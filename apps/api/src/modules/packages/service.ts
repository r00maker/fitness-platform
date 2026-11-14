/**
 * Packages: class packs and unlimited memberships.
 *
 *  - A package type ("plan") holds the studio's terms. Selling one copies the terms onto the
 *    client's package, so later edits to the plan never change what someone already bought.
 *  - Whether a package is active, used up or expired is worked out from its dates and balance
 *    whenever it's needed. Nothing has to run overnight for a package to expire on time.
 *  - Credits are taken when a class is booked and given back when the booking is cancelled
 *    in time (or refunded). Every change is written to the package's history (the ledger).
 *  - Sharing: everyone who can use a package is a member (the buyer included). With
 *    "allocated" sharing each member has their own share, and the buyer holds whatever
 *    hasn't been given to anyone else, so the shares always add up to the classes left.
 */
import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { clientEvent } from "../marketing/events.js";
import { loyaltyForSpend } from "../marketing/loyalty.js";
import { adsOnPurchase } from "../marketing/ads.js";
import { OPTION_LABELS, describePackage, type PackageState } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, classSessions, classTypes, clientPackageMembers, clientPackages, memberships, organizations, packageLedger, packagePlans, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import type { Flags } from "../../lib/flags.js";
import { zoneFor, type TZ } from "../../lib/time.js";
import type { AuthContext } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { notify } from "../notifications/outbox.js";
import { getOrg, userName, type SessionRow } from "../sessions/context.js";
import { can } from "@studio/shared";
import { holdReason } from "./payments.js";

export type Pkg = typeof clientPackages.$inferSelect;
type Member = typeof clientPackageMembers.$inferSelect;
type Org = typeof organizations.$inferSelect;

const isManager = (auth: AuthContext) => can(auth.role, "managePackages");
export const orgZone = (org: Org): TZ => zoneFor(org.timezone, org.observesDaylightSaving);

// ---------------------------------------------------------------------------
// Dates and state
// ---------------------------------------------------------------------------
/** Validity runs from the start of the start day; the package stops working at midnight after its last day. */
export function expiryFrom(start: Date, value: number, unit: "days" | "weeks" | "months", zone: TZ): Date {
  return DateTime.fromJSDate(start, { zone }).startOf("day").plus({ [unit]: value }).toJSDate();
}
/** The last day it can be used, e.g. "2026-12-10", from the moment it stops working. */
export const lastDay = (end: Date | null, zone: TZ) => (end ? DateTime.fromJSDate(end, { zone }).minus({ days: 1 }).toISODate()! : null);
const startOfDayAfter = (date: string, zone: TZ) => DateTime.fromISO(date, { zone }).plus({ days: 1 }).startOf("day").toJSDate();
const friendly = (d: Date, zone: TZ) => DateTime.fromJSDate(d, { zone }).toFormat("d LLL yyyy");

/** Recurring: the classes each period gives (stored on the package when sold). */
export const planCredits = (p: Pkg) => p.creditsPerCycle ?? p.creditsTotal;
/** Recurring: the end of the minimum term. */
export function commitmentEnd(p: Pkg, zone: TZ): Date {
  return expiryFrom(p.startedAt!, p.validityValue! * (p.commitmentCycles ?? 1), p.validityUnit!, zone);
}
/** Recurring that's been stopped: when it actually ends (end of this period, or of the minimum term if later). */
export function renewalEnd(p: Pkg, zone: TZ): Date {
  const thisPeriod = p.expiresAt!;
  if (!p.commitmentCycles || p.endsEarly) return thisPeriod;
  const c = commitmentEnd(p, zone);
  return c > thisPeriod ? c : thisPeriod;
}
const endsAfterThisPeriod = (p: Pkg) => !!p.stopsRenewingAt;

/** Periods still to pay in the minimum term after the current one (0 = the term is done). */
export function periodsLeftInTerm(p: Pkg, zone: TZ): number {
  if (p.billing !== "recurring" || !p.commitmentCycles || !p.startedAt || !p.expiresAt) return 0;
  return Math.max(0, p.commitmentCycles - p.cycle);
}
/**
 * The early cancellation fee for leaving at the end of this period instead of the end of the
 * minimum term. Null when the studio doesn't allow leaving early; 0 when the term is already done.
 */
export function earlyCancelFee(p: Pkg, zone: TZ): number | null {
  const left = periodsLeftInTerm(p, zone);
  if (left === 0) return 0;
  if (p.earlyCancelFeeMode === "flat") return p.earlyCancelFeeCents ?? 0;
  if (p.earlyCancelFeeMode === "remaining") return left * p.pricePaidCents;
  return null;
}

