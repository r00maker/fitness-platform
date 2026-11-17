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
  // Type text into a node, one character at a time, with a blinking caret; resolves when done.
  const type = (node, text, speed = 28) => new Promise((done) => {
    if (reduce) { node.textContent = text; return done(); }
    node.textContent = "";
    const caret = el("i", { class: "caret", "aria-hidden": "true" });
    const t = document.createTextNode("");
    node.append(t, caret);
    let i = 0;
    const step = () => { t.data = text.slice(0, ++i); if (i < text.length) setTimeout(step, speed + Math.random() * speed); else { caret.replaceWith(); done(); } };
    step();
  });
  window.S = { reduce, $, $$, el, tick, replay, seg, type };

  // A page opened from a link starts at the top (some viewers carry the last page's scroll position
  // over). Links to a section (#walkthrough) and reloads keep theirs, and it stops as soon as the
  // visitor scrolls themselves.
  try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch {}
  const how = performance.getEntriesByType?.("navigation")?.[0]?.type;
  if (!location.hash && how !== "reload" && how !== "back_forward") {
    let moved = false;
    ["wheel", "touchstart", "keydown", "pointerdown"].forEach((t) => addEventListener(t, () => (moved = true), { once: true, passive: true }));
    const toTop = () => { if (!moved && scrollY > 0) scrollTo({ top: 0, behavior: "instant" }); };
    toTop(); addEventListener("load", toTop); [120, 400, 900].forEach((ms) => setTimeout(toTop, ms));
  }

  // Parts that need the whole page: run once it has been read.
  const whenReady = (fn) => (document.readyState === "loading" ? addEventListener("DOMContentLoaded", fn) : fn());
  whenReady(() => {
    // Headline sweeps: page-opening headlines on load, the rest once as they come into view.
    if (!reduce) {
      const heads = $$("main h1, main h2, .close h2").filter((h) => !h.closest(".win, .faq"));
      heads.forEach((h) => h.classList.add("sweep"));
      const go = (h) => h.classList.add("go");
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { go(e.target); io.unobserve(e.target); } }), { rootMargin: "0px 0px -12% 0px" });
        heads.forEach((h) => io.observe(h));
      } else heads.forEach(go);
    }

    // Product videos: load as they come near, play while on screen (and, in the day story, only
    // the window in front). With reduced motion they wait for the play button.
    const vids = $$(".vid video");
    const onScreen = new Map();
    const load = (v) => { if (v.dataset.ready) return; v.dataset.ready = "1"; v.querySelectorAll("source[data-src]").forEach((x) => (x.src = x.dataset.src)); v.load(); };
    const inFront = (v) => !v.closest(".day-card.below, .day-card.past");
    const sync = (v) => {
      if (reduce && !v.dataset.chosen) return;
      if (onScreen.get(v) && inFront(v)) { load(v); v.play().catch(() => {}); } else v.pause();
    };
    vids.forEach((v) => {
      v.muted = true; v.playsInline = true; v.loop = true;
      if (reduce) {
        const b = el("button", { type: "button", class: "vid-play", html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>Play' });
        b.setAttribute("aria-label", `Play the video: ${v.getAttribute("aria-label") || "the product in use"}`);
        b.addEventListener("click", () => { v.dataset.chosen = "1"; v.controls = true; b.hidden = true; load(v); v.play().catch(() => {}); });
        v.parentElement.append(b);
      }
    });
    if ("IntersectionObserver" in window) {
      const near = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting && !reduce) { load(e.target); near.unobserve(e.target); } }), { rootMargin: "400px 0px" });
      const on = new IntersectionObserver((es) => es.forEach((e) => { onScreen.set(e.target, e.isIntersecting); sync(e.target); }), { threshold: 0.35 });
      vids.forEach((v) => { near.observe(v); on.observe(v); });
    }
    // The day story calls this when the window in front changes; that window starts from the top.
    window.S.syncVideos = (restart) => { if (restart) restart.currentTime = 0; vids.forEach(sync); };
    document.addEventListener("visibilitychange", () => vids.forEach((v) => (document.hidden ? v.pause() : sync(v))));

    // The dock shows once the page's opening has scrolled away, and hides where the page asks for
    // the walkthrough itself (the form, the closing band) and at the very bottom.
    const dock = $("#dock");
    if (dock) {
      const seen = new Set();
      const update = () => {
        const show = scrollY > innerHeight * 0.7 && !seen.size && innerHeight + scrollY < document.documentElement.scrollHeight - 40;
        dock.classList.toggle("show", show);
        dock.setAttribute("aria-hidden", String(!show));
        dock.querySelector("a").tabIndex = show ? 0 : -1;
      };
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver((es) => { es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))); update(); });
        $$("#walkthrough, .close").forEach((t) => io.observe(t));
      }
      addEventListener("scroll", update, { passive: true });
      update();
    }
  });

  const btn = $(".menu-btn"), nav = $("#nav");
  if (btn && nav) {
    const set = (open) => { nav.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open)); btn.textContent = open ? "Close" : "Menu"; };
    btn.addEventListener("click", () => set(!nav.classList.contains("open")));
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && nav.classList.contains("open")) { set(false); btn.focus(); } });
  }
})();
