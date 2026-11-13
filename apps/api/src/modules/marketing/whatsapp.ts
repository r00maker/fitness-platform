/**
 * WhatsApp Business (WhatsApp Cloud API, run by Meta).
 *
 * How it fits together:
 *  - The studio connects its WhatsApp Business number once: phone number ID, business account ID
 *    and an access token (stored encrypted, never shown again).
 *  - Messages the studio starts (journeys, reminders) must use a template WhatsApp has approved,
 *    with blanks like {{1}} filled in per client. The studio adds its approved templates here
 *    (or syncs them from WhatsApp), and journeys pick from that list.
 *  - Only clients who have said yes to WhatsApp messages, and have a mobile number, get them.
 *  - Messages go through the same outbox as email and push, so they retry and can be traced.
 *
 * Replies from clients (two-way chat) arrive on a webhook; that, and the inbox, come later.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { whatsappSettings as whatsappSettingsInput, whatsappTemplateInput, whatsappVariableCount } from "@studio/shared";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { DbOrTx } from "../../db/client.js";
import { memberships, notifications, users, whatsappSettings } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { parse, parsePatch } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { mergeValues, type Urls } from "./messages.js";

type Settings = typeof whatsappSettings.$inferSelect;

/** The HTTP client for WhatsApp (swapped in tests). */
let waFetch: typeof fetch = (...a) => fetch(...a);
export const setWhatsappFetch = (f: typeof fetch) => (waFetch = f);

export async function whatsappFor(db: DbOrTx, orgId: string): Promise<Settings> {
  const [s] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.orgId, orgId));
  if (s) return s;
  const [c] = await db.insert(whatsappSettings).values({ orgId }).onConflictDoNothing().returning();
  return c ?? (await db.select().from(whatsappSettings).where(eq(whatsappSettings.orgId, orgId)))[0]!;
}
export const whatsappConnected = (s: Settings) => !!(s.phoneNumberId && s.accessToken);

/** Phone numbers in the international form WhatsApp wants: digits only, with the country code. */
export function waNumber(phone: string | null | undefined, countryCode: string): string | null {
  const raw = (phone ?? "").trim();
  const d = raw.replace(/\D/g, "");
  if (d.length < 8) return null;
  if (raw.startsWith("+") || d.length > 10) return d;
  return `${countryCode}${d}`;
}

/** Fill {{first_name}}-style details into each blank. */
function fill(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => values[k] ?? "");
}

/**
 * Queue a template message to clients. Skips anyone who hasn't agreed to WhatsApp messages or
 * has no mobile number; says how many were sent and skipped.
 */
export async function queueWhatsapp(
  tx: DbOrTx,
  orgId: string,
  clientIds: string[],
  msg: { template: string; language: string; variables: string[] },
  urls: Urls,
  ref: Record<string, unknown> = {},
): Promise<{ sent: number; skipped: number; reason?: string }> {
  const s = await whatsappFor(tx, orgId);
  if (!whatsappConnected(s)) return { sent: 0, skipped: clientIds.length, reason: "WhatsApp isn't connected" };
  const t = s.templates.find((x) => x.name === msg.template && x.language === msg.language);
  if (!t) return { sent: 0, skipped: clientIds.length, reason: "That WhatsApp template has been removed" };
  if (!clientIds.length) return { sent: 0, skipped: 0 };
  const rows = await tx
    .select({ id: users.id, phone: users.phone, ok: memberships.marketingWhatsapp })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, clientIds)));
  const merged = await mergeValues(tx, orgId, rows.map((r) => r.id), urls);
  let sent = 0;
  for (const r of rows) {
    const to = waNumber(r.phone, s.defaultCountryCode);
    if (!r.ok || !to) continue;
    const values = (merged.get(r.id) ?? {}) as Record<string, string>;
    await tx.insert(notifications).values({
      orgId, userId: r.id, channel: "whatsapp", template: "custom",
      data: { to, template: t.name, language: t.language, params: msg.variables.map((v) => fill(v, values).slice(0, 200)), preview: t.body, ref },
    });
    sent++;
  }
  return { sent, skipped: clientIds.length - sent, ...(sent < clientIds.length ? { reason: "They haven't agreed to WhatsApp messages or have no mobile number" } : {}) };
}

