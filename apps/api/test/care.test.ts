import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { suggestHealthCategory } from "@studio/shared";
import { bookings, clientHealthNotes, memberships } from "../src/db/schema.js";
import { app, db, dayOffset, outbox, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

type Row = { clientId: string; [k: string]: unknown };

async function setup(opts: { waiverRequired?: boolean } = {}) {
  const s = await studio({ waiverRequired: opts.waiverRequired ?? true });
  const foh = await person(s.orgId, "front_desk", "Fiona");
  const room = await s.owner.call("POST", "/rooms", { locationId: s.locationId, name: "Reformer Studio", spotLabels: ["Reformer 1", "Reformer 2", "Reformer 3"] });
  let hour = 7;
  const mk = async (extra: Record<string, unknown> = {}) =>
    (
      await s.owner.call("POST", "/sessions", {
        classTypeId: s.classTypeId, locationId: s.locationId, roomId: room.body.id, instructorId: s.ana.id, capacity: 3, durationMinutes: 50,
        date: dayOffset(3), startTime: `${String(hour++).padStart(2, "0")}:00`, acknowledge: ["unusual_start_time"], ...extra,
      })
    ).body.id as string;
  const rosterRow = async (caller: typeof s.owner, sessionId: string, clientId: string) =>
    ((await caller.call("GET", `/sessions/${sessionId}`)).body.roster as Row[]).find((r) => r.clientId === clientId)!;
  const classPass = (clientId: string) => db.update(memberships).set({ source: "classpass" }).where(eq(memberships.userId, clientId));
  return { s, foh, mk, rosterRow, classPass };
}

describe("waivers", () => {
  it("asks studio members to sign before their first booking, then never again", async () => {
    const { s, mk } = await setup();
    const c = await mk();
    const first = await s.c1.call("POST", "/bookings", { sessionId: c });
    expect(first.status).toBe(409);
    expect(first.body.error).toMatchObject({ code: "waiver_required", waiver: { text: expect.stringMatching(/at my own risk/), version: 1 } });
    expect((await s.c1.call("POST", "/bookings", { sessionId: c, waiver: { agree: false, signedName: "Chloe T" } })).status).toBe(400);

    expect((await s.c1.call("POST", "/bookings", { sessionId: c, waiver: { agree: true, signedName: "Chloe Tan" } })).status).toBe(201);
    expect((await s.c1.call("GET", "/me/waiver")).body).toMatchObject({ required: true, done: true, method: "signed_by_client" });
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk() })).status).toBe(201);
  });

  it("also needs the waiver to join a waitlist, since they may be booked in automatically", async () => {
    const { s, mk } = await setup();
    const c = await mk({ capacity: 1 });
    await s.c2.call("POST", "/bookings", { sessionId: c, waiver: { agree: true, signedName: "Dev Tan" } });
    expect((await s.c1.call("POST", "/waitlist", { sessionId: c, mode: "automatic" })).body.error.code).toBe("waiver_required");
    expect((await s.c1.call("POST", "/waitlist", { sessionId: c, mode: "automatic", waiver: { agree: true, signedName: "Chloe Tan" } })).status).toBe(201);
  });

  it("stops staff booking or waitlisting a studio member who hasn't signed, so they never show without one", async () => {
    const { s, mk, classPass } = await setup();
    const c = await mk({ capacity: 1 });
    const res = await s.owner.call("POST", "/bookings", { sessionId: c, clientId: s.c1.id });
    expect(res.body.error).toMatchObject({ code: "waiver_required", message: expect.stringMatching(/^Chloe T\d+ hasn't signed the waiver yet, so they can't be booked in\. Ask them to sign it in the app/) });
    // A paper copy marked done by an admin unblocks them.
    await s.owner.call("POST", `/clients/${s.c1.id}/waiver/mark-done`, { acknowledge: ["confirm_waiver_complete"] });
    expect((await s.owner.call("POST", "/bookings", { sessionId: c, clientId: s.c1.id })).status).toBe(201);
    expect((await s.owner.call("POST", "/waitlist", { sessionId: c, clientId: s.c2.id, mode: "automatic" })).body.error.code).toBe("waiver_required");

    // ClassPass clients are checked at the studio: staff just get a reminder.
    await classPass(s.c3.id);
    const cp = await s.owner.call("POST", "/bookings", { sessionId: await mk(), clientId: s.c3.id });
    expect(cp.status).toBe(201);
    expect(cp.body.flags[0]).toMatchObject({ code: "waiver_missing", severity: "info", message: expect.stringMatching(/Check it at the studio/) });
  });

  it("anyone still shown without a waiver (e.g. after an undo) gets the button", async () => {
    const { s, foh, mk, rosterRow } = await setup();
    const c = await mk();
    await s.c1.call("POST", "/bookings", { sessionId: c, waiver: { agree: true, signedName: "Chloe Tan" } });
    expect((await rosterRow(foh, c, s.c1.id)).waiver).toMatchObject({ status: "complete" });
    await s.owner.call("POST", `/clients/${s.c1.id}/waiver/undo`, { reason: "Signed the wrong name" });
    expect((await rosterRow(foh, c, s.c1.id)).waiver).toMatchObject({ status: "missing", canMarkDone: true });
    expect((await rosterRow(s.ana, c, s.c1.id)).waiver).toMatchObject({ status: "missing", canMarkDone: true });
  });

  it("lets staff mark a ClassPass client's waiver done after checking, and only admins can undo it", async () => {
    const { s, foh, mk, rosterRow, classPass } = await setup();
    await classPass(s.c1.id);
    const c = await mk();
    expect((await s.c1.call("POST", "/bookings", { sessionId: c })).status).toBe(201); // ClassPass clients aren't stopped
    let row = await rosterRow(foh, c, s.c1.id);
    expect(row.waiver).toMatchObject({ status: "missing", canMarkDone: true, canUndo: false });
    expect(row.upFront).toEqual([{ kind: "waiver_missing", text: "No waiver" }, { kind: "first_class", text: "First class" }]);

    const ask = await foh.call("POST", `/clients/${s.c1.id}/waiver/mark-done`, {});
    expect(ask.status).toBe(409);
    expect(ask.body.error.flags[0]).toMatchObject({ code: "confirm_waiver_complete", message: expect.stringMatching(/^Has Chloe T\d+ actually completed the studio's waiver\? Once it's marked as done, only an admin can undo it\.$/) });
    const done = await foh.call("POST", `/clients/${s.c1.id}/waiver/mark-done`, { acknowledge: ["confirm_waiver_complete"] });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ method: "confirmed_by_staff", recordedByName: expect.stringMatching(/^Fiona/) });
    row = await rosterRow(foh, c, s.c1.id);
    expect(row.waiver).toMatchObject({ status: "complete", canMarkDone: false, canUndo: false });
    expect((row.upFront as { kind: string }[]).map((u) => u.kind)).toEqual(["first_class"]);

    expect((await foh.call("POST", `/clients/${s.c1.id}/waiver/undo`, { reason: "oops" })).status).toBe(403);
    expect((await s.owner.call("POST", `/clients/${s.c1.id}/waiver/undo`, {})).status).toBe(400);
    expect((await s.owner.call("POST", `/clients/${s.c1.id}/waiver/undo`, { reason: "Marked by mistake" })).body).toMatchObject({ revokeReason: "Marked by mistake" });
    expect((await rosterRow(s.owner, c, s.c1.id)).waiver).toMatchObject({ status: "missing", canMarkDone: true });
    // The undone record is kept on the client's profile.
    const profile = await s.owner.call("GET", `/clients/${s.c1.id}`);
    expect(profile.body.waiver).toMatchObject({ status: "missing", history: [{ method: "confirmed_by_staff", revokeReason: "Marked by mistake" }] });
  });

  it("instructors can mark waivers only for clients in their own classes", async () => {
    const { s, foh, mk, classPass } = await setup();
    await classPass(s.c1.id);
    await classPass(s.c2.id);
    await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    const ack = { acknowledge: ["confirm_waiver_complete"] };
    expect((await s.ben.call("POST", `/clients/${s.c1.id}/waiver/mark-done`, ack)).status).toBe(404);
    expect((await s.ana.call("POST", `/clients/${s.c2.id}/waiver/mark-done`, ack)).status).toBe(404);
    expect((await s.ana.call("POST", `/clients/${s.c1.id}/waiver/mark-done`, ack)).status).toBe(201);
    expect((await s.ana.call("POST", `/clients/${s.c1.id}/waiver/mark-done`, ack)).body.error.code).toBe("waiver_already_done");

    // Eve is a studio member who signed a paper copy at the desk.
    expect((await foh.call("POST", `/clients/${s.c3.id}/waiver/mark-done`, ack)).status).toBe(201);
    expect((await s.c1.call("POST", `/clients/${s.c2.id}/waiver/mark-done`, ack)).status).toBe(403);
  });

  it("can be switched off: nothing is asked or shown", async () => {
    const { s, foh, mk, rosterRow } = await setup({ waiverRequired: false });
    const c = await mk();
    expect((await s.c1.call("POST", "/bookings", { sessionId: c })).status).toBe(201);
    const row = await rosterRow(foh, c, s.c1.id);
    expect(row.waiver).toEqual({ status: "not_required", canMarkDone: false, canUndo: false });
    expect((row.upFront as { kind: string }[]).map((u) => u.kind)).toEqual(["first_class"]);
    expect((await foh.call("POST", `/clients/${s.c1.id}/waiver/mark-done`, { acknowledge: ["confirm_waiver_complete"] })).body.error.code).toBe("waivers_off");
  });

  it("new waiver wording gets a new version; signatures record the version signed", async () => {
    const { s, mk } = await setup();
    await s.owner.call("PATCH", "/settings", { waiverText: "Our own waiver wording, long enough to count as a real waiver." });
    const res = await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    expect(res.body.error.waiver).toEqual({ text: "Our own waiver wording, long enough to count as a real waiver.", version: 2 });
    expect((await s.c1.call("POST", "/me/waiver", { agree: true, signedName: "Chloe Tan" })).body).toMatchObject({ waiverVersion: 2, signedName: "Chloe Tan" });
  });
});

