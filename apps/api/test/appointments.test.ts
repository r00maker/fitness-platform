import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { CLASS_COLORS, whiteTextContrast } from "@studio/shared";
import { bookings, classSeries, classSessions, classTypes } from "../src/db/schema.js";
import { generateSeriesSessions } from "../src/modules/sessions/service.js";
import { app, db, dayOffset, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const ACK = ["possible_duplicate", "instructor_double_booked", "room_double_booked", "late_booking", "outside_booking_window"];

async function setup() {
  const s = await studio();
  const privateType = (await s.owner.call("POST", "/class-types", { name: "Private reformer", color: "#7C3AED", kind: "appointment", defaultDurationMinutes: 55 })).body;
  // Appointments need a package made for them: an unlimited private pack for Chloe and Dev.
  const apptPlan = (await s.owner.call("POST", "/package-plans", { name: "Private unlimited", kind: "unlimited", priceCents: 90000, validityValue: 12, validityUnit: "months", classTypeIds: [privateType.id] })).body;
  for (const c of [s.c1, s.c2]) expect((await s.owner.call("POST", `/clients/${c.id}/packages`, { planId: apptPlan.id })).status).toBe(201);
  const appt = (body: Record<string, unknown> = {}) =>
    s.owner.call("POST", "/sessions", { classTypeId: privateType.id, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, durationMinutes: 55, date: dayOffset(3), startTime: "15:00", acknowledge: ACK, ...body });
  const cls = (body: Record<string, unknown> = {}) =>
    s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, date: dayOffset(3), startTime: "09:00", acknowledge: ACK, ...body });
  const calendar = (who: { call: typeof s.owner.call }) => who.call("GET", `/calendar?view=week&date=${dayOffset(3)}`).then((r) => r.body.sessions as Record<string, unknown>[]);
  return { s, privateType, apptPlan, appt, cls, calendar };
}

describe("class type colours", () => {
  it("offers a palette that's readable with white text, and refuses colours too light for it", async () => {
    const { s } = await setup();
    expect(CLASS_COLORS.length).toBeGreaterThanOrEqual(10);
    for (const c of CLASS_COLORS) expect(whiteTextContrast(c.hex), c.name).toBeGreaterThanOrEqual(3);
    const light = await s.owner.call("POST", "/class-types", { name: "Yoga", color: "#FDE68A" });
    expect(light.status).toBe(400);
    expect(light.body.error.fields.color).toMatch(/too light/);
    // A custom hex is fine if it's dark enough; changing only the colour leaves everything else.
    const t = (await s.owner.call("POST", "/class-types", { name: "Barre", color: "#0F766E" })).body;
    expect(t.kind).toBe("class");
    const p = await s.owner.call("PATCH", `/class-types/${t.id}`, { color: "#BE185D" });
    expect(p.body).toMatchObject({ color: "#BE185D", kind: "class", name: "Barre" });
  });
});

