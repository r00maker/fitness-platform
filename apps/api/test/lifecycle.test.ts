import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, classSessions, clientPackages, fees, organizations, orders, packageLedger } from "../src/db/schema.js";
import { renewDuePackages } from "../src/modules/packages/lifecycle.js";
import { app, dayOffset, db, minutesFromNow, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4000000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n%fake\n");

async function setup(orgSettings: Partial<typeof organizations.$inferInsert> = {}) {
  const s = await studio({ clientsNeedPackage: true });
  if (Object.keys(orgSettings).length) await db.update(organizations).set(orgSettings).where(eq(organizations.id, s.orgId));
  let hour = 7;
  const mk = async (extra: Record<string, unknown> = {}) =>
    (await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 5, durationMinutes: 50, date: dayOffset(3), startTime: `${String(hour++).padStart(2, "0")}:00`, acknowledge: ["unusual_start_time", "in_the_past", "possible_duplicate"], ...extra })).body.id as string;
  const plan = async (body: Record<string, unknown> = {}) => {
    const r = await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months", ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const sell = async (clientId: string, planId: string, extra: Record<string, unknown> = {}) => {
    const r = await s.owner.call("POST", `/clients/${clientId}/packages`, { planId, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const upload = (who: typeof s.owner, body: Buffer, purpose: string, type = "image/png") =>
    app.inject({ method: "POST", url: `/v1/files?purpose=${purpose}`, headers: { authorization: `Bearer ${who.token}`, "content-type": type }, payload: body }).then((r) => ({ status: r.statusCode, body: r.json() }));
  const history = async (who: typeof s.owner, id: string) => (await who.call("GET", `/client-packages/${id}`)).body;
  return { s, mk, plan, sell, upload, history };
}

describe("photos, descriptions and categories", () => {
  it("checks uploads by their contents and keeps attachments private", async () => {
    const { s, upload } = await setup();
    const photo = await upload(s.owner, PNG, "package_photo");
    expect(photo).toMatchObject({ status: 201, body: { contentType: "image/png", url: expect.stringMatching(/^\/v1\/files\//) } });
    // A text file pretending to be a PNG is refused.
    expect((await upload(s.owner, Buffer.from("not really a png"), "package_photo")).body.error.code).toBe("wrong_type");
    expect((await upload(s.owner, PDF, "package_photo", "application/pdf")).body.error.message).toBe("Photos need to be JPG, PNG or WebP.");
    expect((await upload(s.c1, PNG, "package_photo")).status).toBe(403);

    const note = await upload(s.c1, PDF, "extension_attachment", "application/pdf");
    expect(note.status).toBe(201);
    const get = (who: typeof s.owner) => app.inject({ method: "GET", url: note.body.url, headers: { authorization: `Bearer ${who.token}` } });
    expect((await get(s.c1)).headers["content-disposition"]).toMatch(/^attachment/);
    expect((await get(s.owner)).statusCode).toBe(200);
    expect((await get(s.c2)).statusCode).toBe(404);
  });

  it("groups the buying page by category, in the studio's order", async () => {
    const { s, plan, upload } = await setup();
    const photo = await upload(s.owner, PNG, "package_photo");
    const packs = (await s.owner.call("POST", "/package-categories", { name: "Class packs" })).body;
    const members = (await s.owner.call("POST", "/package-categories", { name: "Memberships" })).body;
    await plan({ name: "10-class pack", categoryId: packs.id, description: "Our most popular pack.", photoFileId: photo.body.id });
    await plan({ name: "Unlimited monthly", kind: "unlimited", credits: null, validityValue: 1, categoryId: members.id, billing: "recurring" });
    await plan({ name: "Trial class", credits: 1, priceCents: 2000 });
    await s.owner.call("PUT", "/package-categories/order", { ids: [members.id, packs.id] });
    const page = (await s.c1.call("GET", "/package-plans")).body.categories;
    expect(page.map((c: { name: string; packages: { name: string }[] }) => `${c.name}: ${c.packages.map((p) => p.name).join(", ")}`)).toEqual([
      "Memberships: Unlimited monthly",
      "Class packs: 10-class pack",
      "Other: Trial class",
    ]);
    expect(page[1].packages[0]).toMatchObject({ description: "Our most popular pack.", photoUrl: expect.stringMatching(/^\/v1\/files\//) });
    // Removing a category keeps its packages.
    await s.owner.call("DELETE", `/package-categories/${packs.id}`);
    expect((await s.c1.call("GET", "/package-plans")).body.categories.map((c: { name: string }) => c.name)).toEqual(["Memberships", "Other"]);
  });

  it("keeps a category's description and lets admins choose its packages and their order in one place", async () => {
    const { s, plan } = await setup();
    const packs = (await s.owner.call("POST", "/package-categories", { name: "Class packs", description: "Use them when it suits you." })).body;
    const intro = (await s.owner.call("POST", "/package-categories", { name: "Intro offers" })).body;
    expect(packs.description).toBe("Use them when it suits you.");
    const ten = await plan({ name: "10-class pack", categoryId: packs.id });
    const five = await plan({ name: "5-class pack", priceCents: 15000, categoryId: packs.id });
    const trial = await plan({ name: "Trial class", credits: 1, priceCents: 2000, categoryId: intro.id });
    const loose = await plan({ name: "Drop-in", credits: 1, priceCents: 3500 });

    // Admins see each category's packages; new packages go to the end of their category.
    const cats = (await s.owner.call("GET", "/package-categories")).body;
    expect(cats[0]).toMatchObject({ name: "Class packs", description: "Use them when it suits you.", packages: [{ name: "10-class pack" }, { name: "5-class pack" }] });
    expect((await s.c1.call("GET", "/package-categories")).body[0].packages).toBeUndefined();

    // Reorder, pull the trial class in from another category, and take the 10-class pack out.
    const r = await s.owner.call("PUT", `/package-categories/${packs.id}/packages`, { planIds: [trial.id, loose.id, five.id] });
    expect(r.body).toMatchObject({ moved: 3, removed: 1 });
    const page = (await s.c1.call("GET", "/package-plans")).body.categories;
    expect(page.map((c: { name: string; packages: { name: string }[] }) => `${c.name}: ${c.packages.map((p) => p.name).join(", ")}`)).toEqual([
      "Class packs: Trial class, Drop-in, 5-class pack",
      "Other: 10-class pack",
    ]);
    expect(page[0].description).toBe("Use them when it suits you.");

    // Descriptions can be changed or cleared.
    expect((await s.owner.call("PATCH", `/package-categories/${packs.id}`, { description: null })).body.description).toBeNull();

    // Only admins, only their own packages, each listed once.
    expect((await s.c1.call("PUT", `/package-categories/${packs.id}/packages`, { planIds: [] })).status).toBe(403);
    expect((await s.owner.call("PUT", `/package-categories/${packs.id}/packages`, { planIds: [five.id, five.id] })).status).toBe(400);
    expect((await s.owner.call("PUT", `/package-categories/${packs.id}/packages`, { planIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(404);
    // Moving a package into a category by editing it puts it at the end.
    await s.owner.call("PATCH", `/package-plans/${ten.id}`, { changes: { categoryId: packs.id }, applyTo: "new" });
    expect((await s.owner.call("GET", "/package-categories")).body[0].packages.map((p: { name: string }) => p.name)).toEqual(["Trial class", "Drop-in", "5-class pack", "10-class pack"]);
  });
});

describe("package history", () => {
  it("shows each class, whether they came, what happened to the class, when it started and the studio's changes", async () => {
    const { s, mk, plan, sell, history } = await setup();
    const p = await sell(s.c1.id, (await plan({ startsOn: "first_booking", activateWithinDays: 30 })).id);
    const attended = await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    const cancelled = await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    const noShow = await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    // Those two classes have now happened.
    for (const b of [attended, noShow]) await db.update(classSessions).set({ startsAt: new Date(Date.now() - 3 * 3_600_000), endsAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(classSessions.id, b.body.sessionId));
    await db.update(bookings).set({ attendance: "present" }).where(eq(bookings.id, attended.body.id));
    await db.update(bookings).set({ attendance: "no_show" }).where(eq(bookings.id, noShow.body.id));
    await s.c1.call("POST", `/bookings/${cancelled.body.id}/cancel`, {});
    await s.owner.call("POST", `/client-packages/${p.id}/adjust`, { credits: 1, reason: "Sorry about the cancelled class" });
    await s.owner.call("POST", `/client-packages/${p.id}/adjust`, { validUntil: dayOffset(120), reason: "Holiday" });

    const h = await history(s.c1, p.id);
    expect(h.activatedOn).toBe(dayOffset(0));
    expect(h.classes.map((c: { status: string; credit: string }) => `${c.status}: ${c.credit}`).sort()).toEqual(["Attended: 1 class used", "Cancelled: Class given back", "No-show: Class used (no-show)"]);
    expect(h.adjustmentsByStudio).toMatchObject([
      { title: "+1 class added", detail: "Sorry about the cancelled class", by: "The studio" },
      { title: expect.stringMatching(/^Expiry changed from .* to /), detail: "Holiday", by: "The studio" },
    ]);
    expect(h.changes.map((c: { kind: string }) => c.kind)).toEqual(["purchase", "activated", "adjusted", "expiry_changed"]);
    expect((await history(s.owner, p.id)).adjustmentsByStudio[0].by).toBe("You"); // the admin who made it
    expect((await s.c2.call("GET", `/client-packages/${p.id}`)).status).toBe(404);
  });
});

describe("extension requests", () => {
  it("reviewed by an admin, with a fee", async () => {
    const { s, plan, sell, upload, history } = await setup({ extensionFeeMode: "per_week", extensionFeeCents: 1000, extensionMaxDays: 30 });
    const p = await sell(s.c1.id, (await plan({})).id);
    const policy = (await s.c1.call("GET", "/me/packages")).body.extensions;
    expect(policy).toMatchObject({ allowed: true, maxDays: 30, fee: "SGD 10.00 per week added" });
    expect((await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 60, reason: "Knee injury" })).body.error.message).toBe("You can ask for up to 30 days at a time.");
    const note = await upload(s.c1, PDF, "extension_attachment", "application/pdf");
    const req = await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 10, reason: "Knee injury, physio says 10 days", attachmentFileId: note.body.id });
    expect(req.body).toMatchObject({ approvedAutomatically: false, request: { status: "pending", attachmentUrl: note.body.url } });
    expect((await outbox("extension.requested")).map((n) => n.userId)).toContain(s.owner.id);
    expect((await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 5, reason: "Again" })).body.error.code).toBe("already_requested");

    const list = (await s.owner.call("GET", "/extension-requests")).body;
    expect(list[0]).toMatchObject({ days: 10, feeIfApproved: "SGD 20.00", packageName: "10-class pack" });
    const ok = await s.owner.call("POST", `/extension-requests/${list[0].id}/approve`, {});
    expect(ok.body.request).toMatchObject({ status: "approved", daysGranted: 10, fee: "SGD 20.00" });
    expect(await db.select().from(fees).where(eq(fees.type, "package_extension"))).toHaveLength(1);
    expect((await history(s.c1, p.id)).changes.at(-1)).toMatchObject({ kind: "extended", title: expect.stringMatching(/^Extended by 10 days, to /) });
    expect(await outbox("extension.approved")).toHaveLength(2);
  });

  it("declines, requires documents when asked, and can be switched off", async () => {
    const { s, plan, sell } = await setup({ extensionAttachment: "required" });
    const p = await sell(s.c1.id, (await plan({})).id);
    expect((await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 7, reason: "Travelling" })).body.error.code).toBe("attachment_needed");
    await db.update(organizations).set({ extensionAttachment: "optional" }).where(eq(organizations.id, s.orgId));
    const r = await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 7, reason: "Travelling" });
    expect((await s.owner.call("POST", `/extension-requests/${r.body.request.id}/decline`, {})).status).toBe(400);
    expect((await s.owner.call("POST", `/extension-requests/${r.body.request.id}/decline`, { note: "Travel isn't covered, sorry." })).body.status).toBe("declined");
    await db.update(organizations).set({ extensionMode: "off" }).where(eq(organizations.id, s.orgId));
    expect((await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 7, reason: "Travelling" })).body.error.code).toBe("extensions_off");
    const forever = await sell(s.c2.id, (await plan({ name: "Forever pack", validityValue: null, validityUnit: null })).id);
    await db.update(organizations).set({ extensionMode: "review" }).where(eq(organizations.id, s.orgId));
    expect((await s.c2.call("POST", `/client-packages/${forever.id}/extension-requests`, { days: 7, reason: "x y z" })).body.error.code).toBe("never_expires");
  });

  it("approves short requests automatically, once per package", async () => {
    const { s, plan, sell } = await setup({ extensionMode: "auto", extensionAutoDays: 14 });
    const p = await sell(s.c1.id, (await plan({})).id);
    const first = await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 14, reason: "Flu" });
    expect(first.body).toMatchObject({ approvedAutomatically: true, request: { status: "approved", autoApproved: true } });
    const second = await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 7, reason: "Flu again" });
    expect(second.body).toMatchObject({ approvedAutomatically: false, request: { status: "pending" } });
  });
});

