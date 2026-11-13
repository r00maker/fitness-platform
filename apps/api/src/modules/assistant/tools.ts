/**
 * The assistant's tools. Each runs as the person asking, inside their studio, with their role's
 * permissions, so the assistant can never see or do more than they could themselves.
 *
 * Deliberately missing: anything about money (refunds, payments, prices, selling packages, fees,
 * gift card balances, pay), settings, staff, deleting things, client contact details, health notes,
 * and other studios. There's no tool for them, so the assistant can't do them whatever it's asked.
 *
 * The few things it can do (book a client in, add them to a waitlist, cancel a free-to-cancel
 * booking) are only ever offered. Nothing happens until the person presses Confirm.
 */
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { can, OPTION_LABELS } from "@studio/shared";
import type { Db, DbOrTx } from "../../db/client.js";
import { assistantActions, bookings, classSessions, classTypes, clientPackages, locations, memberships, organizations, rooms, users, waitlistEntries } from "../../db/schema.js";
import { AppError } from "../../lib/errors.js";
import { Flags, type Flag } from "../../lib/flags.js";
import type { AuthContext } from "../../plugins/auth.js";
import { cancelBooking, createBooking } from "../bookings/service.js";
import { joinWaitlist } from "../waitlist/service.js";
import type { ModelTool } from "./model.js";

export interface ToolCtx {
  db: Db;
  auth: AuthContext;
  chatId: string;
  tz: string;
  allowActions: boolean;
  now: Date;
}

const uuid = z.uuid("That isn't a valid id. Look it up first with find_clients or find_classes.");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM.");
const ACTIONS = ["book_client", "join_waitlist", "cancel_booking"] as const;

const inputs = {
  find_clients: z.object({ name: z.string().trim().min(2).max(80) }),
  find_classes: z.object({ date: ymd.optional(), to_date: ymd.optional(), time: hhmm.optional(), name: z.string().trim().max(80).optional() }),
  check_booking: z.object({ client_id: uuid, class_id: uuid }),
  client_bookings: z.object({ client_id: uuid }),
  studio_rules: z.object({}),
  offer_action: z.object({ action: z.enum(ACTIONS), client_id: uuid, class_id: uuid }),
};
export type ToolName = keyof typeof inputs;

export const TOOLS: ModelTool[] = [
  {
    name: "find_clients",
    description: "Look up clients of this studio by name (first, last or both). Returns up to 8 matches with their id and whether they're a member, ClassPass client or lead. Owners and admins also see each client's current packages (name, classes left, expiry). Never returns contact details or health notes.",
    input_schema: { type: "object", properties: { name: { type: "string", description: "All or part of the client's name, e.g. 'Dev Kumar' or 'Dev'." } }, required: ["name"], additionalProperties: false },
  },
  {
    name: "find_classes",
    description: "Find classes and appointments on this studio's schedule. Filter by local date (YYYY-MM-DD; defaults to today), an optional end date (up to 31 days on), start time (24-hour HH:MM) and/or class name. Returns each class's id, date, time, instructor, place, spots, how many are booked and waiting, booking window and any auto-cancel rule. Instructors only see their own classes.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Local date, YYYY-MM-DD. Work it out from today's date in the conversation (e.g. 'Saturday' = the coming Saturday)." },
        to_date: { type: "string", description: "Optional last date to include, YYYY-MM-DD." },
        time: { type: "string", description: "Optional start time, 24-hour HH:MM, e.g. 11:00." },
        name: { type: "string", description: "Optional part of the class name, e.g. 'Reformer'." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "check_booking",
    description: "Check whether a client can be booked into a class right now, using the studio's real booking rules, without booking anything. Returns 'can_book', 'can_book_after_confirming' (with the warnings the person would need to accept) or 'blocked' (with the exact reason). Use this to answer 'why can't I book X into Y?'.",
    input_schema: { type: "object", properties: { client_id: { type: "string" }, class_id: { type: "string" } }, required: ["client_id", "class_id"], additionalProperties: false },
  },
  {
    name: "client_bookings",
    description: "A client's upcoming bookings and waitlist places at this studio (and their last few classes). Instructors only see bookings in their own classes.",
    input_schema: { type: "object", properties: { client_id: { type: "string" } }, required: ["client_id"], additionalProperties: false },
  },
  {
    name: "studio_rules",
    description: "This studio's booking rules: when booking opens and closes, the late-cancellation window and fees, weekly limits, whether a package is needed, waivers, waitlist holds and how cover works.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "offer_action",
    description: "Offer to do one simple thing for the person: book a client into a class ('book_client'), add a client to a class's waitlist ('join_waitlist'), or cancel a client's booking when it's free to cancel ('cancel_booking'). This only shows the person a Confirm button; nothing happens until they press it, so don't say it's done. Check first with check_booking. Not for anything involving payment.",
    input_schema: { type: "object", properties: { action: { type: "string", enum: [...ACTIONS] }, client_id: { type: "string" }, class_id: { type: "string" } }, required: ["action", "client_id", "class_id"], additionalProperties: false },
  },
];

