// HQ preview: overview, studios, a studio's page (plan change, support access, notes), adding a
// studio, the data-move workspace (check, import with warnings, sample, verify, undo) and the assistant.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "hq");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "hq-preview.html"), "utf8");
fs.writeFileSync(path.join(__dirname, "hq-test.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>${src}</body></html>`);
const file = "file://" + path.join(__dirname, "hq-test.html");

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
    const go = async (h) => { await p.evaluate((x) => (location.hash = x), h); await p.waitForTimeout(100); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(100); };
    const toast = () => p.locator("#toast").textContent();
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const txt = (sel) => p.locator(sel).first().textContent();

    // Overview
    ok(`${label}: overview tiles`, /6/.test(await txt(".tile b")) && /USD 1,147/.test(await p.locator(".tiles").textContent()));
    ok(`${label}: needs attention lists problems first`, /Sweat Lab|Reform Co\./.test(await txt("#hAtt + div")));
    ok(`${label}: overview no h-scroll`, await noHScroll());
    await shot("overview");

    // Studios: search and open
    await go("studios");
    await p.fill("#q", "sweat");
    await p.waitForTimeout(100);
    ok(`${label}: search narrows`, (await p.locator("#studioTable tbody tr").count()) === 1);
    await p.fill("#q", "");
    await p.selectOption("#filter", "onboarding");
    ok(`${label}: filter by status`, (await p.locator("#studioTable tbody tr").count()) === 2);
    ok(`${label}: studios no h-scroll`, await noHScroll());
    await shot("studios");
    await click('[data-open="core-flow"]');
    ok(`${label}: opens the studio`, /Core & Flow/.test(await txt("h1")));

    // Plan change: moving down asks first
    await p.selectOption("#planSel", "essentials");
    await click("#planGo");
    ok(`${label}: too many locations for Essentials`, /has 2 locations/.test(await txt("#planAsk")));
    await p.selectOption("#planSel", "signature");
    await click("#planGo");
    ok(`${label}: moving up just changes (${await toast()})`, /now on Signature: USD 599 a month/.test(await toast()));
    await p.selectOption("#planSel", "growth");
    await click("#planGo");
    ok(`${label}: moving down asks`, /Change this studio's plan\?/.test(await txt("#planAsk")));
    await click("#planYes");

    // Support access: client details only while open
    ok(`${label}: no client table before access`, (await p.locator("#clientTable").count()) === 0);
    await click("#accessGo");
    ok(`${label}: a reason is needed`, /Say why/.test(await txt("#accessErr")));
    await p.fill("#accReason", "Owner asked why Chloe can't book Saturday");
    await click("#accessGo");
    ok(`${label}: client table while open`, (await p.locator("#clientTable tbody tr").count()) === 3 && /min left/.test(await txt(".timer")));
    await p.fill("#noteBody", "Called Mei about the date format.");
    await click("#noteAdd");
    ok(`${label}: note added`, /Called Mei about the date format/.test(await txt("#notes")));
    ok(`${label}: studio no h-scroll`, await noHScroll());
    await shot("studio");

    // Assistant
    await go("assistant");
    await click('[data-q="Why are Sweat Lab\'s messages failing?"]');
    ok(`${label}: assistant answers with what it looked at`, /Template paused/.test(await txt(".msg.ai")) && /delivery_problems/.test(await txt(".msg.ai .looked")));
    await p.fill("#askText", "Why can't Chloe book Saturday?");
    await click("#askForm button");
    ok(`${label}: client question uses support access`, /only covers Beginner classes/.test(await p.locator(".msg.ai").last().textContent()));
    ok(`${label}: assistant no h-scroll`, await noHScroll());
    await shot("assistant");

    // Data move
    await go("moves");
    await click("[data-move]");
    ok(`${label}: move workspace`, /moving from Momence/.test(await txt("h1")) && (await p.locator("[data-kind]").count()) === 5);
    await click("#runCheck");
    ok(`${label}: check blocks on ambiguous dates`, /Can't import yet/.test(await txt("#importArea")) && /could be day-first or month-first/.test(await txt("#report")));
    await p.selectOption("#dateOrder", "dmy");
    await p.waitForTimeout(100);
    await click("#runCheck");
    ok(`${label}: ready after setting the date order`, /Ready/.test(await txt("#report .pill")) && /Every row accounted for: 1,194 rows/.test(await txt("#report")));
    await click("#import");
    ok(`${label}: asks to accept warnings`, /Import with these warnings\?/.test(await txt("#importAsk")));
    await click("#importYes");
    ok(`${label}: imported (${await toast()})`, /Imported: 417 clients/.test(await toast()));
    ok(`${label}: verify needs a checked sample`, await p.locator("#verify").isDisabled());
    await p.locator('[data-ok="0"]').check();
    await p.waitForTimeout(100);
    ok(`${label}: sample marks progress`, /Sample compared/.test(await txt(".steps li.now")));
    ok(`${label}: move no h-scroll`, await noHScroll());
    await shot("move");
    await click("#undo");
    ok(`${label}: undo`, /undone/.test(await toast()));
    await click("#runCheck");
    await click("#import");
    await click("#importYes");
    await p.locator('[data-ok="1"]').check();
    await p.waitForTimeout(100);
    await click("#verify");
    ok(`${label}: verified`, /Verified/.test(await txt("#importArea")) && /Verified/.test(await txt(".steps li.now")));

    // Roles
    await p.selectOption("#asRole", "support");
    await go("new-studio");
    ok(`${label}: support can't add studios`, /can't add studios/.test(await txt(".callout")));
    await p.selectOption("#asRole", "onboarding");
    await p.waitForTimeout(100);
    await click('#newForm button[type="submit"]');
    ok(`${label}: form says what's missing`, /Add the studio's name/.test(await txt("#nsErr")));
    await p.fill("#nsName", "Pilates Loft");
    await p.fill("#nsFirst", "Lin");
    await p.fill("#nsLast", "Ho");
    await p.fill("#nsEmail", "lin@example.com");
    await p.selectOption("#nsPlan", "essentials");
    ok(`${label}: price shown`, /Essentials: USD 99 a month/.test(await txt("#nsPrice")));
    await shot("new", false);
    await click('#newForm button[type="submit"]');
    ok(`${label}: studio added (${await toast()})`, /Pilates Loft added. Invite sent to lin@example.com/.test(await toast()) && /Pilates Loft/.test(await txt("h1")));

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