export function packageState(p: Pkg, now = new Date()): PackageState {
  if (p.cancelledAt) return "cancelled";
  if (p.expiresAt && now >= p.expiresAt) return "expired";
  if (!p.startedAt && p.activateBy && now >= p.activateBy) return "expired";
  if (p.kind === "credits" && (p.creditsLeft ?? 0) <= 0) return "used_up";
  if (!p.startedAt || p.startedAt > now) return "not_started";
  return "active";
}

// ---------------------------------------------------------------------------
// Reading packages
// ---------------------------------------------------------------------------
async function classTypeNames(db: DbOrTx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(inArray(classTypes.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function membersOf(db: DbOrTx, packageIds: string[]) {
  if (!packageIds.length) return new Map<string, (Member & { name: string })[]>();
  const rows = await db
    .select({ m: clientPackageMembers, first: users.firstName, last: users.lastName })
    .from(clientPackageMembers)
    .innerJoin(users, eq(users.id, clientPackageMembers.userId))
    .where(inArray(clientPackageMembers.packageId, packageIds))
    .orderBy(asc(clientPackageMembers.createdAt));
  const out = new Map<string, (Member & { name: string })[]>();
  for (const r of rows) out.set(r.m.packageId, [...(out.get(r.m.packageId) ?? []), { ...r.m, name: `${r.first} ${r.last}` }]);
  return out;
}

/** What the apps show for a package: state, balance, dates, terms in plain English, and who shares it. */
export async function presentPackages(db: DbOrTx, org: Org, pkgs: Pkg[], viewerId?: string, now = new Date()) {
  const zone = orgZone(org);
  const members = await membersOf(db, pkgs.map((p) => p.id));
  const names = await classTypeNames(db, [...new Set(pkgs.flatMap((p) => p.classTypeIds))]);
  const planIds = [...new Set(pkgs.map((p) => p.planId).filter((x): x is string => !!x))];
  const plans = new Map(
    (planIds.length ? await db.select({ id: packagePlans.id, description: packagePlans.description, photoFileId: packagePlans.photoFileId }).from(packagePlans).where(inArray(packagePlans.id, planIds)) : []).map((p) => [p.id, p]),
  );
  return pkgs.map((p) => {
    const state = packageState(p, now);
    const ms = members.get(p.id) ?? [];
    const mine = viewerId ? ms.find((m) => m.userId === viewerId) : undefined;
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      state,
      stateLabel: OPTION_LABELS.packageState[state],
      /** Renewal payment failed: can't be used to book until it's paid (or it's forfeited). */
      paymentHold: holdReason(p, (d) => friendly(d, zone)),
      forfeited: !!p.forfeitedAt,
      ownerId: p.ownerId,
      creditsTotal: p.creditsTotal,
      creditsLeft: p.creditsLeft,
      /** What the viewer can use themselves (their share, with allocated sharing). */
      ...(mine ? { yourCreditsLeft: p.kind === "unlimited" ? null : p.sharingMode === "allocated" ? mine.allocatedCredits : p.creditsLeft } : {}),
      validUntil: lastDay(p.expiresAt, zone),
      startedOn: p.startedAt ? DateTime.fromJSDate(p.startedAt, { zone }).toISODate() : null,
      firstBookingBy: !p.startedAt && p.activateBy ? lastDay(p.activateBy, zone) : null,
      purchasedOn: DateTime.fromJSDate(p.purchasedAt, { zone }).toISODate(),
      pricePaid: money(p.pricePaidCents, p.currency),
      description: (p.planId && plans.get(p.planId)?.description) || null,
      photoUrl: p.planId && plans.get(p.planId)?.photoFileId ? `/v1/files/${plans.get(p.planId)!.photoFileId}` : null,
      billing: p.billing,
      ...(p.billing === "recurring"
        ? {
            renewal: {
              period: p.cycle,
              renewsOn: state === "active" && !endsAfterThisPeriod(p) ? DateTime.fromJSDate(p.expiresAt!, { zone }).toISODate() : null,
              endsOn: endsAfterThisPeriod(p) ? lastDay(renewalEnd(p, zone), zone) : null,
              stopped: !!p.stopsRenewingAt,
              commitmentUntil: p.commitmentCycles && p.cycle < p.commitmentCycles ? lastDay(commitmentEnd(p, zone), zone) : null,
              endsEarly: p.endsEarly,
            },
          }
        : {}),
      terms: describePackage({ ...p, credits: p.billing === "recurring" ? planCredits(p) : p.creditsTotal }, p.classTypeIds.map((id) => names.get(id) ?? "").filter(Boolean), (c) => money(c, p.currency)),
      sharing: {
        maxUsers: p.maxUsers,
        mode: p.sharingMode,
        spacesLeft: Math.max(0, p.maxUsers - ms.length),
        members: ms.map((m) => ({ userId: m.userId, name: m.name, isOwner: m.userId === p.ownerId, allocatedCredits: m.allocatedCredits })),
      },
      cancelReason: p.cancelReason,
    };
  });
}

/** Packages a person can use: their own and ones shared with them. */
export async function packagesFor(db: DbOrTx, orgId: string, userId: string): Promise<Pkg[]> {
  const rows = await db
    .select({ p: clientPackages })
    .from(clientPackageMembers)
    .innerJoin(clientPackages, eq(clientPackages.id, clientPackageMembers.packageId))
    .where(and(eq(clientPackageMembers.orgId, orgId), eq(clientPackageMembers.userId, userId)))
    .orderBy(asc(clientPackages.purchasedAt));
  return rows.map((r) => r.p);
}

export async function getPackage(db: DbOrTx, orgId: string, id: string, lock = false): Promise<Pkg> {
  const q = db.select().from(clientPackages).where(and(eq(clientPackages.id, id), eq(clientPackages.orgId, orgId)));
  const [p] = lock ? await q.for("update") : await q;
  if (!p) throw notFound("package");
  return p;
}

export async function ledgerFor(db: DbOrTx, packageId: string) {
  return db
    .select({ id: packageLedger.id, change: packageLedger.change, reason: packageLedger.reason, note: packageLedger.note, createdAt: packageLedger.createdAt, bookingId: packageLedger.bookingId, first: users.firstName, last: users.lastName })
    .from(packageLedger)
    .leftJoin(users, eq(users.id, packageLedger.userId))
    .where(eq(packageLedger.packageId, packageId))
    .orderBy(asc(packageLedger.createdAt));
}

// ---------------------------------------------------------------------------
// Which package pays for a class
// ---------------------------------------------------------------------------
export interface PackageOption {
  pkg: Pkg;
  member: Member;
  ok: boolean;
  /** Why it can't be used, in plain English. */
  reason?: string;
  /** When it would stop working if used now (for "use the one that runs out soonest"). */
  runsOutAt: Date | null;
}

/** Bookings this person holds with this package in the class's week (for the package's weekly limit). */
async function weeklyUses(db: DbOrTx, packageId: string, clientId: string, startsAt: Date, zone: TZ, ignoreSessionId?: string) {
  const start = DateTime.fromJSDate(startsAt, { zone }).startOf("week");
  const [r] = await db
    .select({ n: count() })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(
      and(
        eq(bookings.clientPackageId, packageId),
        eq(bookings.clientId, clientId),
        eq(bookings.status, "confirmed"),
        sql`${classSessions.startsAt} >= ${start.toJSDate()} and ${classSessions.startsAt} < ${start.plus({ weeks: 1 }).toJSDate()}`,
        ignoreSessionId ? ne(bookings.sessionId, ignoreSessionId) : undefined,
      ),
    );
  return r?.n ?? 0;
}

/**
 * Every package this client could use for this class, usable ones first, sorted so the
 * one that runs out soonest is used first (nothing goes to waste).
 */
export async function packageOptions(db: DbOrTx, org: Org, clientId: string, session: Pick<SessionRow, "classTypeId" | "startsAt">, now = new Date(), ignoreSessionId?: string): Promise<PackageOption[]> {
  const zone = orgZone(org);
  const rows = await db
    .select({ p: clientPackages, m: clientPackageMembers })
    .from(clientPackageMembers)
    .innerJoin(clientPackages, eq(clientPackages.id, clientPackageMembers.packageId))
    .where(and(eq(clientPackageMembers.orgId, org.id), eq(clientPackageMembers.userId, clientId)));
  const [type] = await db.select({ name: classTypes.name, kind: classTypes.kind }).from(classTypes).where(eq(classTypes.id, session.classTypeId));
  const out: PackageOption[] = [];
  for (const { p, m } of rows) {
    const state = packageState(p, now);
    const runsOutAt = p.startedAt ? p.expiresAt : p.validityValue && p.validityUnit ? expiryFrom(now, p.validityValue, p.validityUnit, zone) : null;
    const no = (reason: string) => out.push({ pkg: p, member: m, ok: false, reason, runsOutAt });
    if (state === "cancelled") { no(p.forfeitedAt ? "It ended because its payment failed" : "It's been cancelled"); continue; }
    const held = holdReason(p, (d) => friendly(d, zone));
    if (held) { no(held); continue; }
    if (state === "expired") {
      no(p.expiresAt && now >= p.expiresAt ? `It expired on ${friendly(new Date(p.expiresAt.getTime() - 1), zone)}` : `It expired because the first class wasn't booked by ${friendly(new Date(p.activateBy!.getTime() - 1), zone)}`);
      continue;
    }
    if (p.classTypeIds.length && !p.classTypeIds.includes(session.classTypeId)) { no(`It doesn't cover ${type?.name ?? "this class"}`); continue; }
    // Appointments need a package made for them: an "every class" pack covers group classes only.
    if (type?.kind === "appointment" && !p.classTypeIds.length) { no(`It covers group classes, not ${type.name} appointments`); continue; }
    if (p.startedAt && session.startsAt < p.startedAt) { no(`It starts on ${friendly(p.startedAt, zone)}, after this class`); continue; }
    if (runsOutAt && session.startsAt >= runsOutAt) { no(`It ${p.startedAt ? "expires" : "would expire"} on ${friendly(new Date(runsOutAt.getTime() - 1), zone)}, before this class`); continue; }
    if (p.kind === "credits") {
      if ((p.creditsLeft ?? 0) <= 0) { no("There are no classes left on it"); continue; }
      if (p.sharingMode === "allocated" && (m.allocatedCredits ?? 0) <= 0) { no("There are no classes left in your share"); continue; }
    }
    if (p.weeklyLimit && (await weeklyUses(db, p.id, clientId, session.startsAt, zone, ignoreSessionId)) >= p.weeklyLimit) {
      no(`It allows ${p.weeklyLimit} ${p.weeklyLimit === 1 ? "class" : "classes"} a week, and that week is full`);
      continue;
    }
    out.push({ pkg: p, member: m, ok: true, runsOutAt });
  }
  const t = (d: Date | null) => d?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return out.sort((a, b) => Number(b.ok) - Number(a.ok) || t(a.runsOutAt) - t(b.runsOutAt) || Number(b.pkg.ownerId === clientId) - Number(a.pkg.ownerId === clientId));
}

/** "None of your packages cover this class: 10-class pack (it expired on 3 Nov 2026)." */
export function whyNoPackage(options: PackageOption[], forClient: boolean, name = "This client") {
  if (!options.length) return forClient ? "You need a package to book this class. You can buy one at the studio." : `${name} doesn't have a package.`;
  const list = options.map((o) => `${o.pkg.name} (${o.reason!.charAt(0).toLowerCase()}${o.reason!.slice(1)})`).join("; ");
  return `${forClient ? "None of your packages" : `None of ${name}'s packages`} can be used for this class: ${list}.`;
}

/** Take one class from a package for a booking, starting its countdown if this is the first booking. */
export async function useCredit(tx: DbOrTx, org: Org, opt: PackageOption, bookingId: string, clientId: string, actorId: string | null, now = new Date()) {
  const p = opt.pkg;
  if (!p.startedAt && p.startsOn === "first_booking") {
    const expiresAt = p.validityValue && p.validityUnit ? expiryFrom(now, p.validityValue, p.validityUnit, orgZone(org)) : null;
    const [started] = await tx.update(clientPackages).set({ startedAt: now, expiresAt }).where(and(eq(clientPackages.id, p.id), isNull(clientPackages.startedAt))).returning({ id: clientPackages.id });
    if (started) {
      await tx.insert(packageLedger).values({ orgId: org.id, packageId: p.id, userId: clientId, bookingId, change: 0, reason: "activated", note: "Countdown started with the first booking", details: { validUntil: lastDay(expiresAt, orgZone(org)) }, createdBy: actorId });
    }
  }
  if (p.kind !== "credits") return;
  // Done as a guarded update so two bookings at once can't take the last class twice.
  const [taken] = await tx
    .update(clientPackages)
    .set({ creditsLeft: sql`${clientPackages.creditsLeft} - 1` })
    .where(and(eq(clientPackages.id, p.id), sql`${clientPackages.creditsLeft} >= 1`))
    .returning({ id: clientPackages.id });
  if (!taken) throw conflict("package_used_up", `${p.name} has just run out of classes.`);
  if (p.sharingMode === "allocated") {
    const [share] = await tx
      .update(clientPackageMembers)
      .set({ allocatedCredits: sql`${clientPackageMembers.allocatedCredits} - 1` })
      .where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, clientId), sql`${clientPackageMembers.allocatedCredits} >= 1`))
      .returning({ id: clientPackageMembers.userId });
    if (!share) throw conflict("package_used_up", "There are no classes left in your share of this package.");
  }
  await tx.insert(packageLedger).values({ orgId: org.id, packageId: p.id, userId: clientId, bookingId, change: -1, reason: "booked", createdBy: actorId });
  if ((p.creditsLeft ?? 0) - 1 <= 0) await clientEvent(tx, org.id, p.ownerId, { type: "package_used_up", ref: p.id }, now);
}

