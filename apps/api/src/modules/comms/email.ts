/**
 * Email in the Communication inbox: a studio connects its Gmail or Outlook mailbox and reads and
 * answers client emails here, next to WhatsApp. Emails sent from the mailbox itself (on a phone
 * or computer) show up too, so the thread is complete either way.
 *
 * Security and privacy:
 *  - Connecting uses the provider's own sign-in (OAuth). We never see the password. The request
 *    carries a random one-time value, checked when the provider sends the person back.
 *  - Access is limited to reading and sending mail. Tokens are encrypted (SECRETS_KEY).
 *  - Emails are stored as plain text (never as HTML), so nothing in an email can run in the app.
 *  - Unlike WhatsApp, email costs nothing to send, so there's no billing step.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Db, DbOrTx } from "../../db/client.js";
import { commsMessages, conversations, emailAccounts, memberships, oauthStates, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../../lib/secrets.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { conversationFor, recordMessage } from "./threads.js";

export type Provider = "gmail" | "outlook";
type Account = typeof emailAccounts.$inferSelect;
type Cfg = Pick<Config, "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "MICROSOFT_CLIENT_ID" | "MICROSOFT_CLIENT_SECRET" | "MICROSOFT_TENANT" | "PUBLIC_API_URL" | "PUBLIC_APP_URL">;

let mailFetch: typeof fetch = (...a) => fetch(...a);
/** Tests: answer as Google or Microsoft would. */
export const setMailFetch = (f: typeof fetch) => (mailFetch = f);

export interface MailMessage {
  providerId: string;
  threadId: string;
  messageId: string | null;
  from: { address: string; name: string | null };
  to: string[];
  subject: string;
  text: string;
  at: Date;
}

class MailError extends Error {}
async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await mailFetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown; error_description?: string };
  if (!res.ok) {
    const e = body.error as { message?: string } | string | undefined;
    throw new MailError(body.error_description ?? (typeof e === "string" ? e : e?.message) ?? `The mail service responded ${res.status}`);
  }
  return body;
}

const redirectUri = (cfg: Cfg, p: Provider) => `${cfg.PUBLIC_API_URL.replace(/\/$/, "")}/v1/public/comms/email/callback/${p}`;
export const providerReady = (cfg: Cfg, p: Provider) => (p === "gmail" ? !!(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET) : !!(cfg.MICROSOFT_CLIENT_ID && cfg.MICROSOFT_CLIENT_SECRET));
const msToken = (cfg: Cfg) => `https://login.microsoftonline.com/${cfg.MICROSOFT_TENANT}/oauth2/v2.0/token`;
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH = "https://graph.microsoft.com/v1.0/me";

function authUrl(cfg: Cfg, p: Provider, state: string) {
  if (p === "gmail") {
    const q = new URLSearchParams({ client_id: cfg.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(cfg, p), response_type: "code", scope: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email", access_type: "offline", prompt: "consent", state });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({ client_id: cfg.MICROSOFT_CLIENT_ID!, redirect_uri: redirectUri(cfg, p), response_type: "code", response_mode: "query", scope: "offline_access Mail.ReadWrite Mail.Send User.Read", state });
  return `https://login.microsoftonline.com/${cfg.MICROSOFT_TENANT}/oauth2/v2.0/authorize?${q}`;
}

async function tokenRequest(cfg: Cfg, p: Provider, params: Record<string, string>) {
  const body = new URLSearchParams(p === "gmail" ? { client_id: cfg.GOOGLE_CLIENT_ID!, client_secret: cfg.GOOGLE_CLIENT_SECRET!, ...params } : { client_id: cfg.MICROSOFT_CLIENT_ID!, client_secret: cfg.MICROSOFT_CLIENT_SECRET!, ...params });
  return call<{ access_token: string; refresh_token?: string; expires_in: number }>(p === "gmail" ? "https://oauth2.googleapis.com/token" : msToken(cfg), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
}

/** A working access token, refreshed (and saved) when it's about to expire. */
async function accessToken(db: DbOrTx, cfg: Cfg, a: Account) {
  if (a.accessToken && a.accessExpiresAt && a.accessExpiresAt.getTime() > Date.now() + 60_000) return decryptSecret(a.accessToken);
  const t = await tokenRequest(cfg, a.provider, { grant_type: "refresh_token", refresh_token: decryptSecret(a.refreshToken) });
  await db
    .update(emailAccounts)
    .set({ accessToken: encryptSecret(t.access_token), accessExpiresAt: new Date(Date.now() + t.expires_in * 1000), ...(t.refresh_token ? { refreshToken: encryptSecret(t.refresh_token) } : {}) })
    .where(eq(emailAccounts.orgId, a.orgId));
  return t.access_token;
}

// --- Reading mail ------------------------------------------------------------------------
const header = (hs: { name: string; value: string }[], n: string) => hs.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? "";
const addr = (v: string) => {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1]!.trim() || null, address: m[2]!.trim().toLowerCase() } : { name: null, address: v.trim().toLowerCase() };
};
/** HTML to readable plain text (emails are never shown as HTML). */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
/** Drop the quoted earlier message ("On Tue, … wrote:" and "> " lines) so threads read cleanly. */
export function stripQuoted(text: string) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l, i) => /^On .+wrote:\s*$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^From: .+/.test(l) && i > 0 && lines[i - 1] === "" || (l.startsWith(">") && lines.slice(i).every((x) => x.startsWith(">") || !x.trim())));
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n").trim();
}
const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

