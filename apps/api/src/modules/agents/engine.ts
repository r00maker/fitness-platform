/**
 * Running reminder agents: working out who hears what, sending it (push to the staff app, plus the
 * in-app list of agent messages), and scheduling the next run.
 *
 * Boundaries, enforced here rather than trusted to the set-up:
 *  - recipients are always staff of this studio (never clients, never another studio's staff);
 *  - each person only hears about classes they could see themselves: an instructor (who can't
 *    see the full schedule) only hears about classes they teach;
 *  - agents only send messages. They never cancel, book, refund or change anything.
 */
import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { can, type AgentDefinition, type Role } from "@studio/shared";
import type { Db, DbOrTx } from "../../db/client.js";
import { agentMessages, agentMutes, agentRuns, agentSessionLog, agents, classSessions, memberships, organizations, users } from "../../db/schema.js";
import { notify } from "../notifications/outbox.js";
import { AgentData } from "./data.js";
import { compose, runJob, type Finding, type JobResult } from "./jobs.js";

export type AgentRow = typeof agents.$inferSelect;
export interface Outgoing {
  userId: string;
  name: string;
  role: Role;
  title: string;
  body: string;
  link: Record<string, unknown>;
}

/** Staff of this studio the agent may message (roles + named people), minus anyone who muted it. */
export async function recipients(db: DbOrTx, orgId: string, def: AgentDefinition, agentId?: string) {
  const rows = await db
    .select({ userId: memberships.userId, role: memberships.role, first: users.firstName, last: users.lastName })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(memberships.active, true), ne(memberships.role, "client")));
  const muted = agentId ? new Set((await db.select({ u: agentMutes.userId }).from(agentMutes).where(eq(agentMutes.agentId, agentId))).map((m) => m.u)) : new Set<string>();
  return rows
    .filter((r) => r.role !== "client" && ((def.notify.roles as readonly string[]).includes(r.role) || def.notify.userIds.includes(r.userId)) && !muted.has(r.userId))
    .map((r) => ({ userId: r.userId, role: r.role, name: `${r.first} ${r.last}` }));
}

/** Only what this person could see themselves. */
const visibleTo = (p: { userId: string; role: Role }, findings: Finding[]) => (can(p.role, "viewFullSchedule") ? findings : findings.filter((f) => f.cls.instructorId === p.userId));

/** Work out what an agent would send right now, without sending anything. */
export async function compute(db: DbOrTx, orgId: string, agent: { id?: string; name: string; definition: AgentDefinition }, now: Date, only?: { sessionIds: string[] }) {
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
  const tz = org?.timezone ?? "UTC";
  const def = agent.definition;
  const data = new AgentData(db, orgId, new Set(def.sees));
  const res: JobResult = await runJob(data, def, now, tz, only);
  const people = await recipients(db, orgId, def, agent.id);
  const beforeClass = def.when.type === "before_class" ? { hoursBefore: def.when.hoursBefore } : undefined;
  const out: Outgoing[] = [];
  for (const p of people) {
    const mine = visibleTo(p, res.findings);
    if (!mine.length) continue;
    const personal = mine.every((f) => f.cls.instructorId === p.userId);
    const link = mine.length === 1 ? { screen: "class", sessionId: mine[0]!.cls.id, date: mine[0]!.cls.date } : { screen: "schedule", date: res.date ?? mine[0]!.cls.date, sessionIds: mine.map((f) => f.cls.id) };
    out.push({ userId: p.userId, name: p.name, role: p.role, title: agent.name, body: compose(def, res, mine, personal, beforeClass), link });
  }
  const summary = res.findings.length
    ? `Found ${res.findings.length} ${res.findings.length === 1 ? "class" : "classes"} ${beforeClass ? "" : `${res.period} `}and told ${out.length} ${out.length === 1 ? "person" : "people"}.`.replace("  ", " ")
    : `Nothing to report ${beforeClass ? "" : res.period}.`.replace(" .", ".");
  return { findings: res.findings, messages: out, summary, period: res.period };
}

/** Send the messages and record the run. */
async function deliver(tx: DbOrTx, agent: AgentRow, result: Awaited<ReturnType<typeof compute>>) {
  const [run] = await tx
    .insert(agentRuns)
    .values({ orgId: agent.orgId, agentId: agent.id, status: result.messages.length ? "sent" : "nothing", summary: result.summary, recipients: result.messages.length })
    .returning();
  for (const m of result.messages) {
    await tx.insert(agentMessages).values({ orgId: agent.orgId, agentId: agent.id, runId: run!.id, userId: m.userId, title: m.title, body: m.body, link: m.link });
    // Push only, to the staff app. Clients never get agent messages.
    await notify(tx, { orgId: agent.orgId, userIds: [m.userId], template: "agent.message", data: { agentName: agent.name, body: m.body, link: m.link }, channels: ["push"] });
  }
  return run!;
}

