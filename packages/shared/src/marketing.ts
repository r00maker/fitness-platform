/**
 * Marketing: client segments, the email builder's block format, journeys (automations),
 * banners, announcements, gift cards, studio credit and referrals.
 *
 * Shared by the API (which validates and runs everything) and the apps (which build the
 * forms from the same lists, so labels and limits always match).
 */
import { z } from "zod";

const id = z.uuid({ message: "That ID doesn't look right." });
const cents = z.number().int().min(0, "Can't be negative.").max(100_000_000);
const count = z.number().int().min(0, "Can't be negative.").max(100_000);

// ---------------------------------------------------------------------------
// Segments: "clients who…"
// ---------------------------------------------------------------------------
export const COMPARISONS = ["at_least", "at_most", "between"] as const;
export type Comparison = (typeof COMPARISONS)[number];

/** Where a client came from, worked out when they join (ad click ids and UTM tags). */
export const ACQUISITION_CHANNELS = ["meta_ads", "google_ads", "referral", "other_campaign", "direct"] as const;
export type AcquisitionChannel = (typeof ACQUISITION_CHANNELS)[number];

/**
 * Every filter, in the order the app lists them. `kind` decides the input:
 *  - number: a comparison and a number (some can be limited to the last N days)
 *  - choice: one of a few options
 *  - pick: one or more things (tags, package types, class types…)
 */
export const SEGMENT_FIELDS = {
  classesAttended: { group: "Activity", kind: "number", label: "Classes attended", unit: "classes", within: true, help: "Classes they came to. Add “in the last N days” to look at a recent stretch only." },
  daysSinceLastClass: { group: "Activity", kind: "number", label: "Days since their last class", unit: "days", within: false, help: "How long since they last came. Clients who have never come aren't included; use “Classes attended: at most 0” for them." },
  upcomingBookings: { group: "Activity", kind: "number", label: "Classes booked ahead", unit: "classes", within: false, help: "Classes they're booked into that haven't happened yet." },
  noShows: { group: "Activity", kind: "number", label: "No-shows", unit: "no-shows", within: true, help: "Classes they booked but didn't come to." },
  lateCancels: { group: "Activity", kind: "number", label: "Late cancellations", unit: "late cancellations", within: true, help: "Bookings they cancelled inside the late-cancellation window." },
  classTypes: { group: "Activity", kind: "pick", label: "Has attended", pick: "classTypes", within: true, help: "They've come to at least one of these classes." },
  instructors: { group: "Activity", kind: "pick", label: "Has attended a class with", pick: "instructors", within: true, help: "They've come to a class taught by one of these instructors." },
  locations: { group: "Activity", kind: "pick", label: "Has attended at", pick: "locations", within: true, help: "They've come to a class at one of these locations." },

  nettSpend: { group: "Spending", kind: "number", label: "Nett spend", unit: "money", within: true, help: "What they've paid the studio for packages, gift cards and fees, minus money refunded. Studio credit and gift cards they were given don't count." },
  hasActivePackage: { group: "Packages", kind: "choice", label: "Has a package they can use", options: ["yes", "no"], help: "A package or membership that's started (or waiting for their first class) and hasn't run out or expired." },
  packageTypes: { group: "Packages", kind: "pick", label: "Has bought", pick: "packageTypes", within: true, help: "They've bought one of these package types." },
  creditsLeft: { group: "Packages", kind: "number", label: "Classes left", unit: "classes", within: false, help: "Classes left across their credit packs. Unlimited packages aren't counted." },
  daysUntilExpiry: { group: "Packages", kind: "number", label: "Days until their package expires", unit: "days", within: false, help: "For the package that runs out soonest. Clients without an expiring package aren't included." },
  membership: { group: "Packages", kind: "choice", label: "Membership", options: ["active", "stopping", "none"], help: "Recurring packages: renewing, stopped but still running to the end of the period, or none." },
  studioCredit: { group: "Spending", kind: "number", label: "Studio credit", unit: "money", within: false, help: "Studio credit they can spend, from gift cards, referral rewards or the studio." },

  daysSinceJoined: { group: "Profile", kind: "number", label: "Days since they joined", unit: "days", within: false, help: "How long they've had an account with the studio." },
  source: { group: "Profile", kind: "choice", label: "Books through", options: ["direct", "classpass"], help: "Studio members, or clients who book through ClassPass." },
  acquisition: { group: "Profile", kind: "choice", label: "Came from", options: [...ACQUISITION_CHANNELS], help: "Worked out when they joined: an ad click, a referral link, another tagged link, or none of these." },
  tags: { group: "Profile", kind: "pick", label: "Has tag", pick: "tags", within: false, help: "They have at least one of these tags." },
  notTags: { group: "Profile", kind: "pick", label: "Doesn't have tag", pick: "tags", within: false, help: "They have none of these tags." },
  waiver: { group: "Profile", kind: "choice", label: "Waiver", options: ["done", "missing"], help: "Whether their waiver is complete." },
  marketingEmail: { group: "Profile", kind: "choice", label: "Happy to get marketing emails", options: ["yes", "no"], help: "Whether they've agreed to marketing emails. Marketing emails only ever go to people who said yes." },
  referrals: { group: "Profile", kind: "number", label: "Friends referred", unit: "friends", within: false, help: "Friends who joined with their referral code." },
  wasReferred: { group: "Profile", kind: "choice", label: "Joined through a referral", options: ["yes", "no"], help: "Whether they joined with a friend's referral code." },
} as const;
export type SegmentField = keyof typeof SEGMENT_FIELDS;
export const SEGMENT_FIELD_IDS = Object.keys(SEGMENT_FIELDS) as SegmentField[];

