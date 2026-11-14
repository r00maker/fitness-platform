const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "ag");
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
    p.on("pageerror", (e) => errors.push(e.message + " @@ " + (e.stack || "").split("\n").slice(1, 3).join(" / ")));
    await p.goto(file);
    const phone = label === "phone";
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n, full = true) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: full });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const groups = () => p.evaluate(() => [...document.querySelectorAll("#side .navgrp")].map((g) => `${g.querySelector("h3").textContent}: ${[...g.querySelectorAll(".navitem span:not(.count)")].map((x) => x.textContent).join(", ")}`));

    // 1. Grouped menu
    const adminGroups = await groups();
    ok(`${label}: admin menu groups ${JSON.stringify(adminGroups)}`, JSON.stringify(adminGroups.map((g) => g.split(":")[0])) === JSON.stringify(["Day to day", "Clients & sales", "Growth", "Team", "Setup", "Account"]));
    ok(`${label}: Agents under Team`, adminGroups.find((g) => g.startsWith("Team")).includes("Agents"));
    await role("client");
    const cg = await groups();
    ok(`${label}: client menu ${JSON.stringify(cg)}`, cg[0].startsWith("Classes: Book a class, My bookings") && cg[1].startsWith("Packages & rewards"));
    await role("instructor");
    ok(`${label}: instructor menu ${JSON.stringify(await groups())}`, (await groups())[0].startsWith("Day to day: My schedule, Cover requests"));
    await role("foh");
    ok(`${label}: foh menu ${JSON.stringify(await groups())}`, (await groups())[0].startsWith("Day to day: Schedule"));
    await role("admin");
    if (!phone) await p.locator("#side").screenshot({ path: path.join(outDir, `${label}-01-menu.png`) });

    // 2. Edit many: one button, pick on the calendar or filter
    await go("schedule");
    ok(`${label}: one Edit many button`, (await p.locator("#bulkChange").textContent()) === "Edit many" && (await p.locator("#selectMode").count()) === 0);
    await click("#bulkChange");
    ok(`${label}: modal opens with filters`, (await p.locator("#bkTitle").textContent()) === "Edit many classes");
    await click('[data-bksrc="picked"]');
    ok(`${label}: picking mode`, (await p.locator(".selbar").count()) === 1 && !(await p.locator(".modal").count()));
    await click("#next");
    await p.locator("[data-open]").nth(2).click(); await p.waitForTimeout(100);
    await p.locator("[data-open]").nth(5).click(); await p.waitForTimeout(100);
    ok(`${label}: picked count`, /2 classes picked/.test(await p.locator(".selbar b").textContent()));
    await shot("02-picking", false);
    await click('[data-sel="edit"]');
    ok(`${label}: modal shows picked`, /Picked on the calendar \(2\)/.test(await p.locator(".modal").textContent()));
    await p.locator(".modal").screenshot({ path: path.join(outDir, `${label}-03-editmany.png`) });
    await click(".modal [data-mclose].btn");
    await click('[data-sel="done"]');

    // 3. Reports zoom
    await go("reports");
    await click('[data-rtab="classes"]');
    ok(`${label}: zoom bar`, await p.locator(".rzoom").count() === 1);
    const held0 = await p.locator(".rtile .rv").first().textContent();
    await click('[data-rzband="evening"]');
    const held1 = await p.locator(".rtile .rv").first().textContent();
    ok(`${label}: evenings narrows (${held0} -> ${held1})`, Number(held1) < Number(held0) && /evenings/.test(await p.locator(".rzon").textContent()));
    await p.selectOption("#rzLoc", "hv");
    ok(`${label}: location zoom`, /Holland Village/.test(await p.locator(".rzon").textContent()));
    await click("#rzClear");
    ok(`${label}: heat grid`, (await p.locator(".rhc").count()) > 10 && /Busiest/.test(await p.locator(".rheat").locator("xpath=../..").textContent()));
    await click(".rhc");
    ok(`${label}: heat cell zooms`, /Showing/.test(await p.locator(".rzon").textContent()));
    await click("#rzClear");
    ok(`${label}: reports no h-scroll`, await noHScroll());
    await shot("04-reports");

    // 4. Agents page
    await go("agents");
    ok(`${label}: two sample agents`, (await p.locator(".agcard").count()) === 2);
    const agnes = await p.locator(".agcard").nth(1).textContent();
    ok(`${label}: Agnes description`, /Every day at 10:00pm, it checks tomorrow's classes for fewer than 3 booked and tells owners and admins\./.test(agnes));
    ok(`${label}: agents no h-scroll`, await noHScroll());
    await shot("05-agents");
    await click('[data-agprev="2"]');
    const pv = await p.locator(".modal").textContent();
    ok(`${label}: preview shows push to admins only, no names`, /What Agnes would send now/.test(pv) && !/Chloe|Dev Kumar/.test(pv));
    await p.locator(".modal").screenshot({ path: path.join(outDir, `${label}-06-preview.png`) });
    await click(".modal [data-mclose].btn");
    // New agent from a starter
    await click("#agNew");
    ok(`${label}: six starters`, (await p.locator(".agstarter").count()) === 6);
    await click('[data-agst="3"]');
    ok(`${label}: editor prefilled with Nina`, (await p.inputValue("#agName")) === "Nina");
    ok(`${label}: needed sees locked`, await p.locator("#agSee_instructors").isDisabled());
    await p.fill("#agName", "Jeff");
    await click('#agForm button[type="submit"]');
    ok(`${label}: duplicate name refused`, /already have an agent called Jeff/.test(await toast()));
    await p.fill("#agName", "Nina");
    await click('[data-agrole="front_desk"]');
    ok(`${label}: description updates`, /tells owners, admins and front of house/.test(await p.locator(".agdesc").textContent()));
    await p.locator(".modal").screenshot({ path: path.join(outDir, `${label}-07-editor.png`) });
    await click('#agForm button[type="submit"]');
    ok(`${label}: created`, (await p.locator(".agcard").count()) === 3);
    // Before-class option only for per-class jobs; switch Jeff to before class
    await click('[data-agedit="1"]');
    await click('[data-agwhen="before_class"]');
    ok(`${label}: before-class wording`, /^2 hours before each class, it reminds whoever is covering a class\./.test(await p.locator(".agdesc").textContent()));
    await click(".modal [data-mclose].btn");
    // Pause all
    await click("#agPause");
    ok(`${label}: paused`, /All agents are paused/.test(await p.locator("#pgOther").textContent()));
    await click("#agPause");
    // Assistant + usage tabs
    await click('[data-agtab="assistant"]');
    ok(`${label}: assistant settings`, /What it never does/.test(await p.locator("#pgOther").textContent()));
    await click('[data-agtab="usage"]');
    ok(`${label}: usage`, /62 of 300 used/.test(await p.locator("#pgOther").textContent()));
    await shot("08-usage", false);

    // 5. Bell
    await role("instructor");
    const bell = p.locator("#bellBtn");
    ok(`${label}: bell for instructor`, (await bell.count()) === 1);
    await bell.click(); await p.waitForTimeout(150);
    const bp = await p.locator(".bellpanel").textContent();
    ok(`${label}: bell panel (${bp.slice(0, 160)})`, /From your agents/.test(bp) && /Jeff/.test(bp) && /you're covering a class tomorrow/.test(bp) && /Agents that can message you/.test(bp));
    await shot("09-bell", false);
    await p.locator(".bellpanel [data-agmute]").first().click(); await p.waitForTimeout(150);
    ok(`${label}: mute`, /won't get messages from Jeff/.test(await toast()));
    await role("client");
    ok(`${label}: no bell or Ask for clients`, (await p.locator("#bellBtn").count()) === 0 && (await p.locator("#askBtn").count()) === 0);

    // 6. Ask
    await role("admin");
    await go("schedule");
    await click("#askBtn");
    ok(`${label}: ask panel`, (await p.locator(".askpanel").count()) === 1);
    const s0 = await p.locator(".asksugg button").first().textContent();
    ok(`${label}: suggestion (${s0})`, /^Why can't I book .* into Saturday's/.test(s0));
    await p.locator(".asksugg button").first().click(); await p.waitForTimeout(700);
    const a1 = await p.locator(".askmsg.bot").last().textContent();
    ok(`${label}: booking answer (${a1.slice(0, 160)})`, /waiver|package/.test(a1) && /Saturday|Sat \d+ Nov/.test(a1));
    await p.fill("#askIn", "Can you refund Chloe Ng's recent package purchase?");
    await p.press("#askIn", "Enter"); await p.waitForTimeout(700);
    const a2 = await p.locator(".askmsg.bot").last().textContent();
    ok(`${label}: refund refused with directions (${a2.slice(0, 120)})`, /can't do anything involving payments, including refunds, so I can't refund Chloe Ng/.test(a2) && /Clients/.test(a2));
    await shot("10-ask", false);
    // An offer that's confirmed
    const target = await p.evaluate(() => {
      const sx = [...document.querySelectorAll("[data-open]")].map((b) => Number(b.dataset.open));
      return null;
    });
    await p.fill("#askIn", "book chloe ng into tomorrow's 7am class");
    await p.press("#askIn", "Enter"); await p.waitForTimeout(700);
    const a3 = await p.locator(".askmsg.bot").last().textContent();
    const hasOffer = (await p.locator("[data-asyes]").count()) > 0;
    ok(`${label}: answer for book (${a3.slice(0, 140)})`, a3.length > 20);
    if (hasOffer) {
      await p.locator("[data-asyes]").last().click(); await p.waitForTimeout(200);
      ok(`${label}: confirmed (${(await p.locator(".askmsg.bot").last().textContent()).slice(0, 100)})`, /^Done\./.test(await p.locator(".askmsg.bot").last().textContent()));
    }
    await p.fill("#askIn", "what's the weather");
    await p.press("#askIn", "Enter"); await p.waitForTimeout(700);
    ok(`${label}: fallback`, /preview version/.test(await p.locator(".askmsg.bot").last().textContent()));
    ok(`${label}: ask no h-scroll`, await noHScroll());
    await click("#askClose");
    // Front of House: can't book
    await role("foh");
    await click("#askBtn");
    await p.locator(".asksugg button").first().click(); await p.waitForTimeout(700);
    const a4 = await p.locator(".askmsg.bot").last().textContent();
    ok(`${label}: FOH told only admins can book (${a4.slice(0, 160)})`, /only owners and admins can book clients in/i.test(a4) && !/can't be used:/.test(a4));
    await click("#askClose");
    // Turning the assistant off for a role hides Ask.
    await role("admin");
    await go("agents");
    await click('[data-agtab="assistant"]');
    await click('[data-asrole="front_desk"]');
    await role("foh");
    ok(`${label}: Ask hidden when role off`, (await p.locator("#askBtn").count()) === 0);

    ok(`${label}: no page errors ${JSON.stringify(errors.slice(0, 3))}`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