/** Delivery (called by the notifications worker): send one template message with the studio's own number. */
export async function sendWhatsapp(db: DbOrTx, cfg: Pick<Config, "META_GRAPH_VERSION">, orgId: string, d: { to: string; template: string; language: string; params: string[] }) {
  const s = await whatsappFor(db, orgId);
  if (!whatsappConnected(s)) throw new Error("WhatsApp isn't connected");
  const res = await waFetch(`https://graph.facebook.com/${cfg.META_GRAPH_VERSION}/${s.phoneNumberId}/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${decryptSecret(s.accessToken!)}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: d.to,
      type: "template",
      template: { name: d.template, language: { code: d.language }, ...(d.params.length ? { components: [{ type: "body", parameters: d.params.map((text) => ({ type: "text", text })) }] } : {}) },
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
    const msg = body.error?.message ?? `WhatsApp responded ${res.status}`;
    await db.update(whatsappSettings).set({ lastError: msg.slice(0, 300) }).where(eq(whatsappSettings.orgId, orgId));
    throw new Error(msg);
  }
}

const templateKey = z.object({ name: z.string().max(512), language: z.string().max(10) });

export async function whatsappRoutes(app: FastifyInstance) {
  const { db, config } = app;
  const view = (s: Settings) => ({
    connected: whatsappConnected(s),
    phoneNumberId: s.phoneNumberId,
    businessAccountId: s.businessAccountId,
    displayPhone: s.displayPhone,
    defaultCountryCode: s.defaultCountryCode,
    templates: s.templates,
    lastError: s.lastError,
  });

  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => requirePermission(req, "manageMarketing"));

    admin.get("/whatsapp/settings", async (req) => view(await whatsappFor(db, req.auth.orgId)));

    admin.patch("/whatsapp/settings", async (req) => {
      const input = parsePatch(whatsappSettingsInput, req.body);
      await whatsappFor(db, req.auth.orgId);
      const set: Partial<Settings> = { ...input, lastError: null } as Partial<Settings>;
      if ("accessToken" in input) set.accessToken = input.accessToken ? encryptSecret(input.accessToken) : null;
      const [u] = await db.update(whatsappSettings).set(set).where(eq(whatsappSettings.orgId, req.auth.orgId)).returning();
      await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "whatsapp.settings", entityType: "organization", entityId: req.auth.orgId, details: { changed: Object.keys(input) } });
      return view(u!);
    });

    /** Add a template the studio has had approved in WhatsApp Manager. */
    admin.post("/whatsapp/templates", async (req, reply) => {
      const t = parse(whatsappTemplateInput, req.body);
      const s = await whatsappFor(db, req.auth.orgId);
      if (s.templates.some((x) => x.name === t.name && x.language === t.language)) throw conflict("duplicate", "That template is already in your list.");
      const templates = [...s.templates, { ...t, variables: whatsappVariableCount(t.body) }];
      await db.update(whatsappSettings).set({ templates }).where(eq(whatsappSettings.orgId, req.auth.orgId));
      reply.code(201);
      return { templates };
    });

    admin.delete("/whatsapp/templates", async (req) => {
      const k = parse(templateKey, req.body);
      const s = await whatsappFor(db, req.auth.orgId);
      if (!s.templates.some((x) => x.name === k.name && x.language === k.language)) throw notFound("template");
      const templates = s.templates.filter((x) => !(x.name === k.name && x.language === k.language));
      await db.update(whatsappSettings).set({ templates }).where(eq(whatsappSettings.orgId, req.auth.orgId));
      return { templates };
    });

    /** Fetch the approved templates from WhatsApp, so nobody has to copy them in by hand. */
    admin.post("/whatsapp/templates/sync", async (req) => {
      const s = await whatsappFor(db, req.auth.orgId);
      if (!s.businessAccountId || !s.accessToken) throw badRequest("not_connected", "Connect your WhatsApp Business account first.");
      const res = await waFetch(`https://graph.facebook.com/${config.META_GRAPH_VERSION}/${s.businessAccountId}/message_templates?fields=name,language,status,category,components&limit=200`, {
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${decryptSecret(s.accessToken)}` },
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { name: string; language: string; status: string; category: string; components?: { type: string; text?: string }[] }[]; error?: { message: string } };
      if (!res.ok) throw badRequest("whatsapp_error", `WhatsApp said: ${body.error?.message ?? `error ${res.status}`}`);
      const approved = (body.data ?? []).filter((t) => t.status === "APPROVED" && ["MARKETING", "UTILITY"].includes(t.category));
      const templates = approved.map((t) => {
        const text = t.components?.find((c) => c.type === "BODY")?.text ?? "";
        return { name: t.name, language: t.language, body: text, category: t.category.toLowerCase(), variables: whatsappVariableCount(text) };
      });
      await db.update(whatsappSettings).set({ templates, lastError: null }).where(eq(whatsappSettings.orgId, req.auth.orgId));
      return { templates, skipped: (body.data?.length ?? 0) - approved.length };
    });
  });
}
