import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { assistantSettings, assistantUsage, bookings, classSessions, organizations, users } from "../src/db/schema.js";
import { knowledge } from "../src/modules/assistant/knowledge.js";
import { setAssistantModel, type ModelRequest, type ModelResponse } from "../src/modules/assistant/model.js";
import { TOOLS } from "../src/modules/assistant/tools.js";
import { topUpPaid } from "../src/modules/assistant/usage.js";
import { app, db, outbox, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterEach(() => setAssistantModel(null));
afterAll(async () => {
  await app.close();
  await pool.end();
});

const usage = { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 } as ModelResponse["usage"];
const tool = (name: string, input: unknown): ModelResponse => ({ content: [{ type: "tool_use", id: `t_${name}_${Math.random().toString(36).slice(2, 8)}`, name, input, caller: { type: "direct" } }] as ModelResponse["content"], stop_reason: "tool_use", usage });
const say = (text: string): ModelResponse => ({ content: [{ type: "text", text, citations: null }] as ModelResponse["content"], stop_reason: "end_turn", usage });
/** The last tool result the assistant was given, parsed. */
const lastResult = (req: ModelRequest) => {
  const m = req.messages.at(-1)!;
  const block = (m.content as { type: string; content?: string; is_error?: boolean }[]).find((b) => b.type === "tool_result")!;
  return { ...JSON.parse(block.is_error ? JSON.stringify({ error: block.content }) : block.content!), raw: block.content! };
};
/** Answer with a script: each step sees the request and returns the next response. */
function script(steps: ((req: ModelRequest) => ModelResponse)[]) {
  const seen: ModelRequest[] = [];
  let i = 0;
  setAssistantModel(async (req) => {
    seen.push(structuredClone(req));
    const step = steps[i++];
    if (!step) throw new Error("script ran out");
    return step(req);
  });
  return seen;
}

/** Next Saturday at 11am, Singapore. */
const saturday = DateTime.now().setZone("Asia/Singapore").plus({ days: 2 }).startOf("day").plus({ days: (6 - DateTime.now().setZone("Asia/Singapore").plus({ days: 2 }).weekday + 7) % 7 }).set({ hour: 11 });

async function setup(opts: { needPackage?: boolean } = {}) {
  const s = await studio({ clientsNeedPackage: opts.needPackage ?? false });
  await db.update(users).set({ lastName: "Kumar", phone: "+6591234567" }).where(eq(users.id, s.c2.id));
  const fd = await person(s.orgId, "front_desk", "Faye");
  const [cls] = await db
    .insert(classSessions)
    .values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: s.ana.id, startsAt: saturday.toJSDate(), endsAt: saturday.plus({ minutes: 50 }).toJSDate(), capacity: 10 })
    .returning();
  const ask = (who: { call: (m: "POST", u: string, b: unknown) => Promise<{ status: number; body: any }> }, text: string, chatId?: string) => who.call("POST", "/assistant/ask", { text, ...(chatId ? { chatId } : {}) });
  return { s, fd, cls: cls!, ask };
}

