/**
 * The shop: studio merch, drinks, mats and so on, alongside gift cards.
 *
 *  - Owners and admins add products (with sizes or colours, each with its own stock, if needed).
 *  - Clients see a Shop in the app only when there's something in it (products or gift cards).
 *  - Checkout reserves the stock and issues an invoice. Clients pay online (once payments are
 *    connected) or when they collect; studio credit can be used.
 *  - Front of House hands orders over at the desk, taking payment first if it's still due.
 *  - Cancelling or refunding (with "undo the sale") puts the stock back.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { SHOP_ORDER_STATUSES, can, markInvoicePaid, productInput, schemas, shopCheckout, updateProduct } from "@studio/shared";
import { z } from "zod";
import { orders, organizations, products, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { completeOrderById } from "../checkout/routes.js";
import { assertFile, publicFileUrl } from "../files/routes.js";
import { spendCredit, usableGrants } from "../marketing/credit.js";
import { issueInvoice } from "../sales/invoices.js";
import { available, takeStock } from "./stock.js";

const idParam = z.object({ id: schemas.id });
type Product = typeof products.$inferSelect;
type Order = typeof orders.$inferSelect;

const statusOf = (o: Order): keyof typeof SHOP_ORDER_STATUSES => (o.status === "cancelled" ? "cancelled" : o.collectedAt ? "collected" : o.status === "paid" ? "ready" : "awaiting_payment");

export async function shopRoutes(app: FastifyInstance) {
  const { db, config } = app;
  const view = (p: Product, currency: string, admin: boolean) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: money(p.priceCents, currency),
    priceCents: p.priceCents,
    photoUrl: p.photoFileId ? publicFileUrl(config.PUBLIC_API_URL, p.photoFileId) : null,
    category: p.category,
    options: p.options.map((o) => ({ name: o.name, soldOut: o.stock !== null && o.stock <= 0, ...(admin ? { stock: o.stock } : {}) })),
    soldOut: p.options.length ? p.options.every((o) => o.stock !== null && o.stock <= 0) : p.stock !== null && p.stock <= 0,
    ...(admin ? { stock: p.stock, onSale: p.onSale } : {}),
  });
  const currencyOf = async (orgId: string) => (await db.select({ c: organizations.currency, gc: organizations.giftCardsEnabled }).from(organizations).where(eq(organizations.id, orgId)))[0]!;

  /** What clients see. `visible` is false when there's nothing to buy, so the app hides the Shop. */
  app.get("/shop", async (req) => {
    const org = await currencyOf(req.auth.orgId);
    const list = await db.select().from(products).where(and(eq(products.orgId, req.auth.orgId), isNull(products.archivedAt), eq(products.onSale, true))).orderBy(asc(products.sortOrder), asc(products.name));
    return { visible: list.length > 0 || org.gc, giftCards: org.gc, products: list.map((p) => view(p, org.c, false)) };
  });

  // --- Owners and admins: products -------------------------------------------------------
  app.get("/shop/products", async (req) => {
    requirePermission(req, "manageShop");
    const org = await currencyOf(req.auth.orgId);
    const list = await db.select().from(products).where(and(eq(products.orgId, req.auth.orgId), isNull(products.archivedAt))).orderBy(asc(products.sortOrder), asc(products.name));
    return { products: list.map((p) => view(p, org.c, true)) };
  });
  const check = async (orgId: string, input: { photoFileId?: string | null; options?: { name: string }[] }) => {
    if (input.photoFileId) await assertFile(db, orgId, input.photoFileId, "email_image");
    const names = (input.options ?? []).map((o) => o.name.toLowerCase());
    if (new Set(names).size !== names.length) throw badRequest("duplicate_option", "Each size or colour needs a different name.");
  };
  app.post("/shop/products", async (req, reply) => {
    requirePermission(req, "manageShop");
    const input = parse(productInput, req.body);
    await check(req.auth.orgId, input);
    const [p] = await db.insert(products).values({ ...input, orgId: req.auth.orgId }).returning();
    reply.code(201);
    return view(p!, (await currencyOf(req.auth.orgId)).c, true);
  });
  app.patch("/shop/products/:id", async (req) => {
    requirePermission(req, "manageShop");
    const { id } = parse(idParam, req.params);
    const input = parse(updateProduct, req.body);
    await check(req.auth.orgId, input);
    const [p] = await db.update(products).set(input).where(and(eq(products.id, id), eq(products.orgId, req.auth.orgId), isNull(products.archivedAt))).returning();
    if (!p) throw notFound("product");
    return view(p, (await currencyOf(req.auth.orgId)).c, true);
  });
  /** Removed from the shop. Past orders keep their details. */
  app.delete("/shop/products/:id", async (req) => {
    requirePermission(req, "manageShop");
    const { id } = parse(idParam, req.params);
    const [p] = await db.update(products).set({ archivedAt: new Date(), onSale: false }).where(and(eq(products.id, id), eq(products.orgId, req.auth.orgId))).returning();
    if (!p) throw notFound("product");
    return { removed: p.name };
  });

  // --- Clients: checkout -------------------------------------------------------------------
  app.post("/shop/checkout", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (req.auth.role !== "client") throw forbidden("The shop checkout is for clients. Staff can sell items at the desk.");
    const input = parse(shopCheckout, req.body);
    const out = await inTx(app, async (tx) => {
      const org = await currencyOf(req.auth.orgId);
      const ids = [...new Set(input.items.map((i) => i.productId))];
      const rows = await tx.select().from(products).where(and(eq(products.orgId, req.auth.orgId), inArray(products.id, ids))).for("update");
      const items: NonNullable<Order["items"]> = [];
      for (const it of input.items) {
        const p = rows.find((r) => r.id === it.productId);
        if (!p || p.archivedAt || !p.onSale) throw notFound("product");
        const option = p.options.length ? (it.option ?? null) : null;
        if (p.options.length && !p.options.some((o) => o.name === option)) throw badRequest("choose_option", `Choose a size or colour for ${p.name}.`);
        const left = available(p, option);
        if (left !== null && left < it.quantity) throw conflict("sold_out", left <= 0 ? `${p.name}${option ? ` (${option})` : ""} is sold out.` : `Only ${left} ${p.name}${option ? ` (${option})` : ""} left.`);
        await takeStock(tx, p, option, it.quantity);
        // Keep the locked row in step for a second line of the same product.
        const fresh = (await tx.select().from(products).where(eq(products.id, p.id)))[0]!;
        rows.splice(rows.indexOf(p), 1, fresh);
        items.push({ productId: p.id, name: p.name, option, quantity: it.quantity, unitCents: p.priceCents });
      }
      const subtotal = items.reduce((a, i) => a + i.unitCents * i.quantity, 0);
      const balance = input.useCredit ? (await usableGrants(tx, req.auth.orgId, req.auth.userId)).reduce((a, g) => a + g.remainingCents, 0) : 0;
      const credit = Math.min(balance, subtotal);
      const [o] = await tx.insert(orders).values({ orgId: req.auth.orgId, clientId: req.auth.userId, kind: "product", items, subtotalCents: subtotal, amountCents: subtotal - credit, currency: org.c }).returning();
      const spent = credit ? await spendCredit(tx, req.auth.orgId, req.auth.userId, credit, o!.id) : 0;
      await tx.update(orders).set({ creditCents: spent }).where(eq(orders.id, o!.id));
      await issueInvoice(tx, { orgId: req.auth.orgId, clientId: req.auth.userId, source: "product", orderId: o!.id, creditCents: spent, lines: items.map((i) => ({ description: i.name, detail: i.option ?? undefined, quantity: i.quantity, unitCents: i.unitCents })) });
      if (subtotal - spent === 0) await completeOrderById(tx, req.auth, o!.id, "credit");
      const [final] = await tx.select().from(orders).where(eq(orders.id, o!.id));
      return { order: final!, currency: org.c };
    });
    reply.code(201);
    const o = out.order;
    return {
      order: { id: o.id, status: statusOf(o), statusLabel: SHOP_ORDER_STATUSES[statusOf(o)], total: money(o.amountCents, out.currency), items: o.items },
      message: o.status === "paid" ? "All paid. Collect it at the front desk." : "Order placed. Pay and collect it at the front desk.",
    };
  });

  app.get("/me/shop-orders", async (req) => {
    const rows = await db.select().from(orders).where(and(eq(orders.orgId, req.auth.orgId), eq(orders.clientId, req.auth.userId), eq(orders.kind, "product"))).orderBy(desc(orders.createdAt)).limit(50);
    return { orders: rows.map((o) => ({ id: o.id, status: statusOf(o), statusLabel: SHOP_ORDER_STATUSES[statusOf(o)], total: money(o.amountCents, o.currency), items: o.items, at: o.createdAt })) };
  });

  // --- Front desk: handing orders over -------------------------------------------------------
  const ordersQuery = z.object({ show: z.enum(["to_hand_over", "collected", "all"]).default("to_hand_over") });
  app.get("/shop/orders", async (req) => {
    requirePermission(req, "handOverOrders");
    const { show } = parse(ordersQuery, req.query);
    const rows = await db
      .select({ o: orders, first: users.firstName, last: users.lastName })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.clientId))
      .where(and(eq(orders.orgId, req.auth.orgId), eq(orders.kind, "product")))
      .orderBy(desc(orders.createdAt))
      .limit(200);
    const list = rows.filter(({ o }) => (show === "all" ? true : show === "collected" ? !!o.collectedAt : o.status !== "cancelled" && !o.collectedAt));
    return {
      orders: list.map(({ o, first, last }) => ({ id: o.id, client: `${first} ${last}`, status: statusOf(o), statusLabel: SHOP_ORDER_STATUSES[statusOf(o)], toPay: o.status === "paid" ? null : money(o.amountCents, o.currency), total: money(o.subtotalCents ?? o.amountCents, o.currency), items: o.items, at: o.createdAt })),
    };
  });
  /** Hand it over. If it's not paid yet, payment is taken first (cash, card, QR…). */
  app.post("/shop/orders/:id/collected", async (req) => {
    requirePermission(req, "handOverOrders");
    const { id } = parse(idParam, req.params);
    const { method } = parse(z.object({ method: markInvoicePaid.shape.method.unwrap().optional() }), req.body ?? {});
    return inTx(app, async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.orgId, req.auth.orgId), eq(orders.kind, "product"))).for("update");
      if (!o) throw notFound("order");
      if (o.status === "cancelled") throw conflict("cancelled", "This order was cancelled.");
      if (o.collectedAt) throw conflict("collected", "This order has already been collected.");
      if (o.status !== "paid") {
        if (!method) throw conflict("payment_due", `${money(o.amountCents, o.currency)} is still to pay. Choose how they're paying, then hand it over.`, { amountDue: money(o.amountCents, o.currency) });
        await completeOrderById(tx, { ...req.auth, role: can(req.auth.role, "managePackages") ? req.auth.role : "admin" }, o.id, method);
      }
      await tx.update(orders).set({ collectedAt: new Date(), collectedBy: req.auth.userId }).where(eq(orders.id, o.id));
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "shop.collected", entityType: "order", entityId: o.id });
      return { collected: true };
    });
  });
}
