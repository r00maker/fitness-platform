import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { adConversions, adsSettings, leads, memberships, notifications, users } from "../src/db/schema.js";
import { leadFollowUps, sendMetaConversions, setAdsFetch } from "../src/modules/marketing/ads.js";
import { deliverPending } from "../src/modules/notifications/deliver.js";
import { sha256 } from "../src/lib/secrets.js";
import { app, caller, config, db, outbox, pool, reset, studio, tokenFor } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const urls = { api: config.PUBLIC_API_URL, app: config.PUBLIC_APP_URL };
type Call = { url: string; body?: string; auth?: string | null };

/** Pretend to be Meta's Graph API: lead details by id, and accepting conversion events. */
function fakeMeta(leadsById: Record<string, Record<string, string>>, opts: { failEvents?: string } = {}) {
  const calls: Call[] = [];
  setAdsFetch((async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body as string | undefined, auth: new Headers(init?.headers).get("authorization") });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/events")) return opts.failEvents ? json(400, { error: { message: opts.failEvents } }) : json(200, { events_received: 1 });
    const id = decodeURIComponent(url.split("/").pop()!.split("?")[0]!);
    const l = leadsById[id];
    if (!l) return json(404, { error: { message: "Unknown lead" } });
    return json(200, { field_data: Object.entries(l).filter(([k]) => !["campaign", "ad"].includes(k)).map(([name, v]) => ({ name, values: [v] })), campaign_name: l.campaign, ad_name: l.ad });
  }) as typeof fetch);
  return calls;
}

