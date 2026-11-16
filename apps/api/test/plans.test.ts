import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, journeys, organizations } from "../src/db/schema.js";
import { app, config, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const KEY = "platform-key-for-tests-0123456789abcdef";
config.PLATFORM_ADMIN_KEY = KEY;
const platform = async (orgId: string, body: Record<string, unknown>, key: string | null = KEY) => {
  const res = await app.inject({ method: "POST", url: `/v1/platform/studios/${orgId}/plan`, headers: key ? { "x-platform-key": key } : {}, payload: body });
  return { status: res.statusCode, body: res.json() };
};
const orgOf = async (id: string) => (await db.select().from(organizations).where(eq(organizations.id, id)))[0]!;
const tz = "Asia/Singapore";

describe("plans", () => {
  it("our staff set the plan with their own key; the studio starts with that plan's features and rules", async () => {
    const s = await studio();
    expect((await platform(s.orgId, { plan: "essentials" }, null)).status).toBe(404);
    expect((await platform(s.orgId, { plan: "essentials" }, "x".repeat(KEY.length))).status).toBe(404);
    const asOwner = await app.inject({ method: "POST", url: `/v1/platform/studios/${s.orgId}/plan`, headers: { authorization: `Bearer ${s.owner.token}` }, payload: { plan: "signature" } });
    expect(asOwner.statusCode).toBe(404); // a studio sign-in is not our staff's key
    expect((await platform(s.orgId, { plan: "gold" })).status).toBe(400);

    const ask = await platform(s.orgId, { plan: "essentials" });
    expect(ask.body.error.code).toBe("needs_confirmation");
    expect(ask.body.error.flags[0].title).toBe("Change this studio's plan?");
    expect(ask.body.error.message).toMatch(/^Move Test Studio from Signature to Essentials\? Switches on Gift cards\. Switches off Marketing emails and journeys, Leads, Shop, Communication inbox and AI workflows \(nothing is deleted\)\. Fills in the usual rules for Essentials: booking closes from 1 hour before to when class starts; /);
    expect((await orgOf(s.orgId)).plan).toBe("signature"); // nothing until confirmed
    const done = await platform(s.orgId, { plan: "essentials", acknowledge: ["plan_changes"] });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await orgOf(s.orgId)).toMatchObject({ plan: "essentials", studioType: "independent", lateCancelWindowHours: 6, spotBookingEnabled: false, giftCardsEnabled: true });
    expect([...(await orgOf(s.orgId)).featuresOff].sort()).toEqual(["agents", "inbox", "leads", "marketing", "shop"]);

    // What the studio sees, and the usual rules for its kind (for "Changed" marks).
    const plan = (await s.owner.call("GET", "/plan")).body;
    expect(plan).toMatchObject({ plan: "essentials", label: "Essentials", price: { total: "USD 99", perMonth: "USD 99 a month" }, locations: { used: 1, included: 1, max: 1 }, admins: { used: 1, seats: 1 }, app: { status: "not_available", on: false }, aiWorkflows: false });
    expect(plan.price.parts).toEqual([{ label: "Essentials (1 location included)", amount: "USD 99" }]);
    const byKey = Object.fromEntries(plan.features.map((f: { key: string }) => [f.key, f]));
    expect(byKey.payroll).toMatchObject({ inPlan: true, on: true, includedIn: null });
    expect(byKey.marketing).toMatchObject({ inPlan: false, on: false, includedIn: "Growth" });
    expect(byKey.agents.includedIn).toBe("Signature");
    expect(plan.plans.map((p: { label: string; price: string; current: boolean }) => `${p.label} ${p.price}${p.current ? " (current)" : ""}`)).toEqual(["Essentials USD 99 (current)", "Growth USD 299", "Signature USD 599"]);
    expect(plan.sameForEveryPlan).toMatch(/we set you up and move your data for you, the same support/);
    const setup = (await s.owner.call("GET", "/setup")).body;
    expect(setup).toMatchObject({ done: true, studioType: "independent", studioTypeLabel: "Independent studio", changedFromUsual: [] });
    expect(setup.checklist[0]).toEqual({ key: "plan", label: "Your plan is set up", done: true });
    await s.owner.call("PATCH", "/settings", { lateCancelWindowHours: 24 });
    expect((await s.owner.call("GET", "/setup")).body.changedFromUsual).toEqual(["lateCancelWindowHours"]);
    const fd = await person(s.orgId, "front_desk", "Faye");
    expect((await fd.call("GET", "/plan")).status).toBe(403);
  });

  it("each plan's limits: features, locations and admin accounts", async () => {
    const s = await studio();
    await platform(s.orgId, { plan: "essentials", acknowledge: ["plan_changes"] });

    const feat = await s.owner.call("PUT", "/features/marketing", { on: true });
    expect(feat.body.error).toMatchObject({ code: "not_in_plan", message: "Marketing emails and journeys comes with Growth and Signature. You're on Essentials: talk to us to change your plan, and we'll set it up for you." });
    expect((await s.owner.call("PATCH", "/loyalty/settings", { loyaltyEnabled: true })).body.error.code).toBe("not_in_plan");
    expect((await s.owner.call("PATCH", "/referrals/settings", { referralsEnabled: true })).body.error.code).toBe("not_in_plan");
    expect((await s.owner.call("GET", "/features")).body.features.find((f: { key: string }) => f.key === "agents")).toMatchObject({ inPlan: false, includedIn: "Signature" });

    // Banners are part of the marketing tools, so they come with Growth and Signature.
    expect((await s.owner.call("GET", "/banners")).body.error.code).toBe("not_in_plan");
    expect((await s.c1.call("GET", "/me/banners")).body.banners).toEqual([]);
    expect((await s.owner.call("GET", "/announcements")).status).toBe(200); // announcements are on every plan

    const loc = await s.owner.call("POST", "/locations", { name: "East", timezone: tz });
    expect(loc.body.error).toMatchObject({ code: "plan_location_limit", message: "Your Essentials plan includes 1 location. Talk to us about Growth to add more." });

    const admin = await s.owner.call("POST", "/staff/invites", { email: "amy@example.com", firstName: "Amy", lastName: "Lee", role: "admin" });
    expect(admin.body.error).toMatchObject({ code: "plan_admin_limit" });
    expect(admin.body.error.message).toBe("Your Essentials plan includes 1 admin account, counting the owner. Add them as Front of House or an instructor instead (those are unlimited), or talk to us about Signature.");
    expect((await s.owner.call("POST", "/staff/invites", { email: "faye@example.com", firstName: "Faye", lastName: "Ong", role: "front_desk" })).status).toBeLessThan(300);
    expect((await s.owner.call("PATCH", `/staff/${s.ana.id}/role`, { role: "admin" })).body.error.code).toBe("plan_admin_limit");

    // Growth: one admin per location, up to 3 locations.
    await platform(s.orgId, { plan: "growth", acknowledge: ["plan_changes"] });
    expect((await s.owner.call("POST", "/staff/invites", { email: "amy@example.com", firstName: "Amy", lastName: "Lee", role: "admin" })).body.error.message).toMatch(/includes 1 admin account \(one for each location\)/);
    expect((await s.owner.call("POST", "/locations", { name: "East", timezone: tz })).status).toBe(201);
    expect((await s.owner.call("POST", "/staff/invites", { email: "amy@example.com", firstName: "Amy", lastName: "Lee", role: "admin" })).status).toBeLessThan(300);
    expect((await s.owner.call("POST", "/locations", { name: "West", timezone: tz })).status).toBe(201);
    expect((await s.owner.call("POST", "/locations", { name: "North", timezone: tz })).body.error.message).toBe("Your Growth plan includes 3 locations. Talk to us about Signature to add more.");
  });

  it("upgrading switches on what's new and keeps the studio's choices; Signature's extra locations; downgrading stops what isn't included", async () => {
    const s = await studio();
    const g = await platform(s.orgId, { plan: "growth", brandedApp: true, acknowledge: ["plan_changes"] });
    expect(g.body.plan).toMatchObject({ label: "Growth", price: { total: "USD 399" }, app: { status: "add_on", on: true, addOn: "USD 100" } });
    expect(g.body.plan.price.parts).toEqual([{ label: "Growth (3 locations included)", amount: "USD 299" }, { label: "Your own app", amount: "USD 100" }]);
    await s.owner.call("PUT", "/features/shop", { on: false, acknowledge: ["feature_off"] });

    // Up to Signature: leads and agents come on; the shop stays off because the studio chose that.
    const up = await platform(s.orgId, { plan: "signature" });
    expect(up.status, JSON.stringify(up.body)).toBe(200); // nothing switches off, so no question
    const f = Object.fromEntries(up.body.plan.features.map((x: { key: string; on: boolean }) => [x.key, x.on]));
    expect(f).toMatchObject({ leads: true, agents: true, shop: false, marketing: true });
    expect(up.body.plan).toMatchObject({ app: { status: "included", on: true }, aiWorkflows: true, admins: { seats: null } });
    expect((await orgOf(s.orgId)).brandedApp).toBe(false); // included, not an add-on

    // 5 locations included; the 6th asks first because it adds USD 150.
    for (const name of ["B", "C", "D", "E"]) expect((await s.owner.call("POST", "/locations", { name, timezone: tz })).status).toBe(201);
    const sixth = await s.owner.call("POST", "/locations", { name: "F", timezone: tz });
    expect(sixth.body.error.message).toBe("Your Signature plan includes 5 locations. Each extra location adds USD 150 a month, so this one takes your plan to USD 749 a month.");
    expect((await s.owner.call("POST", "/locations", { name: "F", timezone: tz, acknowledge: ["extra_location_cost"] })).status).toBe(201);
    const view = (await s.owner.call("GET", "/plan")).body;
    expect(view.price).toMatchObject({ total: "USD 749" });
    expect(view.price.parts[1]).toEqual({ label: "1 extra location at USD 150 each", amount: "USD 150" });

    // Down to Growth: what stops is spelled out, locations over the limit keep working.
    const a = (await s.owner.call("POST", "/agents", { name: "Agnes", starter: "low_bookings", definition: { when: { type: "daily", time: "22:00" }, job: { type: "low_bookings", daysAhead: 1, below: { mode: "count", value: 3 } }, notify: { roles: ["owner", "admin"] }, sees: ["schedule", "booking_counts"] } })).body;
    const j = (await s.owner.call("POST", "/journeys/from-recipe", { recipe: "intro_funnel" })).body;
    await db.update(journeys).set({ status: "live" }).where(eq(journeys.id, j.id));
    const down = await platform(s.orgId, { plan: "growth" });
    expect(down.body.error.message).toBe("Move Test Studio from Signature to Growth? Switches off Leads and AI workflows (nothing is deleted). 1 agent will stop sending reminders and summaries. It has 6 locations and Growth includes 3: they keep working, but no more can be added.");
    await platform(s.orgId, { plan: "growth", acknowledge: ["plan_changes"] });
    expect((await db.select().from(agents).where(eq(agents.id, a.id))).length).toBe(1); // kept, just not running
    expect((await db.select().from(journeys).where(eq(journeys.id, j.id)))[0]!.status).toBe("live"); // marketing is still in Growth
    expect((await s.owner.call("POST", "/agents/write/announcement", { brief: "Lift out of order today" })).body.error.code).toBe("feature_off"); // AI writing is Signature
    expect((await s.owner.call("GET", "/plan")).body).toMatchObject({ locations: { used: 6, max: 3, overLimit: true }, aiWorkflows: false });
    expect((await s.owner.call("POST", "/locations", { name: "G", timezone: tz })).body.error.code).toBe("plan_location_limit");
  });
});
