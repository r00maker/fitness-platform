/**
 * Online payments: who can pay online, opening Stripe's payment page for an order, cards kept
 * for memberships, what Stripe tells us (webhooks), and refunds back to how the client paid.
 *
 * The studio is the seller (a direct charge in its own Stripe account); we never hold the money.
 * Orders, invoices and packages work exactly as before: a payment completes the order the same
 * way a desk payment does.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { PAY_WITH, PLAN_INFO, STRIPE_COUNTRY, localMethodsFor, passedOnFee, type PayWith } from "@studio/shared";
import type { Config } from "../../config.js";
import type { Db, DbOrTx } from "../../db/client.js";
import { clientPackages, invoiceRefunds, invoices, orders, organizations, packagePlans, paymentCustomers, paymentEvents, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { AppError, badRequest, conflict } from "../../lib/errors.js";
import { money } from "../bookings/rules.js";
import { notify } from "../notifications/outbox.js";
import { addInvoiceLine, invoiceFor } from "../sales/invoices.js";
import { getOrg, staffIds } from "../sessions/context.js";
import { StripeError, stripeFor, type CheckoutSession, type PaymentIntent, type PaymentMethod, type Refund, type StripeAccount, type StripeApi } from "./stripe.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
type Order = typeof orders.$inferSelect;
type OnlineMethod = "card" | "paynow" | "grabpay";

let cfg: Pick<Config, "STRIPE_SECRET_KEY" | "STRIPE_API_URL" | "PUBLIC_APP_URL"> | null = null;
/** Called once when the app (or worker) starts. */
export const configurePayments = (c: Pick<Config, "STRIPE_SECRET_KEY" | "STRIPE_API_URL" | "PUBLIC_APP_URL">) => (cfg = c);
export const stripe = (): StripeApi | null => (cfg ? stripeFor(cfg) : null);
const appUrl = () => cfg?.PUBLIC_APP_URL ?? "http://localhost:5173";

// --- Who can pay online ---------------------------------------------------------------------

/** The studio can take online payments right now. */
export const onlineReady = (org: Org) => !!stripe() && !!org.stripeAccountId && org.stripeChargesEnabled && org.onlinePayments;

/** Where the studio is with Stripe, in plain words. */
export function accountStatus(org: Org) {
  if (!stripe()) return { status: "unavailable" as const, text: "Online payments aren't set up on this platform yet. Clients pay at the studio." };
  if (!STRIPE_COUNTRY[org.currency]) return { status: "unavailable" as const, text: `Online payments aren't available for ${org.currency} yet. Clients pay at the studio.` };
  if (!org.stripeAccountId) return { status: "not_connected" as const, text: "Connect Stripe to take cards, PayNow and GrabPay. Money goes straight to your Stripe account." };
  if (org.stripeDisabledReason && !org.stripeChargesEnabled && org.stripeDetailsSubmitted) return { status: "restricted" as const, text: "Stripe has paused payments on your account. Open Stripe to see what it needs." };
  if (!org.stripeDetailsSubmitted || (!org.stripeChargesEnabled && org.stripeRequirements.length)) return { status: "needs_details" as const, text: `Stripe needs a few more details${org.stripeRequirements.length ? ` (${org.stripeRequirements.length} to go)` : ""} before you can take payments.` };
  if (!org.stripeChargesEnabled) return { status: "pending" as const, text: "Stripe is checking your details. This usually takes a few minutes, sometimes a day or two." };
  if (!org.onlinePayments) return { status: "off" as const, text: "Stripe is connected, but online payments are switched off. Clients pay at the studio." };
  return { status: "ready" as const, text: org.stripePayoutsEnabled ? "Ready: clients can pay online." : "Ready: clients can pay online. Add your bank account in Stripe to receive payouts." };
}

const feeFor = (org: Org, m: OnlineMethod, amount: number) => (!org.passOnFees || m === "paynow" ? 0 : m === "card" ? passedOnFee(amount, org.cardFeeBps, org.cardFeeFixedCents) : passedOnFee(amount, org.grabpayFeeBps, 0));