describe("rolling classes over", () => {
  it("staff can roll unused classes into a new package, within the studio's limits", async () => {
    const { s, plan, sell, history } = await setup();
    const pl = (await plan({})).id;
    const old = await sell(s.c1.id, pl);
    const fresh = await sell(s.c1.id, pl);
    expect((await s.owner.call("POST", `/client-packages/${fresh.id}/rollover`, { fromPackageId: old.id })).body.error.code).toBe("rollover_off");
    await db.update(organizations).set({ rolloverMode: "staff", rolloverMaxCredits: 4, rolloverWithinDays: 30 }).where(eq(organizations.id, s.orgId));
    expect((await s.owner.call("POST", `/client-packages/${fresh.id}/rollover`, { fromPackageId: old.id, credits: 5 })).body.error.message).toBe("Up to 4 classes can roll over from 10-class pack.");
    // An expired pack still counts, within 30 days of ending.
    await db.update(clientPackages).set({ expiresAt: new Date(Date.now() - 5 * 86_400_000) }).where(eq(clientPackages.id, old.id));
    expect((await s.owner.call("POST", `/client-packages/${fresh.id}/rollover`, { fromPackageId: old.id })).body).toMatchObject({ rolledOver: 4 });
    expect((await history(s.c1, fresh.id)).changes.at(-1).title).toBe("+4 classes rolled over from 10-class pack");
    expect((await history(s.c1, old.id)).changes.at(-1).title).toBe("4 classes rolled over to 10-class pack");
    expect((await s.c1.call("POST", `/client-packages/${fresh.id}/rollover`, { fromPackageId: old.id })).status).toBe(403);
    const other = await sell(s.c2.id, pl);
    expect((await s.owner.call("POST", `/client-packages/${other.id}/rollover`, { fromPackageId: old.id })).body.error.code).toBe("different_owner");
  });
});

