import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, classSessions, fees, organizations } from "../src/db/schema.js";
import { app, dayOffset, db, minutesFromNow, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const ACK = ["in_the_past", "unusual_start_time", "ends_after_midnight", "short_notice"];

async function setup() {
  const s = await studio();
  await db.update(organizations).set({ noShowFeeEnabled: true, noShowFeeCents: 2000 }).where(eq(organizations.id, s.orgId));
  const mk = async (when: { date: string; startTime: string }) => {
    const r = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, acknowledge: ACK, ...when });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [b] = await db.insert(bookings).values({ orgId: s.orgId, sessionId: r.body.id, clientId: s.c1.id, source: "client" }).returning();
    return { sessionId: r.body.id as string, bookingId: b!.id };
  };
  const pendingFees = async () => (await s.owner.call("GET", "/fees")).body as { id: string; type: string; final: boolean; finalNote: string | null }[];
  return { s, mk, pendingFees };
}

describe("attendance locks at midnight after the class", () => {
  it("until then, staff can change it and the no-show fee follows; collecting early asks first", async () => {
    const { s, mk, pendingFees } = await setup();
    // Starts in 30 minutes: attendance is open (an hour before) and can't be locked yet, whatever the time of day.
    const { sessionId, bookingId } = await mk(minutesFromNow(30));
    const detail = (await s.ana.call("GET", `/sessions/${sessionId}`)).body;
    expect(detail.attendanceWindow.locked).toBe(false);
    expect(new Date(detail.attendanceWindow.locksAt).getTime()).toBeGreaterThan(Date.now());

    expect((await s.ana.call("PUT", `/bookings/${bookingId}/attendance`, { attendance: "no_show" })).status).toBe(200);
    const [fee] = await pendingFees();
    expect(fee).toMatchObject({ type: "no_show", final: false });
    expect(fee!.finalNote).toMatch(/^Can still change until midnight at the end of \w{3} \d+ \w{3} \(if attendance is corrected\)$/);

    const early = await s.owner.call("POST", `/fees/${fee!.id}/mark-paid`, {});
    expect(early.status).toBe(409);
    expect(early.body.error.flags[0].code).toBe("fee_not_final");
    expect(early.body.error.message).toMatch(/which would remove this no-show fee\. Collect it now anyway\?$/);

    // Corrected before midnight: the fee goes.
    expect((await s.ana.call("PUT", `/bookings/${bookingId}/attendance`, { attendance: "present" })).status).toBe(200);
    expect(await pendingFees()).toHaveLength(0);
  });

  it("after midnight it's final: instructors and Front of House can't change it; admins can, after a warning", async () => {
    const { s, mk, pendingFees } = await setup();
    const { sessionId, bookingId } = await mk({ date: dayOffset(-1), startTime: "09:00" });
    expect((await s.owner.call("PUT", `/bookings/${bookingId}/attendance`, { attendance: "no_show", acknowledge: ["attendance_locked"] })).status).toBe(200);
    expect((await s.owner.call("GET", `/sessions/${sessionId}`)).body.attendanceWindow.locked).toBe(true);

    const ana = await s.ana.call("PUT", `/bookings/${bookingId}/attendance`, { attendance: "present" });
    expect(ana.status).toBe(409);
    expect(ana.body.error.code).toBe("attendance_locked");
    expect(ana.body.error.message).toMatch(/^Attendance for this class closed at midnight at the end of \w{3} \d+ \w{3}\. Ask an admin if it needs correcting\.$/);
    const desk = await person(s.orgId, "front_desk");
    expect((await desk.call("PUT", `/bookings/${bookingId}/attendance`, { attendance: "present" })).body.error.code).toBe("attendance_locked");
    expect((await s.ana.call("POST", `/sessions/${sessionId}/attendance/mark-all`, { acknowledge: ["attendance_locked"] })).body.error.code).toBe("attendance_locked");

    // The fee is final, so collecting it doesn't ask.
    const [fee] = await pendingFees();
    expect(fee).toMatchObject({ final: true, finalNote: null });
    expect((await s.owner.call("POST", `/fees/${fee!.id}/mark-paid`, {})).status).toBe(200);

    // An admin correcting it after it was paid is told to refund it.
    const ask = await s.owner.call("PUT", `/bookings/${bookingId}/attendance`, { attendance: "present" });
    expect(ask.body.error.message).toMatch(/was locked at midnight at the end of .+ and any no-show fees are final\. Changing it now adds or removes a no-show fee\. Change it anyway\?$/);
    const fix = await s.owner.call("PUT", `/bookings/${bookingId}/attendance`, { attendance: "present", acknowledge: ["attendance_locked"] });
    expect(fix.status).toBe(200);
    expect(fix.body.flags.map((f: { message: string }) => f.message)).toContain("This client already paid the no-show fee. Refund it under Sales if they shouldn't have been charged.");
    expect((await db.select().from(fees).where(eq(fees.bookingId, bookingId)))[0]!.status).toBe("charged");
  });

  it("late-cancellation fees are final straight away", async () => {
    const { s, pendingFees } = await setup();
    await db.update(organizations).set({ lateCancelFeeEnabled: true, lateCancelFeeCents: 1500, bookingClosesMinutesBefore: 0 }).where(eq(organizations.id, s.orgId));
    const r = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, capacity: 10, durationMinutes: 50, acknowledge: [...ACK, "no_instructor"], ...minutesFromNow(120) });
    const b = await s.c2.call("POST", "/bookings", { sessionId: r.body.id, acknowledge: ["no_free_cancel"] });
    await s.c2.call("POST", `/bookings/${b.body.id}/cancel`, { acknowledge: ["late_cancel"] });
    const [fee] = await pendingFees();
    expect(fee).toMatchObject({ type: "late_cancel", final: true });
    expect((await s.owner.call("POST", `/fees/${fee!.id}/mark-paid`, {})).status).toBe(200);
  });
});

