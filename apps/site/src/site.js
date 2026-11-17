// Shared by every page: small DOM helpers (window.S) and the phone menu.
(() => {
  "use strict";
  document.documentElement.classList.add("js");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, attrs = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v; else if (k === "style") e.style.cssText = v; else e.setAttribute(k, v);
    }
    kids.forEach((c) => c && e.append(c));
    return e;
  };
  const tick = (size = 16, w = 2.5) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>`;
  const replay = (node, cls) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
  // Segmented controls: one is chosen at a time (role="tab" uses aria-selected, role="radio" aria-checked).
  const seg = (buttons, onPick) => buttons.forEach((b) => b.addEventListener("click", () => {
    buttons.forEach((x) => x.setAttribute(x.getAttribute("role") === "radio" ? "aria-checked" : "aria-selected", String(x === b)));
    onPick(b);
  }));
  window.S = { reduce, $, $$, el, tick, replay, seg };

  const btn = $(".menu-btn"), nav = $("#nav");
  if (btn && nav) {
    const set = (open) => { nav.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); btn.textContent = open ? "Close" : "Menu"; };
    btn.addEventListener("click", () => set(!nav.classList.contains("open")));
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("open")) { set(false); btn.focus(); } });
  }
})();
