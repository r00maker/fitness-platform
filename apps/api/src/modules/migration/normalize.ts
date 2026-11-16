/**
 * Turning old-system text into clean values, strictly: anything we can't read with certainty
 * comes back as a problem to show, never as a guess.
 *
 *  - Dates: ISO (2026-04-03), day-first (03/04/2026), month-first (04/03/2026), "3 Apr 2026",
 *    "Apr 3, 2026", with or without a time. Day-first vs month-first is worked out per column
 *    from values that can only be one (a 13th-31st day); if a whole column is ambiguous, the
 *    studio's answer on the form decides, and if there's none, the check stops and asks.
 *  - Phones: to international format using the studio's country. Numbers Excel has damaged
 *    (6.59123E+09, or a lost leading zero) are flagged, not "fixed".
 *  - Money: "SGD 1,280.00", "$45", "(15.00)" → cents.
 */
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export type DateOrder = "dmy" | "mdy" | "ymd";
export interface Read<T> { value: T | null; problem?: string }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12, january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** The studio's country, for phone numbers (from its currency, which every studio sets). */
export function countryFor(currency: string): CountryCode {
  return ({ SGD: "SG", MYR: "MY", THB: "TH", IDR: "ID", PHP: "PH", VND: "VN", AUD: "AU", USD: "US", GBP: "GB", HKD: "HK", NZD: "NZ" } as Record<string, CountryCode>)[currency] ?? "SG";
}

export const cleanText = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function readEmail(s: string): Read<string> {
  const v = cleanText(s).toLowerCase().replace(/^mailto:/, "");
  if (!v) return { value: null };
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) return { value: null, problem: `“${s}” isn't a valid email address` };
  return { value: v };
}

export function readPhone(s: string, country: CountryCode): Read<string> {
  const raw = cleanText(s);
  if (!raw) return { value: null };
  if (/^\d(\.\d+)?e\+?\d+$/i.test(raw)) return { value: null, problem: `phone “${raw}” was damaged by Excel (shown in scientific notation); check the original` };
  const p = parsePhoneNumberFromString(raw.replace(/^00/, "+"), country);
  if (!p || !p.isValid()) return { value: null, problem: `phone “${raw}” doesn't look like a valid ${country} or international number${/^\d{7,9}$/.test(raw) && country !== "SG" ? " (a leading 0 may have been lost in Excel)" : ""}` };
  return { value: p.number };
}

const pad = (n: number) => String(n).padStart(2, "0");
const validDate = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const fullYear = (y: number, past: boolean) => (y >= 100 ? y : past ? (y > (new Date().getFullYear() % 100) + 1 ? 1900 + y : 2000 + y) : 2000 + y);

/** Which order a column's slash/dot/dash dates are in: decided by values that can only be read one way. */
export function inferDateOrder(values: string[]): DateOrder | "ambiguous" | null {
  let dmy = false, mdy = false, numeric = false;
  for (const v of values) {
    const m = cleanText(v).match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/);
    if (!m) continue;
    if (m[1]!.length === 4) return "ymd";
    numeric = true;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dmy = true;
    if (b > 12 && a <= 12) mdy = true;
  }
  if (!numeric) return null;
  if (dmy && mdy) return "ambiguous";
  return dmy ? "dmy" : mdy ? "mdy" : "ambiguous";
}

/** A date (and optional time) as yyyy-mm-dd[ HH:MM]. `past` means two-digit years are taken as the past (birthdays). */
export function readDate(s: string, order: DateOrder | null, past = false): Read<string> {
  const v = cleanText(s);
  if (!v) return { value: null };
  let y = 0, mo = 0, d = 0, rest = "";
  let m = v.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(.*)$/);
  if (m) { y = +m[1]!; mo = +m[2]!; d = +m[3]!; rest = m[4]!; }
  else if ((m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(.*)$/))) {
    if (!order || order === "ymd") return { value: null, problem: `date “${v}” could be day-first or month-first; say which on the form` };
    const [a, b] = [+m[1]!, +m[2]!];
    [d, mo] = order === "dmy" ? [a, b] : [b, a];
    y = fullYear(+m[3]!, past); rest = m[4]!;
  } else if ((m = v.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{2,4})(.*)$/i)) && MONTHS[m[2]!.toLowerCase()]) {
    d = +m[1]!; mo = MONTHS[m[2]!.toLowerCase()]!; y = fullYear(+m[3]!, past); rest = m[4]!;
  } else if ((m = v.match(/^(?:[a-z]{3,9},?\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})(.*)$/i)) && MONTHS[m[1]!.toLowerCase()]) {
    mo = MONTHS[m[1]!.toLowerCase()]!; d = +m[2]!; y = fullYear(+m[3]!, past); rest = m[4]!;
  } else return { value: null, problem: `“${v}” isn't a date we can read` };
  if (!validDate(y, mo, d)) return { value: null, problem: `“${v}” isn't a real date` };
  const t = rest.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
  let time = "";
  if (t) {
    let h = +t[1]!;
    const ap = t[3]?.toLowerCase().replace(/\./g, "");
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h < 24) time = ` ${pad(h)}:${t[2]}`;
  }
  return { value: `${y}-${pad(mo)}-${pad(d)}${time}` };
}

