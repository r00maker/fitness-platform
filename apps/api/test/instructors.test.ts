import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, classSessions } from "../src/db/schema.js";
import { app, db, dayOffset, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function setup() {
  const s = await studio();
  const base = { classTypeId: s.classTypeId, locationId: s.locationId, capacity: 10, durationMinutes: 50, date: dayOffset(3) };
  let hour = 7;
  const mk = async (instructorId: string | null, extra: Record<string, unknown> = {}) =>
    (await s.owner.call("POST", "/sessions", { ...base, instructorId, startTime: `${String(hour++).padStart(2, "0")}:00`, ...extra })).body.id as string;
  /** Record `n` attended classes for a client with an instructor. */
  const history = async (clientId: string, instructorId: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const id = await mk(instructorId, { date: dayOffset(5 + i), acknowledge: ["unusual_start_time", "possible_duplicate", "instructor_double_booked"] });
      await db.insert(bookings).values({ orgId: s.orgId, sessionId: id, clientId, source: "staff", attendance: "present" });
    }
    hour = 7;
  };
  return { s, mk, history };
}

describe("favourite instructor", () => {
  it("stars classes by the instructor a client has attended most (3+), and tells the instructor", async () => {
    const { s, mk, history } = await setup();
    await history(s.c1.id, s.ana.id, 3);
    await history(s.c1.id, s.ben.id, 1);
    const anaClass = await mk(s.ana.id);
    const benClass = await mk(s.ben.id);
    const cal = await s.c1.call("GET", `/calendar?view=day&date=${dayOffset(3)}`);
    const fav = Object.fromEntries(cal.body.sessions.map((x: { id: string; favouriteInstructor: boolean }) => [x.id, x.favouriteInstructor]));
    expect(fav[anaClass]).toBe(true);
    expect(fav[benClass]).toBe(false);

    await s.c1.call("POST", "/bookings", { sessionId: anaClass });
    const roster = (await s.ana.call("GET", `/sessions/${anaClass}`)).body.roster;
    expect(roster[0]).toMatchObject({ favouriteInstructor: true, classesWithInstructor: 3, attendedCount: 4 });
  });

  it("has no favourite below 3 classes or on a tie", async () => {
    const { s, mk, history } = await setup();
    await history(s.c1.id, s.ana.id, 3);
    await history(s.c1.id, s.ben.id, 3);
    await history(s.c2.id, s.ana.id, 2);
    const anaClass = await mk(s.ana.id);
    for (const c of [s.c1, s.c2]) {
      const cal = await c.call("GET", `/calendar?view=day&date=${dayOffset(3)}`);
      expect(cal.body.sessions.find((x: { id: string }) => x.id === anaClass).favouriteInstructor).toBe(false);
    }
  });
});

describe("cover (substitute) instructors", () => {
  it("marks an instructor as cover when an admin swaps them in, and clears it when the usual instructor is back", async () => {
    const { s, mk } = await setup();
    const c = await mk(s.ana.id);
    const res = await s.owner.call("PATCH", `/sessions/${c}`, { changes: { instructorId: s.ben.id }, asCover: true });
    expect(res.body.updated[0].coverForInstructorId).toBe(s.ana.id);
    const cal = await s.owner.call("GET", `/calendar?view=day&date=${dayOffset(3)}`);
    expect(cal.body.sessions[0]).toMatchObject({ instructor: { name: expect.stringContaining("Ben") }, cover: { forInstructor: { id: s.ana.id } } });
    const back = await s.owner.call("PATCH", `/sessions/${c}`, { changes: { instructorId: s.ana.id } });
    expect(back.body.updated[0].coverForInstructorId).toBeNull();
  });

  it("a permanent change isn't shown as cover, and cover is one class at a time", async () => {
    const { s, mk } = await setup();
    const c = await mk(s.ana.id);
    expect((await s.owner.call("PATCH", `/sessions/${c}`, { changes: { instructorId: s.ben.id } })).body.updated[0].coverForInstructorId).toBeNull();
    const series = await s.owner.call("POST", "/series", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, startTime: "15:00", daysOfWeek: [1, 2, 3, 4, 5, 6, 7], startDate: dayOffset(1), occurrences: 3 });
    const res = await s.owner.call("PATCH", `/sessions/${series.body.sessions[0].id}`, { changes: { instructorId: s.ben.id }, asCover: true, scope: "all" });
    expect(res.body.error.code).toBe("cover_one_class");
  });

  it("a filled cover request shows the cover instructor", async () => {
    const s = await studio({ substituteApproval: "automatic" });
    const c = (await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, date: dayOffset(3), startTime: "09:00" })).body.id;
    const req = await s.ana.call("POST", "/substitute-requests", { sessionId: c });
    await s.ben.call("POST", `/substitute-requests/${req.body.id}/accept`, {});
    const [row] = await db.select().from(classSessions).where(eq(classSessions.id, c));
    expect(row).toMatchObject({ instructorId: s.ben.id, coverForInstructorId: s.ana.id });
  });
});