/** Labels for the choice options above. */
export const SEGMENT_OPTION_LABELS: Record<string, string> = {
  yes: "Yes", no: "No", active: "Renewing", stopping: "Stopping", none: "None", direct: "Studio member", classpass: "ClassPass",
  done: "Done", missing: "Missing", meta_ads: "Meta ads (Facebook, Instagram)", google_ads: "Google ads", referral: "A friend's referral", other_campaign: "Another tagged link",
};

const numberRule = z.object({
  field: z.enum(SEGMENT_FIELD_IDS.filter((f) => SEGMENT_FIELDS[f].kind === "number") as [SegmentField, ...SegmentField[]]),
  op: z.enum(COMPARISONS),
  value: z.number().min(0).max(100_000_000),
  value2: z.number().min(0).max(100_000_000).optional(),
  withinDays: z.number().int().min(1).max(3650).optional(),
});
const choiceRule = z.object({
  field: z.enum(SEGMENT_FIELD_IDS.filter((f) => SEGMENT_FIELDS[f].kind === "choice") as [SegmentField, ...SegmentField[]]),
  value: z.string().max(40),
});
const pickRule = z.object({
  field: z.enum(SEGMENT_FIELD_IDS.filter((f) => SEGMENT_FIELDS[f].kind === "pick") as [SegmentField, ...SegmentField[]]),
  ids: z.array(id).min(1, "Choose at least one.").max(50),
  withinDays: z.number().int().min(1).max(3650).optional(),
});
export const segmentRule = z.union([numberRule, choiceRule, pickRule]).superRefine((r, ctx) => {
  const f = SEGMENT_FIELDS[r.field];
  if ("op" in r && r.op === "between" && (r.value2 === undefined || r.value2 < r.value)) ctx.addIssue({ code: "custom", message: "Give a range, smallest first." });
  if ("withinDays" in r && r.withinDays && !("within" in f && f.within)) ctx.addIssue({ code: "custom", message: `“${f.label}” can't be limited to recent days.` });
  if (f.kind === "choice" && "value" in r && !(f.options as readonly string[]).includes(String(r.value))) ctx.addIssue({ code: "custom", message: `Choose one of the options for “${f.label}”.` });
});
export type SegmentRule = z.infer<typeof segmentRule>;

export const segmentDefinition = z.object({
  /** all = clients who match every rule; any = clients who match at least one. */
  match: z.enum(["all", "any"]).default("all"),
  rules: z.array(segmentRule).max(20, "Up to 20 filters."),
});
export type SegmentDefinition = z.infer<typeof segmentDefinition>;

