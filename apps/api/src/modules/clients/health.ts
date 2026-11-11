/**
 * Health notes: injuries, pregnancy and conditions a client wants instructors to know about.
 *
 * How it stays current without asking every time:
 *  - A note stays on the client's profile until they (or staff) mark it resolved.
 *  - When booking, the client only sees a one-tap "Still the same?" check if they
 *    haven't confirmed the note for HEALTH_NOTE_REVIEW_DAYS days.
 *  - Resolved notes disappear from class lists straight away. Clients can delete a note entirely.
 *
 * Who sees what: the client; admins and Front of House; instructors only for clients
 * booked into their own classes (via the class list). Notes are never put in emails or push messages.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray } from "drizzle-orm";
import { HEALTH_NOTE_REVIEW_DAYS, OPTION_LABELS, bodyArea, can, schemas, suggestHealthCategory, type HealthCategory } from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { clientHealthNotes, memberships } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, forbidden, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import type { AuthContext } from "../../plugins/auth.js";

type NoteRow = typeof clientHealthNotes.$inferSelect;

/** What staff and the client see for one note. */
export function presentNote(n: NoteRow, now = new Date()) {
  const area = bodyArea(n.description);
  return {
    id: n.id,
    category: n.category,
    /** e.g. "Injury · Knee" – short enough for the class list. */
    label: `${OPTION_LABELS.healthCategory[n.category]}${area && n.category !== "pregnancy" ? ` · ${area}` : ""}`,
    description: n.description,
    status: n.status,
    since: n.createdAt,
    reviewedAt: n.reviewedAt,
    resolvedAt: n.resolvedAt,
    needsReview: n.status === "active" && now.getTime() - n.reviewedAt.getTime() > HEALTH_NOTE_REVIEW_DAYS * 86_400_000,
  };
}

/** Active notes for several clients at once (class lists). Most important first. */
export async function activeHealthNotes(db: DbOrTx, orgId: string, clientIds: string[]) {
  const out = new Map<string, ReturnType<typeof presentNote>[]>();
  if (!clientIds.length) return out;
  const rows = await db
    .select()
    .from(clientHealthNotes)
    .where(and(eq(clientHealthNotes.orgId, orgId), inArray(clientHealthNotes.clientId, clientIds), eq(clientHealthNotes.status, "active")))
    .orderBy(desc(clientHealthNotes.createdAt));
  for (const r of rows) out.set(r.clientId, [...(out.get(r.clientId) ?? []), presentNote(r)]);
  return out;
}

export async function notesFor(db: DbOrTx, orgId: string, clientId: string) {
  const rows = await db
    .select()
    .from(clientHealthNotes)
    .where(and(eq(clientHealthNotes.orgId, orgId), eq(clientHealthNotes.clientId, clientId)))
    .orderBy(desc(clientHealthNotes.createdAt));
  const notes = rows.map((r) => presentNote(r));
  return { active: notes.filter((n) => n.status === "active"), resolved: notes.filter((n) => n.status === "resolved") };
}

const chooseCategory = (given: HealthCategory | undefined, description: string): HealthCategory => given ?? suggestHealthCategory(description)?.category ?? "other";

async function assertClient(db: DbOrTx, orgId: string, clientId: string) {
  const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, clientId), eq(memberships.role, "client")));
  if (!m) throw notFound("client");
}

async function getNote(tx: DbOrTx, orgId: string, clientId: string, id: string) {
  const [n] = await tx
    .select()
    .from(clientHealthNotes)
    .where(and(eq(clientHealthNotes.id, id), eq(clientHealthNotes.orgId, orgId), eq(clientHealthNotes.clientId, clientId)))
    .for("update");
  if (!n) throw notFound("note");
  return n;
}

export async function addNote(tx: DbOrTx, auth: AuthContext, clientId: string, input: { category?: HealthCategory; description: string }, now = new Date()) {
  const [n] = await tx
    .insert(clientHealthNotes)
    .values({ orgId: auth.orgId, clientId, category: chooseCategory(input.category, input.description), description: input.description, createdBy: auth.userId, reviewedAt: now })
    .returning();
  // The audit trail records that a note changed, never what it says.
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "health_note.added", entityType: "client", entityId: clientId, details: { noteId: n!.id, category: n!.category } });
  return presentNote(n!, now);
}

