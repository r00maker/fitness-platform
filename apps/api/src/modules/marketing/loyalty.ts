/**
 * Loyalty: points (named by the studio, e.g. "Petals") earned per class attended or per amount
 * spent, swapped for rewards: free classes, a discount, studio credit, a gift card, or something
 * special handed over in person.
 *
 * Points are kept in lots (one per class, purchase or adjustment) and spent oldest first. Expiry:
 *  - inactivity (recommended): everything expires after N months without a class, earn or redeem
 *  - fixed: each lot expires N months after it was earned
 *  - never
 * Expiry is worked out from the current setting, so changing it applies to everyone at once.
 * Clients are reminded two weeks before points expire.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, inArray, isNull, sql, sum } from "drizzle-orm";
import { DateTime } from "luxon";
import { LOYALTY_EARN, LOYALTY_EXPIRY, LOYALTY_REWARD_KINDS, describeReward, loyaltyAdjust, loyaltyRewardInput, loyaltySettings, pointsText, schemas, type Reward } from "@studio/shared";
import { z } from "zod";
import type { Db, DbOrTx } from "../../db/client.js";
import { files, giftCardDesigns, giftCards, loyaltyLedger, loyaltyLots, loyaltyRedemptions, loyaltyRewards, memberships, organizations } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { publicFileUrl } from "../files/routes.js";
import { notify } from "../notifications/outbox.js";
import { getOrg } from "../sessions/context.js";
import { endOfDayAfter, giveReward } from "./credit.js";
import { giftCode } from "./giftcards.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
type Lot = typeof loyaltyLots.$inferSelect;
type RewardRow = typeof loyaltyRewards.$inferSelect;
const WARN_DAYS = 14;

export const fmtPoints = (org: Org, n: number) => pointsText(n, org.loyaltyName, org.loyaltyNamePlural);
const plusMonths = (d: Date, months: number, zone: string) => DateTime.fromJSDate(d, { zone }).plus({ months }).endOf("day").toJSDate();
const fmtDate = (d: Date, zone: string) => DateTime.fromJSDate(d, { zone }).toFormat("d LLL yyyy");

/** How the studio's programme works, in plain English. */
export function loyaltyRules(org: Org) {
  const p = (n: number) => fmtPoints(org, n);
  const earn = org.loyaltyEarn === "classes" ? `Earn ${p(org.loyaltyPointsPerClass)} for every class you attend.` : `Earn ${p(org.loyaltyPointsPerUnit)} for every ${money(100, org.currency)} you spend.`;
  const expiry =
    org.loyaltyExpiry === "never" ? `Your ${org.loyaltyNamePlural} never expire.`
    : org.loyaltyExpiry === "inactivity" ? `Your ${org.loyaltyNamePlural} stay as long as you keep coming: they expire only if you don't come to a class, earn or redeem for ${org.loyaltyExpiryMonths} ${org.loyaltyExpiryMonths === 1 ? "month" : "months"}. We'll remind you first.`
    : `Each ${org.loyaltyName} lasts ${org.loyaltyExpiryMonths} ${org.loyaltyExpiryMonths === 1 ? "month" : "months"} from when you earn it. The oldest are used first, and we'll remind you before any expire.`;
  return { earn, expiry, redeem: `Choose a reward and tap Redeem. Most are added to your account straight away; for in-person rewards, show the code at the front desk.` };
}