describe("teaching lists (who can cover)", () => {
  it("sends cover requests to the class type's list, and offers it as the default", async () => {
    const { s, mk } = await setup();
    const priya = await person(s.orgId, "instructor", "Priya");
    expect((await s.owner.call("PUT", `/class-types/${s.classTypeId}/instructors`, { instructorIds: [s.ana.id, s.ben.id] })).status).toBe(200);
    expect((await s.ana.call("GET", "/class-types")).body[0].instructorIds.sort()).toEqual([s.ana.id, s.ben.id].sort());

    const c = await mk(s.ana.id);
    const opts = await s.ana.call("GET", `/sessions/${c}/cover-options`);
    expect(opts.body.hasTeachingList).toBe(true);
    expect(opts.body.suggested).toEqual([s.ben.id]);
    expect(opts.body.options.find((o: { id: string }) => o.id === priya.id)).toMatchObject({ onTeachingList: false, busy: false });

    const req = await s.ana.call("POST", "/substitute-requests", { sessionId: c });
    expect(req.body.invitedInstructorIds).toEqual([s.ben.id]);
    expect((await priya.call("POST", `/substitute-requests/${req.body.id}/accept`, {})).status).toBe(403);
  });

  it("warns when assigning someone who isn't on the list", async () => {
    const { s, mk } = await setup();
    await s.owner.call("PUT", `/class-types/${s.classTypeId}/instructors`, { instructorIds: [s.ana.id] });
    const res = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ben.id, capacity: 10, durationMinutes: 50, date: dayOffset(3), startTime: "09:00" });
    expect(res.body.error.flags[0]).toMatchObject({ code: "instructor_not_listed", message: expect.stringMatching(/^Ben T\d+ isn't on the list of instructors who teach Reformer Pilates\.$/) });
    const c = await mk(s.ana.id);
    expect((await s.owner.call("PATCH", `/sessions/${c}`, { changes: { instructorId: s.ben.id }, asCover: true })).body.error.flags[0].code).toBe("instructor_not_listed");
  });

  it("without a list, everyone who teaches is asked", async () => {
    const { s, mk } = await setup();
    const req = await s.ana.call("POST", "/substitute-requests", { sessionId: await mk(s.ana.id) });
    expect(req.body.invitedInstructorIds).toEqual([]);
  });
});

describe("calendar details", () => {
  it("includes instructor photo and room id; cancellation messages can be long", async () => {
    const { s, mk } = await setup();
    const c = await mk(s.ana.id);
    const cal = await s.owner.call("GET", `/calendar?view=day&date=${dayOffset(3)}`);
    expect(cal.body.sessions[0]).toHaveProperty("instructor.photoUrl", null);
    expect(cal.body.sessions[0]).toHaveProperty("roomId");
    expect((await s.owner.call("POST", `/sessions/${c}/cancel`, { reason: "x".repeat(1001) })).body.error.fields.reason).toBe("Keep the message under 1,000 characters.");
    expect((await s.owner.call("POST", `/sessions/${c}/cancel`, { reason: "x".repeat(1000) })).status).toBe(200);
  });
});
