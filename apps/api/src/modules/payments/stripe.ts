/**
 * A small Stripe client: only the calls we use, over Stripe's REST API, pinned to one API
 * version so Stripe's changes don't reach us until we choose. Tests swap it for a fake with
 * setStripe().
 *
 * Every call made for a studio carries its account (the Stripe-Account header): the charge,
 * customer and refund live in the studio's own Stripe account (direct charges), not ours.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_API_VERSION = "2026-10-28.endive";

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type: string,
    readonly code?: string,
    readonly declineCode?: string,
  ) {
    super(message);
  }
}

type Params = Record<string, unknown>;
/** Stripe's form encoding: a[b][0][c]=v. */
export function encode(params: Params, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? out.push(...encode(item as Params, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof v === "object") out.push(...encode(v as Params, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export interface StripeAccount {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements?: { currently_due?: string[]; past_due?: string[]; disabled_reason?: string | null };
}
export interface CheckoutSession {
  id: string;
  url: string | null;
  mode: "payment" | "setup" | "subscription";
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  client_reference_id: string | null;
  metadata: Record<string, string>;
  customer: string | null;
  payment_intent: string | PaymentIntent | null;
  setup_intent: string | { id: string; payment_method: string | PaymentMethod | null } | null;
}
export interface PaymentMethod {
  id: string;
  type: string;
  card?: { brand: string; last4: string; exp_month: number; exp_year: number; wallet?: { type: string } | null };
}
export interface PaymentIntent {
  id: string;
  status: string;
  amount: number;
  latest_charge?: string | null;
  payment_method: string | PaymentMethod | null;
  metadata: Record<string, string>;
}
export interface Refund {
  id: string;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
  amount: number;
  payment_intent: string | null;
  metadata: Record<string, string>;
  failure_reason?: string | null;
}

export interface StripeApi {
  createAccount(p: { country: string; name: string; orgId: string }): Promise<StripeAccount>;
  getAccount(accountId: string): Promise<StripeAccount>;
  accountLink(accountId: string, urls: { refresh: string; return: string }): Promise<{ url: string }>;
  createCustomer(account: string, p: { name: string; email: string | null; userId: string }): Promise<{ id: string }>;
  /** Payment methods switched on for the account (to show only the one the client chose). */
  enabledMethods(account: string): Promise<string[]>;
  createCheckoutSession(account: string, p: Params, idempotencyKey: string): Promise<CheckoutSession>;
  getCheckoutSession(account: string, id: string): Promise<CheckoutSession>;
  expireCheckoutSession(account: string, id: string): Promise<void>;
  /** Charge a saved card with nobody present (membership renewals). Throws StripeError on a decline. */
  chargeSavedCard(account: string, p: { customer: string; paymentMethod: string; amount: number; currency: string; description: string; metadata: Record<string, string>; applicationFee?: number }, idempotencyKey: string): Promise<PaymentIntent>;
  createRefund(account: string, p: { paymentIntent: string; amount: number; metadata: Record<string, string> }, idempotencyKey: string): Promise<Refund>;
  detachPaymentMethod(account: string, id: string): Promise<void>;
}

/** The real client. */
export function stripeClient(secretKey: string, baseUrl = "https://api.stripe.com"): StripeApi {
  async function call<T>(method: "GET" | "POST", path: string, params: Params = {}, opts: { account?: string; idempotencyKey?: string } = {}): Promise<T> {
    const body = encode(params).join("&");
    const url = `${baseUrl}/v1${path}${method === "GET" && body ? `?${body}` : ""}`;
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${secretKey}`,
        "stripe-version": STRIPE_API_VERSION,
        ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(opts.account ? { "stripe-account": opts.account } : {}),
        ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
      },
      ...(method === "POST" ? { body } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; type?: string; code?: string; decline_code?: string } };
    if (!res.ok) {
      const e = json.error ?? {};
      throw new StripeError(e.message ?? `Stripe answered ${res.status}`, res.status, e.type ?? "api_error", e.code, e.decline_code);
    }
    return json as T;
  }
  return {
    createAccount: (p) =>
      call("POST", "/accounts", {
        country: p.country,
        // The studio's own full Stripe account: it pays Stripe's fees, Stripe covers losses and
        // collects what it needs from the studio, and the studio has the full dashboard.
        controller: { stripe_dashboard: { type: "full" }, fees: { payer: "account" }, losses: { payments: "stripe" }, requirement_collection: "stripe" },
        business_profile: { name: p.name },
        metadata: { org_id: p.orgId },
      }, { idempotencyKey: `account-${p.orgId}` }),
    getAccount: (id) => call("GET", `/accounts/${encodeURIComponent(id)}`),
    accountLink: (account, urls) => call("POST", "/account_links", { account, type: "account_onboarding", refresh_url: urls.refresh, return_url: urls.return }),
    createCustomer: (account, p) => call("POST", "/customers", { name: p.name, email: p.email ?? undefined, metadata: { user_id: p.userId } }, { account, idempotencyKey: `customer-${account}-${p.userId}` }),
    async enabledMethods(account) {
      const r = await call<{ data: Record<string, unknown>[] }>("GET", "/payment_method_configurations", {}, { account });
      const pmc = r.data.find((c) => c.is_default) ?? r.data[0];
      if (!pmc) return ["card"];
      return Object.entries(pmc)
        .filter(([, v]) => typeof v === "object" && v !== null && (v as { available?: boolean }).available)
        .map(([k]) => k);
    },
    createCheckoutSession: (account, p, key) => call("POST", "/checkout/sessions", p, { account, idempotencyKey: key }),
    getCheckoutSession: (account, id) => call("GET", `/checkout/sessions/${encodeURIComponent(id)}`, { expand: ["payment_intent.payment_method", "setup_intent.payment_method"] }, { account }),
    async expireCheckoutSession(account, id) {
      await call("POST", `/checkout/sessions/${encodeURIComponent(id)}/expire`, {}, { account });
    },
    chargeSavedCard: (account, p, key) =>
      call("POST", "/payment_intents", {
        amount: p.amount, currency: p.currency.toLowerCase(), customer: p.customer, payment_method: p.paymentMethod, off_session: true, confirm: true,
        description: p.description, metadata: p.metadata, ...(p.applicationFee ? { application_fee_amount: p.applicationFee } : {}),
        expand: ["payment_method"],
      }, { account, idempotencyKey: key }),
    createRefund: (account, p, key) => call("POST", "/refunds", { payment_intent: p.paymentIntent, amount: p.amount, metadata: p.metadata }, { account, idempotencyKey: key }),
    async detachPaymentMethod(account, id) {
      await call("POST", `/payment_methods/${encodeURIComponent(id)}/detach`, {}, { account });
    },
  };
}

let override: StripeApi | null = null;
let real: { key: string; api: StripeApi } | null = null;
/** Tests: use a fake Stripe. */
export const setStripe = (s: StripeApi | null) => (override = s);
/** The Stripe client for this platform, or null when online payments aren't set up. */
export function stripeFor(config: { STRIPE_SECRET_KEY?: string; STRIPE_API_URL?: string }): StripeApi | null {
  if (override) return override;
  if (!config.STRIPE_SECRET_KEY) return null;
  if (real?.key !== config.STRIPE_SECRET_KEY) real = { key: config.STRIPE_SECRET_KEY, api: stripeClient(config.STRIPE_SECRET_KEY, config.STRIPE_API_URL) };
  return real.api;
}

/**
 * Check a webhook really came from Stripe: the Stripe-Signature header is
 * t=<unix seconds>,v1=<HMAC-SHA256 of "t.body" with the endpoint's secret>. Old timestamps are
 * refused so a captured request can't be replayed later.
 */
export function verifySignature(rawBody: string, header: string, secret: string, now = Date.now(), toleranceSeconds = 300) {
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return sigs.some((s) => {
    const b = Buffer.from(s);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}
/** Sign a payload like Stripe does (tests and local tools). */
export function signPayload(rawBody: string, secret: string, at = Date.now()) {
  const t = Math.floor(at / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
