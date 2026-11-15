import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { classSessions, locations } from "../src/db/schema.js";
import { extendSeries } from "../src/jobs/series.js";
import { app, dayOffset, db, outbox, person, pool, reset, studio } from "./helpers.js";

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

const everyDay = [1, 2, 3, 4, 5, 6, 7];

async function scheduledOn(locationId: string) {
  const rows = await db.select().from(classSessions).where(eq(classSessions.locationId, locationId));
  return rows.filter((r) => r.status === "scheduled");
}

describe("closures and holidays", () => {
  it("cancels the classes already on those days, after asking, and tells each person once", async () => {
    const { s, base } = await setup();
    const series = await s.owner.call("POST", "/series", { ...base, instructorId: s.ana.id, startTime: "09:00", daysOfWeek: everyDay, startDate: dayOffset(1), endDate: dayOffset(20) });
    expect(series.status).toBe(201);
    await s.owner.call("POST", "/sessions", { ...base, instructorId: s.ana.id, date: dayOffset(5), startTime: "18:00" });
    const [first, second] = series.body.sessions.filter((x: { startsAt: string }) => x.startsAt >= series.body.sessions[4].startsAt);
    // Chloe is booked into two classes on the closed days; Dev into one.
    await s.c1.call("POST", "/bookings", { sessionId: first.id });
    await s.c1.call("POST", "/bookings", { sessionId: second.id });
    await s.c2.call("POST", "/bookings", { sessionId: first.id });

    const span = { startDate: dayOffset(5), endDate: dayOffset(6) };
    const preview = await s.owner.call("POST", "/closures/preview", span);
    expect(preview.status).toBe(200);
    expect(preview.body.classes).toBe(3);
    expect(preview.body.peopleBooked).toBe(3);
    expect(preview.body.text).toBe("3 classes are on the schedule for these days (3 people booked).");

    const body = { ...span, name: "Hari Raya", message: "Back on Monday!" };
    const ask = await s.owner.call("POST", "/closures", body);
    expect(ask.status).toBe(409);
    expect(ask.body.error.flags.map((f: { code: string }) => f.code)).toEqual(["closure_cancels_classes"]);
    expect(ask.body.error.message).toBe("This will cancel 3 classes and 3 bookings. Everyone booked and on the waitlist will get one message about it.");
    expect((await s.owner.call("GET", "/closures")).body.closures).toHaveLength(0); // nothing saved until confirmed

    const ok = await s.owner.call("POST", "/closures", { ...body, acknowledge: ["closure_cancels_classes"] });
    expect(ok.status).toBe(201);
    expect(ok.body.cancelled).toBe(3);
    const [cancelled] = await db.select().from(classSessions).where(eq(classSessions.id, first.id));
    expect(cancelled!.status).toBe("cancelled");
    expect(cancelled!.cancelReason).toBe("Studio closed: Hari Raya");

    // One email (and push) each, however many classes they had; no per-class messages.
    const notes = (await outbox("closure.cancelled")).filter((n) => n.channel === "email");
    expect(notes.map((n) => n.userId).sort()).toEqual([s.c1.id, s.c2.id, s.ana.id].sort());
    const chloe = notes.find((n) => n.userId === s.c1.id)!.data as { items: string[]; role: string; refundNote: string; message: string };
    expect(chloe.items).toHaveLength(2);
    expect(chloe.role).toBe("booked");
    expect(chloe.refundNote).toBe("Your class credit has been returned to your account.");
    expect(chloe.message).toBe("Back on Monday!");
    expect(notes.find((n) => n.userId === s.ana.id)!.data).toMatchObject({ role: "teaching" });
    expect(await outbox("session.cancelled")).toHaveLength(0);
  });

  it("recurring classes skip closed days, both when created and when topped up later", async () => {
    const { s, base } = await setup();
    await s.owner.call("POST", "/closures", { name: "Deepavali", startDate: dayOffset(3), endDate: dayOffset(3) });
    const series = await s.owner.call("POST", "/series", { ...base, startTime: "07:00", daysOfWeek: everyDay, startDate: dayOffset(1), occurrences: 5 });
    expect(series.status).toBe(201);
    const dates = series.body.sessions.map((x: { startsAt: string }) => new Date(x.startsAt).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }));
    // A course with a set number of classes still gets all five, the missed one at the end.
    expect(dates).toEqual([dayOffset(1), dayOffset(2), dayOffset(4), dayOffset(5), dayOffset(6)]);
    expect(series.body.flags[0]).toMatchObject({ code: "closure_skips_classes", severity: "info" });
    expect(series.body.flags[0].message).toMatch(/^1 date is left out because the studio is closed: \w{3} \d+ \w{3} \(Deepavali\)\.$/);

    // An open-ended series topped up by the worker skips a closure added later.
    const open = await s.owner.call("POST", "/series", { ...base, roomId: null, startTime: "19:00", daysOfWeek: everyDay, startDate: dayOffset(1) });
    expect(open.status).toBe(201);
    const far = 200;
    await s.owner.call("POST", "/closures", { name: "Renovation", startDate: dayOffset(far - 1), endDate: dayOffset(far) });
    await extendSeries(db, far + 5);
    const evening = (await scheduledOn(s.locationId)).filter((r) => r.seriesId === open.body.series.id);
    const local = new Set(evening.map((r) => r.startsAt.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" })));
    expect(local.has(dayOffset(far - 2))).toBe(true);
    expect(local.has(dayOffset(far - 1))).toBe(false);
    expect(local.has(dayOffset(far))).toBe(false);
    expect(local.has(dayOffset(far + 1))).toBe(true);
  });

  it("asks before adding or moving a class onto a closed day", async () => {
    const { s, base } = await setup();
    await s.owner.call("POST", "/closures", { name: "Chinese New Year", startDate: dayOffset(4), endDate: dayOffset(5) });
    const add = await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(4), startTime: "10:00" });
    expect(add.status).toBe(409);
    expect(add.body.error.flags[0].code).toBe("closed_day");
    expect(add.body.error.message).toMatch(/^The studio is closed on \w{3} \d+ \w{3} \(Chinese New Year\)\. Add the class anyway\?$/);
    const kept = await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(4), startTime: "10:00", acknowledge: ["closed_day"] });
    expect(kept.status).toBe(201);
    // Editing something else about that class doesn't ask again.
    expect((await s.owner.call("PATCH", `/sessions/${kept.body.id}`, { scope: "this", changes: { capacity: 12 } })).status).toBe(200);

    const other = await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(7), startTime: "10:00" });
    const move = await s.owner.call("PATCH", `/sessions/${other.body.id}`, { scope: "this", changes: { date: dayOffset(5) } });
    expect(move.status).toBe(409);
    expect(move.body.error.flags[0].code).toBe("closed_day");
    expect(move.body.error.message).toMatch(/\(Chinese New Year\)\. Move the class there anyway\?$/);
  });

  it("can keep the classes on the schedule instead of cancelling them", async () => {
    const { s, base } = await setup();
    await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(3), startTime: "10:00" });
    const res = await s.owner.call("POST", "/closures", { name: "Staff training", startDate: dayOffset(3), endDate: dayOffset(3), cancelClasses: false });
    expect(res.status).toBe(201);
    expect(res.body.kept).toBe(1);
    expect(res.body.flags[0]).toMatchObject({ code: "closed_day", severity: "info" });
    expect(await scheduledOn(s.locationId)).toHaveLength(1);
  });

  it("one location's closure leaves other locations open", async () => {
    const { s, base } = await setup();
    const [east] = await db.insert(locations).values({ orgId: s.orgId, name: "East", timezone: "Asia/Singapore" }).returning();
    await s.owner.call("POST", "/sessions", { ...base, date: dayOffset(3), startTime: "10:00" });
    const eastClass = await s.owner.call("POST", "/sessions", { ...base, roomId: null, locationId: east!.id, date: dayOffset(3), startTime: "10:00" });
    const res = await s.owner.call("POST", "/closures", { name: "Aircon repair", locationId: east!.id, startDate: dayOffset(3), endDate: dayOffset(3), acknowledge: ["closure_cancels_classes"] });
    expect(res.status).toBe(201);
    expect(res.body.cancelled).toBe(1);
    expect(await scheduledOn(s.locationId)).toHaveLength(1);
    const [e] = await db.select().from(classSessions).where(eq(classSessions.id, eastClass.body.id));
    expect(e!.status).toBe("cancelled");
    // Studio-wide closures show on every location's calendar; a location's only on its own.
    const central = await s.c1.call("GET", `/calendar?view=week&date=${dayOffset(3)}&locationId=${s.locationId}`);
    expect(central.body.closures).toHaveLength(0);
    const eastCal = await s.c1.call("GET", `/calendar?view=week&date=${dayOffset(3)}&locationId=${east!.id}`);
    expect(eastCal.body.closures[0]).toMatchObject({ name: "Aircon repair", startDate: dayOffset(3) });
  });

  it("removing a closure brings back the recurring classes it left out, but not cancelled ones", async () => {
    const { s, base } = await setup();
    const series = await s.owner.call("POST", "/series", { ...base, startTime: "07:00", daysOfWeek: everyDay, startDate: dayOffset(1) });
    const onDay3 = series.body.sessions[2];
    await s.c1.call("POST", "/bookings", { sessionId: onDay3.id });
    const closure = await s.owner.call("POST", "/closures", { name: "Vesak Day", startDate: dayOffset(3), endDate: dayOffset(4), acknowledge: ["closure_cancels_classes"] });
    expect(closure.body.cancelled).toBe(2);
    // The day-4 class had nobody booked; to see it come back, the series must not have it at all.
    await db.delete(classSessions).where(eq(classSessions.id, series.body.sessions[3].id));

    const del = await s.owner.call("DELETE", `/closures/${closure.body.closure.id}`, {});
    expect(del.status).toBe(200);
    expect(del.body.restored).toBe(1);
    expect(del.body.stillCancelled).toBe(1);
    expect(del.body.text).toBe("1 recurring class is back on the schedule. 1 class cancelled for this closure stays cancelled. Add it again from the calendar if you need to.");
  });

  it("refuses dates that make no sense, in plain words", async () => {
    const { s } = await setup();
    const backwards = await s.owner.call("POST", "/closures", { name: "Oops", startDate: dayOffset(5), endDate: dayOffset(3) });
    expect(backwards.status).toBe(400);
    expect(backwards.body.error.fields.endDate).toBe("The last day can't be before the first day.");
    const past = await s.owner.call("POST", "/closures", { name: "Old", startDate: dayOffset(-5), endDate: dayOffset(-3) });
    expect(past.status).toBe(400);
    expect(past.body.error.message).toBe("Those days have already passed. Choose today or a later date.");
    const long = await s.owner.call("POST", "/closures", { name: "Forever", startDate: dayOffset(1), endDate: dayOffset(400) });
    expect(long.body.error.fields.endDate).toBe("A closure can be up to a year long.");
    const noName = await s.owner.call("POST", "/closures", { name: " ", startDate: dayOffset(1), endDate: dayOffset(1) });
    expect(noName.body.error.fields.name).toBe("Give the closure a name, like “Hari Raya”.");
  });

  it("only admins add closures; everyone can see them; studios stay separate", async () => {
    const { s } = await setup();
    const body = { name: "Hari Raya", startDate: dayOffset(3), endDate: dayOffset(3) };
    const desk = await person(s.orgId, "front_desk");
    expect((await s.c1.call("POST", "/closures", body)).status).toBe(403);
    expect((await s.ana.call("POST", "/closures", body)).status).toBe(403);
    expect((await desk.call("POST", "/closures", body)).status).toBe(403);
    const made = await s.owner.call("POST", "/closures", body);
    expect((await s.c1.call("GET", "/closures")).body.closures[0]).toMatchObject({ name: "Hari Raya", locationName: "All locations" });
    expect((await s.c1.call("DELETE", `/closures/${made.body.closure.id}`, {})).status).toBe(403);

    const other = await studio();
    expect((await other.owner.call("GET", "/closures")).body.closures).toHaveLength(0);
    expect((await other.owner.call("PATCH", `/closures/${made.body.closure.id}`, { name: "Mine now" })).status).toBe(404);
    expect((await other.owner.call("DELETE", `/closures/${made.body.closure.id}`, {})).status).toBe(404);
    const otherLoc = await other.owner.call("POST", "/closures", { ...body, locationId: s.locationId });
    expect(otherLoc.status).toBe(404);
  });
});
