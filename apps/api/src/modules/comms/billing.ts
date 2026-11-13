/**
 * Who pays Meta for WhatsApp messages. The platform never does on a studio's behalf without being
 * paid first:
 *  - "meta_direct": Meta bills the studio's own payment method. We charge nothing.
 *  - "credits": the studio buys credits from us (added once payment is confirmed); each charged
 *    message uses credits at the platform's rate card, and nothing charged is sent without enough.
 *
 * What Meta charges for (per-message pricing): marketing templates always; utility templates only
 * outside the 24-hour customer service window; free-form replies inside the window are free.
 */
import { and, eq, sql } from "drizzle-orm";
import type { WaCategory } from "@studio/shared";
import type { Config } from "../../config.js";
import type { DbOrTx } from "../../db/client.js";
import { commsBilling, creditPurchases, messageCreditLedger } from "../../db/schema.js";
import { conflict } from "../../lib/errors.js";

type Billing = typeof commsBilling.$inferSelect;
export const WINDOW_MS = 24 * 3_600_000;

export async function billingFor(db: DbOrTx, orgId: string): Promise<Billing> {
  const [b] = await db.select().from(commsBilling).where(eq(commsBilling.orgId, orgId));
  if (b) return b;
  const [c] = await db.insert(commsBilling).values({ orgId }).onConflictDoNothing().returning();
  return c ?? (await db.select().from(commsBilling).where(eq(commsBilling.orgId, orgId)))[0]!;
}

/** Ready to send: Meta bills the studio directly (confirmed), or the studio uses credits. */
export const billingReady = (b: Billing) => (b.mode === "meta_direct" && !!b.metaPaymentConfirmedAt) || b.mode === "credits";
export const NOT_READY = "Choose how WhatsApp messages are paid for first (Communication → Settings). Meta charges for messages, and they can't be sent until that's set up.";

/** The platform's rate card (US cents per message by country calling code and category), if it sells credits. */
export function rateCard(cfg: Pick<Config, "WHATSAPP_RATE_CARD">): Record<string, Partial<Record<WaCategory, number>>> | null {
  const raw = cfg.WHATSAPP_RATE_CARD ?? process.env.WHATSAPP_RATE_CARD;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
export const creditsAvailable = (cfg: Pick<Config, "WHATSAPP_RATE_CARD">) => !!rateCard(cfg);

/**
 * What a message costs in credits. Free replies and in-window utility messages cost 0. Returns
 * null when there's no rate for that country (then it can't be sent on credits).
 */
export function messageCost(cfg: Pick<Config, "WHATSAPP_RATE_CARD">, to: string, msg: { template?: { category: string } | null; inWindow: boolean }): number | null {
  if (!msg.template) return 0;
  const cat = msg.template.category as WaCategory;
  if (cat === "utility" && msg.inWindow) return 0;
  const card = rateCard(cfg);
  if (!card) return null;
  const prefix = Object.keys(card).filter((p) => to.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  const rate = prefix ? card[prefix]?.[cat] : undefined;
  return rate ?? null;
}

/** Use credits for a message (locks the balance so two sends can't both spend the last credit). */
export async function chargeCredits(tx: DbOrTx, orgId: string, cents: number, messageId: string | null, note: string) {
  if (cents <= 0) return;
  const [b] = await tx.select().from(commsBilling).where(eq(commsBilling.orgId, orgId)).for("update");
  const balance = Number(b?.balanceCents ?? 0);
  if (balance < cents) {
    throw conflict("not_enough_credits", `This message costs US$${(cents / 100).toFixed(2)} in message credits and you have US$${(balance / 100).toFixed(2)} left. Buy more credits under Communication → Settings.`, { balanceCents: balance, costCents: cents });
  }
  const after = Math.round((balance - cents) * 100) / 100;
  await tx.update(commsBilling).set({ balanceCents: String(after) }).where(eq(commsBilling.orgId, orgId));
  await tx.insert(messageCreditLedger).values({ orgId, changeCents: String(-cents), balanceAfterCents: String(after), reason: "message", note, messageId });
}

/** Put credits back (a charged message that failed to send). */
export async function refundCredits(tx: DbOrTx, orgId: string, cents: number, messageId: string, note: string) {
  if (cents <= 0) return;
  const [b] = await tx.update(commsBilling).set({ balanceCents: sql`${commsBilling.balanceCents} + ${cents}` }).where(eq(commsBilling.orgId, orgId)).returning();
  await tx.insert(messageCreditLedger).values({ orgId, changeCents: String(cents), balanceAfterCents: b!.balanceCents, reason: "refund", note, messageId });
}

/** Called by the payment provider's webhook once a credit purchase is paid. Safe to call twice. */
export async function creditPurchasePaid(tx: DbOrTx, purchaseId: string, provider: string, providerRef: string) {
  const [p] = await tx.update(creditPurchases).set({ status: "paid", paidAt: new Date(), provider, providerRef }).where(and(eq(creditPurchases.id, purchaseId), eq(creditPurchases.status, "pending"))).returning();
  if (!p) return null;
  await billingFor(tx, p.orgId);
  const [b] = await tx.update(commsBilling).set({ balanceCents: sql`${commsBilling.balanceCents} + ${p.amountCents}` }).where(eq(commsBilling.orgId, p.orgId)).returning();
  await tx.insert(messageCreditLedger).values({ orgId: p.orgId, changeCents: String(p.amountCents), balanceAfterCents: b!.balanceCents, reason: "purchase", note: `Bought US$${(p.amountCents / 100).toFixed(2)} of message credits`, purchaseId: p.id });
  return p;
}