/** The ways a client can pay this amount, with any fee, for the checkout page. */
export function payOptions(org: Org, amountCents: number, opts: { recurring: boolean }) {
  const m = (c: number) => money(c, org.currency);
  const out: { payWith: PayWith; label: string; feeCents: number; fee: string | null; total: string; note?: string }[] = [];
  if (amountCents > 0 && onlineReady(org)) {
    if (org.passOnFees) {
      const methods: OnlineMethod[] = ["card", ...(opts.recurring ? [] : (localMethodsFor(org.currency) as OnlineMethod[]))];
      for (const k of methods) {
        const fee = feeFor(org, k, amountCents);
        out.push({ payWith: k, label: k === "card" ? "Card, Apple Pay or Google Pay" : PAY_WITH[k], feeCents: fee, fee: fee ? `+${m(fee)} ${k === "card" ? "card" : "GrabPay"} fee` : null, total: m(amountCents + fee), ...(k === "paynow" ? { note: "No fee" } : {}) });
      }
    } else {
      out.push({ payWith: "online", label: opts.recurring ? "Card, Apple Pay or Google Pay" : "Pay online", feeCents: 0, fee: null, total: m(amountCents) });
    }
  }
  // Memberships renew on the card they're bought with, so they can't be paid at the studio.
  if (amountCents > 0 && !opts.recurring && (org.payAtDesk || !onlineReady(org))) out.push({ payWith: "desk", label: PAY_WITH.desk, feeCents: 0, fee: null, total: m(amountCents) });
  return out;
}

export const MEMBERSHIP_NOT_ONLINE = "This membership renews by card, and the studio isn't taking card payments online yet. Ask at the front desk and they'll set it up for you.";

/** Check the client's choice before anything is created. */
export function choosePayment(org: Org, requested: PayWith | undefined, opts: { recurring: boolean }): { online: false } | { online: true; method: OnlineMethod | null } {
  const ready = onlineReady(org);
  if (opts.recurring) {
    // A membership renews on the card it's bought with: it needs a card, not the desk.
    if (!ready) throw conflict("membership_needs_card", MEMBERSHIP_NOT_ONLINE);
    if (requested === "desk") throw badRequest("membership_needs_card", "Memberships renew by card, so they're paid by card when you buy them (including Apple Pay and Google Pay).");
  }
  const choice = requested ?? (ready ? (org.passOnFees ? "card" : "online") : "desk");
  if (choice === "desk") {
    if (ready && !org.payAtDesk) throw badRequest("pay_online", "This studio takes payment online. Choose how you'd like to pay.");
    return { online: false };
  }
  if (!ready) {
    if (requested) throw conflict("online_unavailable", "Online payment isn't available right now. Choose to pay at the studio instead.");
    return { online: false };
  }
  const method = choice === "online" ? (opts.recurring ? "card" : null) : choice;
  if (opts.recurring && method !== "card") throw badRequest("membership_needs_card", "Memberships renew automatically, so they're paid by card (including Apple Pay and Google Pay).");
  if ((method === "paynow" || method === "grabpay") && !localMethodsFor(org.currency).includes(method)) throw badRequest("method_unavailable", `${PAY_WITH[method]} is only available in Singapore dollars.`);
  return { online: true, method };
}

// --- Opening Stripe's payment page ------------------------------------------------------------

async function customerFor(db: DbOrTx, api: StripeApi, org: Org, userId: string) {
  const acct = org.stripeAccountId!;
  const [c] = await db.select().from(paymentCustomers).where(and(eq(paymentCustomers.orgId, org.id), eq(paymentCustomers.userId, userId), eq(paymentCustomers.stripeAccountId, acct)));
  if (c) return c;
  const [u] = await db.select({ first: users.firstName, last: users.lastName, email: users.email }).from(users).where(eq(users.id, userId));
  const made = await api.createCustomer(acct, { name: `${u?.first ?? ""} ${u?.last ?? ""}`.trim() || "Client", email: u?.email ?? null, userId });
  await db.insert(paymentCustomers).values({ orgId: org.id, userId, stripeAccountId: acct, stripeCustomerId: made.id }).onConflictDoNothing();
  const [again] = await db.select().from(paymentCustomers).where(and(eq(paymentCustomers.orgId, org.id), eq(paymentCustomers.userId, userId), eq(paymentCustomers.stripeAccountId, acct)));
  return again!;
}

