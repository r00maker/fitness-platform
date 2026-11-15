import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, conversations, fees, locations, organizations } from "../src/db/schema.js";
import { getDashboard } from "../src/modules/dashboard/service.js";
import { app, dayOffset, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const ACK = ["unusual_start_time", "no_instructor", "in_the_past", "ends_after_midnight", "short_notice"];
/** "Now" for the dashboard: 8am Singapore time, five days from today, so results don't depend on when tests run. */
const DAY = dayOffset(5);
const NOW = new Date(`${DAY}T00:00:00Z`); // 8:00am in Singapore

async function setup() {
  const s = await studio();
  const base = { classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, capacity: 10, durationMinutes: 50, date: DAY, acknowledge: ACK };
  const mk = async (extra: Record<string, unknown>) => {
    const r = await s.owner.call("POST", "/sessions", { ...base, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const dash = (who: { id: string }, role: "owner" | "front_desk" | "instructor", q: { days?: 7 | 30; locationId?: string } = {}) =>
    getDashboard(db, { orgId: s.orgId, userId: who.id, role }, { days: q.days ?? 7, locationId: q.locationId }, NOW);
  return { s, mk, dash };
}

describe("the dashboard", () => {
  it("leads with today: people booked, how full, the next class, and each class's to-dos", async () => {
    const { s, mk, dash } = await setup();
    const early = await mk({ startTime: "06:00", instructorId: s.ana.id }); // finished by 8am
    const next = await mk({ startTime: "09:00", instructorId: s.ana.id });
    await mk({ startTime: "18:00", instructorId: null });
    await s.c1.call("POST", "/bookings", { sessionId: next });
    await s.c2.call("POST", "/bookings", { sessionId: next });
    await db.insert(bookings).values({ orgId: s.orgId, sessionId: early, clientId: s.c3.id, source: "client" });

    const d = await dash(s.owner, "owner");
    expect(d.greeting.partOfDay).toBe("morning");
    expect(d.today).toMatchObject({ classes: 3, booked: 3, capacity: 30, fill: 10 });
    expect(d.today.text).toBe("3 people booked into 3 classes today");
    expect(d.today.next).toMatchObject({ id: next, localTime: "09:00", booked: 2, state: "upcoming" });
    const [first, , evening] = d.today.list;
    expect(first!.state).toBe("finished");
    expect(first!.todo).toEqual([{ kind: "attendance", text: "Attendance not taken (1)" }]);
    expect(evening!.todo).toEqual([{ kind: "no_instructor", text: "No instructor" }]);
  });

  it("lists what needs attention, most urgent first, each with where to go", async () => {
    const { s, mk, dash } = await setup();
    await mk({ startTime: "18:00", instructorId: null });
    const early = await mk({ startTime: "06:00", instructorId: s.ana.id });
    await db.insert(bookings).values({ orgId: s.orgId, sessionId: early, clientId: s.c3.id, source: "client" });
    await db.insert(fees).values({ orgId: s.orgId, clientId: s.c1.id, type: "late_cancel", amountCents: 1500, currency: "SGD" });
    await db.insert(conversations).values({ orgId: s.orgId, channel: "whatsapp", contact: "6591234567", unread: 3 });

    const d = await dash(s.owner, "owner");
    expect(d.allClear).toBe(false);
    expect(d.attention.map((a) => [a.kind, a.severity])).toEqual([
      ["no_instructor", "urgent"],
      ["attendance", "soon"],
      ["fees", "fyi"],
      ["messages", "fyi"],
    ]);
    expect(d.attention[0]).toMatchObject({ title: "1 class has no instructor", detail: "1 in the next 2 days", action: { page: "schedule" } });
    expect(d.attention.find((a) => a.kind === "fees")).toMatchObject({ title: "1 fee to collect or waive", detail: "SGD 15.00 in late-cancellation and no-show fees", action: { page: "fees" } });
    expect(d.attention.find((a) => a.kind === "messages")).toMatchObject({ count: 3, title: "3 unread messages", detail: "From 1 client" });
  });

  it("flags clients coming soon without a waiver, and cover requests by who can act on them", async () => {
    const { s, mk, dash } = await setup();
    await db.update(organizations).set({ waiverRequired: true }).where(eq(organizations.id, s.orgId));
    const id = await mk({ startTime: "10:00", instructorId: s.ana.id });
    await db.insert(bookings).values({ orgId: s.orgId, sessionId: id, clientId: s.c1.id, source: "client" });
    expect((await s.ana.call("POST", "/substitute-requests", { sessionId: id, reason: "Dentist" })).status).toBe(201);

    const owner = await dash(s.owner, "owner");
    expect(owner.attention.slice(0, 2).map((a) => a.kind).sort()).toEqual(["cover", "waivers"]);
    expect(owner.attention.find((a) => a.kind === "waivers")).toMatchObject({ severity: "urgent", title: "1 client coming soon without a waiver" });
    expect(owner.today.list[0]!.todo).toContainEqual({ kind: "waiver_missing", text: "1 waiver missing" });
    expect(owner.attention.find((a) => a.kind === "cover")).toMatchObject({ severity: "urgent", detail: "1 in the next 2 days" });
    // Ben is asked to cover; Ana (who asked) isn't.
    expect((await dash(s.ben, "instructor")).attention.find((a) => a.kind === "cover")).toMatchObject({ title: "1 cover request for you" });
    expect((await dash(s.ana, "instructor")).attention.find((a) => a.kind === "cover")).toBeUndefined();
  });

  it("shows how it's going against the period before, with a daily trend", async () => {
    const { s, mk, dash } = await setup();
    const id = await mk({ startTime: "09:00", instructorId: s.ana.id });
    await s.c1.call("POST", "/bookings", { sessionId: id });
    const d = await dash(s.owner, "owner", { days: 30 });
    expect(d.kpis.map((k) => k.key)).toEqual(["bookings", "fill", "new_clients", "revenue"]);
    const made = d.kpis[0]!;
    expect(made).toMatchObject({ value: 1, previous: 0, display: "1", change: { text: "New this period", good: true } });
    expect(made.trend).toHaveLength(30);
    expect(made.trend.reduce((a, p) => a + (p.value ?? 0), 0)).toBe(1);
    expect(d.kpis.find((k) => k.key === "new_clients")!.value).toBe(3); // the three sample clients joined today
    expect(d.weekAhead).toHaveLength(7);
    expect(d.weekAhead[0]).toMatchObject({ date: DAY, classes: 1, booked: 1, capacity: 10, fill: 10 });
  });

  it("shows each role only what they can act on", async () => {
    const { s, mk, dash } = await setup();
    await mk({ startTime: "09:00", instructorId: s.ana.id });
    await mk({ startTime: "11:00", instructorId: s.ben.id });
    await mk({ startTime: "18:00", instructorId: null });
    await db.insert(fees).values({ orgId: s.orgId, clientId: s.c1.id, type: "late_cancel", amountCents: 1500, currency: "SGD" });
    const desk = await person(s.orgId, "front_desk");

    const fd = await dash(desk, "front_desk");
    expect(fd.kpis.map((k) => k.key)).toEqual(["bookings", "fill", "new_clients"]); // no money
    expect(fd.attention.map((a) => a.kind)).not.toContain("fees");
    expect(fd.attention.map((a) => a.kind)).not.toContain("no_instructor");
    expect(fd.today.classes).toBe(3);
    expect(fd.scope).toMatchObject({ ownClassesOnly: false, money: false });

    const ana = await dash(s.ana, "instructor");
    expect(ana.scope.ownClassesOnly).toBe(true);
    expect(ana.today.list.map((c) => c.localTime)).toEqual(["09:00"]);
    expect(ana.kpis.map((k) => k.key)).toEqual(["bookings", "fill"]);
    expect((await dash(s.c1, "instructor")).today.text).toBe("You're not teaching today.");

    expect((await s.c1.call("GET", "/dashboard")).status).toBe(403);
    expect((await s.owner.call("GET", "/dashboard?days=30")).status).toBe(200);
    expect((await s.owner.call("GET", "/dashboard?days=12")).status).toBe(400);
  });

  it("narrows to one location, and keeps studios separate", async () => {
    const { s, mk, dash } = await setup();
    const [east] = await db.insert(locations).values({ orgId: s.orgId, name: "East", timezone: "Asia/Singapore" }).returning();
    await mk({ startTime: "09:00", instructorId: s.ana.id });
    await mk({ startTime: "09:00", instructorId: s.ben.id, locationId: east!.id, roomId: null });
    expect((await dash(s.owner, "owner")).today.classes).toBe(2);
    const e = await dash(s.owner, "owner", { locationId: east!.id });
    expect(e.today.classes).toBe(1);
    expect(e.today.list[0]!.where).toBe("East");

    const other = await studio();
    const o = await getDashboard(db, { orgId: other.orgId, userId: other.owner.id, role: "owner" }, { days: 7 }, NOW);
    expect(o.today.classes).toBe(0);
    expect(o.allClear).toBe(true);
    expect((await other.owner.call("GET", `/dashboard?locationId=${east!.id}`)).status).toBe(404);
  });
});
