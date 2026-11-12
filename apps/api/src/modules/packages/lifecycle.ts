/**
 * Everything that happens to a package after it's sold:
 *  - its history (classes booked with it, and every change, in plain English);
 *  - extension requests (studio's choice: off, reviewed, or approved automatically up to a limit; optional fee);
 *  - rolling unused classes over to a new package;
 *  - recurring packages renewing each period, and being stopped;
 *  - editing a package type, for new sales, existing packages or both;
 *  - categories, archiving and deleting.
 */
import { and, asc, count, desc, eq, inArray, isNull, max, ne, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { ARCHIVE_SUGGEST_AFTER_DAYS, OPTION_LABELS, can, describePackage, type PlanEditScope } from "@studio/shared";
import type { Db, DbOrTx } from "../../db/client.js";
import {
  bookings,
  classSessions,
  classTypes,
  clientPackageMembers,
  clientPackages,
  fees,
  memberships,
  orders,
  organizations,
  packageCategories,
  packageExtensionRequests,
  packageLedger,
  packagePlans,
  users,
} from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import type { Flags } from "../../lib/flags.js";
import type { AuthContext } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { notify } from "../notifications/outbox.js";
import { getOrg, staffIds, userName } from "../sessions/context.js";
import { commitmentEnd, earlyCancelFee, expiryFrom, getPackage, lastDay, orgZone, packageState, periodsLeftInTerm, presentPackages, renewalEnd, type Pkg } from "./service.js";
import { assertFile } from "../files/routes.js";

type Org = typeof organizations.$inferSelect;
type Plan = typeof packagePlans.$inferSelect;
const isManager = (auth: AuthContext) => can(auth.role, "managePackages");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nice = (date: string | null) => (date ? DateTime.fromISO(date).toFormat("d LLL yyyy") : "");

async function assertCanSee(db: DbOrTx, auth: AuthContext, p: Pkg) {
  if (isManager(auth)) return;
  const [m] = await db.select().from(clientPackageMembers).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, auth.userId)));
  if (!m) throw notFound("package");
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
/**
 * A package's history, in two parts:
 *  - classes: each class booked with it, whether they came, and what happened to the class credit;
 *  - changes: everything else (bought, started, extended, adjusted by the studio, renewed…).
 * Clients see "the studio" for staff changes; admins see who did it.
 */
export async function packageHistory(db: DbOrTx, auth: AuthContext, id: string, now = new Date()) {
  const org = await getOrg(db, auth.orgId);
  const zone = orgZone(org);
  const p = await getPackage(db, auth.orgId, id);
  await assertCanSee(db, auth, p);
  const admin = isManager(auth);
  const ledger = await db
    .select({ l: packageLedger, first: users.firstName, last: users.lastName, role: memberships.role })
    .from(packageLedger)
    .leftJoin(users, eq(users.id, packageLedger.createdBy))
    .leftJoin(memberships, and(eq(memberships.userId, packageLedger.createdBy), eq(memberships.orgId, auth.orgId)))
    .where(eq(packageLedger.packageId, id))
    .orderBy(asc(packageLedger.createdAt));
  const bookingIds = [...new Set(ledger.map((x) => x.l.bookingId).filter((x): x is string => !!x))];
  const instructor = users;
  const classRows = await db
        .select({
          bookingId: bookings.id,
          clientId: bookings.clientId,
          status: bookings.status,
          attendance: bookings.attendance,
          startsAt: classSessions.startsAt,
          className: classTypes.name,
          sessionStatus: classSessions.status,
          instructorFirst: instructor.firstName,
          instructorLast: instructor.lastName,
        })
        .from(bookings)
        .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
        .innerJoin(classTypes, eq(classTypes.id, classSessions.classTypeId))
        .leftJoin(instructor, eq(instructor.id, classSessions.instructorId))
        .where(bookingIds.length ? or(eq(bookings.clientPackageId, id), inArray(bookings.id, bookingIds)) : eq(bookings.clientPackageId, id))
        .orderBy(desc(classSessions.startsAt));
  const names = new Map((await db.select({ id: users.id, f: users.firstName, l: users.lastName }).from(users).where(inArray(users.id, [...new Set(classRows.map((r) => r.clientId)), auth.userId]))).map((u) => [u.id, `${u.f} ${u.l}`]));

  const classes = classRows.map((r) => {
    const entries = ledger.filter((x) => x.l.bookingId === r.bookingId).map((x) => x.l.reason);
    const local = DateTime.fromJSDate(r.startsAt, { zone });
    const upcoming = r.startsAt > now && r.status === "confirmed";
    const status =
      r.status === "late_cancelled" ? "Late cancellation" : r.status === "cancelled" ? "Cancelled" : upcoming ? "Booked" : r.attendance === "present" ? "Attended" : r.attendance === "no_show" ? "No-show" : "Not marked yet";
    const credit =
      p.kind !== "credits"
        ? "Unlimited"
        : entries.includes("refunded")
          ? "Class given back (refund)"
          : entries.includes("returned")
            ? "Class given back"
            : r.status === "late_cancelled"
              ? "Class used (late cancellation)"
              : r.attendance === "no_show"
                ? "Class used (no-show)"
                : "1 class used";
    return {
      bookingId: r.bookingId,
      date: local.toISODate(),
      time: local.toFormat("h:mma").toLowerCase(),
      className: r.className,
      instructor: r.instructorFirst ? `${r.instructorFirst} ${r.instructorLast}` : null,
      // Shared packages: who booked it.
      person: r.clientId === auth.userId ? "You" : names.get(r.clientId) ?? null,
      status,
      credit,
      creditReturned: entries.includes("returned") || entries.includes("refunded"),
    };
  });

  const by = (x: (typeof ledger)[number]) => {
    if (!x.l.createdBy) return "Automatic";
    if (x.l.createdBy === auth.userId) return "You";
    const staff = x.role && x.role !== "client";
    if (staff) return admin ? `${x.first} ${x.last}` : "The studio";
    return `${x.first} ${x.last}`;
  };
  const d = (x: (typeof ledger)[number]) => (x.l.details ?? {}) as Record<string, unknown>;
  const changes = ledger
    .filter((x) => !["booked", "returned", "refunded"].includes(x.l.reason))
    .map((x) => {
      const det = d(x);
      const n = x.l.change;
      const title = {
        purchase: p.kind === "credits" ? `Bought: ${plural(n, "class", "classes")}` : "Bought",
        activated: `Started${det.validUntil ? `: valid until ${nice(det.validUntil as string)}` : ""}`,
        adjusted: `${n > 0 ? "+" : "−"}${plural(Math.abs(n), "class", "classes")} ${n > 0 ? "added" : "removed"}`,
        expiry_changed: det.field === "firstBookingBy" ? `First-booking deadline changed to ${nice(det.to as string)}` : `Expiry changed from ${nice(det.from as string)} to ${nice(det.to as string)}`,
        extended: `Extended by ${plural(det.days as number, "day")}, to ${nice(det.to as string)}`,
        rolled_over: n > 0 ? `+${plural(n, "class", "classes")} rolled over from ${det.otherName}` : `${plural(-n, "class", "classes")} rolled over to ${det.otherName}`,
        renewed: `Renewed: period ${det.period}${p.kind === "credits" ? `, ${plural(det.classes as number, "class", "classes")}${det.carried ? ` (${det.carried} carried over)` : ""}` : ""}`,
        cancelled: det.stoppedRenewing ? `${det.endedEarly ? "Ending early" : "Stopped renewing"}: ends ${nice(det.endsOn as string)}${det.fee ? ` (early cancellation fee ${det.fee})` : ""}` : "Cancelled",
        plan_updated: "Package rules updated by the studio",
        booked: "",
        returned: "",
        refunded: "",
      }[x.l.reason];
      const staffChange = ["adjusted", "expiry_changed", "cancelled", "plan_updated"].includes(x.l.reason) || (x.l.reason === "extended" && !!x.l.createdBy && by(x) !== "You");
      return {
        date: DateTime.fromJSDate(x.l.createdAt, { zone }).toISODate(),
        kind: x.l.reason,
        title,
        detail: x.l.reason === "plan_updated" ? ((det.summary as string) ?? null) : x.l.note,
        change: n,
        by: by(x),
        /** Changes made by the studio (for the "Changes by the studio" list). */
        byStudio: staffChange,
      };
    });
  const requests = await db.select().from(packageExtensionRequests).where(eq(packageExtensionRequests.packageId, id)).orderBy(desc(packageExtensionRequests.createdAt));
  const [shown] = await presentPackages(db, org, [p], auth.userId, now);
  return {
    ...shown,
    activatedOn: p.startedAt ? DateTime.fromJSDate(p.startedAt, { zone }).toISODate() : null,
    classes,
    changes,
    adjustmentsByStudio: changes.filter((c) => c.byStudio),
    extensionRequests: requests.map((r) => presentRequest(r, org)),
  };
}

