import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { agentMessages, agents, bookings, classSessions, classTypes, organizations } from "../src/db/schema.js";
import { AgentAccessError, AgentData } from "../src/modules/agents/data.js";
import { runDueAgents } from "../src/modules/agents/engine.js";
import { app, db, outbox, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

/** A fixed evening a few days out, so "tomorrow" never depends on when the tests run. */
const NIGHT = DateTime.now().setZone("Asia/Singapore").plus({ days: 5 }).set({ hour: 22, minute: 0, second: 0, millisecond: 0 });
const at = (days: number, hour: number, minute = 0) => NIGHT.plus({ days }).set({ hour, minute }).toJSDate();

async function setup() {
  const s = await studio();
  const fd = await person(s.orgId, "front_desk", "Faye");
  const cls = async (startsAt: Date, o: { instructorId?: string | null; coverFor?: string; capacity?: number; booked?: number } = {}) => {
    const [c] = await db
      .insert(classSessions)
      .values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, roomId: s.roomId, instructorId: o.instructorId === undefined ? s.ana.id : o.instructorId, coverForInstructorId: o.coverFor ?? null, startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000), capacity: o.capacity ?? 10 })
      .returning();
    const people = [s.c1, s.c2, s.c3];
    for (let i = 0; i < (o.booked ?? 0); i++) await db.insert(bookings).values({ orgId: s.orgId, sessionId: c!.id, clientId: people[i]!.id, source: "staff" });
    return c!;
  };
  const make = (body: Record<string, unknown>) => s.owner.call("POST", "/agents", body);
  const dueNow = async (id: string, now: Date) => {
    await db.update(agents).set({ nextRunAt: new Date(now.getTime() - 1000) }).where(eq(agents.id, id));
    return runDueAgents(db, now);
  };
  return { s, fd, cls, make, dueNow };
}

const agnes = { name: "Agnes", starter: "low_bookings", definition: { when: { type: "daily", time: "22:00" }, job: { type: "low_bookings", daysAhead: 1, below: { mode: "count", value: 3 } }, notify: { roles: ["owner", "admin"] }, sees: ["schedule", "booking_counts"] } };
const jeff = { name: "Jeff", starter: "cover_reminder", definition: { when: { type: "daily", time: "19:00" }, job: { type: "cover_classes", daysAhead: 1 }, notify: { roles: ["instructor"] }, sees: ["schedule", "instructors", "cover"] } };

