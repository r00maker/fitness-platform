/** Client directory, history and fees. Admins (and owners) only. */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { FEE_STATUSES, schemas } from "@studio/shared";
import { z } from "zod";
import { bookings, classSessions, classTypes, fees, memberships, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { tagsFor } from "../sessions/people.js";
import { getOrg } from "../sessions/context.js";
import { notesFor } from "./health.js";
import { waiverHistory, waiverStatuses } from "./waivers.js";

const idParam = z.object({ id: schemas.id });
const feeQuery = z.object({ status: z.enum(FEE_STATUSES).optional() });

export async function clientRoutes(app: FastifyInstance) {
  const { db } = app;
  app.addHook("preHandler", async (req) => requirePermission(req, "viewClientDetails"));

  app.get("/clients", async (req) => {
    const { q } = parse(schemas.clientSearch, req.query);
    const search = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    return db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, since: memberships.createdAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.orgId, req.auth.orgId),
          eq(memberships.role, "client"),
          search ? or(ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, search), ilike(users.email, search), ilike(users.phone, search)) : undefined,
        ),
      )
      .orderBy(users.firstName)
      .limit(200);
  });

  app.get("/clients/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const [client] = await db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, photoUrl: users.photoUrl, source: memberships.source, showInAttendeeList: memberships.showInAttendeeList })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, id), eq(memberships.role, "client")));
    if (!client) throw notFound("client");
    const history = await db
      .select({ bookingId: bookings.id, status: bookings.status, attendance: bookings.attendance, startsAt: classSessions.startsAt, className: classTypes.name })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
      .where(and(eq(bookings.orgId, req.auth.orgId), eq(bookings.clientId, id)))
      .orderBy(desc(classSessions.startsAt))
      .limit(100);
    const clientFees = await db.select().from(fees).where(and(eq(fees.orgId, req.auth.orgId), eq(fees.clientId, id))).orderBy(desc(fees.createdAt));
    const attended = history.filter((h) => h.attendance === "present").length;
    const org = await getOrg(db, req.auth.orgId);
    return {
      ...client,
      tags: (await tagsFor(db, req.auth.orgId, [id])).get(id) ?? [],
      waiver: { ...(await waiverStatuses(db, org, [id])).get(id)!, history: await waiverHistory(db, req.auth.orgId, id) },
      healthNotes: await notesFor(db, req.auth.orgId, id),
      summary: {
        attended,
        noShows: history.filter((h) => h.attendance === "no_show").length,
        lateCancels: history.filter((h) => h.status === "late_cancelled").length,
      },
      history,
      fees: clientFees.map((f) => ({ ...f, amount: money(f.amountCents, f.currency) })),
    };
  });

  app.get("/fees", async (req) => {
    const { status } = parse(feeQuery, req.query);
    const rows = await db
      .select({ fee: fees, firstName: users.firstName, lastName: users.lastName })
      .from(fees)
      .innerJoin(users, eq(users.id, fees.clientId))
      .where(and(eq(fees.orgId, req.auth.orgId), inArray(fees.status, status ? [status] : ["pending"])))
      .orderBy(desc(fees.createdAt))
      .limit(500);
    return rows.map((r) => ({ ...r.fee, amount: money(r.fee.amountCents, r.fee.currency), clientName: `${r.firstName} ${r.lastName}` }));
  });

  app.post("/fees/:id/waive", async (req) => {
    requirePermission(req, "manageBookings");
    const { id } = parse(idParam, req.params);
    const { reason } = parse(schemas.waiveFee, req.body);
    return inTx(app, async (tx) => {
      const [fee] = await tx.select().from(fees).where(and(eq(fees.id, id), eq(fees.orgId, req.auth.orgId))).for("update");
      if (!fee) throw notFound("fee");
      if (fee.status !== "pending") throw conflict("fee_not_pending", fee.status === "waived" ? "This fee has already been waived." : "This fee has already been paid. Refund it instead.");
      const [updated] = await tx.update(fees).set({ status: "waived", waivedBy: req.auth.userId, waivedAt: new Date(), waivedReason: reason }).where(eq(fees.id, id)).returning();
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "fee.waived", entityType: "fee", entityId: id, details: { reason } });
      return updated;
    });
  });
}
