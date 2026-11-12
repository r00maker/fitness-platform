/** Worker: send campaigns whose scheduled time has come. */
import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../../db/client.js";
import { emailCampaigns, emailDesigns } from "../../db/schema.js";
import { queueDesignEmail, type Urls } from "./messages.js";
import { allClients, matchSegment } from "./segments.js";
import { segments } from "../../db/schema.js";

export async function sendScheduledCampaigns(db: Db, urls: Urls, now = new Date()) {
  return db.transaction(async (tx) => {
    const due = await tx.select().from(emailCampaigns).where(and(eq(emailCampaigns.status, "scheduled"), lte(emailCampaigns.sendAt, now))).for("update", { skipLocked: true });
    for (const c of due) {
      const [design] = c.emailId ? await tx.select().from(emailDesigns).where(eq(emailDesigns.id, c.emailId)) : [];
      if (!design || design.archivedAt) {
        await tx.update(emailCampaigns).set({ status: "cancelled" }).where(eq(emailCampaigns.id, c.id));
        continue;
      }
      const [sg] = c.segmentId ? await tx.select().from(segments).where(eq(segments.id, c.segmentId)) : [];
      const ids = sg ? await matchSegment(tx, c.orgId, sg.definition, { now }) : await allClients(tx, c.orgId);
      const r = await queueDesignEmail(tx, c.orgId, design, ids, urls, { campaignId: c.id }, now);
      await tx.update(emailCampaigns).set({ status: "sent", sentAt: now, recipients: r.sent, skipped: r.skipped }).where(eq(emailCampaigns.id, c.id));
    }
    return due.length;
  });
}
