/**
 * The studio's front page: what matters today, at one glance.
 *
 *  - Today: the hero number (people booked today), how full today's classes are, the next class,
 *    and every class today with what needs doing (no instructor, waivers, attendance to take).
 *  - Needs attention: a short to-do list, most urgent first, each with where to go to sort it.
 *    Only things the person can act on (Front of House never sees fees; instructors see their own).
 *  - How it's going: bookings made, how full classes were, new clients and (for those who can see
 *    reports) money in, for the last 7 or 30 days against the period before, with a daily trend.
 *    These use the same sums as Reports, so the two pages always agree.
 *  - The week ahead: how full the next 7 days are, and closures coming up.
 *
 * Clients don't have a dashboard: their front page is "Book a class".
 */
import { and, asc, count, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql, sum } from "drizzle-orm";
import { LOW_REVIEW_STARS, can } from "@studio/shared";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, conversations, feedback, fees, locations, orders, packageExtensionRequests, reviews, rooms, substituteRequests, users } from "../../db/schema.js";
import { forbidden } from "../../lib/errors.js";
import { localToUtc, shiftDate, utcToLocal, zoneFor } from "../../lib/time.js";
import type { AuthContext } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { waiverStatuses } from "../clients/waivers.js";
import { closuresInRange } from "../closures/service.js";
import { classStats, clientCounts, metric, pct, revenue } from "../reports/routes.js";
import { getOrg, locationZone } from "../sessions/context.js";
import { canSeeRequest } from "../substitutes/service.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const instructor = alias(users, "instructor");

