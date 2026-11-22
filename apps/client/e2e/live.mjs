/**
 * The client app on the real API: starts the seeded API (a throwaway database, studio_e2e) and the
 * app, then a member signs in, sees Home in the studio's look, books a class with the inline
 * confirmation, sets a goal and cancels. Usage: node e2e/live.mjs (Postgres running; Playwright
 * from NODE_PATH).
 */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const API = "http://127.0.0.1:3997";
const WEB = "http://127.0.0.1:5198";
const DB = process.env.E2E_DATABASE_URL ?? "postgres://studio:studio@localhost:5432/studio_e2e";

const procs = [];
const start = (cmd, args, cwd, env, ready) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  procs.push(p);
  let log = "";
  const on = (b) => { log += b; const m = log.match(ready); if (m) resolve(m); };
  p.stdout.on("data", on); p.stderr.on("data", on);
  p.on("exit", (c) => reject(new Error(`${cmd} exited ${c}\n${log.slice(-2000)}`)));
  setTimeout(() => reject(new Error(`${cmd} didn't start\n${log.slice(-2000)}`)), 60_000);
});
const stop = () => procs.forEach((p) => { try { process.kill(-p.pid, "SIGTERM"); } catch { /* gone */ } });
process.on("exit", stop);

let failed = 0, passed = 0;
const ok = (label, cond, extra = "") => { if (cond) passed++; else failed++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && extra ? ` (${extra})` : ""}`); };

try {
  const m = await start("npx", ["tsx", "src/scripts/e2e-server.ts"], path.join(root, "apps/api"), { E2E_DATABASE_URL: DB, PORT: "3997", WEB_ORIGIN: WEB }, /E2E_API_READY (\S+)/);
  const orgId = m[1];
  await start("npx", ["vite", "--port", "5198", "--host", "127.0.0.1", "--strictPort"], path.join(root, "apps/client"), { VITE_API_URL: API, VITE_AUTH: "dev" }, /Local:/);
  const token = async (email) => (await (await fetch(`${API}/v1/dev/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) })).json()).token;
  const as = (t) => async (method, p, body) => {
    const r = await fetch(`${API}/v1${p}`, { method, headers: { authorization: `Bearer ${t}`, "x-studio-id": orgId, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return r.status === 204 ? {} : r.json();
  };
  const owner = as(await token("owner@harbour.test"));
  // The studio: no waiver for this run, and the Linden look for its app.
  await owner("PATCH", "/settings", { waiverRequired: false });
  ok("api: the studio sets its app look", (await owner("PATCH", "/app-theme", { preset: "linden", welcome: "Breathe out. You're here." })).preset === "linden");
  // A member who has joined and bought a pack.
  const memberToken = await token("mei@example.com");
  const member = as(memberToken);
  await member("POST", "/join", { firstName: "Mei", lastName: "Tan" });
  const memberId = JSON.parse(Buffer.from(memberToken.split(".")[1], "base64url").toString()).sub;
  const pack = (await owner("GET", "/package-plans")).find((p) => p.name === "5-class pack");
  const sold = await owner("POST", `/clients/${memberId}/packages`, { planId: pack.id });
  ok("api: the member has a pack", !!sold.id, JSON.stringify(sold).slice(0, 200));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${WEB}/s/harbour-pilates`);
  // Sign in with the email code (locally the code is 000000).
  await page.getByLabel("Email").fill("mei@example.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel(/6-digit code/).fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForSelector(".hello h1");
  ok("app: Home greets the member", (await page.locator(".hello h1").textContent()).includes("Mei"));
  ok("app: in the studio's look", (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--display"))).includes("Young Serif") && (await page.locator(".hello p").textContent()) === "Breathe out. You're here.");
  ok("app: progress from the API", (await page.locator(".track-count span").textContent()) === "0" && (await page.locator(".track-next").textContent()) === "10 more to your 10th");

  await page.getByRole("button", { name: "8 a month" }).click();
  await page.waitForSelector(".goal-edit output");
  ok("app: goal set through the API", (await page.locator(".goal-edit output").textContent()) === "8");

  await page.getByRole("link", { name: "Book", exact: true }).click();
  await page.waitForSelector(".class-list:not(.is-loading) .class-row");
  const idx = await page.locator(".class-list .class-row").evaluateAll((rows) => rows.findIndex((r) => r.querySelector(".btn-main")));
  const row = page.locator(".class-list .class-row").nth(idx);
  await row.locator(".btn-main").click();
  await row.locator(".confirm-box .btn-main").waitFor();
  ok("app: the confirmation names the pack", /Uses 1 class from your 5-class pack\. 4 left after this\./.test(await row.locator(".confirm-line").textContent()));
  await row.getByRole("button", { name: "Confirm booking" }).click();
  await page.waitForSelector(".toast:has-text('Booked:')");
  ok("app: booked through the API", (await row.locator(".booked-mark").count()) === 1);
  const bookings = await member("GET", "/me/bookings?show=classes");
  ok("api: the booking is there", bookings.classes.length === 1);

  await page.getByRole("link", { name: /My classes/ }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Cancel class" }).click();
  // Inside the late-cancellation window the API asks first, and the row says why.
  const late = page.getByRole("button", { name: "Cancel anyway" });
  await Promise.race([late.waitFor().catch(() => {}), page.waitForSelector(".toast:has-text('Cancelled:')").catch(() => {})]);
  if (await late.count()) {
    ok("app: the late-cancellation check, in the row", /won't get your class credit back|class isn't given back|late/i.test(await page.locator(".confirm-line").textContent()));
    await late.click();
  }
  await page.waitForSelector(".toast:has-text('Cancelled:')");
  ok("app: cancelled through the API", (await member("GET", "/me/bookings?show=classes")).classes.length === 0);
  await page.getByRole("link", { name: "Me", exact: true }).click();
  ok("app: the pack shows what's left", /of5left/.test((await page.locator(".pkg-left").textContent()).replace(/\s/g, "")));
  ok("no errors in the page", errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: path.join(root, "apps/client/e2e/shots/live-me.png") });
  await browser.close();
} catch (e) {
  failed++;
  console.log("FAIL", e.message);
} finally {
  stop();
}
console.log(`${failed} failed of ${passed + failed}`);
process.exit(failed ? 1 : 0);
