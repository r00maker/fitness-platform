import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { passedOnFee } from "@studio/shared";
import { clientPackages, files, giftCardDesigns, giftCards, invoiceRefunds, invoices, orders, organizations, paymentCustomers } from "../src/db/schema.js";
import { renewDuePackages } from "../src/modules/packages/lifecycle.js";
import { setRenewalCharger } from "../src/modules/packages/payments.js";
import { stripeRenewalCharger } from "../src/modules/payments/service.js";
import { setStripe, signPayload, StripeError, verifySignature, type CheckoutSession, type StripeApi } from "../src/modules/payments/stripe.js";
import { app, config, db, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterEach(() => {
  setStripe(null);
  setRenewalCharger(null);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

/** A stand-in for Stripe that remembers what it was asked. */
function fakeStripe() {
  let n = 0;
  const sessions = new Map<string, { account: string; p: Record<string, any> }>();
  const f = {
    calls: [] as [string, ...unknown[]][],
    paidWith: "card" as string,
    decline: null as StripeError | null,
    refundStatus: "succeeded" as "succeeded" | "pending",
    sessions,
    api: null as unknown as StripeApi,
  };
  f.api = {
    async createAccount(p) { f.calls.push(["createAccount", p]); return { id: "acct_new", charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: ["external_account", "tos_acceptance.date"] } }; },
    async getAccount(id) { return { id, charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } }; },
    async accountLink(account) { f.calls.push(["accountLink", account]); return { url: `https://connect.stripe.com/setup/${account}` }; },
    async createCustomer(account, p) { f.calls.push(["createCustomer", account, p.userId]); return { id: `cus_${++n}` }; },
    async enabledMethods() { return ["card", "apple_pay", "google_pay", "link", "paynow", "grabpay"]; },
    async createCheckoutSession(account, p) {
      const id = `cs_${++n}`;
      sessions.set(id, { account, p });
      f.calls.push(["createCheckoutSession", account, p]);
      return { id, url: `https://checkout.stripe.com/c/${id}`, mode: p.mode as "payment", status: "open", payment_status: "unpaid", client_reference_id: (p.client_reference_id as string) ?? null, metadata: p.metadata as Record<string, string>, customer: p.customer as string, payment_intent: null, setup_intent: null };
    },
    async getCheckoutSession(_account, id): Promise<CheckoutSession> {
      const s = sessions.get(id)!;
      const pm = { id: `pm_${id}`, type: f.paidWith, ...(f.paidWith === "card" ? { card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030, wallet: null } } : {}) };
      const total = ((s.p.line_items ?? []) as { price_data: { unit_amount: number } }[]).reduce((a, l) => a + l.price_data.unit_amount, 0);
      return {
        id, url: null, mode: s.p.mode, status: "complete", payment_status: s.p.mode === "setup" ? "no_payment_required" : "paid", client_reference_id: s.p.client_reference_id ?? null, metadata: s.p.metadata, customer: s.p.customer,
        payment_intent: s.p.mode === "payment" ? { id: `pi_${id}`, status: "succeeded", amount: total, payment_method: pm, metadata: s.p.metadata } : null,
        setup_intent: s.p.mode === "setup" ? { id: `seti_${id}`, payment_method: pm } : null,
      };
    },
    async expireCheckoutSession(_a, id) { f.calls.push(["expire", id]); },
    async chargeSavedCard(account, p, key) {
      f.calls.push(["chargeSavedCard", account, p, key]);
      if (f.decline) throw f.decline;
      return { id: `pi_renew_${++n}`, status: "succeeded", amount: p.amount, payment_method: p.paymentMethod, metadata: p.metadata };
    },
    async createRefund(account, p) { f.calls.push(["createRefund", account, p]); return { id: `re_${++n}`, status: f.refundStatus, amount: p.amount, payment_intent: p.paymentIntent, metadata: p.metadata }; },
    async detachPaymentMethod(_a, id) { f.calls.push(["detach", id]); },
  };
  setStripe(f.api);
  return f;
}