// ---------------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------------
type Request = typeof packageExtensionRequests.$inferSelect;
function presentRequest(r: Request, org: Org) {
  return {
    id: r.id,
    days: r.days,
    reason: r.reason,
    attachmentUrl: r.attachmentFileId ? `/v1/files/${r.attachmentFileId}` : null,
    status: r.status,
    statusLabel: OPTION_LABELS.extensionStatus[r.status],
    autoApproved: r.autoApproved,
    daysGranted: r.daysGranted,
    fee: r.feeCents ? money(r.feeCents, org.currency) : null,
    decisionNote: r.decisionNote,
    requestedOn: r.createdAt,
    decidedOn: r.decidedAt,
  };
}

/** The extension fee for this many days under the studio's settings. */
export function extensionFee(org: Org, days: number): number {
  if (org.extensionFeeMode === "flat") return org.extensionFeeCents;
  if (org.extensionFeeMode === "per_week") return Math.ceil(days / 7) * org.extensionFeeCents;
  return 0;
}

/** What a client sees before asking: whether they can, the most days, whether a document is needed, and the fee. */
export function extensionPolicy(org: Org) {
  const fee = org.extensionFeeMode === "free" || !org.extensionFeeCents ? null : org.extensionFeeMode === "flat" ? `${money(org.extensionFeeCents, org.currency)} per extension` : `${money(org.extensionFeeCents, org.currency)} per week added`;
  return {
    allowed: org.extensionMode !== "off",
    maxDays: org.extensionMaxDays,
    attachment: org.extensionAttachment,
    fee,
    approvedAutomaticallyUpTo: org.extensionMode === "auto" ? org.extensionAutoDays : null,
    summary:
      org.extensionMode === "off"
        ? "Contact the studio if you need more time."
        : `Ask for up to ${plural(org.extensionMaxDays, "day")}. ${org.extensionMode === "auto" ? `Requests up to ${plural(org.extensionAutoDays, "day")} are approved straight away (once per package); longer ones are reviewed by the studio.` : "The studio reviews each request."}${fee ? ` Fee: ${fee}.` : ""}`,
  };
}

/** Extend a package by `days`: from its current end, or from today if it has already expired. */
async function extend(tx: DbOrTx, org: Org, p: Pkg, days: number, actorId: string | null, note: string, now: Date) {
  const zone = orgZone(org);
  const today = DateTime.fromJSDate(now, { zone }).startOf("day").toJSDate();
  const notStarted = !p.startedAt && p.startsOn === "first_booking";
  const current = notStarted ? p.activateBy : p.expiresAt;
  if (!current) throw badRequest("never_expires", "This package never expires, so it doesn't need extending.");
  const from = current > today ? current : today;
  const to = DateTime.fromJSDate(from, { zone }).plus({ days }).toJSDate();
  await tx.update(clientPackages).set(notStarted ? { activateBy: to } : { expiresAt: to }).where(eq(clientPackages.id, p.id));
  await tx.insert(packageLedger).values({
    orgId: org.id, packageId: p.id, change: 0, reason: "extended", note, createdBy: actorId,
    details: { days, from: lastDay(current, zone), to: lastDay(to, zone), field: notStarted ? "firstBookingBy" : "validUntil" },
  });
  return lastDay(to, zone)!;
}