export async function resolveNote(tx: DbOrTx, auth: AuthContext, clientId: string, id: string, now = new Date()) {
  const n = await getNote(tx, auth.orgId, clientId, id);
  if (n.status === "resolved") throw conflict("already_resolved", "This note is already marked as resolved.");
  const [u] = await tx.update(clientHealthNotes).set({ status: "resolved", resolvedAt: now, resolvedBy: auth.userId }).where(eq(clientHealthNotes.id, id)).returning();
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "health_note.resolved", entityType: "client", entityId: clientId, details: { noteId: id } });
  return presentNote(u!, now);
}

const idParam = z.object({ id: schemas.id });
const noteParam = z.object({ id: schemas.id, noteId: schemas.id });

export async function healthNoteRoutes(app: FastifyInstance) {
  const own = (auth: AuthContext) => {
    if (auth.role !== "client") throw forbidden("Health notes here are for clients. Staff add them from the client's profile.");
    return auth.userId;
  };

  // --- The client's own notes (booking screen and portal) ---------------------
  app.get("/me/health-notes", async (req) => notesFor(app.db, req.auth.orgId, own(req.auth)));

  app.post("/me/health-notes", async (req, reply) => {
    const clientId = own(req.auth);
    const input = parse(schemas.createHealthNote, req.body);
    reply.code(201);
    return inTx(app, (tx) => addNote(tx, req.auth, clientId, input));
  });

  /** Editing a note also counts as confirming it's current. */
  app.patch("/me/health-notes/:id", async (req) => {
    const clientId = own(req.auth);
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.updateHealthNote, req.body);
    return inTx(app, async (tx) => {
      const n = await getNote(tx, req.auth.orgId, clientId, id);
      if (n.status !== "active") throw conflict("note_resolved", "This note is resolved. Add a new one if it's come back.");
      const description = input.description ?? n.description;
      // If they rewrite it without picking a type, re-suggest from the new wording.
      const category = input.category ?? (input.description ? chooseCategory(undefined, description) : n.category);
      const [u] = await tx.update(clientHealthNotes).set({ description, category, reviewedAt: new Date() }).where(eq(clientHealthNotes.id, id)).returning();
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "health_note.updated", entityType: "client", entityId: clientId, details: { noteId: id, category } });
      return presentNote(u!);
    });
  });

  /** "Still the same" – one tap from the booking screen. */
  app.post("/me/health-notes/:id/still-current", async (req) => {
    const clientId = own(req.auth);
    const { id } = parse(idParam, req.params);
    return inTx(app, async (tx) => {
      const n = await getNote(tx, req.auth.orgId, clientId, id);
      if (n.status !== "active") throw conflict("note_resolved", "This note is already resolved.");
      const [u] = await tx.update(clientHealthNotes).set({ reviewedAt: new Date() }).where(eq(clientHealthNotes.id, id)).returning();
      return presentNote(u!);
    });
  });

  app.post("/me/health-notes/:id/resolve", async (req) => {
    const clientId = own(req.auth);
    const { id } = parse(idParam, req.params);
    return inTx(app, (tx) => resolveNote(tx, req.auth, clientId, id));
  });

  /** Clients can remove a note completely (their data, their choice). */
  app.delete("/me/health-notes/:id", async (req, reply) => {
    const clientId = own(req.auth);
    const { id } = parse(idParam, req.params);
    await inTx(app, async (tx) => {
      await getNote(tx, req.auth.orgId, clientId, id);
      await tx.delete(clientHealthNotes).where(eq(clientHealthNotes.id, id));
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "health_note.deleted", entityType: "client", entityId: clientId, details: { noteId: id } });
    });
    return reply.code(204).send();
  });

  // --- Staff, on a client's behalf (e.g. told at the front desk) ---------------
  app.post("/clients/:id/health-notes", async (req, reply) => {
    if (!can(req.auth.role, "manageHealthNotes")) throw forbidden();
    const { id } = parse(idParam, req.params);
    const input = parse(schemas.createHealthNote, req.body);
    await assertClient(app.db, req.auth.orgId, id);
    reply.code(201);
    return inTx(app, (tx) => addNote(tx, req.auth, id, input));
  });

  app.post("/clients/:id/health-notes/:noteId/resolve", async (req) => {
    if (!can(req.auth.role, "manageHealthNotes")) throw forbidden();
    const { id, noteId } = parse(noteParam, req.params);
    return inTx(app, (tx) => resolveNote(tx, req.auth, id, noteId));
  });
}
