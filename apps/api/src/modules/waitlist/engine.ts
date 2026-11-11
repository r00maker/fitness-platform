/**
 * The waitlist engine. Whenever a spot might have opened (a cancellation, a
 * bigger room, a held spot that wasn't claimed) call `fillOpenSpots`.
 *
 *  - "Book me in automatically" clients are booked straight away and told.
 *  - "Ask me first" clients get the spot held for the studio's hold time
 *    (10 minutes by default) and are told; if they don't confirm, it moves on.
 *  - Each client's chosen cut-off (e.g. 5h / 3h / 1h before class) is respected:
 *    after it passes they're removed and told, so nobody is booked last-minute.
 */
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import type { Db, DbOrTx } from "../../db/client.js";
import { bookings, classSessions, waitlistEntries } from "../../db/schema.js";
import { notify } from "../notifications/outbox.js";
import { bookingWindow, weeklyBookings } from "../bookings/rules.js";
import { confirmedCount, describeSession, getOrg, heldOfferCount, locationZone, lockSession } from "../sessions/context.js";

export async function fillOpenSpots(tx: DbOrTx, orgId: string, sessionId: string, now = new Date()): Promise<void> {
  const session = await lockSession(tx, orgId, sessionId);
  if (session.status !== "scheduled" || session.startsAt <= now) return;

  let open = session.capacity - (await confirmedCount(tx, sessionId)) - (await heldOfferCount(tx, sessionId));
  if (open <= 0) return;

  const queue = await tx
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.sessionId, sessionId), eq(waitlistEntries.status, "waiting"), gt(waitlistEntries.expiresAt, now)))
    .orderBy(asc(waitlistEntries.createdAt))
    .limit(open + 20) // a few spare, in case someone is skipped for the weekly limit
    .for("update");
  if (!queue.length) return;

  const org = await getOrg(tx, orgId);
  const info = await describeSession(tx, session);
  const zone = await locationZone(tx, orgId, session.locationId);
  const { closesAt } = bookingWindow(org, session.startsAt, zone);

  for (const entry of queue) {
    if (open <= 0) break;
    // Someone who has hit the weekly limit since joining keeps their place but is skipped for now.
    if (org.weeklyBookingLimit != null && (await weeklyBookings(tx, orgId, entry.clientId, session.startsAt, zone)).count >= org.weeklyBookingLimit) continue;
    if (entry.mode === "automatic") {
      const [b] = await tx
        .insert(bookings)
        .values({ orgId, sessionId, clientId: entry.clientId, source: "waitlist_automatic" })
        .returning({ id: bookings.id });
      await tx.update(waitlistEntries).set({ status: "enrolled", bookingId: b!.id }).where(eq(waitlistEntries.id, entry.id));
      await notify(tx, { orgId, userIds: [entry.clientId], template: "waitlist.enrolled", data: { ...info, bookingId: b!.id } });
    } else {
      // The hold never runs past booking close (or class start).
      const holdEnds = new Date(Math.min(now.getTime() + org.waitlistHoldMinutes * 60_000, Math.max(closesAt.getTime(), now.getTime() + 60_000), session.startsAt.getTime()));
      await tx.update(waitlistEntries).set({ status: "offered", offerExpiresAt: holdEnds }).where(eq(waitlistEntries.id, entry.id));
      await notify(tx, {
        orgId,
        userIds: [entry.clientId],
        template: "waitlist.offered",
        data: {
          ...info,
          waitlistEntryId: entry.id,
          holdUntil: holdEnds.toISOString(),
          holdUntilLocal: DateTime.fromJSDate(holdEnds, { zone: info.timezone }).toFormat("HH:mm"),
        },
      });
    }
    open--;
  }
}

/**
 * Runs every minute from the worker: releases unclaimed held spots (and offers
 * them onward) and removes clients whose cut-off has passed.
 */
export async function processWaitlistTimers(db: Db, now = new Date()): Promise<{ lapsed: number; expired: number }> {
  return db.transaction(async (tx) => {
    const lapsed = await tx
      .update(waitlistEntries)
      .set({ status: "offer_lapsed" })
      .where(and(eq(waitlistEntries.status, "offered"), lte(waitlistEntries.offerExpiresAt, now)))
      .returning();
    const expired = await tx
      .update(waitlistEntries)
      .set({ status: "expired" })
      .where(and(eq(waitlistEntries.status, "waiting"), lte(waitlistEntries.expiresAt, now)))
      .returning();

    const sessionIds = [...new Set([...lapsed, ...expired].map((e) => e.sessionId))];
    if (!sessionIds.length) return { lapsed: 0, expired: 0 };
    const sessions = await tx.select().from(classSessions).where(inArray(classSessions.id, sessionIds));
    const byId = new Map(sessions.map((s) => [s.id, s]));

    for (const e of [...lapsed, ...expired]) {
      const s = byId.get(e.sessionId);
      if (!s || s.status !== "scheduled") continue;
      const info = await describeSession(tx, s);
      await notify(tx, {
        orgId: e.orgId,
        userIds: [e.clientId],
        template: e.status === "offer_lapsed" ? "waitlist.offer_lapsed" : "waitlist.expired",
        data: { ...info, waitlistEntryId: e.id },
      });
    }
    // Released holds free a spot for the next person in line.
    for (const sessionId of new Set(lapsed.map((e) => e.sessionId))) {
      const s = byId.get(sessionId)!;
      await fillOpenSpots(tx, s.orgId, sessionId, now);
    }
    return { lapsed: lapsed.length, expired: expired.length };
  });
}

/** Class cancelled: close its waitlist quietly (the cancellation notice already tells them). */
export async function closeWaitlist(tx: DbOrTx, sessionId: string): Promise<string[]> {
  const rows = await tx
    .update(waitlistEntries)
    .set({ status: "closed" })
    .where(and(eq(waitlistEntries.sessionId, sessionId), inArray(waitlistEntries.status, ["waiting", "offered"])))
    .returning({ clientId: waitlistEntries.clientId });
  return rows.map((r) => r.clientId);
}
