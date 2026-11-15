import type { FastifyInstance } from "fastify";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { parse } from "../../lib/validate.js";
import { getDashboard } from "./service.js";

const query = z.object({
  days: z.coerce.number().int().refine((d) => d === 7 || d === 30, "Choose 7 or 30 days.").default(7),
  locationId: schemas.id.optional(),
});

export async function dashboardRoutes(app: FastifyInstance) {
  /** The studio's front page for staff: today, what needs attention, how it's going, the week ahead. */
  app.get("/dashboard", async (req) => {
    const q = parse(query, req.query);
    return getDashboard(app.db, req.auth, { days: q.days as 7 | 30, locationId: q.locationId });
  });
}
