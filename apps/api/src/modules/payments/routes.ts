/**
 * Payments: the studio connects Stripe and chooses how clients pay; clients keep a card for
 * memberships and pay orders online; Stripe tells us what happened (webhook).
 *
 *  - GET  /payments                    status, settings and an example of any fee passed on
 *  - POST /payments/connect            owners: create the studio's Stripe account (once) and get Stripe's sign-up page
 *  - POST /payments/refresh            read the account's status from Stripe again
 *  - PUT  /payments/settings           online on/off, paying at the studio, passing the fee on
 *  - GET/POST/DELETE /me/payment-card  clients: the card kept for memberships
 *  - POST /orders/:id/pay              clients: pay a waiting order online (a renewal, a desk order)
 *  - POST /public/payments/stripe/webhook  Stripe, signed with the endpoint's secret
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { PAY_WITH, STRIPE_COUNTRY, can, passedOnFee, payOrder, paymentSettings } from "@studio/shared";
import { z } from "zod";
import { clientPackages, orders, organizations, packagePlans, paymentCustomers } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../../lib/errors.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { getOrg } from "../sessions/context.js";
import { accountStatus, choosePayment, handleStripeEvent, onlineReady, payOptions, recentOnline, saveAccountStatus, startCardSetup, startOnlinePayment, stripe, type StripeEvent } from "./service.js";
import { StripeError, verifySignature } from "./stripe.js";

const idParam = z.object({ id: z.uuid() });
const removeCard = z.object({ acknowledge: z.array(z.string()).max(20).default([]) });
/** A payment event (a snapshot, from a connected account) or a v2 "thin" event naming what changed. */
const stripeEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  account: z.string().nullish(),
  data: z.object({ object: z.record(z.string(), z.unknown()).optional() }).passthrough().nullish(),
  related_object: z.object({ id: z.string(), type: z.string() }).partial().nullish(),
});

