import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, emailCampaigns, journeys, leads, orders, organizations } from "../src/db/schema.js";
import { runDueAgents } from "../src/modules/agents/engine.js";
import { app, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const agnes = { name: "Agnes", starter: "low_bookings", definition: { when: { type: "daily", time: "22:00" }, job: { type: "low_bookings", daysAhead: 1, below: { mode: "count", value: 3 } }, notify: { roles: ["owner", "admin"] }, sees: ["schedule", "booking_counts"] } };

describe("feature switches", () => {
  it("lists what the studio uses; only owners and admins can change it", async () => {
    const s = await studio();
    const fd = await person(s.orgId, "front_desk", "Faye");
    const list = (await s.owner.call("GET", "/features")).body.features;
    expect(list.map((f: { key: string; on: boolean }) => `${f.key}:${f.on}`)).toEqual(["marketing:true", "giftCards:false", "loyalty:false", "referrals:false", "leads:true", "reviews:true", "shop:true", "payroll:true", "inbox:true", "agents:true"]);
    expect(list[0]).toMatchObject({ group: "Grow", label: "Marketing emails and journeys" });
    expect((await fd.call("GET", "/features")).status).toBe(403);
    expect((await fd.call("PUT", "/features/shop", { on: false })).status).toBe(403);
    expect((await s.ana.call("PUT", "/features/payroll", { on: false })).status).toBe(403);
    expect((await s.owner.call("PUT", "/features/nope", { on: false })).status).toBe(400);
    // Everyone gets the switches with the settings, so the apps can hide what's off.
    expect((await s.c1.call("GET", "/settings")).body.features).toMatchObject({ shop: true, giftCards: false, loyalty: false });
    expect((await s.owner.call("GET", "/settings")).body.features.payroll).toBe(true);
  });

  it("switching the shop off asks first when orders are waiting, hides products, and still lets the desk hand orders over", async () => {
    const s = await studio();
    const fd = await person(s.orgId, "front_desk", "Faye");
    const socks = (await s.owner.call("POST", "/shop/products", { name: "Grip socks", priceCents: 1800, stock: 10 })).body;
    const order = (await s.c1.call("POST", "/shop/checkout", { items: [{ productId: socks.id, quantity: 1 }] })).body.order;

    const ask = await s.owner.call("PUT", "/features/shop", { on: false });
    expect(ask.body.error.code).toBe("needs_confirmation");
    expect(ask.body.error.message).toBe("Switch off Shop? It's hidden from the menus, and nothing is deleted. 1 order waiting at the desk can still be handed over.");
    expect((await s.c1.call("GET", "/shop")).body.products).toHaveLength(1); // nothing changed until confirmed
    const done = await s.owner.call("PUT", "/features/shop", { on: false, acknowledge: ["feature_off"] });
    expect(done.body.features.find((f: { key: string }) => f.key === "shop").on).toBe(false);

    expect((await s.c1.call("GET", "/shop")).body).toMatchObject({ visible: false, products: [] });
    const refused = await s.c1.call("POST", "/shop/checkout", { items: [{ productId: socks.id, quantity: 1 }] });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "feature_off", message: "Shop is switched off for this studio. An owner or admin can switch it on under Setup, Features." });
    expect((await s.owner.call("POST", "/shop/products", { name: "Tee", priceCents: 3500 })).body.error.code).toBe("feature_off");
    // What's already under way can finish.
    expect((await s.c1.call("GET", "/me/shop-orders")).body.orders).toHaveLength(1);
    expect((await fd.call("GET", "/shop/orders")).status).toBe(200);
    expect((await fd.call("POST", `/shop/orders/${order.id}/collected`, { method: "qr" })).status).toBeLessThan(300);
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.collectedAt).not.toBeNull();

    // Back on: products are back, as they were.
    expect((await s.owner.call("PUT", "/features/shop", { on: true })).body.next).toBe("Add your products under Money, Shop.");
    expect((await s.c1.call("GET", "/shop")).body.products).toHaveLength(1);
  });

  it("switching marketing off pauses journeys and unschedules campaigns; switching back on doesn't restart them", async () => {
    const s = await studio();
    const j = (await s.owner.call("POST", "/journeys/from-recipe", { recipe: "intro_funnel" })).body;
    await db.update(journeys).set({ status: "live" }).where(eq(journeys.id, j.id));
    const [c] = await db.insert(emailCampaigns).values({ orgId: s.orgId, name: "Christmas", status: "scheduled", sendAt: new Date(Date.now() + 86_400_000) }).returning();

    const ask = await s.owner.call("PUT", "/features/marketing", { on: false });
    expect(ask.body.error.flags[0].details.lines).toEqual([
      "1 live journey will be paused. When you switch Marketing back on, set it live again when you're ready.",
      "1 scheduled campaign will go back to a draft and won't be sent.",
    ]);
    await s.owner.call("PUT", "/features/marketing", { on: false, acknowledge: ["feature_off"] });
    expect((await db.select().from(journeys).where(eq(journeys.id, j.id)))[0]!.status).toBe("paused");
    expect((await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, c!.id)))[0]!.status).toBe("draft");
    for (const url of ["/journeys", "/campaigns", "/segments", "/emails", "/marketing/options"]) expect((await s.owner.call("GET", url)).body.error?.code, url).toBe("feature_off");
    expect((await s.owner.call("POST", `/journeys/${j.id}/go-live`, { acknowledge: ["journey_starts"] })).body.error.code).toBe("feature_off");
    // Announcements and banners aren't part of marketing; they keep working.
    expect((await s.owner.call("GET", "/announcements")).status).toBe(200);

    const on = await s.owner.call("PUT", "/features/marketing", { on: true });
    expect(on.body.next).toMatch(/stay paused/);
    expect((await db.select().from(journeys).where(eq(journeys.id, j.id)))[0]!.status).toBe("paused");
    expect((await s.owner.call("GET", "/journeys")).status).toBe(200);
  });

  it("switching leads off cancels follow-up emails; agents off stops them running; payroll off hides My pay", async () => {
    const s = await studio();
    await db.insert(leads).values({ orgId: s.orgId, source: "walk_in", firstName: "Lee", email: "lee@example.com", token: "tok-lee", nextFollowUpAt: new Date(Date.now() + 3_600_000) } as never);
    const ask = await s.owner.call("PUT", "/features/leads", { on: false });
    expect(ask.body.error.message).toMatch(/1 follow-up email to leads won't be sent\./);
    await s.owner.call("PUT", "/features/leads", { on: false, acknowledge: ["feature_off"] });
    expect((await db.select().from(leads))[0]!.nextFollowUpAt).toBeNull();
    expect((await s.owner.call("GET", "/leads")).body.error.code).toBe("feature_off");

    const a = (await s.owner.call("POST", "/agents", agnes)).body;
    const now = new Date();
    await db.update(agents).set({ nextRunAt: new Date(now.getTime() - 1000) }).where(eq(agents.id, a.id));
    expect((await s.owner.call("PUT", "/features/agents", { on: false })).body.error.message).toMatch(/1 agent will stop sending reminders and summaries\./);
    await s.owner.call("PUT", "/features/agents", { on: false, acknowledge: ["feature_off"] });
    expect(await runDueAgents(db, now)).toBe(0);
    expect((await s.owner.call("GET", "/agents")).body.error.code).toBe("feature_off");
    await s.owner.call("PUT", "/features/agents", { on: true });
    expect(await runDueAgents(db, now)).toBe(1);

    // Nothing running: no question asked.
    const off = await s.owner.call("PUT", "/features/payroll", { on: false });
    expect(off.status).toBe(200);
    expect((await s.ana.call("GET", "/me/pay")).body.error.code).toBe("feature_off");
    expect((await s.owner.call("GET", "/payroll")).body.error.code).toBe("feature_off");
    expect((await s.owner.call("PUT", "/features/payroll", { on: false })).body.changed).toBe(false);
  });

  it("features with their own setting use it, and gift cards stay hidden from clients until they're set up", async () => {
    const s = await studio();
    const on = await s.owner.call("PUT", "/features/giftCards", { on: true });
    expect(on.body.next).toBe("Next, add a design under Marketing, Gift cards. Clients see gift cards once that's done.");
    const [org] = await db.select().from(organizations).where(eq(organizations.id, s.orgId));
    expect(org!.giftCardsEnabled).toBe(true);
    expect(org!.featuresOff).toEqual([]);
    expect((await s.c1.call("GET", "/gift-cards/shop")).body).toEqual({ enabled: false });

    await s.owner.call("PUT", "/features/reviews", { on: false, acknowledge: ["feature_off"] });
    expect((await db.select().from(organizations).where(eq(organizations.id, s.orgId)))[0]!.reviewsEnabled).toBe(false);
    expect((await s.owner.call("PUT", "/features/loyalty", { on: true })).body.next).toMatch(/add rewards under Marketing, Loyalty/);
    expect((await s.c1.call("GET", "/settings")).body.features).toMatchObject({ reviews: false, loyalty: true, giftCards: true });
  });
});
