/**
 * Checks the client app in a real browser, using the built-in demo studios (no server needed):
 * builds the demo, serves it, and walks through Home, booking, the goal, cancelling, filters,
 * celebrations, the three looks, a wide screen and reduced motion.
 * Usage: node e2e/check.mjs   (Playwright from NODE_PATH, e.g. /opt/node-tools/node_modules)
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist-demo");
const shots = join(here, "shots");
mkdirSync(shots, { recursive: true });

execFileSync("npx", ["vite", "build", "--outDir", "dist-demo", "--base", "./"], { cwd: root, stdio: "ignore", env: { ...process.env, VITE_DEMO: "1" } });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!path.startsWith(dist) || !existsSync(path)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
}).listen(0);
const base = `http://localhost:${server.address().port}`;

let failed = 0, passed = 0;
const ok = (label, cond, extra = "") => { if (cond) passed++; else failed++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && extra ? ` (${extra})` : ""}`); };
const browser = await chromium.launch();
const errors = [];
async function open(studio, opts = {}) {
  const page = await browser.newPage(opts.device ? { ...opts.device } : { viewport: opts.viewport ?? { width: 390, height: 844 }, reducedMotion: opts.reduced ? "reduce" : "no-preference" });
  page.on("pageerror", (e) => errors.push(`${studio}: ${e.message}`));
  await page.goto(`${base}/index.html?demo&studio=${studio}${opts.hash ?? ""}`);
  await page.waitForSelector(".screen");
  await page.waitForTimeout(300);
  return page;
}
const closeCelebration = async (p) => { const c = p.getByRole("dialog"); if (await c.count()) await p.keyboard.press("Escape"); };

try {
  // --- Linden: Home is never blank
  let p = await open("linden");
  ok("home: greets the member by name", (await p.locator(".hello h1").textContent()).includes("Rachel"));
  ok("home: studio banners", (await p.locator(".banner").count()) === 2);
  ok("home: classes so far, and how many to the next milestone", (await p.locator(".ms-count b").textContent()) === "47" && /3 to your 50th/.test(await p.locator(".ms-next").textContent()));
  ok("home: a progress bar to the next milestone (no tally marks)", (await p.locator(".ms-bar[role=progressbar]").getAttribute("aria-valuenow")) === "47" && (await p.locator(".tally").count()) === 0);
  ok("home: this month against the goal, with no way to change it here", (await p.locator(".goal-score").textContent()).replace(/\s/g, "") === "5of8" && (await p.locator(".home .step").count()) === 0);
  ok("home: achievements kept to one line", (await p.locator(".ach-strip").count()) === 1 && /to go/.test(await p.locator(".ach-strip").textContent()));
  ok("look: nothing wider than the phone", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok("tabs: the selected tab is marked", await p.evaluate(() => getComputedStyle(document.querySelector('.rail a[aria-current="page"]'), "::after").transform !== "matrix(0, 0, 0, 1, 0, 0)"));
  await p.screenshot({ path: join(shots, "linden-home.png") });

  // 1. Every screen opened from somewhere has Back, and Back returns there.
  await p.locator(".next-card").click();
  await p.waitForSelector(".class-page");
  ok("back: the next class opens its own screen", (await p.locator(".class-page h1").textContent()).length > 3 && (await p.locator(".booked-panel").count()) === 1);
  await p.getByRole("button", { name: "Back" }).click();
  await p.waitForSelector(".hello");
  ok("back: returns to Home", (await p.locator(".hello").count()) === 1);
  await p.getByRole("link", { name: "Me", exact: true }).click();
  await p.getByRole("button", { name: /Purchases and receipts/ }).click();
  await p.getByRole("button", { name: "Back" }).click();
  ok("back: from a Me screen returns to Me", (await p.locator(".me-head").count()) === 1);

  // 2, 4, 5. The timetable: a week at a time, nothing cut off, the favourite instructor, no counts.
  await p.getByRole("link", { name: "Book", exact: true }).click();
  await p.waitForSelector(".class-list:not(.is-loading)");
  ok("book: nothing wider than the phone", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok("book: every filter and day fits on screen", await p.evaluate(() => [...document.querySelectorAll(".chip, .seg, .select, .day, .class-act .btn")].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; })));
  ok("book: seven days at a time", (await p.locator(".days .day").count()) === 7);
  ok("book: no class counts under the dates", (await p.locator(".day-count").count()) === 0);
  ok("book: classes with their favourite instructor are starred", (await p.locator(".class-list .fav").count()) > 0);
  await p.getByRole("button", { name: /Classes with Ana/ }).click();
  ok("book: one tap for classes with Ana", (await p.locator(".class-list .class-row, .empty").count()) >= 1 && await p.evaluate(() => [...document.querySelectorAll(".class-list .class-sub")].every((e) => e.textContent.includes("Ana"))));
  await p.getByRole("button", { name: /Classes with Ana/ }).click();
  await p.getByRole("button", { name: "Next week" }).click();
  ok("book: next week", (await p.locator(".week-label").textContent()) === "Next week");
  await p.getByRole("button", { name: "Previous week" }).click();
  await p.screenshot({ path: join(shots, "linden-book.png") });

  // Booking: one check in the row, then booked.
  const idx = await p.locator(".class-list .class-row").evaluateAll((rows) => rows.findIndex((r) => r.querySelector(".class-act .btn-main")));
  const row = p.locator(".class-list .class-row").nth(idx);
  const name = await row.locator(".class-name").textContent();
  await row.locator(".class-act .btn-main").click();
  await p.waitForSelector(".confirm-box .btn-main");
  ok("book: says what it uses and what's left", /Uses 1 class from your 10-class pack\. 5 left after this\./.test(await row.locator(".confirm-line").textContent()));
  await row.getByRole("button", { name: "Confirm booking" }).click();
  await p.waitForSelector(".toast:has-text('Booked:')");
  ok("book: booked, with a toast naming the class", (await p.locator(".toast", { hasText: "Booked:" }).textContent()).includes(name));
  await p.waitForFunction(() => document.querySelector(".rail .count")?.textContent === "3", null, { timeout: 3000 }).catch(() => {});
  ok("book: My classes count goes up", (await p.locator(".rail .count").textContent()) === "3");
  // Its own screen, then Back to the timetable.
  await row.locator(".class-open").click();
  await p.waitForSelector(".class-page");
  ok("class: its screen says it's booked", (await p.locator(".booked-panel").count()) === 1);
  await p.getByRole("button", { name: "Back" }).click();
  ok("class: Back returns to the timetable", (await p.locator(".week").count()) === 1);

  // My classes: open one and cancel it there.
  await p.getByRole("link", { name: /My classes/ }).click();
  const n = await p.locator(".booking-list > li").count();
  await p.locator(".booking-list > li").last().locator(".row").click();
  await p.getByRole("button", { name: "Cancel booking" }).click();
  await p.getByRole("button", { name: /Cancel class|Cancel anyway/ }).click();
  await p.waitForSelector(".toast:has-text('Cancelled:')");
  await p.waitForFunction((k) => document.querySelectorAll(".booking-list > li").length === k, n - 1, { timeout: 3000 }).catch(() => {});
  ok("my classes: cancelled from the class's screen, then back to the list", (await p.locator(".booking-list > li").count()) === n - 1);

  // 6. The goal is set in Me. Raising it gets praise; lowering it first makes the case for keeping it.
  await p.getByRole("link", { name: "Me", exact: true }).click();
  ok("me: no cancellation rule on the profile", !(await p.locator(".me").textContent()).includes("Cancel up to"));
  await p.getByRole("button", { name: /Monthly goal/ }).click();
  await p.getByRole("button", { name: "One more class" }).click();
  await p.getByRole("button", { name: "Raise it to 9" }).click();
  await p.waitForSelector(".praise");
  ok("goal: raising it gets praise", (await p.locator(".praise").textContent()).length > 10);
  await p.getByRole("button", { name: "One fewer class" }).click();
  await p.getByRole("button", { name: "One fewer class" }).click();
  await p.getByRole("button", { name: "Change it to 7" }).click();
  await p.waitForSelector(".keep-box");
  ok("goal: lowering it first shows how close they are", /You've done 5/.test(await p.locator(".keep-box").textContent()) && (await p.locator(".keep-box .btn-main").textContent()) === "Keep 9");
  await p.getByRole("button", { name: "Keep 9" }).click();
  ok("goal: Keep leaves it as it was", /9 classes a month/.test(await p.locator(".sub-head-sub").textContent()));
  await p.getByRole("button", { name: "Back" }).click();

  // 7. Achievements: milestones in a short grid, the rest beneath.
  await p.getByRole("button", { name: /Achievements/ }).click();
  ok("achievements: milestones together", (await p.locator(".miles li").count()) === 8 && (await p.locator(".miles li.next").count()) === 1);
  ok("achievements: the others, five of them", (await p.locator(".badges li").count()) === 5);
  await p.getByRole("button", { name: "Back" }).click();

  // 10. Buying and managing.
  // Buying is in its own Shop tab.
  await p.getByRole("button", { name: /Buy another package/ }).click();
  await p.waitForSelector(".shop-tab");
  ok("shop tab: Buy in Me opens the Shop tab", (await p.locator('.rail a[aria-current="page"]').textContent()).includes("Shop"));
  await p.waitForSelector(".product");
  ok("shop tab: packs, memberships, gift cards and merchandise in one place", (await p.locator("#packsT").count()) === 1 && (await p.locator("#memT").count()) === 1 && (await p.locator(".gift-promo").count()) === 1 && (await p.locator(".product").count()) === 3);
  await p.getByRole("button", { name: /20-class pack/ }).click();
  await p.waitForSelector(".bill-total");
  ok("buy: the bill, with studio credit taken off", /Studio credit/.test(await p.locator(".bill").textContent()) && (await p.locator(".bill-total").textContent()).includes("655"));
  await p.getByLabel(/10% off/).check();
  await p.waitForFunction(() => document.querySelector(".bill-total")?.textContent.includes("587"), null, { timeout: 3000 }).catch(() => {});
  ok("buy: a discount from a referral", (await p.locator(".bill-total").textContent()).includes("587") && /Discount \(10% off\)/.test(await p.locator(".bill").textContent()));
  await p.getByLabel(/5 classes from 10-class pack/).check();
  await p.waitForFunction(() => /5 unused classes/.test(document.querySelector(".bill")?.textContent ?? ""), null, { timeout: 3000 }).catch(() => {});
  ok("buy: unused classes brought across", /5 unused classes from 10-class pack/.test(await p.locator(".bill").textContent()));
  await p.getByRole("button", { name: /^Pay / }).click();
  await p.waitForSelector(".pay-sheet");
  ok("pay: a payment step, asking for no card details", (await p.locator(".pay-sheet input").count()) === 0 && /SGD 587/.test(await p.locator(".pay-sheet h2").textContent()));
  await p.locator(".pay-sheet").getByRole("button", { name: /^Pay / }).click();
  await p.waitForSelector(".me-head");
  ok("buy: bought, with the classes added", /25 of 25 left/.test(await p.locator(".list .row", { hasText: "20-class pack" }).textContent()) && /1 of 10 left/.test(await p.locator(".list .row", { hasText: "10-class pack" }).textContent()));
  // A package that starts on a chosen day, paid at the studio.
  await p.getByRole("link", { name: "Shop", exact: true }).click();
  await p.getByRole("button", { name: /30-day unlimited pass/ }).click();
  await p.waitForSelector('input[type="date"]');
  const later = await p.evaluate(() => new Date(Date.now() + 3 * 864e5 + 8 * 36e5).toISOString().slice(0, 10));
  await p.fill('input[type="date"]', later);
  await p.getByLabel(/Pay at the studio/).check();
  await p.getByRole("button", { name: "Order and pay at the studio" }).click();
  await p.waitForSelector(".toast:has-text('Order placed')");
  ok("buy: a start date chosen, paid at the studio", true);
  await p.getByRole("button", { name: /10-class pack/ }).click();
  await p.getByRole("button", { name: "Ask for more time" }).click();
  await p.locator('input[type="file"]').setInputFiles({ name: "doctors-note.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
  ok("package: a document can go with the request", /doctors-note\.png/.test(await p.locator(".file-field").textContent()));
  await p.getByLabel("Why?").fill("Travelling for work");
  await p.getByRole("button", { name: "Send request" }).click();
  await p.waitForSelector(".toast:has-text('extended')");
  await p.waitForSelector("#extT", { timeout: 3000 }).catch(() => {});
  ok("package: asked for more time (approved straight away)", (await p.locator("#extT").count()) === 1);
  await p.getByRole("button", { name: "Back" }).click();
  await p.getByRole("button", { name: /20-class pack/ }).click();
  await p.getByRole("button", { name: "Share it" }).click();
  await p.getByLabel("Their email").fill("hannah@example.com");
  await p.locator(".panel").getByRole("button", { name: "Share it" }).click();
  await p.waitForSelector("#whoT");
  ok("package: shared with a friend", (await p.locator(".list.plain .line", { hasText: "Hannah" }).count()) === 1);
  await p.getByRole("button", { name: "Back" }).click();

  await p.getByRole("link", { name: "Shop", exact: true }).click();
  await p.getByRole("button", { name: "Add Linden water bottle" }).click();
  await p.getByRole("button", { name: "Add Grip socks" }).click();
  ok("shop: a basket with a total", (await p.locator(".basket .bill-line").count()) === 2 && (await p.locator(".basket .bill-total").textContent()).includes("50"));
  await p.locator(".basket").getByRole("button", { name: /^Pay / }).click();
  await p.locator(".pay-sheet").getByRole("button", { name: /^Pay / }).click();
  await p.waitForSelector(".toast:has-text('Collect')");
  ok("shop: paid, to collect at the desk", true);
  // A gift card, given straight away.
  await p.getByRole("link", { name: "Shop", exact: true }).click();
  await p.locator(".gift-promo").click();
  await p.getByLabel("Their email").fill("sam@example.com");
  await p.getByRole("button", { name: /^Pay / }).click();
  await p.locator(".pay-sheet").getByRole("button", { name: /^Pay / }).click();
  await p.waitForSelector(".toast:has-text('on its way')");
  ok("gift card: bought and sent", true);
  await p.getByRole("link", { name: "Me", exact: true }).click();
  await p.getByRole("button", { name: /My gift cards and credit/ }).click();
  await p.getByRole("button", { name: "Keep it as credit" }).click();
  await p.waitForSelector(".toast:has-text('credit')");
  await p.waitForFunction(() => document.querySelector(".credit-big")?.textContent.includes("100"), null, { timeout: 3000 }).catch(() => {});
  ok("gift cards: kept as credit", (await p.locator(".credit-big").textContent()).includes("100"));
  await p.getByRole("button", { name: "Back" }).click();
  await p.getByRole("button", { name: /Injuries and health notes/ }).click();
  await p.getByLabel("Add something").fill("Sore left wrist");
  await p.getByRole("button", { name: "Add", exact: true }).click();
  await p.waitForSelector(".note:has-text('Sore left wrist')");
  ok("health: a note added", true);
  await p.locator(".note", { hasText: "Tight lower back" }).getByRole("button", { name: "It's better" }).click();
  await p.waitForSelector(".resolved");
  ok("health: one marked as better", (await p.locator(".resolved summary").textContent()).includes("1"));
  await p.getByRole("button", { name: "Back" }).click();
  await p.getByRole("button", { name: /Rewards/ }).click();
  ok("rewards: balance and rewards", (await p.locator(".credit-big").textContent()) === "470 leaves" && (await p.locator(".reward").count()) === 2);
  await p.getByRole("button", { name: "Redeem" }).click();
  await p.waitForSelector(".toast:has-text('Redeemed')");
  await p.waitForSelector(".code", { timeout: 3000 }).catch(() => {});
  ok("rewards: redeemed, with a code for the desk", (await p.locator(".code").count()) === 1);
  await p.getByRole("button", { name: "Back" }).click();
  for (const [btn, sel] of [[/Refer a friend/, ".refer .credit-big"], [/Waiver/, ".waiver"], [/Purchases and receipts/, ".receipts .line"], [/Payment card/, ".card-page"], [/News and offers/, ".switch"]]) {
    await p.getByRole("button", { name: btn }).click();
    await p.waitForSelector(sel);
    ok(`me: ${sel.split(" ")[0].slice(1)} opens`, true);
    await p.getByRole("button", { name: "Back" }).click();
  }
  ok("me: nothing wider than the phone", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.screenshot({ path: join(shots, "linden-me.png"), fullPage: true });
  await p.close();

  // --- Tidal: a celebration on opening, shown once; stopping a membership
  p = await open("tidal");
  await p.waitForSelector("[role=dialog]");
  ok("celebration: opens by itself", (await p.locator("#celebrateT").textContent()) === "Four weeks running");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(800);
  ok("celebration: Esc closes it and it doesn't come back", (await p.locator("[role=dialog]").count()) === 0);
  ok("look: Tidal's grotesque and pill buttons", (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--display"))).includes("Bricolage") && (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--r-s"))).trim() === "999px");
  await p.getByRole("link", { name: "Me", exact: true }).click();
  await p.getByRole("button", { name: /8 classes a month/ }).click();
  await p.getByRole("button", { name: "Stop renewing" }).click();
  await p.locator(".panel").getByRole("button", { name: "Stop renewing" }).click();
  await p.waitForSelector(".toast:has-text('Stopped')");
  await p.getByRole("button", { name: "Keep it renewing" }).waitFor({ timeout: 3000 }).catch(() => {});
  ok("membership: stopped, and it can be kept renewing again", (await p.getByRole("button", { name: "Keep it renewing" }).count()) === 1);
  await p.close();

  // --- Aizome: the 108th class is celebrated with a seal; a member with no goal is asked
  p = await open("aizome");
  await p.waitForSelector("[role=dialog]");
  ok("celebration: the milestone, with its number", (await p.locator("#celebrateT").textContent()) === "108 classes" && (await p.locator(".celebrate-num").textContent()) === "108");
  ok("celebration: the number is on a solid badge, not over the seal", await p.evaluate(() => { const b = document.querySelector(".cel-badge"); return !!b && b.contains(document.querySelector(".celebrate-num")) && getComputedStyle(b).backgroundColor !== "rgba(0, 0, 0, 0)"; }));
  await p.getByRole("button", { name: "Book your next class" }).click();
  ok("celebration: its button goes to booking", (await p.locator(".screen-book").count()) === 1);
  ok("look: Aizome's square corners and red seal", (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--r-l"))).trim() === "4px" && (await p.evaluate(() => document.documentElement.dataset.motif)) === "stamp");
  await p.close();

  // --- Wide screen: a rail, Home in columns
  p = await open("linden", { viewport: { width: 1440, height: 900 } });
  ok("wide: the rail is on the left", (await p.locator(".rail").boundingBox()).x === 0 && (await p.locator(".rail .brand").isVisible()));
  ok("wide: progress side by side", await p.evaluate(() => getComputedStyle(document.querySelector(".progress-grid")).gridTemplateColumns.split(" ").length === 2));
  await p.screenshot({ path: join(shots, "linden-wide.png") });
  await p.close();

  // --- Reduced motion
  p = await open("aizome", { reduced: true });
  await p.waitForSelector("[role=dialog]");
  ok("reduced motion: the celebration still shows", (await p.locator("#celebrateT").count()) === 1);
  ok("reduced motion: animations are switched off", await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".celebrate")).animationDuration) < 0.01));
  await p.close();

  // --- A phone narrower than most: still nothing cut off
  p = await open("tidal", { viewport: { width: 340, height: 740 }, hash: "#/book" });
  await p.keyboard.press("Escape");
  await p.waitForSelector(".class-list:not(.is-loading)");
  ok("narrow phone: the timetable fits", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await p.close();

  // --- Real phones: iPhone (iOS) and Pixel (Android) sizes, touch, and their browsers' quirks
  for (const [name, device] of [["iPhone 13", devices["iPhone 13"]], ["iPhone SE", devices["iPhone SE"]], ["Pixel 7", devices["Pixel 7"]], ["Galaxy S9+", devices["Galaxy S9+"]]]) {
    p = await open("linden", { device });
    const fits = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    const tabs = await p.locator(".rail a").evaluateAll((as) => as.map((a) => { const r = a.getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height, cut: a.querySelector("span").scrollWidth > a.querySelector("span").clientWidth }; }));
    ok(`${name}: five tabs, all on screen, none cut short`, tabs.length === 5 && tabs.every((t) => t.l >= 0 && t.r <= device.viewport.width + 0.5 && !t.cut));
    ok(`${name}: tabs big enough to tap (44px)`, tabs.every((t) => t.h >= 44));
    ok(`${name}: Home fits`, await fits());
    for (const tab of ["Book", "Shop", "My classes", "Me"]) {
      await p.getByRole("link", { name: tab === "My classes" ? /^My classes/ : tab, exact: tab !== "My classes" }).click();
      await p.waitForTimeout(400);
      ok(`${name}: ${tab} fits`, await fits());
    }
    await p.getByRole("link", { name: "Shop", exact: true }).click();
    await p.getByRole("button", { name: /30-day unlimited pass/ }).click();
    await p.waitForSelector('input[type="date"]');
    ok(`${name}: fields are 16px, so the phone doesn't zoom in when they're tapped`, await p.evaluate(() => matchMedia("(pointer: coarse)").matches && [...document.querySelectorAll("input, select, textarea")].every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16)));
    ok(`${name}: checkout fits`, await fits());
    await p.close();
  }

  // --- The showcase: three live phones
  p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`${base}/showcase.html`);
  ok("showcase: three studios", (await p.locator(".sc-phone iframe").count()) === 3);
  await p.close();
  ok("no errors in the page", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
console.log(`${failed} failed of ${passed + failed}`);
process.exit(failed ? 1 : 0);