let evN = 0;
async function webhook(type: string, object: Record<string, unknown>, account = "acct_studio", opts: { id?: string; secret?: string; at?: number } = {}) {
  const raw = JSON.stringify({ id: opts.id ?? `evt_${++evN}`, type, account, data: { object } });
  const res = await app.inject({ method: "POST", url: "/v1/public/payments/stripe/webhook", headers: { "content-type": "application/json", "stripe-signature": signPayload(raw, opts.secret ?? config.STRIPE_WEBHOOK_SECRET!, opts.at) }, payload: raw });
  return { status: res.statusCode, body: res.json() };
}
const paid = (sessionId: string) => webhook("checkout.session.completed", { id: sessionId, object: "checkout.session" });

/** A studio already connected to Stripe and ready to take payments. */
async function connected() {
  const f = fakeStripe();
  const s = await studio();
  await db.update(organizations).set({ stripeAccountId: "acct_studio", stripeChargesEnabled: true, stripePayoutsEnabled: true, stripeDetailsSubmitted: true }).where(eq(organizations.id, s.orgId));
  const pack = (await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 3000, validityValue: 3, validityUnit: "months" })).body;
  return { f, s, pack };
}
const lastSession = (f: ReturnType<typeof fakeStripe>) => [...f.sessions.entries()].at(-1)!;
const invoiceOf = async (orderId: string) => (await db.select().from(invoices).where(eq(invoices.orderId, orderId)))[0]!;

describe("payments: connecting Stripe", () => {
  it("the owner connects; Stripe's updates make the studio ready and tell the team", async () => {
    const f = fakeStripe();
    const s = await studio();
    const admin = await (await import("./helpers.js")).person(s.orgId, "admin", "Ada");
    expect((await s.owner.call("GET", "/payments")).body.status).toBe("not_connected");
    expect((await admin.call("POST", "/payments/connect")).status).toBe(403);
    const r = await s.owner.call("POST", "/payments/connect");
    expect(r.status).toBe(200);
    expect(r.body.url).toContain("acct_new");
    expect(f.calls.find((c) => c[0] === "createAccount")![1]).toMatchObject({ country: "SG", orgId: s.orgId, currency: "SGD", capabilities: ["card_payments", "paynow_payments", "grabpay_payments"] });
    // Again: the same account, a fresh sign-up link.
    await s.owner.call("POST", "/payments/connect");
    expect(f.calls.filter((c) => c[0] === "createAccount")).toHaveLength(1);

    const pending = await webhook("account.updated", { id: "acct_new", charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements: { currently_due: ["external_account"] } }, "acct_new");
    expect(pending.body.handled).toBe("account");
    let v = (await s.owner.call("GET", "/payments")).body;
    expect(v.status).toBe("needs_details");
    expect(v.statusText).toContain("1 to go");

    await webhook("account.updated", { id: "acct_new", charges_enabled: true, payouts_enabled: false, details_submitted: true, requirements: { currently_due: [] } }, "acct_new");
    v = (await s.owner.call("GET", "/payments")).body;
    expect(v.status).toBe("ready");
    expect(v.statusText).toContain("bank account");
    expect([...new Set((await outbox("payments.ready")).map((n) => n.userId))].sort()).toEqual([s.owner.id, admin.id].sort());
  });

  it("refuses webhooks that aren't signed by Stripe, old ones, and handles repeats once", async () => {
    fakeStripe();
    const s = await studio();
    await db.update(organizations).set({ stripeAccountId: "acct_studio" }).where(eq(organizations.id, s.orgId));
    expect((await webhook("account.updated", { id: "acct_studio" }, "acct_studio", { secret: "whsec_wrong" })).status).toBe(401);
    expect((await webhook("account.updated", { id: "acct_studio" }, "acct_studio", { at: Date.now() - 3600_000 })).status).toBe(401);
    const ev = { id: "acct_studio", charges_enabled: true, payouts_enabled: true, details_submitted: true };
    expect((await webhook("account.updated", ev, "acct_studio", { id: "evt_same" })).body.handled).toBe("account");
    expect((await webhook("account.updated", ev, "acct_studio", { id: "evt_same" })).body.handled).toBe("duplicate");
    expect(new Set((await outbox("payments.ready")).map((n) => n.userId)).size).toBe(1);
    // The signature check itself.
    const raw = '{"a":1}';
    expect(verifySignature(raw, signPayload(raw, "whsec_x"), "whsec_x")).toBe(true);
    expect(verifySignature('{"a":2}', signPayload(raw, "whsec_x"), "whsec_x")).toBe(false);
    // Two destinations (payment events and account events), two secrets.
    expect(verifySignature(raw, signPayload(raw, "whsec_b"), "whsec_a, whsec_b")).toBe(true);
    expect(verifySignature(raw, signPayload(raw, "whsec_c"), "whsec_a, whsec_b")).toBe(false);
  });

  it("v2 account notices (thin events) are looked up from Stripe", async () => {
    fakeStripe();
    const s = await studio();
    await db.update(organizations).set({ stripeAccountId: "acct_v2" }).where(eq(organizations.id, s.orgId));
    const raw = JSON.stringify({ id: "evt_test_thin1", object: "v2.core.event", type: "v2.core.account[configuration.merchant].capability_status_updated", related_object: { id: "acct_v2", type: "v2.core.account", url: "/v2/core/accounts/acct_v2" }, context: null });
    const res = await app.inject({ method: "POST", url: "/v1/public/payments/stripe/webhook", headers: { "content-type": "application/json", "stripe-signature": signPayload(raw, config.STRIPE_WEBHOOK_SECRET!) }, payload: raw });
    expect(res.json().handled).toBe("account");
    expect((await s.owner.call("GET", "/payments")).body.status).toBe("ready"); // the fake account is fully set up
  });

  it("a studio that disconnects Stripe goes back to paying at the studio", async () => {
    const { s, pack } = await connected();
    await webhook("account.application.deauthorized", { id: "ca_1" });
    expect((await s.owner.call("GET", "/payments")).body.status).toBe("not_connected");
    expect([...new Set((await outbox("payments.disconnected")).map((n) => n.userId))]).toEqual([s.owner.id]);
    const q = (await s.c1.call("GET", `/checkout/quote?planId=${pack.id}`)).body;
    expect(q.payments.options.map((o: { payWith: string }) => o.payWith)).toEqual(["desk"]);
  });
});

