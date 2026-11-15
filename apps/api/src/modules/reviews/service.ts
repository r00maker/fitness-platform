/**
 * Reviews: after a class they came to, clients are asked for 1 to 5 stars and an optional comment.
 *
 *  - Only the most recent finished class is ever asked about. Skipping it is fine: the next class
 *    asks again. Clients who leave a review can say "don't ask me for N weeks".
 *  - Low reviews (2 stars or fewer) are flagged for staff under Feedback, Needs attention.
 *  - Google: after a review, everyone (whatever they gave) is offered the studio's Google review
 *    link, with their words ready to paste. Offering it only to happy clients ("review gating")
 *    is against Google's rules and can get a studio's reviews taken down, so the app never does.
 */
import { and, asc, avg, count, desc, eq, gte, isNotNull, isNull, lte, ne } from "drizzle-orm";
import { LOW_REVIEW_STARS, can } from "@studio/shared";
import { alias } from "drizzle-orm/pg-core";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, locations, memberships, reviews, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import type { AuthContext } from "../../plugins/auth.js";
import { notify } from "../notifications/outbox.js";
import { describeSession, getOrg, staffIds } from "../sessions/context.js";

const DAY = 86_400_000;
/** Reviews can be left up to this long after a class. The pop-up only asks about the last two weeks. */
const REVIEW_WINDOW_DAYS = 30;
const PROMPT_WINDOW_DAYS = 14;
const instructor = alias(users, "instructor");

/** Clients' bookings that count as "came": active, finished, not a no-show, class not cancelled. */
const cameTo = (clientId: string, orgId: string, now: Date, sinceDays: number) =>
  and(
    eq(bookings.orgId, orgId),
    eq(bookings.clientId, clientId),
    eq(bookings.status, "confirmed"),
    ne(bookings.attendance, "no_show"),
    eq(classSessions.status, "scheduled"),
    lte(classSessions.endsAt, now),
    gte(classSessions.endsAt, new Date(now.getTime() - sinceDays * DAY)),
  );

/** The review pop-up: the client's most recent finished class, if it hasn't been reviewed or skipped. */
export async function reviewPrompt(db: DbOrTx, auth: AuthContext, now = new Date()) {
  const org = await getOrg(db, auth.orgId);
  const [m] = await db.select({ snooze: memberships.reviewSnoozeUntil }).from(memberships).where(and(eq(memberships.orgId, auth.orgId), eq(memberships.userId, auth.userId)));
  const [{ n: reviewed } = { n: 0 }] = await db.select({ n: count() }).from(reviews).where(and(eq(reviews.orgId, auth.orgId), eq(reviews.clientId, auth.userId)));
  const base = { snoozedUntil: m?.snooze && m.snooze > now ? m.snooze.toISOString() : null, canSnooze: reviewed > 0 };
  if (!org.reviewsEnabled || auth.role !== "client" || (m?.snooze && m.snooze > now)) return { prompt: null, ...base };
  const [last] = await db
    .select({ bookingId: bookings.id, skipped: bookings.reviewSkippedAt, s: classSessions, review: reviews.id, first: instructor.firstName, last: instructor.lastName })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .leftJoin(reviews, eq(reviews.bookingId, bookings.id))
    .leftJoin(instructor, eq(instructor.id, classSessions.instructorId))
    .where(cameTo(auth.userId, auth.orgId, now, PROMPT_WINDOW_DAYS))
    .orderBy(desc(classSessions.endsAt))
    .limit(1);
  if (!last || last.review || last.skipped) return { prompt: null, ...base };
  const info = await describeSession(db, last.s);
  return {
    prompt: { bookingId: last.bookingId, className: info.className, displayDate: info.displayDate, localTime: info.localTime, locationName: info.locationName, instructorName: last.first ? `${last.first} ${last.last}` : null },
    ...base,
  };
}

export async function skipReview(tx: DbOrTx, auth: AuthContext, bookingId: string) {
  const [b] = await tx.select().from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.orgId, auth.orgId), eq(bookings.clientId, auth.userId)));
  if (!b) throw notFound("booking");
  await tx.update(bookings).set({ reviewSkippedAt: new Date() }).where(eq(bookings.id, bookingId));
  return { skipped: true };
}

