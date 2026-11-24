// Booking on the web: Setup, Booking page (link, on/off, widget code and preview) and the public
// booking page (timetable, a class, packages, sign in, then on to the client app).
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "bk");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "bk-test.html"), src);
const file = "file://" + path.join(__dirname, "bk-test.html");

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
    await p.addInitScript(() => { window.__quiet = true; });
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(file);
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const go = async (id) => { await p.evaluate((x) => { if (location.hash === "#" + x) location.hash = "home"; }, id); await p.waitForTimeout(60); await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const txt = async (sel) => ((await p.locator(sel).count()) ? p.locator(sel).first().textContent() : "");
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    try {
    const buy0 = 0;
    const buy = async (planId) => { await ev(`state.ordered = null; state.coPay = null; state.buy = "${planId}"; go("checkout")`); await p.waitForTimeout(150); };

    // --- Setup, Booking page ---
    await role("admin");
    await go("booking-page");
    ok(`${label}: the form's labels sit above their fields`, await p.evaluate(() => { const t = document.querySelector("#bpIntro"), l = t.closest(".fl").querySelector(".flhead"); return l.getBoundingClientRect().bottom <= t.getBoundingClientRect().top + 1 && t.getBoundingClientRect().width >= Math.min(300, innerWidth - 120); }));
    ok(`${label}: Booking page is a Setup tab, after Payments`, (await p.locator('[data-hubtab="booking-page"]').count()) === 1 && (await p.evaluate(() => [...document.querySelectorAll("[data-hubtab]")].map((x) => x.dataset.hubtab))).join().includes("payments,booking-page"));
    ok(`${label}: it's live, with the link`, /Live/.test(await txt(".status")) && (await p.inputValue("#bpSlug")) === "demo-studio");
    ok(`${label}: the code to paste`, /data-studio-schedule="demo-studio"/.test(await txt("#bpCode")) && /widget\.js/.test(await txt("#bpCode")));
    ok(`${label}: widget preview shows classes with spots`, (await p.locator(".bpwhost .bpw li").count()) > 0 && /spots? left|Full/.test(await txt(".bpwhost .bpw")));
    await p.selectOption("#bpWLoc", "hv"); await p.waitForTimeout(150);
    ok(`${label}: one location adds it to the code`, /data-location=/.test(await txt("#bpCode")) && !/Tanjong Pagar/.test(await txt(".bpwhost .bpw ul")));
    await p.selectOption("#bpWLoc", ""); await p.waitForTimeout(120);
    await p.fill("#bpSlug", "admin"); await press("#bpSave");
    ok(`${label}: refuses a reserved link`, /taken by the app itself/.test(await txt("#bpErr")));
    await p.fill("#bpSlug", "breathe-pilates"); await press("#bpSave");
    ok(`${label}: suggests another when a link is taken`, /breathe-pilates-2/.test(await txt("#bpErr")));
    await p.fill("#bpSlug", "Demo Studio SG"); await press("#bpSave");
    ok(`${label}: explains the format`, /lowercase letters, numbers and dashes/.test(await txt("#bpErr")));
    await p.fill("#bpSlug", "demo-studio-sg"); await press("#bpSave");
    ok(`${label}: saved (${await toast()})`, /demo-studio-sg/.test(await toast()) && /demo-studio-sg/.test(await txt("#bpCode")));
    ok(`${label}: setup no h-scroll`, await noHScroll());
    await shot("1-setup");

    // --- The public booking page ---
    await press("#bpOpen");
    ok(`${label}: booking page opens`, (await p.locator("#bpRoot .bp-top h1").count()) === 1 && /demo-studio-sg/.test(await txt("#bpRoot .wc-preview")));
    const rows = await p.locator("#bpRoot .bp-row").count();
    ok(`${label}: today's classes (${rows}), no appointments`, !/Private Reformer/.test(await txt("#bpRoot .bp-list, #bpRoot .bp-empty")));
    await press('#bpRoot [data-bpday="1"]');
    const tomorrow = await p.locator("#bpRoot .bp-row").count();
    ok(`${label}: tomorrow's classes (${tomorrow})`, tomorrow > 0);
    await p.selectOption("#bpvType", "yoga"); await p.waitForTimeout(150);
    ok(`${label}: filter by class`, (await p.locator("#bpRoot .bp-row").count()) < tomorrow && !/Barre/.test(await txt("#bpRoot .bp-list, #bpRoot .bp-empty")));
    await p.selectOption("#bpvType", ""); await p.waitForTimeout(120);
    ok(`${label}: instructors by first name and initial`, /[A-Z][a-z]+ [A-Z]\. ·/.test(await txt("#bpRoot .bp-list")));
    await shot("2-page");
    await press("#bpRoot .bp-row");
    ok(`${label}: a class shows what's needed and the packages`, /To book/.test(await txt("#bpRoot .bp-sheet")) && (await p.locator("#bpRoot .bp-plan").count()) > 0);
    await shot("3-class", false);
    const sid = Number(await p.locator("#bpRoot [data-bpbook]").getAttribute("data-bpbook"));
    await press("#bpRoot [data-bpbook]");
    ok(`${label}: book asks to sign in`, /Sign in to book/.test(await txt("#bpRoot .bp-sheet")));
    await shot("4-signin", false);
    await press("#bpsGo");
    ok(`${label}: then the client app opens that class`, (await p.locator("#bpRoot").count()) === 0 && (await ev("state.role")) === "client" && (await ev("state.openId")) === sid);
    await ev("closeDrawer && closeDrawer()");
    // Packages: buy goes to checkout.
    await ev("state.bpv.tab = 'packages'");
    await role("admin"); await go("booking-page"); await press("#bpOpen");
    ok(`${label}: packages tab`, (await p.locator("#bpRoot .bp-pack").count()) > 2);
    await press("#bpRoot [data-bpbuy]");
    await press("#bpsGo");
    ok(`${label}: buy goes to the client checkout`, (await ev("state.page")) === "checkout" && (await ev("state.role")) === "client");
    // Switched off: not found.
    await role("admin"); await go("booking-page");
    await p.evaluate(() => { const d = document.querySelector("#bpOn"); d.checked = false; d.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(150);
    ok(`${label}: switched off`, /Off/.test(await txt(".status")));
    await press("#bpOpen");
    ok(`${label}: off: page not found`, /Page not found/.test(await txt("#bpRoot")));
    await press("#bpExit");
    ok(`${label}: back to the studio view`, (await p.locator("#bpRoot").count()) === 0);
    } catch (err) { ok(`${label}: ran to the end (${err.message.split("\n")[0]})`, false); }
    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