const CARD_GROUP = ["card", "apple_pay", "google_pay", "link"];
/** Show only the chosen method on Stripe's page (it lists whatever the studio switched on). */
async function exclusions(api: StripeApi, org: Org, method: OnlineMethod | null) {
  if (!method) return undefined;
  const on = await api.enabledMethods(org.stripeAccountId!);
  if (!on.includes(method)) throw conflict("method_off", `${method === "card" ? "Card payments are" : `${PAY_WITH[method]} is`} not switched on for this studio. Choose another way to pay.`);
  const keep = method === "card" ? CARD_GROUP : [method];
  // Wallets (Apple Pay, Google Pay, Link) are card payments: Stripe hides them with "card" and
  // refuses them by name.
  const out = on.filter((m) => !keep.includes(m) && !CARD_GROUP.slice(1).includes(m));
  return out.length ? out : undefined;
}

const platformFee = (org: Org, amount: number) => Math.floor((amount * (PLAN_INFO[org.plan as keyof typeof PLAN_INFO]?.paymentFeeBps ?? 0)) / 10_000);

/**
 * Open Stripe's payment page for a pending order. A card is kept for later when it's a
 * membership (it renews by card). Returns the page to send the client to.
 */
export async function startOnlinePayment(db: Db, org: Org, order: Order, opts: { method: OnlineMethod | null; description: string; saveCard: boolean }) {
  const api = stripe();
  if (!api || !onlineReady(org)) throw conflict("online_unavailable", "Online payment isn't available right now.");
  if (order.status !== "pending") throw conflict("not_pending", `This order is already ${order.status}.`);
  const method = opts.saveCard ? "card" : opts.method;
  const fee = method ? feeFor(org, method, order.amountCents) : 0;
  const customer = await customerFor(db, api, org, order.clientId);
  const excluded = await exclusions(api, org, method);
  const cur = org.currency.toLowerCase();
  const meta = { order_id: order.id, org_id: org.id };
  const appFee = platformFee(org, order.amountCents + fee);
  if (order.checkoutSessionId) await api.expireCheckoutSession(org.stripeAccountId!, order.checkoutSessionId).catch(() => undefined);
  const session = await api.createCheckoutSession(
    org.stripeAccountId!,
    {
      mode: "payment",
      customer: customer.stripeCustomerId,
      client_reference_id: order.id,
      metadata: meta,
      line_items: [
        { price_data: { currency: cur, unit_amount: order.amountCents, product_data: { name: opts.description } }, quantity: 1 },
        ...(fee ? [{ price_data: { currency: cur, unit_amount: fee, product_data: { name: method === "card" ? "Card fee" : "GrabPay fee" } }, quantity: 1 }] : []),
      ],
      payment_intent_data: { metadata: meta, description: opts.description, ...(opts.saveCard ? { setup_future_usage: "off_session" } : {}), ...(appFee ? { application_fee_amount: appFee } : {}) },
      excluded_payment_method_types: excluded,
      success_url: `${appUrl()}/payments/done?order=${order.id}`,
      cancel_url: `${appUrl()}/payments/cancelled?order=${order.id}`,
      expires_at: Math.floor(Date.now() / 1000) + 2 * 3600,
    },
    `checkout-${order.id}-${randomUUID()}`,
  );
  await db.update(orders).set({ provider: "stripe", checkoutSessionId: session.id, surchargeCents: fee }).where(eq(orders.id, order.id));
  return { redirectUrl: session.url!, feeCents: fee };
}