export async function createReview(
  tx: DbOrTx,
  auth: AuthContext,
  input: { bookingId: string; rating: number; comment?: string | null; snoozeWeeks?: number },
  now = new Date(),
) {
  if (auth.role !== "client") throw forbidden("Only clients review classes.");
  const org = await getOrg(tx, auth.orgId);
  if (!org.reviewsEnabled) throw conflict("reviews_off", "This studio isn't taking reviews at the moment.");
  const [row] = await tx
    .select({ b: bookings, s: classSessions })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.orgId, auth.orgId), eq(bookings.clientId, auth.userId)));
  if (!row) throw notFound("booking");
  const { b, s } = row;
  if (b.status !== "confirmed" || s.status !== "scheduled" || b.attendance === "no_show") throw conflict("not_reviewable", "You can review classes you came to.");
  if (s.endsAt > now) throw conflict("not_finished", "You can review this class once it has finished.");
  if (s.endsAt.getTime() < now.getTime() - REVIEW_WINDOW_DAYS * DAY) throw conflict("too_late", `Reviews can be left up to ${REVIEW_WINDOW_DAYS} days after a class.`);
  const [existing] = await tx.select({ id: reviews.id }).from(reviews).where(eq(reviews.bookingId, b.id));
  if (existing) throw conflict("already_reviewed", "You've already reviewed this class. Thank you!");

  const comment = input.comment?.trim() || null;
  const [r] = await tx
    .insert(reviews)
    .values({ orgId: auth.orgId, bookingId: b.id, sessionId: s.id, clientId: auth.userId, instructorId: s.instructorId, classTypeId: s.classTypeId, locationId: s.locationId, rating: input.rating, comment, googleOfferedAt: org.googleReviewUrl ? now : null })
    .returning();
  if (input.snoozeWeeks) {
    await tx.update(memberships).set({ reviewSnoozeUntil: new Date(now.getTime() + input.snoozeWeeks * 7 * DAY) }).where(and(eq(memberships.orgId, auth.orgId), eq(memberships.userId, auth.userId)));
  }
  if (input.rating <= LOW_REVIEW_STARS) {
    const info = await describeSession(tx, s);
    const [u] = await tx.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, auth.userId));
    await notify(tx, { orgId: auth.orgId, userIds: await staffIds(tx, auth.orgId, ["owner", "admin"]), template: "review.low", data: { ...info, stars: input.rating, comment, clientName: `${u?.first} ${u?.last}`, reviewId: r!.id } });
  }
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "review.created", entityType: "review", entityId: r!.id, details: { rating: input.rating } });
  return {
    review: present(r!),
    snoozedUntil: input.snoozeWeeks ? new Date(now.getTime() + input.snoozeWeeks * 7 * DAY).toISOString() : null,
    // Offered to everyone who reviews, whatever they gave (see the note at the top).
    google: org.googleReviewUrl ? { url: org.googleReviewUrl, text: comment, ask: "Would you share this on Google too? It helps other people find the studio. Your words are copied, ready to paste." } : null,
  };
}

/** "Don't ask me for N weeks" from Preferences (0 = ask again). Needs at least one review first. */
export async function setReviewSnooze(tx: DbOrTx, auth: AuthContext, weeks: number, now = new Date()) {
  if (weeks > 0) {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(reviews).where(and(eq(reviews.orgId, auth.orgId), eq(reviews.clientId, auth.userId)));
    if (!n) throw conflict("review_first", "Leave one review first, then you can pause the review pop-ups.");
  }
  const until = weeks ? new Date(now.getTime() + weeks * 7 * DAY) : null;
  await tx.update(memberships).set({ reviewSnoozeUntil: until }).where(and(eq(memberships.orgId, auth.orgId), eq(memberships.userId, auth.userId)));
  return { snoozedUntil: until?.toISOString() ?? null };
}

export async function googleClicked(tx: DbOrTx, auth: AuthContext, id: string, now = new Date()) {
  const [r] = await tx.update(reviews).set({ googleClickedAt: now }).where(and(eq(reviews.id, id), eq(reviews.orgId, auth.orgId), eq(reviews.clientId, auth.userId), isNull(reviews.googleClickedAt))).returning();
  return { recorded: !!r };
}

/**
 * The Reviews page. Admins see every review with the client's name; instructors see reviews of
 * their own classes, with first names and initials only.
 */
