// End-to-end: the real API (seeded, on a throwaway database) and the web app, in a real browser.
// A new person finds a class, signs in, joins, is told they need a package, buys one (paid at
// the desk, marked paid by the studio), signs the waiver, books, sees it in My bookings, cancels;
// My packages and Payment method; desktop and phone. Usage: pnpm --filter @studio/web e2e
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Playwright as installed on the machine (or add it as a dev dependency).
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const out = path.join(here, "shots");
mkdirSync(out, { recursive: true });
const API = "http://127.0.0.1:3998", WEB = "http://127.0.0.1:5199";
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
// Each server runs in its own process group, so stopping it stops what npx started too.
const stop = () => procs.forEach((p) => { try { process.kill(-p.pid, "SIGTERM"); } catch { /* already gone */ } });
process.on("exit", stop);

const results = [];
const ok = (name, cond, extra = "") => results.push([cond ? "PASS" : "FAIL", name + (extra ? `  (${extra})` : "")]);

try {
  const m = await start("npx", ["tsx", "src/scripts/e2e-server.ts"], path.join(root, "apps/api"), { E2E_DATABASE_URL: DB, PORT: "3998", WEB_ORIGIN: WEB }, /E2E_API_READY (\S+)/);
  const orgId = m[1];
  await start("npx", ["vite", "--port", "5199", "--host", "127.0.0.1", "--strictPort"], path.join(root, "apps/web"), { VITE_API_URL: API, VITE_AUTH: "dev" }, /Local:/);

  const ownerToken = (await (await fetch(`${API}/v1/dev/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@harbour.test" }) })).json()).token;
  const asOwner = (method, p, body) => fetch(`${API}/v1${p}`, { method, headers: { authorization: `Bearer ${ownerToken}`, "x-studio-id": orgId, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());

  const browser = await chromium.launch();
  for (const [label, opts] of [["desk", { viewport: { width: 1280, height: 860 } }], ["phone", { ...devices["iPhone 13"] }]]) {
    const ctx = await browser.newContext(opts);
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (msg) => msg.type() === "error" && !/409|404|401|Failed to load resource/.test(msg.text()) && errors.push(msg.text()));
    const shot = (n) => p.screenshot({ path: path.join(out, `${label}-${n}.png`), fullPage: true });
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    const email = `${label}.client@example.com`;
    try {
      // The booking page.
      await p.goto(`${WEB}/s/harbour-pilates`);
      await p.getByRole("heading", { name: "Harbour Pilates" }).waitFor();
      await p.locator(".list .row").first().waitFor();
      ok(`${label}: booking page with classes`, (await p.locator(".list .row").count()) > 0);
      ok(`${label}: instructor as first name and initial`, /Ana L\./.test(await p.locator(".list").innerText()));
      ok(`${label}: no h-scroll`, await noHScroll());
      await shot("1-page");
      await p.getByRole("tab", { name: "Packages" }).click();
      await p.getByRole("heading", { name: "5-class pack" }).waitFor();
      ok(`${label}: packages tab`, (await p.locator(".pack").count()) === 2);
      await p.getByRole("tab", { name: "Classes" }).click();

      // A class, then sign in and join.
      await p.locator(".list .row").first().click();
      await p.getByRole("button", { name: "Sign in to book" }).waitFor();
      ok(`${label}: class shows the packages that cover it`, (await p.locator(".need .plan").count()) === 2);
      await shot("2-class");
      await p.getByRole("button", { name: "Sign in to book" }).click();
      await p.getByLabel("Email").fill(email);
      await p.getByRole("button", { name: "Send me a code" }).click();
      await p.getByLabel("Code").fill("000000");
      await shot("3-code");
      await p.getByRole("button", { name: "Continue", exact: true }).click();
      await p.getByLabel("First name").waitFor();
      ok(`${label}: new people are asked a few details`, true);
      await p.getByLabel("First name").fill("Nia"); await p.getByLabel("Last name").fill(label === "desk" ? "Desk" : "Phone");
      await shot("4-join");
      await p.getByRole("button", { name: "Continue", exact: true }).click();
      // Back on the class, booking straight away: the waiver comes first (once), then the package.
      await p.getByRole("dialog", { name: "Sign the studio's waiver" }).waitFor({ timeout: 10_000 });
      ok(`${label}: waiver before the first class`, true);
      await p.getByLabel("I've read it and I agree").check();
      await p.getByLabel("Type your full name to sign").fill("Nia Test");
      await shot("5-waiver");
      await p.getByRole("button", { name: "Sign and continue" }).click();
      await p.locator(".notice.warn", { hasText: "You'll need a package" }).waitFor({ timeout: 10_000 });
      ok(`${label}: then told a package is needed`, true);

      // Buy the 5-class pack (paid at the desk here: no Stripe on this API).
      await p.locator(".need .plan", { hasText: "5-class pack" }).click();
      await p.getByRole("button", { name: /Place order/ }).waitFor();
      ok(`${label}: checkout quote`, /SGD 150\.00/.test(await p.locator(".sum").innerText()));
      await shot("6-checkout");
      await p.getByRole("button", { name: /Place order/ }).click();
      await p.getByText("Order placed").first().waitFor();
      ok(`${label}: order placed`, true);
      const orders = await asOwner("GET", "/orders?status=pending");
      const mine = orders.find((o) => o.clientName.startsWith("Nia") && o.clientName.toLowerCase().includes(label === "desk" ? "desk" : "phone"));
      const paid = await asOwner("POST", `/orders/${mine.id}/mark-paid`, { method: "cash" });
      ok(`${label}: the studio marks it paid`, paid.status === "paid");
      await p.getByRole("link", { name: "Back to the class" }).click();

      // Back on the class, booking carries on by itself (the waiver is already signed).
      await p.getByRole("heading", { name: "Reformer Flow" }).waitFor();
      const outcome = p.locator('.dialog, .cls .notice.ok:has-text("booked")');
      const carried = await outcome.first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      ok(`${label}: booking carries on after buying`, carried);
      if (!carried) await p.getByRole("button", { name: "Book this class" }).click();
      // Either "please check" (a class within the cancellation window) or booked straight away.
      await outcome.first().waitFor();
      if (await p.locator(".dialog").count()) {
        ok(`${label}: asked first (${(await p.locator(".dialog h2").innerText())})`, true);
        await shot("7-check");
        await p.getByRole("button", { name: "Book it" }).click();
      }
      await p.locator(".notice.ok", { hasText: "You're booked" }).first().waitFor();
      ok(`${label}: booked with the package, no second waiver`, /5-class pack/.test(await p.locator(".cls").innerText()));
      await shot("7-booked");

      // My account.
      await p.getByRole("link", { name: "My account" }).click();
      await p.locator(".list .row").first().waitFor();
      ok(`${label}: in My bookings`, (await p.locator(".list .row").count()) === 1);
      await p.getByRole("button", { name: /^Cancel / }).click();
      await p.locator(".dialog, .notice").first().waitFor();
      const late = (await p.locator(".dialog").count()) > 0;
      if (late) await p.getByRole("button", { name: "Cancel the booking" }).click();
      await p.locator(".notice", { hasText: /^Cancelled/ }).waitFor();
      ok(`${label}: cancelled (${late ? "late: class not given back" : "class given back"})`, late ? /late cancellation/.test(await p.locator(".notice").innerText()) : /back in your package/.test(await p.locator(".notice").innerText()));
      await p.getByRole("tab", { name: "My packages" }).click();
      await p.locator(".pack.mine").first().waitFor();
      ok(`${label}: My packages shows classes left`, /\d+\s*classes left/.test(await p.locator(".pack.mine").first().innerText()), (await p.locator(".pack.mine").first().innerText()).replace(/\n/g, " · ").slice(0, 80));
      await shot("8-packages");
      await p.getByRole("tab", { name: "Payment method" }).click();
      await p.getByText("Online payments aren't on yet").waitFor();
      ok(`${label}: payment method explains it's not on yet`, true);
      ok(`${label}: account no h-scroll`, await noHScroll());

      // A link that doesn't exist.
      await p.goto(`${WEB}/s/no-such-studio`);
      await p.getByRole("heading", { name: "Page not found" }).waitFor();
      ok(`${label}: unknown link: not found`, true);
    } catch (e) {
      ok(`${label}: ran to the end`, false, e.message.split("\n").slice(0, 8).join(" / "));
      await shot("error");
    }
    ok(`${label}: no page errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  await browser.close();
} catch (e) {
  ok("setup", false, e.message.slice(0, 1500));
}
stop();
for (const [r, n] of results) console.log(r, n);
console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
process.exit(results.some(([r]) => r === "FAIL") ? 1 : 0);
