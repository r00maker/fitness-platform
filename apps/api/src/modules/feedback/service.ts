/**
 * Client feedback: what a client would like the studio to know or change ("the aircon at Tanjong
 * Pagar is really cold"), in a category. Staff read it by category, reply, and mark it sorted;
 * clients see the replies and can answer back. Low reviews show here too, under Needs attention.
 */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { FEEDBACK_CATEGORIES, OPTION_LABELS, type FeedbackCategory, type FeedbackStatus } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { feedback, feedbackReplies, locations, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import type { AuthContext } from "../../plugins/auth.js";
import { notify } from "../notifications/outbox.js";
import { getOrg, staffIds } from "../sessions/context.js";
import { lowReviewsToHandle } from "../reviews/service.js";

type Row = typeof feedback.$inferSelect;
const label = (c: FeedbackCategory) => OPTION_LABELS.feedbackCategory[c];

async function locationName(db: DbOrTx, orgId: string, id: string | null | undefined) {
  if (!id) return null;
  const [l] = await db.select({ name: locations.name }).from(locations).where(and(eq(locations.id, id), eq(locations.orgId, orgId)));
  if (!l) throw notFound("location");
  return l.name;
}

export async function createFeedback(tx: DbOrTx, auth: AuthContext, input: { category: FeedbackCategory; message: string; locationId?: string | null }) {
  const where = await locationName(tx, auth.orgId, input.locationId);
  const [f] = await tx.insert(feedback).values({ orgId: auth.orgId, clientId: auth.userId, category: input.category, message: input.message, locationId: input.locationId ?? null }).returning();
  const [u] = await tx.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, auth.userId));
  await notify(tx, { orgId: auth.orgId, userIds: await staffIds(tx, auth.orgId, ["owner", "admin"]), template: "feedback.new", data: { feedbackId: f!.id, clientName: `${u?.first} ${u?.last}`, categoryLabel: label(input.category), message: input.message, locationName: where } });
  return present(f!, [], where);
}

/** Replies in order, for one or many feedback items. */
async function repliesFor(db: DbOrTx, ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; fromStudio: boolean; body: string; createdAt: string; authorName: string | null }[]>();
  const rows = await db
    .select({ r: feedbackReplies, first: users.firstName, last: users.lastName })
    .from(feedbackReplies)
    .leftJoin(users, eq(users.id, feedbackReplies.authorId))
    .where(inArray(feedbackReplies.feedbackId, ids))
    .orderBy(asc(feedbackReplies.createdAt));
  const out = new Map<string, { id: string; fromStudio: boolean; body: string; createdAt: string; authorName: string | null }[]>();
  for (const x of rows) {
    const list = out.get(x.r.feedbackId) ?? [];
    list.push({ id: x.r.id, fromStudio: x.r.fromStudio, body: x.r.body, createdAt: x.r.createdAt.toISOString(), authorName: x.first ? `${x.first} ${x.last}` : null });
    out.set(x.r.feedbackId, list);
  }
  return out;
}

/** A client's own feedback, with the studio's replies (staff names shown as the studio). */
export async function myFeedback(db: DbOrTx, auth: AuthContext) {
  const org = await getOrg(db, auth.orgId);
  const rows = await db.select({ f: feedback, where: locations.name }).from(feedback).leftJoin(locations, eq(locations.id, feedback.locationId)).where(and(eq(feedback.orgId, auth.orgId), eq(feedback.clientId, auth.userId))).orderBy(desc(feedback.lastActivityAt));
  const replies = await repliesFor(db, rows.map((r) => r.f.id));
  return { feedback: rows.map((r) => present(r.f, (replies.get(r.f.id) ?? []).map((x) => ({ ...x, authorName: x.fromStudio ? org.name : null })), r.where)) };
}

async function getOwnOrStaff(tx: DbOrTx, auth: AuthContext, id: string, staff: boolean) {
  const [f] = await tx.select().from(feedback).where(and(eq(feedback.id, id), eq(feedback.orgId, auth.orgId), staff ? undefined : eq(feedback.clientId, auth.userId))).for("update");
  if (!f) throw notFound("feedback");
  return f;
}

