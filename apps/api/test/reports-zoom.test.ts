import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { bookings, classSessions, classTypes, locations } from "../src/db/schema.js";
import { app, db, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe("zooming into class reports", () => {
  it("narrows by class type, location, days of the week and time of day, with breakdowns", async () => {
    const s = await studio();
    const [mat] = await db.insert(classTypes).values({ orgId: s.orgId, name: "Mat", color: "#0F766E" }).returning();
    const [hv] = await db.insert(locations).values({ orgId: s.orgId, name: "Holland Village", timezone: "Asia/Singapore" }).returning();
    const base = DateTime.now().setZone("Asia/Singapore").minus({ days: 14 }).startOf("week"); // a Monday, two weeks ago
    const past = async (o: { day: number; hour: number; type?: string; loc?: string; booked: number }) => {
      const start = base.plus({ days: o.day - 1 }).set({ hour: o.hour });
      const [c] = await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: o.type ?? s.classTypeId, locationId: o.loc ?? s.locationId, instructorId: s.ana.id, startsAt: start.toJSDate(), endsAt: start.plus({ minutes: 50 }).toJSDate(), capacity: 4 }).returning();
      const people = [s.c1, s.c2, s.c3];
      for (let i = 0; i < o.booked; i++) await db.insert(bookings).values({ orgId: s.orgId, sessionId: c!.id, clientId: people[i]!.id, source: "staff" });
    };
    await past({ day: 1, hour: 7, booked: 3 }); // Mon morning Reformer
    await past({ day: 8, hour: 7, booked: 3 });
    await past({ day: 1, hour: 18, booked: 1 }); // Mon evening Reformer
    await past({ day: 8, hour: 18, booked: 1 });
    await past({ day: 6, hour: 9, type: mat!.id, loc: hv!.id, booked: 2 }); // Sat morning Mat, Holland Village

    const all = (await s.owner.call("GET", "/reports/classes?days=30")).body;
    expect(all.byLocation.map((l: { name: string; classes: number }) => [l.name, l.classes])).toEqual([["Central", 4], ["Holland Village", 1]]);
    expect(all.byTime.cells).toEqual(expect.arrayContaining([{ weekday: 1, day: "Mon", timeOfDay: "morning", classes: 2, fill: 75 }, { weekday: 1, day: "Mon", timeOfDay: "evening", classes: 2, fill: 25 }]));
    expect(all.byTime.explain).toBe("Busiest: Mon mornings (75% full). Quietest: Mon evenings (25% full).");

    const evenings = (await s.owner.call("GET", "/reports/classes?days=30&timeOfDay=evening")).body;
    expect(evenings.metrics.find((m: { key: string }) => m.key === "held").value).toBe(2);
    expect(evenings.filters).toEqual({ timeOfDay: "evening", timeOfDayLabel: "Evenings (5pm on)" });

    const saturdays = (await s.owner.call("GET", "/reports/classes?days=30&weekdays=6,7")).body;
    expect(saturdays.metrics.find((m: { key: string }) => m.key === "held").value).toBe(1);
    expect(saturdays.byClassType.map((t: { name: string }) => t.name)).toEqual(["Mat"]);

    const both = (await s.owner.call("GET", `/reports/classes?days=30&locationId=${s.locationId}&classTypeId=${s.classTypeId}&weekdays=1&timeOfDay=morning`)).body;
    expect(both.metrics.find((m: { key: string }) => m.key === "fill").value).toBe(75);
    expect((await s.owner.call("GET", "/reports/classes?days=30&weekdays=8")).status).toBe(400);
  });
});
