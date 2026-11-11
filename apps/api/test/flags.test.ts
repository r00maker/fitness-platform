import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, dayOffset, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

type FlagBody = { code: string; message: string; suggestion?: Record<string, unknown>; severity: string };
const codes = (flags: FlagBody[]) => flags.map((f) => f.code);

async function setup() {
  const s = await studio();
  const base = { classTypeId: s.classTypeId, locationId: s.locationId, capacity: 10, durationMinutes: 50, date: dayOffset(3) };
  return { s, base };
}

describe("catching likely mistakes", () => {
  it("11am–12am: flags the midnight finish and suggests 12pm", async () => {
    const { s, base } = await setup();
    const { durationMinutes: _, ...noLength } = base;
    const res = await s.owner.call("POST", "/sessions", { ...noLength, instructorId: s.ana.id, startTime: "11:00", endTime: "00:00" });
    expect(res.status).toBe(409);
    const [flag] = res.body.error.flags as FlagBody[];
    expect(flag!.code).toBe("ends_after_midnight");
    expect(flag!.message).toBe("This class ends at 12:00am (midnight), which is before its 11:00am start, so it would run overnight for 13 hours. Did you mean 11:00am to 12:00pm (noon)?");
    expect(flag!.suggestion).toEqual({ durationMinutes: 60, endTime: "12:00" });

    // Applying the suggestion goes straight through.
    const fixed = await s.owner.call("POST", "/sessions", { ...noLength, instructorId: s.ana.id, startTime: "11:00", endTime: flag!.suggestion!.endTime });
    expect(fixed.status).toBe(201);
    expect(new Date(fixed.body.endsAt).getTime() - new Date(fixed.body.startsAt).getTime()).toBe(60 * 60_000);
  });

  it("flags 9am–9pm as unusually long with an AM/PM fix", async () => {
    const { s, base } = await setup();
    const res = await s.owner.call("POST", "/sessions", { ...base, durationMinutes: 12 * 60 + 60, startTime: "09:00", instructorId: s.ana.id });
    expect(res.body.error.flags[0].code).toBe("unusually_long");
    expect(res.body.error.flags[0].suggestion.durationMinutes).toBe(60);
  });

  it("flags a 3am start and suggests 3pm", async () => {
    const { s, base } = await setup();
    const res = await s.owner.call("POST", "/sessions", { ...base, startTime: "03:00", instructorId: s.ana.id });
    expect(res.body.error.flags[0]).toMatchObject({ code: "unusual_start_time", message: "This class starts at 3:00am. Did you mean 3:00pm?", suggestion: { startTime: "15:00" } });
  });

  it("flags dates in the past and over a year away", async () => {
    const { s, base } = await setup();
    const past = await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(-2), startTime: "09:00", instructorId: s.ana.id });
    expect(codes(past.body.error.flags)).toContain("in_the_past");
    const far = await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(400), startTime: "09:00", instructorId: s.ana.id });
    expect(codes(far.body.error.flags)).toContain("far_future");
  });

  it("flags more spots than the room holds and offers the room limit", async () => {
    const { s, base } = await setup();
    const res = await s.owner.call("POST", "/sessions", { ...base, roomId: s.roomId, capacity: 40, startTime: "09:00", instructorId: s.ana.id });
    expect(res.body.error.flags[0]).toMatchObject({ code: "over_room_limit", suggestion: { capacity: 30 } });
  });

  it("flags a class that looks like it was created twice", async () => {
    const { s, base } = await setup();
    await s.owner.call("POST", "/sessions", { ...base, startTime: "09:00", instructorId: s.ana.id });
    const res = await s.owner.call("POST", "/sessions", { ...base, startTime: "09:00", instructorId: s.ben.id });
    expect(codes(res.body.error.flags)).toEqual(["possible_duplicate"]);
  });

  it("info-level notes never block: no instructor yet", async () => {
    const { s, base } = await setup();
    const res = await s.owner.call("POST", "/sessions", { ...base, startTime: "09:00" });
    expect(res.status).toBe(201);
    expect(res.body.flags).toEqual([expect.objectContaining({ code: "no_instructor", severity: "info" })]);
  });

  it("acknowledging one warning doesn't wave through a different one", async () => {
    const { s, base } = await setup();
    await s.owner.call("POST", "/sessions", { ...base, roomId: s.roomId, startTime: "09:00", instructorId: s.ana.id });
    const res = await s.owner.call("POST", "/sessions", { ...base, classTypeId: s.classTypeId, roomId: s.roomId, startTime: "09:15", instructorId: s.ana.id, acknowledge: ["instructor_double_booked"] });
    expect(res.status).toBe(409);
    expect(codes(res.body.error.flags)).toEqual(["room_double_booked"]);
  });

  it("shows clashes as badges on the calendar for staff", async () => {
    const { s, base } = await setup();
    await s.owner.call("POST", "/sessions", { ...base, startTime: "09:00", instructorId: s.ana.id });
    await s.owner.call("POST", "/sessions", { ...base, startTime: "09:30", instructorId: s.ana.id, acknowledge: ["instructor_double_booked"] });
    const cal = await s.owner.call("GET", `/calendar?view=day&date=${base.date}`);
    expect(cal.body.sessions.map((x: { flags: { code: string }[] }) => x.flags.map((f) => f.code))).toEqual([["instructor_double_booked"], ["instructor_double_booked"]]);
    const clientView = await s.c1.call("GET", `/calendar?view=day&date=${base.date}`);
    expect(clientView.body.sessions[0].flags).toBeUndefined();
  });
});