async function decide(tx: DbOrTx, org: Org, r: Request, p: Pkg, input: { days: number; feeCents: number; note?: string }, actorId: string | null, auto: boolean, now: Date) {
  const to = await extend(tx, org, p, input.days, actorId, auto ? `Approved automatically: ${r.reason}` : input.note || r.reason, now);
  let feeId: string | null = null;
  if (input.feeCents > 0) {
    const [f] = await tx.insert(fees).values({ orgId: org.id, clientId: r.requestedBy, clientPackageId: p.id, type: "package_extension", amountCents: input.feeCents, currency: org.currency }).returning({ id: fees.id });
    feeId = f!.id;
  }
  const [u] = await tx
    .update(packageExtensionRequests)
    .set({ status: "approved", autoApproved: auto, daysGranted: input.days, feeCents: input.feeCents || null, decidedBy: actorId, decidedAt: now, decisionNote: input.note ?? null })
    .where(eq(packageExtensionRequests.id, r.id))
    .returning();
  await notify(tx, {
    orgId: org.id,
    userIds: [r.requestedBy],
    template: "extension.approved",
    data: { packageName: p.name, days: input.days, validUntil: nice(to), fee: input.feeCents ? money(input.feeCents, org.currency) : null, note: input.note ?? null },
  });
  return { request: presentRequest(u!, org), validUntil: to, feeId };
}

export async function requestExtension(tx: DbOrTx, auth: AuthContext, id: string, input: { days: number; reason: string; attachmentFileId?: string }, now = new Date()) {
  const org = await getOrg(tx, auth.orgId);
  const p = await getPackage(tx, auth.orgId, id, true);
  if (auth.role !== "client") throw forbidden("Staff can extend packages directly with Adjust.");
  await assertCanSee(tx, auth, p);
  if (org.extensionMode === "off") throw conflict("extensions_off", "Your studio doesn't take extension requests in the app. Please contact the studio.");
  if (p.billing === "recurring") throw conflict("recurring", "Memberships renew each period, so they don't need extending. Contact the studio if you'd like to pause it.");
  const state = packageState(p, now);
  if (state === "cancelled") throw conflict("package_cancelled", "This package has been cancelled.");
  if (state === "used_up") throw conflict("used_up", "All the classes on this package have been used, so there's nothing to extend.");
  if (!p.expiresAt && !(p.startsOn === "first_booking" && p.activateBy && !p.startedAt)) throw conflict("never_expires", "This package never expires, so it doesn't need extending.");
  const ended = (!p.startedAt ? p.activateBy : p.expiresAt)!;
  if (now.getTime() - ended.getTime() > 30 * 86_400_000) throw conflict("expired_too_long", "This package expired more than 30 days ago. Please contact the studio.");
  if (input.days > org.extensionMaxDays) throw badRequest("too_long", `You can ask for up to ${plural(org.extensionMaxDays, "day")} at a time.`);
  if (org.extensionAttachment === "off" && input.attachmentFileId) throw badRequest("no_attachments", "Your studio doesn't take attachments with extension requests.");
  if (org.extensionAttachment === "required" && !input.attachmentFileId) throw badRequest("attachment_needed", "Your studio asks for a document with extension requests, e.g. a doctor's note.");
  if (input.attachmentFileId) await assertFile(tx, auth.orgId, input.attachmentFileId, "extension_attachment", auth.userId);
  const [pending] = await tx.select({ id: packageExtensionRequests.id }).from(packageExtensionRequests).where(and(eq(packageExtensionRequests.packageId, p.id), eq(packageExtensionRequests.status, "pending")));
  if (pending) throw conflict("already_requested", "You've already asked for an extension on this package. The studio will get back to you.");

  const [r] = await tx.insert(packageExtensionRequests).values({ orgId: auth.orgId, packageId: p.id, requestedBy: auth.userId, days: input.days, reason: input.reason, attachmentFileId: input.attachmentFileId ?? null }).returning();
  const [autoBefore] = await tx.select({ n: count() }).from(packageExtensionRequests).where(and(eq(packageExtensionRequests.packageId, p.id), eq(packageExtensionRequests.autoApproved, true)));
  if (org.extensionMode === "auto" && input.days <= org.extensionAutoDays && !autoBefore?.n) {
    return { ...(await decide(tx, org, r!, p, { days: input.days, feeCents: extensionFee(org, input.days) }, null, true, now)), approvedAutomatically: true };
  }
  await notify(tx, {
    orgId: auth.orgId,
    userIds: await staffIds(tx, auth.orgId, ["owner", "admin"]),
    template: "extension.requested",
    data: { packageName: p.name, clientName: await userName(tx, auth.userId), days: input.days, reason: input.reason },
  });
  return { request: presentRequest(r!, org), approvedAutomatically: false };
}

async function pendingRequest(tx: DbOrTx, auth: AuthContext, id: string) {
  const [r] = await tx.select().from(packageExtensionRequests).where(and(eq(packageExtensionRequests.id, id), eq(packageExtensionRequests.orgId, auth.orgId))).for("update");
  if (!r) throw notFound("request");
  if (r.status !== "pending") throw conflict("already_decided", `This request was already ${r.status}.`);
  return r;
}

export async function approveExtension(tx: DbOrTx, auth: AuthContext, id: string, input: { days?: number; feeCents?: number; note?: string }, now = new Date()) {
  if (!isManager(auth)) throw forbidden();
  const r = await pendingRequest(tx, auth, id);
  const org = await getOrg(tx, auth.orgId);
  const p = await getPackage(tx, auth.orgId, r.packageId, true);
  const days = input.days ?? r.days;
  return decide(tx, org, r, p, { days, feeCents: input.feeCents ?? extensionFee(org, days), note: input.note }, auth.userId, false, now);
}

export async function declineExtension(tx: DbOrTx, auth: AuthContext, id: string, note: string, now = new Date()) {
  if (!isManager(auth)) throw forbidden();
  const r = await pendingRequest(tx, auth, id);
  const org = await getOrg(tx, auth.orgId);
  const p = await getPackage(tx, auth.orgId, r.packageId);
  const [u] = await tx.update(packageExtensionRequests).set({ status: "declined", decidedBy: auth.userId, decidedAt: now, decisionNote: note }).where(eq(packageExtensionRequests.id, r.id)).returning();
  await notify(tx, { orgId: auth.orgId, userIds: [r.requestedBy], template: "extension.declined", data: { packageName: p.name, note } });
  return presentRequest(u!, org);
}

