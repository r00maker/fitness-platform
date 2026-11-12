/**
 * Studio credit (money to spend in the online store), one-time discounts, and rewards.
 *
 * Credit comes in grants, each with its own expiry (a gift card, a referral reward, a goodwill
 * top-up). Spending takes from the grant that expires soonest, so clients never lose credit
 * they could have used. Every change is in the credit ledger.
 */
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { describeReward, type Reward } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { clientPackageMembers, clientPackages, creditGrants, creditLedger, packageLedger, vouchers } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict } from "../../lib/errors.js";
import { money } from "../bookings/rules.js";
import { getOrg } from "../sessions/context.js";

type Source = "gift_card" | "referral" | "journey" | "studio";

/** The end of the local day N days from now, so "valid for 30 days" means the whole 30th day. */
export function endOfDayAfter(days: number, zone: string, now = new Date()) {
  return DateTime.fromJSDate(now, { zone }).plus({ days }).endOf("day").toJSDate();
}

export async function grantCredit(
  tx: DbOrTx,
  g: { orgId: string; clientId: string; amountCents: number; currency: string; source: Source; sourceId?: string | null; note: string; expiresAt: Date; by?: string | null },
) {
  const [grant] = await tx
    .insert(creditGrants)
    .values({ orgId: g.orgId, clientId: g.clientId, amountCents: g.amountCents, remainingCents: g.amountCents, currency: g.currency, source: g.source, sourceId: g.sourceId ?? null, note: g.note, expiresAt: g.expiresAt, createdBy: g.by ?? null })
    .returning();
  await tx.insert(creditLedger).values({ orgId: g.orgId, clientId: g.clientId, grantId: grant!.id, change: g.amountCents, reason: "granted", note: g.note, createdBy: g.by ?? null });
  return grant!;
}

/** Credit a client can spend now, soonest-expiring first. */
export async function usableGrants(tx: DbOrTx, orgId: string, clientId: string, now = new Date(), lock = false) {
  const q = tx
    .select()
    .from(creditGrants)
    .where(and(eq(creditGrants.orgId, orgId), eq(creditGrants.clientId, clientId), gt(creditGrants.remainingCents, 0), gt(creditGrants.expiresAt, now)))
    .orderBy(asc(creditGrants.expiresAt), asc(creditGrants.createdAt));
  return lock ? q.for("update") : q;
}

export async function creditSummary(tx: DbOrTx, orgId: string, clientId: string, now = new Date()) {
  const org = await getOrg(tx, orgId);
  const grants = await usableGrants(tx, orgId, clientId, now);
  const total = grants.reduce((a, g) => a + g.remainingCents, 0);
  const history = await tx.select().from(creditLedger).where(and(eq(creditLedger.orgId, orgId), eq(creditLedger.clientId, clientId))).orderBy(asc(creditLedger.createdAt));
  return {
    balanceCents: total,
    balance: money(total, org.currency),
    /** Shown as "SGD 50.00 expires 3 Mar" so nothing comes as a surprise. */
    pieces: grants.map((g) => ({ amount: money(g.remainingCents, g.currency), amountCents: g.remainingCents, expiresAt: g.expiresAt, from: g.note })),
    history: history.reverse().slice(0, 100).map((h) => ({ ...h, amount: `${h.change < 0 ? "−" : "+"}${money(Math.abs(h.change), org.currency)}` })),
  };
}

/** Spend up to `amountCents` of credit on an order. Returns how much was used. */
export async function spendCredit(tx: DbOrTx, orgId: string, clientId: string, amountCents: number, orderId: string, now = new Date()) {
  let left = amountCents;
  for (const g of await usableGrants(tx, orgId, clientId, now, true)) {
    if (left <= 0) break;
    const take = Math.min(left, g.remainingCents);
    await tx.update(creditGrants).set({ remainingCents: g.remainingCents - take }).where(eq(creditGrants.id, g.id));
    await tx.insert(creditLedger).values({ orgId, clientId, grantId: g.id, change: -take, reason: "used", orderId, note: "Used at checkout" });
    left -= take;
  }
  return amountCents - left;
}

/** An order was cancelled: put its credit back where it came from. */
export async function returnCredit(tx: DbOrTx, orgId: string, orderId: string) {
  const used = await tx.select().from(creditLedger).where(and(eq(creditLedger.orgId, orgId), eq(creditLedger.orderId, orderId), eq(creditLedger.reason, "used")));
  for (const u of used) {
    if (!u.grantId) continue;
    const [g] = await tx.select().from(creditGrants).where(eq(creditGrants.id, u.grantId)).for("update");
    if (!g) continue;
    await tx.update(creditGrants).set({ remainingCents: Math.min(g.amountCents, g.remainingCents - u.change) }).where(eq(creditGrants.id, g.id));
    await tx.insert(creditLedger).values({ orgId, clientId: u.clientId, grantId: g.id, change: -u.change, reason: "returned", orderId, note: "Order cancelled" });
  }
}

