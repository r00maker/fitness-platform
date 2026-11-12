/**
 * Segments: "clients who…". Each rule is worked out with one grouped query over the studio's
 * clients, then rules are combined (all / any). Always live, never cached, so a segment can't
 * go stale; a studio's client list is small enough for this to stay quick.
 */
import { and, count, eq, gt, gte, inArray, isNull, max, ne, sum } from "drizzle-orm";
import type { SegmentDefinition, SegmentRule } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import {
  bookings,
  classSessions,
  clientPackageMembers,
  clientPackages,
  clientTagAssignments,
  creditGrants,
  fees,
  memberships,
  orders,
  referrals,
  refunds,
} from "../../db/schema.js";
import { getOrg } from "../sessions/context.js";
import { packageState } from "../packages/service.js";
import { waiverStatuses } from "../clients/waivers.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
const DAY = 86_400_000;

/** Every client in the studio (active memberships). */
export async function allClients(db: DbOrTx, orgId: string): Promise<string[]> {
  const rows = await db.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client"), eq(memberships.active, true)));
  return rows.map((r) => r.id);
}

const since = (now: Date, days?: number) => (days ? new Date(now.getTime() - days * DAY) : null);
const toMap = (rows: { id: string; n: unknown }[]) => new Map(rows.map((r) => [r.id, Number(r.n ?? 0)]));

/** Classes attended per client (optionally since a date, or filtered by class type, instructor or location). */
async function attended(db: DbOrTx, orgId: string, from: Date | null, extra?: ReturnType<typeof and>) {
  const rows = await db
    .select({ id: bookings.clientId, n: count() })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.orgId, orgId), eq(bookings.attendance, "present"), from ? gte(classSessions.startsAt, from) : undefined, extra))
    .groupBy(bookings.clientId);
  return toMap(rows);
}

/** What each client has paid, minus money refunded. Credit and gifts received aren't spending. */
export async function nettSpend(db: DbOrTx, orgId: string, from: Date | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const add = (rows: { id: string; n: unknown }[], sign = 1) => rows.forEach((r) => out.set(r.id, (out.get(r.id) ?? 0) + sign * Number(r.n ?? 0)));
  add(
    await db
      .select({ id: clientPackages.ownerId, n: sum(clientPackages.pricePaidCents) })
      .from(clientPackages)
      .where(and(eq(clientPackages.orgId, orgId), from ? gte(clientPackages.purchasedAt, from) : undefined))
      .groupBy(clientPackages.ownerId),
  );
  add(
    await db
      .select({ id: fees.clientId, n: sum(fees.amountCents) })
      .from(fees)
      .where(and(eq(fees.orgId, orgId), eq(fees.status, "charged"), from ? gte(fees.createdAt, from) : undefined))
      .groupBy(fees.clientId),
  );
  add(
    await db
      .select({ id: orders.clientId, n: sum(orders.amountCents) })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), eq(orders.kind, "gift_card"), eq(orders.status, "paid"), from ? gte(orders.paidAt, from) : undefined))
      .groupBy(orders.clientId),
  );
  add(
    await db
      .select({ id: bookings.clientId, n: sum(refunds.amountCents) })
      .from(refunds)
      .innerJoin(bookings, eq(bookings.id, refunds.bookingId))
      .where(and(eq(refunds.orgId, orgId), eq(refunds.method, "original_payment"), from ? gte(refunds.createdAt, from) : undefined))
      .groupBy(bookings.clientId),
    -1,
  );
  return out;
}

/** Usable packages per client: classes left, soonest expiry and membership state. */
async function packageFacts(db: DbOrTx, orgId: string, now: Date) {
  const rows = await db
    .select({ p: clientPackages, userId: clientPackageMembers.userId, allocated: clientPackageMembers.allocatedCredits })
    .from(clientPackageMembers)
    .innerJoin(clientPackages, eq(clientPackages.id, clientPackageMembers.packageId))
    .where(and(eq(clientPackageMembers.orgId, orgId), isNull(clientPackages.cancelledAt)));
  const facts = new Map<string, { usable: boolean; credits: number; expires: Date | null; membership: "active" | "stopping" | "none" }>();
  for (const { p, userId, allocated } of rows) {
    const state = packageState(p, now);
    if (state !== "active" && state !== "not_started") continue;
    const f = facts.get(userId) ?? { usable: false, credits: 0, expires: null, membership: "none" as const };
    f.usable = true;
    if (p.kind === "credits") f.credits += p.sharingMode === "allocated" ? (allocated ?? 0) : (p.creditsLeft ?? 0);
    if (p.expiresAt && (!f.expires || p.expiresAt < f.expires)) f.expires = p.expiresAt;
    if (p.billing === "recurring" && userId === p.ownerId) f.membership = p.stopsRenewingAt ? (f.membership === "active" ? "active" : "stopping") : "active";
    facts.set(userId, f);
  }
  return facts;
}

