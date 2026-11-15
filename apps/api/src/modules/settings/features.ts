/**
 * Feature switches (Setup, Features). Studios switch on what they use, so the apps can show a
 * short menu. Switching a feature off hides it and stops it running, and nothing is deleted:
 *
 *  - Requests to a switched-off feature's pages are refused with `feature_off`, except for
 *    finishing what's already under way (shop orders and rewards waiting to be handed over,
 *    gift cards already sold).
 *  - Things that run on their own stop: live journeys are paused, scheduled campaigns go back
 *    to drafts, lead follow-up emails are cancelled, agents and the email inbox stop. Switching
 *    back on doesn't restart journeys or campaigns; the studio sets them going again, so nothing
 *    is sent late by surprise.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { and, eq, gt, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { FEATURES, FEATURE_LABELS, STORED_FEATURES, schemas, type FeatureKey } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { agents, conversations, emailCampaigns, giftCardDesigns, giftCards, journeys, leads, loyaltyRedemptions, orders, organizations, payRates } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict } from "../../lib/errors.js";
import { withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { getOrg } from "../sessions/context.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
type Setting = Exclude<(typeof FEATURES)[number]["setting"], null>;

const settingOf = (key: FeatureKey): Setting | null => FEATURES.find((f) => f.key === key)!.setting;

/** Whether each feature is on for this studio. */
export function featureState(org: Pick<Org, "featuresOff" | Setting>): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURES.map((f) => [f.key, f.setting ? Boolean(org[f.setting]) : !org.featuresOff.includes(f.key)])) as Record<FeatureKey, boolean>;
}

export const featureOn = (org: Pick<Org, "featuresOff" | Setting>, key: FeatureKey) => featureState(org)[key];

/** SQL: the feature is on for the studio in `orgIdCol` (stored features only). */
export const featureOnSql = (orgIdCol: SQL | unknown, key: FeatureKey) => sql`not exists (select 1 from organizations fo where fo.id = ${orgIdCol} and ${key} = any(fo.features_off))`;

export function assertFeature(org: Pick<Org, "featuresOff" | Setting>, key: FeatureKey) {
  if (!featureOn(org, key)) throw conflict("feature_off", `${FEATURE_LABELS[key]} is switched off for this studio. An owner or admin can switch it on under Setup, Features.`);
}

/**
 * Which routes belong to which feature. Matched against the route's pattern (not the raw URL).
 * Routes that finish what's already under way are left open: handing over shop orders and
 * rewards, clients seeing their own orders, and gift cards already sold.
 */
const ROUTES: { feature: FeatureKey; match: RegExp }[] = [
  { feature: "marketing", match: /^\/v1\/(segments|emails|campaigns|journeys)(\/|$)|^\/v1\/(marketing\/options|clients\/filter)$/ },
  { feature: "leads", match: /^\/v1\/leads(\/|$)/ },
  { feature: "shop", match: /^\/v1\/shop\/(products(\/.*)?|checkout)$/ },
  { feature: "payroll", match: /^\/v1\/(pay-rates|pay-adjustments|payroll)(\/|$)|^\/v1\/(staff\/:id\/pay|me\/pay)$/ },
  { feature: "inbox", match: /^\/v1\/(comms\/(conversations|email)|whatsapp\/templates)(\/|$)/ },
  { feature: "agents", match: /^\/v1\/(agents|me\/agent-messages|me\/agents)(\/|$)/ },
];

export function featureForRoute(url: string | undefined): FeatureKey | null {
  if (!url) return null;
  return ROUTES.find((r) => r.match.test(url))?.feature ?? null;
}

