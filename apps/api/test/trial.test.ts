import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { classSessions, memberships, notifications, organizations, users } from "../src/db/schema.js";
import { notify } from "../src/modules/notifications/outbox.js";
import { app, caller, config, db, hqStaff, pool, reset } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

/** Someone who has signed in (their email confirmed) but has no studio yet. */
async function newcomer(email = `owner.${randomUUID().slice(0, 6)}@studio.sg`) {
  const id = randomUUID();
  const token = await new SignJWT({ email, email_verified: true }).setProtectedHeader({ alg: "HS256" }).setSubject(id).setExpirationTime("1h").sign(new TextEncoder().encode(config.AUTH_DEV_SECRET!));
  const post = (body: unknown) => app.inject({ method: "POST", url: "/v1/trials", headers: { authorization: `Bearer ${token}` }, payload: body as object });
  return { id, token, post };
}
const body = (extra: Record<string, unknown> = {}) => ({ kind: "new", plan: "growth", studioName: "Breathe Pilates", firstName: "Olivia", lastName: "Tan", acceptTerms: true, ...extra });
/** The new owner, calling their own studio. */
async function asOwner(userId: string, orgId: string) {
  const t = await new SignJWT({ org: orgId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("1h").sign(new TextEncoder().encode(config.AUTH_DEV_SECRET!));
  return caller(t);
}

describe("starting a free trial", () => {
  it("makes a studio on the chosen plan, for 14 days, with them as owner; one trial per person", async () => {
    const terms = (await app.inject({ method: "GET", url: "/v1/public/trial" })).json();
    expect(terms).toMatchObject({ days: 14, terms: expect.arrayContaining([expect.stringMatching(/competing product/)]) });

    const me = await newcomer();
    expect((await me.post(body({ acceptTerms: false }))).statusCode).toBe(400);
    const r = await me.post(body());
    expect(r.statusCode, r.body).toBe(201);
    const out = r.json();
    expect(out.trial).toMatchObject({ onTrial: true, state: "active", kind: "new", plan: "growth", daysLeft: 14, clients: { used: 0, max: 25 }, notIncluded: ["Taking payments", "WhatsApp", "More than 25 clients"] });
    const owner = await asOwner(me.id, out.orgId);
    expect((await owner("GET", "/trial")).body).toMatchObject({ onTrial: true, message: "14 days left in your free trial of Growth." });
    const [org] = await db.select().from(organizations).where(eq(organizations.id, out.orgId));
    expect(org).toMatchObject({ plan: "growth", lifecycle: "live", trialKind: "new", trialTermsVersion: "2026-11" });

    // One trial per person.
    const again = await me.post(body({ studioName: "Second Studio" }));
    expect(again.json().error.code).toBe("trial_used");
  });

  it("refuses throwaway email addresses", async () => {
    const r = await (await newcomer("someone@mailinator.com")).post(body());
    expect(r.json().error).toMatchObject({ code: "email_disposable" });
  });
});

describe("what a trial can't do", () => {
  it("no payments, no WhatsApp, no data move, and up to 25 clients", async () => {
    const me = await newcomer();
    const { orgId } = (await me.post(body())).json();
    const owner = await asOwner(me.id, orgId);
    expect((await owner("POST", "/payments/connect", {})).body.error).toMatchObject({ code: "trial_limit", message: expect.stringMatching(/when you start your plan/) });
    expect((await owner("PATCH", "/whatsapp/settings", { enabled: true })).body.error).toMatchObject({ code: "trial_limit" });
    const hq = await hqStaff("onboarding");
    expect((await hq.call("POST", `/platform/studios/${orgId}/migrations`, {})).body.error).toMatchObject({ code: "trial_limit" });

    // 25 clients, then the 26th can't join.
    for (let i = 0; i < 25; i++) {
      const [u] = await db.insert(users).values({ firstName: "C", lastName: `${i}`, email: `c${i}.${orgId.slice(0, 4)}@example.com` }).returning();
      await db.insert(memberships).values({ orgId, userId: u!.id, role: "client" });
    }
    const joiner = await newcomer();
    const join = await app.inject({ method: "POST", url: "/v1/join", headers: { authorization: `Bearer ${joiner.token}`, "x-studio-id": orgId }, payload: { firstName: "Late", lastName: "Comer" } });
    expect(join.json().error).toMatchObject({ code: "trial_client_limit" });
  });

  it("is read-only once it ends, until our team extends it or it starts its plan", async () => {
    const me = await newcomer();
    const { orgId } = (await me.post(body())).json();
    const owner = await asOwner(me.id, orgId);
    await db.update(organizations).set({ trialEndsAt: new Date(Date.now() - 1000) }).where(eq(organizations.id, orgId));
    expect((await owner("GET", "/trial")).body).toMatchObject({ state: "ended", message: expect.stringMatching(/has ended/) });
    expect((await owner("POST", "/class-types", { name: "Barre", color: "#DB2777" })).body.error).toMatchObject({ code: "trial_ended" });
    expect((await owner("GET", "/class-types")).status).toBe(200);

    // They can still ask to start their plan.
    const ask = await owner("POST", "/trial/start-plan", { plan: "signature" });
    expect(ask.status).toBe(200);
    expect(ask.body.planRequest).toMatchObject({ plan: "signature" });
    expect(ask.body.next).toMatch(/switch payments on/);

    const hq = await hqStaff("onboarding");
    const list = (await hq.call("GET", "/platform/trials")).body;
    expect(list.groups).toMatchObject({ new: 1, existing: 0, askedToStart: 1 });
    expect((await hq.call("POST", `/platform/studios/${orgId}/trial`, { action: "extend", days: 7 })).body).toMatchObject({ state: "active", daysLeft: 7 });
    expect((await owner("POST", "/class-types", { name: "Barre", color: "#DB2777" })).status).toBe(201);

    // Converted: the limits lift (here Stripe simply isn't set up in tests).
    expect((await hq.call("POST", `/platform/studios/${orgId}/trial`, { action: "convert" })).body).toMatchObject({ onTrial: false });
    expect((await owner("POST", "/payments/connect", {})).body.error.code).not.toBe("trial_limit");
  });
});

describe("the test studio for studios already on another system", () => {
  it("comes with sample classes and clients, no booking page, and sends nothing", async () => {
    const me = await newcomer();
    const r = await me.post(body({ kind: "existing", plan: "signature", studioName: "Harbour Yoga" }));
    expect(r.statusCode, r.body).toBe(201);
    const { orgId, slug, trial } = r.json();
    expect(trial).toMatchObject({ kind: "existing", notIncluded: expect.arrayContaining(["Moving your data", "Your booking page"]) });
    const [s] = await db.select({ n: count() }).from(classSessions).where(eq(classSessions.orgId, orgId));
    expect(Number(s!.n)).toBe(84);
    const [c] = await db.select({ n: count() }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client")));
    expect(Number(c!.n)).toBe(12);

    // No public page, even if switched on.
    await db.update(organizations).set({ bookingPageEnabled: true }).where(eq(organizations.id, orgId));
    expect((await app.inject({ method: "GET", url: `/v1/public/studios/${slug}` })).statusCode).toBe(404);
    // Nothing goes out to the sample people.
    const [client] = await db.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client")));
    await notify(db, { orgId, userIds: [client!.id], template: "booking.confirmed", data: {} });
    expect(await db.select().from(notifications).where(eq(notifications.orgId, orgId))).toHaveLength(0);

    // It isn't the real studio: that's set up (and the data moved) as usual.
    const hq = await hqStaff("onboarding");
    expect((await hq.call("POST", `/platform/studios/${orgId}/trial`, { action: "convert" })).body.error).toMatchObject({ code: "sandbox" });
    const ask = await (await asOwner(me.id, orgId))("POST", "/trial/start-plan", { plan: "signature" });
    expect(ask.body.next).toMatch(/set up your real studio and move your data/);
  });
});
