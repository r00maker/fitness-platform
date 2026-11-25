import { trialRoutes } from "./modules/trial/routes.js";
import { trialGuard } from "./modules/trial/service.js";
import { clientAppRoutes } from "./modules/client-app/routes.js";
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
import { loyaltyRoutes } from "./modules/marketing/loyalty.js";
import { adsRoutes } from "./modules/marketing/ads.js";
import { staffRoutes } from "./modules/staff/routes.js";
import { whatsappRoutes } from "./modules/marketing/whatsapp.js";
import { reportRoutes } from "./modules/reports/routes.js";
import { commsRoutes } from "./modules/comms/routes.js";
import { agentRoutes } from "./modules/agents/routes.js";
import { assistantRoutes } from "./modules/assistant/routes.js";
import { salesRoutes } from "./modules/sales/routes.js";
import { shopRoutes } from "./modules/shop/routes.js";
import { writerRoutes } from "./modules/assistant/writer.js";
import { emailRoutes } from "./modules/comms/email.js";
import { helpLinkRoutes, helpSiteRoutes } from "./modules/help/routes.js";
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
import { closureRoutes } from "./modules/closures/routes.js";
import { dashboardRoutes } from "./modules/dashboard/routes.js";
import { reviewRoutes } from "./modules/reviews/routes.js";
import { momentRoutes } from "./modules/moments/routes.js";
import { featureGate, featureRoutes } from "./modules/settings/features.js";
import { setupRoutes } from "./modules/settings/setup.js";
import { planRoutes } from "./modules/settings/plans.js";
import { platformRoutes, studioSupportAccessRoutes } from "./modules/platform/routes.js";
import { welcomeRoutes } from "./modules/welcome/routes.js";
import { tellClientsRoutes } from "./modules/marketing/tell.js";
import { automationsRoutes } from "./modules/agents/automations.js";
import { settingsRoutes } from "./modules/settings/routes.js";
import { paymentRoutes } from "./modules/payments/routes.js";
import { bookingPageRoutes } from "./modules/booking-page/routes.js";
import { accountRoutes } from "./modules/account/routes.js";
import { configurePayments, stripe, stripeRenewalCharger } from "./modules/payments/service.js";
import { setRenewalCharger } from "./modules/packages/payments.js";
import { substituteRoutes } from "./modules/substitutes/routes.js";
import { waitlistRoutes } from "./modules/waitlist/routes.js";

export async function buildApp(opts: { config: Config; db: Db }) {
  const app = Fastify({
    bodyLimit: 256 * 1024,
    // Only the configured number of proxies is trusted for the client's address.
    trustProxy: opts.config.TRUST_PROXY_HOPS ? (_address: string, hop: number) => hop < opts.config.TRUST_PROXY_HOPS : false,
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
  // Online payments: with a Stripe key, memberships renew on the client's saved card.
  configurePayments(opts.config);
  if (stripe()) setRenewalCharger(stripeRenewalCharger(opts.db));

  // Plain HTML forms (the unsubscribe pages) and one-click unsubscribe from mail apps post form
  // data. Nothing reads a form body, so it's accepted and ignored.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 }, (_req, _body, done) => done(null, {}));
  await app.register(helmet);
  // The app's own origins, except the public booking data and widget, which any studio's website
  // may read (GET only, no credentials, nothing private in them).
  const appOrigins = opts.config.CORS_ORIGINS.split(",").map((o) => o.trim());
  await app.register(cors, {
    delegator: (req, cb) => {
      const open = /^\/v1\/public\/(studios\/|widget\.js)/.test(req.url ?? "");
      // The apps change things with PUT, PATCH and DELETE too (the CORS default is only GET, HEAD and POST).
      cb(null, open ? { origin: "*", methods: ["GET", "HEAD"], credentials: false } : { origin: appOrigins, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"], credentials: false });
    },
  });
  // Per address. (Keying on the sign-in token would let anyone dodge the limit by sending made-up
  // tokens, since this runs before tokens are checked.) Busier routes have their own limits.
  await app.register(rateLimit, {
    max: 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
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
  // The help centre's pages, for staff with a link from the app (see modules/help).
  await app.register(helpSiteRoutes);

  await app.register(
    async (v1) => {
      await v1.register(auth, { config: opts.config, db: opts.db });
      await v1.register(featureGate);
      // Once a free trial ends, the studio is read-only until it starts its plan.
      v1.addHook("preHandler", async (req) => trialGuard(opts.db, req));
      await v1.register(settingsRoutes);
      await v1.register(featureRoutes);
      await v1.register(setupRoutes);
      await v1.register(planRoutes);
      await v1.register(studioSupportAccessRoutes);
      await v1.register(welcomeRoutes);
      await v1.register(tellClientsRoutes);
      await v1.register(automationsRoutes);
      await v1.register(platformRoutes);
      await v1.register(catalogRoutes);
      await v1.register(sessionRoutes);
      await v1.register(closureRoutes);
      await v1.register(dashboardRoutes);
      await v1.register(reviewRoutes);
      await v1.register(momentRoutes);
      await v1.register(clientAppRoutes);
      await v1.register(trialRoutes);
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
      await v1.register(paymentRoutes);
      await v1.register(bookingPageRoutes);
      await v1.register(accountRoutes);
      await v1.register(marketingRoutes);
      await v1.register(marketingAppRoutes);
      await v1.register(loyaltyRoutes);
      await v1.register(adsRoutes);
      await v1.register(staffRoutes);
      await v1.register(whatsappRoutes);
      await v1.register(reportRoutes);
      await v1.register(commsRoutes);
      await v1.register(agentRoutes);
      await v1.register(assistantRoutes);
      await v1.register(salesRoutes);
      await v1.register(shopRoutes);
      await v1.register(writerRoutes);
      await v1.register(emailRoutes);
      await v1.register(helpLinkRoutes);
    },
    { prefix: "/v1" },
  );
  return app;
}
