import { and, eq, inArray } from "drizzle-orm";
import { can, type Attendance, type RefundMethod } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, refunds, waitlistEntries } from "../../db/schema.js";
import type { Flags } from "../../lib/flags.js";
import { checkClientOverlap, clock } from "../checks/session-checks.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { AuthContext } from "../../plugins/auth.js";
import { notify } from "../notifications/outbox.js";
import { assertMemberWithRole, confirmedCount, describeSession, getOrg, getSession, heldOfferCount, locationZone, lockSession, type SessionRow } from "../sessions/context.js";
import { fillOpenSpots } from "../waitlist/engine.js";
import { applyFee, bookingWindow, feeFor, waivePendingFees, weeklyBookings, windowMessage, windowStatus } from "./rules.js";

export type BookingRow = typeof bookings.$inferSelect;
/** Admins (and owners) can book, cancel, move and refund for clients, and go outside booking rules. */
const isBookingManager = (a: AuthContext) => can(a.role, "manageBookings");

export function refundNote(method: RefundMethod | undefined): string {
  if (method === "credit") return "Your class credit has been returned to your account.";
  if (method === "original_payment") return "Your payment will be refunded to your original payment method.";
  return "";
}

export async function getBooking(db: DbOrTx, orgId: string, bookingId: string): Promise<BookingRow> {
  const [b] = await db.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.orgId, orgId)));
  if (!b) throw notFound("booking");
  return b;
}

/** Clients act only for themselves; only admins act for clients. */
function assertOwnOrManager(auth: AuthContext, booking: BookingRow) {
  if (auth.role === "client") {
    if (booking.clientId !== auth.userId) throw notFound("booking");
  } else if (!isBookingManager(auth)) {
    throw forbidden("Only admins can change bookings for clients.");
  }
}

/** Work out who the booking is for, enforcing that clients can only act for themselves. */
async function resolveClient(tx: DbOrTx, auth: AuthContext, clientId?: string): Promise<string> {
  if (auth.role === "client") {
    if (clientId && clientId !== auth.userId) throw forbidden("You can only book for yourself.");
    return auth.userId;
  }
  if (!isBookingManager(auth)) throw forbidden("Only admins can book clients in.");
  if (!clientId) throw badRequest("client_required", "Choose which client to book.");
  await assertMemberWithRole(tx, auth.orgId, clientId, ["client"], "client");
  return clientId;
}

const hoursUntil = (s: SessionRow, now: Date) => (s.startsAt.getTime() - now.getTime()) / 3_600_000;

/**
 * Book a client in. Pass `flags` to run the "please check" warnings (e.g. the client
 * is already in another class at that time); internal callers like waitlist claims skip them.
 */
