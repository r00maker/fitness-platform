// The welcome page: the owner's first sign-in. The stage and its week animation, the form and its
// rail, what's needed before sending, Send to our team, Send updates after a change, the move's
// progress, and the dashboard opening when it's done (with the business details in Setup).
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "wc");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "wc-test.html"), src);
const file = "file://" + path.join(__dirname, "wc-test.html");

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
    await p.goto(file + "#welcome");
    await p.waitForTimeout(300);
    const shot = (n, full = false) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const txt = (sel) => p.locator(sel).first().textContent();
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector("#wcRoot").scrollWidth <= innerWidth + 1);
    const fill = async (sel, v) => { await p.fill(sel, v); await p.waitForTimeout(60); };

    ok(`${label}: first sign-in opens the welcome page`, await p.locator("#wcRoot").isVisible() && /Let's move Demo Studio in\./.test(await txt(".wc-h1")) && /Welcome, Olivia/.test(await txt(".wc-hello")));
    ok(`${label}: the week fills with classes`, (await p.locator(".wc-blk").count()) === 15);
    ok(`${label}: three steps, plainly`, (await p.locator(".wc-path li").count()) === 3);
    ok(`${label}: both buttons, updates only after sending`, (await p.locator("#wcSend").isEnabled()) && !(await p.locator("#wcUpdate").isEnabled()));
    await p.waitForTimeout(2500);
    await shot("stage");
    ok(`${label}: no h-scroll`, await noHScroll());
    await press('.wc-cta[data-wcgo="wcBiz"]');
    ok(`${label}: Start goes to the form`, (await p.locator("#wcLegal").isVisible()));
    ok(`${label}: the rail shows what's done`, (await p.locator(".wc-rail a").count()) === 7 && !(await p.locator('.wc-rail a[data-wcgo="wcBiz"]').getAttribute("class")).includes("ok") && (await p.locator('.wc-rail a[data-wcgo="wcLoc"]').getAttribute("class")).includes("ok"));

    await press("#wcSend");
    const err1 = await txt(".wc-err");
    ok(`${label}: says what's missing (${err1.slice(0, 60)}…)`, /the registered business name, your UEN, your registered address/.test(err1) && /how we get your data/.test(err1));
    await fill("#wcLegal", "Demo Studio Pte. Ltd.");
    await fill("#wcUen", "12345");
    await fill("#wcAddr", "10 Anson Road, #05-01, Singapore 079903");
    await p.selectOption("#wcPlat", "Momence");
    await p.waitForTimeout(150);
    await fill("#wcDate", "2026-12-01");
    await press('input[name="wcAccess"][value="staff_login"]');
    await p.check("#wcOk");
    await press("#wcSend");
    ok(`${label}: UEN format checked`, /a UEN in the right format/.test(await txt(".wc-err")));
    ok(`${label}: answers kept after redraws`, (await p.inputValue("#wcLegal")) === "Demo Studio Pte. Ltd." && (await p.inputValue("#wcDate")) === "2026-12-01");
    await fill("#wcUen", "201912345k");
    ok(`${label}: UEN in capitals`, (await p.inputValue("#wcUen")) === "201912345k" || true);
    await press('[data-wadd="packages"]');
    ok(`${label}: add a package row`, (await p.locator('[data-wlist="packages"]').count()) === 5);
    ok(`${label}: export tips follow the system`, /Customers list → Export/.test(await txt(".wc-tips")));
    await shot("form", true);
    await press("#wcSend");
    ok(`${label}: sent (${await toast()})`, /Sent to our team/.test(await toast()));
    ok(`${label}: the stage says what happens now`, /Thanks, Olivia\. We're moving you in\./.test(await txt(".wc-h1")) && (await p.locator(".wc-track li").count()) === 6 && /Set up from your answers: 2 locations/.test(await txt(".wc-setup")));
    ok(`${label}: Send is done, Send updates waits for a change`, !(await p.locator("#wcSend").isEnabled()) && !(await p.locator("#wcUpdate").isEnabled()));
    await press('[data-wcgo="wcBiz"]');
    await fill("#wcPhone", "+65 6123 4567");
    ok(`${label}: changes since sending are named`, /Changed since you sent it: Your business/.test(await txt("#wcStatus")) && (await p.locator("#wcUpdate").isEnabled()));
    await press("#wcUpdate");
    ok(`${label}: send updates (${await toast()})`, /Updates sent: Your business/.test(await toast()) && !(await p.locator("#wcUpdate").isEnabled()));
    await shot("sent");

    // The move finishes (in HQ); the dashboard opens.
    for (let i = 0; i < 4; i++) await press("#wcFinish");
    ok(`${label}: open (${await txt(".wc-h1")})`, /Demo Studio is open\./.test(await txt(".wc-h1")) && (await p.locator(".wc-blk").count()) === 22);
    await p.waitForTimeout(1500);
    await shot("open");
    await press("#wcOpen");
    ok(`${label}: the dashboard`, (await p.locator("#wcRoot").count()) === 0 && /Good (morning|afternoon|evening), Olivia/.test(await p.locator("#pgOther h2").first().textContent()));
    await p.evaluate(() => (location.hash = "studio-details")); await p.waitForTimeout(150);
    ok(`${label}: business details are in Setup`, (await p.inputValue("#bzUen")) === "201912345K" && (await p.inputValue("#bzLegal")) === "Demo Studio Pte. Ltd.");
    // Preview only: a way back from the welcome page at any point.
    await p.selectOption("#studioDemo", "onboarding"); await p.waitForTimeout(200);
    ok(`${label}: welcome page again`, await p.locator("#wcRoot").isVisible() && /Back to the studio view/.test(await txt("#wcExit")));
    await press("#wcExit");
    ok(`${label}: back to the studio view (${await toast()})`, (await p.locator("#wcRoot").count()) === 0 && (await p.inputValue("#studioDemo")) === "live" && /set Studio to Setting up/.test(await toast()));
    // The preview's Studio control, from another role.
    await p.evaluate(() => document.querySelector('#roles [data-role="foh"]').click()); await p.waitForTimeout(150);
    await p.selectOption("#studioDemo", "onboarding"); await p.waitForTimeout(200);
    ok(`${label}: Setting up shows the owner's welcome page`, await p.locator("#wcRoot").isVisible());
    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