/**
 * Give a booking's class back to its package (cancelled in time, moved, or refunded).
 * Returns what happened so the app can say so. Unlimited packages have nothing to give back.
 */
export async function returnCredit(
  tx: DbOrTx,
  org: Org,
  booking: { id: string; clientId: string; clientPackageId: string | null; payment: string },
  reason: "returned" | "refunded",
  actorId: string | null,
  note?: string,
  flags?: Flags,
  now = new Date(),
): Promise<{ returned: boolean; packageName?: string }> {
  if (booking.payment !== "package" || !booking.clientPackageId) return { returned: false };
  const p = await getPackage(tx, org.id, booking.clientPackageId, true);
  if (p.kind !== "credits") return { returned: false, packageName: p.name };
  await tx.update(clientPackages).set({ creditsLeft: sql`${clientPackages.creditsLeft} + 1` }).where(eq(clientPackages.id, p.id));
  if (p.sharingMode === "allocated") {
    // Back to whoever used it, or to the buyer if that person no longer shares the package.
    const [back] = await tx
      .update(clientPackageMembers)
      .set({ allocatedCredits: sql`coalesce(${clientPackageMembers.allocatedCredits}, 0) + 1` })
      .where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, booking.clientId)))
      .returning({ id: clientPackageMembers.userId });
    if (!back) await tx.update(clientPackageMembers).set({ allocatedCredits: sql`coalesce(${clientPackageMembers.allocatedCredits}, 0) + 1` }).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, p.ownerId)));
  }
  await tx.insert(packageLedger).values({ orgId: org.id, packageId: p.id, userId: booking.clientId, bookingId: booking.id, change: 1, reason, note: note ?? null, createdBy: actorId });
  const state = packageState({ ...p, creditsLeft: (p.creditsLeft ?? 0) + 1 }, now);
  if (state === "expired" || state === "cancelled") {
    flags?.info({
      code: "package_expired",
      message: `The class went back to ${p.name}, but that package ${state === "expired" ? "has expired" : "was cancelled"}, so it can't be used unless an admin ${state === "expired" ? "extends it" : "sells a new one"}.`,
    });
  }
  return { returned: true, packageName: p.name };
}