describe("checkout", () => {
  it("quotes, takes an order, and becomes a package once paid at the desk", async () => {
    const { s, plan, sell } = await setup({ rolloverMode: "clients" });
    const pl = await plan({ description: "Ten classes, any time." });
    const old = await sell(s.c1.id, pl.id);
    const quote = await s.c1.call("GET", `/checkout/quote?planId=${pl.id}&rolloverFromPackageId=${old.id}`);
    expect(quote.body).toMatchObject({
      package: { name: "10-class pack", description: "Ten classes, any time.", terms: ["10 classes", "Valid for 3 months from the day it's bought"] },
      total: "SGD 280.00",
      startDate: { earliest: dayOffset(0) },
      rolloverOptions: [{ packageId: old.id, classes: 10 }],
      payments: { online: false },
    });
    expect(quote.body.lines[1].label).toBe("10 unused classes from 10-class pack");
    const order = await s.c1.call("POST", "/checkout", { planId: pl.id, rolloverFromPackageId: old.id });
    expect(order.body).toMatchObject({ order: { status: "pending", total: "SGD 280.00" }, payment: { online: false } });
    expect((await s.c1.call("POST", `/orders/${order.body.order.id}/mark-paid`, {})).status).toBe(403);
    expect((await s.owner.call("GET", "/orders")).body[0]).toMatchObject({ clientName: expect.stringMatching(/^Chloe/), packageName: "10-class pack" });
    const paid = await s.owner.call("POST", `/orders/${order.body.order.id}/mark-paid`, {});
    expect(paid.body.status).toBe("paid");
    const mine = (await s.c1.call("GET", "/me/packages")).body.packages;
    expect(mine.map((p: { creditsLeft: number }) => p.creditsLeft).sort((a: number, b: number) => a - b)).toEqual([0, 20]);
    expect((await s.owner.call("GET", `/checkout/quote?planId=${pl.id}`)).status).toBe(403);
  });
});

