const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "s10");
fs.mkdirSync(outDir, { recursive: true });
// A copy of the preview with a test hook, so checks can reach the sample data.
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "s10-test.html"), src);
const file = "file://" + path.join(__dirname, "s10-test.html");

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
    const navLabels = () => p.evaluate(() => [...document.querySelectorAll("#side .navitem span:not(.count)")].map((x) => x.textContent));

    // Menu
    const nav = await navLabels();
    ok(`${label}: admin menu has Sales and Shop`, nav.includes("Sales") && nav.includes("Shop"));

    // 1. Sales
    await go("sales");
    ok(`${label}: transactions list`, (await p.locator(".stbl tbody tr").count()) > 5);
    ok(`${label}: summary tiles`, (await p.locator(".stiles .rtile").count()) === 4);
    ok(`${label}: sales no h-scroll`, await noHScroll());
    await shot("sales");
    await click('[data-sst="open"]');
    const openRows = await p.locator(".stbl tbody tr[data-inv]").count();
    ok(`${label}: unpaid filter (${openRows})`, openRows >= 3);
    await click('.stbl tbody tr[data-inv] button');
    ok(`${label}: invoice detail opens`, await p.locator("#ivT").isVisible());
    await click("#ivDocI");
    ok(`${label}: invoice document`, await p.locator(".invdoc .ivtitle h3").textContent() === "Invoice");
    await shot("invoice-doc", false);
    await p.keyboard.press("Escape");
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));
    await click('.stbl tbody tr[data-inv] button');
    await click("#ivPay");
    await click('#pmForm button[type=submit]');
    ok(`${label}: mark paid`, /paid by card/i.test(await toast()));
    await click('[data-sst="paid"]');
    await click('.stbl tbody tr[data-inv] button');
    ok(`${label}: receipt button`, await p.locator("#ivDocR").isVisible());
    await click("#ivDocR");
    ok(`${label}: receipt doc`, (await p.locator(".invdoc .ivtitle h3").textContent()) === "Receipt");
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));
    await click('.stbl tbody tr[data-inv] button');
    await click("#ivMail");
    ok(`${label}: email receipt`, /emailed to/i.test(await toast()));
    await click("#ivRefund");
    await p.fill("#rfAmt", "10");
    await p.fill("#rfWhy", "Changed their mind");
    await click('#rfForm button[type=submit]');
    await click("#mProceed");
    ok(`${label}: refund`, /Refunded SGD 10\.00/.test(await toast()));
    await click('[data-stab="design"]');
    ok(`${label}: invoice design preview`, await p.locator("#idPrev .invdoc").isVisible());
    await p.fill("#idName", "Breathe Pilates");
    ok(`${label}: live preview updates`, /Breathe Pilates/.test(await p.locator("#idPrev").textContent()));
    await p.locator("#idTax").check(); await p.waitForTimeout(150);
    ok(`${label}: tax line`, /Includes GST at 9%/.test(await p.locator("#idPrev").textContent()));
    await p.fill("#idAcc", "#FFEE00"); await p.locator("#idAcc").dispatchEvent("change"); await p.waitForTimeout(150);
    await click("#idSave");
    ok(`${label}: low-contrast accent refused`, /darker/.test(await toast()));
    await p.fill("#idAcc", "#7C3AED"); await p.locator("#idAcc").dispatchEvent("change"); await p.waitForTimeout(150);
    await click("#idSave");
    ok(`${label}: design saved`, /Saved/.test(await toast()));
    ok(`${label}: design no h-scroll`, await noHScroll());
    await shot("invoice-design");

    // 2. Membership hold (admin client profile + client view)
    const why = await ev('pkgCheck(CPKG.find((x) => x.hold), 0, SESSIONS.find((s) => s.start > NOW && s.type === "reformer"))');
    ok(`${label}: held membership can't book`, /on hold until it's paid/.test(why || ""));
    await role("client");
    await go("my-packages");
    ok(`${label}: client hold banner`, await p.locator(".holdbox").first().isVisible());
    await shot("hold-client");
    await click('[data-hold^="card:"]');
    await p.fill("#hcNum", "4242 4242 4242 4242"); await p.fill("#hcExp", "12 / 29"); await p.fill("#hcCvc", "123");
    await click('#hcForm button[type=submit]');
    ok(`${label}: card updated, hold lifted`, /active again/.test(await toast()) && (await p.locator(".holdbox").count()) === 0);
    await click("#myRcpts");
    ok(`${label}: client receipts list`, (await p.locator("[data-mydoc]").count()) > 2);
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));

    // 10. Client shop
    const cnav = await navLabels();
    ok(`${label}: client menu has Shop, not Gift cards`, cnav.includes("Shop") && !cnav.includes("Gift cards"));
    await go("shop");
    ok(`${label}: client merch grid`, (await p.locator(".prodcard").count()) === 4);
    await click('[data-psel="pr1:L"]');
    await click('[data-padd="pr1"]');
    await click('[data-padd="pr2"]');
    ok(`${label}: basket`, (await p.locator(".basket li").count()) === 2);
    await shot("shop-client");
    await click("#bkPlace");
    ok(`${label}: order placed`, /Order 1004 placed/.test(await toast()));
    await click('[data-cshtab="gifts"]');
    ok(`${label}: gift cards in shop`, await p.locator(".gpick").first().isVisible());
    ok(`${label}: client shop no h-scroll`, await noHScroll());
    // Hidden when empty
    await ev("PRODUCTS.forEach((x) => (x.onSale = false)); GC.on = false; render();");
    ok(`${label}: shop hidden when empty`, !(await navLabels()).includes("Shop"));
    await ev('PRODUCTS.forEach((x) => (x.onSale = x.id !== "pr5")); GC.on = true; render();');

    // FOH pickups
    await role("foh");
    await go("pickups");
    ok(`${label}: FOH pickups shows shop orders`, (await p.locator(".sorder").count()) >= 3);
    await click('[data-socollect="so2"]');
    await click('#pmForm button[type=submit]');
    ok(`${label}: take payment and hand over`, /handed over/.test(await toast()));
    await shot("pickups");

    // Admin shop
    await role("admin");
    await go("shop");
    ok(`${label}: admin products`, (await p.locator(".prodcard").count()) === 5);
    await click("#prodNew");
    await p.fill("#prName", "Yoga mat"); await p.fill("#prPrice", "68"); await p.fill("#prStock", "10");
    await click('#prForm button[type=submit]');
    ok(`${label}: product added`, /Yoga mat added/.test(await toast()));
    await shot("shop-admin");
    await click('[data-shtab="giftcards"]');
    ok(`${label}: gift card settings in shop`, await p.locator("#gcOn").count() === 1);
    await go("marketing");
    ok(`${label}: no gift cards tab in marketing`, (await p.locator('[data-mtab="giftcards"]').count()) === 0);

    // 3. Calendar: double-click and drag (desktop only)
    await go("schedule");
    if (!phone) {
      await ev('state.view = "week"; state.anchor = new Date(2026, 10, 12); render();');
      const col = p.locator(".dcol[data-date]").nth(3);
      await col.scrollIntoViewIfNeeded();
      const box = await col.boundingBox();
      await p.mouse.dblclick(box.x + 10, box.y + 72 * 3 + 5);
      ok(`${label}: double-click asks first`, /Add a class here/.test(await p.locator("#chkTitle, .warnmodal h2").first().textContent()));
      await click("#mProceed");
      ok(`${label}: then opens new class form`, (await p.locator("#formTitle").textContent()) === "New class");
      const st = await p.evaluate(() => [document.querySelector("#fDate").value, document.querySelector("#classForm").textContent.includes("3:00")]);
      ok(`${label}: form prefilled with date (${st[0]})`, st[0] === "2026-11-12");
      await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));
      // Drag a future class down an hour
      const target = await ev('(() => { const s = SESSIONS.find((x) => x.start > new Date(2026, 10, 12, 8) && x.start < new Date(2026, 10, 12, 18) && x.status === "scheduled"); return { id: s.id, h: s.start.getHours(), m: s.start.getMinutes() }; })()');
      const evb = p.locator(`.ev button[data-open="${target.id}"]`).first();
      await evb.scrollIntoViewIfNeeded(); await p.mouse.wheel(0, -60); await p.waitForTimeout(100);
      const eb = await evb.boundingBox();
      await p.mouse.move(eb.x + 20, eb.y + 8); await p.mouse.down(); await p.mouse.move(eb.x + 20, eb.y + 30, { steps: 4 }); await p.mouse.move(eb.x + 20, eb.y + 8 + 72, { steps: 6 });
      ok(`${label}: drag shows ghost`, await p.locator(".evghost").isVisible());
      await p.mouse.up(); await p.waitForTimeout(200);
      ok(`${label}: drag asks first`, /Move this/.test(await p.locator(".warnmodal").first().textContent()));
      await shot("drag-confirm", false);
      await p.locator("#mProceed").click(); await p.waitForTimeout(200);
      const after = await ev(`SESSIONS.find((x) => x.id === ${target.id}).start.getHours()`);
      ok(`${label}: class moved an hour (${target.h} -> ${after})`, after === target.h + 1);
      ok(`${label}: drawer didn't open from the drag`, (await p.locator(".drawer").count()) === 0);
    }

    // 6. No room
    await p.evaluate(() => (document.querySelector("#newClass") || {}).click?.());
    await p.waitForTimeout(150);
    const ropts = await p.evaluate(() => [...document.querySelectorAll("#fRoom option")].map((o) => o.textContent));
    ok(`${label}: "No room" options`, ropts.filter((o) => o.startsWith("No room")).length === 2);
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));

    // 7. Journey goal
    await go("marketing");
    if (!phone) { await ev('state.jOpen = JOURNEYS[0].id; state.jSel = "trigger"; render();');
    const g = await p.evaluate(() => [...document.querySelectorAll("#jtG option")].map((o) => o.value).filter(Boolean));
    ok(`${label}: goal has 3 options (${g})`, g.length === 3); }
    await ev("state.jOpen = null; render();");

    // 8. Class types split
    await go("class-types");
    ok(`${label}: class types two sections`, (await p.locator(".ctsec").count()) === 2);
    await click('[data-newtype="appointment"]');
    ok(`${label}: new appointment type preset`, await p.evaluate(() => document.querySelector("#modalRoot").textContent.length > 0));
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));
    await shot("class-types");

    // 9. Categories
    await go("packages");
    await ev("openCategories()");
    await p.waitForTimeout(100);
    ok(`${label}: categories collapsed rows`, (await p.locator(".catrow").count()) >= 4 && (await p.locator(".catrow.open").count()) === 0);
    await click("[data-catopen]");
    ok(`${label}: open one category`, (await p.locator(".catrow.open [data-catname]").count()) === 1);
    await click("#catAddOpen");
    await p.fill("#catNew", "Corporate");
    await click("#catAdd");
    ok(`${label}: category added and open`, (await p.locator('.catrow.open [data-catname]').inputValue()) === "Corporate");
    await shot("categories", false);
    await click('#catForm button[type=submit]');

    // 4. Writers
    await go("announcements");
    await p.fill("#wrBrief", "lift broken at tanjong pagar, use stairs");
    await click("#wrGo");
    ok(`${label}: announcement drafted`, /Lift out of order/.test(await p.inputValue("#anT")));
    await go("marketing");
    await ev('state.mtab = "campaigns"; render();');
    await click("#mDraftCamp");
    await p.fill("#cdBrief", "intro offer for december, reformer, bring a friend");
    await click('#cdForm button[type=submit]');
    ok(`${label}: campaign drafted`, /Drafted, not sent/.test(await toast()));
    ok(`${label}: draft row`, (await p.locator("[data-csend]").count()) === 1);
    await go("agents");
    await click('[data-agtab="usage"]');
    ok(`${label}: usage says AI credits`, /AI credits this month/.test(await p.locator("#pgOther").textContent()));
    await click('[data-agtab="writers"]');
    ok(`${label}: writers tab`, (await p.locator("[data-wgo]").count()) === 2);

    // 5. Email
    await go("comms");
    await click('[data-ibxch="email"]');
    ok(`${label}: email threads`, (await p.locator(".ibx-row").count()) >= 2);
    await click(".ibx-row");
    await p.fill("#ibxText", "Hi Farah, attached is your receipt.");
    await click("#ibxSend");
    ok(`${label}: email reply`, /Sent from hello@/.test(await toast()));
    await shot("email");
    await click('[data-ctab="settings"]');
    ok(`${label}: email settings card`, /Your email inbox/.test(await p.locator("#pgOther").textContent()));

    // 11. Report export
    await go("reports");
    await click("#rExport");
    ok(`${label}: export menu`, await p.locator("#exCsv").isVisible());
    const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 3000 }).catch(() => null), p.locator("#exCsv").click()]);
    ok(`${label}: CSV download`, !!dl && /\.csv$/.test(dl.suggestedFilename()));
    await click("#rExport");
    await click("#exVis");
    ok(`${label}: visual report`, await p.locator(".vreport .vrkpi").count() === 4);
    await shot("visual-report", false);
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
