import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, dayOffset, outbox, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function classFor(mode: "automatic" | "manual") {
  const s = await studio({ substituteApproval: mode });
  const session = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 10, durationMinutes: 50, date: dayOffset(2), startTime: "07:00" });
  await s.c1.call("POST", "/bookings", { sessionId: session.body.id });
  return { s, sessionId: session.body.id as string };
}

describe("substitutes", () => {
  it("only lets instructors request cover for their own classes", async () => {
    const { s, sessionId } = await classFor("manual");
    expect((await s.ben.call("POST", "/substitute-requests", { sessionId })).status).toBe(403);
    expect((await s.c1.call("POST", "/substitute-requests", { sessionId })).status).toBe(403);
    expect((await s.ana.call("POST", "/substitute-requests", { sessionId, reason: "Dentist" })).status).toBe(201);
    expect((await outbox("sub.requested")).map((n) => n.userId)).toContain(s.ben.id);
  });

  it("automatic: first to accept gets the class and everyone is told", async () => {
    const { s, sessionId } = await classFor("automatic");
    const req = await s.ana.call("POST", "/substitute-requests", { sessionId });
    const res = await s.ben.call("POST", `/substitute-requests/${req.body.id}/accept`);
    expect(res.body.status).toBe("filled");
    expect((await s.owner.call("GET", `/sessions/${sessionId}`)).body.instructorId).toBe(s.ben.id);
    expect((await outbox("instructor.removed")).map((n) => n.userId)).toContain(s.ana.id);
    expect((await outbox("instructor.assigned")).map((n) => n.userId)).toContain(s.ben.id);
    expect((await outbox("instructor.changed_for_client")).map((n) => n.userId)).toContain(s.c1.id);
  });

  it("manual: acceptances wait for an admin to approve", async () => {
    const { s, sessionId } = await classFor("manual");
    const req = await s.ana.call("POST", "/substitute-requests", { sessionId });
    expect((await s.ana.call("POST", `/substitute-requests/${req.body.id}/accept`)).status).toBe(400); // can't cover your own class
    const accepted = await s.ben.call("POST", `/substitute-requests/${req.body.id}/accept`);
    expect(accepted.body.status).toBe("awaiting_approval");
    expect((await outbox("sub.awaiting_approval")).map((n) => n.userId)).toContain(s.owner.id);
    expect((await s.ben.call("POST", `/substitute-requests/${req.body.id}/approve`, { instructorId: s.ben.id })).status).toBe(403);
    const approved = await s.owner.call("POST", `/substitute-requests/${req.body.id}/approve`, { instructorId: s.ben.id });
    expect(approved.body.status).toBe("filled");
  });
});