/** Refuses requests to switched-off features. Registered right after sign-in. */
export const featureGate = fp(async (app: FastifyInstance) => {
  app.addHook("preHandler", async (req: FastifyRequest) => {
    if (!req.auth?.orgId) return;
    const key = featureForRoute(req.routeOptions.url);
    if (!key) return;
    const [org] = await app.db.select({ featuresOff: organizations.featuresOff }).from(organizations).where(eq(organizations.id, req.auth.orgId));
    if (org && org.featuresOff.includes(key)) assertFeature({ ...org, giftCardsEnabled: true, loyaltyEnabled: true, referralsEnabled: true, reviewsEnabled: true }, key);
  });
});

const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
const count = sql<number>`count(*)::int`;
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** What switching a feature off would affect, in plain words (empty when nothing is running). */
async function whatHappens(db: DbOrTx, orgId: string, key: FeatureKey): Promise<string[]> {
  const out: string[] = [];
  if (key === "marketing") {
    const live = n(await db.select({ n: count }).from(journeys).where(and(eq(journeys.orgId, orgId), eq(journeys.status, "live"))));
    const sched = n(await db.select({ n: count }).from(emailCampaigns).where(and(eq(emailCampaigns.orgId, orgId), eq(emailCampaigns.status, "scheduled"))));
    if (live) out.push(`${plural(live, "live journey")} will be paused. When you switch Marketing back on, set ${live === 1 ? "it" : "them"} live again when you're ready.`);
    if (sched) out.push(`${plural(sched, "scheduled campaign")} will go back to ${sched === 1 ? "a draft" : "drafts"} and won't be sent.`);
  } else if (key === "leads") {
    const due = n(await db.select({ n: count }).from(leads).where(and(eq(leads.orgId, orgId), isNotNull(leads.nextFollowUpAt), isNull(leads.clientId))));
    if (due) out.push(`${plural(due, "follow-up email")} to leads won't be sent.`);
  } else if (key === "shop") {
    const waiting = n(await db.select({ n: count }).from(orders).where(and(eq(orders.orgId, orgId), eq(orders.kind, "product"), isNull(orders.collectedAt), inArray(orders.status, ["pending", "paid"]))));
    if (waiting) out.push(`${plural(waiting, "order")} waiting at the desk can still be handed over.`);
  } else if (key === "loyalty") {
    const waiting = n(await db.select({ n: count }).from(loyaltyRedemptions).where(and(eq(loyaltyRedemptions.orgId, orgId), eq(loyaltyRedemptions.status, "waiting"))));
    out.push("Clients stop earning points. Their points are kept for when you switch it back on.");
    if (waiting) out.push(`${plural(waiting, "reward")} waiting to be handed over can still be given.`);
  } else if (key === "giftCards") {
    const live = n(await db.select({ n: count }).from(giftCards).where(and(eq(giftCards.orgId, orgId), inArray(giftCards.status, ["unsent", "given", "kept"]))));
    if (live) out.push(`${plural(live, "gift card")} already sold can still be used. Clients just can't buy new ones.`);
  } else if (key === "agents") {
    const on = n(await db.select({ n: count }).from(agents).where(and(eq(agents.orgId, orgId), eq(agents.enabled, true))));
    if (on) out.push(`${plural(on, "agent")} will stop sending reminders and summaries.`);
  } else if (key === "inbox") {
    const unread = n(await db.select({ n: count }).from(conversations).where(and(eq(conversations.orgId, orgId), gt(conversations.unread, 0))));
    if (unread) out.push(`${plural(unread, "conversation")} with unread messages will be hidden. Reply from your phone in the meantime.`);
  } else if (key === "payroll") {
    const rates = n(await db.select({ n: count }).from(payRates).where(eq(payRates.orgId, orgId)));
    if (rates) out.push("Pay rates are kept, and instructors stop seeing My pay.");
  } else if (key === "referrals") {
    out.push("Referral links stop giving rewards. Rewards already earned are kept.");
  } else if (key === "reviews") {
    out.push("Clients stop being asked for reviews. Reviews already left are kept.");
  }
  return out;
}

