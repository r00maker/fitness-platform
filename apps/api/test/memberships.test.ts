import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { bookings, clientPackages, fees, invoices } from "../src/db/schema.js";
import { renewDuePackages } from "../src/modules/packages/lifecycle.js";
import { retryHeldRenewals, setRenewalCharger } from "../src/modules/packages/payments.js";
import { app, dayOffset, db, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterEach(() => setRenewalCharger(null));
afterAll(async () => {
  await app.close();
  await pool.end();
});

const DAY = 86_400_000;
/** A card that answers from a script: true = approved, a string = declined with that reason. */
function card(script: (true | string)[]) {
  const calls: number[] = [];
  setRenewalCharger({
    name: "test",
    async charge(i) {
      calls.push(i.amountCents);
      const r = script.shift() ?? "Card declined";
      return r === true ? { ok: true, ref: `ch_${calls.length}` } : { ok: false, reason: r };
    },
  });
  return calls;
}

async function setup() {
  const s = await studio({ clientsNeedPackage: true });
  const plan = (await s.owner.call("POST", "/package-plans", { name: "Unlimited monthly", kind: "unlimited", billing: "recurring", validityValue: 1, validityUnit: "months", commitmentCycles: 6, earlyCancelFeeMode: "flat", earlyCancelFeeCents: 9000, priceCents: 30000 })).body;
  const sell = async (clientId: string) => (await s.owner.call("POST", `/clients/${clientId}/packages`, { planId: plan.id, paymentMethod: "card" })).body;
  let hour = 7;
  const cls = async (days: number) => (await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 8, durationMinutes: 50, date: dayOffset(days), startTime: `${String(hour++).padStart(2, "0")}:00`, acknowledge: ["unusual_start_time", "possible_duplicate"] })).body.id as string;
  const dueNow = (id: string) => db.update(clientPackages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clientPackages.id, id));
  return { s, plan, sell, cls, dueNow };
}