export const segmentInput = z.object({
  name: z.string().trim().min(1, "Give the segment a name.").max(80),
  description: z.string().trim().max(300).nullish(),
  definition: segmentDefinition,
});
export const clientFilter = z.object({
  q: z.string().trim().max(100).optional(),
  definition: segmentDefinition.optional(),
  segmentId: id.optional(),
  sort: z.enum(["name", "classes", "spend", "last_class", "joined"]).default("name"),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

/** One rule in plain English, e.g. "Classes attended: at least 10 in the last 30 days". */
export function describeRule(r: SegmentRule, names: (field: SegmentField, ids: string[]) => string[] = () => [], fmtMoney: (c: number) => string = (c) => (c / 100).toFixed(2)): string {
  const f = SEGMENT_FIELDS[r.field];
  const within = "withinDays" in r && r.withinDays ? ` in the last ${r.withinDays} days` : "";
  if ("op" in r) {
    const v = (n: number) => (f.kind === "number" && "unit" in f && f.unit === "money" ? fmtMoney(n) : String(n));
    const cmp = r.op === "at_least" ? `at least ${v(r.value)}` : r.op === "at_most" ? `at most ${v(r.value)}` : `${v(r.value)} to ${v(r.value2 ?? r.value)}`;
    return `${f.label}: ${cmp}${within}`;
  }
  if ("ids" in r) {
    const list = names(r.field, r.ids);
    const shown = list.length ? (list.length > 3 ? `${list.slice(0, 3).join(", ")} and ${list.length - 3} more` : list.join(" or ")) : `${r.ids.length} chosen`;
    return `${f.label}: ${shown}${within}`;
  }
  return `${f.label}: ${SEGMENT_OPTION_LABELS[r.value] ?? r.value}`;
}

// ---------------------------------------------------------------------------
// Email builder: a design is a list of blocks. The API turns it into email-safe HTML.
// No raw HTML is ever accepted, so a design can't carry scripts or break the layout.
// ---------------------------------------------------------------------------
/** Personal details that can be dropped into text with {{tag}}. */
export const MERGE_TAGS = {
  first_name: "Their first name",
  last_name: "Their last name",
  studio_name: "Your studio's name",
  classes_attended: "Classes they've attended",
  credits_left: "Classes left on their packages",
  studio_credit: "Their studio credit",
  referral_code: "Their referral code",
  referral_link: "Their referral link",
} as const;
export type MergeTag = keyof typeof MERGE_TAGS;

const safeUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => /^(https?:\/\/|mailto:)/i.test(u) || /^\{\{referral_link\}\}$/.test(u), "Links need to start with https://, http:// or mailto:.");
const align = z.enum(["left", "center", "right"]).default("left");
const text = z.string().max(5000);

const headingBlock = z.object({ type: z.literal("heading"), text: z.string().trim().min(1, "Add the heading text.").max(200), level: z.union([z.literal(1), z.literal(2)]).default(1), align });
/** Text supports **bold**, *italic*, [links](https://…) and line breaks. */
const textBlock = z.object({ type: z.literal("text"), text, align });
const imageBlock = z.object({ type: z.literal("image"), fileId: id, alt: z.string().trim().max(200).default(""), link: safeUrl.optional(), width: z.enum(["full", "medium", "small"]).default("full"), align: align.default("center") });
const buttonBlock = z.object({ type: z.literal("button"), label: z.string().trim().min(1, "Add the button label.").max(60), url: safeUrl, align: align.default("center"), style: z.enum(["filled", "outline"]).default("filled") });
const dividerBlock = z.object({ type: z.literal("divider") });
const spacerBlock = z.object({ type: z.literal("spacer"), height: z.number().int().min(8).max(120).default(24) });
const packageBlock = z.object({ type: z.literal("package"), planId: id, buttonLabel: z.string().trim().max(60).default("Buy now") });
const socialBlock = z.object({
  type: z.literal("social"),
  /** Round icons (brand colours) or the names as text links. */
  style: z.enum(["icons", "text"]).default("text"),
  links: z.object({ instagram: safeUrl.optional(), facebook: safeUrl.optional(), tiktok: safeUrl.optional(), youtube: safeUrl.optional(), website: safeUrl.optional() }),
  align: align.default("center"),
});
const innerBlock = z.discriminatedUnion("type", [headingBlock, textBlock, imageBlock, buttonBlock, spacerBlock]);
const columnsBlock = z.object({ type: z.literal("columns"), columns: z.tuple([z.array(innerBlock).max(10), z.array(innerBlock).max(10)]) });
export const emailBlock = z.discriminatedUnion("type", [headingBlock, textBlock, imageBlock, buttonBlock, dividerBlock, spacerBlock, packageBlock, socialBlock, columnsBlock]);
export type EmailBlock = z.infer<typeof emailBlock>;
export const EMAIL_BLOCK_TYPES = {
  heading: { label: "Heading", help: "A title. Use one big heading at the top." },
  text: { label: "Text", help: "Paragraphs. Use **bold**, *italic* and [link text](https://…). Add personal details with {{first_name}} and similar." },
  image: { label: "Image", help: "A photo or graphic (JPG, PNG, WebP or GIF, up to 2 MB). Add a short description for people who can't see images." },
  button: { label: "Button", help: "A clear call to action, e.g. “Book your first class”." },
  divider: { label: "Divider", help: "A thin line between sections." },
  spacer: { label: "Space", help: "Extra space between blocks." },
  package: { label: "Package", help: "One of your packages with its price and a button to buy it. Stays up to date if you change the package." },
  social: { label: "Social links", help: "Links to your Instagram, Facebook, TikTok, YouTube or website." },
  columns: { label: "Two columns", help: "Two blocks side by side, e.g. a photo next to text. They stack on phones." },
} as const;

/**
 * Fonts for emails. The first four are on nearly every device. The rest are Google Fonts: Apple
 * Mail, iPhones and most Android mail apps show them; Gmail and Outlook show the fallback listed.
 */
export const EMAIL_FONTS = {
  sans: { label: "Clean", stack: "Helvetica, Arial, sans-serif" },
  serif: { label: "Classic", stack: "Georgia, 'Times New Roman', serif" },
  rounded: { label: "Friendly", stack: "'Trebuchet MS', 'Segoe UI', Helvetica, Arial, sans-serif" },
  modern: { label: "Modern", stack: "Verdana, Geneva, Tahoma, sans-serif" },
  montserrat: { label: "Montserrat (bold, modern)", google: "Montserrat:wght@400;700", stack: "Montserrat, Arial, sans-serif", fallback: "Arial" },
  poppins: { label: "Poppins (geometric)", google: "Poppins:wght@400;700", stack: "Poppins, Helvetica, Arial, sans-serif", fallback: "Helvetica" },
  lato: { label: "Lato (warm)", google: "Lato:wght@400;700", stack: "Lato, Helvetica, Arial, sans-serif", fallback: "Helvetica" },
  dmsans: { label: "DM Sans (soft)", google: "DM+Sans:wght@400;700", stack: "'DM Sans', Helvetica, Arial, sans-serif", fallback: "Helvetica" },
  playfair: { label: "Playfair Display (elegant)", google: "Playfair+Display:wght@400;700", stack: "'Playfair Display', Georgia, serif", fallback: "Georgia" },
  cormorant: { label: "Cormorant (refined)", google: "Cormorant+Garamond:wght@500;700", stack: "'Cormorant Garamond', Georgia, serif", fallback: "Georgia" },
} as const;
export type EmailFont = keyof typeof EMAIL_FONTS;
const fontId = z.enum(Object.keys(EMAIL_FONTS) as [EmailFont, ...EmailFont[]]);

export const emailTheme = z.object({
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#f4f6f4"),
  content: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#ffffff"),
  text: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#17201c"),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0e6b5f"),
  font: fontId.default("sans"),
  /** Headings in a different font (e.g. Playfair headings over Lato text). Left out = same as the text. */
  headingFont: fontId.nullish(),
  buttonShape: z.enum(["rounded", "pill", "square"]).default("rounded"),
  logoFileId: id.nullish(),
});
export const emailDesign = z.object({
  subject: z.string().trim().min(1, "Add a subject line.").max(150),
  /** The grey line shown after the subject in most inboxes. */
  preheader: z.string().trim().max(150).default(""),
  theme: emailTheme.default(emailTheme.parse({})),
  blocks: z.array(emailBlock).min(1, "Add at least one block.").max(60, "Up to 60 blocks."),
});
export type EmailDesign = z.infer<typeof emailDesign>;
/** Marketing emails only go to people who agreed to them, and include an unsubscribe link. Service emails are about their account or bookings. */
export const EMAIL_PURPOSES = ["marketing", "service"] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];
/** A label to group things by ("Onboarding", "Promotions"…). Free text, so studios use their own. */
export const category = z.string().trim().max(40).nullish();
export const EMAIL_CATEGORY_SUGGESTIONS = ["Onboarding", "Promotions", "Newsletters", "Reminders", "Milestones"] as const;
export const JOURNEY_CATEGORY_SUGGESTIONS = ["Onboarding", "Retention", "Win-back", "Milestones", "Ads & leads"] as const;
export const emailDesignInput = z.object({
  name: z.string().trim().min(1, "Give the email a name.").max(80),
  category,
  purpose: z.enum(EMAIL_PURPOSES).default("marketing"),
  design: emailDesign,
});
export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "sent", "cancelled"] as const;
export const campaignInput = z
  .object({
    name: z.string().trim().min(1, "Give the campaign a name.").max(80),
    emailId: id,
    segmentId: id.nullish(),
    /** Send at this time; leave out to send when you press Send. */
    sendAt: z.coerce.date().nullish(),
  });

