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
    ok(`${label}: overview tiles`, /6/.test(await txt(".tile b")) && /SGD 1,426/.test(await p.locator(".tiles").textContent()));
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
    ok(`${label}: moving up just changes (${await toast()})`, /now on Signature: SGD 699 a month/.test(await toast()));
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

    // Data move: the queue, the form, files, check, import, sample, verify, undo
    await go("moves");
    ok(`${label}: every move opens`, (await p.locator("[data-move]").count()) === 3);
    await click('[data-move="barre-house"]');
    ok(`${label}: a move waiting for its form`, /Not sent yet/.test(await p.locator("#hForm").locator("..").textContent()) && /first sign-in, on the welcome page/.test(await p.locator("#hForm").locator("../..").textContent()));
    await click('a[href="#form-barre-house"]');
    ok(`${label}: the form as the studio sees it`, /Moving Barre House to us/.test(await txt("h1")) && /Mailing Lists/.test(await p.locator(".formpage").textContent()));
    await click("#fSend");
    ok(`${label}: form says what's missing`, /when you'd like to switch|how we get your data/.test(await txt("#fErr")));
    await click('input[name="mvAccess"][value="files"]');
    await p.check("#fConsent");
    await click("#fSend");
    ok(`${label}: form sent (${await toast()})`, /Sent to our team/.test(await toast()) && /Sent to our team/.test(await p.locator(".formpage").textContent()));
    await go("move-barre-house");
    ok(`${label}: answers show on the move`, /Uploading the exports themselves/.test(await p.locator(".kv").first().textContent()));
    await p.setInputFiles("#upFile", [
      { name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from("Client List\nClient ID,First Name,Last Name,Email,Mobile Phone,Client Since,Email Opt-in\n1,Ana,Lim,ana@example.com,9123 4567,25/03/2025,Yes\n2,Bo,Tan,,6.59123E+09,02/04/2025,No\n3,Cy,Ho,cy@example.com,8123 4567,14/01/2026,\n") },
      { name: "old.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("x") },
    ]);
    await p.waitForTimeout(300);
    ok(`${label}: a real CSV is read (${await txt(".fcard")})`, /clients\.csv/.test(await txt(".fcard")) && /3 rows · headers on row 2/.test(await txt(".fcard")) && /Email ← Email/.test(await txt(".fcard")));
    ok(`${label}: Excel explained in the preview`, /reads CSV only/.test(await toast()));
    await click("#runCheck");
    ok(`${label}: day-first worked out from 25/03, so it's ready`, /Ready/.test(await txt("#report .pill")) && /3 rows/.test(await txt("#report")));
    ok(`${label}: problems from the real rows`, /Phone damaged by Excel/.test(await txt("#report")) && /No email/.test(await txt("#report")));

    await go("move-core-flow");
    ok(`${label}: Core & Flow has its five exports`, (await p.locator(".fcard").count()) === 5);
    await click('[data-toggle="0"]');
    ok(`${label}: columns can be changed`, (await p.locator('[data-map^="0:"]').count()) >= 8);
    await click("#runCheck");
    ok(`${label}: check blocks on ambiguous dates`, /Can't import yet/.test(await txt("#importArea")) && /could be day-first or month-first/.test(await txt("#report")));
    await p.selectOption("#dateOrder", "dmy");
    await p.waitForTimeout(100);
    ok(`${label}: changing it clears the old check`, (await p.locator("#report").count()) === 0);
    await click("#runCheck");
    ok(`${label}: ready, every row accounted for (${await txt("#report b")})`, /Ready/.test(await txt("#report .pill")) && /Every row accounted for: 156 rows/.test(await txt("#report")));
    await p.locator("details.issue summary").first().click();
    ok(`${label}: a problem lists its rows`, /customers\.csv row \d+/.test(await p.locator("details.issue[open]").first().textContent()));
    await click("#import");
    ok(`${label}: asks to accept warnings`, /Import with these warnings\?/.test(await txt("#importAsk")) && /Clients: the studio told us 62, we found 59/.test(await txt("#importAsk")));
    await click("#importYes");
    ok(`${label}: imported (${await toast()})`, /Imported: 59 clients, 24 packs, 20 memberships, 34 bookings/.test(await toast()));
    ok(`${label}: verify needs a checked sample`, await p.locator("#verify").isDisabled());
    ok(`${label}: sample shows the old row and ours`, /Customer ID/.test(await txt(".cmp")) && /Here now/.test(await txt(".cmp")));
    await p.locator('[data-ok="0"]').check();
    await p.waitForTimeout(100);
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
    ok(`${label}: verified`, /Verified/.test(await txt("#importArea")) && /Verified/.test(await txt(".steps li.done:last-child")));

    // A studio without a move can start one; the owner's app invite comes later.
    await go("studio-reform-co");
    await click("#startMove");
    ok(`${label}: start a move from the studio`, /Reform Co\.: moving data/.test(await txt("h1")) && /Move started/.test(await toast()));
    await go("studio-barre-house");
    ok(`${label}: owner invited, not signed in yet`, /Invited/.test(await txt("#hTeam + div")) && /Send the invite again/.test(await txt("#inviteOwner")));
    await click("#inviteOwner");
    ok(`${label}: send the invite again`, /Invite sent to Grace Chua/.test(await toast()));

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
    ok(`${label}: price shown`, /Essentials: SGD 129 a month/.test(await txt("#nsPrice")));
    await shot("new", false);
    await click('#newForm button[type="submit"]');
    ok(`${label}: studio added (${await toast()})`, /Pilates Loft added\. Invite sent to lin@example\.com: their first sign-in opens the welcome form\./.test(await toast()) && /Pilates Loft/.test(await txt("h1")));
    ok(`${label}: its move is waiting for the form`, /Welcome form not sent yet/.test(await p.locator("#hMove").locator("..").textContent()));

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
