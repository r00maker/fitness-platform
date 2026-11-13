import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { acquisitionFrom } from "@studio/shared";
import { clientTags, clientTagAssignments, journeyEnrollments, memberships, notifications, organizations, users } from "../src/db/schema.js";
import { runDueJourneys, scanJourneyTriggers } from "../src/modules/marketing/journeys.js";
import { keepOverdueGiftCards } from "../src/modules/marketing/giftcards.js";
import { renderEmail } from "../src/modules/marketing/email.js";
import { app, db, dayOffset, minutesFromNow, outbox, pool, reset, studio, tokenFor, caller } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4000000000049454e44ae426082", "hex");
const urls = { api: "https://api.example.com", app: "https://app.example.com" };
const HOUR = 3_600_000;
const DAY = 86_400_000;

async function setup(org: Partial<typeof organizations.$inferInsert> = {}) {
  const s = await studio();
  if (Object.keys(org).length) await db.update(organizations).set(org).where(eq(organizations.id, s.orgId));
  let n = 0;
  /** A class that started 10 minutes ago, so it can be booked by staff and attendance taken. */
  const liveClass = async () => {
    const t = minutesFromNow(-10 - n++);
    const r = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, ...t, acknowledge: ["unusual_start_time", "in_the_past", "possible_duplicate", "instructor_double_booked", "room_double_booked", "ends_after_midnight"] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const attend = async (clientId: string, times = 1) => {
    for (let i = 0; i < times; i++) {
      const b = await s.owner.call("POST", "/bookings", { sessionId: await liveClass(), clientId, acknowledge: ["late_booking", "client_double_booked", "outside_booking_window"] });
      expect(b.status, JSON.stringify(b.body)).toBe(201);
      expect((await s.owner.call("PUT", `/bookings/${b.body.id}/attendance`, { attendance: "present" })).status).toBe(200);
    }
  };
  const plan = async (body: Record<string, unknown> = {}) => (await s.owner.call("POST", "/package-plans", { name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months", ...body })).body;
  const consent = (id: string, on = true) => db.update(memberships).set({ marketingEmail: on, marketingPush: on }).where(and(eq(memberships.userId, id), eq(memberships.orgId, s.orgId)));
  const upload = (purpose: string) =>
    app.inject({ method: "POST", url: `/v1/files?purpose=${purpose}`, headers: { authorization: `Bearer ${s.owner.token}`, "content-type": "image/png" }, payload: PNG }).then((r) => r.json());
  /** A brand-new person joining the studio. */
  const join = async (first: string, body: Record<string, unknown> = {}, phone?: string) => {
    const [u] = await db.insert(users).values({ firstName: first, lastName: "New", email: `${first.toLowerCase()}${Math.random().toString(36).slice(2, 6)}@example.com`, phone: phone ?? null }).returning();
    const call = caller(await tokenFor(u!.id, s.orgId));
    const r = await call("POST", "/join", body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return { id: u!.id, call, body: r.body };
  };
  return { s, attend, plan, consent, upload, join, liveClass };
}

describe("segments", () => {
  it("filters clients by classes, spend, recency, tags and packages, and saves segments", async () => {
    const { s, attend, plan } = await setup();
    await attend(s.c1.id, 3);
    await attend(s.c2.id, 1);
    const p = await plan();
    await s.owner.call("POST", `/clients/${s.c1.id}/packages`, { planId: p.id });
    const [tag] = await db.insert(clientTags).values({ orgId: s.orgId, name: "VIP" }).returning();
    await db.insert(clientTagAssignments).values({ orgId: s.orgId, clientId: s.c2.id, tagId: tag!.id });

    const filter = (definition: unknown, extra: Record<string, unknown> = {}) => s.owner.call("POST", "/clients/filter", { definition, ...extra }).then((r) => r.body);
    const names = (r: { clients: { firstName: string }[] }) => r.clients.map((c) => c.firstName).sort();

    expect(names(await filter({ match: "all", rules: [{ field: "classesAttended", op: "at_least", value: 2 }] }))).toEqual(["Chloe"]);
    expect(names(await filter({ match: "all", rules: [{ field: "classesAttended", op: "at_most", value: 0 }] }))).toEqual(["Eve"]);
    expect(names(await filter({ match: "all", rules: [{ field: "nettSpend", op: "at_least", value: 20000 }] }))).toEqual(["Chloe"]);
    expect(names(await filter({ match: "all", rules: [{ field: "daysSinceLastClass", op: "at_most", value: 7 }] }))).toEqual(["Chloe", "Dev"]);
    expect(names(await filter({ match: "any", rules: [{ field: "tags", ids: [tag!.id] }, { field: "hasActivePackage", value: "yes" }] }))).toEqual(["Chloe", "Dev"]);
    expect(names(await filter({ match: "all", rules: [{ field: "notTags", ids: [tag!.id] }, { field: "classesAttended", op: "between", value: 1, value2: 5 }] }))).toEqual(["Chloe"]);
    expect(names(await filter({ match: "all", rules: [{ field: "creditsLeft", op: "at_least", value: 10 }] }))).toEqual(["Chloe"]);

    // The numbers marketers need are in each row, and the rules read in plain English.
    const r = await filter({ match: "all", rules: [{ field: "classesAttended", op: "at_least", value: 1, withinDays: 30 }] }, { sort: "classes" });
    expect(r.clients[0]).toMatchObject({ firstName: "Chloe", classesAttended: 3, nettSpend: "SGD 280.00" });
    expect(r.rules).toEqual(["Classes attended: at least 1 in the last 30 days"]);

    // Bad rules are explained.
    expect((await s.owner.call("POST", "/segments/preview", { match: "all", rules: [{ field: "classesAttended", op: "between", value: 5, value2: 2 }] })).body.error.fields["rules.0"]).toMatch(/smallest first/);

    const saved = await s.owner.call("POST", "/segments", { name: "Regulars", definition: { match: "all", rules: [{ field: "classesAttended", op: "at_least", value: 2 }] } });
    expect(saved.body.count).toBe(1);
    expect((await s.owner.call("GET", "/segments")).body[0]).toMatchObject({ name: "Regulars", count: 1, rules: ["Classes attended: at least 2"] });
    expect(names(await s.owner.call("POST", "/clients/filter", { segmentId: saved.body.id }).then((x) => x.body))).toEqual(["Chloe"]);
    // Clients and instructors can't see any of this.
    expect((await s.c1.call("POST", "/clients/filter", {})).status).toBe(403);
    expect((await s.ana.call("GET", "/segments")).status).toBe(403);
  });
});

describe("email builder", () => {
  const design = (blocks: unknown[], subject = "Hi {{first_name}}") => ({ subject, preheader: "", blocks });

  it("renders safe, personalised HTML and refuses unknown tags and unsafe links", async () => {
    const { s, upload } = await setup();
    const img = await upload("email_image");
    expect(img.publicUrl).toMatch(/\/v1\/public\/files\//);
    const ok = await s.owner.call("POST", "/emails", {
      name: "Hello",
      design: design([
        { type: "heading", text: "Hello {{first_name}} <script>alert(1)</script>" },
        { type: "text", text: "**Bold**, *italic* and [our site](https://studio.example.com)\nNew line" },
        { type: "image", fileId: img.id, alt: "Our studio" },
        { type: "button", label: "Book now", url: "https://studio.example.com/book" },
        { type: "columns", columns: [[{ type: "text", text: "Left" }], [{ type: "text", text: "Right" }]] },
      ]),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const preview = await s.owner.call("POST", "/emails/preview", { design: ok.body.design, purpose: "marketing" });
    expect(preview.body.subject).toBe("Hi Chloe");
    expect(preview.body.html).not.toContain("<script>");
    expect(preview.body.html).toContain("&lt;script&gt;");
    expect(preview.body.html).toContain("<strong>Bold</strong>");
    expect(preview.body.html).toContain('href="https://studio.example.com"');
    expect(preview.body.html).toContain("Unsubscribe");
    expect(preview.body.text).toContain("our site (https://studio.example.com)");
    // Public image address works without signing in.
    expect((await app.inject({ method: "GET", url: `/v1/public/files/${img.id}` })).statusCode).toBe(200);

    expect((await s.owner.call("POST", "/emails", { name: "Bad", design: design([{ type: "text", text: "Hi {{frist_name}}" }]) })).body.error.message).toMatch(/\{\{frist_name\}\} isn't something we can fill in/);
    expect((await s.owner.call("POST", "/emails", { name: "Bad", design: design([{ type: "button", label: "x", url: "javascript:alert(1)" }]) })).status).toBe(400);
    // Links in text that aren't http(s)/mailto are shown as plain text.
    const html = renderEmail(
      { subject: "x", preheader: "", theme: { background: "#ffffff", content: "#ffffff", text: "#000000", accent: "#0e6b5f", font: "sans", buttonShape: "rounded" }, blocks: [{ type: "text", text: "[click](javascript:alert(1))", align: "left" }] },
      { studioName: "S", publicApiUrl: urls.api, appUrl: urls.app, values: {}, plans: new Map(), unsubscribeUrl: null },
    ).html;
    expect(html).not.toContain("javascript:");
  });

  it("sends a campaign only to people who agreed, after confirming, with a working unsubscribe link", async () => {
    const { s, consent } = await setup();
    await consent(s.c1.id);
    await consent(s.c2.id);
    const email = (await s.owner.call("POST", "/emails", { name: "News", design: design([{ type: "text", text: "New classes, {{first_name}}!" }]) })).body;
    const camp = (await s.owner.call("POST", "/campaigns", { name: "November news", emailId: email.id })).body;
    const first = await s.owner.call("POST", `/campaigns/${camp.id}/send`, {});
    expect(first.status).toBe(409);
    expect(first.body.error.flags[0].message).toMatch(/to 2 people now/);
    const sent = await s.owner.call("POST", `/campaigns/${camp.id}/send`, { acknowledge: ["send_to_many"] });
    expect(sent.body.campaign).toMatchObject({ status: "sent", recipients: 2, skipped: 1 });
    expect(sent.body.flags.find((f: { code: string }) => f.code === "people_skipped").message).toMatch(/1 of the 3/);
    const msgs = (await outbox("custom")).filter((m) => m.channel === "email");
    expect(msgs.map((m) => m.userId).sort()).toEqual([s.c1.id, s.c2.id].sort());
    const d = msgs[0]!.data as { html: string; unsubscribeUrl: string };
    expect(d.html).toContain("Unsubscribe");
    // Sending twice isn't possible.
    expect((await s.owner.call("POST", `/campaigns/${camp.id}/send`, { acknowledge: ["send_to_many"] })).body.error.code).toBe("already_sent");

    // Unsubscribe: the link shows a button (so mail scanners can't unsubscribe anyone); posting unsubscribes.
    const path = new URL(d.unsubscribeUrl).pathname;
    expect((await app.inject({ method: "GET", url: path })).body).toContain("<button");
    await app.inject({ method: "POST", url: path });
    const [m] = await db.select().from(memberships).where(eq(memberships.unsubscribeToken, path.split("/").pop()!));
    expect(m!.marketingEmail).toBe(false);
  });
});

describe("email builder: fonts, icons, categories, deleting and duplicating", () => {
  it("renders web fonts with fallbacks and icon social links, and groups emails by category", async () => {
    const { s } = await setup();
    const e = await s.owner.call("POST", "/emails", {
      name: "Brand",
      category: "Newsletters",
      design: { subject: "Hi", theme: { font: "lato", headingFont: "playfair", accent: "#BE185D" }, blocks: [{ type: "heading", text: "Hello" }, { type: "social", style: "icons", links: { instagram: "https://instagram.com/x", website: "https://x.example.com" } }] },
    });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    const html = (await s.owner.call("POST", "/emails/preview", { design: e.body.design })).body.html as string;
    expect(html).toContain("fonts.googleapis.com/css2?family=Lato");
    expect(html).toContain("family=Playfair+Display");
    expect(html).toContain("'Playfair Display', Georgia, serif");
    expect(html).toMatch(/<img src="[^"]+\/v1\/public\/social\/instagram\.png" width="32"/);
    expect((await app.inject({ method: "GET", url: "/v1/public/social/instagram.png" })).headers["content-type"]).toBe("image/png");
    expect((await s.owner.call("POST", "/emails", { name: "Bad font", design: { subject: "x", theme: { font: "comic" }, blocks: [{ type: "text", text: "x" }] } })).status).toBe(400);
    await s.owner.call("POST", "/emails", { name: "Other", category: "Promotions", design: { subject: "x", blocks: [{ type: "text", text: "x" }] } });
    expect((await s.owner.call("GET", "/emails?category=Newsletters")).body.map((x: { name: string }) => x.name)).toEqual(["Brand"]);
    expect((await s.owner.call("GET", "/marketing/options")).body.emailCategories).toEqual(expect.arrayContaining(["Newsletters", "Promotions", "Onboarding"]));
  });

  it("deletes emails not in use, keeps campaign history, and duplicates and deletes campaigns", async () => {
    const { s, consent } = await setup();
    await consent(s.c1.id);
    const email = (await s.owner.call("POST", "/emails", { name: "News", design: { subject: "News", blocks: [{ type: "text", text: "Hi" }] } })).body;
    const camp = (await s.owner.call("POST", "/campaigns", { name: "October", emailId: email.id })).body;
    const j = (await s.owner.call("POST", "/journeys", { name: "Welcome", category: "Onboarding", definition: { trigger: { type: "account_created" }, steps: [{ id: "a", type: "send_email", emailId: email.id }] } })).body;
    // In use: the journey and the waiting campaign are named.
    const blocked = await s.owner.call("DELETE", `/emails/${email.id}`);
    expect(blocked.body.error.usedBy).toEqual(["the journey “Welcome”", "the campaign “October”"]);
    expect((await s.owner.call("GET", "/journeys?category=Onboarding")).body.map((x: { name: string }) => x.name)).toEqual(["Welcome"]);

    await s.owner.call("POST", `/campaigns/${camp.id}/send`, { acknowledge: ["send_to_many"] });
    const copy = await s.owner.call("POST", `/campaigns/${camp.id}/duplicate`);
    expect(copy.body).toMatchObject({ name: "October (copy)", status: "draft", emailId: email.id });
    expect((await s.owner.call("DELETE", `/campaigns/${copy.body.id}`)).status).toBe(204);
    expect((await s.owner.call("DELETE", `/journeys/${j.id}`)).status).toBe(204);
    expect((await s.owner.call("DELETE", `/emails/${email.id}`)).status).toBe(204);
    // The sent campaign still shows which email went out.
    expect((await s.owner.call("GET", "/campaigns")).body).toEqual([expect.objectContaining({ name: "October", emailName: "News", emailId: null, recipients: 1 })]);
    // A copy of it needs a new email before it can be sent.
    const again = (await s.owner.call("POST", `/campaigns/${camp.id}/duplicate`)).body;
    expect(again.note).toMatch(/Choose an email/);
    expect((await s.owner.call("POST", `/campaigns/${again.id}/send`, { acknowledge: ["send_to_many"] })).body.error.code).toBe("email_archived");
  });
});

describe("journeys", () => {
  it("follows up new members: welcome, then yes/no on buying, with the studio told about people who don't", async () => {
    const { s, join, plan } = await setup();
    const p = await plan({ name: "Intro offer", priceCents: 5000 });
    const recipe = await s.owner.call("POST", "/journeys/from-recipe", { recipe: "intro_funnel" });
    expect(recipe.status).toBe(201);
    const j = recipe.body;
    expect(j.triggerText).toBe("When a client creates an account");
    await db.update(organizations).set({ timezone: "UTC" }).where(eq(organizations.id, s.orgId)); // no quiet-hours surprises in tests
    await s.owner.call("PATCH", `/journeys/${j.id}`, { quietHours: false });
    const live = await s.owner.call("POST", `/journeys/${j.id}/go-live`, {});
    expect(live.body.error.code).toBe("needs_confirmation");
    expect((await s.owner.call("POST", `/journeys/${j.id}/go-live`, { acknowledge: ["journey_starts"] })).body.journey.status).toBe("live");

    const buyer = await join("Bea", { marketingEmail: true });
    const browser = await join("Bo", { marketingEmail: true });
    await runDueJourneys(db, urls);
    // The welcome is a service email, so it goes whatever their marketing choice.
    expect((await outbox("custom")).filter((m) => (m.data as { subject: string }).subject.startsWith("Welcome")).length).toBe(2);

    // Bea buys within 3 days: Yes side (nothing more). Bo doesn't: No side gets the offer email.
    await s.owner.call("POST", `/clients/${buyer.id}/packages`, { planId: p.id });
    await runDueJourneys(db, urls, new Date(Date.now() + 4 * DAY));
    const offers = (await outbox("custom")).filter((m) => (m.data as { subject: string }).subject.includes("intro offer"));
    expect(offers.map((m) => m.userId)).toEqual([browser.id]);
    // Still nothing a week later: admins are asked to call.
    await runDueJourneys(db, urls, new Date(Date.now() + 9 * DAY));
    expect((await outbox("journey.staff")).filter((m) => m.channel === "email").map((m) => m.userId)).toEqual([s.owner.id]);

    const stats = (await s.owner.call("GET", `/journeys/${j.id}`)).body.stats;
    expect(stats).toMatchObject({ started: 2, finished: 2, inProgress: 0 });
    expect(stats.steps.bought).toEqual({ yes: 1, no: 1 });
    // Each client goes through it once.
    await runDueJourneys(db, urls, new Date(Date.now() + 10 * DAY));
    expect((await db.select().from(journeyEnrollments).where(eq(journeyEnrollments.journeyId, j.id))).length).toBe(2);
  });

  it("celebrates milestones with a reward, checks conditions, and keeps people on the version they started", async () => {
    const { s, attend, consent } = await setup();
    await consent(s.c1.id);
    await db.update(organizations).set({ timezone: "UTC" }).where(eq(organizations.id, s.orgId));
    const email = (await s.owner.call("POST", "/emails", { name: "Congrats", design: { subject: "{{classes_attended}} classes!", blocks: [{ type: "text", text: "Well done {{first_name}}" }] } })).body;
    const j = (
      await s.owner.call("POST", "/journeys", {
        name: "3rd class",
        quietHours: false,
        definition: {
          trigger: { type: "attendance_milestone", count: 3 },
          steps: [
            { id: "gift", type: "give_reward", reward: { type: "free_classes", classes: 1, validDays: 30 } },
            { id: "regular", type: "check", rule: { field: "classesAttended", op: "at_least", value: 3 }, yes: [{ id: "mail", type: "send_email", emailId: email.id }], no: [] },
            { id: "pause", type: "wait", for: { value: 2, unit: "days" } },
            { id: "push", type: "send_push", title: "See you soon", body: "Book your next class" },
          ],
        },
      })
    ).body;
    await s.owner.call("POST", `/journeys/${j.id}/go-live`, { acknowledge: ["journey_starts"] });
    await attend(s.c1.id, 3);
    await runDueJourneys(db, urls);
    const pkgs = (await s.c1.call("GET", "/me/packages")).body.packages;
    expect(pkgs.map((p: { name: string }) => p.name)).toContain("1 free class");
    expect((await outbox("custom")).find((m) => m.channel === "email")!.data).toMatchObject({ subject: "3 classes!" });
    // Change the journey while Chloe is waiting: she finishes the version she started.
    const edited = await s.owner.call("PATCH", `/journeys/${j.id}`, { definition: { ...j.definition, steps: [j.definition.steps[0]] } });
    expect(edited.body.note).toMatch(/1 people part-way through/);
    await runDueJourneys(db, urls, new Date(Date.now() + 3 * DAY));
    expect((await outbox("custom")).filter((m) => m.channel === "push").length).toBe(1);
  });

  it("waits for morning when quiet hours are on, and finds lapsed clients", async () => {
    const { s, attend, consent } = await setup();
    await consent(s.c1.id);
    await db.update(organizations).set({ timezone: "UTC" }).where(eq(organizations.id, s.orgId));
    const j = (await s.owner.call("POST", "/journeys", { name: "Lapsed", definition: { trigger: { type: "inactive", days: 30 }, steps: [{ id: "hi", type: "send_push", title: "We miss you", body: "Come back soon" }] } })).body;
    await s.owner.call("POST", `/journeys/${j.id}/go-live`, { acknowledge: ["journey_starts"] });
    await attend(s.c1.id, 1);
    await scanJourneyTriggers(db, new Date(Date.now() + 10 * DAY));
    expect((await db.select().from(journeyEnrollments)).length).toBe(0);
    const later = new Date(Date.now() + 31 * DAY);
    const night = new Date(Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate(), 23, 0));
    await scanJourneyTriggers(db, night);
    await runDueJourneys(db, urls, night);
    const [e] = await db.select().from(journeyEnrollments);
    expect(e!.nextRunAt!.getUTCHours()).toBe(8);
    expect((await outbox("custom")).length).toBe(0);
    await runDueJourneys(db, urls, new Date(night.getTime() + 10 * HOUR));
    expect((await outbox("custom")).length).toBe(1);
  });
});

describe("banners and announcements", () => {
  it("shows banners in their window to the right people and counts clicks", async () => {
    const { s, upload, attend } = await setup();
    const img = await upload("banner");
    const b = await s.owner.call("POST", "/banners", { title: "Intro offer", imageFileId: img.id, linkType: "url", linkTarget: "https://studio.example.com/intro", audience: "new_clients" });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    await s.owner.call("POST", "/banners", { title: "Later", imageFileId: img.id, startsAt: new Date(Date.now() + DAY).toISOString() });
    await attend(s.c2.id);
    expect((await s.c1.call("GET", "/me/banners?placement=home")).body.banners.map((x: { title: string }) => x.title)).toEqual(["Intro offer"]);
    expect((await s.c2.call("GET", "/me/banners")).body).toEqual({ rotateSeconds: 6, banners: [] });
    expect((await s.c1.call("POST", `/me/banners/${b.body.id}/click`)).body.link).toEqual({ type: "url", target: "https://studio.example.com/intro" });
    const admin = (await s.owner.call("GET", "/banners")).body;
    expect(admin.find((x: { title: string }) => x.title === "Intro offer")).toMatchObject({ views: 1, clicks: 1, state: "live" });
    expect(admin.find((x: { title: string }) => x.title === "Later").state).toBe("scheduled");
    expect((await s.owner.call("POST", "/banners", { title: "Bad", imageFileId: img.id, linkType: "url", linkTarget: "javascript:x" })).status).toBe(400);

    // Several banners in one place take turns, in the studio's order, each for the chosen time.
    const second = (await s.owner.call("POST", "/banners", { title: "Gift cards", imageFileId: img.id })).body;
    await s.owner.call("PUT", "/banners/order", { ids: [second.id, b.body.id] });
    expect((await s.owner.call("PATCH", "/banners/settings", { bannerRotateSeconds: 2 })).body.error.fields.bannerRotateSeconds).toMatch(/At least 3/);
    await s.owner.call("PATCH", "/banners/settings", { bannerRotateSeconds: 8 });
    expect((await s.c1.call("GET", "/me/banners?placement=home")).body).toMatchObject({ rotateSeconds: 8, banners: [{ title: "Gift cards" }, { title: "Intro offer" }] });
  });

  it("posts announcements with a push to everyone affected, for as long as chosen, and can end them early", async () => {
    const { s } = await setup();
    const frontDesk = await (await import("./helpers.js")).person(s.orgId, "front_desk", "Fay");
    const a = await frontDesk.call("POST", "/announcements", { title: "Lift out of order", message: "Please use the stairs today.", importance: "important", duration: "end_of_day" });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.message).toMatch(/3 people will get a push/);
    expect((await outbox("custom")).filter((m) => m.channel === "push").length).toBe(3);
    expect((await s.c1.call("GET", "/me/announcements")).body[0]).toMatchObject({ title: "Lift out of order", importance: "important" });
    await s.c1.call("POST", `/me/announcements/${a.body.id}/dismiss`);
    expect((await s.c1.call("GET", "/me/announcements")).body).toEqual([]);
    expect((await s.c2.call("GET", "/me/announcements")).body.length).toBe(1);

    // Scheduled for tomorrow, then cancelled: the waiting push notifications go too.
    const later = await s.owner.call("POST", "/announcements", { title: "Washroom closed", message: "Being repaired", startsAt: new Date(Date.now() + DAY).toISOString(), duration: "2h" });
    expect((await s.c2.call("GET", "/me/announcements")).body.length).toBe(1);
    await s.owner.call("POST", `/announcements/${later.body.id}/end`);
    expect((await db.select().from(notifications).where(eq(notifications.status, "pending"))).filter((n) => (n.data as { ref?: { announcementId?: string } }).ref?.announcementId === later.body.id)).toEqual([]);
    expect((await s.c1.call("POST", "/announcements", { title: "x", message: "y" })).status).toBe(403);
    expect((await s.owner.call("POST", "/announcements", { title: "x", message: "y", duration: "custom" })).body.error.fields.endsAt).toMatch(/when it should disappear/);
  });
});

describe("gift cards and studio credit", () => {
  async function shop() {
    const t = await setup({ giftCardValidityDays: 365, giftCardGiveWithinDays: 30 });
    const img = await t.upload("gift_card_design");
    expect((await t.s.owner.call("PATCH", "/gift-cards/settings", { giftCardsEnabled: true })).body.error.code).toBe("no_designs");
    const design = (await t.s.owner.call("POST", "/gift-cards/designs", { name: "Thank you", fileId: img.id })).body;
    await t.s.owner.call("PATCH", "/gift-cards/settings", { giftCardsEnabled: true, giftCardAmounts: [5000, 10000] });
    await db.update(users).set({ phone: "+65 9123 4567" }).where(eq(users.id, t.s.c2.id));
    return { ...t, design };
  }
  const payAtDesk = async (owner: { call: (m: "POST", u: string) => Promise<{ body: { status: string } }> }, orderId: string) => expect((await owner.call("POST", `/orders/${orderId}/mark-paid`)).body.status).toBe("paid");

  it("buy to give later: waits in the tab, is given by phone number, and becomes the friend's credit", async () => {
    const { s, design } = await shop();
    expect((await s.c1.call("POST", "/gift-cards/checkout", { designId: design.id, amountCents: 7000 })).body.error.message).toMatch(/Choose SGD 50.00, SGD 100.00/);
    const bought = await s.c1.call("POST", "/gift-cards/checkout", { designId: design.id, amountCents: 10000 });
    expect(bought.status, JSON.stringify(bought.body)).toBe(201);
    expect(bought.body.giftCard.code).toMatch(/^GIFT-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Can't give it before it's paid.
    expect((await s.c1.call("POST", `/gift-cards/${bought.body.giftCard.id}/give`, { to: "9123 4567" })).body.error.code).toBe("not_paid");
    await payAtDesk(s.owner, bought.body.order.id);
    const tab = (await s.c1.call("GET", "/me/gift-cards")).body;
    expect(tab.toGive[0]).toMatchObject({ status: "unsent", amount: "SGD 100.00", daysLeftToGive: 30 });

    const given = await s.c1.call("POST", `/gift-cards/${bought.body.giftCard.id}/give`, { to: "9123 4567", message: "Happy birthday!" });
    expect(given.body).toMatchObject({ status: "given", to: "Dev T." });
    expect((await outbox("gift_card.received"))[0]!.data).toMatchObject({ fromName: "Chloe", message: "Happy birthday!", amount: "SGD 100.00" });
    const credit = (await s.c2.call("GET", "/me/credit")).body;
    expect(credit.balance).toBe("SGD 100.00");
    expect((await s.c2.call("GET", "/me/gift-cards")).body.received[0]).toMatchObject({ from: "Chloe", statusLabel: "Received" });
  });

  it("give now needs an account; unsent cards become the buyer's credit after the give-by date", async () => {
    const { s, design } = await shop();
    const nobody = await s.c1.call("POST", "/gift-cards/checkout", { designId: design.id, amountCents: 5000, give: { to: "stranger@example.com" } });
    expect(nobody.status).toBe(409);
    expect(nobody.body.error).toMatchObject({ code: "recipient_not_found", canGiveLater: true });

    const now = await s.c1.call("POST", "/gift-cards/checkout", { designId: design.id, amountCents: 5000, give: { to: (await db.select().from(users).where(eq(users.id, s.c3.id)))[0]!.email.toUpperCase() } });
    expect(now.status, JSON.stringify(now.body)).toBe(201);
    await payAtDesk(s.owner, now.body.order.id);
    expect((await s.c3.call("GET", "/me/credit")).body.balance).toBe("SGD 50.00");

    const later = await s.c1.call("POST", "/gift-cards/checkout", { designId: design.id, amountCents: 5000 });
    await payAtDesk(s.owner, later.body.order.id);
    await keepOverdueGiftCards(db, new Date(Date.now() + 31 * DAY));
    expect((await s.c1.call("GET", "/me/gift-cards")).body.kept[0]).toMatchObject({ status: "kept" });
    expect((await outbox("gift_card.kept"))[0]!.data).toMatchObject({ auto: true });
  });

  it("uses credit and discounts at checkout, soonest-expiring first, and gives them back if the order is cancelled", async () => {
    const { s, plan } = await setup();
    const p = await plan({ priceCents: 15000 });
    await s.owner.call("POST", `/clients/${s.c1.id}/credit`, { amountCents: 10000, reason: "Goodwill", validDays: 30 });
    await s.owner.call("POST", `/clients/${s.c1.id}/credit`, { amountCents: 2000, reason: "Sorry about the aircon", validDays: 7 });
    const q = (await s.c1.call("GET", `/checkout/quote?planId=${p.id}`)).body;
    expect(q.lines.map((l: { label: string; amount: string }) => `${l.label}: ${l.amount}`)).toEqual(["10-class pack: SGD 150.00", "Studio credit: −SGD 120.00"]);
    expect(q.total).toBe("SGD 30.00");
    const order = await s.c1.call("POST", "/checkout", { planId: p.id });
    expect(order.body.order).toMatchObject({ status: "pending", total: "SGD 30.00" });
    expect((await s.c1.call("GET", "/me/credit")).body.balanceCents).toBe(0);
    await s.c1.call("POST", `/orders/${order.body.order.id}/cancel`);
    expect((await s.c1.call("GET", "/me/credit")).body.balanceCents).toBe(12000);

    // Credit that covers everything completes the order straight away.
    const cheap = await plan({ name: "Single class", credits: 1, priceCents: 3000 });
    const done = await s.c1.call("POST", "/checkout", { planId: cheap.id });
    expect(done.body.order.status).toBe("paid");
    expect(done.body.payment.message).toMatch(/added to your packages/);
    const left = (await s.c1.call("GET", "/me/credit")).body;
    // The SGD 20 expiring soonest was used first.
    expect(left.pieces).toEqual([expect.objectContaining({ amount: "SGD 90.00", from: "Goodwill" })]);
    expect((await s.owner.call("POST", `/clients/${s.c1.id}/credit`, { amountCents: -50000, reason: "Oops" })).body.error.code).toBe("not_enough_credit");
  });
});

describe("referrals", () => {
  async function referrals(extra: Partial<typeof organizations.$inferInsert> = {}) {
    const t = await setup({ referralsEnabled: true, referralQualify: "classes_attended", referralQualifyValue: 2, referralQualifyWithinDays: 60, referrerReward: { type: "credit", amountCents: 2000, validDays: 90 }, refereeReward: { type: "discount", percent: 10, validDays: 30 }, referralCodeWindowDays: 7, ...extra });
    const mine = (await t.s.c1.call("GET", "/me/referral")).body;
    return { ...t, code: mine.code as string, link: mine.link as string };
  }

  it("rewards the referrer once the friend qualifies, and welcomes the friend", async () => {
    const { s, code, link, join, attend } = await referrals();
    expect(code).toMatch(/^CHLOE-[A-Z2-9]{4}$/);
    expect(link).toContain(`/join/${s.orgId}?ref=${code}`);
    expect((await app.inject({ method: "GET", url: `/v1/referral-codes/${s.orgId}/${code}` })).json()).toMatchObject({ valid: true, referrerFirstName: "Chloe", welcomeGift: "10% off one purchase, used within 30 days" });

    const friend = await join("Fern", { referralCode: code.toLowerCase(), attribution: { fbclid: "abc" } });
    expect(friend.body.referral).toMatchObject({ referrerFirstName: "Chloe", welcomeGift: "10% off one purchase, used within 30 days" });
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, friend.id));
    expect(m).toMatchObject({ acquisition: "referral", marketingEmail: false });
    expect((await friend.call("GET", "/me/credit")).body.discounts[0].label).toBe("10% off");

    await attend(friend.id, 1);
    expect((await s.c1.call("GET", "/me/credit")).body.balanceCents).toBe(0);
    await attend(friend.id, 1);
    expect((await s.c1.call("GET", "/me/credit")).body.balance).toBe("SGD 20.00");
    expect((await outbox("referral.rewarded"))[0]!.data).toMatchObject({ friendName: "Fern" });
    const me = (await s.c1.call("GET", "/me/referral")).body;
    expect(me).toMatchObject({ rewardsEarned: 1, friends: [{ name: "Fern N.", status: "rewarded" }] });
    // Codes can't be changed once added.
    expect((await friend.call("POST", "/me/referral", { code })).body.error.code).toBe("already_referred");
  });

  it("stops self-referrals and late codes, lets staff add missed ones, and respects the monthly cap", async () => {
    const { s, code, join, attend } = await referrals({ referralMonthlyCap: 1, refereeReward: null });
    expect((await s.c1.call("POST", "/me/referral", { code })).body.error.code).toBe("own_code");
    // Same phone number as the referrer counts as the same person.
    await db.update(users).set({ phone: "91234567" }).where(eq(users.id, s.c1.id));
    const twin = await join("Twin", {}, "+65 9123 4567");
    expect((await twin.call("POST", "/me/referral", { code })).body.error.code).toBe("own_code");

    const late = await join("Lou");
    await db.update(memberships).set({ createdAt: new Date(Date.now() - 8 * DAY) }).where(eq(memberships.userId, late.id));
    expect((await late.call("POST", "/me/referral", { code })).body.error.message).toMatch(/within 7 days of joining/);
    expect((await s.owner.call("POST", `/clients/${late.id}/referral`, { code })).status).toBe(201);

    const second = await join("Sam", { referralCode: code });
    await attend(late.id, 2);
    await attend(second.id, 2);
    const report = (await s.owner.call("GET", "/referrals")).body;
    expect(report.map((r: { referee: string; status: string }) => `${r.referee}: ${r.status}`).sort()).toEqual(["Lou New: rewarded", "Sam New: capped"]);
    expect((await s.c1.call("GET", "/me/credit")).body.balance).toBe("SGD 20.00");
  });

  it("works out where new members came from", () => {
    expect(acquisitionFrom({ fbclid: "x" }, false)).toBe("meta_ads");
    expect(acquisitionFrom({ utm_source: "Instagram", utm_medium: "paid" }, false)).toBe("meta_ads");
    expect(acquisitionFrom({ gclid: "x" }, false)).toBe("google_ads");
    expect(acquisitionFrom({ utm_source: "newsletter" }, false)).toBe("other_campaign");
    expect(acquisitionFrom({}, true)).toBe("referral");
    expect(acquisitionFrom(undefined, false)).toBe("direct");
  });
});

void dayOffset;