export async function listReviews(
  db: DbOrTx,
  auth: AuthContext,
  q: { classTypeId?: string; instructorId?: string; locationId?: string; stars?: string; days: string },
  now = new Date(),
) {
  const all = can(auth.role, "viewReviews");
  if (!all && auth.role !== "instructor") throw forbidden();
  const where = and(
    eq(reviews.orgId, auth.orgId),
    all ? (q.instructorId ? eq(reviews.instructorId, q.instructorId) : undefined) : eq(reviews.instructorId, auth.userId),
    q.classTypeId ? eq(reviews.classTypeId, q.classTypeId) : undefined,
    q.locationId ? eq(reviews.locationId, q.locationId) : undefined,
    q.days !== "all" ? gte(reviews.createdAt, new Date(now.getTime() - Number(q.days) * DAY)) : undefined,
  );
  const starFilter = q.stars === "low" ? lte(reviews.rating, LOW_REVIEW_STARS) : q.stars ? eq(reviews.rating, Number(q.stars)) : undefined;
  const dist = await db.select({ rating: reviews.rating, n: count() }).from(reviews).where(where).groupBy(reviews.rating);
  const [g] = await db.select({ offered: count(reviews.googleOfferedAt), clicked: count(reviews.googleClickedAt) }).from(reviews).where(where);
  const total = dist.reduce((a, d) => a + d.n, 0);
  const average = total ? Math.round((dist.reduce((a, d) => a + d.rating * d.n, 0) / total) * 10) / 10 : null;
  const rows = await db
    .select({ r: reviews, first: users.firstName, last: users.lastName, className: classTypes.name, color: classTypes.color, locationName: locations.name, iFirst: instructor.firstName, iLast: instructor.lastName, startsAt: classSessions.startsAt })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.clientId))
    .innerJoin(classTypes, eq(classTypes.id, reviews.classTypeId))
    .innerJoin(locations, eq(locations.id, reviews.locationId))
    .innerJoin(classSessions, eq(classSessions.id, reviews.sessionId))
    .leftJoin(instructor, eq(instructor.id, reviews.instructorId))
    .where(and(where, starFilter))
    .orderBy(desc(reviews.createdAt))
    .limit(200);
  // Admins also get each instructor's average, to spot who clients love (and who may need support).
  const byInstructor = all
    ? await db
        .select({ id: reviews.instructorId, first: instructor.firstName, last: instructor.lastName, n: count(), avg: avg(reviews.rating) })
        .from(reviews)
        .leftJoin(instructor, eq(instructor.id, reviews.instructorId))
        .where(and(where, isNotNull(reviews.instructorId)))
        .groupBy(reviews.instructorId, instructor.firstName, instructor.lastName)
        .orderBy(desc(count()))
    : [];
  return {
    summary: {
      count: total,
      average,
      distribution: [5, 4, 3, 2, 1].map((stars) => ({ stars, count: dist.find((d) => d.rating === stars)?.n ?? 0 })),
      low: dist.filter((d) => d.rating <= LOW_REVIEW_STARS).reduce((a, d) => a + d.n, 0),
      google: { offered: g?.offered ?? 0, tapped: g?.clicked ?? 0 },
      text: total ? `${average} out of 5 from ${total} ${total === 1 ? "review" : "reviews"}.` : "No reviews yet for this choice.",
    },
    byInstructor: byInstructor.map((b) => ({ instructorId: b.id, name: `${b.first} ${b.last}`, count: b.n, average: Math.round(Number(b.avg) * 10) / 10 })),
    reviews: rows.map((x) => ({
      ...present(x.r),
      clientName: all ? `${x.first} ${x.last}` : `${x.first} ${x.last?.[0] ?? ""}.`,
      className: x.className,
      color: x.color,
      locationName: x.locationName,
      instructorName: x.iFirst ? `${x.iFirst} ${x.iLast}` : null,
      classStartsAt: x.startsAt.toISOString(),
    })),
    scope: { allInstructors: all },
  };
}

/** Low reviews still to look at (for Feedback, Needs attention). */
export async function lowReviewsToHandle(db: DbOrTx, orgId: string) {
  return db
    .select({ r: reviews, first: users.firstName, last: users.lastName, className: classTypes.name, startsAt: classSessions.startsAt, iFirst: instructor.firstName, iLast: instructor.lastName })
    .from(reviews)
    .innerJoin(users, eq(users.id, reviews.clientId))
    .innerJoin(classTypes, eq(classTypes.id, reviews.classTypeId))
    .innerJoin(classSessions, eq(classSessions.id, reviews.sessionId))
    .leftJoin(instructor, eq(instructor.id, reviews.instructorId))
    .where(and(eq(reviews.orgId, orgId), lte(reviews.rating, LOW_REVIEW_STARS), isNull(reviews.handledAt)))
    .orderBy(asc(reviews.createdAt));
}

/** Staff follow up a low review: mark it looked at, optionally replying to the client privately. */
export async function handleReview(tx: DbOrTx, auth: AuthContext, id: string, reply: string | null | undefined, now = new Date()) {
  const [r] = await tx.select().from(reviews).where(and(eq(reviews.id, id), eq(reviews.orgId, auth.orgId)));
  if (!r) throw notFound("review");
  if (r.handledAt) throw conflict("already_handled", "Someone has already followed this up.");
  const text = reply?.trim() || null;
  const [u] = await tx.update(reviews).set({ handledAt: now, handledBy: auth.userId, staffReply: text }).where(eq(reviews.id, id)).returning();
  if (text) {
    const [s] = await tx.select().from(classSessions).where(eq(classSessions.id, r.sessionId));
    const org = await getOrg(tx, auth.orgId);
    await notify(tx, { orgId: auth.orgId, userIds: [r.clientId], template: "review.reply", data: { ...(await describeSession(tx, s!)), reply: text, studioName: org.name } });
  }
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "review.handled", entityType: "review", entityId: id, details: { replied: !!text } });
  return present(u!);
}

export function present(r: typeof reviews.$inferSelect) {
  return {
    id: r.id,
    bookingId: r.bookingId,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt.toISOString(),
    low: r.rating <= LOW_REVIEW_STARS,
    handled: !!r.handledAt,
    staffReply: r.staffReply,
    googleTapped: !!r.googleClickedAt,
  };
}