// ---------------------------------------------------------------------------
// Rewards: used by referrals and journeys
// ---------------------------------------------------------------------------
export const reward = z.discriminatedUnion("type", [
  z.object({ type: z.literal("credit"), amountCents: cents.min(100, "At least 1.00."), validDays: z.number().int().min(1).max(3650).default(90) }),
  z.object({ type: z.literal("free_classes"), classes: z.number().int().min(1).max(50), validDays: z.number().int().min(1).max(3650).default(60) }),
  z.object({ type: z.literal("discount"), percent: z.number().int().min(1).max(100).nullish(), amountCents: cents.nullish(), validDays: z.number().int().min(1).max(3650).default(60) }).refine((d) => !!d.percent !== !!d.amountCents, "Choose a percentage or an amount off."),
]);
export type Reward = z.infer<typeof reward>;
export const REWARD_TYPES = {
  credit: { label: "Studio credit", help: "Money to spend on anything in your online store. It expires after the days you choose." },
  free_classes: { label: "Free classes", help: "A set number of classes added to their account, valid for the days you choose." },
  discount: { label: "One-time discount", help: "A percentage or amount off one purchase, used by the date you choose." },
} as const;
export function describeReward(r: Reward, fmtMoney: (c: number) => string = (c) => (c / 100).toFixed(2)): string {
  if (r.type === "credit") return `${fmtMoney(r.amountCents)} studio credit, valid for ${r.validDays} days`;
  if (r.type === "free_classes") return `${r.classes} free ${r.classes === 1 ? "class" : "classes"}, valid for ${r.validDays} days`;
  return `${r.percent ? `${r.percent}%` : fmtMoney(r.amountCents ?? 0)} off one purchase, used within ${r.validDays} days`;
}

