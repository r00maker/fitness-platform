import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, dayOffset, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function setup() {
  const s = await studio();
  const base = { classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, capacity: 10, durationMinutes: 50 };
  return { s, base };
}

describe("templates and sessions", () => {
  it("creates a class from a template, filling in the gaps", async () => {
    const { s } = await setup();
    const tpl = await s.owner.call("POST", "/templates", { name: "Morning Reformer", classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, capacity: 12, durationMinutes: 50, startTime: "07:00" });
    expect(tpl.status).toBe(201);
    const res = await s.owner.call("POST", "/sessions", { templateId: tpl.body.id, date: dayOffset(3) });
    expect(res.status).toBe(201);
    expect(res.body.capacity).toBe(12);
    expect(res.body.instructorId).toBe(s.ana.id);
    expect(await outbox("instructor.assigned")).toHaveLength(2); // email + push to Ana
  });

  it("explains missing details in plain English", async () => {
    const { s } = await setup();
    const res = await s.owner.call("POST", "/sessions", { date: dayOffset(3), classTypeId: s.classTypeId });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.locationId).toBe("Choose a location.");
  });

  it("flags (but allows) double-booking an instructor", async () => {
    const { s, base } = await setup();
    await s.owner.call("POST", "/sessions", { ...base, instructorId: s.ana.id, date: dayOffset(3), startTime: "09:00" });
    const second = { ...base, roomId: null, instructorId: s.ana.id, date: dayOffset(3), startTime: "09:30" };
    const res = await s.owner.call("POST", "/sessions", second);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("needs_confirmation");
    expect(res.body.error.flags[0].code).toBe("instructor_double_booked");
    expect(res.body.error.message).toMatch(/Ana T\d+ is also teaching Reformer Pilates at 9:00am/);
    const ok = await s.owner.call("POST", "/sessions", { ...second, acknowledge: ["instructor_double_booked"] });
    expect(ok.status).toBe(201);
    expect(ok.body.flags[0].code).toBe("instructor_double_booked");
  });

  it("clients and instructors can't change the schedule", async () => {
    const { s, base } = await setup();
    expect((await s.c1.call("POST", "/sessions", { ...base, date: dayOffset(3), startTime: "09:00" })).status).toBe(403);
    expect((await s.ana.call("POST", "/sessions", { ...base, date: dayOffset(3), startTime: "09:00" })).status).toBe(403);
  });

  it("keeps studios completely separate", async () => {
    const { s, base } = await setup();
    const other = await studio();
    const created = await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(3), startTime: "09:00" });
    expect((await other.owner.call("GET", `/sessions/${created.body.id}`)).status).toBe(404);
    expect((await other.c1.call("POST", "/bookings", { sessionId: created.body.id })).status).toBe(404);
  });
});