/** A time of day on its own ("7:00 AM", "19:30") as HH:MM. */
export function readTime(s: string): Read<string> {
  const t = cleanText(s).match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap]\.?m\.?)?$/i);
  if (!t) return { value: null, problem: s ? `“${s}” isn't a time we can read` : undefined };
  let h = +t[1]!;
  const ap = t[3]?.toLowerCase().replace(/\./g, "");
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23) return { value: null, problem: `“${s}” isn't a time we can read` };
  return { value: `${pad(h)}:${t[2] ?? "00"}` };
}

/** Money in cents. */
export function readMoney(s: string): Read<number> {
  let v = cleanText(s);
  if (!v || v === "-") return { value: null };
  const negative = /^\(.*\)$/.test(v) || /^-/.test(v);
  v = v.replace(/[()\s-]/g, "").replace(/^[A-Z]{3}|[A-Z]{3}$/i, "").replace(/^[^\d.,]+/, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(v)) v = v.replace(/\./g, "").replace(",", "."); // 1.280,00
  v = v.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return { value: null, problem: `“${s}” isn't an amount we can read` };
  const cents = Math.round(Number(v) * 100);
  return { value: negative ? -cents : cents };
}

/** A whole number, or "unlimited". */
export function readCount(s: string): Read<number | "unlimited"> {
  const v = cleanText(s).toLowerCase();
  if (!v) return { value: null };
  if (/^(unlimited|∞|unl\.?|no limit|n\/a unlimited)$/.test(v)) return { value: "unlimited" };
  if (/^-?\d+(\.0+)?$/.test(v)) return { value: Math.trunc(Number(v)) };
  return { value: null, problem: `“${s}” isn't a number of classes` };
}

/** Yes/no. Unknown wording is a problem, so consent is never assumed. */
export function readYes(s: string): Read<boolean> {
  const v = cleanText(s).toLowerCase();
  if (!v) return { value: null };
  if (/^(y|yes|true|1|subscribed|opted in|opt-in|optin|on|active|signed|agreed|x|✓)$/.test(v)) return { value: true };
  if (/^(n|no|false|0|unsubscribed|opted out|opt-out|optout|off|inactive|not signed|none)$/.test(v)) return { value: false };
  return { value: null, problem: `“${s}” isn't clearly yes or no` };
}

/** How often a membership renews. */
export function readInterval(s: string): Read<{ value: number; unit: "weeks" | "months" }> {
  const v = cleanText(s).toLowerCase();
  if (!v) return { value: null };
  if (/^(monthly|month|1 month|every month|per month|mo)$/.test(v)) return { value: { value: 1, unit: "months" } };
  if (/^(weekly|week|1 week|every week|per week)$/.test(v)) return { value: { value: 1, unit: "weeks" } };
  if (/^(fortnightly|biweekly|bi-weekly|every 2 weeks|2 weeks)$/.test(v)) return { value: { value: 2, unit: "weeks" } };
  if (/^(quarterly|every 3 months|3 months)$/.test(v)) return { value: { value: 3, unit: "months" } };
  if (/^(yearly|annually|annual|every year|12 months|1 year)$/.test(v)) return { value: { value: 12, unit: "months" } };
  const m = v.match(/^every (\d+) (week|month)s?$/);
  if (m) return { value: { value: +m[1]!, unit: m[2] === "week" ? "weeks" : "months" } };
  return { value: null, problem: `“${s}” isn't a renewal period we know` };
}