describe("editing package types", () => {
  it("new sales only, existing packages only, or both, with warnings", async () => {
    const { s, mk, plan, sell } = await setup();
    const pl = await plan({});
    const a = await sell(s.c1.id, pl.id);
    await s.c1.call("POST", "/bookings", { sessionId: await mk() });

    // New sales only: Chloe's pack is untouched.
    await s.owner.call("PATCH", `/package-plans/${pl.id}`, { changes: { credits: 12 }, applyTo: "new" });
    expect((await s.c1.call("GET", "/me/packages")).body.packages[0]).toMatchObject({ creditsTotal: 10, creditsLeft: 9 });
    expect((await sell(s.c2.id, pl.id)).creditsTotal).toBe(12);

    // Existing too: asks first, then adds the difference and tells the client.
    const ask = await s.owner.call("PATCH", `/package-plans/${pl.id}`, { changes: { credits: 14, weeklyLimit: 3 }, applyTo: "both" });
    expect(ask.body.error.flags[0]).toMatchObject({ code: "existing_packages_affected", message: expect.stringMatching(/^This changes 2 packages clients already have: \+2 classes on each package; up to 3 classes a week\./) });
    const done = await s.owner.call("PATCH", `/package-plans/${pl.id}`, { changes: { credits: 14, weeklyLimit: 3 }, applyTo: "both", acknowledge: ["existing_packages_affected"] });
    expect(done.body).toMatchObject({ credits: 14, weeklyLimit: 3, packagesChanged: 2 });
    expect((await s.c1.call("GET", "/me/packages")).body.packages[0]).toMatchObject({ creditsTotal: 12, creditsLeft: 11 });
    expect(await outbox("package.updated")).toHaveLength(4);

    // Shorter validity for existing packages only, which would end some straight away.
    await db.update(clientPackages).set({ startedAt: new Date(Date.now() - 40 * 86_400_000) }).where(eq(clientPackages.id, a.id));
    const shorten = await s.owner.call("PATCH", `/package-plans/${pl.id}`, { changes: { validityValue: 30, validityUnit: "days" }, applyTo: "existing", acknowledge: ["existing_packages_affected"] });
    expect(shorten.body.error.flags.map((f: { code: string }) => f.code)).toContain("packages_would_expire");
    const after = await s.owner.call("PATCH", `/package-plans/${pl.id}`, { changes: { validityValue: 30, validityUnit: "days" }, applyTo: "existing", acknowledge: ["existing_packages_affected", "packages_would_expire"] });
    expect(after.body).toMatchObject({ validityValue: 3, validityUnit: "months" }); // the package type itself is unchanged
    expect((await s.c1.call("GET", "/me/packages")).body.packages[0].state).toBe("expired");
  });
});

