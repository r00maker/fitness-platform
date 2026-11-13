import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { bookings, classSessions, commsBilling, commsMessages, conversations, locations, rooms, users, whatsappSettings } from "../src/db/schema.js";
import { creditPurchasePaid } from "../src/modules/comms/billing.js";
import { setWhatsappFetch } from "../src/modules/comms/wa-api.js";
import { app, config, dayOffset, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterEach(() => { delete process.env.WHATSAPP_RATE_CARD; });
afterAll(async () => {
  await app.close();
  await pool.end();
});

const DAY = 86_400_000;
const ACK = ["possible_duplicate", "instructor_double_booked", "room_double_booked", "late_booking", "outside_booking_window", "short_notice", "no_free_cancel", "many_classes"];

async function setup() {
  const s = await studio();
  const cls = (body: Record<string, unknown> = {}) =>
    s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, date: dayOffset(3), startTime: "09:00", acknowledge: ACK, ...body });
  return { s, cls };
}

describe("bookings without a package", () => {
  it("staff can book anyway only if the studio allows it", async () => {
    const { s, cls } = await setup();
    await s.owner.call("PATCH", "/settings", { clientsNeedPackage: true });
    const c = (await cls()).body;
    const ask = await s.owner.call("POST", "/bookings", { sessionId: c.id, clientId: s.c1.id });
    expect(ask.body.error.flags.map((f: { code: string }) => f.code)).toEqual(["no_package"]);
    expect((await s.owner.call("POST", "/bookings", { sessionId: c.id, clientId: s.c1.id, acknowledge: ["no_package"] })).body.payment).toBe("pay_later");

    expect((await s.owner.call("PATCH", "/settings", { allowBookingWithoutPackage: false })).body.allowBookingWithoutPackage).toBe(false);
    const no = await s.owner.call("POST", "/bookings", { sessionId: c.id, clientId: s.c2.id, acknowledge: ["no_package"] });
    expect(no.status).toBe(409);
    expect(no.body.error).toMatchObject({ code: "package_required", message: expect.stringMatching(/only allows bookings with a package/) });
    expect((await s.owner.call("POST", "/bookings", { sessionId: c.id, clientId: s.c2.id, complimentary: true })).body.payment).toBe("complimentary");
    expect((await s.c3.call("POST", "/bookings", { sessionId: c.id, acknowledge: ACK })).body.error.code).toBe("package_needed");
  });
});

