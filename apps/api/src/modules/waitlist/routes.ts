import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { waitlistEntries } from "../../db/schema.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });

export async function waitlistRoutes(app: FastifyInstance) {
  app.post("/waitlist", async (req, reply) => {
    const input = parse(schemas.joinWaitlist, req.body);
    const result = await withFlags(app, input.acknowledge, (tx, flags) => svc.joinWaitlist(tx, req.auth, input, flags));
    reply.code(201);
    return result;
  });
  app.post("/waitlist/:id/claim", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    reply.code(201);
    return inTx(app, (tx) => svc.claimOffer(tx, req.auth, id));
  });
  app.post("/waitlist/:id/decline", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await inTx(app, (tx) => svc.declineOffer(tx, req.auth, id));
    return reply.code(204).send();
  });
  app.delete("/waitlist/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await inTx(app, (tx) => svc.leaveWaitlist(tx, req.auth, id));
    return reply.code(204).send();
  });
  app.get("/me/waitlist", async (req) => {
    const rows = await app.db
      .select()
      .from(waitlistEntries)
      .where(and(eq(waitlistEntries.orgId, req.auth.orgId), eq(waitlistEntries.clientId, req.auth.userId), inArray(waitlistEntries.status, ["waiting", "offered"])));
    return Promise.all(rows.map(async (r) => ({ ...r, position: r.status === "waiting" ? await svc.waitlistPosition(app.db, r) : null })));
  });
}
