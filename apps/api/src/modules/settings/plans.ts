/**
 * Plans: Essentials, Growth and Signature (PLAN_INFO in @studio/shared). Our staff set a studio's
 * plan after the "help me choose" questionnaire or a first call; studios see what's included and
 * ask us to change it. Every plan gets the same setup, data move and support.
 *
 * Changing the plan:
 *  - features the new plan doesn't include are switched off, the same way as from Setup,
 *    Features (journeys pause, and so on; nothing is deleted);
 *  - features the new plan adds are switched on; ones in both plans keep the studio's choice;
 *  - the first time, the rules for the plan's kind of studio are filled in;
 *  - locations and admins over the new plan's limits keep working, but no more can be added.
 *
 * Limits enforced elsewhere: switching on a feature (features.ts), loyalty and referral settings,
 * adding a location, adding admins, and AI recaps.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { FEATURES, FEATURE_LABELS, PLANS, PLAN_INFO, planAdminSeats, planHasAiWorkflows, planHasApp, planIncludes, planPrice, planWith, schemas, type FeatureKey, type Plan } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { classSessions, locations, memberships, organizations } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import type { Flags } from "../../lib/flags.js";
import { withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { getOrg } from "../sessions/context.js";
import { featureOffEffects, featureState, switchFeature } from "./features.js";
import { checklist, presetRuleChanges } from "./setup.js";

type Org = Awaited<ReturnType<typeof getOrg>>;

const count = sql<number>`count(*)::int`;
const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
const words = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
export const usd = (cents: number) => `USD ${cents % 100 ? (cents / 100).toFixed(2) : cents / 100}`;

export const locationCount = async (db: DbOrTx, orgId: string) => n(await db.select({ n: count }).from(locations).where(and(eq(locations.orgId, orgId), isNull(locations.archivedAt))));
export const adminCount = async (db: DbOrTx, orgId: string) => n(await db.select({ n: count }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.active, true), inArray(memberships.role, ["owner", "admin"]))));

/** "Growth and Signature" or "Signature": the plans that include a feature. */
const plansWith = (key: FeatureKey) => words(PLANS.filter((p) => planIncludes(p, key)).map((p) => PLAN_INFO[p].label));

/** Refuse switching on something the studio's plan doesn't include. */
export function assertPlanAllows(org: Pick<Org, "plan">, key: FeatureKey) {
  if (!planIncludes(org.plan, key)) throw conflict("not_in_plan", `${FEATURE_LABELS[key]} comes with ${plansWith(key)}. You're on ${PLAN_INFO[org.plan].label}: talk to us to change your plan, and we'll set it up for you.`);
}

/** Adding a location: refused over the plan's maximum; Signature asks first when it adds to the price. */
export async function checkLocationLimit(db: DbOrTx, org: Org, flags: Flags) {
  const info = PLAN_INFO[org.plan], used = await locationCount(db, org.id);
  if (info.maxLocations !== null && used >= info.maxLocations) {
    const next = PLANS.find((p) => (PLAN_INFO[p].maxLocations ?? Infinity) > used);
    throw conflict("plan_location_limit", `Your ${info.label} plan includes ${plural(info.maxLocations, "location")}. Talk to us about ${next ? PLAN_INFO[next].label : "a bigger plan"} to add more.`);
  }
  if (info.extraLocationCents && used >= info.locationsIncluded) {
    flags.confirm({ code: "extra_location_cost", details: { used, included: info.locationsIncluded }, message: `Your ${info.label} plan includes ${plural(info.locationsIncluded, "location")}. Each extra location adds ${usd(info.extraLocationCents)} a month, so this one takes your plan to ${usd(planPrice(org.plan, used + 1, org.brandedApp).totalCents)} a month.` });
  }
}

/** Adding an admin (inviting one, or making someone an admin): refused over the plan's seats. */
export async function checkAdminSeats(db: DbOrTx, org: Org) {
  const seats = planAdminSeats(org.plan, await locationCount(db, org.id));
  if (seats === null) return;
  if ((await adminCount(db, org.id)) >= seats) {
    const per = PLAN_INFO[org.plan].adminSeats === "per_location";
    throw conflict("plan_admin_limit", `Your ${PLAN_INFO[org.plan].label} plan includes ${plural(seats, "admin account")}${per ? " (one for each location)" : ""}, counting the owner. Add them as Front of House or an instructor instead (those are unlimited), or talk to us about Signature.`);
  }
}

/** What a studio sees about its plan. */
export async function planView(db: DbOrTx, org: Org) {
  const info = PLAN_INFO[org.plan];
  const used = await locationCount(db, org.id), admins = await adminCount(db, org.id);
  const price = planPrice(org.plan, used, org.brandedApp);
  const state = featureState(org);
  const parts = [{ label: `${info.label} (${plural(info.locationsIncluded, "location")} included)`, amount: usd(price.baseCents) }];
  if (price.extraLocations) parts.push({ label: `${plural(price.extraLocations, "extra location")} at ${usd(info.extraLocationCents!)} each`, amount: usd(price.extraCents) });
  if (price.appCents) parts.push({ label: "Your own app", amount: usd(price.appCents) });
  const seats = planAdminSeats(org.plan, used);
  return {
    plan: org.plan,
    label: info.label,
    tagline: info.tagline,
    price: { total: usd(price.totalCents), perMonth: `${usd(price.totalCents)} a month`, parts },
    locations: { used, included: info.locationsIncluded, max: info.maxLocations, extraEach: info.extraLocationCents ? usd(info.extraLocationCents) : null, overLimit: info.maxLocations !== null && used > info.maxLocations },
    admins: { used, seats, overLimit: seats !== null && admins > seats },
    app: { status: info.app, on: planHasApp(org.plan, org.brandedApp), addOn: info.appAddOnCents ? usd(info.appAddOnCents) : null },
    aiWorkflows: planHasAiWorkflows(org.plan),
    features: FEATURES.map((f) => ({ key: f.key, label: f.label, inPlan: planIncludes(org.plan, f.key), on: state[f.key], includedIn: planIncludes(org.plan, f.key) ? null : PLAN_INFO[planWith(f.key)].label })),
    plans: PLANS.map((p) => ({ plan: p, label: PLAN_INFO[p].label, tagline: PLAN_INFO[p].tagline, price: usd(PLAN_INFO[p].priceCents), current: p === org.plan })),
    sameForEveryPlan: "Every plan: we set you up and move your data for you, the same support, and no cut of your sales.",
    change: "To change your plan, talk to us. We'll set it up for you.",
  };
}