export async function withdrawExtension(tx: DbOrTx, auth: AuthContext, id: string) {
  const r = await pendingRequest(tx, auth, id);
  if (r.requestedBy !== auth.userId) throw notFound("request");
  const [u] = await tx.update(packageExtensionRequests).set({ status: "withdrawn" }).where(eq(packageExtensionRequests.id, r.id)).returning();
  return presentRequest(u!, await getOrg(tx, auth.orgId));
}

/** Admins' list of requests, with what approving would do. */
export async function listExtensionRequests(db: DbOrTx, auth: AuthContext, status: Request["status"]) {
  if (!isManager(auth)) throw forbidden();
  const org = await getOrg(db, auth.orgId);
  const zone = orgZone(org);
  const rows = await db
    .select({ r: packageExtensionRequests, p: clientPackages, first: users.firstName, last: users.lastName })
    .from(packageExtensionRequests)
    .innerJoin(clientPackages, eq(clientPackages.id, packageExtensionRequests.packageId))
    .innerJoin(users, eq(users.id, packageExtensionRequests.requestedBy))
    .where(and(eq(packageExtensionRequests.orgId, auth.orgId), eq(packageExtensionRequests.status, status)))
    .orderBy(asc(packageExtensionRequests.createdAt));
  return rows.map(({ r, p, first, last }) => {
    const current = !p.startedAt && p.startsOn === "first_booking" ? p.activateBy : p.expiresAt;
    return {
      ...presentRequest(r, org),
      clientName: `${first} ${last}`,
      packageId: p.id,
      packageName: p.name,
      currentlyValidUntil: lastDay(current, zone),
      feeIfApproved: money(extensionFee(org, r.days), org.currency),
    };
  });
}

// ---------------------------------------------------------------------------
// Rollovers
// ---------------------------------------------------------------------------
/** Unused classes a client could bring across from their other packages (the buyer's own share). */
export async function rolloverOptions(db: DbOrTx, org: Org, clientId: string, now = new Date()) {
  if (org.rolloverMode === "off") return [];
  const zone = orgZone(org);
  const rows = await db.select().from(clientPackages).where(and(eq(clientPackages.orgId, org.id), eq(clientPackages.ownerId, clientId), eq(clientPackages.kind, "credits"), isNull(clientPackages.cancelledAt)));
  const out: { packageId: string; name: string; classes: number; validUntil: string | null }[] = [];
  for (const p of rows) {
    const ended = p.expiresAt && now >= p.expiresAt;
    if (ended && now.getTime() - p.expiresAt!.getTime() > org.rolloverWithinDays * 86_400_000) continue;
    if (!p.startedAt && p.activateBy && now >= p.activateBy) continue;
    let available = p.creditsLeft ?? 0;
    if (p.sharingMode === "allocated") {
      const [own] = await db.select({ a: clientPackageMembers.allocatedCredits }).from(clientPackageMembers).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, p.ownerId)));
      available = own?.a ?? 0;
    }
    if (org.rolloverMaxCredits) available = Math.min(available, org.rolloverMaxCredits);
    if (available > 0) out.push({ packageId: p.id, name: p.name, classes: available, validUntil: lastDay(p.expiresAt, zone) });
  }
  return out;
}

/** Move unused classes from one of the buyer's packages to another (e.g. a newly bought one). */
export async function rolloverInto(tx: DbOrTx, auth: AuthContext, targetId: string, input: { fromPackageId: string; credits?: number }, opts: { viaCheckout?: boolean } = {}, now = new Date()) {
  const org = await getOrg(tx, auth.orgId);
  if (org.rolloverMode === "off") throw conflict("rollover_off", "Your studio doesn't roll classes over between packages.");
  if (!isManager(auth) && !(org.rolloverMode === "clients" && opts.viaCheckout)) throw forbidden("Only the studio can roll classes over.");
  if (targetId === input.fromPackageId) throw badRequest("same_package", "Choose a different package to roll classes over from.");
  const target = await getPackage(tx, auth.orgId, targetId, true);
  const from = await getPackage(tx, auth.orgId, input.fromPackageId, true);
  if (from.ownerId !== target.ownerId) throw badRequest("different_owner", "Classes can only roll over between packages that belong to the same person.");
  if (target.kind !== "credits") throw badRequest("unlimited", "Classes can only roll over into a class pack.");
  const tState = packageState(target, now);
  if (tState === "cancelled" || tState === "expired") throw conflict("target_inactive", "Classes can't roll over into a package that has ended.");
  const option = (await rolloverOptions(tx, org, from.ownerId, now)).find((o) => o.packageId === from.id);
  if (!option) throw conflict("nothing_to_roll_over", `${from.name} has no classes that can roll over${org.rolloverWithinDays ? ` (it must have ended less than ${plural(org.rolloverWithinDays, "day")} ago)` : ""}.`);
  const n = input.credits ?? option.classes;
  if (n > option.classes) throw badRequest("too_many", `Up to ${plural(option.classes, "class", "classes")} can roll over from ${from.name}.`);

  await tx.update(clientPackages).set({ creditsLeft: sql`${clientPackages.creditsLeft} - ${n}` }).where(eq(clientPackages.id, from.id));
  await tx.update(clientPackages).set({ creditsLeft: sql`${clientPackages.creditsLeft} + ${n}`, creditsTotal: sql`coalesce(${clientPackages.creditsTotal}, 0) + ${n}` }).where(eq(clientPackages.id, target.id));
  if (from.sharingMode === "allocated") await tx.update(clientPackageMembers).set({ allocatedCredits: sql`${clientPackageMembers.allocatedCredits} - ${n}` }).where(and(eq(clientPackageMembers.packageId, from.id), eq(clientPackageMembers.userId, from.ownerId)));
  if (target.sharingMode === "allocated") await tx.update(clientPackageMembers).set({ allocatedCredits: sql`coalesce(${clientPackageMembers.allocatedCredits}, 0) + ${n}` }).where(and(eq(clientPackageMembers.packageId, target.id), eq(clientPackageMembers.userId, target.ownerId)));
  await tx.insert(packageLedger).values([
    { orgId: org.id, packageId: from.id, change: -n, reason: "rolled_over", details: { otherName: target.name, otherId: target.id }, createdBy: auth.userId },
    { orgId: org.id, packageId: target.id, change: n, reason: "rolled_over", details: { otherName: from.name, otherId: from.id }, createdBy: auth.userId },
  ]);
  await audit(tx, { orgId: org.id, actorId: auth.userId, action: "package.rolled_over", entityType: "client_package", entityId: target.id, details: { from: from.id, credits: n } });
  return { rolledOver: n, from: from.name, to: target.name };
}

