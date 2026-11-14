import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { bookings, classSessions, journeyEnrollments, leads, memberships, notifications, organizations, packagePlans, users, whatsappSettings } from "../src/db/schema.js";
import { setWhatsappFetch } from "../src/modules/marketing/whatsapp.js";
import { runDueJourneys } from "../src/modules/marketing/journeys.js";
import { deliverPending } from "../src/modules/notifications/deliver.js";
import { autoCancelDue } from "../src/modules/sessions/service.js";
import { app, caller, config, dayOffset, db, outbox, person, pool, reset, studio, tokenFor } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const DAY = 86_400_000;
const ACK = ["possible_duplicate", "instructor_double_booked", "room_double_booked", "late_booking", "outside_booking_window", "short_notice", "in_the_past", "no_free_cancel"];
const urls = { api: config.PUBLIC_API_URL, app: config.PUBLIC_APP_URL };

async function setup() {
  const s = await studio();
  const cls = (body: Record<string, unknown> = {}) =>
    s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, date: dayOffset(3), startTime: "09:00", acknowledge: ACK, ...body });
  return { s, cls };
}

describe("auto-cancel", () => {
  it("cancels a class that hasn't reached its minimum at the cut-off, and leaves the rest", async () => {
    const { s, cls } = await setup();
    // Classes at normal hours a few days ahead; the check runs "as of" 2 hours before the first one,
    // so the test doesn't depend on what time of day it's run.
    const low = (await cls({ startTime: "09:00", autoCancel: { hoursBefore: 3, minBookings: 3 } })).body;
    expect(low).toMatchObject({ autoCancelHours: 3, autoCancelMin: 3 });
    const ok = (await cls({ startTime: "09:30", roomId: null, autoCancel: { hoursBefore: 3, minBookings: 2 } })).body;
    const later = (await cls({ date: dayOffset(5), autoCancel: { hoursBefore: 3, minBookings: 5 } })).body; // days away: not yet
    for (const c of [low, ok, later]) expect(c.id, JSON.stringify(c)).toBeTruthy();
    const at = new Date(new Date(low.startsAt).getTime() - 2 * 3_600_000);
    expect((await s.c1.call("POST", "/bookings", { sessionId: low.id, acknowledge: ACK })).status).toBe(201);
    for (const c of [s.c2, s.c3]) { const b = await c.call("POST", "/bookings", { sessionId: ok.id, acknowledge: ACK }); expect(b.status, JSON.stringify(b.body)).toBe(201); }

    const r = await autoCancelDue(db, at);
    expect(r.cancelled).toEqual([low.id]);
    const rows = Object.fromEntries((await db.select().from(classSessions)).map((x) => [x.id, x]));
    expect(rows[low.id]).toMatchObject({ status: "cancelled", autoCancelled: true });
    expect(rows[ok.id]).toMatchObject({ status: "scheduled", autoCancelled: false });
    expect(rows[ok.id]!.autoCancelCheckedAt).not.toBeNull();
    expect(rows[later.id]!.autoCancelCheckedAt).toBeNull();
    // Chloe was told why and her booking cancelled; the team and instructor were told.
    const told = (await outbox("session.cancelled")).find((n) => n.userId === s.c1.id);
    expect((told!.data as { reason: string }).reason).toMatch(/Not enough people booked \(1 of the 3 needed\)/);
    expect((await db.select().from(bookings).where(eq(bookings.sessionId, low.id)))[0]!.status).toBe("cancelled");
    expect(new Set((await outbox("session.auto_cancelled")).map((n) => n.userId))).toEqual(new Set([s.owner.id, s.ana.id]));
    // Checked once only.
    expect((await autoCancelDue(db, at)).checked).toBe(0);
  });

  it("comes from the template, can be changed on the class, and must make sense", async () => {
    const { s, cls } = await setup();
    const t = (await s.owner.call("POST", "/templates", { name: "Reformer AM", classTypeId: s.classTypeId, locationId: s.locationId, capacity: 8, durationMinutes: 50, startTime: "07:00", autoCancel: { hoursBefore: 12, minBookings: 3 } })).body;
    expect(t).toMatchObject({ autoCancelHours: 12, autoCancelMin: 3 });
    const fromTpl = (await s.owner.call("POST", "/sessions", { templateId: t.id, date: dayOffset(4), instructorId: s.ana.id, acknowledge: ACK })).body;
    expect(fromTpl).toMatchObject({ autoCancelHours: 12, autoCancelMin: 3 });
    const off = (await s.owner.call("POST", "/sessions", { templateId: t.id, date: dayOffset(5), instructorId: s.ana.id, autoCancel: null, acknowledge: ACK })).body;
    expect(off).toMatchObject({ autoCancelHours: null, autoCancelMin: null });
    const changed = await s.owner.call("PATCH", `/sessions/${fromTpl.id}`, { changes: { autoCancel: { hoursBefore: 6, minBookings: 2 } } });
    expect(changed.body.updated[0]).toMatchObject({ autoCancelHours: 6, autoCancelMin: 2 });
    expect((await s.owner.call("PATCH", `/templates/${t.id}`, { autoCancel: { hoursBefore: 12, minBookings: 20 } })).body.error.fields.autoCancel).toMatch(/at most 8/);
    expect((await cls({ autoCancel: { hoursBefore: 100, minBookings: 2 } })).status).toBe(400);
    const appt = (await s.owner.call("POST", "/class-types", { name: "Private", color: "#7C3AED", kind: "appointment" })).body;
    expect((await s.owner.call("POST", "/templates", { name: "Private", classTypeId: appt.id, locationId: s.locationId, capacity: 1, durationMinutes: 55, autoCancel: { hoursBefore: 2, minBookings: 1 } })).body.error.code).toBe("auto_cancel_appointment");
  });
});

