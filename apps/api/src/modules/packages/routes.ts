import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { EXTENSION_STATUSES, can, describePackage, schemas } from "@studio/shared";
import { z } from "zod";
import { classTypes, packageCategories, packagePlans } from "../../db/schema.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { assertFile } from "../files/routes.js";
import { money } from "../bookings/rules.js";
import { getOrg, getSession } from "../sessions/context.js";
import * as life from "./lifecycle.js";
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });
const memberParam = z.object({ id: schemas.id, userId: schemas.id });
const optionsQuery = z.object({ clientId: schemas.id.optional() });
const plansQuery = z.object({ archived: z.stringbool().default(false) });
const requestsQuery = z.object({ status: z.enum(EXTENSION_STATUSES).default("pending") });

type Plan = typeof packagePlans.$inferSelect;

export async function packageRoutes(app: FastifyInstance) {
  const { db } = app;

  /** A package type with its rules in plain English, photo, category and (for admins) how much it's used. */
  async function presentPlans(orgId: string, rows: Plan[], forAdmin: boolean) {
    const org = await getOrg(db, orgId);
    const ids = [...new Set(rows.flatMap((r) => r.classTypeIds))];
    const types = ids.length ? await db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(inArray(classTypes.id, ids)) : [];
    const name = new Map(types.map((t) => [t.id, t.name]));
    const usage = forAdmin ? await life.planUsage(db, orgId) : new Map();
    return rows.map((r) => ({
      ...r,
      price: money(r.priceCents, org.currency),
      photoUrl: r.photoFileId ? `/v1/files/${r.photoFileId}` : null,
      terms: describePackage(r, r.classTypeIds.map((id) => name.get(id) ?? "").filter(Boolean)),
      ...(forAdmin ? { usage: usage.get(r.id) } : {}),
    }));
  }

  async function checkRefs(orgId: string, body: { photoFileId?: string | null; categoryId?: string | null; classTypeIds?: string[] }) {
    if (body.photoFileId) await assertFile(db, orgId, body.photoFileId, "package_photo");
    if (body.categoryId) {
      const [c] = await db.select({ id: packageCategories.id }).from(packageCategories).where(and(eq(packageCategories.id, body.categoryId), eq(packageCategories.orgId, orgId)));
      if (!c) throw notFound("category");
    }
    if (body.classTypeIds?.length) {
      const found = await db.select({ id: classTypes.id }).from(classTypes).where(and(eq(classTypes.orgId, orgId), inArray(classTypes.id, body.classTypeIds)));
      if (found.length !== new Set(body.classTypeIds).size) throw notFound("class type");
    }
  }

  // --- Categories -------------------------------------------------------------------
  app.get("/package-categories", async (req) => db.select().from(packageCategories).where(eq(packageCategories.orgId, req.auth.orgId)).orderBy(asc(packageCategories.sortOrder), asc(packageCategories.name)));
  app.post("/package-categories", async (req, reply) => {
    requirePermission(req, "managePackages");
    const input = parse(schemas.packageCategory, req.body);
    const existing = await db.select({ id: packageCategories.id }).from(packageCategories).where(eq(packageCategories.orgId, req.auth.orgId));
    const [c] = await db.insert(packageCategories).values({ ...input, orgId: req.auth.orgId, sortOrder: existing.length }).returning();
    reply.code(201);
    return c;
  });
  app.patch("/package-categories/:id", async (req) => {
    requirePermission(req, "managePackages");
    const { id } = parse(idParam, req.params);
    const [c] = await db.update(packageCategories).set(parse(schemas.updatePackageCategory, req.body)).where(and(eq(packageCategories.id, id), eq(packageCategories.orgId, req.auth.orgId))).returning();
    if (!c) throw notFound("category");
    return c;
  });
  /** Removing a category keeps its packages; they move to "Other". */
  app.delete("/package-categories/:id", async (req, reply) => {
    requirePermission(req, "managePackages");
    const { id } = parse(idParam, req.params);
    const [c] = await db.delete(packageCategories).where(and(eq(packageCategories.id, id), eq(packageCategories.orgId, req.auth.orgId))).returning();
    if (!c) throw notFound("category");
    return reply.code(204).send();
  });
  app.put("/package-categories/order", async (req) => {
    requirePermission(req, "managePackages");
    const { ids } = parse(schemas.reorderCategories, req.body);
    await inTx(app, async (tx) => {
      for (const [i, id] of ids.entries()) await tx.update(packageCategories).set({ sortOrder: i }).where(and(eq(packageCategories.id, id), eq(packageCategories.orgId, req.auth.orgId)));
    });
    return db.select().from(packageCategories).where(eq(packageCategories.orgId, req.auth.orgId)).orderBy(asc(packageCategories.sortOrder));
  });

  // --- Package types ------------------------------------------------------------------
  /**
   * Clients: what's on sale, grouped by category (in the studio's order), for the buying page.
   * Admins: every package type with usage; archived ones only with ?archived=true.
   */
  app.get("/package-plans", async (req) => {
    const admin = can(req.auth.role, "managePackages");
    const { archived } = parse(plansQuery, req.query);
    const rows = await db
      .select()
      .from(packagePlans)
      .where(and(eq(packagePlans.orgId, req.auth.orgId), admin ? (archived ? isNotNull(packagePlans.archivedAt) : isNull(packagePlans.archivedAt)) : and(eq(packagePlans.onSale, true), isNull(packagePlans.archivedAt))))
      .orderBy(asc(packagePlans.priceCents));
    const plans = await presentPlans(req.auth.orgId, rows, admin);
    if (admin) return plans;
    const cats = await db.select().from(packageCategories).where(eq(packageCategories.orgId, req.auth.orgId)).orderBy(asc(packageCategories.sortOrder));
    const groups = cats.map((c) => ({ id: c.id, name: c.name, description: c.description, packages: plans.filter((p) => p.categoryId === c.id) })).filter((g) => g.packages.length);
    const other = plans.filter((p) => !p.categoryId || !cats.some((c) => c.id === p.categoryId));
    return { categories: other.length ? [...groups, { id: null, name: groups.length ? "Other" : "Packages", description: null, packages: other }] : groups };
  });

  app.post("/package-plans", async (req, reply) => {
    requirePermission(req, "managePackages");
    const input = parse(schemas.packagePlan, req.body);
    await checkRefs(req.auth.orgId, input);
    const [plan] = await db.insert(packagePlans).values({ ...input, orgId: req.auth.orgId }).returning();
    reply.code(201);
    return (await presentPlans(req.auth.orgId, [plan!], true))[0];
  });

  /** Change a package type for new sales, existing packages, or both (see schemas.updatePackagePlan). */
  app.patch("/package-plans/:id", async (req) => {
    requirePermission(req, "managePackages");
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.updatePackagePlan, req.body);
    await checkRefs(req.auth.orgId, input.changes);
    const result = await withFlags(app, input.acknowledge, (tx, flags) => life.updatePlan(tx, req.auth, id, input, flags));
    return { ...(await presentPlans(req.auth.orgId, [result.plan], true))[0], packagesChanged: result.packagesChanged, flags: result.flags };
  });

  app.post("/package-plans/:id/archive", async (req) => {
    const { id } = parse(idParam, req.params);
    return inTx(app, (tx) => life.setArchived(tx, req.auth, id, true));
  });
  app.post("/package-plans/:id/restore", async (req) => {
    const { id } = parse(idParam, req.params);
    return inTx(app, (tx) => life.setArchived(tx, req.auth, id, false));
  });
  app.delete("/package-plans/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { confirmName } = parse(schemas.deletePackagePlan, req.body);
    return inTx(app, (tx) => life.deletePlan(tx, req.auth, id, confirmName));
  });

  // --- A client's packages --------------------------------------------------------------
  app.get("/clients/:id/packages", async (req) => {
    requirePermission(req, "managePackages");
    const { id } = parse(idParam, req.params);
    const org = await getOrg(db, req.auth.orgId);
    return svc.presentPackages(db, org, await svc.packagesFor(db, req.auth.orgId, id), id);
  });

  /** Sell a package at the desk, optionally bringing unused classes across from another package. */
  app.post("/clients/:id/packages", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.sellPackage, req.body);
    reply.code(201);
    return inTx(app, async (tx) => {
      const sold = await svc.sellPackage(tx, req.auth, id, input);
      if (!input.rolloverFromPackageId) return sold;
      const r = await life.rolloverInto(tx, req.auth, sold.id, { fromPackageId: input.rolloverFromPackageId });
      const org = await getOrg(tx, req.auth.orgId);
      return { ...(await svc.presentPackages(tx, org, [await svc.getPackage(tx, req.auth.orgId, sold.id)]))[0], rolledOver: r.rolledOver };
    });
  });

  /** Packages I can use (bought or shared with me), plus the studio's extension rules. */
  app.get("/me/packages", async (req) => {
    const org = await getOrg(db, req.auth.orgId);
    const packages = await svc.presentPackages(db, org, await svc.packagesFor(db, req.auth.orgId, req.auth.userId), req.auth.userId);
    return { packages, extensions: life.extensionPolicy(org) };
  });

  /** One package: classes booked with it, every change (including the studio's adjustments) and extension requests. */
  app.get("/client-packages/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return life.packageHistory(db, req.auth, id);
  });

  app.post("/client-packages/:id/adjust", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.adjustPackage, req.body);
    return inTx(app, (tx) => svc.adjustPackage(tx, req.auth, id, input));
  });
  app.post("/client-packages/:id/cancel", async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(schemas.cancelPackage, req.body);
    return withFlags(app, [], async (tx, flags) => svc.cancelPackage(tx, req.auth, id, reason, flags));
  });
  app.delete("/client-packages/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { confirmName } = parse(schemas.deleteClientPackage, req.body);
    return inTx(app, (tx) => life.deleteClientPackage(tx, req.auth, id, confirmName));
  });
  app.post("/client-packages/:id/rollover", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.rollover, req.body);
    return inTx(app, (tx) => life.rolloverInto(tx, req.auth, id, input));
  });
  app.post("/client-packages/:id/stop-renewing", async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(schemas.stopRenewing, req.body ?? {});
    return inTx(app, (tx) => life.stopRenewing(tx, req.auth, id, reason));
  });
  app.post("/client-packages/:id/resume-renewing", async (req) => {
    const { id } = parse(idParam, req.params);
    return inTx(app, (tx) => life.resumeRenewing(tx, req.auth, id));
  });

  // --- Extensions ------------------------------------------------------------------------
  app.post("/client-packages/:id/extension-requests", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.requestExtension, req.body);
    reply.code(201);
    return inTx(app, (tx) => life.requestExtension(tx, req.auth, id, input));
  });
  app.get("/extension-requests", async (req) => {
    const { status } = parse(requestsQuery, req.query);
    return life.listExtensionRequests(db, req.auth, status);
  });
  app.post("/extension-requests/:id/approve", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.approveExtension, req.body ?? {});
    return inTx(app, (tx) => life.approveExtension(tx, req.auth, id, input));
  });
  app.post("/extension-requests/:id/decline", async (req) => {
    const { id } = parse(idParam, req.params);
    const { note } = parse(schemas.declineExtension, req.body);
    return inTx(app, (tx) => life.declineExtension(tx, req.auth, id, note));
  });
  app.post("/extension-requests/:id/withdraw", async (req) => {
    const { id } = parse(idParam, req.params);
    return inTx(app, (tx) => life.withdrawExtension(tx, req.auth, id));
  });

  // --- Sharing -------------------------------------------------------------------------------
  app.post("/client-packages/:id/members", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.addPackageSharer, req.body);
    reply.code(201);
    return inTx(app, (tx) => svc.addSharer(tx, req.auth, id, input));
  });
  app.delete("/client-packages/:id/members/:userId", async (req) => {
    const { id, userId } = parse(memberParam, req.params);
    return inTx(app, (tx) => svc.removeSharer(tx, req.auth, id, userId));
  });
  app.put("/client-packages/:id/allocations", async (req) => {
    const { id } = parse(idParam, req.params);
    const { allocations } = parse(schemas.setPackageAllocations, req.body);
    return inTx(app, (tx) => svc.setAllocations(tx, req.auth, id, allocations));
  });

  /**
   * "Pay with" on the booking screen: every package the client has, whether it can be used
   * for this class (and if not, why), and which one we'd use.
   */
  app.get("/sessions/:id/package-options", async (req) => {
    const { id } = parse(idParam, req.params);
    const { clientId } = parse(optionsQuery, req.query);
    const isClient = req.auth.role === "client";
    if (!isClient && !can(req.auth.role, "manageBookings")) throw forbidden();
    if (!isClient && !clientId) throw notFound("client");
    const who = isClient ? req.auth.userId : clientId!;
    const org = await getOrg(db, req.auth.orgId);
    const s = await getSession(db, req.auth.orgId, id);
    const options = await svc.packageOptions(db, org, who, s);
    const shown = await svc.presentPackages(db, org, options.map((o) => o.pkg), who);
    return {
      packageNeeded: org.clientsNeedPackage,
      suggested: options.find((o) => o.ok)?.pkg.id ?? null,
      options: options.map((o, i) => ({ ...shown[i], usable: o.ok, reason: o.reason ?? null })),
      ...(options.some((o) => o.ok) ? {} : { message: svc.whyNoPackage(options, isClient) }),
    };
  });

}