// ---------------------------------------------------------------------------
// Selling, adjusting and cancelling (admins)
// ---------------------------------------------------------------------------
export async function getPlan(db: DbOrTx, orgId: string, id: string) {
  const [p] = await db.select().from(packagePlans).where(and(eq(packagePlans.id, id), eq(packagePlans.orgId, orgId)));
  if (!p) throw notFound("package type");
  return p;
}

async function assertClient(db: DbOrTx, orgId: string, userId: string) {
  const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId), eq(memberships.role, "client")));
  if (!m) throw notFound("client");
}

export async function sellPackage(
  tx: DbOrTx,
  auth: AuthContext,
  clientId: string,
  input: { planId: string; startDate?: string; pricePaidCents?: number; note?: string; notifyClient: boolean },
  now = new Date(),
) {
  if (!isManager(auth)) throw forbidden("Only admins can sell packages.");
  await assertClient(tx, auth.orgId, clientId);
  const org = await getOrg(tx, auth.orgId);
  const zone = orgZone(org);
  const plan = await getPlan(tx, auth.orgId, input.planId);
  if (plan.archivedAt) throw conflict("not_on_sale", `${plan.name} has been archived. Restore it under Packages to sell it.`);
  if (!plan.onSale) throw conflict("not_on_sale", `${plan.name} isn't on sale. Switch it back on under Packages to sell it.`);
  if (input.startDate && plan.startsOn !== "purchase") throw badRequest("start_date_not_needed", "This package starts at the first booking, so it doesn't need a start date.");
  const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
  if (input.startDate && input.startDate < today) throw badRequest("start_in_past", "Choose today or a later start date.");

  const startedAt = plan.startsOn === "purchase" ? (input.startDate ? DateTime.fromISO(input.startDate, { zone }).startOf("day").toJSDate() : now) : null;
  const expiresAt = startedAt && plan.validityValue && plan.validityUnit ? expiryFrom(startedAt, plan.validityValue, plan.validityUnit, zone) : null;
  const activateBy = plan.startsOn === "first_booking" && plan.activateWithinDays ? DateTime.fromJSDate(now, { zone }).startOf("day").plus({ days: plan.activateWithinDays + 1 }).toJSDate() : null;

  const [p] = await tx
    .insert(clientPackages)
    .values({
      orgId: auth.orgId,
      planId: plan.id,
      ownerId: clientId,
      name: plan.name,
      kind: plan.kind,
      creditsTotal: plan.credits,
      creditsLeft: plan.kind === "credits" ? plan.credits : null,
      validityValue: plan.validityValue,
      validityUnit: plan.validityUnit,
      startsOn: plan.startsOn,
      activateBy,
      startedAt,
      expiresAt,
      maxUsers: plan.maxUsers,
      sharingMode: plan.sharingMode,
      weeklyLimit: plan.weeklyLimit,
      classTypeIds: plan.classTypeIds,
      billing: plan.billing,
      rolloverCap: plan.rolloverCap,
      commitmentCycles: plan.commitmentCycles,
      creditsPerCycle: plan.billing === "recurring" ? plan.credits : null,
      earlyCancelFeeMode: plan.earlyCancelFeeMode,
      earlyCancelFeeCents: plan.earlyCancelFeeCents,
      pricePaidCents: input.pricePaidCents ?? plan.priceCents,
      currency: org.currency,
      soldBy: auth.userId,
      note: input.note ?? null,
      purchasedAt: now,
    })
    .returning();
  await tx.insert(clientPackageMembers).values({ orgId: auth.orgId, packageId: p!.id, userId: clientId, allocatedCredits: p!.sharingMode === "allocated" ? p!.creditsLeft : null, addedBy: auth.userId });
  await tx.insert(packageLedger).values({ orgId: auth.orgId, packageId: p!.id, userId: clientId, change: p!.kind === "credits" ? p!.creditsLeft! : 0, reason: "purchase", note: `Bought for ${money(p!.pricePaidCents, p!.currency)}`, createdAt: now, createdBy: auth.userId });
  if (startedAt) await tx.insert(packageLedger).values({ orgId: auth.orgId, packageId: p!.id, userId: clientId, change: 0, reason: "activated", note: input.startDate ? "Starts on the chosen date" : "Started when bought", details: { validUntil: lastDay(expiresAt, zone) }, createdAt: startedAt > now ? startedAt : new Date(now.getTime() + 1), createdBy: auth.userId });
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "package.sold", entityType: "client_package", entityId: p!.id, details: { planId: plan.id, clientId } });
  if (input.notifyClient) {
    const [shown] = await presentPackages(tx, org, [p!], clientId, now);
    await notify(tx, { orgId: auth.orgId, userIds: [clientId], template: "package.added", data: { packageName: p!.name, terms: shown!.terms.join(". ") } });
  }
  await clientEvent(tx, auth.orgId, clientId, { type: "package_bought", planId: plan.id, ref: p!.id }, now);
  await loyaltyForSpend(tx, auth.orgId, clientId, p!.pricePaidCents, "package", p!.id, p!.name, now);
  await adsOnPurchase(tx, auth.orgId, clientId, p!.pricePaidCents, now);
  return (await presentPackages(tx, org, [p!], undefined, now))[0]!;
}

