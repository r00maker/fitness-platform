/**
 * Sending builder emails and custom push notifications (campaigns, journeys, announcements).
 *
 * Each message is personalised and queued in the same notifications outbox as booking emails,
 * so it's sent by the worker with retries, and rolls back if the change that caused it does.
 * Marketing emails only go to clients who agreed to them, and always carry an unsubscribe link.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { emailDesigns, memberships, notifications, users } from "../../db/schema.js";
import { money } from "../bookings/rules.js";
import { getOrg } from "../sessions/context.js";
import { attendedCounts, creditBalances, creditsLeft } from "./segments.js";
import { plansFor, renderEmail, type MergeValues } from "./email.js";
import { ensureReferralCode, referralLink } from "./referrals.js";

export interface Urls { api: string; app: string }
type Design = typeof emailDesigns.$inferSelect;
const CHUNK = 500;

/** The personal details {{tags}} can use, for each client. */
export async function mergeValues(db: DbOrTx, orgId: string, clientIds: string[], urls: Urls, now = new Date()): Promise<Map<string, MergeValues & { email: string; unsubscribeToken: string; marketingEmail: boolean; marketingPush: boolean }>> {
  if (!clientIds.length) return new Map();
  const org = await getOrg(db, orgId);
  const rows = await db
    .select({ id: users.id, first: users.firstName, last: users.lastName, email: users.email, token: memberships.unsubscribeToken, code: memberships.referralCode, mEmail: memberships.marketingEmail, mPush: memberships.marketingPush })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, clientIds)));
  const att = await attendedCounts(db, orgId, clientIds);
  const left = await creditsLeft(db, orgId, clientIds, now);
  const credit = await creditBalances(db, orgId, now, clientIds);
  const out = new Map();
  for (const r of rows) {
    const code = r.code ?? (org.referralsEnabled ? await ensureReferralCode(db, orgId, r.id, r.first) : "");
    out.set(r.id, {
      first_name: r.first,
      last_name: r.last,
      classes_attended: String(att.get(r.id) ?? 0),
      credits_left: String(left.get(r.id) ?? 0),
      studio_credit: money(credit.get(r.id) ?? 0, org.currency),
      referral_code: code,
      referral_link: code ? referralLink(urls.app, orgId, code) : urls.app,
      join_link: `${urls.app.replace(/\/$/, "")}/join/${orgId}`,
      email: r.email,
      unsubscribeToken: r.token,
      marketingEmail: r.mEmail,
      marketingPush: r.mPush,
    });
  }
  return out;
}

export const unsubscribeUrl = (urls: Urls, token: string) => `${urls.api.replace(/\/$/, "")}/v1/unsubscribe/${token}`;

/**
 * Queue a builder email to clients. Marketing emails skip anyone who hasn't agreed to them.
 * `ref` ends up with the message (e.g. { campaignId }) for reports.
 */
export async function queueDesignEmail(db: DbOrTx, orgId: string, design: Design, clientIds: string[], urls: Urls, ref: Record<string, unknown>, now = new Date()) {
  const org = await getOrg(db, orgId);
  const values = await mergeValues(db, orgId, clientIds, urls, now);
  const plans = await plansFor(db, orgId, org.currency, design.design);
  const rows: (typeof notifications.$inferInsert)[] = [];
  let skipped = 0;
  for (const id of clientIds) {
    const v = values.get(id);
    if (!v) continue;
    if (design.purpose === "marketing" && !v.marketingEmail) { skipped++; continue; }
    const unsub = design.purpose === "marketing" ? unsubscribeUrl(urls, v.unsubscribeToken) : null;
    const r = renderEmail(design.design, { studioName: org.name, publicApiUrl: urls.api, appUrl: urls.app, values: v, plans, unsubscribeUrl: unsub });
    rows.push({ orgId, userId: id, channel: "email", template: "custom", data: { subject: r.subject, html: r.html, text: r.text, ...(unsub ? { unsubscribeUrl: unsub } : {}), ref: { ...ref, emailId: design.id } } });
  }
  for (let i = 0; i < rows.length; i += CHUNK) await db.insert(notifications).values(rows.slice(i, i + CHUNK));
  return { sent: rows.length, skipped };
}

/** Queue a push notification. Marketing pushes skip anyone who hasn't agreed; service ones (announcements) don't. */
export async function queuePush(db: DbOrTx, orgId: string, clientIds: string[], msg: { title: string; body: string; marketing: boolean; ref: Record<string, unknown>; sendAfter?: Date }) {
  let ids = [...new Set(clientIds)];
  let skipped = 0;
  if (msg.marketing && ids.length) {
    const ok = new Set((await db.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, ids), eq(memberships.marketingPush, true)))).map((r) => r.id));
    skipped = ids.filter((i) => !ok.has(i)).length;
    ids = ids.filter((i) => ok.has(i));
  }
  const rows = ids.map((userId) => ({ orgId, userId, channel: "push" as const, template: "custom", data: { title: msg.title, body: msg.body, ref: msg.ref }, ...(msg.sendAfter ? { sendAfter: msg.sendAfter } : {}) }));
  for (let i = 0; i < rows.length; i += CHUNK) await db.insert(notifications).values(rows.slice(i, i + CHUNK));
  return { sent: rows.length, skipped };
}
