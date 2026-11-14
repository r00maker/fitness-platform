const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "cm");
fs.mkdirSync(outDir, { recursive: true });
const file = "file://" + path.join(__dirname, "..", "studio-calendar-preview.html");

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
    await p.goto(file);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const text = (sel) => p.locator(sel).first().textContent();
    const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const modalShot = async (n) => { const m = p.locator(".modal").first(); await m.evaluate((el) => (el.scrollTop = 0)); await m.screenshot({ path: path.join(outDir, `${label}-${n}.png`) }); };

    // 1. Day view cards aren't cut off
    await go("schedule");
    await click('#views button[data-view="day"]');
    const clipped = await p.evaluate(() => [...document.querySelectorAll(".wgrid.single .ev button")].filter((b) => b.scrollHeight > b.clientHeight + 1).length);
    ok(`${label}: no clipped day cards (${clipped})`, clipped === 0);
    ok(`${label}: count shown once per card`, (await p.locator(".wgrid.single .ev .evr").count()) === (await p.locator(".wgrid.single .ev").count()));
    await p.locator(".gridscroll").first().screenshot({ path: path.join(outDir, `${label}-01-day.png`) });
    await click('#views button[data-view="week"]');

    // 2. Package setting
    await go("policies");
    ok(`${label}: package toggle in rules`, await p.locator("#pAllowNoPkg").count() === 1);
    await p.evaluate(() => { const el = document.querySelector("#pAllowNoPkg"); el.checked = false; });
    await p.locator("#pAllowNoPkg").dispatchEvent("change");
    const saveBtn = p.locator("#polForm button[type=submit]").first();
    if (await saveBtn.count()) { await saveBtn.click(); await p.waitForTimeout(150); }
    await go("schedule");
    await click("#newAppt");
    await p.fill("#fClientQ", "dev"); await p.waitForTimeout(150);
    await click("[data-addclient]");
    await click("#fSubmit");
    ok(`${label}: blocked without package when off [${await toast()}]`, (await toast()).includes("only allows bookings with a package"));
    await click(".modal [data-mclose].btn");

    // 3. Change many classes
    await click("#bulkChange");
    ok(`${label}: bulk step 1`, (await text("#bkTitle")) === "Edit many classes" && (await text(".bkcount")).includes("class"));
    await click('[data-bkday="1"]');
    await p.selectOption("#bkTime", "07:00"); await p.waitForTimeout(150);
    const cnt = await text(".bkcount");
    ok(`${label}: filtered count [${cnt}]`, /\d+ class/.test(cnt));
    await modalShot("03-bulk-1");
    await click('#bkForm button[type=submit]');
    ok(`${label}: bulk step 2`, (await p.locator("#bkIns").count()) === 1 && (await p.locator("#bkCp").count()) === 1 && (await p.locator("#bkAc").count()) === 1);
    await p.selectOption("#bkIns", "ben"); await p.waitForTimeout(100);
    await p.selectOption("#bkCp", "on"); await p.waitForTimeout(100);
    await p.fill("#bkCap", "12");
    await modalShot("03-bulk-2");
    await click('#bkForm button[type=submit]');
    if (await p.locator("#mProceed").count()) await click("#mProceed");
    ok(`${label}: bulk applied [${await toast()}]`, /^Changed \d+ class/.test(await toast()));
    await click("#bulkChange");
    await click('#bkForm button[type=submit]');
    await click('#bkForm button[type=submit]');
    ok(`${label}: must change something`, (await toast()).includes("Change at least one thing"));
    await click(".modal [data-mclose].btn");

    // 4. Communication
    await go("comms");
    ok(`${label}: inbox list`, (await p.locator(".ibx-row").count()) >= 4);
    await click('[data-conv="c1"]');
    ok(`${label}: thread shows phone-app reply`, (await text(".ibx-msgs")).includes("Saturday is booked for you") && (await text(".ibx-msgs")).includes("Sent from the phone app"));
    await p.fill("#ibxText", "Yes, there's a car park on Tras Street.");
    await click("#ibxSend");
    ok(`${label}: reply sent`, (await toast()).includes("free"));
    await shot("04-inbox", false);
    if (label === "phone") await click("#ibxBack");
    await click('[data-conv="c4"]');
    ok(`${label}: closed window explained`, (await text(".ibx-compose")).includes("Reply window closed"));
    await click("#ibxTpl");
    ok(`${label}: charge shown before sending`, (await text(".modal")).includes("Meta charges for this message") && (await text(".modal")).includes("of your message credits"));
    await modalShot("04-template");
    await click('#tpForm button[type=submit]');
    ok(`${label}: template sent`, (await toast()).includes("credits used"));
    if (label === "phone") await click("#ibxBack");
    await click('[data-ctab="settings"]');
    ok(`${label}: payment step shown`, (await text("main")).includes("How Meta gets paid") && (await text("main")).includes("WhatsApp messages cost money"));
    await click('[data-buy="2000"]');
    await click("#mProceed");
    ok(`${label}: credits added`, (await toast()).includes("credits added"));
    await shot("04-settings");
    await p.check('input[name="cbMode"][value="meta_direct"]'); await p.waitForTimeout(100);
    await click("#cbSave");
    ok(`${label}: must confirm Meta card`, (await toast()).includes("Add a payment method"));
    await click('[data-ctab="templates"]');
    ok(`${label}: templates tab`, (await p.locator(".watpl").count()) === 3);
    ok(`${label}: no sideways scroll (comms)`, await noHScroll());

    // 5. Instructor reports
    await go("reports");
    await click('[data-rtab="instructors"]');
    ok(`${label}: instructor list`, (await p.locator("[data-rinstr]").count()) >= 3);
    await click('[data-rinstr="ana"]');
    ok(`${label}: instructor detail`, (await text("main")).includes("Booked per class") && (await p.locator(".rtile").count()) === 6);
    await shot("05-instructor");
    await click("#rInstrBack");
    ok(`${label}: back to list`, (await p.locator("[data-rinstr]").count()) >= 3);
    ok(`${label}: no sideways scroll (reports)`, await noHScroll());

    // 6. Marketing has no WhatsApp tab now
    await go("marketing");
    ok(`${label}: WhatsApp moved out of Marketing`, (await p.locator('[data-mtab="whatsapp"]').count()) === 0);
    ok(`${label}: no page errors ${errors.join(" | ")}`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const r of results) console.log(r.join("  "));
  console.log(results.filter((r) => r[0] === "FAIL").length, "failed of", results.length);
})();