describe("reminder agents", () => {
  it("Agnes tells admins about quiet classes the night before, with numbers but never names", async () => {
    const { s, fd, cls, make, dueNow } = await setup();
    const starters = await s.owner.call("GET", "/agents/starters");
    expect(starters.body.starters.map((x: { suggestedName: string }) => x.suggestedName)).toEqual(["Jeff", "Agnes", "Theo", "Nina", "Walt", "Cora"]);
    expect(starters.body.starters[1].description).toBe("Every day at 10:00pm, it checks tomorrow's classes for fewer than 3 booked and tells owners and admins.");
    expect((await s.ana.call("GET", "/agents/starters")).status).toBe(403);
    expect((await fd.call("POST", "/agents", agnes)).status).toBe(403);

    const quiet = await cls(at(1, 9), { booked: 1 });
    await cls(at(1, 18), { booked: 3 });
    await cls(at(2, 9), { booked: 0 }); // the day after: not checked

    const created = await make(agnes);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.neverSees).toContain("Client names, contact details or health notes");
    expect((await make(agnes)).body.error.code).toBe("name_taken");

    await dueNow(created.body.id, NIGHT.toJSDate());
    const msgs = await db.select().from(agentMessages);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.userId).toBe(s.owner.id);
    expect(msgs[0]!.title).toBe("Agnes");
    expect(msgs[0]!.body).toBe("1 class tomorrow looks quiet: Reformer Pilates, 9:00am (1 of 10 booked). Open the schedule if you want to cancel or promote it.");
    expect(msgs[0]!.body).not.toMatch(/Chloe|Dev|Eve/);
    expect(msgs[0]!.link).toMatchObject({ screen: "class", sessionId: quiet.id });
    // Push to the staff app only: no email, and nothing for clients.
    const sent = await outbox("agent.message");
    expect(sent.map((n) => [n.userId, n.channel])).toEqual([[s.owner.id, "push"]]);
    // It ran and was rescheduled for the next night.
    const [row] = await db.select().from(agents);
    expect(row!.nextRunAt!.getTime()).toBe(NIGHT.plus({ days: 1 }).toMillis());
    const list = (await s.owner.call("GET", "/agents")).body.agents;
    expect(list[0].lastRun.summary).toBe("Found 1 class tomorrow and told 1 person.");
    expect((await s.owner.call("GET", "/me/agent-messages")).body.unread).toBe(1);
  });

  it("Jeff reminds each instructor only about the classes they're covering", async () => {
    const { s, cls, make, dueNow } = await setup();
    await cls(at(1, 7), { instructorId: s.ben.id, coverFor: s.ana.id });
    await cls(at(1, 12), { instructorId: s.ana.id, coverFor: s.ben.id });
    await cls(at(1, 15), { instructorId: s.ana.id }); // her usual class: not a cover
    const created = (await make(jeff)).body;
    await dueNow(created.id, at(0, 19));
    const msgs = await db.select().from(agentMessages);
    const forUser = (id: string) => msgs.filter((m) => m.userId === id).map((m) => m.body);
    expect(forUser(s.ben.id)).toEqual([expect.stringMatching(/^Reminder: you're covering a class tomorrow\. Reformer Pilates, 7:00am at Studio 1, Central \(covering for Ana T\.\)\.$/)]);
    expect(forUser(s.ana.id)).toEqual([expect.stringMatching(/^Reminder: you're covering a class tomorrow\. Reformer Pilates, 12:00pm at Studio 1, Central \(covering for Ben/)]);
    expect(forUser(s.owner.id)).toEqual([]);

    // Ben mutes Jeff for himself.
    expect((await s.ben.call("POST", `/me/agents/${created.id}/mute`)).body.muted).toBe(true);
    expect((await s.ben.call("GET", "/me/agents")).body.agents).toEqual([{ id: created.id, name: "Jeff", enabled: true, muted: true }]);
    await db.delete(agentMessages);
    await dueNow(created.id, at(0, 19, 1));
    expect((await db.select().from(agentMessages)).map((m) => m.userId)).toEqual([s.ana.id]);
  });

  it("only uses what it's been allowed to see, and only messages this studio's staff", async () => {
    const { s, cls, make } = await setup();
    await cls(DateTime.now().setZone("Asia/Singapore").plus({ days: 1 }).set({ hour: 9, minute: 0 }).toJSDate(), { booked: 1 });
    // The job needs booking numbers, so the admin has to allow them.
    const missing = await make({ ...agnes, definition: { ...agnes.definition, sees: ["schedule"] } });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toMatch(/needs to see: how many people are booked/);
    // Clients can't be chosen, by role or by name.
    expect((await make({ ...agnes, definition: { ...agnes.definition, notify: { roles: ["client"] } } })).status).toBe(400);
    expect((await make({ ...agnes, definition: { ...agnes.definition, notify: { roles: [], userIds: [s.c1.id] } } })).body.error.code).toBe("not_staff");
    // Another studio's staff or class types can't be used either.
    const other = await studio();
    expect((await make({ ...agnes, definition: { ...agnes.definition, notify: { roles: [], userIds: [other.owner.id] } } })).body.error.code).toBe("not_staff");
    expect((await make({ ...agnes, definition: { ...agnes.definition, job: { ...agnes.definition.job, classTypeIds: [other.classTypeId] } } })).status).toBe(404);

    // The data layer itself refuses what wasn't granted.
    const scheduleOnly = new AgentData(db, s.orgId, new Set(["schedule"]));
    const [c] = await scheduleOnly.classes(new Date(), at(3, 0));
    expect(c).not.toHaveProperty("booked");
    expect(c).not.toHaveProperty("instructorName");
    await expect(scheduleOnly.openCoverRequests(at(0, 0), at(3, 0))).rejects.toBeInstanceOf(AgentAccessError);
    await expect(new AgentData(db, s.orgId, new Set(["cover"])).classes(at(0, 0), at(3, 0))).rejects.toBeInstanceOf(AgentAccessError);
    // And never another studio's classes.
    expect(await new AgentData(db, other.orgId, new Set(["schedule"])).classes(at(0, 0), at(3, 0))).toEqual([]);

    // Preview shows exactly who'd get what, without sending.
    const preview = await s.owner.call("POST", "/agents/preview", { name: "Agnes", definition: agnes.definition });
    expect(preview.body.messages).toEqual([{ to: expect.stringMatching(/^Olivia/), role: "owner", title: "Agnes", body: expect.stringMatching(/^1 class tomorrow looks quiet/) }]);
    expect(await db.select().from(agentMessages)).toHaveLength(0);
    // Another studio can't see or change this studio's agents.
    const mine = (await make(agnes)).body;
    expect((await other.owner.call("PATCH", `/agents/${mine.id}`, { enabled: false })).status).toBe(404);
    expect((await other.owner.call("GET", "/agents")).body.agents).toEqual([]);
  });

  it("instructors only hear about their own classes, even when a role-wide agent covers everyone", async () => {
    const { s, cls, make, dueNow } = await setup();
    await cls(at(1, 9), { instructorId: s.ana.id });
    await cls(at(1, 10), { instructorId: s.ben.id });
    await cls(at(1, 11), { instructorId: null });
    const theo = (await make({ name: "Theo", definition: { when: { type: "daily", time: "20:00" }, job: { type: "teaching", daysAhead: 1 }, notify: { roles: ["instructor", "front_desk"] }, sees: ["schedule"] } })).body;
    await dueNow(theo.id, at(0, 20));
    const msgs = await db.select().from(agentMessages);
    const body = (id: string) => msgs.find((m) => m.userId === id)?.body;
    expect(body(s.ana.id)).toBe("You're teaching 1 class tomorrow: Reformer Pilates, 9:00am at Studio 1, Central.");
    expect(body(s.ben.id)).toBe("You're teaching 1 class tomorrow: Reformer Pilates, 10:00am at Studio 1, Central.");
    // Front of House can see the whole schedule, so they get the full list.
    expect(msgs.filter((m) => m.body.startsWith("2 classes being taught tomorrow"))).toHaveLength(1);
  });

  it("before-class agents remind once per class, and pausing stops everything", async () => {
    const { s, cls, make } = await setup();
    const now = at(0, 16);
    await cls(new Date(now.getTime() + 90 * 60_000), { instructorId: s.ana.id });
    await cls(new Date(now.getTime() + 5 * 3_600_000), { instructorId: s.ana.id }); // not yet
    const r = await make({ name: "Ping", definition: { when: { type: "before_class", hoursBefore: 2 }, job: { type: "teaching", daysAhead: 1 }, notify: { roles: ["instructor"] }, sees: ["schedule"] } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.description).toBe("2 hours before each class, it reminds instructors about each class they teach. Instructors only hear about their own classes.");
    await runDueAgents(db, now);
    await runDueAgents(db, new Date(now.getTime() + 60_000));
    const msgs = await db.select().from(agentMessages);
    expect(msgs.map((m) => m.body)).toEqual(["You're teaching 1 class in 2 hours: Reformer Pilates, 5:30pm at Studio 1, Central."]);
    // Daily-only jobs can't run per class.
    expect((await make({ name: "Nina", definition: { when: { type: "before_class", hoursBefore: 2 }, job: { type: "no_instructor", daysAhead: 7 }, notify: { roles: ["admin"] }, sees: ["schedule", "instructors"] } })).status).toBe(400);

    // Pause all agents.
    expect((await s.owner.call("PUT", "/agents/paused", { paused: true })).body.paused).toBe(true);
    await cls(new Date(now.getTime() + 3 * 3_600_000 + 60_000), { instructorId: s.ana.id });
    await runDueAgents(db, new Date(now.getTime() + 61 * 60_000 + 60_000));
    expect(await db.select().from(agentMessages)).toHaveLength(1);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, s.orgId));
    expect(org!.agentsPaused).toBe(true);
  });

  it("other jobs: classes with no instructor, busy waitlists and unfilled cover", async () => {
    const { s, cls } = await setup();
    await cls(at(-1, 9), { instructorId: null });
    const preview = await s.owner.call("POST", "/agents/preview", { name: "Nina", definition: { when: { type: "daily", time: "09:00" }, job: { type: "no_instructor", daysAhead: 7 }, notify: { roles: ["owner"] }, sees: ["schedule", "instructors"] } });
    expect(preview.body.messages[0].body).toMatch(/^1 class in the next 7 days has no instructor yet: Reformer Pilates, \w{3} \d+ \w{3} 9:00am at Studio 1, Central\.$/);
    const [ct] = await db.select().from(classTypes);
    expect(ct).toBeTruthy();
  });
});
