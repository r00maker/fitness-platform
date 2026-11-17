/**
 * The website widget (served at /v1/public/widget.js). Studios paste:
 *
 *   <div data-studio-schedule="breathe-pilates"></div>
 *   <script src="https://api.example.com/v1/public/widget.js" async></script>
 *
 * It shows the timetable (day tabs, then each class with time, instructor, location and spots
 * left) inside a shadow root, so the website's styles don't leak in or out. "Book" opens the
 * studio's booking page in a new tab, where clients sign in and book. No cookies, no tracking,
 * nothing stored. Options: data-location, data-days (1–14), data-theme (light, dark, auto).
 * All text from the API is set with textContent, never as HTML.
 */
export const WIDGET_JS = String.raw`(function () {
  "use strict";
  var script = document.currentScript;
  var api = (script && script.src ? new URL(script.src).origin : "") + "/v1/public/studios/";
  var CSS = ":host{all:initial;display:block;font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--fg);" +
    "--bg:#fff;--fg:#17201d;--muted:#5d6b66;--line:#e2e7e5;--soft:#f3f6f5;--accent:#0c6156;--on:#fff}" +
    ":host([data-dark]){--bg:#141a18;--fg:#e8eeec;--muted:#9fb0aa;--line:#2a3431;--soft:#1c2421;--on:#fff}" +
    ".w{background:var(--bg);border:1px solid var(--line);border-radius:14px;padding:16px;max-width:760px}" +
    ".h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:0 0 12px}.h b{font-size:17px}.h a{color:var(--accent);font-size:13px;text-decoration:none;font-weight:600}" +
    ".days{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;margin-bottom:8px;scrollbar-width:thin}" +
    ".days button{font:inherit;font-size:13px;font-weight:600;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:999px;padding:6px 12px;cursor:pointer;white-space:nowrap}" +
    ".days button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--on)}" +
    ".days button:focus-visible,.book:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    "ul{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line)}" +
    "li:first-child{border-top:0}.t{font-weight:700;font-variant-numeric:tabular-nums}.t span{display:block;font-weight:400;font-size:12px;color:var(--muted)}" +
    ".n{min-width:0}.n b{display:flex;align-items:center;gap:6px}.n b i{width:8px;height:8px;border-radius:50%;flex:none}.n span{display:block;font-size:13px;color:var(--muted)}" +
    ".s{font-size:12px;font-weight:600;color:var(--muted);text-align:right;margin-bottom:4px}.s.few{color:#b45309}.s.full{color:#b42318}" +
    ".book{display:inline-block;font-size:13px;font-weight:700;text-decoration:none;background:var(--accent);color:var(--on);padding:7px 14px;border-radius:9px;white-space:nowrap}" +
    ".book.off{background:var(--soft);color:var(--muted);pointer-events:none}.e{color:var(--muted);padding:12px 0;font-size:14px}" +
    ".f{margin-top:10px;font-size:11px;color:var(--muted);text-align:right}" +
    "@media (max-width:480px){li{grid-template-columns:52px 1fr}li .r{grid-column:2;display:flex;gap:10px;align-items:center}.s{margin:0}}";

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function mount(host) {
    var slug = (host.getAttribute("data-studio-schedule") || "").trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug) || host.__studioWidget) return;
    host.__studioWidget = true;
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var theme = host.getAttribute("data-theme") || "light";
    var dark = theme === "dark" || (theme === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) host.setAttribute("data-dark", "");
    var style = el("style"); style.textContent = CSS; root.appendChild(style);
    var box = el("div", "w"); box.setAttribute("role", "region"); box.setAttribute("aria-label", "Class timetable"); root.appendChild(box);
    box.appendChild(el("div", "e", "Loading the timetable…"));
    var days = Math.max(1, Math.min(14, parseInt(host.getAttribute("data-days") || "7", 10) || 7));
    var qs = "?days=" + days + (host.getAttribute("data-location") ? "&locationId=" + encodeURIComponent(host.getAttribute("data-location")) : "");
    fetch(api + slug + "/schedule" + qs, { credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (data) { render(box, data, host); })
      .catch(function () { box.textContent = ""; box.appendChild(el("div", "e", "The timetable couldn't load just now. Please try again later.")); });
  }

  function render(box, data, host) {
    if (data.studio && /^#[0-9a-fA-F]{6}$/.test(data.studio.accent || "")) host.style.setProperty("--accent", data.studio.accent);
    box.textContent = "";
    var h = el("div", "h"); h.appendChild(el("b", null, data.studio ? data.studio.name : "Timetable"));
    var all = el("a", null, "All classes and packages"); all.href = data.links.page; all.target = "_blank"; all.rel = "noopener"; h.appendChild(all); box.appendChild(h);
    var tabs = el("div", "days"); tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", "Choose a day"); box.appendChild(tabs);
    var list = el("div"); box.appendChild(list);
    var first = 0; for (var i = 0; i < data.days.length; i++) { if (data.days[i].classes.length) { first = i; break; } }
    data.days.forEach(function (d, i) {
      var b = el("button", null, d.label + (d.classes.length ? "" : "")); b.type = "button"; b.setAttribute("aria-pressed", String(i === first));
      b.addEventListener("click", function () { [].forEach.call(tabs.children, function (x) { x.setAttribute("aria-pressed", "false"); }); b.setAttribute("aria-pressed", "true"); show(list, d); });
      tabs.appendChild(b);
    });
    show(list, data.days[first]);
    var f = el("div", "f", "Times are in the studio's time zone"); box.appendChild(f);
  }

  function show(list, d) {
    list.textContent = "";
    if (d.closed) { list.appendChild(el("div", "e", d.closed.name + (d.closed.message ? ": " + d.closed.message : ""))); return; }
    if (!d.classes.length) { list.appendChild(el("div", "e", "No classes this day.")); return; }
    var ul = el("ul");
    d.classes.forEach(function (c) {
      var li = el("li");
      var t = el("div", "t", c.time); t.appendChild(el("span", null, c.durationMinutes + " min")); li.appendChild(t);
      var n = el("div", "n"); var b = el("b"); var dot = el("i"); dot.style.background = /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : "#999"; b.appendChild(dot); b.appendChild(document.createTextNode(c.name)); n.appendChild(b);
      n.appendChild(el("span", null, [c.instructor && c.instructor.name, c.location && c.location.name].filter(Boolean).join(" · "))); li.appendChild(n);
      var r = el("div", "r");
      var cls = c.availability === "few_left" ? "s few" : c.availability === "full" || c.availability === "waitlist" ? "s full" : "s";
      r.appendChild(el("div", cls, c.label));
      var open = c.availability === "open" || c.availability === "few_left" || c.availability === "waitlist";
      var a = el("a", "book" + (open ? "" : " off"), c.availability === "waitlist" ? "Join waitlist" : open ? "Book" : c.availability === "not_open_yet" ? "Soon" : c.availability === "closed" ? "Closed" : "Full");
      if (open) { a.href = c.bookUrl; a.target = "_blank"; a.rel = "noopener"; a.setAttribute("aria-label", (a.textContent) + ": " + c.name + " at " + c.time); } else { a.setAttribute("aria-disabled", "true"); }
      r.appendChild(a); li.appendChild(r); ul.appendChild(li);
    });
    list.appendChild(ul);
  }

  function start() { [].forEach.call(document.querySelectorAll("[data-studio-schedule]"), mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
`;
