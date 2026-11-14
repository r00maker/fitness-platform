import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { clientPackages, creditGrants, invoices, notifications } from "../src/db/schema.js";
import { app, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function setup() {
  const s = await studio();
  const fd = await person(s.orgId, "front_desk", "Faye");
  const plan = (await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months" })).body;
  return { s, fd, plan };
}

describe("sales: invoices, receipts and refunds", () => {
  it("issues an invoice at checkout and a receipt once it's paid at the desk", async () => {
    const { s, fd, plan } = await setup();
    const order = await s.c1.call("POST", "/checkout", { planId: plan.id });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    let list = (await s.owner.call("GET", "/sales/transactions")).body;
    expect(list.transactions).toHaveLength(1);
    const sale = list.transactions[0];
    expect(sale).toMatchObject({ number: "INV-00001", status: "open", statusLabel: "Not paid yet", source: "package", total: "SGD 280.00", receiptNumber: null, description: "10-class pack" });
    expect(list.summary).toMatchObject({ toCollect: "SGD 280.00", unpaid: 1, takenIn: "SGD 0.00" });
    // No receipt yet.
    expect((await s.owner.call("GET", `/sales/invoices/${sale.id}/document?kind=receipt`)).status).toBe(409);

    // Paid at the desk by QR: the package is added and the receipt issued.
    const paid = await s.owner.call("POST", `/sales/invoices/${sale.id}/mark-paid`, { method: "qr" });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body).toMatchObject({ status: "paid", receiptNumber: "RCT-00001", paymentMethod: "QR payment (PayNow, DuitNow, PromptPay)" });
    expect(await db.select().from(clientPackages).where(eq(clientPackages.ownerId, s.c1.id))).toHaveLength(1);

    // The receipt is a proper document; the client can open their own, nobody else's.
    const doc = await app.inject({ method: "GET", url: `/v1/sales/invoices/${sale.id}/document?kind=receipt`, headers: { authorization: `Bearer ${s.c1.token}` } });
    expect(doc.statusCode).toBe(200);
    expect(doc.headers["content-type"]).toMatch(/text\/html/);
    expect(doc.body).toContain("RECEIPT");
    expect(doc.body).toContain("RCT-00001");
    expect(doc.body).toContain("Test Studio");
    expect(doc.body).toContain("SGD 280.00");
    expect((await s.c2.call("GET", `/sales/invoices/${sale.id}/document`)).status).toBe(404);
    expect((await fd.call("GET", "/sales/transactions")).status).toBe(403);
    expect((await s.c1.call("GET", "/me/purchases")).body.purchases[0]).toMatchObject({ number: "INV-00001", hasReceipt: true });

    // One click emails the receipt.
    const sent = await s.owner.call("POST", `/sales/invoices/${sale.id}/email-receipt`);
    expect(sent.body.sentTo).toMatch(/@example\.com$/);
    const [mail] = await db.select().from(notifications).where(and(eq(notifications.userId, s.c1.id), eq(notifications.template, "custom")));
    expect((mail!.data as { subject: string; html: string }).subject).toBe("Your receipt from Test Studio (RCT-00001)");
    expect((mail!.data as { html: string }).html).toContain("RCT-00001");
    list = (await s.owner.call("GET", "/sales/transactions")).body;
    expect(list.summary).toMatchObject({ takenIn: "SGD 280.00", toCollect: "SGD 0.00" });
    expect(list.transactions[0].receiptSentAt).toBeTruthy();
  });

  it("uses the studio's own invoice design, numbering and tax", async () => {
    const { s, plan } = await setup();
    expect((await s.owner.call("PATCH", "/sales/settings", { accentColor: "#F5F5F5" })).status).toBe(400); // too light to read
    const r = await s.owner.call("PATCH", "/sales/settings", { businessName: "Test Studio Pte Ltd", address: "1 Tanjong Pagar Rd\nSingapore 088439", registrationLabel: "GST Reg. No.", registrationNumber: "M2-1234567-8", invoicePrefix: "TS-", receiptPrefix: "TSR-", tax: { enabled: true, ratePercent: 9 }, footerNote: "See you on the mat!" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.settings.tax).toEqual({ enabled: true, label: "GST", ratePercent: 9 });
    const sample = await app.inject({ method: "GET", url: "/v1/sales/settings/sample?kind=invoice", headers: { authorization: `Bearer ${s.owner.token}` } });
    expect(sample.body).toContain("Test Studio Pte Ltd");
    expect(sample.body).toContain("GST Reg. No.: M2-1234567-8");
    expect(sample.body).toContain("See you on the mat!");

    // A desk sale is paid there and then: invoice and receipt together.
    const sold = await s.owner.call("POST", `/clients/${s.c2.id}/packages`, { planId: plan.id, paymentMethod: "cash" });
    expect(sold.status, JSON.stringify(sold.body)).toBe(201);
    const [inv] = await db.select().from(invoices);
    expect(inv).toMatchObject({ number: "TS-00001", receiptNumber: "TSR-00001", status: "paid", paymentMethod: "cash", source: "desk_sale", totalCents: 28000, taxCents: 2312, taxLabel: "GST 9%" });
    expect(inv!.seller.registrationNumber).toBe("M2-1234567-8");
    // Changing the address later doesn't rewrite old invoices.
    await s.owner.call("PATCH", "/sales/settings", { address: "New address" });
    const doc = await app.inject({ method: "GET", url: `/v1/sales/invoices/${inv!.id}/document`, headers: { authorization: `Bearer ${s.owner.token}` } });
    expect(doc.body).toContain("1 Tanjong Pagar Rd");
    expect(doc.body).toContain("Includes GST 9%");
    // Only owners and admins change the design.
    expect((await s.ana.call("PATCH", "/sales/settings", { footerNote: "x" })).status).toBe(403);
  });

  it("refunds part as credit, then the rest, ending the package", async () => {
    const { s, plan } = await setup();
    await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: plan.id, paymentMethod: "card" });
    const [inv] = await db.select().from(invoices);
    const r1 = await s.owner.call("POST", `/sales/invoices/${inv!.id}/refunds`, { amountCents: 8000, reason: "Moving away", method: "credit" });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.sale).toMatchObject({ status: "partly_refunded", refunded: "SGD 80.00", refundableCents: 20000 });
    const [grant] = await db.select().from(creditGrants).where(eq(creditGrants.clientId, s.c1.id));
    expect(grant).toMatchObject({ amountCents: 8000, note: `Refund for ${inv!.number}` });
    expect((await s.owner.call("POST", `/sales/invoices/${inv!.id}/refunds`, { amountCents: 30000, reason: "x" })).body.error.code).toBe("too_much");
    const r2 = await s.owner.call("POST", `/sales/invoices/${inv!.id}/refunds`, { amountCents: 20000, reason: "Moving away", undoSale: true, acknowledge: ["package_cancel_unused", "package_has_bookings"] });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(r2.body.sale.status).toBe("refunded");
    const [p] = await db.select().from(clientPackages).where(eq(clientPackages.ownerId, s.c1.id));
    expect(p!.cancelledAt).toBeTruthy();
    const detail = (await s.owner.call("GET", `/sales/invoices/${inv!.id}`)).body;
    expect(detail.refunds.map((x: { method: string }) => x.method)).toEqual(["Studio credit", "Back to how they paid"]);
    expect((await s.owner.call("POST", `/sales/invoices/${inv!.id}/refunds`, { amountCents: 1, reason: "x" })).body.error.code).toBe("not_refundable");
  });

  it("cancelled orders cancel their invoice", async () => {
    const { s, plan } = await setup();
    const o = (await s.c1.call("POST", "/checkout", { planId: plan.id })).body.order;
    await s.c1.call("POST", `/orders/${o.id}/cancel`);
    const [inv] = await db.select().from(invoices);
    expect(inv!.status).toBe("void");
    expect((await s.owner.call("GET", "/sales/transactions?status=open")).body.transactions).toHaveLength(0);
  });
});
