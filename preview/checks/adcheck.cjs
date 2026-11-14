const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "ads");
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
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(file);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const text = (sel) => p.locator(sel).first().textContent();
    const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

    await go("marketing");
    await click('[data-mtab="ads"]');
    await shot("01-results");
    ok(`${label}: funnel shows stages`, (await p.locator(".fnl").count()) === 4);
    ok(`${label}: 30-day funnel numbers [${(await text(".fnl.s1 b")).trim()}]`, Number((await text(".fnl.s1 b")).trim()) >= 17);
    await click('[data-adsdays="365"]');
    ok(`${label}: year funnel includes older`, Number((await text(".fnl.s1 b")).trim()) > 17);
    ok(`${label}: campaigns table`, (await text("main")).includes("November free trial"));
    ok(`${label}: no sideways scroll (results)`, await noHScroll());

    await go("leads");
    await shot("02-leads");
    const openRows = await p.locator(".leadtbl tbody tr").count();
    ok(`${label}: open leads listed`, openRows === 7);
    await click('[data-leadc="l1"]');
    ok(`${label}: mark contacted`, (await toast()).includes("contacted"));
    await click('[data-leadn="l2"]');
    await p.fill("#lnText", "Left a voicemail");
    await click('#lnForm button[type=submit]');
    ok(`${label}: note saved`, (await text(".leadtbl")).includes("Left a voicemail"));
    await click('[data-leadf="bought"]');
    ok(`${label}: bought filter`, (await p.locator(".leadtbl tbody tr").count()) === 7);
    await click('[data-leadf="all"]');
    await p.fill("#leadQ", "kenji"); await p.press("#leadQ", "Enter"); await p.dispatchEvent("#leadQ", "change"); await p.waitForTimeout(150);
    ok(`${label}: search`, (await p.locator(".leadtbl tbody tr").count()) === 1);
    await p.fill("#leadQ", ""); await p.dispatchEvent("#leadQ", "change"); await p.waitForTimeout(150);
    await click("#adsAddLead");
    await p.fill("#lfFirst", "Test");
    await click('#leadForm button[type=submit]');
    ok(`${label}: needs email or phone`, (await text("#lfErr")).includes("email or phone"));
    await p.fill("#lfEmail", "test.person@example.com");
    await click('#leadForm button[type=submit]');
    const tAdd = await toast(); ok(`${label}: lead added [${tAdd}]`, tAdd.includes("Lead added"));
    await click("#adsAddLead");
    await p.fill("#lfFirst", "Again"); await p.fill("#lfEmail", "TEST.person@example.com");
    await click('#leadForm button[type=submit]');
    ok(`${label}: duplicate caught`, (await toast()).includes("already in your leads"));
    await click(".leadtbl tbody tr:first-child [data-leadd]");
    await click("#mProceed");
    ok(`${label}: lead deleted`, (await toast()).includes("deleted"));
    ok(`${label}: no sideways scroll (leads)`, await noHScroll());

    await go("marketing"); await click('[data-mtab="ads"]');
    await click('[data-adsv="connect"]');
    await p.evaluate(() => document.querySelectorAll("details.howto").forEach((d) => (d.open = true)));
    await shot("03-connect");
    ok(`${label}: meta connected`, (await text(".adsgrid .card .status")).includes("Connected"));
    ok(`${label}: tokens never shown`, (await p.inputValue("#amPageTok")) === "");
    await p.fill("#amPage", "abc");
    await click("#amSave");
    ok(`${label}: page id must be numbers`, (await toast()).includes("numbers only"));
    await p.fill("#amPage", "104882736512");
    await p.fill("#amCapiTok", "short");
    await click("#amSave");
    ok(`${label}: short token caught`, (await toast()).includes("too short"));
    await p.fill("#amCapiTok", "");
    await click("#amSave");
    ok(`${label}: meta saved`, (await toast()).includes("Meta settings saved"));
    const keyBefore = await p.inputValue("#agKey");
    await click("#agRotate");
    await click("#mProceed");
    ok(`${label}: google key rotated`, (await p.inputValue("#agKey")) !== keyBefore);
    ok(`${label}: no sideways scroll (connect)`, await noHScroll());

    await click('[data-adsv="follow"]');
    await shot("04-follow");
    ok(`${label}: first email chosen`, (await p.inputValue("#afFirst")) === "e_lead1");
    await p.selectOption("#afFirst", ""); await click("#afSave");
    ok(`${label}: needs first email`, (await toast()).includes("Choose the first email"));
    await p.selectOption("#afFirst", "e1"); await p.waitForTimeout(100); await click("#afSave");
    ok(`${label}: warns when no join link`, (await text(".card:has(#afSave)")).includes("doesn't use {{join_link}}"));
    await p.selectOption("#afFirst", "e_lead1"); await click("#afSave");
    await click('[data-eopen="e_lead1"]');
    await shot("05-lead-email", false);
    ok(`${label}: lead email opens in builder without unknown tags`, (await p.locator(".mt[style*='b42318']").count()) === 0);
    ok(`${label}: no sideways scroll (follow)`, await noHScroll());
    ok(`${label}: no page errors ${errors.join(" | ")}`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const r of results) console.log(r.join("  "));
  console.log(results.filter((r) => r[0] === "FAIL").length, "failed of", results.length);
})();