describe("payments: paying online", () => {
  it("a client pays for a package online; the webhook completes it like a desk payment", async () => {
    const { f, s, pack } = await connected();
    const q = (await s.c1.call("GET", `/checkout/quote?planId=${pack.id}`)).body;
    expect(q.payments.online).toBe(true);
    expect(q.payments.options.map((o: { payWith: string }) => o.payWith)).toEqual(["online", "desk"]);

    const r = await s.c1.call("POST", "/checkout", { planId: pack.id });
    expect(r.status).toBe(201);
    expect(r.body.payment.online).toBe(true);
    expect(r.body.payment.redirectUrl).toMatch(/^https:\/\/checkout\.stripe\.com/);
    const [sid, sess] = lastSession(f);
    expect(sess.account).toBe("acct_studio");
    expect(sess.p.line_items).toHaveLength(1);
    expect(sess.p.line_items[0].price_data).toMatchObject({ currency: "sgd", unit_amount: 3000 });
    expect(sess.p.payment_intent_data.setup_future_usage).toBeUndefined();
    expect(sess.p.payment_intent_data.application_fee_amount).toBeUndefined(); // no cut
    expect(sess.p.excluded_payment_method_types).toBeUndefined(); // every method the studio switched on

    expect((await paid(sid)).body.handled).toBe("paid");
    const [o] = await db.select().from(orders).where(eq(orders.id, r.body.order.id));
    expect(o).toMatchObject({ status: "paid", provider: "stripe", providerRef: `pi_${sid}`, paidWith: "card", checkoutSessionId: null });
    expect(o!.clientPackageId).toBeTruthy();
    const inv = await invoiceOf(o!.id);
    expect(inv).toMatchObject({ status: "paid", paymentMethod: "online", totalCents: 3000 });
    // Stripe sends events more than once: still one package.
    await paid(sid);
    expect(await db.select().from(clientPackages).where(eq(clientPackages.ownerId, s.c1.id))).toHaveLength(1);
  });

  it("passes the fee on for cards and GrabPay only, shown first and added to the invoice", async () => {
    const { f, s, pack } = await connected();
    const on = { onlinePayments: true, payAtDesk: true, passOnFees: true };
    const ask = await s.owner.call("PUT", "/payments/settings", on);
    expect(ask.status).toBe(409);
    expect(ask.body.error.flags[0].code).toBe("pass_on_fees");
    expect((await s.owner.call("PUT", "/payments/settings", { ...on, acknowledge: ["pass_on_fees"] })).status).toBe(200);

    const fee = passedOnFee(3000, 340, 50);
    expect(fee).toBe(158); // (30.00 + 0.50) / (1 − 3.4%) = 31.58
    const q = (await s.c1.call("GET", `/checkout/quote?planId=${pack.id}`)).body;
    const opts = Object.fromEntries(q.payments.options.map((o: { payWith: string; feeCents: number }) => [o.payWith, o.feeCents]));
    expect(opts).toEqual({ card: 158, paynow: 0, grabpay: passedOnFee(3000, 330, 0), desk: 0 });

    // PayNow: no fee, and only PayNow on Stripe's page.
    const pn = await s.c1.call("POST", "/checkout", { planId: pack.id, payWith: "paynow" });
    let [, sess] = lastSession(f);
    expect(sess.p.line_items).toHaveLength(1);
    expect(sess.p.excluded_payment_method_types).toEqual(["card", "grabpay"]); // wallets go with "card"
    await s.c1.call("POST", `/orders/${pn.body.order.id}/cancel`);

    const r = await s.c1.call("POST", "/checkout", { planId: pack.id, payWith: "card" });
    expect(r.body.payment.fee).toBe("SGD 1.58");
    let sid: string;
    [sid, sess] = lastSession(f);
    expect(sess.p.line_items.map((l: { price_data: { unit_amount: number; product_data: { name: string } } }) => [l.price_data.product_data.name, l.price_data.unit_amount])).toEqual([["10-class pack", 3000], ["Card fee", 158]]);
    expect(sess.p.excluded_payment_method_types).toEqual(["paynow", "grabpay"]); // cards and wallets stay
    await paid(sid);
    const inv = await invoiceOf(r.body.order.id);
    expect(inv.totalCents).toBe(3158);
    expect(inv.lines.map((l) => l.description)).toEqual(["10-class pack", "Card fee"]);
  });

  it("keeps paying at the studio possible unless the studio switches it off", async () => {
    const { s, pack } = await connected();
    expect((await s.owner.call("PUT", "/payments/settings", { onlinePayments: false, payAtDesk: false, passOnFees: false })).status).toBe(400);
    expect((await s.owner.call("PUT", "/payments/settings", { onlinePayments: true, payAtDesk: false, passOnFees: false })).status).toBe(200);
    const q = (await s.c1.call("GET", `/checkout/quote?planId=${pack.id}`)).body;
    expect(q.payments.options.map((o: { payWith: string }) => o.payWith)).toEqual(["online"]);
    expect((await s.c1.call("POST", "/checkout", { planId: pack.id, payWith: "desk" })).status).toBe(400);
  });

  it("an order paid at the desk closes its payment page, and a late online payment is refunded", async () => {
    const { f, s, pack } = await connected();
    const r = await s.c1.call("POST", "/checkout", { planId: pack.id });
    const [sid] = lastSession(f);
    expect((await s.owner.call("POST", `/orders/${r.body.order.id}/mark-paid`, { method: "cash" })).status).toBe(200);
    expect(f.calls).toContainEqual(["expire", sid]);
    // Paid on the page anyway (it was already open): the money goes back automatically.
    await paid(sid);
    const refund = f.calls.find((c) => c[0] === "createRefund");
    expect(refund?.[2]).toMatchObject({ paymentIntent: `pi_${sid}`, amount: 3000 });
    expect(await db.select().from(clientPackages).where(eq(clientPackages.ownerId, s.c1.id))).toHaveLength(1);
  });

  it("gift cards and shop orders can be paid online too", async () => {
    const { f, s } = await connected();
    const [file] = await db.insert(files).values({ orgId: s.orgId, uploadedBy: s.owner.id, purpose: "gift_card_design", contentType: "image/png", sizeBytes: 1, data: Buffer.from([0]) }).returning();
    const [design] = await db.insert(giftCardDesigns).values({ orgId: s.orgId, name: "Plain", fileId: file!.id }).returning();
    await db.update(organizations).set({ giftCardsEnabled: true, giftCardAmounts: [5000] }).where(eq(organizations.id, s.orgId));
    const g = await s.c1.call("POST", "/gift-cards/checkout", { designId: design!.id, amountCents: 5000 });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(g.body.payment.online).toBe(true);
    await paid(lastSession(f)[0]);
    const [card] = await db.select().from(giftCards).where(eq(giftCards.id, g.body.giftCard.id));
    expect(card!.status).not.toBe("pending_payment");

    const prod = await s.owner.call("POST", "/shop/products", { name: "Grip socks", priceCents: 1800 });
    expect(prod.status, JSON.stringify(prod.body)).toBe(201);
    const o = await s.c1.call("POST", "/shop/checkout", { items: [{ productId: prod.body.id, quantity: 1 }] });
    expect(o.body.payment.online).toBe(true);
    const [sid, sess] = lastSession(f);
    expect(sess.p.line_items[0].price_data.unit_amount).toBe(1800);
    await paid(sid);
    expect((await s.c1.call("GET", "/me/shop-orders")).body.orders[0].status).toBe("ready");
  });
});

