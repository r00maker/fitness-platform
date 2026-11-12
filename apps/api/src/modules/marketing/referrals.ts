/**
 * Referrals: every client has a code and link. A new member enters a code when they join (the
 * link fills it in), or within the studio's grace period as long as they haven't bought anything
 * yet. Staff can add one for them any time. When the friend meets the studio's rule (attends N
 * classes, spends an amount, or buys a package) within the time allowed, the referrer is rewarded.
 *
 * Guard rails: no referring yourself (same account, email or phone), one referrer per person,
 * codes can't be changed once added, and an optional monthly cap on rewards.
 */
import { and, count, eq, gt, gte, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { describeReward, makeReferralCode, type Reward } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { bookings, clientPackages, memberships, orders, referrals, users } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { money } from "../bookings/rules.js";
import { notify } from "../notifications/outbox.js";
import { getOrg } from "../sessions/context.js";
import { giveReward } from "./credit.js";
import { nettSpend } from "./segments.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
const DAY = 86_400_000;
const normalise = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

export const referralLink = (appUrl: string, orgId: string, code: string) => `${appUrl.replace(/\/$/, "")}/join/${orgId}?ref=${encodeURIComponent(code)}`;

/** A client's code, made the first time it's needed. */
export async function ensureReferralCode(db: DbOrTx, orgId: string, userId: string, firstName: string) {
  const [m] = await db.select({ code: memberships.referralCode }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  if (m?.code) return m.code;
  for (let i = 0; i < 8; i++) {
    const code = makeReferralCode(firstName);
    const [taken] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.referralCode, code)));
    if (taken) continue;
    await db.update(memberships).set({ referralCode: code }).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
    return code;
  }
  throw conflict("busy", "Couldn't make a referral code just now. Please try again.");
}

/** The studio's referral rules, in plain English, for clients and the settings page. */
export function describeReferralRules(org: Org): string[] {
  const fmt = (c: number) => money(c, org.currency);
  const goal =
    org.referralQualify === "classes_attended" ? `attends ${org.referralQualifyValue} ${org.referralQualifyValue === 1 ? "class" : "classes"}` : org.referralQualify === "spend" ? `spends ${fmt(org.referralQualifyValue)}` : "buys their first package";
  return [
    `Share your link or code with a friend who's new to ${org.name}.`,
    `They add your code when they sign up${org.referralCodeWindowDays ? ` (or within ${org.referralCodeWindowDays} days, before their first purchase)` : ""}.`,
    ...(org.refereeReward ? [`They get ${describeReward(org.refereeReward, fmt)} as a welcome gift.`] : []),
    `When your friend ${goal} within ${org.referralQualifyWithinDays} days of joining, you get ${describeReward(org.referrerReward, fmt)}.`,
    ...(org.referralMonthlyCap ? [`You can earn up to ${org.referralMonthlyCap} ${org.referralMonthlyCap === 1 ? "reward" : "rewards"} a month.`] : []),
  ];
}

async function hasBought(db: DbOrTx, orgId: string, clientId: string) {
  const [p] = await db.select({ n: count() }).from(clientPackages).where(and(eq(clientPackages.orgId, orgId), eq(clientPackages.ownerId, clientId), gt(clientPackages.pricePaidCents, 0)));
  const [o] = await db.select({ n: count() }).from(orders).where(and(eq(orders.orgId, orgId), eq(orders.clientId, clientId), eq(orders.status, "paid")));
  return Number(p!.n) + Number(o!.n) > 0;
}

