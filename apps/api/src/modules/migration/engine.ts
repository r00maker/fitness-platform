/**
 * Moving a studio's data from its old system: the check and the import.
 *
 * Both run the same code. The check runs the whole import inside a transaction and then rolls it
 * back, so what it reports is exactly what the import will do. The import runs it again (data may
 * have changed) and keeps it. Every data row ends up in exactly one of: created, linked (an
 * account that already existed), merged (a duplicate of another row) or skipped (with a reason);
 * the report's "every row accounted for" line proves it.
 *
 * Accuracy rules:
 *  - Nothing is guessed. Unreadable dates, phones, amounts or yes/no values are reported with the
 *    file and row; day-first vs month-first dates are worked out per column or taken from the form.
 *  - People are matched by the old system's client ID, then email, then phone, then a name that's
 *    unique. A row we can't match is reported, not attached to someone who looks similar.
 *  - Existing accounts (a client of another studio here) are linked, and their own details are
 *    left as they are.
 *  - Consent to marketing is moved only where the file clearly says yes.
 *  - Classes left are moved exactly as exported; bookings moved with a pack don't use another class
 *    (the old system already took it). Card details can't be moved in a file: memberships move,
 *    and clients add a card before their next billing date.
 */
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { DbOrTx } from "../../db/client.js";
import {
  bookings, classSessions, classTypes, clientHistory, clientPackageMembers, clientPackages, clientTagAssignments, clientTags, clientWaivers, creditGrants, creditLedger, locations,
  memberships, migrationFiles, migrationJobs, migrationRecords, organizations, packageLedger, packagePlans, users,
} from "../../db/schema.js";
import { conflict } from "../../lib/errors.js";
import { grantCredit } from "../marketing/credit.js";
import { FIELD_LABELS, KIND_LABELS, type Kind } from "./fields.js";
import { cleanText, countryFor, inferDateOrder, readCount, readDate, readEmail, readInterval, readMoney, readPhone, readTime, readYes, type DateOrder } from "./normalize.js";

type Job = typeof migrationJobs.$inferSelect;
type File = typeof migrationFiles.$inferSelect;
type Org = typeof organizations.$inferSelect;
export type Level = "blocking" | "warning" | "info";
export interface Issue { level: Level; file: string; row: number | null; field: string | null; message: string }
interface RowRef { file: File; row: number }

/** One client, gathered from every file that mentions them. */
interface ClientPlan {
  key: string;
  refs: RowRef[];
  externalIds: Set<string>;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  memberSince: string | null;
  marketingEmail: boolean;
  creditCents: number;
  tags: Set<string>;
  waiverSignedAt: string | null;
  notes: string[];
  emergency: string | null;
  dateOfBirth: string | null;
  visits: number;
  firstVisit: string | null;
  lastVisit: string | null;
  inactive: boolean;
}

export interface Report {
  ranAt: string;
  mode: "check" | "import";
  sourcePlatform: string | null;
  files: { id: string; filename: string; sheet: string | null; kind: string; kindLabel: string; dataRows: number; mapped: Record<string, string>; unmapped: string[] }[];
  totals: Record<string, Record<string, number>>;
  reconciliation: { label: string; told: number | null; found: number; ok: boolean; note: string }[];
  accounted: { rows: number; created: number; linked: number; merged: number; skipped: number; ok: boolean };
  issues: Issue[];
  issueSummary: { level: Level; message: string; count: number }[];
  blocking: number;
  warnings: number;
  ready: boolean;
  needsAcknowledging: string[];
}

const DAY = 86_400_000;
const isTotalRow = (r: string[]) => /^(grand\s+)?total(s)?\b/i.test(r[0] ?? "") && r.filter((c) => c).length <= 3;
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const summaryKey = (m: string) => m.replace(/“[^”]*”/g, "“…”").replace(/\d+/g, "#");

class Collector {
  issues: Issue[] = [];
  add(level: Level, file: string, row: number | null, field: string | null, message: string) { this.issues.push({ level, file, row, field, message }); }
}

/** Read one field from a row through the mapping. */
const cell = (f: File, r: string[], field: string) => (f.mapping[field] === undefined ? "" : cleanText(r[f.mapping[field]!] ?? ""));

/**
 * Run the move. `apply: false` is the check (rolled back); `apply: true` keeps it.
 * Returns the report; the caller saves it on the job.
 */
