import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { bookings, classSessions, locations, organizations } from "../src/db/schema.js";
import { app, db, outbox, person, pool, reset, studio } from "./helpers.js";

beforeEach(reset);
afterAll(async () => {
  await app.close();
  await pool.end();
});

const HOUR = 3_600_000;
async function setup() {
  const s = await studio();
  /** A class that ended `hoursAgo` hours ago, taught by `who`, with these clients booked. */
  const past = async (hoursAgo: number, who: string, clients: string[], extra: Partial<typeof classSessions.$inferInsert> = {}) => {
    const startsAt = new Date(Date.now() - hoursAgo * HOUR - HOUR);
    const [c] = await db.insert(classSessions).values({ orgId: s.orgId, classTypeId: s.classTypeId, locationId: s.locationId, instructorId: who, capacity: 10, startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000), ...extra }).returning();
    const bs = clients.length ? await db.insert(bookings).values(clients.map((clientId) => ({ orgId: s.orgId, sessionId: c!.id, clientId, source: "client" as const }))).returning() : [];
    return { sessionId: c!.id, bookingFor: (clientId: string) => bs.find((b) => b.clientId === clientId)!.id };
  };
  return { s, past };
}

describe("asking for reviews", () => {
  it("asks about the latest class they came to; skipping is fine and the next class asks again", async () => {
    const { s, past } = await setup();
    const older = await past(48, s.ana.id, [s.c1.id]);
    const latest = await past(3, s.ana.id, [s.c1.id]);
    const p = (await s.c1.call("GET", "/me/review-prompt")).body;
    expect(p.prompt).toMatchObject({ bookingId: latest.bookingFor(s.c1.id), className: "Reformer Pilates", instructorName: expect.stringMatching(/^Ana /) });
    expect(p.canSnooze).toBe(false);

    expect((await s.c1.call("POST", "/reviews/skip", { bookingId: latest.bookingFor(s.c1.id) })).status).toBe(200);
    // Skipped: no pop-up, and the older class isn't asked about either.
    expect((await s.c1.call("GET", "/me/review-prompt")).body.prompt).toBeNull();
    const next = await past(1, s.ana.id, [s.c1.id]);
    expect((await s.c1.call("GET", "/me/review-prompt")).body.prompt.bookingId).toBe(next.bookingFor(s.c1.id));
    // They can still review an older class on purpose.
    expect((await s.c1.call("POST", "/reviews", { bookingId: older.bookingFor(s.c1.id), rating: 5 })).status).toBe(201);
  });

  it("a review can pause the pop-ups for N weeks; pausing on its own needs a review first", async () => {
    const { s, past } = await setup();
    const a = await past(3, s.ana.id, [s.c1.id]);
    expect((await s.c1.call("PUT", "/me/review-snooze", { weeks: 4 })).body.error.message).toBe("Leave one review first, then you can pause the review pop-ups.");
    const r = await s.c1.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 5, comment: "Loved it", snoozeWeeks: 4 });
    expect(r.status).toBe(201);
    expect(new Date(r.body.snoozedUntil).getTime()).toBeGreaterThan(Date.now() + 27 * 24 * HOUR);
    await past(1, s.ana.id, [s.c1.id]);
    const p = (await s.c1.call("GET", "/me/review-prompt")).body;
    expect(p.prompt).toBeNull();
    expect(p.snoozedUntil).not.toBeNull();
    expect((await s.c1.call("PUT", "/me/review-snooze", { weeks: 0 })).body.snoozedUntil).toBeNull();
    expect((await s.c1.call("GET", "/me/review-prompt")).body.prompt).not.toBeNull();
    expect((await s.c1.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 4, snoozeWeeks: 3 })).status).toBe(400);
  });

  it("only for classes they came to, once, after it finished, from the client themselves", async () => {
    const { s, past } = await setup();
    const a = await past(3, s.ana.id, [s.c1.id, s.c2.id]);
    await db.update(bookings).set({ attendance: "no_show" }).where(eq(bookings.id, a.bookingFor(s.c2.id)));
    expect((await s.c2.call("POST", "/reviews", { bookingId: a.bookingFor(s.c2.id), rating: 5 })).body.error.code).toBe("not_reviewable");
    expect((await s.c2.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 5 })).status).toBe(404);
    expect((await s.c1.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 6 })).body.error.fields.rating).toBe("Choose from 1 to 5 stars.");
    expect((await s.c1.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 4 })).status).toBe(201);
    expect((await s.c1.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 4 })).body.error.code).toBe("already_reviewed");
    const future = await past(-5, s.ana.id, [s.c3.id]);
    expect((await s.c3.call("POST", "/reviews", { bookingId: future.bookingFor(s.c3.id), rating: 5 })).body.error.code).toBe("not_finished");
    expect((await s.owner.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 5 })).status).toBe(403);
    await db.update(organizations).set({ reviewsEnabled: false }).where(eq(organizations.id, s.orgId));
    expect((await s.c3.call("GET", "/me/review-prompt")).body.prompt).toBeNull();
  });
});