describe("archiving and deleting", () => {
  it("archives (hidden, still working) and suggests old, unused types", async () => {
    const { s, mk, plan, sell } = await setup();
    const pl = await plan({});
    const p = await sell(s.c1.id, pl.id);
    const unused = await plan({ name: "Old intro offer", onSale: false });
    const list = (await s.owner.call("GET", "/package-plans")).body;
    expect(list.find((x: { id: string }) => x.id === unused.id).usage).toMatchObject({ clientsUsing: 0, suggestArchive: true });
    expect(list.find((x: { id: string }) => x.id === pl.id).usage).toMatchObject({ clientsUsing: 1, suggestArchive: false });

    await s.owner.call("POST", `/package-plans/${pl.id}/archive`, {});
    expect((await s.owner.call("GET", "/package-plans")).body.map((x: { name: string }) => x.name)).toEqual(["Old intro offer"]);
    expect((await s.owner.call("GET", "/package-plans?archived=true")).body[0].name).toBe("10-class pack");
    expect((await s.owner.call("POST", `/clients/${s.c2.id}/packages`, { planId: pl.id })).body.error.message).toMatch(/has been archived/);
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk() })).body.clientPackageId).toBe(p.id);
    await s.owner.call("POST", `/package-plans/${pl.id}/restore`, {});
  });

  it("deletes completely, only after typing the name; bookings stay without the link", async () => {
    const { s, mk, plan, sell } = await setup();
    const pl = await plan({ name: "Summer pack" });
    const p = await sell(s.c1.id, pl.id);
    const b = await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    expect((await s.c1.call("DELETE", `/package-plans/${pl.id}`, { confirmName: "Summer pack" })).status).toBe(403);
    expect((await s.owner.call("DELETE", `/package-plans/${pl.id}`, { confirmName: "Summer" })).body.error.message).toBe("Type “Summer pack” exactly to confirm.");
    expect((await s.owner.call("DELETE", `/package-plans/${pl.id}`, { confirmName: "summer pack" })).body).toEqual({ deleted: "Summer pack", clientPackagesDeleted: 1 });
    expect((await s.c1.call("GET", "/me/packages")).body.packages).toEqual([]);
    expect(await db.select().from(packageLedger).where(eq(packageLedger.packageId, p.id))).toEqual([]);
    const [kept] = await db.select().from(bookings).where(eq(bookings.id, b.body.id));
    expect(kept).toMatchObject({ status: "confirmed", clientPackageId: null });
  });
});

