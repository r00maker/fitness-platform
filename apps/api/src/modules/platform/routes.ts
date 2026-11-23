/**
 * HQ: our own team's dashboard API, under /v1/platform. Separate from the studio app:
 *
 *  - Our staff sign in as themselves (platform_staff), not with a studio account. Roles:
 *    owner (everything, including staff), onboarding (studios, plans, migrations),
 *    support (view, notes, support access).
 *  - Studio overviews, health and setup progress use counts and settings only. A studio's client
 *    personal data is shown only during support access: time-limited, with a reason, logged in
 *    the studio's own audit log, visible to the studio, and endable by them.
 *  - Every change we make is in the studio's audit log, with our staff member as the actor.
 */
import { uniqueSlug } from "../booking-page/routes.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { PLAN_INFO, planPrice, schemas } from "@studio/shared";
import { auditLog, clientPackages, locations, memberships, migrationJobs, organizations, platformNotes, platformStaff, staffInvites, supportAccess, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, forbidden, notFound, unauthorized } from "../../lib/errors.js";
import { Flags } from "../../lib/flags.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { getOrg } from "../sessions/context.js";
import { adminCount, locationCount, planView, setPlan, planMoney } from "../settings/plans.js";
import { sendStaffInvite } from "../staff/routes.js";
import { studioHealth } from "./health.js";
import { platformMigrationRoutes } from "../migration/routes.js";
import { platformAssistantRoutes } from "./assistant.js";
import { platformTrialRoutes } from "../trial/routes.js";

export type PlatformRole = (typeof schemas.PLATFORM_ROLES)[number];
declare module "fastify" {
  interface FastifyRequest {
    platform: { userId: string; role: PlatformRole; name: string };
  }
}

/** What each of our roles can do. */
const CAN: Record<string, readonly PlatformRole[]> = {
  view: ["owner", "onboarding", "support"],
  notes: ["owner", "onboarding", "support"],
  supportAccess: ["owner", "onboarding", "support"],
  assistant: ["owner", "onboarding", "support"],
  manageStudios: ["owner", "onboarding"],
  migrations: ["owner", "onboarding"],
  manageStaff: ["owner"],
};
export function requirePlatform(req: FastifyRequest, what: keyof typeof CAN) {
  if (!CAN[what]!.includes(req.platform.role)) throw forbidden("Your HQ role can't do this. Ask an HQ owner.");
}

const studioParam = schemas.orgIdParam;
const idParam = z.object({ id: z.string().uuid() });
const count = sql<number>`count(*)::int`;

/** Is there a live support access session for this staff member and studio? */
export async function activeSupportAccess(db: FastifyInstance["db"], orgId: string, staffUserId: string) {
  const [s] = await db.select().from(supportAccess).where(and(eq(supportAccess.orgId, orgId), eq(supportAccess.staffUserId, staffUserId), isNull(supportAccess.endedAt), gt(supportAccess.endsAt, new Date()))).limit(1);
  return s ?? null;
}

