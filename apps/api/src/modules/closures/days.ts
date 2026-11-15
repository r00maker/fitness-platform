/**
 * Which days are closed. Kept free of other modules so the schedule checks and
 * series generator can use it without import loops.
 */
import { and, eq, gte, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import type { DbOrTx } from "../../db/client.js";
import { closures } from "../../db/schema.js";

export type ClosureRow = typeof closures.$inferSelect;

/** Closures for a location (including studio-wide ones) that touch the given dates. */
export async function closuresFor(db: DbOrTx, orgId: string, locationId: string | null, fromDate: string, toDate: string, excludeId?: string): Promise<ClosureRow[]> {
  const rows = await db
    .select()
    .from(closures)
    .where(
      and(
        eq(closures.orgId, orgId),
        lte(closures.startDate, toDate),
        gte(closures.endDate, fromDate),
        // For a location: its own closures and studio-wide ones. With no location: all of them.
        locationId ? or(isNull(closures.locationId), eq(closures.locationId, locationId)) : undefined,
      ),
    );
  return excludeId ? rows.filter((c) => c.id !== excludeId) : rows;
}

/** The closure covering a date, if any. */
export const closureCovering = (list: ClosureRow[], date: string) => list.find((c) => c.startDate <= date && c.endDate >= date);

/** "Mon 31 Mar" or "Mon 31 Mar – Wed 2 Apr". */
export function closureDatesText(c: { startDate: string; endDate: string }): string {
  const d = (x: string) => DateTime.fromISO(x).toFormat("ccc d LLL");
  return c.startDate === c.endDate ? d(c.startDate) : `${d(c.startDate)} – ${d(c.endDate)}`;
}
