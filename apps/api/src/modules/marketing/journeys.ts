/**
 * Journeys: automations that move each client through steps.
 *
 *   Trigger (e.g. "Creates an account")
 *     → Wait 1 day
 *     → Wait for "Buys a package" (Intro offer), up to 3 days
 *          Yes → Send email A
 *          No  → Send email B → …
 *
 * How it runs:
 *  - Things that happen in the studio (an account created, a class attended, a package bought)
 *    call `journeyEvent`, which starts matching journeys and answers any "wait for" steps.
 *  - Time-based triggers (package about to expire, hasn't come for a while, joins a segment) are
 *    checked hourly by the worker (`scanJourneyTriggers`).
 *  - The worker runs due steps every minute (`runDueJourneys`). Each enrollment keeps a copy of
 *    the steps it started with, so editing a journey never strands people part-way through.
 *  - Emails and pushes due overnight wait until 8am studio time (if the journey has quiet hours on).
 */
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { JOURNEY_TRIGGERS, durationMs, type JourneyDefinition, type JourneyGoal, type JourneyStep, type JourneyTriggerDef } from "@studio/shared";
import type { Db, DbOrTx } from "../../db/client.js";
import {
  bookings,
  classSessions,
  clientPackages,
  clientTagAssignments,
  clientTags,
  emailDesigns,
  journeyEnrollments,
  journeySegmentMembers,
  journeyStepLog,
  journeys,
  memberships,
  packagePlans,
  segments,
  users,
} from "../../db/schema.js";
import { badRequest } from "../../lib/errors.js";
import { notify } from "../notifications/outbox.js";
import { getOrg } from "../sessions/context.js";
import { packageState } from "../packages/service.js";
import { giveReward } from "./credit.js";
import { queueDesignEmail, queuePush, type Urls } from "./messages.js";
import { clientMatches, matchSegment } from "./segments.js";
import { queueWhatsapp, whatsappConnected, whatsappFor } from "./whatsapp.js";

type Path = (number | string)[];
type Journey = typeof journeys.$inferSelect;
type Enrollment = typeof journeyEnrollments.$inferSelect;
export type ClientEvent =
  | { type: "account_created" }
  | { type: "class_booked"; first: boolean; ref: string }
  | { type: "class_attended"; attendedCount: number; ref: string }
  | { type: "package_bought"; planId: string | null; ref: string }
  | { type: "package_used_up"; ref: string }
  | { type: "membership_stopped"; ref: string }
  | { type: "referral_qualified"; ref: string }
  | { type: "gift_card_received"; ref: string };

// ---------------------------------------------------------------------------
// Walking the steps
// ---------------------------------------------------------------------------
/** The step at a path, e.g. [2, "yes", 0] = the first step on the Yes side of step 3. */
export function stepAt(steps: JourneyStep[], path: Path): JourneyStep | null {
  let list: JourneyStep[] = steps;
  let step: JourneyStep | null = null;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (typeof p === "number") {
      step = list[p] ?? null;
      if (!step) return null;
    } else {
      if (!step || (step.type !== "check" && step.type !== "wait_for")) return null;
      list = p === "yes" ? step.yes : step.no;
    }
  }
  return step;
}

/** The step after this one: the next in the same list, or (at the end of a Yes/No side) the step after the split. */
export function nextPath(steps: JourneyStep[], path: Path): Path | null {
  let p = [...path];
  while (p.length) {
    const sibling = [...p.slice(0, -1), (p[p.length - 1] as number) + 1];
    if (stepAt(steps, sibling)) return sibling;
    if (p.length === 1) return null;
    p = p.slice(0, -2); // out of the Yes/No side, back to the split step
  }
  return null;
}

/** Into a Yes/No side (its first step), or past the split if that side is empty. */
function branch(steps: JourneyStep[], path: Path, side: "yes" | "no"): Path | null {
  const into = [...path, side, 0];
  return stepAt(steps, into) ? into : nextPath(steps, path);
}

function* allSteps(steps: JourneyStep[]): Generator<JourneyStep> {
  for (const s of steps) {
    yield s;
    if (s.type === "check" || s.type === "wait_for") { yield* allSteps(s.yes); yield* allSteps(s.no); }
  }
}

