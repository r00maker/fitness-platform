import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { notifications, pushTokens, users } from "../../db/schema.js";
import type { EmailProvider, PushProvider } from "./providers.js";
import { render } from "./templates.js";

const MAX_ATTEMPTS = 5;

/**
 * Deliver a batch of queued notifications. Safe to run on several workers at
 * once: rows are claimed with SKIP LOCKED so each message is sent by one worker.
 */
export async function deliverPending(db: Db, providers: { email: EmailProvider; push: PushProvider }, batchSize = 50): Promise<number> {
  return db.transaction(async (tx) => {
    const batch = await tx
      .select({ n: notifications, email: users.email })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(and(eq(notifications.status, "pending"), lte(notifications.sendAfter, new Date())))
      .orderBy(notifications.sendAfter)
      .limit(batchSize)
      .for("update", { of: notifications, skipLocked: true });

    for (const { n, email } of batch) {
      try {
        const msg = render(n.template, n.data);
        if (n.channel === "email") {
          await providers.email.send({ to: email, subject: msg.subject, text: msg.body });
        } else {
          const tokens = await tx.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, n.userId));
          if (tokens.length) await providers.push.send({ tokens: tokens.map((t) => t.token), title: msg.pushTitle, body: msg.pushBody, data: { template: n.template, ...pick(n.data) } });
        }
        await tx.update(notifications).set({ status: "sent", sentAt: new Date(), attempts: n.attempts + 1 }).where(eq(notifications.id, n.id));
      } catch (err) {
        const attempts = n.attempts + 1;
        await tx
          .update(notifications)
          .set({
            attempts,
            lastError: String(err instanceof Error ? err.message : err).slice(0, 500),
            status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
            // Exponential back-off: 1, 2, 4, 8 minutes.
            sendAfter: sql`now() + make_interval(mins => ${2 ** (attempts - 1)})`,
          })
          .where(eq(notifications.id, n.id));
      }
    }
    return batch.length;
  });
}

/** Only pass ids (never personal data) through to the device for deep-linking. */
function pick(data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of ["sessionId", "bookingId", "waitlistEntryId", "requestId"]) if (k in data) out[k] = data[k];
  return out;
}