// ---------------------------------------------------------------------------
// Journeys: a trigger, then steps that run one after another. A "check" or "wait for"
// step splits into Yes and No paths. Steps are a tree (not a free canvas), so every
// journey reads top to bottom and can't loop back on itself.
// ---------------------------------------------------------------------------
export const JOURNEY_TRIGGERS = {
  account_created: { label: "Creates an account", help: "Starts when someone joins the studio in the app. Add a check on “Came from” to follow up ad leads differently." },
  first_class_booked: { label: "Books their first class", help: "Starts the first time they book." },
  class_attended: { label: "Attends a class", help: "Starts each time they're marked as attended." },
  attendance_milestone: { label: "Reaches a number of classes", help: "Starts when they attend their Nth class, e.g. their 50th." },
  package_bought: { label: "Buys a package", help: "Starts when they buy one of the package types you choose (or any)." },
  package_expiring: { label: "Package is about to expire", help: "Starts a set number of days before a package expires." },
  package_used_up: { label: "Uses their last class", help: "Starts when a credit pack runs out of classes." },
  membership_stopped: { label: "Stops a membership", help: "Starts when a recurring package is stopped." },
  inactive: { label: "Hasn't come for a while", help: "Starts when it's been a set number of days since their last class." },
  joins_segment: { label: "Joins a segment", help: "Starts when a client starts matching one of your saved segments. Checked every hour." },
  referral_qualified: { label: "Refers a friend who qualifies", help: "Starts when a friend they referred meets your referral rule." },
  gift_card_received: { label: "Receives a gift card", help: "Starts when someone gives them a gift card." },
} as const;
export type JourneyTrigger = keyof typeof JOURNEY_TRIGGERS;
export const JOURNEY_TRIGGER_IDS = Object.keys(JOURNEY_TRIGGERS) as JourneyTrigger[];

