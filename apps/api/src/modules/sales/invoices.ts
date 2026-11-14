/**
 * Invoices and receipts.
 *
 *  - Every sale gets an invoice with the studio's next invoice number (packages, renewals, gift
 *    cards, shop orders, fees). When it's paid it also gets the next receipt number.
 *  - The studio's legal details are copied onto each invoice when it's issued, so changing the
 *    address later never rewrites old paperwork. Branding (logo, colour, footer) is current.
 *  - Documents are plain HTML that reads well in an email, on a phone and printed (A4).
 */
import { and, eq, sql } from "drizzle-orm";
import { DEFAULT_INVOICE_SETTINGS, PAYMENT_METHODS, type InvoiceSettings, type InvoiceSource, type PaymentMethod } from "@studio/shared";
import { DateTime } from "luxon";
import type { DbOrTx } from "../../db/client.js";
import { files, invoiceRefunds, invoiceSettings, invoices, notifications, organizations, users } from "../../db/schema.js";
import { money } from "../bookings/rules.js";
import { publicFileUrl } from "../files/routes.js";

export type Invoice = typeof invoices.$inferSelect;
export interface Line {
  description: string;
  detail?: string;
  quantity: number;
  unitCents: number;
}

export async function settingsFor(db: DbOrTx, orgId: string): Promise<InvoiceSettings> {
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  const [row] = await db.select({ settings: invoiceSettings.settings }).from(invoiceSettings).where(eq(invoiceSettings.orgId, orgId));
  const saved = row?.settings ?? {};
  return { ...DEFAULT_INVOICE_SETTINGS, businessName: org?.name ?? "", ...saved, tax: { ...DEFAULT_INVOICE_SETTINGS.tax, ...(saved.tax ?? {}) } };
}

/** The next invoice or receipt number, e.g. INV-00042. Locked, so two sales never share one. */
async function nextNumber(tx: DbOrTx, orgId: string, kind: "invoice" | "receipt", s: InvoiceSettings) {
  await tx.insert(invoiceSettings).values({ orgId }).onConflictDoNothing();
  const [r] = await tx
    .update(invoiceSettings)
    .set(kind === "invoice" ? { nextInvoiceNo: sql`${invoiceSettings.nextInvoiceNo} + 1` } : { nextReceiptNo: sql`${invoiceSettings.nextReceiptNo} + 1` })
    .where(eq(invoiceSettings.orgId, orgId))
    .returning({ inv: invoiceSettings.nextInvoiceNo, rct: invoiceSettings.nextReceiptNo });
  const n = (kind === "invoice" ? r!.inv : r!.rct) - 1;
  return `${kind === "invoice" ? s.invoicePrefix : s.receiptPrefix}${String(n).padStart(5, "0")}`;
}

const taxIn = (total: number, s: InvoiceSettings) => (s.tax.enabled && s.tax.ratePercent > 0 ? Math.round((total * s.tax.ratePercent) / (100 + s.tax.ratePercent)) : 0);

