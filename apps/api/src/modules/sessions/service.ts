import { and, asc, count, eq, gte, inArray, lt } from "drizzle-orm";
import type { CreateSessionInput, EditScope, RefundMethod, SessionChanges } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import {
  bookings,
  refunds,
  classSeries,
  classSessions,
  classTemplates,
  classTypes,
  memberships,
  rooms,
  substituteRequests,
  waitlistEntries,
} from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import type { Flags } from "../../lib/flags.js";
import { addMinutes, daysBetween, localToUtc, minutesBetweenTimes, recurrenceDates, shiftDate, utcToLocal } from "../../lib/time.js";
import type { AuthContext } from "../../plugins/auth.js";
import { createBooking, refundNote } from "../bookings/service.js";
import {
  checkBulk,
  checkCancellation,
  checkCapacity,
  checkInstructor,
  checkInstructorListed,
  checkShortNotice,
  checkSlot,
  checkTiming,
  CLASH_CODES,
  usualDuration,
} from "../checks/session-checks.js";
import { notify } from "../notifications/outbox.js";
import { closeWaitlist, fillOpenSpots } from "../waitlist/engine.js";
import {
  assertMemberWithRole,
  bookedClientIds,
  classpassBooked,
  confirmedCount,
  describeSession,
  getOrg,
  getSession,
  locationZone,
  lockSession,
  orgZone,
  userName,
  type SessionRow,
} from "./context.js";

const TEACHER_ROLES = ["owner", "admin", "instructor"];
type Room = typeof rooms.$inferSelect;

// ---------------------------------------------------------------------------
// Validation shared by create / edit (only true impossibilities are refused)
// ---------------------------------------------------------------------------
async function assertClassType(db: DbOrTx, orgId: string, classTypeId: string) {
  const [c] = await db.select({ id: classTypes.id, kind: classTypes.kind, name: classTypes.name }).from(classTypes).where(and(eq(classTypes.id, classTypeId), eq(classTypes.orgId, orgId)));
  if (!c) throw notFound("class type");
  return c;
}

/** ClassPass settings that can work: on with a number of spots no bigger than the class, and never for appointments. */
function checkClasspassSettings(kind: string, enabled: boolean, spots: number | null, capacity: number) {
  if (!enabled) return;
  if (kind === "appointment") throw badRequest("classpass_appointment", "ClassPass is only for classes, not appointments.");
  if (!spots) throw badRequest("invalid_input", "Some details need fixing.", { fields: { classpassSpots: "Choose how many spots to open to ClassPass." } });
  if (spots > capacity) throw badRequest("invalid_input", "Some details need fixing.", { fields: { classpassSpots: `ClassPass can have at most all ${capacity} spots in the class.` } });
}

async function getRoom(db: DbOrTx, orgId: string, roomId: string, locationId: string): Promise<Room> {
  const [r] = await db.select().from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.orgId, orgId)));
  if (!r) throw notFound("room");
  if (r.locationId !== locationId) throw badRequest("room_wrong_location", "That room is at a different location.");
  return r;
}

/** Length from either an explicit duration or start + end times. */
function resolveDuration(input: { durationMinutes?: number; endTime?: string }, startTime: string | null, fallback?: number): number | undefined {
  if (input.endTime && input.durationMinutes) throw badRequest("invalid_input", "Give an end time or a length, not both.");
  if (input.endTime) {
    if (!startTime) throw badRequest("invalid_input", "Set a start time as well as an end time.");
    return minutesBetweenTimes(startTime, input.endTime);
  }
  return input.durationMinutes ?? fallback;
}

interface ResolvedFields {
  classTypeId: string;
  locationId: string;
  roomId: string | null;
  instructorId: string | null;
  durationMinutes: number;
  capacity: number;
  waitlistEnabled: boolean;
  waitlistCapacity: number | null;
  notes: string | null;
  templateId: string | null;
  startTime: string | null;
  room: Room | null;
  classpassEnabled: boolean;
  classpassSpots: number | null;
  /** Of the class type: "class" or "appointment". */
  kind: string;
}

type FieldInput = Omit<CreateSessionInput, "date" | "acknowledge">;