describe("membership renewal payments", () => {
  it("holds the membership when the card fails, retries twice over 7 days, then forfeits with the fee", async () => {
    const { s, sell, cls, dueNow } = await setup();
    const p = await sell(s.c1.id);
    // Booked well ahead, while the membership was fine.
    const later = await cls(10);
    expect((await s.c1.call("POST", "/bookings", { sessionId: later, acknowledge: ["no_free_cancel"] })).status).toBe(201);

    const calls = card(["Insufficient funds", "Insufficient funds", "Card expired"]);
    await dueNow(p.id);
    const now = Date.now();
    await renewDuePackages(db, new Date(now));
    expect(calls).toEqual([30000]);
    let [row] = await db.select().from(clientPackages).where(eq(clientPackages.id, p.id));
    expect(row!.paymentHeldAt).toBeTruthy();
    expect(row!.nextPaymentRetryAt!.getTime() - row!.paymentHeldAt!.getTime()).toBe(3 * DAY);
    expect((await outbox("membership.payment_failed")).map((n) => n.userId)).toContain(s.c1.id);
    expect((await outbox("membership.payment_failed_staff")).map((n) => n.userId)).toContain(s.owner.id);

    // On hold: it can't be used to book, and the client is told why.
    const soon = await cls(2);
    const r = await s.c1.call("POST", "/bookings", { sessionId: soon, acknowledge: ["no_free_cancel"] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("package_needed");
    expect(JSON.stringify(r.body)).toMatch(/renewal payment didn't go through, so it's on hold/);
    expect((await s.c1.call("GET", "/me/packages")).body.packages[0].paymentHold).toMatch(/^Its renewal payment didn't go through/);

    // Nothing happens before the retry is due; then retry 1 (day 3) fails, retry 2 is day 7.
    expect(await retryHeldRenewals(db, new Date(now + 1 * DAY))).toBe(0);
    await retryHeldRenewals(db, new Date(now + 3 * DAY + 60_000));
    [row] = await db.select().from(clientPackages).where(eq(clientPackages.id, p.id));
    expect(row).toMatchObject({ paymentRetries: 1, cancelledAt: null });
    expect(row!.nextPaymentRetryAt!.getTime() - row!.paymentHeldAt!.getTime()).toBe(7 * DAY);

    // Retry 2 fails: forfeited.
    await retryHeldRenewals(db, new Date(now + 7 * DAY + 60_000));
    expect(calls).toHaveLength(3);
    [row] = await db.select().from(clientPackages).where(eq(clientPackages.id, p.id));
    expect(row!.forfeitedAt).toBeTruthy();
    expect(row!.cancelledAt).toBeTruthy();
    // The unpaid renewal is cancelled; the early termination fee is invoiced.
    const invs = await db.select().from(invoices).where(eq(invoices.clientPackageId, p.id));
    expect(invs.find((i) => i.source === "renewal")!.status).toBe("void");
    const fee = invs.find((i) => i.source === "fee")!;
    expect(fee).toMatchObject({ status: "open", totalCents: 9000 });
    expect(fee.lines[0]!.description).toBe("Early termination fee");
    expect(await db.select().from(fees).where(and(eq(fees.clientId, s.c1.id), eq(fees.type, "early_cancellation")))).toHaveLength(1);
    // Upcoming classes booked with it are cancelled.
    const [b] = await db.select().from(bookings).where(eq(bookings.sessionId, later));
    expect(b!.status).toBe("cancelled");
    expect((await outbox("membership.forfeited")).map((n) => n.userId)).toContain(s.c1.id);
    // It doesn't renew again; they'd buy a new membership (and start a new minimum term).
    expect(await renewDuePackages(db, new Date(now + 40 * DAY))).toBe(0);
  });

  it("paying at the desk lifts the hold straight away", async () => {
    const { s, sell, cls, dueNow } = await setup();
    const p = await sell(s.c2.id);
    card(["Do not honour"]);
    await dueNow(p.id);
    await renewDuePackages(db);
    const inv = (await db.select().from(invoices).where(and(eq(invoices.clientPackageId, p.id), eq(invoices.source, "renewal"))))[0]!;
    const paid = await s.owner.call("POST", `/sales/invoices/${inv.id}/mark-paid`, { method: "cash" });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    expect(paid.body.receiptNumber).toBeTruthy();
    const [row] = await db.select().from(clientPackages).where(eq(clientPackages.id, p.id));
    expect(row).toMatchObject({ paymentHeldAt: null, paymentRetries: 0 });
    expect((await s.c2.call("POST", "/bookings", { sessionId: await cls(2), acknowledge: ["no_free_cancel"] })).status).toBe(201);
    expect((await outbox("membership.payment_recovered")).map((n) => n.userId)).toEqual([s.c2.id, s.c2.id]);
  });

  it("a successful charge pays the renewal and issues the receipt", async () => {
    const { s, sell, dueNow } = await setup();
    const p = await sell(s.c3.id);
    card([true]);
    await dueNow(p.id);
    await renewDuePackages(db);
    const inv = (await db.select().from(invoices).where(and(eq(invoices.clientPackageId, p.id), eq(invoices.source, "renewal"))))[0]!;
    expect(inv).toMatchObject({ status: "paid", paymentMethod: "online" });
    expect(inv.receiptNumber).toBeTruthy();
    const [row] = await db.select().from(clientPackages).where(eq(clientPackages.id, p.id));
    expect(row!.paymentHeldAt).toBeNull();
  });

  it("without a payment provider, renewals are paid at the desk as before (no hold)", async () => {
    const { s, sell, dueNow } = await setup();
    const p = await sell(s.c1.id);
    await dueNow(p.id);
    await renewDuePackages(db);
    const [row] = await db.select().from(clientPackages).where(eq(clientPackages.id, p.id));
    expect(row!.paymentHeldAt).toBeNull();
    const inv = (await db.select().from(invoices).where(and(eq(invoices.clientPackageId, p.id), eq(invoices.source, "renewal"))))[0]!;
    expect(inv.status).toBe("open");
  });
});
