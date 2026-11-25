// Checks the built help centre in a real browser: every article opens with its screenshots and
// working links, search finds the right article (by words, meaning, typos) and falls back to the
// closest articles, it's never indexed, and it works on a phone and in dark mode.
// Usage: node apps/help/build.mjs && NODE_PATH=<playwright's node_modules> node apps/help/check.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const url = "file://" + path.join(here, "dist/index.html");
const results = [];
const ok = (n, c, x = "") => results.push([c ? "PASS" : "FAIL", n + (c || !x ? "" : `  (${x})`)]);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; p.on("pageerror", (e) => errors.push(e.message));
await p.goto(url); await p.waitForTimeout(300);

ok("never indexed by search engines", (await p.locator('meta[name="robots"]').getAttribute("content")).includes("noindex"));
const ids = await p.evaluate(() => window.__help && [...document.querySelectorAll(".cat li a")].map((a) => a.getAttribute("href").slice(1)));
ok("home: 8 sections, 45 articles", (await p.locator(".cat").count()) === 8 && ids.length === 45, `${await p.locator(".cat").count()} / ${ids.length}`);
ok("home: troubleshooting stands out", (await p.locator(".cat.trouble li").count()) >= 10);

// Every article: a title, its screenshots load, links go to real articles.
let broken = [], imgs = 0, badLinks = [];
for (const id of ids) {
  await p.evaluate((h) => (location.hash = h), id); await p.waitForTimeout(40);
  if (!(await p.locator("article h1").count())) broken.push(id);
  const im = await p.locator("article img").evaluateAll((xs) => Promise.all(xs.map((i) => (i.complete ? i : new Promise((r) => { i.onload = i.onerror = () => r(i); }))).map((x) => x.then?.((i) => i.naturalWidth) ?? x.naturalWidth)));
  const loaded = await Promise.all(im);
  imgs += loaded.length; if (loaded.some((w) => !w)) broken.push(`${id} (screenshot)`);
  for (const h of await p.locator("article a[data-article]").evaluateAll((as) => as.map((a) => a.dataset.article))) if (!ids.includes(h)) badLinks.push(`${id} → ${h}`);
}
ok("every article opens", !broken.length, broken.join(", "));
ok(`screenshots load (${imgs})`, imgs >= 17 && !broken.some((x) => x.includes("screenshot")));
ok("links between articles all work", !badLinks.length, badLinks.join(", "));

// Search.
const top = async (q) => { await p.evaluate(() => (location.hash = "")); await p.fill("#q", q); await p.waitForTimeout(350); return p.locator(".result a").evaluateAll((as) => as.map((a) => a.getAttribute("href").slice(1))); };
ok("search: a word finds its article first", (await top("refund"))[0] === "refunds-fees");
ok("search: other words for the same thing (money back)", (await top("money back")).slice(0, 2).includes("refunds-fees"));
ok("search: other words (teacher sick → cover)", (await top("teacher sick"))[0] === "cover");
const typo = await top("refnud");
ok("search: typos still find it, with 'Did you mean'", typo[0] === "refunds-fees" && /Did you mean/.test(await p.locator("#view").innerText()));
ok("search: problems put troubleshooting first", (await top("can't book a client"))[0] === "cant-book-client");
ok("search: phrases (chinese new year → closures)", (await top("chinese new year"))[0] === "closures");
const none = await top("xyzzy");
ok("search: nothing matching shows the closest articles", none.length >= 3 && /No exact match/.test(await p.locator("#view").innerText()) && /These are the closest/.test(await p.locator("#view").innerText()));
await top("refund");
ok("search: matched words are highlighted", (await p.locator(".result mark").count()) > 0);
await p.locator("#q").press("Enter");
ok("search: Enter goes to the first result", await p.evaluate(() => document.activeElement?.closest(".result") !== null));
await p.locator(".result a").first().click(); await p.waitForTimeout(150);
ok("search: opening a result shows the article, search cleared", (await p.locator("article h1").innerText()) === "Refunds and fees" && (await p.inputValue("#q")) === "");
await p.goBack(); await p.waitForTimeout(250);
ok("search: Back returns to the results", (await p.inputValue("#q")) === "refund" && (await p.locator(".result").count()) > 0);
await p.evaluate(() => (location.hash = "")); await p.locator("body").click({ position: { x: 5, y: 600 } }); await p.keyboard.press("/");
ok("search: / jumps to the search box", await p.evaluate(() => document.activeElement?.id === "q"));
await p.locator('.hint [data-q="closures"]').click(); await p.waitForTimeout(250);
ok("search: popular searches work", (await p.inputValue("#q")) === "closures" && (await p.locator(".result").count()) > 0);

// Screenshots enlarge.
await p.evaluate(() => (location.hash = "closures")); await p.waitForTimeout(200);
await p.locator("figure .zoom").first().click();
ok("screenshots enlarge on click", await p.locator("#lightbox[open]").count() === 1);
await p.keyboard.press("Escape");
ok("and close with Esc", (await p.locator("#lightbox[open]").count()) === 0);
ok("no page errors", !errors.length, errors.join(" | "));
await p.close();

// Phone, dark mode.
const ph = await b.newPage({ ...devices["iPhone 13"], colorScheme: "dark" });
await ph.goto(url + "#who-can-do-what"); await ph.waitForTimeout(300);
ok("phone: no sideways scroll", await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
ok("phone: the table scrolls on its own", await ph.evaluate(() => { const t = document.querySelector(".table"); return t.scrollWidth > t.clientWidth; }));
ok("dark mode: dark background, light text", await ph.evaluate(() => { const bg = getComputedStyle(document.body).backgroundColor, fg = getComputedStyle(document.body).color; const l = (c) => c.match(/\d+/g).slice(0, 3).reduce((s, v) => s + +v, 0); return l(bg) < 150 && l(fg) > 500; }));
await ph.screenshot({ path: path.join(here, "shots-phone.png") }).catch(() => {});
await b.close();

for (const [r, n] of results) console.log(r, n);
const failed = results.filter(([r]) => r === "FAIL").length;
console.log(failed, "failed of", results.length);
process.exit(failed ? 1 : 0);
