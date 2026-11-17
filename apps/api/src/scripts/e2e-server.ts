/**
 * A seeded API for the web app's end-to-end run (apps/web/e2e). Never for production: it wipes
 * the database it's given. Usage: E2E_DATABASE_URL=... PORT=3998 tsx src/scripts/e2e-server.ts
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";

const url = process.env.E2E_DATABASE_URL;
if (!url || !/_e2e\b|_e2e$/.test(url)) throw new Error("Set E2E_DATABASE_URL to a database whose name ends in _e2e (it is wiped).");
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = url;
process.env.AUTH_DEV_SECRET ||= "e2e-secret-e2e-secret-e2e-secret-0123456789";
process.env.CORS_ORIGINS = process.env.WEB_ORIGIN ?? "http://127.0.0.1:5199";
process.env.PUBLIC_APP_URL = process.env.WEB_ORIGIN ?? "http://127.0.0.1:5199";

const { loadConfig } = await import("../config.js");
const { createDb } = await import("../db/client.js");
const { buildApp } = await import("../app.js");
const S = await import("../db/schema.js");
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });

const [org] = await db.insert(S.organizations).values({ name: "Harbour Pilates", slug: "harbour-pilates", timezone: "Asia/Singapore", currency: "SGD", waiverRequired: true, clientsNeedPackage: true, bookingIntro: "Small reformer and mat classes by the harbour. New here? Start with the 5-class pack.", lifecycle: "live" }).returning();
const [owner] = await db.insert(S.users).values({ firstName: "Olivia", lastName: "Tan", email: "owner@harbour.test" }).returning();
const [ana] = await db.insert(S.users).values({ firstName: "Ana", lastName: "Lim", email: "ana@harbour.test" }).returning();
await db.insert(S.memberships).values([{ orgId: org!.id, userId: owner!.id, role: "owner" }, { orgId: org!.id, userId: ana!.id, role: "instructor" }]);
const [tp] = await db.insert(S.locations).values({ orgId: org!.id, name: "Keppel Bay", address: "2 Keppel Bay Vista, Singapore", timezone: "Asia/Singapore" }).returning();
const [hv] = await db.insert(S.locations).values({ orgId: org!.id, name: "Sentosa Cove", timezone: "Asia/Singapore" }).returning();
const [reformer] = await db.insert(S.classTypes).values({ orgId: org!.id, name: "Reformer Flow", color: "#4F46E5", description: "A full-body reformer class for every level. Grip socks needed." }).returning();
const [mat] = await db.insert(S.classTypes).values({ orgId: org!.id, name: "Mat Pilates", color: "#0E7490" }).returning();
// Classes for the next 7 days at 07:00, 12:30 and 18:30 Singapore time (UTC+8).
for (let d = 0; d < 7; d++) {
  for (const [h, m, type, loc, cap] of [[7, 0, reformer, tp, 8], [12, 30, mat, hv, 3], [18, 30, reformer, tp, 10]] as const) {
    const day = new Date(Date.now() + d * 86_400_000);
    const starts = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h - 8, m));
    if (starts.getTime() < Date.now() + 3600_000) continue;
    await db.insert(S.classSessions).values({ orgId: org!.id, classTypeId: type!.id, locationId: loc!.id, instructorId: ana!.id, startsAt: starts, endsAt: new Date(starts.getTime() + 50 * 60_000), capacity: cap });
  }
}
await db.insert(S.packagePlans).values([
  { orgId: org!.id, name: "5-class pack", kind: "credits", credits: 5, priceCents: 15000, validityValue: 2, validityUnit: "months", onSale: true },
  { orgId: org!.id, name: "Unlimited monthly", kind: "unlimited", billing: "recurring", priceCents: 32000, validityValue: 1, validityUnit: "months", onSale: true },
]);

const app = await buildApp({ config, db });
await app.listen({ port: Number(process.env.PORT ?? 3998), host: "127.0.0.1" });
console.log(`E2E_API_READY ${org!.id}`);
