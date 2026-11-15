// Cancelled classes on the calendar ("Show cancelled", staff only) and each class's Cancellations tab.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "cx");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "cx-test.html"), src);
const file = "file://" + path.join(__dirname, "cx-test.html");

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
    const shot = (n, full = false) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const open = async (date, time) => { await ev(`openDrawer(SESSIONS.find((s) => ymd(s.start) === "${date}" && hhmm(s.start) === "${time}").id)`); await p.waitForTimeout(150); };
    const closeDr = async () => { await ev("closeDrawer()"); await p.waitForTimeout(100); };
    const drawer = () => p.locator(".drawer").textContent();
    const cxCount = () => p.locator(phone ? ".ag-row.cx" : ".ev.cx").count();
    const toggle = async (on) => { if ((await p.locator("#fCx").isChecked()) !== on) await click("#fCxWrap"); };

    // Calendar toggle
    await go("schedule");
    ok(`${label}: toggle shown to admins`, await p.locator("#fCxWrap").isVisible());
    ok(`${label}: cancelled classes hidden by default`, (await cxCount()) === 0);
    const headBefore = phone ? 0 : await p.locator(".dh .dcount").allTextContents();
    await toggle(true);
    ok(`${label}: switching on shows the two sample cancelled classes (${await cxCount()})`, (await cxCount()) === 2);
    ok(`${label}: toast explains`, /Showing cancelled classes/.test(await toast()));
    if (!phone) ok(`${label}: day counts ignore cancelled classes`, JSON.stringify(await p.locator(".dh .dcount").allTextContents()) === JSON.stringify(headBefore));
    ok(`${label}: no h-scroll with toggle on`, await noHScroll());
    await shot("week-cancelled", !phone);

    // A cancelled class opens read-only
    await click(phone ? ".ag-row.cx" : ".ev.cx [data-open]");
    const d1 = await drawer();
    ok(`${label}: cancelled class says why`, /This class was cancelled/.test(d1) && /Instructor unwell/.test(d1) && /by Olivia Tan/.test(d1));
    ok(`${label}: no actions on a cancelled class`, (await p.locator('.drawer [data-act="edit"], .drawer [data-act="cancel"]').count()) === 0);
    ok(`${label}: lists who was booked`, (await p.locator(".drawer .cxrow").count()) > 0 && /Class cancelled/.test(d1));
    await shot("cancelled-drawer");
    await closeDr();
    await open("2026-11-11", (await ev(`hhmm(SESSIONS.find((s) => s.autoCancelled).start)`)));
    ok(`${label}: auto-cancelled class says so`, /Cancelled automatically/.test(await drawer()) && /Fewer than 3 people booked/.test(await drawer()));
    await closeDr();

    // Picking classes for Edit many never includes cancelled ones
    await ev("startPicking()");
    ok(`${label}: picking hides cancelled classes`, (await cxCount()) === 0);
    await ev("state.selecting = false; render()");

    // Cancellations tab
    await open("2026-11-11", "10:45");
    ok(`${label}: class has Class list and Cancellations tabs`, (await p.locator(".drawer [data-drtab]").count()) === 2);
    ok(`${label}: Class list is the default`, (await p.locator('.drawer [data-drtab="list"]').getAttribute("aria-selected")) === "true");
    await click('.drawer [data-drtab="cx"]');
    const d2 = await drawer();
    ok(`${label}: summary (${d2.match(/\d+ cancellations?[^.]*\./)?.[0]})`, /2 cancellations \(1 late\)\./.test(d2));
    ok(`${label}: late one shows fee and no class back`, /Late cancel/.test(d2) && /Late fee SGD 15\.00/.test(d2) && /Class not given back \(late\)/.test(d2));
    ok(`${label}: on-time one got the class back`, /On time/.test(d2) && /Class back on their package/.test(d2));
    ok(`${label}: says how long before class`, /26 hours before class/.test(d2) && /3 hours before class/.test(d2));
    ok(`${label}: drawer no h-scroll`, await noHScroll());
    await shot("cancellations-tab");
    await closeDr();
    await open("2026-11-12", "07:00");
    ok(`${label}: tab resets to Class list for another class`, (await p.locator('.drawer [data-drtab="list"]').getAttribute("aria-selected")) === "true");
    await closeDr();

    // A client cancels; staff see it on the tab
    await role("client");
    ok(`${label}: clients don't get the toggle`, !(await p.locator("#fCxWrap").isVisible()));
    ok(`${label}: clients never see cancelled classes`, (await cxCount()) === 0);
    await open("2026-11-14", "09:00");
    ok(`${label}: clients don't get the tabs`, (await p.locator(".drawer [data-drtab]").count()) === 0);
    await click('.drawer [data-act="clientCancel"]');
    await click("#ccGo");
    await role("admin");
    await open("2026-11-14", "09:00");
    await click('.drawer [data-drtab="cx"]');
    ok(`${label}: client's own cancellation appears`, /Cancelled by the client/.test(await drawer()) && (await p.locator(".drawer .cxrow").filter({ hasText: "Chloe" }).count()) === 1);
    await closeDr();

    // Staff cancel a booking with a reason
    await open("2026-11-16", "07:00");
    const ci = await ev(`SESSIONS.find((s) => ymd(s.start) === "2026-11-16" && hhmm(s.start) === "07:00").roster[0].ci`);
    await ev(`openStaffCancel(SESSIONS.find((s) => ymd(s.start) === "2026-11-16" && hhmm(s.start) === "07:00"), ${ci})`);
    await p.waitForTimeout(150);
    await p.locator("#scReason").fill("Injured, called the desk");
    await click('#scForm button[type=submit]');
    await click('.drawer [data-drtab="cx"]');
    ok(`${label}: staff cancellation shows reason and who`, /Cancelled by the studio · by You/.test(await drawer()) && /Injured, called the desk/.test(await drawer()));
    await closeDr();

    // Cancelling a class records why; it shows struck through with the toggle on
    await open("2026-11-17", "07:00");
    await click('.drawer [data-act="cancel"]');
    await p.locator("#cReason").fill("Aircon broken");
    await click('#cancelForm button[type=submit]');
    if (await p.locator("#mProceed").count()) await click("#mProceed");
    await ev(`state.anchor = fromYmdHm("2026-11-17", "00:00"); render()`);
    await p.waitForTimeout(150);
    const cxNext = await cxCount();
    ok(`${label}: newly cancelled class shows (${cxNext})`, cxNext >= 1);
    await open("2026-11-17", "07:00");
    ok(`${label}: its panel has the reason`, /Aircon broken/.test(await drawer()) && /by You/.test(await drawer()));
    await closeDr();

    // Front of House and instructors
    await role("foh");
    ok(`${label}: Front of House gets the toggle`, await p.locator("#fCxWrap").isVisible());
    await open("2026-11-11", "10:45");
    ok(`${label}: Front of House sees the tab`, (await p.locator(".drawer [data-drtab]").count()) === 2);
    await closeDr();
    await role("instructor");
    ok(`${label}: instructors get the toggle`, await p.locator("#fCxWrap").isVisible());
    await toggle(false);
    ok(`${label}: switching off hides them again`, (await cxCount()) === 0);
    await role("admin");

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
