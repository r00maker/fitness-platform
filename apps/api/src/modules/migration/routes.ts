/**
 * Moving a studio from its old system.
 *
 * The moving form comes before the studio's app is set up: our team sends the owner a private
 * link (no account needed) or fills it in with them on a call. It asks what we need to know and
 * how we get the data (invite our team as a staff user, share a temporary password, or upload
 * the exports), and takes files if they have them.
 *
 * Our side (HQ, onboarding and owner roles): upload the exports, check how each file was read
 * (kind and columns, changeable), run the check (a full rehearsal that changes nothing), import
 * when it's clean, compare a random sample against the old system, then mark it verified. An import
 * can be undone while nothing has happened since.
 *
 * Every step is in the studio's audit log. Raw rows are deleted 30 days after the move is verified;
 * a shared password is encrypted and deleted after the move (7 days at most).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { schemas } from "@studio/shared";
import { z } from "zod";
import { migrationFiles, migrationJobs, organizations } from "../../db/schema.js";
import type { DbOrTx } from "../../db/client.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { decryptSecret, encryptSecret } from "../../lib/secrets.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePlatform } from "../platform/routes.js";
import { migrate, runMigration, undoMigration, verificationSample, type Report } from "./engine.js";
import { EXPORT_TIPS, FIELD_LABELS, FIELDS, KIND_LABELS, SOURCE_PLATFORMS, detectKind, findHeaderRow, mapHeaders, type Kind } from "./fields.js";
import { readFile, sha256 } from "./parse.js";

type Job = typeof migrationJobs.$inferSelect;
const UPLOAD_LIMIT = 30 * 1024 * 1024;
const MAX_ROWS = 200_000;
const DAY = 86_400_000;
const OPEN = ["intake", "submitted", "files", "checked", "imported"] as const;

/** The steps, in plain words, for both sides. */
export const MIGRATION_STEPS = [
  { status: "intake", label: "Form started" },
  { status: "submitted", label: "Form sent: we're getting your data" },
  { status: "files", label: "Data received: we're checking it" },
  { status: "checked", label: "Checked: ready to move" },
  { status: "imported", label: "Moved: we're double-checking a sample" },
  { status: "verified", label: "Done and verified" },
] as const;

export async function currentJob(db: DbOrTx, orgId: string) {
  const [j] = await db.select().from(migrationJobs).where(and(eq(migrationJobs.orgId, orgId), inArray(migrationJobs.status, [...OPEN, "verified"]))).orderBy(desc(migrationJobs.createdAt)).limit(1);
  return j ?? null;
}

async function loadJob(db: DbOrTx, orgId: string, jobId: string) {
  const [j] = await db.select().from(migrationJobs).where(and(eq(migrationJobs.id, jobId), eq(migrationJobs.orgId, orgId)));
  if (!j) throw notFound("move");
  return j;
}

/** A short, plain summary of a report for the studio. */
function summarise(r: Report | null) {
  if (!r) return null;
  const t = r.totals;
  return {
    clients: (t.clients?.new ?? 0) + (t.clients?.["already had an account"] ?? 0) + (t.clients?.["already a client here"] ?? 0),
    packs: t.packages?.moved ?? 0,
    classesLeft: t.packages?.["classes left"] ?? 0,
    memberships: t.memberships?.moved ?? 0,
    bookings: t.bookings?.moved ?? 0,
    creditCents: t.credit?.cents ?? 0,
    notMoved: r.accounted.skipped,
  };
}

