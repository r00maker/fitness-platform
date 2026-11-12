/**
 * Marketing for admins: segments, emails (builder), campaigns and journeys.
 */
import type { FastifyInstance } from "fastify";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  ACQUISITION_CHANNELS,
  EMAIL_BLOCK_TYPES,
  JOURNEY_EVENTS,
  JOURNEY_STEP_TYPES,
  JOURNEY_TRIGGERS,
  MERGE_TAGS,
  REWARD_TYPES,
  SEGMENT_FIELDS,
  SEGMENT_OPTION_LABELS,
  campaignInput,
  clientFilter,
  describeRule,
  emailDesign,
  emailDesignInput,
  journeyInput,
  schemas,
  segmentDefinition,
  segmentInput,
  type SegmentDefinition,
  type SegmentField,
} from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import {
  classTypes,
  clientTags,
  emailCampaigns,
  emailDesigns,
  journeyEnrollments,
  journeys,
  locations,
  memberships,
  notifications,
  packagePlans,
  segments,
  users,
} from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";
import { inTx, withFlags } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { money } from "../bookings/rules.js";
import { getOrg } from "../sessions/context.js";
import { checkDesign, plansFor, renderEmail } from "./email.js";
import { checkJourney, describeTrigger, journeyStats, seedSegmentMembers, stepAt } from "./journeys.js";
import { mergeValues, queueDesignEmail, type Urls } from "./messages.js";
import { allClients, clientStats, matchSegment } from "./segments.js";
import { RECIPES, starterEmails } from "./starters.js";

const idParam = z.object({ id: schemas.id });
const ack = z.object({ acknowledge: z.array(z.string()).default([]) });
const archivedQuery = z.object({ archived: z.stringbool().default(false) });
const peopleQuery = z.object({ status: z.enum(["active", "completed", "exited"]).default("active") });
const recipeBody = z.object({ recipe: z.enum(Object.keys(RECIPES) as [string, ...string[]]) });
const enrollBody = z.object({ clientId: schemas.id });
const testBody = z.object({ design: emailDesign.optional(), purpose: z.enum(["marketing", "service"]).optional() });

export const urlsOf = (app: FastifyInstance): Urls => ({ api: app.config.PUBLIC_API_URL, app: app.config.PUBLIC_APP_URL });

/** Names for the things a rule can point at (tags, class types…), for plain-English descriptions. */
async function nameLookup(db: DbOrTx, orgId: string) {
  const [tags, types, staff, locs, plans] = await Promise.all([
    db.select({ id: clientTags.id, name: clientTags.name }).from(clientTags).where(eq(clientTags.orgId, orgId)),
    db.select({ id: classTypes.id, name: classTypes.name }).from(classTypes).where(eq(classTypes.orgId, orgId)),
    db.select({ id: users.id, name: sql<string>`${users.firstName} || ' ' || ${users.lastName}` }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.orgId, orgId), inArray(memberships.role, ["owner", "admin", "instructor"]))),
    db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.orgId, orgId)),
    db.select({ id: packagePlans.id, name: packagePlans.name }).from(packagePlans).where(eq(packagePlans.orgId, orgId)),
  ]);
  const m = new Map<string, string>([...tags, ...types, ...staff, ...locs, ...plans].map((x) => [x.id, x.name]));
  return { lookup: (_f: SegmentField, ids: string[]) => ids.map((i) => m.get(i) ?? "(removed)"), tags, types, staff, locs, plans };
}

async function describeDefinition(db: DbOrTx, orgId: string, def: SegmentDefinition) {
  const org = await getOrg(db, orgId);
  const { lookup } = await nameLookup(db, orgId);
  return def.rules.map((r) => describeRule(r, lookup, (c) => money(c, org.currency)));
}

