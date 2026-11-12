import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { describePackage } from "@studio/shared";
import { bookings, classTypes, clientPackages, fees, organizations } from "../src/db/schema.js";
import { app, dayOffset, db, minutesFromNow, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

type Opt = { id: string; usable: boolean; reason: string | null; name: string };

async function setup() {
  const s = await studio({ clientsNeedPackage: true });
  let hour = 7;
  const mk = async (extra: Record<string, unknown> = {}) =>
    (
      await s.owner.call("POST", "/sessions", {
        classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 5, durationMinutes: 50,
        date: dayOffset(3), startTime: `${String(hour++).padStart(2, "0")}:00`, acknowledge: ["unusual_start_time", "far_future"], ...extra,
      })
    ).body.id as string;
  const plan = async (body: Record<string, unknown>) => {
    const r = await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 25000, validityValue: 3, validityUnit: "months", ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const sell = async (clientId: string, planId: string, extra: Record<string, unknown> = {}) => {
    const r = await s.owner.call("POST", `/clients/${clientId}/packages`, { planId, ...extra });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const mine = async (c: typeof s.c1) => (await c.call("GET", "/me/packages")).body.packages;
  return { s, mk, plan, sell, mine };
}

describe("package types", () => {
  it("describes the terms in plain English", async () => {
    const { plan } = await setup();
    expect((await plan({})).terms).toEqual(["10 classes", "Valid for 3 months from the day it's bought"]);
    expect(
      describePackage({ kind: "credits", credits: 5, validityValue: 60, validityUnit: "days", startsOn: "first_booking", activateWithinDays: 30, maxUsers: 3, sharingMode: "pool" }, ["Reformer Pilates", "Barre"]),
    ).toEqual([
      "5 classes",
      "Valid for 60 days from the first booking",
      "Book the first class within 30 days of buying, or it expires",
      "Up to 3 people can share it, using one pool of credits",
      "Reformer Pilates and Barre only",
    ]);
    expect(describePackage({ kind: "unlimited", validityValue: 1, validityUnit: "months", startsOn: "purchase", maxUsers: 2, weeklyLimit: 4 })).toEqual([
      "Unlimited classes",
      "Up to 4 classes a week",
      "Valid for 1 month from the day it's bought",
      "Up to 2 people can share it, each with unlimited classes",
    ]);
  });

  it("explains settings that don't fit together", async () => {
    const { s } = await setup();
    const bad = async (body: Record<string, unknown>) => (await s.owner.call("POST", "/package-plans", { name: "X", ...body })).body.error.fields;
    expect(await bad({ kind: "credits" })).toMatchObject({ credits: "How many classes does this package include?" });
    expect(await bad({ kind: "unlimited" })).toMatchObject({ validityValue: "Unlimited packages need a validity period, e.g. 1 month." });
    expect(await bad({ kind: "credits", credits: 5, activateWithinDays: 30 })).toMatchObject({ activateWithinDays: "Only needed when the countdown starts at the first booking." });
    expect(await bad({ kind: "credits", credits: 5, maxUsers: 2 })).toMatchObject({ sharingMode: expect.stringMatching(/one pool of credits or each get their own share/) });
    expect(await bad({ kind: "unlimited", validityValue: 1, validityUnit: "months", maxUsers: 2, sharingMode: "allocated" })).toMatchObject({ sharingMode: expect.stringMatching(/can't be split/) });
    expect((await s.c1.call("POST", "/package-plans", { name: "X", kind: "credits", credits: 1 })).status).toBe(403);
  });

  it("clients only see what's on sale", async () => {
    const { s, plan } = await setup();
    const p = await plan({});
    await plan({ name: "Old pack", onSale: false });
    expect((await s.c1.call("GET", "/package-plans")).body.categories.flatMap((c: { packages: { name: string }[] }) => c.packages.map((x) => x.name))).toEqual(["10-class pack"]);
    expect((await s.owner.call("GET", "/package-plans")).body).toHaveLength(2);
    await s.owner.call("PATCH", `/package-plans/${p.id}`, { changes: { onSale: false } });
    expect((await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: p.id })).body.error.code).toBe("not_on_sale");
  });
});

describe("booking with packages", () => {
  it("uses a class when booking and gives it back when cancelled in time", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    const sold = await sell(s.c1.id, (await plan({})).id);
    expect(sold).toMatchObject({ state: "active", creditsLeft: 10, pricePaid: "SGD 250.00", validUntil: expect.any(String) });
    expect(await outbox("package.added")).toHaveLength(2);

    const b = await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    expect(b.body).toMatchObject({ payment: "package", clientPackageId: sold.id, packageName: "10-class pack" });
    expect((await mine(s.c1))[0]).toMatchObject({ creditsLeft: 9, yourCreditsLeft: 9 });

    await s.c1.call("POST", `/bookings/${b.body.id}/cancel`, {});
    expect((await mine(s.c1))[0].creditsLeft).toBe(10);
    const detail = await s.c1.call("GET", `/client-packages/${sold.id}`);
    expect(detail.body.classes).toMatchObject([{ status: "Cancelled", credit: "Class given back", creditReturned: true }]);
    expect(detail.body.changes.map((h: { kind: string }) => h.kind)).toEqual(["purchase", "activated"]);
  });

  it("late cancellations keep the class used", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    await sell(s.c1.id, (await plan({})).id);
    const c = await mk({ ...minutesFromNow(180), acknowledge: ["unusual_start_time", "ends_after_midnight"] });
    const b = await s.c1.call("POST", "/bookings", { sessionId: c, acknowledge: ["no_free_cancel"] });
    await s.c1.call("POST", `/bookings/${b.body.id}/cancel`, { acknowledge: ["late_cancel"] });
    expect((await mine(s.c1))[0].creditsLeft).toBe(9);
  });

  it("uses the package that runs out soonest, or the one chosen", async () => {
    const { s, mk, plan, sell } = await setup();
    const long = await sell(s.c1.id, (await plan({ name: "Long pack", validityValue: 12 })).id);
    const short = await sell(s.c1.id, (await plan({ name: "Short pack", validityValue: 1 })).id);
    const opts = await s.c1.call("GET", `/sessions/${await mk()}/package-options`);
    expect(opts.body.suggested).toBe(short.id);
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk() })).body.clientPackageId).toBe(short.id);
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk(), clientPackageId: long.id })).body.clientPackageId).toBe(long.id);
  });

  it("tells clients exactly why they can't book, and lets staff choose", async () => {
    const { s, mk, plan, sell } = await setup();
    const [other] = await db.insert(classTypes).values({ orgId: s.orgId, name: "Barre", color: "#db2777" }).returning();
    await sell(s.c1.id, (await plan({ name: "Barre pack", classTypeIds: [other!.id] })).id);
    const c = await mk();
    const res = await s.c1.call("POST", "/bookings", { sessionId: c });
    expect(res.body.error).toMatchObject({ code: "package_needed", message: "None of your packages can be used for this class: Barre pack (it doesn't cover Reformer Pilates)." });
    expect((await s.c2.call("POST", "/bookings", { sessionId: c })).body.error.message).toBe("You need a package to book this class. You can buy one at the studio.");

    // Staff: asked first, then booked as "pay at studio", or complimentary.
    const ask = await s.owner.call("POST", "/bookings", { sessionId: c, clientId: s.c1.id });
    expect(ask.body.error.flags[0]).toMatchObject({ code: "no_package", message: expect.stringMatching(/Book anyway\? It'll show as “Pay at studio”/) });
    expect((await s.owner.call("POST", "/bookings", { sessionId: c, clientId: s.c1.id, acknowledge: ["no_package"] })).body.payment).toBe("pay_later");
    expect((await s.owner.call("POST", "/bookings", { sessionId: c, clientId: s.c2.id, complimentary: true })).body.payment).toBe("complimentary");
    expect(await outbox("booking.confirmed")).toHaveLength(4);
    expect((await s.c3.call("POST", "/bookings", { sessionId: c, complimentary: true })).status).toBe(403);
  });

  it("counts down from the first booking, and expires if nothing is booked in time", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    const p = await plan({ startsOn: "first_booking", validityValue: 30, validityUnit: "days", activateWithinDays: 14 });
    const sold = await sell(s.c1.id, p.id);
    expect(sold).toMatchObject({ state: "not_started", validUntil: null, firstBookingBy: dayOffset(14) });
    await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    expect((await mine(s.c1))[0]).toMatchObject({ state: "active", validUntil: dayOffset(29), startedOn: dayOffset(0) });

    // Dev bought one but never booked: once the deadline passes it can't be used.
    const devs = await sell(s.c2.id, p.id);
    await db.update(clientPackages).set({ activateBy: new Date(Date.now() - 1000) }).where(eq(clientPackages.id, devs.id));
    expect((await mine(s.c2))[0].state).toBe("expired");
    expect((await s.c2.call("POST", "/bookings", { sessionId: await mk() })).body.error.message).toMatch(/it expired because the first class wasn't booked by/);
  });

  it("won't use a package for a class after it expires, and can start on a later date", async () => {
    const { s, mk, plan, sell } = await setup();
    await sell(s.c1.id, (await plan({ validityValue: 2, validityUnit: "days" })).id);
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk() })).body.error.message).toMatch(/it expires on .* before this class/);

    const later = await sell(s.c2.id, (await plan({ name: "Monthly", kind: "unlimited", credits: null, validityValue: 1, validityUnit: "months" })).id, { startDate: dayOffset(5) });
    expect(later.state).toBe("not_started");
    expect((await s.c2.call("POST", "/bookings", { sessionId: await mk() })).body.error.message).toMatch(/it starts on .* after this class/);
    expect((await s.c2.call("POST", "/bookings", { sessionId: await mk({ date: dayOffset(6) }) })).body.payment).toBe("package");
  });

  it("enforces a package's weekly limit", async () => {
    const { s, mk, plan, sell } = await setup();
    await sell(s.c1.id, (await plan({ name: "Unlimited", kind: "unlimited", credits: null, validityValue: 1, validityUnit: "months", weeklyLimit: 1 })).id);
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk() })).status).toBe(201);
    expect((await s.c1.call("POST", "/bookings", { sessionId: await mk() })).body.error.message).toMatch(/allows 1 class a week, and that week is full/);
  });
});

