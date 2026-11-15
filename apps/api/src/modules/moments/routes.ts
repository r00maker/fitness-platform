import type { FastifyInstance } from "fastify";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { parse } from "../../lib/validate.js";
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });

export async function momentRoutes(app: FastifyInstance) {
  /** Celebrations to show this person now (made here if one is due). */
  app.get("/me/moments", async (req) => svc.myMoments(app.db, app.config, req.auth));
  app.post("/moments/:id/seen", async (req) => svc.markSeen(app.db, req.auth, parse(idParam, req.params).id));
  /** "Don't show me these": just for this person. */
  app.put("/me/celebrations", async (req) => svc.setCelebrationsOff(app.db, req.auth, parse(schemas.celebrationsPref, req.body).off));
}
