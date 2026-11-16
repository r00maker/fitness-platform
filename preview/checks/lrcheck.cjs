// Reports by location (Signature): the Locations tab with every location side by side, against
// the period before; locked with "In Signature" on other plans.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "lr");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "lr-test.html"), src);
const file = "file://" + path.join(__dirname, "lr-test.html");

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name, cond) => results.push([cond ? "PASS" : "FAIL", name]);
  for (const [label, opts] of [
    ["desk", { viewport: { width: 1360, height: 900 }, colorScheme: "light" }],
    ["desk-dark", { viewport: { width: 1360, height: 900 }, colorScheme: "dark" }],
    ["phone", { ...devices["iPhone 13"], colorScheme: "light" }],
  ]) {
    const p = await browser.newPage(opts);
    await p.addInitScript(() => { window.__quiet = true; });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(file);
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    await go("reports");
    ok(`${label}: Locations tab is there`, (await p.locator('[data-rtab="locations"]').count()) === 1);
    await press('[data-rtab="locations"]');
    const heads = await p.locator("#locReport thead th").allTextContents();
    ok(`${label}: both locations side by side (${heads.join(",")})`, heads.includes("Tanjong Pagar") && heads.includes("Holland Village"));
    const rowsTxt = await p.locator("#locReport tbody th").allTextContents();
    ok(`${label}: the numbers (${rowsTxt.join(",")})`, ["Classes held", "How full", "Visits", "No-shows", "Classes cancelled"].every((x) => rowsTxt.includes(x)));
    ok(`${label}: compared with before`, (await p.locator("#locReport .rchg").count()) >= 10);
    ok(`${label}: headline names the fullest`, /is the fullest \([\d.]+%\); .* has the most room/.test(await p.locator(".rsum").first().textContent()));
    ok(`${label}: no export on this tab`, (await p.locator("#rExport").count()) === 0);
    await press('[data-rdays="90"]');
    ok(`${label}: period switch keeps the tab`, (await p.locator("#locReport").count()) === 1);
    ok(`${label}: no h-scroll`, await noHScroll());
    await shot("locations");
    await press('[data-rtab="overview"]');
    ok(`${label}: back to Overview`, (await p.locator("#locReport").count()) === 0 && (await p.locator("#rExport").count()) === 1);

    await ev('STUDIO.plan = "growth"; render()');
    ok(`${label}: Growth: tab marked In Signature`, /In Signature/.test(await p.locator('[data-rtab="locations"]').textContent()));
    await press('[data-rtab="locations"]');
    ok(`${label}: Growth: locked card`, /Reports by location come with Signature/.test(await p.locator("#locLocked").textContent()) && (await p.locator("#locReport").count()) === 0);
    await shot("locked", false);
    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