export async function paymentRoutes(app: FastifyInstance) {
  const { db, config } = app;

  async function view(orgId: string) {
    const org = await getOrg(db, orgId);
    const st = accountStatus(org);
    const m = (c: number) => money(c, org.currency);
    const example = 3000;
    return {
      status: st.status,
      statusText: st.text,
      account: org.stripeAccountId ? { chargesEnabled: org.stripeChargesEnabled, payoutsEnabled: org.stripePayoutsEnabled, detailsSubmitted: org.stripeDetailsSubmitted, stillNeeded: org.stripeRequirements.length } : null,
      settings: { onlinePayments: org.onlinePayments, payAtDesk: org.payAtDesk, passOnFees: org.passOnFees, cardFeeBps: org.cardFeeBps, cardFeeFixedCents: org.cardFeeFixedCents, grabpayFeeBps: org.grabpayFeeBps },
      fees: {
        card: `${(org.cardFeeBps / 100).toFixed(2).replace(/\.?0+$/, "")}% + ${m(org.cardFeeFixedCents)}`,
        grabpay: `${(org.grabpayFeeBps / 100).toFixed(2).replace(/\.?0+$/, "")}%`,
        example: { price: m(example), card: m(passedOnFee(example, org.cardFeeBps, org.cardFeeFixedCents)), grabpay: m(passedOnFee(example, org.grabpayFeeBps, 0)), paynow: m(0) },
        note: "The fee is never added for PayNow: the banks' PayNow rules don't allow it. Card networks and your Stripe agreement have their own rules on card surcharges, so check them before switching this on.",
      },
      methodsNote: "Which payment methods clients see (cards, Apple Pay, Google Pay, PayNow, GrabPay and others) is set in your Stripe dashboard, under Settings, Payment methods.",
      dashboardUrl: "https://dashboard.stripe.com",
      recent: org.stripeAccountId ? await recentOnline(db, org.id) : [],
    };
  }

  app.get("/payments", async (req) => {
    requirePermission(req, "viewPayments");
    return view(req.auth.orgId);
  });

  /** Owners only: this creates the studio's Stripe account, in the studio's name. */
  app.post("/payments/connect", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    if (req.auth.role !== "owner") throw forbidden("Only the studio's owner can connect Stripe, as the account is in the business's name.");
    const api = stripe();
    if (!api) throw conflict("payments_unavailable", "Online payments aren't set up on this platform yet.");
    let org = await getOrg(db, req.auth.orgId);
    const country = STRIPE_COUNTRY[org.currency];
    if (!country) throw conflict("currency_unsupported", `Online payments aren't available for ${org.currency} yet.`);
    try {
      if (!org.stripeAccountId) {
        const local = country === "SG" ? ["paynow_payments", "grabpay_payments"] : [];
        const a = await api.createAccount({ country, name: org.legalName || org.name, orgId: org.id, currency: org.currency, capabilities: ["card_payments", ...local] });
        // Only set it if nobody else did at the same moment.
        await db.update(organizations).set({ stripeAccountId: a.id }).where(and(eq(organizations.id, org.id), isNull(organizations.stripeAccountId)));
        org = await getOrg(db, org.id);
        await audit(db, { orgId: org.id, actorId: req.auth.userId, action: "payments.connect_started", entityType: "organization", entityId: org.id });
      }
      const base = config.PUBLIC_APP_URL;
      const link = await api.accountLink(org.stripeAccountId!, { refresh: `${base}/setup/payments?stripe=again`, return: `${base}/setup/payments?stripe=back` });
      return { url: link.url };
    } catch (err) {
      if (err instanceof StripeError) throw conflict("stripe_error", `Stripe said: ${err.message}`);
      throw err;
    }
  });

  app.post("/payments/refresh", async (req) => {
    requirePermission(req, "viewPayments");
    const api = stripe();
    const org = await getOrg(db, req.auth.orgId);
    if (api && org.stripeAccountId) {
      try {
        const a = await api.getAccount(org.stripeAccountId);
        await inTx(app, (tx) => saveAccountStatus(tx, org, a));
      } catch (err) {
        if (!(err instanceof StripeError)) throw err;
      }
    }
    return view(org.id);
  });

  app.put("/payments/settings", async (req) => {
    requirePermission(req, "viewPayments");
    const input = parse(paymentSettings, req.body);
    return withFlags(app, input.acknowledge, async (tx, flags) => {
      const org = await getOrg(tx, req.auth.orgId);
      if (!input.payAtDesk && !input.onlinePayments) throw badRequest("no_way_to_pay", "Clients need a way to pay: keep paying online or paying at the studio switched on.");
      if (!input.payAtDesk && !onlineReady({ ...org, onlinePayments: input.onlinePayments })) throw badRequest("online_not_ready", "Online payments aren't ready yet, so clients still need to be able to pay at the studio.");
      if (input.passOnFees && !org.passOnFees) {
        flags.confirm({ code: "pass_on_fees", message: "Clients paying by card or GrabPay will see the fee as a separate line before they pay (never for PayNow). Card networks and your Stripe agreement have their own rules on card surcharges: check they allow it for your business." });
      }
      await tx
        .update(organizations)
        .set({ onlinePayments: input.onlinePayments, payAtDesk: input.payAtDesk, passOnFees: input.passOnFees, ...(input.cardFeeBps !== undefined ? { cardFeeBps: input.cardFeeBps } : {}), ...(input.cardFeeFixedCents !== undefined ? { cardFeeFixedCents: input.cardFeeFixedCents } : {}), ...(input.grabpayFeeBps !== undefined ? { grabpayFeeBps: input.grabpayFeeBps } : {}) })
        .where(eq(organizations.id, org.id));
      await audit(tx, { orgId: org.id, actorId: req.auth.userId, action: "payments.settings", entityType: "organization", entityId: org.id, details: { onlinePayments: input.onlinePayments, payAtDesk: input.payAtDesk, passOnFees: input.passOnFees } });
      return view(org.id);
    });
  });

  // --- Clients -----------------------------------------------------------------------------

  app.get("/me/payment-card", async (req) => {
    const org = await getOrg(db, req.auth.orgId);
    const [c] = org.stripeAccountId ? await db.select().from(paymentCustomers).where(and(eq(paymentCustomers.orgId, org.id), eq(paymentCustomers.userId, req.auth.userId), eq(paymentCustomers.stripeAccountId, org.stripeAccountId))) : [];
    const card = c?.cardPaymentMethodId ? { brand: c.cardBrand, last4: c.cardLast4, expires: `${String(c.cardExpMonth).padStart(2, "0")}/${String(c.cardExpYear).slice(-2)}` } : null;
    return { card, canSave: onlineReady(org), note: "Your card is kept securely by Stripe for your membership's renewals. The studio never sees the full number." };
  });

  app.post("/me/payment-card", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    if (req.auth.role !== "client") throw forbidden("Cards are added by clients themselves.");
    const org = await getOrg(db, req.auth.orgId);
    try {
      return await startCardSetup(db, org, req.auth.userId);
    } catch (err) {
      if (err instanceof StripeError) throw conflict("stripe_error", "We couldn't open Stripe just now. Please try again in a moment.");
      throw err;
    }
  });

  app.delete("/me/payment-card", async (req) => {
    const { acknowledge } = parse(removeCard, req.body ?? {});
    const org = await getOrg(db, req.auth.orgId);
    return withFlags(app, acknowledge, async (tx, flags) => {
      const [c] = org.stripeAccountId ? await tx.select().from(paymentCustomers).where(and(eq(paymentCustomers.orgId, org.id), eq(paymentCustomers.userId, req.auth.userId), eq(paymentCustomers.stripeAccountId, org.stripeAccountId))) : [];
      if (!c?.cardPaymentMethodId) throw notFound("card");
      const live = await tx
        .select({ name: clientPackages.name })
        .from(clientPackages)
        .innerJoin(packagePlans, eq(packagePlans.id, clientPackages.planId))
        .where(and(eq(clientPackages.orgId, org.id), eq(clientPackages.ownerId, req.auth.userId), eq(packagePlans.billing, "recurring"), isNull(clientPackages.cancelledAt), isNull(clientPackages.stopsRenewingAt), gt(clientPackages.expiresAt, new Date())));
      // A membership renewing by card needs one: replace it instead.
      if (live.length) throw conflict("card_needed", `Your ${live[0]!.name} renews on this card, so it can't be removed. Replace it with another card instead, or stop the membership's renewal first.`);
      await tx.update(paymentCustomers).set({ cardPaymentMethodId: null, cardBrand: null, cardLast4: null, cardExpMonth: null, cardExpYear: null, updatedAt: new Date() }).where(eq(paymentCustomers.id, c.id));
      const api = stripe();
      if (api) await api.detachPaymentMethod(org.stripeAccountId!, c.cardPaymentMethodId).catch(() => undefined);
      await audit(tx, { orgId: org.id, actorId: req.auth.userId, action: "payment_card.removed", entityType: "user", entityId: req.auth.userId });
      return { card: null };
    });
  });

  /** Pay a waiting order online: a membership renewal (after a failed card), or something ordered earlier. */
  app.post("/orders/:id/pay", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { payWith } = parse(payOrder, req.body ?? {});
    const org = await getOrg(db, req.auth.orgId);
    const [row] = await db.select({ o: orders, planName: packagePlans.name, billing: packagePlans.billing }).from(orders).leftJoin(packagePlans, eq(packagePlans.id, orders.planId)).where(and(eq(orders.id, id), eq(orders.orgId, org.id)));
    if (!row || row.o.clientId !== req.auth.userId) throw notFound("order");
    if (row.o.status !== "pending") throw conflict("not_pending", `This order is already ${row.o.status}.`);
    if (payWith === "desk") throw badRequest("pay_at_desk", "To pay at the studio, just let the front desk know.");
    const recurring = row.billing === "recurring";
    const choice = choosePayment(org, payWith, { recurring });
    if (!choice.online) throw conflict("online_unavailable", "Online payment isn't available right now. You can pay at the studio.");
    const description = row.o.kind === "gift_card" ? `Gift card ${money(row.o.subtotalCents ?? row.o.amountCents, row.o.currency)}` : row.o.kind === "product" ? "Shop order" : `${row.planName ?? "Package"}${row.o.clientPackageId ? " (renewal)" : ""}`;
    try {
      const r = await startOnlinePayment(db, org, row.o, { method: choice.method, description, saveCard: recurring });
      return { redirectUrl: r.redirectUrl, fee: r.feeCents ? money(r.feeCents, org.currency) : null };
    } catch (err) {
      if (err instanceof StripeError) throw conflict("stripe_error", "We couldn't open the payment page just now. Please try again in a moment.");
      throw err;
    }
  });

  /** The ways to pay a waiting order (for the Pay now screen). */
  app.get("/orders/:id/pay-options", async (req) => {
    const { id } = parse(idParam, req.params);
    const org = await getOrg(db, req.auth.orgId);
    const [row] = await db.select({ o: orders, billing: packagePlans.billing }).from(orders).leftJoin(packagePlans, eq(packagePlans.id, orders.planId)).where(and(eq(orders.id, id), eq(orders.orgId, org.id)));
    if (!row || (row.o.clientId !== req.auth.userId && !can(req.auth.role, "managePackages"))) throw notFound("order");
    return { status: row.o.status, paid: row.o.status === "paid", options: row.o.status === "pending" ? payOptions(org, row.o.amountCents, { recurring: row.billing === "recurring" }).filter((o) => o.payWith !== "desk") : [], labels: PAY_WITH };
  });

  // --- Stripe --------------------------------------------------------------------------------
  app.register(async (hooks) => {
    hooks.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 512 * 1024 }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(badRequest("bad_json", "That request couldn't be understood."), undefined);
      }
    });
    hooks.post("/public/payments/stripe/webhook", { config: { public: true, rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (req, reply) => {
      const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
      const sig = String(req.headers["stripe-signature"] ?? "");
      if (!config.STRIPE_WEBHOOK_SECRET || !verifySignature(raw, sig, config.STRIPE_WEBHOOK_SECRET)) throw unauthorized();
      const ev = parse(stripeEvent, req.body) as StripeEvent;
      const handled = await handleStripeEvent(db, ev);
      return reply.send({ received: true, handled });
    });
  });
}
