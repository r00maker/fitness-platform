const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "up");
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

    // 1. Appointment button stands out
    await go("schedule");
    const bgs = await p.evaluate(() => [getComputedStyle(document.querySelector("#newAppt")).backgroundColor, getComputedStyle(document.querySelector("#newClass")).backgroundColor]);
    ok(`${label}: appointment button colour differs [${bgs}]`, bgs[0] !== bgs[1]);
    await p.locator(".pagehead").first().screenshot({ path: path.join(outDir, `${label}-01-buttons.png`) });

    // 2. Appointment packages
    await click("#newAppt");
    await p.fill("#fClientQ", "chloe"); await p.waitForTimeout(150);
    ok(`${label}: Chloe's private pack shown`, (await text(".cpick")).includes("Private Reformer ×5"));
    await click("[data-addclient]");
    await p.fill("#fClientQ", "dev"); await p.waitForTimeout(150);
    ok(`${label}: Dev has no appointment package`, (await text(".cpick")).includes("No Private Reformer package"));
    await click("[data-addclient]");
    ok(`${label}: chip flagged`, (await p.locator(".pchip.nopkg").count()) === 1);
    await modalShot("02-appt-packages");
    await click("#fSubmit");
    ok(`${label}: asks about missing package`, (await text(".modal")).includes("No appointment package"));
    await click("#mProceed");
    ok(`${label}: appointment created [${await toast()}]`, (await toast()).startsWith("Appointment created."));

    // 3. Auto-cancel in the class creator (from the template)
    await click("#newClass");
    ok(`${label}: auto-cancel from template`, (await p.locator("#fAcOn").isChecked()) && (await p.inputValue("#fAcMin")) === "3");
    ok(`${label}: auto-cancel wording`, (await text("#fAc")).includes("Cancels automatically if fewer than 3 are booked 12 hours before"));
    await p.fill("#fAcMin", "50"); await p.dispatchEvent("#fAcMin", "change"); await p.waitForTimeout(100);
    await modalShot("03-autocancel");
    await click("#fSubmit");
    ok(`${label}: minimum above spots refused`, (await toast()).includes("at most 12"));
    await p.uncheck("#fAcOn"); await p.waitForTimeout(100);
    ok(`${label}: can switch off for one class`, (await p.locator("#fAcMin").count()) === 0);
    await click(".modal [data-mclose].btn");
    // template editor
    await go("templates");
    await click("#newTpl");
    await p.fill("#tName", "Barre test");
    await p.check("#tAcOn"); await p.waitForTimeout(100);
    ok(`${label}: template auto-cancel fields`, (await p.locator("#tAcMin").count()) === 1);
    await click('#tplForm button[type=submit]');
    ok(`${label}: template saved`, (await toast()).includes("Template created"));

    // 4. Deleting class types
    await go("class-types");
    await click('[data-deltype="reformer"]');
    ok(`${label}: refused while on calendar`, (await text(".modal")).includes("still on the calendar"));
    await click(".modal [data-mclose].btn");
    await click("#newType"); await p.fill("#ctName", "Sound bath"); await click("#ctForm button[type=submit]");
    const key = await p.evaluate(() => [...document.querySelectorAll("[data-deltype]")].map((b) => b.dataset.deltype).find((k) => k.startsWith("ct")));
    await click(`[data-deltype="${key}"]`);
    ok(`${label}: asks before deleting`, (await text(".modal")).includes("Delete Sound bath?"));
    await click("#mProceed");
    ok(`${label}: deleted`, (await toast()).includes("Sound bath deleted") && !(await text(".tbl")).includes("Sound bath"));

    // 5. Adding staff
    await go("staff");
    await click("#addStaff");
    await click('#asForm button[type=submit]');
    ok(`${label}: staff needs a name`, (await text("#asErr")).includes("first and last name"));
    await p.fill("#asFirst", "Mia"); await p.fill("#asLast", "Wong"); await p.fill("#asEmail", "mia@demostudio.app");
    await modalShot("05-add-staff");
    await click('#asForm button[type=submit]');
    ok(`${label}: invite sent`, (await toast()).includes("Invite sent to mia@demostudio.app"));
    ok(`${label}: waiting row`, (await text("main")).includes("Added, waiting to set their password"));
    await click('[data-sinv^="resend"]');
    ok(`${label}: resend`, (await toast()).includes("New link sent"));
    await shot("05-staff");

    // 6. Leads page with ClassPass
    await go("leads");
    ok(`${label}: leads page`, (await text("main")).includes("ClassPass clients"));
    await p.selectOption("#leadS", "classpass"); await p.waitForTimeout(150);
    ok(`${label}: ClassPass leads listed`, (await p.locator(".leadtbl tbody tr").count()) >= 1);
    await shot("06-leads");
    ok(`${label}: no sideways scroll (leads)`, await noHScroll());

    // 7. Marketing: Ads tab points to Leads; WhatsApp; journey goal + WhatsApp step
    await go("marketing");
    await click('[data-mtab="ads"]');
    ok(`${label}: ads tab has no leads view`, (await p.locator('[data-adsv="leads"]').count()) === 0 && (await p.locator("[data-goleads]").count()) === 1);
    ok(`${label}: WhatsApp now under Communication`, (await p.locator('[data-mtab="whatsapp"]').count()) === 0);
    await go("comms"); await click('[data-ctab="templates"]');
    ok(`${label}: WhatsApp templates`, (await p.locator(".watpl").count()) === 3);
    await shot("07-whatsapp");
    await go("marketing");
    await click('[data-mtab="journeys"]');
    await click('[data-jopen="jw1"]');
    ok(`${label}: goal shown`, (await text("main")).includes("reached the goal"));
    if (await p.locator('[data-jstep="d1"]').count()) {
      await click('[data-jstep="d1"]');
      if (label !== "phone") ok(`${label}: WhatsApp step form`, (await text("#jPanel")).includes("How it looks") && (await p.locator(".wabubble").count()) >= 1);
    }
    await shot("07-journey", false);
    if (await p.locator("#modalRoot .modal").count()) await click("#modalRoot [data-mclose].btn, #modalRoot [data-close]");

    // 8. Reports
    await go("reports");
    for (const t of ["overview", "sales", "classes", "clients", "conversion"]) {
      await click(`[data-rtab="${t}"]`);
      ok(`${label}: report ${t} tiles`, (await p.locator(".rtile").count()) >= 4);
      await shot(`08-report-${t}`);
    }
    await click('[data-rtab="sales"]');
    await click('[data-rdays="365"]');
    ok(`${label}: monthly bars for a year`, (await text("main")).includes("Money in each month"));
    if (label !== "phone") { await p.hover(".rbar >> nth=3"); await p.waitForTimeout(100); ok(`${label}: bar tooltip`, !(await p.locator("#rTip").isHidden())); }
    await click("#rTbl");
    ok(`${label}: table view`, (await p.locator(".tbl").count()) >= 2);
    ok(`${label}: no sideways scroll (reports)`, await noHScroll());

    // 9. Client: My bookings tabs
    await click('[data-role="client"]');
    await go("my-bookings");
    ok(`${label}: my bookings tabs`, (await p.locator("[data-mbtab]").count()) === 2);
    await click('[data-mbtab="appointments"]');
    ok(`${label}: appointments tab`, (await text("main")).includes("Private Reformer") && (await text("main")).includes("Your appointment package"));
    await shot("09-my-appointments");
    ok(`${label}: no page errors ${errors.join(" | ")}`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const r of results) console.log(r.join("  "));
  console.log(results.filter((r) => r[0] === "FAIL").length, "failed of", results.length);
})();
