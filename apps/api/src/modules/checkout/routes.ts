/**
 * Checkout: a client buying a package or a gift card.
 *
 *  1. GET /checkout/quote shows what they're buying: the rules in plain English, the price, any
 *     discount and studio credit that applies, start-date choices and classes they can roll over.
 *  2. POST /checkout (packages) or POST /gift-cards/checkout creates an order. Studio credit and a
 *     discount are taken off straight away; if nothing's left to pay, it's complete at once.
 *     When a payment provider is connected, the response includes its payment page; until then
 *     the client pays at the desk.
 *  3. The order completes once paid: by the provider's webhook (later), or an admin marking it
 *     paid at the desk (POST /orders/:id/mark-paid). Cancelling puts credit and discounts back.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, isNull } from "drizzle-orm";
import { can, giftCardCheckout, schemas } from "@studio/shared";
import { DateTime } from "luxon";
import { z } from "zod";
import type { AuthContext } from "../../plugins/auth.js";
import type { DbOrTx } from "../../db/client.js";
import { giftCardDesigns, giftCards, orders, packagePlans, users, vouchers } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { getOrg } from "../sessions/context.js";
import { planTerms, rolloverInto, rolloverOptions } from "../packages/lifecycle.js";
import { orgZone, sellPackage } from "../packages/service.js";
import { returnCredit, spendCredit, usableGrants, usableVouchers, voucherDiscount, voucherLabel } from "../marketing/credit.js";
import { checkAmount, findRecipient, giftCardPaid, giftCode } from "../marketing/giftcards.js";

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
type Order = typeof orders.$inferSelect;

/** Price → discount → credit → what's left to pay. */
async function pricing(db: DbOrTx, orgId: string, clientId: string, subtotal: number, opts: { voucherId?: string; useCredit: boolean; allowCredit: boolean }, now = new Date()) {
  let discount = 0;
  let voucher: typeof vouchers.$inferSelect | null = null;
  if (opts.voucherId) {
    voucher = (await usableVouchers(db, orgId, clientId, now)).find((v) => v.id === opts.voucherId) ?? null;
    if (!voucher) throw badRequest("no_voucher", "That discount has been used or has expired.");
    discount = voucherDiscount(voucher, subtotal);
  }
  const balance = opts.allowCredit ? (await usableGrants(db, orgId, clientId, now)).reduce((a, g) => a + g.remainingCents, 0) : 0;
  const credit = opts.useCredit ? Math.min(balance, subtotal - discount) : 0;
  return { subtotal, discount, voucher, credit, balance, due: subtotal - discount - credit };
}

/** Complete a paid order: the package is added (or the gift card released). */
async function completeOrder(tx: DbOrTx, o: Order, by: AuthContext, how: string) {
  let clientPackageId = o.clientPackageId;
  if (o.kind === "gift_card") {
    if (o.giftCardId) await giftCardPaid(tx, o.giftCardId);
  } else if (!clientPackageId) {
    if (!o.planId) throw conflict("plan_deleted", "This package no longer exists, so the order can't be completed. Cancel it instead.");
    // Staff mark orders paid; a fully-credited checkout completes itself, acting for the studio.
    const studio: AuthContext = { ...by, role: can(by.role, "managePackages") ? by.role : "admin" };
    const sold = await sellPackage(tx, studio, o.clientId, { planId: o.planId, startDate: o.startDate ?? undefined, pricePaidCents: o.amountCents, notifyClient: true });
    clientPackageId = sold.id;
    if (o.rolloverFromPackageId) await rolloverInto(tx, studio, sold.id, { fromPackageId: o.rolloverFromPackageId }, { viaCheckout: true });
  }
  const [u] = await tx.update(orders).set({ status: "paid", paidAt: new Date(), clientPackageId }).where(eq(orders.id, o.id)).returning();
  await audit(tx, { orgId: o.orgId, actorId: by.userId, action: "order.paid", entityType: "order", entityId: o.id, details: { at: how } });
  return u!;
}

