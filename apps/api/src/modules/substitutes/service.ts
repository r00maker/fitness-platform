/**
 * Substitute (cover) requests.
 *  - Instructors can ask for cover on their own classes, but don't choose who covers:
 *    their request goes to the class's teaching list (set by admins) and admins are told.
 *  - Admins can ask for cover on any class and choose exactly who is asked, or assign someone directly.
 *  - Invited instructors (or everyone who teaches, if there's no list) get email + push.
 *  - "Automatic" studios: the first instructor to accept gets the class.
 *    "Manual" studios: acceptances are collected and an admin picks one.
 */
import { and, eq, inArray } from "drizzle-orm";
import { can } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { classSessions, classTypeInstructors, substituteRequests, substituteResponses, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import type { AuthContext } from "../../plugins/auth.js";
import { notify } from "../notifications/outbox.js";
import type { Flags } from "../../lib/flags.js";
import { checkInstructorListed, checkSlot } from "../checks/session-checks.js";
import { findOverlaps } from "../sessions/context.js";
import { describeSession, getOrg, getSession, locationZone, lockSession, staffIds, userName, type SessionRow } from "../sessions/context.js";
import { notifyInstructorChange } from "../sessions/service.js";

type RequestRow = typeof substituteRequests.$inferSelect;
const isManager = (a: AuthContext) => can(a.role, "manageCover");

async function getRequest(tx: DbOrTx, orgId: string, id: string): Promise<RequestRow> {
  const [r] = await tx
    .select()
    .from(substituteRequests)
    .where(and(eq(substituteRequests.id, id), eq(substituteRequests.orgId, orgId)))
    .for("update");
  if (!r) throw notFound("cover request");
  return r;
}

async function invitees(tx: DbOrTx, r: Pick<RequestRow, "orgId" | "invitedInstructorIds" | "originalInstructorId">) {
  const ids = r.invitedInstructorIds.length ? r.invitedInstructorIds : await staffIds(tx, r.orgId, ["instructor"]);
  return ids.filter((id) => id !== r.originalInstructorId);
}

export async function createSubRequest(tx: DbOrTx, auth: AuthContext, input: { sessionId: string; reason?: string; invitedInstructorIds?: string[] }, now = new Date()) {
  const s = await lockSession(tx, auth.orgId, input.sessionId);
  if (!isManager(auth) && !(auth.role === "instructor" && s.instructorId === auth.userId)) {
    throw forbidden("You can only ask for cover on classes you teach.");
  }
  if (s.status !== "scheduled" || s.startsAt <= now) throw conflict("class_not_upcoming", "Cover can only be requested for upcoming classes.");
  if (input.invitedInstructorIds?.length && !isManager(auth)) {
    throw forbidden("Your studio's admin arranges who covers. Just send the request and you'll be told once it's sorted.");
  }

  const org = await getOrg(tx, auth.orgId);
  const instructors = new Set(await staffIds(tx, auth.orgId, ["owner", "admin", "instructor"]));
  for (const id of input.invitedInstructorIds ?? []) if (!instructors.has(id)) throw notFound("instructor");
  // No one chosen: ask the class type's teaching list if the studio keeps one, otherwise every instructor.
  const invited = input.invitedInstructorIds?.length ? input.invitedInstructorIds : (await teachingList(tx, s.classTypeId)).filter((id) => id !== s.instructorId);

  const [r] = await tx
    .insert(substituteRequests)
    .values({
      orgId: auth.orgId,
      sessionId: s.id,
      requestedBy: auth.userId,
      originalInstructorId: s.instructorId,
      reason: input.reason ?? null,
      approvalMode: org.substituteApproval,
      invitedInstructorIds: invited,
    })
    .onConflictDoNothing()
    .returning();
  if (!r) throw conflict("already_requested", "Cover has already been requested for this class.");

  const info = await describeSession(tx, s);
  const requesterName = await userName(tx, auth.userId);
  await notify(tx, {
    orgId: auth.orgId,
    userIds: await invitees(tx, r),
    template: "sub.requested",
    data: { ...info, requestId: r.id, reason: input.reason, requesterName },
  });
  // Admins hear about every request an instructor makes, so they can step in and choose.
  if (!isManager(auth)) {
    await notify(tx, {
      orgId: auth.orgId,
      userIds: await staffIds(tx, auth.orgId, ["owner", "admin"]),
      template: "sub.request_made",
      data: { ...info, requestId: r.id, reason: input.reason, requesterName },
    });
  }
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "sub.requested", entityType: "substitute_request", entityId: r.id });
  return r;
}