// ---------------------------------------------------------------------------
// Balance and expiry
// ---------------------------------------------------------------------------
async function lotsOf(db: DbOrTx, orgId: string, clientId: string, lock = false) {
  const q = db.select().from(loyaltyLots).where(and(eq(loyaltyLots.orgId, orgId), eq(loyaltyLots.clientId, clientId), gt(loyaltyLots.remaining, 0))).orderBy(asc(loyaltyLots.earnedAt));
  return lock ? q.for("update") : q;
}
async function activeAt(db: DbOrTx, orgId: string, clientId: string) {
  const [m] = await db.select({ at: memberships.loyaltyActiveAt }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, clientId)));
  return m?.at ?? null;
}
/** When each lot expires under the current setting (null = never). */
function expiryOf(org: Org, lot: Lot, lastActive: Date | null): Date | null {
  if (org.loyaltyExpiry === "never") return null;
  if (org.loyaltyExpiry === "fixed") return plusMonths(lot.earnedAt, org.loyaltyExpiryMonths, org.timezone);
  const from = lastActive && lastActive > lot.earnedAt ? lastActive : lot.earnedAt;
  return plusMonths(from, org.loyaltyExpiryMonths, org.timezone);
}
/** Usable points now, and the next expiry (date and how many go). */
export async function loyaltyBalance(db: DbOrTx, org: Org, clientId: string, now = new Date(), lock = false) {
  const lots = await lotsOf(db, org.id, clientId, lock);
  const last = await activeAt(db, org.id, clientId);
  const live = lots.map((l) => ({ lot: l, expires: expiryOf(org, l, last) })).filter((x) => !x.expires || x.expires > now);
  const points = live.reduce((a, x) => a + x.lot.remaining, 0);
  const dated = live.filter((x) => x.expires).sort((a, b) => a.expires!.getTime() - b.expires!.getTime());
  const next = dated[0]?.expires ?? null;
  const goingThen = next ? dated.filter((x) => x.expires!.getTime() === next.getTime()).reduce((a, x) => a + x.lot.remaining, 0) : 0;
  return { points, live, nextExpiry: next ? { at: next, points: goingThen } : null };
}
export async function loyaltyBalances(db: DbOrTx, orgId: string, now = new Date()) {
  const org = await getOrg(db, orgId);
  const rows = await db.select({ id: loyaltyLots.clientId }).from(loyaltyLots).where(and(eq(loyaltyLots.orgId, orgId), gt(loyaltyLots.remaining, 0))).groupBy(loyaltyLots.clientId);
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.id, (await loyaltyBalance(db, org, r.id, now)).points);
  return out;
}

/** They came to a class, earned or redeemed: under "expire after a stretch without visits" the clock restarts. */
async function touch(db: DbOrTx, orgId: string, clientId: string, now: Date) {
  await db.update(memberships).set({ loyaltyActiveAt: now, loyaltyWarnedAt: null }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, clientId)));
}