/** Every step's id must be unique; everything a step points at must exist in this studio. */
export async function checkJourney(db: DbOrTx, orgId: string, def: JourneyDefinition) {
  const t = def.trigger;
  if (t.type === "attendance_milestone" && !t.count) throw badRequest("needs_count", "Choose which class number starts the journey, e.g. 50.");
  if ((t.type === "package_expiring" || t.type === "inactive") && !t.days) throw badRequest("needs_days", "Choose how many days.");
  if (t.type === "joins_segment" && !t.segmentId) throw badRequest("needs_segment", "Choose the segment.");
  const ids = new Set<string>();
  const emails = new Set<string>(), tags = new Set<string>(), plans = new Set<string>(t.planIds ?? []);
  for (const s of allSteps(def.steps)) {
    if (ids.has(s.id)) throw badRequest("duplicate_step", "Two steps have the same id.");
    ids.add(s.id);
    if (s.type === "send_email") emails.add(s.emailId);
    if (s.type === "add_tag" || s.type === "remove_tag") tags.add(s.tagId);
    if (s.type === "wait_for") s.planIds?.forEach((p) => plans.add(p));
    if (s.type === "send_whatsapp") {
      const wa = await whatsappFor(db, orgId);
      if (!whatsappConnected(wa)) throw badRequest("whatsapp_not_connected", "Connect WhatsApp (Marketing → WhatsApp) before adding WhatsApp steps.");
      const tpl = wa.templates.find((x) => x.name === s.template && x.language === s.language);
      if (!tpl) throw badRequest("missing", `The WhatsApp template “${s.template}” isn't in your list. Add or sync it first.`);
      if (s.variables.length !== tpl.variables) throw badRequest("whatsapp_blanks", `“${s.template}” has ${tpl.variables} ${tpl.variables === 1 ? "blank" : "blanks"} to fill in; this step fills ${s.variables.length}.`);
    }
  }
  def.goal?.planIds?.forEach((p) => plans.add(p));
  const exists = async (table: typeof emailDesigns | typeof clientTags | typeof packagePlans, set: Set<string>, what: string) => {
    if (!set.size) return;
    const found = await db.select({ id: table.id }).from(table).where(and(eq(table.orgId, orgId), inArray(table.id, [...set])));
    if (found.length !== set.size) throw badRequest("missing", `One of the ${what} in this journey no longer exists.`);
  };
  await exists(emailDesigns, emails, "emails");
  await exists(clientTags, tags, "tags");
  await exists(packagePlans, plans, "package types");
  if (t.segmentId) {
    const [sg] = await db.select({ id: segments.id }).from(segments).where(and(eq(segments.orgId, orgId), eq(segments.id, t.segmentId)));
    if (!sg) throw badRequest("missing", "That segment no longer exists.");
  }
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------
/** Start a client on a journey, unless its re-entry rule says they've already been through. */
async function enroll(tx: DbOrTx, j: Journey, clientId: string, triggerRef: string | null, now: Date) {
  const [active] = await tx.select({ id: journeyEnrollments.id }).from(journeyEnrollments).where(and(eq(journeyEnrollments.journeyId, j.id), eq(journeyEnrollments.clientId, clientId), eq(journeyEnrollments.status, "active")));
  if (active) return null;
  if (j.reentry === "once") {
    const [any] = await tx.select({ id: journeyEnrollments.id }).from(journeyEnrollments).where(and(eq(journeyEnrollments.journeyId, j.id), eq(journeyEnrollments.clientId, clientId))).limit(1);
    if (any) return null;
  } else if (triggerRef) {
    const [same] = await tx.select({ id: journeyEnrollments.id }).from(journeyEnrollments).where(and(eq(journeyEnrollments.journeyId, j.id), eq(journeyEnrollments.clientId, clientId), eq(journeyEnrollments.triggerRef, triggerRef))).limit(1);
    if (same) return null;
  }
  const [e] = await tx
    .insert(journeyEnrollments)
    .values({ orgId: j.orgId, journeyId: j.id, clientId, version: j.version, definition: j.definition, path: [0], nextRunAt: now, triggerRef, startedAt: now })
    .returning();
  await tx.insert(journeyStepLog).values({ orgId: j.orgId, journeyId: j.id, enrollmentId: e!.id, clientId, stepId: "start", outcome: "done", createdAt: now });
  return e!;
}

function triggerMatches(t: JourneyTriggerDef, ev: ClientEvent): boolean {
  switch (t.type) {
    case "account_created": return ev.type === "account_created";
    case "first_class_booked": return ev.type === "class_booked" && ev.first;
    case "class_attended": return ev.type === "class_attended";
    case "attendance_milestone": return ev.type === "class_attended" && ev.attendedCount === t.count;
    case "package_bought": return ev.type === "package_bought" && (!t.planIds?.length || (!!ev.planId && t.planIds.includes(ev.planId)));
    case "package_used_up": return ev.type === "package_used_up";
    case "membership_stopped": return ev.type === "membership_stopped";
    case "referral_qualified": return ev.type === "referral_qualified";
    case "gift_card_received": return ev.type === "gift_card_received";
    default: return false;
  }
}

/** Does this event reach a journey's goal? */
function goalMet(goal: JourneyGoal | null | undefined, ev: ClientEvent): boolean {
  if (!goal) return false;
  if (goal.event === "package_bought") return ev.type === "package_bought" && (!goal.planIds?.length || (!!ev.planId && goal.planIds.includes(ev.planId)));
  return ev.type === goal.event;
}

/** Something happened to a client: end journeys whose goal they've reached, start matching journeys, and answer "wait for" steps. */
export async function journeyEvent(tx: DbOrTx, orgId: string, clientId: string, ev: ClientEvent, now = new Date()) {
  // Goals first, so the event that starts a journey can't also count as reaching its goal.
  const mine = await tx.select().from(journeyEnrollments).where(and(eq(journeyEnrollments.orgId, orgId), eq(journeyEnrollments.clientId, clientId), eq(journeyEnrollments.status, "active"))).for("update");
  for (const e of mine) {
    if (!goalMet(e.definition.goal, ev)) continue;
    await tx.insert(journeyStepLog).values({ orgId, journeyId: e.journeyId, enrollmentId: e.id, clientId, stepId: "goal", outcome: "done", createdAt: now });
    // Waiting for this very thing? Count the conversion and let the Yes side run (e.g. a thank-you).
    if (e.waitingFor?.event === ev.type) {
      await tx.update(journeyEnrollments).set({ convertedAt: now }).where(eq(journeyEnrollments.id, e.id));
      continue;
    }
    await tx.update(journeyEnrollments).set({ status: "completed", convertedAt: now, waitingFor: null, nextRunAt: null, finishedAt: now, exitReason: "Reached the goal" }).where(eq(journeyEnrollments.id, e.id));
  }
  const live = await tx.select().from(journeys).where(and(eq(journeys.orgId, orgId), eq(journeys.status, "live")));
  for (const j of live) if (triggerMatches(j.definition.trigger, ev)) await enroll(tx, j, clientId, "ref" in ev ? `${ev.type}:${ev.ref}` : ev.type, now);

  const waitEvent = ev.type === "class_booked" ? "class_booked" : ev.type === "class_attended" ? "class_attended" : ev.type === "package_bought" ? "package_bought" : null;
  if (!waitEvent) return;
  const waiting = await tx
    .select()
    .from(journeyEnrollments)
    .where(and(eq(journeyEnrollments.orgId, orgId), eq(journeyEnrollments.clientId, clientId), eq(journeyEnrollments.status, "active"), sql`${journeyEnrollments.waitingFor}->>'event' = ${waitEvent}`))
    .for("update");
  for (const e of waiting) {
    const w = e.waitingFor!;
    if (new Date(w.until) < now) continue;
    if (ev.type === "package_bought" && w.planIds?.length && (!ev.planId || !w.planIds.includes(ev.planId))) continue;
    const step = stepAt(e.definition.steps, e.path);
    await tx.insert(journeyStepLog).values({ orgId, journeyId: e.journeyId, enrollmentId: e.id, clientId, stepId: step?.id ?? "?", outcome: "yes", createdAt: now });
    const next = branch(e.definition.steps, e.path, "yes");
    await tx.update(journeyEnrollments).set(next ? { path: next, waitingFor: null, nextRunAt: now } : { status: "completed", waitingFor: null, nextRunAt: null, finishedAt: now }).where(eq(journeyEnrollments.id, e.id));
  }
}

// ---------------------------------------------------------------------------
// Running steps
// ---------------------------------------------------------------------------
/** 8am the next morning (studio time) if it's between 9pm and 8am. */
function quietUntil(now: Date, zone: string): Date | null {
  const local = DateTime.fromJSDate(now, { zone });
  if (local.hour >= 8 && local.hour < 21) return null;
  const morning = (local.hour >= 21 ? local.plus({ days: 1 }) : local).set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
  return morning.toJSDate();
}

/** Run an enrollment's steps until it has to wait (or finishes). */
async function advance(tx: DbOrTx, j: Journey, e: Enrollment, urls: Urls, now: Date) {
  const org = await getOrg(tx, j.orgId);
  const steps = e.definition.steps;
  let path: Path | null = e.path;
  const log = (stepId: string, outcome: string, note?: string) => tx.insert(journeyStepLog).values({ orgId: j.orgId, journeyId: j.id, enrollmentId: e.id, clientId: e.clientId, stepId, outcome, note: note ?? null, createdAt: now });
  const save = (set: Partial<Enrollment>) => tx.update(journeyEnrollments).set(set).where(eq(journeyEnrollments.id, e.id));

  // A "wait for" that ran out of time goes down its No side.
  if (e.waitingFor && path) {
    const step = stepAt(steps, path);
    await log(step?.id ?? "?", "no", "Time ran out");
    path = branch(steps, path, "no");
  }

  for (let guard = 0; path && guard < 60; guard++) {
    const step = stepAt(steps, path);
    if (!step) { path = null; break; }
    if ((step.type === "send_email" || step.type === "send_push" || step.type === "send_whatsapp") && j.quietHours) {
      const until = quietUntil(now, org.timezone);
      if (until) return save({ path, nextRunAt: until, waitingFor: null });
    }
    switch (step.type) {
      case "wait": {
        await log(step.id, "done");
        const next = nextPath(steps, path);
        if (!next) return save({ status: "completed", nextRunAt: null, waitingFor: null, finishedAt: now });
        return save({ path: next, nextRunAt: new Date(now.getTime() + durationMs(step.for)), waitingFor: null });
      }
      case "wait_for": {
        const until = new Date(now.getTime() + durationMs(step.within));
        return save({ path, nextRunAt: until, waitingFor: { event: step.event, planIds: step.planIds, until: until.toISOString() } });
      }
      case "check": {
        const yes = await clientMatches(tx, j.orgId, e.clientId, step.rule, now);
        await log(step.id, yes ? "yes" : "no");
        path = branch(steps, path, yes ? "yes" : "no");
        continue;
      }
      case "send_email": {
        const [design] = await tx.select().from(emailDesigns).where(and(eq(emailDesigns.id, step.emailId), eq(emailDesigns.orgId, j.orgId)));
        if (!design || design.archivedAt) await log(step.id, "failed", "The email has been deleted");
        else {
          const r = await queueDesignEmail(tx, j.orgId, design, [e.clientId], urls, { journeyId: j.id }, now);
          await log(step.id, r.sent ? "done" : "skipped", r.sent ? undefined : "They haven't agreed to marketing emails");
        }
        break;
      }
      case "send_push": {
        const r = await queuePush(tx, j.orgId, [e.clientId], { title: step.title, body: step.body, marketing: true, ref: { journeyId: j.id } });
        await log(step.id, r.sent ? "done" : "skipped", r.sent ? undefined : "They haven't agreed to marketing notifications");
        break;
      }
      case "send_whatsapp": {
        const r = await queueWhatsapp(tx, j.orgId, [e.clientId], step, urls, { journeyId: j.id });
        await log(step.id, r.sent ? "done" : "skipped", r.sent ? undefined : r.reason);
        break;
      }
      case "add_tag":
      case "remove_tag": {
        const [tag] = await tx.select({ id: clientTags.id }).from(clientTags).where(and(eq(clientTags.id, step.tagId), eq(clientTags.orgId, j.orgId)));
        if (!tag) { await log(step.id, "failed", "The tag has been deleted"); break; }
        if (step.type === "add_tag") await tx.insert(clientTagAssignments).values({ orgId: j.orgId, clientId: e.clientId, tagId: tag.id }).onConflictDoNothing();
        else await tx.delete(clientTagAssignments).where(and(eq(clientTagAssignments.clientId, e.clientId), eq(clientTagAssignments.tagId, tag.id)));
        await log(step.id, "done");
        break;
      }
      case "give_reward": {
        const what = await giveReward(tx, j.orgId, e.clientId, step.reward, { source: "journey", sourceId: j.id, why: j.name }, now);
        await notify(tx, { orgId: j.orgId, userIds: [e.clientId], template: "reward.given", data: { reward: what, why: j.name } });
        await log(step.id, "done", what);
        break;
      }
      case "notify_staff": {
        const staff = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, j.orgId), inArray(memberships.role, ["owner", "admin"]), eq(memberships.active, true)));
        const [c] = await tx.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, e.clientId));
        await notify(tx, { orgId: j.orgId, userIds: staff.map((s) => s.id), template: "journey.staff", data: { message: step.message, clientName: `${c?.first} ${c?.last}`, clientId: e.clientId, journeyName: j.name } });
        await log(step.id, "done");
        break;
      }
    }
    path = nextPath(steps, path);
  }
  return save({ status: "completed", nextRunAt: null, waitingFor: null, finishedAt: now });
}

