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
  { key: "agents", group: "Run", label: "Agents", help: "Automatic reminders and summaries sent to your staff, such as tomorrow's classes that still need an instructor.", setting: null },
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