export async function runMigration(db: DbOrTx, jobId: string, opts: { apply: boolean; actorId: string; now?: Date }): Promise<Report> {
  const now = opts.now ?? new Date();
  let report!: Report;
  const ROLLBACK = new Error("check-only");
  try {
    await db.transaction(async (tx) => {
      report = await migrate(tx, jobId, opts.apply ? "import" : "check", opts.actorId, now);
      if (!opts.apply || !report.ready) throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return report;
}

export async function migrate(tx: DbOrTx, jobId: string, mode: "check" | "import", actorId: string, now: Date): Promise<Report> {
  const [job] = await tx.select().from(migrationJobs).where(eq(migrationJobs.id, jobId));
  if (!job) throw new Error("job not found");
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, job.orgId));
  const files = (await tx.select().from(migrationFiles).where(eq(migrationFiles.jobId, jobId))).filter((f) => f.kind !== "ignore" && f.rows);
  const c = new Collector();
  const country = countryFor(org!.currency);
  const source = job.sourcePlatform ?? "the old system";
  const zone = org!.timezone;
  const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
  const counts: Record<string, Record<string, number>> = {};
  const bump = (entity: string, what: string, n = 1) => { (counts[entity] ??= {})[what] = (counts[entity]![what] ?? 0) + n; };
  const accounted = { rows: 0, created: 0, linked: 0, merged: 0, skipped: 0 };
  const records: (typeof migrationRecords.$inferInsert)[] = [];
  const record = (ref: RowRef, entity: string, action: "created" | "linked" | "merged" | "skipped", entityId: string | null, reason: string | null, primary = true) => {
    if (primary) accounted[action]++;
    records.push({ jobId, orgId: job.orgId, fileId: ref.file.id, rowNumber: ref.row, entity, entityId, action, reason });
  };

  // --- Rows of each file, with spreadsheet row numbers, and date order per column ----------------
  const dataRows = (f: File) => {
    const out: { r: string[]; row: number }[] = [];
    f.rows!.forEach((r, i) => {
      if (i <= f.headerRow) return;
      if (!r.some((x) => cleanText(x))) return;
      if (isTotalRow(r)) { c.add("info", f.filename, i + 1, null, "a totals row was left out"); return; }
      out.push({ r, row: i + 1 });
    });
    return out;
  };
  const orders = new Map<string, DateOrder | null>();
  const dateOrderFor = (f: File, field: string, rows: { r: string[] }[]) => {
    const key = `${f.id}:${field}`;
    if (orders.has(key)) return orders.get(key)!;
    const inferred = inferDateOrder(rows.map(({ r }) => cell(f, r, field)));
    let order: DateOrder | null = inferred === "ambiguous" ? job.dateOrder ?? null : inferred ?? job.dateOrder ?? null;
    if (inferred === "ambiguous" && !job.dateOrder) {
      c.add("blocking", f.filename, null, field, `dates in “${f.headers[f.mapping[field]!]}” could be day-first or month-first (like 03/04/2026); set how the old system writes dates`);
      order = null;
    }
    orders.set(key, order);
    return order;
  };
  const readD = (f: File, r: string[], row: number, field: string, all: { r: string[] }[], past = false) => {
    const raw = cell(f, r, field);
    if (!raw) return null;
    const res = readDate(raw, dateOrderFor(f, field, all), past);
    if (res.problem && !/could be day-first/.test(res.problem)) c.add("warning", f.filename, row, field, res.problem);
    return res.value;
  };

  // --- People: gathered from every file -------------------------------------------------------------
  const people: ClientPlan[] = [];
  const byExt = new Map<string, ClientPlan>(), byEmail = new Map<string, ClientPlan>(), byPhone = new Map<string, ClientPlan>();
  const byName = new Map<string, ClientPlan[]>();
  const index = (p: ClientPlan) => {
    for (const x of p.externalIds) byExt.set(x, p);
    if (p.email) byEmail.set(p.email, p);
    if (p.phone) byPhone.set(p.phone, p);
    const n = fold(`${p.firstName} ${p.lastName}`);
    if (n) byName.set(n, [...(byName.get(n) ?? []).filter((x) => x !== p), p]);
  };
  const nameOf = (f: File, r: string[]) => {
    const first = cell(f, r, "firstName"), last = cell(f, r, "lastName"), full = cell(f, r, "fullName");
    if (first || last) return { first: first || last, last: first ? last : "" };
    if (full) return { first: full, last: "" }; // kept as written: names aren't split by guessing
    return { first: "", last: "" };
  };
  const contact = (f: File, r: string[], row: number) => {
    const e = readEmail(cell(f, r, "email"));
    if (e.problem) c.add("warning", f.filename, row, "email", e.problem);
    const p = readPhone(cell(f, r, "phone"), country);
    if (p.problem) c.add("warning", f.filename, row, "phone", p.problem);
    return { email: e.value, phone: p.value, ext: cell(f, r, "externalId") || null };
  };
  /** Find who a row is about. */
  const findPerson = (f: File, r: string[], row: number) => {
    const { email, phone, ext } = contact(f, r, row);
    const hit = (ext && byExt.get(ext)) || (email && byEmail.get(email)) || (phone && byPhone.get(phone));
    if (hit) return { person: hit, email, phone, ext };
    const n = nameOf(f, r);
    const same = byName.get(fold(`${n.first} ${n.last}`)) ?? [];
    if (same.length === 1 && !email && !phone && !ext) return { person: same[0]!, email, phone, ext };
    if (same.length > 1) c.add("warning", f.filename, row, null, `more than one client is called “${n.first} ${n.last}”; add an email or client ID to this row`);
    return { person: null, email, phone, ext };
  };
  const newPerson = (ref: RowRef, email: string | null, phone: string | null, ext: string | null, first: string, last: string): ClientPlan => {
    const p: ClientPlan = { key: email ?? phone ?? ext ?? `${ref.file.id}:${ref.row}`, refs: [ref], externalIds: new Set(ext ? [ext] : []), email, phone, firstName: first, lastName: last, memberSince: null, marketingEmail: false, creditCents: 0, tags: new Set(), waiverSignedAt: null, notes: [], emergency: null, dateOfBirth: null, visits: 0, firstVisit: null, lastVisit: null, inactive: false };
    people.push(p);
    index(p);
    return p;
  };

  let namesKeptWhole = 0;
  for (const f of files.filter((x) => x.kind === "clients")) {
    const rows = dataRows(f);
    for (const { r, row } of rows) {
      accounted.rows++;
      const ref = { file: f, row };
      const { email, phone, ext } = contact(f, r, row);
      const n = nameOf(f, r);
      if (!cell(f, r, "firstName") && !cell(f, r, "lastName") && cell(f, r, "fullName")) namesKeptWhole++;
      if (!n.first && !email) { c.add("warning", f.filename, row, null, "no name or email: not moved"); record(ref, "client", "skipped", null, "no name or email"); continue; }
      const existing = (ext && byExt.get(ext)) || (email && byEmail.get(email)) || (phone && !email && byPhone.get(phone));
      const p = existing || newPerson(ref, email, phone, ext, n.first, n.last);
      if (existing) {
        // The same person twice: fill gaps, report clashes.
        existing.refs.push(ref);
        if (ext) existing.externalIds.add(ext);
        if (!existing.email && email) existing.email = email;
        if (!existing.phone && phone) existing.phone = phone;
        if (phone && existing.phone && existing.phone !== phone) c.add("info", f.filename, row, "phone", `same person as row ${existing.refs[0]!.row} with a different phone; kept the first`);
        index(existing);
        record(ref, "client", "merged", null, `same person as ${existing.refs[0]!.file.filename} row ${existing.refs[0]!.row}`);
      }
      const since = readD(f, r, row, "memberSince", rows);
      if (since && (!p.memberSince || since < p.memberSince)) p.memberSince = since;
      const opt = readYes(cell(f, r, "marketingEmail"));
      if (opt.problem) c.add("info", f.filename, row, "marketingEmail", `${opt.problem}; treated as not agreed`);
      if (opt.value) p.marketingEmail = true;
      const credit = readMoney(cell(f, r, "creditBalance"));
      if (credit.problem) c.add("warning", f.filename, row, "creditBalance", credit.problem);
      if (credit.value && credit.value > 0) p.creditCents = Math.max(p.creditCents, credit.value);
      for (const t of cell(f, r, "tags").split(/[;,|]/).map((x) => x.trim()).filter(Boolean)) p.tags.add(t);
      const waiver = cell(f, r, "waiverSignedAt");
      if (waiver) {
        const yes = readYes(waiver);
        const d = yes.value === null ? readD(f, r, row, "waiverSignedAt", rows) : null;
        if (yes.value || d) p.waiverSignedAt = d ?? p.waiverSignedAt ?? today;
      }
      const note = cell(f, r, "notes");
      if (note && !p.notes.includes(note)) p.notes.push(note);
      const em = [cell(f, r, "emergencyName"), readPhone(cell(f, r, "emergencyPhone"), country).value ?? cell(f, r, "emergencyPhone")].filter(Boolean).join(", ");
      if (em) p.emergency = em;
      const dob = readD(f, r, row, "dateOfBirth", rows, true);
      if (dob) p.dateOfBirth = dob.slice(0, 10);
      const v = readCount(cell(f, r, "visits"));
      if (typeof v.value === "number") p.visits = Math.max(p.visits, v.value);
      const lv = readD(f, r, row, "lastVisit", rows);
      if (lv && (!p.lastVisit || lv > p.lastVisit)) p.lastVisit = lv;
      const st = cell(f, r, "status").toLowerCase();
      if (/inactive|deleted|archived|suspended|terminated/.test(st)) p.inactive = true;
    }
  }
  if (namesKeptWhole) c.add("info", "", null, "fullName", `${namesKeptWhole} names were in one column, so they're kept exactly as written (not split into first and last)`);

  // --- Visit history: a summary per client -------------------------------------------------------------
  for (const f of files.filter((x) => x.kind === "visits")) {
    const rows = dataRows(f);
    for (const { r, row } of rows) {
      accounted.rows++;
      const ref = { file: f, row };
      let { person } = findPerson(f, r, row);
      if (!person) {
        const { email, phone, ext } = contact(f, r, row), n = nameOf(f, r);
        if (email && n.first) person = newPerson(ref, email, phone, ext, n.first, n.last);
      }
      if (!person) { record(ref, "visit", "skipped", null, "no matching client"); c.add("warning", f.filename, row, null, "visit for someone we can't match to a client: left out of their history"); continue; }
      const st = cell(f, r, "status").toLowerCase();
      if (/no.?show|late.?cancel|cancel|absent|missed/.test(st)) { record(ref, "visit", "skipped", null, `not attended (${st})`); continue; }
      const d = readD(f, r, row, "startsAt", rows) ?? readD(f, r, row, "date", rows);
      if (!d) { record(ref, "visit", "skipped", null, "no readable date"); continue; }
      person.visits++;
      if (!person.firstVisit || d < person.firstVisit) person.firstVisit = d;
      if (!person.lastVisit || d > person.lastVisit) person.lastVisit = d;
      record(ref, "visit", "merged", null, "counted in the client's visit history");
    }
  }

  // --- Packs and memberships (gathered first, written after the people) ---------------------------------
  type PackPlan = { ref: RowRef; person: ClientPlan; recurring: boolean; name: string; remaining: number | null; total: number | null; purchasedAt: string | null; startsAt: string | null; expiresAt: string | null; priceCents: number; interval: { value: number; unit: "weeks" | "months" } | null; nextBilling: string | null; endDate: string | null; weekly: number | null };
  const packs: PackPlan[] = [];
  const attach = (f: File, r: string[], row: number) => {
    const ref = { file: f, row };
    const found = findPerson(f, r, row);
    if (found.person) { found.person.refs.push(ref); return found.person; }
    const n = nameOf(f, r);
    if (found.email && n.first) return newPerson(ref, found.email, found.phone, found.ext, n.first, n.last);
    return null;
  };
  for (const f of files.filter((x) => x.kind === "packages")) {
    const rows = dataRows(f);
    for (const { r, row } of rows) {
      accounted.rows++;
      const ref = { file: f, row };
      const name = cell(f, r, "name");
      const rem = readCount(cell(f, r, "remaining")), tot = readCount(cell(f, r, "total"));
      if (rem.problem) c.add("warning", f.filename, row, "remaining", rem.problem);
      const expiresAt = readD(f, r, row, "expiresAt", rows);
      if (!name) { c.add("warning", f.filename, row, "name", "pack has no name: not moved"); record(ref, "package", "skipped", null, "no name"); bump("packages", "skipped"); continue; }
      if (expiresAt && expiresAt.slice(0, 10) < today) { record(ref, "package", "skipped", null, "already expired"); bump("packages", "expired"); continue; }
      const unlimited = rem.value === "unlimited" || (rem.value === null && tot.value === "unlimited");
      const remaining = typeof rem.value === "number" ? rem.value : null;
      if (!unlimited && remaining === null) { c.add("warning", f.filename, row, "remaining", "no classes-left number: not moved"); record(ref, "package", "skipped", null, "no classes left given"); bump("packages", "skipped"); continue; }
      if (!unlimited && remaining! <= 0) { record(ref, "package", "skipped", null, "no classes left"); bump("packages", "used up"); continue; }
      const person = attach(f, r, row);
      if (!person) { c.add("warning", f.filename, row, null, `can't match “${name}” to a client (add their email or client ID): not moved`); record(ref, "package", "skipped", null, "no matching client"); bump("packages", "skipped"); continue; }
      const total = typeof tot.value === "number" ? tot.value : null;
      if (total !== null && remaining !== null && remaining > total) c.add("warning", f.filename, row, "remaining", `${remaining} classes left is more than the ${total} in the pack; moved as ${remaining} left`);
      const price = readMoney(cell(f, r, "pricePaid"));
      if (price.problem) c.add("info", f.filename, row, "pricePaid", price.problem);
      packs.push({ ref, person, recurring: false, name, remaining: unlimited ? null : remaining, total: unlimited ? null : Math.max(total ?? 0, remaining ?? 0), purchasedAt: readD(f, r, row, "purchasedAt", rows), startsAt: readD(f, r, row, "startsAt", rows), expiresAt, priceCents: price.value ?? 0, interval: null, nextBilling: null, endDate: null, weekly: null });
    }
  }
  for (const f of files.filter((x) => x.kind === "memberships")) {
    const rows = dataRows(f);
    for (const { r, row } of rows) {
      accounted.rows++;
      const ref = { file: f, row };
      const name = cell(f, r, "name") || "Membership";
      const st = cell(f, r, "status").toLowerCase();
      if (/cancel|terminat|ended|expired|inactive|suspend|declin/.test(st)) { record(ref, "membership", "skipped", null, `not active (${st})`); bump("memberships", "not active"); continue; }
      const endDate = readD(f, r, row, "endDate", rows);
      if (endDate && endDate.slice(0, 10) < today) { record(ref, "membership", "skipped", null, "already ended"); bump("memberships", "not active"); continue; }
      const person = attach(f, r, row);
      if (!person) { c.add("warning", f.filename, row, null, `can't match “${name}” to a client (add their email or client ID): not moved`); record(ref, "membership", "skipped", null, "no matching client"); bump("memberships", "skipped"); continue; }
      const price = readMoney(cell(f, r, "price"));
      if (price.problem) c.add("warning", f.filename, row, "price", price.problem);
      const interval = readInterval(cell(f, r, "interval"));
      if (interval.problem) c.add("warning", f.filename, row, "interval", `${interval.problem}; taken as monthly`);
      const next = readD(f, r, row, "nextBillingDate", rows);
      if (!next) c.add("warning", f.filename, row, "nextBillingDate", "no next billing date: it will renew one period after today");
      const weekly = readCount(cell(f, r, "classesPerWeek"));
      packs.push({ ref, person, recurring: true, name, remaining: null, total: null, purchasedAt: readD(f, r, row, "startDate", rows), startsAt: readD(f, r, row, "startDate", rows), expiresAt: null, priceCents: price.value ?? 0, interval: interval.value ?? { value: 1, unit: "months" }, nextBilling: next, endDate, weekly: typeof weekly.value === "number" ? weekly.value : null });
    }
  }

  // --- Bookings (matched to classes already on our schedule) --------------------------------------------
  type BookPlan = { ref: RowRef; person: ClientPlan; sessionId: string; label: string };
  const books: BookPlan[] = [];
  const bookingFiles = files.filter((x) => x.kind === "bookings");
  const sessionsAhead = bookingFiles.length
    ? await tx.select({ id: classSessions.id, startsAt: classSessions.startsAt, capacity: classSessions.capacity, type: classTypes.name, location: locations.name }).from(classSessions).innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId)).innerJoin(locations, eq(locations.id, classSessions.locationId))
      .where(and(eq(classSessions.orgId, job.orgId), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, now)))
    : [];
  for (const f of bookingFiles) {
    const rows = dataRows(f);
    for (const { r, row } of rows) {
      accounted.rows++;
      const ref = { file: f, row };
      const dt = readD(f, r, row, "startsAt", rows);
      let local = dt && dt.length > 10 ? dt : null;
      if (!local) {
        const d = readD(f, r, row, "date", rows), t = readTime(cell(f, r, "time"));
        if (d && t.value) local = `${d.slice(0, 10)} ${t.value}`;
        else if (d && d.length > 10) local = d;
      }
      if (!local) { c.add("warning", f.filename, row, "date", "no readable class date and time: not moved"); record(ref, "booking", "skipped", null, "no date and time"); bump("bookings", "skipped"); continue; }
      const at = DateTime.fromFormat(local, "yyyy-MM-dd HH:mm", { zone });
      if (at.toJSDate() <= now) { record(ref, "booking", "skipped", null, "in the past"); bump("bookings", "past"); continue; }
      const cls = fold(cell(f, r, "className")), loc = fold(cell(f, r, "location"));
      const same = sessionsAhead.filter((s) => s.startsAt.getTime() === at.toJSDate().getTime() && (!loc || fold(s.location).includes(loc) || loc.includes(fold(s.location))));
      const match = same.length === 1 && (!cls || fold(same[0]!.type).includes(cls) || cls.includes(fold(same[0]!.type))) ? same[0] : same.find((s) => cls && (fold(s.type).includes(cls) || cls.includes(fold(s.type))));
      const label = `${cell(f, r, "className") || "class"} on ${at.toFormat("ccc d LLL")} at ${at.toFormat("h:mma").toLowerCase()}`;
      if (!match) { c.add("warning", f.filename, row, "className", `no class on our schedule for ${label}: put the schedule in first, then check again`); record(ref, "booking", "skipped", null, "no matching class"); bump("bookings", "no matching class"); continue; }
      const person = attach(f, r, row);
      if (!person) { c.add("warning", f.filename, row, null, `can't match the booking for ${label} to a client: not moved`); record(ref, "booking", "skipped", null, "no matching client"); bump("bookings", "skipped"); continue; }
      books.push({ ref, person, sessionId: match.id, label });
    }
  }

  // --- Write: people ------------------------------------------------------------------------------------
  const clientIds = new Map<ClientPlan, string>();
  const tagIds = new Map<string, string>();
  const skippedPeople = new Set<ClientPlan>();
  for (const p of people) {
    const ref = p.refs[0]!;
    const primary = ref.file.kind === "clients";
    if (!p.email) {
      skippedPeople.add(p);
      const holds = packs.filter((x) => x.person === p).length;
      c.add(holds ? "warning" : "info", ref.file.filename, ref.row, "email", `${p.firstName} ${p.lastName}`.trim() + ` has no email, so they can't have an account${holds ? ` (and ${holds === 1 ? "a pack or membership" : `${holds} packs or memberships`} won't move)` : ""}: add one and check again`);
      if (primary) record(ref, "client", "skipped", null, "no email");
      bump("clients", "no email");
      continue;
    }
    let [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${p.email}`);
    let action: "created" | "linked" = "linked";
    if (!u) {
      [u] = await tx.insert(users).values({ email: p.email, firstName: p.firstName || p.email.split("@")[0]!, lastName: p.lastName, phone: p.phone }).returning();
      action = "created";
    }
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.orgId, job.orgId), eq(memberships.userId, u!.id)));
    if (m && m.role !== "client") {
      c.add("warning", ref.file.filename, ref.row, "email", `${p.email} is on this studio's team, so they weren't added as a client`);
      skippedPeople.add(p);
      if (primary) record(ref, "client", "skipped", u!.id, "on the team");
      continue;
    }
    if (!m) {
      const [created] = await tx.insert(memberships).values({ orgId: job.orgId, userId: u!.id, role: "client", active: !p.inactive, marketingEmail: p.marketingEmail, marketingConsentAt: p.marketingEmail ? now : null, ...(p.memberSince ? { createdAt: new Date(`${p.memberSince.slice(0, 10)}T00:00:00Z`) } : {}) }).returning();
      records.push({ jobId, orgId: job.orgId, fileId: ref.file.id, rowNumber: ref.row, entity: "membership_row", entityId: created!.id, action: "created", reason: null });
      bump("clients", action === "created" ? "new" : "already had an account");
    } else {
      action = "linked";
      bump("clients", "already a client here");
    }
    if (primary) record(ref, "client", action, u!.id, action === "linked" ? "existing account: their own details were kept" : null);
    clientIds.set(p, u!.id);
    if (p.marketingEmail) bump("clients", "agreed to marketing");
    // Tags, waiver, credit and history
    for (const t of p.tags) {
      let id = tagIds.get(t.toLowerCase());
      if (!id) {
        const [existing] = await tx.select({ id: clientTags.id }).from(clientTags).where(and(eq(clientTags.orgId, job.orgId), sql`lower(${clientTags.name}) = ${t.toLowerCase()}`));
        id = existing?.id ?? (await tx.insert(clientTags).values({ orgId: job.orgId, name: t.slice(0, 40) }).returning())[0]!.id;
        tagIds.set(t.toLowerCase(), id);
      }
      await tx.insert(clientTagAssignments).values({ orgId: job.orgId, clientId: u!.id, tagId: id }).onConflictDoNothing();
    }
    if (p.waiverSignedAt && org!.waiverRequired) {
      const [w] = await tx.select({ id: clientWaivers.id }).from(clientWaivers).where(and(eq(clientWaivers.orgId, job.orgId), eq(clientWaivers.clientId, u!.id), isNull(clientWaivers.revokedAt)));
      if (!w) {
        const [nw] = await tx.insert(clientWaivers).values({ orgId: job.orgId, clientId: u!.id, method: "confirmed_by_staff", signedName: null, recordedBy: actorId, recordedAt: new Date(`${p.waiverSignedAt.slice(0, 10)}T00:00:00Z`) }).returning();
        records.push({ jobId, orgId: job.orgId, fileId: ref.file.id, rowNumber: ref.row, entity: "waiver", entityId: nw!.id, action: "created", reason: `signed in ${source}` });
        bump("clients", "waiver moved");
      }
    }
    if (p.creditCents > 0) {
      const g = await grantCredit(tx, { orgId: job.orgId, clientId: u!.id, amountCents: p.creditCents, currency: org!.currency, source: "studio", sourceId: jobId, note: `Credit moved from ${source}`, expiresAt: new Date(now.getTime() + 5 * 365 * DAY), by: actorId });
      records.push({ jobId, orgId: job.orgId, fileId: ref.file.id, rowNumber: ref.row, entity: "credit", entityId: g.id, action: "created", reason: null });
      bump("credit", "cents", p.creditCents);
      bump("credit", "clients");
    }
    if (p.visits || p.lastVisit || p.notes.length || p.emergency || p.dateOfBirth || p.memberSince) {
      const vals = { visits: p.visits, firstVisitAt: p.firstVisit ? new Date(`${p.firstVisit.slice(0, 10)}T00:00:00Z`) : null, lastVisitAt: p.lastVisit ? new Date(`${p.lastVisit.slice(0, 10)}T00:00:00Z`) : null, memberSince: p.memberSince ? new Date(`${p.memberSince.slice(0, 10)}T00:00:00Z`) : null, notes: p.notes.join("\n\n") || null, emergencyContact: p.emergency, dateOfBirth: p.dateOfBirth, source, jobId };
      const [h] = await tx.insert(clientHistory).values({ orgId: job.orgId, clientId: u!.id, ...vals }).onConflictDoUpdate({ target: [clientHistory.orgId, clientHistory.clientId], set: vals }).returning();
      records.push({ jobId, orgId: job.orgId, fileId: ref.file.id, rowNumber: ref.row, entity: "history", entityId: h!.id, action: "created", reason: null });
      if (p.visits) bump("visits", "counted", p.visits);
    }
  }
  if (!people.length && !files.some((f) => f.kind === "clients")) c.add("blocking", "", null, null, "there's no clients file yet: add the client list first");

  // --- Write: packs and memberships ------------------------------------------------------------------------
  const plans = await tx.select().from(packagePlans).where(eq(packagePlans.orgId, job.orgId));
  const planByName = new Map(plans.map((pl) => [fold(pl.name), pl]));
  let unmatchedPlans = 0;
  const packFor = new Map<ClientPlan, string[]>();
  for (const k of packs) {
    const clientId = clientIds.get(k.person);
    const kind = k.recurring ? "memberships" : "packages";
    if (!clientId) { record(k.ref, k.recurring ? "membership" : "package", "skipped", null, "client not moved (see their row)"); bump(kind, "client not moved"); continue; }
    const plan = planByName.get(fold(k.name));
    if (!plan) unmatchedPlans++;
    const start = k.startsAt ?? k.purchasedAt;
    const nextBilling = k.recurring ? k.nextBilling ?? DateTime.fromJSDate(now, { zone }).plus(k.interval!.unit === "weeks" ? { weeks: k.interval!.value } : { months: k.interval!.value }).toISODate() : null;
    const [pk] = await tx.insert(clientPackages).values({
      orgId: job.orgId, planId: plan?.id ?? null, ownerId: clientId, name: k.name,
      kind: k.recurring ? (plan?.kind ?? "unlimited") : k.remaining === null ? "unlimited" : "credits",
      creditsTotal: k.recurring ? plan?.credits ?? null : k.total, creditsLeft: k.recurring ? (plan?.kind === "credits" ? plan.credits : null) : k.remaining,
      creditsPerCycle: k.recurring && plan?.kind === "credits" ? plan.credits : null,
      validityValue: k.recurring ? k.interval!.value : null, validityUnit: k.recurring ? k.interval!.unit : null,
      startsOn: "purchase", startedAt: start ? new Date(`${start.slice(0, 10)}T00:00:00Z`) : now,
      expiresAt: k.recurring ? DateTime.fromISO(nextBilling!.slice(0, 10), { zone }).startOf("day").toJSDate() : k.expiresAt ? DateTime.fromISO(k.expiresAt.slice(0, 10), { zone }).endOf("day").toJSDate() : null,
      weeklyLimit: k.weekly ?? plan?.weeklyLimit ?? null, classTypeIds: plan?.classTypeIds ?? [],
      billing: k.recurring ? "recurring" : "one_time", stopsRenewingAt: k.recurring && k.endDate ? new Date(`${k.endDate.slice(0, 10)}T00:00:00Z`) : null,
      pricePaidCents: Math.max(0, k.priceCents), currency: org!.currency, soldBy: actorId,
      note: `Moved from ${source} (${k.ref.file.filename}, row ${k.ref.row})`,
      purchasedAt: k.purchasedAt ? new Date(`${k.purchasedAt.slice(0, 10)}T00:00:00Z`) : now,
    }).returning();
    await tx.insert(clientPackageMembers).values({ orgId: job.orgId, packageId: pk!.id, userId: clientId, allocatedCredits: null, addedBy: actorId });
    await tx.insert(packageLedger).values({ orgId: job.orgId, packageId: pk!.id, userId: clientId, change: k.remaining ?? 0, reason: "adjusted", note: `Moved from ${source}`, details: { migrationJob: jobId, file: k.ref.file.filename, row: k.ref.row }, createdBy: actorId });
    record(k.ref, k.recurring ? "membership" : "package", "created", pk!.id, null);
    bump(kind, "moved");
    if (!k.recurring && k.remaining !== null) bump("packages", "classes left", k.remaining);
    if (!k.recurring && k.remaining === null) bump("packages", "unlimited");
    packFor.set(k.person, [...(packFor.get(k.person) ?? []), pk!.id]);
  }
  if (unmatchedPlans) c.add("info", "", null, "name", `${unmatchedPlans} packs or memberships don't match a package you sell here by name; they move with their own name and terms`);
  if (packs.some((k) => k.recurring && clientIds.has(k.person))) c.add("info", "", null, null, "card details can't be moved in a file: memberships move, and clients add a card before their next billing date (or move cards Stripe-to-Stripe if the old system allows it)");

  // --- Write: bookings ------------------------------------------------------------------------------------
  for (const b of books) {
    const clientId = clientIds.get(b.person);
    if (!clientId) { record(b.ref, "booking", "skipped", null, "client not moved"); bump("bookings", "client not moved"); continue; }
    const [dupe] = await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.sessionId, b.sessionId), eq(bookings.clientId, clientId), eq(bookings.status, "confirmed")));
    if (dupe) { record(b.ref, "booking", "skipped", dupe.id, "already booked"); bump("bookings", "already booked"); continue; }
    const [{ n: taken } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.sessionId, b.sessionId), eq(bookings.status, "confirmed")));
    const [s] = await tx.select({ capacity: classSessions.capacity }).from(classSessions).where(eq(classSessions.id, b.sessionId));
    if (taken >= (s?.capacity ?? 0)) { c.add("warning", b.ref.file.filename, b.ref.row, null, `${b.label} is full on our schedule: not booked`); record(b.ref, "booking", "skipped", null, "class full"); bump("bookings", "class full"); continue; }
    const pack = packFor.get(b.person)?.[0] ?? null;
    const [bk] = await tx.insert(bookings).values({ orgId: job.orgId, sessionId: b.sessionId, clientId, source: "staff", payment: pack ? "package" : "pay_later", clientPackageId: pack, bookedBy: actorId }).returning();
    record(b.ref, "booking", "created", bk!.id, pack ? "on their moved pack (the old system already took the class)" : "no pack: pay at the studio");
    bump("bookings", "moved");
    if (!pack) bump("bookings", "without a pack");
  }

  // --- Every row accounted for, reconciliation, summary ---------------------------------------------------
  const intake = job.intake as Record<string, unknown>;
  const told = (k: string) => (typeof intake[k] === "number" ? (intake[k] as number) : null);
  const movedClients = clientIds.size;
  const rec = (label: string, toldN: number | null, found: number, unit: string) => {
    const ok = toldN === null || Math.abs(found - toldN) <= Math.max(2, Math.round(toldN * 0.03));
    return { label, told: toldN, found, ok, note: toldN === null ? "not given on the form" : ok ? "matches what the studio told us" : `the studio told us about ${toldN} ${unit}; ask them before importing` };
  };
  const reconciliation = [
    rec("Clients", told("activeClients"), movedClients, "clients"),
    rec("Active memberships", told("activeMemberships"), counts.memberships?.moved ?? 0, "memberships"),
    rec("Active class packs", told("activePackages"), counts.packages?.moved ?? 0, "packs"),
  ];
  const acc = { ...accounted, ok: accounted.rows === accounted.created + accounted.linked + accounted.merged + accounted.skipped };
  if (!acc.ok) c.add("blocking", "", null, null, "some rows aren't accounted for; this is a bug, so don't import");
  const issueSummary: Report["issueSummary"] = [];
  for (const i of c.issues) {
    const key = `${i.level}|${summaryKey(i.message)}`;
    const found = issueSummary.find((s) => `${s.level}|${summaryKey(s.message)}` === key);
    if (found) found.count++;
    else issueSummary.push({ level: i.level, message: i.message, count: 1 });
  }
  const blocking = c.issues.filter((i) => i.level === "blocking").length, warnings = c.issues.filter((i) => i.level === "warning").length;
  const needsAcknowledging = [
    ...(warnings ? [`${warnings} ${warnings === 1 ? "warning" : "warnings"} (rows that won't move or were moved with a change)`] : []),
    ...reconciliation.filter((x) => !x.ok).map((x) => `${x.label}: ${x.note}`),
  ];
  const out: Report = {
    ranAt: now.toISOString(), mode, sourcePlatform: job.sourcePlatform,
    files: files.map((f) => ({ id: f.id, filename: f.filename, sheet: f.sheet, kind: f.kind, kindLabel: KIND_LABELS[f.kind as Kind] ?? f.kind, dataRows: f.rows!.slice(f.headerRow + 1).filter((r) => r.some((x) => cleanText(x)) && !isTotalRow(r)).length, mapped: Object.fromEntries(Object.entries(f.mapping).map(([k, i]) => [FIELD_LABELS[k] ?? k, f.headers[i] ?? ""])), unmapped: f.headers.filter((_, i) => !Object.values(f.mapping).includes(i) && f.headers[i]) })),
    totals: counts, reconciliation, accounted: acc, issues: c.issues.slice(0, 1000), issueSummary, blocking, warnings, ready: blocking === 0, needsAcknowledging,
  };
  if (mode === "import" && out.ready) {
    for (let i = 0; i < records.length; i += 500) await tx.insert(migrationRecords).values(records.slice(i, i + 500));
  }
  return out;
}

