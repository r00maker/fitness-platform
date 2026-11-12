import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { ACTION_HELP, FIELDS, FLAG_TITLES, HELP_TIP_DELAY_MS, NAV_ITEMS, OPTION_LABELS, can, schemas } from "@studio/shared";
import { memberships, organizations, pushTokens, users } from "../../db/schema.js";
import { parse } from "../../lib/validate.js";
import { requirePermission, requireRole } from "../../plugins/auth.js";
import { badRequest } from "../../lib/errors.js";
import { money } from "../bookings/rules.js";
import { getOrg } from "../sessions/context.js";
import { instructorHistory } from "../sessions/people.js";

export async function settingsRoutes(app: FastifyInstance) {
  /** Labels and tooltips, so the apps can update wording without a new app release. */
  app.get("/meta/fields", { config: { public: true } }, async () => ({ fields: FIELDS, options: OPTION_LABELS, flags: FLAG_TITLES, actions: ACTION_HELP, nav: NAV_ITEMS, helpTipDelayMs: HELP_TIP_DELAY_MS }));

  app.get("/me", async (req) => {
    const [u] = await app.db.select().from(users).where(eq(users.id, req.auth.userId));
    if (req.auth.role !== "client") return { ...u, role: req.auth.role, orgId: req.auth.orgId };
    // Clients: their favourite instructor, for the one-tap "Classes with …" filter.
    const fav = (await instructorHistory(app.db, req.auth.orgId, [req.auth.userId])).favourite.get(req.auth.userId);
    const [i] = fav ? await app.db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, photoUrl: users.photoUrl }).from(users).where(eq(users.id, fav.instructorId)) : [];
    return {
      ...u,
      role: req.auth.role,
      orgId: req.auth.orgId,
      favouriteInstructor: i ? { id: i.id, name: `${i.firstName} ${i.lastName}`, firstName: i.firstName, photoUrl: i.photoUrl, classes: fav!.classes } : null,
    };
  });

  /** Personal preferences (any role). */
  app.patch("/me/preferences", async (req) => {
    const input = parse(schemas.updatePreferences, req.body);
    const [u] = await app.db.update(users).set(input).where(eq(users.id, req.auth.userId)).returning({ theme: users.theme });
    return u;
  });

  /** Clients choose whether other members see them on class lists. */
  app.patch("/me/privacy", async (req) => {
    const input = parse(schemas.updatePrivacy, req.body);
    const [m] = await app.db
      .update(memberships)
      .set(input)
      .where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, req.auth.userId)))
      .returning({ showInAttendeeList: memberships.showInAttendeeList });
    return m;
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
      waiverRequired: org.waiverRequired,
      spotBookingEnabled: org.spotBookingEnabled,
      clientsNeedPackage: org.clientsNeedPackage,
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
    // New wording = new version; earlier signatures stay valid and record the version they signed.
    const waiverVersion = input.waiverText !== undefined && input.waiverText !== current.waiverText ? current.waiverVersion + 1 : current.waiverVersion;
    const [org] = await app.db.update(organizations).set({ ...input, waiverVersion }).where(eq(organizations.id, req.auth.orgId)).returning();
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
