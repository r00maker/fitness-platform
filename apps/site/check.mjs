// Screenshots and checks of the built site, every page at desktop and phone sizes: no page errors,
// no sideways scroll, links between pages work, the product videos load and play while on screen
// (and wait for a tap with reduced motion), and the interactive parts respond.
// The free trial sign-up runs as a preview here; with --live it also runs against a seeded local API
// (Postgres needed, a database named studio_e2e, which is wiped).
// Usage: node check.mjs [--live] (after node build.mjs)
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { createServer } from "node:http";
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
  ok(`${label} home: the hero film is big`, await p.locator(".hero .vid.film").evaluate((f) => f.getBoundingClientRect().width >= Math.min(1400, innerWidth - 40)));
  await p.evaluate(() => scrollTo(0, 0));
  await p.screenshot({ path: path.join(out, `${label}-home-hero.png`) });
  ok(`${label} home: headline sweeps in`, phone || (await p.locator("#heroT.sweep.go").count()) === 1);
  // A day at the studio: on desktop the clips stack as you scroll and only the one in front plays;
  // on phones each sits under its step.
  const dayAt = (f) => p.evaluate((f) => { const d = document.getElementById("day"); scrollTo({ top: d.offsetTop + f * (d.offsetHeight - innerHeight), behavior: "instant" }); }, f);
  await dayAt(0); await p.waitForTimeout(1200);
  ok(`${label} home: day story layout`, phone ? (await p.locator("#daySteps .day-card").count()) === 4 : (await p.locator("#day.scrolly").count()) === 1 && /7:00am/.test(await text("#daySteps li.on")));
  ok(`${label} home: dock shows once the hero has gone`, await p.locator("#dock.show").count() === 1);
  if (!phone) {
    ok(`${label} home: the clip in front plays`, await playing('.day-card[data-card="0"] video'));
    await dayAt(0.6); await p.waitForTimeout(1200);
    ok(`${label} home: WhatsApp step in front, and only it plays`, /6:02pm/.test(await text("#daySteps li.on")) && await playing('.day-card[data-card="2"] video') && await p.locator('.day-card[data-card="0"] video').evaluate((v) => v.paused));
    await dayAt(0.97); await p.waitForTimeout(1200);
    ok(`${label} home: pay step`, /11:59pm/.test(await text("#daySteps li.on")) && (await p.locator('.day-card[data-card="3"]:not(.below):not(.past)').count()) === 1);
  } else {
    await p.locator('.day-card[data-card="1"] video').scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
    ok(`${label} home: the phone clip plays under its step`, await playing('.day-card[data-card="1"] video'));
  }
  ok(`${label} home: simpler by design, three points`, (await p.locator(".three > div").count()) === 3);
  ok(`${label} home: locations each plan covers`, /up to 3[\s\S]*up to 5[\s\S]*SGD 199/.test(await text(".loc-note")));
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
  ok(`${label} product: a clip for every point`, (await p.locator(".vid.clip video").count()) === 7 && (await p.locator(".still").count()) === 0);
  await p.locator("#run .vid video").first().scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
  ok(`${label} product: the first clip plays`, await playing("#run .vid video"));
  await p.locator("#fill .vid video").first().scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
  ok(`${label} product: the journey clip plays`, await playing("#fill .vid video"));
  ok(`${label} product: Growth sold as trials into regulars`, /Turn trials into regulars/.test(await text("#fillT")));
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
  ok(`${label} pricing: locations priced up front`, (await p.locator(".locs > div").count()) === 4 && /SGD 199/.test(await text(".locs")));
  ok(`${label} pricing: no currency question`, !/Why are prices in Singapore dollars/.test(await text(".faq")));
  await p.screenshot({ path: path.join(out, `${label}-pricing-full.png`), fullPage: true });

  // Switching
  await nav("switching");
  ok(`${label} nav: to Switching`, p.url().endsWith("switching.html"));
  ok(`${label} switching: no sideways scroll`, await noHScroll());
  ok(`${label} switching: systems we move from`, (await p.locator(".mq-row li").count()) === 24 && /Mariana Tek/.test(await text(".marquee")));
  await videosOk("switching");
  await p.locator(".vid video").first().scrollIntoViewIfNeeded(); await p.waitForTimeout(1200);
  ok(`${label} switching: the move clip plays`, await playing(".vid video"));
  await p.locator('[data-from="momence"]').click();
  const mo = await text("#fromPanel");
  ok(`${label} switching: Momence comparison in SGD, with where we're stronger`, /Moving from Momence/.test(mo) && /SGD 585\+/.test(mo) && /Where we're stronger than Momence/.test(mo) && /Where Momence is stronger/.test(mo));
  ok(`${label} switching: locations covered, compared`, /Locations covered/.test(await text("#fromPanel")) && /Up to 3 on Growth/.test(await text("#fromPanel")));
  ok(`${label} switching: our column comes first`, (await p.locator("#fromPanel thead th").nth(1).innerText()) === "Us");
  await p.locator('[data-from="sheet"]').click();
  ok(`${label} switching: spreadsheet has no comparison table`, (await p.locator("#fromPanel table").count()) === 0);
  ok(`${label} switching: questions for any sales call`, (await p.locator("#asks .ask-row").count()) === 7);
  ok(`${label} switching: comparison is dated`, /November 2026/.test(await text(".dated")));
  await p.screenshot({ path: path.join(out, `${label}-switching-full.png`), fullPage: true });

  // Back home from the call to action
  await p.locator(".close .btn-line").click(); await p.waitForLoadState("load");
  ok(`${label} nav: walkthrough link goes home`, /index\.html#walkthrough$/.test(p.url()));
  await p.waitForTimeout(400);
  ok(`${label} home: the hero's main button starts a free trial`, (await p.locator(".hero .btn-main").getAttribute("href")) === "trial.html");

  // Free trial: from a plan card on Pricing, through the code, to ready (a preview: nothing sent)
  await open("pricing");
  ok(`${label} pricing: each plan offers a free trial`, (await p.locator('#plans a[href^="trial.html?plan="]').count()) === 3);
  await p.locator('#plans a[href="trial.html?plan=signature"]').click(); await p.waitForLoadState("load"); await p.waitForTimeout(500);
  ok(`${label} trial: the plan from the card is chosen`, await p.locator('input[name=plan][value=signature]').isChecked());
  ok(`${label} trial: no sideways scroll`, await noHScroll());
  ok(`${label} trial: marked as the current page, and its button still readable`, await p.evaluate(() => { const a = document.querySelector('#nav a[data-page="trial"]'); if (!a) return false; const cs = getComputedStyle(a); return a.getAttribute("aria-current") === "page" && cs.color !== cs.backgroundColor; }));
  ok(`${label} trial: says it's a preview`, /preview of the site/.test(await text("#trialMode")));
  ok(`${label} trial: no dock on the trial page`, (await p.locator("#dock").count()) === 0);
  const shared = readFileSync(path.join(here, "../../packages/shared/src/trial.ts"), "utf8").match(/TRIAL_TERMS = \[([\s\S]*?)\];/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  ok(`${label} trial: the terms match the API's`, JSON.stringify(await p.locator("#tTerms li").allTextContents()) === JSON.stringify(shared));
  await p.screenshot({ path: path.join(out, `${label}-trial-full.png`), fullPage: true });
  await p.locator('#stepAbout button[type="submit"]').click();
  ok(`${label} trial: says what's missing`, /Add your studio's name/.test(await text("#aboutMsg")) && (await p.locator("#tStudio").getAttribute("aria-invalid")) === "true");
  await p.fill("#tStudio", "Breathe Pilates"); await p.fill("#tFirst", "Olivia"); await p.fill("#tLast", "Tan"); await p.fill("#tEmail", "olivia@breathe.sg");
  await p.locator('#stepAbout button[type="submit"]').click();
  ok(`${label} trial: asks for the terms`, /accept the trial's terms/.test(await text("#aboutMsg")));
  await p.check("#tAgree");
  await p.locator('#stepAbout button[type="submit"]').click(); await p.waitForTimeout(300);
  ok(`${label} trial: the code step, with the email`, await p.locator("#stepCode").isVisible() && (await text("#codeTo")) === "olivia@breathe.sg" && await p.evaluate(() => document.activeElement?.id === "tCode"));
  await p.fill("#tCode", "123456"); await p.waitForTimeout(300);
  ok(`${label} trial: a wrong code is refused`, /didn't work/.test(await text("#codeMsg")));
  await p.locator("#changeEmail").click();
  ok(`${label} trial: back to change the email, details kept`, await p.locator("#stepAbout").isVisible() && (await p.inputValue("#tStudio")) === "Breathe Pilates");
  await p.locator('#stepAbout button[type="submit"]').click(); await p.waitForTimeout(300);
  await p.fill("#tCode", "000000"); await p.waitForTimeout(500);
  ok(`${label} trial: ready, on the plan chosen`, (await text("#readyT")) === "Breathe Pilates is ready." && /free trial of Signature runs until/.test(await text("#readySub")) && (await p.locator("#readyNext li").count()) === 3);
  ok(`${label} trial: says nothing was made`, /no studio was made/.test(await text("#readyMsg")));
  await p.screenshot({ path: path.join(out, `${label}-trial-ready.png`) });

  ok(`${label}: no page errors`, !errors.length, errors.join(" | "));
  await p.close();
}
{
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await p.goto(url("index")); await p.waitForTimeout(1200);
  ok("reduced motion: nothing plays by itself", await p.evaluate(() => [...document.querySelectorAll(".vid video")].every((v) => v.paused)));
  ok("reduced motion: each video offers Play", (await p.locator(".vid .vid-play").count()) === (await p.locator(".vid video").count()));
  ok("reduced motion: the day story is a plain list", (await p.locator("#day.scrolly").count()) === 0 && (await p.locator("#daySteps .day-card").count()) === 4);
  await p.locator(".hero .vid-play").click(); await p.waitForTimeout(1000);
  ok("reduced motion: Play starts it, with controls", await p.locator(".hero video").evaluate((v) => !v.paused && v.controls));
  await p.close();
}
// --- The trial against a real (local) API: dev sign-in, then POST /v1/trials ---------------------
if (process.argv.includes("--live")) {
  const DB = process.env.E2E_DATABASE_URL ?? "postgres://studio:studio@localhost:5432/studio_e2e";
  const dist = path.join(here, "dist");
  const site = createServer((req, res) => {
    const f = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!f.startsWith(dist) || !existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }).end(readFileSync(f));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => site.once("listening", r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const api = spawn("npx", ["tsx", "src/scripts/e2e-server.ts"], { cwd: path.join(here, "../api"), env: { ...process.env, E2E_DATABASE_URL: DB, PORT: "3996", WEB_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The API didn't start: " + log)), 90000);
    const on = (d) => { log += d; if (/E2E_API_READY/.test(log)) { clearTimeout(t); resolve(); } };
    api.stdout.on("data", on); api.stderr.on("data", on);
    api.on("exit", () => reject(new Error("The API stopped: " + log)));
  });
  // A copy of the page pointed at the local API (dev sign-in, code 000000).
  writeFileSync(path.join(dist, "trial-live-test.html"), readFileSync(path.join(dist, "trial.html"), "utf8").replace('data-api=""', 'data-api="http://127.0.0.1:3996"'));
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    const signUp = async ({ kind = "new", studio, email, plan = "growth" }) => {
      await p.goto(`${origin}/trial-live-test.html?plan=${plan}${kind === "existing" ? "&kind=existing" : ""}`); await p.waitForTimeout(400);
      await p.fill("#tStudio", studio); await p.fill("#tFirst", "Olivia"); await p.fill("#tLast", "Tan"); await p.fill("#tEmail", email); await p.check("#tAgree");
      await p.locator('#stepAbout button[type="submit"]').click(); await p.waitForTimeout(300);
      await p.fill("#tCode", "000000");
      await p.waitForFunction(() => !document.querySelector("#stepReady").hidden || document.querySelector("#codeMsg").textContent || document.querySelector("#aboutMsg").textContent, null, { timeout: 15000 });
    };
    ok("live trial: says it's running locally", /Running locally/.test(await (async () => { await p.goto(`${origin}/trial-live-test.html`); await p.waitForTimeout(500); return p.locator("#trialMode").innerText(); })()));
    await signUp({ studio: "Breathe Pilates", email: "olivia@breathe.sg" });
    ok("live trial: a new studio is made, on Growth, for 14 days", (await p.locator("#readyT").innerText()) === "Breathe Pilates is ready." && /free trial of Growth runs until/.test(await p.locator("#readySub").innerText()) && !(await p.locator("#readyMsg").innerText()));
    await signUp({ studio: "Second Studio", email: "olivia@breathe.sg" });
    ok("live trial: one trial per person", /already had a free trial/.test(await p.locator("#codeMsg").innerText()));
    await signUp({ kind: "existing", studio: "Harbour Yoga", email: "mei@harbour-yoga.sg", plan: "signature" });
    ok("live trial: the test studio for studios already on another system", (await p.locator("#readyT").innerText()) === "Your test studio is ready." && /Signature/.test(await p.locator("#readySub").innerText()));
    await signUp({ studio: "Throwaway", email: "someone@mailinator.com" });
    ok("live trial: a throwaway inbox goes back to the email", await p.locator("#stepAbout").isVisible() && /email address/.test(await p.locator("#aboutMsg").innerText()) && (await p.locator("#tEmail").getAttribute("aria-invalid")) === "true");
    ok("live trial: no page errors", !errors.length, errors.join(" | "));
    await p.close();
  } finally {
    try { process.kill(-api.pid); } catch {}
    try { unlinkSync(path.join(dist, "trial-live-test.html")); } catch {}
    site.close();
  }
}
// --- The same page with Supabase sign-in: a stand-in for Supabase's email-code endpoints (so no
// real email is sent), whose ES256 tokens the local API checks against its published keys, the way
// it checks the real project's.
if (process.argv.includes("--live")) {
  const DB = process.env.E2E_DATABASE_URL ?? "postgres://studio:studio@localhost:5432/studio_e2e";
  const dist = path.join(here, "dist");
  const KEY = "sb_publishable_standin";
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "standin", alg: "ES256", use: "sig" };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sent = [];
  const sbServer = createServer(async (req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, content-type, authorization", "access-control-allow-methods": "GET, POST, OPTIONS" };
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
    const json = (code, o) => res.writeHead(code, { ...cors, "content-type": "application/json" }).end(JSON.stringify(o));
    const url = new URL(req.url, "http://x").pathname;
    if (url === "/auth/v1/.well-known/jwks.json") return json(200, { keys: [jwk] });
    let body = ""; for await (const c of req) body += c;
    const data = body ? JSON.parse(body) : {};
    if (req.headers.apikey !== KEY) return json(401, { msg: "Invalid API key" });
    if (url === "/auth/v1/otp") { sent.push(data.email); return json(200, {}); }
    if (url === "/auth/v1/verify") {
      if (data.type !== "email" || data.token !== "424242" || !sent.includes(data.email)) return json(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      const now = Math.floor(Date.now() / 1000);
      const head = b64({ alg: "ES256", typ: "JWT", kid: "standin" });
      const claims = b64({ sub: randomUUID(), email: data.email, aud: "authenticated", iss: `${sbBase}/auth/v1`, role: "authenticated", iat: now, exp: now + 3600, user_metadata: { email_verified: true } });
      const sig = sign("sha256", Buffer.from(`${head}.${claims}`), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
      return json(200, { access_token: `${head}.${claims}.${sig}`, token_type: "bearer", expires_in: 3600 });
    }
    json(404, {});
  }).listen(0, "127.0.0.1");
  await new Promise((r) => sbServer.once("listening", r));
  const sbBase = `http://127.0.0.1:${sbServer.address().port}`;
  const site = createServer((req, res) => {
    const f = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!f.startsWith(dist) || !existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": f.endsWith(".html") ? "text/html" : "application/octet-stream" }).end(readFileSync(f));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => site.once("listening", r));
  const origin = `http://127.0.0.1:${site.address().port}`;
  const api = spawn("npx", ["tsx", "src/scripts/e2e-server.ts"], { cwd: path.join(here, "../api"), env: { ...process.env, E2E_DATABASE_URL: DB, PORT: "3995", WEB_ORIGIN: origin, AUTH_JWKS_URL: `${sbBase}/auth/v1/.well-known/jwks.json`, AUTH_ISSUER: `${sbBase}/auth/v1`, AUTH_AUDIENCE: "authenticated" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The API didn't start: " + log)), 90000);
    const on = (d) => { log += d; if (/E2E_API_READY/.test(log)) { clearTimeout(t); resolve(); } };
    api.stdout.on("data", on); api.stderr.on("data", on);
    api.on("exit", () => reject(new Error("The API stopped: " + log)));
  });
  writeFileSync(path.join(dist, "trial-sb-test.html"), readFileSync(path.join(dist, "trial.html"), "utf8").replace('data-api="" data-supabase-url="" data-supabase-key=""', `data-api="http://127.0.0.1:3995" data-supabase-url="${sbBase}" data-supabase-key="${KEY}"`));
  try {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${origin}/trial-sb-test.html?plan=essentials`); await p.waitForTimeout(500);
    ok("supabase trial: no preview note", await p.locator("#trialMode").isHidden());
    await p.fill("#tStudio", "Kiln Pilates"); await p.fill("#tFirst", "Priya"); await p.fill("#tLast", "Nair"); await p.fill("#tEmail", "Priya@Kiln.sg"); await p.check("#tAgree");
    await p.locator('#stepAbout button[type="submit"]').click(); await p.waitForTimeout(600);
    ok("supabase trial: Supabase is asked to email a code, with the publishable key", sent.at(-1) === "priya@kiln.sg" && await p.locator("#stepCode").isVisible());
    await p.fill("#tCode", "111111"); await p.waitForTimeout(800);
    ok("supabase trial: a wrong code is refused by Supabase", /didn't work/.test(await p.locator("#codeMsg").innerText()));
    await p.fill("#tCode", "424242");
    await p.waitForFunction(() => !document.querySelector("#stepReady").hidden || /\S/.test(document.querySelector("#codeMsg").textContent), null, { timeout: 15000 }).catch(() => {});
    ok("supabase trial: the API checks Supabase's token and makes the studio", (await p.locator("#readyT").innerText().catch(() => "")) === "Kiln Pilates is ready." && /Essentials/.test(await p.locator("#readySub").innerText()), await p.locator("#codeMsg").innerText());
    ok("supabase trial: nothing says it's a preview", !(await p.locator("#readyMsg").innerText()));
    ok("supabase trial: no page errors", !errors.length, errors.join(" | "));
    await p.close();
  } finally {
    try { process.kill(-api.pid); } catch {}
    try { unlinkSync(path.join(dist, "trial-sb-test.html")); } catch {}
    site.close(); sbServer.close();
  }
}
await b.close();
for (const [r, n] of results) console.log(r, n);
const failed = results.filter(([r]) => r === "FAIL").length;
console.log(failed, "failed of", results.length);
process.exit(failed ? 1 : 0);
