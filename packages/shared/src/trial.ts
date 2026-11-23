/**
 * The 14-day free trial: no card, no commitment, for trying the app, not for running a studio.
 *
 *  - "new": a studio that isn't on any system yet. Everything works on the plan they're trying,
 *    except taking payments (Stripe can't be connected) and WhatsApp, and there's a cap on clients.
 *    When they start paying, the limits lift and everything they set up carries on.
 *  - "existing": a studio on another system that wants a look. They get a test account filled with
 *    sample classes and clients. No data move, no booking page, and no messages go to anyone.
 *    When they sign up, our team sets up their real account and moves their data, as usual.
 *
 * When a trial ends the account is read-only (nothing can be changed or booked) until they start
 * paying; our team can extend it. One trial per person.
 */
import { z } from "zod";
import { PLANS } from "./features.js";

export const TRIAL_KINDS = ["new", "existing"] as const;
export type TrialKind = (typeof TRIAL_KINDS)[number];
export const TRIAL_DAYS = 14;
/** Most clients a trial can have: enough to try things with a few real people, not to run a studio. */
export const TRIAL_CLIENT_LIMIT = 25;
/** The terms people accept to start a trial (bumped when they change). */
export const TRIAL_TERMS_VERSION = "2026-11";
export const TRIAL_TERMS = [
  "The trial is for trying the app, free for 14 days, with no card and nothing to cancel.",
  "It isn't for running your studio: payments can't be taken, WhatsApp can't be connected and there's a limit of 25 clients.",
  "You may not use the trial to copy the app or build or help build a competing product.",
  "When it ends, your account stays read-only for 30 days so you can start your plan without losing anything, then it's deleted.",
];

export const TRIAL_KIND_LABELS: Record<TrialKind, { label: string; detail: string }> = {
  new: { label: "Opening a new studio", detail: "Set up your real studio: classes, packages, team. Payments switch on when you start your plan." },
  existing: { label: "Already running a studio", detail: "Try it on a test studio filled with sample classes and clients. When you switch, we move your data for you." },
};

const plainText = (max: number) => z.string().trim().min(1).max(max);
export const startTrial = z.object({
  kind: z.enum(TRIAL_KINDS),
  plan: z.enum(PLANS),
  studioName: plainText(80),
  firstName: plainText(60),
  lastName: plainText(60),
  phone: z.string().trim().max(30).optional(),
  timezone: z.string().trim().max(60).default("Asia/Singapore"),
  currency: z.string().regex(/^[A-Z]{3}$/).default("SGD"),
  /** Must be true: the trial's terms (see TRIAL_TERMS). */
  acceptTerms: z.literal(true, { message: "Please accept the trial's terms." }),
});
export const startPlanRequest = z.object({ plan: z.enum(PLANS), brandedApp: z.boolean().default(false), note: z.string().trim().max(500).optional() });
export const platformTrialAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend"), days: z.number().int().min(1).max(30) }),
  z.object({ action: z.literal("end") }),
  z.object({ action: z.literal("convert") }),
]);
