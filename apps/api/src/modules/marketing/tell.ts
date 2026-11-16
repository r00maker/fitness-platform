/**
 * Tell clients: one flow for everything the studio says to its clients. Write it once, then
 * choose who (everyone, a location, people booked at a location soon, a segment) and where:
 *
 *  - a notice in the app (studio news: a closure, a change),
 *  - a banner (Growth and Signature),
 *  - a push notification,
 *  - an email.
 *
 * It's the same as making an announcement, a banner and a campaign by hand (those pages still
 * list and manage what this creates), with one confirm step that shows how many people each
 * place reaches. Studio news reaches everyone it's about; offers only reach people who agreed
 * to marketing (by push or email), and can't be notices.
 */
import type { FastifyInstance } from "fastify";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";
import { FEATURE_LABELS, planIncludes, tellClients, type TellClientsInput, can, emailDesign } from "@studio/shared";
import type { DbOrTx } from "../../db/client.js";
import { announcements, banners, emailCampaigns, emailDesigns, files, locations, memberships, segments } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { getOrg } from "../sessions/context.js";
import { announcementAudience, announcementEnd } from "./app-routes.js";
import { queueDesignEmail, queuePush } from "./messages.js";
import { allClients, matchSegment } from "./segments.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function audienceIds(db: DbOrTx, orgId: string, a: TellClientsInput["audience"], now: Date) {
  if (a.type === "segment") {
    const [sg] = await db.select().from(segments).where(and(eq(segments.id, a.segmentId!), eq(segments.orgId, orgId)));
    if (!sg) throw notFound("segment");
    return matchSegment(db, orgId, sg.definition);
  }
  if (a.type === "everyone") return allClients(db, orgId);
  return announcementAudience(db, orgId, { audience: a.type, locationId: a.locationId ?? null, bookedWithinDays: a.bookedWithinDays }, now);
}
async function agreed(db: DbOrTx, orgId: string, ids: string[], col: "marketingEmail" | "marketingPush") {
  if (!ids.length) return 0;
  const [c] = await db.select({ n: count() }).from(memberships).where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, ids), eq(memberships[col], true)));
  return Number(c!.n);
}
function marketingOn(org: Org) {
  if (!planIncludes(org.plan, "marketing")) throw conflict("not_in_plan", `Banners and offers come with ${FEATURE_LABELS.marketing} on Growth and Signature. Studio news can go out on any plan.`);
  if (org.featuresOff.includes("marketing")) throw conflict("feature_off", "Marketing is switched off. Switch it on under Setup, Features to send offers and banners.");
}

