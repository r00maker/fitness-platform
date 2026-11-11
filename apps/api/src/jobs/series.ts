import { and, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { classSeries } from "../db/schema.js";
import { shiftDate, utcToLocal } from "../lib/time.js";
import { generateSeriesSessions } from "../modules/sessions/service.js";

/** Keep open-ended recurring classes topped up so the calendar always shows months ahead. */
export async function extendSeries(db: Db, horizonDays: number, now = new Date()): Promise<number> {
  const through = shiftDate(utcToLocal(now, "UTC").date, horizonDays);
  const due = await db
    .select()
    .from(classSeries)
    .where(and(isNull(classSeries.endedAt), or(isNull(classSeries.generatedThrough), lt(classSeries.generatedThrough, through))));
  let created = 0;
  for (const s of due) {
    // Each series in its own transaction so one problem doesn't block the rest.
    created += (await db.transaction((tx) => generateSeriesSessions(tx, s, through))).length;
  }
  return created;
}