/** Read an uploaded file into one row per sheet, detected and mapped. */
async function addFiles(tx: DbOrTx, job: Job, input: { filename: string; data: string }, by: string | null) {
  const buf = Buffer.from(input.data.replace(/^data:[^,]*,/, ""), "base64");
  if (buf.length > 20 * 1024 * 1024) throw badRequest("file_too_big", "Files can be up to 20 MB. Split bigger exports by date or export as CSV.");
  const hash = sha256(buf);
  const [dupe] = await tx.select({ id: migrationFiles.id }).from(migrationFiles).where(and(eq(migrationFiles.jobId, job.id), eq(migrationFiles.sha256, hash)));
  if (dupe) throw conflict("same_file", `${input.filename} has already been added.`);
  const sheets = await readFile(input.filename, buf);
  const out = [];
  for (const s of sheets) {
    if (s.rows.length > MAX_ROWS) throw badRequest("file_too_big", `${input.filename} has more than ${MAX_ROWS.toLocaleString("en")} rows. Split it by date and upload the parts.`);
    const headerRow = findHeaderRow(s.rows);
    const headers = (s.rows[headerRow] ?? []).map((h) => h.trim());
    const kind = detectKind(headers, `${input.filename} ${s.sheet ?? ""}`);
    const mapping = mapHeaders(kind, headers);
    const [f] = await tx.insert(migrationFiles).values({ jobId: job.id, orgId: job.orgId, filename: input.filename, format: s.format, sheet: s.sheet, kind, kindDetected: kind, headerRow, headers, mapping, rows: s.rows, rowCount: Math.max(0, s.rows.length - headerRow - 1), sha256: sheets.length > 1 ? `${hash}:${s.sheet}` : hash, uploadedBy: by }).returning();
    out.push(f!);
  }
  if (["intake", "submitted"].includes(job.status)) await tx.update(migrationJobs).set({ status: "files" }).where(eq(migrationJobs.id, job.id));
  // Anything checked before no longer counts.
  if (job.status === "checked") await tx.update(migrationJobs).set({ status: "files", checkedAt: null }).where(eq(migrationJobs.id, job.id));
  await audit(tx, { orgId: job.orgId, actorId: by, action: "migration.file_added", entityType: "migration_job", entityId: job.id, details: { filename: input.filename, sheets: out.map((f) => ({ sheet: f.sheet, kind: f.kind, rows: f.rowCount })) } });
  return out;
}

/** How a file was read, for our staff: kind, columns matched, a few rows to eyeball. */
function fileView(f: typeof migrationFiles.$inferSelect) {
  const fields = f.kind === "ignore" ? {} : FIELDS[f.kind as Exclude<Kind, "ignore">];
  const used = new Set(Object.values(f.mapping));
  return {
    id: f.id, filename: f.filename, sheet: f.sheet, format: f.format, kind: f.kind, kindLabel: KIND_LABELS[f.kind as Kind] ?? f.kind, kindDetected: f.kindDetected,
    headerRow: f.headerRow + 1, headers: f.headers, rows: f.rowCount, purged: !!f.purgedAt,
    fields: Object.keys(fields).map((k) => ({ field: k, label: FIELD_LABELS[k] ?? k, column: f.mapping[k] ?? null, header: f.mapping[k] !== undefined ? f.headers[f.mapping[k]!] ?? null : null })),
    unmappedColumns: f.headers.map((h, i) => ({ h, i })).filter(({ h, i }) => h && !used.has(i)).map(({ h }) => h),
    preview: (f.rows ?? []).slice(f.headerRow + 1, f.headerRow + 6),
  };
}

// --- The welcome form's answers ---------------------------------------------------------------------
// The studio fills the form in the app on the owner's first sign-in (modules/welcome); our team can
// also fill it in with them on a call. Both save here; sending (and applying) is in modules/welcome.

type IntakeInput = z.infer<typeof schemas.migrationIntake>;