describe("Google reviews", () => {
  it("offers the studio's Google link to everyone who reviews, whatever they gave, and counts taps", async () => {
    const { s, past } = await setup();
    expect((await s.owner.call("PATCH", "/settings", { googleReviewUrl: "http://example.com" })).status).toBe(400);
    await s.owner.call("PATCH", "/settings", { googleReviewUrl: "https://g.page/r/abc123/review" });
    const a = await past(3, s.ana.id, [s.c1.id, s.c2.id]);
    const happy = (await s.c1.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 5, comment: "Great class!" })).body;
    const unhappy = (await s.c2.call("POST", "/reviews", { bookingId: a.bookingFor(s.c2.id), rating: 2, comment: "Too crowded" })).body;
    // No review gating: the same offer for 5 stars and for 2.
    expect(happy.google).toMatchObject({ url: "https://g.page/r/abc123/review", text: "Great class!" });
    expect(unhappy.google).toMatchObject({ url: "https://g.page/r/abc123/review", text: "Too crowded" });
    expect((await s.c1.call("POST", `/reviews/${happy.review.id}/google`)).body.recorded).toBe(true);
    expect((await s.c2.call("POST", `/reviews/${happy.review.id}/google`)).body.recorded).toBe(false); // not theirs
    expect((await s.owner.call("GET", "/reviews")).body.summary.google).toEqual({ offered: 2, tapped: 1 });
  });
});

describe("the Reviews page", () => {
  it("summarises and filters by instructor, class type, stars and location; low reviews tell admins", async () => {
    const { s, past } = await setup();
    const [east] = await db.insert(locations).values({ orgId: s.orgId, name: "East", timezone: "Asia/Singapore" }).returning();
    const a = await past(5, s.ana.id, [s.c1.id, s.c2.id]);
    const b = await past(4, s.ben.id, [s.c1.id, s.c3.id], { locationId: east!.id });
    await s.c1.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 5, comment: "Ana is brilliant" });
    await s.c2.call("POST", "/reviews", { bookingId: a.bookingFor(s.c2.id), rating: 4 });
    await s.c1.call("POST", "/reviews", { bookingId: b.bookingFor(s.c1.id), rating: 2, comment: "Room was too hot" });
    await s.c3.call("POST", "/reviews", { bookingId: b.bookingFor(s.c3.id), rating: 3 });
    expect((await outbox("review.low")).filter((n) => n.channel === "email").map((n) => n.userId)).toEqual([s.owner.id]);

    const all = (await s.owner.call("GET", "/reviews")).body;
    expect(all.summary).toMatchObject({ count: 4, average: 3.5, low: 1, text: "3.5 out of 5 from 4 reviews." });
    expect(all.summary.distribution).toEqual([{ stars: 5, count: 1 }, { stars: 4, count: 1 }, { stars: 3, count: 1 }, { stars: 2, count: 1 }, { stars: 1, count: 0 }]);
    expect(all.byInstructor.map((x: { name: string; average: number }) => x.average).sort()).toEqual([2.5, 4.5]);
    expect(all.reviews.find((r: { comment: string }) => r.comment === "Ana is brilliant").clientName).toMatch(/^Chloe T\d+$/);
    expect((await s.owner.call("GET", `/reviews?instructorId=${s.ana.id}`)).body.summary.count).toBe(2);
    expect((await s.owner.call("GET", "/reviews?stars=low")).body.reviews.map((r: { comment: string }) => r.comment)).toEqual(["Room was too hot"]);
    expect((await s.owner.call("GET", `/reviews?locationId=${east!.id}`)).body.summary.count).toBe(2);
    expect((await s.owner.call("GET", `/reviews?classTypeId=${s.classTypeId}&stars=5`)).body.summary.count).toBe(4); // the summary covers the filters, not the stars
    expect((await s.owner.call("GET", `/reviews?classTypeId=${s.classTypeId}&stars=5`)).body.reviews).toHaveLength(1);

    // Instructors see their own classes, with first names and initials.
    const ana = (await s.ana.call("GET", "/reviews")).body;
    expect(ana.summary.count).toBe(2);
    expect(ana.reviews[0].clientName).toMatch(/^\w+ T\.$/);
    expect(ana.byInstructor).toEqual([]);
    expect((await s.ana.call("GET", `/reviews?instructorId=${s.ben.id}`)).body.summary.count).toBe(2); // still only hers
    expect((await s.c1.call("GET", "/reviews")).status).toBe(403);
    expect((await (await studio()).owner.call("GET", "/reviews")).body.summary.count).toBe(0);
  });
});

