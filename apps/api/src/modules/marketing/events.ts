/**
 * Things that happen to a client that marketing cares about: referral rewards and journeys.
 *
 * Called from bookings, attendance, packages and gift cards, inside their transactions. Runs in
 * a savepoint so a problem here can never undo the booking or sale that caused it.
 */
import { and, count, eq } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { bookings } from "../../db/schema.js";
import { journeyEvent, type ClientEvent } from "./journeys.js";
import { checkReferral } from "./referrals.js";

export async function clientEvent(tx: DbOrTx, orgId: string, clientId: string, ev: ClientEvent, now = new Date()) {
  try {
    await tx.transaction(async (sp) => {
      if (ev.type === "class_attended" || ev.type === "package_bought") {
        const rewarded = await checkReferral(sp, orgId, clientId, now);
        if (rewarded) await journeyEvent(sp, orgId, rewarded.referrerId, { type: "referral_qualified", ref: rewarded.referralId }, now);
      }
      await journeyEvent(sp, orgId, clientId, ev, now);
    });
  } catch (err) {
    console.error("[marketing] event failed", ev.type, err);
  }
}

/** Attendance changed to present: count their classes so milestones ("50th class") can start journeys. */
export async function attendedEvent(tx: DbOrTx, orgId: string, clientId: string, bookingId: string, now = new Date()) {
  const [c] = await tx.select({ n: count() }).from(bookings).where(and(eq(bookings.orgId, orgId), eq(bookings.clientId, clientId), eq(bookings.attendance, "present")));
  await clientEvent(tx, orgId, clientId, { type: "class_attended", attendedCount: Number(c!.n), ref: bookingId }, now);
}

/** A booking was made: tell journeys, and whether it's their first ever. */
export async function bookedEvent(tx: DbOrTx, orgId: string, clientId: string, bookingId: string, now = new Date()) {
  const [c] = await tx.select({ n: count() }).from(bookings).where(and(eq(bookings.orgId, orgId), eq(bookings.clientId, clientId)));
  await clientEvent(tx, orgId, clientId, { type: "class_booked", first: Number(c!.n) === 1, ref: bookingId }, now);
}