describe("staff booking, cancelling, moving and refunding for clients", () => {
  it("cancelling inside the window follows the policy by default, and can be overridden", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    await db.update(organizations).set({ lateCancelFeeEnabled: true, lateCancelFeeCents: 1500 }).where(eq(organizations.id, s.orgId));
    await sell(s.c1.id, (await plan({})).id);
    const soon = () => mk({ ...minutesFromNow(180), acknowledge: ["unusual_start_time", "ends_after_midnight", "possible_duplicate", "room_double_booked", "instructor_double_booked"] });
    const b1 = await s.owner.call("POST", "/bookings", { sessionId: await soon(), clientId: s.c1.id });
    const late = await s.owner.call("POST", `/bookings/${b1.body.id}/cancel`, {});
    expect(late.body).toMatchObject({ lateCancel: true, refund: "none", classReturnedToPackage: false, fee: { amountCents: 1500 } });
    expect(late.body.flags[0].message).toMatch(/counts as a late cancellation and the class isn't given back and a SGD 15.00 fee applies/);

    const b2 = await s.owner.call("POST", "/bookings", { sessionId: await soon(), clientId: s.c1.id, acknowledge: ["client_double_booked"] });
    const kind = await s.owner.call("POST", `/bookings/${b2.body.id}/cancel`, { lateCancel: false, reason: "Unwell, let off" });
    expect(kind.body).toMatchObject({ lateCancel: false, refund: "credit", classReturnedToPackage: true, fee: null });
    expect((await mine(s.c1))[0].creditsLeft).toBe(9);
    expect(await db.select().from(fees)).toHaveLength(1);
  });

  it("moves keep the same package; refunds after class give the class back", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    const sold = await sell(s.c1.id, (await plan({})).id);
    const b = await s.owner.call("POST", "/bookings", { sessionId: await mk(), clientId: s.c1.id });
    const moved = await s.owner.call("POST", `/bookings/${b.body.id}/move`, { targetSessionId: await mk() });
    expect(moved.body).toMatchObject({ payment: "package", clientPackageId: sold.id });
    expect((await mine(s.c1))[0].creditsLeft).toBe(9);
    expect(await outbox("booking.moved")).toHaveLength(2);
    expect(await outbox("booking.confirmed")).toHaveLength(2); // only for the original booking

    await db.update(bookings).set({ attendance: "present" }).where(eq(bookings.id, moved.body.id));
    const refund = await s.owner.call("POST", `/bookings/${moved.body.id}/refund`, { method: "credit", reason: "Instructor ran 20 minutes short", acknowledge: ["refund_after_attending"] });
    expect(refund.body).toMatchObject({ refunded: true, classReturnedToPackage: true });
    expect((await mine(s.c1))[0].creditsLeft).toBe(10);

    const comp = await s.owner.call("POST", "/bookings", { sessionId: await mk(), clientId: s.c2.id, complimentary: true });
    expect((await s.owner.call("POST", `/bookings/${comp.body.id}/refund`, { method: "credit", reason: "x" })).body.error.code).toBe("complimentary");
  });

  it("admins adjust and cancel packages; a class given back to an expired package is flagged", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    const sold = await sell(s.c1.id, (await plan({})).id);
    expect((await s.owner.call("POST", `/client-packages/${sold.id}/adjust`, { credits: 2, reason: "Goodwill" })).body).toMatchObject({ creditsLeft: 12, creditsTotal: 12 });
    expect((await s.owner.call("POST", `/client-packages/${sold.id}/adjust`, { credits: -20, reason: "x" })).body.error.message).toBe("There are only 12 classes left to remove.");
    expect((await s.owner.call("POST", `/client-packages/${sold.id}/adjust`, { validUntil: dayOffset(200), reason: "Injury break" })).body.validUntil).toBe(dayOffset(200));
    expect((await s.c1.call("POST", `/client-packages/${sold.id}/adjust`, { credits: 5, reason: "x" })).status).toBe(403);

    const b = await s.c1.call("POST", "/bookings", { sessionId: await mk() });
    await db.update(clientPackages).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(clientPackages.id, sold.id));
    const cancel = await s.owner.call("POST", `/bookings/${b.body.id}/cancel`, {});
    expect(cancel.body.flags.map((f: { code: string }) => f.code)).toContain("package_expired");

    const c2 = await sell(s.c2.id, (await plan({ name: "Another" })).id);
    await s.c2.call("POST", "/bookings", { sessionId: await mk() });
    const cancelled = await s.owner.call("POST", `/client-packages/${c2.id}/cancel`, { reason: "Refunded at the desk" });
    expect(cancelled.body).toMatchObject({ state: "cancelled", flags: [{ code: "clients_affected" }] });
    expect((await mine(s.c2))[0].state).toBe("cancelled");
  });
});