/** Fill in anything not given from the template, then check it all belongs to this studio. */
async function resolveFields(db: DbOrTx, orgId: string, input: FieldInput): Promise<ResolvedFields> {
  let t: typeof classTemplates.$inferSelect | undefined;
  if (input.templateId) {
    [t] = await db.select().from(classTemplates).where(and(eq(classTemplates.id, input.templateId), eq(classTemplates.orgId, orgId)));
    if (!t) throw notFound("template");
  }
  const startTime = input.startTime ?? t?.startTime?.slice(0, 5) ?? null;
  const typeId = input.classTypeId ?? t?.classTypeId ?? "";
  const type = typeId ? await assertClassType(db, orgId, typeId) : null;
  const isAppointment = type?.kind === "appointment";
  const clients = input.clientIds ?? [];
  if (clients.length && type && !isAppointment) throw badRequest("clients_only_for_appointments", "Clients can be added when creating an appointment. For a class, book them in from the class once it's created.");
  const f: ResolvedFields = {
    templateId: t?.id ?? null,
    classTypeId: input.classTypeId ?? t?.classTypeId ?? "",
    locationId: input.locationId ?? t?.locationId ?? "",
    roomId: input.roomId !== undefined ? input.roomId : (t?.roomId ?? null),
    instructorId: input.instructorId !== undefined ? input.instructorId : (t?.instructorId ?? null),
    durationMinutes: resolveDuration(input, startTime, t?.durationMinutes) ?? 0,
    // Appointments are usually for one person (or everyone added).
    capacity: input.capacity ?? t?.capacity ?? (isAppointment ? Math.max(1, clients.length) : 0),
    // Appointments have no waitlist: the studio books people in.
    waitlistEnabled: isAppointment ? false : (input.waitlistEnabled ?? t?.waitlistEnabled ?? true),
    waitlistCapacity: input.waitlistCapacity !== undefined ? input.waitlistCapacity : (t?.waitlistCapacity ?? null),
    notes: input.notes ?? null,
    startTime,
    room: null,
    classpassEnabled: input.classpassEnabled ?? t?.classpassEnabled ?? false,
    classpassSpots: input.classpassSpots !== undefined ? input.classpassSpots : (t?.classpassSpots ?? null),
    kind: type?.kind ?? "class",
  };
  if (isAppointment && t?.classpassEnabled && input.classpassEnabled === undefined) f.classpassEnabled = false;
  if (!f.classpassEnabled) f.classpassSpots = null;
  const missing: Record<string, string> = {};
  if (!f.classTypeId) missing.classTypeId = "Choose a class type.";
  if (!f.locationId) missing.locationId = "Choose a location.";
  if (!f.durationMinutes) missing.durationMinutes = "Set how long the class runs, or an end time.";
  if (!f.capacity) missing.capacity = "Set how many spots there are.";
  if (!f.startTime) missing.startTime = "Set a start time.";
  if (Object.keys(missing).length) throw badRequest("invalid_input", "Some details need fixing.", { fields: missing });

  if (clients.length > f.capacity) throw badRequest("invalid_input", "Some details need fixing.", { fields: { capacity: `You've added ${clients.length} clients, so it needs at least ${clients.length} spots.` } });
  checkClasspassSettings(f.kind, f.classpassEnabled, f.classpassSpots, f.capacity);
  await locationZone(db, orgId, f.locationId);
  if (f.roomId) f.room = await getRoom(db, orgId, f.roomId, f.locationId);
  if (f.instructorId) await assertMemberWithRole(db, orgId, f.instructorId, TEACHER_ROLES, "instructor");
  return f;
}

/** Every check that applies to a class at a given time. */
async function checkNewClass(db: DbOrTx, orgId: string, flags: Flags, f: ResolvedFields, startsAt: Date, now: Date, sessionId?: string) {
  const zone = await locationZone(db, orgId, f.locationId);
  const endsAt = addMinutes(startsAt, f.durationMinutes);
  await checkSlot(db, orgId, flags, zone, { sessionId, instructorId: f.instructorId, roomId: f.roomId, classTypeId: f.classTypeId, locationId: f.locationId, startsAt, endsAt });
  // A time that is itself probably wrong would produce misleading clashes, so hold those back until it's fixed.
  if (checkTiming(flags, zone, { sessionId, startsAt, durationMinutes: f.durationMinutes, ...(await usualDuration(db, f.classTypeId, f.templateId)), isNew: true, now })) flags.drop(CLASH_CODES, sessionId);
  checkCapacity(flags, { sessionId, capacity: f.capacity, room: f.room });
  checkInstructor(flags, { sessionId, instructorId: f.instructorId });
  await checkInstructorListed(db, flags, { sessionId, classTypeId: f.classTypeId, instructorId: f.instructorId });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export async function createSession(tx: DbOrTx, auth: AuthContext, input: CreateSessionInput, flags: Flags, now = new Date()): Promise<SessionRow> {
  const f = await resolveFields(tx, auth.orgId, input);
  const zone = await locationZone(tx, auth.orgId, f.locationId);
  const startsAt = localToUtc(input.date, f.startTime!, zone);
  const endsAt = addMinutes(startsAt, f.durationMinutes);
  await checkNewClass(tx, auth.orgId, flags, f, startsAt, now);

  const { startTime: _st, durationMinutes: _d, room: _r, kind: _k, ...cols } = f;
  const [s] = await tx.insert(classSessions).values({ orgId: auth.orgId, ...cols, startsAt, endsAt }).returning();
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "session.created", entityType: "session", entityId: s!.id });
  if (s!.instructorId && s!.instructorId !== auth.userId) {
    await notify(tx, { orgId: auth.orgId, userIds: [s!.instructorId], template: "instructor.assigned", data: await describeSession(tx, s!) });
  }
  if (f.kind === "appointment") await bookAppointmentClients(tx, auth, [s!], input.clientIds ?? [], flags, now);
  return s!;
}