export async function createBooking(
  tx: DbOrTx,
  auth: AuthContext,
  input: { sessionId: string; clientId?: string },
  flags?: Flags,
  now = new Date(),
  opts: { ignoreSessionId?: string } = {},
) {
  const clientId = await resolveClient(tx, auth, input.clientId);
  const isClient = auth.role === "client";
  const session = await lockSession(tx, auth.orgId, input.sessionId);
  if (session.status !== "scheduled") throw conflict("class_cancelled", "This class has been cancelled.");
  // Admins can add walk-ins until the class ends.
  if (now >= session.endsAt) throw conflict("booking_closed", "This class has finished.");

  const [existing] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.sessionId, session.id), eq(bookings.clientId, clientId), eq(bookings.status, "confirmed")));
  if (existing) throw conflict("already_booked", isClient ? "You're already booked into this class." : "This client is already booked into this class.");

  const [entry] = await tx
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.sessionId, session.id), eq(waitlistEntries.clientId, clientId), inArray(waitlistEntries.status, ["waiting", "offered"])))
    .for("update");
  // A spot held for this client is theirs to take, even though the class looks full to others.
  const holdingOffer = entry?.status === "offered" && !!entry.offerExpiresAt && entry.offerExpiresAt > now;

  // --- Booking rules -------------------------------------------------------
  const org = await getOrg(tx, auth.orgId);
  const zone = await locationZone(tx, auth.orgId, session.locationId);
  const win = bookingWindow(org, session.startsAt, zone);
  const status = windowStatus(now, win);
  if (status !== "open" && !holdingOffer) {
    if (isClient) throw conflict(status === "closed" ? "booking_closed" : "booking_not_open", windowMessage(status, win, zone, org), { bookingOpensAt: win.opensAt, bookingClosesAt: win.closesAt });
    if (now < session.startsAt) flags?.info({ code: "outside_booking_window", sessionId: session.id, message: `${windowMessage(status, win, zone, org)} You're booking as an admin, so the rule doesn't apply.` });
  }
  if (org.weeklyBookingLimit != null) {
    const week = await weeklyBookings(tx, auth.orgId, clientId, session.startsAt, zone, opts.ignoreSessionId);
    if (week.count >= org.weeklyBookingLimit) {
      const message = `${isClient ? "You've" : "This client has"} reached the studio's limit of ${org.weeklyBookingLimit} ${org.weeklyBookingLimit === 1 ? "class" : "classes"} a week (${week.label}).`;
      if (isClient) throw conflict("weekly_limit", message);
      flags?.confirm({ code: "over_weekly_limit", sessionId: session.id, message });
    }
  }

  if (flags) {
    await checkClientOverlap(tx, flags, zone, { clientId, sessionId: session.id, startsAt: session.startsAt, endsAt: session.endsAt, self: isClient, ignoreSessionId: opts.ignoreSessionId });
    if (now >= session.startsAt) flags.info({ code: "late_booking", sessionId: session.id, message: `This class started at ${clock(session.startsAt, zone)}. The client is being added as a walk-in.` });
  }

  if (!holdingOffer) {
    const open = session.capacity - (await confirmedCount(tx, session.id)) - (await heldOfferCount(tx, session.id));
    if (open <= 0) {
      throw conflict("class_full", "This class is full. Join the waitlist and we'll let you know if a spot opens.", {
        canJoinWaitlist: session.waitlistEnabled,
      });
    }
  }

  const [booking] = await tx
    .insert(bookings)
    .values({
      orgId: auth.orgId,
      sessionId: session.id,
      clientId,
      source: holdingOffer ? "waitlist_claimed" : isClient ? "client" : "staff",
      bookedBy: auth.userId,
    })
    .returning();
  if (entry) await tx.update(waitlistEntries).set({ status: "enrolled", bookingId: booking!.id }).where(eq(waitlistEntries.id, entry.id));
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "booking.created", entityType: "booking", entityId: booking!.id });
  return booking!;
}

async function recordRefund(
  tx: DbOrTx,
  auth: AuthContext,
  booking: BookingRow,
  method: RefundMethod,
  opts: { amountCents?: number; reason?: string },
) {
  if (method === "none") return;
  // TODO(payments module): call the payment provider (e.g. Stripe) or credit ledger here and store its reference.
  await tx.insert(refunds).values({
    orgId: auth.orgId,
    bookingId: booking.id,
    method,
    amountCents: opts.amountCents ?? null,
    reason: opts.reason ?? null,
    createdBy: auth.userId,
  });
}

export async function cancelBooking(
  tx: DbOrTx,
  auth: AuthContext,
  bookingId: string,
  input: { refund?: RefundMethod; reason?: string; notifyClient: boolean },
  flags: Flags,
  now = new Date(),
) {
  const booking = await getBooking(tx, auth.orgId, bookingId);
  assertOwnOrManager(auth, booking);
  if (booking.status !== "confirmed") throw conflict("already_cancelled", "This booking is already cancelled.");

  const session = await lockSession(tx, auth.orgId, booking.sessionId);
  const org = await getOrg(tx, auth.orgId);
  let status: "cancelled" | "late_cancelled" = "cancelled";
  let refund: RefundMethod = input.refund ?? "credit";
  let lateFee = false;

  if (auth.role === "client") {
    if (now >= session.startsAt) throw conflict("class_started", "This class has already started, so it can't be cancelled. Please contact the studio.");
    const late = hoursUntil(session, now) < org.lateCancelWindowHours;
    status = late ? "late_cancelled" : "cancelled";
    // Clients can't choose their own refund; the studio policy decides.
    refund = late ? "none" : "credit";
    if (late) {
      const fee = feeFor(org, "late_cancel");
      lateFee = !!fee;
      flags.confirm({
        code: "late_cancel",
        sessionId: session.id,
        message: `This class starts in less than ${org.lateCancelWindowHours} hours, so you won't get your class credit back${fee ? `, and a late-cancellation fee of ${fee.text} applies` : ""}. Cancel anyway?`,
      });
    }
  }

  const [updated] = await tx
    .update(bookings)
    .set({ status, cancelledAt: now })
    .where(eq(bookings.id, booking.id))
    .returning();
  await recordRefund(tx, auth, booking, refund, { reason: input.reason });
  const fee = lateFee ? await applyFee(tx, org, booking, session, "late_cancel") : null;
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "booking.cancelled", entityType: "booking", entityId: booking.id, details: { status, refund, reason: input.reason, feeId: fee?.id } });

  if (input.notifyClient && auth.role !== "client") {
    const info = await describeSession(tx, session);
    await notify(tx, { orgId: auth.orgId, userIds: [booking.clientId], template: "booking.cancelled", data: { ...info, bookingId: booking.id, refundNote: refundNote(refund) } });
  }
  await fillOpenSpots(tx, auth.orgId, session.id, now);
  return { booking: updated!, refund, fee };
}

