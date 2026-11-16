// Moving your data: the studio's form (Setup → Moving your data), how we get the data, file upload
// with each file's kind recognised, what's needed before sending, and the progress after.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "mv");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8");
fs.writeFileSync(path.join(__dirname, "mv-test.html"), src);
const file = "file://" + path.join(__dirname, "mv-test.html");

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
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const press = async (sel) => { await p.evaluate((s) => document.querySelector(s).click(), sel); await p.waitForTimeout(150); };
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");

    await go("moving");
    ok(`${label}: page opens`, (await p.locator("#mvPlatform").count()) === 1);
    await press("#mvSend");
    ok(`${label}: says what's missing`, /which system you use now, when you'd like to switch, how we get your data, your OK/.test(await p.locator("#mvErr").textContent()));
    await p.selectOption("#mvPlatform", "Mindbody");
    await p.waitForTimeout(150);
    ok(`${label}: export tips for the platform`, /Mailing Lists/.test(await p.locator(".mvtips").textContent()));
    await p.fill("#mvDate", "2026-12-01");
    await p.fill("#mvClients", "420");
    await press('input[name="mvAccess"][value="password"]');
    ok(`${label}: password fields appear`, (await p.locator("#mvPass").count()) === 1);
    await p.setInputFiles("#mvFile", [{ name: "client-list.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Email\n") }, { name: "active-series.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") }]);
    await p.waitForTimeout(150);
    const kinds = await p.locator("#mvFiles tbody td:nth-child(2)").allTextContents();
    ok(`${label}: files recognised (${kinds.join(",")})`, kinds[0] === "Clients" && kinds[1] === "Class packs (classes left)");
    ok(`${label}: answers kept after re-render`, (await p.inputValue("#mvClients")) === "420" && (await p.inputValue("#mvDate")) === "2026-12-01");
    await press("#mvSend");
    ok(`${label}: login, password and consent still needed`, /the login to use, the temporary password, your OK/.test(await p.locator("#mvErr").textContent()));
    await p.fill("#mvLogin", "owner@studio.sg");
    await p.fill("#mvPass", "temp-Pass-123");
    await p.check("#mvConsent");
    ok(`${label}: no h-scroll`, await noHScroll());
    await shot("form");
    await press("#mvSend");
    const errNow = (await p.locator("#mvErr").count()) ? await p.locator("#mvErr").textContent() : "";
    ok(`${label}: no error left (${errNow})`, !errNow);
    ok(`${label}: sent (${await toast()})`, /Sent\. We'll be in touch/.test(await toast()));
    ok(`${label}: progress shows data received`, /Data received/.test(await p.locator(".mvsteps li.now").textContent({ timeout: 2000 }).catch(() => "none")));
    ok(`${label}: form locked after sending`, await p.locator("#mvPlatform").isDisabled());
    ok(`${label}: password never shown`, !(await p.content()).includes("temp-Pass-123"));
    await shot("sent");
    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