// ---------------------------------------------------------------------------------------
const sees = (a: AuthContext) => ({
  fullSchedule: can(a.role, "viewFullSchedule"),
  rosters: can(a.role, "viewAllRosters"),
  clientDetails: can(a.role, "viewClientDetails"),
  manager: can(a.role, "manageBookings"),
});
const local = (d: Date, tz: string) => DateTime.fromJSDate(d, { zone: tz });
const when = (d: Date, tz: string) => local(d, tz).toFormat("ccc d LLL, h:mma").replace(/AM|PM/, (m) => m.toLowerCase());
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Clients an instructor may look up: people booked into classes they teach (recently or soon). */
async function instructorClientIds(db: DbOrTx, a: AuthContext, now: Date) {
  const rows = await db
    .selectDistinct({ id: bookings.clientId })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.orgId, a.orgId), eq(classSessions.instructorId, a.userId), gte(classSessions.startsAt, new Date(now.getTime() - 60 * 86_400_000))));
  return rows.map((r) => r.id);
}

async function assertClient(ctx: ToolCtx, clientId: string) {
  const [m] = await ctx.db
    .select({ first: users.firstName, last: users.lastName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.auth.orgId), eq(memberships.userId, clientId), eq(memberships.role, "client")));
  if (!m) throw new ToolError("No client with that id at this studio. Look them up with find_clients.");
  if (ctx.auth.role === "instructor" && !(await instructorClientIds(ctx.db, ctx.auth, ctx.now)).includes(clientId)) {
    throw new ToolError("Instructors can only look up clients booked into their own classes.");
  }
  return `${m.first} ${m.last}`;
}

async function assertClass(ctx: ToolCtx, classId: string) {
  const [s] = await ctx.db
    .select({ id: classSessions.id, startsAt: classSessions.startsAt, instructorId: classSessions.instructorId, name: classTypes.name, tz: locations.timezone })
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(locations, eq(locations.id, classSessions.locationId))
    .where(and(eq(classSessions.id, classId), eq(classSessions.orgId, ctx.auth.orgId)));
  if (!s) throw new ToolError("No class with that id at this studio. Look it up with find_classes.");
  if (!sees(ctx.auth).fullSchedule && s.instructorId !== ctx.auth.userId) throw new ToolError("Instructors can only see their own classes.");
  return { ...s, label: `${s.name}, ${when(s.startsAt, s.tz)}` };
}

export class ToolError extends Error {}

/** Run a change in a transaction that's always rolled back, to see what the real rules say. */
class DryRun extends Error {
  constructor(readonly flags: Flag[]) {
    super("dry run");
  }
}
type Outcome = { result: "can_book" | "can_book_after_confirming"; warnings: { title: string; message: string; code: string }[]; notes: string[] } | { result: "blocked"; code: string; reason: string };
async function dryRun(db: Db, fn: (tx: DbOrTx, flags: Flags) => Promise<unknown>): Promise<Outcome> {
  try {
    await db.transaction(async (tx) => {
      const flags = new Flags([]);
      await fn(tx, flags);
      throw new DryRun(flags.list);
    });
  } catch (e) {
    const list = e instanceof DryRun ? e.flags : e instanceof AppError && e.code === "needs_confirmation" ? [...((e.details?.flags as Flag[]) ?? []), ...((e.details?.info as Flag[]) ?? [])] : null;
    if (list) {
      const warnings = list.filter((f) => f.severity === "confirm").map((f) => ({ code: f.code, title: f.title, message: f.message }));
      return { result: warnings.length ? "can_book_after_confirming" : "can_book", warnings, notes: list.filter((f) => f.severity === "info").map((f) => f.message) };
    }
    if (e instanceof AppError) return { result: "blocked", code: e.code, reason: e.message };
    throw e;
  }
  throw new Error("unreachable");
}