export async function adjustPackage(tx: DbOrTx, auth: AuthContext, id: string, input: { credits?: number; validUntil?: string; reason: string }, now = new Date()) {
  if (!isManager(auth)) throw forbidden("Only admins can change packages.");
  const org = await getOrg(tx, auth.orgId);
  const zone = orgZone(org);
  const p = await getPackage(tx, auth.orgId, id, true);
  if (p.cancelledAt) throw conflict("package_cancelled", "This package was cancelled, so it can't be changed.");
  const set: Partial<Pkg> = {};
  if (input.credits !== undefined) {
    if (p.kind !== "credits") throw badRequest("unlimited", "Unlimited packages don't have classes to add or remove. Change the expiry date instead.");
    const left = (p.creditsLeft ?? 0) + input.credits;
    if (left < 0) throw badRequest("too_many", `There ${p.creditsLeft === 1 ? "is only 1 class" : `are only ${p.creditsLeft} classes`} left to remove.`);
    if (p.sharingMode === "allocated") {
      const [owner] = await tx.select().from(clientPackageMembers).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, p.ownerId)));
      if ((owner?.allocatedCredits ?? 0) + input.credits < 0) throw badRequest("in_other_shares", `Only ${owner?.allocatedCredits ?? 0} of the classes left are in the buyer's own share. Move some back from the people sharing it first.`);
      await tx.update(clientPackageMembers).set({ allocatedCredits: sql`coalesce(${clientPackageMembers.allocatedCredits}, 0) + ${input.credits}` }).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, p.ownerId)));
    }
    Object.assign(set, { creditsLeft: left, creditsTotal: (p.creditsTotal ?? 0) + input.credits });
    await tx.insert(packageLedger).values({ orgId: auth.orgId, packageId: p.id, change: input.credits, reason: "adjusted", note: input.reason, createdBy: auth.userId });
  }
  if (input.validUntil) {
    const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
    if (input.validUntil < today) throw badRequest("date_in_past", "Choose today or a later date.");
    // Not started yet: the date is the deadline for the first booking.
    if (!p.startedAt && p.startsOn === "first_booking") set.activateBy = startOfDayAfter(input.validUntil, zone);
    else set.expiresAt = startOfDayAfter(input.validUntil, zone);
    const before = !p.startedAt && p.startsOn === "first_booking" ? lastDay(p.activateBy, zone) : lastDay(p.expiresAt, zone);
    await tx.insert(packageLedger).values({
      orgId: auth.orgId, packageId: p.id, change: 0, reason: "expiry_changed", note: input.reason, createdBy: auth.userId,
      details: { field: set.activateBy ? "firstBookingBy" : "validUntil", from: before, to: input.validUntil },
    });
  }
  const [u] = await tx.update(clientPackages).set(set).where(eq(clientPackages.id, p.id)).returning();
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "package.adjusted", entityType: "client_package", entityId: p.id, details: input });
  return (await presentPackages(tx, org, [u!], undefined, now))[0]!;
}

