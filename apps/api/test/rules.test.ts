import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { fees, organizations } from "../src/db/schema.js";
import { app, db, dayOffset, minutesFromNow, outbox, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function setup(settings: Partial<typeof organizations.$inferInsert> = {}) {
  const s = await studio();
  if (Object.keys(settings).length) await db.update(organizations).set(settings).where(eq(organizations.id, s.orgId));
  const foh = await person(s.orgId, "front_desk", "Fiona");
  const mk = async (when: { date: string; startTime: string }, extra: Record<string, unknown> = {}) =>
    (await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, acknowledge: ["unusual_start_time", "in_the_past", "ends_after_midnight"], ...when, ...extra })).body.id as string;
  return { s, foh, mk };
}

describe("access levels", () => {
  it("Front of House sees the whole schedule and rosters, can take attendance, and nothing else", async () => {
    const { s, foh, mk } = await setup({ bookingClosesMinutesBefore: 0 });
    const anaClass = await mk(minutesFromNow(30));
    const benClass = await mk({ date: dayOffset(3), startTime: "09:00" }, { instructorId: s.ben.id });
    const booking = await s.c1.call("POST", "/bookings", { sessionId: anaClass, acknowledge: ["no_free_cancel"] });

    expect((await foh.call("GET", `/calendar?view=month&date=${dayOffset(3)}`)).body.sessions.map((x: { id: string }) => x.id)).toContain(benClass);
    const detail = await foh.call("GET", `/sessions/${anaClass}`);
    expect(detail.body.roster[0].firstName).toBe("Chloe");
    expect(detail.body.roster[0].email).toMatch(/@example.com/); // so they can reach a client about an issue
    expect((await foh.call("PUT", `/bookings/${booking.body.id}/attendance`, { attendance: "present" })).status).toBe(200);

    expect((await foh.call("POST", "/bookings", { sessionId: benClass, clientId: s.c2.id })).status).toBe(403);
    expect((await foh.call("POST", `/bookings/${booking.body.id}/cancel`, {})).status).toBe(403);
    expect((await foh.call("POST", `/bookings/${booking.body.id}/refund`, { method: "credit", reason: "x" })).status).toBe(403);
    expect((await foh.call("PATCH", `/sessions/${benClass}`, { changes: { capacity: 12 } })).status).toBe(403);
    expect((await foh.call("GET", "/clients")).status).toBe(403);
    expect((await foh.call("PATCH", "/settings", { weeklyBookingLimit: 3 })).status).toBe(403);
  });

  it("Instructors see only their own classes", async () => {
    const { s, mk } = await setup();
    const anaClass = await mk({ date: dayOffset(3), startTime: "09:00" });
    const benClass = await mk({ date: dayOffset(3), startTime: "11:00" }, { instructorId: s.ben.id });
    const cal = await s.ana.call("GET", `/calendar?view=day&date=${dayOffset(3)}`);
    expect(cal.body.sessions.map((x: { id: string }) => x.id)).toEqual([anaClass]);
    // Asking for someone else's classes still only returns your own.
    expect((await s.ana.call("GET", `/calendar?view=day&date=${dayOffset(3)}&instructorId=${s.ben.id}`)).body.sessions.map((x: { id: string }) => x.id)).toEqual([anaClass]);
    expect((await s.ana.call("GET", `/sessions/${benClass}`)).status).toBe(404);
    expect((await s.ana.call("GET", `/sessions/${anaClass}`)).body.roster).toEqual([]);
  });

  it("Instructors can see a class they've been asked to cover, without its client list", async () => {
    const { s, mk } = await setup();
    const benClass = await mk({ date: dayOffset(3), startTime: "11:00" }, { instructorId: s.ben.id });
    await s.c1.call("POST", "/bookings", { sessionId: benClass });
    await s.ben.call("POST", "/substitute-requests", { sessionId: benClass });
    const list = await s.ana.call("GET", "/substitute-requests");
    expect(list.body[0].session.className).toBe("Reformer Pilates");
    const detail = await s.ana.call("GET", `/sessions/${benClass}`);
    expect(detail.status).toBe(200);
    expect(detail.body.roster).toEqual([]);
  });

  it("Admins see client contact details and history", async () => {
    const { s, mk } = await setup();
    const c = await mk({ date: dayOffset(3), startTime: "09:00" });
    await s.c1.call("POST", "/bookings", { sessionId: c });
    expect((await s.owner.call("GET", `/sessions/${c}`)).body.roster[0].email).toMatch(/@example.com/);
    expect((await s.owner.call("GET", "/clients?q=chloe")).body).toHaveLength(1);
    expect((await s.owner.call("GET", `/clients/${s.c1.id}`)).body.history).toHaveLength(1);
  });
});