const PACKAGE_CODES = new Set(["package_needed", "package_required", "appointment_package_needed", "package_not_usable"]);
/** People who can't see clients' packages get the gist, not the details. */
function forRole(a: AuthContext, o: Outcome): Outcome {
  if (sees(a).clientDetails || o.result !== "blocked" || !PACKAGE_CODES.has(o.code)) return o;
  return { ...o, reason: "They don't have a package that covers this class. An owner or admin can check their packages or sell them one." };
}

// ---------------------------------------------------------------------------------------
async function findClients(ctx: ToolCtx, i: z.infer<typeof inputs.find_clients>) {
  const s = sees(ctx.auth);
  if (!s.rosters && ctx.auth.role !== "instructor") throw new ToolError("This person's role can't look up clients.");
  const allowed = ctx.auth.role === "instructor" ? await instructorClientIds(ctx.db, ctx.auth, ctx.now) : null;
  if (allowed && !allowed.length) return { clients: [], note: "Instructors can only look up clients booked into their own classes, and nobody has booked theirs recently." };
  const q = like(i.name);
  const rows = await ctx.db
    .select({ id: users.id, first: users.firstName, last: users.lastName, source: memberships.source })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.auth.orgId), eq(memberships.role, "client"), or(ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, q), ilike(users.lastName, q)), allowed ? inArray(users.id, allowed) : undefined))
    .orderBy(asc(users.firstName))
    .limit(8);
  const pkgs = s.clientDetails && rows.length
    ? await ctx.db
        .select({ ownerId: clientPackages.ownerId, name: clientPackages.name, kind: clientPackages.kind, left: clientPackages.creditsLeft, expiresAt: clientPackages.expiresAt, cancelledAt: clientPackages.cancelledAt })
        .from(clientPackages)
        .where(and(eq(clientPackages.orgId, ctx.auth.orgId), inArray(clientPackages.ownerId, rows.map((r) => r.id))))
    : [];
  return {
    clients: rows.map((r) => ({
      id: r.id,
      name: `${r.first} ${r.last}`,
      type: r.source === "classpass" ? "ClassPass client" : "Studio member",
      ...(s.clientDetails
        ? {
            packages: pkgs
              .filter((p) => p.ownerId === r.id && !p.cancelledAt && (!p.expiresAt || p.expiresAt > ctx.now))
              .map((p) => ({ name: p.name, classesLeft: p.kind === "unlimited" ? "unlimited" : p.left, expires: p.expiresAt ? local(p.expiresAt, ctx.tz).toFormat("d LLL yyyy") : "no expiry yet" })),
          }
        : {}),
    })),
  };
}