/** A pending order's checkout, after the order was made: send them to pay, or explain the desk. */
export async function paymentFor(db: Db, org: Org, order: Order, choice: ReturnType<typeof choosePayment>, opts: { description: string; saveCard: boolean; deskMessage: string }) {
  if (order.status !== "pending") return { online: false, message: opts.deskMessage };
  if (!choice.online) return { online: false, message: opts.deskMessage };
  try {
    const r = await startOnlinePayment(db, org, order, { method: choice.method, description: opts.description, saveCard: opts.saveCard });
    return { online: true, redirectUrl: r.redirectUrl, fee: r.feeCents ? money(r.feeCents, org.currency) : null };
  } catch (err) {
    // The order is already made: say what happened rather than failing the checkout.
    if (err instanceof AppError && err.code === "method_off") return { online: false, message: `${err.message} Your order is saved: pay for it from your orders.` };
    if (!(err instanceof StripeError)) throw err;
    return { online: false, message: `We couldn't open the payment page just now. Your order is saved: try again from your orders${org.payAtDesk ? ", or pay at the studio" : ""}.` };
  }
}

/** Saving or replacing a card (for memberships): Stripe's page in setup mode. */
export async function startCardSetup(db: Db, org: Org, userId: string) {
  const api = stripe();
  if (!api || !onlineReady(org)) throw conflict("online_unavailable", "Online payment isn't available right now.");
  const customer = await customerFor(db, api, org, userId);
  const excluded = await exclusions(api, org, "card");
  const session = await api.createCheckoutSession(
    org.stripeAccountId!,
    {
      mode: "setup",
      currency: org.currency.toLowerCase(),
      customer: customer.stripeCustomerId,
      metadata: { purpose: "save_card", user_id: userId, org_id: org.id },
      excluded_payment_method_types: excluded,
      success_url: `${appUrl()}/payments/card-saved`,
      cancel_url: `${appUrl()}/account/payment`,
    },
    `setup-${userId}-${randomUUID()}`,
  );
  return { redirectUrl: session.url! };
}

/** Stop a payment page that's no longer needed (paid at the desk, cancelled). Best effort. */
export async function closeCheckout(org: Pick<Org, "stripeAccountId">, order: Pick<Order, "checkoutSessionId">) {
  const api = stripe();
  if (api && org.stripeAccountId && order.checkoutSessionId) await api.expireCheckoutSession(org.stripeAccountId, order.checkoutSessionId).catch(() => undefined);
}

// --- Memberships: charging the saved card -------------------------------------------------------

/** Why a card was declined, in words a client understands. */
export function declineMessage(e: StripeError) {
  const c = e.declineCode ?? e.code ?? "";
  if (c === "authentication_required") return "your bank wants you to confirm this payment. Open the app and tap Pay now";
  if (c === "insufficient_funds") return "not enough funds on the card";
  if (c === "expired_card") return "the card has expired";
  if (c === "lost_card" || c === "stolen_card" || c === "pickup_card") return "the card can't be used any more";
  if (c === "incorrect_cvc" || c === "incorrect_number" || c === "invalid_expiry_year" || c === "invalid_expiry_month") return "the card details are wrong";
  if (c === "card_velocity_exceeded" || c === "withdrawal_count_limit_exceeded") return "the card's limit has been reached";
  if (e.type === "card_error") return "the card was declined";
  return "the payment couldn't be taken";
}

/** The renewal charger: the client's saved card, in the studio's Stripe account. */
export function stripeRenewalCharger(db: Db) {
  return {
    name: "stripe",
    async ready(orgId: string, clientId: string) {
      const org = await getOrg(db, orgId);
      if (!onlineReady(org)) return false;
      const [c] = await db.select().from(paymentCustomers).where(and(eq(paymentCustomers.orgId, orgId), eq(paymentCustomers.userId, clientId), eq(paymentCustomers.stripeAccountId, org.stripeAccountId!)));
      return !!c?.cardPaymentMethodId;
    },
    async charge(i: { orgId: string; clientId: string; invoiceId: string; amountCents: number; currency: string; description: string }) {
      const api = stripe();
      const org = await getOrg(db, i.orgId);
      const [c] = await db.select().from(paymentCustomers).where(and(eq(paymentCustomers.orgId, i.orgId), eq(paymentCustomers.userId, i.clientId), eq(paymentCustomers.stripeAccountId, org.stripeAccountId ?? "")));
      if (!api || !c?.cardPaymentMethodId) return { ok: false as const, reason: "there's no card saved" };
      // One attempt per invoice, card and day: a repeat the same day returns the same answer,
      // but a new card (after a decline) is a new attempt.
      const day = new Date().toISOString().slice(0, 10);
      try {
        const pi = await api.chargeSavedCard(org.stripeAccountId!, { customer: c.stripeCustomerId, paymentMethod: c.cardPaymentMethodId, amount: i.amountCents, currency: i.currency, description: i.description, metadata: { invoice_id: i.invoiceId, org_id: i.orgId, purpose: "renewal" }, applicationFee: platformFee(org, i.amountCents) }, `renewal-${i.invoiceId}-${c.cardPaymentMethodId}-${day}`);
        if (pi.status === "succeeded" || pi.status === "processing") return { ok: true as const, ref: pi.id };
        return { ok: false as const, reason: pi.status === "requires_action" ? "your bank wants you to confirm this payment. Open the app and tap Pay now" : "the payment couldn't be taken" };
      } catch (err) {
        if (err instanceof StripeError) return { ok: false as const, reason: declineMessage(err) };
        throw err;
      }
    },
  };
}

