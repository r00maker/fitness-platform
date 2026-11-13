/**
 * Agents. Owners and admins set them up (pick a ready-made one, name it, choose what it can see
 * and who it tells); everyone on staff sees the messages agents send them and can mute an agent
 * for themselves.
 */
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { AGENT_JOBS, AGENT_NEVER_SEES, AGENT_RECIPIENT_ROLES, AGENT_SEES, AGENT_STARTERS, OPTION_LABELS, describeAgent, schemas, type AgentDefinition, agentDefinition, createAgent, previewAgent, updateAgent } from "@studio/shared";
import { z } from "zod";
import type { DbOrTx } from "../../db/client.js";
import { agentMessages, agentMutes, agentRuns, agents, classTypes, locations, memberships, organizations } from "../../db/schema.js";
import { audit } from "../../lib/audit.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { inTx } from "../../lib/route.js";
import { parse } from "../../lib/validate.js";
import { requirePermission } from "../../plugins/auth.js";
import { agentsForUser, compute, nextRun, runAgent, type AgentRow } from "./engine.js";

const idParam = z.object({ id: schemas.id });

/** Check everything the definition points at belongs to this studio (and is staff, for people). */
async function checkRefs(db: DbOrTx, orgId: string, def: AgentDefinition) {
  if (def.notify.userIds.length) {
    const staff = await db.select({ id: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.active, true), inArray(memberships.userId, def.notify.userIds), sql`${memberships.role} <> 'client'`));
    if (staff.length !== new Set(def.notify.userIds).size) throw badRequest("not_staff", "Agents can only message your studio's staff. Remove anyone who isn't on your team.");
  }
  if (def.job.type === "low_bookings") {
    if (def.job.classTypeIds?.length) {
      const t = await db.select({ id: classTypes.id }).from(classTypes).where(and(eq(classTypes.orgId, orgId), inArray(classTypes.id, def.job.classTypeIds)));
      if (t.length !== new Set(def.job.classTypeIds).size) throw notFound("class type");
    }
    if (def.job.locationIds?.length) {
      const l = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.orgId, orgId), inArray(locations.id, def.job.locationIds)));
      if (l.length !== new Set(def.job.locationIds).size) throw notFound("location");
    }
  }
}

async function timezone(db: DbOrTx, orgId: string) {
  const [o] = await db.select({ timezone: organizations.timezone, paused: organizations.agentsPaused }).from(organizations).where(eq(organizations.id, orgId));
  return { tz: o?.timezone ?? "UTC", paused: o?.paused ?? false };
}

async function getAgent(db: DbOrTx, orgId: string, id: string): Promise<AgentRow> {
  const [a] = await db.select().from(agents).where(and(eq(agents.id, id), eq(agents.orgId, orgId)));
  if (!a) throw notFound("agent");
  return a;
}

function view(a: AgentRow, last?: typeof agentRuns.$inferSelect) {
  const def = a.definition;
  return {
    id: a.id,
    name: a.name,
    starter: a.starter,
    enabled: a.enabled,
    definition: def,
    job: AGENT_JOBS[def.job.type].label,
    description: describeAgent(def),
    sees: def.sees.map((k) => ({ key: k, label: AGENT_SEES[k] })),
    neverSees: AGENT_NEVER_SEES,
    nextRunAt: a.enabled ? a.nextRunAt : null,
    lastRun: last ? { at: last.createdAt, status: last.status, summary: last.summary } : null,
  };
}

const nameTaken = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";

