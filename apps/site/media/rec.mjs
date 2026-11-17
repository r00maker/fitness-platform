// Records short workflow videos of the real product (the clickable previews) for the website.
// Each shot opens a preview in Chromium, hides the preview-only controls, swaps in the sample
// studio's name, draws a cursor (or a touch dot on phones) that moves with eased motion, records
// every painted frame through the DevTools screencast, then ffmpeg crops, eases in a slow zoom,
// fades the loop's ends and encodes an mp4 (H.264, no sound) plus a poster image.
// Usage: node media/shots.mjs [name...]   (shots are defined in shots.mjs)
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "../../..");
export const OUT = path.join(here, "out");
const TMP = path.join(here, ".frames");

export const STUDIO = "Linden Reformer Studio";

// Runs in the page before anything else: quiet pop-ups, the name swap, hidden preview controls, the cursor.
function prelude({ studio, touch, hide, zoom, phone }) {
  window.__quiet = true;
  // Pages are drawn at 2x by zooming the page in a 2x window (the screencast only sends window
  // pixels). For phones, width breakpoints are doubled so the page still lays out as a phone.
  if (phone && zoom !== 1) {
    const mm = window.matchMedia.bind(window);
    const scale = (q) => q.replace(/(m(?:ax|in)-width:\s*)(\d+(?:\.\d+)?)px/g, (_, a, n) => `${a}${Number(n) * zoom}px`);
    window.matchMedia = (q) => mm(scale(q));
    const fixSheets = () => { for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch { continue; } for (const r of rules) if (r.media && /width/.test(r.media.mediaText) && !r.__z) { r.__z = 1; const t = scale(r.media.mediaText); while (r.media.length) r.media.deleteMedium(r.media.item(0)); t.split(",").forEach((m) => r.media.appendMedium(m.trim())); } } };
    window.__fixSheets = fixSheets;
  }
  const swap = (s) => s.replace(/Demo Studio/g, studio);
  const fix = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.data.includes("Demo Studio")) n.data = swap(n.data);
    root.querySelectorAll?.(".mark, .bp-logo").forEach((m) => { if (m.textContent.trim() === "D") m.textContent = studio[0]; });
    root.querySelectorAll?.("input, textarea").forEach((i) => { if (i.value?.includes("Demo Studio")) i.value = swap(i.value); });
    // Hide anything we've asked to hide by its text (e.g. waiver reminders).
    for (const { sel, text } of hide) [...(root.matches?.(sel) ? [root] : []), ...(root.querySelectorAll?.(sel) ?? [])].forEach((el) => { if (!text || new RegExp(text, "i").test(el.textContent)) el.style.setProperty("display", "none", "important"); });
  };
  const style = document.createElement("style");
  style.textContent = `
    .sample, #roles, .plandemo, .rolenote, #roleNote, .demo-only, .help-tip, [role="tooltip"] { display: none !important }
    * { scrollbar-width: none !important } *::-webkit-scrollbar { display: none !important }
    #__cur { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transform: translate(-200px, -200px); transition: none }
    #__cur svg { display: block; filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)) }
    #__cur.touch { width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: rgba(255,255,255,.28); border: 2px solid rgba(255,255,255,.75); box-shadow: 0 2px 10px rgba(0,0,0,.4) }
    .__ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2px solid rgba(166,192,220,.95); animation: __ring .55s cubic-bezier(.22,1,.36,1) forwards }
    @keyframes __ring { to { transform: scale(3.4); opacity: 0 } }`;
  const boot = () => {
    document.documentElement.style.zoom = String(zoom);
    window.__fixSheets?.();
    document.head.append(style);
    fix(document.body);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => (n.nodeType === 1 ? fix(n) : n.nodeType === 3 && n.data.includes("Demo Studio") && (n.data = swap(n.data)))))).observe(document.body, { childList: true, subtree: true });
    const cur = document.createElement("div");
    cur.id = "__cur";
    if (touch) cur.className = "touch";
    else cur.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2 L2 22 L7.2 17.4 L10.6 25.4 L14.2 23.8 L10.8 16 L18 16 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(cur);
    window.__cursor = (x, y) => { cur.style.transform = `translate(${x / zoom}px, ${y / zoom}px)`; };
    window.__ring = (x, y) => { const r = document.createElement("i"); r.className = "__ring"; r.style.left = x / zoom + "px"; r.style.top = y / zoom + "px"; document.body.append(r); setTimeout(() => r.replaceWith(), 700); };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * shot: { name, file (path from repo root), hash, phone, viewport, role, hide: [{sel, text}],
 *         crop: {x, y, w, h} in CSS px (default: whole viewport), out: output width px,
 *         zoom: end scale for a slow push-in (1 = none), run: async (api) => {} }
 */
