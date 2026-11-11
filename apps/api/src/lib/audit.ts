import type { DbOrTx } from "../db/client.js";
import { auditLog } from "../db/schema.js";

/** Record who changed what. Kept for support, disputes and data-protection requests. */
export async function audit(
  db: DbOrTx,
  entry: { orgId: string; actorId: string | null; action: string; entityType: string; entityId: string; details?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values(entry);
}
