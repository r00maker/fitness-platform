import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte } from "drizzle-orm";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { bookings, classSessions, classTypes } from "../../db/schema.js";
import { withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });

export async function bookingRoutes(app: FastifyInstance) {
  app.post("/bookings", async (req, reply) => {
    const input = parse(schemas.createBooking, req.body);
    const result = await withFlags(app, input.acknowledge, (tx, flags) => svc.createBooking(tx, req.auth, input, flags));
    reply.code(201);
    return result;
  });

  app.post("/bookings/:id/cancel", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.cancelBooking, req.body);
    return withFlags(app, input.acknowledge, (tx, flags) => svc.cancelBooking(tx, req.auth, id, input, flags));
  });

  app.post("/bookings/:id/move", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.moveBooking, req.body);
    return withFlags(app, input.acknowledge, (tx, flags) => svc.moveBooking(tx, req.auth, id, input, flags));
  });

  app.post("/bookings/:id/refund", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.refundBooking, req.body);
    return withFlags(app, input.acknowledge, async (tx, flags) => {
      return { refunded: true, ...(await svc.refundBooking(tx, req.auth, id, input, flags)) };
    });
  });

  app.put("/bookings/:id/attendance", async (req) => {
    const { id } = parse(idParam, req.params);
    const { attendance } = parse(schemas.markAttendance, req.body);
    return withFlags(app, [], (tx, flags) => svc.markAttendance(tx, req.auth, id, attendance, flags));
  });

  app.post("/sessions/:id/attendance/mark-all", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.markAllAttendance, req.body);
    return withFlags(app, input.acknowledge, (tx, flags) => svc.markAllAttendance(tx, req.auth, id, input, flags));
  });

  /**
   * The client's upcoming bookings, split into group classes and appointments (some people do both).
   * `?show=classes|appointments` narrows it. Staff notes and ClassPass settings aren't included.
   */
  app.get("/me/bookings", async (req) => {
    const { show } = parse(z.object({ show: z.enum(["all", "classes", "appointments"]).default("all") }), req.query);
    const rows = await app.db
      .select({
        booking: bookings,
        session: { id: classSessions.id, startsAt: classSessions.startsAt, endsAt: classSessions.endsAt, locationId: classSessions.locationId, roomId: classSessions.roomId, instructorId: classSessions.instructorId, status: classSessions.status },
        classType: { id: classTypes.id, name: classTypes.name, color: classTypes.color, kind: classTypes.kind },
      })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
      .where(and(eq(bookings.orgId, req.auth.orgId), eq(bookings.clientId, req.auth.userId), eq(bookings.status, "confirmed"), gte(classSessions.endsAt, new Date())))
      .orderBy(asc(classSessions.startsAt));
    const items = rows.map((r) => ({ ...r, isAppointment: r.classType.kind === "appointment" }));
    const classes = items.filter((i) => !i.isAppointment);
    const appointments = items.filter((i) => i.isAppointment);
    return {
      counts: { classes: classes.length, appointments: appointments.length },
      ...(show !== "appointments" ? { classes } : {}),
      ...(show !== "classes" ? { appointments } : {}),
    };
  });
}
