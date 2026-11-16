// Setup by studio type: the first-run welcome on Home, "Your kind of studio" on Setup, Features
// (asking first with exactly what changes), and Studio rules search with "Changed from the usual"
// marks and a one-tap way back.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "st");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "st-test.html"), src);
const file = "file://" + path.join(__dirname, "st-test.html");

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
    await p.addInitScript(() => { window.__quiet = true; }); // no celebration or review pop-ups over the page
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message + " @@ " + (e.stack || "").split("\n").slice(1, 3).join(" / ")));
    await p.goto(file);
    const phone = label === "phone";
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const nav = () => p.evaluate(() => [...document.querySelectorAll("#side .navitem span:not(.count)")].map((x) => x.textContent));
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const text = (sel) => p.locator(sel).first().textContent();

    // Setup, Features: your kind of studio
    await go("features");
    ok(`${label}: "Your kind of studio" with three choices`, (await p.locator(".stype").count()) === 3 && /Your kind of studio/.test(await text("#pgOther")));
    ok(`${label}: the sample studio is "Several locations", marked current and matching`, /Several locations\s*Current/.test(await text('[data-stype="multi"]')) && /Matches your settings/.test(await text('[data-stype="multi"]')));
    ok(`${label}: nothing to apply for the current type`, await p.locator("#stUse").isDisabled());
    ok(`${label}: features page no h-scroll`, await noHScroll());
    await shot("features");

    await press('[data-stype="independent"]');
    const det = await text("#stDetail");
    ok(`${label}: picking one shows what it switches on and fills in`, /Gift cards and Reviews\./.test(det) && /Booking closes: When class starts/.test(det) && /Late-cancellation window: 6 hours before class/.test(det));
    ok(`${label}: and how much would change`, /8 features and 6 rules would change/.test(det));
    const liveBefore = await ev(`JOURNEYS.filter((j) => j.status === "live").length`);
    await press("#stUse");
    const msg = await text(".warnmodal");
    ok(`${label}: asks first, listing what switches off`, /Use these settings\?/.test(await text("#chkTitle")) && /Set up as an independent studio\? Switches off Marketing emails and journeys, Loyalty points and rewards, Refer a friend, Leads, Shop, Payroll, Communication inbox and Agents \(nothing is deleted\)\./.test(msg));
    ok(`${label}: and each rule change`, /booking closes from 1 hour before to when class starts/.test(msg) && /late-cancellation window from 12 hours before class to 6 hours before class/.test(msg));
    ok(`${label}: and what stops`, new RegExp(`${liveBefore} live journeys? will be paused`).test(msg));
    await shot("confirm", false);
    await press("#mBack");
    ok(`${label}: Go back changes nothing`, (await ev("STUDIO.studioType")) === "multi" && (await ev("STUDIO.lateCancelHours")) === 12);
    await press("#stUse"); await press("#mProceed");
    ok(`${label}: applied: type, rules and features`, (await ev("STUDIO.studioType")) === "independent" && (await ev("STUDIO.lateCancelHours")) === 6 && (await ev("STUDIO.bookingClosesMins")) === 0 && (await ev(`featOn("payroll")`)) === false);
    ok(`${label}: journeys paused`, (await ev(`JOURNEYS.filter((j) => j.status === "live").length`)) === 0);
    ok(`${label}: toast sums it up (${await toast()})`, /Set up as an independent studio\. 8 features changed, 6 rules filled in\. You can change anything under Setup\./.test(await toast()));
    const m = await nav();
    ok(`${label}: menu is shorter (${m.length})`, m.length === 13 && !m.includes("Agents") && m.includes("Staff"));
    ok(`${label}: independent is now current`, /Current/.test(await text('[data-stype="independent"]')));

    // Studio rules: changed from the usual, and search
    await go("policies");
    ok(`${label}: rules say nothing changed from the usual`, /Usual for independent studio · nothing changed/.test(await text(".rulesearch")) && (await p.locator(".chg").count()) === 0);
    await ev(`STUDIO.lateCancelHours = 24; render()`);
    ok(`${label}: a changed setting is marked`, (await p.locator('.rule[data-key="lateCancelWindowHours"] .chg').count()) === 1 && /1 setting changed/.test(await text(".rulesearch")));
    ok(`${label}: with the usual value offered`, (await text('[data-usual="lateCancelWindowHours"]')) === "Use the usual: 6 hours before class");
    await shot("rules-changed", false);
    await press('[data-usual="lateCancelWindowHours"]');
    ok(`${label}: one tap goes back to the usual`, (await ev("STUDIO.lateCancelHours")) === 6 && (await p.locator("#pLate").inputValue()) === "6" && (await p.locator(".chg").count()) === 0);
    ok(`${label}: toast says so`, /Late-cancellation window: back to the usual \(6 hours before class\)\./.test(await toast()));
    await p.locator("#rlSearch").fill("waitlist");
    await p.waitForTimeout(100);
    const visibleCards = await p.evaluate(() => [...document.querySelectorAll("#polForm .card")].filter((c) => c.style.display !== "none").map((c) => c.querySelector("h3").textContent));
    ok(`${label}: search narrows to matching settings (${visibleCards.join(", ")})`, visibleCards.includes("Waitlist") && !visibleCards.includes("Payroll"));
    ok(`${label}: search no h-scroll`, await noHScroll());
    await shot("search", false);
    await p.locator("#rlSearch").fill("zzzz");
    await p.waitForTimeout(100);
    ok(`${label}: no match says so`, await p.locator("#rlNone").isVisible());
    await p.locator("#rlSearch").fill("");
    await p.waitForTimeout(100);
    ok(`${label}: clearing shows everything`, (await p.evaluate(() => [...document.querySelectorAll("#polForm .card")].every((c) => c.style.display !== "none"))) && !(await p.locator("#rlNone").isVisible()));

    // Home: the first-run welcome (owners and admins only)
    await ev(`STUDIO.setupDone = false`);
    await go("home");
    ok(`${label}: Home welcomes a studio that hasn't chosen yet`, (await p.locator(".welcome").count()) === 1 && /Welcome! What kind of studio do you run\?/.test(await text(".welcome")));
    ok(`${label}: with a getting-started list`, /Getting started: 5 of 6 done/.test(await text(".wlcheck summary")));
    ok(`${label}: Home with welcome no h-scroll`, await noHScroll());
    await shot("welcome", !phone);
    await role("foh");
    ok(`${label}: Front of House don't see it`, (await p.locator(".welcome").count()) === 0);
    await role("instructor");
    ok(`${label}: instructors don't see it`, (await p.locator(".welcome").count()) === 0);
    await role("admin");
    await go("home");
    await press('.welcome [data-stype="boutique"]');
    await press(".welcome #stUse");
    ok(`${label}: choosing from Home asks first (the studio has classes)`, /Set up as a boutique studio\?/.test(await text(".warnmodal")));
    await press("#mProceed");
    ok(`${label}: welcome goes once chosen`, (await p.locator(".welcome").count()) === 0 && (await ev("STUDIO.studioType")) === "boutique" && (await ev("STUDIO.setupDone")) === true);
    ok(`${label}: boutique switched its features on`, (await ev(`featOn("payroll") && featOn("shop") && !featOn("agents")`)) === true);

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
