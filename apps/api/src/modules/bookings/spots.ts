/**
 * Spot selection (reformer 3, bike 12, mat by the window…). Rooms with named
 * spots let clients choose one when booking; everyone else (admins booking for
 * someone, waitlist auto-enrolment, moves) is given the next free spot.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import type { DbOrTx } from "../../db/client.js";
import { bookings, rooms } from "../../db/schema.js";
import { badRequest, conflict } from "../../lib/errors.js";
import type { SessionRow } from "../sessions/context.js";

export async function spotLabels(db: DbOrTx, roomId: string | null): Promise<string[] | null> {
  if (!roomId) return null;
  const [r] = await db.select({ labels: rooms.spotLabels }).from(rooms).where(eq(rooms.id, roomId));
  return r?.labels?.length ? r.labels : null;
}

/** Spot number → client, for confirmed bookings in this class. */
export async function takenSpots(db: DbOrTx, sessionId: string): Promise<Map<number, string>> {
  const rows = await db
    .select({ spot: bookings.spot, clientId: bookings.clientId })
    .from(bookings)
    .where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, "confirmed"), isNotNull(bookings.spot)));
  return new Map(rows.map((r) => [r.spot!, r.clientId]));
}

/** The spot to give this booking, or null if the room doesn't use spots (or they're all taken). */
export async function pickSpot(tx: DbOrTx, session: Pick<SessionRow, "id" | "roomId">, requested?: number): Promise<number | null> {
  const labels = await spotLabels(tx, session.roomId);
  if (!labels) {
    if (requested !== undefined) throw badRequest("no_spots", "This class doesn't have spot selection.");
    return null;
  }
  const taken = await takenSpots(tx, session.id);
  if (requested !== undefined) {
    if (requested > labels.length) throw badRequest("invalid_spot", "That spot doesn't exist in this room.");
    if (taken.has(requested)) throw conflict("spot_taken", `${labels[requested - 1]} has just been taken. Please pick another spot.`);
    return requested;
  }
  for (let i = 1; i <= labels.length; i++) if (!taken.has(i)) return i;
  return null;
}
