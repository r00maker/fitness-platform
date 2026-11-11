import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "../db/client.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, pool } = createDb(url);
const migrationsFolder = process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../../drizzle", import.meta.url));
await migrate(db, { migrationsFolder });
await pool.end();
console.log("Migrations applied");
