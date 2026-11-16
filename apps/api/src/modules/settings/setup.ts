/**
 * Setup by studio type. A first-run question ("What kind of studio are you?") switches on the
 * features that kind of studio usually needs and fills sensible rules, so a new owner starts with
 * a short menu and good defaults instead of 32 settings. It's only a starting point: everything
 * can be changed afterwards, and Studio rules marks settings that differ from the usual.
 *
 * Choosing a type for a studio that already has classes (or choosing again later) asks first and
 * lists exactly what will change. Features switched off this way stop running the same way as
 * from Setup, Features (journeys pause, and so on); nothing is deleted.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { FEATURES, FEATURE_LABELS, PRESET_RULES, STUDIO_TYPES, STUDIO_TYPE_PRESETS, presetRuleText, schemas, type FeatureKey, type PresetRuleKey, type StudioType } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { classSessions, classTypes, locations, memberships, organizations, packagePlans } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { getOrg } from "../sessions/context.js";
import { featureOffEffects, featureState, switchFeature } from "./features.js";

type Org = Awaited<ReturnType<typeof getOrg>>;

const count = sql<number>`count(*)::int`;
const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
const words = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** What choosing a type would change, compared with the studio as it is now. */
function changesFor(org: Org, type: StudioType) {
  const preset = STUDIO_TYPE_PRESETS[type];
  const state = featureState(org);
  const features = FEATURES.map((f) => ({ key: f.key as FeatureKey, label: f.label, on: preset.features.includes(f.key) })).filter((f) => state[f.key] !== f.on);
  const rules = PRESET_RULES.map((r) => ({ key: r.key as PresetRuleKey, label: r.label, from: org[r.key], to: preset.rules[r.key] }))
    .filter((r) => r.from !== r.to)
    .map((r) => ({ ...r, fromText: presetRuleText(r.key, r.from), toText: presetRuleText(r.key, r.to) }));
  return { features, rules };
}

/** Settings that differ from the usual for the studio's type (for "Changed" marks in Studio rules). */
export function changedFromUsual(org: Org): PresetRuleKey[] {
  if (!org.studioType) return [];
  const usual = STUDIO_TYPE_PRESETS[org.studioType].rules;
  return PRESET_RULES.map((r) => r.key).filter((k) => org[k] !== usual[k]);
}

/** A short checklist for getting started; each item is done once the studio has it. */
async function checklist(db: DbOrTx, org: Org) {
  const types = n(await db.select({ n: count }).from(classTypes).where(and(eq(classTypes.orgId, org.id), isNull(classTypes.archivedAt))));
  const locs = n(await db.select({ n: count }).from(locations).where(and(eq(locations.orgId, org.id), isNull(locations.archivedAt))));
  const plans = n(await db.select({ n: count }).from(packagePlans).where(eq(packagePlans.orgId, org.id)));
  const team = n(await db.select({ n: count }).from(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.active, true), ne(memberships.role, "client"))));
  const classes = n(await db.select({ n: count }).from(classSessions).where(eq(classSessions.orgId, org.id)));
  return [
    { key: "type", label: "Choose your kind of studio", done: !!org.setupDoneAt },
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
      types: STUDIO_TYPES.map((t) => {
        const p = STUDIO_TYPE_PRESETS[t];
        return {
          key: t,
          label: p.label,
          description: p.description,
          features: { on: FEATURES.filter((f) => p.features.includes(f.key)).map((f) => f.label), off: FEATURES.filter((f) => !p.features.includes(f.key)).map((f) => f.label) },
          rules: PRESET_RULES.map((r) => ({ key: r.key, label: r.label, value: p.rules[r.key], text: presetRuleText(r.key, p.rules[r.key]) })),
          changes: changesFor(org, t),
        };
      }),
      usual: org.studioType ? STUDIO_TYPE_PRESETS[org.studioType].rules : null,
      changedFromUsual: changedFromUsual(org),
      checklist: await checklist(db, org),
    };
  });

  app.post("/setup", async (req) => {
    requirePermission(req, "manageSettings");
    const { studioType, acknowledge } = parse(schemas.runSetup, req.body ?? {});
    return withFlags(app, acknowledge, async (tx, flags) => {
      const org = await getOrg(tx, req.auth.orgId);
      const preset = STUDIO_TYPE_PRESETS[studioType];
      const { features, rules } = changesFor(org, studioType);

      // A brand-new studio (no classes yet, nothing running) just gets the settings. Otherwise
      // say exactly what will change, including what stops when a feature goes off.
      const effects: string[] = [];
      for (const f of features.filter((x) => !x.on)) effects.push(...(await featureOffEffects(tx, org.id, f.key)));
      const hasClasses = n(await tx.select({ n: count }).from(classSessions).where(eq(classSessions.orgId, org.id))) > 0;
      if ((features.length || rules.length) && (hasClasses || org.setupDoneAt || effects.length)) {
        const on = features.filter((f) => f.on).map((f) => f.label), off = features.filter((f) => !f.on).map((f) => f.label);
        const parts = [
          on.length ? `Switches on ${words(on)}.` : "",
          off.length ? `Switches off ${words(off)} (nothing is deleted).` : "",
          rules.length ? `Changes ${rules.map((r) => `${r.label.toLowerCase()} from ${r.fromText.toLowerCase()} to ${r.toText.toLowerCase()}`).join("; ")}.` : "",
          ...effects,
        ].filter(Boolean);
        flags.confirm({ code: "setup_changes", details: { studioType, features, rules, effects }, message: `Set up as ${aOrAn(preset.label.toLowerCase())}? ${parts.join(" ")}` });
      }

      for (const f of features) await switchFeature(tx, org.id, f.key, f.on, req.auth.userId);
      await tx.update(organizations).set({ ...Object.fromEntries(rules.map((r) => [r.key, r.to])), studioType, setupDoneAt: org.setupDoneAt ?? new Date() }).where(eq(organizations.id, org.id));
      await audit(tx, { orgId: org.id, actorId: req.auth.userId, action: "setup.studio_type", entityType: "organization", entityId: org.id, details: { studioType, features: features.map((f) => `${f.key}:${f.on ? "on" : "off"}`), rules: rules.map((r) => r.key) } });

      const after = await getOrg(tx, org.id);
      return {
        studioType,
        summary: `Set up as ${aOrAn(preset.label.toLowerCase())}. ${features.length ? `${features.length} ${features.length === 1 ? "feature" : "features"} changed` : "Features unchanged"}, ${rules.length ? `${rules.length} ${rules.length === 1 ? "rule" : "rules"} filled in` : "rules unchanged"}. You can change anything under Setup.`,
        features: FEATURES.map((f) => ({ key: f.key, label: FEATURE_LABELS[f.key], on: featureState(after)[f.key] })),
        checklist: await checklist(tx, after),
      };
    });
  });
}
