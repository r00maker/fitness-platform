/**
 * Membership renewal payments.
 *
 * When a recurring membership renews, the client's saved card is charged (once a payment provider
 * is connected; until then renewals are paid at the desk, as before). If the charge fails:
 *  - the membership is held: it can't be used to book, and the client and studio are told;
 *  - the card is tried twice more, 3 and 7 days after the first failure;
 *  - paying in the meantime (online or at the desk) lifts the hold straight away;
 *  - if both retries fail, the membership is forfeited: it ends, upcoming classes booked with it
 *    are cancelled, and any early-termination fee applies. To come back the client buys a new
 *    membership, starting a fresh minimum term.
 */
import { and, desc, eq, gt, isNotNull, isNull, lte } from "drizzle-orm";
import type { Db, DbOrTx } from "../../db/client.js";
import { bookings, classSessions, clientPackages, fees, invoices, orders } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { money } from "../bookings/rules.js";
import { notify } from "../notifications/outbox.js";
import { issueInvoice, markPaid } from "../sales/invoices.js";
import { getOrg, staffIds } from "../sessions/context.js";
import { fillOpenSpots } from "../waitlist/engine.js";
import { earlyCancelFee, orgZone } from "./service.js";

const DAY = 86_400_000;
/** Retries after the first failure: day 3 and day 7. */
export const RETRY_DAYS = [3, 7] as const;
export const HOLD_DAYS = 7;

export interface RenewalCharger {
  name: string;
  /** Charge the client's saved card. Never throws for a decline: returns ok: false with a reason. */
  charge(input: { orgId: string; clientId: string; invoiceId: string; amountCents: number; currency: string; description: string }): Promise<{ ok: true; ref: string } | { ok: false; reason: string }>;
}
let charger: RenewalCharger | null = null;
export const setRenewalCharger = (c: RenewalCharger | null) => (charger = c);
export const renewalCharger = () => charger;

type Pkg = typeof clientPackages.$inferSelect;
const heldUntil = (p: Pick<Pkg, "paymentHeldAt">) => new Date(p.paymentHeldAt!.getTime() + HOLD_DAYS * DAY);

/** Why a held membership can't be used to book (null when it isn't held). */
export function holdReason(p: Pick<Pkg, "paymentHeldAt" | "forfeitedAt">, fmt: (d: Date) => string): string | null {
  if (!p.paymentHeldAt || p.forfeitedAt) return null;
  return `Its renewal payment didn't go through, so it's on hold. Update your card or pay at the studio by ${fmt(heldUntil(p))} to keep it`;
}

/** The latest unpaid renewal invoice for a membership. */
async function openRenewal(db: DbOrTx, packageId: string) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.clientPackageId, packageId), eq(invoices.source, "renewal"), eq(invoices.status, "open"))).orderBy(desc(invoices.issuedAt)).limit(1);
  return inv ?? null;
}

/** Paid (by card or at the desk): settle the renewal and lift any hold. */
export async function renewalPaid(tx: DbOrTx, packageId: string, method: "online" | "card" | "cash" | "qr" | "bank_transfer" | "credit" | "other", ref?: string) {
  const inv = await openRenewal(tx, packageId);
  if (inv?.orderId) await tx.update(orders).set({ status: "paid", paidAt: new Date(), ...(ref ? { providerRef: ref } : {}) }).where(and(eq(orders.id, inv.orderId), eq(orders.status, "pending")));
  if (inv) await markPaid(tx, inv, method);
  const [p] = await tx.update(clientPackages).set({ paymentHeldAt: null, paymentRetries: 0, nextPaymentRetryAt: null }).where(and(eq(clientPackages.id, packageId), isNotNull(clientPackages.paymentHeldAt))).returning();
  if (p) await notify(tx, { orgId: p.orgId, userIds: [p.ownerId], template: "membership.payment_recovered", data: { packageName: p.name } });
}

