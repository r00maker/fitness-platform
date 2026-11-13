/**
 * Agents: helpers that take simple, repetitive jobs off the studio's hands.
 *
 * Reminder agents (this file) are built from three plain blocks, so they're easy to set up and,
 * later, easy for studios to put together themselves:
 *   1. When it runs: every day at a set time, or a set number of hours before each class.
 *   2. What it checks: one job, e.g. "classes tomorrow with fewer than 3 booked".
 *   3. Who it tells: staff roles and/or named staff. Never clients.
 * The studio names it ("Agnes", "Jeff") and an owner or admin decides what it can see.
 *
 * What agents can never do, whatever they're given:
 *   - see client names, contact details, health notes, payments, prices, packages or pay;
 *   - see anything from another studio;
 *   - change anything (cancel a class, book someone, refund). They tell a person, who decides.
 *   - tell someone more than that person could see themselves (an instructor only hears about
 *     their own classes).
 */
import { z } from "zod";
import { localTime } from "./schemas.js";

/** What an owner or admin can let an agent see. Anything not listed here, an agent can never see. */
export const AGENT_SEES = {
  schedule: "Class times, names, rooms and locations",
  instructors: "Who teaches each class (names only)",
  booking_counts: "How many people are booked and waiting (numbers, never names)",
  cover: "Cover: who's covering which class, and cover requests",
} as const;
export type AgentSees = keyof typeof AGENT_SEES;
/** Shown on every agent so it's clear what's off limits. */
export const AGENT_NEVER_SEES = [
  "Client names, contact details or health notes",
  "Payments, prices, packages or pay",
  "Anything from another studio",
] as const;

/** Who an agent can message. Clients are deliberately not an option. */
export const AGENT_RECIPIENT_ROLES = ["owner", "admin", "front_desk", "instructor"] as const;
export type AgentRecipientRole = (typeof AGENT_RECIPIENT_ROLES)[number];

/** The jobs a reminder agent can do. */
export const AGENT_JOBS = {
  cover_classes: { label: "Cover class reminders", needs: ["schedule", "cover"], perClass: true, explain: "Reminds instructors about classes they're covering, which are outside their usual schedule and easy to miss." },
  low_bookings: { label: "Low bookings check", needs: ["schedule", "booking_counts"], perClass: true, explain: "Flags classes with few bookings, so someone can decide whether to cancel early." },
  teaching: { label: "Teaching line-up", needs: ["schedule"], perClass: true, explain: "Tells each instructor what they're teaching, e.g. tomorrow's classes." },
  no_instructor: { label: "Classes without an instructor", needs: ["schedule", "instructors"], perClass: false, explain: "Spots upcoming classes nobody is teaching yet." },
  busy_waitlist: { label: "Busy waitlists", needs: ["schedule", "booking_counts"], perClass: false, explain: "Points out full classes with people waiting, in case you can add spots or another class." },
  open_cover: { label: "Unfilled cover requests", needs: ["schedule", "cover"], perClass: false, explain: "Chases cover requests nobody has taken yet." },
} as const satisfies Record<string, { label: string; needs: readonly AgentSees[]; perClass: boolean; explain: string }>;
export type AgentJobType = keyof typeof AGENT_JOBS;

const days = (min: number, max: number, dflt: number) => z.number().int().min(min).max(max).default(dflt);
const ids = z.array(z.uuid()).max(50).optional();

export const agentWhen = z.discriminatedUnion("type", [
  /** Every day (or chosen weekdays, 1 = Monday) at a local time. */
  z.object({ type: z.literal("daily"), time: localTime, weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional() }),
  /** For each class: this many hours before it starts. */
  z.object({ type: z.literal("before_class"), hoursBefore: z.number().int().min(1).max(72) }),
]);

export const agentJob = z.discriminatedUnion("type", [
  /** Daily: covers in the next N days (1 = tomorrow). Before a class: that class, if it's a cover. */
  z.object({ type: z.literal("cover_classes"), daysAhead: days(1, 14, 1) }),
  z.object({
    type: z.literal("low_bookings"),
    /** 0 = later today, 1 = tomorrow, up to a week. */
    daysAhead: days(0, 7, 1),
    below: z.discriminatedUnion("mode", [z.object({ mode: z.literal("count"), value: z.number().int().min(1).max(200) }), z.object({ mode: z.literal("percent"), value: z.number().int().min(1).max(100) })]),
    classTypeIds: ids,
    locationIds: ids,
  }),
  z.object({ type: z.literal("teaching"), daysAhead: days(0, 7, 1) }),
  z.object({ type: z.literal("no_instructor"), daysAhead: days(1, 30, 7) }),
  z.object({ type: z.literal("busy_waitlist"), daysAhead: days(0, 7, 1), atLeast: z.number().int().min(1).max(50).default(3) }),
  z.object({ type: z.literal("open_cover"), daysAhead: days(1, 14, 3) }),
]);
export type AgentJob = z.infer<typeof agentJob>;

