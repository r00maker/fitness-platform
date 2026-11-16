/**
 * The welcome page: what the studio's owner (and admins) see on first signing in, until their
 * studio is ready. One form to get to know the studio and move its data:
 *
 *  - About the business: trading and legal name, UEN, GST, address, phone, website, Instagram.
 *  - Setting up: locations and rooms, the classes they teach, the packages they sell, the team.
 *  - Moving the data: the old system (or nothing to move), the switch date, rough numbers, how
 *    dates are written, how we get the data, and their OK.
 *
 * Answers save as a draft. **Send to our team** checks the form is complete and fills the studio
 * in from it: business details, locations and rooms, class types, packages and the team (added
 * without invites; they're invited when the studio opens). **Send updates** does the same again
 * after a change, and tells our team what changed. Nothing is ever deleted by the form.
 *
 * The studio's dashboard appears once the studio is live: when our team verifies the data move
 * (or, with nothing to move, sets the studio live).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { CLASS_COLORS, PLAN_INFO, schemas } from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { classTypes, locations, memberships, migrationFiles, migrationJobs, organizations, packagePlans, rooms, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { addFiles, currentJob, MIGRATION_STEPS, saveIntake, summarise } from "../migration/routes.js";
import { EXPORT_TIPS, KIND_LABELS, SOURCE_PLATFORMS, type Kind } from "../migration/fields.js";
import type { Report } from "../migration/engine.js";
import { checkAdminSeats } from "../settings/plans.js";
import { getOrg } from "../sessions/context.js";

type Job = typeof migrationJobs.$inferSelect;
type Form = z.infer<typeof schemas.migrationIntake>;
const UPLOAD_LIMIT = 30 * 1024 * 1024;

/** The form's sections, for "what changed since you sent it". */
const SECTIONS: Record<string, (keyof Form)[]> = {
  "About your business": ["tradingName", "legalName", "uen", "gstRegistered", "gstNumber", "address", "phone", "website", "instagram"],
  Locations: ["locations"],
  "What you teach": ["classTypeList"],
  "What you sell": ["packages"],
  "Your team": ["team"],
  "Moving your data": ["nothingToMove", "oldPlatform", "switchDate", "activeClients", "activeMemberships", "activePackages", "dateFormat", "includeInactive", "access", "accessLogin", "accessNotes", "consent"],
  "Who we talk to": ["contactName", "contactPhone", "notes"],
};
function changedSections(now: Record<string, unknown>, sent: Record<string, unknown> | null) {
  if (!sent) return [];
  return Object.entries(SECTIONS).filter(([, keys]) => keys.some((k) => JSON.stringify(now[k] ?? null) !== JSON.stringify(sent[k] ?? null))).map(([name]) => name);
}

/** What's missing before the form can be sent, in plain words. */
function missingFor(f: Record<string, unknown>, sgd: boolean, passwordSaved: boolean) {
  const uen = String(f.uen ?? "");
  const out = [
    !f.tradingName && "your studio's name",
    !f.legalName && "the registered business name",
    sgd && !uen && "your UEN",
    sgd && uen && !schemas.UEN_PATTERN.test(uen) && "a UEN in the right format (like 201912345K or 53412345D)",
    f.gstRegistered === true && !f.gstNumber && "your GST registration number",
    !f.address && "your registered address",
    !(Array.isArray(f.locations) && f.locations.length) && "at least one location",
    !f.switchDate && (f.nothingToMove ? "when you'd like to open" : "when you'd like to switch"),
    !f.nothingToMove && !f.oldPlatform && "which system you use now (or tick nothing to move)",
    !f.nothingToMove && !f.access && "how we get your data",
    !f.nothingToMove && f.access === "password" && !f.accessLogin && "the login to use",
    !f.nothingToMove && f.access === "password" && !passwordSaved && "the temporary password",
    !f.nothingToMove && f.consent !== true && "your OK for us to move your clients' details",
  ].filter(Boolean) as string[];
  return out;
}