/** Worker: run every enrollment that's due. Each runs in its own savepoint so one failure can't hold up the rest. */
export async function runDueJourneys(db: Db, urls: Urls, now = new Date(), batch = 100): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ e: journeyEnrollments, j: journeys })
      .from(journeyEnrollments)
      .innerJoin(journeys, eq(journeys.id, journeyEnrollments.journeyId))
      .where(and(eq(journeyEnrollments.status, "active"), lte(journeyEnrollments.nextRunAt, now), eq(journeys.status, "live")))
      .orderBy(asc(journeyEnrollments.nextRunAt))
      .limit(batch)
      .for("update", { of: journeyEnrollments, skipLocked: true });
    for (const { e, j } of due) {
      try {
        await tx.transaction((sp) => advance(sp, j, e, urls, now));
      } catch (err) {
        await tx.update(journeyEnrollments).set({ nextRunAt: new Date(now.getTime() + 15 * 60_000) }).where(eq(journeyEnrollments.id, e.id));
        await tx.insert(journeyStepLog).values({ orgId: e.orgId, journeyId: e.journeyId, enrollmentId: e.id, clientId: e.clientId, stepId: stepAt(e.definition.steps, e.path)?.id ?? "?", outcome: "failed", note: String(err instanceof Error ? err.message : err).slice(0, 300), createdAt: now });
      }
    }
    return due.length;
  });
}

