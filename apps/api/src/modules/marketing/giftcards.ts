/**
 * Gift cards.
 *
 * Two ways to buy:
 *  1. Give it later: once paid it waits in the buyer's Gift cards tab. They have the studio's
 *     "give within" days to send it; if they don't, it becomes their own studio credit.
 *  2. Give it now: the buyer enters the friend's email or phone. If that person has an account,
 *     the card goes to them as soon as it's paid. If not, they're told, and can buy it to give later.
 *
 * A card's validity starts when it's given (or kept). Once given it's simply studio credit for
 * the recipient, used at checkout like any other credit.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db, DbOrTx } from "../../db/client.js";
import { giftCardDesigns, giftCards, memberships, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { money } from "../bookings/rules.js";
import { notify } from "../notifications/outbox.js";
import { getOrg } from "../sessions/context.js";
import { endOfDayAfter, grantCredit } from "./credit.js";
import { clientEvent } from "./events.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
type Card = typeof giftCards.$inferSelect;
const fmtDate = (d: Date, zone: string) => DateTime.fromJSDate(d, { zone }).toFormat("d LLL yyyy");

/** A card number people can read: GIFT-XXXX-XXXX from letters and digits that can't be misread. */
export function giftCode(random: () => number = Math.random) {
  const safe = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const part = () => Array.from({ length: 4 }, () => safe[Math.floor(random() * safe.length)]).join("");
  return `GIFT-${part()}-${part()}`;
}

/** Find a client in this studio by email or phone (last 8 digits, so +65 and spaces don't matter). */
export async function findRecipient(db: DbOrTx, orgId: string, to: string) {
  const email = to.includes("@") ? to.trim().toLowerCase() : null;
  const digits = email ? null : to.replace(/\D/g, "");
  if (!email && (!digits || digits.length < 8)) throw badRequest("bad_recipient", "Enter an email address or a phone number with at least 8 digits.");
  const rows = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.role, "client"),
        eq(memberships.active, true),
        email ? sql`lower(${users.email}) = ${email}` : sql`right(regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g'), 8) = ${digits!.slice(-8)}`,
      ),
    )
    .limit(2);
  // Two accounts sharing a phone number: ask for their email instead rather than guess.
  if (rows.length !== 1) return null;
  return rows[0]!;
}

export function checkAmount(org: Org, amountCents: number) {
  if (!org.giftCardsEnabled) throw conflict("gift_cards_off", `${org.name} isn't selling gift cards right now.`);
  const fixed = org.giftCardAmounts.includes(amountCents);
  const custom = org.giftCardCustomMinCents !== null && org.giftCardCustomMaxCents !== null && amountCents >= org.giftCardCustomMinCents && amountCents <= org.giftCardCustomMaxCents;
  if (!fixed && !custom) {
    const opts = org.giftCardAmounts.map((a) => money(a, org.currency)).join(", ");
    const range = org.giftCardCustomMinCents !== null && org.giftCardCustomMaxCents !== null ? ` or any amount from ${money(org.giftCardCustomMinCents, org.currency)} to ${money(org.giftCardCustomMaxCents, org.currency)}` : "";
    throw badRequest("bad_amount", `Choose ${opts}${range}.`);
  }
}

/** Turn a card into studio credit for someone, starting its validity now. */
async function credit(tx: DbOrTx, org: Org, card: Card, toId: string, now: Date) {
  const expiresAt = endOfDayAfter(org.giftCardValidityDays, org.timezone, now);
  const grant = await grantCredit(tx, {
    orgId: org.id, clientId: toId, amountCents: card.amountCents, currency: card.currency, source: "gift_card", sourceId: card.id,
    note: `Gift card ${card.code}${card.fromName && toId !== card.buyerId ? ` from ${card.fromName}` : ""}`, expiresAt,
  });
  return { grant, expiresAt };
}

/** Give a paid card to someone now. */
export async function deliver(tx: DbOrTx, card: Card, recipientId: string, by: { fromName?: string | null; message?: string | null }, now = new Date()) {
  const org = await getOrg(tx, card.orgId);
  if (recipientId === card.buyerId) throw conflict("own_card", "To use it yourself, choose “Keep it for myself”.");
  const { grant, expiresAt } = await credit(tx, org, { ...card, fromName: by.fromName ?? card.fromName }, recipientId, now);
  const [u] = await tx
    .update(giftCards)
    .set({ status: "given", recipientId, givenAt: now, creditGrantId: grant.id, fromName: by.fromName ?? card.fromName, message: by.message ?? card.message })
    .where(eq(giftCards.id, card.id))
    .returning();
  const [buyer] = await tx.select({ first: users.firstName }).from(users).where(eq(users.id, card.buyerId));
  const [rec] = await tx.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, recipientId));
  const amount = money(card.amountCents, card.currency);
  await notify(tx, { orgId: org.id, userIds: [recipientId], template: "gift_card.received", data: { fromName: u!.fromName || buyer?.first || "A friend", message: u!.message, amount, studioName: org.name, validUntil: fmtDate(expiresAt, org.timezone), giftCardId: card.id } });
  await notify(tx, { orgId: org.id, userIds: [card.buyerId], template: "gift_card.delivered", data: { recipientName: rec ? `${rec.first} ${rec.last.slice(0, 1)}.` : "Your friend", amount, validUntil: fmtDate(expiresAt, org.timezone), giftCardId: card.id } });
  await clientEvent(tx, org.id, recipientId, { type: "gift_card_received", ref: card.id }, now);
  return u!;
}