/** Try to charge one renewal. Called straight after renewing and by the retry worker. */
export async function chargeRenewal(db: Db, packageId: string, now = new Date()) {
  if (!charger) return "no_provider" as const;
  const inv = await openRenewal(db, packageId);
  if (!inv) return "nothing_due" as const;
  const res = await charger.charge({ orgId: inv.orgId, clientId: inv.clientId, invoiceId: inv.id, amountCents: inv.totalCents, currency: inv.currency, description: inv.lines[0]?.description ?? "Membership" });
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(clientPackages).where(eq(clientPackages.id, packageId)).for("update");
    if (!p || p.cancelledAt) return "cancelled" as const;
    if (res.ok) {
      await renewalPaid(tx, packageId, "online", res.ref);
      return "paid" as const;
    }
    const org = await getOrg(tx, p.orgId);
    const first = !p.paymentHeldAt;
    const heldAt = p.paymentHeldAt ?? now;
    const retries = first ? 0 : p.paymentRetries + 1;
    if (!first && retries >= RETRY_DAYS.length) {
      await forfeit(tx, p, res.reason, now);
      return "forfeited" as const;
    }
    const next = new Date(heldAt.getTime() + RETRY_DAYS[retries]! * DAY);
    await tx.update(clientPackages).set({ paymentHeldAt: heldAt, paymentRetries: retries, nextPaymentRetryAt: next }).where(eq(clientPackages.id, p.id));
    const fmt = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: org.timezone, weekday: "short", day: "numeric", month: "short" });
    const data = { packageName: p.name, amount: money(inv.totalCents, inv.currency), reason: res.reason, nextTry: fmt(next), holdUntil: fmt(new Date(heldAt.getTime() + HOLD_DAYS * DAY)), first, invoiceId: inv.id };
    await notify(tx, { orgId: p.orgId, userIds: [p.ownerId], template: "membership.payment_failed", data });
    if (first) await notify(tx, { orgId: p.orgId, userIds: await staffIds(tx, p.orgId, ["owner", "admin"]), template: "membership.payment_failed_staff", data: { ...data, clientId: p.ownerId } });
    await audit(tx, { orgId: p.orgId, actorId: null, action: "membership.payment_failed", entityType: "client_package", entityId: p.id, details: { attempt: retries + 1, reason: res.reason } });
    return "held" as const;
  });
}

/** Both retries failed: the membership ends and the early-termination fee (if any) applies. */
async function forfeit(tx: DbOrTx, p: Pkg, reason: string, now: Date) {
  const org = await getOrg(tx, p.orgId);
  const zone = orgZone(org);
  const fee = earlyCancelFee(p, zone) ?? 0;
  await tx.update(clientPackages).set({ cancelledAt: now, cancelReason: "Membership payment failed after 3 tries", forfeitedAt: now, nextPaymentRetryAt: null }).where(eq(clientPackages.id, p.id));
  // The unpaid renewal is cancelled: they never got this period.
  const inv = await openRenewal(tx, p.id);
  if (inv) {
    await tx.update(invoices).set({ status: "void", voidedAt: now }).where(eq(invoices.id, inv.id));
    if (inv.orderId) await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, inv.orderId));
  }
  if (fee > 0) {
    const [f] = await tx.insert(fees).values({ orgId: p.orgId, clientId: p.ownerId, clientPackageId: p.id, type: "early_cancellation", amountCents: fee, currency: p.currency }).returning({ id: fees.id });
    await issueInvoice(tx, { orgId: p.orgId, clientId: p.ownerId, source: "fee", feeId: f!.id, clientPackageId: p.id, lines: [{ description: "Early termination fee", detail: `${p.name}: ended before the minimum term after payment failed`, quantity: 1, unitCents: fee }] });
  }
  // Upcoming classes booked with it are cancelled (the spots go to the waitlist).
  const upcoming = await tx
    .select({ id: bookings.id, sessionId: bookings.sessionId })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.clientPackageId, p.id), eq(bookings.status, "confirmed"), gt(classSessions.startsAt, now)));
  for (const b of upcoming) {
    await tx.update(bookings).set({ status: "cancelled", cancelledAt: now }).where(eq(bookings.id, b.id));
    await fillOpenSpots(tx, p.orgId, b.sessionId, now);
  }
  const data = { packageName: p.name, fee: fee ? money(fee, p.currency) : null, cancelledClasses: upcoming.length, reason };
  await notify(tx, { orgId: p.orgId, userIds: [p.ownerId], template: "membership.forfeited", data });
  await notify(tx, { orgId: p.orgId, userIds: await staffIds(tx, p.orgId, ["owner", "admin"]), template: "membership.forfeited_staff", data: { ...data, clientId: p.ownerId } });
  await audit(tx, { orgId: p.orgId, actorId: null, action: "membership.forfeited", entityType: "client_package", entityId: p.id, details: { feeCents: fee, cancelledBookings: upcoming.length } });
}

/** Worker: retry held memberships whose next try is due. */
export async function retryHeldRenewals(db: Db, now = new Date()) {
  if (!charger) return 0;
  const due = await db
    .select({ id: clientPackages.id })
    .from(clientPackages)
    .where(and(isNotNull(clientPackages.paymentHeldAt), isNull(clientPackages.forfeitedAt), isNull(clientPackages.cancelledAt), lte(clientPackages.nextPaymentRetryAt, now)))
    .limit(200);
  for (const { id } of due) await chargeRenewal(db, id, now);
  return due.length;
}