// ---------------------------------------------------------------------------
// Recurring packages
// ---------------------------------------------------------------------------
/**
 * Renew recurring packages whose period has ended (run by the worker every minute).
 * Each new period starts with the plan's classes plus any carried over (up to the cap).
 * Stopped memberships end at the end of the current period, or of the minimum term if later.
 */
export async function renewDuePackages(db: Db, now = new Date()) {
  const due = await db
    .select({ id: clientPackages.id, orgId: clientPackages.orgId })
    .from(clientPackages)
    .where(and(eq(clientPackages.billing, "recurring"), isNull(clientPackages.cancelledAt), sql`${clientPackages.expiresAt} <= ${now}`))
    .limit(500);
  let renewed = 0;
  for (const { id, orgId } of due) {
    await db.transaction(async (tx) => {
      const org = await getOrg(tx, orgId);
      const zone = orgZone(org);
      let p = await getPackage(tx, orgId, id, true);
      while (p.expiresAt && p.expiresAt <= now) {
        if (p.stopsRenewingAt && renewalEnd(p, zone) <= p.expiresAt) return; // stopped: it ends here
        const left = p.kind === "credits" ? (p.creditsLeft ?? 0) : 0;
        const carried = p.kind === "credits" ? Math.min(left, p.rolloverCap ?? 0) : 0;
        const fresh = p.kind === "credits" ? (p.creditsPerCycle ?? 0) + carried : null;
        const next = expiryFrom(p.expiresAt, p.validityValue!, p.validityUnit!, zone);
        const [u] = await tx
          .update(clientPackages)
          .set({ startedAt: p.expiresAt, expiresAt: next, cycle: p.cycle + 1, creditsLeft: fresh, creditsTotal: fresh })
          .where(eq(clientPackages.id, p.id))
          .returning();
        await tx.insert(packageLedger).values({
          orgId, packageId: p.id, change: fresh === null ? 0 : fresh - left, reason: "renewed",
          details: { period: p.cycle + 1, classes: fresh, carried, unusedExpired: left - carried, validUntil: lastDay(next, zone) },
          createdAt: p.expiresAt,
        });
        if (p.pricePaidCents > 0) {
          // Once payments are connected, the provider charges this; until then it's due at the studio.
          await tx.insert(orders).values({ orgId, clientId: p.ownerId, planId: p.planId, amountCents: p.pricePaidCents, currency: p.currency, status: "pending", clientPackageId: p.id });
        }
        await notify(tx, { orgId, userIds: [p.ownerId], template: "package.renewed", data: { packageName: p.name, validUntil: nice(lastDay(next, zone)), classes: fresh, carried } });
        p = u!;
        renewed++;
      }
    });
  }
  return renewed;
}

async function stoppable(db: DbOrTx, auth: AuthContext, id: string, lock = false) {
  const p = await getPackage(db, auth.orgId, id, lock);
  if (!isManager(auth) && p.ownerId !== auth.userId) throw auth.role === "client" ? forbidden("Only the person who bought this membership can stop it.") : forbidden();
  if (p.billing !== "recurring") throw badRequest("not_recurring", "Only recurring packages renew.");
  return p;
}

/**
 * The choices when stopping a membership:
 *  - stop at the end of the minimum term (or this period, if the term is done): no fee;
 *  - during the term, end at the end of this period instead, paying the early cancellation fee
 *    (if the studio allows leaving early).
 */
export async function stopOptions(db: DbOrTx, auth: AuthContext, id: string) {
  const org = await getOrg(db, auth.orgId);
  const zone = orgZone(org);
  const p = await stoppable(db, auth, id);
  const inTerm = periodsLeftInTerm(p, zone) > 0;
  const fee = earlyCancelFee(p, zone);
  return {
    inMinimumTerm: inTerm,
    minimumTermEndsOn: inTerm ? lastDay(commitmentEnd(p, zone), zone) : null,
    stopAtEndOfTerm: { endsOn: lastDay(renewalEnd({ ...p, stopsRenewingAt: new Date(), endsEarly: false }, zone), zone), fee: null },
    endEarly: inTerm
      ? { allowed: fee !== null, endsOn: lastDay(p.expiresAt, zone), feeCents: fee, fee: fee === null ? null : money(fee, org.currency), periodsLeft: periodsLeftInTerm(p, zone) }
      : null,
  };
}

