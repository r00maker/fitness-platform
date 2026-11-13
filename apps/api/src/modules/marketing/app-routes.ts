/**
 * What clients see and do: joining (with a referral code and where they came from), marketing
 * preferences, unsubscribing, banners, announcements, gift cards, studio credit and referrals.
 * Plus the admin side of banners, announcements, gift cards, credit and referral settings.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import {
  ANNOUNCEMENT_DURATIONS,
  REFERRAL_QUALIFY,
  REWARD_TYPES,
  acquisitionFrom,
  announcementInput,
  applyReferral as applyReferralBody,
  bannerInput,
  creditAdjustment,
  describeReward,
  giftCardDesignInput,
  giftCardSettings,
  giftRecipient,
  joinStudio,
  marketingPrefs,
  referralSettings,
  schemas,
} from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import {
  announcementDismissals,
  announcements,
  banners,
  bookings,
  classSessions,
  files,
  giftCardDesigns,
  giftCards,
  locations,
  memberships,
  notifications,
  organizations,
  segments,
  users,
} from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse, parsePatch } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { publicFileUrl } from "../files/routes.js";
import { getOrg } from "../sessions/context.js";
import { adjustCredit, creditSummary, usableVouchers, voucherLabel } from "./credit.js";
import { clientEvent } from "./events.js";
import { auditGift, deliver, findRecipient, keep, presentCards } from "./giftcards.js";
import { queuePush } from "./messages.js";
import { SOCIAL_ICONS } from "./social-icons.js";
import { adsOnJoin } from "./ads.js";
import { applyReferral, describeReferralRules, myReferrals, referralReport } from "./referrals.js";
import { allClients, matchSegment } from "./segments.js";

const idParam = z.object({ id: schemas.id });
const tokenParam = z.object({ token: z.string().regex(/^[a-f0-9]{32,80}$/) });
const placementQuery = z.object({ placement: z.enum(["home", "packages", "schedule"]).optional() });
const codeParams = z.object({ orgId: schemas.id, code: z.string().trim().min(3).max(20) });
const orderBody = z.object({ ids: z.array(schemas.id).min(1).max(100) });
const archiveBody = z.object({ active: z.boolean() });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#17201c;background:#f4f6f4}h1{font-size:22px}button{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #0e6b5f;background:#0e6b5f;color:#fff;cursor:pointer}</style></head><body>${body}</body></html>`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** When an announcement disappears, from the duration chosen. */
function announcementEnd(duration: keyof typeof ANNOUNCEMENT_DURATIONS, start: Date, zone: string, custom?: Date | null) {
  const s = DateTime.fromJSDate(start, { zone });
  switch (duration) {
    case "2h": return s.plus({ hours: 2 }).toJSDate();
    case "end_of_day": return s.endOf("day").toJSDate();
    case "24h": return s.plus({ hours: 24 }).toJSDate();
    case "3d": return s.plus({ days: 3 }).toJSDate();
    case "1w": return s.plus({ weeks: 1 }).toJSDate();
    case "custom": return custom!;
  }
}

/** Who an announcement is for. */
async function announcementAudience(db: DbOrTx, orgId: string, a: { audience: string; locationId: string | null; bookedWithinDays: number }, now: Date): Promise<string[]> {
  if (a.audience === "everyone") return allClients(db, orgId);
  const until = new Date(now.getTime() + (a.audience === "booked_at_location" ? a.bookedWithinDays : 3650) * 86_400_000);
  const from = a.audience === "booked_at_location" ? now : new Date(now.getTime() - 90 * 86_400_000);
  // "location": anyone booked there recently or soon; "booked_at_location": booked there in the next N days.
  const rows = await db
    .selectDistinct({ id: bookings.clientId })
    .from(bookings)
    .innerJoin(classSessions, eq(classSessions.id, bookings.sessionId))
    .where(and(eq(bookings.orgId, orgId), eq(classSessions.locationId, a.locationId!), eq(bookings.status, "confirmed"), gte(classSessions.startsAt, from), lte(classSessions.startsAt, until)));
  return rows.map((r) => r.id);
}