/** Events a "wait for" step can wait for. */
export const JOURNEY_EVENTS = {
  package_bought: "Buys a package",
  class_booked: "Books a class",
  class_attended: "Attends a class",
} as const;
export type JourneyEvent = keyof typeof JOURNEY_EVENTS;

const duration = z.object({ value: z.number().int().min(1).max(1000), unit: z.enum(["minutes", "hours", "days", "weeks"]) });
export type Duration = z.infer<typeof duration>;
export const durationMs = (d: Duration) => d.value * { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 }[d.unit];

export const journeyTrigger = z.object({
  type: z.enum(JOURNEY_TRIGGER_IDS as [JourneyTrigger, ...JourneyTrigger[]]),
  /** package_bought: which package types (empty = any). */
  planIds: z.array(id).max(50).optional(),
  /** attendance_milestone: the Nth class. */
  count: z.number().int().min(1).max(10_000).optional(),
  /** package_expiring / inactive: days before expiry or since the last class. */
  days: z.number().int().min(1).max(365).optional(),
  segmentId: id.optional(),
});
export type JourneyTriggerDef = z.infer<typeof journeyTrigger>;

const stepId = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
type StepShape =
  | { id: string; type: "wait"; for: Duration }
  | { id: string; type: "send_email"; emailId: string }
  | { id: string; type: "send_push"; title: string; body: string }
  | { id: string; type: "add_tag" | "remove_tag"; tagId: string }
  | { id: string; type: "give_reward"; reward: Reward }
  | { id: string; type: "notify_staff"; message: string }
  | { id: string; type: "check"; rule: SegmentRule; yes: StepShape[]; no: StepShape[] }
  | { id: string; type: "wait_for"; event: JourneyEvent; planIds?: string[]; within: Duration; yes: StepShape[]; no: StepShape[] };
export type JourneyStep = StepShape;
export const journeyStep: z.ZodType<StepShape> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ id: stepId, type: z.literal("wait"), for: duration }),
    z.object({ id: stepId, type: z.literal("send_email"), emailId: id }),
    z.object({ id: stepId, type: z.literal("send_push"), title: z.string().trim().min(1).max(60), body: z.string().trim().min(1).max(180) }),
    z.object({ id: stepId, type: z.enum(["add_tag", "remove_tag"]), tagId: id }),
    z.object({ id: stepId, type: z.literal("give_reward"), reward }),
    z.object({ id: stepId, type: z.literal("notify_staff"), message: z.string().trim().min(1).max(500) }),
    z.object({ id: stepId, type: z.literal("check"), rule: segmentRule, yes: z.array(journeyStep).max(50), no: z.array(journeyStep).max(50) }),
    z.object({ id: stepId, type: z.literal("wait_for"), event: z.enum(Object.keys(JOURNEY_EVENTS) as [JourneyEvent, ...JourneyEvent[]]), planIds: z.array(id).max(50).optional(), within: duration, yes: z.array(journeyStep).max(50), no: z.array(journeyStep).max(50) }),
  ]) as unknown as z.ZodType<StepShape>,
);
export const JOURNEY_STEP_TYPES = {
  wait: { label: "Wait", help: "Pause for a while before the next step." },
  send_email: { label: "Send an email", help: "One of your saved emails. Marketing emails are skipped for people who haven't agreed to them." },
  send_push: { label: "Send a push notification", help: "A short message to their phone, if they have the app." },
  add_tag: { label: "Add a tag", help: "Label them, e.g. “Intro offer lead”, so staff can see it and you can filter by it." },
  remove_tag: { label: "Remove a tag", help: "Take a tag off them." },
  give_reward: { label: "Give a reward", help: "Studio credit, free classes or a one-time discount." },
  notify_staff: { label: "Tell the team", help: "Email your admins, e.g. “Give this client a call”." },
  check: { label: "Check (yes / no)", help: "Split the journey by anything you can filter clients by, e.g. “Classes attended: at least 1”." },
  wait_for: { label: "Wait for something (yes / no)", help: "Wait up to a set time for them to do something, e.g. buy the intro offer. Yes if they do, No if time runs out." },
} as const;