/** Save answers (a draft: nothing is applied). `by` is who saved them, for the audit log. */
export async function saveIntake(tx: DbOrTx, job: Job, input: IntakeInput) {
  if (!["intake", "submitted", "files", "checked", "imported", "verified"].includes(job.status)) throw conflict("migration_started", "This move was undone. Start a new one.");
  const { accessPassword, ...answers } = input;
  const intake = { ...(job.intake as Record<string, unknown>), ...Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)) };
  const set: Partial<typeof migrationJobs.$inferInsert> = { intake, sourcePlatform: (intake.oldPlatform as string) || job.sourcePlatform, dateOrder: intake.dateFormat && intake.dateFormat !== "unsure" ? (intake.dateFormat as "dmy" | "mdy" | "ymd") : job.dateOrder };
  if (accessPassword) {
    set.accessSecretEnc = encryptSecret(accessPassword);
    set.accessDeleteAfter = new Date(Date.now() + 7 * DAY);
  }
  if (intake.access && intake.access !== "password") { set.accessSecretEnc = null; set.accessDeleteAfter = null; }
  const [updated] = await tx.update(migrationJobs).set(set).where(eq(migrationJobs.id, job.id)).returning();
  return updated!;
}
export { addFiles, summarise };

// --- Our side (HQ) -------------------------------------------------------------------------------------

