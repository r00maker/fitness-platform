// The attachment quick view (PDF drawn on the page, photos too, no new window) and the studio's
// waitlist setting. pdf.js comes from cdnjs in the real preview; here it's served from a local
// copy of the same version (set PDFJS_DIR, e.g. a folder holding pdfjs-dist@3.11.174's build/).
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "qv");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "qv-test.html"), src);
const file = "file://" + path.join(__dirname, "qv-test.html");
const PDFJS_DIR = process.env.PDFJS_DIR;
if (!PDFJS_DIR) { console.log("Set PDFJS_DIR to a folder with pdf.min.js and pdf.worker.min.js (pdfjs-dist@3.11.174/build)."); process.exit(1); }
// A tiny real PNG (red square) for the photo case.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGP8z8BAEmAiTfmoBhgYAAJPAQ/4T/XnAAAAAElFTkSuQmCC", "base64");

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
    await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/*", (route) => {
      const name = route.request().url().split("/").pop();
      route.fulfill({ status: 200, contentType: "application/javascript", body: fs.readFileSync(path.join(PDFJS_DIR, name)) });
    });
    const p = await ctx.newPage();
    const errors = [];
    let popups = 0;
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("popup", () => popups++);
    ctx.on("page", () => popups++);
    p.on("dialog", (d) => d.dismiss());
    await p.goto(file);
    await p.waitForTimeout(200);
    const go = async (id) => { await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(150); };
    const shot = (n) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`) });
    const click = async (sel) => { await p.locator(sel).first().click(); await p.waitForTimeout(150); };
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const inked = (sel) => p.evaluate((s) => { const c = document.querySelector(s); if (!c) return 0; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 200) n++; return n; }, sel);

    // --- Quick view: a PDF on the Packages page ---
    await go("packages");
    ok(`${label}: the request with a file has a quick-view chip`, (await p.locator(".attchip").count()) === 1 && /physio-note\.pdf/.test(await p.locator(".attchip").textContent()));
    await click(".attchip");
    await p.waitForSelector(".qvpage", { timeout: 10000 }).catch(() => {});
    ok(`${label}: opens on the page, not a new window`, popups === 0 && (await p.locator(".modal.qv").count()) === 1);
    ok(`${label}: says what it is`, (await p.locator("#qvTitle").textContent()) === "physio-note.pdf" && /PDF, 2 pages/.test(await p.locator("#qvMeta").textContent()));
    ok(`${label}: both pages drawn`, (await p.locator(".qvpage").count()) === 2);
    ok(`${label}: the page has real content (${await inked('.qvpage[data-page="1"]')} dark samples)`, (await inked('.qvpage[data-page="1"]')) > 200);
    ok(`${label}: page counter`, (await p.locator("#qvPage").textContent()) === "Page 1 of 2");
    await shot("pdf");
    const w1 = await p.evaluate(() => document.querySelector(".qvpage").getBoundingClientRect().width);
    await click("#qvIn");
    await p.waitForTimeout(300);
    const w2 = await p.evaluate(() => document.querySelector(".qvpage").getBoundingClientRect().width);
    ok(`${label}: zoom in makes it bigger (${Math.round(w1)} → ${Math.round(w2)})`, w2 > w1 * 1.2 && (await p.locator("#qvZoom").textContent()) === "125%");
    if (label !== "phone") { await click("#qvFit"); await p.waitForTimeout(300); ok(`${label}: fit width goes back`, (await p.locator("#qvZoom").textContent()) === "Fit"); }
    await p.evaluate(() => { const b = document.querySelector("#qvBody"); b.scrollTop = b.scrollHeight; b.dispatchEvent(new Event("scroll")); });
    await p.waitForTimeout(100);
    ok(`${label}: counter follows scrolling`, (await p.locator("#qvPage").textContent()) === "Page 2 of 2");
    await p.keyboard.press("Escape");
    await p.waitForTimeout(100);
    ok(`${label}: Esc closes it`, (await p.locator(".modal.qv").count()) === 0);

    // --- A photo a client attached ---
    await ev(`(() => { const r = EXTREQ.find((x) => !x.file); r.file = "xray.png"; ATTACH.set(r.id, { name: "xray.png", type: "image/png", data: () => Promise.resolve(new Uint8Array([${[...PNG].join(",")}])) }); render(); })()`);
    await p.waitForTimeout(150);
    await p.locator(".attchip", { hasText: "xray.png" }).click();
    await p.waitForSelector(".qvimg", { timeout: 5000 }).catch(() => {});
    ok(`${label}: photos show in the same viewer`, (await p.locator(".qvimg").count()) === 1 && (await p.evaluate(() => document.querySelector(".qvimg").naturalWidth)) === 16 && /Photo/.test(await p.locator("#qvMeta").textContent()));
    await click('.qv [data-mclose]');
    ok(`${label}: close button works`, (await p.locator(".modal.qv").count()) === 0);
    ok(`${label}: still no new windows`, popups === 0);

    // --- Waitlist setting ---
    await go("policies");
    ok(`${label}: Studio rules has "How waitlists work"`, (await p.locator("#pWlModes option").count()) === 3);
    await p.evaluate(() => { const s = document.querySelector("#pWlModes"); s.value = "automatic"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.evaluate(() => document.querySelector("#polForm").requestSubmit());
    await p.waitForTimeout(150);
    ok(`${label}: setting saved`, (await ev("STUDIO.wlModes")) === "automatic");
    const full = await ev(`(() => { const s = SESSIONS.find((x) => x.status === "scheduled" && x.start > addDays(NOW, 1) && x.start < addDays(NOW, 6) && x.roster.length >= x.cap && !x.roster.some((r) => r.ci === 0) && !x.waitlist.some((w) => w.ci === 0) && x.waitlistOn !== false); return s && s.id; })()`);
    await role("client");
    await ev(`openDrawer(${full})`);
    ok(`${label}: clients aren't asked to choose`, (await p.locator('.drawer input[name="wlmode"]:not([hidden])').count()) === 0 && /We'll book you in automatically/.test(await p.locator(".drawer").textContent()));
    await click('.drawer [data-act="joinWl"]');
    ok(`${label}: they join the studio's way`, (await ev(`SESSIONS.find((s) => s.id === ${full}).waitlist.find((w) => w.ci === ME.client)?.mode`)) === "automatic");
    await ev("closeDrawer()");
    await role("admin");
    await go("policies");
    await p.evaluate(() => { const s = document.querySelector("#pWlModes"); s.value = "both"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.evaluate(() => document.querySelector("#polForm").requestSubmit());
    await role("client");
    await ev(`(() => { const s = SESSIONS.find((x) => x.id === ${full}); s.waitlist = s.waitlist.filter((w) => w.ci !== ME.client); })()`);
    await ev(`openDrawer(${full})`);
    ok(`${label}: with "Clients choose", both options are back`, (await p.locator('.drawer input[name="wlmode"]:not([hidden])').count()) === 2);
    await ev("closeDrawer()");
    await role("admin");

    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await ctx.close();
  }

  // If the PDF reader can't load, say so plainly.
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.route("https://cdnjs.cloudflare.com/**", (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(file);
  await p.evaluate(() => (location.hash = "packages"));
  await p.waitForTimeout(200);
  await p.locator(".attchip").click();
  await p.waitForTimeout(800);
  ok(`offline: explains the reader didn't load`, /The PDF reader didn't load/.test(await p.locator(".qv").textContent()));
  await ctx.close();

  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
