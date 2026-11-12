import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { AppError } from "./lib/errors.js";
import auth from "./plugins/auth.js";
import { marketingRoutes } from "./modules/marketing/routes.js";
import { marketingAppRoutes } from "./modules/marketing/app-routes.js";
import { bookingRoutes } from "./modules/bookings/routes.js";
import { catalogRoutes } from "./modules/catalog/routes.js";
import { clientRoutes } from "./modules/clients/routes.js";
import { clientTagRoutes } from "./modules/clients/tags.js";
import { healthNoteRoutes } from "./modules/clients/health.js";
import { waiverRoutes } from "./modules/clients/waivers.js";
import { packageRoutes } from "./modules/packages/routes.js";
import { payrollRoutes } from "./modules/payroll/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { checkoutRoutes } from "./modules/checkout/routes.js";
import { sessionRoutes } from "./modules/sessions/routes.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { substituteRoutes } from "./modules/substitutes/routes.js";
import { waitlistRoutes } from "./modules/waitlist/routes.js";

export async function buildApp(opts: { config: Config; db: Db }) {
  const app = Fastify({
    bodyLimit: 256 * 1024,
    trustProxy: true,
    logger:
      opts.config.NODE_ENV === "test"
        ? false
        : {
            level: opts.config.NODE_ENV === "production" ? "info" : "debug",
            // Never write tokens or personal details into logs.
            redact: ["req.headers.authorization", "req.headers.cookie", "*.email", "*.phone"],
          },
  });
  app.decorate("db", opts.db);
  app.decorate("config", opts.config);

  await app.register(helmet);
  await app.register(cors, { origin: opts.config.CORS_ORIGINS.split(",").map((o) => o.trim()), credentials: false });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.headers.authorization?.slice(-24) ?? req.ip,
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...err.details } });
    }
    const pgCode = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (pgCode === "23505") {
      return reply.code(409).send({ error: { code: "duplicate", message: "That already exists." } });
    }
    if (pgCode === "40P01" || pgCode === "40001") {
      return reply.code(409).send({ error: { code: "busy", message: "Lots happening at once – please try again." } });
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: { code: "too_many_requests", message: "You're going a bit fast. Please wait a moment and try again." } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: "bad_request", message: "That request couldn't be understood." } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "server_error", message: "Something went wrong on our side. Please try again." } });
  });

  app.get("/health", { config: { public: true } }, async () => ({ ok: true }));

  await app.register(
    async (v1) => {
      await v1.register(auth, { config: opts.config, db: opts.db });
      await v1.register(settingsRoutes);
      await v1.register(catalogRoutes);
      await v1.register(sessionRoutes);
      await v1.register(bookingRoutes);
      await v1.register(waitlistRoutes);
      await v1.register(substituteRoutes);
      await v1.register(clientRoutes);
      await v1.register(clientTagRoutes);
      await v1.register(waiverRoutes);
      await v1.register(healthNoteRoutes);
      await v1.register(packageRoutes);
      await v1.register(payrollRoutes);
      await v1.register(fileRoutes);
      await v1.register(checkoutRoutes);
      await v1.register(marketingRoutes);
      await v1.register(marketingAppRoutes);
    },
    { prefix: "/v1" },
  );
  return app;
}
