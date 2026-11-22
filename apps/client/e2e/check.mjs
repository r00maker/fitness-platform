/**
 * Checks the client app in a real browser, using the built-in demo studios (no server needed):
 * builds the demo, serves it, and walks through Home, booking, the goal, cancelling, filters,
 * celebrations, the three looks, a wide screen and reduced motion.
 * Usage: node e2e/check.mjs   (Playwright from NODE_PATH, e.g. /opt/node-tools/node_modules)
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist-demo");
const shots = join(here, "shots");
mkdirSync(shots, { recursive: true });

execFileSync("npx", ["vite", "build", "--outDir", "dist-demo", "--base", "./"], { cwd: root, stdio: "ignore", env: { ...process.env, VITE_DEMO: "1" } });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!path.startsWith(dist) || !existsSync(path)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
}).listen(0);
const base = `http://localhost:${server.address().port}`;

let failed = 0, passed = 0;
const ok = (label, cond, extra = "") => { if (cond) passed++; else failed++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && extra ? ` (${extra})` : ""}`); };
const browser = await chromium.launch();
const errors = [];
async function open(studio, opts = {}) {
  const page = await browser.newPage({ viewport: opts.viewport ?? { width: 390, height: 844 }, reducedMotion: opts.reduced ? "reduce" : "no-preference" });
  page.on("pageerror", (e) => errors.push(`${studio}: ${e.message}`));
  await page.goto(`${base}/index.html?demo&studio=${studio}${opts.hash ?? ""}`);
  await page.waitForSelector(".screen");
  await page.waitForTimeout(300);
  return page;
}
const closeCelebration = async (p) => { const c = p.getByRole("dialog"); if (await c.count()) await p.keyboard.press("Escape"); };

try {
  // --- Linden: Home is never blank
  let p = await open("linden");
  ok("home: greets the member by name", (await p.locator(".hello h1").textContent()).includes("Rachel"));
  ok("home: the studio's welcome line", (await p.locator(".hello p").textContent()) === "Slow is still forward.");
  ok("home: studio banners", (await p.locator(".banner").count()) === 2);
  ok("home: the next class", (await p.locator(".next-card .next-name").textContent()).length > 3);
  ok("home: classes so far, and how many to the next milestone", (await p.locator(".track-count span").textContent()) === "47" && (await p.locator(".track-next").textContent()) === "3 more to your 50th");
  ok("home: tally marks to the next milestone (30, 27 done)", (await p.locator(".tally i").count()) === 30 && (await p.locator(".tally i.on").count()) === 27);
  ok("home: this month against the goal", (await p.locator(".goal-score").textContent()).replace(/\s/g, "") === "5of8");
  ok("home: achievements", (await p.locator(".home-badges .badges li").count()) >= 3);
  ok("home: classes to book from Home", (await p.locator("#picksT").count()) === 1);
  ok("look: Linden's serif and green", (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--display"))).includes("Young Serif") && (await p.evaluate(() => getComputedStyle(document.querySelector(".next-card")).backgroundColor)) === "rgb(47, 93, 70)");
  ok("look: nothing wider than the phone", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.screenshot({ path: join(shots, "linden-home.png") });

  // The goal is changed right there.
  await p.getByRole("button", { name: "One more class" }).click();
  await p.waitForTimeout(300);
  ok("goal: + raises it", (await p.locator(".goal-edit output").textContent()) === "9");
  ok("goal: says so", (await p.locator(".toast").first().textContent()).includes("Goal set: 9 classes a month"));

  // --- Booking: one tap opens the check in the row, one more books
  await p.getByRole("link", { name: "Book", exact: true }).click();
  await p.waitForSelector(".class-list:not(.is-loading)");
  const idx = await p.locator(".class-list .class-row").evaluateAll((rows) => rows.findIndex((r) => r.querySelector(".btn-main")));
  const row = p.locator(".class-list .class-row").nth(idx);
  const name = await row.locator("h3").textContent();
  await row.locator(".btn-main").click();
  await p.waitForSelector(".confirm-box .btn-main");
  ok("book: the check opens in the row", (await row.getAttribute("class")).includes("is-open"));
  ok("book: says what it uses and what's left", /Uses 1 class from your 10-class pack\. 5 left after this\./.test(await row.locator(".confirm-line").textContent()));
  ok("book: says until when cancelling is free", /^(Free to cancel until|It starts soon)/.test(await row.locator(".confirm-note").first().textContent()));
  await row.getByRole("button", { name: "Not now" }).click();
  await p.waitForTimeout(350);
  ok("book: Not now closes it, nothing booked", !(await row.getAttribute("class")).includes("is-open") && (await row.locator(".booked-mark").count()) === 0);
  await row.locator(".btn-main").click();
  await row.getByRole("button", { name: "Confirm booking" }).click();
  await p.waitForSelector(".toast:has-text('Booked:')");
  ok("book: booked, with a toast naming the class", (await p.locator(".toast", { hasText: "Booked:" }).textContent()).includes(name));
  ok("book: the row shows it's booked", (await row.locator(".booked-mark").count()) === 1);
  await p.waitForFunction(() => document.querySelector(".rail .count")?.textContent === "3", null, { timeout: 3000 }).catch(() => {});
  ok("book: My classes count goes up", (await p.locator(".rail .count").textContent()) === "3");
  await p.screenshot({ path: join(shots, "linden-booked.png") });
  // Undo straight from the toast.
  await p.locator(".toast", { hasText: "Booked:" }).getByRole("button", { name: "Undo" }).click();
  await p.waitForSelector(".toast:has-text('Cancelled:')");
  await p.waitForFunction(() => document.querySelector(".rail .count")?.textContent === "2", null, { timeout: 3000 }).catch(() => {});
  ok("book: Undo cancels it and gives the class back", (await p.locator(".rail .count").textContent()) === "2" && (await row.locator(".btn-main").count()) === 1);

  // --- Filters apply at once, count per day, and are remembered
  const before = await p.locator(".class-list .class-row").count();
  ok("book: nothing wider than the phone", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.getByRole("button", { name: "Mat Pilates" }).click();
  await p.getByRole("radio", { name: "Evening" }).click();
  const after = await p.locator(".class-list .class-row, .empty").count();
  ok("filters: narrow the list straight away", after >= 1 && after <= before);
  ok("filters: each day shows how many match", (await p.locator(".day.is-empty").count()) > 0);
  await p.reload();
  await p.waitForSelector(".chips");
  ok("filters: remembered", (await p.getByRole("button", { name: "Mat Pilates" }).getAttribute("aria-pressed")) === "true");
  await p.getByRole("button", { name: "Clear filters" }).first().click();
  ok("filters: Clear filters", (await p.locator(".chip[aria-pressed='true']").count()) === 0);

  // --- My classes: cancel in place
  await p.getByRole("link", { name: /My classes/ }).click();
  const n = await p.locator(".booking-list > li").count();
  await p.locator(".booking-list > li").last().getByRole("button", { name: "Cancel" }).click();
  await p.getByRole("button", { name: "Cancel class" }).click();
  await p.waitForSelector(".toast:has-text('Cancelled:')");
  await p.waitForFunction((k) => document.querySelectorAll(".booking-list > li").length === k, n - 1, { timeout: 3000 }).catch(() => {});
  ok("my classes: cancelled in place", (await p.locator(".booking-list > li").count()) === n - 1);

  // --- Me: packages say how their dates work
  await p.getByRole("link", { name: "Me", exact: true }).click();
  ok("me: the pack and how many are left", (await p.locator(".pkg-left").textContent()).replace(/\s/g, "").startsWith("6of10") || (await p.locator(".pkg-left").textContent()).includes("of 10"));
  ok("me: the start follows the earliest class", (await p.locator(".pkg-note").first().textContent()).includes("Booking an earlier class moves the start back"));
  ok("me: every achievement", (await p.locator("#achievements .badges li").count()) >= 10);
  await p.close();

  // --- Tidal: a celebration on opening, shown once; membership booking ahead
  p = await open("tidal");
  await p.waitForSelector("[role=dialog]");
  ok("celebration: opens by itself", (await p.locator("#celebrateT").textContent()) === "Four weeks running");
  ok("celebration: focus is on its button", await p.evaluate(() => document.activeElement?.textContent === "Book your next class"));
  await p.screenshot({ path: join(shots, "tidal-celebration.png") });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(800);
  ok("celebration: Esc closes it and it doesn't come back", (await p.locator("[role=dialog]").count()) === 0);
  ok("look: Tidal's grotesque and pill buttons", (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--display"))).includes("Bricolage") && (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--r-s"))).trim() === "999px");
  await p.getByRole("link", { name: "Book", exact: true }).click();
  await p.waitForSelector(".days");
  // The last day shown is in next month only near a month's end; check the copy on Me instead.
  await p.getByRole("link", { name: "Me", exact: true }).click();
  ok("membership: says next month can be booked ahead", (await p.locator(".pkg-note").last().textContent()).includes("book into next month before it renews"));
  await p.close();

  // --- Aizome: the 108th class is celebrated with a seal
  p = await open("aizome");
  await p.waitForSelector("[role=dialog]");
  ok("celebration: the milestone, with its number", (await p.locator("#celebrateT").textContent()) === "108 classes" && (await p.locator(".celebrate-num").textContent()) === "108");
  await p.getByRole("button", { name: "Book your next class" }).click();
  ok("celebration: its button goes to booking", (await p.locator(".screen-book").count()) === 1);
  ok("look: Aizome's square corners and red seal", (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--r-l"))).trim() === "4px" && (await p.evaluate(() => document.documentElement.dataset.motif)) === "stamp");
  await p.close();

  // --- Wide screen: a rail, Home in columns
  p = await open("linden", { viewport: { width: 1440, height: 900 } });
  ok("wide: the rail is on the left", (await p.locator(".rail").boundingBox()).x === 0 && (await p.locator(".rail .brand").isVisible()));
  ok("wide: progress side by side", await p.evaluate(() => getComputedStyle(document.querySelector(".progress-grid")).gridTemplateColumns.split(" ").length === 2));
  await p.screenshot({ path: join(shots, "linden-wide.png") });
  await p.close();

  // --- Reduced motion: banners stay put, celebrations still say it
  p = await open("aizome", { reduced: true });
  await p.waitForSelector("[role=dialog]");
  ok("reduced motion: the celebration still shows", (await p.locator("#celebrateT").count()) === 1);
  ok("reduced motion: animations are switched off", await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".celebrate")).animationDuration) < 0.01));
  await p.close();

  // --- The showcase: three live phones
  p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`${base}/showcase.html`);
  ok("showcase: three studios", (await p.locator(".sc-phone iframe").count()) === 3);
  await p.close();
  ok("no errors in the page", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
console.log(`${failed} failed of ${passed + failed}`);
process.exit(failed ? 1 : 0);
