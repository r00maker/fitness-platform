import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { classPay, describePayRate } from "@studio/shared";
import { bookings, classTypes, organizations } from "../src/db/schema.js";
import { periodFor } from "../src/modules/payroll/service.js";
import { app, db, dayOffset, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const sgd = (c: number) => `SGD ${(c / 100).toFixed(2)}`;
const PAST = ["in_the_past", "unusual_start_time", "possible_duplicate", "instructor_double_booked"];

describe("pay maths", () => {
  it("works out each pay type", () => {
    expect(classPay({ type: "per_class", amountCents: 5000 }, { headcount: 3, minutes: 50 })).toBe(5000);
    const perClient = { type: "per_client" as const, amountCents: 2000, perClientCents: 300, clientsIncluded: 5, minimumCents: 3000 };
    expect(classPay(perClient, { headcount: 2, minutes: 50 })).toBe(3000); // minimum
    expect(classPay(perClient, { headcount: 9, minutes: 50 })).toBe(3200); // 20 + 4 × 3
    const tiered = { type: "tiered" as const, tiers: [{ fromClients: 0, amountCents: 4000 }, { fromClients: 5, amountCents: 5500 }, { fromClients: 10, amountCents: 7000 }] };
    expect([0, 4, 5, 12].map((h) => classPay(tiered, { headcount: h, minutes: 50 }))).toEqual([4000, 4000, 5500, 7000]);
    expect(classPay({ type: "hourly", amountCents: 6000 }, { headcount: 0, minutes: 45 })).toBe(4500);
    expect(classPay({ type: "salary", amountCents: 300000 }, { headcount: 9, minutes: 50 })).toBe(0);

    expect(describePayRate(perClient, sgd)).toBe("SGD 20.00 per class + SGD 3.00 per client after the first 5 (at least SGD 30.00)");
    expect(describePayRate(tiered, sgd)).toBe("0–4 clients: SGD 40.00 · 5–9 clients: SGD 55.00 · 10+ clients: SGD 70.00");
    expect(describePayRate({ type: "hourly", amountCents: 6000 }, sgd)).toBe("SGD 60.00 an hour of class");
    expect(describePayRate({ type: "salary", amountCents: 300000 }, sgd, "month")).toBe("SGD 3000.00 per month");
  });

  it("splits time into pay periods", () => {
    expect(periodFor("2026-11-12", "monthly", null)).toMatchObject({ start: "2026-11-01", end: "2026-12-01", lastDay: "2026-11-30", label: "November 2026", previous: "2026-10-31", next: "2026-12-01" });
    expect(periodFor("2026-11-12", "weekly", null)).toMatchObject({ start: "2026-11-09", end: "2026-11-16", label: "9–15 Nov 2026" });
    expect(periodFor("2026-11-12", "twice_monthly", null)).toMatchObject({ start: "2026-11-01", end: "2026-11-16" });
    expect(periodFor("2026-11-20", "twice_monthly", null)).toMatchObject({ start: "2026-11-16", end: "2026-12-01", label: "16–30 Nov 2026" });
    expect(periodFor("2026-11-12", "fortnightly", "2026-01-05")).toMatchObject({ start: "2026-11-09", end: "2026-11-23" });
    expect(periodFor("2026-11-12", "fortnightly", "2026-11-02")).toMatchObject({ start: "2026-11-02", end: "2026-11-16" });
    expect(periodFor("2026-11-12", "fortnightly", "2026-12-28")).toMatchObject({ start: "2026-11-02", end: "2026-11-16" }); // anchor in the future works too
    expect(periodFor("2026-12-30", "weekly", null).label).toBe("28 Dec – 3 Jan 2027");
  });
});

async function setup() {
  const s = await studio();
  // Weekly pay, so every class a few days ago sits in a period we can name.
  await db.update(organizations).set({ payPeriod: "weekly" }).where(eq(organizations.id, s.orgId));
  const foh = await person(s.orgId, "front_desk", "Fiona");
  const [privates] = await db.insert(classTypes).values({ orgId: s.orgId, name: "Private Reformer", color: "#7c3aed" }).returning();
  let hour = 7;
  /** A class that has already happened, with `present` attended and `noShow` no-shows. */
  const past = async (instructorId: string, present: number, noShow = 0, extra: Record<string, unknown> = {}) => {
    const r = await s.owner.call("POST", "/sessions", {
      classTypeId: s.classTypeId, locationId: s.locationId, instructorId, capacity: 20, durationMinutes: 50, date: dayOffset(-1), startTime: `${String(hour++).padStart(2, "0")}:00`, acknowledge: PAST, ...extra,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const clients = [s.c1, s.c2, s.c3];
    for (let i = 0; i < present + noShow; i++) {
      const c = i < clients.length ? clients[i]! : await person(s.orgId, "client");
      await db.insert(bookings).values({ orgId: s.orgId, sessionId: r.body.id, clientId: c.id, source: "staff", attendance: i < present ? "present" : "no_show" });
    }
    return r.body.id as string;
  };
  const rate = async (body: Record<string, unknown>) => {
    const r = await s.owner.call("POST", "/pay-rates", { effectiveFrom: dayOffset(-30), ...body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  const report = async (who = s.owner) => (await who.call("GET", `/payroll?date=${dayOffset(-1)}`)).body;
  return { s, foh, privates: privates!, past, rate, report };
}

describe("payroll report", () => {
  it("pays each class by its rate, adds salaries and adjustments, and flags gaps", async () => {
    const { s, foh, privates, past, rate, report } = await setup();
    const r = await rate({ staffId: s.ana.id, type: "per_client", amountCents: 2000, perClientCents: 300, clientsIncluded: 2, minimumCents: 2500 });
    expect(r.description).toBe("SGD 20.00 per class + SGD 3.00 per client after the first 2 (at least SGD 25.00)");
    await rate({ staffId: s.ana.id, classTypeId: privates.id, type: "per_class", amountCents: 8000 });
    await rate({ staffId: foh.id, type: "salary", amountCents: 50000 });
    await past(s.ana.id, 5, 1); // 20 + 3 × 3 = 29
    await past(s.ana.id, 1); // minimum 25
    await past(s.ana.id, 1, 0, { classTypeId: privates.id }); // privates rate 80
    await past(s.ben.id, 4); // no rate
    await s.owner.call("POST", "/pay-adjustments", { staffId: s.ana.id, date: dayOffset(-1), amountCents: 5000, reason: "Workshop" });

    const rep = await report();
    const ana = rep.staff.find((x: { name: string }) => x.name.startsWith("Ana"));
    expect(ana.classes.map((c: { amountCents: number }) => c.amountCents)).toEqual([2900, 2500, 8000]);
    expect(ana).toMatchObject({ classPayCents: 13400, adjustmentsCents: 5000, totalCents: 18400, total: "SGD 184.00", warnings: [] });
    expect(ana.rates.map((x: { description: string; classTypeName: string | null }) => `${x.classTypeName ?? "Usual"}: ${x.description}`)).toEqual([
      "Usual: SGD 20.00 per class + SGD 3.00 per client after the first 2 (at least SGD 25.00)",
      "Private Reformer: SGD 80.00 per class",
    ]);
    const ben = rep.staff.find((x: { name: string }) => x.name.startsWith("Ben"));
    expect(ben).toMatchObject({ totalCents: 0, warnings: [expect.stringMatching(/^No pay rate set for Reformer Pilates/)] });
    expect(rep.staff.find((x: { name: string }) => x.name.startsWith("Fiona"))).toMatchObject({ salaryCents: 50000, totalCents: 50000, rates: [{ description: "SGD 500.00 per week" }] });
    expect(rep.totalCents).toBe(18400 + 50000);
    expect(rep.headcountRule).toBe("Clients who attended");
  });

  it("can count everyone booked, and warns when attendance wasn't taken", async () => {
    const { s, past, rate, report } = await setup();
    await rate({ staffId: s.ana.id, type: "tiered", tiers: [{ fromClients: 0, amountCents: 4000 }, { fromClients: 3, amountCents: 6000 }] });
    await past(s.ana.id, 2, 1);
    const unmarked = await past(s.ana.id, 2);
    await db.update(bookings).set({ attendance: "unmarked" }).where(eq(bookings.sessionId, unmarked));
    let ana = (await report()).staff[0];
    expect(ana.classes.map((c: { clients: number }) => c.clients)).toEqual([2, 0]);
    expect(ana.warnings).toEqual(["Attendance wasn't taken for 1 class, so it counts 0 clients. Take attendance to pay for them properly."]);

    await s.owner.call("PATCH", "/settings", { payHeadcount: "booked" });
    ana = (await report()).staff[0];
    expect(ana.classes.map((c: { clients: number; amountCents: number }) => `${c.clients}:${c.amountCents}`)).toEqual(["3:6000", "2:4000"]);
    expect(ana.warnings).toEqual([]);
  });

  it("uses the rate that applied on the class date", async () => {
    const { s, past, rate, report } = await setup();
    await rate({ staffId: s.ana.id, type: "per_class", amountCents: 4000, effectiveFrom: dayOffset(-60) });
    await rate({ staffId: s.ana.id, type: "per_class", amountCents: 5000, effectiveFrom: dayOffset(0) });
    await past(s.ana.id, 3);
    expect((await report()).staff[0].classes[0].amountCents).toBe(4000);
  });

  it("pays whoever taught, including cover", async () => {
    const { s, past, rate, report } = await setup();
    await rate({ staffId: s.ben.id, type: "per_class", amountCents: 4500 });
    const c = await past(s.ana.id, 3);
    await s.owner.call("PATCH", `/sessions/${c}`, { changes: { instructorId: s.ben.id }, asCover: true, acknowledge: ["already_happened", "clients_affected", "short_notice"] });
    const ben = (await report()).staff.find((x: { name: string }) => x.name.startsWith("Ben"));
    expect(ben.classes[0]).toMatchObject({ cover: true, amountCents: 4500 });
  });

  it("marking as paid keeps the figures and shows later changes", async () => {
    const { s, past, rate, report } = await setup();
    await rate({ staffId: s.ana.id, type: "per_client", perClientCents: 1000 });
    const c = await past(s.ana.id, 2, 1);
    const paid = await s.owner.call("POST", "/payroll/mark-paid", { date: dayOffset(-1), acknowledge: ["period_not_over"] });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    expect((await s.owner.call("POST", "/payroll/mark-paid", { date: dayOffset(-1), acknowledge: ["period_not_over"] })).body.error.code).toBe("already_paid");

    // The no-show turns out to have come: admins are told pay was already marked as paid.
    const [noShow] = await db.select().from(bookings).where(eq(bookings.attendance, "no_show"));
    const fix = await s.owner.call("PUT", `/bookings/${noShow!.id}/attendance`, { attendance: "present" });
    expect(fix.body.flags.map((f: { code: string }) => f.code)).toContain("pay_already_marked_paid");
    const rep = await report();
    expect(rep.paid).toMatchObject({ totalCents: 2000, changesSince: [{ differenceCents: 1000, difference: "+SGD 10.00" }] });
    void c;
  });

  it("won't mark a period with nothing in it as paid", async () => {
    const { s, past, rate } = await setup();
    await rate({ staffId: s.ana.id, type: "per_class", amountCents: 4000 });
    await past(s.ana.id, 1);
    const res = await s.owner.call("POST", "/payroll/mark-paid", { date: dayOffset(30) });
    expect(res.body.error.code).toBe("nothing_to_pay");
  });
});

describe("rates, exports and who sees what", () => {
  it("validates rates in plain English", async () => {
    const { s, privates } = await setup();
    const bad = async (body: Record<string, unknown>) => (await s.owner.call("POST", "/pay-rates", { staffId: s.ana.id, ...body })).body.error.fields;
    expect(await bad({ type: "per_class" })).toMatchObject({ amountCents: "Set the amount." });
    expect(await bad({ type: "tiered", tiers: [{ fromClients: 3, amountCents: 1 }, { fromClients: 6, amountCents: 2 }] })).toMatchObject({ tiers: "The first tier should start at 0 clients, so every class is covered." });
    expect(await bad({ type: "salary", amountCents: 100, classTypeId: privates.id })).toMatchObject({ classTypeId: "Salaries apply to the whole pay period, not one class type." });
    expect((await s.owner.call("POST", "/pay-rates", { staffId: s.c1.id, type: "per_class", amountCents: 100 })).status).toBe(404);
  });

  it("instructors see only their own pay, if the studio allows it; exports a CSV", async () => {
    const { s, foh, past, rate } = await setup();
    await rate({ staffId: s.ana.id, type: "per_class", amountCents: 4000 });
    await rate({ staffId: s.ben.id, type: "per_class", amountCents: 9000 });
    await past(s.ana.id, 2);
    await past(s.ben.id, 2);
    const mine = await s.ana.call("GET", `/me/pay?date=${dayOffset(-1)}`);
    expect(mine.body.you).toMatchObject({ totalCents: 4000, classes: [{ amountCents: 4000 }] });
    expect(JSON.stringify(mine.body)).not.toContain("9000");
    expect((await s.ana.call("GET", "/payroll")).status).toBe(403);
    expect((await foh.call("GET", "/pay-rates")).status).toBe(403);
    expect((await s.c1.call("GET", "/me/pay")).status).toBe(403);

    await s.owner.call("PATCH", "/settings", { instructorsSeeOwnPay: false });
    expect((await s.ana.call("GET", "/me/pay")).body.error.message).toBe("Your studio doesn't show pay in the app. Ask an admin.");

    await s.owner.call("POST", "/pay-adjustments", { staffId: s.ana.id, date: dayOffset(-1), amountCents: -500, reason: "=SUM(A1)" });
    const csv = await app.inject({ method: "GET", url: `/v1/payroll/export.csv?date=${dayOffset(-1)}`, headers: { authorization: `Bearer ${s.owner.token}` } });
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body.split("\r\n")[0]).toBe('"Name","Date","Item","Clients","Amount (SGD)"');
    expect(csv.body).toContain(`"'=SUM(A1)","","-5.00"`);
    expect(csv.body).toMatch(/"All staff","",".*","","125.00"/);
  });
});
