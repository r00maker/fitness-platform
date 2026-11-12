/**
 * Checkout: a client buying a package.
 *
 *  1. GET /checkout/quote shows what they're buying: the rules in plain English, the price,
 *     start-date choices and any classes they can roll over.
 *  2. POST /checkout creates an order. When a payment provider is connected, the response
 *     includes the provider's payment page; until then the client pays at the desk.
 *  3. The order becomes a package once paid: by the provider's webhook (later), or an admin
 *     marking it paid at the desk (POST /orders/:id/mark-paid).
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { can, schemas } from "@studio/shared";
import { DateTime } from "luxon";
import { z } from "zod";
import { orders, packagePlans, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { getOrg } from "../sessions/context.js";
import { planTerms, rolloverInto, rolloverOptions } from "../packages/lifecycle.js";
import { orgZone, sellPackage } from "../packages/service.js";

/**
 * The seam for a payment provider (e.g. Stripe, HitPay, 2C2P). When one is configured it
 * returns the page to send the client to; the provider then calls back to mark the order paid.
 */
export interface PaymentProvider {
  name: string;
  createPayment(order: { id: string; amountCents: number; currency: string; description: string }): Promise<{ redirectUrl: string; ref: string }>;
}
let provider: PaymentProvider | null = null;
export const setPaymentProvider = (p: PaymentProvider | null) => (provider = p);

const idParam = z.object({ id: schemas.id });
const ordersQuery = z.object({ status: z.enum(["pending", "paid", "cancelled"]).default("pending") });

