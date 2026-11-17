import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, locations, memberships, notifications, organizations } from "../src/db/schema.js";
import { app, db, hqStaff, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const newStudio = { name: "Core & Flow", plan: "growth", owner: { email: "Mei@Example.com", firstName: "Mei", lastName: "Tan" } };

describe("HQ", () => {
  it("is only for our team, by role", async () => {
    const s = await studio();
    expect((await app.inject({ method: "GET", url: "/v1/platform/me" })).statusCode).toBe(401);
    expect((await s.owner.call("GET", "/platform/overview")).status).toBe(404); // a studio sign-in can't see HQ
    const support = await hqStaff("support", "Sam");
    const me = (await support.call("GET", "/platform/me")).body;
    expect(me).toMatchObject({ role: "support", can: { view: true, supportAccess: true, manageStudios: false, migrations: false, manageStaff: false } });
    expect((await support.call("POST", "/platform/studios", newStudio)).status).toBe(403);
    expect((await support.call("GET", "/platform/staff")).status).toBe(403);
    const owner = await hqStaff("owner", "Olu");
    expect((await owner.call("GET", "/platform/staff")).body.staff).toHaveLength(2);
  });

  it("creates a studio with its plan, first location and an invite for the owner", async () => {
    const hq = await hqStaff("onboarding");
    expect((await hq.call("POST", "/platform/studios", { ...newStudio, owner: { firstName: "Mei" } })).status).toBe(400);
    const res = await hq.call("POST", "/platform/studios", newStudio);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ name: "Core & Flow", plan: "growth", lifecycle: "onboarding", owner: { email: "mei@example.com" } });
    const id = res.body.id;
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    expect(org).toMatchObject({ plan: "growth", lifecycle: "onboarding", studioType: "boutique", timezone: "Asia/Singapore", currency: "SGD", spotBookingEnabled: true });
    expect(org!.setupDoneAt).not.toBeNull();
    expect((await db.select().from(locations).where(eq(locations.orgId, id))).map((l) => l.name)).toEqual(["Core & Flow"]);
    const [m] = await db.select().from(memberships).where(eq(memberships.orgId, id));
    expect(m!.role).toBe("owner");
    const invite = await db.select().from(notifications).where(and(eq(notifications.orgId, id), eq(notifications.template, "staff.invite")));
    expect(invite).toHaveLength(1);
    expect(invite[0]!.data).toMatchObject({ studioName: "Core & Flow", invitedBy: "Our team", roleLabel: "owner" });
    const log = await db.select().from(auditLog).where(and(eq(auditLog.orgId, id), eq(auditLog.action, "studio.created")));
    expect(log[0]!.actorId).toBe(hq.id);

    // It shows in the list and the detail, with notes and its lifecycle.
    const list = (await hq.call("GET", "/platform/studios?lifecycle=onboarding")).body.studios;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Core & Flow", planLabel: "Growth", price: "SGD 399", locations: 1, clients: 0 });
    expect((await hq.call("POST", `/platform/studios/${id}/notes`, { kind: "call", body: "Kick-off call: moving from Momence on 1 Dec." })).status).toBe(201);
    const detail = (await hq.call("GET", `/platform/studios/${id}`)).body;
    expect(detail.studio).toMatchObject({ name: "Core & Flow", lifecycle: "onboarding" });
    expect(detail.plan).toMatchObject({ label: "Growth" });
    expect(detail.team.map((t: { firstName: string; role: string }) => `${t.firstName}:${t.role}`)).toEqual(["Mei:owner"]);
    expect(detail.notes[0]).toMatchObject({ kind: "call", body: "Kick-off call: moving from Momence on 1 Dec." });
    expect(detail.recentActivity.map((a: { action: string }) => a.action)).toContain("studio.created");
    expect((await hq.call("PATCH", `/platform/studios/${id}`, { lifecycle: "live" })).body.lifecycle).toBe("live");
  });

  it("support access: client details only while open, with a reason the studio can see and end", async () => {
    const s = await studio();
    const hq = await hqStaff("support", "Sam");
    const blocked = await hq.call("GET", `/platform/studios/${s.orgId}/clients`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toMatch(/Start support access for this studio first/);
    expect((await hq.call("POST", `/platform/studios/${s.orgId}/support-access`, { reason: "hi" })).status).toBe(400);
    const open = await hq.call("POST", `/platform/studios/${s.orgId}/support-access`, { reason: "Owner asked why Chloe can't book Saturday", minutes: 30 });
    expect(open.status).toBe(201);
    expect((await hq.call("POST", `/platform/studios/${s.orgId}/support-access`, { reason: "Again please" })).body.error.code).toBe("already_open");

    const clients = (await hq.call("GET", `/platform/studios/${s.orgId}/clients`)).body.clients;
    expect(clients.length).toBe(3);
    expect(clients[0]).toHaveProperty("email");

    // The studio sees it, and can end it.
    const seen = (await s.owner.call("GET", "/support-access")).body.sessions;
    expect(seen[0]).toMatchObject({ reason: "Owner asked why Chloe can't book Saturday", active: true });
    expect(seen[0].who).toMatch(/\(our support team\)$/);
    const actions = (await db.select().from(auditLog).where(eq(auditLog.orgId, s.orgId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["support_access.started", "support_access.viewed_clients"]));
    expect((await s.ana.call("GET", "/support-access")).status).toBe(403);
    expect((await s.owner.call("POST", `/support-access/${open.body.id}/end`, {})).body.ended).toBe(true);
    expect((await hq.call("GET", `/platform/studios/${s.orgId}/clients`)).status).toBe(403);
  });

  it("overview and health: what needs us, and what live studios would pay", async () => {
    const s = await studio(); // a live studio on Signature, 1 location, no bookings this week
    const hq = await hqStaff("owner");
    await hq.call("POST", "/platform/studios", newStudio); // onboarding: not counted in monthly revenue
    await db.insert(notifications).values(Array.from({ length: 5 }, () => ({ orgId: s.orgId, channel: "email" as const, template: "x", data: {}, status: "failed" as const })));
    const o = (await hq.call("GET", "/platform/overview")).body;
    expect(o.studios).toMatchObject({ total: 2, byLifecycle: { live: 1, onboarding: 1 }, byPlan: { signature: 1, growth: 1 } });
    expect(o.mrr).toMatchObject({ cents: 79900, display: "SGD 799" });
    expect(o.mrr.note).toMatch(/Billing isn't connected yet/);
    const flagged = o.needsAttention.find((x: { orgId: string }) => x.orgId === s.orgId);
    expect(flagged.status).toBe("problem");
    expect(flagged.signals).toEqual(expect.arrayContaining(["5 messages failed to send in the last 7 days", "No bookings in the last 7 days"]));
    expect(o.onboarding.map((x: { name: string; plan: string }) => `${x.name} (${x.plan})`)).toEqual(["Core & Flow (Growth)"]);
  });
});