/** Add a referral code for a new member. `via`: joined (at sign-up), later (within the grace period), staff. */
export async function applyReferral(tx: DbOrTx, orgId: string, refereeId: string, rawCode: string, via: "joined" | "later" | "staff", by: string | null, now = new Date()) {
  const org = await getOrg(tx, orgId);
  if (!org.referralsEnabled) throw conflict("referrals_off", `${org.name} isn't running referrals right now.`);
  const code = normalise(rawCode);
  const [referrer] = await tx
    .select({ id: memberships.userId, firstName: users.firstName, email: users.email, phone: users.phone })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.referralCode, code), eq(memberships.role, "client"), eq(memberships.active, true)));
  if (!referrer) throw notFound("referral code");
  const [me] = await tx
    .select({ joined: memberships.createdAt, email: users.email, phone: users.phone, firstName: users.firstName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, refereeId)));
  if (!me) throw notFound("client");
  const digits = (p: string | null) => (p ?? "").replace(/\D/g, "").slice(-8);
  if (referrer.id === refereeId || referrer.email.toLowerCase() === me.email.toLowerCase() || (digits(me.phone) && digits(me.phone) === digits(referrer.phone))) {
    throw conflict("own_code", "That's your own referral code. Codes are for friends who are new to the studio.");
  }
  const [existing] = await tx.select({ id: referrals.id }).from(referrals).where(and(eq(referrals.orgId, orgId), eq(referrals.refereeId, refereeId)));
  if (existing) throw conflict("already_referred", "A referral code has already been added to this account, and it can't be changed.");
  if (via !== "staff") {
    const tooLate = now.getTime() > me.joined.getTime() + org.referralCodeWindowDays * DAY;
    if (tooLate || (await hasBought(tx, orgId, refereeId))) {
      throw conflict(
        "too_late",
        `Referral codes need to be added ${org.referralCodeWindowDays ? `within ${org.referralCodeWindowDays} days of joining and ` : "when you join, "}before your first purchase. If you missed it, ask the studio: they can add it for you.`,
      );
    }
  }
  const [r] = await tx.insert(referrals).values({ orgId, referrerId: referrer.id, refereeId, code, via, createdBy: by }).returning();
  let welcome: string | null = null;
  if (org.refereeReward) {
    welcome = await giveReward(tx, orgId, refereeId, org.refereeReward, { source: "referral", sourceId: r!.id, why: `Welcome gift: referred by ${referrer.firstName}`, by }, now);
    await notify(tx, { orgId, userIds: [refereeId], template: "referral.welcome", data: { reward: welcome, referrerName: referrer.firstName } });
  }
  await audit(tx, { orgId, actorId: by, action: "referral.added", entityType: "referral", entityId: r!.id, details: { via, referrerId: referrer.id, refereeId } });
  return { referral: r!, referrerFirstName: referrer.firstName, welcomeGift: welcome };
}

/**
 * Has a referred friend met the studio's rule? Call after anything that could count (a class
 * attended, a purchase). Returns the referrer if they were just rewarded.
 */
export async function checkReferral(tx: DbOrTx, orgId: string, refereeId: string, now = new Date()): Promise<{ referrerId: string; referralId: string } | null> {
  const [r] = await tx.select().from(referrals).where(and(eq(referrals.orgId, orgId), eq(referrals.refereeId, refereeId), eq(referrals.status, "pending"))).for("update");
  if (!r) return null;
  const org = await getOrg(tx, orgId);
  const [m] = await tx.select({ joined: memberships.createdAt }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, refereeId)));
  const deadline = new Date((m?.joined ?? r.createdAt).getTime() + org.referralQualifyWithinDays * DAY);
  let met = false;
  if (org.referralQualify === "classes_attended") {
    const [c] = await tx
      .select({ n: count() })
      .from(bookings)
      .where(and(eq(bookings.orgId, orgId), eq(bookings.clientId, refereeId), eq(bookings.attendance, "present"), sql`${bookings.attendanceMarkedAt} <= ${deadline}`));
    met = Number(c!.n) >= org.referralQualifyValue;
  } else if (org.referralQualify === "spend") {
    met = ((await nettSpend(tx, orgId, null)).get(refereeId) ?? 0) >= org.referralQualifyValue;
  } else {
    met = await hasBought(tx, orgId, refereeId);
  }
  if (!met) {
    if (now > deadline) await tx.update(referrals).set({ status: "expired", note: "Didn't qualify in time" }).where(eq(referrals.id, r.id));
    return null;
  }
  if (now > new Date(deadline.getTime() + DAY)) {
    await tx.update(referrals).set({ status: "expired", note: "Qualified after the deadline" }).where(eq(referrals.id, r.id));
    return null;
  }
  if (org.referralMonthlyCap) {
    const monthStart = DateTime.fromJSDate(now, { zone: org.timezone }).startOf("month").toJSDate();
    const [c] = await tx.select({ n: count() }).from(referrals).where(and(eq(referrals.orgId, orgId), eq(referrals.referrerId, r.referrerId), eq(referrals.status, "rewarded"), gte(referrals.rewardedAt, monthStart)));
    if (Number(c!.n) >= org.referralMonthlyCap) {
      await tx.update(referrals).set({ status: "capped", rewardedAt: now, note: "Monthly reward limit reached" }).where(eq(referrals.id, r.id));
      return null;
    }
  }
  const [friend] = await tx.select({ firstName: users.firstName }).from(users).where(eq(users.id, refereeId));
  const what = await giveReward(tx, orgId, r.referrerId, org.referrerReward as Reward, { source: "referral", sourceId: r.id, why: `Referral reward: ${friend?.firstName ?? "your friend"} joined` }, now);
  await tx.update(referrals).set({ status: "rewarded", rewardedAt: now }).where(eq(referrals.id, r.id));
  await notify(tx, { orgId, userIds: [r.referrerId], template: "referral.rewarded", data: { reward: what, friendName: friend?.firstName ?? "Your friend" } });
  return { referrerId: r.referrerId, referralId: r.id };
}