export async function platformRoutes(app: FastifyInstance) {
  const { db, config } = app;
  const appUrl = config.PUBLIC_APP_URL.replace(/\/$/, "");

  // Every HQ route: a signed-in member of our team (not a studio sign-in).
  app.decorateRequest("platform", null as unknown as FastifyRequest["platform"]);
  app.addHook("preHandler", async (req) => {
    if (!req.routeOptions.url?.startsWith("/v1/platform/")) return;
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    let sub: string | undefined;
    try {
      sub = (await app.verifyToken(header.slice(7))).sub;
    } catch {
      throw unauthorized();
    }
    if (!sub) throw unauthorized();
    const [s] = await db.select({ role: platformStaff.role, first: users.firstName, last: users.lastName }).from(platformStaff).innerJoin(users, eq(users.id, platformStaff.userId)).where(and(eq(platformStaff.userId, sub), eq(platformStaff.active, true)));
    // Not our staff: look like the route doesn't exist.
    if (!s) throw notFound("page");
    req.platform = { userId: sub, role: s.role, name: `${s.first} ${s.last}` };
  });
  const hq = { config: { public: true } } as const;
  await platformMigrationRoutes(app);
  await platformAssistantRoutes(app);
  await platformTrialRoutes(app);

  app.get("/platform/me", hq, async (req) => ({ ...req.platform, can: Object.fromEntries(Object.entries(CAN).map(([k, roles]) => [k, roles.includes(req.platform.role)])) }));

  // --- Overview ----------------------------------------------------------------------------
  app.get("/platform/overview", hq, async (req) => {
    requirePlatform(req, "view");
    const orgs = await db.select().from(organizations).orderBy(asc(organizations.name));
    const byLifecycle: Record<string, number> = { onboarding: 0, live: 0, paused: 0, cancelled: 0 };
    const byPlan: Record<string, number> = { essentials: 0, growth: 0, signature: 0 };
    let mrrCents = 0;
    const attention: { orgId: string; name: string; status: string; signals: string[] }[] = [];
    const onboarding: { orgId: string; name: string; plan: string; setup: string; since: Date }[] = [];
    for (const o of orgs) {
      byLifecycle[o.lifecycle] = (byLifecycle[o.lifecycle] ?? 0) + 1;
      if (o.lifecycle === "cancelled") continue;
      byPlan[o.plan] = (byPlan[o.plan] ?? 0) + 1;
      const locs = await locationCount(db, o.id);
      if (o.lifecycle === "live") mrrCents += planPrice(o.plan, locs, o.brandedApp).totalCents;
      const h = await studioHealth(db, o);
      if (h.status !== "good") attention.push({ orgId: o.id, name: o.name, status: h.status, signals: h.signals.map((s) => s.text) });
      if (o.lifecycle === "onboarding") onboarding.push({ orgId: o.id, name: o.name, plan: PLAN_INFO[o.plan].label, setup: `${h.setup.done} of ${h.setup.total} done`, since: o.createdAt });
    }
    attention.sort((a, b) => (a.status === b.status ? 0 : a.status === "problem" ? -1 : 1));
    return { studios: { total: orgs.length, byLifecycle, byPlan }, mrr: { cents: mrrCents, display: planMoney(mrrCents), note: "Live studios at plan prices. Billing isn't connected yet, so this is what they'd pay, not what's been collected." }, needsAttention: attention, onboarding };
  });

  // --- Studios -------------------------------------------------------------------------------
  app.get("/platform/studios", hq, async (req) => {
    requirePlatform(req, "view");
    const q = parse(schemas.platformStudiosQuery, req.query);
    const where = and(q.q ? ilike(organizations.name, `%${q.q}%`) : undefined, q.lifecycle ? eq(organizations.lifecycle, q.lifecycle) : undefined, q.plan ? eq(organizations.plan, q.plan) : undefined);
    const orgs = await db.select().from(organizations).where(where).orderBy(asc(organizations.name)).limit(500);
    const rows = [];
    for (const o of orgs) {
      const locs = await locationCount(db, o.id);
      const [{ n: clients } = { n: 0 }] = await db.select({ n: count }).from(memberships).where(and(eq(memberships.orgId, o.id), eq(memberships.role, "client"), eq(memberships.active, true)));
      const h = await studioHealth(db, o);
      rows.push({ id: o.id, name: o.name, plan: o.plan, planLabel: PLAN_INFO[o.plan].label, lifecycle: o.lifecycle, locations: locs, clients, price: planMoney(planPrice(o.plan, locs, o.brandedApp).totalCents), health: h.status, signals: h.signals.map((s) => s.text), setup: `${h.setup.done} of ${h.setup.total}`, lastActivityAt: h.lastActivityAt, createdAt: o.createdAt });
    }
    return { studios: rows };
  });

  /** A new studio: the studio itself, its first location, its plan (features and rules), and an invite for the owner. */
  app.post("/platform/studios", hq, async (req, reply) => {
    requirePlatform(req, "manageStudios");
    const input = parse(schemas.createStudio, req.body);
    const out = await inTx(app, async (tx) => {
      // Its booking page link (<app>/s/<slug>) comes from the name; the studio can change it.
      const [org] = await tx.insert(organizations).values({ name: input.name, timezone: input.timezone, currency: input.currency, lifecycle: "onboarding", slug: await uniqueSlug(tx, input.name) }).returning();
      await tx.insert(locations).values({ orgId: org!.id, name: input.locationName ?? input.name, timezone: input.timezone });
      // A brand-new studio has nothing running, so switching features to the plan needs no question.
      await setPlan(tx, new Flags(["plan_changes"]), org!.id, { plan: input.plan, brandedApp: input.brandedApp }, req.platform.userId);
      const email = input.owner.email.trim().toLowerCase();
      let [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`);
      u ??= (await tx.insert(users).values({ email, firstName: input.owner.firstName, lastName: input.owner.lastName }).returning())[0];
      await tx.insert(memberships).values({ orgId: org!.id, userId: u!.id, role: "owner" });
      const inviteExpiresAt = input.inviteOwner ? await sendStaffInvite(tx, appUrl, org!.id, u!.id, "owner", null) : null;
      await audit(tx, { orgId: org!.id, actorId: req.platform.userId, action: "studio.created", entityType: "organization", entityId: org!.id, details: { by: "hq", plan: input.plan, ownerEmail: email, ownerInvited: input.inviteOwner } });
      // The welcome form (and the data move behind it), ready for the owner's first sign-in.
      const [job] = await tx.insert(migrationJobs).values({ orgId: org!.id, createdBy: req.platform.userId }).returning();
      return { id: org!.id, name: org!.name, plan: input.plan, lifecycle: "onboarding", owner: { id: u!.id, email, invited: input.inviteOwner, inviteExpiresAt }, moveId: job!.id };
    });
    reply.code(201);
    return out;
  });

  app.get("/platform/studios/:orgId", hq, async (req) => {
    requirePlatform(req, "view");
    const { orgId } = parse(studioParam, req.params);
    const org = await getOrg(db, orgId).catch(() => null);
    if (!org) throw notFound("studio");
    const health = await studioHealth(db, org);
    const team = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, role: memberships.role }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, orgId), eq(memberships.active, true), inArray(memberships.role, ["owner", "admin", "front_desk", "instructor"]))).orderBy(asc(memberships.role), asc(users.firstName));
    const [{ n: clients } = { n: 0 }] = await db.select({ n: count }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client"), eq(memberships.active, true)));
    const [{ n: activePackages } = { n: 0 }] = await db.select({ n: count }).from(clientPackages).where(and(eq(clientPackages.orgId, orgId), isNull(clientPackages.cancelledAt), or(isNull(clientPackages.expiresAt), gt(clientPackages.expiresAt, new Date()))));
    const recent = await db.select({ action: auditLog.action, entityType: auditLog.entityType, at: auditLog.createdAt, actor: sql<string | null>`(select first_name || ' ' || last_name from users where id = ${auditLog.actorId})` }).from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(desc(auditLog.createdAt)).limit(25);
    const notes = await db.select({ id: platformNotes.id, kind: platformNotes.kind, body: platformNotes.body, at: platformNotes.createdAt, author: sql<string | null>`(select first_name || ' ' || last_name from users where id = ${platformNotes.authorId})` }).from(platformNotes).where(eq(platformNotes.orgId, orgId)).orderBy(desc(platformNotes.createdAt)).limit(50);
    const access = await db.select({ id: supportAccess.id, reason: supportAccess.reason, endsAt: supportAccess.endsAt, endedAt: supportAccess.endedAt, at: supportAccess.createdAt, staff: sql<string>`(select first_name || ' ' || last_name from users where id = ${supportAccess.staffUserId})`, staffUserId: supportAccess.staffUserId }).from(supportAccess).where(eq(supportAccess.orgId, orgId)).orderBy(desc(supportAccess.createdAt)).limit(20);
    const mine = await activeSupportAccess(db, orgId, req.platform.userId);
    const invites = await db.select({ userId: staffInvites.userId, sentAt: staffInvites.createdAt, expiresAt: staffInvites.expiresAt, acceptedAt: staffInvites.acceptedAt }).from(staffInvites).where(eq(staffInvites.orgId, orgId)).orderBy(desc(staffInvites.createdAt));
    const [move] = await db.select({ id: migrationJobs.id, status: migrationJobs.status, sourcePlatform: migrationJobs.sourcePlatform, formSubmittedAt: migrationJobs.formSubmittedAt, formUpdatedAt: migrationJobs.formUpdatedAt }).from(migrationJobs).where(and(eq(migrationJobs.orgId, orgId), ne(migrationJobs.status, "undone"))).orderBy(desc(migrationJobs.createdAt)).limit(1);
    return {
      studio: { id: org.id, name: org.name, lifecycle: org.lifecycle, timezone: org.timezone, currency: org.currency, createdAt: org.createdAt, studioType: org.studioType },
      plan: await planView(db, org),
      health,
      counts: { clients, activePackages, locations: await locationCount(db, orgId), admins: await adminCount(db, orgId) },
      team: team.map((t) => { const inv = invites.find((i) => i.userId === t.id); return { ...t, signIn: !inv ? "not invited" : inv.acceptedAt ? "signed in" : inv.expiresAt > new Date() ? "invited" : "invite expired" }; }),
      move: move ?? null,
      recentActivity: recent,
      notes,
      supportAccess: access.map((a) => ({ ...a, active: !a.endedAt && a.endsAt > new Date() })),
      myAccess: mine ? { id: mine.id, endsAt: mine.endsAt } : null,
    };
  });

  /** Invite the owner (and any other staff not yet signed in) to the app, once the studio is set up. Re-sending replaces the old link. */
  app.post("/platform/studios/:orgId/invite-owner", hq, async (req) => {
    requirePlatform(req, "manageStudios");
    const { orgId } = parse(studioParam, req.params);
    return inTx(app, async (tx) => {
      const [o] = await tx.select({ userId: memberships.userId, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner"))).limit(1);
      if (!o) throw notFound("owner");
      const [accepted] = await tx.select({ id: staffInvites.id }).from(staffInvites).where(and(eq(staffInvites.orgId, orgId), eq(staffInvites.userId, o.userId), isNotNull(staffInvites.acceptedAt))).limit(1);
      if (accepted) throw conflict("already_joined", "The owner has already set their password and can sign in.");
      const expiresAt = await sendStaffInvite(tx, appUrl, orgId, o.userId, "owner", null);
      await audit(tx, { orgId, actorId: req.platform.userId, action: "studio.owner_invited", entityType: "user", entityId: o.userId, details: { by: "hq" } });
      return { email: o.email, expiresAt };
    });
  });

  app.patch("/platform/studios/:orgId", hq, async (req) => {
    requirePlatform(req, "manageStudios");
    const { orgId } = parse(studioParam, req.params);
    const { lifecycle } = parse(schemas.updateStudio, req.body);
    return inTx(app, async (tx) => {
      const [before] = await tx.select({ lifecycle: organizations.lifecycle }).from(organizations).where(eq(organizations.id, orgId));
      if (!before) throw notFound("studio");
      await tx.update(organizations).set({ lifecycle }).where(eq(organizations.id, orgId));
      await audit(tx, { orgId, actorId: req.platform.userId, action: "studio.lifecycle", entityType: "organization", entityId: orgId, details: { from: before.lifecycle, to: lifecycle, by: "hq" } });
      return { id: orgId, lifecycle };
    });
  });

  /** Change a studio's plan (asks first when something switches off or limits are exceeded). */
  app.post("/platform/studios/:orgId/plan", hq, async (req) => {
    requirePlatform(req, "manageStudios");
    const { orgId } = parse(studioParam, req.params);
    const input = parse(schemas.setPlan, req.body ?? {});
    const [exists] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId));
    if (!exists) throw notFound("studio");
    return withFlags(app, input.acknowledge, (tx, flags) => setPlan(tx, flags, orgId, input, req.platform.userId));
  });

  // --- Notes ---------------------------------------------------------------------------------
  app.post("/platform/studios/:orgId/notes", hq, async (req, reply) => {
    requirePlatform(req, "notes");
    const { orgId } = parse(studioParam, req.params);
    const input = parse(schemas.platformNote, req.body);
    const [n] = await db.insert(platformNotes).values({ orgId, authorId: req.platform.userId, kind: input.kind, body: input.body }).returning();
    reply.code(201);
    return n;
  });

  // --- Support access -------------------------------------------------------------------------
  app.post("/platform/studios/:orgId/support-access", hq, async (req, reply) => {
    requirePlatform(req, "supportAccess");
    const { orgId } = parse(studioParam, req.params);
    const input = parse(schemas.supportAccessInput, req.body);
    return inTx(app, async (tx) => {
      const [org] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId));
      if (!org) throw notFound("studio");
      if (await activeSupportAccess(tx as never, orgId, req.platform.userId)) throw conflict("already_open", "You already have access to this studio. End it first to start a new one.");
      const endsAt = new Date(Date.now() + input.minutes * 60_000);
      const [s] = await tx.insert(supportAccess).values({ orgId, staffUserId: req.platform.userId, reason: input.reason, endsAt }).returning();
      // In the studio's own log: they can see who looked, why and for how long.
      await audit(tx, { orgId, actorId: req.platform.userId, action: "support_access.started", entityType: "support_access", entityId: s!.id, details: { reason: input.reason, minutes: input.minutes } });
      reply.code(201);
      return { id: s!.id, endsAt };
    });
  });
  app.post("/platform/support-access/:id/end", hq, async (req) => {
    requirePlatform(req, "supportAccess");
    const { id } = parse(idParam, req.params);
    const [s] = await db.update(supportAccess).set({ endedAt: new Date() }).where(and(eq(supportAccess.id, id), eq(supportAccess.staffUserId, req.platform.userId), isNull(supportAccess.endedAt))).returning();
    if (!s) throw notFound("support access");
    await audit(db, { orgId: s.orgId, actorId: req.platform.userId, action: "support_access.ended", entityType: "support_access", entityId: s.id });
    return { id: s.id, ended: true };
  });

  /** A studio's clients, with contact details: only during this staff member's support access. Each look is logged. */
  app.get("/platform/studios/:orgId/clients", hq, async (req) => {
    requirePlatform(req, "supportAccess");
    const { orgId } = parse(studioParam, req.params);
    const q = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
    const access = await activeSupportAccess(db, orgId, req.platform.userId);
    if (!access) throw forbidden("Start support access for this studio first (with a reason). The studio will see it.");
    const rows = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, since: memberships.createdAt }).from(memberships).innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client"), q.q ? or(ilike(users.firstName, `%${q.q}%`), ilike(users.lastName, `%${q.q}%`), ilike(users.email, `%${q.q}%`)) : undefined)).orderBy(asc(users.firstName)).limit(100);
    await audit(db, { orgId, actorId: req.platform.userId, action: "support_access.viewed_clients", entityType: "support_access", entityId: access.id, details: { search: q.q ?? null, results: rows.length } });
    return { clients: rows, accessEndsAt: access.endsAt };
  });

  // --- Our staff ---------------------------------------------------------------------------------
  app.get("/platform/staff", hq, async (req) => {
    requirePlatform(req, "manageStaff");
    return { staff: await db.select({ userId: platformStaff.userId, role: platformStaff.role, active: platformStaff.active, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(platformStaff).innerJoin(users, eq(users.id, platformStaff.userId)).orderBy(asc(users.firstName)) };
  });
}

/** For studios: the support access our team has had (owners and admins). */
export async function studioSupportAccessRoutes(app: FastifyInstance) {
  app.get("/support-access", async (req) => {
    requirePermission(req, "manageSettings");
    const rows = await app.db.select({ id: supportAccess.id, reason: supportAccess.reason, at: supportAccess.createdAt, endsAt: supportAccess.endsAt, endedAt: supportAccess.endedAt, staff: sql<string>`(select first_name || ' ' || last_name from users where id = ${supportAccess.staffUserId})` }).from(supportAccess).where(eq(supportAccess.orgId, req.auth.orgId)).orderBy(desc(supportAccess.createdAt)).limit(50);
    return { sessions: rows.map((r) => ({ ...r, active: !r.endedAt && r.endsAt > new Date(), who: `${r.staff} (our support team)` })) };
  });
  /** A studio can end our access at any time. */
  app.post("/support-access/:id/end", async (req) => {
    requirePermission(req, "manageSettings");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [s] = await app.db.update(supportAccess).set({ endedAt: new Date() }).where(and(eq(supportAccess.id, id), eq(supportAccess.orgId, req.auth.orgId), isNull(supportAccess.endedAt))).returning();
    if (!s) throw notFound("support access");
    await audit(app.db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "support_access.ended_by_studio", entityType: "support_access", entityId: s.id });
    return { id: s.id, ended: true };
  });
}
