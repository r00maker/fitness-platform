import { and, count, eq, inArray, lt, gt, notInArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, locations, memberships, organizations, users, waitlistEntries } from "../../db/schema.js";
import { notFound } from "../../lib/errors.js";
import { DateTime } from "luxon";
import { utcToLocal, zoneFor, type TZ } from "../../lib/time.js";

export type SessionRow = typeof classSessions.$inferSelect;

/** Load a class and lock it so capacity checks can't race (two people grabbing the last spot). */
export async function lockSession(tx: DbOrTx, orgId: string, sessionId: string): Promise<SessionRow> {
  const [s] = await tx
    .select()
    .from(classSessions)
    .where(and(eq(classSessions.id, sessionId), eq(classSessions.orgId, orgId)))
    .for("update");
  if (!s) throw notFound("class");
  return s;
}

export async function getSession(db: DbOrTx, orgId: string, sessionId: string): Promise<SessionRow> {
  const [s] = await db.select().from(classSessions).where(and(eq(classSessions.id, sessionId), eq(classSessions.orgId, orgId)));
  if (!s) throw notFound("class");
  return s;
}

export async function getOrg(db: DbOrTx, orgId: string) {
  const [o] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!o) throw notFound("studio");
  return o;
}

/** The human-readable facts used in notifications: class name, place and local time. */
export async function describeSession(db: DbOrTx, s: Pick<SessionRow, "id" | "classTypeId" | "locationId" | "startsAt">) {
  const [row] = await db
    .select({ className: classTypes.name, locationName: locations.name, timezone: locations.timezone, dst: organizations.observesDaylightSaving })
    .from(classTypes)
    .innerJoin(locations, eq(locations.id, s.locationId))
    .innerJoin(organizations, eq(organizations.id, locations.orgId))
    .where(eq(classTypes.id, s.classTypeId));
  const zone = zoneFor(row?.timezone ?? "UTC", row?.dst ?? false);
  const local = utcToLocal(s.startsAt, zone);
  return {
    sessionId: s.id,
    className: row?.className ?? "Class",
    locationName: row?.locationName ?? "",
    timezone: row?.timezone ?? "UTC",
    localDate: local.date,
    localTime: local.time,
    /** Friendly form for messages, e.g. "Wed 11 Nov". */
    displayDate: DateTime.fromISO(local.date).toFormat("ccc d LLL"),
  };
}

/** The zone a location's classes are shown in, honouring the studio's daylight-saving setting. */
export async function locationZone(db: DbOrTx, orgId: string, locationId: string): Promise<TZ> {
  const [l] = await db
    .select({ timezone: locations.timezone, dst: organizations.observesDaylightSaving })
    .from(locations)
    .innerJoin(organizations, eq(organizations.id, locations.orgId))
    .where(and(eq(locations.id, locationId), eq(locations.orgId, orgId)));
  if (!l) throw notFound("location");
  return zoneFor(l.timezone, l.dst);
}

export async function orgZone(db: DbOrTx, orgId: string): Promise<TZ> {
  const o = await getOrg(db, orgId);
  return zoneFor(o.timezone, o.observesDaylightSaving);
}

export async function confirmedCount(db: DbOrTx, sessionId: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(bookings).where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, "confirmed")));
  return r?.n ?? 0;
}

/** Spots currently held for waitlisted clients who chose "Ask me first". */
export async function heldOfferCount(db: DbOrTx, sessionId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.sessionId, sessionId), eq(waitlistEntries.status, "offered")));
  return r?.n ?? 0;
}

export async function bookedClientIds(db: DbOrTx, sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ id: bookings.clientId })
    .from(bookings)
    .where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, "confirmed")));
  return rows.map((r) => r.id);
}

export async function staffIds(db: DbOrTx, orgId: string, roles: ("owner" | "admin" | "instructor")[]): Promise<string[]> {
  const rows = await db
    .select({ id: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.active, true), inArray(memberships.role, roles)));
  return rows.map((r) => r.id);
}

export async function userName(db: DbOrTx, userId: string | null): Promise<string> {
  if (!userId) return "TBC";
  const [u] = await db.select({ f: users.firstName, l: users.lastName }).from(users).where(eq(users.id, userId));
  return u ? `${u.f} ${u.l}` : "TBC";
}

export async function assertMemberWithRole(db: DbOrTx, orgId: string, userId: string, roles: string[], what: string) {
  const [m] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId), eq(memberships.active, true)));
  if (!m || !roles.includes(m.role)) throw notFound(what);
}

const other = alias(classSessions, "other");
const otherType = alias(classTypes, "other_type");
const otherInstructor = alias(users, "other_instructor");

export interface Overlap {
  id: string;
  startsAt: Date;
  className: string;
  classTypeId: string;
  locationId: string;
  instructorId: string | null;
  instructorName: string | null;
  roomId: string | null;
}

/**
 * Classes that overlap a time slot and share its instructor or room. These are
 * reported to the user as warnings, never blocked: some studios deliberately
 * run concurrent group and private sessions.
 */
export async function findOverlaps(
  db: DbOrTx,
  orgId: string,
  slot: { instructorId?: string | null; roomId?: string | null; classTypeId?: string; locationId?: string; startsAt: Date; endsAt: Date; excludeIds?: string[] },
): Promise<Overlap[]> {
  const who = [];
  if (slot.instructorId) who.push(eq(other.instructorId, slot.instructorId));
  if (slot.roomId) who.push(eq(other.roomId, slot.roomId));
  // Same class, same place, same start: probably created twice by accident.
  if (slot.classTypeId && slot.locationId) {
    who.push(and(eq(other.classTypeId, slot.classTypeId), eq(other.locationId, slot.locationId), eq(other.startsAt, slot.startsAt)));
  }
  if (!who.length) return [];
  const rows = await db
    .select({
      id: other.id,
      startsAt: other.startsAt,
      className: otherType.name,
      classTypeId: other.classTypeId,
      locationId: other.locationId,
      instructorId: other.instructorId,
      first: otherInstructor.firstName,
      last: otherInstructor.lastName,
      roomId: other.roomId,
    })
    .from(other)
    .innerJoin(otherType, eq(otherType.id, other.classTypeId))
    .leftJoin(otherInstructor, eq(otherInstructor.id, other.instructorId))
    .where(
      and(
        eq(other.orgId, orgId),
        eq(other.status, "scheduled"),
        lt(other.startsAt, slot.endsAt),
        gt(other.endsAt, slot.startsAt),
        or(...who),
        slot.excludeIds?.length ? notInArray(other.id, slot.excludeIds) : undefined,
      ),
    )
    .limit(10);
  return rows.map(({ first, last, ...r }) => ({ ...r, instructorName: first ? `${first} ${last}` : null }));
}

/** How many people are booked into a class through ClassPass. */
export async function classpassBooked(db: DbOrTx, sessionId: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(bookings).where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, "confirmed"), eq(bookings.source, "classpass")));
  return Number(r?.n ?? 0);
}
