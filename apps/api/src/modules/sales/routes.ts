/**
 * Sales → Transactions: every sale with its invoice and receipt, payments taken at the desk,
 * refunds, and the studio's invoice design. Owners and admins (viewPayments).
 * Clients see their own invoices and receipts under My purchases.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { INVOICE_SOURCES, INVOICE_STATUSES, PAYMENT_METHODS, can, documentQuery, invoiceSettings as settingsSchema, markInvoicePaid, refundInvoice, schemas, transactionsQuery } from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { creditGrants, fees, files, giftCards, invoiceRefunds, invoiceSettings, invoices, orders, organizations, products } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import type { AuthContext } from "../../plugins/auth.js";
import type { Flags } from "../../lib/flags.js";
import { money } from "../bookings/rules.js";
import { completeOrderById } from "../checkout/routes.js";
import { endOfDayAfter, grantCredit } from "../marketing/credit.js";
import { notify } from "../notifications/outbox.js";
import { cancelPackage } from "../packages/service.js";
import { getOrg } from "../sessions/context.js";
import { emailReceipt, markPaid, renderDocument, settingsFor, type Invoice } from "./invoices.js";
import { restock } from "../shop/stock.js";

const idParam = z.object({ id: schemas.id });

async function getInvoice(db: DbOrTx, orgId: string, id: string, lock = false) {
  const q = db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.orgId, orgId)));
  const [inv] = lock ? await q.for("update") : await q;
  if (!inv) throw notFound("sale");
  return inv;
}

function present(inv: Invoice, refunds: (typeof invoiceRefunds.$inferSelect)[] = []) {
  const m = (c: number) => money(c, inv.currency);
  return {
    id: inv.id,
    number: inv.number,
    receiptNumber: inv.receiptNumber,
    status: inv.status,
    statusLabel: INVOICE_STATUSES[inv.status],
    source: inv.source,
    sourceLabel: INVOICE_SOURCES[inv.source],
    client: { id: inv.clientId, name: inv.billTo.name, email: inv.billTo.email },
    description: inv.lines.map((l) => (l.quantity > 1 ? `${l.description} ×${l.quantity}` : l.description)).join(", "),
    lines: inv.lines.map((l) => ({ ...l, amount: m(l.amountCents), unit: m(l.unitCents) })),
    subtotal: m(inv.subtotalCents),
    discount: inv.discountCents ? m(inv.discountCents) : null,
    credit: inv.creditCents ? m(inv.creditCents) : null,
    total: m(inv.totalCents),
    totalCents: inv.totalCents,
    tax: inv.taxCents ? { label: inv.taxLabel, amount: m(inv.taxCents) } : null,
    refunded: inv.refundedCents ? m(inv.refundedCents) : null,
    refundableCents: inv.status === "paid" || inv.status === "partly_refunded" ? inv.totalCents - inv.refundedCents : 0,
    issuedAt: inv.issuedAt,
    paidAt: inv.paidAt,
    paymentMethod: inv.paymentMethod ? PAYMENT_METHODS[inv.paymentMethod] : null,
    receiptSentAt: inv.receiptSentAt,
    refunds: refunds.map((r) => ({ id: r.id, amount: m(r.amountCents), method: r.method === "credit" ? "Studio credit" : "Back to how they paid", reason: r.reason, undidSale: r.undidSale, at: r.createdAt })),
  };
}

/**
 * Refund all or part of a paid sale: back to how they paid (recorded now, sent by the payment
 * provider once one is connected) or as studio credit. Optionally undo the sale too.
 */
