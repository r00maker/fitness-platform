// Full class names on the calendar: studios run versions of a class ("Reformer - Intermediate",
// "Sweat - Essentials"), so every name must show in full in the week, day, month and phone list
// views, without opening the class. Checks each name sits wholly inside its block, nothing is cut
// off, and the instructor line stays when there's room.
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");
const outDir = path.join(__dirname, "nm");
fs.mkdirSync(outDir, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "..", "studio-calendar-preview.html"), "utf8").replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END");
fs.writeFileSync(path.join(__dirname, "nm-test.html"), src);
const file = "file://" + path.join(__dirname, "nm-test.html");

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const ok = (name, cond) => results.push([cond ? "PASS" : "FAIL", name]);
  for (const [label, opts] of [
    ["desk", { viewport: { width: 1360, height: 900 }, colorScheme: "light" }],
    ["desk-dark", { viewport: { width: 1360, height: 900 }, colorScheme: "dark" }],
    ["laptop", { viewport: { width: 1024, height: 768 }, colorScheme: "light" }],
    ["phone", { ...devices["iPhone 13"], colorScheme: "light" }],
    ["small-phone", { ...devices["iPhone SE"], colorScheme: "light" }],
  ]) {
    const p = await browser.newPage(opts);
    await p.addInitScript(() => { window.__quiet = true; }); // no celebration or review pop-ups over the page
    const errors = [];
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(file);
    const phone = /phone/.test(label);
    const ev = (code) => p.evaluate((c) => window.__t(c), code);
    const role = async (r) => { await p.evaluate((x) => document.querySelector(`#roles [data-role="${x}"]`).click(), r); await p.waitForTimeout(150); };
    const view = async (v, date = "2026-11-11") => { await ev(`state.view = "${v}"; state.anchor = fromYmdHm("${date}", "00:00"); render()`); await p.waitForTimeout(200); };
    const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    const shot = (n) => p.screenshot({ path: path.join(outDir, `${label}-${n}.png`), fullPage: phone });
    // Every name element in the view: its full text, and whether any of it is cut off or outside its block.
    const names = () => p.evaluate(() => {
      const sel = "#canvas .ev .en, #canvas .ag-row .n, #canvas .mchip > span";
      return [...document.querySelectorAll(sel)].filter((n) => n.offsetParent).map((n) => {
        const box = n.closest("button, .mchip, .ag-row");
        const r = n.getBoundingClientRect(), b = box.getBoundingClientRect();
        const inside = r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.left >= b.left - 1 && r.right <= b.right + 1;
        const cut = n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1;
        const blockCut = box.scrollHeight > box.clientHeight + 1 && box.matches("button");
        return { text: n.textContent.trim(), ok: inside && !cut && !blockCut };
      });
    });
    const checkView = async (what, expectSome) => {
      const list = await names();
      const bad = list.filter((x) => !x.ok).map((x) => x.text);
      ok(`${label}: ${what} shows ${list.length} names in full${bad.length ? ` (cut: ${bad.slice(0, 3).join("; ")})` : ""}`, list.length > 0 && bad.length === 0);
      for (const n of expectSome) ok(`${label}: ${what} includes “${n}”`, list.some((x) => x.text.endsWith(n)));
    };

    await p.evaluate(() => (location.hash = "schedule")); await p.waitForTimeout(150);
    const VERSIONS = ["Reformer - Intermediate", "Sweat - Essentials", "Mat Pilates - Foundations"];
    await view("week");
    await checkView(phone ? "week list" : "week", VERSIONS);
    ok(`${label}: no h-scroll in week`, await noHScroll());
    if (!phone) {
      // With free time below, the instructor line stays: Mon 9 Nov 7am is followed by a gap.
      const mon = await p.locator('.dcol[data-date="2026-11-09"] .ev').first().textContent();
      ok(`${label}: instructor still shown when there's room (${mon.trim().slice(0, 50)})`, /Ana Lim/.test(mon));
    }
    await shot("week");
    await view("day");
    await checkView("day", VERSIONS);
    ok(`${label}: no h-scroll in day`, await noHScroll());
    await shot("day");
    if (!phone) { await view("month"); await checkView("month", VERSIONS); await shot("month"); }

    // A much longer name still shows in full everywhere.
    await ev(`TYPES.reformer.name = "Reformer - Intermediate (Jumpboard & Tower)"; render()`);
    await p.waitForTimeout(150);
    await view("week"); await checkView(phone ? "week list, long name" : "week, long name", ["Reformer - Intermediate (Jumpboard & Tower)"]);
    await view("day"); await checkView("day, long name", ["Reformer - Intermediate (Jumpboard & Tower)"]);
    ok(`${label}: no h-scroll with a long name`, await noHScroll());
    await shot("long-day");
    if (!phone) { await view("month"); await checkView("month, long name", ["Reformer - Intermediate (Jumpboard & Tower)"]); }
    await ev(`TYPES.reformer.name = "Reformer - Intermediate"; render()`);

    // Instructors checking clients in on their phones: their day view too.
    await role("instructor");
    await view("day");
    await checkView("instructor's day", ["Reformer - Intermediate"]);
    await view("week");
    await checkView(phone ? "instructor's week list" : "instructor's week", ["Reformer - Intermediate"]);
    await role("client");
    await view("week");
    await checkView(phone ? "client's week list" : "client's week", ["Reformer - Intermediate"]);
    await role("admin");

    // Resizing re-fits the blocks (desk only).
    if (!phone) {
      await p.setViewportSize({ width: 1100, height: 800 });
      await p.waitForTimeout(250);
      await view("week");
      await checkView("week after resizing", []);
    }
    ok(`${label}: no page errors (${errors.join(" | ")})`, errors.length === 0);
    await p.close();
  }
  await browser.close();
  for (const [r, n] of results) console.log(r, n);
  console.log(results.filter(([r]) => r === "FAIL").length, "failed of", results.length);
})();
