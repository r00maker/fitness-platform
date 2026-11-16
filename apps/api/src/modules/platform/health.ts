/**
 * Studio health for HQ: signals our team should act on, worked out from data the studio already
 * has. Each signal is "problem" (act today) or "watch" (keep an eye on it), in plain words.
 */
import { and, desc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { PLAN_INFO, planAdminSeats } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { agentRuns, auditLog, bookings, classSessions, clientPackages, journeyStepLog, notifications } from "../../db/schema.js";
import { adminCount, locationCount } from "../settings/plans.js";
import { checklist } from "../settings/setup.js";
import type { getOrg } from "../sessions/context.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
export interface Signal { level: "problem" | "watch"; text: string }

const count = sql<number>`count(*)::int`;
const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const DAY = 86_400_000;

export async function studioHealth(db: DbOrTx, org: Org, now = new Date()) {
  const week = new Date(now.getTime() - 7 * DAY);
  const signals: Signal[] = [];

  const failedMsgs = n(await db.select({ n: count }).from(notifications).where(and(eq(notifications.orgId, org.id), eq(notifications.status, "failed"), gt(notifications.createdAt, week))));
  if (failedMsgs) signals.push({ level: failedMsgs >= 5 ? "problem" : "watch", text: `${plural(failedMsgs, "message")} failed to send in the last 7 days` });

  const failedAgents = n(await db.select({ n: count }).from(agentRuns).where(and(eq(agentRuns.orgId, org.id), eq(agentRuns.status, "failed"), gt(agentRuns.createdAt, week))));
  if (failedAgents) signals.push({ level: "watch", text: `${plural(failedAgents, "agent run")} failed in the last 7 days` });

  const failedSteps = n(await db.select({ n: count }).from(journeyStepLog).where(and(eq(journeyStepLog.orgId, org.id), eq(journeyStepLog.outcome, "failed"), gt(journeyStepLog.createdAt, week))));
  if (failedSteps) signals.push({ level: "watch", text: `${plural(failedSteps, "journey step")} failed in the last 7 days` });

  const held = n(await db.select({ n: count }).from(clientPackages).where(and(eq(clientPackages.orgId, org.id), isNotNull(clientPackages.paymentHeldAt), isNull(clientPackages.cancelledAt))));
  if (held) signals.push({ level: held >= 3 ? "problem" : "watch", text: `${plural(held, "membership")} on hold because a card payment failed` });

  const recentBookings = n(await db.select({ n: count }).from(bookings).where(and(eq(bookings.orgId, org.id), gt(bookings.createdAt, week))));
  if (org.lifecycle === "live" && recentBookings === 0) signals.push({ level: "problem", text: "No bookings in the last 7 days" });

  const [last] = await db.select({ at: auditLog.createdAt }).from(auditLog).where(and(eq(auditLog.orgId, org.id), isNotNull(auditLog.actorId))).orderBy(desc(auditLog.createdAt)).limit(1);
  const lastActivityAt = last?.at ?? null;
  if (org.lifecycle === "live" && (!lastActivityAt || now.getTime() - lastActivityAt.getTime() > 14 * DAY)) signals.push({ level: "watch", text: "No one from the studio has changed anything in 14 days" });

  const steps = await checklist(db, org);
  const done = steps.filter((s) => s.done).length;
  if (org.lifecycle === "onboarding" && done < steps.length && now.getTime() - org.createdAt.getTime() > 14 * DAY) signals.push({ level: "watch", text: `Still setting up after 14 days (${done} of ${steps.length} done)` });

  const locs = await locationCount(db, org.id), admins = await adminCount(db, org.id), info = PLAN_INFO[org.plan], seats = planAdminSeats(org.plan, locs);
  if (info.maxLocations !== null && locs > info.maxLocations) signals.push({ level: "watch", text: `${plural(locs, "location")} on ${info.label}, which includes ${info.maxLocations}` });
  if (seats !== null && admins > seats) signals.push({ level: "watch", text: `${plural(admins, "admin account")} on ${info.label}, which includes ${seats}` });

  const upcoming = n(await db.select({ n: count }).from(classSessions).where(and(eq(classSessions.orgId, org.id), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, now), sql`${classSessions.startsAt} < ${new Date(now.getTime() + 7 * DAY)}`)));

  const status: "good" | "watch" | "problem" = signals.some((s) => s.level === "problem") ? "problem" : signals.length ? "watch" : "good";
  return { status, signals, lastActivityAt, bookingsLast7Days: recentBookings, classesNext7Days: upcoming, setup: { done, total: steps.length, steps } };
}
