/**
 * Our staff: set a studio's plan from the command line (the same as POST /platform/studios/:id/plan).
 *
 *   pnpm --filter @studio/api plan:set <studio id> <essentials|growth|signature> [--app] [--no-app] [--yes]
 *
 * Without --yes it only says what would change (nothing is saved) when the change needs confirming.
 */
import { PLANS, type Plan } from "@studio/shared";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { AppError } from "../lib/errors.js";
import { Flags } from "../lib/flags.js";
import { setPlan } from "../modules/settings/plans.js";

const [orgId, plan, ...rest] = process.argv.slice(2);
if (!orgId || !PLANS.includes(plan as Plan)) {
  console.error("Usage: plan:set <studio id> <essentials|growth|signature> [--app] [--no-app] [--yes]");
  process.exit(1);
}
const brandedApp = rest.includes("--app") ? true : rest.includes("--no-app") ? false : undefined;
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
try {
  const out = await db.transaction(async (tx) => {
    const flags = new Flags(rest.includes("--yes") ? ["plan_changes"] : []);
    const r = await setPlan(tx, flags, orgId, { plan: plan as Plan, brandedApp }, null);
    flags.enforce();
    return r;
  });
  console.log(`Done: ${out.plan.label}, ${out.plan.price.perMonth}.`);
} catch (err) {
  if (err instanceof AppError && err.code === "needs_confirmation") {
    console.log(`${err.message}\nNothing was changed. Run again with --yes to go ahead.`);
    process.exitCode = 2;
  } else throw err;
} finally {
  await pool.end();
}