export const JOURNEY_REENTRY = ["once", "every_time"] as const;
export const journeyDefinition = z.object({
  trigger: journeyTrigger,
  steps: z.array(journeyStep).min(1, "Add at least one step.").max(50),
});
export type JourneyDefinition = z.infer<typeof journeyDefinition>;
export const journeyInput = z.object({
  name: z.string().trim().min(1, "Give the journey a name.").max(80),
  category,
  description: z.string().trim().max(300).nullish(),
  definition: journeyDefinition,
  /** once = each client goes through it at most once; every_time = each time the trigger happens (never twice at the same time). */
  reentry: z.enum(JOURNEY_REENTRY).default("once"),
  /** Emails and pushes due overnight wait until the morning (studio time). */
  quietHours: z.boolean().default(true),
});

// ---------------------------------------------------------------------------
// Banners and announcements (shown in the client app)
// ---------------------------------------------------------------------------
export const BANNER_PLACEMENTS = ["home", "packages", "schedule"] as const;
export const BANNER_LINKS = ["none", "package", "category", "class_type", "gift_cards", "referrals", "url"] as const;
export const bannerInput = z
  .object({
    title: z.string().trim().min(1, "Add a title (used for accessibility and reports).").max(80),
    subtitle: z.string().trim().max(160).nullish(),
    imageFileId: id,
    placement: z.enum(BANNER_PLACEMENTS).default("home"),
    linkType: z.enum(BANNER_LINKS).default("none"),
    /** The package, category or class type id, or the web address. */
    linkTarget: z.string().trim().max(2000).nullish(),
    audience: z.enum(["everyone", "new_clients", "segment"]).default("everyone"),
    segmentId: id.nullish(),
    startsAt: z.coerce.date().nullish(),
    endsAt: z.coerce.date().nullish(),
    active: z.boolean().default(true),
  })
  .superRefine((b, ctx) => {
    if (b.linkType === "url" && !/^https?:\/\//i.test(b.linkTarget ?? "")) ctx.addIssue({ code: "custom", path: ["linkTarget"], message: "Web links need to start with https:// or http://." });
    if (["package", "category", "class_type"].includes(b.linkType) && !z.uuid().safeParse(b.linkTarget).success) ctx.addIssue({ code: "custom", path: ["linkTarget"], message: "Choose what the banner opens." });
    if (b.audience === "segment" && !b.segmentId) ctx.addIssue({ code: "custom", path: ["segmentId"], message: "Choose a segment." });
    if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "The end needs to be after the start." });
  });

export const ANNOUNCEMENT_DURATIONS = {
  "2h": "2 hours",
  end_of_day: "Until the end of today",
  "24h": "24 hours",
  "3d": "3 days",
  "1w": "1 week",
  custom: "Until a date and time I choose",
} as const;
export const announcementInput = z
  .object({
    title: z.string().trim().min(1, "Add a short title, e.g. “Lift out of order”.").max(80),
    message: z.string().trim().min(1, "Add the message.").max(500),
    importance: z.enum(["info", "important"]).default("info"),
    audience: z.enum(["everyone", "location", "booked_at_location"]).default("everyone"),
    /** For location audiences. */
    locationId: id.nullish(),
    /** booked_at_location: clients booked there in the next N days. */
    bookedWithinDays: z.number().int().min(1).max(30).default(7),
    startsAt: z.coerce.date().nullish(),
    duration: z.enum(Object.keys(ANNOUNCEMENT_DURATIONS) as [keyof typeof ANNOUNCEMENT_DURATIONS, ...(keyof typeof ANNOUNCEMENT_DURATIONS)[]]).default("24h"),
    endsAt: z.coerce.date().nullish(),
    sendPush: z.boolean().default(true),
  })
  .superRefine((a, ctx) => {
    if (a.audience !== "everyone" && !a.locationId) ctx.addIssue({ code: "custom", path: ["locationId"], message: "Choose the location." });
    if (a.duration === "custom" && !a.endsAt) ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Choose when it should disappear." });
  });

