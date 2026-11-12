import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { can, describePackage, schemas } from "@studio/shared";
import { z } from "zod";
import { classTypes, packagePlans } from "../../db/schema.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { getOrg, getSession } from "../sessions/context.js";
import * as svc from "./service.js";

const idParam = z.object({ id: schemas.id });
const memberParam = z.object({ id: schemas.id, userId: schemas.id });
const optionsQuery = z.object({ clientId: schemas.id.optional() });

export async function packageRoutes(app: FastifyInstance) {
  const { db } = app;

  /** A package type with its terms in plain English and its price. */
  async function presentPlans(orgId: string, rows: (typeof packagePlans.$inferSelect)[]) {
    const org = await getOrg(db, orgId);
    const ids = [...new Set(rows.flatMap((r) => r.classTypeIds))];
    const types = ids.length ? await db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(inArray(classTypes.id, ids)) : [];
    const name = new Map(types.map((t) => [t.id, t.name]));
    return rows.map((r) => ({ ...r, price: money(r.priceCents, org.currency), terms: describePackage(r, r.classTypeIds.map((id) => name.get(id) ?? "").filter(Boolean)) }));
  }

  // --- Package types (what the studio sells) --------------------------------
  /** Everyone can see what's on sale; admins also see packages taken off sale. */
  app.get("/package-plans", async (req) => {
    const all = can(req.auth.role, "managePackages");
    const rows = await db
      .select()
      .from(packagePlans)
      .where(and(eq(packagePlans.orgId, req.auth.orgId), all ? undefined : eq(packagePlans.onSale, true)))
      .orderBy(asc(packagePlans.priceCents));
    return presentPlans(req.auth.orgId, rows);
  });

  app.post("/package-plans", async (req, reply) => {
    requirePermission(req, "managePackages");
    const input = parse(schemas.packagePlan, req.body);
    if (input.classTypeIds.length) {
      const found = await db.select({ id: classTypes.id }).from(classTypes).where(and(eq(classTypes.orgId, req.auth.orgId), inArray(classTypes.id, input.classTypeIds)));
      if (found.length !== new Set(input.classTypeIds).size) throw notFound("class type");
    }
    const [plan] = await db.insert(packagePlans).values({ ...input, orgId: req.auth.orgId }).returning();
    reply.code(201);
    return (await presentPlans(req.auth.orgId, [plan!]))[0];
  });

  /**
   * Only the name, description, price and whether it's on sale can change. The terms
   * can't, because people may already have bought it: set up a new package type instead.
   */
  app.patch("/package-plans/:id", async (req) => {
    requirePermission(req, "managePackages");
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.updatePackagePlan, req.body);
    const [plan] = await db.update(packagePlans).set(input).where(and(eq(packagePlans.id, id), eq(packagePlans.orgId, req.auth.orgId))).returning();
    if (!plan) throw notFound("package type");
    return (await presentPlans(req.auth.orgId, [plan]))[0];
  });

  // --- A client's packages ---------------------------------------------------
  app.get("/clients/:id/packages", async (req) => {
    requirePermission(req, "managePackages");
    const { id } = parse(idParam, req.params);
    const org = await getOrg(db, req.auth.orgId);
    return svc.presentPackages(db, org, await svc.packagesFor(db, req.auth.orgId, id), id);
  });

  app.post("/clients/:id/packages", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.sellPackage, req.body);
    reply.code(201);
    return inTx(app, (tx) => svc.sellPackage(tx, req.auth, id, input));
  });

  /** Packages I can use: ones I bought and ones shared with me. */
  app.get("/me/packages", async (req) => {
    const org = await getOrg(db, req.auth.orgId);
    return svc.presentPackages(db, org, await svc.packagesFor(db, req.auth.orgId, req.auth.userId), req.auth.userId);
  });

  /** One package with its full history. For admins, the buyer and anyone sharing it. */
  app.get("/client-packages/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const org = await getOrg(db, req.auth.orgId);
    const p = await svc.getPackage(db, req.auth.orgId, id);
    const [shown] = await svc.presentPackages(db, org, [p], req.auth.userId);
    if (!can(req.auth.role, "managePackages") && !shown!.sharing.members.some((m) => m.userId === req.auth.userId)) throw notFound("package");
    const history = (await svc.ledgerFor(db, id)).map((h) => ({ ...h, person: h.first ? `${h.first} ${h.last}` : null, first: undefined, last: undefined }));
    return { ...shown, history };
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

  // --- Sharing -------------------------------------------------------------------
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
   * for this class (and if not, why), and which one we'd use. Clients ask for themselves;
   * admins pass clientId.
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
