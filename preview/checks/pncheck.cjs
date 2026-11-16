// Phones. Clients: the date strip and the day's classes first, notices on one line each, and
// every filter behind one Filter button. Instructors: Up next with Check in first on My day,
// and Check-in mode (big rows, search, waiver prompt, no-shows).
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "pn");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "pn-test.html"), src);
const file = "file://" + path.join(__dirname, "pn-test.html");

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name, cond) => results.push([cond ? "PASS" : "FAIL", name]);
  for (const [label, opts] of [
    ["phone", { ...devices["iPhone 13"], colorScheme: "light" }],
    ["phone-dark", { ...devices["iPhone 13"], colorScheme: "dark" }],
    ["desk", { viewport: { width: 1360, height: 900 }, colorScheme: "light" }],
  ]) {
    const p = await browser.newPage(opts);
    await p.addInitScript(() => { window.__quiet = true; });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(file);
    const desk = label === "desk";
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const count = (sel) => p.locator(sel).count();
    const txt = (sel) => p.locator(sel).first().textContent();
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");

    // --- Clients -------------------------------------------------------------------------
    await role("client");
    await go("schedule");
    if (desk) {
      ok(`${label}: desktop keeps the calendar`, (await count(".pbstrip")) === 0 && (await p.locator("#pgSchedule .toolbar").isVisible()));
    } else {
      ok(`${label}: date strip first, 14 days`, (await count(".pbday")) === 14);
      ok(`${label}: opens on today with classes listed`, /Today/.test(await txt(".pbday.on")) && (await count(".pbrow")) === 3);
      ok(`${label}: calendar controls are out of the way`, !(await p.locator("#pgSchedule .toolbar").isVisible()) && !(await p.locator("#legend").isVisible()));
      ok(`${label}: notices are one line each`, (await count(".pbnote")) === 2 && !(await p.locator("#clientFront").isVisible()) && (await p.locator(".pbnote").first().boundingBox()).height < 60);
      ok(`${label}: booked classes say so`, /Booked/.test(await p.locator(".pblist").textContent()));
      const first = await p.locator(".pbrow").first().boundingBox();
      ok(`${label}: the first class is on the first screen (${Math.round(first.y)}px)`, first.y + first.height < 1400);
      await press('[data-pbday]:nth-child(2)');
      ok(`${label}: another day`, /Thu 12/.test(await txt(".pbdate")) || /Thursday 12/.test(await txt(".pbdate")));
      await press("#pbFilter");
      ok(`${label}: one Filter button holds the filters`, (await count("#pbSheet #pbLoc")) === 1 && (await count("[data-pbtype]")) >= 4);
      await p.selectOption("#pbLoc", { index: 1 });
      await p.waitForTimeout(150);
      ok(`${label}: filter count on the button`, /Filter · 1/.test(await txt("#pbFilter")));
      await press('[data-pbtype="barre"]');
      const rows = await p.locator(".pbrow .pbm b").allTextContents();
      ok(`${label}: filters apply (${rows.join(",")})`, rows.every((r) => r === "Barre"));
      await press("#pbClear");
      ok(`${label}: clear filters`, /^Filter$/.test((await txt("#pbFilter")).trim()));
      await press("#pbDone");
      ok(`${label}: no h-scroll`, await noHScroll());
      await shot("client");
      await press(".pbrow");
      ok(`${label}: tapping a class opens it to book`, (await p.locator(".drawer, #drawer, [role=dialog]").count()) > 0);
      await p.keyboard.press("Escape");
      await press(".pbnote");
      ok(`${label}: a notice opens in full`, await p.locator("#clientFront").isVisible());
    }

    // --- Instructors -----------------------------------------------------------------------
    await role("instructor");
    await go("home");
    ok(`${label}: Up next comes first on My day`, (await p.locator(".insthome > *").first().getAttribute("class")).includes("upfirst"));
    ok(`${label}: before the hour, it's see who's coming`, /See who's coming/.test(await txt(".upgo")) && /Check-in opens at 5:00pm/.test(await txt(".upfirst")));
    ok(`${label}: what matters at the door`, /12 of 16 booked/.test(await txt(".upfacts")) && /waiver missing/.test(await txt(".upfacts")));
    // Move the class to 30 minutes from now, so check-in is open.
    await ev('{ const s = SESSIONS.find((x) => x.instr === ME.instructor && sameDay(x.start, NOW) && x.start > NOW); const d = s.end - s.start; s.start = addMin(NOW, 30); s.end = new Date(s.start.getTime() + d); render(); }');
    ok(`${label}: within the hour: Check in (${await txt(".upgo")})`, /^Check in$/.test((await txt(".upgo")).trim()) && /In 30 min/.test(await txt(".upwhen")));
    await shot("upnext", false);
    await press(".upgo");
    ok(`${label}: check-in mode opens`, (await count(".cimode .cirow")) === 12 && /0 of 12 checked in/.test(await txt(".cihead")));
    const names = await p.locator(".cirow .cip b").allTextContents();
    ok(`${label}: sorted by name`, names.join("|") === [...names].sort((a, b) => a.localeCompare(b)).join("|"));
    await p.fill("#ciQ", "chloe");
    await p.waitForTimeout(150);
    ok(`${label}: search`, (await count(".cirow")) === 1);
    await press('.cirow [data-ci$=":present"]');
    ok(`${label}: checked in, search cleared for the next name (${await toast()})`, /Chloe is checked in/.test(await toast()) && (await count(".cirow")) === 12 && /1 of 12 checked in/.test(await txt(".cihead")));
    const noWaiver = await ev('SESSIONS.find((s) => s.id === state.ci.open).roster.map((r) => CLIENTS[r.ci]).find((c) => waiverMissing(c))?.name');
    if (noWaiver) {
      await p.fill("#ciQ", noWaiver.split(" ")[0]);
      await p.waitForTimeout(150);
      await press('.cirow [data-ci$=":present"]');
      ok(`${label}: no waiver asks first`, /hasn't signed the waiver/.test(await txt(".ciask")));
      await press("[data-ciwaiver]");
      ok(`${label}: paper waiver, then in (${await toast()})`, /Waiver marked as done/.test(await toast()) && /2 of 12 checked in/.test(await txt(".cihead")));
    }
    await press('.cirow.present [data-ci$=":present"]');
    ok(`${label}: tap again to undo`, /Undone/.test(await toast()));
    ok(`${label}: big rows`, (await p.locator(".cirow").first().boundingBox()).height >= 60 && (await p.locator(".cibtn").first().boundingBox()).height >= 44);
    ok(`${label}: no no-show button before class starts`, (await count('[data-ci$=":no_show"]')) === 0);
    ok(`${label}: check-in no h-scroll`, await noHScroll());
    await shot("checkin", false);
    await press("#ciClose");
    ok(`${label}: Done closes and My day updates`, (await count(".cimode")) === 0 && /Check in \(\d+ of 12 in\)/.test(await txt(".upgo")));
    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