export async function refund(tx: DbOrTx, auth: AuthContext, id: string, input: ReturnType<typeof refundInvoice.parse>, flags: Flags) {
  const inv = await getInvoice(tx, auth.orgId, id, true);
  if (inv.status !== "paid" && inv.status !== "partly_refunded") throw conflict("not_refundable", inv.status === "open" ? "This hasn't been paid yet, so there's nothing to refund. Cancel it instead." : "This has already been fully refunded.");
  const left = inv.totalCents - inv.refundedCents;
  if (input.amountCents > left) throw badRequest("too_much", `You can refund up to ${money(left, inv.currency)}.`);

  if (input.undoSale) {
    if ((inv.source === "package" || inv.source === "desk_sale" || inv.source === "renewal") && inv.clientPackageId) {
      await cancelPackage(tx, auth, inv.clientPackageId, `Refunded (${inv.number}): ${input.reason}`, flags);
    } else if (inv.source === "gift_card" && inv.orderId) {
      const [o] = await tx.select({ giftCardId: orders.giftCardId }).from(orders).where(eq(orders.id, inv.orderId));
      const [card] = o?.giftCardId ? await tx.select().from(giftCards).where(eq(giftCards.id, o.giftCardId)).for("update") : [];
      if (card?.creditGrantId) {
        const [g] = await tx.select().from(creditGrants).where(eq(creditGrants.id, card.creditGrantId)).for("update");
        if (g && g.remainingCents < g.amountCents) throw conflict("gift_card_spent", "Some of this gift card has already been spent, so it can't be cancelled. You can still refund an amount without cancelling it.");
        if (g) await tx.update(creditGrants).set({ remainingCents: 0 }).where(eq(creditGrants.id, g.id));
      }
      if (card) await tx.update(giftCards).set({ status: "cancelled" }).where(eq(giftCards.id, card.id));
    } else if (inv.source === "product" && inv.orderId) {
      const [o] = await tx.select({ items: orders.items }).from(orders).where(eq(orders.id, inv.orderId));
      for (const it of o?.items ?? []) await restock(tx, it.productId, it.option, it.quantity);
    } else {
      throw badRequest("cant_undo", "This kind of sale can't be undone, but you can still refund it.");
    }
  }

  if (input.method === "credit") {
    const org = await getOrg(tx, auth.orgId);
    await grantCredit(tx, { orgId: auth.orgId, clientId: inv.clientId, amountCents: input.amountCents, currency: inv.currency, source: "studio", sourceId: inv.id, note: `Refund for ${inv.number}`, expiresAt: endOfDayAfter(365, org.timezone), by: auth.userId });
  }
  const [r] = await tx.insert(invoiceRefunds).values({ orgId: auth.orgId, invoiceId: inv.id, amountCents: input.amountCents, method: input.method, reason: input.reason, undidSale: input.undoSale, createdBy: auth.userId }).returning();
  const refunded = inv.refundedCents + input.amountCents;
  const [u] = await tx.update(invoices).set({ refundedCents: refunded, status: refunded >= inv.totalCents ? "refunded" : "partly_refunded" }).where(eq(invoices.id, inv.id)).returning();
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "sale.refunded", entityType: "invoice", entityId: inv.id, details: { amountCents: input.amountCents, method: input.method, undoSale: input.undoSale } });
  await notify(tx, { orgId: auth.orgId, userIds: [inv.clientId], template: "sale.refunded", data: { amount: money(input.amountCents, inv.currency), number: inv.number, toCredit: input.method === "credit", invoiceId: inv.id } });
  return { sale: present(u!, [r!]) };
}