type Ref = { reason: string; refType?: string; refId?: string; note?: string; by?: string | null };
async function addPoints(tx: DbOrTx, org: Org, clientId: string, points: number, ref: Ref, now: Date) {
  if (points <= 0) return 0;
  await tx.insert(loyaltyLots).values({ orgId: org.id, clientId, amount: points, remaining: points, earnedAt: now });
  await tx.insert(loyaltyLedger).values({ orgId: org.id, clientId, change: points, reason: ref.reason, refType: ref.refType ?? null, refId: ref.refId ?? null, note: ref.note ?? null, createdBy: ref.by ?? null, createdAt: now });
  await touch(tx, org.id, clientId, now);
  return points;
}
/** Take points, oldest first. `partial` takes what's there (for reversals); otherwise all or nothing. */
async function takePoints(tx: DbOrTx, org: Org, clientId: string, points: number, ref: Ref, now: Date, partial = false) {
  const bal = await loyaltyBalance(tx, org, clientId, now, true);
  if (!partial && bal.points < points) throw conflict("not_enough_points", `That needs ${fmtPoints(org, points)}; you have ${fmtPoints(org, bal.points)}.`, { needMore: points - bal.points });
  let left = Math.min(points, bal.points);
  const taken = left;
  for (const { lot } of bal.live) {
    if (left <= 0) break;
    const t = Math.min(left, lot.remaining);
    await tx.update(loyaltyLots).set({ remaining: lot.remaining - t }).where(eq(loyaltyLots.id, lot.id));
    left -= t;
  }
  if (taken > 0) await tx.insert(loyaltyLedger).values({ orgId: org.id, clientId, change: -taken, reason: ref.reason, refType: ref.refType ?? null, refId: ref.refId ?? null, note: ref.note ?? null, createdBy: ref.by ?? null, createdAt: now });
  return taken;
}
/** Points still held for something (earned minus reversed), so earning and reversing can't double up. */
async function netFor(tx: DbOrTx, orgId: string, refType: string, refId: string) {
  const [r] = await tx.select({ n: sum(loyaltyLedger.change) }).from(loyaltyLedger).where(and(eq(loyaltyLedger.orgId, orgId), eq(loyaltyLedger.refType, refType), eq(loyaltyLedger.refId, refId), inArray(loyaltyLedger.reason, ["earned", "reversed"])));
  return Number(r?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Earning (called from attendance, sales and refunds)
// ---------------------------------------------------------------------------
/** Attendance marked (or corrected). Present earns (classes mode); un-marking takes it back. Coming in always counts as activity. */
export async function loyaltyForAttendance(tx: DbOrTx, orgId: string, clientId: string, bookingId: string, present: boolean, now = new Date()) {
  const org = await getOrg(tx, orgId);
  if (!org.loyaltyEnabled) return;
  if (present) await touch(tx, orgId, clientId, now);
  if (org.loyaltyEarn !== "classes") return;
  const net = await netFor(tx, orgId, "booking", bookingId);
  if (present && net <= 0) await addPoints(tx, org, clientId, org.loyaltyPointsPerClass, { reason: "earned", refType: "booking", refId: bookingId, note: "Class attended" }, now);
  if (!present && net > 0) await takePoints(tx, org, clientId, net, { reason: "reversed", refType: "booking", refId: bookingId, note: "Attendance corrected" }, now, true);
}
/** Money paid (spend mode): a package or a gift card. */
export async function loyaltyForSpend(tx: DbOrTx, orgId: string, clientId: string, cents: number, refType: string, refId: string, note: string, now = new Date()) {
  const org = await getOrg(tx, orgId);
  if (!org.loyaltyEnabled || org.loyaltyEarn !== "spend" || cents <= 0) return;
  if ((await netFor(tx, orgId, refType, refId)) > 0) return;
  await addPoints(tx, org, clientId, Math.floor((cents / 100) * org.loyaltyPointsPerUnit), { reason: "earned", refType, refId, note }, now);
}
/** Money refunded (spend mode): take back the points it earned. */
export async function loyaltyForRefund(tx: DbOrTx, orgId: string, clientId: string, cents: number, refId: string, now = new Date()) {
  const org = await getOrg(tx, orgId);
  if (!org.loyaltyEnabled || org.loyaltyEarn !== "spend" || cents <= 0) return;
  await takePoints(tx, org, clientId, Math.floor((cents / 100) * org.loyaltyPointsPerUnit), { reason: "reversed", refType: "refund", refId, note: "Refund" }, now, true);
}

// ---------------------------------------------------------------------------
// Rewards and redeeming
// ---------------------------------------------------------------------------
function whatYouGet(org: Org, r: RewardRow) {
  if (r.kind === "gift_card") return `A ${money(r.giftCardCents ?? 0, org.currency)} gift card to give (or keep)`;
  if (r.kind === "experience") return r.description || "Collect it at the studio";
  return r.reward ? describeReward(r.reward, (c) => money(c, org.currency)) : "";
}
function presentReward(org: Org, r: RewardRow, publicApi: string, balance?: number) {
  const soldOut = r.stock !== null && r.stock <= 0;
  return {
    id: r.id, name: r.name, description: r.description, kind: r.kind, kindLabel: LOYALTY_REWARD_KINDS[r.kind as keyof typeof LOYALTY_REWARD_KINDS]?.label ?? r.kind,
    cost: r.cost, costText: fmtPoints(org, r.cost), whatYouGet: whatYouGet(org, r), photoUrl: r.photoFileId ? publicFileUrl(publicApi, r.photoFileId) : null,
    stock: r.stock, soldOut, active: r.active, reward: r.reward, giftCardCents: r.giftCardCents,
    ...(balance !== undefined ? { canRedeem: !soldOut && balance >= r.cost, needMore: Math.max(0, r.cost - balance) } : {}),
  };
}

export async function redeem(tx: DbOrTx, orgId: string, clientId: string, rewardId: string, now = new Date()) {
  const org = await getOrg(tx, orgId);
  if (!org.loyaltyEnabled) throw conflict("loyalty_off", `${org.name} isn't running its rewards programme right now.`);
  const [r] = await tx.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, rewardId), eq(loyaltyRewards.orgId, orgId), isNull(loyaltyRewards.archivedAt))).for("update");
  if (!r || !r.active) throw notFound("reward");
  if (r.stock !== null && r.stock <= 0) throw conflict("sold_out", `${r.name} has all been claimed. Check back soon.`);
  const [red] = await tx
    .insert(loyaltyRedemptions)
    .values({ orgId, clientId, rewardId: r.id, rewardName: r.name, kind: r.kind, cost: r.cost, status: r.kind === "experience" ? "waiting" : "done", code: r.kind === "experience" ? `R-${giftCode().slice(5, 9)}` : null, createdAt: now })
    .returning();
  await takePoints(tx, org, clientId, r.cost, { reason: "redeemed", refType: "redemption", refId: red!.id, note: r.name }, now);
  await touch(tx, orgId, clientId, now);
  if (r.stock !== null) await tx.update(loyaltyRewards).set({ stock: r.stock - 1 }).where(eq(loyaltyRewards.id, r.id));
  let message: string;
  if (r.kind === "experience") {
    const staff = await tx.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), inArray(memberships.role, ["owner", "admin", "front_desk"]), eq(memberships.active, true)));
    await notify(tx, { orgId, userIds: staff.map((s) => s.id), template: "loyalty.to_hand_over", data: { rewardName: r.name, code: red!.code } });
    message = `Done! Show code ${red!.code} at the front desk to collect ${r.name}.`;
  } else if (r.kind === "gift_card") {
    const [design] = await tx.select({ id: giftCardDesigns.id }).from(giftCardDesigns).where(and(eq(giftCardDesigns.orgId, orgId), eq(giftCardDesigns.active, true))).orderBy(asc(giftCardDesigns.sortOrder)).limit(1);
    await tx.insert(giftCards).values({ orgId, code: giftCode(), designId: design?.id ?? null, amountCents: r.giftCardCents!, currency: org.currency, buyerId: clientId, status: "unsent", giveBy: endOfDayAfter(org.giftCardGiveWithinDays, org.timezone, now) });
    message = `Done! Your ${money(r.giftCardCents!, org.currency)} gift card is in your Gift cards tab, ready to give.`;
  } else {
    const what = await giveReward(tx, orgId, clientId, r.reward as Reward, { source: "loyalty", sourceId: red!.id, why: `${org.loyaltyNamePlural} reward: ${r.name}` }, now);
    message = `Done! You've got ${what}.`;
  }
  await notify(tx, { orgId, userIds: [clientId], template: "loyalty.redeemed", data: { rewardName: r.name, points: fmtPoints(org, r.cost), message } });
  return { redemption: red!, message, balance: (await loyaltyBalance(tx, org, clientId, now)).points };
}