/** The buyer keeps an unsent card (or the give-by date passed): it becomes their own credit. */
export async function keep(tx: DbOrTx, card: Card, auto: boolean, now = new Date()) {
  const org = await getOrg(tx, card.orgId);
  const { grant, expiresAt } = await credit(tx, org, card, card.buyerId, now);
  const [u] = await tx.update(giftCards).set({ status: "kept", recipientId: card.buyerId, givenAt: now, creditGrantId: grant.id }).where(eq(giftCards.id, card.id)).returning();
  await notify(tx, { orgId: org.id, userIds: [card.buyerId], template: "gift_card.kept", data: { auto, amount: money(card.amountCents, card.currency), giveBy: card.giveBy ? fmtDate(card.giveBy, org.timezone) : "", validUntil: fmtDate(expiresAt, org.timezone), giftCardId: card.id } });
  return u!;
}

/** Called when the order is paid: give it now (if it was for someone) or put it in the Gift cards tab. */
export async function giftCardPaid(tx: DbOrTx, cardId: string, now = new Date()) {
  const [card] = await tx.select().from(giftCards).where(eq(giftCards.id, cardId)).for("update");
  if (!card || card.status !== "pending_payment") return card;
  const org = await getOrg(tx, card.orgId);
  if (card.recipientId) return deliver(tx, { ...card, status: "unsent" }, card.recipientId, {}, now);
  const giveBy = endOfDayAfter(org.giftCardGiveWithinDays, org.timezone, now);
  const [u] = await tx.update(giftCards).set({ status: "unsent", giveBy }).where(eq(giftCards.id, card.id)).returning();
  await notify(tx, { orgId: org.id, userIds: [card.buyerId], template: "gift_card.ready", data: { amount: money(card.amountCents, card.currency), giveBy: fmtDate(giveBy, org.timezone), giftCardId: card.id } });
  return u!;
}

/** Worker: unsent cards past their give-by date become the buyer's own credit. */
export async function keepOverdueGiftCards(db: Db, now = new Date()) {
  return db.transaction(async (tx) => {
    const due = await tx.select().from(giftCards).where(and(eq(giftCards.status, "unsent"), lte(giftCards.giveBy, now))).limit(200).for("update", { skipLocked: true });
    for (const c of due) await keep(tx, c, true, now);
    return due.length;
  });
}

/** How a card looks in the app. */
export async function presentCards(db: DbOrTx, org: Org, rows: Card[], viewerId: string) {
  const designs = new Map((await db.select().from(giftCardDesigns).where(eq(giftCardDesigns.orgId, org.id))).map((d) => [d.id, d]));
  const ids = [...new Set(rows.flatMap((r) => [r.buyerId, r.recipientId]).filter(Boolean) as string[])];
  const people = new Map(
    (ids.length ? await db.select({ id: users.id, first: users.firstName, last: users.lastName }).from(users).where(inArray(users.id, ids)) : []).map((p) => [p.id, `${p.first} ${p.last.slice(0, 1)}.`]),
  );
  const STATUS = { pending_payment: "Waiting for payment", unsent: "Ready to give", given: "Given", kept: "Added to your credit", cancelled: "Cancelled" } as const;
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    amount: money(c.amountCents, c.currency),
    amountCents: c.amountCents,
    status: c.status,
    statusLabel: c.status === "given" && c.recipientId === viewerId ? "Received" : STATUS[c.status],
    design: c.designId && designs.get(c.designId) ? { name: designs.get(c.designId)!.name, imageUrl: `/v1/public/files/${designs.get(c.designId)!.fileId}` } : null,
    from: c.recipientId === viewerId && c.buyerId !== viewerId ? c.fromName || people.get(c.buyerId) || null : null,
    to: c.buyerId === viewerId && c.recipientId && c.recipientId !== viewerId ? people.get(c.recipientId) ?? null : null,
    message: c.message,
    giveBy: c.giveBy,
    givenAt: c.givenAt,
    daysLeftToGive: c.status === "unsent" && c.giveBy ? Math.max(0, Math.floor((c.giveBy.getTime() - Date.now()) / 86_400_000)) : null,
  }));
}

export async function auditGift(tx: DbOrTx, orgId: string, actorId: string, action: string, cardId: string, details?: Record<string, unknown>) {
  await audit(tx, { orgId, actorId, action, entityType: "gift_card", entityId: cardId, details });
}
