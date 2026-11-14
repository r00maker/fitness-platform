/**
 * Studio booking rules: when booking opens and closes, the optional weekly
 * limit, and late-cancellation / no-show fees. Clients are held to these rules;
 * admins can go outside them (with a warning to confirm where it matters).
 */
import { and, count, eq, gte, lt, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import type { FeeType } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, fees, organizations } from "../../db/schema.js";
import type { TZ } from "../../lib/time.js";
import { notify } from "../notifications/outbox.js";
import { issueInvoice, voidFor } from "../sales/invoices.js";
import { clock } from "../checks/session-checks.js";
import { describeSession, type SessionRow } from "../sessions/context.js";

type Org = typeof organizations.$inferSelect;
type Booking = typeof bookings.$inferSelect;
export type WindowStatus = "not_open_yet" | "open" | "closed";

export function bookingWindow(org: Pick<Org, "bookingOpensDaysBefore" | "bookingClosesMinutesBefore">, startsAt: Date, zone: TZ) {
  const opensAt = DateTime.fromJSDate(startsAt, { zone }).startOf("day").minus({ days: org.bookingOpensDaysBefore }).toJSDate();
  const closesAt = new Date(startsAt.getTime() - org.bookingClosesMinutesBefore * 60_000);
  return { opensAt, closesAt };
}

export function windowStatus(now: Date, w: { opensAt: Date; closesAt: Date }): WindowStatus {
  if (now < w.opensAt) return "not_open_yet";
  if (now >= w.closesAt) return "closed";
  return "open";
}

/** "Booking opens on Tue 11 Nov at 12:00am (midnight)." — the wording clients see. */
export function windowMessage(status: WindowStatus, w: { opensAt: Date; closesAt: Date }, zone: TZ, org: Pick<Org, "bookingClosesMinutesBefore">): string {
  const dt = (d: Date) => `${DateTime.fromJSDate(d, { zone }).toFormat("ccc d LLL")} at ${clock(d, zone)}`;
  if (status === "not_open_yet") return `Booking for this class opens on ${dt(w.opensAt)}.`;
  const mins = org.bookingClosesMinutesBefore;
  const ahead = mins === 0 ? "when class starts" : mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? "" : "s"} before class` : `${mins} minutes before class`;
  return `Booking for this class closed at ${clock(w.closesAt, zone)} (${ahead}).`;
}

/** Bookings the client holds in the Monday–Sunday week of this class. */
export async function weeklyBookings(db: DbOrTx, orgId: string, clientId: string, startsAt: Date, zone: TZ, excludeSessionId?: string) {
  const start = DateTime.fromJSDate(startsAt, { zone }).startOf("week");
  const end = start.plus({ weeks: 1 });
  const [r] = await db
    .select({ n: count() })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(
      and(
        eq(bookings.orgId, orgId),
        eq(bookings.clientId, clientId),
        eq(bookings.status, "confirmed"),
        gte(classSessions.startsAt, start.toJSDate()),
        lt(classSessions.startsAt, end.toJSDate()),
        excludeSessionId ? ne(bookings.sessionId, excludeSessionId) : undefined,
      ),
    );
  return { count: r?.n ?? 0, label: `${start.toFormat("ccc d LLL")} – ${end.minus({ days: 1 }).toFormat("ccc d LLL")}` };
}

export function money(cents: number, currency: string): string {
  try {
    // Currency code ("SGD 15.00") rather than "$", which is ambiguous across the region.
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "code" }).format(cents / 100).replace(/\u00a0/g, " ");
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

/** The fee that would apply, or null if the studio hasn't switched it on. */
export function feeFor(org: Org, type: FeeType): { amountCents: number; currency: string; text: string } | null {
  const enabled = type === "late_cancel" ? org.lateCancelFeeEnabled : org.noShowFeeEnabled;
  const amountCents = type === "late_cancel" ? org.lateCancelFeeCents : org.noShowFeeCents;
  if (!enabled || amountCents <= 0) return null;
  return { amountCents, currency: org.currency, text: money(amountCents, org.currency) };
}

/** Record a fee against a booking (once) and tell the client. */
export async function applyFee(tx: DbOrTx, org: Org, booking: Booking, session: SessionRow, type: FeeType) {
  const fee = feeFor(org, type);
  if (!fee) return null;
  const [row] = await tx
    .insert(fees)
    .values({ orgId: org.id, clientId: booking.clientId, bookingId: booking.id, type, amountCents: fee.amountCents, currency: fee.currency })
    .onConflictDoNothing()
    .returning();
  if (row) {
    const [cls] = await tx.select({ name: classTypes.name }).from(classTypes).where(eq(classTypes.id, session.classTypeId));
    await issueInvoice(tx, { orgId: org.id, clientId: booking.clientId, source: "fee", feeId: row.id, lines: [{ description: type === "no_show" ? "No-show fee" : "Late cancellation fee", detail: cls?.name, quantity: 1, unitCents: fee.amountCents }] });
    await notify(tx, {
      orgId: org.id,
      userIds: [booking.clientId],
      template: "fee.applied",
      data: { ...(await describeSession(tx, session)), bookingId: booking.id, feeText: fee.text, feeType: type },
    });
  }
  return row ?? null;
}

/** Remove a pending fee, e.g. when a no-show is corrected to attended. */
export async function waivePendingFees(tx: DbOrTx, bookingId: string, type: FeeType, by: string, reason: string) {
  const rows = await tx
    .update(fees)
    .set({ status: "waived", waivedBy: by, waivedAt: new Date(), waivedReason: reason })
    .where(and(eq(fees.bookingId, bookingId), eq(fees.type, type), eq(fees.status, "pending")))
    .returning();
  for (const f of rows) await voidFor(tx, { feeId: f.id });
  return rows;
}