/** Stop a membership renewing: at the end of the minimum term (or this period), or early with the fee. */
export async function stopRenewing(tx: DbOrTx, auth: AuthContext, id: string, input: { reason?: string; endEarly?: boolean; feeCents?: number }, now = new Date()) {
  const org = await getOrg(tx, auth.orgId);
  const zone = orgZone(org);
  const p = await stoppable(tx, auth, id, true);
  if (p.cancelledAt || p.stopsRenewingAt) throw conflict("already_stopped", "This membership has already been stopped.");
  if (input.feeCents !== undefined && !isManager(auth)) throw forbidden("Only the studio can change the fee.");
  const inTerm = periodsLeftInTerm(p, zone) > 0;
  const early = !!input.endEarly && inTerm;
  let feeCents = 0;
  if (early) {
    const fee = earlyCancelFee(p, zone);
    if (fee === null && !isManager(auth)) {
      throw conflict("early_cancel_not_allowed", `This membership has a minimum term until ${nice(lastDay(commitmentEnd(p, zone), zone))}, so it can't end before then. You can stop it now and it will end when the term is up.`);
    }
    feeCents = input.feeCents ?? fee ?? 0;
  }
  const endsOn = lastDay(renewalEnd({ ...p, stopsRenewingAt: now, endsEarly: early }, zone), zone)!;
  await tx.update(clientPackages).set({ stopsRenewingAt: now, endsEarly: early }).where(eq(clientPackages.id, p.id));
  if (feeCents > 0) {
    await tx.insert(fees).values({ orgId: org.id, clientId: p.ownerId, clientPackageId: p.id, type: "early_cancellation", amountCents: feeCents, currency: org.currency });
  }
  await tx.insert(packageLedger).values({
    orgId: org.id, packageId: p.id, change: 0, reason: "cancelled", note: input.reason ?? null, createdBy: auth.userId,
    details: { stoppedRenewing: true, endsOn, endedEarly: early, fee: feeCents ? money(feeCents, org.currency) : null },
  });
  if (auth.role === "client") {
    await notify(tx, { orgId: org.id, userIds: await staffIds(tx, org.id, ["owner", "admin"]), template: "package.stopped", data: { packageName: p.name, clientName: await userName(tx, auth.userId), endsOn: nice(endsOn), reason: input.reason ?? null, fee: feeCents ? money(feeCents, org.currency) : null } });
  }
  return { endsOn, commitmentApplies: !early && endsOn !== lastDay(p.expiresAt, zone), endedEarly: early, fee: feeCents ? money(feeCents, org.currency) : null };
}

export async function resumeRenewing(tx: DbOrTx, auth: AuthContext, id: string, now = new Date()) {
  const p = await getPackage(tx, auth.orgId, id, true);
  if (!isManager(auth) && p.ownerId !== auth.userId) throw forbidden();
  if (!p.stopsRenewingAt) throw conflict("not_stopped", "This membership is still renewing.");
  if (p.expiresAt && p.expiresAt <= now) throw conflict("already_ended", "This membership has already ended. Buy it again to restart.");
  await tx.update(clientPackages).set({ stopsRenewingAt: null, endsEarly: false }).where(eq(clientPackages.id, p.id));
  // Staying after all: an unpaid early cancellation fee no longer applies.
  await tx.update(fees).set({ status: "waived", waivedBy: auth.userId, waivedAt: now, waivedReason: "Membership resumed" }).where(and(eq(fees.clientPackageId, p.id), eq(fees.type, "early_cancellation"), eq(fees.status, "pending")));
  return { renewing: true };
}

// ---------------------------------------------------------------------------
// Editing package types: new sales, existing packages, or both
// ---------------------------------------------------------------------------
type PlanChanges = Partial<{
  name: string; description: string | null; photoFileId: string | null; categoryId: string | null; priceCents: number; onSale: boolean;
  credits: number; validityValue: number | null; validityUnit: "days" | "weeks" | "months" | null; activateWithinDays: number | null;
  maxUsers: number; weeklyLimit: number | null; classTypeIds: string[]; rolloverCap: number | null; commitmentCycles: number | null;
  earlyCancelFeeMode: "none" | "flat" | "remaining"; earlyCancelFeeCents: number | null;
}>;
/** Fields that belong to the package type itself (what's on sale), never copied onto sold packages. */
const PLAN_ONLY = ["description", "photoFileId", "categoryId", "priceCents", "onSale", "commitmentCycles", "earlyCancelFeeMode", "earlyCancelFeeCents"] as const;

/** The next position at the end of a category (or of "No category"). */
export async function endOfCategory(tx: DbOrTx, orgId: string, categoryId: string | null) {
  const [r] = await tx
    .select({ m: max(packagePlans.sortOrder) })
    .from(packagePlans)
    .where(and(eq(packagePlans.orgId, orgId), categoryId ? eq(packagePlans.categoryId, categoryId) : isNull(packagePlans.categoryId)));
  return r?.m === null || r?.m === undefined ? 0 : r.m + 1;
}

/**
 * Set which packages are in a category and their order. Listed packages move here (from wherever
 * they were); packages that were here but aren't listed move to "No category".
 */
export async function setCategoryPackages(tx: DbOrTx, auth: AuthContext, categoryId: string, planIds: string[]) {
  if (!isManager(auth)) throw forbidden();
  const [cat] = await tx.select().from(packageCategories).where(and(eq(packageCategories.id, categoryId), eq(packageCategories.orgId, auth.orgId))).for("update");
  if (!cat) throw notFound("category");
  if (planIds.length) {
    const found = await tx.select({ id: packagePlans.id }).from(packagePlans).where(and(eq(packagePlans.orgId, auth.orgId), inArray(packagePlans.id, planIds)));
    if (found.length !== planIds.length) throw notFound("package type");
  }
  const leaving = (await tx.select({ id: packagePlans.id }).from(packagePlans).where(and(eq(packagePlans.orgId, auth.orgId), eq(packagePlans.categoryId, categoryId)))).filter((p) => !planIds.includes(p.id));
  let next = await endOfCategory(tx, auth.orgId, null);
  for (const p of leaving) await tx.update(packagePlans).set({ categoryId: null, sortOrder: next++ }).where(eq(packagePlans.id, p.id));
  for (const [i, pid] of planIds.entries()) await tx.update(packagePlans).set({ categoryId, sortOrder: i }).where(eq(packagePlans.id, pid));
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "package_category.packages_set", entityType: "package_category", entityId: categoryId, details: { planIds, removed: leaving.map((p) => p.id) } });
  return { category: cat, moved: planIds.length, removed: leaving.length };
}

