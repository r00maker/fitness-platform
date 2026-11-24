import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { bookings, classSessions, organizations } from "../src/db/schema.js";
import { app, dayOffset, db, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function setup() {
  const s = await studio();
  await db.update(organizations).set({ lifecycle: "live" }).where(eq(organizations.id, s.orgId));
  let hour = 6;
  const cls = async (classTypeId = s.classTypeId) =>
    (await s.owner.call("POST", "/sessions", { classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 8, durationMinutes: 50, date: dayOffset(2), startTime: `${String(hour++ % 24).padStart(2, "0")}:00`, acknowledge: ["unusual_start_time", "possible_duplicate"] })).body.id as string;
  /** `n` classes the client came to, all finished earlier today (so they're in this month). */
  // Class times that don't depend on when the tests run: "early" is 6am on the latest morning that
  // has passed; "afternoon" is 2pm yesterday (never before 8am, so never early). Otherwise, an hour ago.
  const sg = () => DateTime.now().setZone("Asia/Singapore");
  const lastMorning = () => (sg().hour >= 7 ? sg() : sg().minus({ days: 1 })).startOf("day").plus({ hours: 6 });
  const attend = async (who: typeof s.c1, n: number, opts: { classTypeId?: string; early?: boolean; afternoon?: boolean } = {}) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await who.call("POST", "/bookings", { sessionId: await cls(opts.classTypeId) })).body.id);
    const rows = await db.select({ id: bookings.id, sessionId: bookings.sessionId }).from(bookings).where(inArray(bookings.id, ids));
    for (const [i, r] of rows.entries()) {
      const start = opts.early ? lastMorning().plus({ minutes: i }).toJSDate()
        : opts.afternoon ? sg().minus({ days: 1 }).startOf("day").plus({ hours: 14, minutes: i }).toJSDate()
        : new Date(Date.now() - (70 + i) * 60_000);
      await db.update(classSessions).set({ startsAt: start, endsAt: new Date(start.getTime() + 50 * 60_000) }).where(eq(classSessions.id, r.sessionId));
    }
    return ids;
  };
  const progress = async (who = s.c1) => (await who.call("GET", "/me/progress")).body;
  return { s, cls, attend, progress };
}

describe("client progress", () => {
  it("counts finished classes towards the next milestone, and celebrates one once", async () => {
    const { s, attend, progress } = await setup();
    expect(await progress()).toMatchObject({ classes: 0, milestone: { previous: 0, next: 10, toGo: 10, progress: 0 }, celebration: null, nudge: "10 classes to your 10th." });

    const ids = await attend(s.c1, 11, { afternoon: true });
    // A no-show and a cancelled class don't count.
    await db.update(bookings).set({ attendance: "no_show" }).where(eq(bookings.id, ids[0]!));
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, ids[1]!));
    const p = await progress();
    expect(p).toMatchObject({ classes: 9, milestone: { previous: 0, next: 10, toGo: 1 }, nudge: "1 class to your 10th." });

    await attend(s.c1, 1, { afternoon: true });
    const q = await progress();
    expect(q).toMatchObject({ classes: 10, milestone: { previous: 10, next: 20, toGo: 10, progress: 0 } });
    expect(q.celebration).toMatchObject({ key: "milestone:10", kind: "milestone", title: "10 classes", message: "That's your 10th class with Test Studio. Next stop: 20." });
    expect(q.achievements.find((a: { key: string }) => a.key === "classes_10")).toMatchObject({ earned: true, earnedOn: dayOffset(-1) }); // the 10th class was yesterday afternoon
    expect(q.achievements.find((a: { key: string }) => a.key === "classes_20")).toMatchObject({ earned: false, progress: { have: 10, need: 20 } });

    expect((await s.c1.call("POST", "/me/celebrations/milestone:10/seen")).status).toBe(204);
    expect((await progress()).celebration).toBeNull();
    // Only for the person themselves.
    expect((await progress(s.c2)).classes).toBe(0);
    expect((await s.owner.call("GET", "/me/progress")).status).toBe(403);
  });

  it("sets a monthly goal, shows how far along this month is, and celebrates meeting it", async () => {
    const { s, attend, progress } = await setup();
    const set = await s.c1.call("PUT", "/me/goal", { classes: 3 });
    expect(set.body.month).toMatchObject({ goal: 3, done: 0, booked: 0 });
    expect(set.body.nudge).toBe("3 more classes to reach your goal of 3 this month.");
    expect((await s.c1.call("PUT", "/me/goal", { classes: 0 })).status).toBe(400);

    await attend(s.c1, 3);
    const p = await progress();
    expect(p.month).toMatchObject({ goal: 3, done: 3 });
    expect(p.celebration).toMatchObject({ key: `goal:${DateTime.now().setZone("Asia/Singapore").toFormat("yyyy-LL")}`, title: "Goal met", message: "3 classes this month: you set 3 and you did it." });
    expect(p.achievements.find((a: { key: string }) => a.key === "goal")).toMatchObject({ earned: true });

    await s.c1.call("PUT", "/me/goal", { classes: null });
    expect((await progress()).month.goal).toBeNull();
  });

  it("earns achievements: early riser and explorer", async () => {
    const { s, attend, progress } = await setup();
    const barre = (await s.owner.call("POST", "/class-types", { name: "Barre", color: "#DB2777" })).body.id;
    const yoga = (await s.owner.call("POST", "/class-types", { name: "Yoga", color: "#059669" })).body.id;
    await attend(s.c1, 5, { early: true });
    await attend(s.c1, 1, { classTypeId: barre });
    await attend(s.c1, 1, { classTypeId: yoga });
    const a = (await progress()).achievements;
    expect(a.find((x: { key: string }) => x.key === "early")).toMatchObject({ earned: true, title: "Early riser" });
    expect(a.find((x: { key: string }) => x.key === "explorer")).toMatchObject({ earned: true });
    expect(a.find((x: { key: string }) => x.key === "streak")).toMatchObject({ earned: false, progress: { have: 1, need: 4 } });
  });
});