/** Warn (not block) if the cover instructor is already teaching at that time. */
async function checkCover(tx: DbOrTx, orgId: string, flags: Flags, s: SessionRow, instructorId: string) {
  const zone = await locationZone(tx, orgId, s.locationId);
  await checkSlot(tx, orgId, flags, zone, { sessionId: s.id, instructorId, startsAt: s.startsAt, endsAt: s.endsAt, excludeIds: [s.id] });
}

/** Put the new instructor on the class and tell everyone involved. */
async function fill(tx: DbOrTx, auth: AuthContext, r: RequestRow, instructorId: string, flags: Flags, now: Date) {
  const s = await lockSession(tx, auth.orgId, r.sessionId);
  await checkCover(tx, auth.orgId, flags, s, instructorId);
  await checkInstructorListed(tx, flags, { sessionId: s.id, classTypeId: s.classTypeId, instructorId });
  // Whoever covers is shown as cover for the usual instructor (unless the usual instructor takes it back).
  const usual = s.coverForInstructorId ?? s.instructorId;
  const [updated] = await tx
    .update(classSessions)
    .set({ instructorId, coverForInstructorId: instructorId === usual ? null : usual })
    .where(eq(classSessions.id, s.id))
    .returning();
  const [filled] = await tx
    .update(substituteRequests)
    .set({ status: "filled", filledBy: instructorId, resolvedAt: now })
    .where(eq(substituteRequests.id, r.id))
    .returning();

  await notifyInstructorChange(tx, auth.orgId, updated!, s.instructorId, { notifyClients: true, actorId: "" });
  const info = { ...(await describeSession(tx, updated!)), requestId: r.id, instructorName: await userName(tx, instructorId) };
  const admins = await staffIds(tx, auth.orgId, ["owner", "admin"]);
  await notify(tx, { orgId: auth.orgId, userIds: [r.requestedBy, ...admins].filter((id) => id !== instructorId && id !== s.instructorId), template: "sub.filled", data: info });
  // Anyone else who offered is told it's sorted.
  const others = await tx
    .select({ id: substituteResponses.instructorId })
    .from(substituteResponses)
    .where(and(eq(substituteResponses.requestId, r.id), eq(substituteResponses.accepted, true)));
  await notify(tx, { orgId: auth.orgId, userIds: others.map((o) => o.id).filter((id) => id !== instructorId), template: "sub.no_longer_needed", data: info });
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "sub.filled", entityType: "substitute_request", entityId: r.id, details: { instructorId } });
  return filled!;
}

export async function respondToSubRequest(tx: DbOrTx, auth: AuthContext, requestId: string, accepted: boolean, flags: Flags, now = new Date()) {
  if (!["instructor", "admin", "owner"].includes(auth.role)) throw forbidden();
  const r = await getRequest(tx, auth.orgId, requestId);
  if (!["open", "awaiting_approval"].includes(r.status)) throw conflict("request_closed", "This class no longer needs cover.");
  if (r.originalInstructorId === auth.userId) throw badRequest("own_class", "You can't cover your own class.");
  if (r.invitedInstructorIds.length && !r.invitedInstructorIds.includes(auth.userId)) throw forbidden("You weren't asked to cover this class.");
  const s = await getSession(tx, auth.orgId, r.sessionId);
  if (s.startsAt <= now) throw conflict("class_started", "This class has already started.");
  if (accepted) await checkCover(tx, auth.orgId, flags, s, auth.userId);

  await tx
    .insert(substituteResponses)
    .values({ orgId: auth.orgId, requestId: r.id, instructorId: auth.userId, accepted })
    .onConflictDoUpdate({ target: [substituteResponses.requestId, substituteResponses.instructorId], set: { accepted } });
  if (!accepted) return r;

  if (r.approvalMode === "automatic") return fill(tx, auth, r, auth.userId, flags, now);

  const [updated] = await tx.update(substituteRequests).set({ status: "awaiting_approval" }).where(eq(substituteRequests.id, r.id)).returning();
  await notify(tx, {
    orgId: auth.orgId,
    userIds: await staffIds(tx, auth.orgId, ["owner", "admin"]),
    template: "sub.awaiting_approval",
    data: { ...(await describeSession(tx, s)), requestId: r.id, instructorName: await userName(tx, auth.userId) },
  });
  return updated!;
}

export async function approveSub(tx: DbOrTx, auth: AuthContext, requestId: string, instructorId: string, flags: Flags, now = new Date()) {
  if (!isManager(auth)) throw forbidden();
  const r = await getRequest(tx, auth.orgId, requestId);
  if (!["open", "awaiting_approval"].includes(r.status)) throw conflict("request_closed", "This class no longer needs cover.");
  const [resp] = await tx
    .select()
    .from(substituteResponses)
    .where(and(eq(substituteResponses.requestId, r.id), eq(substituteResponses.instructorId, instructorId), eq(substituteResponses.accepted, true)));
  if (!resp) throw badRequest("not_accepted", "That instructor hasn't offered to cover this class.");
  return fill(tx, auth, r, instructorId, flags, now);
}