export type Severity = "urgent" | "soon" | "fyi";
export interface AttentionItem {
  kind: string;
  severity: Severity;
  count: number;
  title: string;
  detail: string;
  /** Where to go to sort it: a page in the app, and optionally a class to open. */
  action: { label: string; page: string; sessionId?: string };
}
const SEVERITY_ORDER: Record<Severity, number> = { urgent: 0, soon: 1, fyi: 2 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function getDashboard(db: DbOrTx, auth: AuthContext, q: { days: 7 | 30; locationId?: string }, now = new Date()) {
  if (auth.role === "client") throw forbidden("The dashboard is for studio staff.");
  const org = await getOrg(db, auth.orgId);
  const zone = q.locationId ? await locationZone(db, auth.orgId, q.locationId) : zoneFor(org.timezone, org.observesDaylightSaving);
  const tz = org.timezone;
  const today = utcToLocal(now, zone).date;
  const dayStart = (d: string) => localToUtc(d, "00:00", zone);
  // Instructors (and anyone without the full schedule) see their own classes only.
  const ownOnly = !can(auth.role, "viewFullSchedule");
  const sessionScope = and(
    eq(classSessions.orgId, auth.orgId),
    q.locationId ? eq(classSessions.locationId, q.locationId) : undefined,
    ownOnly ? eq(classSessions.instructorId, auth.userId) : undefined,
  );

  // --- Today ---------------------------------------------------------------------------
  const booked = sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed')`;
  const unmarked = sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed' and b.attendance = 'unmarked')`;
  const present = sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed' and b.attendance = 'present')`;
  const waiting = sql<number>`(select count(*)::int from waitlist_entries w where w.session_id = ${classSessions.id} and w.status in ('waiting','offered'))`;
  const todays = await db
    .select({
      id: classSessions.id, startsAt: classSessions.startsAt, endsAt: classSessions.endsAt, capacity: classSessions.capacity,
      className: classTypes.name, color: classTypes.color, kind: classTypes.kind, locationName: locations.name, roomName: rooms.name,
      instructorId: classSessions.instructorId, instructorFirst: instructor.firstName, instructorLast: instructor.lastName,
      autoCancelMin: classSessions.autoCancelMin, autoCancelHours: classSessions.autoCancelHours,
      booked, unmarked, present, waiting,
    })
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .innerJoin(locations, eq(locations.id, classSessions.locationId))
    .leftJoin(rooms, eq(rooms.id, classSessions.roomId))
    .leftJoin(instructor, eq(instructor.id, classSessions.instructorId))
    .where(and(sessionScope, eq(classSessions.status, "scheduled"), gte(classSessions.startsAt, dayStart(today)), lt(classSessions.startsAt, dayStart(shiftDate(today, 1)))))
    .orderBy(asc(classSessions.startsAt));

  // Waivers missing among people booked today (only matters if the studio needs them).
  const seesRosters = can(auth.role, "viewAllRosters") || ownOnly;
  const todayBookings = todays.length && seesRosters
    ? await db.select({ sessionId: bookings.sessionId, clientId: bookings.clientId }).from(bookings).where(and(inArray(bookings.sessionId, todays.map((s) => s.id)), eq(bookings.status, "confirmed")))
    : [];
  const waivers = await waiverStatuses(db, org, [...new Set(todayBookings.map((b) => b.clientId))]);
  const noWaiver = (sid: string) => todayBookings.filter((b) => b.sessionId === sid && waivers.get(b.clientId)?.status === "missing").length;

  const classes = todays.map((s) => {
    const state = now >= s.endsAt ? "finished" : now >= s.startsAt ? "on_now" : "upcoming";
    const attendanceOpen = now.getTime() >= s.startsAt.getTime() - HOUR;
    return {
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      localTime: utcToLocal(s.startsAt, zone).time,
      localEndTime: utcToLocal(s.endsAt, zone).time,
      className: s.className,
      color: s.color,
      isAppointment: s.kind === "appointment",
      where: s.roomName ? `${s.roomName}, ${s.locationName}` : s.locationName,
      instructor: s.instructorId ? { id: s.instructorId, name: `${s.instructorFirst} ${s.instructorLast}` } : null,
      booked: s.booked,
      capacity: s.capacity,
      waitlist: s.waiting,
      attended: s.present,
      state,
      /** Small, specific things to do for this class. */
      todo: [
        ...(!s.instructorId ? [{ kind: "no_instructor", text: "No instructor" }] : []),
        ...(seesRosters && state !== "finished" && noWaiver(s.id) ? [{ kind: "waiver_missing", text: `${plural(noWaiver(s.id), "waiver")} missing` }] : []),
        ...(seesRosters && attendanceOpen && s.unmarked && s.booked ? [{ kind: "attendance", text: state === "finished" ? `Attendance not taken (${s.unmarked})` : "Take attendance" }] : []),
      ],
    };
  });
  const totalBooked = classes.reduce((a, c) => a + c.booked, 0);
  const totalCapacity = classes.reduce((a, c) => a + c.capacity, 0);
  const next = classes.find((c) => c.state === "on_now") ?? classes.find((c) => c.state === "upcoming") ?? null;

  // --- Needs attention -----------------------------------------------------------------
  const attention: AttentionItem[] = [];
  const in48 = new Date(now.getTime() + 48 * HOUR);
  const in7d = new Date(now.getTime() + 7 * DAY);

  // Cover: admins see every open request; instructors see the ones they've been asked to cover.
  const cover = await db
    .select({ r: substituteRequests, startsAt: classSessions.startsAt })
    .from(substituteRequests)
    .innerJoin(classSessions, eq(classSessions.id, substituteRequests.sessionId))
    .where(and(eq(substituteRequests.orgId, auth.orgId), inArray(substituteRequests.status, ["open", "awaiting_approval"]), gt(classSessions.startsAt, now), q.locationId ? eq(classSessions.locationId, q.locationId) : undefined));
  if (can(auth.role, "manageCover")) {
    if (cover.length) {
      const soon = cover.filter((c) => c.startsAt < in48).length;
      const waitingApproval = cover.filter((c) => c.r.status === "awaiting_approval").length;
      attention.push({ kind: "cover", severity: soon ? "urgent" : "soon", count: cover.length, title: `${plural(cover.length, "class needs", "classes need")} cover`, detail: [soon ? `${soon} in the next 2 days` : "", waitingApproval ? `${waitingApproval} waiting for your OK` : ""].filter(Boolean).join(" · ") || "Nobody has taken it yet", action: { label: "Open cover requests", page: "cover" } });
    }
  } else if (auth.role === "instructor") {
    const forMe = cover.filter((c) => c.r.status === "open" && canSeeRequest(c.r, auth.userId));
    if (forMe.length) attention.push({ kind: "cover", severity: "soon", count: forMe.length, title: `${plural(forMe.length, "cover request")} for you`, detail: "Say yes or no so the studio knows", action: { label: "Open cover requests", page: "cover" } });
  }

  if (can(auth.role, "editSchedule")) {
    const [{ n: noInstr } = { n: 0 }] = await db.select({ n: count() }).from(classSessions).where(and(sessionScope, eq(classSessions.status, "scheduled"), isNull(classSessions.instructorId), gt(classSessions.startsAt, now), lt(classSessions.startsAt, in7d)));
    const [{ n: noInstrSoon } = { n: 0 }] = await db.select({ n: count() }).from(classSessions).where(and(sessionScope, eq(classSessions.status, "scheduled"), isNull(classSessions.instructorId), gt(classSessions.startsAt, now), lt(classSessions.startsAt, in48)));
    if (noInstr) attention.push({ kind: "no_instructor", severity: noInstrSoon ? "urgent" : "soon", count: noInstr, title: `${plural(noInstr, "class has", "classes have")} no instructor`, detail: noInstrSoon ? `${noInstrSoon} in the next 2 days` : "In the next 7 days", action: { label: "See the schedule", page: "schedule" } });

    // Classes that will cancel themselves unless more people book (cut-off in the next 24 hours).
    const risky = await db
      .select({ id: classSessions.id, startsAt: classSessions.startsAt, min: classSessions.autoCancelMin, hours: classSessions.autoCancelHours, booked })
      .from(classSessions)
      .where(and(sessionScope, eq(classSessions.status, "scheduled"), isNull(classSessions.autoCancelCheckedAt), sql`${classSessions.autoCancelMin} is not null`, gt(classSessions.startsAt, now), lt(classSessions.startsAt, new Date(now.getTime() + 72 * HOUR))));
    const atRisk = risky.filter((r) => r.booked < (r.min ?? 0) && r.startsAt.getTime() - (r.hours ?? 0) * HOUR < now.getTime() + 24 * HOUR);
    if (atRisk.length) attention.push({ kind: "may_auto_cancel", severity: "soon", count: atRisk.length, title: `${plural(atRisk.length, "class", "classes")} may cancel automatically`, detail: "Fewer people booked than the minimum, with the cut-off in the next 24 hours", action: { label: atRisk.length === 1 ? "Open the class" : "See the schedule", page: "schedule", ...(atRisk.length === 1 ? { sessionId: atRisk[0]!.id } : {}) } });
  }

  if (seesRosters && org.waiverRequired) {
    const coming = await db
      .select({ clientId: bookings.clientId })
      .from(bookings)
      .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
      .where(and(sessionScope, eq(bookings.status, "confirmed"), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, now), lt(classSessions.startsAt, in48)));
    const ids = [...new Set(coming.map((c) => c.clientId))];
    const missing = [...(await waiverStatuses(db, org, ids)).values()].filter((w) => w.status === "missing").length;
    if (missing) attention.push({ kind: "waivers", severity: "urgent", count: missing, title: `${plural(missing, "client", "clients")} coming soon without a waiver`, detail: "Booked in the next 2 days. Ask them to sign before class, or mark a paper waiver as done", action: { label: "See today's classes", page: "schedule" } });
  }

  if (seesRosters) {
    // Attendance still to take for classes that finished in the last 24 hours.
    const since = new Date(now.getTime() - 24 * HOUR);
    const [{ n: toMark } = { n: 0 }] = await db
      .select({ n: sql<number>`count(distinct ${classSessions.id})::int` })
      .from(classSessions)
      .innerJoin(bookings, eq(bookings.sessionId, classSessions.id))
      .where(and(sessionScope, eq(classSessions.status, "scheduled"), gte(classSessions.endsAt, since), lt(classSessions.endsAt, now), eq(bookings.status, "confirmed"), eq(bookings.attendance, "unmarked")));
    if (toMark) attention.push({ kind: "attendance", severity: "soon", count: toMark, title: `Attendance not taken for ${plural(toMark, "class", "classes")}`, detail: "Finished in the last 24 hours. Pay and no-show fees depend on it", action: { label: "See the schedule", page: "schedule" } });
  }

  if (can(auth.role, "viewClientDetails")) {
    const [f] = await db.select({ n: count(), total: sum(fees.amountCents) }).from(fees).where(and(eq(fees.orgId, auth.orgId), eq(fees.status, "pending")));
    if (f && f.n) attention.push({ kind: "fees", severity: "fyi", count: f.n, title: `${plural(f.n, "fee")} to collect or waive`, detail: `${money(Number(f.total ?? 0), org.currency)} in late-cancellation and no-show fees`, action: { label: "Open fees", page: "fees" } });
  }
  if (can(auth.role, "managePackages")) {
    const [{ n: ext } = { n: 0 }] = await db.select({ n: count() }).from(packageExtensionRequests).where(and(eq(packageExtensionRequests.orgId, auth.orgId), eq(packageExtensionRequests.status, "pending")));
    const [{ n: toConfirm } = { n: 0 }] = await db.select({ n: count() }).from(orders).where(and(eq(orders.orgId, auth.orgId), eq(orders.kind, "package"), eq(orders.status, "pending")));
    if (ext || toConfirm) attention.push({ kind: "packages", severity: "soon", count: ext + toConfirm, title: [ext ? plural(ext, "extension request") : "", toConfirm ? plural(toConfirm, "order", "orders") + " to confirm" : ""].filter(Boolean).join(" and "), detail: toConfirm ? "Mark orders paid when clients pay at the desk, so their package starts" : "Clients are waiting for an answer", action: { label: "Open packages", page: "packages" } });
  }
  if (can(auth.role, "handOverOrders")) {
    const [{ n: pickups } = { n: 0 }] = await db.select({ n: count() }).from(orders).where(and(eq(orders.orgId, auth.orgId), eq(orders.kind, "product"), ne(orders.status, "cancelled"), isNull(orders.collectedAt)));
    if (pickups) attention.push({ kind: "pickups", severity: "fyi", count: pickups, title: `${plural(pickups, "shop order")} to hand over`, detail: "Waiting at the front desk", action: { label: auth.role === "front_desk" ? "Open pickups" : "Open the shop", page: auth.role === "front_desk" ? "pickups" : "shop" } });
  }
  if (can(auth.role, "useInbox")) {
    const [u] = await db.select({ chats: count(), unread: sum(conversations.unread) }).from(conversations).where(and(eq(conversations.orgId, auth.orgId), eq(conversations.status, "open"), gt(conversations.unread, 0)));
    if (u && u.chats) attention.push({ kind: "messages", severity: "fyi", count: Number(u.unread ?? 0), title: `${plural(Number(u.unread ?? 0), "unread message")}`, detail: `From ${plural(u.chats, "client", "clients")}`, action: { label: "Open Communication", page: "comms" } });
  }
  if (can(auth.role, "manageFeedback")) {
    const [{ n: newFb } = { n: 0 }] = await db.select({ n: count() }).from(feedback).where(and(eq(feedback.orgId, auth.orgId), eq(feedback.status, "new")));
    const [{ n: low } = { n: 0 }] = await db.select({ n: count() }).from(reviews).where(and(eq(reviews.orgId, auth.orgId), lte(reviews.rating, LOW_REVIEW_STARS), isNull(reviews.handledAt)));
    if (low) attention.push({ kind: "low_reviews", severity: "soon", count: low, title: `${plural(low, "low review")} to follow up`, detail: `${LOW_REVIEW_STARS} stars or fewer. A quick, kind reply often wins a client back`, action: { label: "Open Feedback", page: "feedback" } });
    if (newFb) attention.push({ kind: "feedback", severity: "fyi", count: newFb, title: `${plural(newFb, "new piece", "new pieces")} of feedback`, detail: "From clients, waiting for a reply", action: { label: "Open Feedback", page: "feedback" } });
  }
  attention.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // --- How it's going (last 7 or 30 days, against the period before) -------------------
  const days = q.days;
  const to = dayStart(shiftDate(today, 1));
  const from = new Date(to.getTime() - days * DAY);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const scope = { locationId: q.locationId, tz, ...(ownOnly ? { instructorId: auth.userId } : {}) };
  const madeIn = async (a: Date, b: Date) =>
    (await db.select({ n: count() }).from(bookings).innerJoin(classSessions, eq(classSessions.id, bookings.sessionId)).where(and(sessionScope, gte(bookings.createdAt, a), lt(bookings.createdAt, b), or(isNull(bookings.cancelledVia), ne(bookings.cancelledVia, "moved")))))[0]?.n ?? 0;
  // Bookings made per day (moves aren't new bookings).
  const perDay = await db.execute<{ d: string; n: string }>(sql`
    select to_char(b.created_at at time zone ${tz}, 'YYYY-MM-DD') as d, count(*) as n
    from bookings b join class_sessions cs on cs.id = b.session_id
    where b.org_id = ${auth.orgId} and b.created_at >= ${from} and b.created_at < ${to} and (b.cancelled_via is null or b.cancelled_via <> 'moved')
      ${q.locationId ? sql`and cs.location_id = ${q.locationId}` : sql``} ${ownOnly ? sql`and cs.instructor_id = ${auth.userId}` : sql``}
    group by 1`);
  const fillPerDay = await db.execute<{ d: string; booked: string; cap: string }>(sql`
    select to_char(cs.starts_at at time zone ${tz}, 'YYYY-MM-DD') as d, sum(cs.capacity) as cap,
      sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed')) as booked
    from class_sessions cs join class_types ct on ct.id = cs.class_type_id
    where cs.org_id = ${auth.orgId} and cs.status = 'scheduled' and ct.kind = 'class' and cs.starts_at >= ${from} and cs.starts_at < ${to} and cs.ends_at < ${now}
      ${q.locationId ? sql`and cs.location_id = ${q.locationId}` : sql``} ${ownOnly ? sql`and cs.instructor_id = ${auth.userId}` : sql``}
    group by 1`);
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, i - days + 1));
  const madeBy = new Map(perDay.rows.map((r) => [r.d, Number(r.n)]));
  const fillBy = new Map(fillPerDay.rows.map((r) => [r.d, pct(Number(r.booked), Number(r.cap))]));
  const [cur, prev] = [await classStats(db, auth.orgId, from, to, "class", scope), await classStats(db, auth.orgId, prevFrom, from, "class", scope)];
  const made = { cur: await madeIn(from, to), prev: await madeIn(prevFrom, from) };
  const kpis = [
    { ...metric({ key: "bookings", label: "Bookings made", value: made.cur, previous: made.prev, display: made.cur.toLocaleString("en"), explain: "New bookings in the period, made by clients or staff. A booking moved to another class counts once." }), trend: dates.map((d) => ({ date: d, value: madeBy.get(d) ?? 0 })) },
    { ...metric({ key: "fill", label: "How full classes were", value: pct(cur.booked, cur.capacity), previous: pct(prev.booked, prev.capacity), display: `${pct(cur.booked, cur.capacity)}%`, explain: "Spots booked out of spots available, for group classes that have finished.", isPercent: true }), trend: dates.map((d) => ({ date: d, value: fillBy.get(d) ?? null })) },
  ];
  if (!ownOnly) {
    const [cl, clPrev] = [await clientCounts(db, auth.orgId, from, to), await clientCounts(db, auth.orgId, prevFrom, from)];
    const joinedPerDay = await db.execute<{ d: string; n: string }>(sql`select to_char(created_at at time zone ${tz}, 'YYYY-MM-DD') as d, count(*) as n from memberships where org_id = ${auth.orgId} and role = 'client' and created_at >= ${from} and created_at < ${to} group by 1`);
    const joinedBy = new Map(joinedPerDay.rows.map((r) => [r.d, Number(r.n)]));
    kpis.push({ ...metric({ key: "new_clients", label: "New clients", value: cl.newClients, previous: clPrev.newClients, display: cl.newClients.toLocaleString("en"), explain: "People who joined the studio in the period. For the whole studio." }), trend: dates.map((d) => ({ date: d, value: joinedBy.get(d) ?? 0 })) });
  }
  if (can(auth.role, "viewReports")) {
    const [r, rPrev] = [await revenue(db, auth.orgId, from, to), await revenue(db, auth.orgId, prevFrom, from)];
    const moneyPerDay = await db.execute<{ d: string; n: string }>(sql`
      select d, sum(n) as n from (
        select to_char(purchased_at at time zone ${tz}, 'YYYY-MM-DD') as d, price_paid_cents as n from client_packages where org_id = ${auth.orgId} and purchased_at >= ${from} and purchased_at < ${to}
        union all select to_char(paid_at at time zone ${tz}, 'YYYY-MM-DD'), amount_cents from orders where org_id = ${auth.orgId} and kind = 'gift_card' and status = 'paid' and paid_at >= ${from} and paid_at < ${to}
        union all select to_char(created_at at time zone ${tz}, 'YYYY-MM-DD'), amount_cents from fees where org_id = ${auth.orgId} and status = 'charged' and created_at >= ${from} and created_at < ${to}
        union all select to_char(created_at at time zone ${tz}, 'YYYY-MM-DD'), -amount_cents from refunds where org_id = ${auth.orgId} and method = 'original_payment' and created_at >= ${from} and created_at < ${to} and amount_cents is not null
      ) x group by d`);
    const moneyBy = new Map(moneyPerDay.rows.map((x) => [x.d, Number(x.n)]));
    kpis.push({ ...metric({ key: "revenue", label: "Money in", value: r.nett, previous: rPrev.nett, display: money(r.nett, org.currency), explain: "Packages, gift cards and fees paid, minus money refunded. For the whole studio, the same as Reports." }), trend: dates.map((d) => ({ date: d, value: moneyBy.get(d) ?? 0 })) });
  }

  // --- The week ahead ------------------------------------------------------------------
  const ahead = await db.execute<{ d: string; classes: string; booked: string; cap: string; full: string }>(sql`
    select to_char(cs.starts_at at time zone ${tz}, 'YYYY-MM-DD') as d, count(*) as classes, sum(cs.capacity) as cap,
      sum(x.n) as booked, count(*) filter (where x.n >= cs.capacity) as full
    from class_sessions cs join class_types ct on ct.id = cs.class_type_id
      cross join lateral (select count(*) as n from bookings b where b.session_id = cs.id and b.status = 'confirmed') x
    where cs.org_id = ${auth.orgId} and cs.status = 'scheduled' and ct.kind = 'class' and cs.starts_at >= ${dayStart(today)} and cs.starts_at < ${dayStart(shiftDate(today, 7))}
      ${q.locationId ? sql`and cs.location_id = ${q.locationId}` : sql``} ${ownOnly ? sql`and cs.instructor_id = ${auth.userId}` : sql``}
    group by 1`);
  const aheadBy = new Map(ahead.rows.map((r) => [r.d, r]));
  const closed = await closuresInRange(db, auth.orgId, q.locationId, today, shiftDate(today, 30));
  const weekAhead = Array.from({ length: 7 }, (_, i) => {
    const d = shiftDate(today, i);
    const r = aheadBy.get(d);
    const cap = Number(r?.cap ?? 0), b = Number(r?.booked ?? 0);
    const closure = closed.find((c) => c.startDate <= d && c.endDate >= d);
    return { date: d, classes: Number(r?.classes ?? 0), booked: b, capacity: cap, fill: pct(b, cap), fullClasses: Number(r?.full ?? 0), closed: closure ? closure.name : null };
  });

  const first = (await db.select({ firstName: users.firstName }).from(users).where(eq(users.id, auth.userId)))[0]?.firstName ?? "";
  return {
    greeting: { firstName: first, partOfDay: partOfDay(Number(utcToLocal(now, zone).time.slice(0, 2))) },
    today: {
      date: today,
      classes: classes.length,
      booked: totalBooked,
      capacity: totalCapacity,
      fill: pct(totalBooked, totalCapacity),
      waitlisted: classes.reduce((a, c) => a + c.waitlist, 0),
      next,
      list: classes,
      text: classes.length ? `${plural(totalBooked, "person", "people")} booked into ${plural(classes.length, "class", "classes")} today` : ownOnly ? "You're not teaching today." : "No classes today.",
    },
    attention,
    allClear: attention.length === 0,
    period: { days, from: from.toISOString(), to: to.toISOString() },
    kpis,
    weekAhead,
    closures: closed,
    /** What this person's dashboard covers, so the app can say so. */
    scope: { ownClassesOnly: ownOnly, money: can(auth.role, "viewReports"), location: q.locationId ?? null },
  };
}

function partOfDay(h: number) {
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
