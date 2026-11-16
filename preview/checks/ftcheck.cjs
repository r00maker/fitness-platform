// Feature switches (Setup, Features) and the grouped menu: related pages share one menu item with
// tabs, old page addresses still work, switching a feature off hides it everywhere (menus, tabs,
// Home, the client app), asks first when something is running, and switching back on restores it.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "ft");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "ft-test.html"), src);
const file = "file://" + path.join(__dirname, "ft-test.html");

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
    const tabs = () => p.evaluate(() => [...document.querySelectorAll(".hubtabs [data-hubtab]")].map((b) => b.dataset.hubtab));
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const flip = async (key) => { await go("features"); await press(`#ft-${key}`); };
    const proceed = () => press("#mProceed");

    // The grouped menu
    const menu = await nav();
    ok(`${label}: admin menu is 14 items (${menu.length})`, menu.length === 14);
    ok(`${label}: grouped items replace separate ones`, ["Money", "Setup", "Staff and pay", "Communication", "Feedback"].every((x) => menu.includes(x)) && !["Fees", "Sales", "Payroll", "Class types", "Announcements", "Leads", "Reviews"].some((x) => menu.includes(x)));

    // Old addresses still work and open the right tab
    await go("fees");
    ok(`${label}: #fees opens Money with the Fees tab (${(await tabs()).join(",")})`, JSON.stringify(await tabs()) === '["sales","fees","shop"]' && (await p.locator('.hubtabs [data-hubtab="fees"][aria-selected="true"]').count()) === 1);
    ok(`${label}: the menu marks Money as current`, (await p.locator('#side .navitem[aria-current="page"] span').first().textContent()) === "Money");
    ok(`${label}: tab counts show (${await p.locator(".hubtabs .n").count()})`, (await p.locator(".hubtabs .n").count()) >= 2);
    ok(`${label}: page with tabs has no h-scroll`, await noHScroll());
    await shot("money-fees", false);
    await press('.hubtabs [data-hubtab="shop"]');
    ok(`${label}: a tab opens its page`, (await ev("state.page")) === "shop" && (await p.evaluate(() => location.hash)) === "#shop");
    await go("home");
    await press('#side .navitem[data-nav="shop"]');
    ok(`${label}: the menu item goes back to the last tab used`, (await ev("state.page")) === "shop");
    ok(`${label}: Money keeps its place in the menu after using a tab`, (await nav()).indexOf("Money") < (await nav()).indexOf("Packages"));
    await go("closures");
    ok(`${label}: Setup has seven tabs, Studio details first, Features last`, (await tabs()).length === 7 && (await tabs())[0] === "studio-details" && (await tabs())[6] === "features");

    // Features page
    await go("features");
    ok(`${label}: Features page lists 10, all on`, (await p.locator(".featrow").count()) === 10 && /10 of 10/.test(await p.locator(".featsum").textContent()) && /14 items/.test(await p.locator(".featsum").textContent()));
    ok(`${label}: Features page no h-scroll`, await noHScroll());
    await shot("features");

    // Agents: asks first (2 agents running); Go back keeps it on
    await flip("agents");
    ok(`${label}: switching Agents off asks first`, /2 agents will stop sending reminders and summaries/.test(await p.locator(".warnmodal").textContent()) && (await p.locator("#chkTitle").textContent()) === "Switch this off?");
    await shot("confirm", false);
    await press("#mBack");
    ok(`${label}: Go back keeps it on`, (await ev(`featOn("agents")`)) === true && (await p.locator("#ft-agents").isChecked()));
    await flip("agents"); await proceed();
    ok(`${label}: agents off: menu item gone (${(await nav()).length})`, !(await nav()).includes("Agents") && (await nav()).length === 13);
    ok(`${label}: toast says nothing is deleted`, /AI workflows is off\. Nothing is deleted/.test(await toast()));
    ok(`${label}: count updates on the page`, /9 of 10/.test(await p.locator(".featsum").textContent()) && /13 items/.test(await p.locator(".featsum").textContent()));
    await go("agents");
    ok(`${label}: a switched-off page can't be opened by address`, (await ev("state.page")) !== "agents");

    // Payroll: Staff and pay becomes Staff; instructors lose My pay
    await flip("payroll"); await proceed();
    ok(`${label}: payroll off: "Staff" without tabs`, (await nav()).includes("Staff") && !(await nav()).includes("Staff and pay"));
    await go("staff");
    ok(`${label}: no tab bar for a single page`, (await p.locator(".hubtabs").count()) === 0);
    await role("instructor");
    ok(`${label}: instructors lose My pay`, !(await nav()).includes("My pay"));
    await role("admin");

    // Marketing: live journeys pause, scheduled campaigns become drafts, its tabs go
    const liveBefore = await ev(`JOURNEYS.filter((j) => j.status === "live").length`);
    await flip("marketing");
    ok(`${label}: switching Marketing off says journeys pause`, new RegExp(`${liveBefore} live journeys? will be paused`).test(await p.locator(".warnmodal").textContent()));
    await proceed();
    ok(`${label}: journeys paused`, (await ev(`JOURNEYS.filter((j) => j.status === "live").length`)) === 0);
    await go("marketing");
    const mtabs = await p.evaluate(() => [...document.querySelectorAll("[data-mtab]")].map((b) => b.dataset.mtab));
    ok(`${label}: Marketing keeps banners, loses journeys and emails (${mtabs.join(",")})`, mtabs.includes("banners") && !mtabs.includes("journeys") && !mtabs.includes("emails"));

    // Inbox and reviews: menu items collapse; Home drops their to-dos
    await flip("inbox"); await proceed();
    await flip("reviews"); await proceed();
    const m2 = await nav();
    ok(`${label}: inbox off: Communication becomes Announcements`, m2.includes("Announcements") && !m2.includes("Communication"));
    await go("feedback");
    ok(`${label}: reviews off: Feedback without a Reviews tab`, m2.includes("Feedback") && (await p.locator(".hubtabs").count()) === 0);
    await go("home");
    const att = await p.locator(".hm-att, .hatt, #pgOther").first().textContent();
    ok(`${label}: Home drops unread messages and low reviews`, !/unread message/.test(att) && !/low review/.test(att));
    await role("instructor");
    ok(`${label}: instructors lose My reviews`, !(await nav()).includes("My reviews"));
    await role("admin");

    // Shop and gift cards off: orders already waiting can still be handed over
    await flip("shop"); await proceed();
    await flip("giftCards"); await proceed();
    await go("shop");
    const shtabs = await p.evaluate(() => [...document.querySelectorAll("[data-shtab]")].map((b) => b.dataset.shtab));
    ok(`${label}: shop off: only the Orders tab, for orders waiting (${shtabs.join(",")})`, JSON.stringify(shtabs) === '["orders"]');
    await go("home");
    ok(`${label}: Home still lists orders to hand over`, /shop orders? to hand over/.test(await p.locator("#pgOther").textContent()));

    // Leads, loyalty and referrals off; then the client app
    await flip("leads"); await proceed();
    await flip("loyalty"); await proceed();
    await flip("referrals"); await proceed();
    ok(`${label}: leads off: Clients without a Leads tab`, (await nav()).includes("Clients") && (await (async () => { await go("clients"); return p.locator(".hubtabs").count(); })()) === 0);
    await role("client");
    const cm = await nav();
    ok(`${label}: client menu loses Rewards, Refer a friend and Shop (${cm.join(" | ")})`, !cm.includes("Rewards") && !cm.includes("Refer a friend") && !cm.includes("Shop"));
    await role("foh");
    ok(`${label}: Front of House keeps Pickups for orders waiting`, (await nav()).includes("Pickups"));
    await role("admin");
    await go("features");
    ok(`${label}: page shows 0 of 10`, /0 of 10/.test(await p.locator(".featsum").textContent()));
    await shot("all-off");

    // Back on: things return, with the next step explained
    await press("#ft-giftCards");
    ok(`${label}: switching on says what's next`, /Gift cards are on\. Check the amounts and designs under Money, Shop, Gift cards\./.test(await toast()));
    await press("#ft-marketing");
    ok(`${label}: marketing back on doesn't restart journeys`, (await ev(`JOURNEYS.filter((j) => j.status === "live").length`)) === 0 && /stay paused/.test(await toast()));
    for (const k of ["agents", "payroll", "inbox", "reviews", "shop", "leads", "loyalty", "referrals"]) await press(`#ft-${k}`);
    ok(`${label}: all back on: 14 items again`, (await nav()).length === 14 && /10 of 10/.test(await p.locator(".featsum").textContent()));
    await role("client");
    const cm2 = await nav();
    ok(`${label}: client menu restored`, ["Rewards", "Refer a friend", "Shop"].every((x) => cm2.includes(x)));
    await role("admin");

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
