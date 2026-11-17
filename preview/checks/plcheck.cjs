// Plans: Essentials, Growth and Signature. The plan card on Setup, Features, the preview's plan
// control (our staff's switch in the real app), asking first before a change switches things off,
// features locked with the plan that includes them, banners and AI workflows by plan, the
// getting-started list on Home, and Studio rules search with "Changed from the usual" marks.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "pl");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "pl-test.html"), src);
const file = "file://" + path.join(__dirname, "pl-test.html");

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
    const plan = async (v) => { await p.selectOption("#planDemo", v); await p.waitForTimeout(150); };

    // Signature (the sample studio)
    await role("client");
    ok(`${label}: clients see banners on Signature`, (await p.locator(".bcar, .bnrs").count()) > 0);
    await role("admin");
    ok(`${label}: header shows the plan control, set to Signature`, (await p.locator("#planDemo").inputValue()) === "signature");
    ok(`${label}: header no h-scroll`, await noHScroll());
    await go("features");
    const card = await text(".plancard");
    ok(`${label}: plan card: Signature, SGD 799 a month`, /Your plan\s*Signature/.test(card) && /SGD 799\s*a month/.test(card));
    ok(`${label}: plan card: locations, app and AI`, /2 of 5 included, then SGD 199 each/.test(card) && /Your own app\s*Included/.test(card) && /AI workflows\s*Included/.test(card));
    ok(`${label}: three plans, Signature current`, (await p.locator(".planopt").count()) === 3 && /Signature\s*Current/.test(await text(".planopt.cur")));
    ok(`${label}: same service on every plan`, /Every plan: we set you up and move your data for you, the same support, and no cut of your sales\./.test(card));
    await press("#planTalk");
    ok(`${label}: Talk to us answers`, /We'll message you within one working day/.test(await toast()));
    ok(`${label}: nothing locked on Signature`, (await p.locator(".featrow input[disabled]").count()) === 0);
    ok(`${label}: features page no h-scroll`, await noHScroll());
    await shot("signature");

    // To Essentials: asks first, Go back changes nothing
    await plan("essentials");
    const msg = await text(".warnmodal");
    ok(`${label}: moving down asks first`, (await text("#chkTitle")) === "Change this studio’s plan?" || (await text("#chkTitle")) === "Change this studio's plan?");
    ok(`${label}: says what switches off`, /Switches off Marketing emails and journeys, Loyalty points and rewards, Refer a friend, Leads, Shop, Communication inbox and AI workflows \(nothing is deleted\)\./.test(msg));
    ok(`${label}: says what's over the limits`, /It has 2 locations and Essentials includes 1: they keep working, but no more can be added\./.test(msg) && /It has 2 admin accounts and Essentials includes 1/.test(msg));
    await shot("confirm", false);
    await press("#mBack");
    ok(`${label}: Go back keeps Signature`, (await ev("STUDIO.plan")) === "signature" && (await p.locator("#planDemo").inputValue()) === "signature");
    await plan("essentials"); await press("#mProceed");
    ok(`${label}: now on Essentials (${await toast()})`, (await ev("STUDIO.plan")) === "essentials" && /Now on Essentials: SGD 129 a month\./.test(await toast()));
    const m = await nav();
    ok(`${label}: Essentials menu is 12 items without Marketing or Agents (${m.length})`, m.length === 12 && !m.includes("Marketing") && !m.includes("Agents") && m.includes("Tell clients") && !m.includes("Automations") && m.includes("Staff and pay"));
    await go("features");
    const card2 = await text(".plancard");
    ok(`${label}: plan card: SGD 129, over-limit notes`, /SGD 129\s*a month/.test(card2) && (await p.locator(".planover").count()) === 2);
    ok(`${label}: locked features say which plan`, /In Growth/.test(await text('.featrow:has(#ft-marketing)')) && /In Signature/.test(await text('.featrow:has(#ft-agents)')) && /In Signature/.test(await text('.featrow:has(#ft-leads)')));
    ok(`${label}: locked switches can't be used`, (await p.locator("#ft-marketing").isDisabled()) && (await p.locator("#ft-agents").isDisabled()));
    ok(`${label}: payroll, reviews and gift cards stay on`, (await ev(`featOn("payroll") && featOn("reviews") && featOn("giftCards")`)) === true);
    ok(`${label}: count line (${(await text(".featsum")).trim()})`, /3 of 10/.test(await text(".featsum")) && /12 items/.test(await text(".featsum")));
    await shot("essentials");
    await go("announcements");
    ok(`${label}: no AI writer on Essentials`, (await p.locator(".card.writer").count()) === 0);
    await go("policies");
    ok(`${label}: AI recaps locked to Signature`, (await p.locator("#pAiRecaps").isDisabled()) && /In Signature/.test(await text('.rule[data-key="aiRecaps"]')));
    ok(`${label}: rules compare with the usual for an independent studio`, /Usual for independent studio · \d+ settings? changed/.test(await text(".rulesearch")));
    await role("client");
    ok(`${label}: clients see no banners on Essentials`, (await p.locator(".bcar, .bnrs").count()) === 0);
    const cm = await nav();
    ok(`${label}: client menu has Shop (gift cards) but no Rewards or Refer a friend`, cm.includes("Shop") && !cm.includes("Rewards") && !cm.includes("Refer a friend"));
    await role("admin");

    // To Growth with the app: nothing switches off, so no question
    await plan("growth+app");
    ok(`${label}: moving up doesn't ask (${await toast()})`, (await p.locator(".warnmodal").count()) === 0 && /Now on Growth, with its own app: SGD 528 a month\./.test(await toast()));
    await go("features");
    const parts = await p.evaluate(() => [...document.querySelectorAll(".planparts li")].map((li) => [...li.children].map((c) => c.textContent.trim()).join(" ")));
    ok(`${label}: Growth price parts (${parts.join(" / ")})`, JSON.stringify(parts) === JSON.stringify(["Growth (3 locations included) SGD 399", "Your own app SGD 129"]));
    ok(`${label}: Growth switches marketing tools on`, (await ev(`featOn("marketing") && featOn("shop") && featOn("inbox") && featOn("loyalty")`)) === true);
    ok(`${label}: AI workflows still locked`, (await p.locator("#ft-agents").isDisabled()) && /In Signature/.test(await text('.featrow:has(#ft-agents)')));
    ok(`${label}: Growth menu has Marketing and Communication`, (await nav()).includes("Marketing") && (await nav()).includes("Communication"));
    ok(`${label}: journeys paused by Essentials stay paused`, (await ev(`JOURNEYS.filter((j) => j.status === "live").length`)) === 0);

    // Back to Signature
    await plan("signature");
    ok(`${label}: back on Signature: 14 items`, (await nav()).length === 14 && (await ev(`featOn("agents") && featOn("leads")`)) === true);
    await go("announcements");
    ok(`${label}: AI writer back on Signature`, (await p.locator(".card.writer").count()) === 1);

    // Studio rules: changed from the usual, and search
    await go("policies");
    ok(`${label}: Signature uses the several-locations rules, nothing changed`, /Usual for several locations · nothing changed/.test(await text(".rulesearch")));
    await ev(`STUDIO.lateCancelHours = 24; render()`);
    ok(`${label}: a changed setting is marked`, (await p.locator('.rule[data-key="lateCancelWindowHours"] .chg').count()) === 1);
    await press('[data-usual="lateCancelWindowHours"]');
    ok(`${label}: one tap goes back to the usual`, (await ev("STUDIO.lateCancelHours")) === 12 && (await p.locator(".chg").count()) === 0 && /back to the usual \(12 hours before class\)/.test(await toast()));
    await p.locator("#rlSearch").fill("waitlist");
    await p.waitForTimeout(100);
    const visibleCards = await p.evaluate(() => [...document.querySelectorAll("#polForm .card")].filter((c) => c.style.display !== "none").map((c) => c.querySelector("h3").textContent));
    ok(`${label}: search narrows (${visibleCards.join(", ")})`, visibleCards.includes("Waitlist") && !visibleCards.includes("Payroll"));
    await p.locator("#rlSearch").fill("zzzz");
    await p.waitForTimeout(100);
    ok(`${label}: no match says so`, await p.locator("#rlNone").isVisible());
    await p.locator("#rlSearch").fill("");
    await p.waitForTimeout(100);

    // Home: getting started until the basics are in
    await go("home");
    ok(`${label}: no getting-started list when everything's done`, (await p.locator(".welcome").count()) === 0);
    await ev(`STUDIO.setupDone = false; render()`);
    ok(`${label}: getting-started list while something's left`, /Getting started: 5 of 6 done/.test(await text(".welcome")) && /set your studio up on Signature/.test(await text(".welcome")));
    ok(`${label}: Home no h-scroll`, await noHScroll());
    await shot("started", false);
    await role("foh");
    ok(`${label}: Front of House don't see it`, (await p.locator(".welcome").count()) === 0);
    await role("admin");
    await press("#wlHide");
    ok(`${label}: it can be hidden`, (await p.locator(".welcome").count()) === 0);

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
