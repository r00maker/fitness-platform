import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { bookings, clientPackages, organizations } from "../src/db/schema.js";
import { renewDuePackages } from "../src/modules/packages/lifecycle.js";
import { app, dayOffset, db, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

/**
 * Members booking into their next period before it renews: the class is held, and taken from
 * that period's classes when it renews. Pack holders could always book ahead; now members can too.
 */
async function setup(planBody: Record<string, unknown> = {}) {
  const s = await studio({ clientsNeedPackage: true });
  const plan = (await s.owner.call("POST", "/package-plans", { name: "2 classes a month", kind: "credits", credits: 2, billing: "recurring", validityValue: 1, validityUnit: "months", priceCents: 0, ...planBody })).body;
  const sold = (await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: plan.id })).body;
  // The current period ends at midnight four days from now, so a class in six days is in the next one.
  const [org] = await db.select().from(organizations).where(eq(organizations.id, s.orgId));
  const renewsAt = DateTime.fromISO(dayOffset(4), { zone: org!.timezone }).startOf("day").toJSDate();
  await db.update(clientPackages).set({ startedAt: new Date(renewsAt.getTime() - 30 * 86_400_000), expiresAt: renewsAt }).where(eq(clientPackages.id, sold.id));
  let hour = 7;
  const cls = async (days: number) =>
    (await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 8, durationMinutes: 50, date: dayOffset(days), startTime: `${String(hour++).padStart(2, "0")}:00`, acknowledge: ["unusual_start_time", "possible_duplicate"] })).body.id as string;
  const mine = async () => (await s.c1.call("GET", "/me/packages")).body.packages[0];
  return { s, sold, cls, mine };
}

describe("members can book into their next period", () => {
  it("holds the class without taking one now, caps it at the period's classes, and takes it when it renews", async () => {
    const { s, sold, cls, mine } = await setup();
    const a = await s.c1.call("POST", "/bookings", { sessionId: await cls(6) });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body).toMatchObject({ payment: "package", bookedAhead: { period: 2, periodStarts: dayOffset(4) } });
    // Nothing taken from this period.
    expect(await mine()).toMatchObject({ creditsLeft: 2, renewal: { bookedAhead: [{ period: 2, classes: 1, periodStarts: dayOffset(4), note: expect.stringMatching(/^1 class booked ahead, taken from the period starting .* when it renews$/) }] } });

    expect((await s.c1.call("POST", "/bookings", { sessionId: await cls(7) })).status).toBe(201);
    // The next period has 2 classes, and both are booked ahead.
    const third = await s.c1.call("POST", "/bookings", { sessionId: await cls(8) });
    expect(third.body.error.message).toMatch(/all 2 classes in its period from .* are already booked ahead/);

    // Cancelling a class booked ahead (in time) just releases the hold.
    const c = await s.c1.call("POST", `/bookings/${a.body.id}/cancel`, {});
    expect(c.body).toMatchObject({ classReturnedToPackage: true });
    expect(await mine()).toMatchObject({ creditsLeft: 2, renewal: { bookedAhead: [{ classes: 1 }] } });
    const again = await s.c1.call("POST", "/bookings", { sessionId: await cls(9) });
    expect(again.status).toBe(201);

    // It renews: the two classes booked ahead come out of the new period.
    await db.update(clientPackages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clientPackages.id, sold.id));
    expect(await renewDuePackages(db, new Date())).toBe(1);
    expect(await mine()).toMatchObject({ creditsLeft: 0, creditsTotal: 2, renewal: { period: 2, bookedAhead: [] } });
    const [b] = await db.select().from(bookings).where(eq(bookings.id, again.body.id));
    expect(b!.heldForPeriod).toBeNull();
    const h = (await s.c1.call("GET", `/client-packages/${sold.id}`)).body;
    expect(h.classes.filter((x: { credit: string }) => x.credit === "1 class used")).toHaveLength(2);
    expect(h.classes.find((x: { status: string }) => x.status === "Cancelled").credit).toBe("Class given back");
  });

  it("tells the client when it's booked ahead", async () => {
    const { s, cls } = await setup();
    await s.owner.call("POST", "/bookings", { sessionId: await cls(6), clientId: s.c1.id });
    const [n] = await outbox("booking.confirmed");
    expect((n!.data as { paymentNote: string }).paymentNote).toMatch(/It uses your 2 classes a month\. It's booked ahead into the period starting .*, and the class is taken from that period when it renews\./);
  });

  it("can be switched off by the studio", async () => {
    const { s, cls } = await setup();
    expect((await s.owner.call("GET", "/settings")).body.membersBookAhead).toBe(true);
    await s.owner.call("PATCH", "/settings", { membersBookAhead: false });
    const r = await s.c1.call("POST", "/bookings", { sessionId: await cls(6) });
    expect(r.body.error.message).toMatch(/this class is in its next period, which starts when it renews on/);
  });

  it("works for unlimited memberships, and stopping the membership cancels classes booked past its end", async () => {
    const { s, sold, cls, mine } = await setup({ name: "Unlimited monthly", kind: "unlimited", credits: null });
    const b = await s.c1.call("POST", "/bookings", { sessionId: await cls(6) });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect((await mine()).renewal.bookedAhead).toMatchObject([{ classes: 1, note: expect.stringMatching(/^1 class booked ahead, in the period starting /) }]);

    const options = (await s.c1.call("GET", `/client-packages/${sold.id}/stop-options`)).body;
    expect(options.bookedAheadAfterEnd.atEndOfTerm).toBe(1);
    const stop = await s.c1.call("POST", `/client-packages/${sold.id}/stop-renewing`, {});
    expect(stop.body).toMatchObject({ cancelledBookings: 1 });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, b.body.id));
    expect(row).toMatchObject({ status: "cancelled", cancelledVia: "membership_ended" });
    // A class after it ends can't be booked at all.
    expect((await s.c1.call("POST", "/bookings", { sessionId: await cls(6) })).body.error.message).toMatch(/it ends on .*, before this class/);
  });
});
