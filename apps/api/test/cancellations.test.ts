import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { organizations } from "../src/db/schema.js";
import { app, dayOffset, db, minutesFromNow, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function setup() {
  const s = await studio();
  let hour = 7;
  const mk = async (extra: Record<string, unknown> = {}) =>
    (
      await s.owner.call("POST", "/sessions", {
        classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50,
        date: dayOffset(3), startTime: `${String(hour++).padStart(2, "0")}:00`, acknowledge: ["unusual_start_time", "ends_after_midnight", "in_the_past"], ...extra,
      })
    ).body.id as string;
  const plan = (await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 25000, validityValue: 3, validityUnit: "months" })).body;
  for (const c of [s.c1, s.c2, s.c3]) await s.owner.call("POST", `/clients/${c.id}/packages`, { planId: plan.id });
  return { s, mk };
}

const tab = async (who: { call: (m: "GET", u: string) => Promise<{ status: number; body: any }> }, id: string) => (await who.call("GET", `/sessions/${id}`)).body.cancellations;

describe("a class's Cancellations tab", () => {
  it("shows who cancelled, when, how, whether the class went back and any late fee", async () => {
    const { s, mk } = await setup();
    await db.update(organizations).set({ lateCancelFeeEnabled: true, lateCancelFeeCents: 1500 }).where(eq(organizations.id, s.orgId));
    // On time, by the client: the class goes back to their package.
    const early = await mk();
    const b1 = await s.c1.call("POST", "/bookings", { sessionId: early });
    await s.c1.call("POST", `/bookings/${b1.body.id}/cancel`, {});
    // By the studio, with a reason.
    const b2 = await s.c2.call("POST", "/bookings", { sessionId: early });
    await s.owner.call("POST", `/bookings/${b2.body.id}/cancel`, { reason: "Called in sick", notifyClient: false });
    // Moved to another class.
    const other = await mk();
    const b3 = await s.c3.call("POST", "/bookings", { sessionId: early });
    expect((await s.owner.call("POST", `/bookings/${b3.body.id}/move`, { targetSessionId: other })).status).toBe(200);

    const c = await tab(s.owner, early);
    expect(c.summary.text).toBe("2 cancellations, 1 moved to another class.");
    const [chloe, dev, eve] = c.list;
    expect(chloe).toMatchObject({ clientId: s.c1.id, via: "self", viaText: "Cancelled by the client", late: false, classReturned: true, fee: null, by: null });
    expect(chloe.hoursBefore).toBeGreaterThan(60);
    expect(dev).toMatchObject({ via: "staff", viaText: "Cancelled by the studio", reason: "Called in sick", by: { id: s.owner.id } });
    expect(eve).toMatchObject({ via: "moved", viaText: "Moved to another class", classReturned: true });

    // Late, by the client: the class isn't given back and the fee shows.
    const soon = await mk({ ...minutesFromNow(180) });
    const b4 = await s.c1.call("POST", "/bookings", { sessionId: soon, acknowledge: ["no_free_cancel"] });
    await s.c1.call("POST", `/bookings/${b4.body.id}/cancel`, { acknowledge: ["late_cancel"] });
    const late = await tab(s.owner, soon);
    expect(late.summary.text).toBe("1 cancellation (1 late).");
    expect(late.list[0]).toMatchObject({ late: true, classReturned: false, fee: { amount: "SGD 15.00", status: "pending" } });
  });

  it("marks bookings cancelled because the class was cancelled", async () => {
    const { s, mk } = await setup();
    const id = await mk();
    await s.c1.call("POST", "/bookings", { sessionId: id });
    await s.owner.call("POST", `/sessions/${id}/cancel`, { reason: "Instructor unwell", acknowledge: ["clients_affected"] });
    expect((await tab(s.owner, id)).list[0]).toMatchObject({ via: "class_cancelled", viaText: "Class cancelled", reason: "Instructor unwell", by: { id: s.owner.id } });
  });

  it("is for staff who can see the class list, not clients or other instructors", async () => {
    const { s, mk } = await setup();
    const id = await mk();
    const b = await s.c1.call("POST", "/bookings", { sessionId: id });
    await s.c1.call("POST", `/bookings/${b.body.id}/cancel`, {});
    const desk = await person(s.orgId, "front_desk");
    expect((await tab(desk, id)).list).toHaveLength(1);
    expect((await tab(s.ana, id)).list).toHaveLength(1); // her own class
    expect(await tab(s.c2, id)).toBeUndefined();
    expect((await s.ben.call("GET", `/sessions/${id}`)).status).toBe(404);
  });
});

describe("cancelled classes on the calendar", () => {
  it("staff can show them, with why and how many were booked; clients never see them", async () => {
    const { s, mk } = await setup();
    const id = await mk();
    await s.c1.call("POST", "/bookings", { sessionId: id });
    await s.c2.call("POST", "/bookings", { sessionId: id });
    await s.owner.call("POST", `/sessions/${id}/cancel`, { reason: "Instructor unwell", acknowledge: ["clients_affected"] });
    const url = `/calendar?view=week&date=${dayOffset(3)}`;
    expect((await s.owner.call("GET", url)).body.sessions.find((x: { id: string }) => x.id === id)).toBeUndefined();
    const shown = (await s.owner.call("GET", `${url}&includeCancelled=true`)).body.sessions.find((x: { id: string }) => x.id === id);
    expect(shown).toMatchObject({ status: "cancelled", cancelled: { reason: "Instructor unwell", automatically: false, peopleWereBooked: 2 } });
    expect((await s.c1.call("GET", `${url}&includeCancelled=true`)).body.sessions.find((x: { id: string }) => x.id === id)).toBeUndefined();
  });
});
