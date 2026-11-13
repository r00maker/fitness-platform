import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { giftCards, loyaltyLots, memberships } from "../src/db/schema.js";
import { expireLoyalty } from "../src/modules/marketing/loyalty.js";
import { app, db, minutesFromNow, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const DAY = 86_400_000;

async function setup(settings: Record<string, unknown> = {}) {
  const s = await studio();
  const r = await s.owner.call("PATCH", "/loyalty/settings", { loyaltyEnabled: true, loyaltyName: "Petal", ...settings });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  let n = 0;
  const book = async (clientId: string) => {
    const t = minutesFromNow(-10 - n++);
    const sid = (await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, ...t, acknowledge: ["unusual_start_time", "in_the_past", "possible_duplicate", "instructor_double_booked", "room_double_booked", "ends_after_midnight"] })).body.id;
    const b = await s.owner.call("POST", "/bookings", { sessionId: sid, clientId, acknowledge: ["late_booking", "client_double_booked", "outside_booking_window"] });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    return b.body.id as string;
  };
  const mark = (bookingId: string, attendance: string) => s.owner.call("PUT", `/bookings/${bookingId}/attendance`, { attendance });
  const me = async (who = s.c1) => (await who.call("GET", "/me/loyalty")).body;
  return { s, settings: r.body, book, mark, me };
}

