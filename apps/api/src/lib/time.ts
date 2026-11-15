import { DateTime, FixedOffsetZone, type Zone } from "luxon";
import type { CalendarView } from "@studio/shared";
import { badRequest } from "./errors.js";

/** A time zone: an IANA name (follows daylight saving) or a fixed offset (doesn't). */
export type TZ = string | Zone;

/**
 * The zone to use for a location. With daylight saving switched off (the default,
 * suited to Southeast Asia) the zone's standard offset is used all year round.
 */
export function zoneFor(timezone: string, observesDaylightSaving: boolean): TZ {
  if (observesDaylightSaving) return timezone;
  const year = DateTime.now().setZone(timezone).year;
  const jan = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: timezone }).offset;
  const jul = DateTime.fromObject({ year, month: 7, day: 1 }, { zone: timezone }).offset;
  if (!Number.isFinite(jan) || !Number.isFinite(jul)) return timezone;
  return FixedOffsetZone.instance(Math.min(jan, jul));
}

export function localHour(instant: Date, timezone: TZ): number {
  return DateTime.fromJSDate(instant, { zone: timezone }).hour;
}

export function friendlyDate(instant: Date, timezone: TZ): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat("ccc d LLL yyyy");
}

/** Minutes from a start to an end time on the same day; an earlier end means it runs past midnight. */
export function minutesBetweenTimes(start: string, end: string): number {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : diff + 24 * 60;
}

/** Turn a local date + time at a location into an exact UTC instant (handles daylight saving). */
export function localToUtc(date: string, time: string, timezone: TZ): Date {
  const dt = DateTime.fromISO(`${date}T${time.slice(0, 5)}`, { zone: timezone });
  if (!dt.isValid) throw badRequest("invalid_time", "That date or time isn't valid.");
  // A local time that doesn't exist (skipped by a DST change) is moved forward by luxon; that's the friendliest outcome.
  return dt.toUTC().toJSDate();
}

export function utcToLocal(instant: Date, timezone: TZ): { date: string; time: string; weekday: number } {
  const dt = DateTime.fromJSDate(instant, { zone: timezone });
  return { date: dt.toISODate()!, time: dt.toFormat("HH:mm"), weekday: dt.weekday };
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

/** The visible range for a calendar view. Weeks start on Monday. */
export function calendarRange(view: CalendarView, date: string, timezone: TZ): { from: Date; to: Date } {
  const anchor = DateTime.fromISO(date, { zone: timezone });
  if (!anchor.isValid) throw badRequest("invalid_date", "That date isn't valid.");
  const unit = view === "day" ? "day" : view === "week" ? "week" : "month";
  const start = anchor.startOf(unit);
  return { from: start.toUTC().toJSDate(), to: start.plus({ [unit + "s"]: 1 }).toUTC().toJSDate() };
}

export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(DateTime.fromISO(toDate).diff(DateTime.fromISO(fromDate), "days").days);
}

export function shiftDate(date: string, days: number): string {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

export interface RecurrenceRule {
  daysOfWeek: number[]; // ISO weekday, 1 = Monday
  everyNWeeks: number;
  startDate: string;
  endDate?: string | null;
  occurrences?: number | null;
}

/**
 * Local dates a recurring class falls on, from `fromDate` through `throughDate` (inclusive).
 * `alreadyGenerated` lets an occurrence-limited series continue counting where it left off.
 */
/**
 * The dates a rule produces between two dates. `skip` leaves dates out (e.g. closures) without
 * counting them, so a course with a set number of classes still gets all of them, just later.
 */
export function recurrenceDates(rule: RecurrenceRule, fromDate: string, throughDate: string, alreadyGenerated = 0, skip?: (date: string) => boolean): string[] {
  const days = new Set(rule.daysOfWeek);
  const firstWeek = DateTime.fromISO(rule.startDate).startOf("week");
  const start = DateTime.max(DateTime.fromISO(rule.startDate), DateTime.fromISO(fromDate));
  let last = DateTime.fromISO(throughDate);
  if (rule.endDate) last = DateTime.min(last, DateTime.fromISO(rule.endDate));

  const out: string[] = [];
  let count = alreadyGenerated;
  for (let d = start; d <= last; d = d.plus({ days: 1 })) {
    if (rule.occurrences != null && count >= rule.occurrences) break;
    if (!days.has(d.weekday)) continue;
    const weeksSinceStart = Math.round(d.startOf("week").diff(firstWeek, "weeks").weeks);
    if (weeksSinceStart % rule.everyNWeeks !== 0) continue;
    if (skip?.(d.toISODate()!)) continue;
    out.push(d.toISODate()!);
    count++;
  }
  return out;
}
