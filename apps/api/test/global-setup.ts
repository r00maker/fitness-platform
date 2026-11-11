import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "../src/db/client.js";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://studio:studio@localhost:5432/studio_test";
  const { db, pool } = createDb(url);
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  await pool.end();
}