// ---------------------------------------------------------------------------
// Recurring classes
// ---------------------------------------------------------------------------
type SeriesRow = typeof classSeries.$inferSelect;

export async function createSeries(
  tx: DbOrTx,
  auth: AuthContext,
  input: FieldInput & { daysOfWeek: number[]; everyNWeeks: number; startDate: string; endDate?: string; occurrences?: number; clientIds?: string[] },
  horizonDays: number,
  flags: Flags,
  now = new Date(),
) {
  const f = await resolveFields(tx, auth.orgId, input);
  const [series] = await tx
    .insert(classSeries)
    .values({
      orgId: auth.orgId,
      templateId: f.templateId,
      classTypeId: f.classTypeId,
      locationId: f.locationId,
      roomId: f.roomId,
      instructorId: f.instructorId,
      capacity: f.capacity,
      durationMinutes: f.durationMinutes,
      waitlistEnabled: f.waitlistEnabled,
      waitlistCapacity: f.waitlistCapacity,
      startTime: f.startTime!,
      daysOfWeek: [...new Set(input.daysOfWeek)].sort(),
      everyNWeeks: input.everyNWeeks,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      occurrences: input.occurrences ?? null,
      classpassEnabled: f.classpassEnabled,
      classpassSpots: f.classpassSpots,
      clientIds: f.kind === "appointment" ? (input.clientIds ?? []) : [],
      notes: f.notes,
      createdBy: auth.userId,
    })
    .returning();
  const zone = await locationZone(tx, auth.orgId, f.locationId);
  const through = shiftDate(utcToLocal(now, zone).date, horizonDays);
  const created = await generateSeriesSessions(tx, series!, through, flags, auth, now);
  if (created.length === 0) throw badRequest("no_dates", "Those settings don't produce any classes. Check the days and dates.");

  // Time, length and capacity are the same for every class, so check them once.
  if (checkTiming(flags, zone, { startsAt: created[0]!.startsAt, durationMinutes: f.durationMinutes, ...(await usualDuration(tx, f.classTypeId, f.templateId)), isNew: true, now })) flags.drop(CLASH_CODES);
  checkCapacity(flags, { capacity: f.capacity, room: f.room });
  checkInstructor(flags, { instructorId: f.instructorId });

  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "series.created", entityType: "series", entityId: series!.id, details: { sessions: created.length } });
  if (f.instructorId && f.instructorId !== auth.userId) {
    const info = await describeSession(tx, created[0]!);
    await notify(tx, { orgId: auth.orgId, userIds: [f.instructorId], template: "instructor.assigned", data: { ...info, className: `${info.className} – ${created.length} recurring classes, the first` } });
  }
  return { series: series!, sessions: created };
}

/**
 * Create the series' classes up to `throughDate`. Clashes are reported through
 * `flags` when a person is creating the series; when the worker tops up an
 * open-ended series, clashes still get created and show as warnings on the calendar.
 */
export async function generateSeriesSessions(tx: DbOrTx, series: SeriesRow, throughDate: string, flags?: Flags, auth?: AuthContext, now = new Date()): Promise<SessionRow[]> {
  if (series.endedAt) return [];
  const from = series.generatedThrough ? shiftDate(series.generatedThrough, 1) : series.startDate;
  if (from > throughDate) return [];
  const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(classSessions).where(eq(classSessions.seriesId, series.id));
  const dates = recurrenceDates(
    { daysOfWeek: series.daysOfWeek, everyNWeeks: series.everyNWeeks, startDate: series.startDate, endDate: series.endDate, occurrences: series.occurrences },
    from,
    throughDate,
    n,
  );
  const zone = await locationZone(tx, series.orgId, series.locationId);
  const rows = [];
  for (const date of dates) {
    const startsAt = localToUtc(date, series.startTime, zone);
    const endsAt = addMinutes(startsAt, series.durationMinutes);
    if (flags) {
      await checkSlot(tx, series.orgId, flags, zone, { instructorId: series.instructorId, roomId: series.roomId, classTypeId: series.classTypeId, locationId: series.locationId, startsAt, endsAt });
    }
    rows.push({
      orgId: series.orgId,
      seriesId: series.id,
      templateId: series.templateId,
      classTypeId: series.classTypeId,
      locationId: series.locationId,
      roomId: series.roomId,
      instructorId: series.instructorId,
      capacity: series.capacity,
      waitlistEnabled: series.waitlistEnabled,
      waitlistCapacity: series.waitlistCapacity,
      classpassEnabled: series.classpassEnabled,
      classpassSpots: series.classpassSpots,
      notes: series.notes,
      startsAt,
      endsAt,
    });
  }
  const created = rows.length ? await tx.insert(classSessions).values(rows).returning() : [];
  await tx.update(classSeries).set({ generatedThrough: throughDate }).where(eq(classSeries.id, series.id));
  // Repeating appointments: the same clients are booked into each new one.
  const [type] = await tx.select({ kind: classTypes.kind }).from(classTypes).where(eq(classTypes.id, series.classTypeId));
  if (created.length && type?.kind === "appointment") {
    if (auth) await bookAppointmentClients(tx, auth, created, series.clientIds, flags!, now, true);
    else if (series.clientIds.length) await bookSeriesClientsInBackground(tx, series, created, now);
  }
  return created;
}