export async function marketingRoutes(app: FastifyInstance) {
  const { db } = app;
  app.addHook("preHandler", async (req) => requirePermission(req, "manageMarketing"));

  /** Everything the marketing screens need to build their forms. */
  app.get("/marketing/options", async (req) => {
    const n = await nameLookup(db, req.auth.orgId);
    const segs = await db.select({ id: segments.id, name: segments.name }).from(segments).where(eq(segments.orgId, req.auth.orgId)).orderBy(asc(segments.name));
    const emails = await db.select({ id: emailDesigns.id, name: emailDesigns.name, purpose: emailDesigns.purpose }).from(emailDesigns).where(and(eq(emailDesigns.orgId, req.auth.orgId), isNull(emailDesigns.archivedAt))).orderBy(asc(emailDesigns.name));
    return {
      segmentFields: SEGMENT_FIELDS,
      optionLabels: SEGMENT_OPTION_LABELS,
      acquisitionChannels: ACQUISITION_CHANNELS,
      mergeTags: MERGE_TAGS,
      blockTypes: EMAIL_BLOCK_TYPES,
      triggers: JOURNEY_TRIGGERS,
      waitEvents: JOURNEY_EVENTS,
      stepTypes: JOURNEY_STEP_TYPES,
      rewardTypes: REWARD_TYPES,
      recipes: Object.entries(RECIPES).map(([id, r]) => ({ id, name: r.name, description: r.description })),
      pick: { tags: n.tags, classTypes: n.types, instructors: n.staff, locations: n.locs, packageTypes: n.plans },
      segments: segs,
      emails,
    };
  });

  // --- Segments -------------------------------------------------------------------
  /** Filter the client list: any search text plus any rules. Returns the numbers marketers care about. */
  app.post("/clients/filter", async (req) => {
    const input = parse(clientFilter, req.body);
    const orgId = req.auth.orgId;
    let def = input.definition;
    if (input.segmentId) {
      const [sg] = await db.select().from(segments).where(and(eq(segments.id, input.segmentId), eq(segments.orgId, orgId)));
      if (!sg) throw notFound("segment");
      def = sg.definition;
    }
    let ids = def ? await matchSegment(db, orgId, def) : await allClients(db, orgId);
    if (input.q) {
      const search = `%${input.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const hits = ids.length
        ? await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), or(ilike(sql`${users.firstName} || ' ' || ${users.lastName}`, search), ilike(users.email, search), ilike(users.phone, search))))
        : [];
      const set = new Set(hits.map((h) => h.id));
      ids = ids.filter((i) => set.has(i));
    }
    const org = await getOrg(db, orgId);
    const people = ids.length
      ? await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, phone: users.phone, joinedAt: memberships.createdAt, source: memberships.source, marketingEmail: memberships.marketingEmail })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, ids)))
      : [];
    const stats = await clientStats(db, orgId, ids);
    const rows = people.map((p) => ({ ...p, ...stats.get(p.id)!, nettSpend: money(stats.get(p.id)!.nettSpendCents, org.currency) }));
    const by = {
      name: (a: (typeof rows)[number], b: (typeof rows)[number]) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      classes: (a: (typeof rows)[number], b: (typeof rows)[number]) => b.classesAttended - a.classesAttended,
      spend: (a: (typeof rows)[number], b: (typeof rows)[number]) => b.nettSpendCents - a.nettSpendCents,
      last_class: (a: (typeof rows)[number], b: (typeof rows)[number]) => (b.lastClassAt?.getTime() ?? 0) - (a.lastClassAt?.getTime() ?? 0),
      joined: (a: (typeof rows)[number], b: (typeof rows)[number]) => b.joinedAt.getTime() - a.joinedAt.getTime(),
    }[input.sort];
    rows.sort(by);
    return {
      total: rows.length,
      canEmail: rows.filter((r) => r.marketingEmail).length,
      rules: def ? await describeDefinition(db, orgId, def) : [],
      clients: rows.slice(input.offset, input.offset + input.limit),
    };
  });

  app.post("/segments/preview", async (req) => {
    const def = parse(segmentDefinition, req.body);
    const ids = await matchSegment(db, req.auth.orgId, def);
    return { count: ids.length, of: (await allClients(db, req.auth.orgId)).length, rules: await describeDefinition(db, req.auth.orgId, def) };
  });

  app.get("/segments", async (req) => {
    const rows = await db.select().from(segments).where(eq(segments.orgId, req.auth.orgId)).orderBy(asc(segments.name));
    return Promise.all(rows.map(async (s) => ({ ...s, count: (await matchSegment(db, req.auth.orgId, s.definition)).length, rules: await describeDefinition(db, req.auth.orgId, s.definition) })));
  });
  app.post("/segments", async (req, reply) => {
    const input = parse(segmentInput, req.body);
    const [s] = await db.insert(segments).values({ ...input, orgId: req.auth.orgId, createdBy: req.auth.userId }).returning();
    reply.code(201);
    return { ...s!, count: (await matchSegment(db, req.auth.orgId, s!.definition)).length };
  });
  app.patch("/segments/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(segmentInput.partial(), req.body);
    const [s] = await db.update(segments).set(input).where(and(eq(segments.id, id), eq(segments.orgId, req.auth.orgId))).returning();
    if (!s) throw notFound("segment");
    return { ...s, count: (await matchSegment(db, req.auth.orgId, s.definition)).length };
  });
  app.delete("/segments/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const live = await db.select({ name: journeys.name }).from(journeys).where(and(eq(journeys.orgId, req.auth.orgId), sql`${journeys.definition}->'trigger'->>'segmentId' = ${id}`));
    if (live.length) throw conflict("segment_in_use", `This segment starts the journey “${live[0]!.name}”. Change or delete that journey first.`);
    const [s] = await db.delete(segments).where(and(eq(segments.id, id), eq(segments.orgId, req.auth.orgId))).returning();
    if (!s) throw notFound("segment");
    return reply.code(204).send();
  });

  // --- Emails -------------------------------------------------------------------------
  app.get("/emails", async (req) => {
    const { archived } = parse(archivedQuery, req.query);
    return db
      .select({ id: emailDesigns.id, name: emailDesigns.name, purpose: emailDesigns.purpose, subject: sql<string>`${emailDesigns.design}->>'subject'`, updatedAt: emailDesigns.updatedAt, archivedAt: emailDesigns.archivedAt })
      .from(emailDesigns)
      .where(and(eq(emailDesigns.orgId, req.auth.orgId), archived ? isNotNull(emailDesigns.archivedAt) : isNull(emailDesigns.archivedAt)))
      .orderBy(desc(emailDesigns.updatedAt));
  });
  app.get("/emails/starters", async () => Object.entries(starterEmails(app.config.PUBLIC_APP_URL)).map(([id, s]) => ({ id, ...s })));
  app.get("/emails/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const [e] = await db.select().from(emailDesigns).where(and(eq(emailDesigns.id, id), eq(emailDesigns.orgId, req.auth.orgId)));
    if (!e) throw notFound("email");
    return e;
  });
  app.post("/emails", async (req, reply) => {
    const input = parse(emailDesignInput, req.body);
    await checkDesign(db, req.auth.orgId, input.design);
    const [e] = await db.insert(emailDesigns).values({ ...input, orgId: req.auth.orgId, createdBy: req.auth.userId }).returning();
    reply.code(201);
    return e;
  });
  app.patch("/emails/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(emailDesignInput.partial(), req.body);
    if (input.design) await checkDesign(db, req.auth.orgId, input.design);
    const [e] = await db.update(emailDesigns).set(input).where(and(eq(emailDesigns.id, id), eq(emailDesigns.orgId, req.auth.orgId))).returning();
    if (!e) throw notFound("email");
    return e;
  });
  app.post("/emails/:id/duplicate", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const [e] = await db.select().from(emailDesigns).where(and(eq(emailDesigns.id, id), eq(emailDesigns.orgId, req.auth.orgId)));
    if (!e) throw notFound("email");
    const [copy] = await db.insert(emailDesigns).values({ orgId: e.orgId, name: `${e.name} (copy)`.slice(0, 80), purpose: e.purpose, design: e.design, createdBy: req.auth.userId }).returning();
    reply.code(201);
    return copy;
  });
  /** Archived emails are hidden; journeys that send them skip that step. Restore with archived: false. */
  app.post("/emails/:id/archive", async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(z.object({ archived: z.boolean().default(true) }), req.body ?? {});
    const [e] = await db.update(emailDesigns).set({ archivedAt: body.archived ? new Date() : null }).where(and(eq(emailDesigns.id, id), eq(emailDesigns.orgId, req.auth.orgId))).returning();
    if (!e) throw notFound("email");
    const usedBy = (await db.select({ name: journeys.name, def: journeys.definition }).from(journeys).where(and(eq(journeys.orgId, req.auth.orgId), eq(journeys.status, "live")))).filter((j) => JSON.stringify(j.def).includes(id));
    return { ...e, warning: body.archived && usedBy.length ? `Live journeys that send it (${usedBy.map((j) => j.name).join(", ")}) will skip that step.` : null };
  });

  /** See the email as a client would, filled in with your own details (or sample ones). */
  app.post("/emails/preview", async (req) => {
    const body = parse(z.object({ design: emailDesign, purpose: z.enum(["marketing", "service"]).default("marketing"), clientId: schemas.id.optional() }), req.body);
    await checkDesign(db, req.auth.orgId, body.design);
    const org = await getOrg(db, req.auth.orgId);
    const urls = urlsOf(app);
    const sample = { first_name: "Chloe", last_name: "Ng", classes_attended: "24", credits_left: "6", studio_credit: money(5000, org.currency), referral_code: "CHLOE-7K2P", referral_link: `${urls.app}/join` };
    const values = body.clientId ? (await mergeValues(db, org.id, [body.clientId], urls)).get(body.clientId) ?? sample : sample;
    return renderEmail(body.design, { studioName: org.name, publicApiUrl: urls.api, appUrl: urls.app, values, plans: await plansFor(db, org.id, org.currency, body.design), unsubscribeUrl: body.purpose === "marketing" ? `${urls.api}/v1/unsubscribe/preview` : null });
  });
  /** Send yourself a test copy (always sent, whatever your marketing settings). */
  app.post("/emails/:id/test", async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(testBody, req.body ?? {});
    const [e] = await db.select().from(emailDesigns).where(and(eq(emailDesigns.id, id), eq(emailDesigns.orgId, req.auth.orgId)));
    if (!e) throw notFound("email");
    const design = { ...e, design: body.design ?? e.design, purpose: "service" as const };
    await checkDesign(db, req.auth.orgId, design.design);
    const r = await queueDesignEmail(db, req.auth.orgId, design, [req.auth.userId], urlsOf(app), { test: true });
    return { sent: r.sent > 0, message: "A test copy is on its way to your inbox." };
  });

  // --- Campaigns (one-off sends) -----------------------------------------------------
  async function audienceFor(orgId: string, segmentId: string | null) {
    if (!segmentId) return allClients(db, orgId);
    const [sg] = await db.select().from(segments).where(and(eq(segments.id, segmentId), eq(segments.orgId, orgId)));
    if (!sg) throw notFound("segment");
    return matchSegment(db, orgId, sg.definition);
  }
  async function consenting(orgId: string, ids: string[]) {
    if (!ids.length) return 0;
    const [c] = await db.select({ n: count() }).from(memberships).where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, ids), eq(memberships.marketingEmail, true)));
    return Number(c!.n);
  }

  app.get("/campaigns", async (req) => {
    const rows = await db
      .select({ c: emailCampaigns, emailName: emailDesigns.name, segmentName: segments.name })
      .from(emailCampaigns)
      .innerJoin(emailDesigns, eq(emailDesigns.id, emailCampaigns.emailId))
      .leftJoin(segments, eq(segments.id, emailCampaigns.segmentId))
      .where(eq(emailCampaigns.orgId, req.auth.orgId))
      .orderBy(desc(emailCampaigns.createdAt));
    const delivery = await db
      .select({ id: sql<string>`${notifications.data}->'ref'->>'campaignId'`, status: notifications.status, n: count() })
      .from(notifications)
      .where(and(eq(notifications.orgId, req.auth.orgId), eq(notifications.template, "custom"), sql`${notifications.data}->'ref' ? 'campaignId'`))
      .groupBy(sql`${notifications.data}->'ref'->>'campaignId'`, notifications.status);
    return rows.map((r) => {
      const d = delivery.filter((x) => x.id === r.c.id);
      const n = (s: string) => Number(d.find((x) => x.status === s)?.n ?? 0);
      return { ...r.c, emailName: r.emailName, audience: r.segmentName ?? "Everyone", delivered: n("sent"), failed: n("failed"), queued: n("pending") };
    });
  });
  app.post("/campaigns", async (req, reply) => {
    const input = parse(campaignInput, req.body);
    const [e] = await db.select({ id: emailDesigns.id }).from(emailDesigns).where(and(eq(emailDesigns.id, input.emailId), eq(emailDesigns.orgId, req.auth.orgId), isNull(emailDesigns.archivedAt)));
    if (!e) throw notFound("email");
    if (input.segmentId) await audienceFor(req.auth.orgId, input.segmentId);
    const [c] = await db.insert(emailCampaigns).values({ orgId: req.auth.orgId, name: input.name, emailId: input.emailId, segmentId: input.segmentId ?? null, sendAt: input.sendAt ?? null, createdBy: req.auth.userId }).returning();
    reply.code(201);
    return c;
  });
  app.patch("/campaigns/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(campaignInput.partial(), req.body);
    const [c] = await db.update(emailCampaigns).set(input).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.orgId, req.auth.orgId), inArray(emailCampaigns.status, ["draft", "scheduled"]))).returning();
    if (!c) throw conflict("not_editable", "Only drafts and scheduled campaigns can be changed.");
    return c;
  });
  /** Send now (or schedule, if it has a send time). Always asks first, with the numbers. */
  app.post("/campaigns/:id/send", async (req) => {
    const { id } = parse(idParam, req.params);
    const { acknowledge } = parse(ack, req.body ?? {});
    return withFlags(app, acknowledge, async (tx, flags) => {
      const [c] = await tx.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.orgId, req.auth.orgId))).for("update");
      if (!c) throw notFound("campaign");
      if (c.status !== "draft" && c.status !== "scheduled") throw conflict("already_sent", c.status === "cancelled" ? "This campaign was cancelled." : "This campaign has already been sent.");
      const [design] = await tx.select().from(emailDesigns).where(eq(emailDesigns.id, c.emailId));
      if (!design || design.archivedAt) throw conflict("email_archived", "The email for this campaign has been archived. Restore it or choose another.");
      const ids = await audienceFor(req.auth.orgId, c.segmentId);
      const reachable = design.purpose === "marketing" ? await consenting(req.auth.orgId, ids) : ids.length;
      if (!reachable) throw conflict("nobody", design.purpose === "marketing" ? "Nobody in this audience has agreed to marketing emails yet." : "There's nobody in this audience.");
      const later = c.sendAt && c.sendAt > new Date();
      flags.confirm({ code: "send_to_many", message: `${later ? "Schedule" : "Send"} “${design.design.subject}” to ${reachable} ${reachable === 1 ? "person" : "people"}${later ? ` on ${c.sendAt!.toISOString()}` : " now"}? This can't be undone once it's sent.` });
      if (design.purpose === "marketing" && reachable < ids.length) flags.info({ code: "people_skipped", message: `${ids.length - reachable} of the ${ids.length} people in this audience haven't agreed to marketing emails, so they won't get it.` });
      if (later) {
        const [u] = await tx.update(emailCampaigns).set({ status: "scheduled" }).where(eq(emailCampaigns.id, c.id)).returning();
        return { campaign: u! };
      }
      const r = await queueDesignEmail(tx, req.auth.orgId, design, ids, urlsOf(app), { campaignId: c.id });
      const [u] = await tx.update(emailCampaigns).set({ status: "sent", sentAt: new Date(), recipients: r.sent, skipped: r.skipped }).where(eq(emailCampaigns.id, c.id)).returning();
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "campaign.sent", entityType: "email_campaign", entityId: c.id, details: { recipients: r.sent, skipped: r.skipped } });
      return { campaign: u! };
    });
  });
  app.post("/campaigns/:id/cancel", async (req) => {
    const { id } = parse(idParam, req.params);
    const [c] = await db.update(emailCampaigns).set({ status: "cancelled" }).where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.orgId, req.auth.orgId), inArray(emailCampaigns.status, ["draft", "scheduled"]))).returning();
    if (!c) throw conflict("not_cancellable", "Only drafts and scheduled campaigns can be cancelled.");
    return c;
  });

  // --- Journeys -----------------------------------------------------------------------
  async function present(j: typeof journeys.$inferSelect, withStats = false) {
    const t = j.definition.trigger;
    const planNames = t.planIds?.length ? (await db.select({ name: packagePlans.name }).from(packagePlans).where(inArray(packagePlans.id, t.planIds))).map((p) => p.name) : undefined;
    const segName = t.segmentId ? (await db.select({ name: segments.name }).from(segments).where(eq(segments.id, t.segmentId)))[0]?.name : undefined;
    return { ...j, triggerText: describeTrigger(t, { plans: planNames, segment: segName }), ...(withStats ? { stats: await journeyStats(db, j) } : {}) };
  }
  async function getJourney(orgId: string, id: string) {
    const [j] = await db.select().from(journeys).where(and(eq(journeys.id, id), eq(journeys.orgId, orgId)));
    if (!j) throw notFound("journey");
    return j;
  }

  app.get("/journeys", async (req) => {
    const rows = await db.select().from(journeys).where(eq(journeys.orgId, req.auth.orgId)).orderBy(desc(journeys.updatedAt));
    return Promise.all(rows.map((j) => present(j, true)));
  });
  app.get("/journeys/recipes", async () => Object.entries(RECIPES).map(([id, r]) => ({ id, name: r.name, description: r.description })));
  app.get("/journeys/:id", async (req) => present(await getJourney(req.auth.orgId, parse(idParam, req.params).id), true));
  app.post("/journeys", async (req, reply) => {
    const input = parse(journeyInput, req.body);
    await checkJourney(db, req.auth.orgId, input.definition);
    const [j] = await db.insert(journeys).values({ ...input, orgId: req.auth.orgId, createdBy: req.auth.userId }).returning();
    reply.code(201);
    return present(j!);
  });
  /** Start from a ready-made journey: its emails are created too, so everything can be edited. */
  app.post("/journeys/from-recipe", async (req, reply) => {
    const { recipe } = parse(recipeBody, req.body);
    const r = RECIPES[recipe]!;
    const starters = starterEmails(app.config.PUBLIC_APP_URL);
    const j = await inTx(app, async (tx) => {
      const ids: Record<string, string> = {};
      for (const key of r.emails) {
        const s = starters[key]!;
        const [e] = await tx.insert(emailDesigns).values({ orgId: req.auth.orgId, name: s.name, purpose: s.purpose, design: s.design, createdBy: req.auth.userId }).returning();
        ids[key] = e!.id;
      }
      const [j] = await tx.insert(journeys).values({ orgId: req.auth.orgId, name: r.name, description: r.description, definition: r.build(ids), createdBy: req.auth.userId }).returning();
      return j!;
    });
    reply.code(201);
    return present(j);
  });
  /** Changes apply to people who start from now on; anyone part-way through finishes the version they started. */
  app.patch("/journeys/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(journeyInput.partial(), req.body);
    const j = await getJourney(req.auth.orgId, id);
    if (input.definition) await checkJourney(db, req.auth.orgId, input.definition);
    const changed = input.definition && JSON.stringify(input.definition) !== JSON.stringify(j.definition);
    const [u] = await db.update(journeys).set({ ...input, ...(changed ? { version: j.version + 1 } : {}) }).where(eq(journeys.id, id)).returning();
    if (changed && u!.status === "live" && input.definition?.trigger.type === "joins_segment") await seedSegmentMembers(db, u!);
    const [inFlight] = await db.select({ n: count() }).from(journeyEnrollments).where(and(eq(journeyEnrollments.journeyId, id), eq(journeyEnrollments.status, "active")));
    return { ...(await present(u!)), note: changed && Number(inFlight!.n) ? `${inFlight!.n} people part-way through will finish the version they started. Everyone who starts from now on gets the new version.` : null };
  });
  app.post("/journeys/:id/go-live", async (req) => {
    const { id } = parse(idParam, req.params);
    const { acknowledge } = parse(ack, req.body ?? {});
    return withFlags(app, acknowledge, async (tx, flags) => {
      const j = await getJourney(req.auth.orgId, id);
      await checkJourney(tx, req.auth.orgId, j.definition);
      const t = await present(j);
      flags.confirm({
        code: "journey_starts",
        message: `“${j.name}” will start running: ${t.triggerText.charAt(0).toLowerCase()}${t.triggerText.slice(1)}, they'll go through its steps.${j.definition.trigger.type === "joins_segment" ? " People already in the segment aren't included; only people who join it from now on." : ""}${j.status === "paused" ? " People who were part-way through carry on from where they stopped." : ""}`,
      });
      const [u] = await tx.update(journeys).set({ status: "live", liveSince: j.liveSince ?? new Date() }).where(eq(journeys.id, id)).returning();
      if (j.status === "draft") await seedSegmentMembers(tx, u!);
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "journey.live", entityType: "journey", entityId: id });
      return { journey: await present(u!) };
    });
  });
  /** Pausing stops new people starting and holds everyone where they are. */
  app.post("/journeys/:id/pause", async (req) => {
    const { id } = parse(idParam, req.params);
    const [u] = await db.update(journeys).set({ status: "paused" }).where(and(eq(journeys.id, id), eq(journeys.orgId, req.auth.orgId), eq(journeys.status, "live"))).returning();
    if (!u) throw conflict("not_live", "Only live journeys can be paused.");
    return present(u);
  });
  app.delete("/journeys/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const j = await getJourney(req.auth.orgId, id);
    if (j.status === "live") throw conflict("live", "Pause the journey before deleting it.");
    await db.delete(journeys).where(eq(journeys.id, id));
    await audit(db, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "journey.deleted", entityType: "journey", entityId: id, details: { name: j.name } });
    return reply.code(204).send();
  });
  /** Add someone by hand (e.g. to test it on yourself, or a client who missed the trigger). */
  app.post("/journeys/:id/enroll", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { clientId } = parse(enrollBody, req.body);
    const j = await getJourney(req.auth.orgId, id);
    if (j.status !== "live") throw conflict("not_live", "Put the journey live first.");
    const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, req.auth.orgId), eq(memberships.userId, clientId)));
    if (!m) throw notFound("client");
    const [active] = await db.select({ id: journeyEnrollments.id }).from(journeyEnrollments).where(and(eq(journeyEnrollments.journeyId, id), eq(journeyEnrollments.clientId, clientId), eq(journeyEnrollments.status, "active")));
    if (active) throw conflict("already_in", "They're already part-way through this journey.");
    const [e] = await db.insert(journeyEnrollments).values({ orgId: j.orgId, journeyId: j.id, clientId, version: j.version, definition: j.definition, path: [0], nextRunAt: new Date(), triggerRef: `manual:${Date.now()}` }).returning();
    reply.code(201);
    return e;
  });
  app.post("/journeys/:id/people/:clientId/remove", async (req) => {
    const { id, clientId } = parse(z.object({ id: schemas.id, clientId: schemas.id }), req.params);
    const [e] = await db
      .update(journeyEnrollments)
      .set({ status: "exited", exitReason: "Removed by staff", nextRunAt: null, finishedAt: new Date() })
      .where(and(eq(journeyEnrollments.journeyId, id), eq(journeyEnrollments.orgId, req.auth.orgId), eq(journeyEnrollments.clientId, clientId), eq(journeyEnrollments.status, "active")))
      .returning();
    if (!e) throw notFound("person in this journey");
    return e;
  });
  app.get("/journeys/:id/people", async (req) => {
    const { id } = parse(idParam, req.params);
    const { status } = parse(peopleQuery, req.query);
    await getJourney(req.auth.orgId, id);
    const rows = await db
      .select({ e: journeyEnrollments, first: users.firstName, last: users.lastName })
      .from(journeyEnrollments)
      .innerJoin(users, eq(users.id, journeyEnrollments.clientId))
      .where(and(eq(journeyEnrollments.journeyId, id), eq(journeyEnrollments.status, status)))
      .orderBy(desc(journeyEnrollments.startedAt))
      .limit(500);
    return rows.map(({ e, first, last }) => ({ clientId: e.clientId, name: `${first} ${last}`, startedAt: e.startedAt, finishedAt: e.finishedAt, version: e.version, atStep: e.status === "active" ? stepAt(e.definition.steps, e.path)?.id ?? null : null, nextRunAt: e.nextRunAt, waitingFor: e.waitingFor }));
  });

}