describe("changes that affect people", () => {
  it("asks before moving a class people are booked into", async () => {
    const { s, base } = await setup();
    const c = await s.owner.call("POST", "/sessions", { ...base, startTime: "09:00", instructorId: s.ana.id });
    await s.c1.call("POST", "/bookings", { sessionId: c.body.id });
    const res = await s.owner.call("PATCH", `/sessions/${c.body.id}`, { changes: { startTime: "10:00" } });
    expect(res.body.error.flags[0]).toMatchObject({ code: "clients_affected", message: "1 booked client will be told about the new time." });
    const ok = await s.owner.call("PATCH", `/sessions/${c.body.id}`, { changes: { startTime: "10:00" }, acknowledge: ["clients_affected"] });
    expect(ok.status).toBe(200);
  });

  it("asks before cancelling with no refund", async () => {
    const { s, base } = await setup();
    const c = await s.owner.call("POST", "/sessions", { ...base, startTime: "09:00", instructorId: s.ana.id });
    await s.c1.call("POST", "/bookings", { sessionId: c.body.id });
    const res = await s.owner.call("POST", `/sessions/${c.body.id}/cancel`, { refund: "none" });
    expect(codes(res.body.error.flags)).toEqual(["clients_affected", "no_refund"]);
  });

  it("flags a client booked into two overlapping classes", async () => {
    const { s, base } = await setup();
    const a = await s.owner.call("POST", "/sessions", { ...base, startTime: "09:00", instructorId: s.ana.id });
    const b = await s.owner.call("POST", "/sessions", { ...base, startTime: "09:30", instructorId: s.ben.id, acknowledge: ["possible_duplicate"] });
    await s.c1.call("POST", "/bookings", { sessionId: a.body.id });
    const res = await s.c1.call("POST", "/bookings", { sessionId: b.body.id });
    expect(res.body.error.message).toBe("You're already booked into Reformer Pilates at 9:00am on " + res.body.error.message.split(" on ")[1]);
    expect((await s.c1.call("POST", "/bookings", { sessionId: b.body.id, acknowledge: ["client_double_booked"] })).status).toBe(201);
  });

  it("flags refunding the same booking twice", async () => {
    const { s, base } = await setup();
    const c = await s.owner.call("POST", "/sessions", { ...base, startTime: "09:00", instructorId: s.ana.id });
    const b = await s.c1.call("POST", "/bookings", { sessionId: c.body.id });
    expect((await s.owner.call("POST", `/bookings/${b.body.id}/refund`, { method: "credit", reason: "Late start" })).status).toBe(200);
    const again = await s.owner.call("POST", `/bookings/${b.body.id}/refund`, { method: "credit", reason: "Late start" });
    expect(again.body.error.flags[0].code).toBe("already_refunded");
  });

  it("flags cover from an instructor who's already teaching then", async () => {
    const s = await studio({ substituteApproval: "automatic" });
    const base = { classTypeId: s.classTypeId, locationId: s.locationId, capacity: 10, durationMinutes: 50, date: dayOffset(3), startTime: "09:00" };
    const anaClass = await s.owner.call("POST", "/sessions", { ...base, instructorId: s.ana.id });
    await s.owner.call("POST", "/sessions", { ...base, locationId: s.locationId, instructorId: s.ben.id, startTime: "09:15" });
    const req = await s.ana.call("POST", "/substitute-requests", { sessionId: anaClass.body.id });
    const accept = await s.ben.call("POST", `/substitute-requests/${req.body.id}/accept`, {});
    expect(accept.body.error.flags[0].code).toBe("instructor_double_booked");
    const ok = await s.ben.call("POST", `/substitute-requests/${req.body.id}/accept`, { acknowledge: ["instructor_double_booked"] });
    expect(ok.body.status).toBe("filled");
  });
});

describe("daylight-saving setting", () => {
  it("is off by default and can be switched on by an admin", async () => {
    const { s } = await setup();
    expect((await s.owner.call("GET", "/settings")).body.observesDaylightSaving).toBe(false);
    expect((await s.owner.call("PATCH", "/settings", { observesDaylightSaving: true })).body.observesDaylightSaving).toBe(true);
    expect((await s.ana.call("PATCH", "/settings", { observesDaylightSaving: false })).status).toBe(403);
  });
});
