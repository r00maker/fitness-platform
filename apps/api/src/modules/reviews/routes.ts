import type { FastifyInstance } from "fastify";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { forbidden } from "../../lib/errors.js";
import * as reviews from "./service.js";
import * as fb from "../feedback/service.js";

const idParam = z.object({ id: schemas.id });

export async function reviewRoutes(app: FastifyInstance) {
  // --- Clients: reviewing a class ---
  app.get("/me/review-prompt", async (req) => reviews.reviewPrompt(app.db, req.auth));
  app.post("/reviews", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parse(schemas.createReview, req.body);
    const out = await inTx(app, (tx) => reviews.createReview(tx, req.auth, input));
    reply.code(201);
    return out;
  });
  app.post("/reviews/skip", async (req) => {
    const { bookingId } = parse(schemas.skipReview, req.body);
    return inTx(app, (tx) => reviews.skipReview(tx, req.auth, bookingId));
  });
  app.put("/me/review-snooze", async (req) => {
    const { weeks } = parse(schemas.reviewSnooze, req.body);
    return inTx(app, (tx) => reviews.setReviewSnooze(tx, req.auth, weeks));
  });
  /** The client tapped "Share on Google": counted, so studios can see whether asking works. */
  app.post("/reviews/:id/google", async (req) => {
    const { id } = parse(idParam, req.params);
    return inTx(app, (tx) => reviews.googleClicked(tx, req.auth, id));
  });

  // --- Staff: the Reviews page (instructors: their own classes) ---
  app.get("/reviews", async (req) => reviews.listReviews(app.db, req.auth, parse(schemas.reviewQuery, req.query)));
  app.post("/reviews/:id/handle", async (req) => {
    requirePermission(req, "manageFeedback");
    const { id } = parse(idParam, req.params);
    const { reply } = parse(schemas.handleReview, req.body ?? {});
    return inTx(app, (tx) => reviews.handleReview(tx, req.auth, id, reply));
  });

  // --- Feedback ---
  app.post("/feedback", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (req.auth.role !== "client") throw forbidden("Feedback comes from clients. Staff can reply to it under Feedback.");
    const input = parse(schemas.createFeedback, req.body);
    reply.code(201);
    return inTx(app, (tx) => fb.createFeedback(tx, req.auth, input));
  });
  app.get("/me/feedback", async (req) => fb.myFeedback(app.db, req.auth));
  app.post("/me/feedback/:id/replies", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { body } = parse(schemas.feedbackReply, req.body);
    reply.code(201);
    return inTx(app, (tx) => fb.reply(tx, req.auth, id, body, false));
  });
  app.register(async (staff) => {
    staff.addHook("preHandler", async (req) => requirePermission(req, "manageFeedback"));
    staff.get("/feedback", async (req) => fb.staffFeedback(app.db, req.auth, parse(schemas.feedbackQuery, req.query)));
    staff.post("/feedback/:id/replies", async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const { body } = parse(schemas.feedbackReply, req.body);
      reply.code(201);
      return inTx(app, (tx) => fb.reply(tx, req.auth, id, body, true));
    });
    staff.patch("/feedback/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const { status } = parse(schemas.updateFeedback, req.body);
      return inTx(app, (tx) => fb.setStatus(tx, req.auth, id, status));
    });
  });
}
