import { and, asc, count, eq, inArray } from "drizzle-orm";
import { can, type WaitlistMode } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, waitlistEntries } from "../../db/schema.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import type { Flags } from "../../lib/flags.js";
import type { AuthContext } from "../../plugins/auth.js";
import { bookingWindow, weeklyBookings, windowMessage, windowStatus } from "../bookings/rules.js";
import { choosePayment, createBooking } from "../bookings/service.js";
import { assertMemberWithRole, confirmedCount, getOrg, heldOfferCount, locationZone, lockSession } from "../sessions/context.js";
import { fillOpenSpots } from "./engine.js";
import { requireWaiver } from "../clients/waivers.js";

export async function joinWaitlist(
  tx: DbOrTx,
  auth: AuthContext,
  input: { sessionId: string; clientId?: string; mode: WaitlistMode; expiresHoursBeforeStart: number | null; waiver?: { signedName: string } },
  flags: Flags,
  now = new Date(),
) {
  let clientId = auth.userId;
  if (auth.role !== "client") {
    if (!can(auth.role, "manageBookings")) throw forbidden("Only admins can add clients to a waitlist.");
    if (!input.clientId) throw badRequest("client_required", "Choose which client to add.");
    await assertMemberWithRole(tx, auth.orgId, input.clientId, ["client"], "client");
    clientId = input.clientId;
  } else if (input.clientId && input.clientId !== auth.userId) {
    throw forbidden("You can only join the waitlist for yourself.");
  }

  const session = await lockSession(tx, auth.orgId, input.sessionId);
  if (session.status !== "scheduled" || now >= session.startsAt) throw conflict("booking_closed", "This class is no longer taking bookings.");
  if (!session.waitlistEnabled) throw conflict("waitlist_off", "This class doesn't have a waitlist.");

  const org = await getOrg(tx, auth.orgId);
  // Waiting stops at the client's cut-off, or when booking closes, whichever is first.
  const zone = await locationZone(tx, auth.orgId, session.locationId);
  const win = bookingWindow(org, session.startsAt, zone);
  const status = windowStatus(now, win);
  if (status !== "open") {
    if (auth.role === "client") throw conflict(status === "closed" ? "booking_closed" : "booking_not_open", windowMessage(status, win, zone, org));
    flags.info({ code: "outside_booking_window", sessionId: session.id, message: `${windowMessage(status, win, zone, org)} You're adding them as an admin, so the rule doesn't apply.` });
  }
  if (org.weeklyBookingLimit != null) {
    const week = await weeklyBookings(tx, auth.orgId, clientId, session.startsAt, zone);
    if (week.count >= org.weeklyBookingLimit) {
      const message = `${auth.role === "client" ? "You've" : "This client has"} reached the studio's limit of ${org.weeklyBookingLimit} ${org.weeklyBookingLimit === 1 ? "class" : "classes"} a week (${week.label}).`;
      if (auth.role === "client") throw conflict("weekly_limit", message);
      flags.confirm({ code: "over_weekly_limit", sessionId: session.id, message });
    }
  }
  const open = session.capacity - (await confirmedCount(tx, session.id)) - (await heldOfferCount(tx, session.id));
  if (open > 0) throw conflict("spots_available", "There's still space in this class – you can book it directly.");

  // They may be booked in automatically later, so the waiver and a package that covers the class are needed now.
  await requireWaiver(tx, auth, org, clientId, input.waiver, flags, session.id);
  await choosePayment(tx, auth, org, clientId, session, {}, flags, now);

  const hours = input.expiresHoursBeforeStart;
  if (hours !== null && !org.waitlistExpiryOptionsHours.includes(hours)) {
    throw badRequest("invalid_expiry", `Pick one of: ${org.waitlistExpiryOptionsHours.map((h) => `${h}h`).join(", ")} before class.`);
  }
  const cutoff = session.startsAt.getTime() - (hours ?? 0) * 3_600_000;
  const expiresAt = new Date(status === "open" ? Math.min(cutoff, win.closesAt.getTime()) : cutoff);
  if (expiresAt <= now) throw badRequest("expiry_passed", "That cut-off has already passed. Pick a shorter one.");

  const [booked] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.sessionId, session.id), eq(bookings.clientId, clientId), eq(bookings.status, "confirmed")));
  if (booked) throw conflict("already_booked", "You're already booked into this class.");

  const [active] = await tx
    .select({ n: count() })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.sessionId, session.id), inArray(waitlistEntries.status, ["waiting", "offered"])));
  if (session.waitlistCapacity != null && (active?.n ?? 0) >= session.waitlistCapacity) {
    throw conflict("waitlist_full", "The waitlist for this class is full.");
  }

  const [entry] = await tx
    .insert(waitlistEntries)
    .values({ orgId: auth.orgId, sessionId: session.id, clientId, mode: input.mode, expiresHoursBeforeStart: hours, expiresAt })
    .onConflictDoNothing()
    .returning();
  if (!entry) throw conflict("already_waitlisted", "You're already on the waitlist for this class.");
  return { ...entry, position: await waitlistPosition(tx, entry) };
}

export async function waitlistPosition(db: DbOrTx, entry: { id: string; sessionId: string }): Promise<number> {
  const queue = await db
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.sessionId, entry.sessionId), eq(waitlistEntries.status, "waiting")))
    .orderBy(asc(waitlistEntries.createdAt));
  return queue.findIndex((q) => q.id === entry.id) + 1;
}

async function ownEntry(tx: DbOrTx, auth: AuthContext, entryId: string) {
  const [e] = await tx
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.id, entryId), eq(waitlistEntries.orgId, auth.orgId)))
    .for("update");
  if (!e || (auth.role === "client" && e.clientId !== auth.userId)) throw notFound("waitlist spot");
  if (auth.role !== "client" && !can(auth.role, "manageBookings")) throw forbidden();
  return e;
}

/** Confirm a held spot ("Ask me first" mode). */
export async function claimOffer(tx: DbOrTx, auth: AuthContext, entryId: string, now = new Date()) {
  const e = await ownEntry(tx, auth, entryId);
  if (e.status !== "offered" || !e.offerExpiresAt || e.offerExpiresAt <= now) {
    throw conflict("offer_expired", "Sorry, this held spot has expired and gone to the next person.");
  }
  return createBooking(tx, auth, { sessionId: e.sessionId, clientId: e.clientId }, undefined, now);
}

export async function declineOffer(tx: DbOrTx, auth: AuthContext, entryId: string, now = new Date()) {
  const e = await ownEntry(tx, auth, entryId);
  if (e.status !== "offered") throw conflict("no_offer", "There's no held spot to decline.");
  await tx.update(waitlistEntries).set({ status: "declined" }).where(eq(waitlistEntries.id, e.id));
  await fillOpenSpots(tx, auth.orgId, e.sessionId, now);
}

export async function leaveWaitlist(tx: DbOrTx, auth: AuthContext, entryId: string, now = new Date()) {
  const e = await ownEntry(tx, auth, entryId);
  if (!["waiting", "offered"].includes(e.status)) throw conflict("not_waiting", "You're not on this waitlist any more.");
  await tx.update(waitlistEntries).set({ status: "left" }).where(eq(waitlistEntries.id, e.id));
  if (e.status === "offered") await fillOpenSpots(tx, auth.orgId, e.sessionId, now);
}
