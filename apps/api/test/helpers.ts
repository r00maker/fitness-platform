import { SignJWT } from "jose";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { classTypes, locations, memberships, notifications, organizations, rooms, users } from "../src/db/schema.js";

export const config = loadConfig();
export const { db, pool } = createDb(config.DATABASE_URL);
export const app = await buildApp({ config, db });

export async function reset() {
  const tables = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`);
  await db.execute(sql.raw(`truncate ${tables.rows.map((t) => `"${t.tablename}"`).join(", ")} cascade`));
}

export async function tokenFor(userId: string, orgId: string) {
  return new SignJWT({ org: orgId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setExpirationTime("1h").sign(new TextEncoder().encode(config.AUTH_DEV_SECRET!));
}

type Role = "owner" | "admin" | "front_desk" | "instructor" | "client";
let n = 0;
export async function person(orgId: string, role: Role, firstName: string = role) {
  const [u] = await db.insert(users).values({ firstName, lastName: `T${++n}`, email: `${role}${n}@example.com` }).returning();
  await db.insert(memberships).values({ orgId, userId: u!.id, role });
  const token = await tokenFor(u!.id, orgId);
  return { id: u!.id, token, call: caller(token) };
}

export function caller(token: string) {
  return async (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown) => {
    const res = await app.inject({ method, url: `/v1${url}`, headers: { authorization: `Bearer ${token}` }, ...(body !== undefined && { payload: body as object }) });
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };
}

/** A studio with an owner, two instructors, three clients, a location, room and class type. */
export async function studio(opts: { substituteApproval?: "automatic" | "manual"; waiverRequired?: boolean; clientsNeedPackage?: boolean } = {}) {
  // Waivers are on by default for real studios; most tests aren't about them, so they're off unless asked for.
  const [org] = await db
    .insert(organizations)
    .values({ name: "Test Studio", timezone: "Asia/Singapore", substituteApproval: opts.substituteApproval ?? "manual", waiverRequired: opts.waiverRequired ?? false, clientsNeedPackage: opts.clientsNeedPackage ?? false })
    .returning();
  const orgId = org!.id;
  const [loc] = await db.insert(locations).values({ orgId, name: "Central", timezone: "Asia/Singapore" }).returning();
  const [room] = await db.insert(rooms).values({ orgId, locationId: loc!.id, name: "Studio 1", capacity: 30 }).returning();
  const [type] = await db.insert(classTypes).values({ orgId, name: "Reformer Pilates", color: "#4F46E5" }).returning();
  return {
    orgId,
    locationId: loc!.id,
    roomId: room!.id,
    classTypeId: type!.id,
    owner: await person(orgId, "owner", "Olivia"),
    ana: await person(orgId, "instructor", "Ana"),
    ben: await person(orgId, "instructor", "Ben"),
    c1: await person(orgId, "client", "Chloe"),
    c2: await person(orgId, "client", "Dev"),
    c3: await person(orgId, "client", "Eve"),
  };
}

/** A local date `days` from today, in Singapore. */
export function dayOffset(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
}

/** Local date and HH:MM a number of minutes from now, in Singapore. */
export function minutesFromNow(mins: number) {
  const d = new Date(Date.now() + mins * 60_000);
  return {
    date: d.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" }),
    startTime: d.toLocaleTimeString("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

export async function outbox(template?: string) {
  const rows = await db.select().from(notifications);
  return rows.filter((r) => !template || r.template === template);
}
