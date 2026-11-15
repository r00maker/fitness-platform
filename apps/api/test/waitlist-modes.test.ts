import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { app, dayOffset, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function fullClass() {
  const s = await studio();
  const session = await s.owner.call("POST", "/sessions", { classTypeId: s.classTypeId, locationId: s.locationId, instructorId: s.ana.id, capacity: 1, durationMinutes: 50, date: dayOffset(3), startTime: "09:00" });
  await s.c1.call("POST", "/bookings", { sessionId: session.body.id });
  return { s, sessionId: session.body.id as string };
}

describe("how waitlists work (studio setting)", () => {
  it("by default clients choose, and must pick one", async () => {
    const { s, sessionId } = await fullClass();
    expect((await s.c2.call("GET", "/settings")).body.waitlistModes).toBe("both");
    const none = await s.c2.call("POST", "/waitlist", { sessionId });
    expect(none.status).toBe(400);
    expect(none.body.error.fields.mode).toBe("Choose “Book me in automatically” or “Ask me first”.");
    const ok = await s.c2.call("POST", "/waitlist", { sessionId, mode: "manual" });
    expect(ok.status).toBe(201);
    expect(ok.body.mode).toBe("manual");
  });

  it("admins can make every waitlist automatic: no choice needed, the other way is refused plainly", async () => {
    const { s, sessionId } = await fullClass();
    expect((await s.owner.call("PATCH", "/settings", { waitlistModes: "automatic" })).body.waitlistModes).toBe("automatic");
    expect((await s.c2.call("GET", "/settings")).body.waitlistModes).toBe("automatic");
    const asked = await s.c2.call("POST", "/waitlist", { sessionId, mode: "manual" });
    expect(asked.status).toBe(400);
    expect(asked.body.error.message).toBe("This studio books people in from the waitlist automatically when a spot opens.");
    const ok = await s.c2.call("POST", "/waitlist", { sessionId });
    expect(ok.body.mode).toBe("automatic");
  });

  it("or always ask first, including when staff add someone", async () => {
    const { s, sessionId } = await fullClass();
    await s.owner.call("PATCH", "/settings", { waitlistModes: "manual" });
    const staff = await s.owner.call("POST", "/waitlist", { sessionId, clientId: s.c3.id });
    expect(staff.status).toBe(201);
    expect(staff.body.mode).toBe("manual");
    expect((await s.c2.call("POST", "/waitlist", { sessionId, mode: "automatic" })).body.error.code).toBe("waitlist_mode_not_offered");
  });

  it("only admins change it, and only to a real option", async () => {
    const { s } = await fullClass();
    expect((await s.c1.call("PATCH", "/settings", { waitlistModes: "manual" })).status).toBe(403);
    expect((await s.ana.call("PATCH", "/settings", { waitlistModes: "manual" })).status).toBe(403);
    expect((await s.owner.call("PATCH", "/settings", { waitlistModes: "sometimes" })).status).toBe(400);
  });
});