// ---------------------------------------------------------------------------
// Appointments: booking the client in as it's created
// ---------------------------------------------------------------------------
/**
 * Book the chosen clients into new appointments, with the usual checks (packages, clashes,
 * weekly limit). With no client, ask first: appointments are usually only booked once confirmed.
 * Repeats send one confirmation for the first appointment rather than one per date.
 */
async function bookAppointmentClients(tx: DbOrTx, auth: AuthContext, sessions: SessionRow[], clientIds: string[], flags: Flags, now: Date, repeating = false) {
  if (!clientIds.length) {
    flags.confirm({
      code: "appointment_no_client",
      message: `No client has been added${repeating ? " to these appointments" : ""}. Appointments are usually booked once a client has confirmed. Save ${repeating ? "them" : "it"} as an open slot anyway? You can book someone in later.`,
    });
    return;
  }
  for (const [i, s] of sessions.entries()) {
    for (const clientId of clientIds) {
      await createBooking(tx, auth, { sessionId: s.id, clientId, notifyClient: i === 0 }, flags, now, { silent: i > 0 });
    }
  }
}

/** The worker topping up a repeating appointment: book its clients in quietly, skipping any that can't be. */
async function bookSeriesClientsInBackground(tx: DbOrTx, series: SeriesRow, sessions: SessionRow[], now: Date) {
  const actor = series.createdBy ?? (await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, series.orgId), eq(memberships.role, "owner"))).limit(1))[0]?.id;
  if (!actor) return;
  const auth: AuthContext = { orgId: series.orgId, userId: actor, role: "owner" };
  for (const s of sessions) {
    for (const clientId of series.clientIds) {
      try {
        await tx.transaction((sp) => createBooking(sp, auth, { sessionId: s.id, clientId, notifyClient: false }, undefined, now, { silent: true }));
      } catch {
        // e.g. they're no longer a client: the appointment stays, open for staff to fill.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Edit (one, series scope, or bulk)
// ---------------------------------------------------------------------------
async function applyChanges(
  tx: DbOrTx,
  auth: AuthContext,
  current: SessionRow,
  changes: SessionChanges,
  opts: { notifyClients: boolean; detach: boolean; now: Date; flags: Flags; asCover?: boolean },
): Promise<SessionRow> {
  if (current.status !== "scheduled") throw conflict("class_cancelled", "Cancelled classes can't be edited.");
  const { flags, now } = opts;
  const s = await lockSession(tx, auth.orgId, current.id);
  const zone = await locationZone(tx, auth.orgId, s.locationId);
  const local = utcToLocal(s.startsAt, zone);
  const currentDuration = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000);
  const duration = resolveDuration(changes, changes.startTime ?? local.time, currentDuration)!;
  const startsAt = changes.date || changes.startTime ? localToUtc(changes.date ?? local.date, changes.startTime ?? local.time, zone) : s.startsAt;
  const endsAt = addMinutes(startsAt, duration);
  const timeChanged = startsAt.getTime() !== s.startsAt.getTime() || endsAt.getTime() !== s.endsAt.getTime();
  const instructorId = changes.instructorId !== undefined ? changes.instructorId : s.instructorId;
  const roomId = changes.roomId !== undefined ? changes.roomId : s.roomId;
  const capacity = changes.capacity ?? s.capacity;
  const classTypeId = changes.classTypeId ?? s.classTypeId;
  const waitlistEnabled = changes.waitlistEnabled ?? s.waitlistEnabled;

  // Hard stops: things that can't work, rather than things that look unusual.
  if (timeChanged && s.startsAt <= now) throw conflict("class_started", "Classes that have started can't be moved.");
  if (changes.classTypeId) await assertClassType(tx, auth.orgId, changes.classTypeId);
  if (changes.instructorId) await assertMemberWithRole(tx, auth.orgId, changes.instructorId, TEACHER_ROLES, "instructor");
  const room = roomId ? await getRoom(tx, auth.orgId, roomId, s.locationId) : null;
  const booked = await confirmedCount(tx, s.id);
  if (capacity < booked) {
    throw conflict("below_booked", `${booked} people are already booked, so spots can't go below ${booked}. Move or cancel some bookings first.`);
  }

  // Warnings.
  const ref = { sessionId: s.id };
  if (timeChanged || instructorId !== s.instructorId || roomId !== s.roomId || classTypeId !== s.classTypeId) {
    await checkSlot(tx, auth.orgId, flags, zone, { ...ref, instructorId, roomId, classTypeId, locationId: s.locationId, startsAt, endsAt, excludeIds: [s.id] });
  }
  if (timeChanged) {
    if (checkTiming(flags, zone, { ...ref, startsAt, durationMinutes: duration, ...(await usualDuration(tx, classTypeId, s.templateId)), isNew: false, now })) flags.drop(CLASH_CODES, s.id);
    if (booked > 0) {
      flags.confirm({ code: "clients_affected", ...ref, message: `${booked} booked ${booked === 1 ? "client" : "clients"} will ${opts.notifyClients ? "be told about" : "NOT be told about"} the new time.` });
    }
    checkShortNotice(flags, { ...ref, startsAt: s.startsAt, now, what: "Clients may already have planned around the current time.", severity: "confirm" });
  }
  // Cover: remember who usually teaches, so the calendar can show "covering for…".
  let coverFor = s.coverForInstructorId;
  if (opts.asCover && !instructorId) throw badRequest("cover_needs_instructor", "Choose who is covering this class.");
  if (instructorId !== s.instructorId) {
    checkShortNotice(flags, { ...ref, startsAt: s.startsAt, now, what: "Make sure the new instructor knows.", severity: "info" });
    if (!instructorId) checkInstructor(flags, { ...ref, instructorId });
    await checkInstructorListed(tx, flags, { ...ref, classTypeId, instructorId });
    coverFor = opts.asCover ? (s.coverForInstructorId ?? s.instructorId) : null;
    if (instructorId === s.coverForInstructorId) coverFor = null; // back with the usual instructor
  }
  if (changes.capacity !== undefined || changes.roomId !== undefined) checkCapacity(flags, { ...ref, capacity, room });

  // ClassPass: on with a sensible number of spots; warn if fewer than already booked through ClassPass.
  const classpassEnabled = changes.classpassEnabled ?? s.classpassEnabled;
  const classpassSpots = !classpassEnabled ? null : changes.classpassSpots !== undefined ? changes.classpassSpots : s.classpassSpots;
  const type = await assertClassType(tx, auth.orgId, classTypeId);
  checkClasspassSettings(type.kind, classpassEnabled, classpassSpots, capacity);
  if (classpassEnabled !== s.classpassEnabled || classpassSpots !== s.classpassSpots) {
    const cp = await classpassBooked(tx, s.id);
    if (cp > (classpassSpots ?? 0)) {
      flags.confirm({ code: "classpass_reduced", ...ref, message: `${cp} ${cp === 1 ? "person has" : "people have"} already booked through ClassPass. They keep their ${cp === 1 ? "spot" : "spots"}; ClassPass just can't take any more.` });
    }
  }

  let waitlistClosed: string[] = [];
  if (!waitlistEnabled && s.waitlistEnabled) {
    waitlistClosed = await closeWaitlist(tx, s.id);
    if (waitlistClosed.length) {
      flags.confirm({ code: "waitlist_affected", ...ref, message: `${waitlistClosed.length} ${waitlistClosed.length === 1 ? "person is" : "people are"} on the waitlist and will be taken off it.` });
    }
  }

  const [updated] = await tx
    .update(classSessions)
    .set({
      classTypeId,
      instructorId,
      coverForInstructorId: coverFor,
      roomId,
      capacity,
      startsAt,
      endsAt,
      waitlistEnabled,
      waitlistCapacity: changes.waitlistCapacity !== undefined ? changes.waitlistCapacity : s.waitlistCapacity,
      notes: changes.notes !== undefined ? changes.notes : s.notes,
      classpassEnabled,
      classpassSpots,
      detachedFromSeries: s.detachedFromSeries || (opts.detach && !!s.seriesId),
    })
    .where(eq(classSessions.id, s.id))
    .returning();
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "session.updated", entityType: "session", entityId: s.id, details: { changes } });

  // --- Tell the people affected ------------------------------------------
  const info = await describeSession(tx, updated!);
  const clients = await bookedClientIds(tx, s.id);
  if (timeChanged) {
    await notify(tx, {
      orgId: auth.orgId,
      userIds: [updated!.instructorId, ...(opts.notifyClients ? clients : [])],
      template: "session.rescheduled",
      data: { ...info, oldLocalDate: local.date, oldLocalTime: local.time },
    });
  }
  if (instructorId !== s.instructorId) {
    await notifyInstructorChange(tx, auth.orgId, updated!, s.instructorId, { notifyClients: opts.notifyClients, actorId: auth.userId });
  }
  if (waitlistClosed.length) await notify(tx, { orgId: auth.orgId, userIds: waitlistClosed, template: "waitlist.closed", data: info });
  if (capacity > s.capacity || (updated!.waitlistEnabled && !s.waitlistEnabled)) await fillOpenSpots(tx, auth.orgId, s.id, now);
  return updated!;
}

