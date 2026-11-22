// Setup, App look: start from a look, change colours (with the contrast warning and its fix),
// typefaces, corners, the celebration, the welcome line and milestones, all shown live on the
// phone; save, undo; and the locked state without the branded app.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "al");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "al-test.html"), src);
const file = "file://" + path.join(__dirname, "al-test.html");

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

    await go("app-look");
    ok(`${label}: App look opens under Setup`, (await p.locator(".pagehead h2", { hasText: "App look" }).count()) === 1);
    ok(`${label}: four looks to start from`, (await p.locator("[data-alpreset]").count()) === 4);
    ok(`${label}: the phone shows the app`, (await p.locator(".alp .alp-hello").count()) === 1 && (await p.locator(".alp-bar").count()) === 1);
    ok(`${label}: nothing to save yet`, await p.locator("#alSave").isDisabled());

    await press('[data-alpreset="linden"]');
    ok(`${label}: picking Linden changes the phone`, (await phoneVar("--a-ac")).toUpperCase() === "#2F5D46" && (await phoneVar("--a-disp")).includes("Young Serif"));
    ok(`${label}: and its welcome line`, (await p.locator(".alp-wel").textContent()) === "Slow is still forward.");
    ok(`${label}: there's something to save`, !(await p.locator("#alSave").isDisabled()));

    // A brand colour too light for white text: warned, with a one-tap fix.
    await ev(`(() => { const i = document.querySelector('[data-alhex="accent"]'); i.value = "#E8E36A"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await p.waitForTimeout(150);
    ok(`${label}: warns when text on the brand colour is hard to read`, (await p.locator(".alwarn").count()) >= 1);
    await press("#alFixOn");
    ok(`${label}: the fix uses dark text`, (await phoneVar("--a-on")).toUpperCase() === "#111111" && (await p.locator(".alwarn", { hasText: "brand colour" }).count()) === 0);
    await ev(`(() => { const i = document.querySelector('[data-alhex="accent"]'); i.value = "#1F4F3A"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await p.waitForTimeout(150);
    await ev(`(() => { const i = document.querySelector('[data-alhex="onAccent"]'); i.value = "#FFFFFF"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await p.waitForTimeout(150);
    ok(`${label}: a hex code updates the phone`, (await phoneVar("--a-ac")).toUpperCase() === "#1F4F3A");

    await p.selectOption("#al-displayFont", "Shippori Mincho");
    await p.waitForTimeout(150);
    ok(`${label}: typeface changes the phone`, (await phoneVar("--a-disp")).includes("Shippori Mincho"));
    await press('[data-alcorner="square"]');
    ok(`${label}: corners change the phone`, (await phoneVar("--a-rl")) === "4px");
    await press('[data-almotif="stamp"]');
    ok(`${label}: picking a celebration shows it`, (await p.locator(".alp-cel").count()) === 1 && (await p.locator(".alp").getAttribute("data-motif")) === "stamp");
    await press('[data-alview="book"]');
    ok(`${label}: the timetable on the phone`, (await p.locator(".alp-list li").count()) >= 1);
    await press('[data-alview="home"]');

    await p.fill("#alWelcome", "Breathe out. You're here.");
    ok(`${label}: welcome line, live`, (await p.locator(".alp-wel").textContent()) === "Breathe out. You're here.");
    await p.fill("#alMilAdd", "75");
    await press("#alMilBtn");
    ok(`${label}: a milestone added, in order`, (await p.locator(".almil button").allTextContents()).map((t) => parseInt(t)).join(",") === "10,20,50,75,100,150,200,300,500");
    await p.fill("#alMilAdd", "75");
    await press("#alMilBtn");
    ok(`${label}: no duplicates, and says so`, (await p.locator("#alMilErr").textContent()) === "75 is already there.");
    await press('[data-almil="10"]');
    ok(`${label}: a milestone removed`, (await p.locator(".almil button").count()) === 8);
    ok(`${label}: the bar runs to the next milestone (50)`, /3 to your 50th/.test(await p.locator(".alp-ms span").first().textContent()));
    ok(`${label}: nothing wider than the screen`, await noHScroll());
    await shot("edited");

    await press("#alSave");
    ok(`${label}: saved`, (await ev("STUDIO.appLook.saved.preset")) === "linden" && (await ev("STUDIO.appLook.saved.welcome")) === "Breathe out. You're here." && (await p.locator("#alSave").isDisabled()));
    await press('[data-alcorner="round"]');
    await press("#alReset");
    ok(`${label}: Undo changes goes back to the saved look`, (await phoneVar("--a-rl")) === "4px");

    // Without the branded app (Growth, no add-on): locked, and the phone shows the plain look.
    await ev(`(STUDIO.plan = "growth", STUDIO.brandedApp = false, state.alv.draft = null, render())`);
    await p.waitForTimeout(200);
    ok(`${label}: locked without the branded app`, (await p.locator(".al-lock").count()) === 1 && (await p.locator("[data-alpreset]").first().isDisabled()));
    ok(`${label}: says how to get it on Growth`, /Add the branded app to Growth for SGD 99 a month/.test(await p.locator(".al-lock").textContent()));
    ok(`${label}: members see the plain look meanwhile`, (await phoneVar("--a-disp")).includes("Manrope"));
    await shot("locked");
    await ev(`(STUDIO.plan = "growth", STUDIO.brandedApp = true, state.alv.draft = null, render())`);
    await p.waitForTimeout(200);
    ok(`${label}: with the add-on, the saved look is back`, (await phoneVar("--a-disp")).includes("Shippori Mincho"));
    await ev(`(STUDIO.plan = "signature", STUDIO.brandedApp = false, STUDIO.appLook.saved = null, state.alv.draft = null, render())`);
    ok(`${label}: no errors`, errors.length === 0);
    if (errors.length) console.log(errors);
    await p.close();
  }
  await browser.close();
  for (const [s, n] of results) console.log(s, n);
  console.log(`${results.filter((r) => r[0] === "FAIL").length} failed of ${results.length}`);
})();