export async function cancelPackage(tx: DbOrTx, auth: AuthContext, id: string, reason: string, flags: Flags, now = new Date()) {
  if (!isManager(auth)) throw forbidden("Only admins can cancel packages.");
  const org = await getOrg(tx, auth.orgId);
  const p = await getPackage(tx, auth.orgId, id, true);
  if (p.cancelledAt) throw conflict("package_cancelled", "This package is already cancelled.");
  const [upcoming] = await tx
    .select({ n: count() })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.clientPackageId, p.id), eq(bookings.status, "confirmed"), sql`${classSessions.startsAt} > ${now}`));
  if (upcoming?.n) flags.info({ code: "clients_affected", message: `${upcoming.n} upcoming ${upcoming.n === 1 ? "booking was" : "bookings were"} made with this package. ${upcoming.n === 1 ? "It stays" : "They stay"} booked; cancel ${upcoming.n === 1 ? "it" : "them"} separately if needed.` });
  const [u] = await tx.update(clientPackages).set({ cancelledAt: now, cancelReason: reason }).where(eq(clientPackages.id, p.id)).returning();
  await tx.insert(packageLedger).values({ orgId: auth.orgId, packageId: p.id, change: 0, reason: "cancelled", note: reason, createdBy: auth.userId });
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "package.cancelled", entityType: "client_package", entityId: p.id, details: { reason } });
  return (await presentPackages(tx, org, [u!], undefined, now))[0]!;
}