// --- Stripe's side: account status ---------------------------------------------------------------

export async function saveAccountStatus(tx: DbOrTx, org: Org, a: StripeAccount) {
  const before = org.stripeChargesEnabled;
  const [u] = await tx
    .update(organizations)
    .set({
      stripeChargesEnabled: a.charges_enabled,
      stripePayoutsEnabled: a.payouts_enabled,
      stripeDetailsSubmitted: a.details_submitted,
      stripeRequirements: [...new Set([...(a.requirements?.past_due ?? []), ...(a.requirements?.currently_due ?? [])])],
      stripeDisabledReason: a.requirements?.disabled_reason ?? null,
    })
    .where(eq(organizations.id, org.id))
    .returning();
  if (!before && a.charges_enabled) {
    await notify(tx, { orgId: org.id, userIds: await staffIds(tx, org.id, ["owner", "admin"]), template: "payments.ready", data: { studioName: org.name } });
    await audit(tx, { orgId: org.id, actorId: null, action: "payments.ready", entityType: "organization", entityId: org.id });
  }
  return u!;
}

// --- Stripe's side: webhooks -------------------------------------------------------------------

export interface StripeEvent {
  id: string;
  type: string;
  account?: string | null;
  data?: { object?: Record<string, unknown> } | null;
  /** v2 thin events: what changed (the account), to be looked up. */
  related_object?: { id?: string; type?: string } | null;
}
type Followup = () => Promise<unknown>;

const pmOf = (pi: PaymentIntent | null): PaymentMethod | null => (pi && typeof pi.payment_method === "object" ? pi.payment_method : null);
/** card, apple_pay, google_pay, paynow, grabpay... */
const paidWith = (pm: PaymentMethod | null) => (pm ? (pm.card?.wallet?.type ?? pm.type) : null);

async function saveCard(tx: DbOrTx, org: Org, userId: string, customerId: string | null, pm: PaymentMethod | null) {
  if (!pm?.card || !customerId) return;
  await tx
    .update(paymentCustomers)
    .set({ cardPaymentMethodId: pm.id, cardBrand: pm.card.brand, cardLast4: pm.card.last4, cardExpMonth: pm.card.exp_month, cardExpYear: pm.card.exp_year, updatedAt: new Date() })
    .where(and(eq(paymentCustomers.orgId, org.id), eq(paymentCustomers.userId, userId), eq(paymentCustomers.stripeCustomerId, customerId)));
}

