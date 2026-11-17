// Screenshots and checks of the built site, every page at desktop and phone sizes: no page errors,
// no sideways scroll, links between pages work, and the interactive parts respond.
// Usage: node check.mjs (after node build.mjs)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "shots"); mkdirSync(out, { recursive: true });
const url = (page) => "file://" + path.join(here, "dist", `${page}.html`);
const results = []; const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n + (x ? `  (${x})` : "")]);
const b = await chromium.launch();
for (const [label, opts] of [["desk", { viewport: { width: 1440, height: 900 } }], ["phone", { ...devices["iPhone 13"] }]]) {
  const p = await b.newPage(opts);
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const text = (s) => p.locator(s).first().innerText();
  const open = async (page) => { await p.goto(url(page)); await p.waitForTimeout(400); };
  const phone = label === "phone";
  const nav = async (name) => {
    if (phone) await p.locator(".menu-btn").click();
    await p.locator(`#nav a[data-page="${name}"]`).click();
    await p.waitForLoadState("load"); await p.waitForTimeout(400);
  };

  // Home
  await open("index"); await p.waitForTimeout(2200);
  ok(`${label} home: no sideways scroll`, await noHScroll());
  ok(`${label} home: timetable filled`, (await p.locator("#tt .cls").count()) === 17);
  ok(`${label} home: no waiver on the to-do list`, !/waiver/i.test(await text("#att")));
  await p.screenshot({ path: path.join(out, `${label}-home-hero.png`) });
  await p.locator("#tt .cls").nth(1).click();
  await p.locator(".pop .abtn.go").click();
  ok(`${label} home: book from the timetable`, /booked|waitlist/.test(await text(".pop")));
  await p.keyboard.press("Escape");
  ok(`${label} home: headline sweeps in`, phone || (await p.locator("#heroT.sweep.go").count()) === 1);
  // A day at the studio: on desktop the windows stack as you scroll; on phones each sits under its step.
  const dayAt = (f) => p.evaluate((f) => { const d = document.getElementById("day"); scrollTo({ top: d.offsetTop + f * (d.offsetHeight - innerHeight), behavior: "instant" }); }, f);
  await dayAt(0); await p.waitForTimeout(900);
  ok(`${label} home: day story layout`, phone ? (await p.locator("#daySteps .day-card").count()) === 4 : (await p.locator("#day.scrolly").count()) === 1 && /7:00am/.test(await text("#daySteps li.on")));
  ok(`${label} home: dock shows once the hero has gone`, await p.locator("#dock.show").count() === 1);
  for (let i = 0; i < 4; i++) await p.locator(".att-item:not(.done) .abtn").first().click().then(() => p.waitForTimeout(500));
  ok(`${label} home: to-do list clears`, await p.locator("#attEmpty").isVisible());
  if (phone) await p.locator("#markAll").scrollIntoViewIfNeeded(); else { await dayAt(0.3); await p.waitForTimeout(1000); }
  ok(`${label} home: instructor step`, phone || /12:20pm/.test(await text("#daySteps li.on")));
  await p.locator("#markAll").click(); await p.waitForTimeout(700);
  ok(`${label} home: mark everyone present`, (await p.locator("#day .rp.here").count()) === 5);
  if (phone) await p.locator("#waReply").scrollIntoViewIfNeeded(); else await dayAt(0.6);
  await p.waitForTimeout(5200);
  ok(`${label} home: WhatsApp reply types itself`, /booked you in with your 10-class pack/.test(await text("#waReply")));
  if (!phone) { await dayAt(0.97); await p.waitForTimeout(1000); }
  ok(`${label} home: pay step`, phone || (/11:59pm/.test(await text("#daySteps li.on")) && (await p.locator('.day-card[data-card="3"]:not(.below):not(.past)').count()) === 1));
  await p.locator("#closeDays").click();
  ok(`${label} home: public holidays`, /9 classes cancelled and 64 people told/.test(await text("#holidayWin")));
  ok(`${label} home: prices in SGD`, /SGD 129[\s\S]*SGD 399[\s\S]*SGD 699/.test(await text(".prices")));
  await p.locator("#walkthrough").scrollIntoViewIfNeeded(); await p.waitForTimeout(700);
  ok(`${label} home: dock steps aside at the form`, (await p.locator("#dock.show").count()) === 0);
  await p.locator('#join button[type="submit"]').click();
  ok(`${label} home: form says what's missing`, /Add your name/.test(await text("#joinNote")));
  await p.screenshot({ path: path.join(out, `${label}-home-full.png`), fullPage: true });

  // Product
  await nav("product");
  ok(`${label} nav: to Product`, p.url().endsWith("product.html"));
  ok(`${label} product: marked as the current page`, (await p.locator('#nav a[aria-current="page"]').getAttribute("data-page")) === "product");
  ok(`${label} product: no sideways scroll`, await noHScroll());
  await p.locator('[data-chk="double"]').click();
  ok(`${label} product: warnings switch`, /double-booked/i.test(await text("#chk")));
  await p.locator("#markAll").click(); await p.waitForTimeout(700);
  ok(`${label} product: mark everyone present`, (await p.locator(".rp.here").count()) === 6);
  await p.locator('[data-jr="intro"]').click();
  ok(`${label} product: journey shows its steps`, (await p.locator(".jr-steps li").count()) === 3);
  await p.locator("#jrOn").click({ force: true });
  ok(`${label} product: journey switches off`, /Switched off/.test(await text(".jr-result")));
  await p.locator("#bars").scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
  await p.locator('[data-m="fill"]').click(); await p.waitForTimeout(700);
  ok(`${label} product: report by location`, /58%/.test(await text("#bars")) && (await p.locator("#bars li.low").count()) === 1);
  await p.locator("#qs button").nth(2).click(); await p.waitForTimeout(2600);
  ok(`${label} product: Ask types the question, then answers`, /What do I owe instructors/.test(await text("#askQ")) && /SGD 4,737/.test(await text("#ans")));
  await p.screenshot({ path: path.join(out, `${label}-product-full.png`), fullPage: true });

  // Pricing
  await nav("pricing");
  ok(`${label} nav: to Pricing`, p.url().endsWith("pricing.html"));
  ok(`${label} pricing: no sideways scroll`, await noHScroll());
  ok(`${label} pricing: starts at Essentials`, /Essentials/.test(await text("#outPlan")) && /SGD 129/.test(await text("#outAmt")));
  await p.locator("#wantApp").check({ force: true });
  ok(`${label} pricing: one location with an app is Growth`, /Growth/.test(await text("#outPlan")) && /SGD 498/.test(await text("#outAmt")));
  for (let i = 0; i < 5; i++) await p.locator("#locPlus").click();
  ok(`${label} pricing: 6 locations is Signature plus one`, /Signature/.test(await text("#outPlan")) && /SGD 898/.test(await text("#outAmt")) && /Signature/.test(await text(".plan.fit")));
  await p.locator('[data-bill="year"]').click();
  ok(`${label} pricing: yearly`, /SGD 8,980/.test(await text("#outAmt")) && /SGD 6,990/.test(await text("#plans")));
  ok(`${label} pricing: comparison table`, (await p.locator("#cmp tbody tr").count()) > 25);
  await p.locator(".faq summary").first().click();
  ok(`${label} pricing: FAQ opens`, await p.locator(".faq details").first().evaluate((d) => d.open));
  await p.screenshot({ path: path.join(out, `${label}-pricing-full.png`), fullPage: true });

  // Switching
  await nav("switching");
  ok(`${label} nav: to Switching`, p.url().endsWith("switching.html"));
  ok(`${label} switching: no sideways scroll`, await noHScroll());
  ok(`${label} switching: systems we move from`, (await p.locator(".mq-row li").count()) === 24 && /Mariana Tek/.test(await text(".marquee")));
  for (let i = 0; i < 3; i++) await p.locator(".qa-item:not(.done) .abtn").first().click();
  ok(`${label} switching: questions answered, move ready`, /ready to run/.test(await text("#qaLog")));
  await p.locator('[data-from="momence"]').click();
  const mo = await text("#fromPanel");
  ok(`${label} switching: Momence comparison in SGD, with where we're stronger`, /Moving from Momence/.test(mo) && /SGD 585\+/.test(mo) && /Where we're stronger than Momence/.test(mo) && /Where Momence is stronger/.test(mo));
  ok(`${label} switching: our column comes first`, (await p.locator("#fromPanel thead th").nth(1).innerText()) === "Us");
  await p.locator('[data-from="sheet"]').click();
  ok(`${label} switching: spreadsheet has no comparison table`, (await p.locator("#fromPanel table").count()) === 0);
  ok(`${label} switching: questions for any sales call`, (await p.locator("#asks .ask-row").count()) === 7);
  ok(`${label} switching: comparison is dated`, /November 2026/.test(await text(".dated")));
  await p.screenshot({ path: path.join(out, `${label}-switching-full.png`), fullPage: true });

  // Back home from the call to action
  await p.locator(".close .btn").click(); await p.waitForLoadState("load");
  ok(`${label} nav: walkthrough link goes home`, /index\.html#walkthrough$/.test(p.url()));

  ok(`${label}: no page errors`, !errors.length, errors.join(" | "));
  await p.close();
}
await b.close();
for (const [r, n] of results) console.log(r, n);
const failed = results.filter(([r]) => r === "FAIL").length;
console.log(failed, "failed of", results.length);
process.exit(failed ? 1 : 0);
