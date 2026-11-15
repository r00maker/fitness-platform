// Reviews (the client pop-up, the Google offer, the Reviews page), client feedback and the
// staff Feedback page, and celebration pop-ups for instructors and owners.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "rv");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "rv-test.html"), src);
const file = "file://" + path.join(__dirname, "rv-test.html");

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name, cond) => results.push([cond ? "PASS" : "FAIL", name]);
  for (const [label, opts] of [
    ["desk", { viewport: { width: 1360, height: 900 }, colorScheme: "light" }],
    ["desk-dark", { viewport: { width: 1360, height: 900 }, colorScheme: "dark" }],
    ["phone", { ...devices["iPhone 13"], colorScheme: "light" }],
  ]) {
    const ctx = await browser.newContext(opts);
    const p = await ctx.newPage();
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.dismiss());
    ctx.on("page", (pg) => pg.close().catch(() => {})); // "Share on Google" opens Google in a new tab
    await p.goto(file);
    await p.waitForTimeout(300);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(200); };
    const press = async (sel) => { await p.evaluate((x) => document.querySelector(x).click(), sel); await p.waitForTimeout(150); };
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(200); };
    const toast = () => p.locator(".toast").last().textContent().catch(() => "");
    const modal = () => p.locator("#modalRoot").textContent();
    const shot = (n) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`) });
    const noHScroll = async () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const clearModal = () => p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));

    // --- Celebrations: the owner lands on Home ---
    await p.waitForTimeout(500);
    ok(`${label}: owner gets a celebration on Home`, /5,000 visits!/.test(await modal()));
    await shot("celebrate-milestone");
    await press("#ceNext");
    const recap = await modal();
    ok(`${label}: then the studio's fortnight`, /Your fortnight · 26 Oct – 8 Nov/.test(recap) && /classes held/.test(recap));
    ok(`${label}: with Claude's review summary and self-care tips`, /What clients said/.test(recap) && /Summary written by Claude/.test(recap) && /Look after yourself/.test(recap));
    await shot("celebrate-recap");
    await press("#ceNext");
    ok(`${label}: Thanks closes it`, (await modal()).trim() === "");
    await go("schedule"); await go("home"); await p.waitForTimeout(500);
    ok(`${label}: shown once per visit`, (await modal()).trim() === "");
    ok(`${label}: without AI, set wording and no summary`, (await ev(`(() => { STUDIO.aiRecaps = false; const r = studioRecap(); STUDIO.aiRecaps = true; return r.summary === null && !r.byAi; })()`)));

    // --- Home attention includes low reviews and feedback ---
    ok(`${label}: Home lists low reviews to follow up`, /low reviews? to follow up/.test(await p.locator(".hattsec").textContent()));

    // --- Staff Feedback page ---
    await go("feedback");
    ok(`${label}: Feedback has Needs attention plus one tab per category`, (await p.locator("[data-fbst]").count()) === 7);
    ok(`${label}: low reviews flagged`, (await p.locator(".fbcard.lowrv").count()) === 2);
    const newBefore = await ev("fbNew().length");
    ok(`${label}: new feedback listed (${newBefore})`, newBefore >= 3 && (await p.locator(".fbcard:not(.lowrv)").count()) === newBefore);
    await shot("feedback-attention");
    const fbId = await ev("fbNew()[0].id");
    await p.locator(`#fbs-${fbId}`).fill("Thanks! We'll sort it this week.");
    await press(`[data-fbsr="${fbId}"]`);
    ok(`${label}: replying marks it Replied and tells the client`, (await ev(`FEEDBACK.find((f) => f.id === ${fbId}).status`)) === "in_progress" && /by email/.test(await toast()));
    const lowId = await ev("lowToHandle()[0].id");
    await p.locator(`#lrv-${lowId}`).fill("Sorry about that, the aircon is fixed now.");
    await press(`[data-lrv="${lowId}"]`);
    ok(`${label}: following up a low review clears it`, (await p.locator(".fbcard.lowrv").count()) === 1 && /gets your reply by email/.test(await toast()));
    await press('[data-fbst="facilities"]');
    ok(`${label}: categories are kept apart`, (await ev(`[...document.querySelectorAll(".fbcard")].length`)) === (await ev(`FEEDBACK.filter((f) => f.cat === "facilities" && f.status !== "resolved").length`)));
    ok(`${label}: feedback page no h-scroll`, await noHScroll());

    // --- Reviews page ---
    await go("reviews");
    const total = await ev(`REVIEWS.filter((r) => r.at >= addDays(NOW, -90)).length`);
    ok(`${label}: summary from ${total} reviews`, new RegExp(`from ${total} reviews`).test(await p.locator(".rvhero").textContent()));
    ok(`${label}: how people rated, 5 to 1`, (await p.locator(".rvdist .rvrow:not(.rvinstr)").count()) === 5);
    ok(`${label}: Google share rate shown`, /tapped “Share on Google”/.test(await p.locator(".rvsum").textContent()));
    await p.evaluate(() => { const s = document.querySelector("#rvStars"); s.value = "low"; s.dispatchEvent(new Event("change")); });
    await p.waitForTimeout(150);
    ok(`${label}: star filter`, (await p.locator(".rvcard").count()) === (await ev(`REVIEWS.filter((r) => r.rating <= 2 && r.at >= addDays(NOW, -90)).length`)));
    await p.evaluate(() => { const s = document.querySelector("#rvStars"); s.value = ""; s.dispatchEvent(new Event("change")); });
    await press('[data-rvi="ana"]');
    ok(`${label}: tapping an instructor filters to them`, (await ev("state.rvf.instr")) === "ana" && /from \d+ review/.test(await p.locator(".rvhero").textContent()));
    await shot("reviews");
    ok(`${label}: reviews page no h-scroll`, await noHScroll());
    await ev(`state.rvf.instr = ""`);

    // --- Studio rules ---
    await go("policies");
    ok(`${label}: Studio rules has reviews and celebrations`, (await p.locator("#pRevOn, #pGoogle, #pCelebOn, #pAiRecaps").count()) === 4);
    await p.evaluate(() => (document.querySelector("#pGoogle").value = "http://not-secure"));
    await p.evaluate(() => document.querySelector("#polForm").requestSubmit());
    await p.waitForTimeout(150);
    ok(`${label}: Google link must be https`, (await ev("STUDIO.googleUrl")) === "https://g.page/r/demo-studio/review");
    await p.evaluate(() => (document.querySelector("#pGoogle").value = "https://g.page/r/new-link/review"));
    await p.evaluate(() => document.querySelector("#polForm").requestSubmit());
    await p.waitForTimeout(150);
    ok(`${label}: valid link saved`, (await ev("STUDIO.googleUrl")) === "https://g.page/r/new-link/review");

    // --- Instructor celebrations and My reviews ---
    await role("instructor");
    await go("home"); await p.waitForTimeout(600);
    ok(`${label}: instructor gets a milestone`, /250 classes taught!/.test(await modal()));
    await press("#ceNext");
    ok(`${label}: and their own fortnight`, /classes? taught:/.test(await modal()) && /of you at the front of the room/.test(await modal()));
    await press("#ceOff");
    ok(`${label}: "Don't show these" turns them off`, /Celebrations are off for you/.test(await toast()));
    await go("preferences");
    ok(`${label}: and Preferences shows the switch off`, (await p.locator("#prefCeleb").isChecked()) === false);
    await go("reviews");
    const anaCount = await ev(`REVIEWS.filter((r) => r.instr === "ana" && r.at >= addDays(NOW, -90)).length`);
    ok(`${label}: My reviews shows only theirs, names shortened`, (await p.locator(".rvcard").count()) === Math.min(60, anaCount) && /\b\w+ \w\.$/.test((await p.locator(".rvcard .muted").nth(1).textContent()).trim()) && (await p.locator("#rvInstr").count()) === 0);

    // --- Client: review pop-up ---
    await role("client");
    await go("schedule"); await p.waitForTimeout(700);
    const prompt = await modal();
    ok(`${label}: client is asked about their last class`, /How was .+\?/.test(prompt));
    ok(`${label}: Send waits for a rating; pausing needs a review`, (await p.locator("#rvSend").isDisabled()) && (await p.locator("#rvSnooze").isDisabled()));
    await shot("review-prompt");
    await press('[data-star="5"]');
    ok(`${label}: picking stars enables Send`, !(await p.locator("#rvSend").isDisabled()) && /Loved it/.test(await p.locator(".rvword").textContent()));
    await p.locator("#rvText").fill("Lovely class, thank you!");
    await press("#rvSnooze");
    await p.evaluate(() => document.querySelector("#rvForm").requestSubmit());
    await p.waitForTimeout(150);
    ok(`${label}: thanks, and Google is offered`, /Thank you, Chloe!/.test(await modal()) && /Would you share this on Google too\?/.test(await modal()));
    ok(`${label}: pause saved for 4 weeks`, (await ev("CLIENT_RV.snoozeUntil && Math.round((CLIENT_RV.snoozeUntil - NOW) / 864e5)")) === 28);
    await press("#tyGoogle");
    ok(`${label}: Share on Google is counted`, (await ev(`REVIEWS.at(-1).google`)) === "tapped" && /Opening your studio's Google page/.test(await toast()));
    // Google is offered after a low review too (no gating).
    await ev(`CLIENT_RV.snoozeUntil = null; CLIENT_RV.skipped.clear(); REVIEWS.pop()`);
    await ev(`openReviewPrompt(reviewPromptFor(ME.client))`);
    await press('[data-star="1"]');
    await p.evaluate(() => document.querySelector("#rvForm").requestSubmit());
    await p.waitForTimeout(150);
    ok(`${label}: a 1-star review gets the same Google offer`, /Would you share this on Google too\?/.test(await modal()) && /The studio has been told/.test(await modal()));
    await clearModal();
    // Skip: no pop-up, and the next class asks again.
    await ev(`REVIEWS.pop()`);
    await ev(`openReviewPrompt(reviewPromptFor(ME.client))`);
    await press("#rvSkip");
    ok(`${label}: skipping is fine`, /We'll ask again after your next class/.test(await toast()) && (await ev("reviewPromptFor(ME.client)")) === null);

    // --- Client: feedback ---
    await go("feedback");
    await p.locator("#fbMsg").fill("The aircon at Holland Village is too cold in the evening.");
    await p.evaluate(() => document.querySelector("#fbForm").requestSubmit());
    await p.waitForTimeout(150);
    ok(`${label}: a category is needed`, /Choose what it's about/.test(await toast()));
    await press('[data-fbcat="facilities"]');
    await p.locator("#fbMsg").fill("The aircon at Holland Village is too cold in the evening.");
    await p.evaluate(() => document.querySelector("#fbForm").requestSubmit());
    await p.waitForTimeout(150);
    ok(`${label}: feedback sent and listed`, /Sent\. Thank you!/.test(await toast()) && (await p.locator(".fbcard .status.open").count()) >= 1);
    await shot("client-feedback");
    await press('[data-fbt="reviews"]');
    ok(`${label}: My reviews tab with the pause control`, (await p.locator("#rvPauseGo, #rvResume").count()) === 1);
    ok(`${label}: client pages no h-scroll`, await noHScroll());
    await role("admin");

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
