import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { can, schemas } from "@studio/shared";
import { z } from "zod";
import { bookings, classSessions, classTypes, memberships, substituteRequests, users, waitlistEntries } from "../../db/schema.js";
import { spotLabels } from "../bookings/spots.js";
import { attendedCounts, instructorHistory, publicName, tagsFor } from "./people.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { canSeeRequest } from "../substitutes/service.js";
import { classpassView, getCalendar } from "./calendar.js";
import { classpassBooked, confirmedCount, describeSession, getOrg, getSession } from "./context.js";
import { waiverStatuses } from "../clients/waivers.js";
import { activeHealthNotes } from "../clients/health.js";

/** Pinned tags shown under a client's name; the rest are counted as "+N" and listed under More. */
const MAX_UP_FRONT_TAGS = 2;
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });

export async function sessionRoutes(app: FastifyInstance) {
  app.get("/calendar", async (req) => getCalendar(app.db, req.auth, parse(schemas.calendarQuery, req.query)));

  /** Who may open this class: everyone except instructors looking at other people's classes they weren't asked to cover. */
  async function visibleSession(auth: { role: string; userId: string; orgId: string }, id: string) {
    const s = await getSession(app.db, auth.orgId, id);
    const ownClass = auth.role === "instructor" && s.instructorId === auth.userId;
    // Appointments are private: a client only sees one they're booked into.
    if (auth.role === "client") {
      const [type] = await app.db.select({ kind: classTypes.kind }).from(classTypes).where(eq(classTypes.id, s.classTypeId));
      if (type?.kind === "appointment") {
        const [mine] = await app.db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.sessionId, s.id), eq(bookings.clientId, auth.userId), eq(bookings.status, "confirmed")));
        if (!mine) throw notFound("class");
      }
    }
    if (auth.role === "instructor" && !ownClass) {
      const requests = await app.db
        .select()
        .from(substituteRequests)
        .where(and(eq(substituteRequests.sessionId, s.id), inArray(substituteRequests.status, ["open", "awaiting_approval"])));
      if (!requests.some((r) => canSeeRequest(r, auth.userId))) throw notFound("class");
    }
    return { s, ownClass };
  }

  /**
   * Class detail. What's included depends on who's asking:
   *  - Admin and Front of House: the full client list with contact details, photo, spot, tags,
   *    classes attended, waiver status and health notes.
   *  - Instructor: the same for their own classes; a class they've been asked to cover shows no client list.
   *  - Client: class details plus their own booking or waitlist place (who else is coming is under /attendees).
   *
   * Each client row has `upFront`: the few things worth seeing at a glance, most important first
   * (no waiver, health notes, first class, pinned tags). Everything else is for the expandable "More".
   */
  app.get("/sessions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { role, userId, orgId } = req.auth;
    const { s, ownClass } = await visibleSession(req.auth, id);
    const info = await describeSession(app.db, s);
    const isClient = role === "client";
    const fullRoster = can(role, "viewAllRosters") || ownClass;
    const contacts = can(role, "viewClientContacts") || ownClass;
    const labels = await spotLabels(app.db, s);
    const org = await getOrg(app.db, orgId);

    const rows = isClient || fullRoster
      ? await app.db
          .select({
            id: bookings.id, clientId: bookings.clientId, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone,
            photoUrl: users.photoUrl, source: memberships.source, spot: bookings.spot, status: bookings.status, attendance: bookings.attendance, bookedVia: bookings.source,
          })
          .from(bookings)
          .innerJoin(users, eq(users.id, bookings.clientId))
          .leftJoin(memberships, and(eq(memberships.userId, bookings.clientId), eq(memberships.orgId, orgId)))
          .where(and(eq(bookings.sessionId, s.id), fullRoster ? undefined : eq(bookings.clientId, userId)))
          .orderBy(asc(bookings.spot), asc(users.firstName))
      : [];
    const ids = rows.map((r) => r.clientId);
    // Extra client details are only loaded for staff who can see the whole list (the helpers skip empty lists).
    const staffIds = fullRoster ? ids : [];
    const [attended, tags, history, waivers, health] = await Promise.all([
      attendedCounts(app.db, orgId, staffIds),
      tagsFor(app.db, orgId, staffIds),
      instructorHistory(app.db, orgId, staffIds),
      waiverStatuses(app.db, org, staffIds),
      activeHealthNotes(app.db, orgId, staffIds),
    ]);
    // Anyone shown without a waiver gets a "Mark waiver done" button for staff (studio members can't be booked without one).
    const canMarkWaiver = can(role, "confirmWaivers");
    const person = async (uid: string | null) => {
      if (!uid) return null;
      const [u] = await app.db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, photoUrl: users.photoUrl }).from(users).where(eq(users.id, uid));
      return u ? { id: u.id, name: `${u.firstName} ${u.lastName}`, photoUrl: u.photoUrl } : null;
    };
    const waitlist = isClient || fullRoster
      ? await app.db
          .select({ id: waitlistEntries.id, clientId: waitlistEntries.clientId, firstName: users.firstName, lastName: users.lastName, mode: waitlistEntries.mode, status: waitlistEntries.status, expiresAt: waitlistEntries.expiresAt, offerExpiresAt: waitlistEntries.offerExpiresAt })
          .from(waitlistEntries)
          .innerJoin(users, eq(users.id, waitlistEntries.clientId))
          .where(and(eq(waitlistEntries.sessionId, s.id), inArray(waitlistEntries.status, ["waiting", "offered"]), fullRoster ? undefined : eq(waitlistEntries.clientId, userId)))
          .orderBy(asc(waitlistEntries.createdAt))
      : [];

    const { classpassEnabled: _cpe, classpassSpots: _cps, ...session } = s;
    const [type] = await app.db.select({ kind: classTypes.kind }).from(classTypes).where(eq(classTypes.id, s.classTypeId));
    const confirmed = rows.filter((r) => r.status === "confirmed");
    return {
      ...session,
      ...info,
      isAppointment: type?.kind === "appointment",
      notes: isClient ? undefined : s.notes,
      ...(isClient
        ? {}
        : { classpass: classpassView({ ...s, classpassTaken: await classpassBooked(app.db, s.id), booked: fullRoster ? confirmed.length : await confirmedCount(app.db, s.id) }) }),
      spotSelection: !!labels,
      waiverRequired: org.waiverRequired,
      instructor: await person(s.instructorId),
      cover: s.coverForInstructorId ? { forInstructor: await person(s.coverForInstructorId) } : null,
      booked: fullRoster ? rows.filter((r) => r.status === "confirmed").length : undefined,
      roster: rows.map(({ email, phone, spot, ...r }) => {
        const n = attended.get(r.clientId) ?? 0;
        const clientTags: { id: string; name: string; color: string; pinned: boolean }[] = tags.get(r.clientId) ?? [];
        const waiver = waivers.get(r.clientId);
        const notes = health.get(r.clientId) ?? [];
        const pinned = clientTags.filter((t) => t.pinned);
        return {
          ...r,
          // No spot selection (room or studio setting): spot details are left out entirely.
          ...(labels ? { spot, spotLabel: spot ? labels[spot - 1] : null } : {}),
          ...(contacts ? { email, phone } : {}),
          ...(fullRoster
            ? {
                upFront: [
                  ...(waiver?.status === "missing" ? [{ kind: "waiver_missing", text: "No waiver" }] : []),
                  ...notes.map((h) => ({ kind: "health", text: h.label })),
                  ...(n === 0 ? [{ kind: "first_class", text: "First class" }] : []),
                  ...pinned.slice(0, MAX_UP_FRONT_TAGS).map((t) => ({ kind: "tag", text: t.name, color: t.color })),
                ],
                moreTags: Math.max(0, pinned.length - MAX_UP_FRONT_TAGS) + clientTags.filter((t) => !t.pinned).length,
                waiver: waiver
                  ? { ...waiver, canMarkDone: waiver.status === "missing" && canMarkWaiver, canUndo: waiver.status === "complete" && can(role, "reverseWaivers") }
                  : null,
                healthNotes: notes,
                attendedCount: n,
                firstVisit: n === 0,
                tags: clientTags,
                packageName: null /* filled in by the payments module */,
                // For the instructor: how often this client comes to their classes, and whether they're the favourite.
                classesWithInstructor: s.instructorId ? (history.withInstructor.get(r.clientId)?.get(s.instructorId) ?? 0) : 0,
                favouriteInstructor: !!s.instructorId && history.favourite.get(r.clientId)?.instructorId === s.instructorId,
              }
            : {}),
        };
      }),
      waitlist: waitlist.map((w, i) => ({ ...w, position: i + 1 })),
    };
  });

  /**
   * Who's coming, for the spot-selection screen. Studio members (not ClassPass) see other
   * members' first name, initial and photo, unless that person has chosen to stay hidden.
   * Staff see full names.
   */
  app.get("/sessions/:id/attendees", async (req) => {
    const { id } = parse(idParam, req.params);
    const { role, userId, orgId } = req.auth;
    const { s, ownClass } = await visibleSession(req.auth, id);
    const staffView = can(role, "viewAllRosters") || ownClass;
    if (role === "instructor" && !ownClass) throw notFound("class");
    let viewerIsMember = staffView;
    if (role === "client") {
      const [m] = await app.db.select({ source: memberships.source }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
      viewerIsMember = m?.source === "direct";
    }
    const labels = await spotLabels(app.db, s);
    const rows = await app.db
      .select({ clientId: bookings.clientId, spot: bookings.spot, firstName: users.firstName, lastName: users.lastName, photoUrl: users.photoUrl, source: memberships.source, visible: memberships.showInAttendeeList })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.clientId))
      .leftJoin(memberships, and(eq(memberships.userId, bookings.clientId), eq(memberships.orgId, orgId)))
      .where(and(eq(bookings.sessionId, s.id), eq(bookings.status, "confirmed")));

    const person = (r: (typeof rows)[number]) => {
      if (r.clientId === userId) return { you: true, name: "You", photoUrl: r.photoUrl };
      if (staffView) return { name: `${r.firstName} ${r.lastName}`, photoUrl: r.photoUrl };
      if (viewerIsMember && r.source === "direct" && r.visible) return { name: publicName(r.firstName, r.lastName), photoUrl: r.photoUrl };
      return null; // shown as "Taken" / counted, without a name
    };
    const bySpot = new Map(rows.filter((r) => r.spot).map((r) => [r.spot!, r]));
    return {
      spotSelection: !!labels,
      namesShown: viewerIsMember,
      ...(viewerIsMember ? {} : { namesHiddenReason: "Who's attending is only shown to studio members." }),
      spots: labels?.map((label, i) => {
        const r = bySpot.get(i + 1);
        return { spot: i + 1, label, status: !r ? "free" : r.clientId === userId ? "yours" : "taken", attendee: r ? person(r) : null };
      }) ?? null,
      attending: rows.map(person).filter((p) => p !== null),
      othersCount: rows.filter((r) => person(r) === null).length,
    };
  });

  // --- Everything below changes the schedule: owners and admins only. -------
  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => requirePermission(req, "editSchedule"));

    admin.post("/sessions", async (req, reply) => {
      const input = parse(schemas.createSession, req.body);
      const result = await withFlags(app, input.acknowledge, (tx, flags) => svc.createSession(tx, req.auth, input, flags));
      reply.code(201);
      return result;
    });

    admin.post("/series", async (req, reply) => {
      const input = parse(schemas.createSeries, req.body);
      const result = await withFlags(app, input.acknowledge, (tx, flags) => svc.createSeries(tx, req.auth, input, app.config.SERIES_HORIZON_DAYS, flags));
      reply.code(201);
      return result;
    });

    admin.patch("/sessions/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(schemas.updateSession, req.body);
      return withFlags(app, input.acknowledge, (tx, flags) => svc.updateSession(tx, req.auth, id, input, flags));
    });

    /** Which upcoming classes a filter matches, before a bulk change or cancel. */
    admin.post("/sessions/bulk-preview", async (req) => {
      const { filter } = parse(schemas.bulkPreview, req.body);
      return svc.previewBulk(app.db, req.auth.orgId, filter);
    });

    admin.post("/sessions/bulk-update", async (req) => {
      const input = parse(schemas.bulkUpdateSessions, req.body);
      return withFlags(app, input.acknowledge, (tx, flags) => svc.bulkUpdateSessions(tx, req.auth, input, flags));
    });

    admin.post("/sessions/:id/cancel", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(schemas.cancelSession, req.body);
      return withFlags(app, input.acknowledge, (tx, flags) => svc.cancelSession(tx, req.auth, id, input, flags));
    });

    admin.post("/sessions/bulk-cancel", async (req) => {
      const input = parse(schemas.bulkCancelSessions, req.body);
      return withFlags(app, input.acknowledge, (tx, flags) => svc.bulkCancelSessions(tx, req.auth, input, flags));
    });

    admin.delete("/sessions/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(schemas.cancelSession, req.body);
      return withFlags(app, input.acknowledge, (tx, flags) => svc.deleteSession(tx, req.auth, id, input, flags));
    });

    admin.post("/sessions/:id/duplicate", async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const input = parse(schemas.duplicateSession, req.body);
      const result = await withFlags(app, input.acknowledge, (tx, flags) => svc.duplicateSession(tx, req.auth, id, input.dates, flags));
      reply.code(201);
      return result;
    });

    admin.post("/sessions/duplicate-range", async (req, reply) => {
      const input = parse(schemas.duplicateRange, req.body);
      const result = await withFlags(app, input.acknowledge, (tx, flags) => svc.duplicateRange(tx, req.auth, input, flags));
      reply.code(201);
      return result;
    });
  });

  /**
   * ClassPass spots: upcoming classes open to ClassPass, with how many spots ClassPass can still
   * take. Until the ClassPass connection is live, this is the list staff keep ClassPass in step with.
   */
  app.get("/classpass/spots", async (req) => {
    if (!can(req.auth.role, "manageBookings")) throw forbidden();
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(60).default(14) }), req.query);
    const now = new Date();
    const rows = await app.db
      .select({ s: classSessions, typeName: classTypes.name, color: classTypes.color })
      .from(classSessions)
      .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
      .where(and(eq(classSessions.orgId, req.auth.orgId), eq(classSessions.status, "scheduled"), eq(classSessions.classpassEnabled, true), gt(classSessions.startsAt, now), lt(classSessions.startsAt, new Date(now.getTime() + days * 86_400_000))))
      .orderBy(asc(classSessions.startsAt))
      .limit(500);
    return Promise.all(
      rows.map(async ({ s, typeName, color }) => ({
        sessionId: s.id, className: typeName, color, startsAt: s.startsAt.toISOString(), capacity: s.capacity,
        ...classpassView({ ...s, classpassTaken: await classpassBooked(app.db, s.id), booked: await confirmedCount(app.db, s.id) }),
      })),
    );
  });

  // Instructors' own upcoming classes (handy for the mobile "My schedule" tab).
  app.get("/me/teaching", async (req) => {
    if (req.auth.role === "client") throw forbidden();
    return app.db
      .select()
      .from(classSessions)
      .where(and(eq(classSessions.orgId, req.auth.orgId), eq(classSessions.instructorId, req.auth.userId), eq(classSessions.status, "scheduled")))
      .orderBy(asc(classSessions.startsAt))
      .limit(200);
  });
}
