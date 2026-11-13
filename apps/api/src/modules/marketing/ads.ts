/**
 * Ads funnel: from an ad to a paying client, and back to the ad platform.
 *
 *  1. Leads arrive from Meta Lead Ads (webhook, then the lead is read with the Page's token) and
 *     Google lead form ads (webhook with the studio's secret key), or staff add them by hand.
 *     The same lead never arrives twice; a lead who's already a client is marked as such.
 *  2. Follow-up: a first email with their own sign-up link, an optional reminder if they haven't
 *     joined after a few days, and an alert to the team so someone can call.
 *  3. When they join (by their link, or the same email or phone) the lead is matched; when they
 *     first pay, it's marked as bought with the amount.
 *  4. Results go back to the platforms so ads find more people who actually pay:
 *     - Meta Conversions API: sign-ups and first purchases, with hashed email/phone only.
 *     - Google: a private CSV address Google Ads reads on a schedule (offline conversion
 *       import by click id), so no Google developer account is needed.
 *  5. The funnel report: leads → joined → bought, per source and campaign.
 *
 * Tokens are stored encrypted (see lib/secrets.ts) and are never sent back to the apps.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac } from "node:crypto";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { LEAD_SOURCES, LEAD_STATUSES, adsSettings as adsSettingsInput, leadInput, leadUpdate, schemas } from "@studio/shared";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Db, DbOrTx } from "../../db/client.js";
import { adConversions, adsSettings, clientPackages, emailDesigns, leads, memberships, notifications, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound, unauthorized } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { decryptSecret, encryptSecret, randomToken, sameSecret, sha256 } from "../../lib/secrets.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { notify } from "../notifications/outbox.js";
import { getOrg } from "../sessions/context.js";
import { plansFor, renderEmail } from "./email.js";
import type { Urls } from "./messages.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
type Settings = typeof adsSettings.$inferSelect;
type Lead = typeof leads.$inferSelect;

/** The HTTP client for ad platforms (swapped in tests). */
let adsFetch: typeof fetch = (...a) => fetch(...a);
export const setAdsFetch = (f: typeof fetch) => (adsFetch = f);

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");
const last8 = (p: string | null | undefined) => digits(p).slice(-8);
const DAY = 86_400_000;

export async function settingsFor(db: DbOrTx, orgId: string): Promise<Settings> {
  const [s] = await db.select().from(adsSettings).where(eq(adsSettings.orgId, orgId));
  if (s) return s;
  const [created] = await db.insert(adsSettings).values({ orgId, googleKey: randomToken(16), googleFeedKey: randomToken(24) }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(adsSettings).where(eq(adsSettings.orgId, orgId)))[0]!;
}

