import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assistantSettings, assistantUsage, emailCampaigns, emailDesigns } from "../src/db/schema.js";
import { setWriterModel, type WriterRequest } from "../src/modules/assistant/model.js";
import { app, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterEach(() => setWriterModel(null));
afterAll(async () => {
  await app.close();
  await pool.end();
});

const usage = { input_tokens: 900, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as never;
function writer(json: unknown) {
  const seen: WriterRequest[] = [];
  setWriterModel(async (req) => {
    seen.push(req);
    return { json, stop_reason: "end_turn", usage };
  });
  return seen;
}

describe("writing agents", () => {
  it("drafts an announcement in the studio's voice, for staff who can post them", async () => {
    const s = await studio();
    const fd = await person(s.orgId, "front_desk", "Faye");
    const seen = writer({ title: "Lift out of order today", message: "The lift at Central is being repaired. Please take the stairs to Studio 1, and give yourself a few extra minutes.", importance: "important" });
    const r = await fd.call("POST", "/agents/write/announcement", { brief: "lift broken at central, use stairs" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ draft: { title: "Lift out of order today", importance: "important" }, creditsUsed: 1 });
    // The writer gets the guide, the studio's real names and the brief, kept apart from its rules.
    expect(seen[0]!.system).toMatch(/Never invent dates, times, prices/);
    expect(seen[0]!.prompt).toMatch(/Studio: Test Studio/);
    expect(seen[0]!.prompt).toMatch(/Classes: Reformer Pilates/);
    expect(seen[0]!.prompt).toMatch(/<brief>\nlift broken at central, use stairs\n<\/brief>/);
    expect(seen[0]!.prompt).not.toMatch(/Chloe|Dev|Eve|@example\.com/); // no client details
    expect(seen[0]!.schema).toMatchObject({ required: ["title", "message", "importance"] });
    expect((await db.select().from(assistantUsage))[0]!.replies).toBe(1);
    // Instructors don't post announcements.
    expect((await s.ana.call("POST", "/agents/write/announcement", { brief: "hello there" })).status).toBe(403);
  });

  it("drafts a campaign email in the builder (never sends it) and uses 3 credits", async () => {
    const s = await studio();
    writer({ name: "December intro offer", subject: "Your first Reformer class, on us", preheader: "New to the studio? Try a class this December.", heading: "Hi {{first_name}}, try Reformer this December", paragraphs: ["Bring a friend to Central and both of you get [offer].", "- 50 minutes\n- All levels"], buttonLabel: "Book a class" });
    const r = await s.owner.call("POST", "/agents/write/campaign", { brief: "intro offer for december, reformer, bring a friend" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ name: "December intro offer", creditsUsed: 3 });
    const [email] = await db.select().from(emailDesigns).where(eq(emailDesigns.id, r.body.emailId));
    expect(email!.design.subject).toBe("Your first Reformer class, on us");
    expect(email!.design.blocks.map((b) => b.type)).toEqual(["heading", "text", "text", "button"]);
    expect(email!.design.blocks.at(-1)).toMatchObject({ type: "button", label: "Book a class", url: "http://localhost:5173" });
    const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, r.body.campaignId));
    expect(campaign).toMatchObject({ status: "draft", sentAt: null, emailId: email!.id });
    expect((await db.select().from(assistantUsage))[0]!.replies).toBe(3);
    expect((await s.ana.call("POST", "/agents/write/campaign", { brief: "intro offer" })).status).toBe(403);
  });

  it("checks there are enough AI credits first", async () => {
    const s = await studio();
    await db.insert(assistantSettings).values({ orgId: s.orgId, monthlyAllowance: 2 });
    writer({ name: "x", subject: "x", preheader: "x", heading: "x", paragraphs: ["x"], buttonLabel: "Book" });
    const r = await s.owner.call("POST", "/agents/write/campaign", { brief: "intro offer for december" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: "assistant_limit", message: expect.stringMatching(/needs 3 AI credits and your studio has 2 left/) });
    setWriterModel(null);
    expect((await s.owner.call("POST", "/agents/write/announcement", { brief: "hello world" })).body.error.code).toBe("assistant_unavailable");
  });
});
