/**
 * Calls to Meta's WhatsApp Cloud API, in one place (and swappable in tests).
 *
 * Coexistence: a studio keeps using the WhatsApp Business app on its phone, and the same number is
 * connected here through Meta's sign-up window (Embedded Signup). Messages staff send from the phone
 * arrive as "echoes" on the webhook, so the inbox shows the whole conversation either way.
 */
import type { Config } from "../../config.js";

let waFetch: typeof fetch = (...a) => fetch(...a);
export const setWhatsappFetch = (f: typeof fetch) => (waFetch = f);

type Cfg = Pick<Config, "META_GRAPH_VERSION" | "META_APP_ID" | "META_APP_SECRET">;
const graph = (cfg: Cfg, path: string) => `https://graph.facebook.com/${cfg.META_GRAPH_VERSION}/${path}`;

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await waFetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok) throw new WhatsappError(body.error?.message ?? `WhatsApp responded ${res.status}`, body.error?.code);
  return body;
}
export class WhatsappError extends Error {
  constructor(message: string, readonly code?: number) { super(message); }
}

/** Finish sign-up: swap the one-time code from Meta's window for the studio's access token. */
export async function exchangeSignupCode(cfg: Cfg, code: string): Promise<string> {
  if (!cfg.META_APP_ID || !cfg.META_APP_SECRET) throw new WhatsappError("WhatsApp sign-up isn't set up on this server yet (META_APP_ID and META_APP_SECRET).");
  const q = new URLSearchParams({ client_id: cfg.META_APP_ID, client_secret: cfg.META_APP_SECRET, code });
  const r = await call<{ access_token?: string }>(`${graph(cfg, "oauth/access_token")}?${q}`);
  if (!r.access_token) throw new WhatsappError("Meta didn't return an access token.");
  return r.access_token;
}

/** Ask Meta to send this WhatsApp account's messages and delivery updates to our webhook. */
export async function subscribeApp(cfg: Cfg, businessAccountId: string, token: string) {
  await call(graph(cfg, `${businessAccountId}/subscribed_apps`), { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}

/** The number's display form, e.g. "+65 6123 4567". */
export async function phoneDetails(cfg: Cfg, phoneNumberId: string, token: string) {
  return call<{ display_phone_number?: string; verified_name?: string }>(`${graph(cfg, phoneNumberId)}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` } });
}

const send = (cfg: Cfg, phoneNumberId: string, token: string, payload: Record<string, unknown>) =>
  call<{ messages?: { id: string }[] }>(graph(cfg, `${phoneNumberId}/messages`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  }).then((r) => r.messages?.[0]?.id ?? null);

/** A free-form reply (only allowed within 24 hours of the client's last message). */
export const sendText = (cfg: Cfg, phoneNumberId: string, token: string, to: string, text: string) => send(cfg, phoneNumberId, token, { to, type: "text", text: { body: text, preview_url: true } });

/** A template message (the only kind allowed outside the 24 hours). */
export const sendTemplateMessage = (cfg: Cfg, phoneNumberId: string, token: string, to: string, t: { name: string; language: string; params: string[] }) =>
  send(cfg, phoneNumberId, token, {
    to,
    type: "template",
    template: { name: t.name, language: { code: t.language }, ...(t.params.length ? { components: [{ type: "body", parameters: t.params.map((text) => ({ type: "text", text })) }] } : {}) },
  });

/** A raw request through the same (swappable) client, for calls without a helper here. */
export const waRaw = (url: string, init?: RequestInit) => waFetch(url, init);