/** What changing to a plan would do, compared with the studio now. */
async function planChanges(db: DbOrTx, org: Org, plan: Plan) {
  const first = !org.setupDoneAt;
  const before = PLAN_INFO[org.plan].features, after = PLAN_INFO[plan].features;
  const state = featureState(org);
  const features = FEATURES.map((f) => {
    const on = !after.includes(f.key) ? false : first || !before.includes(f.key) ? true : state[f.key];
    return { key: f.key as FeatureKey, label: f.label, on };
  }).filter((f) => state[f.key] !== f.on);
  const rules = first ? presetRuleChanges(org, PLAN_INFO[plan].studioType) : [];
  const used = await locationCount(db, org.id), admins = await adminCount(db, org.id);
  const info = PLAN_INFO[plan], seats = planAdminSeats(plan, used);
  const limits: string[] = [];
  if (info.maxLocations !== null && used > info.maxLocations) limits.push(`It has ${plural(used, "location")} and ${info.label} includes ${info.maxLocations}: they keep working, but no more can be added.`);
  if (seats !== null && admins > seats) limits.push(`It has ${plural(admins, "admin account")} and ${info.label} includes ${seats}: they keep their access, but no more can be added.`);
  return { features, rules, limits };
}

/** Set a studio's plan. Asks first (plan_changes) when something switches off, limits are exceeded, or rules change for a running studio. */
export async function setPlan(tx: DbOrTx, flags: Flags, orgId: string, input: { plan: Plan; brandedApp?: boolean }, actorId: string | null) {
  const org = await getOrg(tx, orgId);
  const { features, rules, limits } = await planChanges(tx, org, input.plan);
  const effects: string[] = [];
  for (const f of features.filter((x) => !x.on)) effects.push(...(await featureOffEffects(tx, org.id, f.key)));
  const running = n(await tx.select({ n: count }).from(classSessions).where(eq(classSessions.orgId, org.id))) > 0;
  const on = features.filter((f) => f.on).map((f) => f.label), off = features.filter((f) => !f.on).map((f) => f.label);
  if (off.length || limits.length || (rules.length && running)) {
    const parts = [
      on.length ? `Switches on ${words(on)}.` : "",
      off.length ? `Switches off ${words(off)} (nothing is deleted).` : "",
      rules.length ? `Fills in the usual rules for ${PLAN_INFO[input.plan].label}: ${rules.map((r) => `${r.label.toLowerCase()} from ${r.fromText.toLowerCase()} to ${r.toText.toLowerCase()}`).join("; ")}.` : "",
      ...effects,
      ...limits,
    ].filter(Boolean);
    flags.confirm({ code: "plan_changes", details: { plan: input.plan, features, rules, effects, limits }, message: `Move ${org.name} from ${PLAN_INFO[org.plan].label} to ${PLAN_INFO[input.plan].label}? ${parts.join(" ")}` });
  }
  for (const f of features) await switchFeature(tx, org.id, f.key, f.on, actorId);
  const brandedApp = PLAN_INFO[input.plan].app === "add_on" ? (input.brandedApp ?? org.brandedApp) : false;
  await tx.update(organizations).set({ ...Object.fromEntries(rules.map((r) => [r.key, r.to])), plan: input.plan, brandedApp, studioType: PLAN_INFO[input.plan].studioType, setupDoneAt: org.setupDoneAt ?? new Date() }).where(eq(organizations.id, org.id));
  await audit(tx, { orgId: org.id, actorId, action: "plan.changed", entityType: "organization", entityId: org.id, details: { from: org.plan, to: input.plan, brandedApp, features: features.map((f) => `${f.key}:${f.on ? "on" : "off"}`), rules: rules.map((r) => r.key) } });
  const after = await getOrg(tx, org.id);
  return { plan: await planView(tx, after), checklist: await checklist(tx, after) };
}

/** Our staff's key, compared in constant time. The route is off when no key is set. */
function platformKeyOk(req: FastifyRequest, key: string | undefined) {
  const given = req.headers["x-platform-key"];
  if (!key || typeof given !== "string") return false;
  const a = Buffer.from(given), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function planRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/plan", async (req) => {
    requirePermission(req, "manageSettings");
    return planView(db, await getOrg(db, req.auth.orgId));
  });

  /** Our staff only: change a studio's plan. Studios can't reach this (separate key, not a sign-in). */
  app.post("/platform/studios/:orgId/plan", { config: { public: true, rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    if (!platformKeyOk(req, app.config.PLATFORM_ADMIN_KEY)) throw notFound("page");
    const { orgId } = parse(schemas.orgIdParam, req.params);
    const input = parse(schemas.setPlan, req.body ?? {});
    const [exists] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId));
    if (!exists) throw notFound("studio");
    return withFlags(app, input.acknowledge, (tx, flags) => setPlan(tx, flags, orgId, input, null));
  });
}