describe("payments: memberships and cards on file", () => {
  async function membership() {
    const c = await connected();
    const plan = (await c.s.owner.call("POST", "/package-plans", { name: "Unlimited monthly", kind: "unlimited", billing: "recurring", validityValue: 1, validityUnit: "months", priceCents: 20000 })).body;
    return { ...c, plan };
  }

  it("a membership is paid by card and the card is kept for renewals, which charge it", async () => {
    const { f, s, plan } = await membership();
    expect((await s.c1.call("POST", "/checkout", { planId: plan.id, payWith: "paynow" })).body.error.code).toBe("membership_needs_card");
    const r = await s.c1.call("POST", "/checkout", { planId: plan.id });
    const [sid, sess] = lastSession(f);
    expect(sess.p.payment_intent_data.setup_future_usage).toBe("off_session");
    expect(sess.p.excluded_payment_method_types).toEqual(["paynow", "grabpay"]);
    await paid(sid);
    const card = (await s.c1.call("GET", "/me/payment-card")).body.card;
    expect(card).toEqual({ brand: "visa", last4: "4242", expires: "12/30" });

    // Renewal day: the saved card is charged with nobody present.
    setRenewalCharger(stripeRenewalCharger(db));
    const [o] = await db.select().from(orders).where(eq(orders.id, r.body.order.id));
    await db.update(clientPackages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clientPackages.id, o!.clientPackageId!));
    await renewDuePackages(db, new Date());
    const charge = f.calls.find((c) => c[0] === "chargeSavedCard")!;
    expect(charge[1]).toBe("acct_studio");
    expect(charge[2]).toMatchObject({ paymentMethod: `pm_${sid}`, amount: 20000, currency: "SGD" });
    const renewal = (await db.select().from(orders).where(and(eq(orders.clientPackageId, o!.clientPackageId!), eq(orders.status, "paid")))).find((x) => x.id !== o!.id);
    expect(renewal).toMatchObject({ provider: "stripe", paidWith: "card" });
  });

  it("a declined renewal holds the membership with a plain reason; a new card tries again", async () => {
    const { f, s, plan } = await membership();
    await s.c1.call("POST", "/checkout", { planId: plan.id });
    await paid(lastSession(f)[0]);
    setRenewalCharger(stripeRenewalCharger(db));
    f.decline = new StripeError("Your card has insufficient funds.", 402, "card_error", "card_declined", "insufficient_funds");
    const [p] = await db.select().from(clientPackages).where(eq(clientPackages.ownerId, s.c1.id));
    await db.update(clientPackages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clientPackages.id, p!.id));
    await renewDuePackages(db, new Date());
    const [held] = await db.select().from(clientPackages).where(eq(clientPackages.id, p!.id));
    expect(held!.paymentHeldAt).toBeTruthy();
    expect((await outbox("membership.payment_failed"))[0]!.data).toMatchObject({ reason: "not enough funds on the card" });

    // The client saves a new card: the renewal is tried straight away.
    f.decline = null;
    const setup = await s.c1.call("POST", "/me/payment-card");
    expect(setup.body.redirectUrl).toBeTruthy();
    const [sid, sess] = lastSession(f);
    expect(sess.p.mode).toBe("setup");
    const saved = await paid(sid);
    expect(saved.body.handled, JSON.stringify(saved.body)).toBe("card_saved");
    const [ok] = await db.select().from(clientPackages).where(eq(clientPackages.id, p!.id));
    expect(ok!.paymentHeldAt).toBeNull();
    // The same day, a new card is a new attempt (Stripe would replay the decline for the same key).
    const keys = f.calls.filter((c) => c[0] === "chargeSavedCard").map((c) => c[3]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("removing the card asks first while a membership renews by card", async () => {
    const { f, s, plan } = await membership();
    await s.c1.call("POST", "/checkout", { planId: plan.id });
    await paid(lastSession(f)[0]);
    const ask = await s.c1.call("DELETE", "/me/payment-card", {});
    expect(ask.status).toBe(409);
    expect(ask.body.error.flags[0].code).toBe("remove_card_membership");
    expect((await s.c1.call("DELETE", "/me/payment-card", { acknowledge: ["remove_card_membership"] })).body.card).toBeNull();
    expect(f.calls.some((c) => c[0] === "detach")).toBe(true);
    const [c] = await db.select().from(paymentCustomers).where(eq(paymentCustomers.userId, s.c1.id));
    expect(c!.cardLast4).toBeNull();
  });

  it("without a saved card, a renewal is due at the studio as before", async () => {
    const { s, plan } = await membership();
    setRenewalCharger(stripeRenewalCharger(db));
    const sold = (await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: plan.id, paymentMethod: "card" })).body;
    await db.update(clientPackages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clientPackages.id, sold.id));
    await renewDuePackages(db, new Date());
    const [p] = await db.select().from(clientPackages).where(eq(clientPackages.id, sold.id));
    expect(p!.paymentHeldAt).toBeNull();
    const due = await db.select().from(orders).where(and(eq(orders.clientPackageId, sold.id), eq(orders.status, "pending")));
    expect(due).toHaveLength(1);
    // The client can pay it online from the app.
    const r = await s.c1.call("POST", `/orders/${due[0]!.id}/pay`, {});
    expect(r.status).toBe(200);
    expect(r.body.redirectUrl).toBeTruthy();
  });
});