/**
 * Fill the studio in from the form. Matching is by name (ignoring case), so sending again
 * updates what's there and adds what's new; nothing is removed.
 */
export async function applyWelcome(tx: DbOrTx, orgId: string, f: Form, actorId: string) {
  const org = await getOrg(tx, orgId);
  const done: Record<string, number> = { locationsAdded: 0, locationsUpdated: 0, roomsAdded: 0, classTypesAdded: 0, classTypesUpdated: 0, packagesAdded: 0, packagesUpdated: 0, teamAdded: 0 };
  const notes: string[] = [];
  const lower = (s: string) => s.trim().toLowerCase();

  await tx.update(organizations).set({
    ...(f.tradingName ? { name: f.tradingName } : {}),
    legalName: f.legalName ?? org.legalName, uen: f.uen ?? org.uen,
    gstNumber: f.gstRegistered ? (f.gstNumber ?? null) : f.gstRegistered === false ? null : org.gstNumber,
    address: f.address ?? org.address, phone: f.phone ?? org.phone, website: f.website ?? org.website, instagram: f.instagram ?? org.instagram,
  }).where(eq(organizations.id, orgId));

  // Locations and rooms. The first location we made when adding the studio is renamed to the
  // studio's first one, as long as nothing is scheduled there yet.
  const existing = await tx.select().from(locations).where(eq(locations.orgId, orgId));
  for (const [i, l] of (f.locations ?? []).entries()) {
    let loc = existing.find((x) => lower(x.name) === lower(l.name));
    if (!loc && i === 0 && existing.length === 1 && !(f.locations ?? []).some((x) => lower(x.name) === lower(existing[0]!.name))) {
      const [{ n } = { n: 0 }] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from class_sessions where location_id = ${existing[0]!.id}`).then((r) => r.rows);
      if (!n) {
        [loc] = await tx.update(locations).set({ name: l.name, address: l.address ?? existing[0]!.address }).where(eq(locations.id, existing[0]!.id)).returning();
        existing[0] = loc!;
        done.locationsUpdated!++;
      }
    }
    if (!loc) {
      [loc] = await tx.insert(locations).values({ orgId, name: l.name, timezone: org.timezone, address: l.address ?? null }).returning();
      existing.push(loc!);
      done.locationsAdded!++;
    } else if (l.address && l.address !== loc.address) {
      await tx.update(locations).set({ address: l.address }).where(eq(locations.id, loc.id));
      if (!done.locationsUpdated) done.locationsUpdated = 1;
    }
    const have = await tx.select({ name: rooms.name }).from(rooms).where(eq(rooms.locationId, loc!.id));
    for (const r of l.rooms) {
      if (have.some((x) => lower(x.name) === lower(r))) continue;
      await tx.insert(rooms).values({ orgId, locationId: loc!.id, name: r });
      done.roomsAdded!++;
    }
  }

  // What they teach.
  const types = await tx.select().from(classTypes).where(eq(classTypes.orgId, orgId));
  for (const c of f.classTypeList ?? []) {
    const t = types.find((x) => lower(x.name) === lower(c.name));
    if (t) {
      if (c.minutes && c.minutes !== t.defaultDurationMinutes) { await tx.update(classTypes).set({ defaultDurationMinutes: c.minutes }).where(eq(classTypes.id, t.id)); done.classTypesUpdated!++; }
      continue;
    }
    const [n] = await tx.insert(classTypes).values({ orgId, name: c.name, color: CLASS_COLORS[types.length % CLASS_COLORS.length]!.hex, defaultDurationMinutes: c.minutes ?? null }).returning();
    types.push(n!);
    done.classTypesAdded!++;
  }

  // What they sell (the data move matches clients' packs to these by name).
  const plans = await tx.select().from(packagePlans).where(eq(packagePlans.orgId, orgId));
  for (const p of f.packages ?? []) {
    const unlimited = !p.classes;
    const vals = {
      kind: (unlimited ? "unlimited" : "credits") as "unlimited" | "credits", credits: unlimited ? null : p.classes!, priceCents: Math.round((p.price ?? 0) * 100),
      billing: (p.type === "membership" ? "recurring" : "one_time") as "recurring" | "one_time",
      validityValue: p.validityValue ?? (p.type === "membership" ? 1 : null), validityUnit: p.validityUnit ?? (p.type === "membership" || p.validityValue ? "months" : null),
    };
    const ex = plans.find((x) => lower(x.name) === lower(p.name));
    if (ex) { await tx.update(packagePlans).set(vals).where(eq(packagePlans.id, ex.id)); done.packagesUpdated!++; }
    else { const [n] = await tx.insert(packagePlans).values({ orgId, name: p.name, ...vals, sortOrder: plans.length }).returning(); plans.push(n!); done.packagesAdded!++; }
  }

  // The team: added now, invited when the studio opens.
  for (const m of f.team ?? []) {
    const email = m.email.trim().toLowerCase();
    let [u] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    const [already] = u ? await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, u.id))) : [];
    if (already) continue;
    let role = m.role;
    if (role === "admin") {
      try { await checkAdminSeats(tx, org); } catch { role = "front_desk"; notes.push(`${m.firstName} was added as Front of House: your ${PLAN_INFO[org.plan].label} plan's admin accounts are all used.`); }
    }
    u ??= (await tx.insert(users).values({ email, firstName: m.firstName, lastName: m.lastName }).returning())[0];
    await tx.insert(memberships).values({ orgId, userId: u!.id, role });
    done.teamAdded!++;
  }
  await audit(tx, { orgId, actorId, action: "studio.welcome_applied", entityType: "organization", entityId: orgId, details: { ...done, notes } });
  return { done, notes };
}