/**
 * Undo an import: removes everything it created, as long as nothing has happened since (a booking,
 * a class used, credit spent). Accounts that already existed are left alone; so are their details.
 */
export async function undoMigration(tx: DbOrTx, job: Job, actorId: string): Promise<{ removed: Record<string, number> }> {
  void actorId;
  const recs = await tx.select().from(migrationRecords).where(and(eq(migrationRecords.jobId, job.id), eq(migrationRecords.action, "created")));
  const ids = (entity: string) => recs.filter((r) => r.entity === entity && r.entityId).map((r) => r.entityId!);
  const pkgIds = [...ids("package"), ...ids("membership")], bookingIds = ids("booking"), grantIds = ids("credit");
  const memberRows = ids("membership_row");
  const newClients = memberRows.length ? (await tx.select({ userId: memberships.userId }).from(memberships).where(inIds(memberships.id, memberRows))).map((m) => m.userId) : [];
  const since = job.importedAt ?? new Date(0);
  // Anything that happened since?
  const problems: string[] = [];
  if (newClients.length) {
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.orgId, job.orgId), inIds(bookings.clientId, newClients), gt(bookings.createdAt, since), bookingIds.length ? sql`${bookings.id} not in (${sql.join(bookingIds.map((i) => sql`${i}`), sql`, `)})` : sql`true`));
    if (n) problems.push(`${n} new ${n === 1 ? "booking" : "bookings"} by moved clients`);
  }
  if (bookingIds.length) {
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(inIds(bookings.id, bookingIds), sql`(${bookings.status} <> 'confirmed' or ${bookings.attendance} <> 'unmarked')`));
    if (n) problems.push(`${n} moved ${n === 1 ? "booking has" : "bookings have"} been cancelled or checked in`);
  }
  if (pkgIds.length) {
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(packageLedger).where(and(inIds(packageLedger.packageId, pkgIds), gt(packageLedger.createdAt, since), sql`${packageLedger.reason} <> 'adjusted'`));
    if (n) problems.push(`moved packs or memberships have been used or changed ${n} ${n === 1 ? "time" : "times"}`);
  }
  if (grantIds.length) {
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(creditLedger).where(and(inIds(creditLedger.grantId, grantIds), sql`${creditLedger.reason} <> 'granted'`));
    if (n) problems.push(`moved credit has been used ${n} ${n === 1 ? "time" : "times"}`);
  }
  if (problems.length) throw conflict("migration_in_use", `This import can't be undone because things have happened since: ${problems.join("; ")}. Fix the rows by hand instead.`);

  const removed: Record<string, number> = {};
  const del = async (label: string, p: Promise<unknown[]>) => { removed[label] = (await p).length; };
  if (bookingIds.length) await del("bookings", tx.delete(bookings).where(inIds(bookings.id, bookingIds)).returning({ id: bookings.id }));
  if (pkgIds.length) {
    await tx.delete(packageLedger).where(inIds(packageLedger.packageId, pkgIds));
    await tx.delete(clientPackageMembers).where(inIds(clientPackageMembers.packageId, pkgIds));
    await del("packs and memberships", tx.delete(clientPackages).where(inIds(clientPackages.id, pkgIds)).returning({ id: clientPackages.id }));
  }
  if (grantIds.length) {
    await tx.delete(creditLedger).where(inIds(creditLedger.grantId, grantIds));
    await del("credit", tx.delete(creditGrants).where(inIds(creditGrants.id, grantIds)).returning({ id: creditGrants.id }));
  }
  if (ids("waiver").length) await del("waivers", tx.delete(clientWaivers).where(inIds(clientWaivers.id, ids("waiver"))).returning({ id: clientWaivers.id }));
  if (ids("history").length) await del("visit histories", tx.delete(clientHistory).where(inIds(clientHistory.id, ids("history"))).returning({ id: clientHistory.id }));
  if (newClients.length) {
    await tx.delete(clientTagAssignments).where(and(eq(clientTagAssignments.orgId, job.orgId), inIds(clientTagAssignments.clientId, newClients)));
    await del("clients", tx.delete(memberships).where(inIds(memberships.id, memberRows)).returning({ id: memberships.id }));
    // Accounts we created and that aren't used anywhere else go too.
    const created = ids("client");
    if (created.length) {
      const stillUsed = new Set((await tx.select({ u: memberships.userId }).from(memberships).where(inIds(memberships.userId, created))).map((m) => m.u));
      const gone = created.filter((u) => !stillUsed.has(u));
      if (gone.length) await tx.delete(users).where(inIds(users.id, gone));
    }
  }
  await tx.delete(migrationRecords).where(eq(migrationRecords.jobId, job.id));
  return { removed };
}

