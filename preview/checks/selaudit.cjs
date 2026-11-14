const { chromium, devices } = require("playwright");
const scheme = process.argv[2] || "light";
const engine = process.argv[3] || "chromium";
(async () => {
  const pw = require("playwright");
  const b = await pw[engine].launch(engine === "chromium" ? {} : {});
  const p = await b.newPage({ viewport: { width: 1360, height: 900 }, colorScheme: scheme });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("file://" + __dirname + "/../studio-calendar-preview.html"); await p.waitForTimeout(200);
  const rows = new Map();
  const collect = async (where) => {
    const list = await p.evaluate(() => {
      const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, bb] = m.slice(0, 3).map((x) => { x = x / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bb; };
      const bgOf = (el) => { while (el) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; el = el.parentElement; } return "rgb(255,255,255)"; };
      return [...document.querySelectorAll("select")].filter((s) => s.offsetParent).map((s) => {
        const cs = getComputedStyle(s); const bg = bgOf(s); const L1 = lum(cs.color), L2 = lum(bg);
        const cr = L1 == null || L2 == null ? 0 : (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const opt = s.options[s.selectedIndex]; 
        // Is the chosen text wider than the box (cut off)?
        const c = document.createElement("canvas").getContext("2d"); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const need = opt ? c.measureText(opt.text).width + parseFloat(cs.paddingLeft) + 22 : 0;
        return { id: s.id || s.className || s.name || "(no id)", sig: [cs.appearance, cs.backgroundColor, cs.color, cs.borderTopColor, cs.borderRadius, cs.height, cs.fontSize, cs.backgroundImage === "none" ? "noimg" : "img"].join(" | "), contrast: Math.round(cr * 10) / 10, cut: need > s.clientWidth + 1 ? `${opt.text} (${Math.round(need)}>${s.clientWidth})` : "" };
      });
    });
    for (const x of list) { const k = x.sig; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(`${where}#${x.id}${x.contrast < 4.5 ? ` LOWCONTRAST ${x.contrast}` : ""}${x.cut ? ` CUT ${x.cut}` : ""}`); }
  };
  const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(120); };
  for (const r of ["admin", "foh", "instructor", "client"]) {
    await role(r);
    const ids = await p.evaluate(() => [...document.querySelectorAll("#side .navitem")].map((b) => b.dataset.nav));
    for (const id of ids) {
      await p.evaluate((x) => (location.hash = x), id); await p.waitForTimeout(120);
      await collect(`${r}/${id}`);
      const tabs = await p.evaluate(() => [...document.querySelectorAll("#pgOther [role=tab]")].map((t, i) => i));
      for (const i of tabs) { await p.evaluate((n) => document.querySelectorAll("#pgOther [role=tab]")[n]?.click(), i); await p.waitForTimeout(120); await collect(`${r}/${id}/tab${i}`);
        const sub = await p.evaluate(() => document.querySelectorAll("#pgOther [role=tab]").length); }
    }
  }
  // Modals
  await role("admin"); await p.evaluate(() => (location.hash = "schedule")); await p.waitForTimeout(120);
  for (const btn of ["#newClass", "#newAppt", "#bulkChange"]) { await p.click(btn); await p.waitForTimeout(150); await collect(`modal${btn}`); if (btn === "#bulkChange") { await p.click('#bkForm button[type=submit]'); await p.waitForTimeout(150); await collect("modal-bulk2"); } await p.evaluate(() => (document.querySelector("#modalRoot").innerHTML = "")); }
  await p.evaluate(() => (location.hash = "agents")); await p.waitForTimeout(120); await p.click('[data-agtab="agents"]'); await p.waitForTimeout(100); await p.click("#agNew"); await p.waitForTimeout(100); await p.click('[data-agst="1"]'); await p.waitForTimeout(150); await collect("modal-agent");
  for (const [k, v] of rows) console.log(`\n${v.length}x  ${k}\n   ${[...new Set(v)].slice(0, 6).join("\n   ")}${v.length > 6 ? `\n   …` : ""}`);
  const bad = [...rows.values()].flat().filter((x) => /LOWCONTRAST|CUT/.test(x));
  console.log("\nPROBLEMS:", bad.length); bad.slice(0, 40).forEach((x) => console.log("  ", x));
  console.log("errors", errs.slice(0, 3));
  await b.close();
})();
