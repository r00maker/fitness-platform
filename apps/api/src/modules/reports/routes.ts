/**
 * Reports, written for studio owners rather than analysts.
 *
 * Five tabs, each answering one question:
 *  - Overview: how is the studio doing?
 *  - Sales: where does the money come from?
 *  - Classes: which classes fill up, and which don't?
 *  - Clients: are people coming back?
 *  - Conversion: are new people turning into paying clients?
 *
 * Every number comes with the same number for the period before (so "up 12%" means something),
 * whether that change is good or bad, and one plain sentence explaining what it means. Money is
 * "nett": packages, gift cards and fees paid, minus money refunded (studio credit isn't money in).
 * Group classes and appointments are kept apart so private sessions don't skew class numbers.
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { funnel } from "../marketing/ads.js";
import { getOrg } from "../sessions/context.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
const DAY = 86_400_000;
const query = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90, 365].includes(d), "Choose 7, 30, 90 or 365 days.").default(30) });
const section = z.object({ section: z.enum(["overview", "sales", "classes", "clients", "conversion"]) });

interface Period { from: Date; to: Date; prevFrom: Date; days: number }
const n = (v: unknown) => Number(v ?? 0);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

/** A headline number: this period, the one before, and what it means in plain words. */
function metric(o: { key: string; label: string; value: number; previous: number; display: string; explain: string; goodWhenUp?: boolean; isPercent?: boolean }) {
  const { value, previous } = o;
  let change: { text: string; direction: "up" | "down" | "flat"; good: boolean | null };
  if (o.isPercent) {
    const diff = Math.round((value - previous) * 10) / 10;
    change = { text: diff === 0 ? "Same as before" : `${diff > 0 ? "+" : ""}${diff} points`, direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat", good: diff === 0 ? null : (diff > 0) === (o.goodWhenUp ?? true) };
  } else if (!previous) {
    change = { text: value ? "New this period" : "None either period", direction: value ? "up" : "flat", good: value ? (o.goodWhenUp ?? true) : null };
  } else {
    const p = Math.round(((value - previous) / previous) * 100);
    change = { text: p === 0 ? "Same as before" : `${p > 0 ? "Up" : "Down"} ${Math.abs(p)}%`, direction: p > 0 ? "up" : p < 0 ? "down" : "flat", good: p === 0 ? null : (p > 0) === (o.goodWhenUp ?? true) };
  }
  return { key: o.key, label: o.label, value, previous, display: o.display, change, explain: o.explain };
}

// --- The numbers ---------------------------------------------------------------------
async function revenue(db: DbOrTx, orgId: string, from: Date, to: Date) {
  const r = await db.execute<{ packages: string; gift_cards: string; fees: string; refunds: string; sold: string }>(sql`
    select
      (select coalesce(sum(price_paid_cents), 0) from client_packages where org_id = ${orgId} and purchased_at >= ${from} and purchased_at < ${to}) as packages,
      (select count(*) from client_packages where org_id = ${orgId} and purchased_at >= ${from} and purchased_at < ${to} and price_paid_cents > 0) as sold,
      (select coalesce(sum(amount_cents), 0) from orders where org_id = ${orgId} and kind = 'gift_card' and status = 'paid' and paid_at >= ${from} and paid_at < ${to}) as gift_cards,
      (select coalesce(sum(amount_cents), 0) from fees where org_id = ${orgId} and status = 'charged' and created_at >= ${from} and created_at < ${to}) as fees,
      (select coalesce(sum(amount_cents), 0) from refunds where org_id = ${orgId} and method = 'original_payment' and created_at >= ${from} and created_at < ${to}) as refunds`);
  const x = r.rows[0]!;
  const gross = n(x.packages) + n(x.gift_cards) + n(x.fees);
  return { packages: n(x.packages), giftCards: n(x.gift_cards), fees: n(x.fees), refunds: n(x.refunds), sold: n(x.sold), nett: gross - n(x.refunds) };
}

async function classStats(db: DbOrTx, orgId: string, from: Date, to: Date, kind: "class" | "appointment" = "class") {
  const r = await db.execute<{ held: string; capacity: string; booked: string; present: string; no_show: string; cancelled: string; auto: string }>(sql`
    with s as (
      select cs.id, cs.capacity, cs.status, cs.auto_cancelled from class_sessions cs join class_types ct on ct.id = cs.class_type_id
      where cs.org_id = ${orgId} and cs.starts_at >= ${from} and cs.starts_at < ${to} and cs.ends_at < now() and ct.kind = ${kind}
    )
    select
      count(*) filter (where status = 'scheduled') as held,
      coalesce(sum(capacity) filter (where status = 'scheduled'), 0) as capacity,
      (select count(*) from bookings b join s on s.id = b.session_id where s.status = 'scheduled' and b.status = 'confirmed') as booked,
      (select count(*) from bookings b join s on s.id = b.session_id where s.status = 'scheduled' and b.status = 'confirmed' and b.attendance = 'present') as present,
      (select count(*) from bookings b join s on s.id = b.session_id where s.status = 'scheduled' and b.status = 'confirmed' and b.attendance = 'no_show') as no_show,
      count(*) filter (where status = 'cancelled') as cancelled,
      count(*) filter (where status = 'cancelled' and auto_cancelled) as auto
    from s`);
  const x = r.rows[0]!;
  return { held: n(x.held), capacity: n(x.capacity), booked: n(x.booked), present: n(x.present), noShow: n(x.no_show), cancelled: n(x.cancelled), autoCancelled: n(x.auto) };
}

async function clientCounts(db: DbOrTx, orgId: string, from: Date, to: Date) {
  const r = await db.execute<{ active: string; new_clients: string }>(sql`
    select
      (select count(distinct b.client_id) from bookings b join class_sessions cs on cs.id = b.session_id
        where b.org_id = ${orgId} and b.status = 'confirmed' and b.attendance = 'present' and cs.starts_at >= ${from} and cs.starts_at < ${to}) as active,
      (select count(*) from memberships where org_id = ${orgId} and role = 'client' and created_at >= ${from} and created_at < ${to}) as new_clients`);
  return { active: n(r.rows[0]!.active), newClients: n(r.rows[0]!.new_clients) };
}

/** Of the clients who came in the period before, how many came again this period. */
async function retention(db: DbOrTx, orgId: string, p: Period) {
  const r = await db.execute<{ before: string; kept: string }>(sql`
    with came as (
      select b.client_id, cs.starts_at from bookings b join class_sessions cs on cs.id = b.session_id
      where b.org_id = ${orgId} and b.status = 'confirmed' and b.attendance = 'present' and cs.starts_at >= ${p.prevFrom} and cs.starts_at < ${p.to}
    ), before as (select distinct client_id from came where starts_at < ${p.from}),
       now_ as (select distinct client_id from came where starts_at >= ${p.from})
    select (select count(*) from before) as before, (select count(*) from before where client_id in (select client_id from now_)) as kept`);
  return { before: n(r.rows[0]!.before), kept: n(r.rows[0]!.kept) };
}

/** First-timers in a window, and how many came back for a second class (within 30 days). */
async function secondVisits(db: DbOrTx, orgId: string, from: Date, to: Date) {
  const r = await db.execute<{ first_timers: string; returned: string }>(sql`
    with visits as (
      select b.client_id, cs.starts_at, row_number() over (partition by b.client_id order by cs.starts_at) as nth
      from bookings b join class_sessions cs on cs.id = b.session_id
      where b.org_id = ${orgId} and b.status = 'confirmed' and b.attendance = 'present'
    ), firsts as (select client_id, starts_at from visits where nth = 1 and starts_at >= ${from} and starts_at < ${to})
    select count(*) as first_timers,
      count(*) filter (where exists (select 1 from visits v where v.client_id = firsts.client_id and v.nth = 2 and v.starts_at <= firsts.starts_at + interval '30 days')) as returned
    from firsts`);
  return { firstTimers: n(r.rows[0]!.first_timers), returned: n(r.rows[0]!.returned) };
}

/** New clients who joined in a window, and how many bought a paid package. */
async function newToPaying(db: DbOrTx, orgId: string, from: Date, to: Date) {
  const r = await db.execute<{ joined: string; paid: string }>(sql`
    select count(*) as joined,
      count(*) filter (where exists (select 1 from client_packages cp where cp.org_id = m.org_id and cp.owner_id = m.user_id and cp.price_paid_cents > 0)) as paid
    from memberships m where m.org_id = ${orgId} and m.role = 'client' and m.created_at >= ${from} and m.created_at < ${to}`);
  return { joined: n(r.rows[0]!.joined), paid: n(r.rows[0]!.paid) };
}

// --- The tabs ------------------------------------------------------------------------
async function overview(db: DbOrTx, org: Org, p: Period) {
  const cur = { rev: await revenue(db, org.id, p.from, p.to), cls: await classStats(db, org.id, p.from, p.to), cl: await clientCounts(db, org.id, p.from, p.to) };
  const prev = { rev: await revenue(db, org.id, p.prevFrom, p.from), cls: await classStats(db, org.id, p.prevFrom, p.from), cl: await clientCounts(db, org.id, p.prevFrom, p.from) };
  const fill = pct(cur.cls.booked, cur.cls.capacity), fillPrev = pct(prev.cls.booked, prev.cls.capacity);
  const metrics = [
    metric({ key: "revenue", label: "Money in", value: cur.rev.nett, previous: prev.rev.nett, display: money(cur.rev.nett, org.currency), explain: "Packages, gift cards and fees paid, minus money refunded." }),
    metric({ key: "active", label: "Clients who came", value: cur.cl.active, previous: prev.cl.active, display: String(cur.cl.active), explain: "Different people who came to at least one class." }),
    metric({ key: "new", label: "New clients", value: cur.cl.newClients, previous: prev.cl.newClients, display: String(cur.cl.newClients), explain: "People who joined the studio in this period." }),
    metric({ key: "held", label: "Classes held", value: cur.cls.held, previous: prev.cls.held, display: String(cur.cls.held), explain: "Group classes that ran (not counting appointments)." }),
    metric({ key: "fill", label: "How full classes were", value: fill, previous: fillPrev, display: `${fill}%`, isPercent: true, explain: `On average, about ${Math.round(fill / 10)} of every 10 spots were taken.` }),
  ];
  const slots = await slotTable(db, org, p.from, p.to);
  const highlights = [
    slots[0] ? `Your fullest regular class: ${slots[0].label} (${slots[0].fill}% full on average).` : "",
    slots.length > 1 ? `Your quietest: ${slots[slots.length - 1]!.label} (${slots[slots.length - 1]!.fill}% full). Worth a look.` : "",
    cur.cls.autoCancelled ? `${cur.cls.autoCancelled} ${cur.cls.autoCancelled === 1 ? "class was" : "classes were"} cancelled automatically for low bookings.` : "",
  ].filter(Boolean);
  return { metrics, highlights, summary: summaryLine(metrics, p.days) };
}

async function sales(db: DbOrTx, org: Org, p: Period) {
  const cur = await revenue(db, org.id, p.from, p.to), prev = await revenue(db, org.id, p.prevFrom, p.from);
  const avg = cur.sold ? Math.round(cur.packages / cur.sold) : 0, avgPrev = prev.sold ? Math.round(prev.packages / prev.sold) : 0;
  const metrics = [
    metric({ key: "revenue", label: "Money in", value: cur.nett, previous: prev.nett, display: money(cur.nett, org.currency), explain: "Packages, gift cards and fees paid, minus money refunded." }),
    metric({ key: "sold", label: "Packages sold", value: cur.sold, previous: prev.sold, display: String(cur.sold), explain: "Paid packages and memberships sold (free ones aren't counted)." }),
    metric({ key: "average", label: "Average package sale", value: avg, previous: avgPrev, display: money(avg, org.currency), explain: "What a package sold for, on average." }),
    metric({ key: "refunds", label: "Money refunded", value: cur.refunds, previous: prev.refunds, display: money(cur.refunds, org.currency), goodWhenUp: false, explain: "Money paid back to clients (not studio credit)." }),
  ];
  // Bars: by week for up to 90 days, by month for a year.
  const unit = p.days > 90 ? "month" : "week";
  const zone = org.timezone;
  const bars = await db.execute<{ bucket: string; cents: string }>(sql`
    with money_in as (
      select purchased_at as at, price_paid_cents as cents from client_packages where org_id = ${org.id} and purchased_at >= ${p.from} and purchased_at < ${p.to}
      union all select paid_at, amount_cents from orders where org_id = ${org.id} and kind = 'gift_card' and status = 'paid' and paid_at >= ${p.from} and paid_at < ${p.to}
      union all select created_at, amount_cents from fees where org_id = ${org.id} and status = 'charged' and created_at >= ${p.from} and created_at < ${p.to}
      union all select created_at, -coalesce(amount_cents, 0) from refunds where org_id = ${org.id} and method = 'original_payment' and created_at >= ${p.from} and created_at < ${p.to}
    )
    select to_char(date_trunc(${unit}, at at time zone ${zone}), 'YYYY-MM-DD') as bucket, sum(cents) as cents from money_in group by 1 order by 1`);
  const byBucket = new Map(bars.rows.map((b) => [b.bucket, n(b.cents)]));
  const series: { label: string; start: string; cents: number; display: string }[] = [];
  const first = await db.execute<{ d: string }>(sql`select to_char(date_trunc(${unit}, ${p.from}::timestamptz at time zone ${zone}), 'YYYY-MM-DD') as d`);
  for (let d = new Date(`${first.rows[0]!.d}T00:00:00Z`); d < p.to; ) {
    const key = d.toISOString().slice(0, 10);
    const cents = byBucket.get(key) ?? 0;
    series.push({ start: key, label: d.toLocaleDateString("en-GB", unit === "month" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" }), cents, display: money(cents, org.currency) });
    d = unit === "month" ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) : new Date(d.getTime() + 7 * DAY);
  }
  const gross = cur.packages + cur.giftCards + cur.fees;
  const breakdown = [
    { label: "Packages and memberships", cents: cur.packages },
    { label: "Gift cards", cents: cur.giftCards },
    { label: "Fees (late cancellation, no-show)", cents: cur.fees },
  ].map((b) => ({ ...b, display: money(b.cents, org.currency), share: pct(b.cents, gross) }));
  const top = await db.execute<{ name: string; sold: string; cents: string }>(sql`
    select name, count(*) as sold, sum(price_paid_cents) as cents from client_packages
    where org_id = ${org.id} and purchased_at >= ${p.from} and purchased_at < ${p.to} and price_paid_cents > 0 group by name order by sum(price_paid_cents) desc limit 8`);
  return {
    metrics,
    summary: summaryLine(metrics, p.days),
    chart: { title: unit === "month" ? "Money in each month" : "Money in each week", unit, series },
    breakdown,
    topPackages: top.rows.map((r) => ({ name: r.name, sold: n(r.sold), cents: n(r.cents), display: money(n(r.cents), org.currency), share: pct(n(r.cents), cur.packages) })),
  };
}

/** Regular class slots (same class, weekday and start time, held at least twice), fullest first. */
async function slotTable(db: DbOrTx, org: Org, from: Date, to: Date) {
  const r = await db.execute<{ name: string; dow: string; hhmm: string; classes: string; capacity: string; booked: string }>(sql`
    select ct.name, extract(isodow from cs.starts_at at time zone ${org.timezone}) as dow, to_char(cs.starts_at at time zone ${org.timezone}, 'HH24:MI') as hhmm,
      count(*) as classes, sum(cs.capacity) as capacity,
      sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed')) as booked
    from class_sessions cs join class_types ct on ct.id = cs.class_type_id
    where cs.org_id = ${org.id} and cs.status = 'scheduled' and ct.kind = 'class' and cs.starts_at >= ${from} and cs.starts_at < ${to} and cs.ends_at < now()
    group by 1, 2, 3 having count(*) >= 2`);
  const day = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const time = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h! + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h! < 12 ? "am" : "pm"}`; };
  return r.rows
    .map((x) => ({ label: `${x.name}, ${day[n(x.dow)]} ${time(x.hhmm)}`, classes: n(x.classes), averageBooked: Math.round((n(x.booked) / n(x.classes)) * 10) / 10, fill: pct(n(x.booked), n(x.capacity)) }))
    .sort((a, b) => b.fill - a.fill);
}

async function classes(db: DbOrTx, org: Org, p: Period) {
  const cur = await classStats(db, org.id, p.from, p.to), prev = await classStats(db, org.id, p.prevFrom, p.from);
  const appts = await classStats(db, org.id, p.from, p.to, "appointment"), apptsPrev = await classStats(db, org.id, p.prevFrom, p.from, "appointment");
  const fill = pct(cur.booked, cur.capacity), fillPrev = pct(prev.booked, prev.capacity);
  const ns = pct(cur.noShow, cur.present + cur.noShow), nsPrev = pct(prev.noShow, prev.present + prev.noShow);
  const metrics = [
    metric({ key: "held", label: "Classes held", value: cur.held, previous: prev.held, display: String(cur.held), explain: "Group classes that ran." }),
    metric({ key: "fill", label: "How full classes were", value: fill, previous: fillPrev, display: `${fill}%`, isPercent: true, explain: `About ${Math.round(fill / 10)} of every 10 spots were taken.` }),
    metric({ key: "visits", label: "Visits", value: cur.present, previous: prev.present, display: String(cur.present), explain: "Times someone was marked as attended." }),
    metric({ key: "noshow", label: "No-shows", value: ns, previous: nsPrev, display: `${ns}%`, isPercent: true, goodWhenUp: false, explain: `Out of every 100 people booked, about ${Math.round(ns)} didn't turn up.` }),
    metric({ key: "appointments", label: "Appointments held", value: appts.held, previous: apptsPrev.held, display: String(appts.held), explain: "Private sessions, counted separately from classes." }),
  ];
  const types = await db.execute<{ name: string; color: string; classes: string; capacity: string; booked: string; present: string; no_show: string }>(sql`
    select ct.name, ct.color, count(*) as classes, sum(cs.capacity) as capacity,
      sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed')) as booked,
      sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed' and b.attendance = 'present')) as present,
      sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed' and b.attendance = 'no_show')) as no_show
    from class_sessions cs join class_types ct on ct.id = cs.class_type_id
    where cs.org_id = ${org.id} and cs.status = 'scheduled' and ct.kind = 'class' and cs.starts_at >= ${p.from} and cs.starts_at < ${p.to} and cs.ends_at < now()
    group by ct.name, ct.color order by count(*) desc`);
  const slots = await slotTable(db, org, p.from, p.to);
  return {
    metrics,
    summary: summaryLine(metrics, p.days),
    byClassType: types.rows.map((t) => ({ name: t.name, color: t.color, classes: n(t.classes), averageBooked: Math.round((n(t.booked) / n(t.classes)) * 10) / 10, fill: pct(n(t.booked), n(t.capacity)), noShow: pct(n(t.no_show), n(t.present) + n(t.no_show)) })),
    fullest: slots.slice(0, 5),
    quietest: slots.length > 5 ? slots.slice(-5).reverse() : [],
    cancelled: { total: cur.cancelled, automatic: cur.autoCancelled, text: cur.cancelled ? `${cur.cancelled} ${cur.cancelled === 1 ? "class was" : "classes were"} cancelled${cur.autoCancelled ? `, ${cur.autoCancelled} of them automatically for low bookings` : ""}.` : "No classes were cancelled." },
  };
}

async function clients(db: DbOrTx, org: Org, p: Period) {
  const cur = await clientCounts(db, org.id, p.from, p.to), prev = await clientCounts(db, org.id, p.prevFrom, p.from);
  const ret = await retention(db, org.id, p);
  const retPrev = await retention(db, org.id, { from: p.prevFrom, to: p.from, prevFrom: new Date(p.prevFrom.getTime() - p.days * DAY), days: p.days });
  const sv = await secondVisits(db, org.id, p.from, p.to), svPrev = await secondVisits(db, org.id, p.prevFrom, p.from);
  const keptPct = pct(ret.kept, ret.before), keptPrev = pct(retPrev.kept, retPrev.before);
  const back = pct(sv.returned, sv.firstTimers), backPrev = pct(svPrev.returned, svPrev.firstTimers);
  // At risk: came at least twice in the last 90 days, but not in the last 21 days, and nothing booked.
  const risk = await db.execute<{ id: string; first_name: string; last_name: string; last_visit: string; visits: string }>(sql`
    select u.id, u.first_name, u.last_name, max(cs.starts_at) as last_visit, count(*) as visits
    from bookings b join class_sessions cs on cs.id = b.session_id join users u on u.id = b.client_id
    where b.org_id = ${org.id} and b.status = 'confirmed' and b.attendance = 'present' and cs.starts_at >= now() - interval '90 days'
      and not exists (select 1 from bookings f join class_sessions fs on fs.id = f.session_id where f.client_id = b.client_id and f.org_id = b.org_id and f.status = 'confirmed' and fs.starts_at > now())
    group by u.id, u.first_name, u.last_name
    having count(*) >= 2 and max(cs.starts_at) < now() - interval '21 days'
    order by count(*) desc limit 10`);
  const regulars = await db.execute<{ first_name: string; last_name: string; visits: string }>(sql`
    select u.first_name, u.last_name, count(*) as visits from bookings b join class_sessions cs on cs.id = b.session_id join users u on u.id = b.client_id
    where b.org_id = ${org.id} and b.status = 'confirmed' and b.attendance = 'present' and cs.starts_at >= ${p.from} and cs.starts_at < ${p.to}
    group by u.id, u.first_name, u.last_name order by count(*) desc limit 10`);
  const metrics = [
    metric({ key: "active", label: "Clients who came", value: cur.active, previous: prev.active, display: String(cur.active), explain: "Different people who came to at least one class." }),
    metric({ key: "new", label: "New clients", value: cur.newClients, previous: prev.newClients, display: String(cur.newClients), explain: "People who joined the studio." }),
    metric({ key: "kept", label: "Clients who kept coming", value: keptPct, previous: keptPrev, display: `${keptPct}%`, isPercent: true, explain: ret.before ? `Of the ${ret.before} people who came in the period before, ${ret.kept} came again in this one.` : "Nobody came in the period before, so there's nothing to compare yet." }),
    metric({ key: "second", label: "Came back after their first class", value: back, previous: backPrev, display: `${back}%`, isPercent: true, explain: sv.firstTimers ? `${sv.returned} of ${sv.firstTimers} first-timers came to a second class within 30 days.` : "No first-timers in this period." }),
  ];
  return {
    metrics,
    summary: summaryLine(metrics, p.days),
    atRisk: { explain: "Regulars (2+ visits in the last 90 days) who haven't come for 3 weeks and have nothing booked. A friendly message now often brings them back.", clients: risk.rows.map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}`, lastVisit: new Date(r.last_visit).toISOString(), visits: n(r.visits) })) },
    regulars: regulars.rows.map((r) => ({ name: `${r.first_name} ${r.last_name}`, visits: n(r.visits) })),
  };
}

async function conversion(db: DbOrTx, org: Org, p: Period) {
  const np = await newToPaying(db, org.id, p.from, p.to), npPrev = await newToPaying(db, org.id, p.prevFrom, p.from);
  const sv = await secondVisits(db, org.id, p.from, p.to), svPrev = await secondVisits(db, org.id, p.prevFrom, p.from);
  const f = await funnel(db, org.id, p.days);
  const cp = f.sources.find((s) => s.source === "classpass")!;
  const paying = pct(np.paid, np.joined), payingPrev = pct(npPrev.paid, npPrev.joined);
  const back = pct(sv.returned, sv.firstTimers), backPrev = pct(svPrev.returned, svPrev.firstTimers);
  const leadsTotal = f.total.leads, leadsBought = f.sources.reduce((a, s) => a + (s.leads ? Math.min(s.bought, s.leads) : 0), 0);
  const metrics = [
    metric({ key: "paying", label: "New clients who bought a package", value: paying, previous: payingPrev, display: `${paying}%`, isPercent: true, explain: np.joined ? `${np.paid} of the ${np.joined} people who joined have bought a package.` : "Nobody joined in this period." }),
    metric({ key: "second", label: "First-timers who came back", value: back, previous: backPrev, display: `${back}%`, isPercent: true, explain: sv.firstTimers ? `${sv.returned} of ${sv.firstTimers} came to a second class within 30 days.` : "No first-timers in this period." }),
    metric({ key: "leads", label: "Leads who became paying clients", value: pct(leadsBought, leadsTotal), previous: 0, display: `${pct(leadsBought, leadsTotal)}%`, isPercent: true, explain: leadsTotal ? `${leadsBought} of ${leadsTotal} leads (from ads, ClassPass and enquiries) have bought a package.` : "No leads in this period." }),
    metric({ key: "classpass", label: "ClassPass clients who became members", value: pct(cp.bought, cp.leads), previous: 0, display: `${pct(cp.bought, cp.leads)}%`, isPercent: true, explain: cp.leads ? `${cp.bought} of ${cp.leads} people who came through ClassPass bought one of your packages.` : "No new ClassPass clients in this period." }),
  ];
  // Lead and ClassPass comparisons have no clean "before" here, so they show no change arrow.
  for (const m of metrics.slice(2)) m.change = { text: "", direction: "flat", good: null };
  const goals = await db.execute<{ name: string; started: string; converted: string }>(sql`
    select j.name, count(e.*) as started, count(e.converted_at) as converted from journeys j join journey_enrollments e on e.journey_id = j.id
    where j.org_id = ${org.id} and j.definition->'goal' is not null and jsonb_typeof(j.definition->'goal') = 'object' and e.created_at >= ${p.from} and e.created_at < ${p.to}
    group by j.id, j.name order by count(e.*) desc`);
  return {
    metrics,
    summary: summaryLine(metrics.slice(0, 2), p.days),
    funnel: f,
    journeys: goals.rows.map((g) => ({ name: g.name, started: n(g.started), converted: n(g.converted), rate: pct(n(g.converted), n(g.started)) })),
  };
}

/** One sentence at the top of each tab: the biggest change worth knowing about. */
function summaryLine(metrics: ReturnType<typeof metric>[], days: number): string {
  const period = days === 365 ? "the year before" : `the previous ${days} days`;
  const moved = metrics.filter((m) => m.change.good !== null && m.change.text);
  if (!moved.length) return `Much the same as ${period}.`;
  const good = moved.filter((m) => m.change.good), bad = moved.filter((m) => !m.change.good);
  const say = (m: ReturnType<typeof metric>) => `${m.label.toLowerCase()} ${m.change.direction === "up" ? "went up" : "went down"}${m.change.text.match(/\d/) ? ` (${m.change.text.toLowerCase()})` : ""}`;
  const parts = [good[0] ? `Good news: ${say(good[0])}` : "", bad[0] ? `${good[0] ? "; worth watching: " : "Worth watching: "}${say(bad[0])}` : ""];
  return `${parts.join("")} compared with ${period}.`;
}

export async function reportRoutes(app: FastifyInstance) {
  app.get("/reports/:section", async (req) => {
    requirePermission(req, "viewReports");
    const { section: which } = parse(section, req.params);
    const { days } = parse(query, req.query);
    const org = await getOrg(app.db, req.auth.orgId);
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY);
    const p: Period = { from, to, prevFrom: new Date(from.getTime() - days * DAY), days };
    const fn = { overview, sales, classes, clients, conversion }[which];
    return {
      section: which,
      period: { days, from: from.toISOString(), to: to.toISOString(), label: days === 365 ? "Last 12 months" : `Last ${days} days`, comparedWith: days === 365 ? "the 12 months before" : `the ${days} days before` },
      currency: org.currency,
      ...(await fn(app.db, org, p)),
    };
  });
}
