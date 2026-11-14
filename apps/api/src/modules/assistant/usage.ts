/**
 * AI credits. Each studio's plan includes a number a month. An assistant answer or an announcement
 * draft uses 1 (however many look-ups it took); a campaign draft uses 3. After the month's credits,
 * bought top-ups are used; they don't expire.
 * Owners and admins are told at 80% and at 100%. Reminder agents don't use the allowance: they
 * don't use AI, so they cost next to nothing to run.
 */
import { and, eq, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Config } from "../../config.js";
import type { DbOrTx } from "../../db/client.js";
import { assistantSettings, assistantTopUps, assistantUsage, organizations } from "../../db/schema.js";
import { conflict } from "../../lib/errors.js";
import { notify } from "../notifications/outbox.js";
import { staffIds } from "../sessions/context.js";

export async function settingsFor(db: DbOrTx, orgId: string) {
  const [s] = await db.select().from(assistantSettings).where(eq(assistantSettings.orgId, orgId));
  if (s) return s;
  await db.insert(assistantSettings).values({ orgId }).onConflictDoNothing();
  return (await db.select().from(assistantSettings).where(eq(assistantSettings.orgId, orgId)))[0]!;
}

async function monthOf(db: DbOrTx, orgId: string, now: Date) {
  const [o] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
  const local = DateTime.fromJSDate(now, { zone: o?.tz ?? "UTC" });
  return { month: local.toFormat("yyyy-LL"), resetsOn: local.plus({ months: 1 }).startOf("month").toFormat("d LLLL") };
}

export async function usageFor(db: DbOrTx, cfg: Pick<Config, "ASSISTANT_MONTHLY_REPLIES">, orgId: string, now = new Date()) {
  const s = await settingsFor(db, orgId);
  const { month, resetsOn } = await monthOf(db, orgId, now);
  const [u] = await db.select().from(assistantUsage).where(and(eq(assistantUsage.orgId, orgId), eq(assistantUsage.month, month)));
  const allowance = s.monthlyAllowance ?? cfg.ASSISTANT_MONTHLY_REPLIES;
  const used = (u?.replies ?? 0) - (u?.fromTopUps ?? 0);
  const leftThisMonth = Math.max(0, allowance - used);
  return {
    month,
    resetsOn,
    allowance,
    used,
    leftThisMonth,
    topUpsLeft: s.extraReplies,
    canAsk: leftThisMonth > 0 || s.extraReplies > 0,
    percent: allowance ? Math.min(100, Math.round((used / allowance) * 100)) : 100,
  };
}

/** What each AI job uses. */
export const AI_CREDITS = { answer: 1, announcement: 1, campaign: 3 } as const;

/** Before asking the model: are there enough credits left? */
export async function assertCanAsk(db: DbOrTx, cfg: Pick<Config, "ASSISTANT_MONTHLY_REPLIES">, orgId: string, now = new Date(), cost = 1) {
  const u = await usageFor(db, cfg, orgId, now);
  if (u.leftThisMonth + u.topUpsLeft < cost) {
    throw conflict(
      "assistant_limit",
      u.leftThisMonth + u.topUpsLeft > 0
        ? `This needs ${cost} AI credits and your studio has ${u.leftThisMonth + u.topUpsLeft} left this month. They're topped up on ${u.resetsOn}, or an owner or admin can buy more under Agents → Usage.`
        : `Your studio has used all ${u.allowance} AI credits included this month. They're topped up on ${u.resetsOn}, or an owner or admin can buy more under Agents → Usage.`,
      { resetsOn: u.resetsOn },
    );
  }
  return u;
}

/** After an AI job: count its credits (the month's first, then top-ups) and warn at 80% and 100%. */
export async function recordReply(tx: DbOrTx, cfg: Pick<Config, "ASSISTANT_MONTHLY_REPLIES">, orgId: string, tokens: { input: number; cached: number; output: number }, now = new Date(), cost = 1) {
  const before = await usageFor(tx, cfg, orgId, now);
  const fromMonth = Math.min(Math.max(0, before.leftThisMonth), cost);
  const fromTopUps = Math.min(before.topUpsLeft, cost - fromMonth);
  await tx
    .insert(assistantUsage)
    .values({ orgId, month: before.month, replies: cost, fromTopUps, inputTokens: tokens.input, cachedTokens: tokens.cached, outputTokens: tokens.output })
    .onConflictDoUpdate({
      target: [assistantUsage.orgId, assistantUsage.month],
      set: {
        replies: sql`${assistantUsage.replies} + ${cost}`,
        fromTopUps: sql`${assistantUsage.fromTopUps} + ${fromTopUps}`,
        inputTokens: sql`${assistantUsage.inputTokens} + ${tokens.input}`,
        cachedTokens: sql`${assistantUsage.cachedTokens} + ${tokens.cached}`,
        outputTokens: sql`${assistantUsage.outputTokens} + ${tokens.output}`,
      },
    });
  if (fromTopUps) await tx.update(assistantSettings).set({ extraReplies: sql`greatest(${assistantSettings.extraReplies} - ${fromTopUps}, 0)` }).where(eq(assistantSettings.orgId, orgId));
  const after = await usageFor(tx, cfg, orgId, now);
  const [row] = await tx.select().from(assistantUsage).where(and(eq(assistantUsage.orgId, orgId), eq(assistantUsage.month, after.month)));
  const warn = async (full: boolean) => {
    await notify(tx, { orgId, userIds: await staffIds(tx, orgId, ["owner", "admin"]), template: "assistant.usage", data: { full, used: after.used, allowance: after.allowance, percent: after.percent, resetsOn: after.resetsOn } });
    await tx.update(assistantUsage).set(full ? { warnedAt100: now } : { warnedAt80: now }).where(and(eq(assistantUsage.orgId, orgId), eq(assistantUsage.month, after.month)));
  };
  if (after.allowance && after.used >= after.allowance && !row?.warnedAt100) await warn(true);
  else if (after.allowance && after.percent >= 80 && !row?.warnedAt80 && !row?.warnedAt100) await warn(false);
  return after;
}

/** Called by the payment provider's webhook once a top-up is paid. Safe to call twice. */
export async function topUpPaid(tx: DbOrTx, topUpId: string, provider: string, providerRef: string) {
  const [t] = await tx.update(assistantTopUps).set({ status: "paid", paidAt: new Date(), provider, providerRef }).where(and(eq(assistantTopUps.id, topUpId), eq(assistantTopUps.status, "pending"))).returning();
  if (!t) return null;
  await settingsFor(tx, t.orgId);
  await tx.update(assistantSettings).set({ extraReplies: sql`${assistantSettings.extraReplies} + ${t.replies}` }).where(eq(assistantSettings.orgId, t.orgId));
  return t;
}
