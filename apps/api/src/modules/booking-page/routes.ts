/**
 * Booking on the web.
 *
 * Studio side (owners and admins):
 *  - GET/PUT /booking-page   the studio's link (<app>/s/<slug>), on/off, a line at the top, the
 *                            widget colour, and the code to paste into the studio's own website.
 *
 * Public (no sign-in; read-only; any website may call them, for the widget):
 *  - GET /public/studios/:slug                 the studio: name, locations, class types, rules in brief
 *  - GET /public/studios/:slug/schedule        the timetable, day by day, with spots left
 *  - GET /public/studios/:slug/classes/:id     one class, and what's needed to book it
 *  - GET /public/studios/:slug/packages        what's on sale, with the terms in plain English
 *  - GET /public/widget.js                     the website widget
 *
 * Booking and buying stay in the client app: the links go to <app>/s/<slug>/..., where people sign
 * in (or create an account and join the studio) and book with the usual rules and payments. The
 * public endpoints only show what a member would see on the timetable: no one's name or booking,
 * and appointments stay private.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { bookingPageSettings, publicScheduleQuery, slugify, type BookingPageSettings } from "@studio/shared";
import { DateTime } from "luxon";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { classSessions, classTypes, locations, organizations, packagePlans } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { zoneFor } from "../../lib/time.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { publicFileUrl } from "../files/routes.js";
import { planTerms } from "../packages/lifecycle.js";
import { settingsFor } from "../sales/invoices.js";
import { getCalendar } from "../sessions/calendar.js";
import { getOrg } from "../sessions/context.js";
import { onlineReady } from "../payments/service.js";
import { WIDGET_JS } from "./widget.js";

type Org = Awaited<ReturnType<typeof getOrg>>;
const NOBODY = "00000000-0000-0000-0000-000000000000";
const slugParam = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/) });
const classParams = slugParam.extend({ id: z.uuid() });
const PUBLIC = { public: true, rateLimit: { max: 240, timeWindow: "1 minute" } } as const;

/** A free link for a studio, from its name (adds -2, -3... if taken). */
export async function uniqueSlug(db: DbOrTx, name: string, exceptOrgId?: string) {
  const base = slugify(name);
  for (let i = 1; i < 50; i++) {
    const s = i === 1 ? base : `${base.slice(0, 37)}-${i}`;
    const [taken] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.slug, s), exceptOrgId ? ne(organizations.id, exceptOrgId) : undefined));
    if (!taken) return s;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}

