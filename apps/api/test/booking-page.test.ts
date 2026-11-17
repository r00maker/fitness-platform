import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { classTypes, organizations, packagePlans, users } from "../src/db/schema.js";
import { app, dayOffset, db, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const pub = async (url: string, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: "GET", url: `/v1/public${url}`, headers });
  return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? res.json() : res.body, headers: res.headers };
};

async function setup() {
  const s = await studio();
  let hour = 7;
  const cls = async (days: number, opts: Record<string, unknown> = {}) => {
    const r = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 8, durationMinutes: 50, date: dayOffset(days), startTime: `${String(hour++).padStart(2, "0")}:00`, acknowledge: ["unusual_start_time", "possible_duplicate"], ...opts });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const save = (body: Record<string, unknown> = {}) => s.owner.call("PUT", "/booking-page", { slug: "test-studio", enabled: true, intro: "Small classes in Tanjong Pagar.", accent: null, ...body });
  return { s, cls, save };
}

describe("booking page: the studio's link", () => {
  it("suggests a link from the name, saves it, and refuses one that's taken or reserved", async () => {
    const { s, save } = await setup();
    const v = (await s.owner.call("GET", "/booking-page")).body;
    expect(v).toMatchObject({ slug: "test-studio", saved: false, live: false });
    expect(v.widget.code).toContain('data-studio-schedule="test-studio"');
    expect(v.widget.code).toContain("/v1/public/widget.js");
    expect((await s.ana.call("GET", "/booking-page")).status).toBe(403);
    const ok = await save();
    expect(ok.body).toMatchObject({ saved: true, live: true, url: expect.stringMatching(/\/s\/test-studio$/) });

    const other = await studio();
    const taken = await other.owner.call("PUT", "/booking-page", { slug: "test-studio", enabled: true });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toMatch(/test-studio-2/);
    expect((await other.owner.call("PUT", "/booking-page", { slug: "admin", enabled: true })).status).toBe(400);
    expect((await other.owner.call("PUT", "/booking-page", { slug: "Bad Link!", enabled: true })).status).toBe(400);
    // Uppercase is just made lowercase.
    expect((await other.owner.call("PUT", "/booking-page", { slug: "Other-Studio", enabled: true })).body.slug).toBe("other-studio");
  });

  it("new studios added in HQ get a link from their name", async () => {
    const { uniqueSlug } = await import("../src/modules/booking-page/routes.js");
    const { save } = await setup();
    await save();
    expect(await uniqueSlug(db, "Test Studio")).toBe("test-studio-2");
    expect(await uniqueSlug(db, "Breathe Pilates & Yoga!")).toBe("breathe-pilates-and-yoga");
  });
});