async function findClasses(ctx: ToolCtx, i: z.infer<typeof inputs.find_classes>) {
  const today = local(ctx.now, ctx.tz).toISODate()!;
  const fromDay = DateTime.fromISO(i.date ?? today, { zone: ctx.tz }).startOf("day");
  const toDay = DateTime.fromISO(i.to_date ?? i.date ?? today, { zone: ctx.tz }).endOf("day");
  if (toDay < fromDay || toDay.diff(fromDay, "days").days > 32) throw new ToolError("Choose an end date on or after the start date, at most 31 days later.");
  const s = sees(ctx.auth);
  const rows = await ctx.db
    .select({
      id: classSessions.id,
      name: classTypes.name,
      kind: classTypes.kind,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      tz: locations.timezone,
      location: locations.name,
      room: rooms.name,
      status: classSessions.status,
      capacity: classSessions.capacity,
      instructorId: classSessions.instructorId,
      waitlistEnabled: classSessions.waitlistEnabled,
      autoCancelHours: classSessions.autoCancelHours,
      autoCancelMin: classSessions.autoCancelMin,
      booked: sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed')`,
      waiting: sql<number>`(select count(*)::int from waitlist_entries w where w.session_id = ${classSessions.id} and w.status in ('waiting', 'offered'))`,
      instructor: sql<string | null>`(select u.first_name || ' ' || u.last_name from users u where u.id = ${classSessions.instructorId})`,
    })
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(locations, eq(locations.id, classSessions.locationId))
    .leftJoin(rooms, eq(rooms.id, classSessions.roomId))
    .where(and(eq(classSessions.orgId, ctx.auth.orgId), gte(classSessions.startsAt, fromDay.toJSDate()), lt(classSessions.startsAt, toDay.toJSDate()), i.name ? ilike(classTypes.name, like(i.name)) : undefined, s.fullSchedule ? undefined : eq(classSessions.instructorId, ctx.auth.userId)))
    .orderBy(asc(classSessions.startsAt))
    .limit(60);
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.auth.orgId));
  const list = rows.filter((r) => !i.time || local(r.startsAt, r.tz).toFormat("HH:mm") === i.time).slice(0, 15);
  return {
    classes: list.map((r) => ({
      id: r.id,
      name: r.kind === "appointment" ? `${r.name} (appointment)` : r.name,
      when: when(r.startsAt, r.tz),
      ends: local(r.endsAt, r.tz).toFormat("h:mma").toLowerCase(),
      status: r.status === "cancelled" ? "cancelled" : r.endsAt < ctx.now ? "finished" : "scheduled",
      instructor: r.instructor ?? "No instructor yet",
      place: [r.room, r.location].filter(Boolean).join(", "),
      spots: r.capacity,
      booked: r.booked,
      waiting: r.waitlistEnabled ? r.waiting : "no waitlist",
      bookingOpens: when(local(r.startsAt, r.tz).startOf("day").minus({ days: org!.bookingOpensDaysBefore }).toJSDate(), r.tz),
      bookingCloses: when(new Date(r.startsAt.getTime() - org!.bookingClosesMinutesBefore * 60_000), r.tz),
      autoCancel: r.autoCancelHours ? `Cancels automatically if fewer than ${r.autoCancelMin} are booked ${r.autoCancelHours} hours before.` : null,
    })),
    ...(rows.length > list.length && !i.time ? { note: "More classes match; narrow it down by time or name." } : {}),
    ...(!s.fullSchedule ? { note: "Instructors only see their own classes." } : {}),
  };
}

async function checkBooking(ctx: ToolCtx, i: z.infer<typeof inputs.check_booking>) {
  const client = await assertClient(ctx, i.client_id);
  const cls = await assertClass(ctx, i.class_id);
  const attempt = (auth: AuthContext) => dryRun(ctx.db, (tx, flags) => createBooking(tx, auth, { sessionId: i.class_id, clientId: i.client_id, notifyClient: false }, flags, ctx.now, { silent: true }));
  const mine = forRole(ctx.auth, await attempt(ctx.auth));
  const out: Record<string, unknown> = { client, class: cls.label, forThisPerson: mine };
  // Not allowed to book clients in at all? Also say what an admin would run into, so the answer is useful.
  if (mine.result === "blocked" && mine.code === "forbidden") out.ifAnAdminBooksIt = forRole(ctx.auth, await attempt({ ...ctx.auth, role: "admin" }));
  return out;
}