export async function salesRoutes(app: FastifyInstance) {
  const { db, config } = app;

  /** Everything sold, newest first, with what's still to be paid and refunded. */
  app.get("/sales/transactions", async (req) => {
    requirePermission(req, "viewPayments");
    const q = parse(transactionsQuery, req.query);
    const org = await getOrg(db, req.auth.orgId);
    const zone = org.timezone;
    const day = (d: string, plus = 0) => DateTime.fromISO(d, { zone }).plus({ days: plus }).toJSDate();
    const where = and(
      eq(invoices.orgId, req.auth.orgId),
      q.status === "open" ? eq(invoices.status, "open") : q.status === "paid" ? inArray(invoices.status, ["paid", "partly_refunded"]) : q.status === "refunded" ? inArray(invoices.status, ["refunded", "partly_refunded"]) : undefined,
      q.source !== "all" ? eq(invoices.source, q.source) : undefined,
      q.from ? gte(invoices.issuedAt, day(q.from)) : undefined,
      q.to ? lt(invoices.issuedAt, day(q.to, 1)) : undefined,
      q.q ? or(ilike(invoices.number, `%${q.q}%`), ilike(invoices.receiptNumber, `%${q.q}%`), sql`${invoices.billTo}->>'name' ilike ${`%${q.q}%`}`) : undefined,
    );
    const rows = await db.select().from(invoices).where(where).orderBy(desc(invoices.issuedAt)).limit(q.limit);
    const [t] = await db
      .select({
        paid: sql<number>`coalesce(sum(case when ${invoices.status} in ('paid','partly_refunded','refunded') then ${invoices.totalCents} else 0 end), 0)::int`,
        refunded: sql<number>`coalesce(sum(${invoices.refundedCents}), 0)::int`,
        owed: sql<number>`coalesce(sum(case when ${invoices.status} = 'open' then ${invoices.totalCents} else 0 end), 0)::int`,
        openCount: sql<number>`count(*) filter (where ${invoices.status} = 'open')::int`,
      })
      .from(invoices)
      .where(where);
    const m = (c: number) => money(c, org.currency);
    return {
      summary: { takenIn: m(t!.paid), refunded: m(t!.refunded), nett: m(t!.paid - t!.refunded), toCollect: m(t!.owed), unpaid: t!.openCount },
      transactions: rows.map((r) => present(r)),
    };
  });

  app.get("/sales/invoices/:id", async (req) => {
    requirePermission(req, "viewPayments");
    const { id } = parse(idParam, req.params);
    const inv = await getInvoice(db, req.auth.orgId, id);
    return present(inv, await db.select().from(invoiceRefunds).where(eq(invoiceRefunds.invoiceId, inv.id)).orderBy(invoiceRefunds.createdAt));
  });

  /** The invoice or receipt as a page to view, print or save as PDF. Staff, or the client it's for. */
  app.get("/sales/invoices/:id/document", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { kind } = parse(documentQuery, req.query);
    const inv = await getInvoice(db, req.auth.orgId, id);
    if (!can(req.auth.role, "viewPayments") && inv.clientId !== req.auth.userId) throw notFound("sale");
    if (kind === "receipt" && !inv.receiptNumber) throw conflict("not_paid", "There's no receipt until it's been paid.");
    if (inv.status === "void" && kind === "receipt") throw conflict("void", "This sale was cancelled.");
    const doc = await renderDocument(db, inv, kind, config.PUBLIC_API_URL);
    reply.header("content-type", "text/html; charset=utf-8").header("cache-control", "private, no-store");
    return doc.html;
  });

  app.post("/sales/invoices/:id/email-receipt", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    requirePermission(req, "viewPayments");
    const { id } = parse(idParam, req.params);
    return inTx(app, async (tx) => {
      const inv = await getInvoice(tx, req.auth.orgId, id, true);
      if (!inv.receiptNumber) throw conflict("not_paid", "There's no receipt until it's been paid.");
      if (!inv.billTo.email) throw conflict("no_email", "This client has no email address.");
      await emailReceipt(tx, inv, config.PUBLIC_API_URL);
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "sale.receipt_emailed", entityType: "invoice", entityId: inv.id });
      return { sentTo: inv.billTo.email };
    });
  });

  /** Paid at the desk (cash, card, QR…). Orders become the package, gift card or shop order. */
  app.post("/sales/invoices/:id/mark-paid", async (req) => {
    requirePermission(req, "viewPayments");
    const { id } = parse(idParam, req.params);
    const { method } = parse(markInvoicePaid, req.body ?? {});
    return inTx(app, async (tx) => {
      const inv = await getInvoice(tx, req.auth.orgId, id, true);
      if (inv.status !== "open") throw conflict("not_open", `This is already ${INVOICE_STATUSES[inv.status].toLowerCase()}.`);
      if (inv.orderId) await completeOrderById(tx, req.auth, inv.orderId, method);
      else {
        await markPaid(tx, inv, method);
        if (inv.feeId) await tx.update(fees).set({ status: "charged" }).where(eq(fees.id, inv.feeId));
      }
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "sale.paid", entityType: "invoice", entityId: inv.id, details: { method } });
      return present(await getInvoice(tx, req.auth.orgId, id));
    });
  });

  app.post("/sales/invoices/:id/refunds", async (req) => {
    requirePermission(req, "viewPayments");
    const { id } = parse(idParam, req.params);
    const input = parse(refundInvoice, req.body);
    return withFlags(app, input.acknowledge, (tx, flags) => refund(tx, req.auth, id, input, flags));
  });

  // --- Invoice design ----------------------------------------------------------------
  app.get("/sales/settings", async (req) => {
    requirePermission(req, "viewPayments");
    return { settings: await settingsFor(db, req.auth.orgId), paymentMethods: PAYMENT_METHODS };
  });
  app.patch("/sales/settings", async (req) => {
    requirePermission(req, "manageSettings");
    const input = parse(settingsSchema, req.body);
    if (input.logoFileId) {
      const [f] = await db.select({ purpose: files.purpose }).from(files).where(and(eq(files.id, input.logoFileId), eq(files.orgId, req.auth.orgId)));
      if (!f || f.purpose !== "email_image") throw badRequest("logo", "Upload the logo as an image first (it's shown in emails, so it needs to be an email image).");
    }
    return inTx(app, async (tx) => {
      const cur = (await tx.select().from(invoiceSettings).where(eq(invoiceSettings.orgId, req.auth.orgId)))[0]?.settings ?? {};
      const next = { ...cur, ...input, ...(input.tax ? { tax: { ...(cur.tax ?? {}), ...input.tax } } : {}) };
      await tx.insert(invoiceSettings).values({ orgId: req.auth.orgId, settings: next }).onConflictDoUpdate({ target: invoiceSettings.orgId, set: { settings: next } });
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "sales.settings", entityType: "organization", entityId: req.auth.orgId, details: { changed: Object.keys(input) } });
      return { settings: await settingsFor(tx, req.auth.orgId) };
    });
  });
  /** A sample invoice or receipt with the current design, to check how it looks. */
  app.get("/sales/settings/sample", async (req, reply) => {
    requirePermission(req, "viewPayments");
    const { kind } = parse(documentQuery, req.query);
    const s = await settingsFor(db, req.auth.orgId);
    const [org] = await db.select({ currency: organizations.currency }).from(organizations).where(eq(organizations.id, req.auth.orgId));
    const total = 28000, tax = s.tax.enabled ? Math.round((total * s.tax.ratePercent) / (100 + s.tax.ratePercent)) : 0;
    const sample = {
      id: "00000000-0000-0000-0000-000000000000", orgId: req.auth.orgId, number: `${s.invoicePrefix}00001`, receiptNumber: `${s.receiptPrefix}00001`, clientId: req.auth.userId, status: "paid", source: "package",
      orderId: null, clientPackageId: null, feeId: null, lines: [{ description: "10-class pack", detail: "Valid for 3 months from the first class", quantity: 1, unitCents: 28000, amountCents: 28000 }],
      subtotalCents: total, discountCents: 0, creditCents: 0, totalCents: total, taxCents: tax, taxLabel: s.tax.enabled ? `${s.tax.label} ${s.tax.ratePercent}%` : null, currency: org?.currency ?? "SGD",
      billTo: { name: "Chloe Ng", email: "chloe@example.com" }, seller: { businessName: s.businessName, address: s.address, registrationLabel: s.registrationLabel, registrationNumber: s.registrationNumber, email: s.email, phone: s.phone, website: s.website },
      issuedAt: new Date(), paidAt: new Date(), paymentMethod: "card", receiptSentAt: null, refundedCents: 0, voidedAt: null, createdBy: null, createdAt: new Date(),
    } satisfies Invoice;
    const doc = await renderDocument(db, sample, kind, config.PUBLIC_API_URL, { sample: true });
    reply.header("content-type", "text/html; charset=utf-8").header("cache-control", "no-store");
    return doc.html;
  });

  // --- Clients: their own purchases ---------------------------------------------------
  app.get("/me/purchases", async (req) => {
    const rows = await db.select().from(invoices).where(and(eq(invoices.orgId, req.auth.orgId), eq(invoices.clientId, req.auth.userId))).orderBy(desc(invoices.issuedAt)).limit(100);
    return { purchases: rows.filter((r) => r.status !== "void").map((r) => ({ ...present(r), refunds: undefined, hasReceipt: !!r.receiptNumber })) };
  });

  /** Fees paid at the desk. */
  app.post("/fees/:id/mark-paid", async (req) => {
    requirePermission(req, "viewPayments");
    const { id } = parse(idParam, req.params);
    const { method } = parse(markInvoicePaid, req.body ?? {});
    return inTx(app, async (tx) => {
      const [fee] = await tx.select().from(fees).where(and(eq(fees.id, id), eq(fees.orgId, req.auth.orgId))).for("update");
      if (!fee) throw notFound("fee");
      if (fee.status !== "pending") throw conflict("fee_not_pending", fee.status === "waived" ? "This fee was waived." : "This fee has already been paid.");
      await tx.update(fees).set({ status: "charged" }).where(eq(fees.id, id));
      const [inv] = await tx.select().from(invoices).where(eq(invoices.feeId, id)).for("update");
      const paid = inv ? await markPaid(tx, inv, method) : null;
      return { fee: { id, status: "charged" }, sale: paid ? present(paid) : null };
    });
  });
}
