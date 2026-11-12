/**
 * Payroll: what each instructor and staff member is owed for a pay period.
 *
 *  - Each person has a usual rate, and optionally different rates for particular class types.
 *    Rates have a start date, so changing someone's rate never rewrites past pay.
 *  - Classes count once they've finished. Whoever taught the class (including cover) is paid for it.
 *  - Per-client and tiered pay use the studio's "who counts" setting: clients who attended, or
 *    everyone booked. Late cancellations never count.
 *  - One-off adjustments (workshops, bonuses, deductions) are added on top.
 *  - "Mark as paid" keeps a copy of the figures. Anything that changes later (e.g. attendance
 *    corrected) shows as a difference instead of quietly changing what was paid.
 */
import { and, asc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { OPTION_LABELS, classPay, describePayRate, type PayPeriod } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, memberships, organizations, payAdjustments, payRates, payRuns, users } from "../../db/schema.js";
import { zoneFor, type TZ } from "../../lib/time.js";
import { money } from "../bookings/rules.js";

type Org = typeof organizations.$inferSelect;
type Rate = typeof payRates.$inferSelect;
const DEFAULT_FORTNIGHT_ANCHOR = "2026-01-05"; // a Monday
const PERIOD_NOUN: Record<PayPeriod, string> = { weekly: "week", fortnightly: "fortnight", twice_monthly: "half-month", monthly: "month" };

export const orgZone = (org: Org): TZ => zoneFor(org.timezone, org.observesDaylightSaving);

// ---------------------------------------------------------------------------
// Pay periods
// ---------------------------------------------------------------------------
export interface Period {
  start: string;
  /** Exclusive: the first day of the next period. */
  end: string;
  lastDay: string;
  label: string;
  previous: string;
  next: string;
}

function label(start: DateTime, last: DateTime) {
  if (start.day === 1 && last.equals(start.endOf("month").startOf("day"))) return start.toFormat("LLLL yyyy");
  if (start.month === last.month) return `${start.day}–${last.toFormat("d LLL yyyy")}`;
  return `${start.toFormat("d LLL")} – ${last.toFormat("d LLL yyyy")}`;
}