describe("sharing", () => {
  it("one shared pool: the buyer adds people by email, up to the limit", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    const sold = await sell(s.c1.id, (await plan({ name: "Couples pack", maxUsers: 2, sharingMode: "pool" })).id);
    const devEmail = (await s.c2.call("GET", "/me")).body.email;
    expect((await s.c2.call("POST", `/client-packages/${sold.id}/members`, { email: devEmail })).status).toBe(403);
    const shared = await s.c1.call("POST", `/client-packages/${sold.id}/members`, { email: devEmail.toUpperCase() });
    expect(shared.status).toBe(201);
    expect(shared.body.sharing).toMatchObject({ spacesLeft: 0, members: [{ isOwner: true }, { userId: s.c2.id }] });
    expect(await outbox("package.shared")).toHaveLength(2);
    expect((await s.c1.call("POST", `/client-packages/${sold.id}/members`, { clientId: s.c3.id })).body.error.message).toBe("This package can be shared by up to 2 people, including the buyer, and it's full.");
    expect((await s.c1.call("POST", `/client-packages/${sold.id}/members`, { email: "nobody@example.com" })).body.error.code).toBe("no_account");

    expect((await s.c2.call("POST", "/bookings", { sessionId: await mk() })).body.clientPackageId).toBe(sold.id);
    expect((await mine(s.c1))[0].creditsLeft).toBe(9);
    expect((await mine(s.c2))[0]).toMatchObject({ creditsLeft: 9, yourCreditsLeft: 9, ownerId: s.c1.id });

    // Dev can leave; Chloe can't be removed from her own package.
    expect((await s.c2.call("DELETE", `/client-packages/${sold.id}/members/${s.c2.id}`)).status).toBe(200);
    expect((await s.owner.call("DELETE", `/client-packages/${sold.id}/members/${s.c1.id}`)).body.error.code).toBe("owner");
  });

  it("each with their own share: the buyer splits the classes, and keeps the rest", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    const sold = await sell(s.c1.id, (await plan({ name: "Family pack", maxUsers: 3, sharingMode: "allocated" })).id);
    await s.c1.call("POST", `/client-packages/${sold.id}/members`, { clientId: s.c2.id });
    expect((await s.c2.call("POST", "/bookings", { sessionId: await mk() })).body.error.message).toMatch(/there are no classes left in your share/);

    expect((await s.c1.call("PUT", `/client-packages/${sold.id}/allocations`, { allocations: [{ userId: s.c2.id, credits: 11 }] })).body.error.message).toBe("That shares out 11 classes, but only 10 are left.");
    const split = await s.c1.call("PUT", `/client-packages/${sold.id}/allocations`, { allocations: [{ userId: s.c2.id, credits: 3 }] });
    expect(split.body.sharing.members.map((m: { allocatedCredits: number }) => m.allocatedCredits)).toEqual([7, 3]);

    const b = await s.c2.call("POST", "/bookings", { sessionId: await mk() });
    expect((await mine(s.c2))[0]).toMatchObject({ creditsLeft: 9, yourCreditsLeft: 2 });
    expect((await mine(s.c1))[0].yourCreditsLeft).toBe(7);
    await s.c2.call("POST", `/bookings/${b.body.id}/cancel`, {});
    expect((await mine(s.c2))[0].yourCreditsLeft).toBe(3);

    // When Dev stops sharing, his unused classes go back to Chloe.
    await s.c1.call("DELETE", `/client-packages/${sold.id}/members/${s.c2.id}`);
    expect((await mine(s.c1))[0].yourCreditsLeft).toBe(10);
  });
});

describe("waitlists and packages", () => {
  it("needs a package to join, and books automatically with it", async () => {
    const { s, mk, plan, sell, mine } = await setup();
    const p = (await plan({})).id;
    await sell(s.c1.id, p);
    const c = await mk({ capacity: 1 });
    const b = await s.c1.call("POST", "/bookings", { sessionId: c });
    expect((await s.c2.call("POST", "/waitlist", { sessionId: c, mode: "automatic" })).body.error.code).toBe("package_needed");
    await sell(s.c2.id, p);
    expect((await s.c2.call("POST", "/waitlist", { sessionId: c, mode: "automatic" })).status).toBe(201);
    await s.c1.call("POST", `/bookings/${b.body.id}/cancel`, {});
    const [auto] = await db.select().from(bookings).where(and(eq(bookings.clientId, s.c2.id), eq(bookings.status, "confirmed")));
    expect(auto).toMatchObject({ payment: "package", source: "waitlist_automatic" });
    expect((await mine(s.c2))[0].creditsLeft).toBe(9);
  });
});