describe("recurring packages", () => {
  it("renews each period with a fresh set of classes, carrying some over, until stopped", async () => {
    const { s, plan, sell, history } = await setup();
    expect((await s.owner.call("POST", "/package-plans", { name: "X", kind: "credits", credits: 8, billing: "recurring" })).body.error.fields).toMatchObject({ validityValue: "How often does it renew? e.g. every 1 month." });
    const pl = await plan({ name: "8 a month", credits: 8, validityValue: 1, validityUnit: "months", billing: "recurring", rolloverCap: 2, commitmentCycles: 3, priceCents: 22000 });
    expect(pl.terms).toEqual(["8 classes every month", "Renews every month until it's cancelled", "Up to 2 unused classes carry over to the next month", "Minimum term of 3 months"]);
    const p = await sell(s.c1.id, pl.id);
    expect(p).toMatchObject({ billing: "recurring", renewal: { period: 1, stopped: false, commitmentUntil: expect.any(String) } });

    // Period ends with 5 classes unused: 2 carry over, so the new period has 10.
    await db.update(clientPackages).set({ creditsLeft: 5, expiresAt: new Date(Date.now() - 1000) }).where(eq(clientPackages.id, p.id));
    expect(await renewDuePackages(db)).toBe(1);
    const renewed = (await s.c1.call("GET", "/me/packages")).body.packages[0];
    expect(renewed).toMatchObject({ state: "active", creditsLeft: 10, renewal: { period: 2 } });
    expect((await history(s.c1, p.id)).changes.find((c: { kind: string }) => c.kind === "renewed").title).toBe("Renewed: period 2, 10 classes (2 carried over)");
    expect(await db.select().from(orders).where(eq(orders.clientPackageId, p.id))).toHaveLength(1);
    expect(await outbox("package.renewed")).toHaveLength(2);

    // Stopping during the minimum term: it runs to the end of month 3.
    const stop = await s.c1.call("POST", `/client-packages/${p.id}/stop-renewing`, { reason: "Moving away" });
    expect(stop.body).toMatchObject({ commitmentApplies: true });
    expect((await s.c1.call("GET", "/me/packages")).body.packages[0].renewal).toMatchObject({ stopped: true, renewsOn: null, endsOn: stop.body.endsOn });
    expect(await outbox("package.stopped")).toHaveLength(2);
    expect((await s.c1.call("POST", `/client-packages/${p.id}/extension-requests`, { days: 7, reason: "Holiday" })).body.error.code).toBe("recurring");
  });
});