/** Issue an invoice. With `paid`, it's paid at once and gets its receipt number too. */
export async function issueInvoice(
  tx: DbOrTx,
  input: {
    orgId: string;
    clientId: string;
    source: InvoiceSource;
    lines: Line[];
    discountCents?: number;
    creditCents?: number;
    orderId?: string | null;
    clientPackageId?: string | null;
    feeId?: string | null;
    createdBy?: string | null;
    paid?: { method: PaymentMethod; at?: Date };
  },
): Promise<Invoice> {
  const s = await settingsFor(tx, input.orgId);
  const [org] = await tx.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, input.orgId));
  const [client] = await tx.select({ first: users.firstName, last: users.lastName, email: users.email }).from(users).where(eq(users.id, input.clientId));
  const lines = input.lines.map((l) => ({ ...l, amountCents: l.unitCents * l.quantity }));
  const subtotal = lines.reduce((a, l) => a + l.amountCents, 0);
  const total = Math.max(0, subtotal - (input.discountCents ?? 0) - (input.creditCents ?? 0));
  const now = input.paid?.at ?? new Date();
  const [inv] = await tx
    .insert(invoices)
    .values({
      orgId: input.orgId,
      number: await nextNumber(tx, input.orgId, "invoice", s),
      clientId: input.clientId,
      source: input.source,
      orderId: input.orderId ?? null,
      clientPackageId: input.clientPackageId ?? null,
      feeId: input.feeId ?? null,
      lines,
      subtotalCents: subtotal,
      discountCents: input.discountCents ?? 0,
      creditCents: input.creditCents ?? 0,
      totalCents: total,
      taxCents: taxIn(total, s),
      taxLabel: s.tax.enabled ? `${s.tax.label} ${s.tax.ratePercent}%` : null,
      currency: org?.currency ?? "SGD",
      billTo: { name: client ? `${client.first} ${client.last}` : "Client", email: client?.email ?? null },
      seller: { businessName: s.businessName, address: s.address, registrationLabel: s.registrationLabel, registrationNumber: s.registrationNumber, email: s.email, phone: s.phone, website: s.website },
      createdBy: input.createdBy ?? null,
      issuedAt: now,
    })
    .returning();
  return input.paid ? markPaid(tx, inv!, input.paid.method, now) : inv!;
}

/** Paid: gets its receipt number (and is emailed if the studio sends receipts automatically). */
export async function markPaid(tx: DbOrTx, inv: Invoice, method: PaymentMethod, at = new Date()): Promise<Invoice> {
  if (inv.status !== "open") return inv;
  const s = await settingsFor(tx, inv.orgId);
  const [u] = await tx
    .update(invoices)
    .set({ status: "paid", paidAt: at, paymentMethod: inv.totalCents === 0 ? "credit" : method, receiptNumber: await nextNumber(tx, inv.orgId, "receipt", s) })
    .where(and(eq(invoices.id, inv.id), eq(invoices.status, "open")))
    .returning();
  if (u && s.autoEmailReceipts) await emailReceipt(tx, u);
  return u ?? inv;
}

/** Find an invoice by what it's for. */
export async function invoiceFor(tx: DbOrTx, by: { orderId?: string; feeId?: string }) {
  const [inv] = await tx.select().from(invoices).where(by.orderId ? eq(invoices.orderId, by.orderId) : eq(invoices.feeId, by.feeId!)).for("update");
  return inv ?? null;
}
export async function payFor(tx: DbOrTx, by: { orderId?: string; feeId?: string }, method: PaymentMethod) {
  const inv = await invoiceFor(tx, by);
  return inv ? markPaid(tx, inv, method) : null;
}
export async function voidFor(tx: DbOrTx, by: { orderId?: string; feeId?: string }) {
  const inv = await invoiceFor(tx, by);
  if (inv?.status === "open") await tx.update(invoices).set({ status: "void", voidedAt: new Date() }).where(eq(invoices.id, inv.id));
}

