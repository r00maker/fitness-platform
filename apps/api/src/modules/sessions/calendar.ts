import { and, asc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { FLAG_TITLES, TIME_OF_DAY_HOURS, can, type CalendarView, type FlagCode, type TimeOfDay } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { classSessions, classTypes, locations, rooms, users } from "../../db/schema.js";
import { calendarRange, utcToLocal, zoneFor, type TZ } from "../../lib/time.js";
import type { AuthContext } from "../../plugins/auth.js";
import { getOrg } from "./context.js";
import { instructorHistory } from "./people.js";
import { bookingWindow, windowStatus } from "../bookings/rules.js";

export interface CalendarQuery {
  view: CalendarView;
  date: string;
  timezone?: string;
  locationId?: string;
  classTypeId?: string;
  instructorId?: string;
  timeOfDay?: TimeOfDay;
  q?: string;
  includeCancelled: boolean;
  favouriteInstructor?: boolean;
}

const instructor = alias(users, "instructor");
const coverFor = alias(users, "cover_for");

/**
 * One query returns everything a calendar cell needs (name, colour, instructor,
 * spots left, waitlist size), so day/week/month views load in a single round trip.
 */
export async function getCalendar(db: DbOrTx, auth: AuthContext, query: CalendarQuery) {
  let q = query;
  const org = await getOrg(db, auth.orgId);
  const zones = new Map<string, TZ>();
  const zone = (name: string) => {
    if (!zones.has(name)) zones.set(name, zoneFor(name, org.observesDaylightSaving));
    return zones.get(name)!;
  };
  let tzName = q.timezone ?? org.timezone;
  if (!q.timezone && q.locationId) {
    const [loc] = await db.select({ tz: locations.timezone }).from(locations).where(and(eq(locations.id, q.locationId), eq(locations.orgId, auth.orgId)));
    if (loc) tzName = loc.tz;
  }
  const { from, to } = calendarRange(q.view, q.date, zone(tzName));
  const isClient = auth.role === "client";
  // Instructors see only their own classes; Front of House and admins see everything.
  if (auth.role === "instructor") q = { ...q, instructorId: auth.userId };
  else if (!isClient && !can(auth.role, "viewFullSchedule")) q = { ...q, instructorId: auth.userId };
  // Clients see a star on classes taught by their favourite instructor, and can filter to just those in one tap.
  const favourite = isClient ? (await instructorHistory(db, auth.orgId, [auth.userId])).favourite.get(auth.userId) : undefined;
  const favouriteOnly = isClient && q.favouriteInstructor;
  if (favouriteOnly) q = { ...q, instructorId: favourite?.instructorId };
  const now = new Date();

  // Badges for staff: double-booked instructor or room (allowed, but worth seeing at a glance).
  const overlapping = (col: "instructor_id" | "room_id") =>
    sql<boolean>`exists (select 1 from class_sessions o where o.org_id = ${classSessions.orgId} and o.id <> ${classSessions.id} and o.status = 'scheduled'
      and o.${sql.raw(col)} = ${col === "instructor_id" ? classSessions.instructorId : classSessions.roomId}
      and o.starts_at < ${classSessions.endsAt} and o.ends_at > ${classSessions.startsAt})`;

  const booked = sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed')`;
  const classpassTaken = sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed' and b.source = 'classpass')`;
  // Appointments are private: clients only see the ones they're booked into.
  const ownBooking = sql<boolean>`exists (select 1 from bookings b where b.session_id = ${classSessions.id} and b.client_id = ${auth.userId} and b.status = 'confirmed')`;
  const waiting = sql<number>`(select count(*)::int from waitlist_entries w where w.session_id = ${classSessions.id} and w.status in ('waiting','offered'))`;
  const search = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

  const rows = await db
    .select({
      id: classSessions.id,
      seriesId: classSessions.seriesId,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      status: classSessions.status,
      capacity: classSessions.capacity,
      waitlistEnabled: classSessions.waitlistEnabled,
      notes: classSessions.notes,
      classType: { id: classTypes.id, name: classTypes.name, color: classTypes.color, kind: classTypes.kind },
      classpassEnabled: classSessions.classpassEnabled,
      classpassSpots: classSessions.classpassSpots,
      classpassTaken,
      location: { id: locations.id, name: locations.name, timezone: locations.timezone },
      roomName: rooms.name,
      instructorId: classSessions.instructorId,
      instructorFirst: instructor.firstName,
      instructorLast: instructor.lastName,
      instructorPhoto: instructor.photoUrl,
      roomId: classSessions.roomId,
      coverForId: classSessions.coverForInstructorId,
      coverForFirst: coverFor.firstName,
      coverForLast: coverFor.lastName,
      booked,
      waiting,
      instructorClash: overlapping("instructor_id"),
      roomClash: overlapping("room_id"),
    })
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(locations, eq(locations.id, classSessions.locationId))
    .leftJoin(rooms, eq(rooms.id, classSessions.roomId))
    .leftJoin(instructor, eq(instructor.id, classSessions.instructorId))
    .leftJoin(coverFor, eq(coverFor.id, classSessions.coverForInstructorId))
    .where(
      and(
        eq(classSessions.orgId, auth.orgId),
        gte(classSessions.startsAt, from),
        lt(classSessions.startsAt, to),
        q.includeCancelled && !isClient ? undefined : eq(classSessions.status, "scheduled"),
        q.locationId ? eq(classSessions.locationId, q.locationId) : undefined,
        q.classTypeId ? eq(classSessions.classTypeId, q.classTypeId) : undefined,
        q.instructorId ? eq(classSessions.instructorId, q.instructorId) : undefined,
        // Filtering by favourite but they don't have one yet: nothing matches.
        favouriteOnly && !favourite ? sql`false` : undefined,
        isClient ? or(eq(classTypes.kind, "class"), ownBooking) : undefined,
        search
          ? or(
              ilike(classTypes.name, search),
              ilike(locations.name, search),
              ilike(rooms.name, search),
              ilike(sql`${instructor.firstName} || ' ' || ${instructor.lastName}`, search),
            )
          : undefined,
      ),
    )
    .orderBy(asc(classSessions.startsAt))
    .limit(2000);


  // Time of day is judged in each class's own local time (so it respects the daylight-saving setting).
  const visible = q.timeOfDay
    ? rows.filter((r) => {
        const h = Number(utcToLocal(r.startsAt, zone(r.location.timezone)).time.slice(0, 2));
        const [lo, hi] = TIME_OF_DAY_HOURS[q.timeOfDay!];
        return h >= lo && h < hi;
      })
    : rows;

  return {
    view: q.view,
    timezone: tzName,
    daylightSaving: org.observesDaylightSaving,
    ...(isClient ? { favouriteInstructorId: favourite?.instructorId ?? null, favouriteOnly } : {}),
    from: from.toISOString(),
    to: to.toISOString(),
    sessions: visible.map((r) => {
      const z = zone(r.location.timezone);
      const local = utcToLocal(r.startsAt, z);
      const win = bookingWindow(org, r.startsAt, z);
      const flags: FlagCode[] = [];
      if (r.status === "scheduled") {
        if (r.instructorClash) flags.push("instructor_double_booked");
        if (r.roomClash) flags.push("room_double_booked");
        if (!r.instructorId) flags.push("no_instructor");
      }
      return {
        id: r.id,
        seriesId: r.seriesId,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        localDate: local.date,
        localStartTime: local.time,
        localEndTime: utcToLocal(r.endsAt, z).time,
        status: r.status,
        classType: r.classType,
        color: r.classType.color,
        location: r.location,
        roomId: r.roomId,
        roomName: r.roomName,
        instructor: r.instructorId ? { id: r.instructorId, name: `${r.instructorFirst} ${r.instructorLast}`, photoUrl: r.instructorPhoto } : null,
        /** Set when the instructor is covering: shown as "Ben Tan (cover for Ana Lim)". */
        cover: r.coverForId ? { forInstructor: { id: r.coverForId, name: `${r.coverForFirst} ${r.coverForLast}` } } : null,
        ...(isClient ? { favouriteInstructor: !!favourite && favourite.instructorId === r.instructorId } : {}),
        capacity: r.capacity,
        booked: r.booked,
        spotsLeft: Math.max(0, r.capacity - r.booked),
        isFull: r.booked >= r.capacity,
        waitlistEnabled: r.waitlistEnabled,
        waitlistCount: r.waiting,
        bookingOpensAt: win.opensAt.toISOString(),
        bookingClosesAt: win.closesAt.toISOString(),
        bookingWindow: windowStatus(now, win),
        isAppointment: r.classType.kind === "appointment",
        ...(isClient ? {} : { classpass: classpassView(r) }),
        ...(isClient ? {} : { notes: r.notes, flags: flags.map((code) => ({ code, title: FLAG_TITLES[code] })) }),
      };
    }),
  };
}

/**
 * ClassPass for a class: how many spots are open to it, taken, and still available.
 * Available is what ClassPass can still sell: the ClassPass spots left, but never more than the class has free.
 */
export function classpassView(r: { classpassEnabled: boolean; classpassSpots: number | null; classpassTaken: number; capacity: number; booked: number }) {
  if (!r.classpassEnabled) return { enabled: false as const };
  const spots = r.classpassSpots ?? 0;
  return { enabled: true as const, spots, taken: r.classpassTaken, available: Math.max(0, Math.min(spots - r.classpassTaken, r.capacity - r.booked)) };
}
