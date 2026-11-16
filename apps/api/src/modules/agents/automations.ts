/**
 * Automations: one place for everything that runs by itself, so studios don't have to know
 * the difference between "agents" and "journeys".
 *
 *  - For clients: journeys (welcome, win-back, intro-offer follow-up...), Marketing.
 *  - For your team: reminders (what used to be called reminder agents: cover reminders,
 *    low bookings, teaching line-ups...), AI workflows.
 *
 * Both are listed the same way: a name, when it runs, what it does, and whether it's on. Each
 * keeps its own editor (journeys and team reminders work differently underneath).
 */
import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { AGENT_STARTERS, JOURNEY_TRIGGERS, can, describeAgent, planIncludes } from "@studio/shared";
import { agents, journeys } from "../../db/schema.js";
import { forbidden } from "../../lib/errors.js";
import { getOrg } from "../sessions/context.js";

export async function automationsRoutes(app: FastifyInstance) {
  app.get("/automations", async (req) => {
    const role = req.auth.role;
    const forClients = can(role, "manageMarketing"), forTeam = can(role, "manageAgents");
    if (!forClients && !forTeam) throw forbidden();
    const org = await getOrg(app.db, req.auth.orgId);
    const on = (k: "marketing" | "agents") => planIncludes(org.plan, k) && !org.featuresOff.includes(k);
    const clientRows = forClients && on("marketing") ? await app.db.select().from(journeys).where(eq(journeys.orgId, org.id)).orderBy(desc(journeys.createdAt)) : [];
    const teamRows = forTeam && on("agents") ? await app.db.select().from(agents).where(eq(agents.orgId, org.id)).orderBy(desc(agents.createdAt)) : [];
    const items = [
      ...clientRows.map((j) => ({
        id: j.id, for: "clients" as const, name: j.name,
        when: JOURNEY_TRIGGERS[j.definition.trigger.type]?.label ?? j.definition.trigger.type,
        does: `${j.definition.steps.length} ${j.definition.steps.length === 1 ? "step" : "steps"}: messages to clients`,
        on: j.status === "live", status: j.status, edit: { kind: "journey", id: j.id },
      })),
      ...teamRows.map((a) => ({
        id: a.id, for: "team" as const, name: a.name,
        when: a.definition.when.type === "daily" ? `Every day at ${a.definition.when.time}` : `${a.definition.when.hoursBefore} hours before each class`,
        does: describeAgent(a.definition),
        on: a.enabled, status: a.enabled ? "on" : "off", edit: { kind: "team_reminder", id: a.id },
      })),
    ];
    return {
      items,
      sections: {
        clients: forClients ? (on("marketing") ? { available: true } : { available: false, note: "Journeys for clients come with Marketing on Growth and Signature." }) : null,
        team: forTeam ? (on("agents") ? { available: true, starters: AGENT_STARTERS.map((s) => ({ key: s.key, title: s.title, pitch: s.pitch })) } : { available: false, note: "Team reminders come with AI workflows on Signature." }) : null,
      },
    };
  });
}
