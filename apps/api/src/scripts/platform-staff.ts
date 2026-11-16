/**
 * Our team: add (or change the role of) someone who can use HQ. Run on the server; there's no
 * way to do this from a studio account.
 *
 *   pnpm --filter @studio/api platform:staff <email> <owner|onboarding|support> [--first Name --last Name] [--remove]
 *
 * They sign in with the same sign-in provider as everyone else; this only says they're our staff.
 */
import { eq, sql } from "drizzle-orm";
import { schemas } from "@studio/shared";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { platformStaff, users } from "../db/schema.js";

const [emailArg, role, ...rest] = process.argv.slice(2);
const flag = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
if (!emailArg || !(schemas.PLATFORM_ROLES as readonly string[]).includes(role ?? "")) {
  console.error("Usage: platform:staff <email> <owner|onboarding|support> [--first Name --last Name] [--remove]");
  process.exit(1);
}
const email = emailArg.trim().toLowerCase();
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
try {
  let [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  u ??= (await db.insert(users).values({ email, firstName: flag("first") ?? "HQ", lastName: flag("last") ?? "Staff" }).returning())[0];
  if (rest.includes("--remove")) {
    await db.update(platformStaff).set({ active: false }).where(eq(platformStaff.userId, u!.id));
    console.log(`${email} can no longer use HQ.`);
  } else {
    await db.insert(platformStaff).values({ userId: u!.id, role: role as "owner" }).onConflictDoUpdate({ target: platformStaff.userId, set: { role: role as "owner", active: true } });
    console.log(`${email} can use HQ as ${role}.`);
  }
} finally {
  await pool.end();
}