export const agentNotify = z
  .object({
    roles: z.array(z.enum(AGENT_RECIPIENT_ROLES)).max(4).default([]),
    /** Particular staff members, e.g. just the studio manager. */
    userIds: z.array(z.uuid()).max(50).default([]),
  })
  .refine((n) => n.roles.length + n.userIds.length > 0, "Choose who the agent tells.");

const agentName = z
  .string()
  .trim()
  .min(1, "Give your agent a name.")
  .max(30, "Keep the name to 30 characters.")
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u, "Use letters, numbers and spaces.");

export const agentDefinition = z
  .object({
    when: agentWhen,
    job: agentJob,
    notify: agentNotify,
    /** What the owner or admin lets it see. Must include what the job needs. */
    sees: z.array(z.enum(Object.keys(AGENT_SEES) as [AgentSees, ...AgentSees[]])).min(1).max(4),
  })
  .superRefine((d, ctx) => {
    const job = AGENT_JOBS[d.job.type];
    const missing = job.needs.filter((n) => !d.sees.includes(n));
    if (missing.length) ctx.addIssue({ code: "custom", path: ["sees"], message: `${job.label} needs to see: ${missing.map((m) => AGENT_SEES[m].toLowerCase()).join("; ")}.` });
    if (d.when.type === "before_class" && !job.perClass) ctx.addIssue({ code: "custom", path: ["when"], message: `${job.label} runs once a day. Choose a time instead.` });
  });
export type AgentDefinition = z.infer<typeof agentDefinition>;

export const createAgent = z.object({ name: agentName, starter: z.string().max(40).optional(), enabled: z.boolean().default(true), definition: agentDefinition });
export const updateAgent = z
  .object({ name: agentName, enabled: z.boolean(), definition: agentDefinition })
  .partial()
  .refine((u) => Object.keys(u).length > 0, "Nothing to change.");
export const previewAgent = z.object({ name: agentName.default("Your agent"), definition: agentDefinition });

/** Ready-made agents. Pick one, name it, adjust a setting or two, done. */
export const AGENT_STARTERS = [
  {
    key: "cover_reminder",
    suggestedName: "Jeff",
    title: "Remind instructors about cover classes",
    pitch: "The evening before, each instructor covering a class gets a nudge, since covers aren't on their usual schedule.",
    definition: { when: { type: "daily", time: "19:00" }, job: { type: "cover_classes", daysAhead: 1 }, notify: { roles: ["instructor"], userIds: [] }, sees: ["schedule", "instructors", "cover"] },
  },
  {
    key: "low_bookings",
    suggestedName: "Agnes",
    title: "Warn about quiet classes the night before",
    pitch: "At 10pm, admins hear which of tomorrow's classes have fewer than 3 booked, so they can cancel early if they want to.",
    definition: { when: { type: "daily", time: "22:00" }, job: { type: "low_bookings", daysAhead: 1, below: { mode: "count", value: 3 } }, notify: { roles: ["owner", "admin"], userIds: [] }, sees: ["schedule", "booking_counts"] },
  },
  {
    key: "teaching_lineup",
    suggestedName: "Theo",
    title: "Send instructors tomorrow's line-up",
    pitch: "Each instructor gets a list of what they're teaching tomorrow, with times and rooms.",
    definition: { when: { type: "daily", time: "20:00" }, job: { type: "teaching", daysAhead: 1 }, notify: { roles: ["instructor"], userIds: [] }, sees: ["schedule", "cover"] },
  },
  {
    key: "no_instructor",
    suggestedName: "Nina",
    title: "Spot classes with no instructor",
    pitch: "Each morning, admins hear about classes in the next week that nobody is teaching yet.",
    definition: { when: { type: "daily", time: "09:00" }, job: { type: "no_instructor", daysAhead: 7 }, notify: { roles: ["owner", "admin"], userIds: [] }, sees: ["schedule", "instructors"] },
  },
  {
    key: "busy_waitlist",
    suggestedName: "Walt",
    title: "Point out busy waitlists",
    pitch: "Each morning, the front desk hears which classes today and tomorrow have 3 or more people waiting.",
    definition: { when: { type: "daily", time: "08:00" }, job: { type: "busy_waitlist", daysAhead: 1, atLeast: 3 }, notify: { roles: ["admin", "front_desk"], userIds: [] }, sees: ["schedule", "booking_counts"] },
  },
  {
    key: "open_cover",
    suggestedName: "Cora",
    title: "Chase unfilled cover requests",
    pitch: "Each morning, admins hear about cover requests for the next 3 days that nobody has taken.",
    definition: { when: { type: "daily", time: "10:00" }, job: { type: "open_cover", daysAhead: 3 }, notify: { roles: ["owner", "admin"], userIds: [] }, sees: ["schedule", "instructors", "cover"] },
  },
] as const;

