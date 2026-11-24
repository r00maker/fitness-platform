/**
 * The free trial: starting one (anyone signed in, once), what the studio sees, asking to start a
 * plan, and what our team can do (extend, end, convert).
 */
import type { FastifyInstance } from "fastify";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { platformTrialAction, startPlanRequest, startTrial, TRIAL_DAYS, TRIAL_TERMS, TRIAL_TERMS_VERSION, schemas } from "@studio/shared";
import { locations, memberships, organizations, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, unauthorized } from "../../lib/errors.js";
import { Flags } from "../../lib/flags.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { uniqueSlug } from "../booking-page/routes.js";
import { requirePlatform } from "../platform/routes.js";
import { getOrg } from "../sessions/context.js";
import { setPlan } from "../settings/plans.js";
import { seedSandbox } from "./sandbox.js";
import { trialState, trialView } from "./service.js";

/** Throwaway inboxes: a trial needs an address someone actually uses. */
const DISPOSABLE = /@(mailinator|guerrillamail|10minutemail|tempmail|temp-mail|yopmail|trashmail|getnada|sharklasers|dispostable|maildrop|fakeinbox|throwawaymail)\./i;

export async function trialRoutes(app: FastifyInstance) {
  const { db } = app;

  /** The trial's terms, for the sign-up page. */
  app.get("/public/trial", { config: { public: true } }, async () => ({ days: TRIAL_DAYS, terms: TRIAL_TERMS, termsVersion: TRIAL_TERMS_VERSION }));

  /**
   * Start a trial. The person signs in first (their email confirmed); they become the owner of a
   * new studio on the plan they chose. One trial per person, and not for studios already with us.
   */
  app.post("/trials", { config: { public: true, rateLimit: { max: app.config.NODE_ENV === "test" ? 1000 : 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    let payload: Awaited<ReturnType<typeof app.verifyToken>>;
    try {
      payload = await app.verifyToken(header.slice(7));
    } catch {
      throw unauthorized();
    }
    const sub = payload.sub;
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : undefined;
    if (!sub) throw unauthorized();
    const input = parse(startTrial, req.body);
    const out = await inTx(app, async (tx) => {
      let [u] = await tx.select().from(users).where(eq(users.id, sub));
      if (!u) {
        if (!email) throw badRequest("email_needed", "Sign in with your email address to start a trial.");
        const yes = (v: unknown) => v === true || v === "true";
        if (!yes(payload.email_verified) && !yes((payload.user_metadata as Record<string, unknown> | undefined)?.email_verified)) throw forbidden("Please confirm your email address first, then try again.");
        if (DISPOSABLE.test(email)) throw badRequest("email_disposable", "Please use your studio's email address, or one you check every day.");
        [u] = await tx.insert(users).values({ id: sub, email, firstName: input.firstName, lastName: input.lastName, phone: input.phone ?? null }).returning();
      }
      // One trial per person, and studios already with us don't need one.
      const owned = await tx.select({ trial: organizations.trialStartedAt }).from(memberships).innerJoin(organizations, eq(organizations.id, memberships.orgId)).where(and(eq(memberships.userId, sub), eq(memberships.role, "owner")));
      if (owned.some((o) => o.trial)) throw conflict("trial_used", "You've already had a free trial. Talk to us and we'll get you set up.");
      if (owned.length) throw conflict("already_customer", "You already have a studio with us, so there's no need for a trial. Talk to us to add another.");
      const now = new Date();
      const [org] = await tx
        .insert(organizations)
        .values({
          name: input.studioName, timezone: input.timezone, currency: input.currency, lifecycle: "live", slug: await uniqueSlug(tx, input.studioName),
          // The test studio has no public booking page.
          bookingPageEnabled: input.kind === "new",
          trialKind: input.kind, trialStartedAt: now, trialEndsAt: DateTime.fromJSDate(now).plus({ days: TRIAL_DAYS }).toJSDate(), trialTermsVersion: TRIAL_TERMS_VERSION,
        })
        .returning();
      const [loc] = await tx.insert(locations).values({ orgId: org!.id, name: input.kind === "existing" ? "Sample studio" : input.studioName, timezone: input.timezone }).returning();
      await setPlan(tx, new Flags(["plan_changes"]), org!.id, { plan: input.plan }, null);
      await tx.insert(memberships).values({ orgId: org!.id, userId: u!.id, role: "owner" });
      if (input.kind === "existing") await seedSandbox(tx, org!, loc!.id, now);
      await audit(tx, { orgId: org!.id, actorId: u!.id, action: "trial.started", entityType: "organization", entityId: org!.id, details: { kind: input.kind, plan: input.plan, terms: TRIAL_TERMS_VERSION } });
      return org!.id;
    });
    const org = await getOrg(db, out);
    reply.code(201);
    return { orgId: org.id, slug: org.slug, trial: await trialView(db, org) };
  });

  /** What the studio's team sees: days left, what's not included, the client cap. */
  app.get("/trial", async (req) => {
    if (req.auth.role === "client") throw forbidden();
    return trialView(db, await getOrg(db, req.auth.orgId));
  });

  /** The owner asks to start their plan; our team follows up and switches payments on. */
  app.post("/trial/start-plan", async (req) => {
    if (req.auth.role !== "owner") throw forbidden("Only the studio's owner can start the plan.");
    const input = parse(startPlanRequest, req.body);
    const org = await getOrg(db, req.auth.orgId);
    if (!org.trialKind || org.trialConvertedAt) throw conflict("not_on_trial", "Your studio isn't on a trial.");
    const request = { plan: input.plan, brandedApp: input.brandedApp, note: input.note ?? null, at: new Date().toISOString(), by: req.auth.userId };
    await db.update(organizations).set({ trialPlanRequest: request }).where(eq(organizations.id, org.id));
    await audit(db, { orgId: org.id, actorId: req.auth.userId, action: "trial.plan_requested", entityType: "organization", entityId: org.id, details: request });
    return {
      ...(await trialView(db, await getOrg(db, org.id))),
      next: org.trialKind === "existing"
        ? "Thanks! We'll be in touch within a working day to set up your real studio and move your data across. This test studio stays as it is until then."
        : "Thanks! We'll be in touch within a working day to switch payments on. Nothing you've set up changes.",
    };
  });
}

/** HQ: trials in the studios list, and extending, ending or converting one. */
export async function platformTrialRoutes(app: FastifyInstance) {
  const { db } = app;
  const hq = { config: { public: true } } as const;
  app.get("/platform/trials", hq, async (req) => {
    requirePlatform(req, "view");
    const orgs = await db.select().from(organizations).where(isNotNull(organizations.trialKind)).orderBy(sql`${organizations.trialStartedAt} desc`).limit(500);
    const out = [];
    for (const o of orgs) out.push({ id: o.id, name: o.name, ...(await trialView(db, o)) });
    return {
      trials: out,
      groups: {
        new: out.filter((t) => t.onTrial && t.kind === "new").length,
        existing: out.filter((t) => t.onTrial && t.kind === "existing").length,
        askedToStart: out.filter((t) => t.onTrial && t.planRequest).length,
        converted: out.filter((t) => !t.onTrial && t.convertedAt).length,
      },
    };
  });
  app.post("/platform/studios/:orgId/trial", hq, async (req) => {
    requirePlatform(req, "manageStudios");
    const { orgId } = parse(schemas.orgIdParam, req.params);
    const input = parse(platformTrialAction, req.body);
    const org = await getOrg(db, orgId);
    if (!org.trialKind || org.trialConvertedAt) throw conflict("not_on_trial", "This studio isn't on a trial.");
    const now = new Date();
    if (input.action === "extend") {
      const from = org.trialEndsAt && org.trialEndsAt > now ? org.trialEndsAt : now;
      await db.update(organizations).set({ trialEndsAt: DateTime.fromJSDate(from).plus({ days: input.days }).toJSDate() }).where(eq(organizations.id, org.id));
    } else if (input.action === "end") {
      await db.update(organizations).set({ trialEndsAt: now }).where(eq(organizations.id, org.id));
    } else {
      // A test studio isn't the real one: its real studio is set up (and its data moved) as usual.
      if (org.trialKind === "existing") throw conflict("sandbox", "This is a test studio with sample data. Set up their real studio from Studios, New studio (with the data move), then end this trial.");
      await db.update(organizations).set({ trialConvertedAt: now }).where(eq(organizations.id, org.id));
    }
    await audit(db, { orgId: org.id, actorId: req.platform.userId, action: `trial.${input.action}`, entityType: "organization", entityId: org.id, details: input });
    const after = await getOrg(db, org.id);
    return { ...(await trialView(db, after)), state: trialState(after) };
  });
}