/** Personnel change: old instructor told they're off, new one told they're on, clients told if the studio wants. */
export async function notifyInstructorChange(
  tx: DbOrTx,
  orgId: string,
  session: SessionRow,
  previousInstructorId: string | null,
  opts: { notifyClients: boolean; actorId: string },
) {
  const info = await describeSession(tx, session);
  if (previousInstructorId) await notify(tx, { orgId, userIds: [previousInstructorId], template: "instructor.removed", data: info });
  if (session.instructorId && session.instructorId !== opts.actorId) {
    await notify(tx, { orgId, userIds: [session.instructorId], template: "instructor.assigned", data: info });
  }
  const org = await getOrg(tx, orgId);
  if (opts.notifyClients && org.notifyClientsOnInstructorChange && session.instructorId) {
    await notify(tx, {
      orgId,
      userIds: await bookedClientIds(tx, session.id),
      template: "instructor.changed_for_client",
      data: { ...info, instructorName: await userName(tx, session.instructorId) },
    });
  }
}

/** Upcoming, not-individually-edited classes in the same series. */
async function seriesSiblings(tx: DbOrTx, s: SessionRow, scope: Exclude<EditScope, "this">, now: Date) {
  return tx
    .select()
    .from(classSessions)
    .where(
      and(
        eq(classSessions.seriesId, s.seriesId!),
        eq(classSessions.status, "scheduled"),
        gte(classSessions.startsAt, scope === "following" ? s.startsAt : now),
        eq(classSessions.detachedFromSeries, false),
      ),
    )
    .orderBy(asc(classSessions.startsAt));
}