/** Admins can also skip the request flow and assign cover directly. */
export async function assignSubDirectly(tx: DbOrTx, auth: AuthContext, requestId: string, instructorId: string, flags: Flags, now = new Date()) {
  if (!isManager(auth)) throw forbidden();
  const r = await getRequest(tx, auth.orgId, requestId);
  if (!["open", "awaiting_approval"].includes(r.status)) throw conflict("request_closed", "This class no longer needs cover.");
  const teachers = await staffIds(tx, auth.orgId, ["owner", "admin", "instructor"]);
  if (!teachers.includes(instructorId)) throw notFound("instructor");
  return fill(tx, auth, r, instructorId, flags, now);
}

export async function cancelSubRequest(tx: DbOrTx, auth: AuthContext, requestId: string, now = new Date()) {
  const r = await getRequest(tx, auth.orgId, requestId);
  if (!isManager(auth) && r.requestedBy !== auth.userId) throw forbidden();
  if (!["open", "awaiting_approval"].includes(r.status)) throw conflict("request_closed", "This request is already closed.");
  const [updated] = await tx.update(substituteRequests).set({ status: "cancelled", resolvedAt: now }).where(eq(substituteRequests.id, r.id)).returning();
  const info = { ...(await describeSession(tx, await getSession(tx, auth.orgId, r.sessionId))), requestId: r.id };
  await notify(tx, { orgId: auth.orgId, userIds: await invitees(tx, r), template: "sub.no_longer_needed", data: info });
  return updated!;
}

export async function teachingList(db: DbOrTx, classTypeId: string): Promise<string[]> {
  const rows = await db.select({ id: classTypeInstructors.instructorId }).from(classTypeInstructors).where(eq(classTypeInstructors.classTypeId, classTypeId));
  return rows.map((r) => r.id);
}

/**
 * Who could cover a class, for the admin's "Arrange cover" screen: every other instructor,
 * marked if they're on the class's teaching list and if they're busy at that time.
 * `suggested` is the default selection (listed and free, or everyone free if there's no list).
 */
export async function coverOptions(db: DbOrTx, auth: AuthContext, sessionId: string) {
  if (!isManager(auth)) throw forbidden("Your studio's admin arranges who covers.");
  const s = await getSession(db, auth.orgId, sessionId);
  const ids = (await staffIds(db, auth.orgId, ["instructor"])).filter((id) => id !== s.instructorId);
  const list = new Set(await teachingList(db, s.classTypeId));
  const options = [];
  for (const id of ids) {
    const [u] = await db.select({ f: users.firstName, l: users.lastName, photoUrl: users.photoUrl }).from(users).where(eq(users.id, id));
    const busy = (await findOverlaps(db, auth.orgId, { instructorId: id, startsAt: s.startsAt, endsAt: s.endsAt, excludeIds: [s.id] })).length > 0;
    options.push({ id, name: `${u?.f} ${u?.l}`, photoUrl: u?.photoUrl ?? null, onTeachingList: list.has(id), busy });
  }
  const suggested = options.filter((o) => !o.busy && (list.size === 0 || o.onTeachingList)).map((o) => o.id);
  return { hasTeachingList: list.size > 0, options, suggested };
}

export async function listSubRequests(db: DbOrTx, auth: AuthContext, statuses: RequestRow["status"][]) {
  const rows = await db
    .select()
    .from(substituteRequests)
    .where(and(eq(substituteRequests.orgId, auth.orgId), inArray(substituteRequests.status, statuses)))
    .orderBy(substituteRequests.createdAt);
  // Instructors see requests they made or were asked to cover.
  const visible = isManager(auth) ? rows : rows.filter((r) => r.requestedBy === auth.userId || canSeeRequest(r, auth.userId));
  // Include the class details, since instructors can't open other people's classes on the calendar.
  return Promise.all(visible.map(async (r) => ({ ...r, session: await describeSession(db, await getSession(db, auth.orgId, r.sessionId)) })));
}

/** Whether an instructor has been asked to cover this request. */
export function canSeeRequest(r: Pick<RequestRow, "invitedInstructorIds" | "originalInstructorId">, userId: string) {
  return r.originalInstructorId !== userId && (r.invitedInstructorIds.length === 0 || r.invitedInstructorIds.includes(userId));
}
