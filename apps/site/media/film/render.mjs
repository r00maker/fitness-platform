// Renders the films: opens stage.html for each, steps time frame by frame (seek(t)), screenshots
// each frame, and pipes them to ffmpeg for an H.264 mp4 and a VP9 WebM, plus a poster.
// Usage: NODE_PATH=<playwright's node_modules> node media/film/render.mjs [name...] [--fps=30] [--preview]
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const STILLS = path.join(here, "..", "stills");
const OUT = path.join(here, "..", "out");
mkdirSync(OUT, { recursive: true });

// The stills' sizes and detail boxes, for the engine.
const data = {};
for (const f of readdirSync(STILLS).filter((x) => x.endsWith(".json"))) data[f.replace(".json", "")] = JSON.parse(readFileSync(path.join(STILLS, f), "utf8"));
writeFileSync(path.join(STILLS, "index.js"), `window.STILLS_DATA = ${JSON.stringify(data)};\n`);

const args = process.argv.slice(2);
const fps = Number(args.find((a) => a.startsWith("--fps="))?.slice(6) ?? 30);
const preview = args.includes("--preview");
const names = args.filter((a) => !a.startsWith("--"));
const all = ["hero", "dayCover", "dayClasses", "dayWhatsapp", "dayPay", "checks", "journey", "locations", "ask", "move"];
// The hero plays big and first, so it gets 60 frames a second; the rest 30.
const fpsFor = (n) => (n === "hero" ? 60 : fps);

const browser = await chromium.launch();
try {
  for (const name of names.length ? names : all) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("file://" + path.join(here, "stage.html") + "?film=" + name);
    await page.waitForFunction(() => document.fonts.status === "loaded" && [...document.images].every((i) => i.complete));
    await page.waitForTimeout(300);
    if (errors.length) throw new Error(`${name}: ${errors.join(" | ")}`);
    const dur = await page.evaluate(() => window.FILM_DUR);
    if (preview) {
      // A contact sheet of 12 moments, for review.
      const dir = path.join(here, "..", ".preview"); mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 12; i++) { const t = (dur * (i + 0.5)) / 12; await page.evaluate((x) => window.seek(x), t); await page.screenshot({ path: path.join(dir, `${name}-${String(i).padStart(2, "0")}.jpg`), type: "jpeg", quality: 80 }); }
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(dir, `${name}-%02d.jpg`), "-vf", "scale=640:-2,tile=4x3:padding=6:color=white", "-frames:v", "1", path.join(dir, `${name}.png`)]);
      console.log(`${name}: preview ${dur}s -> media/.preview/${name}.png`);
      await page.close();
      continue;
    }
    const mp4 = path.join(OUT, `film-${name}.mp4`);
    const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fpsFor(name)), "-c:v", "mjpeg", "-i", "-",
      "-vf", "fade=t=in:st=0:d=0.3", "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-tune", "animation", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart", "-an", mp4], { stdio: ["pipe", "inherit", "inherit"] });
    const f = fpsFor(name), frames = Math.round(dur * f);
    for (let i = 0; i < frames; i++) {
      await page.evaluate((x) => window.seek(x), i / f);
      const buf = await page.screenshot({ type: "jpeg", quality: 92 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    }
    ff.stdin.end();
    await new Promise((r, j) => ff.on("close", (c) => (c ? j(new Error(`ffmpeg ${c}`)) : r())));
    const webm = mp4.replace(".mp4", ".webm"), poster = mp4.replace(".mp4", ".jpg");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "42", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-an", webm]);
    // Poster: the first frame where the film has settled (a caption on screen).
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(2.2, dur / 3)), "-i", mp4, "-frames:v", "1", "-q:v", "3", "-vf", "scale=1600:-2", poster]);
    const kb = (f) => Math.round(statSync(f).size / 1024);
    console.log(`${name}: ${dur}s, ${frames} frames, mp4 ${kb(mp4)} KB, webm ${kb(webm)} KB, poster ${kb(poster)} KB`);
    await page.close();
  }
} finally { await browser.close(); }
