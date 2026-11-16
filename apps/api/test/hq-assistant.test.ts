import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { auditLog, platformChatMessages } from "../src/db/schema.js";
import { setHqModel, type ModelRequest, type ModelResponse } from "../src/modules/assistant/model.js";
import { HQ_TOOLS } from "../src/modules/platform/assistant.js";
import { app, db, hqStaff, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterEach(() => setHqModel(null));
afterAll(async () => {
  await app.close();
  await pool.end();
});

const usage = { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 40000, cache_creation_input_tokens: 0 } as ModelResponse["usage"];
const thinking = { type: "thinking", thinking: "Look at the studio first.", signature: "sig-123" };
const tool = (name: string, input: unknown): ModelResponse => ({ content: [thinking, { type: "tool_use", id: `t_${name}_${Math.random().toString(36).slice(2, 8)}`, name, input, caller: { type: "direct" } }] as ModelResponse["content"], stop_reason: "tool_use", usage });
const say = (text: string): ModelResponse => ({ content: [{ type: "text", text, citations: null }] as ModelResponse["content"], stop_reason: "end_turn", usage });
const lastResult = (req: ModelRequest) => {
  const block = (req.messages.at(-1)!.content as { type: string; content?: string; is_error?: boolean }[]).find((b) => b.type === "tool_result")!;
  return { error: !!block.is_error, text: block.content ?? "" };
};
function script(steps: ((req: ModelRequest) => ModelResponse)[]) {
  const seen: ModelRequest[] = [];
  let i = 0;
  setHqModel(async (req) => {
    seen.push(structuredClone(req));
    const step = steps[i++];
    if (!step) throw new Error("script ran out");
    return step(req);
  });
  return seen;
}

describe("HQ assistant", () => {
  it("knows every doc, looks into a studio read-only, and keeps its thinking in the conversation", async () => {
    const s = await studio();
    const hq = await hqStaff("support", "Sam");
    expect((await s.owner.call("POST", "/platform/assistant/ask", { text: "hi" })).status).toBe(404);
    const seen = script([
      () => tool("studio_overview", { studio_id: s.orgId }),
      (req) => {
        const r = JSON.parse(lastResult(req).text);
        expect(r.studio.name).toBe("Test Studio");
        expect(r.plan.label).toBe("Signature");
        expect(r.yourSupportAccess.open).toBe(false);
        return tool("find_clients", { studio_id: s.orgId, name: "Chloe" });
      },
      (req) => {
        const r = lastResult(req);
        expect(r.error).toBe(true);
        expect(r.text).toMatch(/needs support access to Test Studio/);
        return say("Test Studio is on Signature with no bookings this week. To look at Chloe, start support access first.");
      },
    ]);
    const res = await hq.call("POST", "/platform/assistant/ask", { text: "Why can't Chloe book on Saturday?", studioId: s.orgId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reply).toMatch(/start support access first/);
    expect(res.body.looked).toEqual(["studio_overview", "find_clients"]);

    const first = seen[0]!;
    const sys = first.system.map((b) => b.text).join("\n");
    for (const doc of ["docs/PRODUCT_NOTES.md", "docs/HOSTING_AND_DEPLOYMENT.md", "docs/help/STUDIO_GUIDE.md", "README.md"]) expect(sys).toContain(`<document name="${doc}">`);
    expect(first.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect((first.messages[0]!.content as { text: string }[])[0]!.text).toMatch(/Asked by Sam .*HQ role: support\]\n\[Asking about Test Studio/);
    // Read-only: nothing that offers or changes anything.
    expect(first.tools.map((t) => t.name)).not.toContain("offer_action");
    expect(HQ_TOOLS.every((t) => !/offer|create|update|delete|cancel_/.test(t.name))).toBe(true);
    // Thinking is passed back exactly as it came.
    expect((seen[1]!.messages[1]!.content as { type: string; signature?: string }[])[0]).toMatchObject({ type: "thinking", signature: "sig-123" });

    // The next question carries on the same conversation.
    const again = script([(req) => {
      expect(req.messages.filter((m) => m.role === "user").length).toBe(4);
      return say("Still the same studio.");
    }]);
    expect((await hq.call("POST", "/platform/assistant/ask", { text: "And now?", chatId: res.body.chatId })).body.reply).toBe("Still the same studio.");
    expect(again).toHaveLength(1);
    const chat = (await hq.call("GET", `/platform/assistant/chats/${res.body.chatId}`)).body;
    expect(chat.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // Someone else in our team can't read it.
    expect((await (await hqStaff("owner")).call("GET", `/platform/assistant/chats/${res.body.chatId}`)).status).toBe(404);
  });

  it("client look-ups work only during support access, and are logged in the studio's audit log", async () => {
    const s = await studio();
    const hq = await hqStaff("support");
    await hq.call("POST", `/platform/studios/${s.orgId}/support-access`, { reason: "Owner asked why Chloe can't book", minutes: 30 });
    script([
      () => tool("find_clients", { studio_id: s.orgId, name: "Chloe" }),
      (req) => {
        const r = lastResult(req);
        expect(r.error, r.text).toBe(false);
        expect(r.text).toContain("Chloe");
        return tool("recent_activity", { studio_id: s.orgId, action: "support_access" });
      },
      (req) => {
        const r = JSON.parse(lastResult(req).text);
        expect(r.entries[0].details).toBeDefined(); // details shown with support access
        expect(r.entries.map((e: { by: string }) => e.by)).toContain("our team (support)");
        return say("Found Chloe.");
      },
    ]);
    expect((await hq.call("POST", "/platform/assistant/ask", { text: "Find Chloe" })).body.reply).toBe("Found Chloe.");
    const logged = await db.select().from(auditLog).where(and(eq(auditLog.orgId, s.orgId), eq(auditLog.action, "support_access.assistant_lookup")));
    expect(logged.map((l) => (l.details as { tool: string }).tool)).toEqual(["find_clients"]);
  });

  it("bad tool input is answered as an error, and refusals and missing set-up are handled", async () => {
    const hq = await hqStaff("onboarding");
    script([
      () => tool("studio_overview", { studio_id: "not-an-id" }),
      (req) => {
        expect(lastResult(req)).toMatchObject({ error: true, text: expect.stringMatching(/studio_id/) });
        return { content: [], stop_reason: "refusal", usage } as unknown as ModelResponse;
      },
    ]);
    const r = await hq.call("POST", "/platform/assistant/ask", { text: "Look at studio not-an-id" });
    expect(r.body.reply).toMatch(/can't help with that one/);
    const stored = await db.select().from(platformChatMessages).where(eq(platformChatMessages.chatId, r.body.chatId));
    expect(stored.at(-1)!.role).toBe("assistant");
    setHqModel(null);
    expect((await hq.call("POST", "/platform/assistant/ask", { text: "hello" })).body.error.code).toBe("assistant_not_set_up");
  });
});
