/**
 * Waivers.
 *  - Studio members sign the waiver in the app the first time they book (or any time from their profile).
 *    No one, staff included, can book or waitlist a studio member who hasn't, so they never
 *    turn up on a class list without one.
 *  - ClassPass clients sign at the studio; staff then mark it done from the class list,
 *    after a "have you checked?" confirmation. The same button appears for anyone else
 *    still missing one (e.g. after an admin undoes a waiver, or waivers were just switched on).
 *  - Once done, only an admin can undo it, so a mis-tap can't quietly remove it.
 *  - Studios that don't use waivers switch them off in settings.
 */
import type { FastifyInstance } from "fastify";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { can, schemas, type WaiverMethod } from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, clientWaivers, memberships, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import type { Flags } from "../../lib/flags.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import type { AuthContext } from "../../plugins/auth.js";
import { getOrg, userName } from "../sessions/context.js";

type Org = Awaited<ReturnType<typeof getOrg>>;

/** Shown until the studio pastes in its own waiver. Studios should replace it with wording from their own adviser. */
export const STANDARD_WAIVER_TEXT =
  "I confirm that I am in good health and able to take part in exercise classes. I will tell my instructor about any injury, condition or pregnancy before class. " +
  "I understand that exercise carries some risk of injury, and I take part at my own risk. I agree to follow the instructor's guidance and to stop if I feel unwell.";

export const waiverText = (org: Org) => org.waiverText ?? STANDARD_WAIVER_TEXT;

export interface WaiverStatus {
  status: "complete" | "missing" | "not_required";
  method?: WaiverMethod;
  recordedAt?: Date;
}

/** Waiver status for several clients in one query (for class lists). */
export async function waiverStatuses(db: DbOrTx, org: Org, clientIds: string[]): Promise<Map<string, WaiverStatus>> {
  const out = new Map<string, WaiverStatus>();
  if (!org.waiverRequired) {
    for (const id of clientIds) out.set(id, { status: "not_required" });
    return out;
  }
  const rows = clientIds.length
    ? await db
        .select({ clientId: clientWaivers.clientId, method: clientWaivers.method, recordedAt: clientWaivers.recordedAt })
        .from(clientWaivers)
        .where(and(eq(clientWaivers.orgId, org.id), inArray(clientWaivers.clientId, clientIds), isNull(clientWaivers.revokedAt)))
    : [];
  const done = new Map(rows.map((r) => [r.clientId, r]));
  for (const id of clientIds) {
    const r = done.get(id);
    out.set(id, r ? { status: "complete", method: r.method, recordedAt: r.recordedAt } : { status: "missing" });
  }
  return out;
}

async function activeWaiver(db: DbOrTx, orgId: string, clientId: string) {
  const [w] = await db
    .select()
    .from(clientWaivers)
    .where(and(eq(clientWaivers.orgId, orgId), eq(clientWaivers.clientId, clientId), isNull(clientWaivers.revokedAt)));
  return w ?? null;
}

async function clientMembership(db: DbOrTx, orgId: string, clientId: string) {
  const [m] = await db
    .select({ source: memberships.source })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, clientId), eq(memberships.role, "client")));
  if (!m) throw notFound("client");
  return m;
}

/** A client signs the waiver themselves (typed name + "I agree"). Signing again is harmless. */
export async function signWaiver(tx: DbOrTx, org: Org, clientId: string, input: { signedName: string }) {
  const existing = await activeWaiver(tx, org.id, clientId);
  if (existing) return existing;
  const [w] = await tx
    .insert(clientWaivers)
    .values({ orgId: org.id, clientId, method: "signed_by_client", signedName: input.signedName, waiverVersion: org.waiverVersion, recordedBy: clientId })
    .onConflictDoNothing()
    .returning();
  const row = w ?? (await activeWaiver(tx, org.id, clientId))!;
  await audit(tx, { orgId: org.id, actorId: clientId, action: "waiver.signed", entityType: "client", entityId: clientId, details: { version: org.waiverVersion } });
  return row;
}

/**
 * Called when booking or joining a waitlist. Studio members must have signed first,
 * whoever is booking: they can sign in the same step by sending `waiver`, and staff
 * are told to ask them to sign (or mark a paper copy done). ClassPass clients book
 * through ClassPass and are checked at the studio, so staff just get a reminder.
 */
export async function requireWaiver(tx: DbOrTx, auth: AuthContext, org: Org, clientId: string, waiver: { signedName: string } | undefined, flags?: Flags, sessionId?: string) {
  if (!org.waiverRequired || (await activeWaiver(tx, org.id, clientId))) return;
  const { source } = await clientMembership(tx, org.id, clientId);
  if (source === "direct") {
    if (auth.role !== "client") {
      throw conflict(
        "waiver_required",
        `${await userName(tx, clientId)} hasn't signed the waiver yet, so they can't be booked in. Ask them to sign it in the app, or if they've signed a paper copy, mark it done on their profile first.`,
      );
    }
    if (waiver) {
      await signWaiver(tx, org, clientId, waiver);
      return;
    }
    throw conflict("waiver_required", "Please read and sign the studio's waiver before your first class. You only need to do this once.", {
      waiver: { text: waiverText(org), version: org.waiverVersion },
    });
  }
  if (auth.role === "client") return;
  flags?.info({ code: "waiver_missing", sessionId, message: `${await userName(tx, clientId)} hasn't completed the waiver yet. Check it at the studio and mark it done on the class list.` });
}