async function setup() {
  const s = await studio();
  const email = (await s.owner.call("POST", "/emails", { name: "Lead welcome", design: { subject: "Your first class, {{first_name}}", blocks: [{ type: "text", text: "Hi {{first_name}}, here's your trial." }, { type: "button", label: "Book your trial", url: "{{join_link}}" }] } })).body;
  const reminder = (await s.owner.call("POST", "/emails", { name: "Lead reminder", design: { subject: "Still keen?", blocks: [{ type: "text", text: "Your trial is waiting." }] } })).body;
  const plan = (await s.owner.call("POST", "/package-plans", { name: "Trial pack", kind: "credits", credits: 3, priceCents: 5900, validityValue: 1, validityUnit: "months" })).body;
  const connect = (body: Record<string, unknown> = {}) =>
    s.owner.call("PATCH", "/ads/settings", { metaPageId: "1000001", metaPageToken: "EAAB-page-token-secret-0123456789", metaPixelId: "2000002", metaCapiToken: "EAAB-capi-token-secret-0123456789", metaSendConversions: true, googleFeedEnabled: true, leadFollowUp: true, leadFirstEmailId: email.id, leadReminderEmailId: reminder.id, ...body });
  const metaPost = (payload: unknown, secret = config.META_APP_SECRET!) => {
    const raw = JSON.stringify(payload);
    return app.inject({ method: "POST", url: "/v1/public/ads/meta/webhook", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}` }, payload: raw });
  };
  const metaLead = (leadgenId: string, pageId = "1000001") => ({ object: "page", entry: [{ id: pageId, time: 1, changes: [{ field: "leadgen", value: { leadgen_id: leadgenId, page_id: pageId, form_id: "F1" } }] }] });
  const join = async (first: string, email: string, body: Record<string, unknown> = {}, phone: string | null = null) => {
    const [u] = await db.insert(users).values({ firstName: first, lastName: "Lim", email, phone }).returning();
    const call = caller(await tokenFor(u!.id, s.orgId));
    const r = await call("POST", "/join", body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { id: u!.id, call };
  };
  return { s, email, reminder, plan, connect, metaPost, metaLead, join };
}

describe("ads settings", () => {
  it("stores access tokens encrypted, never shows them, and checks what's needed", async () => {
    const { s, connect } = await setup();
    const fresh = (await s.owner.call("GET", "/ads/settings")).body;
    expect(fresh.meta).toMatchObject({ pageConnected: false, conversionsConnected: false, webhookUrl: expect.stringMatching(/\/v1\/public\/ads\/meta\/webhook$/) });
    expect(fresh.google.feedUrl).toContain(`/v1/public/ads/google/${s.orgId}/conversions.csv?key=`);

    // Switching on conversions without the dataset and token is explained.
    expect((await s.owner.call("PATCH", "/ads/settings", { metaSendConversions: true })).body.error.code).toBe("meta_incomplete");
    expect((await s.owner.call("PATCH", "/ads/settings", { leadFollowUp: true })).body.error.code).toBe("no_email");

    const r = await connect();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain("token-secret");
    expect(r.body.meta).toMatchObject({ pageId: "1000001", pageConnected: true, conversionsConnected: true, sendConversions: true });
    const [row] = await db.select().from(adsSettings);
    expect(row!.metaPageToken).toMatch(/^v1:/);
    expect(row!.metaPageToken).not.toContain("EAAB-page-token-secret-0123456789");

    // Changing one thing leaves the rest; null removes a token.
    expect((await s.owner.call("PATCH", "/ads/settings", { leadReminderDays: 5 })).body).toMatchObject({ meta: { pageConnected: true }, followUp: { reminderDays: 5, enabled: true } });
    expect((await s.owner.call("PATCH", "/ads/settings", { metaPageToken: null })).body.meta.pageConnected).toBe(false);

    const before = (await s.owner.call("GET", "/ads/settings")).body.google;
    const after = (await s.owner.call("POST", "/ads/settings/rotate-google-keys")).body.google;
    expect(after.key).not.toBe(before.key);
    expect((await s.c1.call("GET", "/ads/settings")).status).toBe(403);
    expect((await s.ana.call("GET", "/leads")).status).toBe(403);
  });
});

describe("Meta lead ads", () => {
  it("verifies the webhook, rejects unsigned posts, and turns each lead into one followed-up lead", async () => {
    const { s, connect, metaPost, metaLead } = await setup();
    await connect();
    const calls = fakeMeta({ L1: { full_name: "Mei Ling Tan", email: "Mei@Example.com", phone_number: "+65 9123 4567", campaign: "November trial", ad: "Reformer video" } });

    const verify = (token: string) => app.inject({ method: "GET", url: `/v1/public/ads/meta/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=12345` });
    expect((await verify("wrong")).statusCode).toBe(401);
    const ok = await verify(config.META_VERIFY_TOKEN!);
    expect([ok.statusCode, ok.body]).toEqual([200, "12345"]);

    expect((await metaPost(metaLead("L1"), "not-the-secret")).statusCode).toBe(401);
    expect(await db.select().from(leads)).toHaveLength(0);

    const r = await metaPost(metaLead("L1"));
    expect(r.json()).toEqual({ received: 1 });
    // The lead was read with the studio's Page token.
    expect(calls[0]!.url).toContain("/L1?fields=");
    expect(calls[0]!.auth).toBe("Bearer EAAB-page-token-secret-0123456789");
    expect(calls[0]!.url).not.toContain("access_token"); // never in the address, where it could be logged
    // Meta sometimes sends the same lead twice.
    await metaPost(metaLead("L1"));
    // A page we don't know is ignored.
    await metaPost(metaLead("L1", "3000003"));

    const list = (await s.owner.call("GET", "/leads")).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Mei Ling Tan", firstName: "Mei", lastName: "Ling Tan", email: "mei@example.com", source: "meta", sourceLabel: "Meta (Facebook, Instagram)", status: "new", campaignName: "November trial", adName: "Reformer video" });
    expect(list[0].token).toBeUndefined();

    // The first email went to the lead (no account), with their own sign-up link and a way to stop.
    const [lead] = await db.select().from(leads);
    const [mail] = (await outbox("custom")).filter((n) => n.toEmail);
    expect(mail).toMatchObject({ userId: null, toEmail: "mei@example.com" });
    const d = mail!.data as { subject: string; html: string; unsubscribeUrl: string };
    expect(d.subject).toBe("Your first class, Mei");
    expect(d.html).toContain(`/join/${s.orgId}?lead=${lead!.token}`);
    expect(d.html).toContain("because you asked Test Studio about classes");
    expect(lead!.nextFollowUpAt!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    // And the team was told.
    const team = await outbox("lead.new");
    expect([...new Set(team.map((n) => n.userId))]).toEqual([s.owner.id]);
    expect(team[0]!.data).toMatchObject({ name: "Mei Ling Tan", campaign: "November trial" });

    // Delivery uses the lead's address.
    const sent: { to: string; subject: string }[] = [];
    await deliverPending(db, { email: { send: async (m) => void sent.push(m) }, push: { send: async () => {} } }, 50);
    expect(sent.map((m) => m.to)).toContain("mei@example.com");
  });

  it("saves a problem reading a lead so the studio can see it", async () => {
    const { s, connect, metaPost, metaLead } = await setup();
    await connect();
    fakeMeta({});
    await metaPost(metaLead("MISSING"));
    expect((await s.owner.call("GET", "/ads/settings")).body.meta.lastError).toMatch(/Couldn't read a lead from Meta: Unknown lead/);
  });
});

describe("Google lead form ads", () => {
  it("takes leads with the studio's key, keeps the click id, and skips follow-up for test leads", async () => {
    const { s, connect } = await setup();
    await connect();
    const key = (await s.owner.call("GET", "/ads/settings")).body.google.key;
    const post = (body: Record<string, unknown>) => app.inject({ method: "POST", url: `/v1/public/ads/google/${s.orgId}/leads`, payload: body });
    const cols = [{ column_id: "FULL_NAME", string_value: "Arjun Nair" }, { column_id: "EMAIL", string_value: "arjun@example.com" }, { column_id: "PHONE_NUMBER", string_value: "8123 4567" }];
    expect((await post({ google_key: "wrong", lead_id: "G1", user_column_data: cols })).statusCode).toBe(401);
    expect((await post({ google_key: key, lead_id: "G1", gcl_id: "GCLID-1", campaign_id: 99, user_column_data: cols })).statusCode).toBe(200);
    expect((await post({ google_key: key, lead_id: "T1", is_test: true, user_column_data: [{ column_id: "EMAIL", string_value: "test@example.com" }] })).statusCode).toBe(200);

    const rows = await db.select().from(leads);
    expect(rows.find((l) => l.externalId === "G1")).toMatchObject({ source: "google", firstName: "Arjun", lastName: "Nair", gclid: "GCLID-1", campaignName: "Campaign 99", isTest: false });
    expect(rows.find((l) => l.externalId === "T1")!.isTest).toBe(true);
    expect((await outbox("custom")).map((n) => n.toEmail)).toEqual(["arjun@example.com"]);
    expect(new Set((await outbox("lead.new")).map((n) => n.data && (n.data as { leadId: string }).leadId)).size).toBe(1);
  });

  it("recognises leads who are already clients, and the same person asking twice", async () => {
    const { s, connect } = await setup();
    await connect();
    const [chloe] = await db.select().from(users).where(eq(users.id, s.c1.id));
    const key = (await s.owner.call("GET", "/ads/settings")).body.google.key;
    const post = (lead: string, email: string, extra: Record<string, unknown> = {}) =>
      app.inject({ method: "POST", url: `/v1/public/ads/google/${s.orgId}/leads`, payload: { google_key: key, lead_id: lead, user_column_data: [{ column_id: "EMAIL", string_value: email }], ...extra } });
    await post("A", chloe!.email.toUpperCase());
    await post("B", "new@example.com");
    await post("C", "new@example.com", { gcl_id: "LATER" });
    const rows = await db.select().from(leads);
    expect(rows).toHaveLength(2);
    expect(rows.find((l) => l.externalId === "A")).toMatchObject({ status: "joined", clientId: s.c1.id, note: expect.stringMatching(/Already a client/) });
    expect(rows.find((l) => l.externalId === "B")!.gclid).toBe("LATER");
    // Only the genuinely new lead was emailed.
    expect((await outbox("custom")).map((n) => n.toEmail)).toEqual(["new@example.com"]);
  });
});

describe("from lead to paying client", () => {
  it("matches the lead when they join and buy, and reports both to Meta and Google", async () => {
    const { s, plan, connect, metaPost, metaLead, join } = await setup();
    await connect();
    const calls = fakeMeta({ L1: { first_name: "Mei", last_name: "Tan", email: "mei@example.com", phone_number: "9123 4567", campaign: "November trial" } });
    await metaPost(metaLead("L1"));
    const [lead] = await db.select().from(leads);

    // She joins from the link in the email, signed in with a different address.
    const mei = await join("Mei", "mei.tan@work.example", { leadToken: lead!.token, phone: "+65 9123 4567" });
    expect((await db.select().from(leads))[0]).toMatchObject({ status: "joined", clientId: mei.id, nextFollowUpAt: null });
    const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, mei.id), eq(memberships.orgId, s.orgId)));
    expect(m!.acquisition).toBe("meta_ads");

    // Someone else joins straight from a Google ad click, no form.
    const raj = await join("Raj", "raj@example.com", { attribution: { gclid: "CLICK-9", utm_source: "google" } });

    await s.owner.call("POST", `/clients/${mei.id}/packages`, { planId: plan.id });
    await s.owner.call("POST", `/clients/${mei.id}/packages`, { planId: plan.id }); // only the first counts
    await s.owner.call("POST", `/clients/${raj.id}/packages`, { planId: plan.id });
    expect((await db.select().from(leads))[0]).toMatchObject({ status: "bought", firstPurchaseCents: 5900 });

    const conv = await db.select().from(adConversions);
    const summary = conv.map((c) => `${c.platform}:${c.event}:${c.clientId === mei.id ? "mei" : "raj"}:${c.valueCents ?? ""}`).sort();
    expect(summary).toEqual(["google:purchase:raj:5900", "google:signup:raj:", "meta:purchase:mei:5900", "meta:signup:mei:"]);

    // Meta gets hashed details only, in one request.
    expect(await sendMetaConversions(db, config)).toBe(2);
    const sent = calls.find((c) => c.url.includes("/2000002/events"))!;
    expect(sent.auth).toBe("Bearer EAAB-capi-token-secret-0123456789");
    expect(sent.url).not.toContain("access_token");
    expect(sent.body).not.toContain("mei.tan@work.example");
    expect(sent.body).not.toContain("91234567");
    const events = JSON.parse(sent.body!).data;
    expect(events.map((e: { event_name: string }) => e.event_name).sort()).toEqual(["CompleteRegistration", "Purchase"]);
    const purchase = events.find((e: { event_name: string }) => e.event_name === "Purchase");
    expect(purchase).toMatchObject({ action_source: "system_generated", custom_data: { value: 59, currency: "SGD" }, user_data: { em: [sha256("mei.tan@work.example")], ph: [sha256("6591234567")], lead_id: "L1" } });
    expect(await sendMetaConversions(db, config)).toBe(0); // nothing sent twice

    // Google reads the CSV with the private key.
    const { feedUrl } = (await s.owner.call("GET", "/ads/settings")).body.google;
    const path = feedUrl.slice(feedUrl.indexOf("/v1/"));
    expect((await app.inject({ method: "GET", url: path.replace(/key=\w+/, "key=wrong") })).statusCode).toBe(401);
    const csv = (await app.inject({ method: "GET", url: path })).body.trim().split("\n");
    expect(csv[0]).toBe("Parameters:TimeZone=Asia/Singapore");
    expect(csv[1]).toBe("Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency");
    expect(csv.slice(2)).toEqual([
      expect.stringMatching(/^"CLICK-9","Studio sign-up","\d{4}-\d\d-\d\d \d\d:\d\d:\d\d","",""$/),
      expect.stringMatching(/^"CLICK-9","First purchase","[^"]+","59.00","SGD"$/),
    ]);

    // The funnel: 1 Meta lead → joined → bought, plus Raj straight from a Google ad.
    const f = (await s.owner.call("GET", "/ads/funnel?days=30")).body;
    expect(f.sources.find((x: { source: string }) => x.source === "meta")).toMatchObject({ leads: 1, joined: 1, bought: 1, revenueCents: 5900, leadToJoin: "100%", joinToBuy: "100%" });
    expect(f.sources.find((x: { source: string }) => x.source === "google")).toMatchObject({ leads: 0, joinedFromAdWithoutForm: 1, joined: 1, bought: 1, revenueCents: 5900 });
    expect(f.total).toMatchObject({ leads: 1, joined: 2, bought: 2, revenueCents: 11800 });
    expect(f.campaigns).toEqual([expect.objectContaining({ name: "November trial", leads: 1, bought: 1 })]);
  });

  it("keeps trying Meta and shows the error, then gives up after five tries", async () => {
    const { s, connect, join } = await setup();
    await connect();
    fakeMeta({}, { failEvents: "Invalid access token" });
    await join("Zoe", "zoe@example.com", { attribution: { fbclid: "FBCLICK" } });
    for (let i = 0; i < 5; i++) await sendMetaConversions(db, config);
    expect((await db.select().from(adConversions))[0]).toMatchObject({ status: "failed", attempts: 5, lastError: "Invalid access token" });
    expect((await s.owner.call("GET", "/ads/settings")).body.meta.lastError).toBe("Invalid access token");
  });

  it("matches a lead by email when they join without the link", async () => {
    const { s, connect, join } = await setup();
    await connect({ leadFollowUp: false });
    await s.owner.call("POST", "/leads", { firstName: "Walk", lastName: "In", email: "walkin@example.com" });
    await join("Walk", "WalkIn@example.com");
    expect((await db.select().from(leads))[0]).toMatchObject({ source: "manual", status: "joined" });
    // A manual lead isn't an ad, so nothing is reported.
    expect(await db.select().from(adConversions)).toHaveLength(0);
  });
});

describe("following up", () => {
  it("sends one reminder to leads who haven't joined, unless they asked to stop", async () => {
    const { s, connect } = await setup();
    await connect();
    const a = (await s.owner.call("POST", "/leads", { firstName: "Amy", email: "amy@example.com" })).body;
    const b = (await s.owner.call("POST", "/leads", { firstName: "Bo", email: "bo@example.com" })).body;
    expect((await s.owner.call("POST", "/leads", { firstName: "Bo", email: "BO@example.com" })).body.duplicate).toBe(true);
    expect((await s.owner.call("POST", "/leads", { firstName: "Nobody" })).status).toBe(400);

    // Bo stops the emails from the link (GET only asks; POST stops).
    const [bo] = await db.select().from(leads).where(eq(leads.id, b.id));
    const page = await app.inject({ method: "GET", url: `/v1/unsubscribe/lead/${bo!.token}` });
    expect(page.body).toContain("Stop these emails?");
    const stop = await app.inject({ method: "POST", url: `/v1/unsubscribe/lead/${bo!.token}`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "List-Unsubscribe=One-Click" });
    expect(stop.statusCode).toBe(200);

    expect(await leadFollowUps(db, urls)).toBe(0); // not due yet
    expect(await leadFollowUps(db, urls, new Date(Date.now() + 4 * 86_400_000))).toBe(1);
    const reminders = (await outbox("custom")).filter((n) => (n.data as { subject: string }).subject === "Still keen?");
    expect(reminders.map((n) => n.toEmail)).toEqual(["amy@example.com"]);
    expect(await leadFollowUps(db, urls, new Date(Date.now() + 8 * 86_400_000))).toBe(0); // just the one

    // Staff mark progress; joined leads follow what the client does.
    expect((await s.owner.call("PATCH", `/leads/${a.id}`, { status: "contacted", note: "Called, coming Sat" })).body).toMatchObject({ status: "contacted", note: "Called, coming Sat" });
    expect((await s.owner.call("GET", "/leads?q=amy")).body).toHaveLength(1);
    expect((await s.owner.call("GET", "/leads?status=contacted")).body.map((l: { firstName: string }) => l.firstName)).toEqual(["Amy"]);
  });

  it("erases a lead completely, including emails still waiting to go", async () => {
    const { s, connect } = await setup();
    await connect();
    const a = (await s.owner.call("POST", "/leads", { firstName: "Amy", email: "amy@example.com" })).body;
    expect((await db.select().from(notifications)).some((n) => n.toEmail === "amy@example.com")).toBe(true);
    expect((await s.owner.call("DELETE", `/leads/${a.id}`)).status).toBe(204);
    expect(await db.select().from(leads)).toHaveLength(0);
    expect((await db.select().from(notifications)).some((n) => n.toEmail === "amy@example.com")).toBe(false);
  });
});
