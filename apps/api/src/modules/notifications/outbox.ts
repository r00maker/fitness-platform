import type { DbOrTx } from "../../db/client.js";
import { notifications } from "../../db/schema.js";
import { TEMPLATES } from "./templates.js";

/**
 * Queue email + push messages for people. Call this inside the same transaction
 * as the change that caused it: if the change rolls back, so do the messages.
 */
export async function notify(
  db: DbOrTx,
  opts: { orgId: string; userIds: (string | null | undefined)[]; template: string; data: Record<string, unknown>; channels?: readonly ("email" | "push")[] },
): Promise<void> {
  if (!TEMPLATES[opts.template]) throw new Error(`Unknown notification template: ${opts.template}`);
  const ids = [...new Set(opts.userIds.filter((x): x is string => !!x))];
  if (ids.length === 0) return;
  await db.insert(notifications).values(
    ids.flatMap((userId) =>
      (opts.channels ?? (["email", "push"] as const)).map((channel) => ({
        orgId: opts.orgId,
        userId,
        channel,
        template: opts.template,
        data: opts.data,
      })),
    ),
  );
}
