/**
 * Closures and holidays: days a location (or the whole studio) is closed.
 *  - Recurring classes skip closed days (see generateSeriesSessions).
 *  - Adding a closure cancels the classes already on those days in one go, and each person
 *    gets one message listing all their cancelled classes rather than one per class.
 *  - Adding a single class on a closed day asks first (the "closed_day" check).
 *  - Removing a closure puts back the recurring classes it left out. Classes it cancelled
 *    stay cancelled, because bookings were refunded and people were told.
 */
import { FLAG_CODES, type RefundMethod } from "@studio/shared";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { classSeries, classSessions, closures, locations, waitlistEntries, bookings } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { Flags } from "../../lib/flags.js";
import { daysBetween, recurrenceDates, shiftDate, utcToLocal, type TZ } from "../../lib/time.js";
import type { AuthContext } from "../../plugins/auth.js";
import { refundNote } from "../bookings/service.js";
import { notify } from "../notifications/outbox.js";
import { describeSession, locationZone, orgZone, type SessionRow } from "../sessions/context.js";
import { bookSeriesClientsInBackground, cancelOne, seriesRule, seriesSessionRow, type CancelledInfo } from "../sessions/service.js";
import { closureCovering, closureDatesText, closuresFor, type ClosureRow } from "./days.js";

const MAX_DAYS = 366;
const MAX_CLASSES = 2000;
/** Starts the reason on classes a closure cancelled; clients see it in the cancellation. */
const CANCEL_REASON = "Studio closed: ";

interface Span {
  locationId?: string | null;
  startDate: string;
  endDate: string;
}

/** Each affected location with its time zone (one, or all the studio's open locations). */
async function locationsFor(db: DbOrTx, orgId: string, locationId: string | null | undefined): Promise<{ id: string; zone: TZ }[]> {
  if (locationId) return [{ id: locationId, zone: await locationZone(db, orgId, locationId) }];
  const rows = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.orgId, orgId), isNull(locations.archivedAt)));
  return Promise.all(rows.map(async (l) => ({ id: l.id, zone: await locationZone(db, orgId, l.id) })));
}