export async function record(shot) {
  // Always close the browser, or a failed shot leaves the process running.
  const opened = [];
  const launch = chromium.launch.bind(chromium);
  try { return await recordOnce(shot, async () => { const b = await launch(); opened.push(b); return b; }); }
  finally { for (const b of opened) await b.close().catch(() => {}); }
}

async function recordOnce(shot, launchBrowser) {
  const Z = 2;
  const viewport = shot.viewport ?? (shot.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: viewport.width * Z, height: viewport.height * Z }, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(prelude, { studio: STUDIO, touch: !!shot.phone, hide: shot.hide ?? [], zoom: Z, phone: !!shot.phone });
  // A copy of the page with a hook into its code (like the preview's own checks), for setting up state.
  let file = path.join(ROOT, shot.file);
  const src = readFileSync(file, "utf8");
  if (src.includes("  // MKT-JS-END")) {
    file = path.join(path.dirname(file), `.rec-${shot.name}.html`);
    writeFileSync(file, src.replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END"));
  }
  await page.goto("file://" + file + (shot.hash ? "#" + shot.hash : ""));
  await page.waitForTimeout(700);

  let pos = { x: viewport.width * Z * 0.62, y: viewport.height * Z * 0.72 };
  const setCursor = (p) => page.evaluate(({ x, y }) => window.__cursor?.(x, y), p);
  const api = {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    js: (fn, arg) => page.evaluate(fn, arg),
    role: async (r) => { await page.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`)?.click(), r); await page.waitForTimeout(300); },
    nav: async (n) => { await page.evaluate((x) => document.querySelector(`[data-nav="${x}"]`)?.click(), n); await page.waitForTimeout(400); },
    async moveTo(target, { ms = 650, dx = 0, dy = 0 } = {}) {
      let to = typeof target === "object" ? { x: target.x * Z, y: target.y * Z } : target;
      if (typeof target === "string") {
        const loc = page.locator(target).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
        const b = await loc.boundingBox({ timeout: 3000 });
        if (!b) throw new Error(`${shot.name}: nothing to point at for ${target}`);
        to = { x: b.x + b.width / 2 + dx * Z, y: b.y + b.height / 2 + dy * Z };
      }
      // The cursor glides in the page (smooth, frame by frame); the real pointer follows in a few steps.
      const from = { ...pos };
      const glide = page.evaluate(({ from, to, ms }) => new Promise((done) => {
        const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const t0 = performance.now();
        (function f(now) { const t = Math.min(1, (now - t0) / ms), k = e(t); window.__cursor?.(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k); t < 1 ? requestAnimationFrame(f) : done(); })(t0);
      }), { from, to, ms });
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await glide;
      pos = to;
    },
    async click(target, opts) {
      if (target) await api.moveTo(target, opts);
      await page.waitForTimeout(140);
      await page.evaluate(({ x, y }) => window.__ring?.(x, y), pos);
      await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up();
      await page.waitForTimeout(260);
    },
    async type(target, text, delay = 55) {
      if (target) await api.click(target);
      for (const ch of text) { await page.keyboard.type(ch); await page.waitForTimeout(delay + Math.random() * delay * 0.8); }
    },
    ev: (code) => page.evaluate((c) => window.__t(c), code),
    async select(target, label) { await api.click(target); await page.waitForTimeout(250); await page.selectOption(target, typeof label === "object" ? label : { label }, { timeout: 3000 }); await page.waitForTimeout(350); },
    async fill(target, value) { await api.click(target); await page.locator(target).first().fill(value, { timeout: 3000 }); await page.waitForTimeout(300); },
    async clear(target) { await page.locator(target).first().fill("", { timeout: 3000 }); },
    async ifVisible(sel, fn) { if (await page.locator(sel).first().isVisible().catch(() => false)) await fn(); },
    async scroll(dy, ms = 900) {
      const steps = Math.round(ms / 16); let done = 0;
      for (let i = 1; i <= steps; i++) { const want = Math.round(dy * Z * ease(i / steps)); await page.mouse.wheel(0, want - done); done = want; await page.waitForTimeout(16); }
    },
  };
  if (shot.setup) await shot.setup(api);
  await setCursor(pos);
  await page.waitForTimeout(300);

  // Record every painted frame with its time.
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const file = path.join(TMP, `f${String(frames.length).padStart(5, "0")}.jpg`);
    frames.push({ file, t: f.metadata.timestamp });
    writeFileSync(file, Buffer.from(f.data, "base64"));
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  // A tiny always-moving pixel keeps frames coming while nothing else changes.
  await page.evaluate(() => { const d = document.createElement("i"); d.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:2147483647"; document.body.append(d); let k = 0; (function tick() { d.style.transform = `translateX(${(k++ % 2)}px)`; requestAnimationFrame(tick); })(); });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: viewport.width * Z, maxHeight: viewport.height * Z, everyNthFrame: 1 });
  const t0 = Date.now() / 1000;
  await page.waitForTimeout(500);
  await shot.run(api);
  await page.waitForTimeout(shot.tail ?? 900);
  const tEnd = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  await page.waitForTimeout(200);
  await browser.close();
  if (file !== path.join(ROOT, shot.file)) rmSync(file, { force: true });
  if (errors.length) console.warn(`${shot.name}: page errors: ${errors.join(" | ")}`);
  if (frames.length < 10) throw new Error(`${shot.name}: only ${frames.length} frames`);

  // Frame list with real durations, then crop, zoom, fade and encode.
  const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.001, ((frames[i + 1]?.t ?? tEnd) - f.t)).toFixed(4)}`).join("\n") + `\nfile '${frames.at(-1).file}'\n`;
  writeFileSync(path.join(TMP, "list.txt"), list);
  const c = shot.crop ?? { x: 0, y: 0, w: viewport.width, h: viewport.height };
  // The screencast's frames may be smaller than the device pixels: crop in the frames' own scale.
  const fw = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", frames[0].file]).toString().trim());
  const k = fw / viewport.width;
  const px = (v) => Math.round(v * k / 2) * 2;
  const outW = shot.out ?? 1280;
  const outH = Math.round((outW * c.h) / c.w / 2) * 2;
  const dur = (tEnd - frames[0].t);
  const z = shot.zoom ?? 1;
  const filters = [
    `crop=${px(c.w)}:${px(c.h)}:${px(c.x)}:${px(c.y)}`,
    "fps=30",
    // Slow push-in towards zoomAt (0..1 across the frame), one step per frame.
    z > 1 ? `zoompan=z='1+${(z - 1).toFixed(3)}*min(on/${Math.round(dur * 30)},1)':x='(iw-iw/zoom)*${shot.zoomAt?.x ?? 0.5}':y='(ih-ih/zoom)*${shot.zoomAt?.y ?? 0.5}':d=1:s=${px(c.w)}x${px(c.h)}:fps=30` : null,
    `scale=${outW}:${outH}:flags=lanczos`,
    `fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, dur - 0.4).toFixed(2)}:d=0.4`,
    "format=yuv420p",
  ].filter(Boolean).join(",");
  mkdirSync(OUT, { recursive: true });
  const mp4 = path.join(OUT, `${shot.name}.mp4`), poster = path.join(OUT, `${shot.name}.jpg`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(TMP, "list.txt"), "-vf", filters, "-c:v", "libx264", "-preset", "slow", "-crf", String(shot.crf ?? 27), "-profile:v", "high", "-movflags", "+faststart", "-an", mp4]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String((shot.posterAt ?? 0.55) * dur), "-i", mp4, "-frames:v", "1", "-q:v", "4", poster]);
  rmSync(TMP, { recursive: true, force: true });
  const kb = (f) => Math.round(statSync(f).size / 1024);
  console.log(`${shot.name}: ${dur.toFixed(1)}s, ${frames.length} frames (${fw}px wide), ${outW}x${outH}, ${kb(mp4)} KB (+ poster ${kb(poster)} KB)`);
}
