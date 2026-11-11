import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte } from "drizzle-orm";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { bookings, classSessions } from "../../db/schema.js";
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
      await svc.refundBooking(tx, req.auth, id, input, flags);
      return { refunded: true };
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

  app.get("/me/bookings", async (req) =>
    app.db
      .select({ booking: bookings, session: classSessions })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .where(and(eq(bookings.orgId, req.auth.orgId), eq(bookings.clientId, req.auth.userId), eq(bookings.status, "confirmed"), gte(classSessions.endsAt, new Date())))
      .orderBy(asc(classSessions.startsAt)),
  );
}