export const leadJoinLink = (urls: Urls, orgId: string, token: string) => `${urls.app.replace(/\/$/, "")}/join/${orgId}?lead=${token}`;
const leadName = (l: Pick<Lead, "firstName" | "lastName" | "email" | "phone">) => [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || l.phone || "Someone";

/** Send one of the studio's saved emails to a lead (no account yet), with their own sign-up link. */
async function emailLead(tx: DbOrTx, org: Org, emailId: string, lead: Lead, urls: Urls) {
  if (!lead.email || lead.unsubscribed) return false;
  const [design] = await tx.select().from(emailDesigns).where(and(eq(emailDesigns.id, emailId), eq(emailDesigns.orgId, org.id), isNull(emailDesigns.archivedAt)));
  if (!design) return false;
  const join = leadJoinLink(urls, org.id, lead.token);
  const unsub = `${urls.api.replace(/\/$/, "")}/v1/unsubscribe/lead/${lead.token}`;
  const r = renderEmail(design.design, {
    studioName: org.name, publicApiUrl: urls.api, appUrl: urls.app, plans: await plansFor(tx, org.id, org.currency, design.design), unsubscribeUrl: unsub, lead: true,
    values: { first_name: lead.firstName || "there", last_name: lead.lastName ?? "", join_link: join, referral_link: join, classes_attended: "0", credits_left: "0", studio_credit: money(0, org.currency), referral_code: "" },
  });
  await tx.insert(notifications).values({ orgId: org.id, userId: null, toEmail: lead.email, channel: "email", template: "custom", data: { subject: r.subject, html: r.html, text: r.text, unsubscribeUrl: unsub, ref: { leadId: lead.id } } });
  return true;
}

export type NewLead = {
  source: keyof typeof LEAD_SOURCES;
  firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null; note?: string | null;
  externalId?: string | null; campaignName?: string | null; adName?: string | null; formName?: string | null; gclid?: string | null; isTest?: boolean;
};

/** Record a lead (or recognise one we already have), then follow up. */
export async function createLead(tx: DbOrTx, orgId: string, input: NewLead, urls: Urls, now = new Date()): Promise<{ lead: Lead; duplicate: boolean }> {
  const org = await getOrg(tx, orgId);
  const s = await settingsFor(tx, orgId);
  const email = input.email?.trim().toLowerCase() || null;
  if (input.externalId) {
    const [same] = await tx.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.source, input.source), eq(leads.externalId, input.externalId)));
    if (same) return { lead: same, duplicate: true };
  }
  // Already a client? Then this is a returning or existing member, not a new lead to chase.
  const contactMatch = (emailCol: typeof users.email, phoneCol: typeof users.phone) =>
    or(email ? sql`lower(${emailCol}) = ${email}` : undefined, last8(input.phone).length === 8 ? sql`right(regexp_replace(coalesce(${phoneCol}, ''), '[^0-9]', '', 'g'), 8) = ${last8(input.phone)}` : undefined);
  const [client] = email || last8(input.phone)
    ? await tx.select({ id: users.id }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client"), contactMatch(users.email, users.phone))).limit(1)
    : [];
  // Asked twice (e.g. two ads)? Keep one lead, fill in what's new.
  const [open] = email || last8(input.phone)
    ? await tx
        .select()
        .from(leads)
        .where(and(eq(leads.orgId, orgId), inArray(leads.status, ["new", "contacted"]), gte(leads.createdAt, new Date(now.getTime() - 90 * DAY)), contactMatch(leads.email as never, leads.phone as never)))
        .limit(1)
    : [];
  if (open && !client) {
    const [u] = await tx
      .update(leads)
      .set({ firstName: open.firstName ?? input.firstName ?? null, lastName: open.lastName ?? input.lastName ?? null, email: open.email ?? email, phone: open.phone ?? input.phone ?? null, gclid: open.gclid ?? input.gclid ?? null, campaignName: input.campaignName ?? open.campaignName, adName: input.adName ?? open.adName, formName: input.formName ?? open.formName })
      .where(eq(leads.id, open.id))
      .returning();
    return { lead: u!, duplicate: true };
  }
  const [lead] = await tx
    .insert(leads)
    .values({
      orgId, source: input.source, status: client ? "joined" : "new", firstName: input.firstName ?? null, lastName: input.lastName ?? null, email, phone: input.phone ?? null,
      note: client ? ["Already a client when they filled in the form.", input.note].filter(Boolean).join(" ") : (input.note ?? null),
      externalId: input.externalId ?? null, campaignName: input.campaignName ?? null, adName: input.adName ?? null, formName: input.formName ?? null, gclid: input.gclid ?? null,
      isTest: !!input.isTest, token: randomToken(16), clientId: client?.id ?? null, joinedAt: client ? now : null, createdAt: now,
    })
    .returning();
  const l = lead!;
  if (!client && !l.isTest) {
    if (s.leadFollowUp && s.leadFirstEmailId && (await emailLead(tx, org, s.leadFirstEmailId, l, urls)) && s.leadReminderEmailId) {
      await tx.update(leads).set({ nextFollowUpAt: new Date(now.getTime() + s.leadReminderDays * DAY) }).where(eq(leads.id, l.id));
    }
    if (s.leadNotifyTeam) {
      const team = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), inArray(memberships.role, ["owner", "admin", "front_desk"]), eq(memberships.active, true)));
      await notify(tx, { orgId, userIds: team.map((t) => t.id), template: "lead.new", data: { name: leadName(l), source: LEAD_SOURCES[l.source as keyof typeof LEAD_SOURCES], campaign: l.campaignName, contact: [l.email, l.phone].filter(Boolean).join(" · "), leadId: l.id } });
    }
  }
  return { lead: l, duplicate: false };
}

/** Worker: reminders to leads who haven't joined yet. */
export async function leadFollowUps(db: Db, urls: Urls, now = new Date()) {
  return db.transaction(async (tx) => {
    const due = await tx.select().from(leads).where(and(isNotNull(leads.nextFollowUpAt), lte(leads.nextFollowUpAt, now), isNull(leads.clientId), inArray(leads.status, ["new", "contacted"]), eq(leads.unsubscribed, false))).limit(200).for("update", { skipLocked: true });
    for (const l of due) {
      const s = await settingsFor(tx, l.orgId);
      if (s.leadFollowUp && s.leadReminderEmailId) await emailLead(tx, await getOrg(tx, l.orgId), s.leadReminderEmailId, l, urls);
      await tx.update(leads).set({ nextFollowUpAt: null }).where(eq(leads.id, l.id));
    }
    return due.length;
  });
}