describe("deleting class types", () => {
  it("refuses while it's on the calendar, then asks first and tidies up", async () => {
    const { s, cls } = await setup();
    const c = (await cls()).body;
    await s.owner.call("POST", "/templates", { name: "Reformer AM", classTypeId: s.classTypeId, locationId: s.locationId, capacity: 8, durationMinutes: 50 });
    const only = (await s.owner.call("POST", "/package-plans", { name: "Reformer 5-pack", kind: "credits", credits: 5, priceCents: 15000, validityValue: 2, validityUnit: "months", classTypeIds: [s.classTypeId] })).body;
    const inUse = await s.owner.call("DELETE", `/class-types/${s.classTypeId}`, {});
    expect(inUse.status).toBe(409);
    expect(inUse.body.error).toMatchObject({ code: "class_type_in_use", message: expect.stringMatching(/still on the calendar \(1 upcoming class\)/) });

    await s.owner.call("POST", `/sessions/${c.id}/cancel`, { notifyClients: false, acknowledge: ["clients_affected"] });
    const ask = await s.owner.call("DELETE", `/class-types/${s.classTypeId}`, {});
    expect(ask.body.error.flags[0]).toMatchObject({ code: "delete_class_type", message: expect.stringMatching(/Its template \(Reformer AM\) will be deleted too.*Reformer 5-pack only covers/) });
    const done = await s.owner.call("DELETE", `/class-types/${s.classTypeId}`, { acknowledge: ["delete_class_type"] });
    expect(done.body).toMatchObject({ deleted: "Reformer Pilates", templatesRemoved: 1, packagesTakenOffSale: ["Reformer 5-pack"] });
    expect((await s.owner.call("GET", "/class-types")).body).toHaveLength(0);
    expect((await db.select().from(packagePlans).where(eq(packagePlans.id, only.id)))[0]!.onSale).toBe(false);
    expect((await s.ana.call("DELETE", `/class-types/${s.classTypeId}`, {})).status).toBe(403);
  });
});

