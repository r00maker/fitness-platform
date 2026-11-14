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

  it("exports the raw rows as CSV (following the filters) and a visual one-pager", async () => {
    const s = await studio();
    const base = DateTime.now().setZone("Asia/Singapore").minus({ days: 14 }).startOf("week");
    for (const [day, hour, booked] of [[1, 7, 3], [1, 18, 1], [8, 7, 2]] as const) {
      const start = base.plus({ days: day - 1 }).set({ hour });
      const [c] = await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, startsAt: start.toJSDate(), endsAt: start.plus({ minutes: 50 }).toJSDate(), capacity: 4 }).returning();
      const people = [s.c1, s.c2, s.c3];
      for (let i = 0; i < booked; i++) await db.insert(bookings).values({ orgId: s.orgId, sessionId: c!.id, clientId: people[i]!.id, source: "staff", attendance: "present" });
    }
    const get = (url: string) => app.inject({ method: "GET", url: `/v1${url}`, headers: { authorization: `Bearer ${s.owner.token}` } });
    const csv = await get("/reports/export/classes?days=30&timeOfDay=morning");
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.headers["content-disposition"]).toMatch(/attachment; filename="classes-.*\.csv"/);
    const lines = csv.body.replace(/^\ufeff/, "").trim().split("\r\n");
    expect(lines[0]).toBe('"Date","Starts","Ends","Class","Type","Instructor","Location","Room","Spots","Booked","Attended","No-shows","How full (%)","Status"');
    expect(lines).toHaveLength(3); // the two morning classes only
    expect(lines[1]).toMatch(/"07:00","07:50","Reformer Pilates","Class","Ana T\d+","Central","","4","3","3","0","75","Held"/);
    expect(lines.join("")).not.toMatch(/@example\.com/); // no contact details

    const vis = await get("/reports/export/classes?days=30&format=visual&timeOfDay=morning");
    expect(vis.headers["content-type"]).toMatch(/text\/html/);
    expect(vis.body).toContain("<h1>Classes report</h1>");
    expect(vis.body).toContain('<span class="chip">Mornings (before 12pm)</span>');
    expect(vis.body).toContain("How full each class was");
    expect(vis.body).toContain("Save as PDF or print");

    expect((await get("/reports/export/overview?days=30")).body.split("\r\n")[0]).toContain("Money in (SGD)");
    expect((await get("/reports/export/sales?days=30")).body).toContain("Invoice");
    expect((await get("/reports/export/instructors?days=30&format=visual")).body).toContain("Everyone who teaches");
    expect((await s.ana.call("GET", "/reports/export/classes?days=30")).status).toBe(403);
  });
});