describe("changing many classes", () => {
  it("chooses classes by filter across months, previews them, and changes anything the creator can", async () => {
    const { s, cls } = await setup();
    const series = await s.owner.call("POST", "/series", { classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, capacity: 12, durationMinutes: 50, startTime: "07:00", daysOfWeek: [1, 3], startDate: dayOffset(1), occurrences: 26, acknowledge: ACK });
    expect(series.status, JSON.stringify(series.body)).toBe(201);
    const other = (await cls({ startTime: "18:00", instructorId: s.ben.id })).body;
    await s.c1.call("POST", "/bookings", { sessionId: series.body.sessions[0].id, acknowledge: ACK });
    const filter = { from: dayOffset(0), to: dayOffset(120), weekdays: [1], startTimes: ["07:00"] };

    const preview = (await s.owner.call("POST", "/sessions/bulk-preview", { filter })).body;
    expect(preview.count).toBe(13);
    expect(preview.sample).toHaveLength(8);
    expect(preview.text).toMatch(/^13 classes/);

    const changes = { instructorId: s.ben.id, capacity: 8, startTime: "07:30", classpassEnabled: true, classpassSpots: 2, autoCancel: { hoursBefore: 6, minBookings: 2 }, notes: "Bring a mat" };
    const r = await s.owner.call("POST", "/sessions/bulk-update", { filter, changes, notifyClients: false, acknowledge: [...ACK, "clients_affected"] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.updated).toHaveLength(13);
    const rows = await db.select().from(classSessions);
    const mondays = rows.filter((x) => x.seriesId && x.instructorId === s.ben.id);
    expect(mondays).toHaveLength(13);
    expect(mondays.every((x) => x.capacity === 8 && x.classpassSpots === 2 && x.autoCancelMin === 2 && x.notes === "Bring a mat")).toBe(true);
    expect(rows.filter((x) => x.seriesId && x.instructorId === s.ana.id)).toHaveLength(13); // Wednesdays untouched
    expect(rows.find((x) => x.id === other.id)!.capacity).toBe(10);

    // Moving location needs a room there.
    const [hv] = await db.insert(locations).values({ orgId: s.orgId, name: "Holland Village", timezone: "Asia/Singapore" }).returning();
    const [hvRoom] = await db.insert(rooms).values({ orgId: s.orgId, locationId: hv!.id, name: "Main Studio", capacity: 20 }).returning();
    const wed = { from: dayOffset(0), to: dayOffset(120), weekdays: [3] };
    expect((await s.owner.call("POST", "/sessions/bulk-update", { filter: wed, changes: { locationId: hv!.id }, acknowledge: ACK })).body.error.code).toBe("room_needed");
    const moved = await s.owner.call("POST", "/sessions/bulk-update", { filter: wed, changes: { locationId: hv!.id, roomId: hvRoom!.id }, acknowledge: ACK });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect((await db.select().from(classSessions).where(eq(classSessions.locationId, hv!.id))).length).toBe(13);

    // Cancel by filter too.
    const cancel = await s.owner.call("POST", "/sessions/bulk-cancel", { filter: { from: dayOffset(0), to: dayOffset(120), instructorIds: [s.ben.id], startTimes: ["18:00"] }, notifyClients: false, acknowledge: ACK });
    expect(cancel.body.cancelled).toHaveLength(1);

    // Guard rails.
    expect((await s.owner.call("POST", "/sessions/bulk-preview", { filter: { from: dayOffset(0), to: dayOffset(500) } })).status).toBe(400);
    expect((await s.owner.call("POST", "/sessions/bulk-update", { filter, sessionIds: [other.id], changes: { capacity: 9 } })).status).toBe(400);
    expect((await s.owner.call("POST", "/sessions/bulk-update", { filter: { from: dayOffset(200), to: dayOffset(210) }, changes: { capacity: 9 } })).body.error.code).toBe("no_classes");
    expect((await s.ana.call("POST", "/sessions/bulk-preview", { filter })).status).toBe(403);
  });
});

describe("instructor reports", () => {
  it("lists everyone who teaches and drills into one; instructors see only their own", async () => {
    const { s } = await setup();
    const past = async (instructorId: string, daysAgo: number, booked: number) => {
      const startsAt = new Date(Date.now() - daysAgo * DAY);
      const [c] = await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, instructorId, startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000), capacity: 10 }).returning();
      const people = [s.c1, s.c2, s.c3];
      for (let i = 0; i < booked; i++) await db.insert(bookings).values({ orgId: s.orgId, sessionId: c!.id, clientId: people[i]!.id, source: "staff", attendance: "present" });
    };
    await past(s.ana.id, 3, 3); await past(s.ana.id, 10, 2); await past(s.ben.id, 4, 1);
    const list = (await s.owner.call("GET", "/reports/instructors?days=30")).body.instructors;
    expect(list.map((x: { name: string }) => x.name.split(" ")[0])).toEqual(["Ana", "Ben"]);
    expect(list[0]).toMatchObject({ classes: 2, averageBooked: 2.5, fill: 25, visits: 5 });
    const ana = (await s.owner.call("GET", `/reports/instructors/${s.ana.id}?days=30`)).body;
    expect(ana.instructor.name).toMatch(/^Ana/);
    expect(ana.metrics.find((m: { key: string }) => m.key === "average").display).toBe("2.5");
    expect(ana.regulars[0]).toMatchObject({ visits: 2 });
    expect((await s.ana.call("GET", `/reports/instructors/${s.ana.id}`)).status).toBe(200);
    expect((await s.ana.call("GET", `/reports/instructors/${s.ben.id}`)).status).toBe(403);
    expect((await s.ana.call("GET", "/reports/instructors")).status).toBe(403);
    expect((await s.owner.call("GET", `/reports/instructors/${s.c1.id}`)).status).toBe(404);
    const filtered = (await s.owner.call("GET", `/reports/classes?days=30&instructorId=${s.ben.id}`)).body;
    expect(filtered.metrics.find((m: { key: string }) => m.key === "held").value).toBe(1);
    expect(filtered.filters).toEqual({ instructorId: s.ben.id });
  });
});

