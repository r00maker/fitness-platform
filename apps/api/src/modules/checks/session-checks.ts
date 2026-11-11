/**
 * Mistake-catching checks. Each one adds a plain-English warning to `flags`;
 * none of them refuse the change. See lib/flags.ts for how confirmation works.
 * Thresholds live in FLAG_LIMITS (packages/shared/src/enums.ts).
 */
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { DateTime } from "luxon";
import { FLAG_LIMITS, OPTION_LABELS, type RefundMethod } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, rooms, users } from "../../db/schema.js";
import type { Flags } from "../../lib/flags.js";
import { utcToLocal, type TZ } from "../../lib/time.js";
import { findOverlaps } from "../sessions/context.js";

const HOUR = 3_600_000;

/** "11:00am", with noon/midnight spelled out because that's where AM/PM slips happen. */
export function clock(d: Date | DateTime, zone?: TZ): string {
  const dt = d instanceof DateTime ? d : DateTime.fromJSDate(d, { zone });
  const t = dt.toFormat("h:mma").toLowerCase();
  if (dt.hour === 0 && dt.minute === 0) return `${t} (midnight)`;
  if (dt.hour === 12 && dt.minute === 0) return `${t} (noon)`;
  return t;
}
const day = (d: Date, zone: TZ) => DateTime.fromJSDate(d, { zone }).toFormat("ccc d LLL");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hoursText = (mins: number) => (mins % 60 === 0 ? plural(mins / 60, "hour") : `${Math.floor(mins / 60)}h ${mins % 60}m`);

// ---------------------------------------------------------------------------
// Clashes: instructor, room, duplicates
// ---------------------------------------------------------------------------
export async function checkSlot(
  db: DbOrTx,
  orgId: string,
  flags: Flags,
  zone: TZ,
  slot: { sessionId?: string; instructorId?: string | null; roomId?: string | null; classTypeId?: string; locationId?: string; startsAt: Date; endsAt: Date; excludeIds?: string[] },
) {
  const overlaps = await findOverlaps(db, orgId, slot);
  if (!overlaps.length) return;
  const when = (o: { startsAt: Date }) => `${clock(o.startsAt, zone)} on ${day(o.startsAt, zone)}`;
  let roomName: string | undefined;
  for (const o of overlaps) {
    const ref = { sessionId: slot.sessionId, details: { clashingSessionId: o.id, date: utcToLocal(slot.startsAt, zone).date } };
    if (slot.classTypeId && o.classTypeId === slot.classTypeId && o.locationId === slot.locationId && o.startsAt.getTime() === slot.startsAt.getTime()) {
      flags.confirm({ code: "possible_duplicate", message: `There's already a ${o.className} class here at ${when(o)}. Is this one a duplicate?`, ...ref });
    }
    if (slot.instructorId && o.instructorId === slot.instructorId) {
      flags.confirm({ code: "instructor_double_booked", message: `${o.instructorName} is also teaching ${o.className} at ${when(o)}.`, ...ref });
    }
    if (slot.roomId && o.roomId === slot.roomId) {
      roomName ??= (await db.select({ name: rooms.name }).from(rooms).where(eq(rooms.id, slot.roomId)))[0]?.name ?? "This room";
      flags.confirm({ code: "room_double_booked", message: `${roomName} is also being used for ${o.className} at ${when(o)}.`, ...ref });
    }
  }
}

// ---------------------------------------------------------------------------
// Times and lengths
// ---------------------------------------------------------------------------
export function checkTiming(
  flags: Flags,
  zone: TZ,
  s: { sessionId?: string; startsAt: Date; durationMinutes: number; usualMinutes?: number | null; className?: string; isNew: boolean; now: Date },
) {
  const start = DateTime.fromJSDate(s.startsAt, { zone });
  const end = start.plus({ minutes: s.durationMinutes });
  const d = s.durationMinutes;
  const ref = { sessionId: s.sessionId };
  // An AM/PM slip adds exactly 12 hours, so offer the 12-hours-shorter version as a fix.
  const ampmFix = d > 12 * 60 && d - 12 * 60 >= FLAG_LIMITS.shortClassMinutes
    ? { durationMinutes: d - 12 * 60, endTime: start.plus({ minutes: d - 12 * 60 }).toFormat("HH:mm") }
    : undefined;
  const fixText = ampmFix ? ` Did you mean ${clock(start)} to ${clock(start.plus({ minutes: ampmFix.durationMinutes }))}?` : "";

  if (end.toISODate() !== start.toISODate() && !(end.hour === 0 && end.minute === 0 && d <= FLAG_LIMITS.longClassMinutes)) {
    flags.confirm({ code: "ends_after_midnight", message: `This class runs from ${clock(start)} to ${clock(end)} the next day (${hoursText(d)}).${fixText}`, suggestion: ampmFix, ...ref });
  } else if (d > FLAG_LIMITS.longClassMinutes) {
    flags.confirm({ code: "unusually_long", message: `This class is ${hoursText(d)} long (${clock(start)} to ${clock(end)}).${fixText}`, suggestion: ampmFix, ...ref });
  } else if (d < FLAG_LIMITS.shortClassMinutes) {
    flags.confirm({ code: "unusually_short", message: `This class is only ${plural(d, "minute")} long. Is that right?`, ...ref });
  } else if (s.usualMinutes && (Math.abs(d - s.usualMinutes) / s.usualMinutes) * 100 > FLAG_LIMITS.durationDifferencePct) {
    flags.info({ code: "duration_differs_from_usual", message: `${s.className ?? "This class"} is usually ${s.usualMinutes} minutes; this one is ${d}.`, suggestion: { durationMinutes: s.usualMinutes }, ...ref });
  }

  if (start.hour < FLAG_LIMITS.earliestNormalHour || start.hour >= FLAG_LIMITS.latestNormalHour) {
    const flipped = start.plus({ hours: start.hour < 12 ? 12 : -12 });
    flags.confirm({
      code: "unusual_start_time",
      message: `This class starts at ${clock(start)}. Did you mean ${clock(flipped)}?`,
      suggestion: { startTime: flipped.toFormat("HH:mm") },
      ...ref,
    });
  }
  if (s.isNew && s.startsAt < s.now) {
    flags.confirm({ code: "in_the_past", message: `This class is in the past (${start.toFormat("ccc d LLL yyyy")} at ${clock(start)}).`, ...ref });
  }
  if (s.startsAt.getTime() - s.now.getTime() > FLAG_LIMITS.farFutureDays * 24 * HOUR) {
    flags.confirm({ code: "far_future", message: `This class is on ${start.toFormat("d LLL yyyy")}, over a year away. Is the year right?`, ...ref });
  }
}

