import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { can, schemas } from "@studio/shared";
import { z } from "zod";
import { bookings, classSessions, substituteRequests, users, waitlistEntries } from "../../db/schema.js";
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
  app.get("/sessions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { role, userId, orgId } = req.auth;
    const s = await getSession(app.db, orgId, id);
    const ownClass = role === "instructor" && s.instructorId === userId;
    if (role === "instructor" && !ownClass) {
      const requests = await app.db
        .select()
        .from(substituteRequests)
        .where(and(eq(substituteRequests.sessionId, s.id), inArray(substituteRequests.status, ["open", "awaiting_approval"])));
      if (!requests.some((r) => canSeeRequest(r, userId))) throw notFound("class");
    }
    const info = await describeSession(app.db, s);
    const isClient = role === "client";
    const fullRoster = can(role, "viewAllRosters") || ownClass;
    const contacts = can(role, "viewClientDetails");

    const roster = isClient || fullRoster
      ? await app.db
          .select({ id: bookings.id, clientId: bookings.clientId, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, status: bookings.status, attendance: bookings.attendance, source: bookings.source })
          .from(bookings)
          .innerJoin(users, eq(users.id, bookings.clientId))
          .where(and(eq(bookings.sessionId, s.id), fullRoster ? undefined : eq(bookings.clientId, userId)))
          .orderBy(asc(users.firstName))
      : [];
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
      booked: fullRoster ? roster.filter((r) => r.status === "confirmed").length : undefined,
      roster: roster.map(({ email, phone, ...r }) => (contacts ? { ...r, email, phone } : r)),
      waitlist: waitlist.map((w, i) => ({ ...w, position: i + 1 })),
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
