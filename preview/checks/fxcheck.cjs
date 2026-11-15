// Quick fixes: the Studio rules save button clears the Ask button, deleting templates, and the
// attendance lock (midnight after the class) with no-show fees that become final then.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "fx");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "fx-test.html"), src);
const file = "file://" + path.join(__dirname, "fx-test.html");

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name, cond) => results.push([cond ? "PASS" : "FAIL", name]);
  for (const [label, opts] of [
    ["desk", { viewport: { width: 1360, height: 900 }, colorScheme: "light" }],
    ["phone", { ...devices["iPhone 13"], colorScheme: "light" }],
  ]) {
    const p = await browser.newPage(opts);
    await p.addInitScript(() => { window.__quiet = true; }); // no celebration or review pop-ups over the page
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.dismiss());
    await p.goto(file);
    await p.waitForTimeout(200);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const press = async (sel) => { await p.evaluate((x) => document.querySelector(x).click(), sel); await p.waitForTimeout(150); };
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const modal = () => p.locator("#modalRoot").textContent();

    // 1. Save studio rules vs the Ask button
    await go("policies");
    for (const where of ["top", "bottom"]) {
      await p.evaluate((w) => window.scrollTo(0, w === "top" ? 0 : document.body.scrollHeight), where);
      await p.waitForTimeout(150);
      const [a, b] = await p.evaluate(() => [document.querySelector(".savebar .btn").getBoundingClientRect(), document.querySelector("#askBtn").getBoundingClientRect()].map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })));
      const overlap = !(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t);
      ok(`${label}: save button and Ask don't overlap (${where} of page)`, !overlap);
    }
    await p.screenshot({ path: path.join(outDir, `${label}-rules.png`) });

    // 2. Deleting a template
    await go("templates");
    const tplId = await ev(`TEMPLATE_LIST.find((t) => SESSIONS.some((s) => s.tpl === t.id && s.status === "scheduled" && s.start > NOW)).id`);
    const before = await ev(`SESSIONS.filter((s) => s.tpl === "${tplId}" && s.status === "scheduled").map((s) => [s.id, s.cap, s.instr, +s.start].join()).join("|")`);
    const rows = await p.locator("[data-tpl]").count();
    await click(`[data-tpldel="${tplId}"]`);
    ok(`${label}: Delete asks first and says classes stay the same`, (await p.locator("#chkTitle").textContent()) === "Delete this template?" && /made from it stay exactly as they are\./.test(await modal()));
    ok(`${label}: the row's Delete doesn't open the editor`, (await p.locator("#tplForm").count()) === 0);
    await press("#mProceed");
    ok(`${label}: template gone from the list`, (await p.locator("[data-tpl]").count()) === rows - 1 && /deleted/.test(await toast()));
    ok(`${label}: classes made from it are unchanged`, (await ev(`SESSIONS.filter((s) => s.tpl === "${tplId}" && s.status === "scheduled").map((s) => [s.id, s.cap, s.instr, +s.start].join()).join("|")`)) === before);
    ok(`${label}: it's no longer offered for new classes`, !(await ev(`TEMPLATE_LIST.some((t) => t.id === "${tplId}")`)));
    await click("[data-tpl]");
    ok(`${label}: the editor has Delete too`, (await p.locator("#tDel").count()) === 1);
    await press("#tDel");
    await press("#mBack");
    ok(`${label}: Go back keeps it`, (await p.locator("[data-tpl]").count()) === rows - 1);

    // 3. Attendance lock
    const yday = await ev(`SESSIONS.find((s) => ymd(s.start) === "2026-11-10" && s.instr === ME.instructor && s.status === "scheduled" && s.roster.length).id`);
    await role("instructor");
    await ev(`openDrawer(${yday})`);
    ok(`${label}: instructors can't change yesterday's attendance`, (await p.locator('.drawer [data-att]:not([disabled])').count()) === 0 && /Attendance is locked/.test(await p.locator(".drawer").textContent()) && /Ask an admin/.test(await p.locator(".drawer").textContent()));
    await ev("closeDrawer()");
    await role("admin");
    await ev(`openDrawer(${yday})`);
    ok(`${label}: admins see why it's locked`, /You can still correct it; you'll be asked first/.test(await p.locator(".drawer").textContent()));
    const target = (await p.locator(".drawer [data-att]").first().getAttribute("data-att")).split(":")[0];
    const attOf = () => ev(`SESSIONS.find((s) => s.id === ${yday}).roster.find((r) => r.ci === ${target}).att`);
    const before2 = await attOf();
    await click(".drawer [data-att]");
    ok(`${label}: an admin change asks first`, /was locked at midnight at the end of Tue 10 Nov/.test(await modal()) && (await attOf()) === before2);
    await press("#mProceed");
    ok(`${label}: and goes through once confirmed`, (await attOf()) !== before2);
    await ev("closeDrawer()");

    // Today: open until midnight; a no-show fee isn't final yet.
    const today = await ev(`SESSIONS.find((s) => ymd(s.start) === "2026-11-11" && s.end < NOW && s.status === "scheduled" && s.roster.some((r) => r.att !== "no_show")).id`);
    await ev(`openDrawer(${today})`);
    ok(`${label}: today's class says when it locks`, /Attendance locks at midnight at the end of Wed 11 Nov \(tonight\)/.test(await p.locator(".drawer").textContent()));
    const ci = await ev(`SESSIONS.find((s) => s.id === ${today}).roster.find((r) => r.att !== "no_show").ci`);
    await click(`.drawer [data-att="${ci}:no_show"]`);
    await ev("closeDrawer()");
    await go("fees");
    ok(`${label}: Fees explains when each kind is final`, /no-show fees become final at midnight after the class/.test(await p.locator("#pgOther .pagehead").textContent()));
    ok(`${label}: today's no-show fee says "Final after midnight"`, (await p.locator("td .status.wait", { hasText: "Final after midnight" }).count()) === 1);
    const feeId = await ev(`FEES.find((f) => f.sid === ${today} && f.ci === ${ci} && f.status === "pending").id`);
    const invNo = await ev(`INV.list.find((x) => x.ref?.fee === ${feeId})?.no || null`);
    if (invNo) {
      await go("sales");
      await ev(`openInvoice && openInvoice(INV.list.find((x) => x.ref?.fee === ${feeId}).id)`).catch(() => {});
    }
    // Collecting it goes through feeGate, which asks while attendance is open.
    await ev(`feeGate({ ref: { fee: ${feeId} } }, () => { window.__collected = true; })`);
    await p.waitForTimeout(150);
    ok(`${label}: collecting it early asks first`, (await p.locator("#chkTitle").textContent().catch(() => "")) === "Attendance can still change" && !(await p.evaluate(() => window.__collected)));
    await press("#mProceed");
    ok(`${label}: and collects once confirmed`, await p.evaluate(() => window.__collected === true));
    const late = await ev(`(() => { let hit = false; feeGate({ ref: { fee: FEES.find((f) => f.type === "late_cancel").id } }, () => (hit = true)); return hit; })()`);
    ok(`${label}: late-cancellation fees don't ask`, late === true);

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
