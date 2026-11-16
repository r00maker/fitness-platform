// One place for each job: Tell clients (notice, banner, push, email from one message), Automations
// (client journeys and team reminders in one list), and Write with AI next to text boxes.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "tc");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "tc-test.html"), src);
const file = "file://" + path.join(__dirname, "tc-test.html");

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
    const go = async (id) => { await p.evaluate((x) => { if (location.hash === "#" + x) location.hash = "home"; }, id); await p.waitForTimeout(60); await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const txt = (sel) => p.locator(sel).first().textContent();
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    const nav = () => p.evaluate(() => [...document.querySelectorAll("#side .navitem span:not(.count)")].map((x) => x.textContent));

    // Menu: Tell clients and Automations replace Announcements and Agents.
    const items = await nav();
    ok(`${label}: menu has Automations, not Agents or Announcements`, items.includes("Automations") && !items.includes("Agents") && !items.includes("Announcements"));

    // --- Tell clients ---
    await go("tell");
    ok(`${label}: Tell clients is a tab of Communication`, /Tell clients/.test(await txt("#pgOther h2")) && (await p.locator('[data-hubtab="tell"]').count()) === 1);
    await press("#tcSend");
    ok(`${label}: says what's missing`, /Add a short title, the message/.test(await txt("#tcErr")));
    await p.fill("#tcTitle", "Lift out of order"); await p.waitForTimeout(80);
    await p.fill("#tcMsg", "Please use the stairs on the left of the lobby."); await p.waitForTimeout(80);
    ok(`${label}: typing keeps focus`, (await p.evaluate(() => document.activeElement?.id)) === "tcMsg");
    ok(`${label}: preview shows the notice and the push`, /Lift out of order/.test(await txt(".tcprev .annbar")) && /Lift out of order/.test(await txt(".tcpush")));
    ok(`${label}: reach on each place`, /a notice in the app for 20 people, a push notification to 20 people/.test(await p.locator("#tcSend").locator("..").textContent()));
    await p.selectOption("#tcWho", "booked_at_location"); await p.waitForTimeout(150);
    ok(`${label}: banner off for a location audience`, await p.locator("#tc_banner").isDisabled());
    await press("#tcSend");
    ok(`${label}: asks first, with the numbers`, /Send “Lift out of order”: a notice in the app for \d+ (person|people), a push notification to \d+/.test(await txt(".warnmodal")));
    await press("#mProceed");
    ok(`${label}: sent (${await toast()})`, /^Sent: a notice in the app/.test(await toast()));
    ok(`${label}: it's in the history`, /Lift out of order/.test(await txt(".tchist")));
    // Offers: no notices; only people who agreed.
    await press('[data-tck="offer"]');
    ok(`${label}: offers can't be notices`, await p.locator("#tc_notice").isDisabled());
    await p.selectOption("#tcWho", "everyone"); await p.waitForTimeout(120);
    await p.fill("#tcTitle", "Bring a friend free"); await p.fill("#tcMsg", "This weekend only."); await p.waitForTimeout(80);
    await press("#tc_email");
    const line = await p.locator("#tcSend").locator("..").textContent();
    ok(`${label}: offers reach fewer people (${line.trim()})`, /a push notification to (\d+) people, an email to (\d+) people/.test(line) && Number(line.match(/email to (\d+)/)[1]) < 20);
    await press("#tcSend");
    ok(`${label}: offer note`, /only people who agreed to marketing/.test(await txt(".warnmodal")));
    await press("#mProceed");
    ok(`${label}: the email shows on Campaigns`, await ev('CAMPAIGNS[0].name === "Bring a friend free"'));
    ok(`${label}: no h-scroll`, await noHScroll());
    await shot("tell");
    // Front of House: news only.
    await role("foh"); await go("tell");
    ok(`${label}: Front of House can't send offers`, await p.locator('[data-tck="offer"]').isDisabled());
    await role("admin");

    // --- Write with AI ---
    await go("tell");
    await press('[data-aiw="message"]');
    ok(`${label}: Write with AI drafts the message (${await toast()})`, (await p.inputValue("#tcMsg")).length > 20 && /Drafted with AI \(1 AI credit\)/.test(await toast()));
    await ev('STUDIO.plan = "growth"; render()');
    await go("tell");
    ok(`${label}: on Growth it's marked In Signature`, /In Signature/.test(await txt('[data-aiw="message"]')));
    await ev('STUDIO.plan = "signature"; render()');

    // --- Automations ---
    await go("automations");
    const rows = await p.locator(".aurow").count();
    ok(`${label}: journeys and team reminders in one list (${rows})`, rows >= 6 && (await p.locator(".aufor.clients").count()) >= 4 && (await p.locator(".aufor.team").count()) >= 2);
    await press('[data-auf="team"]');
    ok(`${label}: filter to the team`, (await p.locator(".aufor.clients").count()) === 0);
    await press('[data-auopen^="agent"]');
    ok(`${label}: a team reminder opens its editor`, (await ev("state.page")) === "agents");
    await go("automations");
    await press('[data-auf="clients"]');
    await press('[data-auopen^="journey"]');
    ok(`${label}: a journey opens its editor`, (await ev("state.page")) === "marketing" && !!(await ev("state.jOpen")));
    await go("automations");
    ok(`${label}: automations no h-scroll`, await noHScroll());
    await shot("automations");
    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