// ---------------------------------------------------------------------------
// Sharing (the buyer or an admin)
// ---------------------------------------------------------------------------
async function canManageSharing(tx: DbOrTx, auth: AuthContext, id: string) {
  const p = await getPackage(tx, auth.orgId, id, true);
  if (!isManager(auth) && p.ownerId !== auth.userId) {
    // People it's shared with can see it, but only the buyer (or an admin) changes who shares it.
    throw auth.role === "client" ? forbidden("Only the person who bought this package can change who shares it.") : forbidden();
  }
  return p;
}

export async function addSharer(tx: DbOrTx, auth: AuthContext, id: string, input: { email?: string; clientId?: string }, now = new Date()) {
  const p = await canManageSharing(tx, auth, id);
  const org = await getOrg(tx, auth.orgId);
  if (p.maxUsers <= 1) throw badRequest("not_shareable", "This package can't be shared.");
  const state = packageState(p, now);
  if (state === "cancelled" || state === "expired") throw conflict("package_inactive", `This package has ${state === "expired" ? "expired" : "been cancelled"}, so it can't be shared.`);
  const [person] = await tx
    .select({ id: users.id, first: users.firstName })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, auth.orgId), eq(memberships.role, "client")))
    .where(input.clientId ? eq(users.id, input.clientId) : sql`lower(${users.email}) = lower(${input.email!})`);
  if (!person) throw input.email ? badRequest("no_account", "No one with that email has an account with the studio yet. Ask them to sign up first, then add them.") : notFound("client");
  const current = await tx.select().from(clientPackageMembers).where(eq(clientPackageMembers.packageId, p.id));
  if (current.some((m) => m.userId === person.id)) throw conflict("already_sharing", `${person.first} already shares this package.`);
  if (current.length >= p.maxUsers) throw conflict("package_full", `This package can be shared by up to ${p.maxUsers} people, including the buyer, and it's full.`);
  await tx.insert(clientPackageMembers).values({ orgId: auth.orgId, packageId: p.id, userId: person.id, allocatedCredits: p.sharingMode === "allocated" ? 0 : null, addedBy: auth.userId });
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "package.shared", entityType: "client_package", entityId: p.id, details: { userId: person.id } });
  await notify(tx, {
    orgId: auth.orgId,
    userIds: [person.id],
    template: "package.shared",
    data: { packageName: p.name, ownerName: await userName(tx, p.ownerId), allocated: p.sharingMode === "allocated" },
  });
  return (await presentPackages(tx, org, [p], undefined, now))[0]!;
}