// --- Documents --------------------------------------------------------------------------
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The invoice or receipt as a self-contained HTML page (email, screen and print). */
export async function renderDocument(db: DbOrTx, inv: Invoice, kind: "invoice" | "receipt", publicApiUrl: string, opts: { sample?: boolean } = {}) {
  const s = await settingsFor(db, inv.orgId);
  const [org] = await db.select({ name: organizations.name, timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, inv.orgId));
  const refunds = opts.sample ? [] : await db.select().from(invoiceRefunds).where(eq(invoiceRefunds.invoiceId, inv.id));
  let logo = "";
  if (s.logoFileId) {
    const [f] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, s.logoFileId), eq(files.orgId, inv.orgId)));
    if (f) logo = publicFileUrl(publicApiUrl, f.id);
  }
  const zone = org?.timezone ?? "UTC";
  const day = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone }).toFormat("d LLL yyyy") : "");
  const m = (c: number) => money(c, inv.currency);
  const accent = s.accentColor;
  const receipt = kind === "receipt";
  const seller = inv.seller;
  const contact = [seller.email, seller.phone, seller.website.replace(/^https?:\/\//, "")].filter(Boolean);
  const refunded = refunds.reduce((a, r) => a + r.amountCents, 0);
  const row = (label: string, value: string, o: { strong?: boolean; muted?: boolean } = {}) =>
    `<tr><td style="padding:6px 0;color:${o.muted ? "#5b6660" : "#17201c"};${o.strong ? "font-weight:700;font-size:16px" : ""}">${esc(label)}</td><td style="padding:6px 0;text-align:right;white-space:nowrap;color:${o.muted ? "#5b6660" : "#17201c"};${o.strong ? "font-weight:700;font-size:16px" : ""}">${esc(value)}</td></tr>`;
  const title = receipt ? "Receipt" : "Invoice";
  const number = receipt ? (inv.receiptNumber ?? "") : inv.number;
  const status = receipt ? "Paid" : inv.status === "void" ? "Cancelled" : inv.status === "open" ? "Due" : inv.status === "refunded" ? "Refunded" : "Paid";
  const statusBg = status === "Due" ? "#fcefd6" : status === "Cancelled" || status === "Refunded" ? "#edf0ed" : "#e0f2e5";
  const statusFg = status === "Due" ? "#7a4500" : status === "Cancelled" || status === "Refunded" ? "#4a5650" : "#166530";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} ${esc(number)} · ${esc(seller.businessName)}</title>
<style>@page{size:A4;margin:16mm}@media print{body{background:#fff!important}.sheet{box-shadow:none!important;margin:0!important}}@media (max-width:600px){.pad{padding:24px 20px!important}.split td{display:block;width:100%!important;text-align:left!important;padding-bottom:12px!important}}</style></head>
<body style="margin:0;background:#f4f6f4;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#17201c;font-size:14px;line-height:1.5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="sheet" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-top:6px solid ${accent}">
<tr><td class="pad" style="padding:36px 40px 8px">
  <table role="presentation" width="100%" class="split" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="top" style="width:55%">${logo ? `<img src="${esc(logo)}" alt="${esc(seller.businessName)}" style="display:block;max-height:56px;max-width:200px;margin-bottom:12px;border:0">` : ""}
      <div style="font-size:17px;font-weight:700">${esc(seller.businessName)}</div>
      ${seller.address ? `<div style="color:#5b6660;white-space:pre-line">${esc(seller.address)}</div>` : ""}
      ${seller.registrationLabel && seller.registrationNumber ? `<div style="color:#5b6660">${esc(seller.registrationLabel)}: ${esc(seller.registrationNumber)}</div>` : ""}
      ${contact.length ? `<div style="color:#5b6660">${contact.map(esc).join(" · ")}</div>` : ""}</td>
    <td valign="top" style="text-align:right">
      <div style="font-size:28px;font-weight:700;letter-spacing:.02em;color:${accent}">${title.toUpperCase()}</div>
      <div style="font-weight:700;margin-top:2px">${esc(number)}</div>
      <div style="display:inline-block;margin-top:8px;padding:3px 10px;border-radius:999px;background:${statusBg};color:${statusFg};font-size:12px;font-weight:700;letter-spacing:.04em">${status.toUpperCase()}</div></td>
  </tr></table>
</td></tr>
<tr><td class="pad" style="padding:20px 40px 0">
  <table role="presentation" width="100%" class="split" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e3e8e3;border-bottom:1px solid #e3e8e3"><tr>
    <td valign="top" style="padding:14px 0;width:50%"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#5b6660">${receipt ? "RECEIVED FROM" : "BILLED TO"}</div><div style="font-weight:600">${esc(inv.billTo.name)}</div>${inv.billTo.email ? `<div style="color:#5b6660">${esc(inv.billTo.email)}</div>` : ""}</td>
    <td valign="top" style="padding:14px 0;text-align:right">
      <div><span style="color:#5b6660">${receipt ? "Paid on" : "Issued"}</span> <b>${esc(day(receipt ? inv.paidAt : inv.issuedAt))}</b></div>
      ${receipt ? `<div><span style="color:#5b6660">Paid by</span> <b>${esc(inv.paymentMethod ? PAYMENT_METHODS[inv.paymentMethod] : "")}</b></div><div><span style="color:#5b6660">For invoice</span> <b>${esc(inv.number)}</b></div>` : inv.status === "paid" ? `<div><span style="color:#5b6660">Paid</span> <b>${esc(day(inv.paidAt))}</b></div>` : ""}</td>
  </tr></table>
</td></tr>
<tr><td class="pad" style="padding:20px 40px 0">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td style="padding:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;color:#5b6660;border-bottom:2px solid ${accent}">DESCRIPTION</td><td style="padding:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;color:#5b6660;border-bottom:2px solid ${accent};text-align:center;width:48px">QTY</td><td style="padding:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.08em;color:#5b6660;border-bottom:2px solid ${accent};text-align:right;width:120px">AMOUNT</td></tr>
    ${inv.lines.map((l) => `<tr><td style="padding:12px 0;border-bottom:1px solid #eef1ee"><div style="font-weight:600">${esc(l.description)}</div>${l.detail ? `<div style="color:#5b6660;font-size:13px">${esc(l.detail)}</div>` : ""}${l.quantity > 1 ? `<div style="color:#5b6660;font-size:13px">${esc(m(l.unitCents))} each</div>` : ""}</td><td style="padding:12px 0;border-bottom:1px solid #eef1ee;text-align:center">${l.quantity}</td><td style="padding:12px 0;border-bottom:1px solid #eef1ee;text-align:right;white-space:nowrap">${esc(m(l.amountCents))}</td></tr>`).join("")}
  </table>
  <table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:300px;margin-top:12px">
    ${inv.discountCents || inv.creditCents ? row("Subtotal", m(inv.subtotalCents)) : ""}
    ${inv.discountCents ? row("Discount", `−${m(inv.discountCents)}`) : ""}
    ${inv.creditCents ? row("Studio credit", `−${m(inv.creditCents)}`) : ""}
    <tr><td colspan="2" style="border-top:2px solid ${accent};padding:0;height:2px;line-height:2px">&nbsp;</td></tr>
    ${row(receipt ? "Amount paid" : "Total", m(inv.totalCents), { strong: true })}
    ${inv.taxCents ? row(`Includes ${inv.taxLabel ?? "tax"}`, m(inv.taxCents), { muted: true }) : ""}
    ${refunded ? row("Refunded", `−${m(refunded)}`, { muted: true }) : ""}
  </table>
  <div style="clear:both"></div>
</td></tr>
<tr><td class="pad" style="padding:28px 40px 36px">
  ${!receipt && inv.status === "open" && s.paymentTerms ? `<div style="background:#f4f6f4;border-radius:8px;padding:12px 14px;margin-bottom:14px"><b>Payment</b><br>${esc(s.paymentTerms)}</div>` : ""}
  ${s.footerNote ? `<div style="color:#5b6660;white-space:pre-line">${esc(s.footerNote)}</div>` : ""}
  <div style="color:#8a958f;font-size:12px;margin-top:18px">${esc(title)} ${esc(number)}${opts.sample ? " · sample" : ""}</div>
</td></tr>
</table></td></tr></table></body></html>`;
  return { html, subject: `${receipt ? "Your receipt" : "Your invoice"} from ${seller.businessName} (${number})`, text: `${title} ${number} from ${seller.businessName}\n${inv.lines.map((l) => `${l.description} x${l.quantity}: ${m(l.amountCents)}`).join("\n")}\nTotal: ${m(inv.totalCents)}${receipt ? `\nPaid ${day(inv.paidAt)} by ${inv.paymentMethod ? PAYMENT_METHODS[inv.paymentMethod] : ""}` : ""}` };
}

/** Email the receipt to the client. */
export async function emailReceipt(tx: DbOrTx, inv: Invoice, publicApiUrl = process.env.PUBLIC_API_URL ?? "http://localhost:3000") {
  const doc = await renderDocument(tx, inv, "receipt", publicApiUrl);
  await tx.insert(notifications).values({ orgId: inv.orgId, userId: inv.clientId, channel: "email", template: "custom", data: { subject: doc.subject, html: doc.html, text: doc.text, ref: { invoiceId: inv.id } } });
  await tx.update(invoices).set({ receiptSentAt: new Date() }).where(eq(invoices.id, inv.id));
}