/** Staff top-up (positive) or correction (negative). */
export async function adjustCredit(tx: DbOrTx, by: { orgId: string; userId: string }, clientId: string, input: { amountCents: number; reason: string; validDays: number }, now = new Date()) {
  const org = await getOrg(tx, by.orgId);
  if (input.amountCents > 0) {
    await grantCredit(tx, { orgId: org.id, clientId, amountCents: input.amountCents, currency: org.currency, source: "studio", note: input.reason, expiresAt: endOfDayAfter(input.validDays, org.timezone, now), by: by.userId });
  } else {
    const grants = await usableGrants(tx, org.id, clientId, now, true);
    const have = grants.reduce((a, g) => a + g.remainingCents, 0);
    if (have < -input.amountCents) throw conflict("not_enough_credit", `They only have ${money(have, org.currency)} of credit.`);
    let left = -input.amountCents;
    for (const g of grants) {
      if (left <= 0) break;
      const take = Math.min(left, g.remainingCents);
      await tx.update(creditGrants).set({ remainingCents: g.remainingCents - take }).where(eq(creditGrants.id, g.id));
      await tx.insert(creditLedger).values({ orgId: org.id, clientId, grantId: g.id, change: -take, reason: "adjusted", note: input.reason, createdBy: by.userId });
      left -= take;
    }
  }
  await audit(tx, { orgId: org.id, actorId: by.userId, action: "credit.adjusted", entityType: "user", entityId: clientId, details: { amountCents: input.amountCents, reason: input.reason } });
  return creditSummary(tx, org.id, clientId, now);
}

// ---------------------------------------------------------------------------
// Vouchers (one-time discounts)
// ---------------------------------------------------------------------------
export async function usableVouchers(tx: DbOrTx, orgId: string, clientId: string, now = new Date()) {
  return tx
    .select()
    .from(vouchers)
    .where(and(eq(vouchers.orgId, orgId), eq(vouchers.clientId, clientId), isNull(vouchers.usedAt), gt(vouchers.expiresAt, now)))
    .orderBy(asc(vouchers.expiresAt));
}
export const voucherDiscount = (v: { percent: number | null; amountCents: number | null }, subtotal: number) =>
  Math.min(subtotal, v.percent ? Math.round((subtotal * v.percent) / 100) : (v.amountCents ?? 0));
export const voucherLabel = (v: { percent: number | null; amountCents: number | null }, currency: string) => (v.percent ? `${v.percent}% off` : `${money(v.amountCents ?? 0, currency)} off`);

// ---------------------------------------------------------------------------
// Rewards (referrals and journeys)
// ---------------------------------------------------------------------------
/** Give a client a reward. Returns a plain-English description of what they got. */
export async function giveReward(
  tx: DbOrTx,
  orgId: string,
  clientId: string,
  reward: Reward,
  ctx: { source: "referral" | "journey"; sourceId?: string | null; why: string; by?: string | null },
  now = new Date(),
): Promise<string> {
  const org = await getOrg(tx, orgId);
  const expiresAt = endOfDayAfter(reward.validDays, org.timezone, now);
  if (reward.type === "credit") {
    await grantCredit(tx, { orgId, clientId, amountCents: reward.amountCents, currency: org.currency, source: ctx.source, sourceId: ctx.sourceId, note: ctx.why, expiresAt, by: ctx.by });
  } else if (reward.type === "discount") {
    await tx.insert(vouchers).values({ orgId, clientId, percent: reward.percent ?? null, amountCents: reward.amountCents ?? null, note: ctx.why, expiresAt });
  } else {
    // A small credit pack of its own, so it shows with their packages and is used like any other.
    const name = `${reward.classes} free ${reward.classes === 1 ? "class" : "classes"}`;
    const [p] = await tx
      .insert(clientPackages)
      .values({
        orgId, planId: null, ownerId: clientId, name, kind: "credits", creditsTotal: reward.classes, creditsLeft: reward.classes,
        validityValue: reward.validDays, validityUnit: "days", startsOn: "purchase", startedAt: now, expiresAt,
        maxUsers: 1, pricePaidCents: 0, currency: org.currency, soldBy: ctx.by ?? null, note: ctx.why, purchasedAt: now,
      })
      .returning();
    await tx.insert(clientPackageMembers).values({ orgId, packageId: p!.id, userId: clientId, addedBy: ctx.by ?? null });
    await tx.insert(packageLedger).values({ orgId, packageId: p!.id, userId: clientId, change: reward.classes, reason: "purchase", note: ctx.why, createdAt: now });
    await tx.insert(packageLedger).values({ orgId, packageId: p!.id, userId: clientId, change: 0, reason: "activated", note: "Started straight away", createdAt: new Date(now.getTime() + 1) });
  }
  return describeReward(reward, (c) => money(c, org.currency));
}