export async function checkoutRoutes(app: FastifyInstance) {
  const { db } = app;

  async function plan(orgId: string, id: string) {
    const [p] = await db.select().from(packagePlans).where(and(eq(packagePlans.id, id), eq(packagePlans.orgId, orgId)));
    if (!p || !p.onSale || p.archivedAt) throw notFound("package");
    return p;
  }
  const clientsOnly = (role: string) => {
    if (role !== "client") throw forbidden("Checkout is for clients. Staff sell packages from the client's profile.");
  };

  app.get("/checkout/quote", async (req) => {
    clientsOnly(req.auth.role);
    const q = parse(schemas.checkoutQuote, req.query);
    const org = await getOrg(db, req.auth.orgId);
    const p = await plan(org.id, q.planId);
    const zone = orgZone(org);
    const today = DateTime.now().setZone(zone).toISODate()!;
    const rollovers = org.rolloverMode === "clients" && p.kind === "credits" ? await rolloverOptions(db, org, req.auth.userId) : [];
    const chosen = q.rolloverFromPackageId ? rollovers.find((r) => r.packageId === q.rolloverFromPackageId) : undefined;
    if (q.rolloverFromPackageId && !chosen) throw badRequest("no_rollover", "Those classes can't be rolled over.");
    const price = await pricing(db, org.id, req.auth.userId, p.priceCents, { voucherId: q.voucherId, useCredit: q.useCredit, allowCredit: true });
    const m = (c: number) => money(c, org.currency);
    return {
      package: { id: p.id, name: p.name, description: p.description, photoUrl: p.photoFileId ? `/v1/files/${p.photoFileId}` : null, billing: p.billing, terms: await planTerms(db, p, org.currency) },
      lines: [
        { label: p.name, amount: m(p.priceCents) },
        ...(chosen ? [{ label: `${chosen.classes} unused ${chosen.classes === 1 ? "class" : "classes"} from ${chosen.name}`, amount: "Included" }] : []),
        ...(price.discount ? [{ label: `Discount (${voucherLabel(price.voucher!, org.currency)})`, amount: `−${m(price.discount)}` }] : []),
        ...(price.credit ? [{ label: "Studio credit", amount: `−${m(price.credit)}` }] : []),
      ],
      total: m(price.due),
      totalCents: price.due,
      studioCredit: { balance: m(price.balance), balanceCents: price.balance, using: m(price.credit) },
      vouchers: (await usableVouchers(db, org.id, req.auth.userId)).map((v) => ({ id: v.id, label: voucherLabel(v, org.currency), note: v.note, expiresAt: v.expiresAt })),
      recurringNote: p.billing === "recurring" ? `You'll be charged ${m(p.priceCents)} each ${p.validityValue === 1 ? p.validityUnit!.replace(/s$/, "") : `${p.validityValue} ${p.validityUnit}`} until you stop it.${price.discount || price.credit ? " The discount and credit apply to this first payment only." : ""}` : null,
      startDate: p.startsOn === "purchase" && p.billing === "one_time" && p.validityValue ? { earliest: today, latest: DateTime.fromISO(today).plus({ days: 60 }).toISODate(), default: today } : null,
      startsNote: p.startsOn === "first_booking" ? "Your package starts when you book your first class." : null,
      rolloverOptions: rollovers,
      payments: price.due === 0 ? { online: false, message: "Nothing to pay: your credit and discount cover it." } : provider ? { online: true, provider: provider.name } : { online: false, message: "Online payment isn't switched on yet. Place your order and pay at the front desk; your package is ready as soon as the studio confirms payment." },
    };
  });

  app.post("/checkout", async (req, reply) => {
    clientsOnly(req.auth.role);
    const input = parse(schemas.checkout, req.body);
    const org = await getOrg(db, req.auth.orgId);
    const p = await plan(org.id, input.planId);
    if (input.startDate && !(p.startsOn === "purchase" && p.billing === "one_time")) throw badRequest("start_date_not_needed", "This package doesn't take a start date.");
    if (input.rolloverFromPackageId) {
      const ok = org.rolloverMode === "clients" && (await rolloverOptions(db, org, req.auth.userId)).some((r) => r.packageId === input.rolloverFromPackageId);
      if (!ok) throw badRequest("no_rollover", "Those classes can't be rolled over.");
    }
    const result = await inTx(app, async (tx) => {
      const price = await pricing(tx, org.id, req.auth.userId, p.priceCents, { voucherId: input.voucherId, useCredit: input.useCredit, allowCredit: true });
      const [o] = await tx
        .insert(orders)
        .values({
          orgId: org.id, clientId: req.auth.userId, planId: p.id, kind: "package", subtotalCents: price.subtotal, discountCents: price.discount, voucherId: price.voucher?.id ?? null,
          amountCents: price.due, currency: org.currency, startDate: input.startDate ?? null, rolloverFromPackageId: input.rolloverFromPackageId ?? null, provider: price.due && provider ? provider.name : null,
        })
        .returning();
      if (price.voucher) {
        const [used] = await tx.update(vouchers).set({ usedAt: new Date(), orderId: o!.id }).where(and(eq(vouchers.id, price.voucher.id), isNull(vouchers.usedAt))).returning();
        if (!used) throw conflict("voucher_used", "That discount has just been used.");
      }
      const credit = price.credit ? await spendCredit(tx, org.id, req.auth.userId, price.credit, o!.id) : 0;
      if (credit !== price.credit) throw conflict("credit_changed", "Your credit changed while checking out. Please try again.");
      const [withCredit] = await tx.update(orders).set({ creditCents: credit }).where(eq(orders.id, o!.id)).returning();
      return price.due === 0 ? completeOrder(tx, withCredit!, req.auth, "fully paid with credit or discount") : withCredit!;
    });
    let payment: { online: boolean; redirectUrl?: string; message?: string } =
      result.status === "paid" ? { online: false, message: "All done! It's been added to your packages." } : { online: false, message: "Order placed. Pay at the front desk and your package will be ready straight away." };
    if (result.status === "pending" && provider) {
      const r = await provider.createPayment({ id: result.id, amountCents: result.amountCents, currency: result.currency, description: p.name });
      await db.update(orders).set({ providerRef: r.ref }).where(eq(orders.id, result.id));
      payment = { online: true, redirectUrl: r.redirectUrl };
    }
    reply.code(201);
    return { order: { id: result.id, status: result.status, total: money(result.amountCents, result.currency), packageName: p.name, clientPackageId: result.clientPackageId }, payment };
  });

  /**
   * Buy a gift card. With `give`, it goes to that person once paid (they need an account here);
   * without, it waits in your Gift cards tab. Studio credit can't be used to buy gift cards.
   */
  app.post("/gift-cards/checkout", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    clientsOnly(req.auth.role);
    const input = parse(giftCardCheckout, req.body);
    const org = await getOrg(db, req.auth.orgId);
    checkAmount(org, input.amountCents);
    const [design] = await db.select().from(giftCardDesigns).where(and(eq(giftCardDesigns.id, input.designId), eq(giftCardDesigns.orgId, org.id), eq(giftCardDesigns.active, true)));
    if (!design) throw notFound("gift card design");
    let recipientId: string | null = null;
    if (input.give) {
      const r = await findRecipient(db, org.id, input.give.to);
      if (!r) {
        throw conflict(
          "recipient_not_found",
          `We couldn't find one account at ${org.name} with that ${input.give.to.includes("@") ? "email address" : "phone number"}. You can buy the gift card now and give it from your Gift cards tab once they've joined.`,
          { canGiveLater: true },
        );
      }
      if (r.id === req.auth.userId) throw badRequest("own_card", "That's you! To buy credit for yourself, choose “Give it later” and then “Keep it for myself”.");
      recipientId = r.id;
    }
    const [me] = await db.select({ first: users.firstName }).from(users).where(eq(users.id, req.auth.userId));
    const out = await inTx(app, async (tx) => {
      const [card] = await tx
        .insert(giftCards)
        .values({ orgId: org.id, code: giftCode(), designId: design.id, amountCents: input.amountCents, currency: org.currency, buyerId: req.auth.userId, recipientId, fromName: input.give?.fromName || me?.first || null, message: input.give?.message ?? null })
        .returning();
      const [o] = await tx
        .insert(orders)
        .values({ orgId: org.id, clientId: req.auth.userId, kind: "gift_card", giftCardId: card!.id, subtotalCents: input.amountCents, amountCents: input.amountCents, currency: org.currency, provider: provider?.name ?? null })
        .returning();
      return { card: card!, order: o! };
    });
    let payment: { online: boolean; redirectUrl?: string; message?: string } = {
      online: false,
      message: recipientId ? "Order placed. Pay at the front desk and the gift card goes to them straight away." : "Order placed. Pay at the front desk and the gift card will be in your Gift cards tab, ready to give.",
    };
    if (provider) {
      const r = await provider.createPayment({ id: out.order.id, amountCents: out.order.amountCents, currency: out.order.currency, description: `Gift card ${money(input.amountCents, org.currency)}` });
      await db.update(orders).set({ providerRef: r.ref }).where(eq(orders.id, out.order.id));
      payment = { online: true, redirectUrl: r.redirectUrl };
    }
    reply.code(201);
    return { order: { id: out.order.id, status: out.order.status, total: money(out.order.amountCents, org.currency) }, giftCard: { id: out.card.id, code: out.card.code, givingTo: recipientId ? input.give!.to : null }, payment };
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
    return rows.map((r) => ({
      ...r.o,
      total: money(r.o.amountCents, r.o.currency),
      packageName: r.o.kind === "gift_card" ? `Gift card ${money(r.o.subtotalCents ?? r.o.amountCents, r.o.currency)}` : (r.planName ?? "Package (deleted)"),
      clientName: `${r.first} ${r.last}`,
      isRenewal: !!r.o.clientPackageId && !r.o.paidAt,
    }));
  });

  /** Paid at the desk: the order becomes the client's package (or gift card), or a renewal is simply settled. */
  app.post("/orders/:id/mark-paid", async (req) => {
    requirePermission(req, "managePackages");
    const { id } = parse(idParam, req.params);
    return inTx(app, async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.orgId, req.auth.orgId))).for("update");
      if (!o) throw notFound("order");
      if (o.status !== "pending") throw conflict("not_pending", `This order is already ${o.status}.`);
      return completeOrder(tx, o, req.auth, "desk");
    });
  });

  app.post("/orders/:id/cancel", async (req) => {
    const { id } = parse(idParam, req.params);
    return inTx(app, async (tx) => {
      const [o] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.orgId, req.auth.orgId))).for("update");
      if (!o || (!can(req.auth.role, "managePackages") && o.clientId !== req.auth.userId)) throw notFound("order");
      if (o.status !== "pending") throw conflict("not_pending", `This order is already ${o.status}.`);
      await returnCredit(tx, o.orgId, o.id);
      if (o.voucherId) await tx.update(vouchers).set({ usedAt: null, orderId: null }).where(eq(vouchers.id, o.voucherId));
      if (o.giftCardId) await tx.update(giftCards).set({ status: "cancelled" }).where(and(eq(giftCards.id, o.giftCardId), eq(giftCards.status, "pending_payment")));
      const [u] = await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, o.id)).returning();
      return u;
    });
  });
}
