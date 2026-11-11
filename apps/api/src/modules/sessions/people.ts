/**
 * Extra client information shown on class lists, loaded in a few grouped
 * queries rather than one per client.
 */
import { and, count, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { bookings, clientTagAssignments, clientTags } from "../../db/schema.js";

export async function attendedCounts(db: DbOrTx, orgId: string, clientIds: string[]): Promise<Map<string, number>> {
  if (!clientIds.length) return new Map();
  const rows = await db
    .select({ clientId: bookings.clientId, n: count() })
    .from(bookings)
    .where(and(eq(bookings.orgId, orgId), inArray(bookings.clientId, clientIds), eq(bookings.attendance, "present")))
    .groupBy(bookings.clientId);
  return new Map(rows.map((r) => [r.clientId, r.n]));
}

export async function tagsFor(db: DbOrTx, orgId: string, clientIds: string[]) {
  const out = new Map<string, { id: string; name: string; color: string }[]>();
  if (!clientIds.length) return out;
  const rows = await db
    .select({ clientId: clientTagAssignments.clientId, id: clientTags.id, name: clientTags.name, color: clientTags.color })
    .from(clientTagAssignments)
    .innerJoin(clientTags, eq(clientTags.id, clientTagAssignments.tagId))
    .where(and(eq(clientTagAssignments.orgId, orgId), inArray(clientTagAssignments.clientId, clientIds)))
    .orderBy(clientTags.name);
  for (const { clientId, ...t } of rows) out.set(clientId, [...(out.get(clientId) ?? []), t]);
  return out;
}

/** "Sarah L." — what other members see. */
export const publicName = (first: string, last: string) => `${first} ${last.trim().charAt(0).toUpperCase()}.`.trim();