type GmailPart = { mimeType: string; body?: { data?: string }; parts?: GmailPart[] };
function gmailText(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data) return b64url(part.body.data);
  for (const p of part.parts ?? []) { const t = gmailText(p); if (t) return t; }
  if (part.mimeType === "text/html" && part.body?.data) return htmlToText(b64url(part.body.data));
  for (const p of part.parts ?? []) if (p.mimeType === "text/html" && p.body?.data) return htmlToText(b64url(p.body.data));
  return "";
}

async function listGmail(token: string, since: Date): Promise<MailMessage[]> {
  const q = encodeURIComponent(`(in:inbox OR in:sent) after:${Math.floor(since.getTime() / 1000)}`);
  const list = await call<{ messages?: { id: string }[] }>(`${GMAIL}/messages?q=${q}&maxResults=50`, { headers: { Authorization: `Bearer ${token}` } });
  const out: MailMessage[] = [];
  for (const { id } of list.messages ?? []) {
    const m = await call<{ id: string; threadId: string; internalDate: string; payload: GmailPart & { headers: { name: string; value: string }[] } }>(`${GMAIL}/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
    const hs = m.payload.headers;
    out.push({ providerId: m.id, threadId: m.threadId, messageId: header(hs, "Message-ID") || null, from: addr(header(hs, "From")), to: header(hs, "To").split(",").map((x) => addr(x).address).filter(Boolean), subject: header(hs, "Subject"), text: gmailText(m.payload), at: new Date(Number(m.internalDate)) });
  }
  return out;
}

async function listOutlook(token: string, since: Date): Promise<MailMessage[]> {
  const out: MailMessage[] = [];
  for (const folder of ["inbox", "sentitems"]) {
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    const r = await call<{ value: { id: string; conversationId: string; internetMessageId: string; subject: string; from?: { emailAddress: { address: string; name: string } }; toRecipients: { emailAddress: { address: string } }[]; receivedDateTime: string; body: { contentType: string; content: string } }[] }>(
      `${GRAPH}/mailFolders/${folder}/messages?$filter=${filter}&$orderby=receivedDateTime asc&$top=50&$select=id,conversationId,internetMessageId,subject,from,toRecipients,receivedDateTime,body`,
      { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } },
    );
    for (const m of r.value) {
      out.push({ providerId: m.id, threadId: m.conversationId, messageId: m.internetMessageId ?? null, from: { address: (m.from?.emailAddress.address ?? "").toLowerCase(), name: m.from?.emailAddress.name ?? null }, to: m.toRecipients.map((t) => t.emailAddress.address.toLowerCase()), subject: m.subject ?? "", text: m.body.contentType === "html" ? htmlToText(m.body.content) : m.body.content, at: new Date(m.receivedDateTime) });
    }
  }
  return out;
}

/** Bring new mail into the inbox. Safe to run as often as you like (messages are matched by id). */
export async function syncEmail(db: Db, cfg: Cfg, orgId: string, now = new Date()) {
  const [a] = await db.select().from(emailAccounts).where(eq(emailAccounts.orgId, orgId));
  if (!a) return 0;
  try {
    const token = await accessToken(db, cfg, a);
    const since = new Date(Math.max((a.lastSyncAt?.getTime() ?? 0) - 10 * 60_000, now.getTime() - 14 * 86_400_000));
    const mail = a.provider === "gmail" ? await listGmail(token, since) : await listOutlook(token, since);
    let added = 0;
    await db.transaction(async (tx) => {
      for (const m of mail.sort((x, y) => x.at.getTime() - y.at.getTime())) {
        const outgoing = m.from.address === a.address.toLowerCase();
        const contact = outgoing ? m.to.find((t) => t !== a.address.toLowerCase()) : m.from.address;
        if (!contact || /(^|[.@])(no-?reply|mailer-daemon|postmaster)/i.test(contact)) continue;
        const conv = await conversationFor(tx, orgId, contact, outgoing ? null : m.from.name, "email");
        const body = stripQuoted(m.text).slice(0, 20_000) || "(No text)";
        const saved = await recordMessage(tx, conv, {
          direction: outgoing ? "out" : "in",
          origin: outgoing ? "mailbox" : "contact",
          kind: "text",
          body: m.subject ? `${m.subject}\n\n${body}` : body,
          externalId: `email:${m.providerId}`,
          status: outgoing ? "sent" : "received",
          meta: { subject: m.subject, threadId: m.threadId, messageId: m.messageId, providerId: m.providerId },
          at: m.at,
        });
        if (saved) added++;
      }
      await tx.update(emailAccounts).set({ lastSyncAt: now, lastError: null }).where(eq(emailAccounts.orgId, orgId));
    });
    return added;
  } catch (err) {
    await db.update(emailAccounts).set({ lastError: err instanceof MailError ? err.message : "Couldn't reach the mailbox." }).where(eq(emailAccounts.orgId, orgId));
    return 0;
  }
}

/** Worker: sync every connected mailbox. */
export async function syncAllEmail(db: Db, cfg: Cfg) {
  const all = await db.select({ orgId: emailAccounts.orgId }).from(emailAccounts);
  let n = 0;
  for (const { orgId } of all) n += await syncEmail(db, cfg, orgId);
  return n;
}

// --- Sending ------------------------------------------------------------------------------
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);
const safeLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Send an email as the studio's mailbox: a reply in the thread, or a new message. Returns the provider's id. */
export async function sendEmail(db: DbOrTx, cfg: Cfg, a: Account, m: { to: string; subject: string; text: string; replyTo?: { threadId?: string; messageId?: string | null; providerId?: string } }) {
  const token = await accessToken(db, cfg, a);
  const subject = safeLine(m.subject);
  if (a.provider === "gmail") {
    const raw = [
      `From: ${a.address}`,
      `To: ${safeLine(m.to)}`,
      `Subject: ${encodeHeader(subject)}`,
      ...(m.replyTo?.messageId ? [`In-Reply-To: ${safeLine(m.replyTo.messageId)}`, `References: ${safeLine(m.replyTo.messageId)}`] : []),
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(m.text).toString("base64"),
    ].join("\r\n");
    const r = await call<{ id: string }>(`${GMAIL}/messages/send`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url"), ...(m.replyTo?.threadId ? { threadId: m.replyTo.threadId } : {}) }) });
    return r.id;
  }
  if (m.replyTo?.providerId) {
    // Outlook replies in the same conversation; the sent copy arrives with the next sync.
    await call(`${GRAPH}/messages/${encodeURIComponent(m.replyTo.providerId)}/reply`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ comment: m.text }) });
    return null;
  }
  await call(`${GRAPH}/sendMail`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: { subject, body: { contentType: "Text", content: m.text }, toRecipients: [{ emailAddress: { address: m.to } }] }, saveToSentItems: true }) });
  return null;
}

/** Reply in an email thread from the inbox. */
export async function replyByEmail(tx: DbOrTx, cfg: Cfg, c: typeof conversations.$inferSelect, userId: string, text: string) {
  const [a] = await tx.select().from(emailAccounts).where(eq(emailAccounts.orgId, c.orgId));
  if (!a) throw conflict("email_not_connected", "Connect your Gmail or Outlook mailbox first (Communication → Settings).");
  const [last] = await tx.select().from(commsMessages).where(and(eq(commsMessages.conversationId, c.id), eq(commsMessages.direction, "in"))).orderBy(desc(commsMessages.createdAt)).limit(1);
  const subject = last?.meta?.subject ? (/^re:/i.test(last.meta.subject) ? last.meta.subject : `Re: ${last.meta.subject}`) : "Your message";
  const msg = (await recordMessage(tx, c, { direction: "out", origin: "platform", kind: "text", body: text, status: "queued", sentBy: userId, meta: { subject } }))!;
  try {
    const id = await sendEmail(tx, cfg, a, { to: c.contact, subject, text, replyTo: last?.meta ?? undefined });
    return (await tx.update(commsMessages).set({ status: "sent", ...(id ? { externalId: `email:${id}` } : {}) }).where(eq(commsMessages.id, msg.id)).returning())[0]!;
  } catch (err) {
    return (await tx.update(commsMessages).set({ status: "failed", error: err instanceof MailError ? err.message : "The mailbox didn't respond. Try again." }).where(eq(commsMessages.id, msg.id)).returning())[0]!;
  }
}

// --- Routes -------------------------------------------------------------------------------
const providerParam = z.object({ provider: z.enum(["gmail", "outlook"]) });
const newEmail = z.object({ clientId: z.uuid(), subject: z.string().trim().min(1, "Add a subject.").max(200), text: z.string().trim().min(1, "Write a message.").max(20_000) });

export async function emailRoutes(app: FastifyInstance) {
  const { db, config } = app;

  app.get("/comms/email", async (req) => {
    requirePermission(req, "useInbox");
    const [a] = await db.select().from(emailAccounts).where(eq(emailAccounts.orgId, req.auth.orgId));
    return {
      available: { gmail: providerReady(config, "gmail"), outlook: providerReady(config, "outlook") },
      account: a ? { provider: a.provider, address: a.address, lastSyncAt: a.lastSyncAt, lastError: a.lastError, connectedAt: a.connectedAt } : null,
      note: "Emails cost nothing to send. Your mailbox keeps working as normal; emails you send from it show up here too.",
    };
  });

  /** Start connecting: returns the provider's sign-in page. */
  app.post("/comms/email/connect", async (req) => {
    requirePermission(req, "manageComms");
    const { provider } = parse(providerParam, req.body);
    if (!providerReady(config, provider)) throw new AppError(503, "email_not_set_up", `${provider === "gmail" ? "Gmail" : "Outlook"} isn't set up on this server yet. Ask whoever runs it to add the ${provider === "gmail" ? "Google" : "Microsoft"} app details.`);
    const token = randomToken(24);
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, new Date()));
    await db.insert(oauthStates).values({ tokenHash: sha256(token), orgId: req.auth.orgId, userId: req.auth.userId, provider, expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { url: authUrl(config, provider, token) };
  });

  /** Where Google or Microsoft sends the person back after they've agreed. */
  app.get("/public/comms/email/callback/:provider", { config: { public: true, rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { provider } = parse(providerParam, req.params);
    const q = parse(z.object({ code: z.string().min(5).max(4000).optional(), state: z.string().regex(/^[a-f0-9]{48}$/), error: z.string().max(200).optional() }), req.query);
    const back = (status: string) => reply.redirect(`${config.PUBLIC_APP_URL.replace(/\/$/, "")}/communication?email=${status}`);
    const [st] = await db.delete(oauthStates).where(and(eq(oauthStates.tokenHash, sha256(q.state)), eq(oauthStates.provider, provider))).returning();
    if (!st || st.expiresAt < new Date()) return back("expired");
    if (q.error || !q.code) return back("cancelled");
    // Still allowed? (They might have lost admin access in the meantime.)
    const [m] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.orgId, st.orgId), eq(memberships.userId, st.userId), eq(memberships.active, true)));
    if (!m || !["owner", "admin"].includes(m.role)) return back("not_allowed");
    try {
      const t = await tokenRequest(config, provider, { grant_type: "authorization_code", code: q.code, redirect_uri: redirectUri(config, provider) });
      if (!t.refresh_token) return back("no_offline_access");
      const address =
        provider === "gmail"
          ? (await call<{ emailAddress: string }>(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${t.access_token}` } })).emailAddress
          : ((u) => u.mail ?? u.userPrincipalName)(await call<{ mail?: string; userPrincipalName: string }>(`${GRAPH}?$select=mail,userPrincipalName`, { headers: { Authorization: `Bearer ${t.access_token}` } }));
      const row = { provider, address: address.toLowerCase(), refreshToken: encryptSecret(t.refresh_token), accessToken: encryptSecret(t.access_token), accessExpiresAt: new Date(Date.now() + t.expires_in * 1000), lastSyncAt: null, lastError: null, connectedBy: st.userId, connectedAt: new Date() };
      await db.insert(emailAccounts).values({ orgId: st.orgId, ...row }).onConflictDoUpdate({ target: emailAccounts.orgId, set: row });
      await audit(db, { orgId: st.orgId, actorId: st.userId, action: "email.connected", entityType: "organization", entityId: st.orgId, details: { provider, address: address.toLowerCase() } });
    } catch {
      return back("failed");
    }
    return back("connected");
  });

  app.delete("/comms/email", async (req) => {
    requirePermission(req, "manageComms");
    const [a] = await db.delete(emailAccounts).where(eq(emailAccounts.orgId, req.auth.orgId)).returning();
    if (!a) throw notFound("mailbox");
    await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "email.disconnected", entityType: "organization", entityId: req.auth.orgId, details: { provider: a.provider } });
    return { disconnected: true, note: "Disconnected. Past emails stay in the inbox. You can also remove access from your Google or Microsoft account settings." };
  });

  /** Check for new mail now (it's also checked every couple of minutes). */
  app.post("/comms/email/sync", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req) => {
    requirePermission(req, "useInbox");
    const added = await syncEmail(db, config, req.auth.orgId);
    const [a] = await db.select({ lastError: emailAccounts.lastError }).from(emailAccounts).where(eq(emailAccounts.orgId, req.auth.orgId));
    if (!a) throw conflict("email_not_connected", "Connect your Gmail or Outlook mailbox first (Communication → Settings).");
    return { added, lastError: a.lastError };
  });

  /** Start an email to a client from the inbox. */
  app.post("/comms/email/messages", async (req, reply) => {
    requirePermission(req, "useInbox");
    const input = parse(newEmail, req.body);
    const out = await inTx(app, async (tx) => {
      const [a] = await tx.select().from(emailAccounts).where(eq(emailAccounts.orgId, req.auth.orgId));
      if (!a) throw conflict("email_not_connected", "Connect your Gmail or Outlook mailbox first (Communication → Settings).");
      const [client] = await tx.select({ email: users.email, first: users.firstName, last: users.lastName }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, input.clientId), eq(memberships.role, "client")));
      if (!client) throw notFound("client");
      if (!client.email) throw badRequest("no_email", "This client has no email address.");
      const conv = await conversationFor(tx, req.auth.orgId, client.email.toLowerCase(), `${client.first} ${client.last}`, "email");
      const msg = (await recordMessage(tx, conv, { direction: "out", origin: "platform", kind: "text", body: `${input.subject}\n\n${input.text}`, status: "queued", sentBy: req.auth.userId, meta: { subject: input.subject } }))!;
      try {
        const id = await sendEmail(tx, config, a, { to: client.email, subject: input.subject, text: input.text });
        return (await tx.update(commsMessages).set({ status: "sent", ...(id ? { externalId: `email:${id}` } : {}) }).where(eq(commsMessages.id, msg.id)).returning())[0]!;
      } catch (err) {
        return (await tx.update(commsMessages).set({ status: "failed", error: err instanceof MailError ? err.message : "The mailbox didn't respond." }).where(eq(commsMessages.id, msg.id)).returning())[0]!;
      }
    });
    reply.code(out.status === "failed" ? 502 : 201);
    return out.status === "failed" ? { error: { code: "send_failed", message: out.error } } : { message: out, conversationId: out.conversationId };
  });
}