async function clientBookings(ctx: ToolCtx, i: z.infer<typeof inputs.client_bookings>) {
  const client = await assertClient(ctx, i.client_id);
  const own = sees(ctx.auth).rosters ? undefined : eq(classSessions.instructorId, ctx.auth.userId);
  const base = ctx.db
    .select({ startsAt: classSessions.startsAt, tz: locations.timezone, name: classTypes.name, status: bookings.status, attendance: bookings.attendance })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(locations, eq(locations.id, classSessions.locationId));
  const upcoming = await base.where(and(eq(bookings.orgId, ctx.auth.orgId), eq(bookings.clientId, i.client_id), gte(classSessions.startsAt, ctx.now), own)).orderBy(asc(classSessions.startsAt)).limit(15);
  const past = await ctx.db
    .select({ startsAt: classSessions.startsAt, tz: locations.timezone, name: classTypes.name, status: bookings.status, attendance: bookings.attendance })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(locations, eq(locations.id, classSessions.locationId))
    .where(and(eq(bookings.orgId, ctx.auth.orgId), eq(bookings.clientId, i.client_id), lt(classSessions.startsAt, ctx.now), own))
    .orderBy(desc(classSessions.startsAt))
    .limit(5);
  const waits = await ctx.db
    .select({ startsAt: classSessions.startsAt, tz: locations.timezone, name: classTypes.name, status: waitlistEntries.status })
    .from(waitlistEntries)
    .innerJoin(classSessions, eq(classSessions.id, waitlistEntries.sessionId))
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(locations, eq(locations.id, classSessions.locationId))
    .where(and(eq(waitlistEntries.orgId, ctx.auth.orgId), eq(waitlistEntries.clientId, i.client_id), inArray(waitlistEntries.status, ["waiting", "offered"]), gte(classSessions.startsAt, ctx.now), own));
  const status = (s: string) => ({ confirmed: "booked", cancelled: "cancelled", late_cancelled: "cancelled late" })[s] ?? s;
  return {
    client,
    upcoming: upcoming.map((b) => ({ class: `${b.name}, ${when(b.startsAt, b.tz)}`, status: status(b.status) })),
    waitlists: waits.map((w) => ({ class: `${w.name}, ${when(w.startsAt, w.tz)}`, status: w.status === "offered" ? "a spot is being held for them" : "waiting" })),
    recent: past.map((b) => ({ class: `${b.name}, ${when(b.startsAt, b.tz)}`, status: b.status === "confirmed" ? (b.attendance === "present" ? "attended" : b.attendance === "no_show" ? "no-show" : "booked") : status(b.status) })),
  };
}

async function studioRules(ctx: ToolCtx) {
  const [o] = await ctx.db.select().from(organizations).where(eq(organizations.id, ctx.auth.orgId));
  const fee = (on: boolean, cents: number) => (on ? `${(cents / 100).toFixed(2)} ${o!.currency}` : "none");
  return {
    bookingOpens: `${o!.bookingOpensDaysBefore} days before the class, at midnight`,
    bookingCloses: `${o!.bookingClosesMinutesBefore} minutes before the class starts (clients only; owners and admins can still book people in)`,
    lateCancellation: `Cancelling less than ${o!.lateCancelWindowHours} hours before counts as late: the class isn't given back to the package.`,
    lateCancelFee: fee(o!.lateCancelFeeEnabled, o!.lateCancelFeeCents),
    noShowFee: fee(o!.noShowFeeEnabled, o!.noShowFeeCents),
    weeklyLimit: o!.weeklyBookingLimit ? `${o!.weeklyBookingLimit} classes a week per client` : "none",
    clientsNeedPackage: o!.clientsNeedPackage ? "Yes: clients need a package that covers the class to book it themselves." : "No: clients can book and pay at the studio.",
    staffCanBookWithoutPackage: o!.allowBookingWithoutPackage ? "Yes, after a warning (it shows as Pay at studio)." : "No: a package (or a complimentary booking) is always needed.",
    waivers: o!.waiverRequired ? "Studio members sign a waiver at their first booking." : "Off",
    waitlistHold: `When a spot opens on a manual waitlist, it's held for ${o!.waitlistHoldMinutes} minutes.`,
    cover: o!.substituteApproval === "automatic" ? "The first instructor to accept a cover request gets the class." : "An admin chooses who covers from the instructors who offer.",
  };
}

