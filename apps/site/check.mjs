// Screenshots and checks of the built site, every page at desktop and phone sizes: no page errors,
// no sideways scroll, links between pages work, the product videos load and play while on screen
// (and wait for a tap with reduced motion), and the interactive parts respond.
// Usage: node check.mjs (after node build.mjs)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
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
  // A video counts as playing once its time moves on.
  const playing = (sel) => p.locator(sel).first().evaluate((v) => new Promise((done) => { const t = v.currentTime; setTimeout(() => done(!v.paused && v.currentTime > t), 900); }));
  const videosOk = async (where) => {
    const vs = await p.evaluate(() => [...document.querySelectorAll(".vid video")].map((v) => ({ poster: v.getAttribute("poster"), srcs: [...v.querySelectorAll("source")].map((x) => x.dataset.src) })));
    const files = vs.flatMap((v) => [v.poster, ...v.srcs]);
    const missing = files.filter((f) => !existsSync(path.join(here, "dist", f)));
    ok(`${label} ${where}: ${vs.length} videos, each with a poster, mp4 and webm on disk`, vs.length > 0 && vs.every((v) => v.poster && v.srcs.length === 2) && !missing.length, missing.join(", "));
  };
  const nav = async (name) => {
    if (phone) await p.locator(".menu-btn").click();
    await p.locator(`#nav a[data-page="${name}"]`).click();
    await p.waitForLoadState("load"); await p.waitForTimeout(1100);
  };

  // Home
  await open("index"); await p.waitForTimeout(1500);
  ok(`${label} home: no sideways scroll`, await noHScroll());
  await videosOk("home");
  await p.locator(".hero video").scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
  ok(`${label} home: the hero video plays`, await playing(".hero video"));
  ok(`${label} home: the hero film is big`, await p.locator(".hero .vid.film").evaluate((f) => f.getBoundingClientRect().width >= innerWidth - 40 || f.getBoundingClientRect().width >= 1400));
  await p.evaluate(() => scrollTo(0, 0));
  await p.screenshot({ path: path.join(out, `${label}-home-hero.png`) });
  ok(`${label} home: headline sweeps in`, phone || (await p.locator("#heroT.sweep.go").count()) === 1);
  // A day at the studio: one film; its chapters follow it, and tapping one jumps there.
  await p.locator("#dayFilm video").scrollIntoViewIfNeeded(); await p.waitForTimeout(1400);
  ok(`${label} home: the day film plays`, await playing("#dayFilm video"));
  ok(`${label} home: dock shows once the hero has gone`, await p.locator("#dock.show").count() === 1);
  await p.locator('#chapters button[data-at="12.1"]').click(); await p.waitForTimeout(900);
  ok(`${label} home: a chapter jumps the film there`, await p.locator("#dayFilm video").evaluate((v) => v.currentTime >= 12 && v.currentTime < 18) && /6:02pm/.test(await text("#chapters li.on")));
  await p.locator('.vid.film video[aria-label^="Closing"]').scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
  ok(`${label} home: made-for-here film plays`, await playing('.vid.film video[aria-label^="Closing"]'));
  ok(`${label} home: prices in SGD`, /SGD 129[\s\S]*SGD 399[\s\S]*SGD 699/.test(await text(".prices")));
  await p.locator("#walkthrough").scrollIntoViewIfNeeded(); await p.waitForTimeout(700);
  ok(`${label} home: dock steps aside at the form`, (await p.locator("#dock.show").count()) === 0);
  await p.locator('#join button[type="submit"]').click();
  ok(`${label} home: form says what's missing`, /Add your name/.test(await text("#joinNote")));
  await p.evaluate(() => scrollTo(0, 0));
  await p.screenshot({ path: path.join(out, `${label}-home-full.png`), fullPage: true });

  // Product
  await nav("product");
  ok(`${label} nav: to Product`, p.url().endsWith("product.html"));
  ok(`${label} product: marked as the current page`, (await p.locator('#nav a[aria-current="page"]').getAttribute("data-page")) === "product");
  ok(`${label} product: no sideways scroll`, await noHScroll());
  await videosOk("product");
  ok(`${label} product: four films`, (await p.locator(".vid.film video").count()) === 4);
  const fillFilm = '.vid.film video[aria-label^="The intro-offer journey"]';
  await p.locator(fillFilm).scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
  ok(`${label} product: the journey film plays`, await playing(fillFilm));
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
  await videosOk("switching");
  await p.locator(".vid video").first().scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
  ok(`${label} switching: the move film plays`, await playing(".vid video"));
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
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await p.goto(url("index")); await p.waitForTimeout(1200);
  ok("reduced motion: nothing plays by itself", await p.evaluate(() => [...document.querySelectorAll(".vid video")].every((v) => v.paused)));
  ok("reduced motion: each video offers Play", (await p.locator(".vid .vid-play").count()) === (await p.locator(".vid video").count()));
  await p.locator(".hero .vid-play").click(); await p.waitForTimeout(1000);
  ok("reduced motion: Play starts it, with controls", await p.locator(".hero video").evaluate((v) => !v.paused && v.controls));
  await p.close();
}
await b.close();
for (const [r, n] of results) console.log(r, n);
const failed = results.filter(([r]) => r === "FAIL").length;
console.log(failed, "failed of", results.length);
process.exit(failed ? 1 : 0);