export async function updateSession(
  tx: DbOrTx,
  auth: AuthContext,
  sessionId: string,
  input: { changes: SessionChanges; scope: EditScope; notifyClients: boolean; asCover?: boolean },
  flags: Flags,
  now = new Date(),
) {
  const s = await getSession(tx, auth.orgId, sessionId);
  if (input.scope === "this" || !s.seriesId) {
    return { updated: [await applyChanges(tx, auth, s, input.changes, { notifyClients: input.notifyClients, detach: true, now, flags, asCover: input.asCover })] };
  }
  if (input.asCover) throw badRequest("cover_one_class", "Cover is set one class at a time. Choose “This class only”, or select the classes and use bulk edit.");
  if (input.changes.date) throw badRequest("date_in_series", "To move a whole series to another day, change its days instead. Dates can only be changed one class at a time.");

  let seriesId = s.seriesId;
  if (input.scope === "following") seriesId = await splitSeries(tx, s);
  const zone = await locationZone(tx, auth.orgId, s.locationId);
  const newDuration = resolveDuration(input.changes, input.changes.startTime ?? utcToLocal(s.startsAt, zone).time);
  await tx
    .update(classSeries)
    .set({
      ...(input.changes.startTime && { startTime: input.changes.startTime }),
      ...(newDuration && { durationMinutes: newDuration }),
      ...(input.changes.instructorId !== undefined && { instructorId: input.changes.instructorId }),
      ...(input.changes.roomId !== undefined && { roomId: input.changes.roomId }),
      ...(input.changes.capacity && { capacity: input.changes.capacity }),
      ...(input.changes.classTypeId && { classTypeId: input.changes.classTypeId }),
      ...(input.changes.waitlistEnabled !== undefined && { waitlistEnabled: input.changes.waitlistEnabled }),
      ...(input.changes.waitlistCapacity !== undefined && { waitlistCapacity: input.changes.waitlistCapacity }),
      ...(input.changes.classpassEnabled !== undefined && { classpassEnabled: input.changes.classpassEnabled, ...(!input.changes.classpassEnabled && { classpassSpots: null }) }),
      ...(input.changes.classpassSpots !== undefined && { classpassSpots: input.changes.classpassSpots }),
      ...(input.changes.notes !== undefined && { notes: input.changes.notes }),
    })
    .where(eq(classSeries.id, seriesId));

  const targets = await seriesSiblings(tx, { ...s, seriesId }, input.scope, now);
  checkBulk(flags, targets.length, "change");
  const updated = [];
  for (const t of targets) updated.push(await applyChanges(tx, auth, t, input.changes, { notifyClients: input.notifyClients, detach: false, now, flags }));
  return { updated };
}

/** "This and later classes": end the old series the day before and move later classes to a new series. */
async function splitSeries(tx: DbOrTx, s: SessionRow): Promise<string> {
  const [old] = await tx.select().from(classSeries).where(eq(classSeries.id, s.seriesId!));
  if (!old) throw notFound("series");
  const zone = await locationZone(tx, s.orgId, s.locationId);
  const splitDate = utcToLocal(s.startsAt, zone).date;
  if (splitDate <= old.startDate) return old.id; // editing from the first class = whole series

  const [{ before } = { before: 0 }] = await tx
    .select({ before: count() })
    .from(classSessions)
    .where(and(eq(classSessions.seriesId, old.id), lt(classSessions.startsAt, s.startsAt)));
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = old;
  const [next] = await tx
    .insert(classSeries)
    .values({ ...rest, startDate: splitDate, occurrences: old.occurrences != null ? old.occurrences - before : null })
    .returning();
  await tx.update(classSeries).set({ endDate: shiftDate(splitDate, -1), generatedThrough: shiftDate(splitDate, -1) }).where(eq(classSeries.id, old.id));
  await tx.update(classSessions).set({ seriesId: next!.id }).where(and(eq(classSessions.seriesId, old.id), gte(classSessions.startsAt, s.startsAt)));
  return next!.id;
}