export async function removeSharer(tx: DbOrTx, auth: AuthContext, id: string, userId: string, now = new Date()) {
  const p = await getPackage(tx, auth.orgId, id, true);
  // The buyer or an admin can remove anyone; people it's shared with can remove themselves.
  if (!isManager(auth) && p.ownerId !== auth.userId && userId !== auth.userId) throw forbidden();
  if (userId === p.ownerId) throw badRequest("owner", "The buyer can't be removed from their own package.");
  const [m] = await tx.delete(clientPackageMembers).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, userId))).returning();
  if (!m) throw notFound("person");
  // Their unused share goes back to the buyer.
  if (p.sharingMode === "allocated" && m.allocatedCredits) {
    await tx.update(clientPackageMembers).set({ allocatedCredits: sql`coalesce(${clientPackageMembers.allocatedCredits}, 0) + ${m.allocatedCredits}` }).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, p.ownerId)));
  }
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "package.unshared", entityType: "client_package", entityId: p.id, details: { userId } });
  return (await presentPackages(tx, await getOrg(tx, auth.orgId), [p], undefined, now))[0]!;
}

/** Allocated sharing: set how many classes each person sharing gets. The buyer keeps the rest. */
export async function setAllocations(tx: DbOrTx, auth: AuthContext, id: string, allocations: { userId: string; credits: number }[], now = new Date()) {
  const p = await canManageSharing(tx, auth, id);
  if (p.sharingMode !== "allocated") throw badRequest("pool", "Everyone sharing this package uses one pool of classes, so there's nothing to split.");
  const members = await tx.select().from(clientPackageMembers).where(eq(clientPackageMembers.packageId, p.id));
  const others = allocations.filter((a) => a.userId !== p.ownerId);
  for (const a of others) if (!members.some((m) => m.userId === a.userId)) throw badRequest("not_sharing", "Someone in the list doesn't share this package.");
  const given = others.reduce((n, a) => n + a.credits, 0);
  const left = p.creditsLeft ?? 0;
  if (given > left) throw badRequest("too_many", `That shares out ${given} classes, but only ${left} ${left === 1 ? "is" : "are"} left.`);
  for (const m of members) {
    if (m.userId === p.ownerId) continue;
    const a = others.find((x) => x.userId === m.userId);
    if (a) await tx.update(clientPackageMembers).set({ allocatedCredits: a.credits }).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, m.userId)));
  }
  // Recalculate the buyer's share from what everyone else now holds.
  const after = await tx.select().from(clientPackageMembers).where(eq(clientPackageMembers.packageId, p.id));
  const othersHold = after.filter((m) => m.userId !== p.ownerId).reduce((n, m) => n + (m.allocatedCredits ?? 0), 0);
  if (othersHold > left) throw badRequest("too_many", `That shares out ${othersHold} classes, but only ${left} ${left === 1 ? "is" : "are"} left.`);
  await tx.update(clientPackageMembers).set({ allocatedCredits: left - othersHold }).where(and(eq(clientPackageMembers.packageId, p.id), eq(clientPackageMembers.userId, p.ownerId)));
  await audit(tx, { orgId: auth.orgId, actorId: auth.userId, action: "package.allocations_set", entityType: "client_package", entityId: p.id, details: { allocations } });
  return (await presentPackages(tx, await getOrg(tx, auth.orgId), [p], undefined, now))[0]!;
}
