/**
 * Setup by studio type. Each plan starts a studio with the rules that suit its kind (independent,
 * boutique, several locations): our staff set the plan, and the first time that happens the
 * matching rules are filled in (see plans.ts). It's only a starting point; everything can be
 * changed afterwards, and Studio rules marks settings that differ from the usual for the kind.
 *
 * GET /setup gives studios the usual values, what they've changed, and a getting-started list.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { PRESET_RULES, STUDIO_TYPE_PRESETS, presetRuleText, type PresetRuleKey, type StudioType } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { classSessions, classTypes, locations, memberships, packagePlans } from "../../db/schema.js";
import { requirePermission } from "../../plugins/auth.js";
import { getOrg } from "../sessions/context.js";

type Org = Awaited<ReturnType<typeof getOrg>>;

const count = sql<number>`count(*)::int`;
const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;

/** The rules a kind of studio would change, compared with the studio as it is now. */
export function presetRuleChanges(org: Org, type: StudioType) {
  const preset = STUDIO_TYPE_PRESETS[type];
  return PRESET_RULES.map((r) => ({ key: r.key as PresetRuleKey, label: r.label, from: org[r.key], to: preset.rules[r.key] }))
    .filter((r) => r.from !== r.to)
    .map((r) => ({ ...r, fromText: presetRuleText(r.key, r.from), toText: presetRuleText(r.key, r.to) }));
}

/** Settings that differ from the usual for the studio's kind (for "Changed" marks in Studio rules). */
export function changedFromUsual(org: Org): PresetRuleKey[] {
  if (!org.studioType) return [];
  const usual = STUDIO_TYPE_PRESETS[org.studioType].rules;
  return PRESET_RULES.map((r) => r.key).filter((k) => org[k] !== usual[k]);
}

/** A short checklist for getting started; each item is done once the studio has it. */
export async function checklist(db: DbOrTx, org: Org) {
  const types = n(await db.select({ n: count }).from(classTypes).where(and(eq(classTypes.orgId, org.id), isNull(classTypes.archivedAt))));
  const locs = n(await db.select({ n: count }).from(locations).where(and(eq(locations.orgId, org.id), isNull(locations.archivedAt))));
  const plans = n(await db.select({ n: count }).from(packagePlans).where(eq(packagePlans.orgId, org.id)));
  const team = n(await db.select({ n: count }).from(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.active, true), ne(memberships.role, "client"))));
  const classes = n(await db.select({ n: count }).from(classSessions).where(eq(classSessions.orgId, org.id)));
  return [
    { key: "plan", label: "Your plan is set up", done: !!org.setupDoneAt },
    { key: "locations", label: "Add your location and rooms", done: locs > 0 },
    { key: "classTypes", label: "Add the classes you teach", done: types > 0 },
    { key: "packages", label: "Add the packages and memberships you sell", done: plans > 0 },
    { key: "team", label: "Invite your instructors and front desk", done: team > 1 },
    { key: "schedule", label: "Put your first classes on the schedule", done: classes > 0 },
  ];
}

export async function setupRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/setup", async (req) => {
    requirePermission(req, "manageSettings");
    const org = await getOrg(db, req.auth.orgId);
    return {
      done: !!org.setupDoneAt,
      studioType: org.studioType,
      studioTypeLabel: org.studioType ? STUDIO_TYPE_PRESETS[org.studioType].label : null,
      usual: org.studioType ? STUDIO_TYPE_PRESETS[org.studioType].rules : null,
      changedFromUsual: changedFromUsual(org),
      checklist: await checklist(db, org),
    };
  });
}