export async function updatePlan(tx: DbOrTx, auth: AuthContext, id: string, input: { changes: PlanChanges; applyTo: PlanEditScope; notifyClients: boolean }, flags: Flags, now = new Date()) {
  if (!isManager(auth)) throw forbidden();
  const org = await getOrg(tx, auth.orgId);
  const zone = orgZone(org);
  const [plan] = await tx.select().from(packagePlans).where(and(eq(packagePlans.id, id), eq(packagePlans.orgId, auth.orgId))).for("update");
  if (!plan) throw notFound("package type");
  const c = input.changes;
  if (c.credits !== undefined && plan.kind !== "credits") throw badRequest("unlimited", "Unlimited packages don't have a number of classes.");
  if ((c.validityValue === null || c.validityUnit === null) && (plan.kind === "unlimited" || plan.billing === "recurring")) throw badRequest("needs_validity", "This package needs a validity period.");
  if (c.activateWithinDays && plan.startsOn !== "first_booking") throw badRequest("activate", "Only needed when the countdown starts at the first booking.");
  if ((c.rolloverCap || c.commitmentCycles) && plan.billing !== "recurring") throw badRequest("recurring_only", "That only applies to recurring packages.");

  const touchesExisting = input.applyTo !== "new";
  const existing = touchesExisting
    ? (await tx.select().from(clientPackages).where(and(eq(clientPackages.planId, plan.id), isNull(clientPackages.cancelledAt)))).filter((p) => ["active", "not_started"].includes(packageState(p, now)))
    : [];
  const describeChange: string[] = [];
  const updates = new Map<string, Partial<Pkg>>();
  let wouldExpire = 0;
  let shorter = 0;
  if (touchesExisting) {
    for (const p of existing) {
      const u: Partial<Pkg> = {};
      if (c.name !== undefined) u.name = c.name;
      if (c.weeklyLimit !== undefined) u.weeklyLimit = c.weeklyLimit;
      if (c.classTypeIds !== undefined) u.classTypeIds = c.classTypeIds;
      if (c.maxUsers !== undefined) u.maxUsers = c.maxUsers;
      if (c.rolloverCap !== undefined) u.rolloverCap = c.rolloverCap;
      if (c.credits !== undefined) {
        if (p.billing === "recurring") u.creditsPerCycle = c.credits; // from the next period
        else {
          const delta = c.credits - (plan.credits ?? 0);
          u.creditsTotal = Math.max(0, (p.creditsTotal ?? 0) + delta);
          u.creditsLeft = Math.max(0, (p.creditsLeft ?? 0) + delta);
        }
      }
      if (c.validityValue !== undefined) {
        u.validityValue = c.validityValue;
        u.validityUnit = c.validityUnit!;
        // One-time packages that have started get a new end date; memberships change from the next period.
        if (p.billing !== "recurring" && p.startedAt) {
          const end = c.validityValue && c.validityUnit ? expiryFrom(p.startedAt, c.validityValue, c.validityUnit, zone) : null;
          if (end && p.expiresAt && end < p.expiresAt) shorter++;
          if (end && end <= now) wouldExpire++;
          u.expiresAt = end;
        }
      }
      if (c.activateWithinDays !== undefined && !p.startedAt) u.activateBy = c.activateWithinDays ? DateTime.fromJSDate(p.purchasedAt, { zone }).startOf("day").plus({ days: c.activateWithinDays + 1 }).toJSDate() : null;
      if (Object.keys(u).length) updates.set(p.id, u);
    }
    if (c.name !== undefined) describeChange.push(`the name becomes “${c.name}”`);
    if (c.credits !== undefined) describeChange.push(plan.billing === "recurring" ? `${plural(c.credits, "class", "classes")} each period from the next renewal` : `${c.credits - (plan.credits ?? 0) >= 0 ? "+" : "−"}${plural(Math.abs(c.credits - (plan.credits ?? 0)), "class", "classes")} on each package`);
    if (c.validityValue !== undefined) describeChange.push(c.validityValue ? `valid for ${c.validityValue} ${c.validityUnit}${plan.billing === "recurring" ? " per period from the next renewal" : " from when each package started"}` : "no expiry");
    if (c.weeklyLimit !== undefined) describeChange.push(c.weeklyLimit ? `up to ${plural(c.weeklyLimit, "class", "classes")} a week` : "no weekly limit");
    if (c.classTypeIds !== undefined) describeChange.push(c.classTypeIds.length ? "a different set of classes it covers" : "covers every class");
    if (c.maxUsers !== undefined) describeChange.push(`can be shared by up to ${c.maxUsers}`);
    if (c.activateWithinDays !== undefined) describeChange.push(c.activateWithinDays ? `first class must be booked within ${plural(c.activateWithinDays, "day")} of buying` : "no first-booking deadline");
    if (c.rolloverCap !== undefined) describeChange.push(`up to ${c.rolloverCap ?? 0} unused classes carry over`);
    const planOnly = PLAN_ONLY.filter((k) => c[k] !== undefined);
    if (planOnly.length && input.applyTo === "existing") {
      flags.info({ code: "existing_packages_affected", message: `Price, minimum term, early cancellation fee, category, photo and description belong to the package type itself (clients keep the terms they signed up to), so they're only saved with “New sales” or “Both”. The description and photo clients see always come from the package type.` });
    }
    if (updates.size) {
      flags.confirm({
        code: "existing_packages_affected",
        message: `This changes ${plural(updates.size, "package", "packages")} clients already have: ${describeChange.join("; ")}.${shorter ? ` ${plural(shorter, "package", "packages")} will end sooner than before.` : ""}${input.notifyClients ? " They'll be told by email and push." : ""}`,
      });
    }
    if (wouldExpire) flags.confirm({ code: "packages_would_expire", message: `${plural(wouldExpire, "package", "packages")} would expire straight away with the new validity.` });
  }

  let updatedPlan = plan;
  if (input.applyTo !== "existing") {
    const moving = c.categoryId !== undefined && (c.categoryId ?? null) !== plan.categoryId;
    const sortOrder = moving ? await endOfCategory(tx, auth.orgId, c.categoryId ?? null) : undefined;
    const [u] = await tx.update(packagePlans).set({ ...c, ...(moving ? { sortOrder } : {}) }).where(eq(packagePlans.id, plan.id)).returning();
    updatedPlan = u!;
  }
  for (const [pid, u] of updates) {
    await tx.update(clientPackages).set(u).where(eq(clientPackages.id, pid));
    const before = existing.find((p) => p.id === pid)!;
    const creditDelta = u.creditsLeft != null ? u.creditsLeft - (before.creditsLeft ?? 0) : 0;
    await tx.insert(packageLedger).values({ orgId: org.id, packageId: pid, change: creditDelta, reason: "plan_updated", details: { summary: describeChange.join("; ") }, createdBy: auth.userId });
    if (input.notifyClients) {
      const members = await tx.select({ id: clientPackageMembers.userId }).from(clientPackageMembers).where(eq(clientPackageMembers.packageId, pid));
      await notify(tx, { orgId: org.id, userIds: members.map((m) => m.id), template: "package.updated", data: { packageName: u.name ?? before.name, changes: describeChange.join("; ") } });
    }
  }
  await audit(tx, { orgId: org.id, actorId: auth.userId, action: "package_plan.updated", entityType: "package_plan", entityId: plan.id, details: { changes: c, applyTo: input.applyTo, packagesChanged: updates.size } });
  return { plan: updatedPlan, packagesChanged: updates.size };
}

