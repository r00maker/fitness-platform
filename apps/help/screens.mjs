// Takes the help centre's screenshots from the studio preview (preview/studio-calendar-preview.html):
// opens each page, hides the preview-only controls, outlines the part an article talks about, and
// saves a 2x WebP into docs/help/centre/img/. Re-run after the screens change.
// Usage: NODE_PATH=<playwright's node_modules> node apps/help/screens.mjs [name...]
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(root, "docs/help/centre/img");
const tmp = path.join(here, ".shots");
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

// A copy of the preview with a hook to run its code (as the preview's own checks do).
const page = path.join(tmp, "preview.html");
writeFileSync(page, readFileSync(path.join(root, "preview/studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END"));

const HIDE = `.sample, #roles, .plandemo, .rolenote, #roleNote, .demo-only, .help-tip, [role="tooltip"], .toast, #askBtn, .askbtn { display: none !important }
  * { scrollbar-width: none !important; caret-color: transparent !important } *::-webkit-scrollbar { display: none !important }
  .__hl { outline: 3px solid #e2622f !important; outline-offset: 4px !important; border-radius: 10px !important; position: relative; z-index: 5 }`;

/** Each shot: where to go, what to do, what to outline and what to capture. */
const SHOTS = [
  { name: "tour", hash: "home", clip: "viewport", outline: "nav, .sidebar, aside" },
  { name: "home", hash: "home", clip: ".main" },
  { name: "features", hash: "features", clip: ".main", height: 900 },
  { name: "schedule", hash: "schedule", clip: ".main", height: 820 },
  { name: "new-class", hash: "schedule", act: async (p) => { await clickText(p, /New class/); }, clip: "dialog" },
  { name: "class-panel", hash: "schedule", act: async (p) => { await p.locator('.main button:has-text("Vinyasa Yoga")').last().click(); await p.waitForTimeout(500); }, clip: "dialog", outline: 'button:has-text("Add client")' },
  { name: "check-in", role: /Instructor/, hash: "home", act: async (p) => { await p.locator("[data-checkin]").first().click(); await p.waitForTimeout(600); }, clip: "#ciRoot > *" },
  { name: "closures", hash: "closures", act: async (p) => { await clickText(p, /Add closure/); }, clip: "dialog" },
  { name: "cover", hash: "cover", clip: ".main", height: 760 },
  { name: "packages", hash: "packages", clip: ".main", height: 820 },
  { name: "sales", hash: "sales", clip: ".main", height: 820 },
  { name: "payments", hash: "payments", clip: ".main", height: 820 },
  { name: "tell", hash: "tell", clip: ".main", height: 900 },
  { name: "reports", hash: "reports", clip: ".main", height: 820, outline: "text=/^Export/" },
  { name: "booking-page", hash: "booking-page", clip: ".main", height: 900 },
  { name: "app-look", hash: "app-look", clip: ".main", height: 900 },
  { name: "studio-rules", hash: "policies", act: async (p) => { await p.locator("#rlSearch").fill("cancel"); await p.waitForTimeout(400); }, clip: ".main", height: 760, outline: "#rlSearch" },
];

async function clickText(p, re) {
  const el = p.getByRole("button", { name: re }).first();
  await el.click();
  await p.waitForTimeout(500);
}

const only = process.argv.slice(2);
const browser = await chromium.launch();
const done = [], failed = [];
for (const s of SHOTS.filter((x) => !only.length || only.includes(x.name))) {
  const p = await browser.newPage({ viewport: { width: 1440, height: s.height ?? 900 }, deviceScaleFactor: 2, colorScheme: "light" });
  try {
    await p.addInitScript(() => { window.__quiet = true; });
    await p.goto("file://" + page);
    await p.waitForTimeout(400);
    if (s.role) { await p.locator("#roles").getByRole("button", { name: s.role }).first().click(); await p.waitForTimeout(400); }
    await p.addStyleTag({ content: HIDE });
    await p.evaluate((h) => (location.hash = h), s.hash);
    await p.waitForTimeout(600);
    await p.addStyleTag({ content: HIDE });
    if (s.act) await s.act(p);
    if (s.outline) {
      const loc = s.outline.startsWith("text=") ? p.locator(s.outline).first() : p.locator(s.outline).first();
      await loc.evaluate((el) => el.classList.add("__hl")).catch(() => {});
    }
    const file = path.join(tmp, `${s.name}.png`);
    if (s.clip === "viewport") await p.screenshot({ path: file });
    else {
      let target = null;
      if (s.clip === "dialog" || s.clip === "dialog-or-main") {
        const d = p.locator('[role="dialog"]:visible, .modal:visible, .sheet:visible, .panel:visible').last();
        if (await d.count()) target = d;
        else if (s.clip === "dialog") throw new Error("no dialog opened");
      }
      target ??= p.locator(s.clip === "dialog-or-main" ? ".main" : s.clip).first();
      await target.screenshot({ path: file });
    }
    // WebP keeps the screenshots small; 2x stays sharp on any screen.
    execFileSync("python3", ["-c", `from PIL import Image; im = Image.open(${JSON.stringify(file)}).convert("RGB"); im.save(${JSON.stringify(path.join(out, s.name + ".webp"))}, "WEBP", quality=82, method=6)`]);
    done.push(s.name);
  } catch (e) {
    failed.push(`${s.name}: ${e.message.split("\n")[0]}`);
  } finally { await p.close(); }
}
await browser.close();
rmSync(page);
console.log("saved:", done.join(", ") || "none");
if (failed.length) { console.log("failed:\n  " + failed.join("\n  ")); process.exitCode = 1; }