/** An order was paid on Stripe's page. Completes it as a desk payment would. */
async function orderPaid(tx: DbOrTx, org: Org, session: CheckoutSession, later: Followup[]) {
  const orderId = session.metadata?.order_id ?? session.client_reference_id;
  if (!orderId) return;
  const pi = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const piId = pi?.id ?? (typeof session.payment_intent === "string" ? session.payment_intent : null);
  const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, org.id))).for("update");
  if (!o) return;
  if (o.providerRef === piId && o.status === "paid") return; // already handled
  if (o.status !== "pending") {
    // Paid twice (paid at the desk too) or the order was cancelled: give the money back.
    if (piId) later.push(() => refundWhole(org, o, piId, o.status === "paid" ? "Paid twice: also paid at the studio" : "The order was cancelled before payment arrived"));
    return;
  }
  const pm = pmOf(pi);
  await tx.update(orders).set({ provider: "stripe", providerRef: piId, paidWith: paidWith(pm), checkoutSessionId: null }).where(eq(orders.id, o.id));
  if (o.surchargeCents > 0) {
    const inv = await invoiceFor(tx, { orderId: o.id });
    if (inv) await addInvoiceLine(tx, inv, { description: paidWith(pm) === "grabpay" ? "GrabPay fee" : "Card fee", quantity: 1, unitCents: o.surchargeCents });
  }
  // Same completion as a desk payment, with the client as the one who paid.
  const { completeOrderById } = await import("../checkout/routes.js");
  await completeOrderById(tx, { userId: o.clientId, orgId: org.id, role: "client" }, o.id, "online");
  // A membership's first payment keeps the card for its renewals.
  if (pm?.card) {
    const [plan] = o.planId ? await tx.select({ billing: packagePlans.billing }).from(packagePlans).where(eq(packagePlans.id, o.planId)) : [];
    if (plan?.billing === "recurring" || o.clientPackageId) await saveCard(tx, org, o.clientId, session.customer, pm);
  }
}

/** Give a whole payment back (paid twice, or for a cancelled order). */
async function refundWhole(org: Org, o: Order, paymentIntent: string, why: string) {
  const api = stripe();
  if (!api || !org.stripeAccountId) return;
  await api.createRefund(org.stripeAccountId, { paymentIntent, amount: o.amountCents + o.surchargeCents, metadata: { order_id: o.id, reason: why, automatic: "true" } }, `auto-refund-${paymentIntent}`);
}

/** Refund status updates, and refunds made in the studio's Stripe dashboard. */
async function refundChanged(tx: DbOrTx, org: Org, r: Refund) {
  const [ours] = await tx.select().from(invoiceRefunds).where(or(eq(invoiceRefunds.providerRef, r.id), r.metadata?.invoice_refund_id ? eq(invoiceRefunds.id, r.metadata.invoice_refund_id) : undefined)).for("update");
  if (ours) {
    if (ours.providerStatus === r.status) return;
    await tx.update(invoiceRefunds).set({ providerRef: r.id, providerStatus: r.status }).where(eq(invoiceRefunds.id, ours.id));
    if ((r.status === "failed" || r.status === "canceled") && ours.providerStatus !== "failed" && ours.providerStatus !== "canceled") {
      // The money didn't go back: the sale shows as not refunded, and the studio is told.
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, ours.invoiceId)).for("update");
      if (inv) {
        const refunded = Math.max(0, inv.refundedCents - ours.amountCents);
        await tx.update(invoices).set({ refundedCents: refunded, status: refunded === 0 ? "paid" : "partly_refunded" }).where(eq(invoices.id, inv.id));
        await notify(tx, { orgId: org.id, userIds: await staffIds(tx, org.id, ["owner", "admin"]), template: "payment.refund_failed", data: { amount: money(ours.amountCents, inv.currency), number: inv.number, reason: r.failure_reason ?? "", invoiceId: inv.id } });
      }
    }
    return;
  }
  if (r.metadata?.invoice_refund_id) throw new Error("refund not recorded yet; Stripe will send it again");
  if (r.metadata?.automatic === "true" || r.status === "failed" || r.status === "canceled" || !r.payment_intent) return;
  // Made in the studio's Stripe dashboard: record it against the sale so reports agree.
  const [o] = await tx.select().from(orders).where(and(eq(orders.orgId, org.id), eq(orders.providerRef, r.payment_intent)));
  const inv = o ? await invoiceFor(tx, { orderId: o.id }) : null;
  if (!inv || (inv.status !== "paid" && inv.status !== "partly_refunded")) return;
  const amount = Math.min(r.amount, inv.totalCents - inv.refundedCents);
  if (amount <= 0) return;
  await tx.insert(invoiceRefunds).values({ orgId: org.id, invoiceId: inv.id, amountCents: amount, method: "original_payment", reason: "Refunded in Stripe", providerRef: r.id, providerStatus: r.status });
  const refunded = inv.refundedCents + amount;
  await tx.update(invoices).set({ refundedCents: refunded, status: refunded >= inv.totalCents ? "refunded" : "partly_refunded" }).where(eq(invoices.id, inv.id));
  await audit(tx, { orgId: org.id, actorId: null, action: "sale.refunded", entityType: "invoice", entityId: inv.id, details: { amountCents: amount, method: "original_payment", via: "stripe_dashboard" } });
}

