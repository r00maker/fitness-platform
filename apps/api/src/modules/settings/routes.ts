import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { FIELDS, FLAG_TITLES, OPTION_LABELS, can, schemas } from "@studio/shared";
import { memberships, organizations, pushTokens, users } from "../../db/schema.js";
import { parse } from "../../lib/validate.js";
import { requirePermission, requireRole } from "../../plugins/auth.js";
import { badRequest } from "../../lib/errors.js";
import { money } from "../bookings/rules.js";
import { getOrg } from "../sessions/context.js";

export async function settingsRoutes(app: FastifyInstance) {
  /** Labels and tooltips, so the apps can update wording without a new app release. */
  app.get("/meta/fields", { config: { public: true } }, async () => ({ fields: FIELDS, options: OPTION_LABELS, flags: FLAG_TITLES }));

  app.get("/me", async (req) => {
    const [u] = await app.db.select().from(users).where(eq(users.id, req.auth.userId));
    return { ...u, role: req.auth.role, orgId: req.auth.orgId };
  });

  app.post("/me/push-tokens", async (req, reply) => {
    const input = parse(schemas.registerPushToken, req.body);
    await app.db
      .insert(pushTokens)
      .values({ ...input, userId: req.auth.userId })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId: req.auth.userId, platform: input.platform } });
    return reply.code(204).send();
  });

  /** Admins get every setting; everyone else gets the studio's policies in plain terms. */
  app.get("/settings", async (req) => {
    const org = await getOrg(app.db, req.auth.orgId);
    if (can(req.auth.role, "manageSettings")) return org;
    return {
      waitlistExpiryOptionsHours: org.waitlistExpiryOptionsHours,
      lateCancelWindowHours: org.lateCancelWindowHours,
      bookingOpensDaysBefore: org.bookingOpensDaysBefore,
      bookingClosesMinutesBefore: org.bookingClosesMinutesBefore,
      weeklyBookingLimit: org.weeklyBookingLimit,
      lateCancelFee: org.lateCancelFeeEnabled ? money(org.lateCancelFeeCents, org.currency) : null,
      noShowFee: org.noShowFeeEnabled ? money(org.noShowFeeCents, org.currency) : null,
    };
  });

  app.patch("/settings", async (req) => {
    requirePermission(req, "manageSettings");
    const input = parse(schemas.updateOrgSettings, req.body);
    const current = await getOrg(app.db, req.auth.orgId);
    const next = { ...current, ...input };
    const fields: Record<string, string> = {};
    if (next.lateCancelFeeEnabled && next.lateCancelFeeCents <= 0) fields.lateCancelFeeCents = "Set the fee amount, or switch the fee off.";
    if (next.noShowFeeEnabled && next.noShowFeeCents <= 0) fields.noShowFeeCents = "Set the fee amount, or switch the fee off.";
    if (Object.keys(fields).length) throw badRequest("invalid_input", "Some details need fixing.", { fields });
    const [org] = await app.db.update(organizations).set(input).where(eq(organizations.id, req.auth.orgId)).returning();
    return org;
  });

  app.get("/staff", async (req) => {
    requireRole(req, ["owner", "admin", "front_desk", "instructor"]);
    return app.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, req.auth.orgId))
      .then((rows) => rows.filter((r) => r.role !== "client"));
  });
}
