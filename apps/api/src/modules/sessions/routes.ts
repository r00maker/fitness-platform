import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { can, schemas } from "@studio/shared";
import { z } from "zod";
import { bookings, classSessions, memberships, substituteRequests, users, waitlistEntries } from "../../db/schema.js";
import { spotLabels } from "../bookings/spots.js";
import { attendedCounts, publicName, tagsFor } from "./people.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { canSeeRequest } from "../substitutes/service.js";
import { getCalendar } from "./calendar.js";
import { describeSession, getSession } from "./context.js";
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });

export async function sessionRoutes(app: FastifyInstance) {
  app.get("/calendar", async (req) => getCalendar(app.db, req.auth, parse(schemas.calendarQuery, req.query)));

  /**
   * Class detail. What's included depends on who's asking:
   *  - Admin: everything, including client contact details.
   *  - Front of House: everything except client contact details.
   *  - Instructor: their own classes (with the client list), or a class they've been asked to cover (no client list).
   *  - Client: class details plus their own booking or waitlist place.
   */
  /** Who may open this class: everyone except instructors looking at other people's classes they weren't asked to cover. */
  async function visibleSession(auth: { role: string; userId: string; orgId: string }, id: string) {
    const s = await getSession(app.db, auth.orgId, id);
    const ownClass = auth.role === "instructor" && s.instructorId === auth.userId;
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
   *  - Admin and Front of House: the full client list with contact details, photo, spot, tags and classes attended.
   *  - Instructor: the same for their own classes; a class they've been asked to cover shows no client list.
   *  - Client: class details plus their own booking or waitlist place (who else is coming is under /attendees).
   */
  app.get("/sessions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { role, userId, orgId } = req.auth;
    const { s, ownClass } = await visibleSession(req.auth, id);
    const info = await describeSession(app.db, s);
    const isClient = role === "client";
    const fullRoster = can(role, "viewAllRosters") || ownClass;
    const contacts = can(role, "viewClientContacts") || ownClass;
    const labels = await spotLabels(app.db, s.roomId);

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
    const [attended, tags] = fullRoster ? await Promise.all([attendedCounts(app.db, orgId, ids), tagsFor(app.db, orgId, ids)]) : [new Map(), new Map()];
    const waitlist = isClient || fullRoster
      ? await app.db
          .select({ id: waitlistEntries.id, clientId: waitlistEntries.clientId, firstName: users.firstName, lastName: users.lastName, mode: waitlistEntries.mode, status: waitlistEntries.status, expiresAt: waitlistEntries.expiresAt, offerExpiresAt: waitlistEntries.offerExpiresAt })
          .from(waitlistEntries)
          .innerJoin(users, eq(users.id, waitlistEntries.clientId))
          .where(and(eq(waitlistEntries.sessionId, s.id), inArray(waitlistEntries.status, ["waiting", "offered"]), fullRoster ? undefined : eq(waitlistEntries.clientId, userId)))
          .orderBy(asc(waitlistEntries.createdAt))
      : [];

    return {
      ...s,
      ...info,
      notes: isClient ? undefined : s.notes,
      spotSelection: !!labels,
      booked: fullRoster ? rows.filter((r) => r.status === "confirmed").length : undefined,
      roster: rows.map(({ email, phone, ...r }) => {
        const n = attended.get(r.clientId) ?? 0;
        return {
          ...r,
          spotLabel: r.spot && labels ? labels[r.spot - 1] : null,
          ...(contacts ? { email, phone } : {}),
          ...(fullRoster ? { attendedCount: n, firstVisit: n === 0, tags: tags.get(r.clientId) ?? [], packageName: null /* filled in by the payments module */ } : {}),
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
    const labels = await spotLabels(app.db, s.roomId);
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
