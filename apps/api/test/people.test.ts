import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { bookings, memberships, organizations } from "../src/db/schema.js";
import { app, db, dayOffset, minutesFromNow, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function setup() {
  const s = await studio();
  const foh = await person(s.orgId, "front_desk", "Fiona");
  const room = await s.owner.call("POST", "/rooms", { locationId: s.locationId, name: "Reformer Studio", spotLabels: ["Reformer 1", "Reformer 2", "Reformer 3", "Reformer 4"] });
  const mk = async (extra: Record<string, unknown> = {}) =>
    (await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, roomId: room.body.id, instructorId: s.ana.id, capacity: 4, durationMinutes: 50, date: dayOffset(3), startTime: "09:00", ...extra })).body.id as string;
  return { s, foh, room: room.body, mk };
}

describe("client details on class lists", () => {
  it("Front of House and the class's instructor see contact details", async () => {
    const { s, foh, mk } = await setup();
    const c = await mk();
    await s.c1.call("POST", "/bookings", { sessionId: c });
    expect((await foh.call("GET", `/sessions/${c}`)).body.roster[0]).toMatchObject({ email: expect.stringMatching(/@/), phone: null });
    expect((await s.ana.call("GET", `/sessions/${c}`)).body.roster[0].email).toMatch(/@/);
  });

  it("shows photo, spot, classes attended, first visit and tags", async () => {
    const { s, foh, mk } = await setup();
    const tag = await s.owner.call("POST", "/client-tags", { name: "Injury: lower back", color: "#b42318" });
    expect(tag.status).toBe(201);
    expect((await foh.call("PUT", `/clients/${s.c1.id}/tags`, { tagIds: [tag.body.id] })).body).toEqual([{ id: tag.body.id, name: "Injury: lower back", color: "#b42318" }]);
    const c = await mk();
    await s.c1.call("POST", "/bookings", { sessionId: c, spot: 3 });
    await s.c2.call("POST", "/bookings", { sessionId: c });
    await db.update(bookings).set({ attendance: "present" }).where(eq(bookings.clientId, s.c2.id)); // pretend Dev has been before
    const roster = (await foh.call("GET", `/sessions/${c}`)).body.roster;
    const chloe = roster.find((r: { clientId: string }) => r.clientId === s.c1.id);
    const dev = roster.find((r: { clientId: string }) => r.clientId === s.c2.id);
    expect(chloe).toMatchObject({ spot: 3, spotLabel: "Reformer 3", attendedCount: 0, firstVisit: true, tags: [{ name: "Injury: lower back" }], photoUrl: null, packageName: null });
    expect(dev).toMatchObject({ spot: 1, spotLabel: "Reformer 1", attendedCount: 1, firstVisit: false, tags: [] });
  });

  it("only staff who manage tags can create or assign them; names are unique", async () => {
    const { s } = await setup();
    expect((await s.ana.call("POST", "/client-tags", { name: "VIP" })).status).toBe(403);
    await s.owner.call("POST", "/client-tags", { name: "VIP" });
    expect((await s.owner.call("POST", "/client-tags", { name: "vip" })).body.error.message).toBe("There's already a tag called “vip”.");
    expect((await s.ana.call("GET", "/client-tags")).body[0]).toMatchObject({ name: "VIP", clients: 0 });
    expect((await s.c1.call("GET", "/client-tags")).status).toBe(403);
  });
});

describe("spot selection", () => {
  it("lets a client pick a spot and stops two people taking the same one", async () => {
    const { s, mk } = await setup();
    const c = await mk();
    expect((await s.c1.call("POST", "/bookings", { sessionId: c, spot: 2 })).body.spot).toBe(2);
    const clash = await s.c2.call("POST", "/bookings", { sessionId: c, spot: 2 });
    expect(clash.body.error).toMatchObject({ code: "spot_taken", message: "Reformer 2 has just been taken. Please pick another spot." });
    expect((await s.c2.call("POST", "/bookings", { sessionId: c })).body.spot).toBe(1); // next free spot
    expect((await s.c3.call("POST", "/bookings", { sessionId: c, spot: 9 })).body.error.code).toBe("invalid_spot");
  });

  it("gives waitlisted clients the freed spot", async () => {
    const { s, mk } = await setup();
    const c = await mk({ capacity: 1 });
    const b = await s.c1.call("POST", "/bookings", { sessionId: c, spot: 4 });
    await s.c2.call("POST", "/waitlist", { sessionId: c, mode: "automatic" });
    await s.c1.call("POST", `/bookings/${b.body.id}/cancel`, {});
    const [auto] = await db.select().from(bookings).where(and(eq(bookings.clientId, s.c2.id), eq(bookings.status, "confirmed")));
    expect(auto!.spot).toBe(1);
  });
});

describe("who's attending", () => {
  it("studio members see other members by first name and initial; hidden members and ClassPass clients aren't named", async () => {
    const { s, mk } = await setup();
    const c = await mk();
    await s.c2.call("POST", "/bookings", { sessionId: c, spot: 1 }); // Dev, a member
    await s.c3.call("POST", "/bookings", { sessionId: c, spot: 2 }); // Eve, will hide herself
    await s.c3.call("PATCH", "/me/privacy", { showInAttendeeList: false });

    const member = await s.c1.call("GET", `/sessions/${c}/attendees`);
    expect(member.body.namesShown).toBe(true);
    expect(member.body.spots.map((x: { status: string }) => x.status)).toEqual(["taken", "taken", "free", "free"]);
    expect(member.body.spots[0].attendee.name).toMatch(/^Dev T\.$/);
    expect(member.body.spots[1].attendee).toBeNull();
    expect(member.body.othersCount).toBe(1);

    await db.update(memberships).set({ source: "classpass" }).where(eq(memberships.userId, s.c1.id));
    const viaClassPass = await s.c1.call("GET", `/sessions/${c}/attendees`);
    expect(viaClassPass.body).toMatchObject({ namesShown: false, namesHiddenReason: "Who's attending is only shown to studio members.", attending: [] });
    expect(viaClassPass.body.spots[0]).toMatchObject({ status: "taken", attendee: null });
  });
});

describe("booking a class you can't cancel for free", () => {
  it("asks the client to confirm first", async () => {
    const { s, mk } = await setup();
    await db.update(organizations).set({ lateCancelFeeEnabled: true, lateCancelFeeCents: 1500, bookingClosesMinutesBefore: 0 }).where(eq(organizations.id, s.orgId));
    const c = await mk({ ...minutesFromNow(180), acknowledge: ["unusual_start_time", "ends_after_midnight"] });
    const res = await s.c1.call("POST", "/bookings", { sessionId: c });
    expect(res.body.error.message).toBe("This class starts in less than 12 hours. If you book and then cancel, you won't get your class credit back, and a late-cancellation fee of SGD 15.00 applies.");
    expect((await s.c1.call("POST", "/bookings", { sessionId: c, acknowledge: ["no_free_cancel"] })).status).toBe(201);
  });
});
