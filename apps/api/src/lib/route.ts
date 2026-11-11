import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { Db, Tx } from "../db/client.js";
import { Flags, type Flag } from "./flags.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    config: Config;
  }
}

/** Run a unit of work in one transaction: everything succeeds together or nothing changes. */
export function inTx<T>(app: FastifyInstance, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return app.db.transaction(fn);
}

/**
 * Like inTx, for actions that can raise "please check" warnings. If any still need
 * confirming, everything is rolled back and a 409 lists them. On success the
 * warnings (including acknowledged and info ones) are returned as `flags`.
 */
export async function withFlags<T extends object>(
  app: FastifyInstance,
  acknowledge: readonly string[],
  fn: (tx: Tx, flags: Flags) => Promise<T>,
): Promise<T & { flags: Flag[] }> {
  return app.db.transaction(async (tx) => {
    const flags = new Flags(acknowledge);
    const result = await fn(tx, flags);
    flags.enforce();
    return { ...result, flags: flags.list };
  });
}