async function jobFor(db: DbOrTx, orgId: string, by: string) {
  const j = await currentJob(db, orgId);
  if (j) return j;
  const [n] = await db.insert(migrationJobs).values({ orgId, createdBy: by }).returning();
  return n!;
}

/** Everything the welcome page shows. */
async function view(db: DbOrTx, orgId: string, job: Job) {
  const org = await getOrg(db, orgId);
  const files = await db.select({ id: migrationFiles.id, filename: migrationFiles.filename, sheet: migrationFiles.sheet, kind: migrationFiles.kind, rows: migrationFiles.rowCount }).from(migrationFiles).where(eq(migrationFiles.jobId, job.id)).orderBy(migrationFiles.createdAt);
  const { accessPassword: _p, ...form } = job.intake as Record<string, unknown>;
  // Sensible starting answers from what we already know.
  const locs = await db.select({ name: locations.name, address: locations.address }).from(locations).where(eq(locations.orgId, orgId)).orderBy(locations.createdAt);
  form.tradingName ??= org.name;
  form.locations ??= locs.map((l) => ({ name: l.name, address: l.address ?? "", rooms: [] }));
  const step = MIGRATION_STEPS.findIndex((x) => x.status === job.status);
  const sent = !!job.formSubmittedAt;
  return {
    studio: { name: org.name, plan: PLAN_INFO[org.plan].label, lifecycle: org.lifecycle, currency: org.currency, needsUen: org.currency === "SGD" },
    /** While true, the app shows the welcome page instead of the dashboard. */
    showWelcome: org.lifecycle === "onboarding",
    form,
    passwordSaved: !!job.accessSecretEnc,
    sent: sent ? { at: job.formSubmittedAt, updatedAt: job.formUpdatedAt } : null,
    unsentChanges: changedSections(form, job.sentIntake),
    missing: missingFor(form, org.currency === "SGD", !!job.accessSecretEnc),
    progress: { status: job.status, step: step + 1, steps: MIGRATION_STEPS.map((x) => x.label), nothingToMove: !!form.nothingToMove, summary: ["imported", "verified"].includes(job.status) ? summarise(job.lastCheck as unknown as Report | null) : null },
    files: files.map((f) => ({ ...f, kindLabel: KIND_LABELS[f.kind as Kind] ?? f.kind })),
    platforms: SOURCE_PLATFORMS,
    exportTips: EXPORT_TIPS[(form.oldPlatform as string) ?? "Other"] ?? EXPORT_TIPS.Other,
  };
}