describe("leaving a membership early", () => {
  it("runs to the end of the minimum term, or ends early with the studio's fee", async () => {
    const { s, plan, sell } = await setup();
    expect((await s.owner.call("POST", "/package-plans", { name: "X", kind: "unlimited", validityValue: 1, validityUnit: "months", billing: "recurring", earlyCancelFeeMode: "flat" })).body.error.fields).toMatchObject({
      earlyCancelFeeMode: "An early cancellation fee needs a recurring package with a minimum term.",
    });
    const flat = await plan({ name: "Unlimited", kind: "unlimited", credits: null, billing: "recurring", validityValue: 1, validityUnit: "months", commitmentCycles: 6, earlyCancelFeeMode: "flat", earlyCancelFeeCents: 9000, priceCents: 30000 });
    expect(flat.terms).toEqual(["Unlimited classes", "Renews every month until it's cancelled", "Minimum term of 6 months", "Leaving before then: SGD 90.00 early cancellation fee"]);
    const p = await sell(s.c1.id, flat.id);
    const options = (await s.c1.call("GET", `/client-packages/${p.id}/stop-options`)).body;
    expect(options).toMatchObject({ inMinimumTerm: true, endEarly: { allowed: true, fee: "SGD 90.00", periodsLeft: 5 } });
    expect(options.stopAtEndOfTerm.endsOn > options.endEarly.endsOn).toBe(true);
    const early = await s.c1.call("POST", `/client-packages/${p.id}/stop-renewing`, { endEarly: true, reason: "Moving overseas" });
    expect(early.body).toMatchObject({ endedEarly: true, fee: "SGD 90.00", endsOn: options.endEarly.endsOn });
    expect(await db.select().from(fees).where(eq(fees.type, "early_cancellation"))).toMatchObject([{ amountCents: 9000, status: "pending" }]);
    // Changing their mind: the membership carries on and the fee goes.
    await s.c1.call("POST", `/client-packages/${p.id}/resume-renewing`, {});
    expect((await db.select().from(fees).where(eq(fees.type, "early_cancellation")))[0]!.status).toBe("waived");
  });

  it("charges the rest of the term, or doesn't allow leaving early", async () => {
    const { s, plan, sell } = await setup();
    const rest = await plan({ name: "8 a month", credits: 8, billing: "recurring", validityValue: 1, validityUnit: "months", commitmentCycles: 3, earlyCancelFeeMode: "remaining", priceCents: 20000 });
    expect(rest.terms).toContain("Leaving before then: the rest of the minimum term is charged");
    const a = await sell(s.c1.id, rest.id);
    expect((await s.c1.call("GET", `/client-packages/${a.id}/stop-options`)).body.endEarly).toMatchObject({ fee: "SGD 400.00", periodsLeft: 2 });
    // Admins can waive it.
    expect((await s.owner.call("POST", `/client-packages/${a.id}/stop-renewing`, { endEarly: true, feeCents: 0 })).body).toMatchObject({ endedEarly: true, fee: null });

    const locked = await plan({ name: "Locked", kind: "unlimited", credits: null, billing: "recurring", validityValue: 3, validityUnit: "months", commitmentCycles: 4 });
    expect(locked.terms).toContain("Minimum term of 12 months (4 periods)");
    const b = await sell(s.c2.id, locked.id);
    expect((await s.c2.call("GET", `/client-packages/${b.id}/stop-options`)).body.endEarly).toMatchObject({ allowed: false, fee: null });
    expect((await s.c2.call("POST", `/client-packages/${b.id}/stop-renewing`, { endEarly: true })).body.error.code).toBe("early_cancel_not_allowed");
    expect((await s.c2.call("POST", `/client-packages/${b.id}/stop-renewing`, {})).body).toMatchObject({ endedEarly: false, commitmentApplies: true });
  });
});

describe("staff pay details", () => {
  it("shows current rates, history, upcoming changes and this period", async () => {
    const { s } = await setup();
    await s.owner.call("POST", "/pay-rates", { staffId: s.ana.id, type: "per_class", amountCents: 4000, effectiveFrom: dayOffset(-90) });
    await s.owner.call("POST", "/pay-rates", { staffId: s.ana.id, type: "per_class", amountCents: 4500, effectiveFrom: dayOffset(-10) });
    await s.owner.call("POST", "/pay-rates", { staffId: s.ana.id, type: "per_class", amountCents: 5000, effectiveFrom: dayOffset(20) });
    const pay = await s.owner.call("GET", `/staff/${s.ana.id}/pay`);
    expect(pay.body.current.map((r: { description: string }) => r.description)).toEqual(["SGD 45.00 per class"]);
    expect(pay.body.history).toHaveLength(3);
    expect(pay.body.upcoming).toMatchObject([{ description: "SGD 50.00 per class", effectiveFrom: dayOffset(20) }]);
    expect((await s.ana.call("GET", `/staff/${s.ana.id}/pay`)).status).toBe(403);
    void minutesFromNow;
  });
});
