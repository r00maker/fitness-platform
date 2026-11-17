// Screenshots and basic checks of the built site: desktop and phone, no page errors, no sideways scroll,
// and the interactive parts respond. Usage: node check.mjs (after node build.mjs)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "shots"); mkdirSync(out, { recursive: true });
const results = []; const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n + (x ? `  (${x})` : "")]);
const b = await chromium.launch();
for (const [label, opts] of [["desk", { viewport: { width: 1440, height: 900 } }], ["phone", { ...devices["iPhone 13"] }]]) {
  const p = await b.newPage(opts);
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("file://" + path.join(here, "dist/index.html"));
  await p.waitForTimeout(2600);
  ok(`${label}: no sideways scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  ok(`${label}: timetable filled`, (await p.locator("#tt .cls").count()) === 17);
  await p.screenshot({ path: path.join(out, `${label}-hero.png`) });
  await p.locator("#tt .cls").nth(1).click();
  await p.locator(".pop .abtn.go").click();
  ok(`${label}: book from the timetable`, /booked|waitlist/.test(await p.locator(".pop").innerText()));
  await p.keyboard.press("Escape");
  for (let i = 0; i < 4; i++) await p.locator(".att-item:not(.done) .abtn").first().click().then(() => p.waitForTimeout(500));
  ok(`${label}: to-do list clears`, await p.locator("#attEmpty").isVisible());
  await p.locator('[data-chk="double"]').click();
  ok(`${label}: warnings switch`, /double-booked/i.test(await p.locator("#chk").innerText()));
  await p.locator('[data-local="pay"]').click();
  ok(`${label}: checkout tab`, /PayNow/.test(await p.locator("#localPanel").innerText()));
  await p.locator("#markAll").click(); await p.waitForTimeout(700);
  ok(`${label}: mark everyone present`, (await p.locator(".rp.here").count()) === 6);
  await p.locator('[data-loc="3"]').click();
  ok(`${label}: plan recommended`, /Growth/.test(await p.locator(".plan.fit").innerText()));
  await p.locator('[data-bill="year"]').click();
  ok(`${label}: yearly prices`, /USD 2,990/.test(await p.locator("#plans").innerText()));
  await p.locator('#join button[type="submit"]').click();
  ok(`${label}: form says what's missing`, /Add your name/.test(await p.locator("#joinNote").innerText()));
  await p.screenshot({ path: path.join(out, `${label}-full.png`), fullPage: true });
  ok(`${label}: no page errors`, !errors.length, errors.join(" | "));
  await p.close();
}
await b.close();
for (const [r, n] of results) console.log(r, n);
const failed = results.filter(([r]) => r === "FAIL").length;
console.log(failed, "failed of", results.length);
process.exit(failed ? 1 : 0);
