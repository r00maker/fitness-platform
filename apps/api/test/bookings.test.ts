import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, refunds, waitlistEntries } from "../src/db/schema.js";
import { processWaitlistTimers } from "../src/modules/waitlist/engine.js";
import { app, db, dayOffset, minutesFromNow, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function fullClass(capacity = 1, opts: { date?: string; startTime?: string } = {}) {
  const s = await studio();
  // Let clients book right up to the start, so classes starting "soon" can be tested.
  await db.update(organizations).set({ bookingClosesMinutesBefore: 0 }).where(eq(organizations.id, s.orgId));
  const session = await s.owner.call("POST", "/sessions", {
    classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity, durationMinutes: 50,
    date: opts.date ?? dayOffset(2), startTime: opts.startTime ?? "07:00",
    acknowledge: ["unusual_start_time"], // tests that start "soon" may run late at night
  });
  const b1 = await s.c1.call("POST", "/bookings", { sessionId: session.body.id });
  return { s, sessionId: session.body.id as string, b1 };
}

describe("booking", () => {
  it("fills, then points clients to the waitlist", async () => {
    const { s, sessionId, b1 } = await fullClass(1);
    expect(b1.status).toBe(201);
    const b2 = await s.c2.call("POST", "/bookings", { sessionId });
    expect(b2.status).toBe(409);
    expect(b2.body.error.code).toBe("class_full");
    expect(b2.body.error.canJoinWaitlist).toBe(true);
  });

  it("never overbooks under simultaneous requests", async () => {
    const { s, sessionId } = await fullClass(2);
    const results = await Promise.all([s.c2.call("POST", "/bookings", { sessionId }), s.c3.call("POST", "/bookings", { sessionId })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("staff can cancel with a refund, and move a client to another class", async () => {
    const { s, sessionId, b1 } = await fullClass(5);
    const other = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, capacity: 5, durationMinutes: 50, date: dayOffset(3), startTime: "07:00" });
    const moved = await s.owner.call("POST", `/bookings/${b1.body.id}/move`, { targetSessionId: other.body.id });
    expect(moved.status).toBe(200);
    expect(moved.body.sessionId).toBe(other.body.id);
    expect(await outbox("booking.moved")).toHaveLength(2);

    const b2 = await s.c2.call("POST", "/bookings", { sessionId });
    const cancel = await s.owner.call("POST", `/bookings/${b2.body.id}/cancel`, { refund: "original_payment", reason: "Injury" });
    expect(cancel.body.refund).toBe("original_payment");
    expect(await db.select().from(refunds).where(eq(refunds.bookingId, b2.body.id))).toHaveLength(1);
  });

  it("refunds after a class without cancelling", async () => {
    const { s, b1 } = await fullClass(5);
    const res = await s.owner.call("POST", `/bookings/${b1.body.id}/refund`, { method: "credit", reason: "Heating broken" });
    expect(res.status).toBe(200);
    expect(await outbox("booking.refunded")).toHaveLength(2);
  });

  it("clients cancelling late lose the credit", async () => {
    const { s, b1 } = await fullClass(5, minutesFromNow(120));
    const check = await s.c1.call("POST", `/bookings/${b1.body.id}/cancel`, {});
    expect(check.body.error.message).toBe("This class starts in less than 12 hours, so you won't get your class credit back. Cancel anyway?");
    const res = await s.c1.call("POST", `/bookings/${b1.body.id}/cancel`, { acknowledge: ["late_cancel"] });
    expect(res.body.booking.status).toBe("late_cancelled");
    expect(res.body.refund).toBe("none");
  });
});

describe("attendance", () => {
  it("marks everyone present in one go, and lets instructors only do their own classes", async () => {
    const { s, sessionId, b1 } = await fullClass(5, minutesFromNow(30));
    await s.c2.call("POST", "/bookings", { sessionId });

    expect((await s.ben.call("POST", `/sessions/${sessionId}/attendance/mark-all`, {})).status).toBe(403);
    expect((await s.ana.call("PUT", `/bookings/${b1.body.id}/attendance`, { attendance: "no_show" })).body.attendance).toBe("no_show");
    const early = await s.ana.call("POST", `/sessions/${sessionId}/attendance/mark-all`, {});
    expect(early.body.error.flags[0].code).toBe("class_not_started");
    const all = await s.ana.call("POST", `/sessions/${sessionId}/attendance/mark-all`, { acknowledge: ["class_not_started"] });
    expect(all.body.updated).toBe(1); // the no-show isn't overwritten
  });
});

describe("waitlist", () => {
  it("automatic mode books the next person in as soon as a spot opens", async () => {
    const { s, sessionId, b1 } = await fullClass(1);
    const w = await s.c2.call("POST", "/waitlist", { sessionId, mode: "automatic", expiresHoursBeforeStart: 3 });
    expect(w.status).toBe(201);
    expect(w.body.position).toBe(1);
    await s.c1.call("POST", `/bookings/${b1.body.id}/cancel`, {});
    const roster = await s.owner.call("GET", `/sessions/${sessionId}`);
    expect(roster.body.roster.find((r: { clientId: string; status: string }) => r.clientId === s.c2.id && r.status === "confirmed")).toBeTruthy();
    expect(await outbox("waitlist.enrolled")).toHaveLength(2);
  });

  it("manual mode holds the spot for 10 minutes, then offers it to the next person", async () => {
    const { s, sessionId, b1 } = await fullClass(1);
    const w2 = await s.c2.call("POST", "/waitlist", { sessionId, mode: "manual", expiresHoursBeforeStart: null });
    await s.c3.call("POST", "/waitlist", { sessionId, mode: "manual", expiresHoursBeforeStart: null });
    await s.c1.call("POST", `/bookings/${b1.body.id}/cancel`, {});

    // The held spot can't be taken by someone else.
    expect((await s.c1.call("POST", "/bookings", { sessionId })).body.error.code).toBe("class_full");
    const [offer] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, w2.body.id));
    expect(offer!.status).toBe("offered");
    expect(offer!.offerExpiresAt!.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    // 11 minutes later: hold lapses and moves to Eve.
    await processWaitlistTimers(db, new Date(Date.now() + 11 * 60_000));
    expect(await outbox("waitlist.offer_lapsed")).toHaveLength(2);
    const lapsedClaim = await s.c2.call("POST", `/waitlist/${w2.body.id}/claim`);
    expect(lapsedClaim.body.error.code).toBe("offer_expired");

    const mine = await s.c3.call("GET", "/me/waitlist");
    expect(mine.body[0].status).toBe("offered");
    const claim = await s.c3.call("POST", `/waitlist/${mine.body[0].id}/claim`);
    expect(claim.status).toBe(201);
    expect(claim.body.source).toBe("waitlist_claimed");
  });

  it("only accepts the studio's cut-off options and removes people once theirs passes", async () => {
    const { s, sessionId } = await fullClass(1);
    const bad = await s.c2.call("POST", "/waitlist", { sessionId, mode: "automatic", expiresHoursBeforeStart: 4 });
    expect(bad.body.error.message).toBe("Pick one of: 5h, 3h, 1h before class.");
    const ok = await s.c2.call("POST", "/waitlist", { sessionId, mode: "automatic", expiresHoursBeforeStart: 5 });
    const [entry] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, ok.body.id));
    await processWaitlistTimers(db, new Date(entry!.expiresAt.getTime() + 1000));
    const [after] = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, ok.body.id));
    expect(after!.status).toBe("expired");
    expect(await outbox("waitlist.expired")).toHaveLength(2);
  });

  it("won't let you join a waitlist when there's space", async () => {
    const { s, sessionId } = await fullClass(3);
    expect((await s.c2.call("POST", "/waitlist", { sessionId, mode: "automatic" })).body.error.code).toBe("spots_available");
  });
});
