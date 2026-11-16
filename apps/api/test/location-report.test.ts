import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, classSessions, locations, organizations } from "../src/db/schema.js";
import { app, db, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const DAY = 86_400_000;

describe("report by location (Signature)", () => {
  it("shows each location side by side against the period before", async () => {
    const s = await studio();
    const [east] = await db.insert(locations).values({ orgId: s.orgId, name: "East", timezone: "Asia/Singapore" }).returning();
    const cls = async (locationId: string, daysAgo: number, capacity: number) => {
      const startsAt = new Date(Date.now() - daysAgo * DAY);
      const [c] = await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId, instructorId: s.ana.id, capacity, startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000) }).returning();
      return c!.id;
    };
    // Central: one class this period, 2 of 4 spots, one came, one didn't. Chloe's first class ever.
    const c1 = await cls(s.locationId, 3, 4);
    await db.insert(bookings).values([
      { orgId: s.orgId, sessionId: c1, clientId: s.c1.id, source: "client", attendance: "present" },
      { orgId: s.orgId, sessionId: c1, clientId: s.c2.id, source: "client", attendance: "no_show" },
    ]);
    // Dev came to East last period, so he isn't new this time.
    const old = await cls(east!.id, 40, 10);
    await db.insert(bookings).values({ orgId: s.orgId, sessionId: old, clientId: s.c2.id, source: "client", attendance: "present" });
    // East: one class this period, full (2 of 2).
    const e1 = await cls(east!.id, 5, 2);
    await db.insert(bookings).values([
      { orgId: s.orgId, sessionId: e1, clientId: s.c3.id, source: "client", attendance: "present" },
      { orgId: s.orgId, sessionId: e1, clientId: s.c2.id, source: "client", attendance: "present" },
    ]);

    const r = await s.owner.call("GET", "/reports/locations?days=30");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.summary).toBe("East is the fullest (100%); Central has the most room (50%).");
    const get = (name: string, key: string) => r.body.locations.find((l: { name: string }) => l.name === name).metrics.find((m: { key: string }) => m.key === key);
    expect(get("Central", "visits")).toMatchObject({ value: 1, previous: 0 });
    expect(get("Central", "noShows")).toMatchObject({ value: 50, display: "50%" });
    expect(get("Central", "newClients").value).toBe(1); // Chloe (Dev's first class was at East)
    expect(get("East", "newClients")).toMatchObject({ value: 1, previous: 1 }); // Eve now, Dev last period
    expect(get("East", "classes")).toMatchObject({ value: 1, previous: 1 });
    expect(r.body.note).toMatch(/aren't split by location/);

    expect((await s.ana.call("GET", "/reports/locations")).status).toBe(403);
    await db.update(organizations).set({ plan: "growth" }).where(eq(organizations.id, s.orgId));
    const locked = await s.owner.call("GET", "/reports/locations");
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatchObject({ code: "not_in_plan", message: expect.stringMatching(/come with Signature. You're on Growth/) });
  });
});