describe("booking window", () => {
  it("opens 14 calendar days before at midnight, and admins can book earlier", async () => {
    const { s, mk } = await setup();
    const far = await mk({ date: dayOffset(20), startTime: "09:00" });
    const early = await s.c1.call("POST", "/bookings", { sessionId: far });
    expect(early.body.error.code).toBe("booking_not_open");
    expect(early.body.error.message).toMatch(/^Booking for this class opens on .+ at 12:00am \(midnight\)\.$/);
    const admin = await s.owner.call("POST", "/bookings", { sessionId: far, clientId: s.c1.id });
    expect(admin.status).toBe(201);
    expect(admin.body.flags[0].code).toBe("outside_booking_window");
    const cal = await s.c1.call("GET", `/calendar?view=day&date=${dayOffset(20)}`);
    expect(cal.body.sessions[0].bookingWindow).toBe("not_open_yet");
  });

  it("closes 1 hour before class", async () => {
    const { s, mk } = await setup();
    const soon = await mk(minutesFromNow(30));
    const res = await s.c1.call("POST", "/bookings", { sessionId: soon });
    expect(res.body.error).toMatchObject({ code: "booking_closed" });
    expect(res.body.error.message).toMatch(/\(1 hour before class\)\.$/);
    expect((await s.c1.call("POST", "/waitlist", { sessionId: soon, mode: "automatic" })).body.error.code).toBe("booking_closed");
  });

  it("follows the studio's own settings", async () => {
    const { s, mk } = await setup({ bookingOpensDaysBefore: 30, bookingClosesMinutesBefore: 0 });
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk({ date: dayOffset(20), startTime: "09:00" }) })).status).toBe(201);
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk(minutesFromNow(30)), acknowledge: ["no_free_cancel"] })).status).toBe(201);
  });
});

describe("moving a booking", () => {
  it("clients can't move inside the late-cancellation window; admins can", async () => {
    const { s, mk } = await setup({ bookingClosesMinutesBefore: 0 });
    const soon = await mk(minutesFromNow(180));
    const later = await mk({ date: dayOffset(3), startTime: "09:00" });
    const b = await s.c1.call("POST", "/bookings", { sessionId: soon, acknowledge: ["no_free_cancel"] });
    const res = await s.c1.call("POST", `/bookings/${b.body.id}/move`, { targetSessionId: later });
    expect(res.body.error).toMatchObject({ code: "late_move", message: "Your class starts in less than 12 hours, so it can't be moved. Please contact the studio if you need help." });
    const admin = await s.owner.call("POST", `/bookings/${b.body.id}/move`, { targetSessionId: later });
    expect(admin.status).toBe(200);
    expect(admin.body.flags.map((f: { code: string }) => f.code)).toContain("late_move");
  });

  it("clients can move outside the window", async () => {
    const { s, mk } = await setup();
    const b = await s.c1.call("POST", "/bookings", { sessionId: await mk({ date: dayOffset(3), startTime: "09:00" }) });
    expect((await s.c1.call("POST", `/bookings/${b.body.id}/move`, { targetSessionId: await mk({ date: dayOffset(4), startTime: "09:00" }) })).status).toBe(200);
  });
});

