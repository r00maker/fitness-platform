/**
 * Background worker: a separate process from the API so slow email/push
 * providers never slow down the app. Run one or more copies.
 */
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { deliverPending } from "../modules/notifications/deliver.js";
import { providersFromConfig } from "../modules/notifications/providers.js";
import { processWaitlistTimers } from "../modules/waitlist/engine.js";
import { extendSeries } from "./series.js";
import { renewDuePackages } from "../modules/packages/lifecycle.js";
import { runDueJourneys, scanJourneyTriggers } from "../modules/marketing/journeys.js";
import { keepOverdueGiftCards } from "../modules/marketing/giftcards.js";
import { expireLoyalty } from "../modules/marketing/loyalty.js";
import { leadFollowUps, sendMetaConversions } from "../modules/marketing/ads.js";
import { sendScheduledCampaigns } from "../modules/marketing/campaigns.js";

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
const providers = providersFromConfig(config);
let running = true;

function every(ms: number, name: string, fn: () => Promise<unknown>) {
  const tick = async () => {
    if (!running) return;
    try {
      await fn();
    } catch (err) {
      console.error(`[worker] ${name} failed`, err);
    }
    if (running) setTimeout(tick, ms);
  };
  void tick();
}

every(2_000, "notifications", async () => {
  while ((await deliverPending(db, providers)) > 0) {}
});
every(30_000, "waitlist", () => processWaitlistTimers(db));
every(60_000, "renewals", () => renewDuePackages(db));
every(60 * 60_000, "series", () => extendSeries(db, config.SERIES_HORIZON_DAYS));
const urls = { api: config.PUBLIC_API_URL, app: config.PUBLIC_APP_URL };
every(60_000, "journeys", async () => {
  while ((await runDueJourneys(db, urls)) > 0) {}
});
every(60 * 60_000, "journey triggers", () => scanJourneyTriggers(db));
every(60_000, "campaigns", () => sendScheduledCampaigns(db, urls));
every(60 * 60_000, "gift cards", () => keepOverdueGiftCards(db));
every(6 * 60 * 60_000, "loyalty expiry", () => expireLoyalty(db));
every(15 * 60_000, "lead follow-ups", () => leadFollowUps(db, urls));
every(5 * 60_000, "meta conversions", () => sendMetaConversions(db, config));

const stop = async () => {
  running = false;
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
console.log("[worker] started");