// ---------------------------------------------------------------------------
// Gift cards, studio credit and referrals
// ---------------------------------------------------------------------------
export const GIFT_CARD_STATUSES = ["pending_payment", "unsent", "given", "kept", "cancelled"] as const;
export type GiftCardStatus = (typeof GIFT_CARD_STATUSES)[number];
/** Email address or phone number of the person receiving a gift card. */
export const giftRecipient = z.object({
  to: z.string().trim().min(3, "Enter their email address or phone number.").max(200),
  fromName: z.string().trim().max(60).nullish(),
  message: z.string().trim().max(300).nullish(),
});
export const giftCardCheckout = z.object({
  designId: id,
  amountCents: cents.min(100),
  /** Give it straight away. Leave out to keep it in your Gift cards tab and give it later. */
  give: giftRecipient.optional(),
});
export const giftCardDesignInput = z.object({ name: z.string().trim().min(1).max(60), fileId: id, active: z.boolean().default(true) });
export const giftCardSettings = z.object({
  giftCardsEnabled: z.boolean(),
  giftCardAmounts: z.array(cents.min(100)).max(8),
  giftCardCustomMinCents: cents.nullable(),
  giftCardCustomMaxCents: cents.nullable(),
  giftCardValidityDays: z.number().int().min(30).max(3650),
  giftCardGiveWithinDays: z.number().int().min(1).max(365),
}).partial();

export const REFERRAL_QUALIFY = {
  classes_attended: "Attends a number of classes",
  spend: "Spends a set amount",
  package_bought: "Buys a package",
} as const;
export const referralSettings = z
  .object({
    referralsEnabled: z.boolean(),
    /** How a referred friend qualifies the referrer for a reward. */
    referralQualify: z.enum(Object.keys(REFERRAL_QUALIFY) as [keyof typeof REFERRAL_QUALIFY, ...(keyof typeof REFERRAL_QUALIFY)[]]),
    /** Classes, or an amount in cents, depending on the rule (ignored for package_bought). */
    referralQualifyValue: z.number().int().min(1).max(100_000_000),
    /** The friend has this many days from joining to qualify. */
    referralQualifyWithinDays: z.number().int().min(7).max(365),
    referrerReward: reward,
    /** An optional welcome gift for the new member, given when they enter the code. */
    refereeReward: reward.nullable(),
    /** New members can add a code this many days after joining (and before their first purchase). */
    referralCodeWindowDays: z.number().int().min(0).max(60),
    /** Most rewards one person can earn in a calendar month (null = no limit). */
    referralMonthlyCap: z.number().int().min(1).max(100).nullable(),
  })
  .partial();
export const applyReferral = z.object({ code: z.string().trim().min(3).max(20) });
export const creditAdjustment = z.object({
  amountCents: z.number().int().min(-100_000_00).max(100_000_00).refine((n) => n !== 0, "Enter an amount."),
  reason: z.string().trim().min(1, "Add a reason.").max(200),
  validDays: z.number().int().min(1).max(3650).default(365),
});
export const joinStudio = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: z.string().trim().max(30).nullish(),
  referralCode: z.string().trim().max(20).nullish(),
  marketingEmail: z.boolean().default(false),
  marketingPush: z.boolean().default(false),
  /** From the link they arrived on: utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid. */
  attribution: z.record(z.string().max(40), z.string().max(200)).optional(),
});
export const marketingPrefs = z.object({ marketingEmail: z.boolean().optional(), marketingPush: z.boolean().optional() });

/** Work out where a new client came from, from the tags on the link they arrived on. */
export function acquisitionFrom(attribution: Record<string, string> | undefined, referred: boolean): AcquisitionChannel {
  if (referred) return "referral";
  const a = Object.fromEntries(Object.entries(attribution ?? {}).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  if (a.fbclid || /^(facebook|fb|instagram|ig|meta)$/.test(a.utm_source ?? "")) return "meta_ads";
  if (a.gclid || a.gbraid || a.wbraid || (a.utm_source === "google" && /^(cpc|ppc|paid|paidsearch)$/.test(a.utm_medium ?? ""))) return "google_ads";
  if (a.utm_source || a.utm_campaign) return "other_campaign";
  return "direct";
}

/** A short code people can read out: letters from their name and four that can't be misread. */
export function makeReferralCode(firstName: string, random: () => number = Math.random): string {
  const letters = firstName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "FRIEND";
  const safe = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += safe[Math.floor(random() * safe.length)];
  return `${letters}-${tail}`;
}
