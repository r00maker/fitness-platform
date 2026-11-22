/**
 * The client app's Home: progress towards the next class milestone, a monthly goal the client
 * sets, achievements, and the one celebration to show when they open the app.
 *
 *  - A class counts once it has finished and wasn't a no-show (studios that don't take attendance
 *    still see progress). Cancelled classes never count.
 *  - Goals are per month and carry on into later months until changed.
 *  - Celebrations show once (seen is stored), only for things that happened in the last 3 weeks,
 *    and only the most important one at a time.
 *  - Everything is worked out from bookings when asked, so nothing has to run overnight.
 */
import { and, asc, desc, eq, lte, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { resolveAppTheme, planHasApp, type AppTheme } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, clientCelebrations, clientGoals, organizations } from "../../db/schema.js";
import { zoneFor, type TZ } from "../../lib/time.js";
import type { AuthContext } from "../../plugins/auth.js";
import { settingsFor } from "../sales/invoices.js";
import { getOrg } from "../sessions/context.js";

type Org = typeof organizations.$inferSelect;
const RECENT_DAYS = 21;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

/** The look a studio's app uses (its own with the branded app, otherwise the plain one in its colour). */
export async function themeFor(db: DbOrTx, org: Org): Promise<AppTheme> {
  const accent = org.bookingAccent ?? (await settingsFor(db, org.id)).accentColor ?? null;
  return resolveAppTheme(org.appTheme, { hasApp: planHasApp(org.plan, org.brandedApp), accent });
}

/** Classes that count: finished, not a no-show, not cancelled. Oldest first. */
async function doneClasses(db: DbOrTx, orgId: string, userId: string, now: Date) {
  return db
    .select({ startsAt: classSessions.startsAt, classTypeId: classSessions.classTypeId })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.orgId, orgId), eq(bookings.clientId, userId), eq(bookings.status, "confirmed"), ne(bookings.attendance, "no_show"), ne(classSessions.status, "cancelled"), lte(classSessions.endsAt, now)))
    .orderBy(asc(classSessions.startsAt));
}

async function goalsOf(db: DbOrTx, orgId: string, userId: string) {
  return db.select({ month: clientGoals.month, classes: clientGoals.classes }).from(clientGoals).where(and(eq(clientGoals.orgId, orgId), eq(clientGoals.userId, userId))).orderBy(desc(clientGoals.month));
}
const goalFor = (goals: { month: string; classes: number }[], month: string) => goals.find((g) => g.month <= month)?.classes ?? null;

interface Badge { key: string; title: string; detail: string; earned: boolean; earnedOn: string | null; progress: { have: number; need: number } | null }

