/**
 * Feature switches. Studios switch on what they use, so an independent studio sees a short
 * menu and a growing brand can add more later. Switching a feature off hides it and stops it
 * running; nothing is deleted, so switching it back on picks up the data where it was.
 *
 * Some features already had their own on/off setting; `setting` names it, so there is one
 * source of truth. The rest are stored in `organizations.features_off`.
 */
export const FEATURES = [
  { key: "marketing", group: "Grow", label: "Marketing emails and journeys", help: "Email campaigns to groups of clients, and automatic journeys such as a welcome series or a nudge for people who haven't been in for a while.", setting: null },
  { key: "giftCards", group: "Grow", label: "Gift cards", help: "Clients buy gift cards in the app to give or keep. Cards already sold can always be used.", setting: "giftCardsEnabled" },
  { key: "loyalty", group: "Grow", label: "Loyalty points and rewards", help: "Clients earn points for classes and swap them for rewards.", setting: "loyaltyEnabled" },
  { key: "referrals", group: "Grow", label: "Refer a friend", help: "Clients share a link and both sides get a reward when a friend joins.", setting: "referralsEnabled" },
  { key: "leads", group: "Grow", label: "Leads", help: "People who aren't paying members yet: ad enquiries, ClassPass clients and walk-ins, with follow-up emails.", setting: null },
  { key: "reviews", group: "Grow", label: "Reviews", help: "Clients are asked to rate their latest class, and you see the results by class type and instructor.", setting: "reviewsEnabled" },
  { key: "shop", group: "Run", label: "Shop", help: "Sell drinks, merchandise and other products in the app, picked up at the front desk.", setting: null },
  { key: "payroll", group: "Run", label: "Payroll", help: "Pay rates for instructors and staff, and what each person is owed for each pay period.", setting: null },
  { key: "inbox", group: "Run", label: "Communication inbox", help: "Read and answer client WhatsApp messages in the app, alongside your phone.", setting: null },
  { key: "agents", group: "Run", label: "AI workflows", help: "Agents that send your staff reminders and summaries (such as tomorrow's classes that still need an instructor), and AI that drafts announcements, campaigns and staff recaps.", setting: null },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export const FEATURE_KEYS = FEATURES.map((f) => f.key) as unknown as readonly [FeatureKey, ...FeatureKey[]];
/** Features stored in `features_off` (the rest use their own setting). */
export const STORED_FEATURES = FEATURES.filter((f) => f.setting === null).map((f) => f.key);
export const FEATURE_LABELS = Object.fromEntries(FEATURES.map((f) => [f.key, f.label])) as Record<FeatureKey, string>;

/**
 * Setup by studio type. A first-run question ("What kind of studio are you?") switches on the
 * right features and fills sensible rules. Studios can change anything afterwards; the type is
 * only a starting point, and Studio rules marks settings that differ from the usual for it.
 */
export const STUDIO_TYPES = ["independent", "boutique", "multi"] as const;
export type StudioType = (typeof STUDIO_TYPES)[number];

/** The settings a studio type fills in (API field names), in the order they're shown. */
export const PRESET_RULES = [
  { key: "bookingClosesMinutesBefore", label: "Booking closes" },
  { key: "clientsNeedPackage", label: "Clients need a package to book" },
  { key: "lateCancelWindowHours", label: "Late-cancellation window" },
  { key: "spotBookingEnabled", label: "Clients choose a spot" },
  { key: "waitlistModes", label: "How waitlists work" },
  { key: "substituteApproval", label: "Approving cover" },
  { key: "celebrationsEnabled", label: "Celebration pop-ups for staff" },
] as const;
export type PresetRuleKey = (typeof PRESET_RULES)[number]["key"];
export interface PresetRules {
  bookingClosesMinutesBefore: number;
  clientsNeedPackage: boolean;
  lateCancelWindowHours: number;
  spotBookingEnabled: boolean;
  waitlistModes: "both" | "automatic" | "manual";
  substituteApproval: "automatic" | "manual";
  celebrationsEnabled: boolean;
}

export const STUDIO_TYPE_PRESETS: Record<StudioType, { label: string; description: string; features: readonly FeatureKey[]; rules: PresetRules }> = {
  independent: {
    label: "Independent studio",
    description: "One room and a small team, or just you. Keeps it simple: booking, packages, reviews and gift cards. Walk-ins welcome.",
    features: ["giftCards", "reviews"],
    rules: { bookingClosesMinutesBefore: 0, clientsNeedPackage: false, lateCancelWindowHours: 6, spotBookingEnabled: false, waitlistModes: "automatic", substituteApproval: "manual", celebrationsEnabled: false },
  },
  boutique: {
    label: "Boutique studio",
    description: "One or two locations with a team of instructors, and classes that fill up. Adds marketing, the shop, payroll and the WhatsApp inbox.",
    features: ["marketing", "giftCards", "referrals", "reviews", "shop", "payroll", "inbox"],
    rules: { bookingClosesMinutesBefore: 60, clientsNeedPackage: true, lateCancelWindowHours: 12, spotBookingEnabled: true, waitlistModes: "both", substituteApproval: "manual", celebrationsEnabled: true },
  },
  multi: {
    label: "Several locations",
    description: "A growing brand with managers and a front desk at each location. Everything is switched on, including leads, loyalty and agents.",
    features: FEATURES.map((f) => f.key),
    rules: { bookingClosesMinutesBefore: 60, clientsNeedPackage: true, lateCancelWindowHours: 12, spotBookingEnabled: true, waitlistModes: "both", substituteApproval: "manual", celebrationsEnabled: true },
  },
};

/** A preset setting's value in plain words, e.g. "1 hour before" or "Clients choose". */
export function presetRuleText(key: PresetRuleKey, value: unknown): string {
  const hours = (h: number) => `${h} ${h === 1 ? "hour" : "hours"}`;
  switch (key) {
    case "bookingClosesMinutesBefore": {
      const m = Number(value);
      return m === 0 ? "When class starts" : m % 60 === 0 ? `${hours(m / 60)} before` : `${m} minutes before`;
    }
    case "lateCancelWindowHours": return `${hours(Number(value))} before class`;
    case "clientsNeedPackage": return value ? "Yes" : "No, they can pay at the studio";
    case "waitlistModes": return ({ both: "Clients choose", automatic: "Always book in automatically", manual: "Always ask first" } as Record<string, string>)[String(value)] ?? String(value);
    case "substituteApproval": return value === "automatic" ? "First to accept gets it" : "An admin chooses";
    default: return value ? "On" : "Off";
  }
}

/**
 * Plans. Each plan sets which features a studio can switch on, how many locations and admins it
 * includes, and whether it has its own branded app. Our staff set the plan (after the "help me
 * choose" questionnaire or a first call); studios can switch off anything their plan includes.
 * Every plan gets the same done-for-you setup, data move and support.
 */
export const PLANS = ["essentials", "growth", "signature"] as const;
export type Plan = (typeof PLANS)[number];

export interface PlanInfo {
  label: string;
  /** Who it's for and what it adds, as shown on the pricing page. */
  tagline: string;
  priceCents: number;
  locationsIncluded: number;
  /** null: no maximum (extra locations cost extraLocationCents each). */
  maxLocations: number | null;
  extraLocationCents: number | null;
  /** The branded app: included, a flat add-on, or not available. */
  app: "included" | "add_on" | "not_available";
  appAddOnCents: number | null;
  /** Admin accounts (owners count): a number, one per location, or no limit. Instructor and front desk accounts are always unlimited. */
  adminSeats: number | "per_location" | "unlimited";
  features: readonly FeatureKey[];
  /** The rules a new studio on this plan starts with. */
  studioType: StudioType;
}

export const PLAN_INFO: Record<Plan, PlanInfo> = {
  essentials: {
    label: "Essentials",
    tagline: "For one independent studio. Everything to run classes, take bookings, pay instructors and get paid.",
    priceCents: 9900, locationsIncluded: 1, maxLocations: 1, extraLocationCents: null, app: "not_available", appAddOnCents: null, adminSeats: 1,
    features: ["giftCards", "reviews", "payroll"], studioType: "independent",
  },
  growth: {
    label: "Growth",
    tagline: "For studios with a team, up to 3 locations. Adds marketing, WhatsApp and the shop.",
    priceCents: 29900, locationsIncluded: 3, maxLocations: 3, extraLocationCents: null, app: "add_on", appAddOnCents: 10000, adminSeats: "per_location",
    features: ["giftCards", "reviews", "payroll", "marketing", "loyalty", "referrals", "shop", "inbox"], studioType: "boutique",
  },
  signature: {
    label: "Signature",
    tagline: "For brands with up to 5 locations. Your own app included, plus AI that does the work for you.",
    priceCents: 59900, locationsIncluded: 5, maxLocations: null, extraLocationCents: 15000, app: "included", appAddOnCents: null, adminSeats: "unlimited",
    features: FEATURES.map((f) => f.key), studioType: "multi",
  },
};

export const planIncludes = (plan: Plan, key: FeatureKey) => PLAN_INFO[plan].features.includes(key);
/** The first plan that includes a feature, for "Included in Growth" prompts. */
export const planWith = (key: FeatureKey): Plan => PLANS.find((p) => planIncludes(p, key)) ?? "signature";
/** AI workflows (agents, AI writing, AI recaps) come with the Agents feature. Ask (chat) is on every plan. */
export const planHasAiWorkflows = (plan: Plan) => planIncludes(plan, "agents");
/** Reports with locations side by side: Signature (it's for brands with several locations). */
export const planHasLocationReport = (plan: Plan) => plan === "signature";
export const planHasApp = (plan: Plan, brandedApp: boolean) => PLAN_INFO[plan].app === "included" || (PLAN_INFO[plan].app === "add_on" && brandedApp);

/** Admin seats for a plan with this many locations; null means no limit. */
export function planAdminSeats(plan: Plan, locations: number): number | null {
  const s = PLAN_INFO[plan].adminSeats;
  return s === "unlimited" ? null : s === "per_location" ? Math.max(1, locations) : s;
}

/** What a studio pays each month (USD cents), with the parts. */
export function planPrice(plan: Plan, locations: number, brandedApp: boolean) {
  const p = PLAN_INFO[plan];
  const extra = p.extraLocationCents ? Math.max(0, locations - p.locationsIncluded) : 0;
  const extraCents = extra * (p.extraLocationCents ?? 0);
  const appCents = p.app === "add_on" && brandedApp ? p.appAddOnCents ?? 0 : 0;
  return { baseCents: p.priceCents, extraLocations: extra, extraCents, appCents, totalCents: p.priceCents + extraCents + appCents };
}