async function offerAction(ctx: ToolCtx, i: z.infer<typeof inputs.offer_action>) {
  if (!ctx.allowActions) return { offered: false, reason: "Your studio has switched off the assistant doing things for people. Do it from the class on the Schedule instead." };
  if (!sees(ctx.auth).manager) return { offered: false, reason: `Only owners and admins can ${i.action === "cancel_booking" ? "cancel bookings" : "book clients in"}, so I can't do it for this person either.` };
  const client = await assertClient(ctx, i.client_id);
  const cls = await assertClass(ctx, i.class_id);
  let outcome: Outcome;
  let summary: string;
  if (i.action === "book_client") {
    outcome = await dryRun(ctx.db, (tx, flags) => createBooking(tx, ctx.auth, { sessionId: i.class_id, clientId: i.client_id, notifyClient: false }, flags, ctx.now, { silent: true }));
    summary = `Book ${client} into ${cls.label}`;
    if (outcome.result !== "blocked" && outcome.warnings.some((w) => w.code === "no_package")) {
      return { offered: false, reason: `${client} has no package that covers this class, so booking them would mean paying at the studio. That's a payment decision, so book it yourself from the class (or sell them a package first).` };
    }
  } else if (i.action === "join_waitlist") {
    outcome = await dryRun(ctx.db, (tx, flags) => joinWaitlist(tx, ctx.auth, { sessionId: i.class_id, clientId: i.client_id, mode: "automatic", expiresHoursBeforeStart: null }, flags, ctx.now));
    summary = `Add ${client} to the waitlist for ${cls.label}`;
  } else {
    const [b] = await ctx.db.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.orgId, ctx.auth.orgId), eq(bookings.sessionId, i.class_id), eq(bookings.clientId, i.client_id), eq(bookings.status, "confirmed")));
    if (!b) return { offered: false, reason: `${client} isn't booked into ${cls.label}.` };
    outcome = await dryRun(ctx.db, (tx, flags) => cancelBooking(tx, ctx.auth, b.id, { notifyClient: true }, flags, ctx.now));
    summary = `Cancel ${client}'s booking for ${cls.label} (their class goes back to their package)`;
    if (outcome.result !== "blocked" && outcome.notes.some((n) => /late-cancellation window/.test(n))) {
      return { offered: false, reason: "That would be a late cancellation, which affects their package and maybe a fee. Cancel it yourself from the class so you can choose what happens." };
    }
  }
  if (outcome.result === "blocked") return { offered: false, reason: forRole(ctx.auth, outcome).result === "blocked" ? (forRole(ctx.auth, outcome) as { reason: string }).reason : outcome.reason };
  const [a] = await ctx.db
    .insert(assistantActions)
    .values({ orgId: ctx.auth.orgId, chatId: ctx.chatId, userId: ctx.auth.userId, type: i.action, input: { clientId: i.client_id, classId: i.class_id }, summary, expiresAt: new Date(ctx.now.getTime() + 15 * 60_000) })
    .returning();
  return { offered: true, actionId: a!.id, summary, needsConfirming: outcome.warnings.map((w) => w.message), note: "The person now sees a Confirm button. It's not done until they press it." };
}

/** Run one tool call. Errors come back as text the model can explain, never as a crash. */
export async function runTool(ctx: ToolCtx, name: string, raw: unknown): Promise<{ content: string; isError: boolean; actionId?: string }> {
  const schema = inputs[name as ToolName];
  if (!schema) return { content: `There's no tool called ${name}.`, isError: true };
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) return { content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`, isError: true };
  try {
    const i = parsed.data as never;
    const out =
      name === "find_clients" ? await findClients(ctx, i)
      : name === "find_classes" ? await findClasses(ctx, i)
      : name === "check_booking" ? await checkBooking(ctx, i)
      : name === "client_bookings" ? await clientBookings(ctx, i)
      : name === "studio_rules" ? await studioRules(ctx)
      : await offerAction(ctx, i);
    return { content: JSON.stringify(out), isError: false, actionId: (out as { actionId?: string }).actionId };
  } catch (e) {
    if (e instanceof ToolError || e instanceof AppError) return { content: e.message, isError: true };
    throw e;
  }
}

/** What this person's role can do, in plain words, for the assistant's instructions. */
export function roleSummary(role: AuthContext["role"]) {
  const yes: string[] = [], no: string[] = [];
  const add = (ok: boolean, text: string) => (ok ? yes : no).push(text);
  add(can(role, "viewFullSchedule"), "see the whole schedule (otherwise only their own classes)");
  add(can(role, "manageBookings"), "book, cancel, move and refund bookings for clients");
  add(can(role, "viewClientDetails"), "see client profiles, history, packages and fees");
  add(can(role, "editSchedule"), "create, change and cancel classes");
  add(can(role, "managePackages"), "set up and sell packages");
  add(can(role, "manageSettings"), "change studio rules and settings");
  add(can(role, "manageStaff"), "add and remove staff");
  add(can(role, "managePayroll"), "see and manage pay");
  return { label: OPTION_LABELS.role[role], can: yes, cannot: no };
}