/** Upcoming scheduled classes on the closed days, judged by each location's own dates. */
async function classesOn(db: DbOrTx, orgId: string, span: Span, now: Date, status: "scheduled" | "cancelled" = "scheduled"): Promise<SessionRow[]> {
  const out: SessionRow[] = [];
  for (const loc of await locationsFor(db, orgId, span.locationId)) {
    // A day either side covers any time zone; the exact local date is checked below.
    const rows = await db
      .select()
      .from(classSessions)
      .where(
        and(
          eq(classSessions.orgId, orgId),
          eq(classSessions.locationId, loc.id),
          eq(classSessions.status, status),
          gte(classSessions.startsAt, new Date(Math.max(now.getTime(), Date.parse(`${shiftDate(span.startDate, -1)}T00:00:00Z`)))),
          lte(classSessions.startsAt, new Date(`${shiftDate(span.endDate, 2)}T00:00:00Z`)),
        ),
      )
      .orderBy(asc(classSessions.startsAt))
      .limit(MAX_CLASSES + 1);
    for (const s of rows) {
      const date = utcToLocal(s.startsAt, loc.zone).date;
      if (date >= span.startDate && date <= span.endDate && s.startsAt > now) out.push(s);
    }
  }
  if (out.length > MAX_CLASSES) throw badRequest("too_many", `That closure covers more than ${MAX_CLASSES.toLocaleString("en")} classes. Choose fewer days.`);
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

async function checkSpan(db: DbOrTx, orgId: string, span: Span, now: Date) {
  if (span.endDate < span.startDate) throw badRequest("invalid_input", "Some details need fixing.", { fields: { endDate: "The last day can't be before the first day." } });
  if (daysBetween(span.startDate, span.endDate) >= MAX_DAYS) throw badRequest("invalid_input", "Some details need fixing.", { fields: { endDate: "A closure can be up to a year long." } });
  if (span.locationId) await locationZone(db, orgId, span.locationId);
  const today = utcToLocal(now, await orgZone(db, orgId)).date;
  if (span.endDate < today) throw badRequest("closure_in_past", "Those days have already passed. Choose today or a later date.");
}

/** What a closure would do, for the "Add closure" window before saving. */
export async function previewClosure(db: DbOrTx, orgId: string, span: Span, now = new Date()) {
  await checkSpan(db, orgId, span, now);
  const list = await classesOn(db, orgId, span, now);
  const ids = list.map((s) => s.id);
  const booked = ids.length
    ? await db.select({ sessionId: bookings.sessionId, n: sql<number>`count(*)::int` }).from(bookings).where(and(inArray(bookings.sessionId, ids), eq(bookings.status, "confirmed"))).groupBy(bookings.sessionId)
    : [];
  const [{ waiting } = { waiting: 0 }] = ids.length
    ? await db.select({ waiting: sql<number>`count(*)::int` }).from(waitlistEntries).where(and(inArray(waitlistEntries.sessionId, ids), inArray(waitlistEntries.status, ["waiting", "offered"])))
    : [];
  const bookedBy = new Map(booked.map((b) => [b.sessionId, b.n]));
  const people = [...bookedBy.values()].reduce((a, b) => a + b, 0);
  const sample = [];
  for (const s of list.slice(0, 8)) sample.push({ id: s.id, ...(await describeSession(db, s)), booked: bookedBy.get(s.id) ?? 0 });
  const overlapping = await closuresFor(db, orgId, span.locationId ?? null, span.startDate, span.endDate);
  return {
    dates: closureDatesText(span),
    days: daysBetween(span.startDate, span.endDate) + 1,
    classes: list.length,
    peopleBooked: people,
    waitlisted: waiting,
    sample,
    /** Closures already covering some of these days. */
    alreadyClosed: overlapping.map((c) => ({ id: c.id, name: c.name, dates: closureDatesText(c) })),
    text: classesText(list.length, people),
  };
}

function classesText(classes: number, people: number) {
  if (!classes) return "No classes are on the schedule for these days.";
  return `${classes} ${classes === 1 ? "class is" : "classes are"} on the schedule for these days${people ? ` (${people} ${people === 1 ? "person" : "people"} booked)` : ", none booked yet"}.`;
}

export async function createClosure(
  tx: DbOrTx,
  auth: AuthContext,
  input: Span & { name: string; message?: string | null; cancelClasses: boolean; refund: RefundMethod; notifyClients: boolean },
  flags: Flags,
  now = new Date(),
) {
  await checkSpan(tx, auth.orgId, input, now);
  const targets = await classesOn(tx, auth.orgId, input, now);
  const [closure] = await tx
    .insert(closures)
    .values({ orgId: auth.orgId, locationId: input.locationId ?? null, name: input.name, startDate: input.startDate, endDate: input.endDate, message: input.message || null, createdBy: auth.userId })
    .returning();

  const affected: CancelledInfo[] = [];
  if (targets.length && input.cancelClasses) {
    const booked = targets.length
      ? (await tx.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(inArray(bookings.sessionId, targets.map((s) => s.id)), eq(bookings.status, "confirmed"))))[0]?.n ?? 0
      : 0;
    flags.confirm({
      code: "closure_cancels_classes",
      details: { classes: targets.length, peopleBooked: booked },
      message: `This will cancel ${targets.length} ${targets.length === 1 ? "class" : "classes"}${booked ? ` and ${booked} ${booked === 1 ? "booking" : "bookings"}` : ""}.${booked && input.refund === "none" ? " Clients will NOT get their class back." : ""} ${input.notifyClients ? "Everyone booked and on the waitlist will get one message about it." : "Clients will NOT be told."}`,
    });
    // The one warning above covers every class, so the per-class checks are already answered.
    const answered = new Flags([...FLAG_CODES]);
    for (const s of targets) await cancelOne(tx, auth, s, { reason: `${CANCEL_REASON}${input.name}`, refund: input.refund, notifyClients: false, silent: (i) => affected.push(i) }, answered, now);
    await tellPeople(tx, auth, closure!, affected, input);
  } else if (targets.length) {
    flags.info({ code: "closed_day", details: { classes: targets.length }, message: `${targets.length} ${targets.length === 1 ? "class stays" : "classes stay"} on the schedule. New recurring classes will skip these days.` });
  }
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "closure.created", entityType: "closure", entityId: closure!.id, details: { cancelled: affected.length } });
  return { closure: closureView(closure!), cancelled: affected.length, kept: input.cancelClasses ? 0 : targets.length };
}

/** One message per person, listing all their cancelled classes. */
async function tellPeople(tx: DbOrTx, auth: AuthContext, closure: ClosureRow, affected: CancelledInfo[], opts: { refund: RefundMethod; notifyClients: boolean }) {
  const byPerson = new Map<string, { role: "booked" | "waitlist" | "teaching"; items: string[] }>();
  const add = (userId: string | null, role: "booked" | "waitlist" | "teaching", item: string) => {
    if (!userId) return;
    const key = `${userId}:${role}`;
    if (!byPerson.has(key)) byPerson.set(key, { role, items: [] });
    byPerson.get(key)!.items.push(item);
  };
  for (const a of affected) {
    const d = await describeSession(tx, a.session);
    const item = `${d.className} on ${d.displayDate} at ${d.localTime}`;
    add(a.session.instructorId, "teaching", item);
    if (opts.notifyClients) {
      for (const c of a.clientIds) add(c, "booked", item);
      for (const w of a.waitlisted) add(w, "waitlist", item);
    }
  }
  const base = { closureName: closure.name, dates: closureDatesText(closure), message: closure.message };
  for (const [key, v] of byPerson) {
    const userId = key.split(":")[0]!;
    await notify(tx, { orgId: auth.orgId, userIds: [userId], template: "closure.cancelled", data: { ...base, role: v.role, items: v.items, refundNote: v.role === "booked" ? refundNote(opts.refund) : "" } });
  }
}