describe("the app's look", () => {
  it("comes with the branded app, starts from a preset, and is public with the studio", async () => {
    const { s } = await setup();
    await s.owner.call("PUT", "/booking-page", { slug: "linden", enabled: true });

    await db.update(organizations).set({ plan: "essentials" }).where(eq(organizations.id, s.orgId));
    const without = (await s.owner.call("GET", "/app-theme")).body;
    expect(without).toMatchObject({ hasApp: false, theme: { preset: "classic" } });
    expect(without.presets.map((p: { key: string }) => p.key)).toEqual(["classic", "sage", "cobalt", "indigo"]);
    expect((await s.owner.call("PATCH", "/app-theme", { preset: "sage" })).body.error.code).toBe("needs_branded_app");

    await db.update(organizations).set({ plan: "signature" }).where(eq(organizations.id, s.orgId));
    expect((await s.owner.call("PATCH", "/app-theme", { preset: "sage" })).body).toMatchObject({ preset: "sage", displayFont: "Young Serif", motif: "leaf" });
    // Changes sit on top of the preset.
    const t = (await s.owner.call("PATCH", "/app-theme", { accent: "#1F4F3A", milestones: [100, 5, 50] })).body;
    expect(t).toMatchObject({ preset: "sage", accent: "#1F4F3A", displayFont: "Young Serif", milestones: [5, 50, 100] });
    expect((await s.owner.call("PATCH", "/app-theme", { accent: "green" })).status).toBe(400);
    expect((await s.c1.call("PATCH", "/app-theme", { preset: "cobalt" })).status).toBe(403);

    const pub = (await app.inject({ method: "GET", url: "/v1/public/studios/linden" })).json();
    expect(pub.theme).toMatchObject({ preset: "sage", accent: "#1F4F3A" });
    // The client's milestones follow the studio's.
    expect((await s.c1.call("GET", "/me/progress")).body.milestone.next).toBe(5);
    // Looks saved under their earlier names (named after the example studios) still work.
    await db.update(organizations).set({ appTheme: { preset: "tidal" } as never }).where(eq(organizations.id, s.orgId));
    expect((await app.inject({ method: "GET", url: "/v1/public/studios/linden" })).json().theme).toMatchObject({ preset: "cobalt", motif: "wave" });
    expect((await s.owner.call("PATCH", "/app-theme", { preset: "aizome" })).body).toMatchObject({ preset: "indigo", motif: "stamp" });
  });

  it("lets the apps change things from their own address (PUT, PATCH and DELETE too)", async () => {
    const pre = await app.inject({ method: "OPTIONS", url: "/v1/me/goal", headers: { origin: "http://localhost:5173", "access-control-request-method": "PUT" } });
    expect(pre.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(String(pre.headers["access-control-allow-methods"])).toMatch(/PUT/);
    expect(String(pre.headers["access-control-allow-methods"])).toMatch(/PATCH/);
    const other = await app.inject({ method: "OPTIONS", url: "/v1/me/goal", headers: { origin: "https://evil.example", "access-control-request-method": "PUT" } });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("tells the app when free cancelling ends, for the booking confirmation", async () => {
    const { s, cls } = await setup();
    const id = await cls();
    const o = (await s.c1.call("GET", `/sessions/${id}/package-options`)).body;
    expect(o).toMatchObject({ insideLateWindow: false, freeCancelUntil: expect.any(String) });
  });
});
