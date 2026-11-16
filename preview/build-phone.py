"""Build phone-preview.html: the studio preview running inside phone-sized frames.

Each frame is the real preview (studio-calendar-preview.html) at phone width, opened as one
role on one page, so the phone layouts can be seen on any screen. Run after inject.py:

    python3 build-phone.py
"""
import json

app = open("studio-calendar-preview.html").read()
# The preview's own code, reachable from the frame's boot script (same hook the checks use).
app = app.replace("  // MKT-JS-END", "  window.__t = (c) => eval(c);\n  // MKT-JS-END")
doc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><script>window.__quiet = true;</script></head><body>' + app + "</body></html>"
payload = json.dumps(doc).replace("</", "<\\/")

page = r"""<title>Studio on Phones</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap">
<style>
/* Layout: a row of phones on a soft table; on a phone, one at a time with tabs. */
:root { --bg: #eef1ee; --ink: #16201c; --muted: #56635d; --line: #d5ddd8; --accent: #0c6156; --accent-fg: #fff; --body: "Inter", system-ui, sans-serif; --display: "Space Grotesk", "Inter", system-ui, sans-serif; --shell: #101614; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0d1311; --ink: #e4ebe8; --muted: #97a59f; --line: #26312d; --accent: #4fc2ad; --accent-fg: #0b1512; --shell: #000; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #0d1311; --ink: #e4ebe8; --muted: #97a59f; --line: #26312d; --accent: #4fc2ad; --accent-fg: #0b1512; --shell: #000; color-scheme: dark }
* { box-sizing: border-box }
body { background: var(--bg); color: var(--ink); font: 15px/1.5 var(--body); margin: 0 }
.wrap { padding-block: 28px 48px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: flex; flex-direction: column; gap: 20px; align-items: center }
header { max-width: 900px; text-align: center; display: flex; flex-direction: column; gap: 6px }
h1 { font: 700 clamp(26px, 4vw, 36px)/1.15 var(--display); margin: 0; letter-spacing: -0.01em; text-wrap: balance }
header p { margin: 0; color: var(--muted) }
.tabs { display: none; gap: 6px; flex-wrap: wrap; justify-content: center }
.tabs button { font: 500 14px var(--body); border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 999px; padding: 8px 14px; cursor: pointer }
.tabs button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-fg) }
.row { display: flex; gap: 28px; flex-wrap: wrap; justify-content: center; align-items: flex-start }
figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 12px; max-width: 100% }
.phone { width: 390px; height: 844px; max-width: 100%; border-radius: 52px; background: var(--shell); padding: 12px; box-shadow: 0 30px 60px -30px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.04) inset; position: relative }
.phone::before { content: ""; position: absolute; top: 22px; left: 50%; width: 110px; height: 30px; margin-left: -55px; border-radius: 20px; background: var(--shell); z-index: 2 }
.screen { width: 100%; height: 100%; border-radius: 40px; overflow: hidden; background: #f4f6f4; position: relative; padding-top: 44px }
iframe { width: 366px; height: 776px; border: 0; display: block; transform-origin: 0 0 }
.loading { position: absolute; inset: 0; display: grid; place-items: center; color: #56635d; font-size: 14px; background: #f4f6f4 }
figcaption { text-align: center; max-width: 340px; display: flex; flex-direction: column; gap: 2px }
figcaption b { font: 600 16px var(--display) }
figcaption span { color: var(--muted); font-size: 13.5px }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .screen, :root:not([data-theme="light"]) .loading { background: #0f1513 } }
:root[data-theme="dark"] .screen, :root[data-theme="dark"] .loading { background: #0f1513 }
@media (max-width: 860px) {
  .tabs { display: flex }
  figure:not(.on) { display: none }
  .phone { width: min(390px, 100%); height: auto; aspect-ratio: 390 / 844; border-radius: 44px; padding: 10px }
}
</style>
<div class="wrap">
  <header><h1>The studio app on phones</h1><p>Each phone runs the real preview at phone width. Scroll inside a phone, tap anything, and book or check people in. Sample data; nothing is sent anywhere.</p></header>
  <div class="tabs" role="group" aria-label="Choose a phone"><button type="button" data-tab="0" aria-pressed="true">Client: book a class</button><button type="button" data-tab="1" aria-pressed="false">Instructor: My day</button><button type="button" data-tab="2" aria-pressed="false">Instructor: check-in</button></div>
  <div class="row">
    <figure class="on" data-fig="0"><div class="phone"><div class="screen"><div class="loading">Opening…</div><iframe title="Client booking a class on a phone" data-boot="client"></iframe></div></div><figcaption><b>Client: book a class</b><span>The next 14 days in a strip, that day's classes first, notices on one line, every filter behind one Filter button.</span></figcaption></figure>
    <figure data-fig="1"><div class="phone"><div class="screen"><div class="loading">Opening…</div><iframe title="Instructor's My day on a phone" data-boot="instructor"></iframe></div></div><figcaption><b>Instructor: My day</b><span>Up next comes first: when it starts, who's booked, missing waivers and first-timers, and Check in.</span></figcaption></figure>
    <figure data-fig="2"><div class="phone"><div class="screen"><div class="loading">Opening…</div><iframe title="Instructor's check-in mode on a phone" data-boot="checkin"></iframe></div></div><figcaption><b>Instructor: check-in mode</b><span>Big rows by first name, search, waiver prompt, tap again to undo. Here the class starts in 30 minutes, so check-in is open.</span></figcaption></figure>
  </div>
</div>
<script>
(() => {
  const DOC = __DOC__;
  const BOOT = {
    client: "click('client'); location.hash = 'schedule';",
    instructor: "click('instructor'); location.hash = 'home';",
    checkin: "click('instructor'); location.hash = 'home'; setTimeout(() => { window.__t(\"{ const s = SESSIONS.find((x) => x.instr === ME.instructor && sameDay(x.start, NOW) && x.start > NOW); const d = s.end - s.start; s.start = addMin(NOW, 30); s.end = new Date(s.start.getTime() + d); render(); }\"); setTimeout(() => document.querySelector('[data-checkin]')?.click(), 120); }, 200);",
  };
  // Hide the preview's own role and plan switches inside each phone: each phone is one person.
  const boot = (what) => `<style>#roles, .plandemo, #roleNote, .rolenote { display: none !important }</style><script>window.__quiet = true; window.addEventListener("load", () => { const click = (r) => document.querySelector('#roles [data-role="' + r + '"]')?.click(); setTimeout(() => { ${BOOT[what]} }, 60); });<\/script>`;
  const fit = () => document.querySelectorAll(".screen").forEach((sc) => { const f = sc.querySelector("iframe"); const k = sc.clientWidth / 366; sc.style.paddingTop = `${44 * Math.min(1, k)}px`; f.style.transform = k < 1 ? `scale(${k})` : ""; });
  document.querySelectorAll("iframe[data-boot]").forEach((f) => {
    f.addEventListener("load", () => f.previousElementSibling?.remove(), { once: true });
    const at = DOC.lastIndexOf("</body>"); // the app's own code mentions </body> in strings too
    f.srcdoc = DOC.slice(0, at) + boot(f.dataset.boot) + DOC.slice(at);
  });
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => {
    document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    document.querySelectorAll("[data-fig]").forEach((f) => f.classList.toggle("on", f.dataset.fig === b.dataset.tab));
    fit();
  }));
  addEventListener("resize", fit); fit();
})();
</script>
"""
open("phone-preview.html", "w").write(page.replace("__DOC__", payload))
print("ok", round(len(page) / 1024 + len(payload) / 1024), "KB")