describe("recurring classes, calendar and bulk edits", () => {
  it("creates a series and shows it colour-coded on the calendar with filters", async () => {
    const { s, base } = await setup();
    const series = await s.owner.call("POST", "/series", { ...base, instructorId: s.ana.id, startTime: "07:00", daysOfWeek: [1, 2, 3, 4, 5], startDate: dayOffset(1), occurrences: 10 });
    expect(series.status).toBe(201);
    expect(series.body.sessions).toHaveLength(10);
    await s.owner.call("POST", "/sessions", { ...base, instructorId: s.ben.id, date: dayOffset(1), startTime: "18:30" });

    const month = await s.c1.call("GET", `/calendar?view=month&date=${dayOffset(1)}`);
    expect(month.status).toBe(200);
    expect(month.body.sessions[0].color).toBe("#4F46E5");
    expect(month.body.sessions[0].notes).toBeUndefined(); // clients never see staff notes

    const day = await s.owner.call("GET", `/calendar?view=day&date=${dayOffset(1)}`);
    const evening = await s.owner.call("GET", `/calendar?view=day&date=${dayOffset(1)}&timeOfDay=evening`);
    const byBen = await s.owner.call("GET", `/calendar?view=month&date=${dayOffset(1)}&instructorId=${s.ben.id}`);
    const search = await s.owner.call("GET", `/calendar?view=day&date=${dayOffset(1)}&q=ben`);
    expect(day.body.sessions.length).toBeGreaterThanOrEqual(1);
    expect(evening.body.sessions.every((x: { localStartTime: string }) => x.localStartTime === "18:30")).toBe(true);
    expect(byBen.body.sessions).toHaveLength(1);
    expect(search.body.sessions).toHaveLength(1);
  });

  it("edits 'this and later classes' without touching earlier ones", async () => {
    const { s, base } = await setup();
    const { body } = await s.owner.call("POST", "/series", { ...base, instructorId: s.ana.id, startTime: "07:00", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate: dayOffset(1), occurrences: 6 });
    const third = body.sessions[2];
    const res = await s.owner.call("PATCH", `/sessions/${third.id}`, { scope: "following", changes: { instructorId: s.ben.id, startTime: "08:00" } });
    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(4);
    const first = await s.owner.call("GET", `/sessions/${body.sessions[0].id}`);
    expect(first.body.instructorId).toBe(s.ana.id);
    expect(res.body.updated[0].instructorId).toBe(s.ben.id);
    // Personnel change: Ana told she's off, Ben told he's on.
    expect((await outbox("instructor.removed")).length).toBeGreaterThan(0);
    expect((await outbox("session.rescheduled")).length).toBeGreaterThan(0);
  });

  it("bulk-edits and bulk-cancels selected classes", async () => {
    const { s, base } = await setup();
    const { body } = await s.owner.call("POST", "/series", { ...base, startTime: "07:00", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate: dayOffset(1), occurrences: 3 });
    const ids = body.sessions.map((x: { id: string }) => x.id);
    const upd = await s.owner.call("POST", "/sessions/bulk-update", { sessionIds: ids, changes: { capacity: 15 } });
    expect(upd.body.updated.every((x: { capacity: number }) => x.capacity === 15)).toBe(true);
    const cancel = await s.owner.call("POST", "/sessions/bulk-cancel", { sessionIds: ids.slice(0, 2), reason: "Studio maintenance" });
    expect(cancel.body.cancelled).toHaveLength(2);
  });

  it("duplicates a class onto other dates, flagging clashes for the user to decide", async () => {
    const { s, base } = await setup();
    const one = await s.owner.call("POST", "/sessions", { ...base, instructorId: s.ana.id, date: dayOffset(2), startTime: "07:00" });
    await s.owner.call("POST", "/sessions", { ...base, roomId: null, instructorId: s.ana.id, date: dayOffset(4), startTime: "07:00" });
    const dates = [dayOffset(3), dayOffset(4)];
    const res = await s.owner.call("POST", `/sessions/${one.body.id}/duplicate`, { dates });
    expect(res.status).toBe(409);
    expect(res.body.error.flags.map((f: { details: { date: string } }) => f.details.date)).toEqual([dayOffset(4), dayOffset(4)]);
    expect((await s.owner.call("GET", `/calendar?view=month&date=${dayOffset(3)}`)).body.sessions).toHaveLength(2); // nothing was created
    const ok = await s.owner.call("POST", `/sessions/${one.body.id}/duplicate`, { dates, acknowledge: ["instructor_double_booked", "possible_duplicate"] });
    expect(ok.status).toBe(201);
    expect(ok.body.created).toHaveLength(2);
  });

  it("delete removes an unused class but cancels one with bookings (keeping history)", async () => {
    const { s, base } = await setup();
    const empty = await s.owner.call("POST", "/sessions", { ...base, instructorId: s.ana.id, date: dayOffset(2), startTime: "07:00" });
    const used = await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(2), startTime: "09:00" });
    await s.c1.call("POST", "/bookings", { sessionId: used.body.id });

    expect((await s.owner.call("DELETE", `/sessions/${empty.body.id}`, {})).body.deleted).toHaveLength(1);
    const check = await s.owner.call("DELETE", `/sessions/${used.body.id}`, { reason: "Instructor unwell", refund: "credit" });
    expect(check.body.error.message).toBe("1 booked client will be told the class is cancelled and given: return class credit.");
    const res = await s.owner.call("DELETE", `/sessions/${used.body.id}`, { reason: "Instructor unwell", refund: "credit", acknowledge: ["clients_affected"] });
    expect(res.body.cancelled).toHaveLength(1);
    const cancelNotices = await outbox("session.cancelled");
    expect(cancelNotices.map((n) => n.userId)).toEqual(expect.arrayContaining([s.ana.id, s.c1.id]));
  });
});
