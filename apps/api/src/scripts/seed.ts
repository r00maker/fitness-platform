/** Local demo data: one studio, two locations, staff, clients, class types and a recurring schedule. */
import { sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { classTemplates, classTypes, clientHealthNotes, packagePlans, payRates, clientTagAssignments, clientTags, clientWaivers, locations, memberships, organizations, rooms, users } from "../db/schema.js";
import { createSeries } from "../modules/sessions/service.js";
import { sellPackage } from "../modules/packages/service.js";
import { Flags } from "../lib/flags.js";

const config = loadConfig();
if (config.NODE_ENV === "production") throw new Error("The demo seed must never run against production");
const { db, pool } = createDb(config.DATABASE_URL);

// Re-runnable: clear previous demo data first (development databases only).
await db.execute(sql`truncate organizations, users cascade`);

const [org] = await db.insert(organizations).values({ name: "Demo Studio", timezone: "Asia/Singapore" }).returning();
const mk = async (firstName: string, lastName: string, role: "owner" | "admin" | "instructor" | "client") => {
  const [u] = await db.insert(users).values({ firstName, lastName, email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com` }).returning();
  await db.insert(memberships).values({ orgId: org!.id, userId: u!.id, role });
  return u!;
};
const owner = await mk("Olivia", "Owner", "owner");
const ana = await mk("Ana", "Instructor", "instructor");
const ben = await mk("Ben", "Instructor", "instructor");
const chloe = await mk("Chloe", "Client", "client");
const dev = await mk("Dev", "Client", "client");
// Chloe has signed the waiver; Dev hasn't yet and has a knee injury; Chloe is tagged VIP (shown up front).
await db.insert(clientWaivers).values({ orgId: org!.id, clientId: chloe.id, method: "signed_by_client", signedName: "Chloe Client", waiverVersion: 1, recordedBy: chloe.id });
await db.insert(clientHealthNotes).values({ orgId: org!.id, clientId: dev.id, category: "injury", description: "Sore right knee, avoiding deep lunges", createdBy: dev.id });
const [vip] = await db.insert(clientTags).values({ orgId: org!.id, name: "VIP", color: "#b45309", pinned: true }).returning();
await db.insert(clientTagAssignments).values({ orgId: org!.id, clientId: chloe.id, tagId: vip!.id });

const [central] = await db.insert(locations).values({ orgId: org!.id, name: "Central", timezone: "Asia/Singapore" }).returning();
const [studio1] = await db.insert(rooms).values({ orgId: org!.id, locationId: central!.id, name: "Studio 1", capacity: 20 }).returning();
const [reformer] = await db.insert(classTypes).values({ orgId: org!.id, name: "Reformer Pilates", color: "#4F46E5", defaultDurationMinutes: 50 }).returning();
const [yoga] = await db.insert(classTypes).values({ orgId: org!.id, name: "Vinyasa Yoga", color: "#059669", defaultDurationMinutes: 60 }).returning();
const [tpl] = await db
  .insert(classTemplates)
  .values({ orgId: org!.id, name: "Reformer – 50 min", classTypeId: reformer!.id, locationId: central!.id, roomId: studio1!.id, instructorId: ana!.id, capacity: 12, durationMinutes: 50, startTime: "07:00" })
  .returning();

const auth = { userId: owner.id, orgId: org!.id, role: "owner" as const };
const today = new Date().toISOString().slice(0, 10);
await db.transaction((tx) => createSeries(tx, auth, { templateId: tpl!.id, daysOfWeek: [1, 3, 5], everyNWeeks: 1, startDate: today }, 28, new Flags()));
await db.transaction((tx) =>
  createSeries(tx, auth, { classTypeId: yoga!.id, locationId: central!.id, roomId: studio1!.id, instructorId: ben.id, capacity: 20, durationMinutes: 60, startTime: "18:30", daysOfWeek: [2, 4], everyNWeeks: 1, startDate: today }, 28, new Flags()),
);

// Packages: a class pack and an unlimited membership; Chloe has a pack.
const [pack] = await db
  .insert(packagePlans)
  .values({ orgId: org!.id, name: "10-class pack", kind: "credits", credits: 10, priceCents: 28000, validityValue: 3, validityUnit: "months", startsOn: "first_booking", activateWithinDays: 30 })
  .returning();
await db.insert(packagePlans).values({ orgId: org!.id, name: "Unlimited monthly", kind: "unlimited", priceCents: 32000, validityValue: 1, validityUnit: "months", weeklyLimit: 6 });
await db.transaction((tx) => sellPackage(tx, auth, chloe.id, { planId: pack!.id, notifyClient: false }));
// Pay: Ana per client with a minimum, Ben tiered by class size.
const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
await db.insert(payRates).values([
  { orgId: org!.id, staffId: ana.id, type: "per_client", amountCents: 2000, perClientCents: 300, clientsIncluded: 5, minimumCents: 4000, effectiveFrom: from },
  { orgId: org!.id, staffId: ben.id, type: "tiered", tiers: [{ fromClients: 0, amountCents: 4000 }, { fromClients: 6, amountCents: 5500 }, { fromClients: 12, amountCents: 7000 }], effectiveFrom: from },
]);

if (config.AUTH_DEV_SECRET) {
  const token = await new SignJWT({ org: org!.id }).setProtectedHeader({ alg: "HS256" }).setSubject(owner.id).setExpirationTime("12h").sign(new TextEncoder().encode(config.AUTH_DEV_SECRET));
  console.log(`Seeded. Owner token (12h):\n${token}`);
}
await pool.end();