// ---------------------------------------------------------------------------
// Worker: expiry and reminders
// ---------------------------------------------------------------------------
export async function expireLoyalty(db: Db, now = new Date()) {
  const orgs = await db.select().from(organizations).where(and(eq(organizations.loyaltyEnabled, true), sql`${organizations.loyaltyExpiry} <> 'never'`));
  for (const org of orgs) {
    const clients = await db.selectDistinct({ id: loyaltyLots.clientId }).from(loyaltyLots).where(and(eq(loyaltyLots.orgId, org.id), gt(loyaltyLots.remaining, 0)));
    for (const { id } of clients) {
      await db.transaction(async (tx) => {
        const lots = await lotsOf(tx, org.id, id, true);
        const last = await activeAt(tx, org.id, id);
        let gone = 0;
        let soon: { at: Date; points: number } | null = null;
        for (const lot of lots) {
          const exp = expiryOf(org, lot, last)!;
          if (exp <= now) {
            gone += lot.remaining;
            await tx.update(loyaltyLots).set({ remaining: 0 }).where(eq(loyaltyLots.id, lot.id));
          } else if (exp.getTime() - now.getTime() <= WARN_DAYS * 86_400_000) {
            if (!soon || exp < soon.at) soon = { at: exp, points: lot.remaining };
            else if (exp.getTime() === soon.at.getTime()) soon.points += lot.remaining;
          }
        }
        if (gone) await tx.insert(loyaltyLedger).values({ orgId: org.id, clientId: id, change: -gone, reason: "expired", note: org.loyaltyExpiry === "inactivity" ? `No visits for ${org.loyaltyExpiryMonths} months` : "Reached their expiry date", createdAt: now });
        if (soon) {
          const [m] = await tx.select({ warned: memberships.loyaltyWarnedAt }).from(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, id)));
          if (!m?.warned || now.getTime() - m.warned.getTime() > 20 * 86_400_000) {
            await notify(tx, { orgId: org.id, userIds: [id], template: "loyalty.expiring", data: { points: fmtPoints(org, soon.points), date: fmtDate(soon.at, org.timezone), plural: org.loyaltyNamePlural, inactivity: org.loyaltyExpiry === "inactivity" } });
            await tx.update(memberships).set({ loyaltyWarnedAt: now }).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, id)));
          }
        }
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const idParam = z.object({ id: schemas.id });
const statusQuery = z.object({ status: z.enum(["waiting", "given", "cancelled", "done", "all"]).default("waiting") });
const orderBody = z.object({ ids: z.array(schemas.id).min(1).max(200) });