export async function tellClientsRoutes(app: FastifyInstance) {
  const { db, config } = app;

  /** What clients have been told lately, in one list (notices, banners, emails). */
  app.get("/tell-clients", async (req) => {
    if (!can(req.auth.role, "postAnnouncements") && !can(req.auth.role, "manageMarketing")) throw forbidden();
    const since = new Date(Date.now() - 60 * 86_400_000);
    const a = await db.select().from(announcements).where(and(eq(announcements.orgId, req.auth.orgId), gt(announcements.createdAt, since))).orderBy(desc(announcements.createdAt)).limit(50);
    const b = can(req.auth.role, "manageMarketing") ? await db.select().from(banners).where(and(eq(banners.orgId, req.auth.orgId), gt(banners.createdAt, since))).orderBy(desc(banners.createdAt)).limit(50) : [];
    const c = can(req.auth.role, "manageMarketing") ? await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.orgId, req.auth.orgId), gt(emailCampaigns.createdAt, since))).orderBy(desc(emailCampaigns.createdAt)).limit(50) : [];
    const items = [
      ...a.map((x) => ({ id: x.id, place: "notice" as const, title: x.title, at: x.createdAt, detail: `${x.importance === "important" ? "Important notice" : "Notice"}${x.pushedTo ? `, push to ${x.pushedTo}` : ""}` })),
      ...b.map((x) => ({ id: x.id, place: "banner" as const, title: x.title, at: x.createdAt, detail: `Banner on ${x.placement === "home" ? "Home" : x.placement === "schedule" ? "Book a class" : "Packages"}, ${x.clicks} taps` })),
      ...c.map((x) => ({ id: x.id, place: "email" as const, title: x.name, at: x.createdAt, detail: x.status === "sent" ? `Email to ${x.recipients ?? 0}` : `Email (${x.status})` })),
    ].sort((p, q) => +q.at - +p.at);
    return { items };
  });

  /** Say it once; it becomes a notice, a banner, a push and/or an email. Asks first, with the numbers. */
  app.post("/tell-clients", async (req, reply) => {
    const input = parse(tellClients, req.body);
    const p = input.places;
    if (!p.notice && !p.banner && !p.push && !p.email) throw badRequest("no_places", "Choose at least one place: a notice in the app, a banner, a push notification or an email.");
    const org = await getOrg(db, req.auth.orgId);
    const offer = input.kind === "offer";
    // Who can do what: news is for anyone who posts announcements; offers, banners and emails are marketing.
    if (p.notice || (p.push && !offer)) { if (!can(req.auth.role, "postAnnouncements")) throw forbidden(); }
    if (offer || p.banner || p.email) { if (!can(req.auth.role, "manageMarketing")) throw forbidden("Offers, banners and emails are for owners and admins."); marketingOn(org); }
    if (offer && p.notice) throw badRequest("offer_notice", "Notices are for studio news. For an offer, use a banner, a push notification or an email.");
    if (p.banner && !["everyone", "segment"].includes(input.audience.type)) throw badRequest("banner_audience", "Banners can show to everyone or to a segment. Choose one of those, or untick the banner.");
    if (input.audience.type === "segment" && !input.audience.segmentId) throw badRequest("segment_needed", "Choose a segment.");
    if (["location", "booked_at_location"].includes(input.audience.type)) {
      const [l] = input.audience.locationId ? await db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, input.audience.locationId), eq(locations.orgId, org.id))) : [];
      if (!l) throw badRequest("location_needed", "Choose a location.");
    }
    if (p.banner) {
      const [f] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, p.banner.imageFileId), eq(files.orgId, org.id), eq(files.purpose, "banner")));
      if (!f) throw badRequest("missing_image", "Upload the banner image first.");
    }
    const now = new Date();
    const startsAt = input.startsAt && input.startsAt > now ? input.startsAt : now;
    const endsAt = announcementEnd(input.duration, startsAt, org.timezone, null);
    const ids = await audienceIds(db, org.id, input.audience, startsAt);
    if (!ids.length) throw conflict("nobody", "There's nobody in this audience yet.");
    const pushReach = p.push ? (offer ? await agreed(db, org.id, ids, "marketingPush") : ids.length) : 0;
    const emailReach = p.email ? (offer ? await agreed(db, org.id, ids, "marketingEmail") : ids.length) : 0;

    const out = await withFlags(app, input.acknowledge, async (tx, flags) => {
      const parts = [
        p.notice && `a${input.importance === "important" ? "n important" : ""} notice in the app for ${ids.length === 1 ? "1 person" : `${ids.length} people`}`,
        p.banner && `a banner on ${p.banner.placement === "home" ? "Home" : p.banner.placement === "schedule" ? "Book a class" : "Packages"}`,
        p.push && `a push notification to ${plural(pushReach, "person", "people")}`,
        p.email && `an email to ${plural(emailReach, "person", "people")}`,
      ].filter(Boolean);
      flags.confirm({ code: "send_to_many", message: `${startsAt > now ? "Schedule" : "Send"} “${input.title}”: ${parts.join(", ")}?${p.push || p.email ? " Push notifications and emails can't be taken back once they're sent." : ""}` });
      if (offer && ((p.push && pushReach < ids.length) || (p.email && emailReach < ids.length))) flags.info({ code: "people_skipped", message: `It's an offer, so only people who agreed to marketing get it${p.email ? `: ${ids.length - emailReach} won't get the email` : ""}${p.push ? `${p.email ? "," : ":"} ${ids.length - pushReach} won't get the push` : ""}.` });
      const created: Record<string, string> = {};
      const ref = { tell: true };
      if (p.notice) {
        const [a] = await tx.insert(announcements).values({ orgId: org.id, title: input.title, message: input.message, importance: input.importance, audience: input.audience.type === "segment" ? "everyone" : input.audience.type, locationId: input.audience.locationId ?? null, bookedWithinDays: input.audience.bookedWithinDays, startsAt, endsAt, sendPush: p.push && !offer, pushedTo: p.push && !offer ? pushReach : 0, createdBy: req.auth.userId }).returning();
        created.announcementId = a!.id;
      }
      if (p.push) await queuePush(tx, org.id, ids, { title: input.title, body: input.message.slice(0, 180), marketing: offer, ref: { ...ref, ...(created.announcementId ? { announcementId: created.announcementId } : {}) }, sendAfter: startsAt });
      if (p.banner) {
        const [b] = await tx.insert(banners).values({ orgId: org.id, title: input.title, subtitle: input.message.slice(0, 160), imageFileId: p.banner.imageFileId, placement: p.banner.placement, linkType: p.banner.linkType, linkTarget: p.banner.linkTarget ?? null, audience: input.audience.type === "segment" ? "segment" : "everyone", segmentId: input.audience.segmentId ?? null, startsAt, endsAt, active: true, createdBy: req.auth.userId }).returning();
        created.bannerId = b!.id;
      }
      if (p.email) {
        const [last] = await tx.select({ d: emailDesigns.design }).from(emailDesigns).where(eq(emailDesigns.orgId, org.id)).orderBy(desc(emailDesigns.createdAt)).limit(1);
        const design = emailDesign.parse({ subject: input.title, preheader: input.message.slice(0, 120), ...(last ? { theme: last.d.theme } : {}), blocks: [{ type: "heading", text: input.title }, { type: "text", text: input.message }, { type: "button", label: "Open the app", url: config.PUBLIC_APP_URL }] });
        const [e] = await tx.insert(emailDesigns).values({ orgId: org.id, name: input.title, category: offer ? "Promotions" : "Studio news", purpose: offer ? "marketing" : "service", design, createdBy: req.auth.userId }).returning();
        const later = startsAt > now;
        const r = later ? { sent: 0, skipped: 0 } : await queueDesignEmail(tx, org.id, e!, ids, { api: config.PUBLIC_API_URL, app: config.PUBLIC_APP_URL }, { ...ref });
        const [c] = await tx.insert(emailCampaigns).values({ orgId: org.id, name: input.title, emailId: e!.id, emailName: e!.name, segmentId: input.audience.segmentId ?? null, sendAt: later ? startsAt : null, status: later ? "scheduled" : "sent", sentAt: later ? null : now, recipients: r.sent, skipped: r.skipped, createdBy: req.auth.userId }).returning();
        created.emailId = e!.id; created.campaignId = c!.id;
      }
      await audit(tx, { orgId: org.id, actorId: req.auth.userId, action: "clients.told", entityType: "message", entityId: created.announcementId ?? created.bannerId ?? created.campaignId ?? org.id, details: { kind: input.kind, places: Object.keys(p).filter((k) => p[k as keyof typeof p]), audience: input.audience.type, people: ids.length, push: pushReach, email: emailReach } });
      return { created, reach: { audience: ids.length, notice: p.notice ? ids.length : 0, push: pushReach, email: emailReach }, message: `${startsAt > now ? "Scheduled" : "Sent"}: ${parts.join(", ")}.` };
    });
    reply.code(201);
    return out;
  });
}