/**
 * A random sample to check by eye: each moved client's row in the old file next to what they have
 * here now. Our staff (and the studio) go through these before marking the move verified.
 */
export async function verificationSample(db: DbOrTx, job: Job, size = 10) {
  const recs = await db.select().from(migrationRecords).where(and(eq(migrationRecords.jobId, job.id), eq(migrationRecords.entity, "client"), sql`${migrationRecords.action} in ('created', 'linked')`)).orderBy(sql`random()`).limit(size);
  const files = new Map((await db.select().from(migrationFiles).where(eq(migrationFiles.jobId, job.id))).map((f) => [f.id, f]));
  const out = [];
  for (const r of recs) {
    const f = r.fileId ? files.get(r.fileId) : undefined;
    const row = f?.rows?.[r.rowNumber - 1];
    const old = f && row ? Object.fromEntries(f.headers.map((h, i) => [h, row[i] ?? ""]).filter(([h, v]) => h && v)) : null;
    const [u] = await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone }).from(users).where(eq(users.id, r.entityId!));
    const [m] = await db.select({ marketingEmail: memberships.marketingEmail, active: memberships.active, since: memberships.createdAt }).from(memberships).where(and(eq(memberships.orgId, job.orgId), eq(memberships.userId, r.entityId!)));
    const pkgs = await db.select({ name: clientPackages.name, billing: clientPackages.billing, creditsLeft: clientPackages.creditsLeft, expiresAt: clientPackages.expiresAt }).from(clientPackages).where(and(eq(clientPackages.orgId, job.orgId), eq(clientPackages.ownerId, r.entityId!), isNull(clientPackages.cancelledAt)));
    const credit = await db.select({ cents: sql<number>`coalesce(sum(${creditGrants.remainingCents}), 0)::int` }).from(creditGrants).where(and(eq(creditGrants.orgId, job.orgId), eq(creditGrants.clientId, r.entityId!)));
    const [h] = await db.select().from(clientHistory).where(and(eq(clientHistory.orgId, job.orgId), eq(clientHistory.clientId, r.entityId!)));
    const upcoming = await db.select({ n: sql<number>`count(*)::int` }).from(bookings).innerJoin(classSessions, eq(classSessions.id, bookings.sessionId)).where(and(eq(bookings.orgId, job.orgId), eq(bookings.clientId, r.entityId!), eq(bookings.status, "confirmed"), gt(classSessions.startsAt, new Date())));
    out.push({
      clientId: r.entityId, action: r.action, file: f?.filename ?? null, row: r.rowNumber, old,
      now: u ? { name: `${u.firstName} ${u.lastName}`.trim(), email: u.email, phone: u.phone, agreedToMarketing: m?.marketingEmail ?? false, active: m?.active ?? false, clientSince: m?.since?.toISOString().slice(0, 10) ?? null, packs: pkgs.map((p) => ({ name: p.name, recurring: p.billing === "recurring", classesLeft: p.creditsLeft, until: p.expiresAt?.toISOString().slice(0, 10) ?? null })), creditCents: credit[0]?.cents ?? 0, visits: h?.visits ?? 0, lastVisit: h?.lastVisitAt?.toISOString().slice(0, 10) ?? null, upcomingBookings: upcoming[0]?.n ?? 0 } : null,
    });
  }
  return out;
}

/** Raw rows from old systems are kept only until 30 days after the move is verified (or undone). */
export async function purgeMigrationFiles(db: DbOrTx, now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * DAY);
  const jobs = await db.select({ id: migrationJobs.id }).from(migrationJobs).where(sql`coalesce(${migrationJobs.verifiedAt}, ${migrationJobs.undoneAt}) < ${cutoff}`);
  let files = 0;
  for (const j of jobs) {
    const r = await db.update(migrationFiles).set({ rows: null, purgedAt: now }).where(and(eq(migrationFiles.jobId, j.id), isNull(migrationFiles.purgedAt))).returning({ id: migrationFiles.id });
    files += r.length;
  }
  // Temporary passwords for old systems: gone after the move, or after 7 days whatever happens.
  const secrets = await db.update(migrationJobs).set({ accessSecretEnc: null }).where(and(sql`${migrationJobs.accessSecretEnc} is not null`, sql`(${migrationJobs.accessDeleteAfter} < ${now} or ${migrationJobs.importedAt} is not null)`)).returning({ id: migrationJobs.id });
  return { files, secrets: secrets.length };
}

const inIds = (col: Parameters<typeof inArray>[0], ids: string[]) => inArray(col, ids);
