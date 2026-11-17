/**
 * Online payments (Stripe Connect). Each studio connects its own Stripe account and is the
 * seller: money goes straight to the studio, the studio pays Stripe's fees, and refunds and
 * disputes are the studio's (handled here or in its own Stripe dashboard).
 *
 * Which payment methods clients see (cards, PayNow, GrabPay, Apple Pay and so on) is set in the
 * studio's Stripe dashboard. A studio can pass the processing fee on to clients for cards and
 * GrabPay. Never for PayNow: the banks' PayNow rules don't allow surcharges.
 */
import { z } from "zod";

/** How a client chooses to pay. "online" lets them pick on Stripe's page (no fee passed on). */
export const PAY_WITH = { online: "Pay online", card: "Card", paynow: "PayNow", grabpay: "GrabPay", desk: "Pay at the studio" } as const;
export type PayWith = keyof typeof PAY_WITH;
export const payWith = z.enum(Object.keys(PAY_WITH) as [PayWith, ...PayWith[]]);

/** Methods a fee can be passed on for. Wallets (Apple Pay, Google Pay, Link) are cards. */
export const FEE_METHODS = ["card", "grabpay"] as const;
export type FeeMethod = (typeof FEE_METHODS)[number];

/** Stripe's country for the studio's currency (online payments need one of these). */
export const STRIPE_COUNTRY: Record<string, string> = { SGD: "SG", MYR: "MY", THB: "TH", HKD: "HK", AUD: "AU", NZD: "NZ", JPY: "JP", USD: "US", GBP: "GB", EUR: "IE" };
/** PayNow and GrabPay are Singapore-dollar methods. */
export const localMethodsFor = (currency: string): PayWith[] => (currency === "SGD" ? ["paynow", "grabpay"] : []);

/**
 * The fee to add so the studio still receives the full price after Stripe's fee:
 * (price + fixed) / (1 − rate), rounded up, minus the price.
 */
export function passedOnFee(amountCents: number, bps: number, fixedCents: number) {
  if (amountCents <= 0 || (bps <= 0 && fixedCents <= 0)) return 0;
  const gross = Math.ceil((amountCents + fixedCents) / (1 - bps / 10_000));
  return gross - amountCents;
}

const bps = z.number().int().min(0).max(1000);
export const paymentSettings = z.object({
  /** Clients can pay online (once Stripe is connected and ready). */
  onlinePayments: z.boolean(),
  /** Clients can still choose to pay at the studio. */
  payAtDesk: z.boolean(),
  /** Add the processing fee for cards and GrabPay, shown before they pay. Never PayNow. */
  passOnFees: z.boolean(),
  cardFeeBps: bps,
  cardFeeFixedCents: z.number().int().min(0).max(500),
  grabpayFeeBps: bps,
  acknowledge: z.array(z.string()).max(20).default([]),
}).partial({ cardFeeBps: true, cardFeeFixedCents: true, grabpayFeeBps: true });
export type PaymentSettingsInput = z.infer<typeof paymentSettings>;

export const payOrder = z.object({ payWith: payWith.default("online") });