export async function myProgress(db: DbOrTx, auth: AuthContext, now = new Date()) {
  const org = await getOrg(db, auth.orgId);
  const zone: TZ = zoneFor(org.timezone, org.observesDaylightSaving);
  const theme = await themeFor(db, org);
  const done = await doneClasses(db, org.id, auth.userId, now);
  const local = (d: Date) => DateTime.fromJSDate(d, { zone });
  const today = local(now);
  const month = today.toFormat("yyyy-LL");
  const total = done.length;
  const dateOf = (i: number) => local(done[i]!.startsAt).toISODate()!; // the (i+1)th class

  // --- Milestones
  const reached = theme.milestones.filter((m) => m <= total);
  const next = theme.milestones.find((m) => m > total) ?? null;
  const previous = reached.at(-1) ?? 0;

  // --- This month: classes done, and classes booked for the rest of it
  const monthStart = today.startOf("month").toJSDate();
  const monthEnd = today.endOf("month").toJSDate();
  const doneThisMonth = done.filter((c) => c.startsAt >= monthStart).length;
  const [booked] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.orgId, org.id), eq(bookings.clientId, auth.userId), eq(bookings.status, "confirmed"), ne(classSessions.status, "cancelled"), sql`${classSessions.endsAt} > ${now}`, sql`${classSessions.startsAt} <= ${monthEnd}`));
  const goals = await goalsOf(db, org.id, auth.userId);
  const goal = goalFor(goals, month);

  // Months the goal was met (for the achievement), counting this month once it's met.
  const perMonth = new Map<string, number>();
  for (const c of done) perMonth.set(local(c.startsAt).toFormat("yyyy-LL"), (perMonth.get(local(c.startsAt).toFormat("yyyy-LL")) ?? 0) + 1);
  const metMonths = [...perMonth.entries()].filter(([m, n]) => { const g = goalFor(goals, m); return g !== null && n >= g; }).map(([m]) => m).sort();

  // --- Weeks in a row with at least one class (Monday to Sunday)
  const weeks = [...new Set(done.map((c) => local(c.startsAt).startOf("week").toISODate()!))].sort();
  let best = 0, run = 0, prev: DateTime | null = null, streakEarnedOn: string | null = null;
  for (const w of weeks) {
    const d = DateTime.fromISO(w, { zone });
    run = prev && Math.round(d.diff(prev, "weeks").weeks) === 1 ? run + 1 : 1;
    if (run >= 4 && !streakEarnedOn) streakEarnedOn = d.toISODate();
    best = Math.max(best, run);
    prev = d;
  }
  const thisWeek = today.startOf("week");
  const lastWeekDone = weeks.at(-1);
  // The current run: still alive if the last class was this week or last week.
  const current = lastWeekDone && thisWeek.diff(DateTime.fromISO(lastWeekDone, { zone }), "weeks").weeks <= 1 ? run : 0;

  // --- Achievements
  const early = done.map((c, i) => ({ i, hour: local(c.startsAt).hour })).filter((x) => x.hour < 8);
  const typesSeen: { id: string; i: number }[] = [];
  done.forEach((c, i) => { if (!typesSeen.some((t) => t.id === c.classTypeId)) typesSeen.push({ id: c.classTypeId, i }); });
  const badges: Badge[] = [
    { key: "first", title: "First class", detail: "You came to your first class.", earned: total >= 1, earnedOn: total >= 1 ? dateOf(0) : null, progress: null },
    ...theme.milestones.map((m) => ({ key: `classes_${m}`, title: `${m} classes`, detail: `Your ${ordinal(m)} class with us.`, earned: total >= m, earnedOn: total >= m ? dateOf(m - 1) : null, progress: total >= m ? null : { have: total, need: m } })),
    { key: "goal", title: "Goal met", detail: metMonths.length ? `You met your monthly goal ${metMonths.length === 1 ? "once" : `${metMonths.length} times`}.` : "Meet the goal you set for a month.", earned: metMonths.length > 0, earnedOn: metMonths[0] ? DateTime.fromFormat(metMonths[0], "yyyy-LL", { zone }).endOf("month").toISODate() : null, progress: null },
    { key: "streak", title: "Four weeks running", detail: "A class every week for four weeks.", earned: best >= 4, earnedOn: streakEarnedOn, progress: best >= 4 ? null : { have: current, need: 4 } },
    { key: "early", title: "Early riser", detail: "Five classes before 8am.", earned: early.length >= 5, earnedOn: early.length >= 5 ? dateOf(early[4]!.i) : null, progress: early.length >= 5 ? null : { have: early.length, need: 5 } },
    { key: "explorer", title: "Explorer", detail: "Three different kinds of class.", earned: typesSeen.length >= 3, earnedOn: typesSeen.length >= 3 ? dateOf(typesSeen[2]!.i) : null, progress: typesSeen.length >= 3 ? null : { have: typesSeen.length, need: 3 } },
  ];

  // --- The one celebration to show now (most important first), if it's recent and not seen yet
  const seen = new Set((await db.select({ key: clientCelebrations.key }).from(clientCelebrations).where(and(eq(clientCelebrations.orgId, org.id), eq(clientCelebrations.userId, auth.userId)))).map((r) => r.key));
  const recent = (iso: string | null) => !!iso && today.diff(DateTime.fromISO(iso, { zone }), "days").days <= RECENT_DAYS;
  const candidates: { key: string; kind: "milestone" | "goal" | "badge"; title: string; message: string; number: number | null }[] = [];
  if (previous && recent(dateOf(previous - 1))) {
    candidates.push({ key: `milestone:${previous}`, kind: "milestone", number: previous, title: `${previous} classes`, message: next ? `That's your ${ordinal(previous)} class with ${org.name}. Next stop: ${next}.` : `That's your ${ordinal(previous)} class with ${org.name}.` });
  }
  if (goal && doneThisMonth >= goal) {
    candidates.push({ key: `goal:${month}`, kind: "goal", number: doneThisMonth, title: "Goal met", message: `${plural(doneThisMonth, "class", "classes")} this month: you set ${goal} and you did it.` });
  }
  // "First class" only matters until the first milestone; after that the milestones say more.
  for (const b of badges.filter((b) => b.earned && ["streak", "early", "explorer", ...(previous ? [] : ["first"])].includes(b.key) && recent(b.earnedOn))) {
    candidates.push({ key: `badge:${b.key}`, kind: "badge", number: null, title: b.title, message: b.detail });
  }
  const celebration = candidates.find((c) => !seen.has(c.key)) ?? null;

  // --- A gentle nudge for Home (not a pop-up)
  const goalLeft = goal ? Math.max(0, goal - doneThisMonth) : null;
  const nudge =
    goal && goalLeft! > 0
      ? `${plural(goalLeft!, "more class", "more classes")} to reach your goal of ${goal} this month${booked!.n ? `, and you've ${plural(booked!.n, "class", "classes")} booked` : ""}.`
      : next
        ? `${plural(next - total, "class", "classes")} to your ${ordinal(next)}.`
        : null;

  return {
    classes: total,
    milestones: theme.milestones,
    milestone: { previous, next, toGo: next ? next - total : 0, progress: next ? (total - previous) / (next - previous) : 1 },
    month: { month, label: today.toFormat("LLLL"), done: doneThisMonth, booked: booked!.n, goal, daysLeft: Math.ceil(today.endOf("month").diff(today, "days").days) },
    streak: { weeks: current, best },
    achievements: badges,
    celebration,
    nudge,
  };
}

/** Set (or clear) the monthly goal from this month on. */
export async function setGoal(db: DbOrTx, auth: AuthContext, classes: number | null, now = new Date()) {
  const org = await getOrg(db, auth.orgId);
  const month = DateTime.fromJSDate(now, { zone: zoneFor(org.timezone, org.observesDaylightSaving) }).toFormat("yyyy-LL");
  if (classes === null) {
    await db.delete(clientGoals).where(and(eq(clientGoals.orgId, org.id), eq(clientGoals.userId, auth.userId), sql`${clientGoals.month} >= ${month}`));
  } else {
    await db.insert(clientGoals).values({ orgId: org.id, userId: auth.userId, month, classes }).onConflictDoUpdate({ target: [clientGoals.orgId, clientGoals.userId, clientGoals.month], set: { classes, updatedAt: now } });
  }
  return myProgress(db, auth, now);
}

export async function markSeen(db: DbOrTx, auth: AuthContext, key: string) {
  await db.insert(clientCelebrations).values({ orgId: auth.orgId, userId: auth.userId, key }).onConflictDoNothing();
}