/** Run one agent now (also used by "Run now"). */
export async function runAgent(tx: DbOrTx, agent: AgentRow, now: Date, only?: { sessionIds: string[] }) {
  const result = await compute(tx, agent.orgId, agent, now, only);
  const run = await deliver(tx, agent, result);
  await tx.update(agents).set({ lastRunAt: now }).where(eq(agents.id, agent.id));
  return { run, ...result };
}

/** The next time a daily agent runs, in the studio's time zone. Null for before-class agents. */
export function nextRun(def: AgentDefinition, tz: string, after: Date): Date | null {
  if (def.when.type !== "daily") return null;
  const [h, m] = def.when.time.split(":").map(Number) as [number, number];
  const days = def.when.weekdays ?? [1, 2, 3, 4, 5, 6, 7];
  let d = DateTime.fromJSDate(after, { zone: tz }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
  for (let i = 0; i < 9; i++) {
    if (d.toMillis() > after.getTime() && days.includes(d.weekday)) return d.toJSDate();
    d = d.plus({ days: 1 });
  }
  return null;
}

const paused = sql`exists (select 1 from organizations o where o.id = ${agents.orgId} and o.agents_paused)`;

/** Worker: run every daily agent that's due, and before-class agents for classes coming up. */
export async function runDueAgents(db: Db, now = new Date()) {
  let ran = 0;
  // Daily agents. Each in its own transaction, skipping any another worker has picked up.
  const due = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.enabled, true), isNotNull(agents.nextRunAt), lte(agents.nextRunAt, now), sql`not ${paused}`))
    .limit(100);
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [a] = await tx.select().from(agents).where(and(eq(agents.id, id), lte(agents.nextRunAt, now))).for("update", { skipLocked: true });
      if (!a) return;
      const [org] = await tx.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, a.orgId));
      try {
        await tx.transaction(async (inner) => {
          await runAgent(inner, a, now);
        });
      } catch (err) {
        await tx.insert(agentRuns).values({ orgId: a.orgId, agentId: a.id, status: "failed", summary: "Couldn't run this time. It'll try again at its next run.", error: String(err).slice(0, 500) });
      }
      await tx.update(agents).set({ nextRunAt: nextRun(a.definition, org?.timezone ?? "UTC", now) }).where(eq(agents.id, a.id));
      ran++;
    });
  }

  // Before-class agents: classes whose reminder time has come (within the last 2 hours, so a new
  // agent doesn't send old reminders) and that this agent hasn't reminded about yet.
  const perClass = await db
    .select()
    .from(agents)
    .where(and(eq(agents.enabled, true), sql`${agents.definition}->'when'->>'type' = 'before_class'`, sql`not ${paused}`));
  for (const a of perClass) {
    if (a.definition.when.type !== "before_class") continue;
    const h = a.definition.when.hoursBefore * 3_600_000;
    const sessions = await db
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(
        and(
          eq(classSessions.orgId, a.orgId),
          eq(classSessions.status, "scheduled"),
          sql`${classSessions.startsAt} > ${now}`,
          sql`${classSessions.startsAt} <= ${new Date(now.getTime() + h)}`,
          sql`${classSessions.startsAt} > ${new Date(now.getTime() + h - 2 * 3_600_000)}`,
          sql`not exists (select 1 from agent_session_log l where l.agent_id = ${a.id} and l.session_id = ${classSessions.id})`,
        ),
      )
      .limit(200);
    if (!sessions.length) continue;
    await db.transaction(async (tx) => {
      const ids = (await tx.insert(agentSessionLog).values(sessions.map((s) => ({ agentId: a.id, sessionId: s.id }))).onConflictDoNothing().returning()).map((l) => l.sessionId);
      if (!ids.length) return;
      const result = await compute(tx, a.orgId, a, now, { sessionIds: ids });
      // Before-class checks that find nothing aren't worth a line in the activity list.
      if (result.messages.length) {
        await deliver(tx, a, result);
        await tx.update(agents).set({ lastRunAt: now }).where(eq(agents.id, a.id));
      }
      ran++;
    });
  }
  return ran;
}

/** The agents that may message this person, and whether they've muted each. */
export async function agentsForUser(db: DbOrTx, orgId: string, userId: string, role: Role) {
  const list = await db.select().from(agents).where(eq(agents.orgId, orgId));
  const muted = new Set((await db.select({ a: agentMutes.agentId }).from(agentMutes).where(and(eq(agentMutes.userId, userId), inArray(agentMutes.agentId, list.length ? list.map((a) => a.id) : ["00000000-0000-0000-0000-000000000000"])))).map((m) => m.a));
  return list.filter((a) => (a.definition.notify.roles as readonly string[]).includes(role) || a.definition.notify.userIds.includes(userId)).map((a) => ({ id: a.id, name: a.name, enabled: a.enabled, muted: muted.has(a.id) }));
}