describe("communication inbox", () => {
  const sent: { url: string; body?: Record<string, unknown> }[] = [];
  const fakeMeta = (fail = false) => {
    sent.length = 0;
    let n = 0;
    setWhatsappFetch((async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (url.includes("oauth/access_token")) return json(200, { access_token: "EAAG-studio-token-0123456789" });
      if (url.includes("subscribed_apps")) return json(200, { success: true });
      if (url.includes("/messages")) return fail ? json(400, { error: { message: "Recipient phone number not on WhatsApp" } }) : json(200, { messages: [{ id: `wamid.${++n}` }] });
      return json(200, { display_phone_number: "+65 6123 4567", verified_name: "Test Studio" });
    }) as typeof fetch);
  };
  const hook = (payload: unknown, secret = config.META_APP_SECRET!) => {
    const raw = JSON.stringify(payload);
    return app.inject({ method: "POST", url: "/v1/public/comms/whatsapp/webhook", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }, payload: raw });
  };
  const inbound = (from: string, text: string, id: string, field = "messages") => ({
    entry: [{ changes: [{ field, value: field === "messages"
      ? { metadata: { phone_number_id: "1112223334" }, contacts: [{ wa_id: from, profile: { name: "Chloe T" } }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] }
      : { metadata: { phone_number_id: "1112223334" }, message_echoes: [{ from: "6561234567", to: from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }],
  });
  async function connected(s: Awaited<ReturnType<typeof studio>>, billing: Record<string, unknown> = { mode: "meta_direct", paymentMethodAdded: true }) {
    fakeMeta();
    await s.owner.call("PUT", "/comms/billing", billing);
    const r = await s.owner.call("POST", "/comms/whatsapp/connect", { code: "one-time-code-123", businessAccountId: "9876543210", phoneNumberId: "1112223334", coexistence: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await s.owner.call("POST", "/whatsapp/templates", { name: "class_promo", language: "en", body: "Hi {{1}}, new classes this week!", category: "marketing" });
    await s.owner.call("POST", "/whatsapp/templates", { name: "booking_update", language: "en", body: "Hi {{1}}, your class has moved.", category: "utility" });
    await db.update(users).set({ phone: "9123 4567" }).where(eq(users.id, s.c1.id));
  }

  it("needs payment set up before connecting, and keeps the token secret", async () => {
    const { s } = await setup();
    fakeMeta();
    const st = (await s.owner.call("GET", "/comms/status")).body;
    expect(st.billing).toMatchObject({ mode: "none", ready: false, creditsOffered: false });
    expect(st.notice).toMatch(/Meta charges for WhatsApp messages/);
    expect((await s.owner.call("POST", "/comms/whatsapp/connect", { code: "one-time-code-123", businessAccountId: "9876543210", phoneNumberId: "1112223334" })).body.error.code).toBe("billing_not_set_up");
    expect((await s.owner.call("PUT", "/comms/billing", { mode: "credits" })).body.error.code).toBe("credits_unavailable");
    expect((await s.owner.call("PUT", "/comms/billing", { mode: "meta_direct", paymentMethodAdded: false })).status).toBe(400);
    await connected(s);
    const after = (await s.owner.call("GET", "/comms/status")).body;
    expect(after).toMatchObject({ billing: { mode: "meta_direct", ready: true }, whatsapp: { connected: true, coexistence: true, phone: "+65 6123 4567" } });
    expect(JSON.stringify(after)).not.toContain("studio-token");
    expect((await db.select().from(whatsappSettings))[0]!.accessToken).toMatch(/^v1:/);
    expect(sent.some((x) => x.url.includes("9876543210/subscribed_apps"))).toBe(true);
    // Front of House can read and reply, but not change payment or the connection.
    const fiona = await person(s.orgId, "front_desk", "Fiona");
    expect((await fiona.call("GET", "/comms/conversations")).status).toBe(200);
    expect((await fiona.call("PUT", "/comms/billing", { mode: "meta_direct", paymentMethodAdded: true })).status).toBe(403);
    expect((await s.ana.call("GET", "/comms/conversations")).status).toBe(403);
  });

  it("shows messages from clients and from the phone app in one thread, and replies within 24 hours", async () => {
    const { s } = await setup();
    await connected(s);
    expect((await hook(inbound("6591234567", "Hi! Can I book Saturday?", "wamid.in1"), "wrong-secret")).statusCode).toBe(401);
    expect((await hook(inbound("6591234567", "Hi! Can I book Saturday?", "wamid.in1"))).json()).toEqual({ handled: 1 });
    await hook(inbound("6591234567", "Hi! Can I book Saturday?", "wamid.in1")); // Meta can send it twice
    await hook(inbound("6591234567", "Sure, see you then!", "wamid.echo1", "smb_message_echoes"));
    const list = (await s.owner.call("GET", "/comms/conversations")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ contact: "6591234567", isClient: true, unread: 1, replyWindowOpen: true });
    expect(list[0].clientId).toBe(s.c1.id);
    const thread = (await s.owner.call("GET", `/comms/conversations/${list[0].id}`)).body;
    expect(thread.messages.map((m: { origin: string }) => m.origin)).toEqual(["contact", "phone_app"]);
    expect(thread.canReply.freeText).toBe(true);

    const r = await s.owner.call("POST", `/comms/conversations/${list[0].id}/messages`, { text: "Booked you in for 9am!" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: "sent", externalId: "wamid.1", costCents: 0 });
    expect(sent.find((x) => x.url.endsWith("/1112223334/messages"))!.body).toMatchObject({ to: "6591234567", type: "text", text: { body: "Booked you in for 9am!" } });
    // Delivery updates arrive later.
    await hook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1112223334" }, statuses: [{ id: "wamid.1", status: "read" }] } }] }] });
    expect((await db.select().from(commsMessages).where(eq(commsMessages.externalId, "wamid.1")))[0]!.status).toBe("read");
    expect((await s.owner.call("POST", `/comms/conversations/${list[0].id}/read`)).body).toEqual({ unread: 0 });

    // After 24 hours only templates, and it says what Meta charges before sending anything.
    await db.update(conversations).set({ lastInboundAt: new Date(Date.now() - 2 * DAY) });
    expect((await s.owner.call("POST", `/comms/conversations/${list[0].id}/messages`, { text: "Still coming?" })).body.error.code).toBe("window_closed");
    const before = sent.length;
    const ask = await s.owner.call("POST", `/comms/conversations/${list[0].id}/template`, { template: "booking_update", language: "en", variables: ["Chloe"] });
    expect(ask.body.error.flags[0]).toMatchObject({ code: "whatsapp_charge", message: expect.stringMatching(/billed to your WhatsApp account/) });
    expect(sent.length).toBe(before); // nothing went out
    const ok = await s.owner.call("POST", `/comms/conversations/${list[0].id}/template`, { template: "booking_update", language: "en", variables: ["Chloe"], acknowledge: ["whatsapp_charge"] });
    expect(ok.body).toMatchObject({ status: "sent", kind: "template", body: "Hi Chloe, your class has moved." });
  });

  it("on credits: buys credits (added once paid), charges per message, refunds failures, and never overspends", async () => {
    const { s } = await setup();
    process.env.WHATSAPP_RATE_CARD = JSON.stringify({ "65": { marketing: 6.5, utility: 2.2 } });
    await connected(s, { mode: "credits" });
    const buy = await s.owner.call("POST", "/comms/credits/purchases", { amountCents: 2000 });
    expect(buy.status).toBe(201);
    expect((await s.owner.call("GET", "/comms/credits")).body.balanceCents).toBe(0);
    // Nothing to spend yet: a marketing message is refused before it's sent.
    await db.update(users).set({ phone: "9123 4567" }).where(eq(users.id, s.c1.id));
    const { memberships } = await import("../src/db/schema.js");
    await db.update(memberships).set({ marketingWhatsapp: true }).where(eq(memberships.userId, s.c1.id));
    const broke = await s.owner.call("POST", "/comms/conversations", { clientId: s.c1.id, template: "class_promo", language: "en", variables: ["Chloe"], acknowledge: ["whatsapp_charge"] });
    expect(broke.body.error.code).toBe("not_enough_credits");
    expect(sent.filter((x) => x.url.endsWith("/messages"))).toHaveLength(0);

    await db.transaction((tx) => creditPurchasePaid(tx, buy.body.purchase.id, "stripe", "pi_123"));
    await db.transaction((tx) => creditPurchasePaid(tx, buy.body.purchase.id, "stripe", "pi_123")); // twice is fine
    expect((await s.owner.call("GET", "/comms/credits")).body.balanceCents).toBe(2000);
    const ask = await s.owner.call("POST", "/comms/conversations", { clientId: s.c1.id, template: "class_promo", language: "en", variables: ["Chloe"] });
    expect(ask.body.error.flags[0].message).toMatch(/uses US\$0\.07 of your message credits \(US\$20\.00 left\)/);
    const r = await s.owner.call("POST", "/comms/conversations", { clientId: s.c1.id, template: "class_promo", language: "en", variables: ["Chloe"], acknowledge: ["whatsapp_charge"] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.message).toMatchObject({ status: "sent", costCents: 6.5 });
    expect((await db.select().from(commsBilling))[0]!.balanceCents).toBe("1993.50");
    // Meta later says it failed: the credits come back.
    await hook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1112223334" }, statuses: [{ id: r.body.message.externalId, status: "failed", errors: [{ message: "Message undeliverable" }] }] } }] }] });
    expect((await s.owner.call("GET", "/comms/credits")).body).toMatchObject({ balanceCents: 2000, ledger: [{ reason: "refund" }, { reason: "message" }, { reason: "purchase" }] });

    // Someone who hasn't said yes to WhatsApp marketing can't be sent a marketing message out of the blue.
    await db.update(users).set({ phone: "8123 4567" }).where(eq(users.id, s.c2.id));
    expect((await s.owner.call("POST", "/comms/conversations", { clientId: s.c2.id, template: "class_promo", language: "en", variables: ["Dev"], acknowledge: ["whatsapp_charge"] })).body.error.code).toBe("no_consent");
    // A send that fails straight away is refunded at once.
    fakeMeta(true);
    const failed = await s.owner.call("POST", "/comms/conversations", { clientId: s.c2.id, template: "booking_update", language: "en", variables: ["Dev"], acknowledge: ["whatsapp_charge"] });
    expect(failed.body.message).toMatchObject({ status: "failed", error: "Recipient phone number not on WhatsApp" });
    expect((await s.owner.call("GET", "/comms/credits")).body.balanceCents).toBe(2000);
  });
});