/** Registered inside platformRoutes, so the HQ sign-in check applies. */
export async function platformMigrationRoutes(app: FastifyInstance) {
  const { db } = app;
  const hq = { config: { public: true } } as const;
  const studioParam = schemas.orgIdParam;
  const job = (req: FastifyRequest) => parse(schemas.migrationIdParam, req.params);

  /** The queue: every move in progress, oldest first, with what it's waiting on. */
  app.get("/platform/migrations", hq, async (req) => {
    requirePlatform(req, "view");
    const rows = await db.select({ id: migrationJobs.id, orgId: migrationJobs.orgId, studio: organizations.name, status: migrationJobs.status, sourcePlatform: migrationJobs.sourcePlatform, intake: migrationJobs.intake, lastCheck: migrationJobs.lastCheck, createdAt: migrationJobs.createdAt, importedAt: migrationJobs.importedAt }).from(migrationJobs).innerJoin(organizations, eq(organizations.id, migrationJobs.orgId)).where(ne(migrationJobs.status, "undone")).orderBy(migrationJobs.createdAt).limit(200);
    const next: Record<string, string> = { intake: "Studio is filling in the form", submitted: "Get the data out of the old system", files: "Check the files", checked: "Import", imported: "Compare a sample and verify", verified: "Done" };
    return {
      migrations: rows.map((r) => {
        const check = r.lastCheck as unknown as Report | null;
        const intake = r.intake as Record<string, unknown>;
        return { id: r.id, orgId: r.orgId, studio: r.studio, status: r.status, next: next[r.status], sourcePlatform: r.sourcePlatform, switchDate: intake.switchDate ?? null, access: intake.access ?? null, blocking: check?.blocking ?? null, warnings: check?.warnings ?? null, createdAt: r.createdAt, importedAt: r.importedAt };
      }),
    };
  });

  app.post("/platform/studios/:orgId/migrations", hq, async (req, reply) => {
    requirePlatform(req, "migrations");
    const { orgId } = parse(studioParam, req.params);
    const out = await inTx(app, async (tx) => {
      const [org] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId));
      if (!org) throw notFound("studio");
      const open = await currentJob(tx, orgId);
      if (open && open.status !== "verified") return { id: open.id, status: open.status, existing: true };
      const [j] = await tx.insert(migrationJobs).values({ orgId, createdBy: req.platform.userId }).returning();
      await audit(tx, { orgId, actorId: req.platform.userId, action: "migration.started", entityType: "migration_job", entityId: j!.id, details: { by: "hq" } });
      return { id: j!.id, status: j!.status, existing: false };
    });
    reply.code(out.existing ? 200 : 201);
    return out;
  });

  app.get("/platform/studios/:orgId/migrations/:jobId", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const j = await loadJob(db, orgId, jobId);
    const files = await db.select().from(migrationFiles).where(eq(migrationFiles.jobId, j.id)).orderBy(migrationFiles.createdAt);
    const { accessPassword: _p, ...intake } = j.intake as Record<string, unknown>;
    return {
      job: { id: j.id, orgId: j.orgId, status: j.status, sourcePlatform: j.sourcePlatform, dateOrder: j.dateOrder, passwordSaved: !!j.accessSecretEnc, passwordDeletedBy: j.accessDeleteAfter, checkedAt: j.checkedAt, importedAt: j.importedAt, verifiedAt: j.verifiedAt, undoneAt: j.undoneAt },
      form: { sentAt: j.formSubmittedAt, updatedAt: j.formUpdatedAt },
      intake,
      steps: MIGRATION_STEPS,
      exportTips: EXPORT_TIPS[j.sourcePlatform ?? "Other"] ?? EXPORT_TIPS.Other,
      files: files.map(fileView),
      lastCheck: j.lastCheck,
    };
  });

  app.patch("/platform/studios/:orgId/migrations/:jobId", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const input = parse(schemas.migrationJobUpdate, req.body ?? {});
    const j = await loadJob(db, orgId, jobId);
    if (["imported", "verified", "undone"].includes(j.status)) throw conflict("migration_done", "This move has already been imported.");
    const [u] = await db.update(migrationJobs).set({ ...(input.sourcePlatform !== undefined ? { sourcePlatform: input.sourcePlatform } : {}), ...(input.dateOrder !== undefined ? { dateOrder: input.dateOrder } : {}), ...(j.status === "checked" ? { status: "files" as const, checkedAt: null } : {}) }).where(eq(migrationJobs.id, j.id)).returning();
    return { id: u!.id, sourcePlatform: u!.sourcePlatform, dateOrder: u!.dateOrder, status: u!.status };
  });

  /** Fill in (or correct) the moving form on the studio's behalf, for example on the kick-off call. */
  app.put("/platform/studios/:orgId/migrations/:jobId/intake", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const input = parse(schemas.migrationIntake, req.body ?? {});
    return inTx(app, async (tx) => {
      const u = await saveIntake(tx, await loadJob(tx, orgId, jobId), input);
      await audit(tx, { orgId, actorId: req.platform.userId, action: "migration.answers_saved", entityType: "migration_job", entityId: u.id, details: { by: "hq" } });
      const { accessPassword: _p, ...intake } = u.intake as Record<string, unknown>;
      return { id: u.id, status: u.status, intake, passwordSaved: !!u.accessSecretEnc };
    });
  });

  /** The temporary password the studio shared, to sign in to their old system. Logged. */
  app.post("/platform/studios/:orgId/migrations/:jobId/access", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const j = await loadJob(db, orgId, jobId);
    if (!j.accessSecretEnc) throw notFound("saved password");
    await audit(db, { orgId, actorId: req.platform.userId, action: "migration.password_viewed", entityType: "migration_job", entityId: j.id, details: { by: "hq" } });
    const intake = j.intake as Record<string, unknown>;
    return { login: intake.accessLogin ?? null, password: decryptSecret(j.accessSecretEnc), deletedBy: j.accessDeleteAfter, notes: intake.accessNotes ?? null };
  });

  app.post("/platform/studios/:orgId/migrations/:jobId/files", { ...hq, bodyLimit: UPLOAD_LIMIT }, async (req, reply) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const input = parse(schemas.migrationUpload, req.body);
    const out = await inTx(app, async (tx) => {
      const j = await loadJob(tx, orgId, jobId);
      if (["imported", "verified", "undone"].includes(j.status)) throw conflict("migration_done", "This move has already been imported. Start a new one for more files.");
      return { files: (await addFiles(tx, j, input, req.platform.userId)).map(fileView) };
    });
    reply.code(201);
    return out;
  });

  /** Correct how a file was read: its kind, which column is which, or where the headers are. */
  app.patch("/platform/studios/:orgId/migrations/:jobId/files/:fileId", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId, fileId } = parse(schemas.migrationFileParam, req.params);
    const input = parse(schemas.migrationFileUpdate, req.body ?? {});
    return inTx(app, async (tx) => {
      const j = await loadJob(tx, orgId, jobId);
      if (["imported", "verified", "undone"].includes(j.status)) throw conflict("migration_done", "This move has already been imported.");
      const [f] = await tx.select().from(migrationFiles).where(and(eq(migrationFiles.id, fileId), eq(migrationFiles.jobId, j.id)));
      if (!f) throw notFound("file");
      if (!f.rows) throw conflict("file_purged", "This file's rows have been deleted.");
      const headerRow = input.headerRow ?? f.headerRow;
      const headers = headerRow !== f.headerRow ? (f.rows[headerRow] ?? []).map((h) => h.trim()) : f.headers;
      const kind = input.kind ?? f.kind;
      let mapping = kind !== f.kind || headerRow !== f.headerRow ? (kind === "ignore" ? {} : mapHeaders(kind as Exclude<Kind, "ignore">, headers)) : { ...f.mapping };
      if (input.mapping) {
        const known = kind === "ignore" ? {} : FIELDS[kind as Exclude<Kind, "ignore">];
        for (const [field, col] of Object.entries(input.mapping)) {
          if (!(field in known)) throw badRequest("unknown_field", `“${field}” isn't something we read from a ${KIND_LABELS[kind as Kind]} file.`);
          if (col === null) delete mapping[field];
          else {
            if (col >= headers.length) throw badRequest("no_such_column", `There's no column ${col + 1} in ${f.filename}.`);
            for (const [k, v] of Object.entries(mapping)) if (v === col) delete mapping[k]; // a column means one thing
            mapping[field] = col;
          }
        }
      }
      mapping = Object.fromEntries(Object.entries(mapping));
      const [u] = await tx.update(migrationFiles).set({ kind, headerRow, headers, mapping, rowCount: Math.max(0, f.rows.length - headerRow - 1) }).where(eq(migrationFiles.id, f.id)).returning();
      if (j.status === "checked") await tx.update(migrationJobs).set({ status: "files", checkedAt: null }).where(eq(migrationJobs.id, j.id));
      return fileView(u!);
    });
  });

  app.delete("/platform/studios/:orgId/migrations/:jobId/files/:fileId", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId, fileId } = parse(schemas.migrationFileParam, req.params);
    return inTx(app, async (tx) => {
      const j = await loadJob(tx, orgId, jobId);
      if (["imported", "verified"].includes(j.status)) throw conflict("migration_done", "This move has been imported; its files are kept as the record of what was moved.");
      const [f] = await tx.delete(migrationFiles).where(and(eq(migrationFiles.id, fileId), eq(migrationFiles.jobId, j.id))).returning({ id: migrationFiles.id, filename: migrationFiles.filename });
      if (!f) throw notFound("file");
      if (j.status === "checked") await tx.update(migrationJobs).set({ status: "files", checkedAt: null }).where(eq(migrationJobs.id, j.id));
      await audit(tx, { orgId, actorId: req.platform.userId, action: "migration.file_removed", entityType: "migration_job", entityId: j.id, details: { filename: f.filename } });
      return { deleted: true };
    });
  });

  /** The check: a full rehearsal of the import that changes nothing, with every problem listed. */
  app.post("/platform/studios/:orgId/migrations/:jobId/check", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const j = await loadJob(db, orgId, jobId);
    if (["imported", "verified", "undone"].includes(j.status)) throw conflict("migration_done", "This move has already been imported.");
    const report = await runMigration(db, j.id, { apply: false, actorId: req.platform.userId });
    await db.update(migrationJobs).set({ lastCheck: report as unknown as Record<string, unknown>, checkedAt: new Date(), status: report.ready ? "checked" : "files" }).where(eq(migrationJobs.id, j.id));
    return report;
  });

  /** The import. Blocked while the check finds blocking problems; asks once to accept warnings. */
  app.post("/platform/studios/:orgId/migrations/:jobId/import", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const { acknowledge } = parse(schemas.migrationImport, req.body ?? {});
    const j = await loadJob(db, orgId, jobId);
    if (j.status !== "checked") throw conflict(j.status === "imported" || j.status === "verified" ? "migration_done" : "not_checked", j.status === "imported" || j.status === "verified" ? "This move has already been imported." : "Run the check first (and again after any change).");
    return withFlags(app, acknowledge, async (tx, flags) => {
      const report = await migrate(tx, j.id, "import", req.platform.userId, new Date());
      if (!report.ready) throw badRequest("migration_blocked", `The data changed since the check and now has ${report.blocking} blocking ${report.blocking === 1 ? "problem" : "problems"}. Run the check again.`);
      if (report.needsAcknowledging.length) flags.confirm({ code: "migration_warnings", message: `Import anyway? ${report.needsAcknowledging.join(". ")}.`, details: { issueSummary: report.issueSummary.filter((i) => i.level !== "info") } });
      await tx.update(migrationJobs).set({ status: "imported", importedAt: new Date(), lastCheck: report as unknown as Record<string, unknown>, accessSecretEnc: null }).where(eq(migrationJobs.id, j.id));
      await audit(tx, { orgId, actorId: req.platform.userId, action: "migration.imported", entityType: "migration_job", entityId: j.id, details: { by: "hq", totals: report.totals, accounted: report.accounted, warnings: report.warnings } });
      return { report };
    });
  });

  /** A random sample of moved clients next to their rows in the old files, to compare by eye. */
  app.get("/platform/studios/:orgId/migrations/:jobId/sample", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const j = await loadJob(db, orgId, jobId);
    if (!["imported", "verified"].includes(j.status)) throw conflict("not_imported", "Import first, then compare a sample.");
    return { sample: await verificationSample(db, j, 10) };
  });

  app.post("/platform/studios/:orgId/migrations/:jobId/verify", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    const input = parse(schemas.migrationVerify, req.body ?? {});
    return inTx(app, async (tx) => {
      const j = await loadJob(tx, orgId, jobId);
      if (j.status !== "imported") throw conflict("not_imported", j.status === "verified" ? "This move is already verified." : "Import first, then verify.");
      await tx.update(migrationJobs).set({ status: "verified", verifiedAt: new Date(), accessSecretEnc: null }).where(eq(migrationJobs.id, j.id));
      // The move is done: the studio's dashboard replaces the welcome page.
      const [org] = await tx.select({ lifecycle: organizations.lifecycle }).from(organizations).where(eq(organizations.id, orgId));
      if (org?.lifecycle === "onboarding") {
        await tx.update(organizations).set({ lifecycle: "live" }).where(eq(organizations.id, orgId));
        await audit(tx, { orgId, actorId: req.platform.userId, action: "studio.lifecycle", entityType: "organization", entityId: orgId, details: { from: "onboarding", to: "live", by: "hq", reason: "data move verified" } });
      }
      await audit(tx, { orgId, actorId: req.platform.userId, action: "migration.verified", entityType: "migration_job", entityId: j.id, details: { by: "hq", checked: input.checked, note: input.note } });
      return { status: "verified", studioLive: org?.lifecycle === "onboarding" || org?.lifecycle === "live", rowsDeletedAfter: new Date(Date.now() + 30 * DAY) };
    });
  });

  app.post("/platform/studios/:orgId/migrations/:jobId/undo", hq, async (req) => {
    requirePlatform(req, "migrations");
    const { orgId, jobId } = job(req);
    return inTx(app, async (tx) => {
      const j = await loadJob(tx, orgId, jobId);
      if (j.status !== "imported") throw conflict("not_imported", j.status === "verified" ? "A verified move can't be undone. Fix rows by hand instead." : "There's nothing imported to undo.");
      const out = await undoMigration(tx, j, req.platform.userId);
      await tx.update(migrationJobs).set({ status: "undone", undoneAt: new Date() }).where(eq(migrationJobs.id, j.id));
      await audit(tx, { orgId, actorId: req.platform.userId, action: "migration.undone", entityType: "migration_job", entityId: j.id, details: { by: "hq", removed: out.removed } });
      return { status: "undone", ...out };
    });
  });
}