export function checkCapacity(flags: Flags, s: { sessionId?: string; capacity: number; room?: { name: string; capacity: number | null } | null }) {
  if (s.room?.capacity != null && s.capacity > s.room.capacity) {
    flags.confirm({
      code: "over_room_limit",
      message: `${s.room.name} holds ${s.room.capacity} people, but this class has ${s.capacity} spots.`,
      suggestion: { capacity: s.room.capacity },
      sessionId: s.sessionId,
    });
  }
}

export function checkInstructor(flags: Flags, s: { sessionId?: string; instructorId: string | null }) {
  if (!s.instructorId) flags.info({ code: "no_instructor", message: "No instructor is assigned yet. It will show as “TBC” to clients.", sessionId: s.sessionId });
}

export async function usualDuration(db: DbOrTx, classTypeId: string) {
  const [t] = await db.select({ name: classTypes.name, mins: classTypes.defaultDurationMinutes }).from(classTypes).where(eq(classTypes.id, classTypeId));
  return { className: t?.name, usualMinutes: t?.mins ?? null };
}

// ---------------------------------------------------------------------------
// Changes that affect people
// ---------------------------------------------------------------------------
export function checkShortNotice(flags: Flags, s: { sessionId: string; startsAt: Date; now: Date; what: string; severity: "confirm" | "info" }) {
  const hoursAway = (s.startsAt.getTime() - s.now.getTime()) / HOUR;
  if (hoursAway > 0 && hoursAway < FLAG_LIMITS.shortNoticeHours) {
    const f = { code: "short_notice" as const, sessionId: s.sessionId, message: `This class starts in ${hoursAway < 1 ? "under an hour" : plural(Math.floor(hoursAway), "hour")}. ${s.what}` };
    s.severity === "confirm" ? flags.confirm(f) : flags.info(f);
  }
}

export function checkCancellation(flags: Flags, s: { sessionId: string; booked: number; waitlisted: number; refund: RefundMethod; endsAt: Date; startsAt: Date; now: Date }) {
  if (s.booked > 0) {
    flags.confirm({
      code: "clients_affected",
      sessionId: s.sessionId,
      message: `${plural(s.booked, "booked client")} will be told the class is cancelled${s.refund === "none" ? "" : ` and given: ${OPTION_LABELS.refundMethod[s.refund].toLowerCase()}`}.`,
    });
    if (s.refund === "none") flags.confirm({ code: "no_refund", sessionId: s.sessionId, message: "Booked clients won't get their class credit or payment back." });
  }
  if (s.waitlisted > 0) flags.info({ code: "waitlist_affected", sessionId: s.sessionId, message: `${plural(s.waitlisted, "person", "people")} on the waitlist will be told.` });
  if (s.endsAt < s.now) flags.confirm({ code: "already_happened", sessionId: s.sessionId, message: "This class has already happened. Cancelling it now changes past records." });
  checkShortNotice(flags, { sessionId: s.sessionId, startsAt: s.startsAt, now: s.now, what: "Clients may already be on their way.", severity: "info" });
}

export function checkBulk(flags: Flags, count: number, verb: string) {
  if (count > FLAG_LIMITS.manyClasses) flags.confirm({ code: "many_classes", message: `This will ${verb} ${count} classes.` });
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------
export async function checkClientOverlap(
  db: DbOrTx,
  flags: Flags,
  zone: TZ,
  b: { clientId: string; sessionId: string; startsAt: Date; endsAt: Date; self: boolean; ignoreSessionId?: string },
) {
  const rows = await db
    .select({ startsAt: classSessions.startsAt, className: classTypes.name, first: users.firstName, sessionId: classSessions.id })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(users, eq(users.id, bookings.clientId))
    .where(
      and(
        eq(bookings.clientId, b.clientId),
        eq(bookings.status, "confirmed"),
        ne(bookings.sessionId, b.sessionId),
        b.ignoreSessionId ? ne(bookings.sessionId, b.ignoreSessionId) : undefined,
        lt(classSessions.startsAt, b.endsAt),
        gt(classSessions.endsAt, b.startsAt),
      ),
    )
    .limit(3);
  for (const r of rows) {
    flags.confirm({
      code: "client_double_booked",
      message: `${b.self ? "You're" : `${r.first} is`} already booked into ${r.className} at ${clock(r.startsAt, zone)} on ${day(r.startsAt, zone)}.`,
      details: { otherSessionId: r.sessionId },
    });
  }
}
