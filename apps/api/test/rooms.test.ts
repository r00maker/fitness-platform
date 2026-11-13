import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, classTemplates, locations } from "../src/db/schema.js";
import { app, db, dayOffset, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function setup() {
  const s = await studio();
  const room = (await s.owner.call("POST", "/rooms", { locationId: s.locationId, name: "Reformer Studio", spotLabels: ["Reformer 1", "Reformer 2", "Reformer 3", "Reformer 4"], spotColumns: 2 })).body;
  const mk = async (roomId = room.id, capacity = 4) =>
    (await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, roomId, instructorId: s.ana.id, capacity, durationMinutes: 50, date: dayOffset(3), startTime: "09:00", acknowledge: ["possible_duplicate", "instructor_double_booked", "room_double_booked"] })).body.id as string;
  return { s, room, mk };
}

describe("editing keeps what wasn't changed", () => {
  it("renaming a template doesn't switch its waitlist back on", async () => {
    const { s } = await setup();
    const t = (await s.owner.call("POST", "/templates", { name: "Reformer", classTypeId: s.classTypeId, locationId: s.locationId, capacity: 10, durationMinutes: 50, waitlistEnabled: false })).body;
    expect((await s.owner.call("PATCH", `/templates/${t.id}`, { name: "Reformer AM" })).body).toMatchObject({ name: "Reformer AM", waitlistEnabled: false });
  });
});

describe("rooms", () => {
  it("renames a room and changes its spots, warning when booked spots would go", async () => {
    const { s, room, mk } = await setup();
    expect(room).toMatchObject({ capacity: 4, spotColumns: 2 });
    const c = await mk();
    await s.c1.call("POST", "/bookings", { sessionId: c, spot: 4 });
    await s.c2.call("POST", "/bookings", { sessionId: c, spot: 1 });

    expect((await s.owner.call("PATCH", `/rooms/${room.id}`, { name: "Reformer Room" })).body.room.name).toBe("Reformer Room");
    // Down to 3 spots: Chloe's spot 4 goes, and the class (for 4) is now bigger than the room.
    const ask = await s.owner.call("PATCH", `/rooms/${room.id}`, { spotLabels: ["Reformer 1", "Reformer 2", "Reformer 3"] });
    expect(ask.status).toBe(409);
    expect(ask.body.error.flags.map((f: { code: string }) => f.code).sort()).toEqual(["room_smaller", "spots_removed"]);
    expect((await db.select().from(bookings).where(eq(bookings.clientId, s.c1.id)))[0]!.spot).toBe(4);
    const done = await s.owner.call("PATCH", `/rooms/${room.id}`, { spotLabels: ["Reformer 1", "Reformer 2", "Reformer 3"], acknowledge: ["spots_removed", "room_smaller"] });
    expect(done.body.room).toMatchObject({ capacity: 3, spotLabels: ["Reformer 1", "Reformer 2", "Reformer 3"] });
    const spots = Object.fromEntries((await db.select().from(bookings)).map((b) => [b.clientId, b.spot]));
    expect(spots).toEqual({ [s.c1.id]: null, [s.c2.id]: 1 });
    // A room with named spots can't hold more people than it has spots.
    expect((await s.owner.call("PATCH", `/rooms/${room.id}`, { capacity: 10 })).body.error.code).toBe("more_than_spots");
    // Switching spots off keeps the capacity and clears the layout.
    const off = await s.owner.call("PATCH", `/rooms/${room.id}`, { spotLabels: null, capacity: 12, acknowledge: ["spots_removed"] });
    expect(off.body.room).toMatchObject({ spotLabels: null, spotColumns: null, capacity: 12 });
    expect((await s.ana.call("PATCH", `/rooms/${room.id}`, { name: "x" })).status).toBe(403);
  });

  it("removes a room, moving its upcoming classes, templates and repeats to another room", async () => {
    const { s, room, mk } = await setup();
    const c = await mk(room.id, 4);
    await s.c1.call("POST", "/bookings", { sessionId: c, spot: 3 });
    const [tpl] = await db.insert(classTemplates).values({ orgId: s.orgId, name: "Reformer", classTypeId: s.classTypeId, locationId: s.locationId, roomId: room.id, durationMinutes: 50, capacity: 4 }).returning();

    // Without a destination: warned that the class will have no room.
    const ask = await s.owner.call("POST", `/rooms/${room.id}/remove`, {});
    expect(ask.body.error.flags[0]).toMatchObject({ code: "room_has_classes", message: expect.stringMatching(/1 upcoming class is in Reformer Studio/) });

    // Elsewhere is not allowed; a smaller room at the same location asks first.
    const [other] = await db.insert(locations).values({ orgId: s.orgId, name: "Elsewhere", timezone: "Asia/Singapore" }).returning();
    const far = (await s.owner.call("POST", "/rooms", { locationId: other!.id, name: "Far room", capacity: 10 })).body;
    expect((await s.owner.call("POST", `/rooms/${room.id}/remove`, { moveToRoomId: far.id })).body.error.code).toBe("room_wrong_location");
    const small = (await s.owner.call("POST", "/rooms", { locationId: s.locationId, name: "Small room", spotLabels: ["A", "B"] })).body;
    const smaller = await s.owner.call("POST", `/rooms/${room.id}/remove`, { moveToRoomId: small.id });
    expect(smaller.body.error.flags.map((f: { code: string }) => f.code)).toEqual(["room_smaller"]);

    const done = await s.owner.call("POST", `/rooms/${room.id}/remove`, { moveToRoomId: s.roomId });
    expect(done.body).toMatchObject({ removed: "Reformer Studio", classesMoved: 1, movedTo: "Studio 1" });
    expect((await s.owner.call("GET", `/sessions/${c}`)).body.roomId).toBe(s.roomId);
    // Studio 1 has no named spots, so the spot number is cleared; the booking stays.
    expect((await db.select().from(bookings))[0]).toMatchObject({ status: "confirmed", spot: null });
    expect((await db.select().from(classTemplates).where(eq(classTemplates.id, tpl!.id)))[0]!.roomId).toBe(s.roomId);
    expect((await s.owner.call("GET", "/rooms")).body.map((r: { name: string }) => r.name).sort()).toEqual(["Far room", "Small room", "Studio 1"]);
    expect((await s.owner.call("PATCH", `/rooms/${room.id}`, { name: "Back" })).body.error.code).toBe("room_removed");
  });
});
