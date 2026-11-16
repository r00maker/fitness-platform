import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { classSessions, journeys, organizations } from "../src/db/schema.js";
import { app, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const orgOf = async (id: string) => (await db.select().from(organizations).where(eq(organizations.id, id)))[0]!;

describe("setup by studio type", () => {
  it("a new studio picks its kind and gets the features and rules that suit it, without being asked", async () => {
    const s = await studio();
    const fd = await person(s.orgId, "front_desk", "Faye");
    expect((await fd.call("GET", "/setup")).status).toBe(403);
    expect((await s.owner.call("POST", "/setup", { studioType: "huge" })).status).toBe(400);

    const before = (await s.owner.call("GET", "/setup")).body;
    expect(before).toMatchObject({ done: false, studioType: null, usual: null, changedFromUsual: [] });
    expect(before.types.map((t: { key: string; label: string }) => `${t.key}: ${t.label}`)).toEqual(["independent: Independent studio", "boutique: Boutique studio", "multi: Several locations"]);
    const indie = before.types[0];
    expect(indie.features.on).toEqual(["Gift cards", "Reviews"]);
    expect(indie.rules.map((r: { label: string; text: string }) => `${r.label}: ${r.text}`)).toEqual([
      "Booking closes: When class starts",
      "Clients need a package to book: No, they can pay at the studio",
      "Late-cancellation window: 6 hours before class",
      "Clients choose a spot: Off",
      "How waitlists work: Always book in automatically",
      "Approving cover: An admin chooses",
      "Celebration pop-ups for staff: Off",
    ]);
    expect(before.checklist.map((c: { key: string; done: boolean }) => `${c.key}:${c.done}`)).toEqual(["type:false", "locations:true", "classTypes:true", "packages:false", "team:true", "schedule:false"]);

    // No classes yet and nothing running: it just applies.
    const done = await s.owner.call("POST", "/setup", { studioType: "independent" });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.summary).toBe("Set up as an independent studio. 7 features changed, 5 rules filled in. You can change anything under Setup.");
    const org = await orgOf(s.orgId);
    expect(org).toMatchObject({ studioType: "independent", bookingClosesMinutesBefore: 0, clientsNeedPackage: false, lateCancelWindowHours: 6, spotBookingEnabled: false, waitlistModes: "automatic", celebrationsEnabled: false, giftCardsEnabled: true, reviewsEnabled: true });
    expect(org.setupDoneAt).not.toBeNull();
    expect([...org.featuresOff].sort()).toEqual(["agents", "inbox", "leads", "marketing", "payroll", "shop"]);
    expect((await s.owner.call("GET", "/journeys")).body.error.code).toBe("feature_off");
    expect(done.body.checklist[0]).toEqual({ key: "type", label: "Choose your kind of studio", done: true });

    // Studio rules can say what's been changed from the usual for this kind of studio.
    await s.owner.call("PATCH", "/settings", { lateCancelWindowHours: 24 });
    const after = (await s.owner.call("GET", "/setup")).body;
    expect(after).toMatchObject({ done: true, studioType: "independent", changedFromUsual: ["lateCancelWindowHours"] });
    expect(after.usual.lateCancelWindowHours).toBe(6);
  });

  it("choosing for a studio that's running asks first and lists exactly what changes, then stops what's switched off", async () => {
    const s = await studio();
    await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 86_400_000 + 3_000_000), capacity: 10 });
    const j = (await s.owner.call("POST", "/journeys/from-recipe", { recipe: "intro_funnel" })).body;
    await db.update(journeys).set({ status: "live" }).where(eq(journeys.id, j.id));

    const ask = await s.owner.call("POST", "/setup", { studioType: "boutique" });
    expect(ask.body.error.code).toBe("needs_confirmation");
    expect(ask.body.error.flags[0].title).toBe("Use these settings?");
    expect(ask.body.error.message).toBe("Set up as a boutique studio? Switches on Gift cards and Refer a friend. Switches off Leads and Agents (nothing is deleted). Changes clients need a package to book from no, they can pay at the studio to yes.");
    expect((await orgOf(s.orgId)).studioType).toBeNull(); // nothing changed until confirmed
    expect((await s.owner.call("POST", "/setup", { studioType: "boutique", acknowledge: ["setup_changes"] })).status).toBe(200);
    expect(await orgOf(s.orgId)).toMatchObject({ studioType: "boutique", clientsNeedPackage: true, referralsEnabled: true });

    // Changing type later: what stops is spelled out, and it stops.
    const again = await s.owner.call("POST", "/setup", { studioType: "independent" });
    expect(again.body.error.message).toMatch(/^Set up as an independent studio\? Switches off Marketing emails and journeys, Refer a friend, Shop, Payroll and Communication inbox \(nothing is deleted\)\. Changes booking closes from 1 hour before to when class starts; /);
    expect(again.body.error.message).toMatch(/1 live journey will be paused\./);
    await s.owner.call("POST", "/setup", { studioType: "independent", acknowledge: ["setup_changes"] });
    expect((await db.select().from(journeys).where(eq(journeys.id, j.id)))[0]!.status).toBe("paused");
    expect((await orgOf(s.orgId)).studioType).toBe("independent");
  });
});