/** Instructors can only mark waivers for people booked into a class they teach. */
async function isInInstructorsClass(db: DbOrTx, orgId: string, instructorId: string, clientId: string) {
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.orgId, orgId), eq(bookings.clientId, clientId), eq(bookings.status, "confirmed"), eq(classSessions.instructorId, instructorId)))
    .limit(1);
  return !!row;
}

/** Staff mark a waiver done, after confirming they've actually checked it. */
export async function markWaiverDone(tx: DbOrTx, auth: AuthContext, clientId: string, flags: Flags) {
  if (!can(auth.role, "confirmWaivers")) throw forbidden();
  const org = await getOrg(tx, auth.orgId);
  if (!org.waiverRequired) throw badRequest("waivers_off", "Your studio doesn't use waivers. An admin can switch them on in Studio rules.");
  await clientMembership(tx, auth.orgId, clientId);
  if (auth.role === "instructor" && !(await isInInstructorsClass(tx, auth.orgId, auth.userId, clientId))) throw notFound("client");
  if (await activeWaiver(tx, auth.orgId, clientId)) throw conflict("waiver_already_done", "This client's waiver is already marked as done.");

  const name = await userName(tx, clientId);
  flags.confirm({ code: "confirm_waiver_complete", message: `Has ${name} actually completed the studio's waiver? Once it's marked as done, only an admin can undo it.` });
  const [w] = await tx
    .insert(clientWaivers)
    .values({ orgId: auth.orgId, clientId, method: "confirmed_by_staff", recordedBy: auth.userId })
    .onConflictDoNothing()
    .returning();
  if (!w) throw conflict("waiver_already_done", "This client's waiver is already marked as done.");
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "waiver.marked_done", entityType: "client", entityId: clientId });
  return { ...w, recordedByName: await userName(tx, auth.userId) };
}

/** Admins only. The record is kept (marked as undone) rather than deleted. */
export async function undoWaiver(tx: DbOrTx, auth: AuthContext, clientId: string, reason: string, now = new Date()) {
  if (!can(auth.role, "reverseWaivers")) throw forbidden("Only an admin can undo a completed waiver.");
  await clientMembership(tx, auth.orgId, clientId);
  const w = await activeWaiver(tx, auth.orgId, clientId);
  if (!w) throw conflict("no_waiver", "This client doesn't have a completed waiver to undo.");
  const [undone] = await tx
    .update(clientWaivers)
    .set({ revokedAt: now, revokedBy: auth.userId, revokeReason: reason })
    .where(eq(clientWaivers.id, w.id))
    .returning();
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "waiver.undone", entityType: "client", entityId: clientId, details: { reason, method: w.method } });
  return undone!;
}

/** Full waiver record for the client's profile (admin view). */
export async function waiverHistory(db: DbOrTx, orgId: string, clientId: string) {
  const rows = await db
    .select({ w: clientWaivers, byFirst: users.firstName, byLast: users.lastName })
    .from(clientWaivers)
    .innerJoin(users, eq(users.id, clientWaivers.recordedBy))
    .where(and(eq(clientWaivers.orgId, orgId), eq(clientWaivers.clientId, clientId)))
    .orderBy(clientWaivers.recordedAt);
  return rows.map((r) => ({ ...r.w, recordedByName: `${r.byFirst} ${r.byLast}` }));
}

const idParam = z.object({ id: schemas.id });

export async function waiverRoutes(app: FastifyInstance) {
  /** The client's own waiver: whether they need to sign, and the wording. */
  app.get("/me/waiver", async (req) => {
    const org = await getOrg(app.db, req.auth.orgId);
    const w = await activeWaiver(app.db, req.auth.orgId, req.auth.userId);
    return {
      required: org.waiverRequired,
      done: !!w,
      signedAt: w?.recordedAt ?? null,
      method: w?.method ?? null,
      text: org.waiverRequired ? waiverText(org) : null,
      version: org.waiverVersion,
    };
  });

  app.post("/me/waiver", async (req, reply) => {
    if (req.auth.role !== "client") throw forbidden("Waivers are signed by clients.");
    const input = parse(schemas.signWaiver, req.body);
    const w = await inTx(app, async (tx) => {
      const org = await getOrg(tx, req.auth.orgId);
      if (!org.waiverRequired) throw badRequest("waivers_off", "This studio doesn't need a waiver.");
      return signWaiver(tx, org, req.auth.userId, input);
    });
    reply.code(201);
    return w;
  });

  app.post("/clients/:id/waiver/mark-done", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { acknowledge } = parse(schemas.confirmWaiver, req.body ?? {});
    const w = await withFlags(app, acknowledge, (tx, flags) => markWaiverDone(tx, req.auth, id, flags));
    reply.code(201);
    return w;
  });

  app.post("/clients/:id/waiver/undo", async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(schemas.reverseWaiver, req.body);
    return inTx(app, (tx) => undoWaiver(tx, req.auth, id, reason));
  });
}