/** Worker (hourly): time-based triggers. */
export async function scanJourneyTriggers(db: Db, now = new Date()) {
  const live = await db.select().from(journeys).where(eq(journeys.status, "live"));
  for (const j of live) {
    const t = j.definition.trigger;
    await db.transaction(async (tx) => {
      if (t.type === "package_expiring") {
        const soon = new Date(now.getTime() + t.days! * 86_400_000);
        const rows = await tx
          .select({ p: clientPackages })
          .from(clientPackages)
          .where(and(eq(clientPackages.orgId, j.orgId), isNull(clientPackages.cancelledAt), gt(clientPackages.expiresAt, now), lte(clientPackages.expiresAt, soon)));
        for (const { p } of rows) if (packageState(p, now) === "active" && !(p.billing === "recurring" && !p.stopsRenewingAt)) await enroll(tx, j, p.ownerId, `expiring:${p.id}`, now);
      } else if (t.type === "inactive") {
        const rows = await tx
          .select({ id: bookings.clientId, last: sql<string>`max(${classSessions.startsAt})` })
          .from(bookings)
          .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
          .innerJoin(memberships, and(eq(memberships.userId, bookings.clientId), eq(memberships.orgId, j.orgId), eq(memberships.active, true)))
          .where(and(eq(bookings.orgId, j.orgId), eq(bookings.attendance, "present")))
          .groupBy(bookings.clientId);
        const cutoff = now.getTime() - t.days! * 86_400_000;
        for (const r of rows) {
          const last = new Date(r.last);
          if (last.getTime() > cutoff) continue;
          // Booked ahead? They're coming back, so leave them be.
          const [ahead] = await tx.select({ n: count() }).from(bookings).innerJoin(classSessions, eq(classSessions.id, bookings.sessionId)).where(and(eq(bookings.clientId, r.id), eq(bookings.orgId, j.orgId), eq(bookings.status, "confirmed"), gt(classSessions.startsAt, now)));
          if (Number(ahead!.n) > 0) continue;
          await enroll(tx, j, r.id, `inactive:${last.toISOString().slice(0, 10)}`, now);
        }
      } else if (t.type === "joins_segment") {
        const [sg] = await tx.select().from(segments).where(eq(segments.id, t.segmentId!));
        if (!sg) return;
        const now_ = new Set(await matchSegment(tx, j.orgId, sg.definition, { now }));
        const before = new Set((await tx.select({ id: journeySegmentMembers.clientId }).from(journeySegmentMembers).where(eq(journeySegmentMembers.journeyId, j.id))).map((r) => r.id));
        for (const id of now_) if (!before.has(id)) { await tx.insert(journeySegmentMembers).values({ journeyId: j.id, clientId: id }).onConflictDoNothing(); await enroll(tx, j, id, `segment:${now.toISOString().slice(0, 13)}`, now); }
        const left = [...before].filter((id) => !now_.has(id));
        if (left.length) await tx.delete(journeySegmentMembers).where(and(eq(journeySegmentMembers.journeyId, j.id), inArray(journeySegmentMembers.clientId, left)));
      }
    });
  }
}