describe("deleting a template", () => {
  it("asks first, says classes made from it stay the same, and leaves them untouched", async () => {
    const s = await studio();
    const tpl = (await s.owner.call("POST", "/templates", { name: "Morning Reformer", classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, capacity: 12, durationMinutes: 50, startTime: "07:00" })).body;
    const one = (await s.owner.call("POST", "/sessions", { templateId: tpl.id, date: dayOffset(3) })).body;
    await s.owner.call("POST", "/series", { templateId: tpl.id, daysOfWeek: [1], startDate: dayOffset(1), occurrences: 3 });

    const ask = await s.owner.call("DELETE", `/templates/${tpl.id}`, {});
    expect(ask.status).toBe(409);
    expect(ask.body.error.flags[0].code).toBe("delete_template");
    expect(ask.body.error.message).toBe("“Morning Reformer” will be deleted, so it can't be used for new classes. The 4 upcoming classes and 1 repeating schedule made from it stay exactly as they are.");
    const ok = await s.owner.call("DELETE", `/templates/${tpl.id}`, { acknowledge: ["delete_template"] });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ deleted: "Morning Reformer", classesKept: 4, repeatsKept: 1 });

    expect((await s.owner.call("GET", "/templates")).body).toHaveLength(0);
    const [kept] = await db.select().from(classSessions).where(eq(classSessions.id, one.id));
    expect(kept).toMatchObject({ capacity: 12, instructorId: s.ana.id, status: "scheduled" });
    expect((await s.owner.call("POST", "/sessions", { templateId: tpl.id, date: dayOffset(4) })).status).toBe(404);
    expect((await s.owner.call("DELETE", `/templates/${tpl.id}`, { acknowledge: ["delete_template"] })).status).toBe(404);
  });

  it("only admins can, and studios stay separate", async () => {
    const s = await studio();
    const tpl = (await s.owner.call("POST", "/templates", { name: "Evening Yoga", classTypeId: s.classTypeId, locationId: s.locationId, capacity: 12, durationMinutes: 60, startTime: "19:00" })).body;
    expect((await s.ana.call("DELETE", `/templates/${tpl.id}`, { acknowledge: ["delete_template"] })).status).toBe(403);
    const other = await studio();
    expect((await other.owner.call("DELETE", `/templates/${tpl.id}`, { acknowledge: ["delete_template"] })).status).toBe(404);
    const unused = await s.owner.call("DELETE", `/templates/${tpl.id}`, {});
    expect(unused.body.error.message).toBe("“Evening Yoga” will be deleted, so it can't be used for new classes. No upcoming classes use it.");
  });
});