export async function loyaltyRoutes(app: FastifyInstance) {
  const { db } = app;
  const api = app.config.PUBLIC_API_URL;

  const settingsView = (org: Org) => ({
    loyaltyEnabled: org.loyaltyEnabled, loyaltyName: org.loyaltyName, loyaltyNamePlural: org.loyaltyNamePlural, loyaltyEarn: org.loyaltyEarn,
    loyaltyPointsPerClass: org.loyaltyPointsPerClass, loyaltyPointsPerUnit: org.loyaltyPointsPerUnit, loyaltyExpiry: org.loyaltyExpiry, loyaltyExpiryMonths: org.loyaltyExpiryMonths,
    earnOptions: LOYALTY_EARN, expiryOptions: LOYALTY_EXPIRY, rewardKinds: LOYALTY_REWARD_KINDS,
    example: `You've got ${fmtPoints(org, 120)}. ${loyaltyRules(org).earn}`,
    rules: loyaltyRules(org),
  });
  app.get("/loyalty/settings", async (req) => {
    requirePermission(req, "manageMarketing");
    return settingsView(await getOrg(db, req.auth.orgId));
  });
  app.patch("/loyalty/settings", async (req) => {
    requirePermission(req, "manageMarketing");
    const input = parse(loyaltySettings, req.body);
    const sent = Object.keys(req.body ?? {});
    const changes = Object.fromEntries(Object.entries(input).filter(([k]) => sent.includes(k)));
    if (changes.loyaltyName && !sent.includes("loyaltyNamePlural")) changes.loyaltyNamePlural = /s$/i.test(String(changes.loyaltyName)) ? changes.loyaltyName : `${changes.loyaltyName}s`;
    const [u] = await db.update(organizations).set(changes).where(eq(organizations.id, req.auth.orgId)).returning();
    await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "loyalty.settings", entityType: "organization", entityId: req.auth.orgId, details: changes });
    return settingsView(u!);
  });

  // --- Rewards (admin) ---
  async function checkReward(orgId: string, r: z.infer<typeof loyaltyRewardInput>) {
    if (r.photoFileId) {
      const [f] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, r.photoFileId), eq(files.orgId, orgId), inArray(files.purpose, ["banner", "gift_card_design", "email_image", "package_photo"])));
      if (!f) throw badRequest("missing_image", "Upload the photo first.");
    }
  }
  app.get("/loyalty/rewards", async (req) => {
    const org = await getOrg(db, req.auth.orgId);
    const admin = req.auth.role !== "client";
    if (admin) requirePermission(req, "manageMarketing");
    const rows = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.orgId, org.id), isNull(loyaltyRewards.archivedAt), admin ? undefined : eq(loyaltyRewards.active, true))).orderBy(asc(loyaltyRewards.sortOrder), asc(loyaltyRewards.cost));
    return rows.map((r) => presentReward(org, r, api));
  });
  app.post("/loyalty/rewards", async (req, reply) => {
    requirePermission(req, "manageMarketing");
    const input = parse(loyaltyRewardInput, req.body);
    await checkReward(req.auth.orgId, input);
    const [c] = await db.select({ n: sql<number>`count(*)` }).from(loyaltyRewards).where(eq(loyaltyRewards.orgId, req.auth.orgId));
    const [r] = await db.insert(loyaltyRewards).values({ ...input, reward: input.reward ?? null, orgId: req.auth.orgId, sortOrder: Number(c!.n) }).returning();
    reply.code(201);
    return presentReward(await getOrg(db, req.auth.orgId), r!, api);
  });
  app.patch("/loyalty/rewards/:id", async (req) => {
    requirePermission(req, "manageMarketing");
    const { id } = parse(idParam, req.params);
    const [cur] = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, id), eq(loyaltyRewards.orgId, req.auth.orgId), isNull(loyaltyRewards.archivedAt)));
    if (!cur) throw notFound("reward");
    const input = parse(loyaltyRewardInput, { ...cur, ...(req.body as object) });
    await checkReward(req.auth.orgId, input);
    const [r] = await db.update(loyaltyRewards).set({ ...input, reward: input.reward ?? null }).where(eq(loyaltyRewards.id, id)).returning();
    return presentReward(await getOrg(db, req.auth.orgId), r!, api);
  });
  /** Removed rewards disappear for clients; anything already redeemed is kept. */
  app.delete("/loyalty/rewards/:id", async (req, reply) => {
    requirePermission(req, "manageMarketing");
    const { id } = parse(idParam, req.params);
    const [r] = await db.update(loyaltyRewards).set({ archivedAt: new Date() }).where(and(eq(loyaltyRewards.id, id), eq(loyaltyRewards.orgId, req.auth.orgId))).returning();
    if (!r) throw notFound("reward");
    return reply.code(204).send();
  });
  app.put("/loyalty/rewards/order", async (req) => {
    requirePermission(req, "manageMarketing");
    const { ids } = parse(orderBody, req.body);
    await inTx(app, async (tx) => { for (const [i, id] of ids.entries()) await tx.update(loyaltyRewards).set({ sortOrder: i }).where(and(eq(loyaltyRewards.id, id), eq(loyaltyRewards.orgId, req.auth.orgId))); });
    return { ok: true };
  });

  // --- Redemptions (staff: hand over in-person rewards) ---
  app.get("/loyalty/redemptions", async (req) => {
    requirePermission(req, "postAnnouncements"); // owners, admins and front desk
    const { status } = parse(statusQuery, req.query);
    const org = await getOrg(db, req.auth.orgId);
    const rows = await db
      .select({ r: loyaltyRedemptions, first: sql<string>`u.first_name`, last: sql<string>`u.last_name` })
      .from(loyaltyRedemptions)
      .innerJoin(sql`users u`, sql`u.id = ${loyaltyRedemptions.clientId}`)
      .where(and(eq(loyaltyRedemptions.orgId, org.id), status === "all" ? undefined : eq(loyaltyRedemptions.status, status)))
      .orderBy(desc(loyaltyRedemptions.createdAt))
      .limit(300);
    return rows.map((x) => ({ ...x.r, clientName: `${x.first} ${x.last}`, costText: fmtPoints(org, x.r.cost) }));
  });
  async function handle(req: { auth: { orgId: string; userId: string } }, id: string, to: "given" | "cancelled") {
    return inTx(app, async (tx) => {
      const [red] = await tx.select().from(loyaltyRedemptions).where(and(eq(loyaltyRedemptions.id, id), eq(loyaltyRedemptions.orgId, req.auth.orgId))).for("update");
      if (!red) throw notFound("redemption");
      if (red.status !== "waiting") throw conflict("already_handled", red.status === "given" ? "This has already been handed over." : "This can't be changed any more.");
      const org = await getOrg(tx, req.auth.orgId);
      const [u] = await tx.update(loyaltyRedemptions).set({ status: to, handledBy: req.auth.userId, handledAt: new Date() }).where(eq(loyaltyRedemptions.id, id)).returning();
      if (to === "cancelled") {
        await addPoints(tx, org, red.clientId, red.cost, { reason: "refunded", refType: "redemption", refId: red.id, note: `${red.rewardName} cancelled`, by: req.auth.userId }, new Date());
        if (red.rewardId) await tx.update(loyaltyRewards).set({ stock: sql`case when ${loyaltyRewards.stock} is null then null else ${loyaltyRewards.stock} + 1 end` }).where(eq(loyaltyRewards.id, red.rewardId));
        await notify(tx, { orgId: org.id, userIds: [red.clientId], template: "loyalty.cancelled", data: { rewardName: red.rewardName, points: fmtPoints(org, red.cost) } });
      }
      return u!;
    });
  }
  app.post("/loyalty/redemptions/:id/given", async (req) => { requirePermission(req, "postAnnouncements"); return handle(req, parse(idParam, req.params).id, "given"); });
  app.post("/loyalty/redemptions/:id/cancel", async (req) => { requirePermission(req, "postAnnouncements"); return handle(req, parse(idParam, req.params).id, "cancelled"); });

  // --- A client's points (staff) ---
  app.get("/clients/:id/loyalty", async (req) => {
    requirePermission(req, "viewClientDetails");
    const { id } = parse(idParam, req.params);
    return clientView(db, await getOrg(db, req.auth.orgId), id, api);
  });
  app.post("/clients/:id/loyalty", async (req) => {
    requirePermission(req, "manageMarketing");
    const { id } = parse(idParam, req.params);
    const { points, reason } = parse(loyaltyAdjust, req.body);
    const org = await getOrg(db, req.auth.orgId);
    const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, id), eq(memberships.role, "client")));
    if (!m) throw notFound("client");
    await inTx(app, async (tx) => {
      if (points > 0) await addPoints(tx, org, id, points, { reason: "adjusted", note: reason, by: req.auth.userId }, new Date());
      else await takePoints(tx, org, id, -points, { reason: "adjusted", note: reason, by: req.auth.userId }, new Date());
      await audit(tx, { orgId: org.id, actorId: req.auth.userId, action: "loyalty.adjusted", entityType: "user", entityId: id, details: { points, reason } });
    });
    return clientView(db, org, id, api);
  });

  // --- Clients ---
  app.get("/me/loyalty", async (req) => {
    if (req.auth.role !== "client") throw forbidden("Loyalty points are for clients.");
    const org = await getOrg(db, req.auth.orgId);
    if (!org.loyaltyEnabled) return { enabled: false };
    return clientView(db, org, req.auth.userId, api);
  });
  app.post("/me/loyalty/rewards/:id/redeem", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    if (req.auth.role !== "client") throw forbidden("Rewards are for clients.");
    const { id } = parse(idParam, req.params);
    return inTx(app, (tx) => redeem(tx, req.auth.orgId, req.auth.userId, id));
  });
}