describe("support assistant", () => {
  it("answers 'why can't I book Dev Kumar into Saturday's 11am Reformer?' from the real booking rules", async () => {
    const { s, cls, ask } = await setup({ needPackage: true });
    await db.update(organizations).set({ allowBookingWithoutPackage: false }).where(eq(organizations.id, s.orgId));
    let clientId = "", classId = "";
    const seen = script([
      () => tool("find_clients", { name: "Dev Kumar" }),
      (req) => {
        const r = lastResult(req);
        expect(r.clients).toEqual([{ id: s.c2.id, name: "Dev Kumar", type: "Studio member", packages: [] }]);
        expect(r.raw).not.toMatch(/@example\.com|\+659/); // never contact details
        clientId = r.clients[0].id;
        return tool("find_classes", { date: saturday.toISODate(), time: "11:00", name: "reformer" });
      },
      (req) => {
        const r = lastResult(req);
        expect(r.classes).toHaveLength(1);
        expect(r.classes[0]).toMatchObject({ id: cls.id, name: "Reformer Pilates", spots: 10, booked: 0, instructor: expect.stringMatching(/^Ana/) });
        classId = r.classes[0].id;
        return tool("check_booking", { client_id: clientId, class_id: classId });
      },
      (req) => {
        const r = lastResult(req);
        expect(r.forThisPerson).toMatchObject({ result: "blocked", code: "package_required", reason: expect.stringMatching(/Dev Kumar doesn't have a package.*only allows bookings with a package/) });
        return say("Dev doesn't have a package that covers Reformer, and your studio only allows bookings with a package. Sell him one first (Clients, Dev Kumar, Sell a package), or book it as complimentary.");
      },
    ]);
    const r = await ask(s.owner, "why can't i book Dev Kumar into Saturday's 11am Reformer class?");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.reply).toMatch(/^Dev doesn't have a package/);
    // Nothing was booked by the check.
    expect(await db.select().from(bookings)).toHaveLength(0);
    // The guide is sent once, cached, with who's asking in a separate block.
    expect(seen[0]!.system[0]!.text).toContain("# Studio guide");
    expect(seen[0]!.system[0]!.text).not.toContain("Hosting, data storage");
    expect(seen[0]!.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(seen[0]!.system[1]!.text).toMatch(/You're talking to Olivia, who is the Owner at Test Studio/);
    expect(seen[0]!.messages[0]!.content).toEqual([{ type: "text", text: expect.stringMatching(/^\[Today is \w+day \d+ \w+ \d{4}, .*\]\nwhy can't i book Dev Kumar/) }]);
    // The chat keeps only what the person sees, and counts as one reply.
    const chat = (await s.owner.call("GET", `/assistant/chats/${r.body.chatId}`)).body;
    expect(chat.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    const [u] = await db.select().from(assistantUsage);
    expect(u).toMatchObject({ replies: 1, inputTokens: 4800, cachedTokens: 36000, outputTokens: 320 });
  });

  it("has no tools for money, settings or contact details, and refuses payment-like actions", async () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["find_clients", "find_classes", "check_booking", "client_bookings", "studio_rules", "offer_action"]);
    expect(JSON.stringify(TOOLS)).not.toMatch(/"refund|"payment|"price|"delete/i);
    const { s, cls, ask } = await setup({ needPackage: true }); // staff may book without a package (after a warning)
    script([
      () => tool("offer_action", { action: "book_client", client_id: s.c2.id, class_id: cls.id }),
      (req) => {
        const r = lastResult(req);
        expect(r).toMatchObject({ offered: false, reason: expect.stringMatching(/paying at the studio\. That's a payment decision/) });
        return say("He has no package for this class, so you'd need to book it yourself as Pay at studio, or sell him a package.");
      },
    ]);
    expect((await ask(s.owner, "book Dev into Saturday's Reformer")).body.actions).toEqual([]);
    script([() => say("I can't do refunds. An owner or admin can: open the client, go to their packages and choose Refund.")]);
    expect((await ask(s.owner, "can you refund Chloe Ng's recent package purchase?")).body.reply).toMatch(/can't do refunds/);
  });

  it("offers an action, and only does it once the person confirms", async () => {
    const { s, cls, ask } = await setup();
    script([
      () => tool("offer_action", { action: "book_client", client_id: s.c2.id, class_id: cls.id }),
      (req) => {
        const r = lastResult(req);
        expect(r).toMatchObject({ offered: true, summary: expect.stringMatching(/^Book Dev Kumar into Reformer Pilates, Sat/) });
        return say("I can book Dev in. Press Confirm to go ahead.");
      },
    ]);
    const r = await ask(s.owner, "book dev into saturday 11am reformer");
    expect(r.body.actions).toEqual([{ id: expect.any(String), summary: expect.stringMatching(/^Book Dev Kumar/), status: "proposed" }]);
    expect(await db.select().from(bookings)).toHaveLength(0);
    const id = r.body.actions[0].id;
    // Someone else can't confirm it, even an admin.
    const admin = await person(s.orgId, "admin", "Adam");
    expect((await admin.call("POST", `/assistant/actions/${id}/confirm`, {})).status).toBe(404);
    const ok = await s.owner.call("POST", `/assistant/actions/${id}/confirm`, {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const [b] = await db.select().from(bookings);
    expect(b).toMatchObject({ clientId: s.c2.id, sessionId: cls.id, bookedBy: s.owner.id, source: "staff" });
    expect((await outbox("booking.confirmed")).map((n) => n.userId)).toContain(s.c2.id);
    expect((await s.owner.call("POST", `/assistant/actions/${id}/confirm`, {})).body.error.code).toBe("action_finished");
    // The assistant is told it happened, next time it's asked.
    const seen = script([() => say("Done.")]);
    await ask(s.owner, "thanks", r.body.chatId);
    expect(JSON.stringify(seen[0]!.messages)).toContain("[The person confirmed, and it's done: Book Dev Kumar");
  });

  it("only sees and does what the asker's role allows, in their own studio", async () => {
    const { s, fd, cls, ask } = await setup({ needPackage: true });
    await db.update(organizations).set({ allowBookingWithoutPackage: false }).where(eq(organizations.id, s.orgId));
    // Front of House can look clients up but not their packages, and can't book them in.
    script([
      () => tool("find_clients", { name: "dev" }),
      (req) => {
        expect(lastResult(req).clients[0]).not.toHaveProperty("packages");
        return tool("check_booking", { client_id: s.c2.id, class_id: cls.id });
      },
      (req) => {
        const r = lastResult(req);
        expect(r.forThisPerson).toMatchObject({ result: "blocked", code: "forbidden" });
        expect(r.ifAnAdminBooksIt).toMatchObject({ result: "blocked", reason: "They don't have a package that covers this class. An owner or admin can check their packages or sell them one." });
        return tool("offer_action", { action: "book_client", client_id: s.c2.id, class_id: cls.id });
      },
      (req) => {
        expect(lastResult(req)).toMatchObject({ offered: false, reason: expect.stringMatching(/^Only owners and admins can book clients in/) });
        return say("Only an owner or admin can book clients in.");
      },
    ]);
    expect((await ask(fd, "why can't I book Dev into Saturday 11am?")).status).toBe(200);

    // Instructors only find clients booked into their own classes.
    await db.insert(bookings).values({ orgId: s.orgId, sessionId: cls.id, clientId: s.c1.id, source: "staff" });
    script([
      () => tool("find_clients", { name: "e" }),
      (req) => {
        expect(lastResult(req).clients.map((c: { name: string }) => c.name)).toEqual([expect.stringMatching(/^Chloe/)]);
        return say("ok");
      },
    ]);
    await ask(s.ben, "who is Chloe?"); // Ben doesn't teach it: nobody
    script([
      () => tool("find_clients", { name: "e" }),
      (req) => {
        expect(lastResult(req).clients).toEqual([]);
        return say("ok");
      },
    ]);
    await ask(s.ben, "find clients");

    // Another studio can't reach this studio's clients or classes, even with their ids.
    const other = await studio();
    script([
      () => tool("check_booking", { client_id: s.c2.id, class_id: cls.id }),
      (req) => {
        expect(lastResult(req).error).toMatch(/No client with that id at this studio/);
        return tool("find_classes", { date: saturday.toISODate() });
      },
      (req) => {
        expect(lastResult(req).classes).toEqual([]);
        return say("I couldn't find that.");
      },
    ]);
    expect((await ask(other.owner, "check Dev")).status).toBe(200);

    // Clients can't use it; owners choose which roles can.
    expect((await s.c1.call("POST", "/assistant/ask", { text: "hi" })).status).toBe(404);
    await s.owner.call("PATCH", "/assistant/settings", { roles: ["owner", "admin"] });
    expect((await ask(s.ana, "hi")).status).toBe(403);
    expect((await s.ana.call("PATCH", "/assistant/settings", { enabled: false })).status).toBe(403);
  });

  it("counts replies against the month's allowance, warns, and uses top-ups after", async () => {
    const { s, ask } = await setup();
    await db.insert(assistantSettings).values({ orgId: s.orgId, monthlyAllowance: 2 });
    script([() => say("one"), () => say("two"), () => say("three")]);
    expect((await ask(s.owner, "q1")).status).toBe(200);
    expect(await outbox("assistant.usage")).toHaveLength(0); // 1 of 2: no warning yet
    expect((await ask(s.owner, "q2")).body.usage).toEqual({ leftThisMonth: 0, topUpsLeft: 0 });
    const warned = await outbox("assistant.usage");
    expect(warned.map((n) => [n.userId, n.channel]).sort()).toEqual([[s.owner.id, "email"], [s.owner.id, "push"]]);
    expect(warned[0]!.data).toMatchObject({ full: true, used: 2, allowance: 2 });
    const limit = await ask(s.owner, "q3");
    expect(limit.status).toBe(409);
    expect(limit.body.error.code).toBe("assistant_limit");

    // An owner buys a top-up; it counts once payment is confirmed.
    const t = await s.owner.call("POST", "/assistant/top-ups", { pack: 0 });
    expect(t.body).toMatchObject({ replies: 200, status: "pending" });
    expect((await ask(s.owner, "q3")).status).toBe(409);
    await db.transaction((tx) => topUpPaid(tx, t.body.id, "stripe", "pi_1"));
    expect(await db.transaction((tx) => topUpPaid(tx, t.body.id, "stripe", "pi_1"))).toBeNull(); // safe to call twice
    expect((await ask(s.owner, "q3")).body.usage).toEqual({ leftThisMonth: 0, topUpsLeft: 199 });
    const settings = (await s.owner.call("GET", "/assistant/settings")).body;
    expect(settings.usage).toMatchObject({ allowance: 2, used: 2, topUpsLeft: 199, percent: 100 });
  });

  it("says it isn't available when the platform has no key, and knows the guide", async () => {
    const { s, ask } = await setup();
    setAssistantModel(null);
    const r = await ask(s.owner, "hello");
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("assistant_unavailable");
    const k = knowledge();
    expect(k).toContain('<document name="help/STUDIO_GUIDE.md">');
    expect(k).toContain('<document name="PRODUCT_NOTES.md">');
    expect(k).not.toContain("HOSTING_AND_DEPLOYMENT");
  });
});