const cmp = (n: number, r: { op: string; value: number; value2?: number }) =>
  r.op === "at_least" ? n >= r.value : r.op === "at_most" ? n <= r.value : n >= r.value && n <= (r.value2 ?? r.value);

/** The clients (from `universe`) a single rule matches. */
async function matchRule(db: DbOrTx, org: Org, rule: SegmentRule, universe: string[], now: Date): Promise<Set<string>> {
  const orgId = org.id;
  const from = since(now, "withinDays" in rule ? rule.withinDays : undefined);
  const byNumber = (m: Map<string, number>, r: { op: string; value: number; value2?: number }, missing: number | null = 0) =>
    new Set(universe.filter((id) => { const v = m.has(id) ? m.get(id)! : missing; return v !== null && cmp(v, r); }));
  const memberRows = async () => db.select().from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.role, "client")));

  switch (rule.field) {
    case "classesAttended":
      return byNumber(await attended(db, orgId, from), rule as never);
    case "daysSinceLastClass": {
      const rows = await db
        .select({ id: bookings.clientId, last: max(classSessions.startsAt) })
        .from(bookings)
        .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
        .where(and(eq(bookings.orgId, orgId), eq(bookings.attendance, "present")))
        .groupBy(bookings.clientId);
      const days = new Map(rows.map((r) => [r.id, Math.floor((now.getTime() - new Date(r.last as unknown as string).getTime()) / DAY)]));
      return byNumber(days, rule as never, null);
    }
    case "upcomingBookings": {
      const rows = await db
        .select({ id: bookings.clientId, n: count() })
        .from(bookings)
        .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
        .where(and(eq(bookings.orgId, orgId), eq(bookings.status, "confirmed"), eq(classSessions.status, "scheduled"), gt(classSessions.startsAt, now)))
        .groupBy(bookings.clientId);
      return byNumber(toMap(rows), rule as never);
    }
    case "noShows": {
      const rows = await db
        .select({ id: bookings.clientId, n: count() })
        .from(bookings)
        .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
        .where(and(eq(bookings.orgId, orgId), eq(bookings.attendance, "no_show"), from ? gte(classSessions.startsAt, from) : undefined))
        .groupBy(bookings.clientId);
      return byNumber(toMap(rows), rule as never);
    }
    case "lateCancels": {
      const rows = await db
        .select({ id: bookings.clientId, n: count() })
        .from(bookings)
        .where(and(eq(bookings.orgId, orgId), eq(bookings.status, "late_cancelled"), from ? gte(bookings.cancelledAt, from) : undefined))
        .groupBy(bookings.clientId);
      return byNumber(toMap(rows), rule as never);
    }
    case "classTypes":
    case "instructors":
    case "locations": {
      const ids = (rule as { ids: string[] }).ids;
      const col = rule.field === "classTypes" ? classSessions.classTypeId : rule.field === "instructors" ? classSessions.instructorId : classSessions.locationId;
      const m = await attended(db, orgId, from, and(inArray(col, ids)));
      return new Set(universe.filter((id) => (m.get(id) ?? 0) > 0));
    }
    case "nettSpend":
      return byNumber(await nettSpend(db, orgId, from), rule as never);
    case "hasActivePackage":
    case "creditsLeft":
    case "daysUntilExpiry":
    case "membership": {
      const facts = await packageFacts(db, orgId, now);
      if (rule.field === "hasActivePackage") return new Set(universe.filter((id) => !!facts.get(id)?.usable === ((rule as { value: string }).value === "yes")));
      if (rule.field === "membership") return new Set(universe.filter((id) => (facts.get(id)?.membership ?? "none") === (rule as { value: string }).value));
      if (rule.field === "creditsLeft") return byNumber(new Map([...facts].map(([k, f]) => [k, f.credits])), rule as never);
      const days = new Map([...facts].filter(([, f]) => f.expires).map(([k, f]) => [k, Math.max(0, Math.ceil((f.expires!.getTime() - now.getTime()) / DAY))]));
      return byNumber(days, rule as never, null);
    }
    case "packageTypes": {
      const rows = await db
        .selectDistinct({ id: clientPackages.ownerId })
        .from(clientPackages)
        .where(and(eq(clientPackages.orgId, orgId), inArray(clientPackages.planId, (rule as { ids: string[] }).ids), from ? gte(clientPackages.purchasedAt, from) : undefined));
      const set = new Set(rows.map((r) => r.id));
      return new Set(universe.filter((id) => set.has(id)));
    }
    case "studioCredit":
      return byNumber(await creditBalances(db, orgId, now), rule as never);
    case "daysSinceJoined": {
      const rows = await memberRows();
      return byNumber(new Map(rows.map((m) => [m.userId, Math.floor((now.getTime() - m.createdAt.getTime()) / DAY)])), rule as never, null);
    }
    case "source":
    case "acquisition":
    case "marketingEmail": {
      const v = (rule as { value: string }).value;
      const rows = await memberRows();
      const ok = new Set(rows.filter((m) => (rule.field === "source" ? m.source === v : rule.field === "acquisition" ? m.acquisition === v : m.marketingEmail === (v === "yes"))).map((m) => m.userId));
      return new Set(universe.filter((id) => ok.has(id)));
    }
    case "tags":
    case "notTags": {
      const rows = await db
        .selectDistinct({ id: clientTagAssignments.clientId })
        .from(clientTagAssignments)
        .where(and(eq(clientTagAssignments.orgId, orgId), inArray(clientTagAssignments.tagId, (rule as { ids: string[] }).ids)));
      const has = new Set(rows.map((r) => r.id));
      return new Set(universe.filter((id) => (rule.field === "tags" ? has.has(id) : !has.has(id))));
    }
    case "waiver": {
      const statuses = await waiverStatuses(db, org, universe);
      const want = (rule as { value: string }).value;
      return new Set(universe.filter((id) => { const s = statuses.get(id)!.status; return want === "done" ? s !== "missing" : s === "missing"; }));
    }
    case "referrals": {
      const rows = await db
        .select({ id: referrals.referrerId, n: count() })
        .from(referrals)
        .where(and(eq(referrals.orgId, orgId), ne(referrals.status, "void")))
        .groupBy(referrals.referrerId);
      return byNumber(toMap(rows), rule as never);
    }
    case "wasReferred": {
      const rows = await db.select({ id: referrals.refereeId }).from(referrals).where(and(eq(referrals.orgId, orgId), ne(referrals.status, "void")));
      const set = new Set(rows.map((r) => r.id));
      const want = (rule as { value: string }).value === "yes";
      return new Set(universe.filter((id) => set.has(id) === want));
    }
  }
  return new Set();
}

