import type { FastifyInstance } from "fastify";
import { SUB_REQUEST_STATUSES, schemas } from "@studio/shared";
import { z } from "zod";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requireRole } from "../../plugins/auth.js";
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });
const listQuery = z.object({ status: z.enum(SUB_REQUEST_STATUSES).optional() });

export async function substituteRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => requireRole(req, ["owner", "admin", "instructor"]));

  app.get("/sessions/:id/cover-options", async (req) => {
    const { id } = parse(idParam, req.params);
    return svc.coverOptions(app.db, req.auth, id);
  });

  app.get("/substitute-requests", async (req) => {
    const { status } = parse(listQuery, req.query);
    return svc.listSubRequests(app.db, req.auth, status ? [status] : ["open", "awaiting_approval"]);
  });
  app.post("/substitute-requests", async (req, reply) => {
    const input = parse(schemas.createSubRequest, req.body);
    reply.code(201);
    return inTx(app, (tx) => svc.createSubRequest(tx, req.auth, input));
  });
  app.post("/substitute-requests/:id/accept", async (req) => {
    const { id } = parse(idParam, req.params);
    const { acknowledge } = parse(schemas.respondToSub, req.body);
    return withFlags(app, acknowledge, (tx, flags) => svc.respondToSubRequest(tx, req.auth, id, true, flags));
  });
  app.post("/substitute-requests/:id/decline", async (req) => {
    const { id } = parse(idParam, req.params);
    return withFlags(app, [], (tx, flags) => svc.respondToSubRequest(tx, req.auth, id, false, flags));
  });
  app.post("/substitute-requests/:id/approve", async (req) => {
    const { id } = parse(idParam, req.params);
    const { instructorId, acknowledge } = parse(schemas.approveSub, req.body);
    return withFlags(app, acknowledge, (tx, flags) => svc.approveSub(tx, req.auth, id, instructorId, flags));
  });
  app.post("/substitute-requests/:id/assign", async (req) => {
    const { id } = parse(idParam, req.params);
    const { instructorId, acknowledge } = parse(schemas.approveSub, req.body);
    return withFlags(app, acknowledge, (tx, flags) => svc.assignSubDirectly(tx, req.auth, id, instructorId, flags));
  });
  app.post("/substitute-requests/:id/cancel", async (req) => {
    const { id } = parse(idParam, req.params);
    return inTx(app, (tx) => svc.cancelSubRequest(tx, req.auth, id));
  });
}