/** The pay period that contains this date. */
export function periodFor(date: string, payPeriod: PayPeriod, anchor: string | null): Period {
  const d = DateTime.fromISO(date);
  let start: DateTime;
  let end: DateTime;
  switch (payPeriod) {
    case "weekly":
      start = d.startOf("week");
      end = start.plus({ weeks: 1 });
      break;
    case "fortnightly": {
      const a = DateTime.fromISO(anchor ?? DEFAULT_FORTNIGHT_ANCHOR);
      const n = Math.floor(d.diff(a, "days").days / 14);
      start = a.plus({ days: n * 14 });
      end = start.plus({ days: 14 });
      break;
    }
    case "twice_monthly":
      start = d.day <= 15 ? d.startOf("month") : d.startOf("month").plus({ days: 15 });
      end = d.day <= 15 ? d.startOf("month").plus({ days: 15 }) : d.startOf("month").plus({ months: 1 });
      break;
    case "monthly":
      start = d.startOf("month");
      end = start.plus({ months: 1 });
      break;
  }
  const last = end.minus({ days: 1 });
  return { start: start.toISODate()!, end: end.toISODate()!, lastDay: last.toISODate()!, label: label(start, last), previous: start.minus({ days: 1 }).toISODate()!, next: end.toISODate()! };
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------
/** The rate for a class: a rate for that class type if there is one, otherwise their usual rate, as of the class date. */
export function rateFor(rates: Rate[], staffId: string, classTypeId: string, date: string): Rate | undefined {
  const mine = rates.filter((r) => r.staffId === staffId && r.type !== "salary" && r.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return mine.find((r) => r.classTypeId === classTypeId) ?? mine.find((r) => r.classTypeId === null);
}

export function salaryFor(rates: Rate[], staffId: string, lastDayOfPeriod: string): Rate | undefined {
  return rates.filter((r) => r.staffId === staffId && r.type === "salary" && r.effectiveFrom <= lastDayOfPeriod).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function describeRate(r: Rate, org: Org, typeName?: string) {
  const text = describePayRate(r, (c) => money(c, org.currency), PERIOD_NOUN[org.payPeriod]);
  return { id: r.id, staffId: r.staffId, classTypeId: r.classTypeId, classTypeName: typeName ?? null, type: r.type, typeLabel: OPTION_LABELS.payRateType[r.type], description: text, effectiveFrom: r.effectiveFrom };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------
export interface StaffPay {
  staffId: string;
  name: string;
  role: string;
  rates: ReturnType<typeof describeRate>[];
  classes: {
    sessionId: string;
    date: string;
    time: string;
    className: string;
    minutes: number;
    clients: number;
    booked: number;
    attendanceTaken: boolean;
    cover: boolean;
    rate: string | null;
    amountCents: number | null;
    amount: string | null;
  }[];
  salaryCents: number;
  adjustments: { id: string; date: string; amountCents: number; amount: string; reason: string }[];
  classPayCents: number;
  adjustmentsCents: number;
  totalCents: number;
  total: string;
  upcomingClasses: number;
  warnings: string[];
}

export async function payReport(db: DbOrTx, org: Org, date: string, opts: { staffId?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const zone = orgZone(org);
  const period = periodFor(date, org.payPeriod, org.payPeriodAnchor);
  const from = DateTime.fromISO(period.start, { zone }).toJSDate();
  const to = DateTime.fromISO(period.end, { zone }).toJSDate();
  const fmt = (c: number) => money(c, org.currency);

  // Late cancellations and cancelled bookings never count; no-shows count only if the studio says so.
  const countedAttendance = org.payHeadcount === "attended" ? sql`b.attendance = 'present'` : sql`b.attendance in ('present','no_show','unmarked')`;
  const classes = await db
    .select({
      id: classSessions.id,
      instructorId: classSessions.instructorId,
      classTypeId: classSessions.classTypeId,
      className: classTypes.name,
      startsAt: classSessions.startsAt,
      endsAt: classSessions.endsAt,
      coverFor: classSessions.coverForInstructorId,
      clients: sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed' and ${countedAttendance})`,
      booked: sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed')`,
      marked: sql<number>`(select count(*)::int from bookings b where b.session_id = ${classSessions.id} and b.status = 'confirmed' and b.attendance <> 'unmarked')`,
    })
    .from(classSessions)
    .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
    .where(
      and(
        eq(classSessions.orgId, org.id),
        eq(classSessions.status, "scheduled"),
        isNotNull(classSessions.instructorId),
        gte(classSessions.startsAt, from),
        lt(classSessions.startsAt, to),
        opts.staffId ? eq(classSessions.instructorId, opts.staffId) : undefined,
      ),
    )
    .orderBy(asc(classSessions.startsAt));

  const rates = await db.select().from(payRates).where(and(eq(payRates.orgId, org.id), opts.staffId ? eq(payRates.staffId, opts.staffId) : undefined));
  const adjustments = await db
    .select()
    .from(payAdjustments)
    .where(and(eq(payAdjustments.orgId, org.id), gte(payAdjustments.date, period.start), lt(payAdjustments.date, period.end), opts.staffId ? eq(payAdjustments.staffId, opts.staffId) : undefined))
    .orderBy(asc(payAdjustments.date));
  const staff = await db
    .select({ id: users.id, first: users.firstName, last: users.lastName, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, org.id), ne(memberships.role, "client"), opts.staffId ? eq(memberships.userId, opts.staffId) : undefined));
  const typeNames = new Map((await db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(eq(classTypes.orgId, org.id))).map((t) => [t.id, t.name]));

  const out: StaffPay[] = [];
  for (const p of staff) {
    const mine = classes.filter((c) => c.instructorId === p.id);
    const myRates = rates.filter((r) => r.staffId === p.id);
    const myAdj = adjustments.filter((a) => a.staffId === p.id);
    if (!mine.length && !myRates.length && !myAdj.length) continue;
    const warnings: string[] = [];
    const missing = new Set<string>();
    let notTaken = 0;
    const lines: StaffPay["classes"] = [];
    for (const c of mine.filter((c) => c.endsAt <= now)) {
      const local = DateTime.fromJSDate(c.startsAt, { zone });
      const day = local.toISODate()!;
      const r = rateFor(rates, p.id, c.classTypeId, day);
      const minutes = Math.round((c.endsAt.getTime() - c.startsAt.getTime()) / 60_000);
      const amountCents = r ? classPay(r, { headcount: c.clients, minutes }) : null;
      if (!r) missing.add(c.className);
      const usesHeadcount = r?.type === "per_client" || r?.type === "tiered";
      const taken = c.booked === 0 || c.marked > 0;
      if (usesHeadcount && org.payHeadcount === "attended" && !taken) notTaken++;
      lines.push({
        sessionId: c.id,
        date: day,
        time: local.toFormat("h:mma").toLowerCase(),
        className: c.className,
        minutes,
        clients: c.clients,
        booked: c.booked,
        attendanceTaken: taken,
        cover: !!c.coverFor,
        rate: r ? describeRate(r, org).description : null,
        amountCents,
        amount: amountCents === null ? null : fmt(amountCents),
      });
    }
    if (missing.size) warnings.push(`No pay rate set for ${[...missing].join(", ")}, so ${missing.size === 1 ? "those classes are" : "these classes are"} shown without pay. Add a rate to include them.`);
    if (notTaken) warnings.push(`Attendance wasn't taken for ${notTaken} ${notTaken === 1 ? "class" : "classes"}, so ${notTaken === 1 ? "it counts" : "they count"} 0 clients. Take attendance to pay for them properly.`);
    const salary = salaryFor(rates, p.id, period.lastDay);
    const salaryCents = salary?.amountCents ?? 0;
    const classPayCents = lines.reduce((n, l) => n + (l.amountCents ?? 0), 0);
    const adjustmentsCents = myAdj.reduce((n, a) => n + a.amountCents, 0);
    const totalCents = classPayCents + salaryCents + adjustmentsCents;
    const current = myRates.filter((r) => r.effectiveFrom <= period.lastDay).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
    const latestPerScope = current.filter((r, i) => current.findIndex((x) => x.classTypeId === r.classTypeId && (x.type === "salary") === (r.type === "salary")) === i);
    out.push({
      staffId: p.id,
      name: `${p.first} ${p.last}`,
      role: OPTION_LABELS.role[p.role],
      rates: latestPerScope.map((r) => describeRate(r, org, r.classTypeId ? typeNames.get(r.classTypeId) : undefined)),
      classes: lines,
      salaryCents,
      adjustments: myAdj.map((a) => ({ id: a.id, date: a.date, amountCents: a.amountCents, amount: fmt(a.amountCents), reason: a.reason })),
      classPayCents,
      adjustmentsCents,
      totalCents,
      total: fmt(totalCents),
      upcomingClasses: mine.filter((c) => c.endsAt > now).length,
      warnings,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  const totalCents = out.reduce((n, s) => n + s.totalCents, 0);

  const [run] = opts.staffId ? [] : await db.select().from(payRuns).where(and(eq(payRuns.orgId, org.id), eq(payRuns.periodStart, period.start)));
  let paid = null;
  if (run) {
    const before = (run.snapshot as { staff?: { staffId: string; name: string; totalCents: number }[] }).staff ?? [];
    const changes = out
      .map((s) => ({ name: s.name, was: before.find((b) => b.staffId === s.staffId)?.totalCents ?? 0, now: s.totalCents }))
      .concat(before.filter((b) => !out.some((s) => s.staffId === b.staffId)).map((b) => ({ name: b.name, was: b.totalCents, now: 0 })))
      .filter((c) => c.was !== c.now)
      .map((c) => ({ name: c.name, differenceCents: c.now - c.was, difference: `${c.now - c.was > 0 ? "+" : ""}${fmt(c.now - c.was)}` }));
    paid = { paidAt: run.paidAt, totalCents: run.totalCents, total: fmt(run.totalCents), changesSince: changes };
  }
  return {
    period,
    currency: org.currency,
    headcountRule: OPTION_LABELS.payHeadcount[org.payHeadcount],
    staff: out,
    totalCents,
    total: fmt(totalCents),
    periodOver: now >= to,
    paid,
  };
}

/** Pay runs whose period includes this class's date (to warn when attendance changes after pay was marked as paid). */
export async function paidRunFor(db: DbOrTx, orgId: string, localDate: string) {
  const [run] = await db.select().from(payRuns).where(and(eq(payRuns.orgId, orgId), sql`${payRuns.periodStart} <= ${localDate}`, sql`${payRuns.periodEnd} > ${localDate}`));
  return run ?? null;
}

/** A spreadsheet-friendly version of the report. */
export function toCsv(report: Awaited<ReturnType<typeof payReport>>) {
  const cell = (v: unknown) => {
    const t = String(v ?? "");
    // Quote everything; neutralise leading characters spreadsheets treat as formulas.
    return `"${(/^[=+\-@]/.test(t) && !/^-?\d/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const amount = (c: number | null) => (c === null ? "" : (c / 100).toFixed(2));
  const rows: unknown[][] = [["Name", "Date", "Item", "Clients", `Amount (${report.currency})`]];
  for (const s of report.staff) {
    for (const c of s.classes) rows.push([s.name, c.date, `${c.className} ${c.time}${c.cover ? " (cover)" : ""}`, c.clients, amount(c.amountCents)]);
    if (s.salaryCents) rows.push([s.name, report.period.lastDay, "Salary", "", amount(s.salaryCents)]);
    for (const a of s.adjustments) rows.push([s.name, a.date, a.reason, "", amount(a.amountCents)]);
    rows.push([s.name, "", "Total", "", amount(s.totalCents)]);
  }
  rows.push(["All staff", "", report.period.label, "", amount(report.totalCents)]);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

