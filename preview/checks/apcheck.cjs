const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "ap");
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
    p.on("pageerror", (e) => errors.push(e.message + " @@ " + (e.stack || "").split("\n").slice(1, 6).join(" / ")));
    await p.goto(file);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n, full = false) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const text = (sel) => p.locator(sel).first().textContent();
    const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const modalShot = async (n) => { const m = p.locator(".modal").first(); await m.evaluate((el) => (el.scrollTop = 0)); await m.screenshot({ path: path.join(outDir, `${label}-${n}.png`) }); };

    await go("schedule");
    ok(`${label}: new appointment button`, await p.locator("#newAppt").isVisible());
    // --- Appointment with no client: asked first ---
    await click("#newAppt");
    ok(`${label}: appointment title`, (await text("#formTitle")) === "New appointment");
    ok(`${label}: no template for appointments`, (await p.locator("#fTpl").count()) === 0);
    const typeOpts = await p.locator("#fType option").allTextContents();
    ok(`${label}: only appointment types [${typeOpts}]`, typeOpts.length === 1 && typeOpts[0] === "Private Reformer");
    ok(`${label}: no waitlist or ClassPass on appointments`, (await p.locator("#fWl").count()) === 0 && (await p.locator("#fCpOn").count()) === 0);
    await p.fill("#fClientQ", "chl"); await p.waitForTimeout(150);
    await modalShot("01-appt-search");
    await click("[data-addclient]");
    ok(`${label}: client chip added`, (await text("#fClients")).includes("Chloe"));
    await click("[data-unclient]");
    ok(`${label}: client removed`, !(await text("#fClients")).includes("Chloe Tan"));
    await click("#fSubmit");
    ok(`${label}: no-client flag`, (await text(".modal")).includes("No client added"));
    await click("#mProceed");
    ok(`${label}: open appointment created [${await toast()}]`, (await toast()).startsWith("Appointment created."));

    // --- Repeating appointment with a client ---
    await click("#newAppt");
    await p.fill("#fClientQ", "chloe"); await p.waitForTimeout(150);
    await click("[data-addclient]");
    await p.selectOption("#fRepF", "1"); await p.waitForTimeout(100);
    await p.fill("#fRepN", "4"); await p.dispatchEvent("#fRepN", "change"); await p.waitForTimeout(100);
    const sum = await text("#fRepSum");
    ok(`${label}: repeat summary [${sum}]`, /4 appointments/.test(sum) && /booked into every one/.test(sum));
    await modalShot("02-appt-repeat");
    await click("#fSubmit");
    if (await p.locator("#mProceed").count()) await click("#mProceed");
    const t2 = await toast();
    ok(`${label}: 4 appointments with client [${t2}]`, t2.startsWith("4 appointments created.") && t2.includes("booked in to every one"));

    // --- New class: ClassPass and repeats ---
    await click("#newClass");
    ok(`${label}: class title`, (await text("#formTitle")) === "New class");
    ok(`${label}: class types exclude appointments`, !(await p.locator("#fType option").allTextContents()).includes("Private Reformer"));
    ok(`${label}: ClassPass on by default`, await p.locator("#fCpOn").isChecked());
    await p.fill("#fCpSpots", "99"); await p.dispatchEvent("#fCpSpots", "change"); await p.waitForTimeout(100);
    const capV = await p.inputValue("#fCap");
    ok(`${label}: ClassPass spots capped at class size`, (await p.inputValue("#fCpSpots")) === capV);
    await p.fill("#fCpSpots", "3"); await p.dispatchEvent("#fCpSpots", "change"); await p.waitForTimeout(100);
    ok(`${label}: ClassPass hint`, (await text("#fCp")).includes("ClassPass can book up to 3 spots"));
    await p.selectOption("#fRepF", "1"); await p.waitForTimeout(100);
    await click('[data-dow="3"]');
    await p.fill("#fRepN", "6"); await p.dispatchEvent("#fRepN", "change"); await p.waitForTimeout(100);
    ok(`${label}: class repeat summary`, /6 classes/.test(await text("#fRepSum")) && /Fri & Wed|Wed & Fri|Fri|Wed/.test(await text("#fRepSum")));
    await modalShot("03-class-cp-repeat");
    await click("#fSubmit");
    if (await p.locator("#mProceed").count()) await click("#mProceed");
    const t3 = await toast();
    ok(`${label}: 6 classes created [${t3}]`, t3.startsWith("6 classes created."));
    const cpCount = await p.evaluate(() => 0);
    ok(`${label}: no sideways scroll (schedule)`, await noHScroll());

    // Drawer shows ClassPass for staff
    await click("#pgSchedule .ev:not(.appt) [data-open], #pgSchedule .ag-row[data-open], #pgSchedule [data-open]");
    ok(`${label}: drawer ClassPass line`, /ClassPass: \d+ of \d+|Not taking ClassPass/.test(await text(".drawer")));
    await shot("04-drawer");
    await click(".drawer [data-close]");

    // --- Class types: colours and kinds ---
    await go("class-types");
    await shot("05-class-types", true);
    ok(`${label}: kind column`, (await text("#pgOther")).includes("Appointments"));
    await click('[data-edittype="barre"]');
    await click('[data-ctcol="#0E7490"]');
    ok(`${label}: swatch picked`, (await p.getAttribute('[data-ctcol="#0E7490"]', "aria-checked")) === "true");
    await p.fill("#ctHex", "#FDE68A"); await p.dispatchEvent("#ctHex", "change"); await p.waitForTimeout(100);
    ok(`${label}: too-light colour refused`, (await text(".modal")).includes("too light") && (await p.locator("#ctForm button[type=submit]").isDisabled()));
    await p.fill("#ctHex", "2f6b5a"); await p.dispatchEvent("#ctHex", "change"); await p.waitForTimeout(100);
    ok(`${label}: custom hex accepted`, !(await p.locator("#ctForm button[type=submit]").isDisabled()));
    await modalShot("06-type-editor");
    await click("#ctForm button[type=submit]");
    const varNow = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--t-barre").trim().toLowerCase());
    ok(`${label}: colour applied [${varNow}]`, label.includes("dark") ? varNow.includes("color-mix") || varNow.startsWith("rgb") || varNow.startsWith("#") : varNow === "#2f6b5a");
    await click("#newType");
    await p.fill("#ctName", "Sound bath");
    await p.check('input[name="ctKind"][value="appointment"]'); await p.waitForTimeout(100);
    await click("#ctForm button[type=submit]");
    ok(`${label}: new appointment type added`, (await toast()).includes("Sound bath added"));
    await go("schedule");
    await click("#newAppt");
    ok(`${label}: new type offered for appointments`, (await p.locator("#fType option").allTextContents()).includes("Sound bath"));
    await click(".modal [data-mclose].btn");
    ok(`${label}: no sideways scroll (types)`, await noHScroll());

    // --- Clients don't see other people's appointments ---
    await click('[data-role="client"]');
    if (await p.locator('[data-csrc="new"]').count()) await click('[data-csrc="new"]');
    await go("schedule");
    const visible = await p.evaluate(() => document.querySelectorAll(".ev.appt").length);
    ok(`${label}: client sees no appointments they're not in (${visible})`, visible === 0);
    ok(`${label}: client has no appointment buttons`, !(await p.locator("#newAppt").isVisible()));
    ok(`${label}: no page errors ${errors.join(" | ")}`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const r of results) console.log(r.join("  "));
  console.log(results.filter((r) => r[0] === "FAIL").length, "failed of", results.length);
})();