export async function marketingAppRoutes(app: FastifyInstance) {
  const { db } = app;
  const appUrl = app.config.PUBLIC_APP_URL;

  // --- Joining ------------------------------------------------------------------------
  /**
   * A signed-in person joins a studio as a client. Records where they came from (ad click ids and
   * UTM tags from the link they arrived on), their marketing choices, and a referral code if given.
   */
  app.post("/join", { config: { joining: true } }, async (req, reply) => {
    if (!req.auth.joining) throw conflict("already_member", "You're already a member of this studio.");
    const input = parse(joinStudio, req.body);
    const out = await inTx(app, async (tx) => {
      const [org] = await tx.select().from(organizations).where(eq(organizations.id, req.auth.orgId));
      if (!org) throw notFound("studio");
      let [u] = await tx.select().from(users).where(eq(users.id, req.auth.userId));
      if (!u) {
        if (!req.auth.email || !input.firstName || !input.lastName) throw badRequest("details_needed", "Add your first and last name to join.");
        // A new account takes the email the sign-in provider gives us, so it must be one the person
        // has confirmed. Otherwise someone could sign up with another person's address and later
        // be matched to things sent to it (like a staff invite).
        if (!req.auth.emailVerified) throw forbidden("Please confirm your email address first (check your inbox for a link), then try again.");
        [u] = await tx.insert(users).values({ id: req.auth.userId, email: req.auth.email, firstName: input.firstName, lastName: input.lastName, phone: input.phone ?? null }).returning();
      } else if (input.phone && !u.phone) {
        await tx.update(users).set({ phone: input.phone }).where(eq(users.id, u.id));
      }
      const consent = input.marketingEmail || input.marketingPush || input.marketingWhatsapp;
      await tx.insert(memberships).values({
        orgId: org.id, userId: u!.id, role: "client", marketingEmail: input.marketingEmail, marketingPush: input.marketingPush, marketingWhatsapp: input.marketingWhatsapp,
        marketingConsentAt: consent ? new Date() : null, attribution: input.attribution ?? null, acquisition: acquisitionFrom(input.attribution, !!input.referralCode),
      });
      let referral: { referrerFirstName: string; welcomeGift: string | null } | null = null;
      let referralProblem: string | null = null;
      if (input.referralCode) {
        // A bad code shouldn't stop someone joining: they're told, and staff can add it later.
        try {
          await tx.transaction(async (sp) => {
            const r = await applyReferral(sp, org.id, u!.id, input.referralCode!, "joined", u!.id);
            referral = { referrerFirstName: r.referrerFirstName, welcomeGift: r.welcomeGift };
          });
        } catch (err) {
          referralProblem = err instanceof Error ? err.message : "That referral code couldn't be added.";
          await tx.update(memberships).set({ acquisition: acquisitionFrom(input.attribution, false) }).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, u!.id)));
        }
      }
      // From an ad or a lead form: match their enquiry and tell the ad platform about the sign-up.
      await adsOnJoin(tx, org.id, u!.id, { leadToken: input.leadToken, email: u!.email, phone: input.phone ?? u!.phone, attribution: input.attribution ?? null });
      await clientEvent(tx, org.id, u!.id, { type: "account_created" });
      return { studio: org.name, referral, referralProblem };
    });
    reply.code(201);
    return out;
  });

  /** Before joining: "Chloe invited you to Demo Studio". Only the first name is shown. */
  app.get("/referral-codes/:orgId/:code", { config: { public: true, rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { orgId, code } = parse(codeParams, req.params);
    const [org] = await db.select({ name: organizations.name, on: organizations.referralsEnabled, refereeReward: organizations.refereeReward, currency: organizations.currency }).from(organizations).where(eq(organizations.id, orgId));
    if (!org || !org.on) return { valid: false };
    const [r] = await db.select({ first: users.firstName }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, orgId), eq(memberships.referralCode, code.toUpperCase()), eq(memberships.active, true)));
    if (!r) return { valid: false };
    return { valid: true, studioName: org.name, referrerFirstName: r.first, welcomeGift: org.refereeReward ? describeReward(org.refereeReward, (c) => money(c, org.currency)) : null };
  });

  /** Social icons for emails (public, cached for a long time). */
  app.get("/public/social/:name", { config: { public: true } }, async (req, reply) => {
    const { name } = parse(z.object({ name: z.string().regex(/^[a-z]+\.png$/) }), req.params);
    const png = SOCIAL_ICONS[name.replace(/\.png$/, "")];
    if (!png) throw notFound("icon");
    reply.header("content-type", "image/png").header("cache-control", "public, max-age=2592000, immutable").header("cross-origin-resource-policy", "cross-origin");
    return reply.send(Buffer.from(png, "base64"));
  });

  // --- Marketing choices and unsubscribing ------------------------------------------
  app.get("/me/marketing", async (req) => {
    const [m] = await db.select({ marketingEmail: memberships.marketingEmail, marketingPush: memberships.marketingPush, marketingWhatsapp: memberships.marketingWhatsapp, since: memberships.marketingConsentAt }).from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, req.auth.userId)));
    return m;
  });
  app.patch("/me/marketing", async (req) => {
    const input = parse(marketingPrefs, req.body);
    const [m] = await db
      .update(memberships)
      .set({ ...input, ...(input.marketingEmail || input.marketingPush || input.marketingWhatsapp ? { marketingConsentAt: new Date() } : {}) })
      .where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, req.auth.userId)))
      .returning({ marketingEmail: memberships.marketingEmail, marketingPush: memberships.marketingPush, marketingWhatsapp: memberships.marketingWhatsapp });
    return m;
  });
  /** The link in marketing emails. GET shows a confirm button (so link scanners can't unsubscribe people); POST unsubscribes (also used by one-click mail apps). */
  app.get("/unsubscribe/:token", { config: { public: true } }, async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const [m] = await db.select({ org: organizations.name, on: memberships.marketingEmail }).from(memberships).innerJoin(organizations, eq(organizations.id, memberships.orgId)).where(eq(memberships.unsubscribeToken, token));
    reply.type("text/html");
    if (!m) return page("Unsubscribe", "<h1>That link has expired</h1><p>You can change your email choices in the app under Profile.</p>");
    if (!m.on) return page("Unsubscribed", `<h1>You're unsubscribed</h1><p>You won't get marketing emails from ${esc(m.org)}. You'll still get emails about your bookings.</p>`);
    return page("Unsubscribe", `<h1>Unsubscribe from ${esc(m.org)}?</h1><p>You'll stop getting news and offers by email. Emails about your bookings will still arrive.</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
  });
  app.post("/unsubscribe/:token", { config: { public: true } }, async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const [m] = await db.update(memberships).set({ marketingEmail: false }).where(eq(memberships.unsubscribeToken, token)).returning({ orgId: memberships.orgId, userId: memberships.userId });
    reply.type("text/html");
    if (m) await audit(db, { orgId: m.orgId, actorId: m.userId, action: "marketing.unsubscribed", entityType: "user", entityId: m.userId });
    return page("Unsubscribed", "<h1>You're unsubscribed</h1><p>You won't get marketing emails any more. You can turn them back on in the app under Profile.</p>");
  });

  // --- Banners ------------------------------------------------------------------------
  const presentBanner = (b: typeof banners.$inferSelect, now: Date) => ({
    ...b,
    imageUrl: publicFileUrl(app.config.PUBLIC_API_URL, b.imageFileId),
    state: !b.active ? "paused" : b.startsAt && b.startsAt > now ? "scheduled" : b.endsAt && b.endsAt <= now ? "ended" : "live",
    clickRate: b.views ? `${Math.round((b.clicks / b.views) * 1000) / 10}%` : null,
  });
  app.get("/banners", async (req) => {
    requirePermission(req, "manageMarketing");
    const now = new Date();
    const rows = await db.select().from(banners).where(eq(banners.orgId, req.auth.orgId)).orderBy(asc(banners.placement), asc(banners.sortOrder));
    return rows.map((b) => presentBanner(b, now));
  });
  async function checkBanner(orgId: string, b: z.infer<typeof bannerInput>) {
    const [f] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, b.imageFileId), eq(files.orgId, orgId), eq(files.purpose, "banner")));
    if (!f) throw badRequest("missing_image", "Upload the banner image first.");
    if (b.audience === "segment") {
      const [s] = await db.select({ id: segments.id }).from(segments).where(and(eq(segments.id, b.segmentId!), eq(segments.orgId, orgId)));
      if (!s) throw notFound("segment");
    }
  }
  app.post("/banners", async (req, reply) => {
    requirePermission(req, "manageMarketing");
    const input = parse(bannerInput, req.body);
    await checkBanner(req.auth.orgId, input);
    const [c] = await db.select({ n: count() }).from(banners).where(and(eq(banners.orgId, req.auth.orgId), eq(banners.placement, input.placement)));
    const [b] = await db.insert(banners).values({ ...input, orgId: req.auth.orgId, sortOrder: Number(c!.n), createdBy: req.auth.userId }).returning();
    reply.code(201);
    return presentBanner(b!, new Date());
  });
  app.patch("/banners/:id", async (req) => {
    requirePermission(req, "manageMarketing");
    const { id } = parse(idParam, req.params);
    const [cur] = await db.select().from(banners).where(and(eq(banners.id, id), eq(banners.orgId, req.auth.orgId)));
    if (!cur) throw notFound("banner");
    const input = parse(bannerInput, { ...cur, ...(req.body as object) });
    await checkBanner(req.auth.orgId, input);
    const [b] = await db.update(banners).set(input).where(eq(banners.id, id)).returning();
    return presentBanner(b!, new Date());
  });
  app.delete("/banners/:id", async (req, reply) => {
    requirePermission(req, "manageMarketing");
    const { id } = parse(idParam, req.params);
    const [b] = await db.delete(banners).where(and(eq(banners.id, id), eq(banners.orgId, req.auth.orgId))).returning();
    if (!b) throw notFound("banner");
    return reply.code(204).send();
  });
  /** How long each banner shows before the next, when several share a place. */
  app.get("/banners/settings", async (req) => {
    requirePermission(req, "manageMarketing");
    const org = await getOrg(db, req.auth.orgId);
    return { bannerRotateSeconds: org.bannerRotateSeconds };
  });
  app.patch("/banners/settings", async (req) => {
    requirePermission(req, "manageMarketing");
    const { bannerRotateSeconds } = parse(z.object({ bannerRotateSeconds: z.number().int().min(3, "At least 3 seconds, so people can read it.").max(30) }), req.body);
    await db.update(organizations).set({ bannerRotateSeconds }).where(eq(organizations.id, req.auth.orgId));
    return { bannerRotateSeconds };
  });
  app.put("/banners/order", async (req) => {
    requirePermission(req, "manageMarketing");
    const { ids } = parse(orderBody, req.body);
    await inTx(app, async (tx) => { for (const [i, id] of ids.entries()) await tx.update(banners).set({ sortOrder: i }).where(and(eq(banners.id, id), eq(banners.orgId, req.auth.orgId))); });
    return { ok: true };
  });
  /**
   * Client app: banners to show now, for this person, in the studio's order. When a place has more
   * than one, the app shows them in turn, each for `rotateSeconds` (pausing while someone is
   * touching or reading it). Each fetch counts as a view.
   */
  app.get("/me/banners", async (req) => {
    const { placement } = parse(placementQuery, req.query);
    const now = new Date();
    const rows = await db
      .select()
      .from(banners)
      .where(and(eq(banners.orgId, req.auth.orgId), eq(banners.active, true), placement ? eq(banners.placement, placement) : undefined, or(isNull(banners.startsAt), lte(banners.startsAt, now)), or(isNull(banners.endsAt), gt(banners.endsAt, now))))
      .orderBy(asc(banners.sortOrder));
    const shown: typeof rows = [];
    for (const b of rows) {
      if (b.audience === "new_clients") {
        const [c] = await db.select({ n: count() }).from(bookings).where(and(eq(bookings.orgId, req.auth.orgId), eq(bookings.clientId, req.auth.userId), eq(bookings.attendance, "present")));
        if (Number(c!.n) > 0) continue;
      } else if (b.audience === "segment") {
        const [s] = b.segmentId ? await db.select().from(segments).where(eq(segments.id, b.segmentId)) : [];
        if (!s || !(await matchSegment(db, req.auth.orgId, s.definition, { universe: [req.auth.userId], now })).length) continue;
      }
      shown.push(b);
    }
    if (shown.length) await db.update(banners).set({ views: sql`${banners.views} + 1` }).where(inArray(banners.id, shown.map((b) => b.id)));
    const org = await getOrg(db, req.auth.orgId);
    return {
      rotateSeconds: org.bannerRotateSeconds,
      banners: shown.map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, placement: b.placement, imageUrl: publicFileUrl(app.config.PUBLIC_API_URL, b.imageFileId), link: { type: b.linkType, target: b.linkTarget } })),
    };
  });
  app.post("/me/banners/:id/click", async (req) => {
    const { id } = parse(idParam, req.params);
    const [b] = await db.update(banners).set({ clicks: sql`${banners.clicks} + 1` }).where(and(eq(banners.id, id), eq(banners.orgId, req.auth.orgId))).returning();
    if (!b) throw notFound("banner");
    return { link: { type: b.linkType, target: b.linkTarget } };
  });

  // --- Announcements --------------------------------------------------------------------
  const presentAnnouncement = (a: typeof announcements.$inferSelect, now: Date) => ({
    ...a,
    state: a.endedEarlyAt || a.endsAt <= now ? "ended" : a.startsAt > now ? "scheduled" : "showing",
  });
  app.get("/announcements", async (req) => {
    requirePermission(req, "postAnnouncements");
    const now = new Date();
    const rows = await db.select().from(announcements).where(and(eq(announcements.orgId, req.auth.orgId), gt(announcements.endsAt, new Date(now.getTime() - 30 * 86_400_000)))).orderBy(desc(announcements.startsAt));
    return rows.map((a) => presentAnnouncement(a, now));
  });
  app.post("/announcements", async (req, reply) => {
    requirePermission(req, "postAnnouncements");
    const input = parse(announcementInput, req.body);
    const org = await getOrg(db, req.auth.orgId);
    const now = new Date();
    const startsAt = input.startsAt && input.startsAt > now ? input.startsAt : now;
    const endsAt = announcementEnd(input.duration, startsAt, org.timezone, input.endsAt);
    if (endsAt <= startsAt) throw badRequest("ends_before_start", "It needs to end after it starts.");
    if (input.locationId) {
      const [l] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, input.locationId), eq(locations.orgId, org.id)));
      if (!l) throw notFound("location");
    }
    const out = await inTx(app, async (tx) => {
      const [a] = await tx
        .insert(announcements)
        .values({ orgId: org.id, title: input.title, message: input.message, importance: input.importance, audience: input.audience, locationId: input.locationId ?? null, bookedWithinDays: input.bookedWithinDays, startsAt, endsAt, sendPush: input.sendPush, createdBy: req.auth.userId })
        .returning();
      let pushedTo = 0;
      if (input.sendPush) {
        // Service messages (about the studio itself), so they reach everyone affected, not only marketing opt-ins.
        const ids = await announcementAudience(tx, org.id, a!, startsAt);
        pushedTo = (await queuePush(tx, org.id, ids, { title: input.title, body: input.message.slice(0, 180), marketing: false, ref: { announcementId: a!.id }, sendAfter: startsAt })).sent;
        await tx.update(announcements).set({ pushedTo }).where(eq(announcements.id, a!.id));
      }
      await audit(tx, { orgId: org.id, actorId: req.auth.userId, action: "announcement.posted", entityType: "announcement", entityId: a!.id, details: { pushedTo } });
      return { ...presentAnnouncement({ ...a!, pushedTo }, now), message: input.sendPush ? `Posted. ${pushedTo} ${pushedTo === 1 ? "person" : "people"} will get a push notification${startsAt > now ? " when it starts" : ""}.` : "Posted in the app." };
    });
    reply.code(201);
    return out;
  });
  /** Fix a typo or change how long it stays. (The push notification, if already sent, can't be changed.) */
  app.patch("/announcements/:id", async (req) => {
    requirePermission(req, "postAnnouncements");
    const { id } = parse(idParam, req.params);
    const input = parse(z.object({ title: z.string().trim().min(1).max(80).optional(), message: z.string().trim().min(1).max(500).optional(), importance: z.enum(["info", "important"]).optional(), endsAt: z.coerce.date().optional() }), req.body);
    const [cur] = await db.select().from(announcements).where(and(eq(announcements.id, id), eq(announcements.orgId, req.auth.orgId)));
    if (!cur) throw notFound("announcement");
    if (input.endsAt && input.endsAt <= cur.startsAt) throw badRequest("ends_before_start", "It needs to end after it starts.");
    const [a] = await db.update(announcements).set(input).where(eq(announcements.id, id)).returning();
    return presentAnnouncement(a!, new Date());
  });
  /** Take it down now (e.g. the lift is fixed). Unsent pushes for a scheduled one are cancelled. */
  app.post("/announcements/:id/end", async (req) => {
    requirePermission(req, "postAnnouncements");
    const { id } = parse(idParam, req.params);
    return inTx(app, async (tx) => {
      const [a] = await tx.update(announcements).set({ endedEarlyAt: new Date() }).where(and(eq(announcements.id, id), eq(announcements.orgId, req.auth.orgId), isNull(announcements.endedEarlyAt))).returning();
      if (!a) throw conflict("already_ended", "This announcement has already ended.");
      await tx.delete(notifications).where(and(eq(notifications.orgId, a.orgId), eq(notifications.status, "pending"), sql`${notifications.data}->'ref'->>'announcementId' = ${a.id}`));
      return presentAnnouncement(a, new Date());
    });
  });
  /** Client app: announcements showing now, for this person (front page), most important first. */
  app.get("/me/announcements", async (req) => {
    const now = new Date();
    const rows = await db
      .select()
      .from(announcements)
      .leftJoin(announcementDismissals, and(eq(announcementDismissals.announcementId, announcements.id), eq(announcementDismissals.userId, req.auth.userId)))
      .where(and(eq(announcements.orgId, req.auth.orgId), lte(announcements.startsAt, now), gt(announcements.endsAt, now), isNull(announcements.endedEarlyAt), isNull(announcementDismissals.userId)))
      .orderBy(desc(sql`${announcements.importance} = 'important'`), desc(announcements.startsAt));
    const out = [];
    for (const { announcements: a } of rows) {
      if (a.audience !== "everyone" && !(await announcementAudience(db, a.orgId, a, now)).includes(req.auth.userId)) continue;
      const loc = a.locationId ? (await db.select({ name: locations.name }).from(locations).where(eq(locations.id, a.locationId)))[0]?.name : null;
      out.push({ id: a.id, title: a.title, message: a.message, importance: a.importance, location: loc ?? null, postedAt: a.startsAt, showsUntil: a.endsAt });
    }
    return out;
  });
  app.post("/me/announcements/:id/dismiss", async (req) => {
    const { id } = parse(idParam, req.params);
    const [a] = await db.select({ id: announcements.id }).from(announcements).where(and(eq(announcements.id, id), eq(announcements.orgId, req.auth.orgId)));
    if (!a) throw notFound("announcement");
    await db.insert(announcementDismissals).values({ announcementId: id, userId: req.auth.userId }).onConflictDoNothing();
    return { ok: true };
  });

  // --- Gift cards -------------------------------------------------------------------------
  const settingsView = (org: Awaited<ReturnType<typeof getOrg>>) => ({
    giftCardsEnabled: org.giftCardsEnabled,
    giftCardAmounts: org.giftCardAmounts,
    giftCardCustomMinCents: org.giftCardCustomMinCents,
    giftCardCustomMaxCents: org.giftCardCustomMaxCents,
    giftCardValidityDays: org.giftCardValidityDays,
    giftCardGiveWithinDays: org.giftCardGiveWithinDays,
    rules: [
      `Gift cards are studio credit for anything in your online store, valid for ${org.giftCardValidityDays} days from when they're given.`,
      `Cards bought to give later can wait up to ${org.giftCardGiveWithinDays} days; after that they become the buyer's own credit.`,
      "Gift cards can't be bought with studio credit.",
    ],
  });
  app.get("/gift-cards/settings", async (req) => {
    requirePermission(req, "manageMarketing");
    const org = await getOrg(db, req.auth.orgId);
    const designs = await db.select().from(giftCardDesigns).where(eq(giftCardDesigns.orgId, org.id)).orderBy(asc(giftCardDesigns.sortOrder));
    return { ...settingsView(org), designs: designs.map((d) => ({ ...d, imageUrl: publicFileUrl(app.config.PUBLIC_API_URL, d.fileId) })) };
  });
  app.patch("/gift-cards/settings", async (req) => {
    requirePermission(req, "manageMarketing");
    const input = parse(giftCardSettings, req.body);
    const org = await getOrg(db, req.auth.orgId);
    const next = { ...org, ...input };
    if ((next.giftCardCustomMinCents === null) !== (next.giftCardCustomMaxCents === null) || (next.giftCardCustomMinCents ?? 0) > (next.giftCardCustomMaxCents ?? 0)) throw badRequest("bad_range", "Give both a lowest and a highest custom amount, lowest first (or neither).");
    if (next.giftCardsEnabled && !next.giftCardAmounts.length && next.giftCardCustomMinCents === null) throw badRequest("no_amounts", "Add at least one amount, or allow custom amounts.");
    if (input.giftCardsEnabled) {
      const [d] = await db.select({ n: count() }).from(giftCardDesigns).where(and(eq(giftCardDesigns.orgId, org.id), eq(giftCardDesigns.active, true)));
      if (!Number(d!.n)) throw badRequest("no_designs", "Add at least one gift card design before switching gift cards on.");
    }
    const [u] = await db.update(organizations).set(input).where(eq(organizations.id, org.id)).returning();
    return settingsView(u!);
  });
  app.post("/gift-cards/designs", async (req, reply) => {
    requirePermission(req, "manageMarketing");
    const input = parse(giftCardDesignInput, req.body);
    const [f] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, input.fileId), eq(files.orgId, req.auth.orgId), eq(files.purpose, "gift_card_design")));
    if (!f) throw badRequest("missing_image", "Upload the design's photo first.");
    const [c] = await db.select({ n: count() }).from(giftCardDesigns).where(eq(giftCardDesigns.orgId, req.auth.orgId));
    const [d] = await db.insert(giftCardDesigns).values({ ...input, orgId: req.auth.orgId, sortOrder: Number(c!.n) }).returning();
    reply.code(201);
    return { ...d!, imageUrl: publicFileUrl(app.config.PUBLIC_API_URL, d!.fileId) };
  });
  /** Change a design's name or photo, or hide it. Cards already bought keep the design they had. */
  app.patch("/gift-cards/designs/:id", async (req) => {
    requirePermission(req, "manageMarketing");
    const { id } = parse(idParam, req.params);
    const input = parsePatch(giftCardDesignInput.partial(), req.body);
    if (input.fileId) {
      const [f] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, input.fileId), eq(files.orgId, req.auth.orgId), eq(files.purpose, "gift_card_design")));
      if (!f) throw badRequest("missing_image", "Upload the new photo first.");
    }
    const [d] = await db.update(giftCardDesigns).set(input).where(and(eq(giftCardDesigns.id, id), eq(giftCardDesigns.orgId, req.auth.orgId))).returning();
    if (!d) throw notFound("design");
    return { ...d, imageUrl: publicFileUrl(app.config.PUBLIC_API_URL, d.fileId) };
  });
  /** All gift cards sold (admins). */
  app.get("/gift-cards", async (req) => {
    requirePermission(req, "manageMarketing");
    const org = await getOrg(db, req.auth.orgId);
    const rows = await db
      .select({ c: giftCards, buyer: sql<string>`b.first_name || ' ' || b.last_name`, recipient: sql<string | null>`r.first_name || ' ' || r.last_name` })
      .from(giftCards)
      .innerJoin(sql`users b`, sql`b.id = ${giftCards.buyerId}`)
      .leftJoin(sql`users r`, sql`r.id = ${giftCards.recipientId}`)
      .where(eq(giftCards.orgId, org.id))
      .orderBy(desc(giftCards.createdAt))
      .limit(500);
    return rows.map((r) => ({ ...r.c, amount: money(r.c.amountCents, r.c.currency), buyer: r.buyer, recipient: r.recipient }));
  });

  /** Client: what's on offer in the gift card shop. */
  app.get("/gift-cards/shop", async (req) => {
    const org = await getOrg(db, req.auth.orgId);
    if (!org.giftCardsEnabled) return { enabled: false };
    const designs = await db.select().from(giftCardDesigns).where(and(eq(giftCardDesigns.orgId, org.id), eq(giftCardDesigns.active, true))).orderBy(asc(giftCardDesigns.sortOrder));
    return {
      enabled: true,
      designs: designs.map((d) => ({ id: d.id, name: d.name, imageUrl: publicFileUrl(app.config.PUBLIC_API_URL, d.fileId) })),
      amounts: org.giftCardAmounts.map((a) => ({ cents: a, label: money(a, org.currency) })),
      custom: org.giftCardCustomMinCents !== null ? { min: money(org.giftCardCustomMinCents, org.currency), max: money(org.giftCardCustomMaxCents!, org.currency), minCents: org.giftCardCustomMinCents, maxCents: org.giftCardCustomMaxCents } : null,
      rules: settingsView(org).rules,
      howToGive: ["Give it now: enter their email or phone number. They need an account with us; it arrives as soon as you've paid.", `Give it later: it waits in your Gift cards tab for up to ${org.giftCardGiveWithinDays} days. Send it whenever you're ready.`],
    };
  });
  app.get("/me/gift-cards", async (req) => {
    const org = await getOrg(db, req.auth.orgId);
    const rows = await db.select().from(giftCards).where(and(eq(giftCards.orgId, org.id), or(eq(giftCards.buyerId, req.auth.userId), eq(giftCards.recipientId, req.auth.userId)))).orderBy(desc(giftCards.createdAt));
    const cards = await presentCards(db, org, rows.filter((r) => r.status !== "cancelled"), req.auth.userId);
    const me = req.auth.userId;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      toGive: cards.filter((c) => c.status === "unsent" || c.status === "pending_payment"),
      received: cards.filter((c) => byId.get(c.id)!.recipientId === me && byId.get(c.id)!.buyerId !== me),
      given: cards.filter((c) => byId.get(c.id)!.buyerId === me && c.status === "given"),
      kept: cards.filter((c) => c.status === "kept"),
      credit: await creditSummary(db, org.id, me),
    };
  });
  async function myUnsent(orgId: string, buyerId: string, id: string, tx: DbOrTx) {
    const [c] = await tx.select().from(giftCards).where(and(eq(giftCards.id, id), eq(giftCards.orgId, orgId), eq(giftCards.buyerId, buyerId))).for("update");
    if (!c) throw notFound("gift card");
    if (c.status === "pending_payment") throw conflict("not_paid", "This gift card hasn't been paid for yet.");
    if (c.status !== "unsent") throw conflict("already_given", "This gift card has already been given.");
    return c;
  }
  app.post("/gift-cards/:id/give", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(giftRecipient, req.body);
    const org = await getOrg(db, req.auth.orgId);
    const r = await findRecipient(db, org.id, input.to);
    if (!r) throw conflict("recipient_not_found", `We couldn't find one account at ${org.name} with that ${input.to.includes("@") ? "email address" : "phone number"}. Ask them to join first, then try again.`);
    return inTx(app, async (tx) => {
      const c = await myUnsent(org.id, req.auth.userId, id, tx);
      const u = await deliver(tx, c, r.id, { fromName: input.fromName, message: input.message });
      await auditGift(tx, org.id, req.auth.userId, "gift_card.given", c.id, { to: r.id });
      return (await presentCards(tx, org, [u], req.auth.userId))[0];
    });
  });
  app.post("/gift-cards/:id/keep", async (req) => {
    const { id } = parse(idParam, req.params);
    const org = await getOrg(db, req.auth.orgId);
    return inTx(app, async (tx) => {
      const c = await myUnsent(org.id, req.auth.userId, id, tx);
      const u = await keep(tx, c, false);
      return (await presentCards(tx, org, [u], req.auth.userId))[0];
    });
  });

  // --- Studio credit -------------------------------------------------------------------------
  app.get("/me/credit", async (req) => {
    const org = await getOrg(db, req.auth.orgId);
    const vs = await usableVouchers(db, org.id, req.auth.userId);
    return { ...(await creditSummary(db, org.id, req.auth.userId)), discounts: vs.map((v) => ({ id: v.id, label: voucherLabel(v, org.currency), note: v.note, expiresAt: v.expiresAt })) };
  });
  app.get("/clients/:id/credit", async (req) => {
    requirePermission(req, "viewClientDetails");
    const { id } = parse(idParam, req.params);
    return creditSummary(db, req.auth.orgId, id);
  });
  app.post("/clients/:id/credit", async (req) => {
    requirePermission(req, "manageMarketing");
    const { id } = parse(idParam, req.params);
    const input = parse(creditAdjustment, req.body);
    const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, id), eq(memberships.role, "client")));
    if (!m) throw notFound("client");
    return inTx(app, (tx) => adjustCredit(tx, req.auth, id, input));
  });

  // --- Referrals --------------------------------------------------------------------------------
  const referralView = (org: Awaited<ReturnType<typeof getOrg>>) => ({
    referralsEnabled: org.referralsEnabled,
    referralQualify: org.referralQualify,
    referralQualifyValue: org.referralQualifyValue,
    referralQualifyWithinDays: org.referralQualifyWithinDays,
    referrerReward: org.referrerReward,
    refereeReward: org.refereeReward,
    referralCodeWindowDays: org.referralCodeWindowDays,
    referralMonthlyCap: org.referralMonthlyCap,
    qualifyOptions: REFERRAL_QUALIFY,
    rewardOptions: REWARD_TYPES,
    howItWorks: describeReferralRules(org),
  });
  app.get("/referrals/settings", async (req) => {
    requirePermission(req, "manageMarketing");
    return referralView(await getOrg(db, req.auth.orgId));
  });
  app.patch("/referrals/settings", async (req) => {
    requirePermission(req, "manageMarketing");
    const input = parse(referralSettings, req.body);
    const [u] = await db.update(organizations).set(input).where(eq(organizations.id, req.auth.orgId)).returning();
    return referralView(u!);
  });
  app.get("/referrals", async (req) => {
    requirePermission(req, "manageMarketing");
    return referralReport(db, req.auth.orgId);
  });
  /** Staff: add a referral a client missed (any time; still one per person). */
  app.post("/clients/:id/referral", async (req, reply) => {
    requirePermission(req, "manageMarketing");
    const { id } = parse(idParam, req.params);
    const { code } = parse(applyReferralBody, req.body);
    const r = await inTx(app, (tx) => applyReferral(tx, req.auth.orgId, id, code, "staff", req.auth.userId));
    reply.code(201);
    return { referrer: r.referrerFirstName, welcomeGift: r.welcomeGift };
  });
  app.get("/me/referral", async (req) => {
    if (req.auth.role !== "client") throw forbidden("Referral links are for clients.");
    return myReferrals(db, req.auth.orgId, req.auth.userId, appUrl);
  });
  /** A new member adds a friend's code (within the studio's grace period, before their first purchase). */
  app.post("/me/referral", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req) => {
    if (req.auth.role !== "client") throw forbidden("Referral codes are for clients.");
    const { code } = parse(applyReferralBody, req.body);
    const r = await inTx(app, (tx) => applyReferral(tx, req.auth.orgId, req.auth.userId, code, "later", req.auth.userId));
    return { referrer: r.referrerFirstName, welcomeGift: r.welcomeGift, message: `Thanks! ${r.referrerFirstName} will be rewarded once you qualify.${r.welcomeGift ? ` You've got ${r.welcomeGift}.` : ""}` };
  });
}