/** "Ana L.": instructors' first name and initial on public pages. */
const publicName = (full: string | undefined) => {
  if (!full) return null;
  const [first, ...rest] = full.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1]![0]!.toUpperCase()}.` : first!;
};

export async function bookingPageRoutes(app: FastifyInstance) {
  const { db, config } = app;
  const base = config.PUBLIC_APP_URL.replace(/\/$/, "");
  const links = (slug: string) => ({ page: `${base}/s/${slug}`, packages: `${base}/s/${slug}/packages`, classUrl: (id: string) => `${base}/s/${slug}/classes/${id}`, planUrl: (id: string) => `${base}/s/${slug}/packages/${id}` });

  async function accentOf(org: Org) {
    return org.bookingAccent ?? (await settingsFor(db, org.id)).accentColor ?? "#0C6156";
  }

  async function view(orgId: string) {
    const org = await getOrg(db, orgId);
    const slug = org.slug ?? (await uniqueSlug(db, org.name, org.id));
    const l = links(slug);
    const api = config.PUBLIC_API_URL.replace(/\/$/, "");
    const accent = await accentOf(org);
    return {
      slug,
      saved: !!org.slug,
      enabled: org.bookingPageEnabled,
      intro: org.bookingIntro,
      accent: org.bookingAccent,
      accentInUse: accent,
      url: l.page,
      live: !!org.slug && org.bookingPageEnabled && org.lifecycle === "live",
      widget: {
        code: `<div data-studio-schedule="${slug}"></div>\n<script src="${api}/v1/public/widget.js" async></script>`,
        options: [
          { attribute: "data-location", what: "Show one location only (its id, from the list below)." },
          { attribute: "data-days", what: "How many days to show, 1 to 14 (7 if left out)." },
          { attribute: "data-theme", what: "light, dark, or auto to follow the visitor's device." },
        ],
        locations: (await db.select({ id: locations.id, name: locations.name }).from(locations).where(and(eq(locations.orgId, org.id), isNull(locations.archivedAt))).orderBy(asc(locations.name))),
        link: `<a href="${l.page}">Book a class</a>`,
        note: "Paste the code where the timetable should appear (most website builders have an \"Embed\" or \"Custom code\" block). Its Book buttons open your booking page, where clients sign in and book.",
      },
    };
  }

  app.get("/booking-page", async (req) => {
    requirePermission(req, "manageSettings");
    return view(req.auth.orgId);
  });

  app.put("/booking-page", async (req) => {
    requirePermission(req, "manageSettings");
    const input: BookingPageSettings = parse(bookingPageSettings, req.body);
    await inTx(app, async (tx) => {
      const [taken] = await tx.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.slug, input.slug), ne(organizations.id, req.auth.orgId)));
      if (taken) throw conflict("slug_taken", `Another studio already uses that link. How about ${await uniqueSlug(tx, input.slug, req.auth.orgId)}?`, { fields: { slug: "Another studio already uses that link." } });
      const before = await getOrg(tx, req.auth.orgId);
      await tx.update(organizations).set({ slug: input.slug, bookingPageEnabled: input.enabled, bookingIntro: input.intro || null, bookingAccent: input.accent }).where(eq(organizations.id, req.auth.orgId));
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "booking_page.updated", entityType: "organization", entityId: req.auth.orgId, details: { slug: input.slug, enabled: input.enabled, ...(before.slug && before.slug !== input.slug ? { previousSlug: before.slug } : {}) } });
    });
    return view(req.auth.orgId);
  });

  // --- Public ------------------------------------------------------------------------------
  /** A studio whose booking page is open to the public. */
  async function studioBySlug(slug: string) {
    const [row] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
    if (!row) throw notFound("studio");
    const org = await getOrg(db, row.id);
    if (!org.bookingPageEnabled || org.lifecycle !== "live") throw notFound("studio");
    return org;
  }
  // Public and cacheable, and other websites may load it (the widget): the security headers
  // otherwise say "this site only".
  const cache = (reply: { header: (k: string, v: string) => unknown }, seconds = 60) => {
    reply.header("cache-control", `public, max-age=${seconds}`);
    reply.header("cross-origin-resource-policy", "cross-origin");
  };

  app.get("/public/studios/:slug", { config: PUBLIC }, async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    const org = await studioBySlug(slug);
    const s = await settingsFor(db, org.id);
    const l = links(slug);
    const locs = await db.select({ id: locations.id, name: locations.name, address: locations.address, timezone: locations.timezone }).from(locations).where(and(eq(locations.orgId, org.id), isNull(locations.archivedAt))).orderBy(asc(locations.name));
    const types = await db.select({ id: classTypes.id, name: classTypes.name, color: classTypes.color, description: classTypes.description }).from(classTypes).where(and(eq(classTypes.orgId, org.id), eq(classTypes.kind, "class"))).orderBy(asc(classTypes.name));
    cache(reply, 300);
    return {
      id: org.id,
      slug,
      name: org.name,
      intro: org.bookingIntro,
      accent: await accentOf(org),
      logoUrl: s.logoFileId ? publicFileUrl(config.PUBLIC_API_URL, s.logoFileId) : null,
      currency: org.currency,
      timezone: org.timezone,
      locations: locs,
      classTypes: types,
      rules: {
        bookingOpens: `Booking opens ${org.bookingOpensDaysBefore} ${org.bookingOpensDaysBefore === 1 ? "day" : "days"} ahead`,
        bookingCloses: org.bookingClosesMinutesBefore ? `and closes ${org.bookingClosesMinutesBefore >= 60 && org.bookingClosesMinutesBefore % 60 === 0 ? `${org.bookingClosesMinutesBefore / 60} ${org.bookingClosesMinutesBefore === 60 ? "hour" : "hours"}` : `${org.bookingClosesMinutesBefore} minutes`} before the class` : "and stays open until the class starts",
        cancelling: `Cancel up to ${org.lateCancelWindowHours} ${org.lateCancelWindowHours === 1 ? "hour" : "hours"} before to get the class back.`,
        needPackage: org.clientsNeedPackage,
        payOnline: onlineReady(org),
        waiver: org.waiverRequired,
      },
      links: { page: l.page, packages: l.packages },
      contact: { phone: org.phone, website: org.website, instagram: org.instagram, address: org.address },
    };
  });

  app.get("/public/studios/:slug/schedule", { config: PUBLIC }, async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    const q = parse(publicScheduleQuery, req.query);
    const org = await studioBySlug(slug);
    const today = DateTime.now().setZone(zoneFor(org.timezone, org.observesDaylightSaving)).toISODate()!;
    const date = q.date && q.date >= today ? q.date : today;
    // What a member sees on the timetable, without anyone's own bookings.
    const cal = await getCalendar(db, { userId: NOBODY, orgId: org.id, role: "client" }, { view: "day", date, locationId: q.locationId, classTypeId: q.classTypeId, includeCancelled: false }, q.days);
    const now = Date.now();
    const l = links(slug);
    const byDay = new Map<string, unknown[]>();
    for (const s of cal.sessions) {
      if (s.isAppointment || Date.parse(s.startsAt) <= now) continue;
      const spots = s.spotsLeft;
      const availability = s.bookingWindow === "not_open_yet" ? "not_open_yet" : s.bookingWindow === "closed" ? "closed" : s.isFull ? (s.waitlistEnabled ? "waitlist" : "full") : spots <= 3 ? "few_left" : "open";
      const list = byDay.get(s.localDate) ?? [];
      list.push({
        id: s.id,
        name: s.classType.name,
        color: s.color,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        localDate: s.localDate,
        time: s.localStartTime,
        endTime: s.localEndTime,
        durationMinutes: Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60_000),
        location: { id: s.location.id, name: s.location.name },
        room: s.roomName,
        instructor: s.instructor ? { name: publicName(s.instructor.name), photoUrl: s.instructor.photoUrl } : null,
        spotsLeft: spots,
        availability,
        label: { open: `${spots} spots left`, few_left: `${spots} ${spots === 1 ? "spot" : "spots"} left`, full: "Full", waitlist: "Full: join the waitlist", not_open_yet: `Booking opens ${DateTime.fromISO(s.bookingOpensAt).setZone(s.location.timezone).toFormat("ccc d LLL")}`, closed: "Booking closed" }[availability],
        bookingOpensAt: s.bookingOpensAt,
        bookUrl: l.classUrl(s.id),
      });
      byDay.set(s.localDate, list);
    }
    const days = [];
    const zone = zoneFor(org.timezone, org.observesDaylightSaving);
    for (let i = 0; i < q.days; i++) {
      const d = DateTime.fromISO(date, { zone }).plus({ days: i });
      const iso = d.toISODate()!;
      // Closed for the whole studio (or the location being shown) that day.
      const closed = cal.closures.find((c) => c.startDate <= iso && iso <= c.endDate && (!c.locationId || c.locationId === q.locationId));
      days.push({ date: iso, label: i === 0 && iso === today ? "Today" : d.toFormat("ccc d LLL"), closed: closed ? { name: closed.name, message: closed.message ?? null } : null, classes: byDay.get(iso) ?? [] });
    }
    cache(reply);
    return { studio: { name: org.name, slug, accent: await accentOf(org) }, timezone: cal.timezone, from: date, days, links: { page: l.page } };
  });

  app.get("/public/studios/:slug/classes/:id", { config: PUBLIC }, async (req, reply) => {
    const { slug, id } = parse(classParams, req.params);
    const org = await studioBySlug(slug);
    // The class, seen as on the timetable for its day.
    const [row] = await db.select({ startsAt: classSessions.startsAt, tz: locations.timezone }).from(classSessions).innerJoin(locations, eq(locations.id, classSessions.locationId)).where(and(eq(classSessions.id, id), eq(classSessions.orgId, org.id)));
    if (!row) throw notFound("class");
    const day = DateTime.fromJSDate(row.startsAt).setZone(row.tz).toISODate()!;
    const cal = await getCalendar(db, { userId: NOBODY, orgId: org.id, role: "client" }, { view: "day", date: day, timezone: row.tz, includeCancelled: false }, 1);
    const s = cal.sessions.find((x) => x.id === id);
    if (!s || s.isAppointment || Date.parse(s.startsAt) <= Date.now()) throw notFound("class");
    const [type] = await db.select({ description: classTypes.description }).from(classTypes).where(eq(classTypes.id, s.classType.id));
    const [loc] = await db.select({ address: locations.address }).from(locations).where(eq(locations.id, s.location.id));
    // Packages that cover it (every class, or this class type), cheapest first.
    const plans = await db.select().from(packagePlans).where(and(eq(packagePlans.orgId, org.id), eq(packagePlans.onSale, true), isNull(packagePlans.archivedAt))).orderBy(asc(packagePlans.priceCents));
    const covering = plans.filter((p) => !p.classTypeIds.length || p.classTypeIds.includes(s.classType.id)).slice(0, 4);
    const l = links(slug);
    cache(reply);
    return {
      id: s.id,
      name: s.classType.name,
      description: type?.description ?? null,
      color: s.color,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      date: DateTime.fromISO(s.startsAt).setZone(s.location.timezone).toFormat("cccc d LLLL"),
      time: `${s.localStartTime} to ${s.localEndTime}`,
      location: { name: s.location.name, address: loc?.address ?? null },
      room: s.roomName,
      instructor: s.instructor ? { name: publicName(s.instructor.name), photoUrl: s.instructor.photoUrl } : null,
      spotsLeft: s.spotsLeft,
      isFull: s.isFull,
      waitlist: s.isFull && s.waitlistEnabled,
      bookingWindow: s.bookingWindow,
      bookingOpensAt: s.bookingOpensAt,
      toBook: org.clientsNeedPackage
        ? { needPackage: true, text: "You'll need a package that covers this class. You can buy one when you book.", packages: await Promise.all(covering.map(async (p) => ({ id: p.id, name: p.name, price: money(p.priceCents, org.currency), terms: await planTerms(db, p, org.currency), buyUrl: l.planUrl(p.id) }))) }
        : { needPackage: false, text: "Book now and pay at the studio, or use a package if you have one.", packages: [] },
      cancelling: `Cancel up to ${org.lateCancelWindowHours} ${org.lateCancelWindowHours === 1 ? "hour" : "hours"} before to get the class back.`,
      bookUrl: l.classUrl(s.id),
    };
  });

  app.get("/public/studios/:slug/packages", { config: PUBLIC }, async (req, reply) => {
    const { slug } = parse(slugParam, req.params);
    const org = await studioBySlug(slug);
    const plans = await db.select().from(packagePlans).where(and(eq(packagePlans.orgId, org.id), eq(packagePlans.onSale, true), isNull(packagePlans.archivedAt))).orderBy(asc(packagePlans.priceCents));
    const l = links(slug);
    cache(reply, 300);
    return {
      studio: { name: org.name, slug },
      packages: await Promise.all(
        plans.map(async (p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          kind: p.kind,
          billing: p.billing,
          price: money(p.priceCents, org.currency),
          priceCents: p.priceCents,
          photoUrl: p.photoFileId ? publicFileUrl(config.PUBLIC_API_URL, p.photoFileId) : null,
          terms: await planTerms(db, p, org.currency),
          buyUrl: l.planUrl(p.id),
        })),
      ),
    };
  });

  app.get("/public/widget.js", { config: { public: true } }, async (_req, reply) => {
    reply.header("content-type", "application/javascript; charset=utf-8").header("cache-control", "public, max-age=3600").header("cross-origin-resource-policy", "cross-origin");
    return WIDGET_JS;
  });
}