export async function bulkUpdateSessions(
  tx: DbOrTx,
  auth: AuthContext,
  input: { sessionIds: string[]; changes: SessionChanges; notifyClients: boolean; asCover?: boolean },
  flags: Flags,
  now = new Date(),
) {
  const sessions = await tx
    .select()
    .from(classSessions)
    .where(and(eq(classSessions.orgId, auth.orgId), inArray(classSessions.id, input.sessionIds)))
    .orderBy(asc(classSessions.startsAt));
  if (sessions.length !== new Set(input.sessionIds).size) throw notFound("class");
  checkBulk(flags, sessions.length, "change");
  const updated = [];
  for (const s of sessions) updated.push(await applyChanges(tx, auth, s, input.changes, { notifyClients: input.notifyClients, detach: true, now, flags, asCover: input.asCover }));
  return { updated };
}

// ---------------------------------------------------------------------------
// Cancel / delete
// ---------------------------------------------------------------------------
type CancelOpts = { reason?: string; refund: RefundMethod; notifyClients: boolean };

async function cancelOne(tx: DbOrTx, auth: AuthContext, s: SessionRow, opts: CancelOpts, flags: Flags, now: Date) {
  await lockSession(tx, auth.orgId, s.id);
  if (s.status === "cancelled") return s;
  const [{ waiting } = { waiting: 0 }] = await tx
    .select({ waiting: count() })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.sessionId, s.id), inArray(waitlistEntries.status, ["waiting", "offered"])));
  checkCancellation(flags, { sessionId: s.id, booked: await confirmedCount(tx, s.id), waitlisted: waiting, refund: opts.refund, startsAt: s.startsAt, endsAt: s.endsAt, now });

  const [updated] = await tx
    .update(classSessions)
    .set({ status: "cancelled", cancelledAt: now, cancelReason: opts.reason ?? null })
    .where(eq(classSessions.id, s.id))
    .returning();
  const cancelled = await tx
    .update(bookings)
    .set({ status: "cancelled", cancelledAt: now })
    .where(and(eq(bookings.sessionId, s.id), eq(bookings.status, "confirmed")))
    .returning();
  if (opts.refund !== "none" && cancelled.length) {
    await tx.insert(refunds).values(
      cancelled.map((b) => ({ orgId: auth.orgId, bookingId: b.id, method: opts.refund, reason: opts.reason ?? "Class cancelled", createdBy: auth.userId })),
    );
  }
  const waitlisted = await closeWaitlist(tx, s.id);
  await tx
    .update(substituteRequests)
    .set({ status: "cancelled", resolvedAt: now })
    .where(and(eq(substituteRequests.sessionId, s.id), inArray(substituteRequests.status, ["open", "awaiting_approval"])));

  const info = { ...(await describeSession(tx, s)), reason: opts.reason };
  await notify(tx, { orgId: auth.orgId, userIds: [s.instructorId], template: "session.cancelled", data: info });
  if (opts.notifyClients) {
    await notify(tx, { orgId: auth.orgId, userIds: cancelled.map((b) => b.clientId), template: "session.cancelled", data: { ...info, refundNote: refundNote(opts.refund) } });
    await notify(tx, { orgId: auth.orgId, userIds: waitlisted, template: "session.cancelled", data: info });
  }
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "session.cancelled", entityType: "session", entityId: s.id, details: { reason: opts.reason, refund: opts.refund, bookings: cancelled.length } });
  return updated!;
}

export async function cancelSession(tx: DbOrTx, auth: AuthContext, sessionId: string, input: CancelOpts & { scope: EditScope }, flags: Flags, now = new Date()) {
  const s = await getSession(tx, auth.orgId, sessionId);
  if (input.scope === "this" || !s.seriesId) return { cancelled: [await cancelOne(tx, auth, s, input, flags, now)] };

  // Stop the series producing more classes, then cancel the upcoming ones.
  const zone = await locationZone(tx, auth.orgId, s.locationId);
  if (input.scope === "all") {
    await tx.update(classSeries).set({ endedAt: now }).where(eq(classSeries.id, s.seriesId));
  } else {
    const lastDay = shiftDate(utcToLocal(s.startsAt, zone).date, -1);
    await tx.update(classSeries).set({ endDate: lastDay, generatedThrough: lastDay }).where(eq(classSeries.id, s.seriesId));
  }
  const targets = await tx
    .select()
    .from(classSessions)
    .where(and(eq(classSessions.seriesId, s.seriesId), eq(classSessions.status, "scheduled"), gte(classSessions.startsAt, input.scope === "following" ? s.startsAt : now)));
  checkBulk(flags, targets.length, "cancel");
  const cancelled = [];
  for (const t of targets) cancelled.push(await cancelOne(tx, auth, t, input, flags, now));
  return { cancelled };
}

export async function bulkCancelSessions(tx: DbOrTx, auth: AuthContext, input: CancelOpts & { sessionIds: string[] }, flags: Flags, now = new Date()) {
  const sessions = await tx.select().from(classSessions).where(and(eq(classSessions.orgId, auth.orgId), inArray(classSessions.id, input.sessionIds)));
  if (sessions.length !== new Set(input.sessionIds).size) throw notFound("class");
  checkBulk(flags, sessions.length, "cancel");
  const cancelled = [];
  for (const s of sessions) cancelled.push(await cancelOne(tx, auth, s, input, flags, now));
  return { cancelled };
}

