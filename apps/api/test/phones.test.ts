import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bookings, classSessions } from "../src/db/schema.js";
import { app, dayOffset, db, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`);

describe("client booking on phones: the date strip", () => {
  it("counts each day's classes, what can still be booked, and where you're booked", async () => {
    const s = await studio();
    const mk = async (date: string, hhmm: string, capacity: number, instructorId = s.ana.id) => (await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, instructorId, capacity, startsAt: at(date, hhmm), endsAt: new Date(at(date, hhmm).getTime() + 50 * 60_000) }).returning())[0]!.id;
    const d1 = dayOffset(1), d3 = dayOffset(3);
    const full = await mk(d1, "07:00", 1), open = await mk(d1, "18:00", 10, s.ben.id);
    await mk(d3, "09:00", 10);
    await db.insert(bookings).values([{ orgId: s.orgId, sessionId: full, clientId: s.c2.id, source: "client" }, { orgId: s.orgId, sessionId: open, clientId: s.c1.id, source: "client" }]);

    const r = await s.c1.call("GET", `/calendar/strip?date=${dayOffset(0)}&days=7`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.days).toHaveLength(7);
    expect(r.body.days[1]).toMatchObject({ date: d1, classes: 2, bookable: 1, youreBooked: true, closed: null });
    expect(r.body.days[3]).toMatchObject({ date: d3, classes: 1, bookable: 1, youreBooked: false });
    expect(r.body.days[2]).toMatchObject({ classes: 0, bookable: 0 });
    expect(r.body.days[0].weekday).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    // Same filters as the calendar.
    expect((await s.c1.call("GET", `/calendar/strip?date=${dayOffset(0)}&days=7&instructorId=${s.ben.id}`)).body.days[1].classes).toBe(1);
    // The day's list says which classes you're in.
    const day = (await s.c1.call("GET", `/calendar?view=day&date=${d1}`)).body.sessions;
    expect(day.map((x: { youreBooked: boolean; isFull: boolean }) => `${x.youreBooked}:${x.isFull}`)).toEqual(["false:true", "true:false"]);
    expect((await s.c1.call("GET", `/calendar/strip?date=${dayOffset(0)}&days=40`)).status).toBe(400);
  });
});

describe("instructors on phones: up next and check-in mode", () => {
  it("lists everyone booked with what matters at the door, searchable, and counts check-ins", async () => {
    const s = await studio({ waiverRequired: true });
    const startsAt = new Date(Date.now() + 30 * 60_000);
    const [c] = await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000) }).returning();
    const [b1] = await db.insert(bookings).values({ orgId: s.orgId, sessionId: c!.id, clientId: s.c3.id, source: "client" }).returning();
    await db.insert(bookings).values({ orgId: s.orgId, sessionId: c!.id, clientId: s.c1.id, source: "client" });

    const r = await s.ana.call("GET", `/sessions/${c!.id}/check-in`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ open: true, counts: { booked: 2, checkedIn: 0, notYet: 2 } });
    expect(r.body.people.map((p: { name: string }) => p.name.split(" ")[0])).toEqual(["Chloe", "Eve"]); // by first name
    expect(r.body.people[0].flags.map((f: { kind: string }) => f.kind)).toEqual(["waiver_missing", "first_class"]);
    expect((await s.ana.call("GET", `/sessions/${c!.id}/check-in?q=eve`)).body.people).toHaveLength(1);
    expect((await s.ben.call("GET", `/sessions/${c!.id}/check-in`)).status).toBe(404); // not their class
    expect((await s.c1.call("GET", `/sessions/${c!.id}/check-in`)).status).toBe(404);
    expect((await s.owner.call("GET", `/sessions/${c!.id}/check-in`)).status).toBe(200);

    const mark = await s.ana.call("PUT", `/bookings/${b1!.id}/attendance`, { attendance: "present" });
    expect(mark.status, JSON.stringify(mark.body)).toBe(200);
    expect((await s.ana.call("GET", `/sessions/${c!.id}/check-in`)).body.counts).toMatchObject({ checkedIn: 1, notYet: 1 });

    // Home puts it first: up next, with check-in open (unless the class falls after midnight).
    const local = new Date(startsAt.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
    if (local === dayOffset(0)) {
      const next = (await s.ana.call("GET", "/dashboard")).body.today.next;
      expect(next).toMatchObject({ id: c!.id, startsIn: expect.stringMatching(/^In \d+ min$/), checkIn: { open: true, checkedIn: 1, notYet: 1, label: "Check in (1 of 2 in)" } });
    }
  });
});