const HISTORY_LABEL: Record<string, string> = { earned: "Earned", reversed: "Taken back", redeemed: "Redeemed", refunded: "Returned", expired: "Expired", adjusted: "Adjusted by the studio" };
async function clientView(db: DbOrTx, org: Org, clientId: string, api: string, now = new Date()) {
  const bal = await loyaltyBalance(db, org, clientId, now);
  const rewards = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.orgId, org.id), isNull(loyaltyRewards.archivedAt), eq(loyaltyRewards.active, true))).orderBy(asc(loyaltyRewards.sortOrder), asc(loyaltyRewards.cost));
  const history = await db.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.orgId, org.id), eq(loyaltyLedger.clientId, clientId))).orderBy(desc(loyaltyLedger.createdAt)).limit(50);
  const reds = await db.select().from(loyaltyRedemptions).where(and(eq(loyaltyRedemptions.orgId, org.id), eq(loyaltyRedemptions.clientId, clientId))).orderBy(desc(loyaltyRedemptions.createdAt)).limit(30);
  return {
    enabled: true as const,
    name: org.loyaltyName,
    namePlural: org.loyaltyNamePlural,
    balance: bal.points,
    balanceText: fmtPoints(org, bal.points),
    nextExpiry: bal.nextExpiry ? { date: bal.nextExpiry.at, points: bal.nextExpiry.points, text: `${fmtPoints(org, bal.nextExpiry.points)} expire on ${fmtDate(bal.nextExpiry.at, org.timezone)}${org.loyaltyExpiry === "inactivity" ? " unless you come to a class before then" : ""}.` } : null,
    rules: loyaltyRules(org),
    rewards: rewards.map((r) => presentReward(org, r, api, bal.points)),
    history: history.map((h) => ({ at: h.createdAt, change: h.change, text: `${h.change > 0 ? "+" : "−"}${fmtPoints(org, Math.abs(h.change))}`, what: HISTORY_LABEL[h.reason] ?? h.reason, note: h.note })),
    redemptions: reds.map((r) => ({ id: r.id, reward: r.rewardName, at: r.createdAt, status: r.status, code: r.status === "waiting" ? r.code : null, statusLabel: { done: "Added to your account", waiting: "Show the code at the front desk", given: "Collected", cancelled: `Cancelled: ${org.loyaltyNamePlural} returned` }[r.status] ?? r.status })),
  };
}
