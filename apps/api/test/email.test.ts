import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { commsMessages, conversations, emailAccounts, users } from "../src/db/schema.js";
import { setMailFetch, stripQuoted, syncEmail } from "../src/modules/comms/email.js";
import { app, config, db, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const b64 = (s: string) => Buffer.from(s).toString("base64url");
type Sent = { url: string; body: string; auth: string | null };

/** Pretend to be Google: tokens, the profile, a small mailbox, and sending. */
function fakeGmail(mail: { id: string; from: string; to: string; subject: string; text: string; at: number; msgId: string }[]) {
  const sent: Sent[] = [];
  setMailFetch((async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    sent.push({ url, body, auth: new Headers(init?.headers).get("authorization") });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "ya29.access", refresh_token: "1//refresh-token", expires_in: 3600 });
    if (url.endsWith("/users/me/profile")) return json({ emailAddress: "Hello@TestStudio.com" });
    if (url.includes("/users/me/messages?q=")) return json({ messages: mail.map((m) => ({ id: m.id })) });
    const one = url.match(/\/users\/me\/messages\/([^/?]+)\?format=full/);
    if (one) {
      const m = mail.find((x) => x.id === one[1])!;
      return json({ id: m.id, threadId: `t-${m.id}`, internalDate: String(m.at), payload: { mimeType: "text/plain", headers: [{ name: "From", value: m.from }, { name: "To", value: m.to }, { name: "Subject", value: m.subject }, { name: "Message-ID", value: m.msgId }], body: { data: b64(m.text) } } });
    }
    if (url.endsWith("/users/me/messages/send")) return json({ id: "sent-1" });
    return json({ error: { message: "unexpected " + url } }, 404);
  }) as typeof fetch);
  return sent;
}

async function connect(s: Awaited<ReturnType<typeof studio>>) {
  const r = await s.owner.call("POST", "/comms/email/connect", { provider: "gmail" });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const url = new URL(r.body.url);
  expect(url.host).toBe("accounts.google.com");
  expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
  expect(url.searchParams.get("scope")).toMatch(/gmail\.modify/);
  const state = url.searchParams.get("state")!;
  const cb = await app.inject({ method: "GET", url: `/v1/public/comms/email/callback/gmail?code=4/auth-code&state=${state}` });
  return { cb, state };
}

describe("email in the Communication inbox", () => {
  it("connects Gmail with the provider's own sign-in and keeps the tokens encrypted", async () => {
    const s = await studio();
    const fd = await person(s.orgId, "front_desk", "Faye");
    expect((await fd.call("POST", "/comms/email/connect", { provider: "gmail" })).status).toBe(403);
    fakeGmail([]);
    const { cb, state } = await connect(s);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe("http://localhost:5173/communication?email=connected");
    const [a] = await db.select().from(emailAccounts);
    expect(a).toMatchObject({ provider: "gmail", address: "hello@teststudio.com" });
    expect(a!.refreshToken.startsWith("v1:")).toBe(true);
    expect(a!.refreshToken).not.toContain("refresh-token");
    // The one-time value can't be used again, and made-up ones are refused.
    const again = await app.inject({ method: "GET", url: `/v1/public/comms/email/callback/gmail?code=x12345&state=${state}` });
    expect(again.headers.location).toMatch(/email=expired$/);
    const fake = await app.inject({ method: "GET", url: `/v1/public/comms/email/callback/gmail?code=x12345&state=${"a".repeat(48)}` });
    expect(fake.headers.location).toMatch(/email=expired$/);
    expect((await fd.call("GET", "/comms/email")).body.account).toMatchObject({ provider: "gmail", address: "hello@teststudio.com" });
  });

  it("brings mail into client threads and replies in the same Gmail thread", async () => {
    const s = await studio();
    await db.update(users).set({ email: "chloe@gmail.com" }).where(eq(users.id, s.c1.id));
    const now = Date.now();
    const sent = fakeGmail([
      { id: "m1", from: "Chloe Ng <chloe@gmail.com>", to: "hello@teststudio.com", subject: "Parking?", text: "Hi! Is there parking near Central?\n\nOn Tue, Studio wrote:\n> old stuff", at: now - 60_000, msgId: "<abc@mail.gmail.com>" },
      { id: "m2", from: "Mailer-Daemon <mailer-daemon@googlemail.com>", to: "hello@teststudio.com", subject: "Delivery failed", text: "x", at: now - 50_000, msgId: "<d@x>" },
    ]);
    await connect(s);
    expect(await syncEmail(db, config, s.orgId)).toBe(1);
    expect(await syncEmail(db, config, s.orgId)).toBe(0); // matched by id: nothing twice
    const [c] = await db.select().from(conversations);
    expect(c).toMatchObject({ channel: "email", contact: "chloe@gmail.com", clientId: s.c1.id, unread: 1 });
    const [m] = await db.select().from(commsMessages);
    expect(m!.body).toBe("Parking?\n\nHi! Is there parking near Central?");
    expect(m!.meta).toMatchObject({ subject: "Parking?", threadId: "t-m1", messageId: "<abc@mail.gmail.com>" });

    const list = (await s.owner.call("GET", "/comms/conversations")).body;
    expect(list[0]).toMatchObject({ channel: "email", name: expect.stringMatching(/^Chloe/), replyWindowOpen: true });
    const r = await s.owner.call("POST", `/comms/conversations/${c!.id}/messages`, { text: "Yes, there's a car park behind the building." });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: "sent", externalId: "email:sent-1" });
    const send = sent.find((x) => x.url.endsWith("/messages/send"))!;
    expect(send.auth).toBe("Bearer ya29.access");
    const payload = JSON.parse(send.body) as { raw: string; threadId: string };
    expect(payload.threadId).toBe("t-m1");
    const raw = Buffer.from(payload.raw, "base64url").toString();
    expect(raw).toContain("To: chloe@gmail.com");
    expect(raw).toContain("Subject: Re: Parking?");
    expect(raw).toContain("In-Reply-To: <abc@mail.gmail.com>");
  });

  it("trims quoted earlier messages", () => {
    expect(stripQuoted("Thanks!\n\nOn Mon, 3 Nov 2026 at 10:00, Studio <x@y.com> wrote:\n> Hello")).toBe("Thanks!");
    expect(stripQuoted("See you\n> quoted\n> more")).toBe("See you");
  });
});