describe("booking page: public", () => {
  it("is only public once saved, switched on and the studio is open", async () => {
    const { s, save } = await setup();
    expect((await pub("/studios/test-studio")).status).toBe(404);
    await save();
    const r = await pub("/studios/test-studio");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Test Studio", intro: "Small classes in Tanjong Pagar.", currency: "SGD", locations: [{ name: "Central" }], classTypes: [{ name: "Reformer Pilates" }] });
    expect(r.body.rules.cancelling).toMatch(/Cancel up to 12 hours before/);
    await save({ enabled: false });
    expect((await pub("/studios/test-studio")).status).toBe(404);
    await save({ enabled: true });
    await db.update(organizations).set({ lifecycle: "onboarding" }).where(eq(organizations.id, s.orgId));
    expect((await pub("/studios/test-studio")).status).toBe(404);
  });

  it("shows the timetable with spots left, hides appointments and past classes, and no one's names", async () => {
    const { s, cls, save } = await setup();
    await save();
    const open = await cls(1);
    const small = await cls(1, { capacity: 2 });
    await s.c1.call("POST", "/bookings", { sessionId: small, acknowledge: ["no_free_cancel"] });
    await s.c2.call("POST", "/bookings", { sessionId: small, acknowledge: ["no_free_cancel"] });
    const [appt] = await db.insert(classTypes).values({ orgId: s.orgId, name: "Private session", color: "#7C3AED", kind: "appointment" }).returning();
    await cls(1, { classTypeId: appt!.id, capacity: 1, acknowledge: ["unusual_start_time", "possible_duplicate", "appointment_no_client"] });
    const later = await cls(20); // beyond the 14-day booking window

    const r = await pub("/studios/test-studio/schedule?days=14");
    expect(r.status).toBe(200);
    const all = r.body.days.flatMap((d: { classes: unknown[] }) => d.classes) as { id: string; name: string; availability: string; spotsLeft: number; label: string; instructor: { name: string }; bookUrl: string }[];
    expect(all.map((c) => c.name)).not.toContain("Private session");
    const o = all.find((c) => c.id === open)!;
    expect(o).toMatchObject({ availability: "open", spotsLeft: 8, label: "8 spots left", instructor: { name: "Ana T." } });
    expect(o.bookUrl).toMatch(new RegExp(`/s/test-studio/classes/${open}$`));
    expect(all.find((c) => c.id === small)).toMatchObject({ availability: "waitlist", spotsLeft: 0, label: "Full: join the waitlist" });
    expect(all.some((c) => c.id === later)).toBe(false); // 20 days out: outside the 14 days shown
    expect(r.body.days).toHaveLength(14);
    // Nothing about the people booked.
    const [c1] = await db.select().from(users).where(eq(users.id, s.c1.id));
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(c1!.email);
    expect(text).not.toContain(c1!.lastName);
    expect(text).not.toContain(s.c1.id);
    // Booking not open yet for a class 20 days away.
    const far = await pub(`/studios/test-studio/schedule?date=${dayOffset(20)}&days=1`);
    expect(far.body.days[0].classes[0]).toMatchObject({ availability: "not_open_yet", label: expect.stringMatching(/^Booking opens /) });
    expect(r.headers["cache-control"]).toContain("max-age");
  });

  it("shows one class with what's needed to book it", async () => {
    const { s, cls, save } = await setup();
    await save();
    await db.update(organizations).set({ clientsNeedPackage: true }).where(eq(organizations.id, s.orgId));
    await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months" });
    const id = await cls(2);
    const r = await pub(`/studios/test-studio/classes/${id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: "Reformer Pilates", spotsLeft: 8, instructor: { name: "Ana T." }, toBook: { needPackage: true } });
    expect(r.body.toBook.packages[0]).toMatchObject({ name: "10-class pack", price: "SGD 280.00" });
    expect(r.body.toBook.packages[0].terms.length).toBeGreaterThan(0);
    expect((await pub(`/studios/test-studio/classes/${randomUUID()}`)).status).toBe(404);
    // Another studio's class isn't found through this studio's link.
    const other = await studio();
    await other.owner.call("PUT", "/booking-page", { slug: "other-studio", enabled: true });
    expect((await pub(`/studios/other-studio/classes/${id}`)).status).toBe(404);
  });

  it("lists packages on sale with their terms", async () => {
    const { s, save } = await setup();
    await save();
    await s.owner.call("POST", "/package-plans", { name: "Unlimited monthly", kind: "unlimited", billing: "recurring", validityValue: 1, validityUnit: "months", priceCents: 20000 });
    const off = (await s.owner.call("POST", "/package-plans", { name: "Old pack", kind: "credits", credits: 5, priceCents: 9000, validityValue: 1, validityUnit: "months" })).body;
    await db.update(packagePlans).set({ onSale: false }).where(eq(packagePlans.id, off.id));
    const r = await pub("/studios/test-studio/packages");
    expect(r.body.packages.map((p: { name: string }) => p.name)).toEqual(["Unlimited monthly"]);
    expect(r.body.packages[0]).toMatchObject({ billing: "recurring", price: "SGD 200.00", buyUrl: expect.stringMatching(/\/s\/test-studio\/packages\//) });
  });

  it("shows a day the studio is closed", async () => {
    const { s, save } = await setup();
    await save();
    const day = dayOffset(3);
    const c = await s.owner.call("POST", "/closures", { name: "Deepavali", startDate: day, endDate: day, message: "See you the day after!" });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const r = await pub(`/studios/test-studio/schedule?date=${day}&days=1`);
    expect(r.body.days[0].closed).toMatchObject({ name: "Deepavali", message: "See you the day after!" });
  });
});

describe("booking page: the widget", () => {
  it("serves the widget script, and any website can read the public timetable (only that)", async () => {
    const { s, save } = await setup();
    await save();
    const w = await pub("/widget.js");
    expect(w.status).toBe(200);
    expect(String(w.headers["content-type"])).toContain("javascript");
    expect(String(w.body)).toContain("data-studio-schedule");
    expect(String(w.body)).not.toContain("innerHTML");
    // Other websites may load it (a "same-origin" resource policy would block the script tag).
    expect(w.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    const fromSite = { origin: "https://www.somestudio.sg" };
    const sched = await pub("/studios/test-studio/schedule", fromSite);
    expect(sched.headers["access-control-allow-origin"]).toBe("*");
    expect(sched.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    // The rest of the API stays limited to the app's own origins.
    const res = await app.inject({ method: "GET", url: "/v1/booking-page", headers: { ...fromSite, authorization: `Bearer ${s.owner.token}` } });
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["access-control-allow-origin"]).not.toBe("https://www.somestudio.sg");
  });
});
