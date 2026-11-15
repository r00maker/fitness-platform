/**
 * The Cancellations tab on a class: everyone whose booking was cancelled, when and how, whether
 * they got the class back, and any late fee. For staff who can see the class list.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { OPTION_LABELS, type CancelledVia } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, fees, packageLedger, users } from "../../db/schema.js";
import { alias } from "drizzle-orm/pg-core";
import { money } from "../bookings/rules.js";
import type { SessionRow } from "./context.js";

const canceller = alias(users, "canceller");

export async function cancellationsFor(db: DbOrTx, s: SessionRow) {
  const rows = await db
    .select({
      bookingId: bookings.id,
      clientId: bookings.clientId,
      firstName: users.firstName,
      lastName: users.lastName,
      photoUrl: users.photoUrl,
      status: bookings.status,
      source: bookings.source,
      cancelledAt: bookings.cancelledAt,
      via: bookings.cancelledVia,
      reason: bookings.cancelReason,
      byId: bookings.cancelledBy,
      byFirst: canceller.firstName,
      byLast: canceller.lastName,
    })
    .from(bookings)
    .innerJoin(users, eq(users.id, bookings.clientId))
    .leftJoin(canceller, eq(canceller.id, bookings.cancelledBy))
    .where(and(eq(bookings.sessionId, s.id), inArray(bookings.status, ["cancelled", "late_cancelled"])))
    .orderBy(asc(bookings.cancelledAt));
  const ids = rows.map((r) => r.bookingId);
  // The class went back to the package if the package history shows it returned for this booking.
  const returned = ids.length
    ? new Set((await db.select({ id: packageLedger.bookingId }).from(packageLedger).where(and(inArray(packageLedger.bookingId, ids), gt(packageLedger.change, 0)))).map((r) => r.id))
    : new Set<string | null>();
  const feeRows = ids.length ? await db.select().from(fees).where(and(inArray(fees.bookingId, ids), eq(fees.type, "late_cancel"))) : [];
  const feeBy = new Map(feeRows.map((f) => [f.bookingId, f]));

  const list = rows.map((r) => {
    const via = (r.via ?? (r.byId === r.clientId ? "self" : null)) as CancelledVia | null;
    const fee = feeBy.get(r.bookingId);
    const hoursBefore = r.cancelledAt ? Math.round(((s.startsAt.getTime() - r.cancelledAt.getTime()) / 3_600_000) * 10) / 10 : null;
    return {
      bookingId: r.bookingId,
      clientId: r.clientId,
      name: `${r.firstName} ${r.lastName}`,
      photoUrl: r.photoUrl,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      /** Hours before the class started (negative = after it started). */
      hoursBefore,
      late: r.status === "late_cancelled",
      via,
      viaText: via ? OPTION_LABELS.cancelledVia[via] : "Cancelled",
      /** The member of staff who did it (not shown when the client cancelled themselves). */
      by: via === "staff" || via === "moved" || via === "class_cancelled" ? (r.byId && r.byId !== r.clientId ? { id: r.byId, name: `${r.byFirst} ${r.byLast}` } : null) : null,
      reason: r.reason,
      classpass: r.source === "classpass",
      classReturned: returned.has(r.bookingId),
      fee: fee ? { amount: money(fee.amountCents, fee.currency), status: fee.status } : null,
    };
  });
  const late = list.filter((c) => c.late).length;
  const moved = list.filter((c) => c.via === "moved").length;
  const n = list.length - moved;
  const parts = [n ? `${n} ${n === 1 ? "cancellation" : "cancellations"}${late ? ` (${late} late)` : ""}` : "", moved ? `${moved} moved to another class` : ""].filter(Boolean);
  return { list, summary: { total: n, late, moved, text: parts.length ? `${parts.join(", ")}.` : "No one has cancelled." } };
}