describe("feedback", () => {
  it("clients send feedback in a category; staff see categories apart, reply, and sort it", async () => {
    const { s } = await setup();
    const sent = await s.c1.call("POST", "/feedback", { category: "facilities", message: "The aircon at Central is really cold", locationId: s.locationId });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ categoryLabel: "Facilities and comfort", locationName: "Central", status: "new" });
    await s.c2.call("POST", "/feedback", { category: "classes", message: "Could we have a 6am Reformer on Fridays?" });
    expect((await outbox("feedback.new")).filter((n) => n.channel === "email")).toHaveLength(2);
    expect((await s.c1.call("POST", "/feedback", { category: "facilities", message: "Hot" })).body.error.fields.message).toBe("Tell us a little more (at least a few words).");

    const desk = await person(s.orgId, "front_desk");
    const page = (await desk.call("GET", "/feedback")).body;
    expect(page.categories.find((c: { category: string }) => c.category === "facilities")).toMatchObject({ label: "Facilities and comfort", new: 1, open: 1, total: 1 });
    expect(page.categories.find((c: { category: string }) => c.category === "classes").new).toBe(1);
    expect(page.needsAttention).toMatchObject({ count: 2, newFeedback: 2, lowReviews: [] });
    expect((await desk.call("GET", "/feedback?category=classes")).body.feedback.map((f: { message: string }) => f.message)).toEqual(["Could we have a 6am Reformer on Fridays?"]);

    const r = await desk.call("POST", `/feedback/${sent.body.id}/replies`, { body: "Thanks! We've turned it up two degrees." });
    expect(r.body.status).toBe("in_progress");
    expect((await outbox("feedback.replied")).map((n) => n.userId)).toContain(s.c1.id);
    const mine = (await s.c1.call("GET", "/me/feedback")).body.feedback[0];
    expect(mine.replies[0]).toMatchObject({ fromStudio: true, body: "Thanks! We've turned it up two degrees.", authorName: "Test Studio" });
    expect((await desk.call("PATCH", `/feedback/${sent.body.id}`, { status: "resolved" })).body.status).toBe("resolved");
    // A client answering back reopens it for staff.
    expect((await s.c1.call("POST", `/me/feedback/${sent.body.id}/replies`, { body: "Much better now, thank you!" })).body.status).toBe("new");
    expect((await s.c2.call("POST", `/me/feedback/${sent.body.id}/replies`, { body: "Me too" })).status).toBe(404);
  });

  it("flags low reviews under Needs attention until someone follows them up", async () => {
    const { s, past } = await setup();
    const a = await past(3, s.ana.id, [s.c1.id]);
    const rev = (await s.c1.call("POST", "/reviews", { bookingId: a.bookingFor(s.c1.id), rating: 1, comment: "Started 15 minutes late" })).body.review;
    const low = (await s.owner.call("GET", "/feedback")).body.needsAttention;
    expect(low.count).toBe(1);
    expect(low.lowReviews[0]).toMatchObject({ rating: 1, comment: "Started 15 minutes late", instructorName: expect.stringMatching(/^Ana /) });
    const done = await s.owner.call("POST", `/reviews/${rev.id}/handle`, { reply: "Sorry about that. Your next class is on us." });
    expect(done.body).toMatchObject({ handled: true, staffReply: "Sorry about that. Your next class is on us." });
    expect((await outbox("review.reply")).map((n) => n.userId)).toContain(s.c1.id);
    expect((await s.owner.call("GET", "/feedback")).body.needsAttention.count).toBe(0);
    expect((await s.owner.call("POST", `/reviews/${rev.id}/handle`, {})).body.error.code).toBe("already_handled");
  });

  it("only clients send it, only staff with access read it, and studios stay separate", async () => {
    const { s } = await setup();
    expect((await s.owner.call("POST", "/feedback", { category: "other", message: "Testing from staff" })).status).toBe(403);
    const f = (await s.c1.call("POST", "/feedback", { category: "other", message: "Lovely studio, thank you" })).body;
    expect((await s.ana.call("GET", "/feedback")).status).toBe(403);
    expect((await s.c1.call("GET", "/feedback")).status).toBe(403);
    const other = await studio();
    expect((await other.owner.call("POST", `/feedback/${f.id}/replies`, { body: "Hi" })).status).toBe(404);
    expect((await other.owner.call("GET", "/feedback")).body.feedback).toHaveLength(0);
  });
});
