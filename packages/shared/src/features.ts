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