export async function updateClosure(tx: DbOrTx, auth: AuthContext, id: string, input: { name?: string; message?: string | null }) {
  const [c] = await tx
    .update(closures)
    .set({ ...(input.name !== undefined && { name: input.name }), ...(input.message !== undefined && { message: input.message || null }) })
    .where(and(eq(closures.id, id), eq(closures.orgId, auth.orgId)))
    .returning();
  if (!c) throw notFound("closure");
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "closure.updated", entityType: "closure", entityId: id });
  return closureView(c);
}

/**
 * Remove a closure. Recurring classes it left out come back (from today on), unless another
 * closure still covers the day. Courses with a set number of classes already made up the
 * missed class at the end, so nothing is added to those.
 */
export async function deleteClosure(tx: DbOrTx, auth: AuthContext, id: string, input: { restoreClasses: boolean }, now = new Date()) {
  const [c] = await tx.select().from(closures).where(and(eq(closures.id, id), eq(closures.orgId, auth.orgId))).for("update");
  if (!c) throw notFound("closure");
  await tx.delete(closures).where(eq(closures.id, id));
  const today = utcToLocal(now, await orgZone(tx, auth.orgId)).date;
  let restored = 0;
  if (input.restoreClasses && c.endDate >= today) {
    const from = c.startDate > today ? c.startDate : today;
    const series = await tx
      .select()
      .from(classSeries)
      .where(and(eq(classSeries.orgId, auth.orgId), isNull(classSeries.endedAt), isNull(classSeries.occurrences), c.locationId ? eq(classSeries.locationId, c.locationId) : undefined));
    for (const sr of series) {
      const through = sr.generatedThrough && sr.generatedThrough < c.endDate ? sr.generatedThrough : c.endDate;
      if (!sr.generatedThrough || through < from) continue;
      const still = await closuresFor(tx, auth.orgId, sr.locationId, from, through);
      const zone = await locationZone(tx, auth.orgId, sr.locationId);
      const existing = await tx.select({ startsAt: classSessions.startsAt }).from(classSessions).where(eq(classSessions.seriesId, sr.id));
      const have = new Set(existing.map((e) => utcToLocal(e.startsAt, zone).date));
      const dates = recurrenceDates(seriesRule(sr), from, through, 0, (d) => have.has(d) || !!closureCovering(still, d));
      const rows = dates.map((d) => seriesSessionRow(sr, d, zone)).filter((r) => r.startsAt > now);
      if (!rows.length) continue;
      const created = await tx.insert(classSessions).values(rows).returning();
      if (sr.clientIds.length) await bookSeriesClientsInBackground(tx, sr, created, now);
      restored += created.length;
    }
  }
  // Classes the closure cancelled stay cancelled: people were told and their bookings returned.
  const stillCancelled = c.endDate >= today ? (await classesOn(tx, auth.orgId, c, now, "cancelled")).filter((s) => s.cancelReason?.startsWith(CANCEL_REASON)).length : 0;
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "closure.deleted", entityType: "closure", entityId: id, details: { restored } });
  const parts = [restored ? `${restored} recurring ${restored === 1 ? "class is" : "classes are"} back on the schedule.` : ""];
  if (stillCancelled) parts.push(`${stillCancelled} ${stillCancelled === 1 ? "class" : "classes"} cancelled for this closure ${stillCancelled === 1 ? "stays" : "stay"} cancelled. Add ${stillCancelled === 1 ? "it" : "them"} again from the calendar if you need to.`);
  return { deleted: id, restored, stillCancelled, text: parts.filter(Boolean).join(" ") || "Closure removed." };
}

export async function listClosures(db: DbOrTx, orgId: string, include: "upcoming" | "all", now = new Date()) {
  const today = utcToLocal(now, await orgZone(db, orgId)).date;
  const rows = await db
    .select({ c: closures, locationName: locations.name })
    .from(closures)
    .leftJoin(locations, eq(locations.id, closures.locationId))
    .where(and(eq(closures.orgId, orgId), include === "upcoming" ? gte(closures.endDate, today) : undefined))
    .orderBy(asc(closures.startDate));
  return { closures: rows.map((r) => ({ ...closureView(r.c), locationName: r.locationName ?? "All locations" })) };
}

/** Closures touching a calendar range, for the calendar to shade those days. */
export async function closuresInRange(db: DbOrTx, orgId: string, locationId: string | undefined, fromDate: string, toDate: string) {
  const rows = await db
    .select()
    .from(closures)
    .where(and(eq(closures.orgId, orgId), lte(closures.startDate, toDate), gte(closures.endDate, fromDate), locationId ? or(isNull(closures.locationId), eq(closures.locationId, locationId)) : undefined))
    .orderBy(asc(closures.startDate));
  return rows.map(closureView);
}

export function closureView(c: ClosureRow) {
  return { id: c.id, name: c.name, locationId: c.locationId, startDate: c.startDate, endDate: c.endDate, dates: closureDatesText(c), message: c.message };
}