export async function checkoutRoutes(app: FastifyInstance) {
  const { db } = app;

  async function plan(orgId: string, id: string) {
    const [p] = await db.select().from(packagePlans).where(and(eq(packagePlans.id, id), eq(packagePlans.orgId, orgId)));
    if (!p || !p.onSale || p.archivedAt) throw notFound("package");
    return p;
  }

  app.get("/checkout/quote", async (req) => {
    if (req.auth.role !== "client") throw forbidden("Checkout is for clients. Staff sell packages from the client's profile.");
    const { planId, rolloverFromPackageId } = parse(schemas.checkoutQuote, req.query);
    const org = await getOrg(db, req.auth.orgId);
    const p = await plan(org.id, planId);
    const zone = orgZone(org);
    const today = DateTime.now().setZone(zone).toISODate()!;
    const rollovers = org.rolloverMode === "clients" && p.kind === "credits" ? await rolloverOptions(db, org, req.auth.userId) : [];
    const chosen = rolloverFromPackageId ? rollovers.find((r) => r.packageId === rolloverFromPackageId) : undefined;
    if (rolloverFromPackageId && !chosen) throw badRequest("no_rollover", "Those classes can't be rolled over.");
    return {
      package: { id: p.id, name: p.name, description: p.description, photoUrl: p.photoFileId ? `/v1/files/${p.photoFileId}` : null, billing: p.billing, terms: await planTerms(db, p) },
      lines: [
        { label: p.name, amount: money(p.priceCents, org.currency) },
        ...(chosen ? [{ label: `${chosen.classes} unused ${chosen.classes === 1 ? "class" : "classes"} from ${chosen.name}`, amount: "Included" }] : []),
      ],
      total: money(p.priceCents, org.currency),
      totalCents: p.priceCents,
      recurringNote: p.billing === "recurring" ? `You'll be charged ${money(p.priceCents, org.currency)} each ${p.validityValue === 1 ? p.validityUnit!.replace(/s$/, "") : `${p.validityValue} ${p.validityUnit}`} until you stop it.` : null,
      startDate: p.startsOn === "purchase" && p.billing === "one_time" && p.validityValue ? { earliest: today, latest: DateTime.fromISO(today).plus({ days: 60 }).toISODate(), default: today } : null,
      startsNote: p.startsOn === "first_booking" ? "Your package starts when you book your first class." : null,
      rolloverOptions: rollovers,
      payments: provider ? { online: true, provider: provider.name } : { online: false, message: "Online payment isn't switched on yet. Place your order and pay at the front desk; your package is ready as soon as the studio confirms payment." },
    };
  });

  app.post("/checkout", async (req, reply) => {
    if (req.auth.role !== "client") throw forbidden("Checkout is for clients. Staff sell packages from the client's profile.");
    const input = parse(schemas.checkout, req.body);
    const org = await getOrg(db, req.auth.orgId);
    const p = await plan(org.id, input.planId);
    if (input.startDate && !(p.startsOn === "purchase" && p.billing === "one_time")) throw badRequest("start_date_not_needed", "This package doesn't take a start date.");
    if (input.rolloverFromPackageId) {
      const ok = org.rolloverMode === "clients" && (await rolloverOptions(db, org, req.auth.userId)).some((r) => r.packageId === input.rolloverFromPackageId);
      if (!ok) throw badRequest("no_rollover", "Those classes can't be rolled over.");
    }
    const [o] = await db
      .insert(orders)
      .values({ orgId: org.id, clientId: req.auth.userId, planId: p.id, amountCents: p.priceCents, currency: org.currency, startDate: input.startDate ?? null, rolloverFromPackageId: input.rolloverFromPackageId ?? null, provider: provider?.name ?? null })
      .returning();
    let payment: { online: boolean; redirectUrl?: string; message?: string } = { online: false, message: "Order placed. Pay at the front desk and your package will be ready straight away." };
    if (provider) {
      const r = await provider.createPayment({ id: o!.id, amountCents: o!.amountCents, currency: o!.currency, description: p.name });
      await db.update(orders).set({ providerRef: r.ref }).where(eq(orders.id, o!.id));
      payment = { online: true, redirectUrl: r.redirectUrl };
    }
    reply.code(201);
    return { order: { id: o!.id, status: o!.status, total: money(o!.amountCents, o!.currency), packageName: p.name }, payment };
  });

  /** Clients: their orders. Admins: orders waiting for payment at the desk (or ?status=paid). */
  app.get("/orders", async (req) => {
    const admin = can(req.auth.role, "managePackages");
    const { status } = parse(ordersQuery, req.query);
    const rows = await db
      .select({ o: orders, planName: packagePlans.name, first: users.firstName, last: users.lastName })
      .from(orders)
      .leftJoin(packagePlans, eq(packagePlans.id, orders.planId))
      .innerJoin(users, eq(users.id, orders.clientId))
      .where(and(eq(orders.orgId, req.auth.orgId), eq(orders.status, status), admin ? undefined : eq(orders.clientId, req.auth.userId)))
      .orderBy(desc(orders.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r.o, total: money(r.o.amountCents, r.o.currency), packageName: r.planName ?? "Package (deleted)", clientName: `${r.first} ${r.last}`, isRenewal: !!r.o.clientPackageId && !r.o.paidAt }));
  });

  /** Paid at the desk: the order becomes the client's package (or, for a renewal, is simply settled). */
  app.post("/orders/:id/mark-paid", async (req) => {
    requirePermission(req, "managePackages");
    const { id } = parse(idParam, req.params);
    return inTx(app, async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.orgId, req.auth.orgId))).for("update");
      if (!o) throw notFound("order");
      if (o.status !== "pending") throw conflict("not_pending", `This order is already ${o.status}.`);
      let clientPackageId = o.clientPackageId;
      if (!clientPackageId) {
        if (!o.planId) throw conflict("plan_deleted", "This package no longer exists, so the order can't be completed. Cancel it instead.");
        const sold = await sellPackage(tx, req.auth, o.clientId, { planId: o.planId, startDate: o.startDate ?? undefined, pricePaidCents: o.amountCents, notifyClient: true });
        clientPackageId = sold.id;
        if (o.rolloverFromPackageId) await rolloverInto(tx, req.auth, sold.id, { fromPackageId: o.rolloverFromPackageId }, { viaCheckout: true });
      }
      const [u] = await tx.update(orders).set({ status: "paid", paidAt: new Date(), clientPackageId }).where(eq(orders.id, o.id)).returning();
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "order.paid", entityType: "order", entityId: o.id, details: { at: "desk" } });
      return u;
    });
  });

  app.post("/orders/:id/cancel", async (req) => {
    const { id } = parse(idParam, req.params);
    return inTx(app, async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.orgId, req.auth.orgId))).for("update");
      if (!o || (!can(req.auth.role, "managePackages") && o.clientId !== req.auth.userId)) throw notFound("order");
      if (o.status !== "pending") throw conflict("not_pending", `This order is already ${o.status}.`);
      const [u] = await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, o.id)).returning();
      return u;
    });
  });
}
