/**
 * The free trial's rules (see trial.ts in shared): what a trial can't do, the client cap, the
 * read-only state once it ends, and what the studio and our team see.
 */
import type { FastifyRequest } from "fastify";
import { and, count, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { PLAN_INFO, TRIAL_CLIENT_LIMIT, TRIAL_KIND_LABELS } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { memberships, organizations } from "../../db/schema.js";
import { conflict } from "../../lib/errors.js";

type Org = typeof organizations.$inferSelect;
export type TrialState = "none" | "active" | "ended";

export function trialState(org: Pick<Org, "trialKind" | "trialEndsAt" | "trialConvertedAt">, now = new Date()): TrialState {
  if (!org.trialKind || org.trialConvertedAt) return "none";
  return org.trialEndsAt && now >= org.trialEndsAt ? "ended" : "active";
}
export const inTrial = (org: Pick<Org, "trialKind" | "trialEndsAt" | "trialConvertedAt">, now = new Date()) => trialState(org, now) !== "none";
/** The test studio for studios already on another system (sample data, nothing goes out). */
export const isSandbox = (org: Pick<Org, "trialKind" | "trialConvertedAt">) => org.trialKind === "existing" && !org.trialConvertedAt;

const BLOCKED = {
  payments: "Payments switch on when you start your plan. Until then, the trial can't take money.",
  whatsapp: "WhatsApp connects when you start your plan.",
  migration: "We move your data when you start your plan, not during the trial.",
} as const;
/** Refuse what a trial can't do, saying when it becomes possible. */
export function assertNotTrial(org: Org, what: keyof typeof BLOCKED, now = new Date()) {
  if (inTrial(org, now)) throw conflict("trial_limit", BLOCKED[what]);
}

async function clientCount(db: DbOrTx, orgId: string) {
  const [r] = await db.select({ n: count() }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client")));
  return Number(r?.n ?? 0);
}
/** Trials can have up to TRIAL_CLIENT_LIMIT clients. */
export async function assertClientRoom(db: DbOrTx, org: Org, now = new Date()) {
  if (!inTrial(org, now)) return;
  if ((await clientCount(db, org.id)) >= TRIAL_CLIENT_LIMIT) {
    throw conflict("trial_client_limit", `${org.name} is on a free trial, which allows up to ${TRIAL_CLIENT_LIMIT} clients. Ask the studio about joining once it starts its plan.`);
  }
}

/** What the studio (and our team) see about a trial. */
export async function trialView(db: DbOrTx, org: Org, now = new Date()) {
  const state = trialState(org, now);
  if (!org.trialKind) return { onTrial: false as const };
  const daysLeft = org.trialEndsAt ? Math.max(0, Math.ceil(DateTime.fromJSDate(org.trialEndsAt).diff(DateTime.fromJSDate(now), "days").days)) : 0;
  return {
    onTrial: state !== "none",
    state,
    kind: org.trialKind,
    kindLabel: TRIAL_KIND_LABELS[org.trialKind].label,
    plan: org.plan,
    planLabel: PLAN_INFO[org.plan].label,
    startedAt: org.trialStartedAt,
    endsAt: org.trialEndsAt,
    daysLeft,
    convertedAt: org.trialConvertedAt,
    clients: { used: await clientCount(db, org.id), max: TRIAL_CLIENT_LIMIT },
    notIncluded: state === "none" ? [] : org.trialKind === "existing"
      ? ["Taking payments", "WhatsApp", "Moving your data", "Your booking page", "Messages to clients (it's sample data)"]
      : ["Taking payments", "WhatsApp", `More than ${TRIAL_CLIENT_LIMIT} clients`],
    message:
      state === "ended" ? "Your free trial has ended. Everything is kept for 30 days: start your plan to carry on."
      : state === "active" ? `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in your free trial of ${PLAN_INFO[org.plan].label}.`
      : null,
    planRequest: org.trialPlanRequest ?? null,
  };
}

/** Routes an ended trial can still use: its own trial screen (to start a plan) and HQ. */
const ALWAYS = [/^\/v1\/trial\b/, /^\/v1\/platform\//, /^\/v1\/dev\//, /^\/v1\/me\/push-tokens/];
/**
 * Once a trial ends, the studio is read-only: anything that changes something is refused, for
 * staff and clients alike, until it starts its plan (or our team extends the trial).
 */
export async function trialGuard(db: DbOrTx, req: FastifyRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.auth?.orgId) return;
  if (ALWAYS.some((r) => r.test(req.url))) return;
  const [org] = await db.select({ trialKind: organizations.trialKind, trialEndsAt: organizations.trialEndsAt, trialConvertedAt: organizations.trialConvertedAt }).from(organizations).where(eq(organizations.id, req.auth.orgId));
  if (org && trialState(org) === "ended") {
    throw conflict("trial_ended", req.auth.role === "client" ? "This studio's app is paused for now. Please contact the studio." : "Your free trial has ended. Everything you set up is kept for 30 days: start your plan to carry on.");
  }
}