/** Handle one webhook event. Repeats do nothing; an error makes Stripe send it again later. */
export async function handleStripeEvent(db: Db, ev: StripeEvent) {
  const api = stripe();
  if (!api) return "not_configured";
  // v2 account events only say which account changed: read it from Stripe.
  const thinAccount = ev.type.startsWith("v2.core.account") && ev.related_object?.type === "v2.core.account" ? ev.related_object.id ?? null : null;
  const acct = ev.account ?? thinAccount;
  let fresh: StripeAccount | null = null;
  if (thinAccount) fresh = await api.getAccount(thinAccount);
  const [org0] = acct ? await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.stripeAccountId, acct)) : [];
  // Fetch the full session from Stripe (the event's copy is a summary).
  let session: CheckoutSession | null = null;
  if (org0 && acct && (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded")) session = await api.getCheckoutSession(acct, String(ev.data?.object?.id));
  const later: Followup[] = [];
  const result = await db.transaction(async (tx) => {
    const [isNew] = await tx.insert(paymentEvents).values({ id: ev.id, type: ev.type, account: acct, orgId: org0?.id ?? null }).onConflictDoNothing().returning();
    if (!isNew) return "duplicate";
    if (!org0) return "ignored";
    const org = await getOrg(tx, org0.id);
    if (fresh) {
      await saveAccountStatus(tx, org, fresh);
      return "account";
    }
    const obj = ev.data?.object ?? {};
    switch (ev.type) {
      case "account.updated":
        await saveAccountStatus(tx, org, obj as unknown as StripeAccount);
        return "account";
      case "account.application.deauthorized":
        await tx.update(organizations).set({ stripeAccountId: null, stripeChargesEnabled: false, stripePayoutsEnabled: false, stripeDetailsSubmitted: false, stripeRequirements: [], stripeDisabledReason: null }).where(eq(organizations.id, org.id));
        await notify(tx, { orgId: org.id, userIds: await staffIds(tx, org.id, ["owner"]), template: "payments.disconnected", data: { studioName: org.name } });
        await audit(tx, { orgId: org.id, actorId: null, action: "payments.disconnected", entityType: "organization", entityId: org.id });
        return "disconnected";
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = session!;
        if (s.mode === "setup") {
          const si = typeof s.setup_intent === "object" ? s.setup_intent : null;
          const pm = si && typeof si.payment_method === "object" ? si.payment_method : null;
          const userId = s.metadata?.user_id;
          if (userId) {
            await saveCard(tx, org, userId, s.customer, pm);
            // A membership on hold for a failed payment is tried again straight away.
            const held = await tx.select({ id: clientPackages.id }).from(clientPackages).where(and(eq(clientPackages.orgId, org.id), eq(clientPackages.ownerId, userId), isNull(clientPackages.cancelledAt), isNotNull(clientPackages.paymentHeldAt)));
            for (const h of held) later.push(async () => (await import("../packages/payments.js")).chargeRenewal(db, h.id));
          }
          return "card_saved";
        }
        if (s.payment_status !== "paid") return "awaiting_payment"; // PayNow etc. confirm later
        await orderPaid(tx, org, s, later);
        return "paid";
      }
      case "checkout.session.async_payment_failed": {
        const orderId = (obj.metadata as Record<string, string> | undefined)?.order_id;
        const [o] = orderId ? await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, org.id))) : [];
        if (o?.status === "pending") {
          await tx.update(orders).set({ checkoutSessionId: null, surchargeCents: 0 }).where(eq(orders.id, o.id));
          await notify(tx, { orgId: org.id, userIds: [o.clientId], template: "payment.failed", data: { amount: money(o.amountCents, o.currency), orderId: o.id } });
        }
        return "failed";
      }
      case "checkout.session.expired": {
        await tx.update(orders).set({ checkoutSessionId: null, surchargeCents: 0 }).where(and(eq(orders.orgId, org.id), eq(orders.checkoutSessionId, String(obj.id)), eq(orders.status, "pending")));
        return "expired";
      }
      case "refund.created":
      case "refund.updated":
      case "refund.failed":
        await refundChanged(tx, org, obj as unknown as Refund);
        return "refund";
      case "charge.dispute.created": {
        const pi = String(obj.payment_intent ?? "");
        const [o] = pi ? await tx.select().from(orders).where(and(eq(orders.orgId, org.id), eq(orders.providerRef, pi))) : [];
        const amount = money(Number(obj.amount ?? 0), String(obj.currency ?? org.currency).toUpperCase());
        await notify(tx, { orgId: org.id, userIds: await staffIds(tx, org.id, ["owner", "admin"]), template: "payment.disputed", data: { amount, reason: String(obj.reason ?? "").replace(/_/g, " "), clientId: o?.clientId ?? null, orderId: o?.id ?? null } });
        await audit(tx, { orgId: org.id, actorId: null, action: "payment.disputed", entityType: "order", entityId: o?.id ?? org.id, details: { amount: Number(obj.amount ?? 0), reason: obj.reason } });
        return "dispute";
      }
      default:
        return "ignored";
    }
  });
  for (const f of later) await f();
  return result;
}