/** A reply: from staff it goes to the client; from the client it goes back to staff. */
export async function reply(tx: DbOrTx, auth: AuthContext, id: string, body: string, staff: boolean, now = new Date()) {
  const f = await getOwnOrStaff(tx, auth, id, staff);
  await tx.insert(feedbackReplies).values({ orgId: auth.orgId, feedbackId: id, authorId: auth.userId, fromStudio: staff, body });
  const status: FeedbackStatus = staff ? (f.status === "new" ? "in_progress" : f.status) : f.status === "resolved" ? "new" : f.status;
  await tx.update(feedback).set({ status, lastActivityAt: now }).where(eq(feedback.id, id));
  const org = await getOrg(tx, auth.orgId);
  if (staff) {
    await notify(tx, { orgId: auth.orgId, userIds: [f.clientId], template: "feedback.replied", data: { feedbackId: id, studioName: org.name, message: f.message, reply: body } });
  } else {
    const [u] = await tx.select({ first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, auth.userId));
    await notify(tx, { orgId: auth.orgId, userIds: await staffIds(tx, auth.orgId, ["owner", "admin"]), template: "feedback.new", data: { feedbackId: id, followUp: true, clientName: `${u?.first} ${u?.last}`, categoryLabel: label(f.category), message: body } });
  }
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "feedback.replied", entityType: "feedback", entityId: id, details: { fromStudio: staff } });
  return { status };
}

export async function setStatus(tx: DbOrTx, auth: AuthContext, id: string, status: FeedbackStatus) {
  const f = await getOwnOrStaff(tx, auth, id, true);
  if (f.status === status) throw conflict("same_status", `It's already marked “${OPTION_LABELS.feedbackStatus[status]}”.`);
  await tx.update(feedback).set({ status }).where(eq(feedback.id, id));
  return { id, status };
}

/**
 * The Feedback page for staff: each category kept apart with its own counts, plus Needs
 * attention (new feedback nobody has answered, and low reviews nobody has followed up).
 */
export async function staffFeedback(db: DbOrTx, auth: AuthContext, q: { category?: FeedbackCategory; status?: FeedbackStatus }) {
  const counts = await db
    .select({ category: feedback.category, status: feedback.status, n: count() })
    .from(feedback)
    .where(eq(feedback.orgId, auth.orgId))
    .groupBy(feedback.category, feedback.status);
  const categories = FEEDBACK_CATEGORIES.map((c) => {
    const mine = counts.filter((x) => x.category === c);
    return { category: c, label: label(c), new: mine.find((x) => x.status === "new")?.n ?? 0, open: mine.filter((x) => x.status !== "resolved").reduce((a, x) => a + x.n, 0), total: mine.reduce((a, x) => a + x.n, 0) };
  });
  const rows = await db
    .select({ f: feedback, first: users.firstName, last: users.lastName, where: locations.name })
    .from(feedback)
    .innerJoin(users, eq(users.id, feedback.clientId))
    .leftJoin(locations, eq(locations.id, feedback.locationId))
    .where(and(eq(feedback.orgId, auth.orgId), q.category ? eq(feedback.category, q.category) : undefined, q.status ? eq(feedback.status, q.status) : undefined))
    .orderBy(sql`case when ${feedback.status} = 'new' then 0 when ${feedback.status} = 'in_progress' then 1 else 2 end`, desc(feedback.lastActivityAt))
    .limit(300);
  const replies = await repliesFor(db, rows.map((r) => r.f.id));
  const low = await lowReviewsToHandle(db, auth.orgId);
  const newCount = categories.reduce((a, c) => a + c.new, 0);
  return {
    needsAttention: {
      count: newCount + low.length,
      newFeedback: newCount,
      lowReviews: low.map((x) => ({ id: x.r.id, rating: x.r.rating, comment: x.r.comment, createdAt: x.r.createdAt.toISOString(), clientName: `${x.first} ${x.last}`, className: x.className, classStartsAt: x.startsAt.toISOString(), instructorName: x.iFirst ? `${x.iFirst} ${x.iLast}` : null })),
    },
    categories,
    feedback: rows.map((r) => ({ ...present(r.f, replies.get(r.f.id) ?? [], r.where), clientName: `${r.first} ${r.last}` })),
  };
}

function present(f: Row, replies: { id: string; fromStudio: boolean; body: string; createdAt: string; authorName: string | null }[], where: string | null) {
  return { id: f.id, category: f.category, categoryLabel: label(f.category), message: f.message, locationName: where, status: f.status, statusLabel: OPTION_LABELS.feedbackStatus[f.status], createdAt: f.createdAt.toISOString(), lastActivityAt: f.lastActivityAt.toISOString(), replies };
}