describe("loyalty points", () => {
  it("uses the studio's own name, earns per class, and takes points back if attendance is corrected", async () => {
    const { s, settings, book, mark, me } = await setup();
    expect(settings).toMatchObject({ loyaltyName: "Petal", loyaltyNamePlural: "Petals", example: "You've got 120 Petals. Earn 10 Petals for every class you attend." });
    const b = await book(s.c1.id);
    await mark(b, "present");
    expect((await me()).balanceText).toBe("10 Petals");
    await mark(b, "present"); // marking again doesn't earn twice
    expect((await me()).balance).toBe(10);
    await mark(b, "no_show");
    expect((await me()).balance).toBe(0);
    await mark(b, "present");
    const view = await me();
    expect(view.balance).toBe(10);
    expect(view.history.map((h: { text: string; what: string }) => `${h.what} ${h.text}`)).toEqual(["Earned +10 Petals", "Taken back −10 Petals", "Earned +10 Petals"]);
    expect(view.rules.expiry).toMatch(/expire only if you don't come to a class, earn or redeem for 12 months/);
    expect((await s.c1.call("PATCH", "/loyalty/settings", { loyaltyEnabled: false })).status).toBe(403);
  });

  it("earns per amount spent, including gift cards bought", async () => {
    const { s, me } = await setup({ loyaltyEarn: "spend", loyaltyPointsPerUnit: 2 });
    const plan = (await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 28050, validityValue: 3, validityUnit: "months" })).body;
    await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: plan.id });
    expect((await me()).balance).toBe(561);
    expect((await me()).rules.earn).toBe("Earn 2 Petals for every SGD 1.00 you spend.");
  });

  it("swaps points for rewards of every kind, with stock and in-person hand-over", async () => {
    const { s, me } = await setup();
    await s.owner.call("POST", `/clients/${s.c1.id}/loyalty`, { points: 500, reason: "Welcome to the programme" });
    const add = (body: Record<string, unknown>) => s.owner.call("POST", "/loyalty/rewards", body).then((r) => { expect(r.status, JSON.stringify(r.body)).toBe(201); return r.body; });
    const free = await add({ name: "Free class", cost: 100, kind: "free_classes", reward: { type: "free_classes", classes: 1, validDays: 30 } });
    await add({ name: "10% off", cost: 80, kind: "discount", reward: { type: "discount", percent: 10, validDays: 30 } });
    const gift = await add({ name: "SGD 20 gift card", cost: 150, kind: "gift_card", giftCardCents: 2000 });
    const tote = await add({ name: "Studio tote bag", description: "Our canvas tote, while stocks last.", cost: 120, kind: "experience", stock: 1 });
    expect((await s.owner.call("POST", "/loyalty/rewards", { name: "Bad", cost: 10, kind: "credit" })).body.error.fields.reward).toBe("Set what they get.");

    const view = await me();
    expect(view.rewards.map((r: { name: string; canRedeem: boolean }) => `${r.name}:${r.canRedeem}`)).toEqual(["Free class:true", "10% off:true", "SGD 20 gift card:true", "Studio tote bag:true"]);
    expect(view.rewards[2].whatYouGet).toBe("A SGD 20.00 gift card to give (or keep)");

    const r1 = await s.c1.call("POST", `/me/loyalty/rewards/${free.id}/redeem`);
    expect(r1.body).toMatchObject({ balance: 400, message: "Done! You've got 1 free class, valid for 30 days." });
    expect((await s.c1.call("GET", "/me/packages")).body.packages.map((p: { name: string }) => p.name)).toContain("1 free class");
    await s.c1.call("POST", `/me/loyalty/rewards/${gift.id}/redeem`);
    expect((await db.select().from(giftCards).where(eq(giftCards.buyerId, s.c1.id)))[0]).toMatchObject({ status: "unsent", amountCents: 2000 });

    const r3 = await s.c1.call("POST", `/me/loyalty/rewards/${tote.id}/redeem`);
    expect(r3.body.message).toMatch(/^Done! Show code R-[A-Z2-9]{4} at the front desk/);
    expect((await outbox("loyalty.to_hand_over")).filter((m) => m.channel === "email").map((m) => m.userId)).toEqual([s.owner.id]);
    // Only one tote bag: the next person is told it's gone.
    await s.owner.call("POST", `/clients/${s.c2.id}/loyalty`, { points: 200, reason: "Test" });
    expect((await s.c2.call("POST", `/me/loyalty/rewards/${tote.id}/redeem`)).body.error.code).toBe("sold_out");
    // Not enough points: told how many more they need.
    expect((await s.c2.call("POST", `/me/loyalty/rewards/${gift.id}/redeem`)).status).toBe(200);
    expect((await s.c2.call("POST", `/me/loyalty/rewards/${gift.id}/redeem`)).body.error).toMatchObject({ code: "not_enough_points", needMore: 100 });

    // Front desk hands it over, or cancels it (points and stock come back).
    const waiting = (await s.owner.call("GET", "/loyalty/redemptions")).body;
    expect(waiting).toEqual([expect.objectContaining({ rewardName: "Studio tote bag", status: "waiting", costText: "120 Petals" })]);
    await s.owner.call("POST", `/loyalty/redemptions/${waiting[0].id}/cancel`);
    expect((await me()).balance).toBe(250);
    expect((await s.owner.call("GET", "/loyalty/rewards")).body.find((r: { id: string }) => r.id === tote.id).stock).toBe(1);
    expect((await s.owner.call("POST", `/loyalty/redemptions/${waiting[0].id}/given`)).body.error.code).toBe("already_handled");
  });

  it("expires points after a stretch without visits, with a reminder first", async () => {
    const { s, me } = await setup({ loyaltyExpiryMonths: 6 });
    await s.owner.call("POST", `/clients/${s.c1.id}/loyalty`, { points: 300, reason: "Test" });
    const ago = (days: number) => new Date(Date.now() - days * DAY);
    await db.update(loyaltyLots).set({ earnedAt: ago(175) }).where(eq(loyaltyLots.clientId, s.c1.id));
    await db.update(memberships).set({ loyaltyActiveAt: ago(175) }).where(and(eq(memberships.userId, s.c1.id), eq(memberships.orgId, s.orgId)));
    expect((await me()).nextExpiry.text).toMatch(/^300 Petals expire on .+ unless you come to a class before then\.$/);
    await expireLoyalty(db);
    expect((await outbox("loyalty.expiring"))[0]!.data).toMatchObject({ points: "300 Petals", inactivity: true });
    await expireLoyalty(db); // no second reminder
    expect((await outbox("loyalty.expiring")).filter((m) => m.channel === "email").length).toBe(1);
    await expireLoyalty(db, new Date(Date.now() + 10 * DAY));
    expect((await me()).balance).toBe(0);
    expect((await me()).history[0]).toMatchObject({ what: "Expired", text: "−300 Petals" });
  });

  it("can expire each batch on its own date instead, and filters clients by points", async () => {
    const { s, me } = await setup({ loyaltyExpiry: "fixed", loyaltyExpiryMonths: 3 });
    await s.owner.call("POST", `/clients/${s.c1.id}/loyalty`, { points: 100, reason: "Old" });
    await db.update(loyaltyLots).set({ earnedAt: new Date(Date.now() - 100 * DAY) }).where(eq(loyaltyLots.clientId, s.c1.id));
    await s.owner.call("POST", `/clients/${s.c1.id}/loyalty`, { points: 40, reason: "New" });
    await db.update(memberships).set({ loyaltyActiveAt: new Date() }).where(eq(memberships.userId, s.c1.id));
    expect((await me()).balance).toBe(40); // the old batch has passed its date even before the worker runs
    await expireLoyalty(db);
    expect((await me()).history[0]).toMatchObject({ what: "Expired", text: "−100 Petals" });
    const found = await s.owner.call("POST", "/clients/filter", { definition: { match: "all", rules: [{ field: "loyaltyPoints", op: "at_least", value: 20 }] } });
    expect(found.body.clients.map((c: { firstName: string }) => c.firstName)).toEqual(["Chloe"]);
  });
});