/**
 * Move a client to a different class in one step (cancels the old spot, books the new one).
 * Clients can't move inside the late-cancellation window; admins can.
 */
export async function moveBooking(tx: DbOrTx, auth: AuthContext, bookingId: string, input: { targetSessionId: string; notifyClient: boolean }, flags: Flags, now = new Date()) {
  const booking = await getBooking(tx, auth.orgId, bookingId);
  assertOwnOrManager(auth, booking);
  if (booking.status !== "confirmed") throw conflict("not_active", "Only active bookings can be moved.");
  if (booking.sessionId === input.targetSessionId) throw badRequest("same_class", "Pick a different class to move to.");

  // Lock both classes in a fixed order so two simultaneous moves can't deadlock.
  const [firstId, secondId] = [booking.sessionId, input.targetSessionId].sort();
  await lockSession(tx, auth.orgId, firstId!);
  await lockSession(tx, auth.orgId, secondId!);
  const from = await getSession(tx, auth.orgId, booking.sessionId);
  const org = await getOrg(tx, auth.orgId);
  const insideLateWindow = hoursUntil(from, now) < org.lateCancelWindowHours;

  if (auth.role === "client") {
    if (now >= from.startsAt) throw conflict("class_started", "This class has already started, so the booking can't be moved.");
    if (insideLateWindow) {
      throw conflict("late_move", `Your class starts in less than ${org.lateCancelWindowHours} hours, so it can't be moved. Please contact the studio if you need help.`);
    }
  } else if (insideLateWindow) {
    flags.info({ code: "late_move", sessionId: from.id, message: `This is inside the ${org.lateCancelWindowHours}-hour late-cancellation window. Clients can't do this themselves, but admins can.` });
  }

  await tx.update(bookings).set({ status: "cancelled", cancelledAt: now }).where(eq(bookings.id, booking.id));
  const moved = await createBooking(tx, auth, { sessionId: input.targetSessionId, clientId: booking.clientId }, flags, now, { ignoreSessionId: booking.sessionId });
  await tx.update(bookings).set({ source: "moved" }).where(eq(bookings.id, moved.id));
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "booking.moved", entityType: "booking", entityId: booking.id, details: { to: moved.id } });

  if (input.notifyClient && auth.role !== "client") {
    const oldInfo = await describeSession(tx, from);
    const newInfo = await describeSession(tx, await getSession(tx, auth.orgId, input.targetSessionId));
    await notify(tx, {
      orgId: auth.orgId,
      userIds: [booking.clientId],
      template: "booking.moved",
      data: { ...newInfo, bookingId: moved.id, oldClassName: oldInfo.className, oldLocalDate: oldInfo.localDate, oldLocalTime: oldInfo.localTime },
    });
  }
  await fillOpenSpots(tx, auth.orgId, from.id, now);
  return { ...moved, source: "moved" as const };
}