describe("spot booking switched off", () => {
  it("keeps the confirmation step and who's attending, but drops spots everywhere", async () => {
    const { s, foh, mk, rosterRow } = await setup({ waiverRequired: false });
    await s.owner.call("PATCH", "/settings", { spotBookingEnabled: false });
    expect((await s.c1.call("GET", "/settings")).body.spotBookingEnabled).toBe(false);
    const c = await mk();
    expect((await s.c1.call("POST", "/bookings", { sessionId: c, spot: 2 })).body.error.code).toBe("no_spots");
    const b = await s.c1.call("POST", "/bookings", { sessionId: c });
    expect(b.body.spot).toBeNull();
    const att = await s.c2.call("GET", `/sessions/${c}/attendees`);
    expect(att.body).toMatchObject({ spotSelection: false, spots: null, namesShown: true, attending: [{ name: expect.stringMatching(/^Chloe T\.$/) }] });
    const row = await rosterRow(foh, c, s.c1.id);
    expect(row).not.toHaveProperty("spot");
    expect(row).not.toHaveProperty("spotLabel");
  });
});

describe("health notes", () => {
  it("are added once, shown to the class's instructor, and drop off when resolved", async () => {
    const { s, foh, mk, rosterRow } = await setup({ waiverRequired: false });
    const note = await s.c1.call("POST", "/me/health-notes", { description: "Sore left knee from running, avoiding deep lunges" });
    expect(note.status).toBe(201);
    expect(note.body).toMatchObject({ category: "injury", label: "Injury · Knee", status: "active", needsReview: false });
    const c = await mk();
    await s.c1.call("POST", "/bookings", { sessionId: c });

    const row = await rosterRow(s.ana, c, s.c1.id);
    expect(row.healthNotes).toMatchObject([{ label: "Injury · Knee", description: "Sore left knee from running, avoiding deep lunges" }]);
    expect(row.upFront).toEqual([{ kind: "health", text: "Injury · Knee" }, { kind: "first_class", text: "First class" }]);
    // Instructors of other classes can't open the list at all.
    expect((await s.ben.call("GET", `/sessions/${c}`)).status).toBe(404);

    expect((await s.c1.call("POST", `/me/health-notes/${note.body.id}/resolve`, {})).body.status).toBe("resolved");
    expect((await rosterRow(foh, c, s.c1.id)).healthNotes).toEqual([]);
    expect((await s.c1.call("GET", "/me/health-notes")).body).toMatchObject({ active: [], resolved: [{ id: note.body.id }] });
  });

  it("only asks 'still the same?' once a note is a month old", async () => {
    const { s } = await setup({ waiverRequired: false });
    const note = (await s.c1.call("POST", "/me/health-notes", { description: "22 weeks pregnant" })).body;
    expect(note).toMatchObject({ category: "pregnancy", label: "Pregnancy" });
    await db.update(clientHealthNotes).set({ reviewedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(clientHealthNotes.id, note.id));
    expect((await s.c1.call("GET", "/me/health-notes")).body.active[0].needsReview).toBe(true);
    expect((await s.c1.call("POST", `/me/health-notes/${note.id}/still-current`, {})).body.needsReview).toBe(false);
    // Rewording it re-suggests the type.
    expect((await s.c1.call("PATCH", `/me/health-notes/${note.id}`, { description: "Had my baby 6 weeks ago" })).body.category).toBe("postnatal");
  });

  it("are private to the client and staff", async () => {
    const { s, foh } = await setup({ waiverRequired: false });
    const note = (await s.c1.call("POST", "/me/health-notes", { category: "medical_condition", description: "Asthma, inhaler in my bag" })).body;
    expect((await s.c2.call("POST", `/me/health-notes/${note.id}/resolve`, {})).status).toBe(404);
    expect((await s.c2.call("DELETE", `/me/health-notes/${note.id}`)).status).toBe(404);
    expect((await s.ana.call("POST", `/clients/${s.c1.id}/health-notes`, { description: "Bad back" })).status).toBe(403);
    expect((await s.ana.call("GET", "/me/health-notes")).status).toBe(403);

    // Front of House can add one the client mentions at the desk.
    expect((await foh.call("POST", `/clients/${s.c1.id}/health-notes`, { description: "Recovering from wrist surgery" })).body).toMatchObject({ category: "recent_surgery", label: "Recent surgery · Wrist" });
    expect((await s.owner.call("GET", `/clients/${s.c1.id}`)).body.healthNotes.active).toHaveLength(2);
    expect((await s.c1.call("DELETE", `/me/health-notes/${note.id}`)).status).toBe(204);
    expect((await s.c1.call("GET", "/me/health-notes")).body.active).toHaveLength(1);
  });

  it("suggests a sensible type from plain English", () => {
    const cases: [string, string | null, string | null][] = [
      ["sore left knee", "injury", "Knee"],
      ["lower back pain", "injury", "Lower back"],
      ["pregnant with lower back pain", "pregnancy", "Lower back"],
      ["18 weeks along", "pregnancy", null],
      ["c-section 8 weeks ago", "postnatal", null],
      ["postpartum, diastasis recti", "postnatal", "Core"],
      ["ACL reconstruction in March", "recent_surgery", "Knee"],
      ["high blood pressure", "medical_condition", null],
      ["arthritis in both hands", "medical_condition", "Hand"],
      ["tight hamstrings", "injury", "Hamstring"],
      ["feeling great", null, null],
    ];
    for (const [text, category, area] of cases) {
      const got = suggestHealthCategory(text);
      expect(got?.category ?? null, text).toBe(category);
      if (category) expect(got?.area ?? null, text).toBe(area);
    }
  });
});

describe("tags on class lists", () => {
  it("shows up to two pinned tags up front and counts the rest", async () => {
    const { s, foh, mk, rosterRow } = await setup({ waiverRequired: false });
    const mkTag = async (name: string, pinned: boolean) => (await s.owner.call("POST", "/client-tags", { name, pinned })).body.id as string;
    const ids = [await mkTag("VIP", true), await mkTag("Teacher", true), await mkTag("Staff", true), await mkTag("Prefers front row", false)];
    await foh.call("PUT", `/clients/${s.c1.id}/tags`, { tagIds: ids });
    await db.insert(bookings).values({ orgId: s.orgId, sessionId: await mk(), clientId: s.c1.id, source: "staff", attendance: "present" });
    const c = await mk();
    await s.c1.call("POST", "/bookings", { sessionId: c });
    const row = await rosterRow(foh, c, s.c1.id);
    expect(row.upFront).toEqual([
      { kind: "tag", text: "Staff", color: "#64748b" },
      { kind: "tag", text: "Teacher", color: "#64748b" },
    ]);
    expect(row.moreTags).toBe(2);
    expect((row.tags as unknown[]).length).toBe(4);
  });
});

describe("cover requests", () => {
  it("instructors ask but don't choose; admins are told and choose", async () => {
    const { s, mk } = await setup({ waiverRequired: false });
    const c = await mk();
    expect((await s.ana.call("POST", "/substitute-requests", { sessionId: c, invitedInstructorIds: [s.ben.id] })).body.error.message).toBe(
      "Your studio's admin arranges who covers. Just send the request and you'll be told once it's sorted.",
    );
    const req = await s.ana.call("POST", "/substitute-requests", { sessionId: c, reason: "Sick" });
    expect(req.status).toBe(201);
    expect((await outbox("sub.request_made")).map((n) => n.userId)).toContain(s.owner.id);
    expect((await s.ana.call("POST", `/substitute-requests/${req.body.id}/assign`, { instructorId: s.ben.id })).status).toBe(403);
    expect((await s.owner.call("POST", `/substitute-requests/${req.body.id}/assign`, { instructorId: s.ben.id })).body.status).toBe("filled");
  });
});

describe("favourite instructor filter", () => {
  it("shows only that instructor's classes in one tap", async () => {
    const { s, mk } = await setup({ waiverRequired: false });
    for (let i = 0; i < 3; i++) await db.insert(bookings).values({ orgId: s.orgId, sessionId: await mk(), clientId: s.c1.id, source: "staff", attendance: "present" });
    const anaClass = await mk();
    const benClass = await mk({ instructorId: s.ben.id });
    expect((await s.c1.call("GET", "/me")).body.favouriteInstructor).toMatchObject({ id: s.ana.id, firstName: "Ana", classes: 3 });

    const all = await s.c1.call("GET", `/calendar?view=day&date=${dayOffset(3)}`);
    expect(all.body).toMatchObject({ favouriteInstructorId: s.ana.id, favouriteOnly: false });
    expect(all.body.sessions.map((x: { id: string }) => x.id)).toContain(benClass);
    const fav = await s.c1.call("GET", `/calendar?view=day&date=${dayOffset(3)}&favouriteInstructor=true`);
    const ids = fav.body.sessions.map((x: { id: string }) => x.id);
    expect(ids).toContain(anaClass);
    expect(ids).not.toContain(benClass);
    expect((await s.c1.call("GET", `/calendar?view=day&date=${dayOffset(3)}&favouriteInstructor=false`)).body.sessions.length).toBe(all.body.sessions.length);

    // No favourite yet: the filter shows nothing rather than everything.
    expect((await s.c2.call("GET", "/me")).body.favouriteInstructor).toBeNull();
    expect((await s.c2.call("GET", `/calendar?view=day&date=${dayOffset(3)}&favouriteInstructor=true`)).body.sessions).toEqual([]);
  });
});


describe("preferences", () => {
  it("saves light/dark on the account for every role", async () => {
    const { s, foh } = await setup({ waiverRequired: false });
    expect((await s.c1.call("GET", "/me")).body.theme).toBe("system");
    for (const who of [s.c1, s.ana, foh, s.owner]) expect((await who.call("PATCH", "/me/preferences", { theme: "dark" })).body).toEqual({ theme: "dark" });
    expect((await s.ana.call("GET", "/me")).body.theme).toBe("dark");
    expect((await s.c2.call("GET", "/me")).body.theme).toBe("system"); // only your own
    expect((await s.c1.call("PATCH", "/me/preferences", { theme: "purple" })).status).toBe(400);
  });
});