/** "Joins a segment" journeys only start people who join after it goes live. */
export async function seedSegmentMembers(tx: DbOrTx, j: Journey, now = new Date()) {
  if (j.definition.trigger.type !== "joins_segment") return;
  const [sg] = await tx.select().from(segments).where(eq(segments.id, j.definition.trigger.segmentId!));
  if (!sg) return;
  await tx.delete(journeySegmentMembers).where(eq(journeySegmentMembers.journeyId, j.id));
  const ids = await matchSegment(tx, j.orgId, sg.definition, { now });
  if (ids.length) await tx.insert(journeySegmentMembers).values(ids.map((clientId) => ({ journeyId: j.id, clientId }))).onConflictDoNothing();
}

/** Numbers for each step: how many reached it, and how it went; how many are waiting at each step now. */
export async function journeyStats(db: DbOrTx, j: Journey) {
  const log = await db
    .select({ stepId: journeyStepLog.stepId, outcome: journeyStepLog.outcome, n: count() })
    .from(journeyStepLog)
    .where(eq(journeyStepLog.journeyId, j.id))
    .groupBy(journeyStepLog.stepId, journeyStepLog.outcome);
  const active = await db.select({ path: journeyEnrollments.path, definition: journeyEnrollments.definition }).from(journeyEnrollments).where(and(eq(journeyEnrollments.journeyId, j.id), eq(journeyEnrollments.status, "active")));
  const [done] = await db.select({ n: count() }).from(journeyEnrollments).where(and(eq(journeyEnrollments.journeyId, j.id), eq(journeyEnrollments.status, "completed")));
  const [conv] = await db.select({ n: count() }).from(journeyEnrollments).where(and(eq(journeyEnrollments.journeyId, j.id), isNotNull(journeyEnrollments.convertedAt)));
  const steps: Record<string, Record<string, number>> = {};
  for (const r of log) (steps[r.stepId] ??= {})[r.outcome] = Number(r.n);
  const waitingAt: Record<string, number> = {};
  for (const a of active) { const s = stepAt(a.definition.steps, a.path); if (s) waitingAt[s.id] = (waitingAt[s.id] ?? 0) + 1; }
  const started = steps.start?.done ?? 0;
  const converted = Number(conv!.n);
  return {
    started, inProgress: active.length, finished: Number(done!.n), steps, waitingAt,
    // Goal: how many reached it while on the journey, as a share of everyone who started.
    ...(j.definition.goal ? { converted, conversionRate: started ? Math.round((converted / started) * 1000) / 10 : 0 } : {}),
  };
}

/** The trigger in plain English, e.g. "When a client attends their 50th class". */
export function describeTrigger(t: JourneyTriggerDef, names: { plans?: string[]; segment?: string } = {}): string {
  const base = JOURNEY_TRIGGERS[t.type].label.toLowerCase();
  if (t.type === "attendance_milestone") return `When a client attends their ${ordinal(t.count ?? 1)} class`;
  if (t.type === "package_expiring") return `${t.days} ${t.days === 1 ? "day" : "days"} before a client's package expires`;
  if (t.type === "inactive") return `When a client hasn't come for ${t.days} days (and hasn't booked ahead)`;
  if (t.type === "joins_segment") return `When a client joins “${names.segment ?? "a segment"}”`;
  if (t.type === "package_bought" && names.plans?.length) return `When a client buys ${names.plans.join(" or ")}`;
  return `When a client ${base}`;
}
function ordinal(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