// --- Refunds made here -------------------------------------------------------------------------

/** Was this sale paid online through Stripe? */
export async function paidOnline(tx: DbOrTx, inv: typeof invoices.$inferSelect) {
  if (!inv.orderId) return false;
  const [o] = await tx.select({ provider: orders.provider, ref: orders.providerRef }).from(orders).where(eq(orders.id, inv.orderId));
  return o?.provider === "stripe" && !!o.ref;
}

/**
 * A refund "back to how they paid" for a sale paid online: Stripe sends it. Runs inside the
 * refund's transaction, so if Stripe refuses, nothing is recorded.
 */
export async function refundOnline(tx: DbOrTx, inv: typeof invoices.$inferSelect, refundId: string, amountCents: number) {
  if (!inv.orderId) return null;
  const [o] = await tx.select().from(orders).where(eq(orders.id, inv.orderId));
  if (o?.provider !== "stripe" || !o.providerRef) return null;
  const org = await getOrg(tx, inv.orgId);
  const api = stripe();
  if (!api || !org.stripeAccountId) throw conflict("refund_unavailable", "This was paid online, but Stripe isn't connected any more. Refund it as studio credit, or from your Stripe dashboard.");
  try {
    const r = await api.createRefund(org.stripeAccountId, { paymentIntent: o.providerRef, amount: amountCents, metadata: { invoice_refund_id: refundId, invoice: inv.number } }, `refund-${refundId}`);
    await tx.update(invoiceRefunds).set({ providerRef: r.id, providerStatus: r.status }).where(eq(invoiceRefunds.id, refundId));
    return { status: r.status, paidWith: o.paidWith };
  } catch (err) {
    if (err instanceof StripeError) throw conflict("refund_failed", `Stripe couldn't make the refund: ${err.message}`);
    throw err;
  }
}

/** Recent online payments for the studio's Payments page. */
export async function recentOnline(db: DbOrTx, orgId: string) {
  const rows = await db
    .select({ o: orders, first: users.firstName, last: users.lastName })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.clientId))
    .where(and(eq(orders.orgId, orgId), eq(orders.provider, "stripe"), inArray(orders.status, ["paid"])))
    .orderBy(desc(orders.paidAt))
    .limit(20);
  return rows.map((r) => ({ id: r.o.id, client: `${r.first} ${r.last}`, amount: money(r.o.amountCents + r.o.surchargeCents, r.o.currency), fee: r.o.surchargeCents ? money(r.o.surchargeCents, r.o.currency) : null, paidWith: r.o.paidWith, at: r.o.paidAt }));
}