export async function agentRoutes(app: FastifyInstance) {
  const { db } = app;

  /** The ready-made agents and the building blocks, for the "New agent" screen. */
  app.get("/agents/starters", async (req) => {
    requirePermission(req, "manageAgents");
    return {
      starters: AGENT_STARTERS.map((s) => ({ ...s, description: describeAgent(agentDefinition.parse(s.definition)), job: AGENT_JOBS[s.definition.job.type].label })),
      jobs: Object.entries(AGENT_JOBS).map(([key, j]) => ({ key, ...j })),
      sees: Object.entries(AGENT_SEES).map(([key, label]) => ({ key, label })),
      neverSees: AGENT_NEVER_SEES,
      recipientRoles: AGENT_RECIPIENT_ROLES.map((r) => ({ key: r, label: OPTION_LABELS.role[r] })),
    };
  });

  app.get("/agents", async (req) => {
    requirePermission(req, "manageAgents");
    const list = await db.select().from(agents).where(eq(agents.orgId, req.auth.orgId)).orderBy(agents.createdAt);
    const runs = list.length
      ? await db.execute<typeof agentRuns.$inferSelect & { agent_id: string; created_at: Date }>(sql`
          select distinct on (agent_id) agent_id, status, summary, created_at from agent_runs where org_id = ${req.auth.orgId} order by agent_id, created_at desc`)
      : { rows: [] };
    const last = new Map(runs.rows.map((r) => [r.agent_id, { ...r, createdAt: r.created_at } as typeof agentRuns.$inferSelect]));
    const { paused } = await timezone(db, req.auth.orgId);
    return { paused, agents: list.map((a) => view(a, last.get(a.id))) };
  });

  /** What an agent would send right now, without sending it (for setting one up, or checking one). */
  app.post("/agents/preview", async (req) => {
    requirePermission(req, "manageAgents");
    const input = parse(previewAgent, req.body);
    await checkRefs(db, req.auth.orgId, input.definition);
    const r = await compute(db, req.auth.orgId, { name: input.name, definition: input.definition }, new Date());
    return { description: describeAgent(input.definition), summary: r.summary, messages: r.messages.map((m) => ({ to: m.name, role: m.role, title: m.title, body: m.body })) };
  });

  app.post("/agents", async (req, reply) => {
    requirePermission(req, "manageAgents");
    const input = parse(createAgent, req.body);
    const a = await inTx(app, async (tx) => {
      await checkRefs(tx, req.auth.orgId, input.definition);
      const { tz } = await timezone(tx, req.auth.orgId);
      const [row] = await tx
        .insert(agents)
        .values({ orgId: req.auth.orgId, name: input.name, starter: input.starter ?? null, definition: input.definition, enabled: input.enabled, nextRunAt: nextRun(input.definition, tz, new Date()), createdBy: req.auth.userId })
        .returning()
        .catch((e) => {
          if (nameTaken(e)) throw conflict("name_taken", `You already have an agent called ${input.name}. Pick another name.`);
          throw e;
        });
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "agent.created", entityType: "agent", entityId: row!.id, details: { name: input.name, job: input.definition.job.type, sees: input.definition.sees } });
      return row!;
    });
    reply.code(201);
    return view(a);
  });

  app.patch("/agents/:id", async (req) => {
    requirePermission(req, "manageAgents");
    const { id } = parse(idParam, req.params);
    const input = parse(updateAgent, req.body);
    const a = await inTx(app, async (tx) => {
      const cur = await getAgent(tx, req.auth.orgId, id);
      const def = input.definition ?? cur.definition;
      if (input.definition) await checkRefs(tx, req.auth.orgId, def);
      const { tz } = await timezone(tx, req.auth.orgId);
      const [row] = await tx
        .update(agents)
        .set({ ...(input.name ? { name: input.name } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), definition: def, nextRunAt: nextRun(def, tz, new Date()) })
        .where(eq(agents.id, id))
        .returning()
        .catch((e) => {
          if (nameTaken(e)) throw conflict("name_taken", `You already have an agent called ${input.name}. Pick another name.`);
          throw e;
        });
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "agent.updated", entityType: "agent", entityId: id, details: { changed: Object.keys(input), ...(input.definition ? { sees: def.sees } : {}) } });
      return row!;
    });
    return view(a);
  });

  app.delete("/agents/:id", async (req) => {
    requirePermission(req, "manageAgents");
    const { id } = parse(idParam, req.params);
    await inTx(app, async (tx) => {
      const a = await getAgent(tx, req.auth.orgId, id);
      await tx.delete(agents).where(eq(agents.id, id));
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: "agent.deleted", entityType: "agent", entityId: id, details: { name: a.name } });
    });
    return { deleted: true };
  });

  /** Run it now, e.g. to see it working. Sends real messages. */
  app.post("/agents/:id/run", async (req) => {
    requirePermission(req, "manageAgents");
    const { id } = parse(idParam, req.params);
    return inTx(app, async (tx) => {
      const a = await getAgent(tx, req.auth.orgId, id);
      if (!a.enabled) throw conflict("agent_off", `${a.name} is switched off. Switch it on first.`);
      if (a.definition.when.type === "before_class") throw conflict("runs_per_class", `${a.name} runs before each class, so there's nothing to run now. Use "Preview" to see what it would send.`);
      const r = await runAgent(tx, a, new Date());
      return { summary: r.summary, sent: r.messages.length };
    });
  });

  app.get("/agents/:id/runs", async (req) => {
    requirePermission(req, "manageAgents");
    const { id } = parse(idParam, req.params);
    await getAgent(db, req.auth.orgId, id);
    const runs = await db.select().from(agentRuns).where(eq(agentRuns.agentId, id)).orderBy(desc(agentRuns.createdAt)).limit(30);
    return { runs: runs.map((r) => ({ at: r.createdAt, status: r.status, summary: r.summary, recipients: r.recipients })) };
  });

  /** Pause (or resume) every agent at once. */
  app.put("/agents/paused", async (req) => {
    requirePermission(req, "manageAgents");
    const { paused } = parse(z.object({ paused: z.boolean() }), req.body);
    await inTx(app, async (tx) => {
      await tx.update(organizations).set({ agentsPaused: paused }).where(eq(organizations.id, req.auth.orgId));
      await audit(tx, { orgId: req.auth.orgId, actorId: req.auth.userId, action: paused ? "agents.paused" : "agents.resumed", entityType: "organization", entityId: req.auth.orgId });
    });
    return { paused };
  });

  // --- For every staff member ------------------------------------------------------
  const staffOnly = (role: string) => {
    if (role === "client") throw notFound("page");
  };

  /** Messages agents have sent me. */
  app.get("/me/agent-messages", async (req) => {
    staffOnly(req.auth.role);
    const rows = await db.select().from(agentMessages).where(and(eq(agentMessages.orgId, req.auth.orgId), eq(agentMessages.userId, req.auth.userId))).orderBy(desc(agentMessages.createdAt)).limit(50);
    return { unread: rows.filter((r) => !r.readAt).length, messages: rows.map((r) => ({ id: r.id, agentId: r.agentId, title: r.title, body: r.body, link: r.link, read: !!r.readAt, at: r.createdAt })) };
  });
  app.post("/me/agent-messages/read", async (req) => {
    staffOnly(req.auth.role);
    await db.update(agentMessages).set({ readAt: new Date() }).where(and(eq(agentMessages.orgId, req.auth.orgId), eq(agentMessages.userId, req.auth.userId), isNull(agentMessages.readAt)));
    return { ok: true };
  });

  /** The agents that may message me, so I can mute any I don't want. */
  app.get("/me/agents", async (req) => {
    staffOnly(req.auth.role);
    return { agents: await agentsForUser(db, req.auth.orgId, req.auth.userId, req.auth.role) };
  });
  app.post("/me/agents/:id/mute", async (req) => {
    staffOnly(req.auth.role);
    const { id } = parse(idParam, req.params);
    await getAgent(db, req.auth.orgId, id);
    await db.insert(agentMutes).values({ agentId: id, userId: req.auth.userId }).onConflictDoNothing();
    return { muted: true };
  });
  app.delete("/me/agents/:id/mute", async (req) => {
    staffOnly(req.auth.role);
    const { id } = parse(idParam, req.params);
    await getAgent(db, req.auth.orgId, id);
    await db.delete(agentMutes).where(and(eq(agentMutes.agentId, id), eq(agentMutes.userId, req.auth.userId)));
    return { muted: false };
  });
}