/** Refund without cancelling – e.g. after the class, if something went wrong. */
export async function refundBooking(tx: DbOrTx, auth: AuthContext, bookingId: string, input: { method: Exclude<RefundMethod, "none">; amountCents?: number; reason: string }, flags: Flags) {
  if (!isBookingManager(auth)) throw forbidden("Only admins can give refunds.");
  const booking = await getBooking(tx, auth.orgId, bookingId);
  const previous = await tx.select().from(refunds).where(eq(refunds.bookingId, booking.id));
  for (const p of previous) {
    flags.confirm({ code: "already_refunded", message: `This booking was already refunded on ${p.createdAt.toISOString().slice(0, 10)} (${p.method === "credit" ? "class credit" : "payment"}).`, details: { refundId: p.id } });
  }
  if (booking.attendance === "present") flags.info({ code: "refund_after_attending", message: "This client was marked as attended." });
  await recordRefund(tx, auth, booking, input.method, input);
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "booking.refunded", entityType: "booking", entityId: booking.id, details: input });
  const info = await describeSession(tx, await getSession(tx, auth.orgId, booking.sessionId));
  await notify(tx, { orgId: auth.orgId, userIds: [booking.clientId], template: "booking.refunded", data: { ...info, bookingId: booking.id, reason: input.reason, refundNote: refundNote(input.method) } });
}

/** Instructors take attendance for their own classes; Front of House and admins for any class. */
async function assertCanTakeAttendance(tx: DbOrTx, auth: AuthContext, sessionId: string, now: Date) {
  const session = await getSession(tx, auth.orgId, sessionId);
  if (!can(auth.role, "takeAttendanceAnyClass") && !(auth.role === "instructor" && session.instructorId === auth.userId)) throw forbidden();
  if (now.getTime() < session.startsAt.getTime() - 60 * 60_000) {
    throw conflict("too_early", "Attendance can be taken from an hour before class starts.");
  }
  return session;
}

/** No-show fees follow attendance: added when marked no-show, removed if it's corrected. */
async function syncNoShowFee(tx: DbOrTx, auth: AuthContext, booking: BookingRow, session: SessionRow, attendance: Attendance, flags?: Flags) {
  if (attendance === "no_show") {
    const org = await getOrg(tx, auth.orgId);
    const fee = await applyFee(tx, org, booking, session, "no_show");
    if (fee) flags?.info({ code: "fee_applies", sessionId: session.id, message: `A no-show fee of ${feeFor(org, "no_show")!.text} has been added for this client. Admins can waive it.` });
  } else {
    await waivePendingFees(tx, booking.id, "no_show", auth.userId, "Attendance corrected");
  }
}

export async function markAttendance(tx: DbOrTx, auth: AuthContext, bookingId: string, attendance: Attendance, flags: Flags, now = new Date()) {
  const booking = await getBooking(tx, auth.orgId, bookingId);
  if (booking.status !== "confirmed") throw conflict("not_active", "Attendance can only be taken for active bookings.");
  const session = await assertCanTakeAttendance(tx, auth, booking.sessionId, now);
  const [b] = await tx
    .update(bookings)
    .set({ attendance, attendanceMarkedAt: now, attendanceMarkedBy: auth.userId })
    .where(eq(bookings.id, bookingId))
    .returning();
  if (attendance !== booking.attendance) await syncNoShowFee(tx, auth, b!, session, attendance, flags);
  return b!;
}

/** "Mark everyone present" – only touches people not yet marked, unless overwrite is set. */
export async function markAllAttendance(
  tx: DbOrTx,
  auth: AuthContext,
  sessionId: string,
  input: { attendance: "present" | "no_show"; overwrite: boolean },
  flags: Flags,
  now = new Date(),
) {
  const session = await assertCanTakeAttendance(tx, auth, sessionId, now);
  if (now < session.startsAt) {
    flags.confirm({ code: "class_not_started", sessionId, message: `This class hasn't started yet. Mark everyone as ${input.attendance === "present" ? "attended" : "no-show"} anyway?` });
  }
  const before = await tx
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.sessionId, sessionId),
        eq(bookings.orgId, auth.orgId),
        eq(bookings.status, "confirmed"),
        input.overwrite ? undefined : eq(bookings.attendance, "unmarked"),
      ),
    );
  if (!before.length) return { updated: 0 };
  await tx
    .update(bookings)
    .set({ attendance: input.attendance, attendanceMarkedAt: now, attendanceMarkedBy: auth.userId })
    .where(inArray(bookings.id, before.map((b) => b.id)));
  for (const b of before) if (b.attendance !== input.attendance) await syncNoShowFee(tx, auth, b, session, input.attendance, flags);
  return { updated: before.length };
}