describe("appointments", () => {
  it("asks before saving one with no client, and has no waitlist", async () => {
    const { appt } = await setup();
    const ask = await appt();
    expect(ask.status).toBe(409);
    expect(ask.body.error.flags.map((f: { code: string }) => f.code)).toEqual(["appointment_no_client"]);
    expect(ask.body.error.message).toMatch(/usually booked once a client has confirmed/);
    const ok = await appt({ acknowledge: [...ACK, "appointment_no_client"] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ capacity: 1, waitlistEnabled: false, classpassEnabled: false });
  });

  it("books the client in as it's created, and stays private to them", async () => {
    const { s, appt, calendar } = await setup();
    const r = await appt({ clientIds: [s.c1.id] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [b] = await db.select().from(bookings).where(eq(bookings.sessionId, r.body.id));
    expect(b).toMatchObject({ clientId: s.c1.id, source: "staff", status: "confirmed" });
    expect((await outbox("booking.confirmed")).some((n) => n.userId === s.c1.id)).toBe(true);

    // Staff see it on the schedule; the booked client sees it; other clients don't.
    expect((await calendar(s.owner)).find((x) => x.id === r.body.id)).toMatchObject({ isAppointment: true });
    expect((await calendar(s.c1)).map((x) => x.id)).toContain(r.body.id);
    expect((await calendar(s.c2)).map((x) => x.id)).not.toContain(r.body.id);
    expect((await s.c2.call("GET", `/sessions/${r.body.id}`)).status).toBe(404);
    expect((await s.c1.call("GET", `/sessions/${r.body.id}`)).body).toMatchObject({ isAppointment: true });
    // Clients can't book appointments themselves.
    const self = await s.c2.call("POST", "/bookings", { sessionId: r.body.id });
    expect(self.status).toBe(403);
    expect(self.body.error.message).toMatch(/booked by the studio/);
  });

  it("needs a package that covers appointments (group class packs don't), or complimentary", async () => {
    const { s, appt } = await setup();
    const groupPack = (await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months" })).body;
    await s.owner.call("POST", `/clients/${s.c3.id}/packages`, { planId: groupPack.id });
    // Studios that allow bookings without a package (the default): staff are asked first; it shows as pay at studio.
    const ask = await appt({ clientIds: [s.c3.id] });
    expect(ask.body.error.flags.map((f: { code: string }) => f.code)).toEqual(["no_package"]);
    expect(ask.body.error.flags[0].message).toMatch(/doesn't have a package that covers Private reformer appointments/);
    const anyway = await appt({ clientIds: [s.c3.id], startTime: "13:00", acknowledge: [...ACK, "no_package"] });
    expect((await db.select().from(bookings).where(eq(bookings.sessionId, anyway.body.id)))[0]!.payment).toBe("pay_later");
    // Studios that don't: no booking without a package (or complimentary).
    await s.owner.call("PATCH", "/settings", { allowBookingWithoutPackage: false });
    const r = await appt({ clientIds: [s.c3.id], acknowledge: [...ACK, "no_package"] });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "appointment_package_needed", message: expect.stringMatching(/only allows bookings with a package.*complimentary/) });
    expect(r.body.error.packages[0].reason).toMatch(/covers group classes, not Private reformer appointments/);
    // An open slot, then booked in for free.
    const open = await appt({ acknowledge: [...ACK, "appointment_no_client"] });
    expect((await s.owner.call("POST", "/bookings", { sessionId: open.body.id, clientId: s.c3.id, complimentary: true })).body).toMatchObject({ payment: "complimentary" });
    // Chloe's private pack pays for hers.
    const mine = await appt({ clientIds: [s.c1.id], startTime: "17:00" });
    expect((await db.select().from(bookings).where(eq(bookings.sessionId, mine.body.id)))[0]!.payment).toBe("package");
  });

  it("fits everyone added, and only takes clients for appointments", async () => {
    const { s, appt, cls } = await setup();
    const duo = await appt({ clientIds: [s.c1.id, s.c2.id] });
    expect(duo.body.capacity).toBe(2);
    expect((await appt({ clientIds: [s.c1.id, s.c2.id], capacity: 1 })).body.error.fields.capacity).toMatch(/at least 2 spots/);
    expect((await cls({ clientIds: [s.c1.id] })).body.error.code).toBe("clients_only_for_appointments");
  });

  it("repeats weekly with the client booked into each one, with one confirmation", async () => {
    const { s, privateType } = await setup();
    const r = await s.owner.call("POST", "/series", {
      classTypeId: privateType.id, locationId: s.locationId, instructorId: s.ana.id, durationMinutes: 55, startTime: "15:00",
      daysOfWeek: [2], startDate: dayOffset(1), occurrences: 4, clientIds: [s.c1.id], acknowledge: ACK,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.sessions).toHaveLength(4);
    for (const x of r.body.sessions) {
      const bs = await db.select().from(bookings).where(eq(bookings.sessionId, x.id));
      expect(bs.map((b) => b.clientId)).toEqual([s.c1.id]);
    }
    expect(new Set((await outbox("booking.confirmed")).filter((n) => n.userId === s.c1.id).map((n) => (n.data as { bookingId: string }).bookingId)).size).toBe(1);

    // A repeat with no client asks first, like a single appointment.
    const ask = await s.owner.call("POST", "/series", { classTypeId: privateType.id, locationId: s.locationId, instructorId: s.ana.id, durationMinutes: 55, startTime: "17:00", daysOfWeek: [4], startDate: dayOffset(1), occurrences: 2, acknowledge: ACK });
    expect(ask.body.error.flags.map((f: { code: string }) => f.code)).toEqual(["appointment_no_client"]);
  });

  it("books the client into dates the background job adds later", async () => {
    const { s, privateType } = await setup();
    const r = await s.owner.call("POST", "/series", { classTypeId: privateType.id, locationId: s.locationId, instructorId: s.ana.id, durationMinutes: 55, startTime: "15:00", daysOfWeek: [3], startDate: dayOffset(1), clientIds: [s.c1.id], acknowledge: ACK });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [series] = await db.select().from(classSeries).where(eq(classSeries.id, r.body.series.id));
    const before = r.body.sessions.length;
    const more = await db.transaction((tx) => generateSeriesSessions(tx, series!, dayOffset(200)));
    expect(more.length).toBeGreaterThan(0);
    for (const x of more) {
      expect((await db.select().from(bookings).where(and(eq(bookings.sessionId, x.id), eq(bookings.clientId, s.c1.id)))).length).toBe(1);
    }
    expect(before).toBeGreaterThan(0);
  });

  it("turning a class type into appointments switches ClassPass off for its upcoming classes", async () => {
    const { s, cls } = await setup();
    await cls({ classpassEnabled: true, classpassSpots: 3 });
    const r = await s.owner.call("PATCH", `/class-types/${s.classTypeId}`, { kind: "appointment" });
    expect(r.body).toMatchObject({ kind: "appointment", classpassSwitchedOff: 1 });
    expect((await db.select().from(classSessions))[0]!.classpassEnabled).toBe(false);
    expect((await db.select().from(classTypes).where(eq(classTypes.id, s.classTypeId)))[0]!.kind).toBe("appointment");
  });
});

describe("recurring classes with ClassPass", () => {
  it("copies ClassPass settings to every class in the series", async () => {
    const { s } = await setup();
    const r = await s.owner.call("POST", "/series", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 12, durationMinutes: 50, startTime: "07:00", daysOfWeek: [1, 3, 5], startDate: dayOffset(1), occurrences: 6, classpassEnabled: true, classpassSpots: 4, acknowledge: ACK });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.sessions).toHaveLength(6);
    expect(r.body.sessions.every((x: { classpassEnabled: boolean; classpassSpots: number }) => x.classpassEnabled && x.classpassSpots === 4)).toBe(true);
  });
});

describe("ClassPass spots", () => {
  it("checks the settings make sense", async () => {
    const { s, cls, appt } = await setup();
    expect((await cls({ classpassEnabled: true })).body.error.fields.classpassSpots).toMatch(/how many spots/);
    expect((await cls({ classpassEnabled: true, classpassSpots: 11 })).body.error.fields.classpassSpots).toMatch(/at most all 10/);
    expect((await appt({ clientIds: [s.c1.id], classpassEnabled: true, classpassSpots: 1 })).body.error.code).toBe("classpass_appointment");
    // Off means no spots are kept.
    expect((await cls({ classpassEnabled: false, classpassSpots: 3 })).body).toMatchObject({ classpassEnabled: false, classpassSpots: null });
  });

  it("lets staff add ClassPass bookings up to the limit, with members still able to book the rest", async () => {
    const { s, cls, calendar } = await setup();
    const c = (await cls({ capacity: 4, classpassEnabled: true, classpassSpots: 2 })).body;
    const cp1 = await s.owner.call("POST", "/bookings", { sessionId: c.id, clientId: s.c1.id, viaClasspass: true });
    expect(cp1.status, JSON.stringify(cp1.body)).toBe(201);
    expect(cp1.body).toMatchObject({ source: "classpass", payment: "classpass" });
    await s.owner.call("POST", "/bookings", { sessionId: c.id, clientId: s.c2.id, viaClasspass: true });
    const third = await s.owner.call("POST", "/bookings", { sessionId: c.id, clientId: s.c3.id, viaClasspass: true });
    expect(third.status).toBe(409);
    expect(third.body.error).toMatchObject({ code: "classpass_full", message: expect.stringMatching(/All 2 ClassPass spots are taken/) });
    // A member can still take a normal spot.
    expect((await s.c3.call("POST", "/bookings", { sessionId: c.id, acknowledge: ACK })).status).toBe(201);
    // Clients can't mark their own booking as ClassPass.
    expect((await s.c3.call("POST", "/bookings", { sessionId: c.id, viaClasspass: true })).status).toBe(403);

    const mine = (await calendar(s.owner)).find((x) => x.id === c.id);
    expect(mine!.classpass).toEqual({ enabled: true, spots: 2, taken: 2, available: 0 });
    expect((await calendar(s.c3)).find((x) => x.id === c.id)!.classpass).toBeUndefined();
    expect((await s.owner.call("GET", `/sessions/${c.id}`)).body.classpass).toMatchObject({ spots: 2, taken: 2 });
    expect((await s.c3.call("GET", `/sessions/${c.id}`)).body.classpassSpots).toBeUndefined();

    // Fewer ClassPass spots than already booked: asked first; the bookings stay.
    const fewer = await s.owner.call("PATCH", `/sessions/${c.id}`, { changes: { classpassSpots: 1 } });
    expect(fewer.body.error.flags.map((f: { code: string }) => f.code)).toEqual(["classpass_reduced"]);
    expect((await s.owner.call("PATCH", `/sessions/${c.id}`, { changes: { classpassSpots: 1 }, acknowledge: ["classpass_reduced"] })).status).toBe(200);
    expect((await db.select().from(bookings).where(eq(bookings.source, "classpass"))).length).toBe(2);

    // ClassPass bookings are changed in ClassPass; cancelling takes no studio fee or refund.
    expect((await s.owner.call("POST", `/bookings/${cp1.body.id}/move`, { targetSessionId: (await cls({ startTime: "11:00" })).body.id })).body.error.code).toBe("classpass_move");
    const cancel = await s.owner.call("POST", `/bookings/${cp1.body.id}/cancel`, { notifyClient: false });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
  });

  it("never shows ClassPass more spots than the class has free, and lists upcoming ClassPass classes", async () => {
    const { s, cls } = await setup();
    const c = (await cls({ capacity: 3, classpassEnabled: true, classpassSpots: 3 })).body;
    await s.c1.call("POST", "/bookings", { sessionId: c.id, acknowledge: ACK });
    await s.c2.call("POST", "/bookings", { sessionId: c.id, acknowledge: ACK });
    const off = (await cls({ startTime: "12:00" })).body;
    expect((await s.owner.call("POST", "/bookings", { sessionId: off.id, clientId: s.c3.id, viaClasspass: true })).body.error.code).toBe("classpass_off");

    const list = (await s.owner.call("GET", "/classpass/spots?days=7")).body;
    expect(list).toEqual([expect.objectContaining({ sessionId: c.id, className: "Reformer Pilates", spots: 3, taken: 0, available: 1 })]);
    expect((await s.c1.call("GET", "/classpass/spots")).status).toBe(403);
  });

  it("templates carry ClassPass settings into new classes", async () => {
    const { s } = await setup();
    const t = (await s.owner.call("POST", "/templates", { name: "Reformer AM", classTypeId: s.classTypeId, locationId: s.locationId, capacity: 8, durationMinutes: 50, startTime: "07:00", classpassEnabled: true, classpassSpots: 2 })).body;
    expect(t).toMatchObject({ classpassEnabled: true, classpassSpots: 2 });
    expect((await s.owner.call("PATCH", `/templates/${t.id}`, { classpassSpots: 9 })).body.error.fields.classpassSpots).toMatch(/at most all 8/);
    const c = await s.owner.call("POST", "/sessions", { templateId: t.id, date: dayOffset(4), instructorId: s.ana.id, acknowledge: ACK });
    expect(c.body).toMatchObject({ classpassEnabled: true, classpassSpots: 2 });
  });
});

describe("rooms are optional", () => {
  it("creates classes at a location with no rooms, and lists classes and appointments apart", async () => {
    const { locations: L, classTypes: CT } = await import("../src/db/schema.js");
    const h = await import("./helpers.js");
    const s = await h.studio();
    const [loc] = await h.db.insert(L).values({ orgId: s.orgId, name: "Pop-up studio", timezone: "Asia/Singapore" }).returning();
    const r = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: loc!.id, instructorId: s.ana.id, capacity: 12, durationMinutes: 50, date: h.dayOffset(3), startTime: "09:00" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.roomId).toBeNull();
    await h.db.insert(CT).values({ orgId: s.orgId, name: "Private session", color: "#7C3AED", kind: "appointment" });
    expect((await s.owner.call("GET", "/class-types?kind=appointment")).body.map((t: { name: string }) => t.name)).toEqual(["Private session"]);
    expect((await s.owner.call("GET", "/class-types?kind=class")).body.map((t: { name: string }) => t.name)).toEqual(["Reformer Pilates"]);
  });
});
