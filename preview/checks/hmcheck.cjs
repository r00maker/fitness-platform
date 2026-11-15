// Home, the staff front page: today, needs attention, how it's going, the week ahead, for each role.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "hm");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "hm-test.html"), src);
const file = "file://" + path.join(__dirname, "hm-test.html");

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
    p.on("dialog", (d) => d.dismiss());
    await p.goto(file);
    await p.waitForTimeout(200);
    const phone = label === "phone";
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: true });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const text = (sel) => p.locator(sel).first().textContent();
    const navLabels = () => p.evaluate(() => [...document.querySelectorAll("#side .navitem span:not(.count)")].map((x) => x.textContent));
    const kpiKeys = () => p.evaluate(() => [...document.querySelectorAll("[data-kpi]")].map((x) => x.dataset.kpi));

    // Admin lands on Home
    ok(`${label}: staff land on Home`, (await ev("state.page")) === "home" && (await p.locator("#hToday").count()) === 1);
    ok(`${label}: Home is first in the menu`, (await navLabels())[0] === "Home");
    ok(`${label}: greets by name`, /Good morning, Olivia/.test(await text("#pgOther .pagehead h2")));
    const booked = await ev(`SESSIONS.filter((s) => s.status === "scheduled" && sameDay(s.start, NOW)).reduce((a, s) => a + s.roster.length, 0)`);
    ok(`${label}: hero is people booked today (${booked})`, (await text(".heronum")) === String(booked));
    ok(`${label}: exactly one hero figure`, (await p.locator(".heronum").count()) === 1);
    ok(`${label}: up next is the 10:45 class`, /Reformer Pilates · 10:45am/.test(await text(".upnext")));
    ok(`${label}: today's classes listed with to-dos`, (await p.locator(".hclass").count()) === 5 && (await p.locator(".hclass .todo").count()) >= 2);
    const sev = await p.evaluate(() => [...document.querySelectorAll(".attrow")].map((r) => r.className.replace("attrow ", "")));
    ok(`${label}: attention sorted most urgent first (${sev.join(",")})`, sev.length >= 5 && sev.join(",") === [...sev].sort((a, b) => ["urgent", "soon", "fyi"].indexOf(a) - ["urgent", "soon", "fyi"].indexOf(b)).join(","));
    ok(`${label}: every item has a word label, not just colour`, (await p.locator(".attrow .sevlbl").count()) === sev.length);
    ok(`${label}: admin sees four tiles incl. money`, JSON.stringify(await kpiKeys()) === JSON.stringify(["bookings", "fill", "new_clients", "money"]));
    ok(`${label}: tiles compare with the period before`, /vs the 7 days before/.test(await text(".ktile")));
    ok(`${label}: sparklines drawn`, (await p.locator(".ktile svg.spark").count()) === 4);
    ok(`${label}: week ahead has 7 days`, (await p.locator(".wkcol").count()) === 7);
    if (phone) {
      const [h, a, c] = await p.evaluate(() => [".hero", ".hattsec", ".hclassesec"].map((s) => document.querySelector(s).getBoundingClientRect().top));
      ok(`${label}: on phones, attention comes before the class list`, h < a && a < c);
    }
    ok(`${label}: no sideways scroll`, await noHScroll());
    await shot("home");

    // Period and location filters
    const before = await text('[data-kpi="bookings"] .kval');
    await click('[data-hdays="30"]');
    ok(`${label}: 30 days changes the numbers (${before} → ${await text('[data-kpi="bookings"] .kval')})`, (await text('[data-kpi="bookings"] .kval')) !== before && /vs the 30 days before/.test(await text(".ktile")));
    await click('[data-hdays="7"]');
    await p.locator("#hLoc").selectOption("hv");
    await p.waitForTimeout(150);
    const hv = await ev(`SESSIONS.filter((s) => s.status === "scheduled" && sameDay(s.start, NOW) && s.loc === "hv").reduce((a, s) => a + s.roster.length, 0)`);
    ok(`${label}: location narrows today (${hv})`, (await text(".heronum")) === String(hv) && /Holland Village/.test(await text("#pgOther .pagehead p")));
    ok(`${label}: studio-wide tiles say so when narrowed`, (await p.locator(".kscope").count()) === 2);
    await p.locator("#hLoc").selectOption("");
    await p.waitForTimeout(150);

    // Week ahead: tooltip, table, open a day
    if (!phone) {
      await p.locator(".wkcol").nth(1).hover();
      await p.waitForTimeout(100);
      ok(`${label}: hover shows the day's numbers`, /Thu 12 Nov: \d+ classes, \d+ of \d+ spots booked/.test(await text("#hTip")) && await p.locator("#hTip").isVisible());
    }
    await click("#hTable");
    ok(`${label}: week ahead as a table`, (await p.locator(".wktbl tbody tr").count()) === 7);
    await click("#hTable");
    await click('.wkcol >> nth=2');
    ok(`${label}: tapping a day opens it on the schedule`, (await ev("state.page")) === "schedule" && (await ev("state.view")) === "day" && (await ev("ymd(state.anchor)")) === "2026-11-13");
    await go("home");

    // Actions go where they say
    await click('.attrow [data-hgo="fees"]');
    ok(`${label}: "Open fees" goes to Fees`, (await ev("state.page")) === "fees");
    await go("home");
    await click(".upnext [data-hopen]");
    ok(`${label}: "Open class" opens the class`, (await p.locator(".drawer").count()) === 1 && /Reformer Pilates/.test(await text(".drawer h2")));
    await ev("closeDrawer()");
    await click(".hclass >> nth=1");
    ok(`${label}: tapping a class row opens it`, /Mat Pilates/.test(await text(".drawer h2")));
    await ev("closeDrawer()");

    // Front of House: no money, no admin-only to-dos
    await role("foh");
    ok(`${label}: Front of House stays on Home`, (await ev("state.page")) === "home" && /Good morning, Fiona/.test(await text("#pgOther .pagehead h2")));
    ok(`${label}: Front of House sees no money`, JSON.stringify(await kpiKeys()) === JSON.stringify(["bookings", "fill", "new_clients"]));
    const fohKinds = await p.evaluate(() => [...document.querySelectorAll(".attrow b")].map((b) => b.textContent).join(" | "));
    ok(`${label}: Front of House to-dos are theirs (${fohKinds})`, !/\bfees?\b|instructor|extension|cover/i.test(fohKinds) && /waiver/.test(fohKinds));

    // Instructor: their day
    await role("instructor");
    ok(`${label}: instructors see "My day"`, (await navLabels())[0] === "My day" && (await text("#hToday")) === "Your classes today");
    const mine = await ev(`SESSIONS.filter((s) => s.status === "scheduled" && sameDay(s.start, NOW) && s.instr === ME.instructor).length`);
    ok(`${label}: only their classes (${mine})`, (await p.locator(".hclass").count()) === mine);
    ok(`${label}: their numbers only`, JSON.stringify(await kpiKeys()) === JSON.stringify(["bookings", "fill"]));
    ok(`${label}: cover requests for them`, /1 cover request for you/.test(await p.locator(".hattsec").textContent()));

    // Clients keep "Book a class"
    await role("client");
    ok(`${label}: clients have no Home and land on Book a class`, !(await navLabels()).includes("Home") && (await ev("state.page")) === "schedule");
    await role("admin");

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