/** What a client sees on "Refer a friend". */
export async function myReferrals(db: DbOrTx, orgId: string, userId: string, appUrl: string, now = new Date()) {
  const org = await getOrg(db, orgId);
  const [me] = await db.select({ first: users.firstName, joined: memberships.createdAt }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  if (!org.referralsEnabled) return { enabled: false as const };
  const code = await ensureReferralCode(db, orgId, userId, me!.first);
  const mine = await db
    .select({ r: referrals, first: users.firstName, last: users.lastName })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.refereeId))
    .where(and(eq(referrals.orgId, orgId), eq(referrals.referrerId, userId), ne(referrals.status, "void")))
    .orderBy(sql`${referrals.createdAt} desc`);
  const [byWhom] = await db.select({ status: referrals.status, first: users.firstName }).from(referrals).innerJoin(users, eq(users.id, referrals.referrerId)).where(and(eq(referrals.orgId, orgId), eq(referrals.refereeId, userId)));
  const canAdd = !byWhom && now.getTime() <= me!.joined.getTime() + org.referralCodeWindowDays * DAY && !(await hasBought(db, orgId, userId));
  const STATUS = { pending: "Joined: not qualified yet", rewarded: "You got your reward", capped: "Qualified, but you'd reached this month's limit", expired: "Didn't qualify in time", void: "Removed" } as const;
  return {
    enabled: true as const,
    code,
    link: referralLink(appUrl, orgId, code),
    howItWorks: describeReferralRules(org),
    friends: mine.map((x) => ({ name: `${x.first} ${x.last.slice(0, 1)}.`, joinedAt: x.r.createdAt, status: x.r.status, statusLabel: STATUS[x.r.status] })),
    rewardsEarned: mine.filter((x) => x.r.status === "rewarded").length,
    referredBy: byWhom ? { firstName: byWhom.first } : null,
    canAddCode: canAdd,
  };
}

/** Admin overview: every referral and how it's going. */
export async function referralReport(db: DbOrTx, orgId: string) {
  const rows = await db
    .select({ r: referrals, referrerFirst: sql<string>`ru.first_name`, referrerLast: sql<string>`ru.last_name`, refereeFirst: users.firstName, refereeLast: users.lastName })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.refereeId))
    .innerJoin(sql`users ru`, sql`ru.id = ${referrals.referrerId}`)
    .where(eq(referrals.orgId, orgId))
    .orderBy(sql`${referrals.createdAt} desc`)
    .limit(500);
  return rows.map((x) => ({ ...x.r, referrer: `${x.referrerFirst} ${x.referrerLast}`, referee: `${x.refereeFirst} ${x.refereeLast}` }));
}