const ROLE_WORDS: Record<AgentRecipientRole, string> = { owner: "owners", admin: "admins", front_desk: "front of house", instructor: "instructors" };
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};
const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const listWords = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** One plain sentence saying what an agent does, e.g. for its card and while it's being set up. */
export function describeAgent(d: AgentDefinition, opts: { peopleCount?: number } = {}): string {
  const j = d.job;
  const ahead = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in the next ${n} days`);
  const job =
    j.type === "cover_classes" ? (d.when.type === "before_class" ? "reminds whoever is covering a class" : `reminds instructors about classes they're covering ${ahead(j.daysAhead)}`)
    : j.type === "low_bookings" ? `checks ${d.when.type === "before_class" ? "each class" : `${ahead(j.daysAhead)}'s classes`} for ${j.below.mode === "count" ? `fewer than ${j.below.value} booked` : `less than ${j.below.value}% full`}`
    : j.type === "teaching" ? (d.when.type === "before_class" ? "reminds instructors about each class they teach" : `sends instructors what they're teaching ${ahead(j.daysAhead)}`)
    : j.type === "no_instructor" ? `looks for classes ${ahead(j.daysAhead)} with no instructor`
    : j.type === "busy_waitlist" ? `looks for classes ${j.daysAhead === 1 ? "today and tomorrow" : ahead(j.daysAhead)} with ${j.atLeast} or more people waiting`
    : `chases cover requests ${ahead(j.daysAhead)} that nobody has taken`;
  const when =
    d.when.type === "before_class" ? `${d.when.hoursBefore} ${d.when.hoursBefore === 1 ? "hour" : "hours"} before each class`
    : `${d.when.weekdays && d.when.weekdays.length < 7 ? `Every ${listWords(d.when.weekdays.map((w) => DAY_NAMES[w]!))}` : "Every day"} at ${clock(d.when.time)}`;
  const people = opts.peopleCount ?? d.notify.userIds.length;
  const who = listWords([...d.notify.roles.map((r) => ROLE_WORDS[r]), ...(people ? [`${people} chosen ${people === 1 ? "person" : "people"}`] : [])]);
  const onlyOwn = d.notify.roles.includes("instructor") ? " Instructors only hear about their own classes." : "";
  return `${d.when.type === "before_class" ? `${when[0]!.toUpperCase()}${when.slice(1)}` : when}, it ${job} and tells ${who}.${onlyOwn}`;
}

// ---------------------------------------------------------------------------
// Support assistant
// ---------------------------------------------------------------------------
/** Staff roles that can be allowed to use the assistant (clients can't). */
export const ASSISTANT_ROLES = ["owner", "admin", "front_desk", "instructor"] as const;
export const assistantSettings = z
  .object({
    enabled: z.boolean(),
    roles: z.array(z.enum(ASSISTANT_ROLES)).max(4),
    /** Let it do simple things (book someone in, add to a waitlist) once the person confirms. */
    allowActions: z.boolean(),
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, "Nothing to change.");
export const askAssistant = z.object({
  chatId: z.uuid().optional(),
  text: z.string().trim().min(1, "Type a question.").max(2000, "Keep questions under 2,000 characters."),
});
export const confirmAssistantAction = z.object({ acknowledge: z.array(z.string()).max(20).default([]) });
/**
 * Top-up packs of assistant replies, for studios that use more than their plan includes.
 * Prices are placeholders in US cents: set the real ones before launch.
 */
export const ASSISTANT_TOP_UPS = [
  { replies: 200, priceCents: 1000 },
  { replies: 1000, priceCents: 4000 },
] as const;
export const buyAssistantTopUp = z.object({ pack: z.number().int().min(0).max(ASSISTANT_TOP_UPS.length - 1) });
