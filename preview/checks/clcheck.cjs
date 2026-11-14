// Closures and holidays: the Closures page, adding one (with the "what will happen" summary and
// the confirmation), shaded days on the calendar for staff and clients, repeats skipping closed
// days, the closed-day warning in the class form, editing and removing.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "cl");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "cl-test.html"), src);
const file = "file://" + path.join(__dirname, "cl-test.html");

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
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message + " @@ " + (e.stack || "").split("\n").slice(1, 3).join(" / ")));
    p.on("dialog", (d) => d.dismiss());
    await p.goto(file);
    const phone = label === "phone";
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const setDate = async (sel, v) => { await p.locator(sel).fill(v); await p.locator(sel).dispatchEvent("change"); await p.waitForTimeout(100); };
    const navLabels = () => p.evaluate(() => [...document.querySelectorAll("#side .navitem span:not(.count)")].map((x) => x.textContent));
    const calendarWeek = async (date) => { await go("schedule"); await ev(`state.view = "week"; state.anchor = fromYmdHm("${date}", "00:00"); render()`); await p.waitForTimeout(150); };

    // Menu and page
    ok(`${label}: admin menu has Closures & holidays`, (await navLabels()).includes("Closures & holidays"));
    await go("closures");
    ok(`${label}: three sample closures`, (await p.locator(".clcard").count()) === 3);
    ok(`${label}: sample closure cancelled its classes`, /1 class cancelled for this closure/.test(await p.locator(".clcard").first().textContent()));
    ok(`${label}: closures page no h-scroll`, await noHScroll());
    await shot("page");

    // Add a closure on a day with classes
    await click("#clNew");
    ok(`${label}: add window opens`, await p.locator("#clForm").isVisible());
    await p.locator("#clN").fill("Deepavali");
    await setDate("#clS", "2026-11-16");
    ok(`${label}: last day follows first day`, (await p.locator("#clE").inputValue()) === "2026-11-16");
    const sum = await p.locator("#clSum").textContent();
    ok(`${label}: summary says what will happen (${sum.slice(0, 80)})`, /classes are on the schedule for these days/.test(sum) && /They'll be cancelled/.test(sum));
    const before = await ev(`SESSIONS.filter((s) => ymd(s.start) === "2026-11-16" && s.status === "scheduled").length`);
    ok(`${label}: modal no h-scroll`, await noHScroll());
    await shot("add", false);
    await click('#clForm button[type=submit]');
    ok(`${label}: asks before cancelling`, (await p.locator("#chkTitle").textContent()) === "Classes will be cancelled" && /This will cancel \d+ classes/.test(await p.locator(".warnmodal .mb").textContent()));
    await shot("confirm", false);
    await click("#mProceed");
    ok(`${label}: toast says what happened (${await toast()})`, new RegExp(`Closure added\\. ${before} classes cancelled\\.`).test(await toast()));
    ok(`${label}: classes on that day cancelled`, (await ev(`SESSIONS.filter((s) => ymd(s.start) === "2026-11-16" && s.status === "scheduled").length`)) === 0);
    ok(`${label}: four closures listed`, (await p.locator(".clcard").count()) === 4);

    // Validation
    await click("#clNew");
    await click('#clForm button[type=submit]');
    ok(`${label}: name needed`, /Give the closure a name/.test(await toast()));
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));

    // Calendar: shaded and named, for staff and clients
    await calendarWeek("2026-11-16");
    if (phone) ok(`${label}: agenda names the closed day`, (await p.locator(".ag-day .closedtag").first().textContent()) === "Closed: Deepavali");
    else {
      ok(`${label}: closed day shaded`, (await p.locator('.dcol.closed[data-date="2026-11-16"]').count()) === 1);
      ok(`${label}: day heading names it`, (await p.locator(".dh .closedtag").first().textContent()) === "Closed: Deepavali");
    }
    await shot("calendar", false);
    await calendarWeek("2026-11-28");
    const hv = await p.locator(".closedtag").first().textContent();
    ok(`${label}: one location's closure says where (${hv})`, hv === "Closed at Holland Village: Floor repairs");
    await ev(`state.view = "month"; state.anchor = fromYmdHm("2026-11-16", "00:00"); render()`);
    await p.waitForTimeout(150);
    ok(`${label}: month view marks it`, (await p.locator('.mc.closed[data-day="2026-11-16"] .closedchip').count()) === 1);
    await shot("month", false);
    await role("client");
    await calendarWeek("2026-11-16");
    ok(`${label}: clients see the closed day`, (await p.locator(".closedtag").filter({ hasText: "Deepavali" }).count()) === 1);
    await shot("client-calendar", false);
    await role("admin");

    // The class form: adding a class on a closed day asks; repeats skip closed days
    await ev(`openForm(null, { ...FORM_DEFAULTS, date: "2026-11-16", start: "12:00" })`);
    await p.waitForTimeout(150);
    await click('#classForm button[type=submit]');
    ok(`${label}: adding a class on a closed day asks first`, /The studio is closed on Mon 16 Nov \(Deepavali\)\. Add the class anyway\?/.test(await p.locator(".warnmodal").textContent().catch(() => "")));
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));
    const made = await ev(`(() => { const n = SESSIONS.length; openForm(null, { ...FORM_DEFAULTS, date: "2026-11-16", start: "21:00", instr: "", rep: { freq: 1, days: [1], end: "count", count: 4, until: "" } }); return n; })()`);
    await p.waitForTimeout(150);
    await click('#classForm button[type=submit]');
    if (await p.locator("#mProceed").count()) await click("#mProceed");
    const added = await ev(`SESSIONS.slice(${made}).map((s) => ymd(s.start))`);
    ok(`${label}: repeat skipped the closed day and still made 4 (${added.join(", ")})`, added.length === 4 && !added.includes("2026-11-16") && added[0] === "2026-11-23");

    // Moving a class onto a closed day asks
    const moveId = await ev(`SESSIONS.find((s) => ymd(s.start) === "2026-11-18" && s.status === "scheduled").id`);
    await ev(`openForm(SESSIONS.find((s) => s.id === ${moveId}))`);
    await p.waitForTimeout(150);
    await setDate("#fDate", "2026-11-16");
    await click('#classForm button[type=submit]');
    ok(`${label}: moving onto a closed day asks`, /Move the class there anyway\?/.test(await p.locator(".warnmodal").textContent().catch(() => "")));
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));

    // Edit and remove
    await go("closures");
    await click('[data-cledit="cl2"]');
    ok(`${label}: edit shows dates read-only`, /remove this closure and add it again/.test(await p.locator("#clForm").textContent()));
    await p.locator("#clN").fill("Christmas");
    await click('#clForm button[type=submit]');
    ok(`${label}: edit saved`, (await toast()) === "Closure saved." && /Christmas/.test(await p.locator(".clcard").nth(2).textContent()));
    const newId = await ev(`CLOSURES.find((c) => c.name === "Deepavali").id`);
    await click(`[data-cldel="${newId}"]`);
    ok(`${label}: removing explains cancelled classes stay cancelled`, /stay cancelled, because people were already told/.test(await p.locator(".warnmodal").textContent()));
    await click("#mProceed");
    ok(`${label}: removed`, /“Deepavali” removed\./.test(await toast()) && (await p.locator(".clcard").count()) === 3);
    ok(`${label}: cancelled classes stay cancelled`, (await ev(`SESSIONS.filter((s) => ymd(s.start) === "2026-11-16" && s.status === "scheduled").length`)) === 0);

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
