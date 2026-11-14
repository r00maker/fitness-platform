import type { FastifyInstance } from "fastify";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });

export async function closureRoutes(app: FastifyInstance) {
  /** Everyone can see when the studio is closed (clients see it on the schedule too). */
  app.get("/closures", async (req) => {
    const { include } = parse(schemas.closureList, req.query);
    return svc.listClosures(app.db, req.auth.orgId, include);
  });

  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => requirePermission(req, "editSchedule"));

    /** What a closure would cancel, before saving. */
    admin.post("/closures/preview", async (req) => svc.previewClosure(app.db, req.auth.orgId, parse(schemas.closurePreview, req.body)));

    admin.post("/closures", async (req, reply) => {
      const input = parse(schemas.createClosure, req.body);
      const result = await withFlags(app, input.acknowledge, (tx, flags) => svc.createClosure(tx, req.auth, input, flags));
      reply.code(201);
      return result;
    });

    admin.patch("/closures/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(schemas.updateClosure, req.body);
      return inTx(app, (tx) => svc.updateClosure(tx, req.auth, id, input));
    });

    admin.delete("/closures/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(schemas.deleteClosure, req.body ?? {});
      return inTx(app, (tx) => svc.deleteClosure(tx, req.auth, id, input));
    });
  });
}
