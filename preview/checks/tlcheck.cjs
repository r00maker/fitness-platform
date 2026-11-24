// The free trial: the bar (days left, what is not included), payments locked, Start my plan,
// the test studio, and read-only once it ends.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "tl");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "tl-test.html"), src);
const file = "file://" + path.join(__dirname, "tl-test.html");

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
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(200); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const phoneVar = (v) => p.evaluate((x) => getComputedStyle(document.querySelector(".alp")).getPropertyValue(x).trim(), v);
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    const pick = async (v) => { await p.selectOption("#trialDemo", v); await p.waitForTimeout(200); };
    await go("home");
    ok(`${label}: no trial, no bar`, (await p.locator(".trialbar").count()) === 0);
    await pick("new");
    ok(`${label}: the bar says how long is left, and what's not included`, /12 days left in your free trial of Signature/.test(await p.locator(".trialbar").textContent()) && /Payments and WhatsApp switch on/.test(await p.locator(".trialbar").textContent()));
    await go("payments");
    ok(`${label}: payments locked during the trial`, (await p.locator(".trial-locked").count()) === 1 && await p.locator("#payConnect").isDisabled());
    await press("#trialStart");
    ok(`${label}: Start my plan asks which plan`, (await p.locator(".trialask [data-trplan]").count()) === 3);
    await press('[data-trplan="growth"]');
    ok(`${label}: Growth offers the branded app`, (await p.locator("#trialApp").count()) === 1);
    await press("#trialSend");
    ok(`${label}: asked, and told what happens next`, /switch payments on/.test(await p.locator(".trialbar").textContent()) && (await p.locator(".trialask").count()) === 0);
    await shot("new");
    await pick("existing");
    ok(`${label}: the test studio says it's sample data`, /sample data, so nothing you do here reaches anyone/.test(await p.locator(".trialbar").textContent()));
    await pick("ended");
    await go("booking-page");
    ok(`${label}: ended: read-only, Start my plan still there`, /has ended/.test(await p.locator(".trialbar").textContent()) && await p.locator("#bpSave").isDisabled() && !(await p.locator("#trialStart").isDisabled()));
    ok(`${label}: nothing wider than the screen`, await noHScroll());
    await shot("ended");
    await pick("");
    ok(`${label}: back to no trial`, (await p.locator(".trialbar").count()) === 0);
    ok(`${label}: no errors`, errors.length === 0);
    if (errors.length) console.log(errors);
    await p.close();
  }
  await browser.close();
  for (const [s, n] of results) console.log(s, n);
  console.log(`${results.filter((r) => r[0] === "FAIL").length} failed of ${results.length}`);
})();

