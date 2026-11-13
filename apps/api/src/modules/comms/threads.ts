/** Conversation threads: shared by the inbox, the webhook and journeys. */
import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { commsMessages, conversations, memberships, users } from "../../db/schema.js";

type Conversation = typeof conversations.$inferSelect;
const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "");

/** Find the client with this mobile number (matched on the last 8 digits). */
export async function clientByPhone(tx: DbOrTx, orgId: string, phone: string) {
  const last8 = digits(phone).slice(-8);
  if (last8.length < 8) return null;
  const [c] = await tx
    .select({ id: users.id, name: sql<string>`${users.firstName} || ' ' || ${users.lastName}` })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client"), sql`right(regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g'), 8) = ${last8}`))
    .limit(1);
  return c ?? null;
}

/** The thread with this number, created if new (and linked to the client with that number). */
export async function conversationFor(tx: DbOrTx, orgId: string, contact: string, name?: string | null): Promise<Conversation> {
  const [found] = await tx.select().from(conversations).where(and(eq(conversations.orgId, orgId), eq(conversations.channel, "whatsapp"), eq(conversations.contact, contact)));
  if (found) {
    if (name && !found.contactName) await tx.update(conversations).set({ contactName: name }).where(eq(conversations.id, found.id));
    return found;
  }
  const client = await clientByPhone(tx, orgId, contact);
  const [c] = await tx
    .insert(conversations)
    .values({ orgId, channel: "whatsapp", contact, contactName: name ?? client?.name ?? null, clientId: client?.id ?? null })
    .onConflictDoNothing()
    .returning();
  return c ?? (await tx.select().from(conversations).where(and(eq(conversations.orgId, orgId), eq(conversations.channel, "whatsapp"), eq(conversations.contact, contact))))[0]!;
}

/** Add a message to a thread and keep the thread's summary (last message, unread, reply window) up to date. */
export async function recordMessage(tx: DbOrTx, conv: Conversation, m: Omit<typeof commsMessages.$inferInsert, "orgId" | "conversationId"> & { at?: Date }) {
  const at = m.at ?? new Date();
  const { at: _a, ...row } = m;
  const [msg] = await tx.insert(commsMessages).values({ ...row, orgId: conv.orgId, conversationId: conv.id, createdAt: at }).onConflictDoNothing().returning();
  if (!msg) return null; // already have it (webhooks can repeat)
  const preview = (m.body ?? (m.template ? `Template: ${m.template.name}` : "Attachment")).slice(0, 140);
  await tx
    .update(conversations)
    .set({
      lastMessageAt: at,
      lastPreview: preview,
      ...(m.direction === "in" ? { lastInboundAt: at, unread: sql`${conversations.unread} + 1`, status: "open" } : {}),
    })
    .where(eq(conversations.id, conv.id));
  return msg;
}