describe("staff invites", () => {
  it("adds a staff member by email; they set their password from the link", async () => {
    const { s } = await setup();
    const r = await s.owner.call("POST", "/staff/invites", { email: "Mia.Wong@Example.com", firstName: "Mia", lastName: "Wong", role: "instructor" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ email: "mia.wong@example.com", role: "instructor", status: "invited" });
    const mail = await outbox("staff.invite");
    expect(mail.map((m) => m.channel)).toEqual(["email"]);
    const link = (mail[0]!.data as { link: string }).link;
    expect(link).toMatch(/\/staff-invite\/[a-f0-9]{48}$/);
    const token = link.split("/").pop()!;
    expect((await s.owner.call("GET", "/staff/team")).body.find((x: { email: string }) => x.email === "mia.wong@example.com")).toMatchObject({ status: "invited", roleLabel: "Instructor" });

    const page = await app.inject({ method: "GET", url: `/v1/public/staff-invites/${token}` });
    expect(page.json()).toMatchObject({ studio: "Test Studio", firstName: "Mia", email: "mia.wong@example.com", roleLabel: "Instructor" });
    expect((await app.inject({ method: "POST", url: `/v1/public/staff-invites/${token}/accept` })).json()).toEqual({ accepted: true });
    expect((await app.inject({ method: "POST", url: `/v1/public/staff-invites/${token}/accept` })).statusCode).toBe(404);
    expect((await s.owner.call("GET", "/staff/team")).body.find((x: { email: string }) => x.email === "mia.wong@example.com").status).toBe("active");
    // Signed in, she's an instructor.
    const mia = caller(await tokenFor(r.body.id, s.orgId));
    expect((await mia("GET", "/me/teaching")).status).toBe(200);

    // Removing her takes access away straight away.
    expect((await s.owner.call("DELETE", `/staff/${r.body.id}`)).status).toBe(204);
    expect((await mia("GET", "/me/teaching")).status).toBe(403);
  });

  it("keeps the safeguards: owner-only admins, no client emails, no removing the owner or yourself", async () => {
    const { s } = await setup();
    const admin = await person(s.orgId, "admin", "Ada");
    expect((await admin.call("POST", "/staff/invites", { email: "x@example.com", firstName: "X", lastName: "Y", role: "admin" })).status).toBe(403);
    expect((await admin.call("POST", "/staff/invites", { email: "x@example.com", firstName: "X", lastName: "Y", role: "front_desk" })).status).toBe(201);
    const [chloe] = await db.select().from(users).where(eq(users.id, s.c1.id));
    expect((await s.owner.call("POST", "/staff/invites", { email: chloe!.email, firstName: "C", lastName: "T", role: "instructor" })).body.error.code).toBe("already_client");
    expect((await admin.call("DELETE", `/staff/${s.owner.id}`)).status).toBe(403);
    expect((await admin.call("DELETE", `/staff/${admin.id}`)).status).toBe(400);
    expect((await s.ana.call("POST", "/staff/invites", { email: "z@example.com", firstName: "Z", lastName: "Z", role: "instructor" })).status).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/public/staff-invites/${"0".repeat(48)}` })).statusCode).toBe(404);
  });
});

describe("ClassPass clients are leads", () => {
  it("adds them on their first ClassPass booking and marks them converted when they buy", async () => {
    const { s, cls } = await setup();
    const c = (await cls({ classpassEnabled: true, classpassSpots: 3 })).body;
    await s.owner.call("POST", "/bookings", { sessionId: c.id, clientId: s.c1.id, viaClasspass: true });
    const c2 = (await cls({ startTime: "11:00", classpassEnabled: true, classpassSpots: 3 })).body;
    await s.owner.call("POST", "/bookings", { sessionId: c2.id, clientId: s.c1.id, viaClasspass: true });
    const list = (await s.owner.call("GET", "/leads?source=classpass&status=all")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ source: "classpass", sourceLabel: "ClassPass", status: "new", clientId: s.c1.id });
    const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, s.c1.id), eq(memberships.orgId, s.orgId)));
    expect(m!.source).toBe("classpass");
    expect(await outbox("custom")).toHaveLength(0); // no emails to ClassPass leads

    const plan = (await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months" })).body;
    await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: plan.id });
    expect((await db.select().from(leads))[0]).toMatchObject({ status: "bought", firstPurchaseCents: 28000 });
    expect((await db.select().from(memberships).where(and(eq(memberships.userId, s.c1.id), eq(memberships.orgId, s.orgId))))[0]!.source).toBe("direct");
    const f = (await s.owner.call("GET", "/ads/funnel?days=30")).body;
    expect(f.sources.find((x: { source: string }) => x.source === "classpass")).toMatchObject({ label: "ClassPass", leads: 1, bought: 1 });
  });
});

describe("journey goals", () => {
  it("ends the journey when the goal is reached, and counts it", async () => {
    const { s } = await setup();
    await db.update(organizations).set({ timezone: "UTC" }).where(eq(organizations.id, s.orgId));
    const plan = (await s.owner.call("POST", "/package-plans", { name: "Intro", kind: "credits", credits: 3, priceCents: 5000, validityValue: 1, validityUnit: "months" })).body;
    const j = (await s.owner.call("POST", "/journeys", { name: "Nudge", quietHours: false, definition: { trigger: { type: "package_used_up" }, goal: { event: "package_bought" }, steps: [{ id: "w", type: "wait", for: { value: 2, unit: "days" } }, { id: "p", type: "send_push", title: "Top up?", body: "Your pack is used up." }] } })).body;
    expect((await s.owner.call("POST", `/journeys/${j.id}/go-live`, { acknowledge: ["journey_starts"] })).body.journey.status).toBe("live");
    const { journeyEvent } = await import("../src/modules/marketing/journeys.js");
    await db.transaction((tx) => journeyEvent(tx, s.orgId, s.c1.id, { type: "package_used_up" } as never));
    await db.transaction((tx) => journeyEvent(tx, s.orgId, s.c2.id, { type: "package_used_up" } as never));
    await runDueJourneys(db, urls);
    // Chloe buys before the reminder: she leaves the journey and gets no push.
    await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: plan.id });
    const [e] = await db.select().from(journeyEnrollments).where(eq(journeyEnrollments.clientId, s.c1.id));
    expect(e).toMatchObject({ status: "completed", exitReason: "Reached the goal" });
    expect(e!.convertedAt).not.toBeNull();
    await runDueJourneys(db, urls, new Date(Date.now() + 3 * DAY));
    const stats = (await s.owner.call("GET", `/journeys/${j.id}`)).body.stats;
    expect(stats).toMatchObject({ started: 2, converted: 1, conversionRate: 50 });

    // A goal that's also what a "Wait for" step waits for: no error; reaching it follows the Yes side.
    const thanks = await s.owner.call("POST", "/journeys", { name: "Thanks", quietHours: false, definition: { trigger: { type: "account_created" }, goal: { event: "package_bought" }, steps: [{ id: "wf", type: "wait_for", event: "package_bought", within: { value: 3, unit: "days" }, yes: [{ id: "ty", type: "send_push", title: "Thank you!", body: "Enjoy your classes." }], no: [] }] } });
    expect(thanks.status, JSON.stringify(thanks.body)).toBe(201);
    await s.owner.call("POST", `/journeys/${thanks.body.id}/go-live`, { acknowledge: ["journey_starts"] });
    await db.transaction((tx) => journeyEvent(tx, s.orgId, s.c3.id, { type: "account_created" } as never));
    await runDueJourneys(db, urls);
    await s.owner.call("POST", `/clients/${s.c3.id}/packages`, { planId: plan.id });
    await runDueJourneys(db, urls);
    const [t] = await db.select().from(journeyEnrollments).where(and(eq(journeyEnrollments.clientId, s.c3.id), eq(journeyEnrollments.journeyId, thanks.body.id)));
    expect(t!.convertedAt).not.toBeNull();
    expect(t!.status).toBe("completed");
    expect(t!.exitReason).not.toBe("Reached the goal");
    expect((await s.owner.call("GET", `/journeys/${thanks.body.id}`)).body.stats).toMatchObject({ converted: 1 });
    // Only the three simple goals are offered.
    expect((await s.owner.call("POST", "/journeys", { name: "Odd", definition: { trigger: { type: "account_created" }, goal: { event: "account_created" }, steps: [{ id: "p", type: "send_push", title: "Hi", body: "Hi" }] } })).status).toBe(400);
  });
});

describe("WhatsApp", () => {
  it("connects, keeps the token secret, and sends template messages only to people who agreed", async () => {
    const { s } = await setup();
    await db.update(organizations).set({ timezone: "UTC" }).where(eq(organizations.id, s.orgId));
    const before = await s.owner.call("POST", "/journeys", { name: "WA", definition: { trigger: { type: "package_used_up" }, steps: [{ id: "wa", type: "send_whatsapp", template: "top_up", language: "en", variables: ["{{first_name}}"] }] } });
    expect(before.body.error.code).toBe("whatsapp_not_connected");

    await s.owner.call("PUT", "/comms/billing", { mode: "meta_direct", paymentMethodAdded: true });
    const conn = await s.owner.call("PATCH", "/whatsapp/settings", { phoneNumberId: "1234567890", businessAccountId: "9876543210", accessToken: "EAAG-whatsapp-token-0123456789" });
    expect(conn.body).toMatchObject({ connected: true });
    expect(JSON.stringify(conn.body)).not.toContain("whatsapp-token");
    expect((await db.select().from(whatsappSettings))[0]!.accessToken).toMatch(/^v1:/);
    expect((await s.owner.call("POST", "/whatsapp/templates", { name: "top_up", language: "en", body: "Hi {{1}}, your class pack is used up. Reply to top up!" })).body.templates[0]).toMatchObject({ variables: 1 });
    const wrong = await s.owner.call("POST", "/journeys", { name: "WA", definition: { trigger: { type: "package_used_up" }, steps: [{ id: "wa", type: "send_whatsapp", template: "top_up", language: "en", variables: [] }] } });
    expect(wrong.body.error.code).toBe("whatsapp_blanks");
    const j = (await s.owner.call("POST", "/journeys", { name: "WA", quietHours: false, definition: { trigger: { type: "package_used_up" }, steps: [{ id: "wa", type: "send_whatsapp", template: "top_up", language: "en", variables: ["{{first_name}}"] }] } })).body;
    await s.owner.call("POST", `/journeys/${j.id}/go-live`, { acknowledge: ["journey_starts"] });

    // Chloe said yes and has a mobile; Dev didn't say yes.
    await db.update(users).set({ phone: "9123 4567" }).where(eq(users.id, s.c1.id));
    await db.update(users).set({ phone: "+65 8123 4567" }).where(eq(users.id, s.c2.id));
    await db.update(memberships).set({ marketingWhatsapp: true }).where(eq(memberships.userId, s.c1.id));
    const { journeyEvent } = await import("../src/modules/marketing/journeys.js");
    for (const c of [s.c1, s.c2]) await db.transaction((tx) => journeyEvent(tx, s.orgId, c.id, { type: "package_used_up" } as never));
    await runDueJourneys(db, urls);
    const wa = (await db.select().from(notifications)).filter((n) => n.channel === "whatsapp");
    expect(wa).toHaveLength(1);
    expect(wa[0]).toMatchObject({ userId: s.c1.id, data: expect.objectContaining({ to: "6591234567", template: "top_up", params: ["Chloe"] }) });

    // Delivered with the studio's own number and token.
    const sent: { url: string; auth: string; body: Record<string, unknown> }[] = [];
    setWhatsappFetch((async (url: string, init: RequestInit) => {
      sent.push({ url: String(url), auth: String((init.headers as Record<string, string>).Authorization), body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as typeof fetch);
    const { providersFromConfig } = await import("../src/modules/notifications/providers.js");
    await deliverPending(db, { email: { send: async () => {} }, push: { send: async () => {} }, whatsapp: providersFromConfig(config).whatsapp });
    expect(sent[0]!.url).toMatch(/\/1234567890\/messages$/);
    expect(sent[0]!.auth).toBe("Bearer EAAG-whatsapp-token-0123456789");
    expect(sent[0]!.body).toMatchObject({ messaging_product: "whatsapp", to: "6591234567", type: "template", template: { name: "top_up", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Chloe" }] }] } });

    // Templates can be synced from WhatsApp (approved marketing and utility ones only).
    setWhatsappFetch((async () => new Response(JSON.stringify({ data: [
      { name: "top_up", language: "en", status: "APPROVED", category: "MARKETING", components: [{ type: "BODY", text: "Hi {{1}}, top up?" }] },
      { name: "otp", language: "en", status: "APPROVED", category: "AUTHENTICATION", components: [] },
      { name: "draft", language: "en", status: "PENDING", category: "MARKETING", components: [] },
    ] }), { status: 200 })) as typeof fetch);
    const sync = (await s.owner.call("POST", "/whatsapp/templates/sync")).body;
    expect(sync).toMatchObject({ skipped: 2, templates: [{ name: "top_up", variables: 1 }] });
  });
});

describe("my bookings", () => {
  it("splits classes from appointments", async () => {
    const { s, cls } = await setup();
    const priv = (await s.owner.call("POST", "/class-types", { name: "Private", color: "#7C3AED", kind: "appointment" })).body;
    const c = (await cls()).body;
    await s.c1.call("POST", "/bookings", { sessionId: c.id, acknowledge: ACK });
    const a = (await s.owner.call("POST", "/sessions", { classTypeId: priv.id, locationId: s.locationId, instructorId: s.ana.id, durationMinutes: 55, date: dayOffset(4), startTime: "15:00", acknowledge: [...ACK, "appointment_no_client"] })).body;
    await s.owner.call("POST", "/bookings", { sessionId: a.id, clientId: s.c1.id, complimentary: true });
    const mine = (await s.c1.call("GET", "/me/bookings")).body;
    expect(mine.counts).toEqual({ classes: 1, appointments: 1 });
    expect(mine.appointments[0]).toMatchObject({ isAppointment: true, classType: { name: "Private" } });
    expect(mine.classes[0].session.notes).toBeUndefined();
    expect(Object.keys((await s.c1.call("GET", "/me/bookings?show=appointments")).body)).toEqual(["counts", "appointments"]);
  });
});

describe("reports", () => {
  it("gives plain-English numbers with comparisons, for owners and admins only", async () => {
    const { s } = await setup();
    // Two past classes: one 8/10 full, one 2/10; one no-show.
    const mk = async (daysAgo: number, booked: number, noShows = 0) => {
      const startsAt = new Date(Date.now() - daysAgo * DAY);
      const [c] = await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000), capacity: 10 }).returning();
      const people = [s.c1, s.c2, s.c3];
      for (let i = 0; i < booked; i++) {
        const u = i < 3 ? people[i]!.id : (await person(s.orgId, "client", `Extra${i}`)).id;
        await db.insert(bookings).values({ orgId: s.orgId, sessionId: c!.id, clientId: u, source: "staff", attendance: i < noShows ? "no_show" : "present" });
      }
    };
    await mk(5, 8, 1);
    await mk(12, 2);
    const plan = (await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months" })).body;
    await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: plan.id });

    const o = (await s.owner.call("GET", "/reports/overview?days=30")).body;
    expect(o.period).toMatchObject({ days: 30, label: "Last 30 days", comparedWith: "the 30 days before" });
    const m = Object.fromEntries(o.metrics.map((x: { key: string }) => [x.key, x]));
    expect(m.revenue).toMatchObject({ value: 28000, display: "SGD 280.00", change: { text: "New this period", good: true } });
    expect(m.held.value).toBe(2);
    expect(m.fill).toMatchObject({ value: 50, display: "50%", explain: "On average, about 5 of every 10 spots were taken." });
    expect(typeof o.summary).toBe("string");

    const sales = (await s.owner.call("GET", "/reports/sales?days=30")).body;
    expect(sales.topPackages).toEqual([expect.objectContaining({ name: "10-class pack", sold: 1, share: 100 })]);
    expect(sales.chart.unit).toBe("week");
    expect(sales.chart.series.reduce((a: number, b: { cents: number }) => a + b.cents, 0)).toBe(28000);
    expect(sales.breakdown[0]).toMatchObject({ label: "Packages and memberships", share: 100 });

    const classes = (await s.owner.call("GET", "/reports/classes?days=30")).body;
    const cm = Object.fromEntries(classes.metrics.map((x: { key: string }) => [x.key, x]));
    expect(cm.visits.value, JSON.stringify(classes.metrics)).toBe(9);
    expect(cm.noshow.display).toBe("10%");
    expect(classes.byClassType[0]).toMatchObject({ name: "Reformer Pilates", classes: 2, averageBooked: 5, fill: 50 });

    const clients = (await s.owner.call("GET", "/reports/clients?days=30")).body;
    expect(clients.metrics.find((x: { key: string }) => x.key === "active").value).toBe(8); // different people: Chloe no-showed once but came the other time
    expect(clients.regulars[0].visits).toBe(2);

    const conv = (await s.owner.call("GET", "/reports/conversion?days=30")).body;
    expect(conv.metrics.map((x: { key: string }) => x.key)).toEqual(["paying", "second", "leads", "classpass"]);
    expect(conv.funnel.sources.map((x: { source: string }) => x.source)).toContain("classpass");

    expect((await s.owner.call("GET", "/reports/overview?days=45")).status).toBe(400);
    expect((await s.ana.call("GET", "/reports/overview")).status).toBe(403);
    expect((await s.c1.call("GET", "/reports/sales")).status).toBe(403);
  });
});
