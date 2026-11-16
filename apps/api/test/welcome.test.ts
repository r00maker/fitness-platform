import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, classTypes, locations, memberships, organizations, packagePlans, rooms, users } from "../src/db/schema.js";
import { app, caller, db, hqStaff, outbox, person, pool, reset, tokenFor } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

async function newStudio() {
  const hq = await hqStaff("onboarding");
  const r = await hq.call("POST", "/platform/studios", { name: "Core & Flow", plan: "growth", owner: { email: "mei@example.com", firstName: "Mei", lastName: "Tan" } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const owner = { id: r.body.owner.id as string, call: caller(await tokenFor(r.body.owner.id, r.body.id)) };
  return { hq, orgId: r.body.id as string, moveId: r.body.moveId as string, owner };
}

const FULL = {
  tradingName: "Core & Flow", legalName: "Core and Flow Pte. Ltd.", uen: "201912345k", gstRegistered: false, address: "71 Tiong Bahru Rd, #01-02, Singapore 160071", phone: "+65 6123 4567", website: "coreandflow.sg", instagram: "@coreandflow",
  locations: [{ name: "Tiong Bahru", address: "71 Tiong Bahru Rd", rooms: ["Reformer room", "Mat room"] }, { name: "Robertson Quay", rooms: [] }],
  classTypeList: [{ name: "Reformer - Beginner", minutes: 50, capacity: 8 }, { name: "Mat Pilates", minutes: 45 }],
  packages: [{ name: "10 Class Pack", type: "pack", classes: 10, price: 280, validityValue: 3, validityUnit: "months" }, { name: "Unlimited Monthly", type: "membership", price: 189 }],
  team: [{ firstName: "Ana", lastName: "Lim", email: "ana@coreandflow.sg", role: "instructor" }, { firstName: "Kai", lastName: "Tan", email: "kai@coreandflow.sg", role: "admin" }],
  oldPlatform: "Momence", switchDate: "2026-12-01", activeClients: 2, dateFormat: "dmy", access: "staff_login", consent: true, contactName: "Mei Tan",
};

describe("the welcome page", () => {
  it("greets the owner on first sign-in with the form, filled in from what we know", async () => {
    const { owner, orgId } = await newStudio();
    const w = (await owner.call("GET", "/welcome")).body;
    expect(w).toMatchObject({ showWelcome: true, studio: { name: "Core & Flow", plan: "Growth", needsUen: true }, sent: null, unsentChanges: [] });
    expect(w.form).toMatchObject({ tradingName: "Core & Flow", locations: [{ name: "Core & Flow" }] });
    expect(w.missing).toEqual(expect.arrayContaining(["the registered business name", "your UEN", "your registered address"]));
    // Instructors don't see it (they're invited when the studio opens anyway).
    const ins = await person(orgId, "instructor", "Ben");
    expect((await ins.call("GET", "/welcome")).status).toBe(403);
    // Drafts save as you go and change nothing in the studio.
    expect((await owner.call("PUT", "/welcome", { legalName: "Core and Flow Pte. Ltd." })).body.form.legalName).toBe("Core and Flow Pte. Ltd.");
    expect((await db.select().from(organizations).where(eq(organizations.id, orgId)))[0]!.legalName).toBeNull();
  });

  it("send: checks it's complete, then fills the studio in; send updates: re-applies what changed", async () => {
    const { owner, orgId, hq, moveId } = await newStudio();
    const bad = await owner.call("POST", "/welcome/send", { ...FULL, uen: "12345" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/a UEN in the right format/);
    const noOk = await owner.call("POST", "/welcome/send", { ...FULL, consent: false });
    expect(noOk.body.error.message).toMatch(/your OK for us to move your clients' details/);

    const sent = await owner.call("POST", "/welcome/send", FULL);
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.setUp).toMatchObject({ locationsUpdated: 1, locationsAdded: 1, roomsAdded: 2, classTypesAdded: 2, packagesAdded: 2, teamAdded: 2 });
    expect(sent.body).toMatchObject({ sent: { at: expect.any(String) }, unsentChanges: [], progress: { status: "submitted" } });

    // The dashboard is filled in: business details, locations and rooms, classes, packages, team.
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org).toMatchObject({ legalName: "Core and Flow Pte. Ltd.", uen: "201912345K", gstNumber: null, address: "71 Tiong Bahru Rd, #01-02, Singapore 160071", website: "coreandflow.sg", instagram: "@coreandflow" });
    const locs = await db.select().from(locations).where(eq(locations.orgId, orgId));
    expect(locs.map((l) => l.name).sort()).toEqual(["Robertson Quay", "Tiong Bahru"]); // the first one was renamed, not duplicated
    expect((await db.select().from(rooms).where(eq(rooms.orgId, orgId))).map((r) => r.name).sort()).toEqual(["Mat room", "Reformer room"]);
    expect((await db.select().from(classTypes).where(eq(classTypes.orgId, orgId))).find((c) => c.name === "Reformer - Beginner")!.defaultDurationMinutes).toBe(50);
    const plans = await db.select().from(packagePlans).where(eq(packagePlans.orgId, orgId));
    expect(plans.map((p) => `${p.name}|${p.kind}|${p.credits}|${p.priceCents}|${p.billing}|${p.validityValue}${p.validityUnit}`).sort()).toEqual(["10 Class Pack|credits|10|28000|one_time|3months", "Unlimited Monthly|unlimited|null|18900|recurring|1months"]);
    const team = await db.select({ role: memberships.role, email: users.email }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, orgId));
    expect(team.map((t) => `${t.email}:${t.role}`).sort()).toEqual(["ana@coreandflow.sg:instructor", "kai@coreandflow.sg:admin", "mei@example.com:owner"]);
    expect(await outbox("staff.invite")).toHaveLength(1); // the owner's; the team is invited when the studio opens

    // Sending twice isn't a thing; updates are.
    expect((await owner.call("POST", "/welcome/send", FULL)).body.error.code).toBe("already_sent");
    expect((await owner.call("POST", "/welcome/update", FULL)).body.error.code).toBe("nothing_changed");
    const draft = (await owner.call("PUT", "/welcome", { phone: "+65 6999 0000" })).body;
    expect(draft.unsentChanges).toEqual(["About your business"]);
    const upd = await owner.call("POST", "/welcome/update", { packages: [...FULL.packages, { name: "Intro 3 for $45", classes: 3, price: 45, validityValue: 14, validityUnit: "days" }] });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body.changed).toEqual(["About your business", "What you sell"]);
    expect(upd.body.setUp).toMatchObject({ packagesAdded: 1, packagesUpdated: 2, locationsAdded: 0, teamAdded: 0 });
    expect((await db.select().from(organizations).where(eq(organizations.id, orgId)))[0]!.phone).toBe("+65 6999 0000");
    const log = (await db.select().from(auditLog).where(eq(auditLog.orgId, orgId))).map((a) => a.action);
    expect(log).toEqual(expect.arrayContaining(["studio.welcome_sent", "studio.welcome_updated", "studio.welcome_applied"]));

    // Our team sees when it was sent and updated.
    expect((await hq.call("GET", `/platform/studios/${orgId}/migrations/${moveId}`)).body.form).toMatchObject({ sentAt: expect.any(String), updatedAt: expect.any(String) });
  });

  it("the dashboard appears once the move is verified", async () => {
    const { owner, orgId, hq, moveId } = await newStudio();
    expect((await owner.call("POST", "/welcome/send", FULL)).status).toBe(200);
    const up = await owner.call("POST", "/welcome/files", { filename: "clients.csv", data: b64("Name,Email\nAna Lim,ana.lim@example.com\nBo Tan,bo@example.com\n") });
    expect(up.status).toBe(201);
    const base = `/platform/studios/${orgId}/migrations/${moveId}`;
    expect((await hq.call("POST", `${base}/check`, {})).body.ready).toBe(true);
    expect((await hq.call("POST", `${base}/import`, {})).status).toBe(200);
    expect((await owner.call("GET", "/welcome")).body).toMatchObject({ showWelcome: true, progress: { status: "imported", summary: { clients: 2 } } });
    expect((await hq.call("POST", `${base}/verify`, { checked: 2 })).body.studioLive).toBe(true);
    expect((await owner.call("GET", "/welcome")).body.showWelcome).toBe(false);
    expect((await db.select().from(organizations).where(eq(organizations.id, orgId)))[0]!.lifecycle).toBe("live");
  });

  it("a new studio with nothing to move only needs the studio's details", async () => {
    const { owner } = await newStudio();
    const r = await owner.call("POST", "/welcome/send", { tradingName: "Core & Flow", legalName: "Core and Flow LLP", uen: "T19LL1234A", address: "1 Keong Saik Rd", locations: [{ name: "Keong Saik", rooms: [] }], nothingToMove: true, switchDate: "2027-01-05" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.progress.nothingToMove).toBe(true);
    const gst = await owner.call("PUT", "/welcome", { gstRegistered: true });
    expect(gst.body.missing).toEqual(["your GST registration number"]);
  });
});

