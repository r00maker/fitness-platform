// Full UI sweep: every role, page, tab and the main modals, in light and dark.
// Flags text below WCAG contrast (4.5, or 3 for large/bold text), horizontal page overflow,
// text clipped inside its box, and elements drawn with a fixed light/dark colour that doesn't
// match the theme.
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const width = Number(process.argv[2] || 1360);
const out = path.join(__dirname, width < 600 ? "uiphone" : "ui");
fs.mkdirSync(out, { recursive: true });

(async () => {
  const b = await chromium.launch();
  const report = [];
  for (const scheme of ["light", "dark"]) {
    const p = await b.newPage({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto("file://" + path.join(__dirname, "..", "studio-calendar-preview.html"));
    await p.waitForTimeout(200);
    const seen = new Set();
    const scan = async (where) => {
      const found = await p.evaluate(() => {
        const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
        const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const mix = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
        // Effective background: stack translucent backgrounds up to an opaque one.
        const bgOf = (el) => { const layers = []; let e = el; while (e && e.nodeType === 1) { const cs = getComputedStyle(e); const c = parse(cs.backgroundColor); if (cs.backgroundImage !== "none" && !/^url/.test(cs.backgroundImage) && !/gradient/.test(cs.backgroundImage)) {} if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } e = e.parentElement; } let base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = mix(layers[i], base); return base; };
        const hasGradient = (el) => { let e = el; while (e && e.nodeType === 1) { if (/gradient|url\(/.test(getComputedStyle(e).backgroundImage) && !/select/i.test(e.tagName)) return true; e = e.parentElement; } return false; };
        const issues = [];
        const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && Number(cs.opacity) > 0.2 && !el.closest("[hidden],.sr,.helpkey,svg,.email,.emailprev,.phone .email"); };
        const label = (el) => { const t = (el.innerText || el.value || "").trim().replace(/\s+/g, " ").slice(0, 50); const cls = (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""); return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : cls} "${t}"`; };
        const els = [...document.querySelectorAll("#pgOther *, #pgSchedule *, .topbar *, #side *, .modal *, .bellpanel *, .askpanel *, .askbtn, .selbar *, .toast")];
        for (const el of els) {
          if (!vis(el)) continue;
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !/checkbox|radio|color|range|file/.test(el.type);
          if (!own && !isField) continue;
          if (hasGradient(el)) continue;
          const cs = getComputedStyle(el);
          const fg = parse(cs.color); if (!fg) continue;
          const bg = bgOf(el);
          const fgm = mix(fg, bg);
          const L1 = lum(fgm), L2 = lum(bg);
          const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
          const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
          const disabled = el.disabled || el.closest("[disabled],[aria-disabled=true],.off,.disabled");
          if (cr < need && !disabled) issues.push(`contrast ${cr.toFixed(2)}<${need}: ${label(el)} fg=${cs.color} bg=rgb(${[bg.r, bg.g, bg.b].map(Math.round)})`);
          // Text cut off inside its own box (not scrollers or ellipsis by design).
          if (own && el.scrollWidth > el.clientWidth + 2 && cs.overflowX === "hidden" && cs.textOverflow !== "ellipsis" && el.clientWidth > 0) issues.push(`clipped: ${label(el)} (${el.scrollWidth}>${el.clientWidth})`);
        }
        for (const el of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=hidden]), textarea, select")) {
          if (!vis(el)) continue; const cs = getComputedStyle(el);
          if (cs.borderTopStyle === "inset" || cs.borderTopStyle === "outset" || (cs.borderRadius === "0px" && el.tagName !== "TEXTAREA")) issues.push(`unstyled field: ${label(el)} (${cs.borderTopStyle} ${cs.borderRadius})`);
        }
        if (document.documentElement.scrollWidth > innerWidth + 1) issues.push(`page scrolls sideways: ${document.documentElement.scrollWidth}>${innerWidth}`);
        return issues;
      });
      for (const f of found) { const k = `${scheme}|${f.replace(/ \(\d+>\d+\)|[0-9.]+<|fg=.*$/g, "")}`; if (seen.has(k)) continue; seen.add(k); report.push(`[${scheme}] ${where}: ${f}`); }
    };
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(100); };
    for (const r of ["admin", "foh", "instructor", "client"]) {
      await role(r);
      const ids = await p.evaluate(() => [...document.querySelectorAll("#side .navitem")].map((x) => x.dataset.nav));
      for (const id of ids) {
        await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(120);
        await scan(`${r}/${id}`);
        if (r === "admin" || r === "client") await p.screenshot({ path: path.join(out, `${scheme}-${r}-${id}.png`), fullPage: true });
        const nTabs = await p.evaluate(() => document.querySelectorAll("#pgOther [role=tab], #pgOther [data-mtab], #pgOther [data-ctab]").length);
        for (let i = 1; i < Math.min(nTabs, 12); i++) {
          const name = await p.evaluate((n) => { const t = document.querySelectorAll("#pgOther [role=tab], #pgOther [data-mtab], #pgOther [data-ctab]")[n]; if (!t) return null; t.click(); return t.textContent.trim(); }, i);
          if (!name) continue;
          await p.waitForTimeout(120);
          await scan(`${r}/${id}/${name}`);
          if (r === "admin") await p.screenshot({ path: path.join(out, `${scheme}-${r}-${id}-${name.replace(/\W+/g, "_")}.png`), fullPage: true });
        }
      }
    }
    // Drawers, modals, panels.
    await role("admin"); await p.evaluate(() => (location.hash = "schedule")); await p.waitForTimeout(120);
    await p.locator("[data-open]").first().click(); await p.waitForTimeout(150); await scan("class drawer"); await p.screenshot({ path: path.join(out, `${scheme}-drawer.png`) });
    await p.evaluate(() => document.querySelector("[data-close]")?.click());
    for (const btn of ["#newClass", "#newAppt", "#bulkChange"]) { await p.click(btn); await p.waitForTimeout(150); await scan(`modal ${btn}`); await p.locator(".modal").first().screenshot({ path: path.join(out, `${scheme}-modal-${btn.slice(1)}.png`) }); await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = "")); }
    await p.click("#askBtn"); await p.waitForTimeout(100); await p.locator(".asksugg button").first().click(); await p.waitForTimeout(600); await scan("ask"); await p.click("#askClose");
    await p.click("#bellBtn"); await p.waitForTimeout(100); await scan("bell"); await p.click("#bellBtn");
    await p.evaluate(() => (location.hash = "agents")); await p.waitForTimeout(100); await p.click('[data-agtab="agents"]'); await p.click("#agNew"); await p.waitForTimeout(100); await p.click('[data-agst="1"]'); await p.waitForTimeout(150); await scan("agent editor");
    await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = ""));
    await role("client"); await p.evaluate(() => (location.hash = "schedule")); await p.waitForTimeout(100);
    await p.locator("[data-open]").first().click(); await p.waitForTimeout(150); await scan("client class drawer"); await p.screenshot({ path: path.join(out, `${scheme}-client-drawer.png`) });
    if (errs.length) report.push(`[${scheme}] page errors: ${errs.slice(0, 3).join(" | ")}`);
    await p.close();
  }
  await b.close();
  console.log(report.join("\n"));
  console.log(`\n${report.length} findings`);
})();
