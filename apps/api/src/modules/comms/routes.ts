/**
 * The Communication inbox: read and answer WhatsApp messages here (and, next, email), alongside
 * the WhatsApp Business app on the studio's phone.
 *
 * Rules that protect the studio:
 *  - Nothing is sent until the studio has chosen how Meta is paid (its own card, or our credits).
 *  - Free-form replies only within 24 hours of the client's last message (WhatsApp's rule);
 *    after that, only approved templates, and the app says what Meta charges before sending.
 *  - Marketing messages to people who haven't agreed to WhatsApp messages are refused.
 *  - The webhook only accepts messages signed by Meta, and only for numbers connected here.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac } from "node:crypto";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { COMMS_BILLING_MODES, buyCredits, commsBilling as commsBillingInput, connectWhatsapp, conversationsQuery, replyText, sendTemplate, startConversation, updateConversation, schemas } from "@studio/shared";
import { z } from "zod";
import type { Db, DbOrTx } from "../../db/client.js";
import { commsBilling, commsMessages, conversations, creditPurchases, memberships, messageCreditLedger, users, whatsappSettings } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound, unauthorized } from "../../lib/errors.js";
import type { Flags } from "../../lib/flags.js";
import { inTx, withFlags } from "../../lib/route.js";
import { decryptSecret, encryptSecret, sameSecret } from "../../lib/secrets.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { whatsappFor } from "../marketing/whatsapp.js";
import { clientByPhone, conversationFor, recordMessage } from "./threads.js";
import { replyByEmail } from "./email.js";
import { NOT_READY, WINDOW_MS, billingFor, billingReady, chargeCredits, creditsAvailable, messageCost, refundCredits } from "./billing.js";
import { WhatsappError, exchangeSignupCode, phoneDetails, sendTemplateMessage, sendText, subscribeApp } from "./wa-api.js";

type Conversation = typeof conversations.$inferSelect;
const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");
const idParam = z.object({ id: schemas.id });

const windowOpen = (c: Conversation, now = new Date()) => !!c.lastInboundAt && now.getTime() - c.lastInboundAt.getTime() < WINDOW_MS;

// ---------------------------------------------------------------------------
// Webhook: messages in, delivery updates, and messages staff send from the phone app
// ---------------------------------------------------------------------------
type WaMsg = { from?: string; to?: string; id: string; timestamp?: string; type: string; text?: { body?: string } };
type WaChange = {
  field: string;
  value: {
    metadata?: { phone_number_id?: string; display_phone_number?: string };
    contacts?: { wa_id: string; profile?: { name?: string } }[];
    messages?: WaMsg[];
    message_echoes?: WaMsg[];
    statuses?: { id: string; status: string; errors?: { title?: string; message?: string }[] }[];
  };
};

export async function handleWebhook(db: Db, body: { entry?: { changes?: WaChange[] }[] }) {
  let handled = 0;
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const pid = ch.value.metadata?.phone_number_id;
      if (!pid) continue;
      const [wa] = await db.select({ orgId: whatsappSettings.orgId }).from(whatsappSettings).where(eq(whatsappSettings.phoneNumberId, pid));
      if (!wa) continue;
      await db.transaction(async (tx) => {
        const names = new Map((ch.value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
        const at = (m: WaMsg) => (m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date());
        const body = (m: WaMsg) => (m.type === "text" ? (m.text?.body ?? "") : null);
        const kind = (m: WaMsg) => (m.type === "text" ? "text" : ["image", "video", "audio", "document", "sticker"].includes(m.type) ? "media" : "other") as "text" | "media" | "other";
        // A client wrote in.
        for (const m of ch.field === "messages" ? (ch.value.messages ?? []) : []) {
          const from = digits(m.from);
          const conv = await conversationFor(tx, wa.orgId, from, names.get(m.from ?? "") ?? null);
          if (await recordMessage(tx, conv, { direction: "in", origin: "contact", kind: kind(m), body: body(m) ?? `[${m.type}]`, externalId: m.id, status: "received", at: at(m) })) handled++;
        }
        // Staff replied from the WhatsApp Business app on the phone (coexistence).
        for (const m of ch.field === "smb_message_echoes" ? (ch.value.message_echoes ?? []) : []) {
          const to = digits(m.to);
          const conv = await conversationFor(tx, wa.orgId, to);
          if (await recordMessage(tx, conv, { direction: "out", origin: "phone_app", kind: kind(m), body: body(m) ?? `[${m.type}]`, externalId: m.id, status: "sent", at: at(m) })) handled++;
        }
        // Sent / delivered / read / failed. A failed charged message gets its credits back.
        for (const st of ch.field === "messages" ? (ch.value.statuses ?? []) : []) {
          const status = (["sent", "delivered", "read", "failed"] as const).find((x) => x === st.status);
          if (!status) continue;
          const [msg] = await tx.select().from(commsMessages).where(and(eq(commsMessages.orgId, wa.orgId), eq(commsMessages.externalId, st.id)));
          if (!msg) continue;
          const order = ["queued", "sent", "delivered", "read"];
          if (status !== "failed" && order.indexOf(status) <= order.indexOf(msg.status)) continue;
          await tx.update(commsMessages).set({ status, error: status === "failed" ? (st.errors?.[0]?.message ?? st.errors?.[0]?.title ?? "WhatsApp couldn't deliver it") : null }).where(eq(commsMessages.id, msg.id));
          if (status === "failed" && msg.status !== "failed") await refundCredits(tx, wa.orgId, Number(msg.costCents), msg.id, "Message failed to send");
          handled++;
        }
      });
    }
  }
  return handled;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function commsRoutes(app: FastifyInstance) {
  const { db, config } = app;

  async function connection(tx: DbOrTx, orgId: string) {
    const wa = await whatsappFor(tx, orgId);
    if (!wa.phoneNumberId || !wa.accessToken) throw conflict("whatsapp_not_connected", "Connect your WhatsApp number first (Communication → Settings).");
    return { wa, token: decryptSecret(wa.accessToken) };
  }

  const statusView = async (orgId: string) => {
    const b = await billingFor(db, orgId);
    const wa = await whatsappFor(db, orgId);
    const [{ unread } = { unread: 0 }] = await db.select({ unread: sql<number>`coalesce(sum(${conversations.unread}), 0)::int` }).from(conversations).where(and(eq(conversations.orgId, orgId), eq(conversations.status, "open")));
    return {
      billing: { mode: b.mode, label: COMMS_BILLING_MODES[b.mode], ready: billingReady(b), balanceCents: Number(b.balanceCents), creditsOffered: creditsAvailable(config) },
      whatsapp: { connected: !!(wa.phoneNumberId && wa.accessToken), coexistence: wa.coexistence, phone: wa.displayPhone, lastError: wa.lastError, signupReady: !!(config.META_APP_ID && config.META_APP_SECRET) },
      unread,
      notice: "Meta charges for WhatsApp messages: marketing messages every time, service updates outside the 24-hour reply window. Replies to a client within 24 hours of their message are free.",
    };
  };

  app.register(async (inbox) => {
    inbox.addHook("preHandler", async (req) => requirePermission(req, "useInbox"));

    inbox.get("/comms/status", async (req) => statusView(req.auth.orgId));

    inbox.get("/comms/conversations", async (req) => {
      const { status, q, mine } = parse(conversationsQuery, req.query);
      const search = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const rows = await db
        .select({ c: conversations, clientName: sql<string | null>`${users.firstName} || ' ' || ${users.lastName}` })
        .from(conversations)
        .leftJoin(users, eq(users.id, conversations.clientId))
        .where(and(
          eq(conversations.orgId, req.auth.orgId),
          status === "all" ? undefined : eq(conversations.status, status),
          mine ? eq(conversations.assignedTo, req.auth.userId) : undefined,
          search ? or(ilike(conversations.contactName, search), ilike(conversations.contact, search), ilike(conversations.lastPreview, search), ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, search)) : undefined,
        ))
        .orderBy(desc(conversations.lastMessageAt))
        .limit(200);
      return rows.map(({ c, clientName }) => ({ ...c, name: clientName ?? c.contactName ?? (c.channel === "email" ? c.contact : `+${c.contact}`), isClient: !!c.clientId, replyWindowOpen: c.channel === "email" || windowOpen(c), replyWindowEndsAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS).toISOString() : null }));
    });

    inbox.get("/comms/conversations/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const [c] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.orgId, req.auth.orgId)));
      if (!c) throw notFound("conversation");
      const msgs = await db.select().from(commsMessages).where(eq(commsMessages.conversationId, id)).orderBy(desc(commsMessages.createdAt)).limit(200);
      const wa = await whatsappFor(db, req.auth.orgId);
      const open = windowOpen(c);
      return {
        conversation: { ...c, replyWindowOpen: open, replyWindowEndsAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS).toISOString() : null },
        messages: msgs.reverse().map((m) => ({ ...m, costCents: Number(m.costCents) })),
        // Outside the window only templates can be sent; say so plainly.
        canReply: c.channel === "email" || open ? { freeText: true, why: null } : { freeText: false, why: "It's been more than 24 hours since their last message, so WhatsApp only allows one of your approved templates. Meta charges for these." },
        templates: wa.templates,
      };
    });

    inbox.post("/comms/conversations/:id/read", async (req) => {
      const { id } = parse(idParam, req.params);
      const [c] = await db.update(conversations).set({ unread: 0 }).where(and(eq(conversations.id, id), eq(conversations.orgId, req.auth.orgId))).returning();
      if (!c) throw notFound("conversation");
      return { unread: 0 };
    });

    inbox.patch("/comms/conversations/:id", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(updateConversation, req.body);
      if (input.assignedTo) {
        const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, input.assignedTo), inArray(memberships.role, ["owner", "admin", "front_desk"]), eq(memberships.active, true)));
        if (!m) throw notFound("team member");
      }
      const [c] = await db.update(conversations).set(input).where(and(eq(conversations.id, id), eq(conversations.orgId, req.auth.orgId))).returning();
      if (!c) throw notFound("conversation");
      return c;
    });

    /** A free reply, within 24 hours of their last message. */
    inbox.post("/comms/conversations/:id/messages", async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const { text } = parse(replyText, req.body);
      const out = await inTx(app, async (tx) => {
        const [c] = await tx.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.orgId, req.auth.orgId))).for("update");
        if (!c) throw notFound("conversation");
        // Email: free to send, no reply window.
        if (c.channel === "email") return replyByEmail(tx, config, c, req.auth.userId, text);
        if (!billingReady(await billingFor(tx, req.auth.orgId))) throw conflict("billing_not_set_up", NOT_READY);
        if (!windowOpen(c)) throw conflict("window_closed", "It's been more than 24 hours since their last message, so WhatsApp only allows one of your approved templates. Choose a template instead.");
        const { wa, token } = await connection(tx, req.auth.orgId);
        const msg = (await recordMessage(tx, c, { direction: "out", origin: "platform", kind: "text", body: text, status: "queued", sentBy: req.auth.userId }))!;
        try {
          const wamid = await sendText(config, wa.phoneNumberId!, token, c.contact, text);
          const [u] = await tx.update(commsMessages).set({ status: "sent", externalId: wamid }).where(eq(commsMessages.id, msg.id)).returning();
          return u!;
        } catch (err) {
          const [u] = await tx.update(commsMessages).set({ status: "failed", error: err instanceof WhatsappError ? err.message : "WhatsApp didn't respond. Try again." }).where(eq(commsMessages.id, msg.id)).returning();
          return u!;
        }
      });
      reply.code(out.status === "failed" ? 502 : 201);
      return out.status === "failed" ? { error: { code: "send_failed", message: out.error, messageId: out.id } } : { ...out, costCents: 0 };
    });

    /** Send an approved template (allowed any time; Meta may charge). Asks first, saying what it costs. */
    async function sendTemplateTo(tx: DbOrTx, orgId: string, userId: string, c: Conversation, input: { template: string; language: string; variables: string[] }, flags: Flags) {
      const b = await billingFor(tx, orgId);
      if (!billingReady(b)) throw conflict("billing_not_set_up", NOT_READY);
      const { wa, token } = await connection(tx, orgId);
      const t = wa.templates.find((x) => x.name === input.template && x.language === input.language);
      if (!t) throw notFound("template");
      if (input.variables.length !== t.variables) throw badRequest("whatsapp_blanks", `“${t.name}” has ${t.variables} ${t.variables === 1 ? "blank" : "blanks"} to fill in.`);
      if (t.category === "marketing" && c.clientId) {
        const [m] = await tx.select({ ok: memberships.marketingWhatsapp }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, c.clientId)));
        if (!m?.ok && !windowOpen(c)) throw conflict("no_consent", "They haven't agreed to marketing messages on WhatsApp. You can still send service updates, or reply when they message you.");
      }
      const inWindow = windowOpen(c);
      const cost = b.mode === "credits" ? messageCost(config, c.contact, { template: t, inWindow }) : null;
      if (b.mode === "credits" && cost === null) throw conflict("no_rate", "There's no message price for that country yet, so it can't be sent on credits. Contact support.");
      const free = t.category === "utility" && inWindow;
      flags.confirm({
        code: "whatsapp_charge",
        message: free
          ? "This service update is free because they messaged you in the last 24 hours."
          : b.mode === "credits"
            ? `Meta charges for this ${t.category === "marketing" ? "marketing" : "service"} message. It uses US$${((cost ?? 0) / 100).toFixed(2)} of your message credits (US$${(Number(b.balanceCents) / 100).toFixed(2)} left).`
            : `Meta charges for this ${t.category === "marketing" ? "marketing" : "service"} message, billed to your WhatsApp account at Meta's rates.`,
      });
      // Ask before anything is sent or charged (a message can't be unsent).
      flags.enforce();
      const msg = (await recordMessage(tx, c, { direction: "out", origin: "platform", kind: "template", body: t.body.replace(/\{\{(\d+)\}\}/g, (_, i) => input.variables[Number(i) - 1] ?? ""), template: { name: t.name, language: t.language, category: t.category, variables: input.variables }, status: "queued", sentBy: userId, costCents: String(cost ?? 0) }))!;
      if (cost) await chargeCredits(tx, orgId, cost, msg.id, `WhatsApp ${t.category} message`);
      try {
        const wamid = await sendTemplateMessage(config, wa.phoneNumberId!, token, c.contact, { name: t.name, language: t.language, params: input.variables });
        return (await tx.update(commsMessages).set({ status: "sent", externalId: wamid }).where(eq(commsMessages.id, msg.id)).returning())[0]!;
      } catch (err) {
        if (cost) await refundCredits(tx, orgId, cost, msg.id, "Message failed to send");
        return (await tx.update(commsMessages).set({ status: "failed", error: err instanceof WhatsappError ? err.message : "WhatsApp didn't respond. Try again." }).where(eq(commsMessages.id, msg.id)).returning())[0]!;
      }
    }

    inbox.post("/comms/conversations/:id/template", async (req) => {
      const { id } = parse(idParam, req.params);
      const input = parse(sendTemplate, req.body);
      return withFlags(app, input.acknowledge, async (tx, flags) => {
        const [c] = await tx.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.orgId, req.auth.orgId))).for("update");
        if (!c) throw notFound("conversation");
        const m = await sendTemplateTo(tx, req.auth.orgId, req.auth.userId, c, input, flags);
        return { ...m, costCents: Number(m.costCents) };
      });
    });

    /** Message a client who hasn't written in (business-initiated: always a template). */
    inbox.post("/comms/conversations", async (req, reply) => {
      const input = parse(startConversation, req.body);
      const out = await withFlags(app, input.acknowledge, async (tx, flags) => {
        const [u] = await tx.select({ phone: users.phone, first: users.firstName, last: users.lastName }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, input.clientId), eq(memberships.role, "client")));
        if (!u) throw notFound("client");
        const wa = await whatsappFor(tx, req.auth.orgId);
        const raw = digits(u.phone);
        if (raw.length < 8) throw badRequest("no_mobile", `${u.first} doesn't have a mobile number on their profile.`);
        const to = (u.phone ?? "").trim().startsWith("+") || raw.length > 10 ? raw : `${wa.defaultCountryCode}${raw}`;
        const c = await conversationFor(tx, req.auth.orgId, to, `${u.first} ${u.last}`);
        const m = await sendTemplateTo(tx, req.auth.orgId, req.auth.userId, c, input, flags);
        return { conversationId: c.id, message: { ...m, costCents: Number(m.costCents) } };
      });
      reply.code(201);
      return out;
    });
  });

  // --- Settings: payment first, then connect WhatsApp (owners and admins) ------------------
  app.register(async (admin) => {
    admin.addHook("preHandler", async (req) => requirePermission(req, "manageComms"));

    /** Choose how Meta gets paid. Required before WhatsApp can be connected or used. */
    admin.put("/comms/billing", async (req) => {
      const input = parse(commsBillingInput, req.body);
      if (input.mode === "credits" && !creditsAvailable(config)) throw conflict("credits_unavailable", "Buying message credits isn't available yet. Add a payment method in Meta and choose “Pay Meta directly”.");
      await billingFor(db, req.auth.orgId);
      await db
        .update(commsBilling)
        .set(input.mode === "meta_direct" ? { mode: "meta_direct", metaPaymentConfirmedAt: new Date(), metaPaymentConfirmedBy: req.auth.userId } : { mode: "credits" })
        .where(eq(commsBilling.orgId, req.auth.orgId));
      await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "comms.billing", entityType: "organization", entityId: req.auth.orgId, details: { mode: input.mode } });
      return statusView(req.auth.orgId);
    });

    /** Buy message credits. Nothing is added until the payment provider confirms payment. */
    admin.post("/comms/credits/purchases", async (req, reply) => {
      const { amountCents } = parse(buyCredits, req.body);
      if (!creditsAvailable(config)) throw conflict("credits_unavailable", "Buying message credits isn't available yet.");
      const [p] = await db.insert(creditPurchases).values({ orgId: req.auth.orgId, amountCents, createdBy: req.auth.userId }).returning();
      reply.code(201);
      return { purchase: p, next: "Pay to add these credits. They're added as soon as the payment goes through." };
    });

    admin.get("/comms/credits", async (req) => {
      const b = await billingFor(db, req.auth.orgId);
      const ledger = await db.select().from(messageCreditLedger).where(eq(messageCreditLedger.orgId, req.auth.orgId)).orderBy(desc(messageCreditLedger.createdAt)).limit(100);
      return { balanceCents: Number(b.balanceCents), ledger: ledger.map((l) => ({ ...l, changeCents: Number(l.changeCents), balanceAfterCents: Number(l.balanceAfterCents) })) };
    });

    /** Finish Meta's sign-up window: keeps the WhatsApp Business app working on the phone (coexistence). */
    admin.post("/comms/whatsapp/connect", async (req) => {
      const input = parse(connectWhatsapp, req.body);
      if (!billingReady(await billingFor(db, req.auth.orgId))) throw conflict("billing_not_set_up", NOT_READY);
      const [taken] = await db.select({ orgId: whatsappSettings.orgId }).from(whatsappSettings).where(eq(whatsappSettings.phoneNumberId, input.phoneNumberId));
      if (taken && taken.orgId !== req.auth.orgId) throw conflict("number_in_use", "That WhatsApp number is already connected to another studio.");
      let token: string;
      try {
        token = await exchangeSignupCode(config, input.code);
        await subscribeApp(config, input.businessAccountId, token);
      } catch (err) {
        throw badRequest("whatsapp_error", `WhatsApp said: ${(err instanceof Error ? err.message : "it couldn't finish connecting").replace(/\.$/, "")}. Try connecting again.`);
      }
      const details = await phoneDetails(config, input.phoneNumberId, token).catch(() => ({}) as { display_phone_number?: string });
      await whatsappFor(db, req.auth.orgId);
      await db
        .update(whatsappSettings)
        .set({ phoneNumberId: input.phoneNumberId, businessAccountId: input.businessAccountId, accessToken: encryptSecret(token), coexistence: input.coexistence, displayPhone: details.display_phone_number ?? null, connectedAt: new Date(), lastError: null })
        .where(eq(whatsappSettings.orgId, req.auth.orgId));
      await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "comms.whatsapp_connected", entityType: "organization", entityId: req.auth.orgId, details: { coexistence: input.coexistence } });
      return statusView(req.auth.orgId);
    });

    admin.post("/comms/whatsapp/disconnect", async (req) => {
      await db.update(whatsappSettings).set({ accessToken: null, phoneNumberId: null, connectedAt: null }).where(eq(whatsappSettings.orgId, req.auth.orgId));
      await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "comms.whatsapp_disconnected", entityType: "organization", entityId: req.auth.orgId });
      return statusView(req.auth.orgId);
    });
  });

  // --- Webhook (Meta). Signed with the platform's app secret over the raw body. ----------------
  app.register(async (hooks) => {
    hooks.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
      (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
      try { done(null, body ? JSON.parse(body as string) : {}); } catch { done(badRequest("bad_json", "That request couldn't be understood."), undefined); }
    });
    hooks.get("/public/comms/whatsapp/webhook", { config: { public: true } }, async (req, reply) => {
      const q = req.query as Record<string, string>;
      if (!config.META_VERIFY_TOKEN || q["hub.mode"] !== "subscribe" || !sameSecret(q["hub.verify_token"] ?? "", config.META_VERIFY_TOKEN)) throw unauthorized();
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    });
    hooks.post("/public/comms/whatsapp/webhook", { config: { public: true, rateLimit: { max: 1200, timeWindow: "1 minute" } } }, async (req) => {
      const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? "";
      const sig = String(req.headers["x-hub-signature-256"] ?? "");
      if (!config.META_APP_SECRET || !sig.startsWith("sha256=") || !sameSecret(sig, `sha256=${createHmac("sha256", config.META_APP_SECRET).update(raw).digest("hex")}`)) throw unauthorized();
      return { handled: await handleWebhook(db, req.body as never) };
    });
  });
}