// ---------------------------------------------------------------------------
// Matching leads to clients, and queueing results for the ad platforms
// ---------------------------------------------------------------------------
async function queueConversion(tx: DbOrTx, org: Org, s: Settings, c: { event: "signup" | "purchase"; clientId: string; lead: Lead | null; attribution: Record<string, string> | null; valueCents?: number }, now: Date) {
  const a = Object.fromEntries(Object.entries(c.attribution ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const metaLeadId = c.lead?.source === "meta" ? c.lead.externalId : null;
  const fbclid = a.fbclid ?? null;
  const gclid = c.lead?.gclid ?? a.gclid ?? null;
  const base = { orgId: org.id, event: c.event, clientId: c.clientId, leadId: c.lead?.id ?? null, valueCents: c.valueCents ?? null, currency: org.currency, happenedAt: now };
  if ((metaLeadId || fbclid) && s.metaSendConversions && s.metaPixelId && s.metaCapiToken) {
    await tx.insert(adConversions).values({ ...base, platform: "meta", metaLeadId, fbclid, status: "pending" }).onConflictDoNothing();
  }
  if (gclid && s.googleFeedEnabled) await tx.insert(adConversions).values({ ...base, platform: "google", gclid, status: "listed" }).onConflictDoNothing();
}

/** A new client joined: match their lead (by sign-up link, email or phone) and report the sign-up. */
export async function adsOnJoin(tx: DbOrTx, orgId: string, clientId: string, info: { leadToken?: string | null; email: string; phone?: string | null; attribution?: Record<string, string> | null }, now = new Date()) {
  const org = await getOrg(tx, orgId);
  let [lead] = info.leadToken ? await tx.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.token, info.leadToken))) : [];
  if (!lead) {
    [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.orgId, orgId), isNull(leads.clientId), or(sql`lower(${leads.email}) = ${info.email.toLowerCase()}`, last8(info.phone).length === 8 ? sql`right(regexp_replace(coalesce(${leads.phone}, ''), '[^0-9]', '', 'g'), 8) = ${last8(info.phone)}` : undefined)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
  }
  if (lead) {
    await tx.update(leads).set({ clientId, status: lead.status === "bought" ? "bought" : "joined", joinedAt: now, nextFollowUpAt: null }).where(eq(leads.id, lead.id));
    if (lead.source === "meta" || lead.source === "google") {
      await tx.update(memberships).set({ acquisition: lead.source === "meta" ? "meta_ads" : "google_ads" }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, clientId), sql`${memberships.acquisition} <> 'referral'`));
    }
  }
  if (lead || info.attribution?.fbclid || info.attribution?.gclid) await queueConversion(tx, org, await settingsFor(tx, orgId), { event: "signup", clientId, lead: lead ?? null, attribution: info.attribution ?? null }, now);
}

/** Money paid: if this is the first purchase of someone who came from an ad, mark the lead and report it. */
export async function adsOnPurchase(tx: DbOrTx, orgId: string, clientId: string, cents: number, now = new Date()) {
  if (cents <= 0) return;
  const [paidBefore] = await tx.select({ n: sql<number>`count(*)` }).from(clientPackages).where(and(eq(clientPackages.orgId, orgId), eq(clientPackages.ownerId, clientId), sql`${clientPackages.pricePaidCents} > 0`));
  if (Number(paidBefore!.n) > 1) return; // the package that triggered this is already counted
  const [lead] = await tx.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.clientId, clientId))).orderBy(desc(leads.createdAt)).limit(1);
  const [m] = await tx.select({ attribution: memberships.attribution }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, clientId)));
  if (!lead && !m?.attribution?.fbclid && !m?.attribution?.gclid) return;
  if (lead && !lead.boughtAt) await tx.update(leads).set({ status: "bought", boughtAt: now, firstPurchaseCents: cents }).where(eq(leads.id, lead.id));
  await queueConversion(tx, await getOrg(tx, orgId), await settingsFor(tx, orgId), { event: "purchase", clientId, lead: lead ?? null, attribution: m?.attribution ?? null, valueCents: cents }, now);
}

// ---------------------------------------------------------------------------
// Meta: reading leads and sending conversions
// ---------------------------------------------------------------------------
const graph = (cfg: Pick<Config, "META_GRAPH_VERSION">, path: string) => `https://graph.facebook.com/${cfg.META_GRAPH_VERSION}/${path}`;

