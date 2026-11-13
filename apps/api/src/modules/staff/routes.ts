/**
 * Staff accounts. Owners and admins add staff by email; the new person gets an email with a link
 * to set their password. Passwords never pass through us: the link opens the app's "set your
 * password" page, which creates the sign-in with the studio's sign-in provider (Clerk, Auth0, ...)
 * for that email, then marks the invite accepted here. No 2FA is required for staff.
 *
 * Safeguards: only the owner adds or removes admins; nobody can remove the owner or themselves;
 * invite links are random, stored only as a hash, single-use and expire after 7 days.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { OPTION_LABELS, schemas } from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { memberships, organizations, staffInvites, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { randomToken, sha256 } from "../../lib/secrets.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { notify } from "../notifications/outbox.js";

const INVITE_DAYS = 7;
const STAFF_ROLES = ["owner", "admin", "front_desk", "instructor"] as const;
const userParam = z.object({ userId: schemas.id });
const tokenParam = z.object({ token: z.string().regex(/^[a-f0-9]{48}$/) });
const roleLabel = (r: string) => OPTION_LABELS.role[r as keyof typeof OPTION_LABELS.role] ?? r;

export async function staffRoutes(app: FastifyInstance) {
  const { db, config } = app;
  const appUrl = config.PUBLIC_APP_URL.replace(/\/$/, "");

  /** Create a fresh invite link and email it. Earlier links for this person stop working. */
  async function sendInvite(tx: DbOrTx, orgId: string, userId: string, role: string, invitedBy: string) {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
    const [by] = await tx.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, invitedBy));
    await tx.delete(staffInvites).where(and(eq(staffInvites.orgId, orgId), eq(staffInvites.userId, userId), sql`${staffInvites.acceptedAt} is null`));
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    await tx.insert(staffInvites).values({ orgId, userId, email: u!.email, role: role as never, tokenHash: sha256(token), expiresAt, invitedBy });
    await notify(tx, {
      orgId, userIds: [userId], template: "staff.invite", channels: ["email"],
      data: { firstName: u!.firstName, email: u!.email, studioName: org!.name, invitedBy: by ? `${by.first} ${by.last}` : "The studio", roleLabel: roleLabel(role).toLowerCase(), link: `${appUrl}/staff-invite/${token}` },
    });
    return expiresAt;
  }

  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => requirePermission(req, "manageStaff"));

    /** Everyone on the team, with whether they've set their password yet. */
    admin.get("/staff/team", async (req) => {
      const rows = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, role: memberships.role, active: memberships.active })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.orgId, req.auth.orgId), inArray(memberships.role, [...STAFF_ROLES])));
      const invites = await db.select().from(staffInvites).where(eq(staffInvites.orgId, req.auth.orgId));
      return rows
        .filter((r) => r.active)
        .map((r) => {
          const mine = invites.filter((i) => i.userId === r.id);
          const pending = mine.find((i) => !i.acceptedAt);
          const accepted = mine.some((i) => i.acceptedAt);
          return {
            ...r,
            roleLabel: roleLabel(r.role),
            status: accepted || !mine.length ? "active" : pending && pending.expiresAt > new Date() ? "invited" : "invite_expired",
            inviteExpiresAt: pending?.expiresAt ?? null,
          };
        });
    });

    /** Add a staff member: they get an email to set their password. */
    admin.post("/staff/invites", async (req, reply) => {
      const input = parse(schemas.inviteStaff, req.body);
      if (input.role === "admin" && req.auth.role !== "owner") throw forbidden("Only the owner can add admins.");
      const email = input.email.trim().toLowerCase();
      const out = await inTx(app, async (tx) => {
        let [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`);
        if (u) {
          const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, u.id)));
          if (m?.role === "client") throw conflict("already_client", `${email} belongs to one of your clients. Staff need their own sign-in: use a different email address (for example a work one).`);
          if (m?.active) throw conflict("already_staff", `${u.firstName} ${u.lastName} is already on your team.`);
          if (m) await tx.update(memberships).set({ active: true, role: input.role }).where(eq(memberships.id, m.id));
          else await tx.insert(memberships).values({ orgId: req.auth.orgId, userId: u.id, role: input.role });
        } else {
          [u] = await tx.insert(users).values({ email, firstName: input.firstName, lastName: input.lastName, phone: input.phone ?? null }).returning();
          await tx.insert(memberships).values({ orgId: req.auth.orgId, userId: u!.id, role: input.role });
        }
        const expiresAt = await sendInvite(tx, req.auth.orgId, u!.id, input.role, req.auth.userId);
        await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "staff.invited", entityType: "user", entityId: u!.id, details: { role: input.role } });
        return { id: u!.id, email, role: input.role, status: "invited", inviteExpiresAt: expiresAt };
      });
      reply.code(201);
      return out;
    });

    admin.post("/staff/:userId/resend-invite", async (req) => {
      const { userId } = parse(userParam, req.params);
      return inTx(app, async (tx) => {
        const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, userId), eq(memberships.active, true)));
        if (!m || m.role === "client") throw notFound("staff member");
        const [done] = await tx.select({ id: staffInvites.id }).from(staffInvites).where(and(eq(staffInvites.orgId, req.auth.orgId), eq(staffInvites.userId, userId), sql`${staffInvites.acceptedAt} is not null`));
        if (done) throw conflict("already_accepted", "They've already set their password. If they've forgotten it, they can reset it from the sign-in page.");
        return { inviteExpiresAt: await sendInvite(tx, req.auth.orgId, userId, m.role, req.auth.userId) };
      });
    });

    admin.patch("/staff/:userId/role", async (req) => {
      const { userId } = parse(userParam, req.params);
      const { role } = parse(schemas.changeStaffRole, req.body);
      return inTx(app, async (tx) => {
        const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, userId), eq(memberships.active, true)));
        if (!m || m.role === "client") throw notFound("staff member");
        if (m.role === "owner") throw forbidden("The owner's role can't be changed here.");
        if (userId === req.auth.userId) throw badRequest("own_role", "You can't change your own role. Ask the owner.");
        if ((role === "admin" || m.role === "admin") && req.auth.role !== "owner") throw forbidden("Only the owner can make someone an admin or change an admin's role.");
        await tx.update(memberships).set({ role }).where(eq(memberships.id, m.id));
        await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "staff.role_changed", entityType: "user", entityId: userId, details: { from: m.role, to: role } });
        return { id: userId, role, roleLabel: roleLabel(role) };
      });
    });

    /** Remove someone's access to this studio. Their past classes and pay records stay. */
    admin.delete("/staff/:userId", async (req, reply) => {
      const { userId } = parse(userParam, req.params);
      await inTx(app, async (tx) => {
        const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, userId), eq(memberships.active, true)));
        if (!m || m.role === "client") throw notFound("staff member");
        if (m.role === "owner") throw forbidden("The owner can't be removed.");
        if (userId === req.auth.userId) throw badRequest("remove_self", "You can't remove yourself.");
        if (m.role === "admin" && req.auth.role !== "owner") throw forbidden("Only the owner can remove an admin.");
        await tx.update(memberships).set({ active: false }).where(eq(memberships.id, m.id));
        await tx.delete(staffInvites).where(and(eq(staffInvites.orgId, req.auth.orgId), eq(staffInvites.userId, userId), sql`${staffInvites.acceptedAt} is null`));
        await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "staff.removed", entityType: "user", entityId: userId });
      });
      return reply.code(204).send();
    });
  });

  // --- Public: the "set your password" page --------------------------------------------
  const findInvite = async (token: string) => {
    const [i] = await db.select().from(staffInvites).where(eq(staffInvites.tokenHash, sha256(token)));
    return i;
  };
  /** What the set-password page shows. Only someone with the emailed link can see it. */
  app.get("/public/staff-invites/:token", { config: { public: true, rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    const i = await findInvite(token);
    if (!i || i.acceptedAt) throw notFound("invite");
    if (i.expiresAt <= new Date()) throw conflict("invite_expired", "This link has expired. Ask the studio to send a new one.");
    const [u] = await db.select({ firstName: users.firstName }).from(users).where(eq(users.id, i.userId));
    const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, i.orgId));
    // userId lets the app create the sign-in with the provider linked to this account.
    return { studio: org!.name, firstName: u!.firstName, email: i.email, role: i.role, roleLabel: roleLabel(i.role), userId: i.userId, orgId: i.orgId };
  });
  /** Called by the app once the password has been set with the sign-in provider. Single use. */
  app.post("/public/staff-invites/:token/accept", { config: { public: true, rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { token } = parse(tokenParam, req.params);
    const i = await findInvite(token);
    if (!i || i.acceptedAt) throw notFound("invite");
    if (i.expiresAt <= new Date()) throw conflict("invite_expired", "This link has expired. Ask the studio to send a new one.");
    await db.update(staffInvites).set({ acceptedAt: new Date() }).where(eq(staffInvites.id, i.id));
    await audit(db, { orgId: i.orgId, actorId: i.userId, action: "staff.invite_accepted", entityType: "user", entityId: i.userId });
    return { accepted: true };
  });
}