/** Studio credit each client can spend now. */
export async function creditBalances(db: DbOrTx, orgId: string, now: Date, clientIds?: string[]) {
  const rows = await db
    .select({ id: creditGrants.clientId, n: sum(creditGrants.remainingCents) })
    .from(creditGrants)
    .where(and(eq(creditGrants.orgId, orgId), gt(creditGrants.expiresAt, now), gt(creditGrants.remainingCents, 0), clientIds?.length ? inArray(creditGrants.clientId, clientIds) : undefined))
    .groupBy(creditGrants.clientId);
  return toMap(rows);
}

/** The clients a segment matches. Pass `universe` to check only some clients (e.g. one person in a journey). */
export async function matchSegment(db: DbOrTx, orgId: string, def: SegmentDefinition, opts: { universe?: string[]; now?: Date } = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  const universe = opts.universe ?? (await allClients(db, orgId));
  if (!def.rules.length || !universe.length) return universe;
  const org = await getOrg(db, orgId);
  let result: Set<string> | null = null;
  for (const rule of def.rules) {
    const m = await matchRule(db, org, rule, def.match === "all" && result ? [...result] : universe, now);
    if (def.match === "all") result = m;
    else result = new Set([...(result ?? []), ...m]);
    if (def.match === "all" && result.size === 0) break;
  }
  return universe.filter((id) => result!.has(id));
}

/** One rule for one client (journeys' yes/no checks). */
export async function clientMatches(db: DbOrTx, orgId: string, clientId: string, rule: SegmentRule, now = new Date()) {
  return (await matchSegment(db, orgId, { match: "all", rules: [rule] }, { universe: [clientId], now })).length === 1;
}

/** The numbers shown beside each client in filtered lists. */
export async function clientStats(db: DbOrTx, orgId: string, ids: string[], now = new Date()) {
  if (!ids.length) return new Map<string, { classesAttended: number; lastClassAt: Date | null; nettSpendCents: number; studioCreditCents: number }>();
  const att = await db
    .select({ id: bookings.clientId, n: count(), last: max(classSessions.startsAt) })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.orgId, orgId), eq(bookings.attendance, "present"), inArray(bookings.clientId, ids)))
    .groupBy(bookings.clientId);
  const a = new Map(att.map((r) => [r.id, r]));
  const spend = await nettSpend(db, orgId, null);
  const credit = await creditBalances(db, orgId, now, ids);
  return new Map(
    ids.map((id) => [
      id,
      {
        classesAttended: Number(a.get(id)?.n ?? 0),
        lastClassAt: a.get(id)?.last ? new Date(a.get(id)!.last as unknown as string) : null,
        nettSpendCents: spend.get(id) ?? 0,
        studioCreditCents: credit.get(id) ?? 0,
      },
    ]),
  );
}

/** Classes attended, for the given clients. */
export async function attendedCounts(db: DbOrTx, orgId: string, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  return attended(db, orgId, null, and(inArray(bookings.clientId, ids)));
}

/** Classes left across each client's usable credit packs. */
export async function creditsLeft(db: DbOrTx, orgId: string, ids: string[], now = new Date()) {
  const facts = await packageFacts(db, orgId, now);
  return new Map(ids.map((id) => [id, facts.get(id)?.credits ?? 0]));
}