describe("weekly limit (off by default)", () => {
  it("is unlimited unless the studio sets one", async () => {
    const { s, mk } = await setup();
    for (const t of ["07:00", "09:00", "11:00"]) expect((await s.c1.call("POST", "/bookings", { sessionId: await mk({ date: dayOffset(3), startTime: t }, { instructorId: null }) })).status).toBe(201);
  });

  it("stops clients at the limit; admins can go over after confirming", async () => {
    const { s, mk } = await setup({ weeklyBookingLimit: 1 });
    const a = await mk({ date: dayOffset(7), startTime: "09:00" });
    const b = await mk({ date: dayOffset(7), startTime: "11:00" });
    await s.c1.call("POST", "/bookings", { sessionId: a });
    const res = await s.c1.call("POST", "/bookings", { sessionId: b });
    expect(res.body.error.code).toBe("weekly_limit");
    expect(res.body.error.message).toMatch(/^You've reached the studio's limit of 1 class a week \(Mon .+ – Sun .+\)\.$/);
    expect((await s.owner.call("POST", "/bookings", { sessionId: b, clientId: s.c1.id })).body.error.flags[0].code).toBe("over_weekly_limit");
    expect((await s.owner.call("POST", "/bookings", { sessionId: b, clientId: s.c1.id, acknowledge: ["over_weekly_limit"] })).status).toBe(201);
  });
});

describe("fees", () => {
  it("rejects switching a fee on without an amount", async () => {
    const { s } = await setup();
    const res = await s.owner.call("PATCH", "/settings", { lateCancelFeeEnabled: true });
    expect(res.body.error.fields.lateCancelFeeCents).toBe("Set the fee amount, or switch the fee off.");
  });

  it("warns the client about the late-cancellation fee, then records it", async () => {
    const { s, mk } = await setup({ lateCancelFeeEnabled: true, lateCancelFeeCents: 1500, bookingClosesMinutesBefore: 0 });
    const b = await s.c1.call("POST", "/bookings", { sessionId: await mk(minutesFromNow(120)), acknowledge: ["no_free_cancel"] });
    const check = await s.c1.call("POST", `/bookings/${b.body.id}/cancel`, {});
    expect(check.body.error.message).toBe("This class starts in less than 12 hours, so you won't get your class credit back, and a late-cancellation fee of SGD 15.00 applies. Cancel anyway?");
    const res = await s.c1.call("POST", `/bookings/${b.body.id}/cancel`, { acknowledge: ["late_cancel"] });
    expect(res.body.fee).toMatchObject({ type: "late_cancel", amountCents: 1500, currency: "SGD", status: "pending" });
    expect(await outbox("fee.applied")).toHaveLength(2);
    expect((await s.c1.call("GET", "/settings")).body.lateCancelFee).toBe("SGD 15.00");
  });

  it("adds a no-show fee, removes it if attendance is corrected, and admins can waive", async () => {
    const { s, mk } = await setup({ noShowFeeEnabled: true, noShowFeeCents: 2000, bookingClosesMinutesBefore: 0 });
    const c = await mk(minutesFromNow(30));
    const b1 = await s.c1.call("POST", "/bookings", { sessionId: c, acknowledge: ["no_free_cancel"] });
    const b2 = await s.c2.call("POST", "/bookings", { sessionId: c, acknowledge: ["no_free_cancel"] });

    const marked = await s.ana.call("PUT", `/bookings/${b1.body.id}/attendance`, { attendance: "no_show" });
    expect(marked.body.flags[0].message).toBe("A no-show fee of SGD 20.00 has been added for this client. Admins can waive it.");
    await s.ana.call("PUT", `/bookings/${b1.body.id}/attendance`, { attendance: "present" });
    const [corrected] = await db.select().from(fees).where(eq(fees.bookingId, b1.body.id));
    expect(corrected).toMatchObject({ status: "waived", waivedReason: "Attendance corrected" });

    await s.ana.call("PUT", `/bookings/${b2.body.id}/attendance`, { attendance: "no_show" });
    const pending = await s.owner.call("GET", "/fees");
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({ amount: "SGD 20.00", clientName: expect.stringContaining("Dev") });
    expect((await s.ana.call("POST", `/fees/${pending.body[0].id}/waive`, { reason: "First visit" })).status).toBe(403);
    expect((await s.owner.call("POST", `/fees/${pending.body[0].id}/waive`, { reason: "First visit" })).body.status).toBe("waived");
  });
});
