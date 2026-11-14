/**
 * Report exports.
 *  - CSV: the raw rows behind a report (one row per class, sale, client, lead or day), for the
 *    same period and filters as on screen. Opens in Excel, Numbers or Google Sheets.
 *  - Visual: a one-page summary that's quick to read and looks good printed or saved as PDF
 *    (A4): headline numbers with their change, a plain-English summary, and simple charts.
 *
 * Exports carry no contact details: names only where the report already shows them.
 */
import { sql, type SQL } from "drizzle-orm";
import { DateTime } from "luxon";
import type { DbOrTx } from "../../db/client.js";

const n = (v: unknown) => Number(v ?? 0);
const cents = (c: unknown) => (n(c) / 100).toFixed(2);

/** CSV that spreadsheets open cleanly: quoted cells, formulas neutralised, UTF-8 with a BOM. */
export function toCsv(header: string[], rows: unknown[][]) {
  const cell = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return `"${(/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export async function csvFor(db: DbOrTx, org: { id: string; timezone: string; currency: string }, section: string, from: Date, to: Date, scope: SQL) {
  const tz = org.timezone;
  const local = (d: unknown, f = "yyyy-MM-dd") => (d ? DateTime.fromJSDate(new Date(d as string), { zone: tz }).toFormat(f) : "");
  if (section === "classes") {
    const r = await db.execute<Record<string, string>>(sql`
      select cs.starts_at, cs.ends_at, ct.name as class, ct.kind, cs.status, cs.auto_cancelled, cs.capacity,
        (select u.first_name || ' ' || u.last_name from users u where u.id = cs.instructor_id) as instructor,
        l.name as location, (select r.name from rooms r where r.id = cs.room_id) as room,
        (select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed') as booked,
        (select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed' and b.attendance = 'present') as attended,
        (select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed' and b.attendance = 'no_show') as no_shows
      from class_sessions cs join class_types ct on ct.id = cs.class_type_id join locations l on l.id = cs.location_id
      where cs.org_id = ${org.id} and cs.starts_at >= ${from} and cs.starts_at < ${to} and cs.ends_at < now() ${scope}
      order by cs.starts_at`);
    return {
      header: ["Date", "Starts", "Ends", "Class", "Type", "Instructor", "Location", "Room", "Spots", "Booked", "Attended", "No-shows", "How full (%)", "Status"],
      rows: r.rows.map((x) => [local(x.starts_at), local(x.starts_at, "HH:mm"), local(x.ends_at, "HH:mm"), x.class, x.kind === "appointment" ? "Appointment" : "Class", x.instructor ?? "", x.location, x.room ?? "", n(x.capacity), n(x.booked), n(x.attended), n(x.no_shows), x.status === "cancelled" ? "" : Math.round((n(x.booked) / Math.max(1, n(x.capacity))) * 100), x.status === "cancelled" ? (String(x.auto_cancelled) === "true" ? "Cancelled automatically" : "Cancelled") : "Held"]),
    };
  }
  if (section === "sales") {
    const r = await db.execute<Record<string, string>>(sql`
      select number, receipt_number, issued_at, paid_at, bill_to->>'name' as client, source, lines, subtotal_cents, discount_cents, credit_cents, total_cents, tax_cents, refunded_cents, status, payment_method
      from invoices where org_id = ${org.id} and issued_at >= ${from} and issued_at < ${to} order by issued_at`);
    const what = (lines: unknown) => (Array.isArray(lines) ? lines : []).map((l: { description: string; quantity: number }) => (l.quantity > 1 ? `${l.description} x${l.quantity}` : l.description)).join("; ");
    return {
      header: ["Invoice", "Receipt", "Issued", "Paid", "Client", "What", "Source", "Currency", "Subtotal", "Discount", "Studio credit", "Total", "Tax included", "Refunded", "Status", "Paid by"],
      rows: r.rows.map((x) => [x.number, x.receipt_number ?? "", local(x.issued_at), local(x.paid_at), x.client, what(x.lines), x.source, org.currency, cents(x.subtotal_cents), cents(x.discount_cents), cents(x.credit_cents), cents(x.total_cents), cents(x.tax_cents), cents(x.refunded_cents), x.status, x.payment_method ?? ""]),
    };
  }
  if (section === "clients") {
    const r = await db.execute<Record<string, string>>(sql`
      select u.first_name || ' ' || u.last_name as name, m.created_at as joined, m.source,
        (select count(*) from bookings b join class_sessions s on s.id = b.session_id where b.client_id = u.id and b.org_id = m.org_id and b.status = 'confirmed' and b.attendance = 'present' and s.starts_at >= ${from} and s.starts_at < ${to}) as visits,
        (select count(*) from bookings b where b.client_id = u.id and b.org_id = m.org_id and b.status = 'confirmed' and b.attendance = 'present') as all_visits,
        (select max(s.starts_at) from bookings b join class_sessions s on s.id = b.session_id where b.client_id = u.id and b.org_id = m.org_id and b.status = 'confirmed' and b.attendance = 'present') as last_visit,
        (select min(s.starts_at) from bookings b join class_sessions s on s.id = b.session_id where b.client_id = u.id and b.org_id = m.org_id and b.status = 'confirmed' and s.starts_at > now()) as next_booking
      from memberships m join users u on u.id = m.user_id where m.org_id = ${org.id} and m.role = 'client' order by 4 desc, 1`);
    return { header: ["Client", "Joined", "Came through", "Visits in period", "Visits ever", "Last visit", "Next booking"], rows: r.rows.map((x) => [x.name, local(x.joined), x.source === "classpass" ? "ClassPass" : "Direct", n(x.visits), n(x.all_visits), local(x.last_visit), local(x.next_booking)]) };
  }
  if (section === "conversion") {
    const r = await db.execute<Record<string, string>>(sql`
      select created_at, coalesce(first_name || ' ' || coalesce(last_name, ''), '') as name, source, campaign_name, status, joined_at, bought_at from leads
      where org_id = ${org.id} and created_at >= ${from} and created_at < ${to} order by created_at`);
    return { header: ["Came in", "Name", "Source", "Campaign", "Status", "Joined", "First purchase"], rows: r.rows.map((x) => [local(x.created_at), (x.name ?? "").trim(), x.source, x.campaign_name ?? "", x.status, local(x.joined_at), local(x.bought_at)]) };
  }
  if (section === "instructors") {
    const r = await db.execute<Record<string, string>>(sql`
      select u.first_name || ' ' || u.last_name as name,
        count(*) filter (where ct.kind = 'class') as classes, count(*) filter (where ct.kind = 'appointment') as appointments,
        count(*) filter (where cs.cover_for_instructor_id is not null) as covers,
        sum(cs.capacity) filter (where ct.kind = 'class') as capacity,
        sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed')) filter (where ct.kind = 'class') as booked,
        sum((select count(*) from bookings b where b.session_id = cs.id and b.status = 'confirmed' and b.attendance = 'present')) as visits
      from class_sessions cs join class_types ct on ct.id = cs.class_type_id join users u on u.id = cs.instructor_id
      where cs.org_id = ${org.id} and cs.status = 'scheduled' and cs.starts_at >= ${from} and cs.starts_at < ${to} and cs.ends_at < now()
      group by u.id, u.first_name, u.last_name order by 2 desc`);
    return { header: ["Instructor", "Classes", "Appointments", "Covers", "Booked per class", "How full (%)", "Visits"], rows: r.rows.map((x) => [x.name, n(x.classes), n(x.appointments), n(x.covers), n(x.classes) ? (n(x.booked) / n(x.classes)).toFixed(1) : "0", n(x.capacity) ? Math.round((n(x.booked) / n(x.capacity)) * 100) : 0, n(x.visits)]) };
  }
  // Overview: one row per day.
  const r = await db.execute<Record<string, string>>(sql`
    with days as (select generate_series(date_trunc('day', ${from}::timestamptz at time zone ${tz}), date_trunc('day', ${to}::timestamptz at time zone ${tz}) - interval '1 day', interval '1 day') as d)
    select to_char(d, 'YYYY-MM-DD') as day,
      (select coalesce(sum(total_cents - refunded_cents), 0) from invoices i where i.org_id = ${org.id} and i.status in ('paid','partly_refunded','refunded') and (i.paid_at at time zone ${tz})::date = d::date) as money,
      (select count(*) from class_sessions s join class_types t on t.id = s.class_type_id where s.org_id = ${org.id} and t.kind = 'class' and s.status = 'scheduled' and s.ends_at < now() and (s.starts_at at time zone ${tz})::date = d::date) as classes,
      (select count(*) from bookings b join class_sessions s on s.id = b.session_id where b.org_id = ${org.id} and b.status = 'confirmed' and b.attendance = 'present' and (s.starts_at at time zone ${tz})::date = d::date) as visits,
      (select count(*) from memberships m where m.org_id = ${org.id} and m.role = 'client' and (m.created_at at time zone ${tz})::date = d::date) as new_clients
    from days order by d`);
  return { header: ["Date", `Money in (${org.currency})`, "Classes held", "Visits", "New clients"], rows: r.rows.map((x) => [x.day, cents(x.money), n(x.classes), n(x.visits), n(x.new_clients)]) };
}

// --- The visual report --------------------------------------------------------------------
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
type Metric = { label: string; display: string; explain: string; change: { text: string; direction: "up" | "down" | "flat"; good: boolean | null } };
const INK = "#17201c", MUTED = "#55605a", LINE = "#e3e8e3", SOFT = "#f4f6f4", ACCENT = "#0c6156", ACCENT_SOFT = "#cfe6e0", GOOD = "#166530", BAD = "#9a3412";

/** Horizontal bars: label, bar, value. Bars share one colour; the value is printed, so no axis is needed. */
function hbars(rows: { label: string; value: number; display: string; note?: string }[], max = Math.max(1, ...rows.map((r) => r.value))) {
  if (!rows.length) return `<p class="empty">Nothing in this period.</p>`;
  return `<table class="hb">${rows.map((r) => `<tr><td class="hl">${esc(r.label)}${r.note ? `<span>${esc(r.note)}</span>` : ""}</td><td class="hbar"><div style="width:${Math.max(1.5, (r.value / max) * 100).toFixed(1)}%"></div></td><td class="hv">${esc(r.display)}</td></tr>`).join("")}</table>`;
}

/** Vertical columns over time, with the highest and latest values labelled. */
function columns(series: { label: string; value: number; display: string }[], title: string) {
  if (!series.length) return "";
  const W = 640, H = 170, pad = 22, bw = (W - pad * 2) / series.length;
  const max = Math.max(1, ...series.map((s) => s.value));
  const top = series.reduce((a, s, i) => (s.value > series[a]!.value ? i : a), 0);
  const step = Math.ceil(series.length / 8);
  const bars = series
    .map((s, i) => {
      const h = Math.max(s.value > 0 ? 2 : 0, ((s.value / max) * (H - 46)));
      const x = pad + i * bw + bw * 0.18, y = H - 22 - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${i === top ? ACCENT : ACCENT_SOFT}"><title>${esc(`${s.label}: ${s.display}`)}</title></rect>${i === top ? `<text x="${(x + bw * 0.32).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}">${esc(s.display)}</text>` : ""}${i % step === 0 ? `<text x="${(x + bw * 0.32).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="${MUTED}">${esc(s.label)}</text>` : ""}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}"><line x1="${pad}" y1="${H - 22}" x2="${W - pad}" y2="${H - 22}" stroke="${LINE}"/>${bars}</svg>`;
}

/** Day × time-of-day grid; darker = fuller, with the number printed in each box. */
function heat(cells: { weekday: number; timeOfDay: string; fill: number; classes: number }[]) {
  if (!cells.length) return "";
  const days = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;
  const bands = [["morning", "Mornings"], ["afternoon", "Afternoons"], ["evening", "Evenings"]] as const;
  const bg = (f: number) => `rgba(12,97,86,${(0.08 + Math.min(100, f) / 100 * 0.62).toFixed(2)})`;
  return `<table class="heat"><tr><th></th>${days.map(([, d]) => `<th>${d}</th>`).join("")}</tr>${bands.map(([b, l]) => `<tr><th class="rl">${l}</th>${days.map(([d]) => { const c = cells.find((x) => x.weekday === d && x.timeOfDay === b); return c ? `<td style="background:${bg(c.fill)};color:${c.fill >= 55 ? "#fff" : INK}">${Math.round(c.fill)}%</td>` : `<td class="none">–</td>`; }).join("")}</tr>`).join("")}</table>`;
}

export function visualReport(o: { studio: string; title: string; period: { label: string; comparedWith: string }; filters: string[]; generatedAt: string; metrics?: Metric[]; summary?: string; sections: { title: string; body: string; wide?: boolean }[] }) {
  const tile = (m: Metric) => {
    const arrow = m.change.direction === "up" ? "▲" : m.change.direction === "down" ? "▼" : "■";
    const col = m.change.good === null ? MUTED : m.change.good ? GOOD : BAD;
    return `<div class="tile"><div class="tl">${esc(m.label)}</div><div class="tv">${esc(m.display)}</div>${m.change.text ? `<div class="tc" style="color:${col}">${arrow} ${esc(m.change.text)}</div>` : ""}<div class="tx">${esc(m.explain)}</div></div>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)} · ${esc(o.studio)} · ${esc(o.period.label)}</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;background:${SOFT};color:${INK};font:13px/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:820px;margin:24px auto;background:#fff;border-radius:12px;padding:36px 40px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:3px solid ${ACCENT};padding-bottom:14px;margin-bottom:18px}
h1{font-size:24px;margin:0;letter-spacing:-.01em}.sub{color:${MUTED}}.meta{text-align:right;color:${MUTED};font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;justify-content:flex-end}.chip{background:${SOFT};border:1px solid ${LINE};border-radius:999px;padding:1px 9px;font-size:11.5px;color:${INK}}
.summary{background:${SOFT};border-left:4px solid ${ACCENT};border-radius:6px;padding:10px 14px;font-weight:600;margin:0 0 16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px}
.tile{border:1px solid ${LINE};border-radius:10px;padding:10px 12px;break-inside:avoid}.tl{font-size:11.5px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:.04em}.tv{font-size:22px;font-weight:700;margin:2px 0}.tc{font-size:12px;font-weight:700}.tx{font-size:11.5px;color:${MUTED};margin-top:3px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{border:1px solid ${LINE};border-radius:10px;padding:12px 14px;break-inside:avoid}.card.wide{grid-column:1/-1}
h2{font-size:13.5px;margin:0 0 8px}.hb{width:100%;border-collapse:collapse}.hb td{padding:4px 0;vertical-align:middle}.hl{width:38%;padding-right:8px!important;font-size:12.5px}.hl span{display:block;color:${MUTED};font-size:11px}
.hbar div{height:12px;background:${ACCENT};border-radius:3px}.hv{width:72px;text-align:right;font-weight:700;font-size:12.5px;white-space:nowrap}
.heat{width:100%;border-collapse:separate;border-spacing:3px}.heat th{font-size:11px;color:${MUTED};font-weight:600}.heat .rl{text-align:left}.heat td{text-align:center;border-radius:5px;padding:7px 2px;font-weight:700;font-size:12px}.heat td.none{color:${MUTED};background:${SOFT}}
table.list{width:100%;border-collapse:collapse;font-size:12.5px}table.list th{text-align:left;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid ${LINE};padding:4px 6px}table.list td{border-bottom:1px solid ${LINE};padding:5px 6px}table.list td.num,table.list th.num{text-align:right}
ul.points{margin:0;padding-left:18px}.empty{color:${MUTED};margin:0}footer{margin-top:18px;color:${MUTED};font-size:11px;display:flex;justify-content:space-between}
.print{position:fixed;right:16px;bottom:16px;background:${ACCENT};color:#fff;border:0;border-radius:999px;padding:10px 16px;font:inherit;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.2)}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:0;max-width:none}.print{display:none}}
@media (max-width:640px){.page{margin:0;border-radius:0;padding:20px 16px}.grid{grid-template-columns:1fr}header{flex-direction:column;align-items:flex-start}.meta{text-align:left}.chips{justify-content:flex-start}}
</style></head><body><div class="page">
<header><div><div class="sub">${esc(o.studio)}</div><h1>${esc(o.title)}</h1><div class="sub">${esc(o.period.label)} · compared with ${esc(o.period.comparedWith)}</div></div>
<div class="meta">Made ${esc(o.generatedAt)}${o.filters.length ? `<div class="chips">${o.filters.map((f) => `<span class="chip">${esc(f)}</span>`).join("")}</div>` : ""}</div></header>
${o.summary ? `<p class="summary">${esc(o.summary)}</p>` : ""}
${o.metrics?.length ? `<div class="tiles">${o.metrics.map(tile).join("")}</div>` : ""}
<div class="grid">${o.sections.map((s) => `<section class="card${s.wide ? " wide" : ""}"><h2>${esc(s.title)}</h2>${s.body}</section>`).join("")}</div>
<footer><span>${esc(o.studio)} · ${esc(o.title)}</span><span>Numbers compare ${esc(o.period.label.toLowerCase())} with ${esc(o.period.comparedWith)}.</span></footer>
</div><button class="print" onclick="window.print()">Save as PDF or print</button></body></html>`;
}

export const charts = { hbars, columns, heat };
export const listTable = (head: string[], rows: (string | number)[][], numCols: number[] = []) =>
  rows.length ? `<table class="list"><tr>${head.map((h, i) => `<th${numCols.includes(i) ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${r.map((c, i) => `<td${numCols.includes(i) ? ' class="num"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("")}</table>` : `<p class="empty">Nothing in this period.</p>`;
export const points = (items: string[]) => (items.length ? `<ul class="points">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="empty">Nothing stands out.</p>`);