export async function welcomeRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get("/welcome", async (req) => {
    requirePermission(req, "manageSettings");
    return view(db, req.auth.orgId, await jobFor(db, req.auth.orgId, req.auth.userId));
  });

  /** Save answers as you go (nothing is applied until it's sent). */
  app.put("/welcome", async (req) => {
    requirePermission(req, "manageSettings");
    const input = parse(schemas.migrationIntake, req.body ?? {});
    return inTx(app, async (tx) => view(tx, req.auth.orgId, await saveIntake(tx, await jobFor(tx, req.auth.orgId, req.auth.userId), input)));
  });

  /** Send to our team: check it's complete, then fill the studio in from it. Sending again later is "Send updates". */
  const send = (mode: "send" | "update") => async (req: FastifyRequest) => {
    requirePermission(req, "manageSettings");
    const input = parse(schemas.migrationIntake, req.body ?? {});
    return inTx(app, async (tx) => {
      let job = await jobFor(tx, req.auth.orgId, req.auth.userId);
      if (mode === "send" && job.formSubmittedAt) throw conflict("already_sent", "You've already sent this. Change anything and choose Send updates.");
      if (mode === "update" && !job.formSubmittedAt) throw conflict("not_sent", "Send the form first.");
      job = await saveIntake(tx, job, input);
      const org = await getOrg(tx, req.auth.orgId);
      const form = job.intake as Record<string, unknown>;
      const missing = missingFor(form, org.currency === "SGD", !!job.accessSecretEnc);
      if (missing.length) throw badRequest("form_incomplete", `Before sending, add ${missing.join(", ")}.`);
      const changed = changedSections(form, job.sentIntake);
      if (mode === "update" && !changed.length) throw conflict("nothing_changed", "Nothing has changed since you last sent it.");
      const applied = await applyWelcome(tx, req.auth.orgId, parse(schemas.migrationIntake, form), req.auth.userId);
      const { accessPassword: _p, ...snapshot } = form;
      const now = new Date();
      await tx.update(migrationJobs).set({
        sentIntake: snapshot, ...(mode === "send" ? { formSubmittedAt: now } : { formUpdatedAt: now }),
        ...(job.status === "intake" ? { status: "submitted" as const } : {}),
      }).where(eq(migrationJobs.id, job.id));
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: mode === "send" ? "studio.welcome_sent" : "studio.welcome_updated", entityType: "migration_job", entityId: job.id, details: { changed: mode === "send" ? Object.keys(SECTIONS) : changed, nothingToMove: !!form.nothingToMove, oldPlatform: form.oldPlatform } });
      const [fresh] = await tx.select().from(migrationJobs).where(eq(migrationJobs.id, job.id));
      return { ...(await view(tx, req.auth.orgId, fresh!)), setUp: applied.done, notes: applied.notes, changed: mode === "send" ? null : changed };
    });
  };
  app.post("/welcome/send", send("send"));
  app.post("/welcome/update", send("update"));

  /** Upload exports from the old system (JSON with the file as base64). */
  app.post("/welcome/files", { bodyLimit: UPLOAD_LIMIT }, async (req, reply) => {
    requirePermission(req, "manageSettings");
    const input = parse(schemas.migrationUpload, req.body);
    const out = await inTx(app, async (tx) => {
      const job = await jobFor(tx, req.auth.orgId, req.auth.userId);
      if (!["intake", "submitted", "files", "checked"].includes(job.status)) throw conflict("migration_started", "Your data has already been moved. Message us if there's more to add.");
      const files = await addFiles(tx, job, input, req.auth.userId);
      return { files: files.map((f) => ({ id: f.id, filename: f.filename, sheet: f.sheet, kind: f.kind, kindLabel: KIND_LABELS[f.kind as Kind], rows: f.rowCount })) };
    });
    reply.code(201);
    return out;
  });
}