/**
 * Delete: a class nobody ever booked or waitlisted is removed completely.
 * Otherwise it's cancelled instead, so refunds, history and reports stay correct.
 */
export async function deleteSession(tx: DbOrTx, auth: AuthContext, sessionId: string, input: CancelOpts & { scope: EditScope }, flags: Flags, now = new Date()) {
  const s = await lockSession(tx, auth.orgId, sessionId);
  if (input.scope === "this") {
    const has = async (table: typeof bookings | typeof waitlistEntries | typeof substituteRequests) =>
      (await tx.select({ id: table.id }).from(table).where(eq(table.sessionId, s.id)).limit(1)).length > 0;
    const hasHistory = (await has(bookings)) || (await has(waitlistEntries)) || (await has(substituteRequests));
    if (!hasHistory) {
      const info = await describeSession(tx, s);
      await tx.delete(classSessions).where(eq(classSessions.id, s.id));
      if (s.status === "scheduled") await notify(tx, { orgId: auth.orgId, userIds: [s.instructorId], template: "session.cancelled", data: { ...info, reason: input.reason } });
      await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "session.deleted", entityType: "session", entityId: s.id });
      return { deleted: [s.id], cancelled: [] };
    }
  }
  const { cancelled } = await cancelSession(tx, auth, sessionId, input, flags, now);
  return { deleted: [], cancelled };
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------
async function copyTo(tx: DbOrTx, auth: AuthContext, s: SessionRow, date: string, flags: Flags, now: Date): Promise<SessionRow> {
  const zone = await locationZone(tx, auth.orgId, s.locationId);
  const time = utcToLocal(s.startsAt, zone).time;
  const duration = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000);
  const startsAt = localToUtc(date, time, zone);
  const endsAt = addMinutes(startsAt, duration);
  await checkSlot(tx, auth.orgId, flags, zone, { instructorId: s.instructorId, roomId: s.roomId, classTypeId: s.classTypeId, locationId: s.locationId, startsAt, endsAt });
  if (startsAt < now) flags.confirm({ code: "in_the_past", message: `${date} is in the past.`, details: { date } });
  const [c] = await tx
    .insert(classSessions)
    .values({
      orgId: auth.orgId,
      templateId: s.templateId,
      classTypeId: s.classTypeId,
      locationId: s.locationId,
      roomId: s.roomId,
      instructorId: s.instructorId,
      capacity: s.capacity,
      waitlistEnabled: s.waitlistEnabled,
      waitlistCapacity: s.waitlistCapacity,
      notes: s.notes,
      classpassEnabled: s.classpassEnabled,
      classpassSpots: s.classpassSpots,
      startsAt,
      endsAt,
    })
    .returning();
  return c!;
}

/** Copy one class onto other dates at the same local time. */
export async function duplicateSession(tx: DbOrTx, auth: AuthContext, sessionId: string, dates: string[], flags: Flags, now = new Date()) {
  const s = await getSession(tx, auth.orgId, sessionId);
  const created = [];
  for (const d of [...new Set(dates)]) created.push(await copyTo(tx, auth, s, d, flags, now));
  checkBulk(flags, created.length, "create");
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "session.duplicated", entityType: "session", entityId: s.id, details: { created: created.length } });
  return { created };
}

/** Copy a whole block of the schedule (e.g. "copy this week to next week"). */
export async function duplicateRange(
  tx: DbOrTx,
  auth: AuthContext,
  input: { fromDate: string; toDate: string; targetStartDate: string; locationId?: string },
  flags: Flags,
  now = new Date(),
) {
  if (input.toDate < input.fromDate) throw badRequest("bad_range", "The end date must be after the start date.");
  if (daysBetween(input.fromDate, input.toDate) > 62) throw badRequest("range_too_long", "Copy up to two months at a time.");
  const zone = await orgZone(tx, auth.orgId);
  const from = localToUtc(input.fromDate, "00:00", zone);
  const to = localToUtc(shiftDate(input.toDate, 1), "00:00", zone);
  const sessions = await tx
    .select()
    .from(classSessions)
    .where(
      and(
        eq(classSessions.orgId, auth.orgId),
        eq(classSessions.status, "scheduled"),
        gte(classSessions.startsAt, from),
        lt(classSessions.startsAt, to),
        input.locationId ? eq(classSessions.locationId, input.locationId) : undefined,
      ),
    )
    .orderBy(asc(classSessions.startsAt));
  const shift = daysBetween(input.fromDate, input.targetStartDate);
  const created = [];
  for (const s of sessions) {
    const locZone = await locationZone(tx, auth.orgId, s.locationId);
    created.push(await copyTo(tx, auth, s, shiftDate(utcToLocal(s.startsAt, locZone).date, shift), flags, now));
  }
  checkBulk(flags, created.length, "create");
  return { created };
}