/** After switching on: what still needs doing before clients see it, if anything. */
async function nextStep(db: DbOrTx, org: Org, key: FeatureKey): Promise<string | null> {
  if (key === "giftCards") {
    const designs = n(await db.select({ n: count }).from(giftCardDesigns).where(and(eq(giftCardDesigns.orgId, org.id), eq(giftCardDesigns.active, true))));
    const amounts = org.giftCardAmounts.length > 0 || org.giftCardCustomMinCents !== null;
    if (!designs || !amounts) return `Next, add ${[!amounts ? "at least one amount" : "", !designs ? "a design" : ""].filter(Boolean).join(" and ")} under Money, Shop, Gift cards. Clients see gift cards once that's done.`;
  }
  if (key === "loyalty") return "Next, check how many points each class earns and add rewards under Marketing, Loyalty.";
  if (key === "referrals") return "Next, choose the rewards for both sides under Marketing, Refer a friend.";
  if (key === "marketing") return "Journeys and campaigns you paused before stay paused. Set them going again under Marketing when you're ready.";
  if (key === "inbox") return "Connect your WhatsApp number under Communication if you haven't yet.";
  if (key === "payroll") return "Set each person's pay rate under Staff and pay.";
  if (key === "shop") return "Add your products under Money, Shop.";
  return null;
}

/** Stop what runs on its own when a feature goes off. */
async function stopRunning(tx: DbOrTx, orgId: string, key: FeatureKey) {
  if (key === "marketing") {
    await tx.update(journeys).set({ status: "paused" }).where(and(eq(journeys.orgId, orgId), eq(journeys.status, "live")));
    await tx.update(emailCampaigns).set({ status: "draft" }).where(and(eq(emailCampaigns.orgId, orgId), eq(emailCampaigns.status, "scheduled")));
  } else if (key === "leads") {
    await tx.update(leads).set({ nextFollowUpAt: null }).where(and(eq(leads.orgId, orgId), isNotNull(leads.nextFollowUpAt)));
  }
}

export async function featureRoutes(app: FastifyInstance) {
  const { db } = app;

  const list = (org: Org) => {
    const state = featureState(org);
    return FEATURES.map((f) => ({ key: f.key, group: f.group, label: f.label, help: f.help, on: state[f.key] }));
  };

  app.get("/features", async (req) => {
    requirePermission(req, "manageSettings");
    return { features: list(await getOrg(db, req.auth.orgId)) };
  });

  app.put("/features/:key", async (req) => {
    requirePermission(req, "manageSettings");
    const { key } = parse(schemas.featureKeyParam, req.params);
    const { on, acknowledge } = parse(schemas.setFeature, req.body ?? {});
    return withFlags(app, acknowledge, async (tx, flags) => {
      const org = await getOrg(tx, req.auth.orgId);
      if (featureOn(org, key) === on) return { features: list(org), changed: false };
      if (!on) {
        const lines = await whatHappens(tx, org.id, key);
        if (lines.length) flags.confirm({ code: "feature_off", details: { feature: key, lines }, message: `Switch off ${FEATURE_LABELS[key]}? It's hidden from the menus, and nothing is deleted. ${lines.join(" ")}` });
        await stopRunning(tx, org.id, key);
      }
      const setting = settingOf(key);
      if (setting) await tx.update(organizations).set({ [setting]: on }).where(eq(organizations.id, org.id));
      else {
        const off = new Set(org.featuresOff);
        if (on) off.delete(key);
        else off.add(key);
        await tx.update(organizations).set({ featuresOff: [...off].filter((k) => (STORED_FEATURES as readonly string[]).includes(k)) }).where(eq(organizations.id, org.id));
      }
      await audit(tx, { orgId: org.id, actorId: req.auth.userId, action: on ? "feature.on" : "feature.off", entityType: "organization", entityId: org.id, details: { feature: key } });
      return { features: list(await getOrg(tx, org.id)), changed: true, ...(on ? { next: await nextStep(tx, org, key) } : {}) };
    });
  });
}