// ---------------------------------------------------------------------------
// Tidying up: usage, archive, delete
// ---------------------------------------------------------------------------
/** For each package type: how many clients are using one, when it last sold, and whether it looks safe to archive. */
export async function planUsage(db: DbOrTx, orgId: string, now = new Date()) {
  const sold = await db
    .select({ planId: clientPackages.planId, n: count(), last: max(clientPackages.purchasedAt) })
    .from(clientPackages)
    .where(eq(clientPackages.orgId, orgId))
    .groupBy(clientPackages.planId);
  const live = await db.select().from(clientPackages).where(and(eq(clientPackages.orgId, orgId), isNull(clientPackages.cancelledAt)));
  const active = new Map<string, number>();
  for (const p of live) if (p.planId && ["active", "not_started"].includes(packageState(p, now))) active.set(p.planId, (active.get(p.planId) ?? 0) + 1);
  const plans = await db.select({ id: packagePlans.id, onSale: packagePlans.onSale, archivedAt: packagePlans.archivedAt, createdAt: packagePlans.createdAt }).from(packagePlans).where(eq(packagePlans.orgId, orgId));
  const old = now.getTime() - ARCHIVE_SUGGEST_AFTER_DAYS * 86_400_000;
  return new Map(
    plans.map((pl) => {
      const s = sold.find((x) => x.planId === pl.id);
      const inUse = active.get(pl.id) ?? 0;
      const lastSold = s?.last ?? null;
      const stale = !pl.onSale || (lastSold ? lastSold.getTime() < old : pl.createdAt.getTime() < old);
      return [pl.id, { clientsUsing: inUse, timesSold: s?.n ?? 0, lastSoldAt: lastSold, suggestArchive: !pl.archivedAt && inUse === 0 && stale }];
    }),
  );
}

export async function setArchived(tx: DbOrTx, auth: AuthContext, id: string, archived: boolean, now = new Date()) {
  if (!isManager(auth)) throw forbidden();
  const [u] = await tx
    .update(packagePlans)
    .set(archived ? { archivedAt: now, onSale: false } : { archivedAt: null })
    .where(and(eq(packagePlans.id, id), eq(packagePlans.orgId, auth.orgId)))
    .returning();
  if (!u) throw notFound("package type");
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: archived ? "package_plan.archived" : "package_plan.restored", entityType: "package_plan", entityId: id });
  return u;
}

/** Wipe client packages completely: history, shares, requests and fees go; bookings stay (attendance) but lose the link. */
async function wipePackages(tx: DbOrTx, ids: string[]) {
  if (!ids.length) return;
  await tx.update(bookings).set({ clientPackageId: null }).where(inArray(bookings.clientPackageId, ids));
  await tx.update(orders).set({ clientPackageId: null }).where(inArray(orders.clientPackageId, ids));
  await tx.update(orders).set({ rolloverFromPackageId: null }).where(inArray(orders.rolloverFromPackageId, ids));
  await tx.delete(clientPackages).where(inArray(clientPackages.id, ids)); // members, history, requests and package fees cascade
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Admins only, after typing the package's name. Deletes the type and every package sold from it. */
export async function deletePlan(tx: DbOrTx, auth: AuthContext, id: string, confirmName: string) {
  if (!isManager(auth)) throw forbidden("Only admins can delete packages.");
  const [plan] = await tx.select().from(packagePlans).where(and(eq(packagePlans.id, id), eq(packagePlans.orgId, auth.orgId))).for("update");
  if (!plan) throw notFound("package type");
  if (!sameName(confirmName, plan.name)) throw badRequest("name_mismatch", `Type “${plan.name}” exactly to confirm.`);
  const sold = await tx.select({ id: clientPackages.id }).from(clientPackages).where(eq(clientPackages.planId, plan.id));
  await wipePackages(tx, sold.map((s) => s.id));
  await tx.update(orders).set({ planId: null }).where(eq(orders.planId, plan.id));
  await tx.delete(packagePlans).where(eq(packagePlans.id, plan.id));
  // Kept in the audit log: that it happened and how much went, never any client details.
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "package_plan.deleted", entityType: "package_plan", entityId: plan.id, details: { name: plan.name, clientPackagesDeleted: sold.length } });
  return { deleted: plan.name, clientPackagesDeleted: sold.length };
}

export async function deleteClientPackage(tx: DbOrTx, auth: AuthContext, id: string, confirmName: string) {
  if (!isManager(auth)) throw forbidden("Only admins can delete packages.");
  const p = await getPackage(tx, auth.orgId, id, true);
  if (!sameName(confirmName, p.name)) throw badRequest("name_mismatch", `Type “${p.name}” exactly to confirm.`);
  await wipePackages(tx, [p.id]);
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "client_package.deleted", entityType: "client_package", entityId: p.id, details: { name: p.name } });
  return { deleted: p.name };
}

/** The plain-English rules for a plan (for the selling page and checkout). */
export async function planTerms(db: DbOrTx, plan: Plan, currency = "SGD") {
  const names = plan.classTypeIds.length ? await db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(inArray(classTypes.id, plan.classTypeIds)) : [];
  return describePackage(plan, plan.classTypeIds.map((id) => names.find((n) => n.id === id)?.name ?? "").filter(Boolean), (c) => money(c, currency));
}

