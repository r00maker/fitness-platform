// The help centre link: at the bottom of the menu (under Preferences) for owners and admins, Front
// of House and instructors, never for clients; it opens the help centre in a new tab, and stays
// put as you move between pages, on a computer and on a phone.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "hp");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "hp-test.html"), src);
const file = "file://" + path.join(__dirname, "hp-test.html");

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name, cond) => results.push([cond ? "PASS" : "FAIL", name]);
  for (const [label, opts] of [["desk", { viewport: { width: 1360, height: 900 } }], ["phone", { ...devices["iPhone 13"] }]]) {
    const p = await browser.newPage(opts);
    await p.addInitScript(() => { window.__quiet = true; });
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(file); await p.waitForTimeout(300);
    const role = async (r) => { await p.locator("#roles").getByRole("button", { name: r, exact: true }).click(); await p.waitForTimeout(250); };
    const link = () => p.locator("#helpLink");
    const after = () => p.evaluate(() => document.querySelector("#helpLink")?.previousElementSibling?.dataset.nav);

    for (const r of ["Admin", "Front of House", "Instructor"]) {
      await role(r);
      ok(`${label}: ${r} has Help centre, under Preferences`, (await link().count()) === 1 && (await after()) === "preferences");
    }
    ok(`${label}: it opens in a new tab, safely`, (await link().getAttribute("target")) === "_blank" && (await link().getAttribute("rel")) === "noopener" && /claude\.ai\/artifact\//.test(await link().getAttribute("href")));
    ok(`${label}: screen readers hear it opens a new tab`, /opens in a new tab/.test(await link().getAttribute("aria-label")));
    await role("Client");
    ok(`${label}: clients don't have it`, (await link().count()) === 0);
    await role("Admin");
    await p.evaluate(() => (location.hash = "reports")); await p.waitForTimeout(250);
    await p.evaluate(() => (location.hash = "schedule")); await p.waitForTimeout(250);
    ok(`${label}: it stays as you move between pages`, (await link().count()) === 1);
    if (label === "desk") {
      const [tab] = await Promise.all([p.context().waitForEvent("page"), link().click()]);
      ok("desk: clicking it opens a new tab at the help centre", /claude\.ai\/artifact\/RC6G9kQ871d3ifvWyuGsds/.test(tab.url()));
      await tab.close();
      await p.locator(".side").screenshot({ path: path.join(outDir, "menu.png") });
    } else {
      await p.locator(".menubtn, #menuBtn, [aria-label*='enu']").first().click().catch(() => {});
      await p.waitForTimeout(250);
      ok("phone: in the menu", await link().isVisible());
    }
    ok(`${label}: no errors`, !errors.length);
    await p.close();
  }
  await browser.close();
  fs.unlinkSync(path.join(__dirname, "hp-test.html"));
  for (const [r, n] of results) console.log(r, n);
  const failed = results.filter(([r]) => r === "FAIL").length;
  console.log(failed, "failed of", results.length);
  process.exit(failed ? 1 : 0);
})();
