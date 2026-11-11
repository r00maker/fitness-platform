/**
 * Extra client information shown on class lists, loaded in a few grouped
 * queries rather than one per client.
 */
import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { FAVOURITE_INSTRUCTOR_MIN_CLASSES } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, clientTagAssignments, clientTags } from "../../db/schema.js";

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

/**
 * Classes each client has attended with each instructor, and their favourite: the
 * instructor they've attended most (at least FAVOURITE_INSTRUCTOR_MIN_CLASSES, no tie).
 */
export async function instructorHistory(db: DbOrTx, orgId: string, clientIds: string[]) {
  const withInstructor = new Map<string, Map<string, number>>();
  const favourite = new Map<string, { instructorId: string; classes: number }>();
  if (!clientIds.length) return { withInstructor, favourite };
  const rows = await db
    .select({ clientId: bookings.clientId, instructorId: classSessions.instructorId, n: count() })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.orgId, orgId), inArray(bookings.clientId, clientIds), eq(bookings.attendance, "present"), isNotNull(classSessions.instructorId)))
    .groupBy(bookings.clientId, classSessions.instructorId);
  for (const r of rows) {
    const m = withInstructor.get(r.clientId) ?? new Map<string, number>();
    m.set(r.instructorId!, r.n);
    withInstructor.set(r.clientId, m);
  }
  for (const [clientId, m] of withInstructor) {
    const [top, second] = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (top && top[1] >= FAVOURITE_INSTRUCTOR_MIN_CLASSES && (!second || top[1] > second[1])) favourite.set(clientId, { instructorId: top[0], classes: top[1] });
  }
  return { withInstructor, favourite };
}