describe("payments: refunds", () => {
  async function paidOrder() {
    const c = await connected();
    const r = await c.s.c1.call("POST", "/checkout", { planId: c.pack.id });
    await paid(lastSession(c.f)[0]);
    return { ...c, orderId: r.body.order.id as string, inv: await invoiceOf(r.body.order.id) };
  }

  it("refunds back to how they paid go through Stripe, after asking", async () => {
    const { f, s, inv } = await paidOrder();
    const body = { amountCents: 1000, reason: "Moved away", method: "original_payment" };
    const ask = await s.owner.call("POST", `/sales/invoices/${inv.id}/refunds`, body);
    expect(ask.status).toBe(409);
    expect(ask.body.error.flags.map((x: { code: string }) => x.code)).toContain("refund_online");
    expect(f.calls.some((c) => c[0] === "createRefund")).toBe(false); // nothing sent before the OK
    const ok = await s.owner.call("POST", `/sales/invoices/${inv.id}/refunds`, { ...body, acknowledge: ["refund_online"] });
    expect(ok.status).toBe(200);
    expect(ok.body.message).toContain("Stripe");
    const call = f.calls.find((c) => c[0] === "createRefund")!;
    expect(call[2]).toMatchObject({ amount: 1000, paymentIntent: expect.stringMatching(/^pi_/) });
    const [r] = await db.select().from(invoiceRefunds).where(eq(invoiceRefunds.invoiceId, inv.id));
    expect(r).toMatchObject({ providerStatus: "succeeded" });
    expect(r!.providerRef).toMatch(/^re_/);
    // Studio credit refunds don't touch Stripe.
    await s.owner.call("POST", `/sales/invoices/${inv.id}/refunds`, { amountCents: 500, reason: "Goodwill", method: "credit" });
    expect(f.calls.filter((c) => c[0] === "createRefund")).toHaveLength(1);
  });

  it("a refund that fails later is undone on the sale and the studio is told", async () => {
    const { f, s, inv } = await paidOrder();
    f.refundStatus = "pending";
    await s.owner.call("POST", `/sales/invoices/${inv.id}/refunds`, { amountCents: 3000, reason: "Injury", method: "original_payment", acknowledge: ["refund_online"] });
    const [r] = await db.select().from(invoiceRefunds).where(eq(invoiceRefunds.invoiceId, inv.id));
    expect((await db.select().from(invoices).where(eq(invoices.id, inv.id)))[0]!.status).toBe("refunded");
    await webhook("refund.failed", { id: r!.providerRef, status: "failed", amount: 3000, payment_intent: "pi_x", metadata: { invoice_refund_id: r!.id }, failure_reason: "expired_or_canceled_card" });
    const [after] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(after).toMatchObject({ status: "paid", refundedCents: 0 });
    expect((await outbox("payment.refund_failed")).map((n) => n.userId)).toContain(s.owner.id);
  });

  it("refunds made in the studio's Stripe dashboard are recorded against the sale", async () => {
    const { s, orderId, inv } = await paidOrder();
    const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
    await webhook("refund.created", { id: "re_dash", status: "succeeded", amount: 1200, payment_intent: o!.providerRef, metadata: {} });
    const [after] = await db.select().from(invoices).where(eq(invoices.id, inv.id));
    expect(after).toMatchObject({ status: "partly_refunded", refundedCents: 1200 });
    const [r] = await db.select().from(invoiceRefunds).where(eq(invoiceRefunds.invoiceId, inv.id));
    expect(r).toMatchObject({ reason: "Refunded in Stripe", providerRef: "re_dash" });
    // Told twice: recorded once.
    await webhook("refund.updated", { id: "re_dash", status: "succeeded", amount: 1200, payment_intent: o!.providerRef, metadata: {} });
    expect(await db.select().from(invoiceRefunds).where(eq(invoiceRefunds.invoiceId, inv.id))).toHaveLength(1);
    expect((await s.owner.call("GET", "/payments")).body.recent).toHaveLength(1);
  });

  it("disputes tell the owner and admins what to do", async () => {
    const { s, orderId } = await paidOrder();
    const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
    await webhook("charge.dispute.created", { id: "dp_1", amount: 3000, currency: "sgd", reason: "product_not_received", payment_intent: o!.providerRef });
    const n = await outbox("payment.disputed");
    expect(n.map((x) => x.userId)).toContain(s.owner.id);
    expect(n[0]!.data).toMatchObject({ amount: "SGD 30.00", reason: "product not received", clientId: s.c1.id });
  });
});