async function fetchMetaLead(cfg: Pick<Config, "META_GRAPH_VERSION">, leadgenId: string, token: string) {
  const res = await adsFetch(`${graph(cfg, encodeURIComponent(leadgenId))}?fields=field_data,campaign_name,ad_name,form_id,created_time&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as { field_data?: { name: string; values: string[] }[]; campaign_name?: string; ad_name?: string; form_id?: string; error?: { message: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `Meta responded ${res.status}`);
  const f = Object.fromEntries((body.field_data ?? []).map((x) => [x.name.toLowerCase(), x.values?.[0] ?? ""]));
  const [first, ...rest] = (f.full_name ?? "").trim().split(/\s+/);
  return {
    firstName: f.first_name || first || null,
    lastName: f.last_name || rest.join(" ") || null,
    email: f.email || null,
    phone: f.phone_number || f.phone || null,
    campaignName: body.campaign_name ?? null,
    adName: body.ad_name ?? null,
  };
}

/** Meta's user data rules: trimmed, lower-case, SHA-256; phones with country code and digits only. */
function metaUserData(u: { email: string; phone: string | null; firstName: string; lastName: string; clientId: string }, countryCode: string, conv: typeof adConversions.$inferSelect) {
  const ph = digits(u.phone);
  const phone = ph.length === 8 ? `${countryCode}${ph}` : ph;
  return {
    em: [sha256(u.email.trim().toLowerCase())],
    ...(phone ? { ph: [sha256(phone)] } : {}),
    fn: [sha256(u.firstName.trim().toLowerCase())],
    ln: [sha256(u.lastName.trim().toLowerCase())],
    external_id: [sha256(u.clientId)],
    ...(conv.fbclid ? { fbc: `fb.1.${conv.happenedAt.getTime()}.${conv.fbclid}` } : {}),
    ...(conv.metaLeadId ? { lead_id: conv.metaLeadId } : {}),
  };
}

/** Worker: send waiting conversions to Meta, one request per studio, with retries. */
export async function sendMetaConversions(db: Db, cfg: Pick<Config, "META_GRAPH_VERSION">, opts: { testEventCode?: string; orgId?: string } = {}) {
  const pending = await db
    .select({ c: adConversions, email: users.email, phone: users.phone, first: users.firstName, last: users.lastName })
    .from(adConversions)
    .innerJoin(users, eq(users.id, adConversions.clientId))
    .where(and(eq(adConversions.platform, "meta"), eq(adConversions.status, "pending"), opts.orgId ? eq(adConversions.orgId, opts.orgId) : undefined))
    .limit(500);
  const byOrg = new Map<string, typeof pending>();
  for (const p of pending) byOrg.set(p.c.orgId, [...(byOrg.get(p.c.orgId) ?? []), p]);
  let sent = 0;
  for (const [orgId, rows] of byOrg) {
    const s = await settingsFor(db, orgId);
    if (!s.metaPixelId || !s.metaCapiToken || !s.metaSendConversions) continue;
    const data = rows.map(({ c, email, phone, first, last }) => ({
      event_name: c.event === "signup" ? "CompleteRegistration" : "Purchase",
      event_time: Math.floor(c.happenedAt.getTime() / 1000),
      event_id: c.id,
      action_source: "system_generated",
      user_data: metaUserData({ email, phone, firstName: first, lastName: last, clientId: c.clientId! }, s.phoneCountryCode, c),
      custom_data: c.event === "purchase" ? { value: (c.valueCents ?? 0) / 100, currency: c.currency } : { lead_event_source: "Studio booking app", event_source: "crm" },
    }));
    const ids = rows.map((r) => r.c.id);
    try {
      const res = await adsFetch(`${graph(cfg, `${s.metaPixelId}/events`)}?access_token=${encodeURIComponent(decryptSecret(s.metaCapiToken))}`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, ...(opts.testEventCode ? { test_event_code: opts.testEventCode } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) throw new Error(body.error?.message ?? `Meta responded ${res.status}`);
      await db.update(adConversions).set({ status: "sent", sentAt: new Date(), attempts: sql`${adConversions.attempts} + 1` }).where(inArray(adConversions.id, ids));
      await db.update(adsSettings).set({ metaLastError: null }).where(eq(adsSettings.orgId, orgId));
      sent += ids.length;
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err).slice(0, 300);
      await db.update(adConversions).set({ attempts: sql`${adConversions.attempts} + 1`, lastError: msg, status: sql`case when ${adConversions.attempts} + 1 >= 5 then 'failed' else 'pending' end` }).where(inArray(adConversions.id, ids));
      await db.update(adsSettings).set({ metaLastError: msg }).where(eq(adsSettings.orgId, orgId));
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// The funnel report
// ---------------------------------------------------------------------------
export async function funnel(db: DbOrTx, orgId: string, days: number, now = new Date()) {
  const org = await getOrg(db, orgId);
  const from = new Date(now.getTime() - days * DAY);
  const ls = await db.select().from(leads).where(and(eq(leads.orgId, orgId), eq(leads.isTest, false), gte(leads.createdAt, from)));
  // People who joined straight from an ad (no form): counted as sign-ups for that platform.
  const direct = await db
    .select({ id: memberships.userId, acq: memberships.acquisition })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.acquisition, ["meta_ads", "google_ads"]), gte(memberships.createdAt, from)));
  const leadClients = new Set(ls.map((l) => l.clientId).filter(Boolean));
  const firstBuys = new Map<string, number>();
  const directIds = direct.filter((d) => !leadClients.has(d.id)).map((d) => d.id);
  if (directIds.length) {
    const rows = await db
      .select({ id: clientPackages.ownerId, cents: clientPackages.pricePaidCents, at: clientPackages.purchasedAt })
      .from(clientPackages)
      .where(and(eq(clientPackages.orgId, orgId), inArray(clientPackages.ownerId, directIds), sql`${clientPackages.pricePaidCents} > 0`))
      .orderBy(clientPackages.purchasedAt);
    for (const r of rows) if (!firstBuys.has(r.id)) firstBuys.set(r.id, r.cents);
  }
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  const row = (source: string, label: string) => {
    const mine = ls.filter((l) => l.source === source);
    const joinedLeads = mine.filter((l) => l.joinedAt).length;
    const boughtLeads = mine.filter((l) => l.boughtAt);
    const d = direct.filter((x) => !leadClients.has(x.id) && x.acq === (source === "meta" ? "meta_ads" : source === "google" ? "google_ads" : "_"));
    const dBought = d.filter((x) => firstBuys.has(x.id));
    const revenue = boughtLeads.reduce((a, l) => a + (l.firstPurchaseCents ?? 0), 0) + dBought.reduce((a, x) => a + firstBuys.get(x.id)!, 0);
    const joined = joinedLeads + d.length, bought = boughtLeads.length + dBought.length;
    return { source, label, leads: mine.length, joinedFromAdWithoutForm: d.length, joined, bought, revenueCents: revenue, revenue: money(revenue, org.currency), leadToJoin: rate(joinedLeads, mine.length), joinToBuy: rate(bought, joined) };
  };
  const sources = [row("meta", LEAD_SOURCES.meta), row("google", LEAD_SOURCES.google), row("manual", LEAD_SOURCES.manual)];
  const campaigns = [...new Set(ls.map((l) => l.campaignName).filter(Boolean))].map((name) => {
    const m = ls.filter((l) => l.campaignName === name);
    const rev = m.reduce((a, l) => a + (l.firstPurchaseCents ?? 0), 0);
    return { name, source: m[0]!.source, leads: m.length, joined: m.filter((l) => l.joinedAt).length, bought: m.filter((l) => l.boughtAt).length, revenue: money(rev, org.currency), revenueCents: rev };
  }).sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads);
  const total = sources.reduce((a, s) => ({ leads: a.leads + s.leads, joined: a.joined + s.joined, bought: a.bought + s.bought, revenueCents: a.revenueCents + s.revenueCents }), { leads: 0, joined: 0, bought: 0, revenueCents: 0 });
  return { days, total: { ...total, revenue: money(total.revenueCents, org.currency) }, sources, campaigns };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const idParam = z.object({ id: schemas.id });
const orgParam = z.object({ orgId: schemas.id });
const tokenParam = z.object({ token: z.string().regex(/^[a-f0-9]{32}$/) });
const leadsQuery = z.object({ status: z.enum([...(Object.keys(LEAD_STATUSES) as [string, ...string[]]), "open", "all"]).default("open"), source: z.enum(Object.keys(LEAD_SOURCES) as [string, ...string[]]).optional(), q: z.string().trim().max(100).optional() });
const funnelQuery = z.object({ days: z.coerce.number().int().min(7).max(730).default(30) });
const metaWebhook = z.object({ object: z.string(), entry: z.array(z.object({ id: z.string(), changes: z.array(z.object({ field: z.string(), value: z.record(z.string(), z.unknown()) })).default([]) })).default([]) });
const googleLead = z.object({
  google_key: z.string(),
  lead_id: z.string().optional(),
  campaign_id: z.union([z.string(), z.number()]).optional(),
  form_id: z.union([z.string(), z.number()]).optional(),
  gcl_id: z.string().optional(),
  is_test: z.boolean().optional(),
  user_column_data: z.array(z.object({ column_id: z.string(), string_value: z.string().optional() })).default([]),
});

export async function adsRoutes(app: FastifyInstance) {
  const { db, config } = app;
  const urls: Urls = { api: config.PUBLIC_API_URL, app: config.PUBLIC_APP_URL };

  const settingsView = (s: Settings, orgId: string) => ({
    meta: {
      pageId: s.metaPageId, pageConnected: !!s.metaPageToken, pixelId: s.metaPixelId, conversionsConnected: !!s.metaCapiToken, sendConversions: s.metaSendConversions, lastError: s.metaLastError,
      webhookUrl: `${urls.api.replace(/\/$/, "")}/v1/public/ads/meta/webhook`, webhookReady: !!(config.META_APP_SECRET && config.META_VERIFY_TOKEN),
    },
    google: {
      leadWebhookUrl: `${urls.api.replace(/\/$/, "")}/v1/public/ads/google/${orgId}/leads`, key: s.googleKey,
      feedEnabled: s.googleFeedEnabled, feedUrl: `${urls.api.replace(/\/$/, "")}/v1/public/ads/google/${orgId}/conversions.csv?key=${s.googleFeedKey}`,
      signupName: s.googleSignupName, purchaseName: s.googlePurchaseName,
    },
    phoneCountryCode: s.phoneCountryCode,
    followUp: { enabled: s.leadFollowUp, firstEmailId: s.leadFirstEmailId, reminderEmailId: s.leadReminderEmailId, reminderDays: s.leadReminderDays, notifyTeam: s.leadNotifyTeam },
  });

  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => requirePermission(req, "manageMarketing"));

    admin.get("/ads/settings", async (req) => settingsView(await settingsFor(db, req.auth.orgId), req.auth.orgId));
    admin.patch("/ads/settings", async (req) => {
      const input = parse(adsSettingsInput, req.body);
      const sent = Object.keys(req.body ?? {});
      const s = await settingsFor(db, req.auth.orgId);
      const set: Partial<Settings> = {};
      for (const [k, v] of Object.entries(input)) if (sent.includes(k)) (set as Record<string, unknown>)[k] = v;
      // Tokens are encrypted before they're stored; null removes them.
      for (const k of ["metaPageToken", "metaCapiToken"] as const) if (sent.includes(k)) set[k] = input[k] ? encryptSecret(input[k]!) : null;
      for (const k of ["leadFirstEmailId", "leadReminderEmailId"] as const) {
        if (set[k]) {
          const [e] = await db.select({ id: emailDesigns.id }).from(emailDesigns).where(and(eq(emailDesigns.id, set[k]!), eq(emailDesigns.orgId, req.auth.orgId), isNull(emailDesigns.archivedAt)));
          if (!e) throw notFound("email");
        }
      }
      const next = { ...s, ...set };
      if (next.metaSendConversions && (!next.metaPixelId || !next.metaCapiToken)) throw badRequest("meta_incomplete", "Add your dataset ID and Conversions API token before switching this on.");
      if (next.leadFollowUp && !next.leadFirstEmailId) throw badRequest("no_email", "Choose the first email new leads get.");
      const [u] = await db.update(adsSettings).set(set).where(eq(adsSettings.orgId, req.auth.orgId)).returning();
      await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "ads.settings", entityType: "organization", entityId: req.auth.orgId, details: { changed: sent } });
      return settingsView(u!, req.auth.orgId);
    });
    /** New Google keys (e.g. if one was shared by mistake). Paste the new ones into Google Ads. */
    admin.post("/ads/settings/rotate-google-keys", async (req) => {
      await settingsFor(db, req.auth.orgId);
      const [u] = await db.update(adsSettings).set({ googleKey: randomToken(16), googleFeedKey: randomToken(24) }).where(eq(adsSettings.orgId, req.auth.orgId)).returning();
      return settingsView(u!, req.auth.orgId);
    });
    /** Send any waiting conversions now, optionally as a test (shows under Test events in Meta's Events Manager). */
    admin.post("/ads/meta/send", async (req) => {
      const { testEventCode } = parse(z.object({ testEventCode: z.string().trim().max(40).optional() }), req.body ?? {});
      const sentNow = await sendMetaConversions(db, config, { testEventCode, orgId: req.auth.orgId });
      const s = await settingsFor(db, req.auth.orgId);
      return { sent: sentNow, error: s.metaLastError };
    });

    admin.get("/ads/funnel", async (req) => funnel(db, req.auth.orgId, parse(funnelQuery, req.query).days));

    admin.get("/leads", async (req) => {
      const { status, source, q } = parse(leadsQuery, req.query);
      const search = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const rows = await db
        .select()
        .from(leads)
        .where(and(
          eq(leads.orgId, req.auth.orgId),
          status === "all" ? undefined : status === "open" ? inArray(leads.status, ["new", "contacted"]) : eq(leads.status, status),
          source ? eq(leads.source, source) : undefined,
          search ? or(ilike(leads.firstName, search), ilike(leads.lastName, search), ilike(leads.email, search), ilike(leads.phone, search), ilike(leads.campaignName, search)) : undefined,
        ))
        .orderBy(desc(leads.createdAt))
        .limit(500);
      return rows.map(({ token: _t, ...l }) => ({ ...l, name: leadName(l), sourceLabel: LEAD_SOURCES[l.source as keyof typeof LEAD_SOURCES], statusLabel: LEAD_STATUSES[l.status as keyof typeof LEAD_STATUSES] }));
    });
    /** A lead who called or walked in. */
    admin.post("/leads", async (req, reply) => {
      const input = parse(leadInput, req.body);
      const r = await inTx(app, (tx) => createLead(tx, req.auth.orgId, { ...input, source: "manual" }, urls));
      reply.code(r.duplicate ? 200 : 201);
      const { token: _t, ...l } = r.lead;
      return { ...l, duplicate: r.duplicate };
    });
    admin.patch("/leads/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(leadUpdate, req.body);
      const [cur] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, req.auth.orgId)));
      if (!cur) throw notFound("lead");
      if (input.status && (cur.status === "joined" || cur.status === "bought")) throw conflict("already_joined", "This lead has already joined, so their status follows what they do.");
      const [u] = await db.update(leads).set({ ...input, ...(input.status === "lost" ? { nextFollowUpAt: null } : {}) }).where(eq(leads.id, id)).returning();
      const { token: _t, ...l } = u!;
      return l;
    });
    /** Erase a lead completely (e.g. they asked for their details to be deleted). */
    admin.delete("/leads/:id", async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const [l] = await db.delete(leads).where(and(eq(leads.id, id), eq(leads.orgId, req.auth.orgId))).returning();
      if (!l) throw notFound("lead");
      await db.delete(notifications).where(and(eq(notifications.orgId, req.auth.orgId), eq(notifications.status, "pending"), sql`${notifications.data}->'ref'->>'leadId' = ${id}`));
      await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "lead.deleted", entityType: "lead", entityId: id });
      return reply.code(204).send();
    });
  });

  // --- Public: webhooks, the Google feed, and stopping lead emails ---------------------------
  /** Meta Lead Ads. GET answers Meta's verification; POST is signed with the app secret over the raw body. */
  app.register(async (hooks) => {
    hooks.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
      try { done(null, body ? JSON.parse(body as string) : {}); } catch { done(badRequest("bad_json", "That request couldn't be understood."), undefined); }
    });
    hooks.get("/public/ads/meta/webhook", { config: { public: true } }, async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (!config.META_VERIFY_TOKEN || q["hub.mode"] !== "subscribe" || !sameSecret(q["hub.verify_token"] ?? "", config.META_VERIFY_TOKEN)) throw unauthorized();
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    });
    hooks.post("/public/ads/meta/webhook", { config: { public: true, rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req) => {
      const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
      const sig = String(req.headers["x-hub-signature-256"] ?? "");
      if (!config.META_APP_SECRET || !sig.startsWith("sha256=") || !sameSecret(sig, `sha256=${createHmac("sha256", config.META_APP_SECRET).update(raw).digest("hex")}`)) throw unauthorized();
      const body = parse(metaWebhook, req.body);
      let received = 0;
      for (const entry of body.entry) {
        for (const ch of entry.changes) {
          if (ch.field !== "leadgen") continue;
          const leadgenId = String(ch.value.leadgen_id ?? "");
          const pageId = String(ch.value.page_id ?? entry.id);
          const studios = await db.select().from(adsSettings).where(eq(adsSettings.metaPageId, pageId));
          for (const s of studios) {
            if (!s.metaPageToken || !leadgenId) continue;
            try {
              const details = await fetchMetaLead(config, leadgenId, decryptSecret(s.metaPageToken));
              await inTx(app, (tx) => createLead(tx, s.orgId, { source: "meta", externalId: leadgenId, ...details }, urls));
              received++;
            } catch (err) {
              await db.update(adsSettings).set({ metaLastError: `Couldn't read a lead from Meta: ${String(err instanceof Error ? err.message : err).slice(0, 200)}` }).where(eq(adsSettings.orgId, s.orgId));
            }
          }
        }
      }
      return { received };
    });
  });

  /** Google lead form ads: Google sends each lead with the key the studio pasted into Google Ads. */
  app.post("/public/ads/google/:orgId/leads", { config: { public: true, rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (req) => {
    const { orgId } = parse(orgParam, req.params);
    const body = parse(googleLead, req.body);
    const [s] = await db.select().from(adsSettings).where(eq(adsSettings.orgId, orgId));
    if (!s || !sameSecret(body.google_key, s.googleKey)) throw unauthorized();
    const col = (id: string) => body.user_column_data.find((c) => c.column_id === id)?.string_value?.trim() || null;
    const [first, ...rest] = (col("FULL_NAME") ?? "").split(/\s+/);
    await inTx(app, (tx) =>
      createLead(tx, orgId, {
        source: "google", externalId: body.lead_id ?? null, email: col("EMAIL"), phone: col("PHONE_NUMBER"),
        firstName: col("FIRST_NAME") ?? (first || null), lastName: col("LAST_NAME") ?? (rest.join(" ") || null),
        campaignName: body.campaign_id ? `Campaign ${body.campaign_id}` : null, formName: body.form_id ? `Form ${body.form_id}` : null, gclid: body.gcl_id ?? null, isTest: !!body.is_test,
      }, urls),
    );
    return {};
  });

  /** Google Ads offline conversion import: a CSV Google reads on a schedule, by click id (GCLID). */
  app.get("/public/ads/google/:orgId/conversions.csv", { config: { public: true } }, async (req, reply) => {
    const { orgId } = parse(orgParam, req.params);
    const { key } = parse(z.object({ key: z.string().max(100) }), req.query);
    const [s] = await db.select().from(adsSettings).where(eq(adsSettings.orgId, orgId));
    if (!s || !s.googleFeedEnabled || !sameSecret(key, s.googleFeedKey)) throw unauthorized();
    const org = await getOrg(db, orgId);
    const rows = await db.select().from(adConversions).where(and(eq(adConversions.orgId, orgId), eq(adConversions.platform, "google"), gte(adConversions.happenedAt, new Date(Date.now() - 90 * DAY)))).orderBy(adConversions.happenedAt);
    const cell = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""');
    const lines = [
      `Parameters:TimeZone=${org.timezone}`,
      "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency",
      ...rows.map((r) => [r.gclid ?? "", r.event === "signup" ? s.googleSignupName : s.googlePurchaseName, DateTime.fromJSDate(r.happenedAt, { zone: org.timezone }).toFormat("yyyy-MM-dd HH:mm:ss"), r.valueCents ? (r.valueCents / 100).toFixed(2) : "", r.valueCents ? (r.currency ?? org.currency) : ""].map((v) => `"${cell(String(v))}"`).join(",")),
    ];
    reply.header("content-type", "text/csv; charset=utf-8").header("cache-control", "no-store");
    return lines.join("\n") + "\n";
  });

  /** "Stop these emails" in follow-ups to leads. GET confirms (so link scanners can't stop them); POST stops. */
  const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#17201c;background:#f4f6f4}button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #0e6b5f;background:#0e6b5f;color:#fff}</style></head><body>${body}</body></html>`;
  app.get("/unsubscribe/lead/:token", { config: { public: true } }, async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const [l] = await db.select({ unsub: leads.unsubscribed }).from(leads).where(eq(leads.token, token));
    reply.type("text/html");
    if (!l) return page("Stop emails", "<h1>That link has expired</h1>");
    if (l.unsub) return page("Stopped", "<h1>Done</h1><p>You won't get any more emails about your enquiry.</p>");
    return page("Stop emails", '<h1>Stop these emails?</h1><p>You won\'t hear from us again about your enquiry.</p><form method="post"><button type="submit">Stop emails</button></form>');
  });
  app.post("/unsubscribe/lead/:token", { config: { public: true } }, async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    await db.update(leads).set({ unsubscribed: true, nextFollowUpAt: null }).where(eq(leads.token, token));
    reply.type("text/html");
    return page("Stopped", "<h1>Done</h1><p>You won't get any more emails about your enquiry.</p>");
  });
}
