  // ===========================================================================
  // Booking on the web (the same rules as apps/api/src/modules/booking-page):
  //  - Setup, Booking page: the studio's link (<app>/s/<slug>), on/off, a line at the top, the
  //    widget colour, the code to paste into the studio's website (with options) and a live
  //    preview of the widget.
  //  - The public booking page, as visitors see it (opened from Setup, or #book): the timetable by
  //    day with spots left, filters, a class with the packages that cover it, and the packages on
  //    sale. Book and Buy ask the visitor to sign in (a stand-in), then hand over to the client
  //    app: the class opens with the usual booking rules, or the package goes to checkout.
  // ===========================================================================
  {
    const BP = (STUDIO.bp ||= { slug: "demo-studio", saved: true, enabled: true, intro: "Small-group reformer, yoga and barre in Tanjong Pagar and Holland Village. First time? Try the 5-class pack.", accent: "" });
    const V = (state.bpv ||= { tab: "classes", day: 0, loc: "", type: "", open: null, buy: null, signin: null, days: 7, wLoc: "", wTheme: "light" });
    const APP = "https://book.studioapp.sg";
    const API = "https://api.studioapp.sg";
    const RESERVED = ["admin", "api", "app", "book", "booking", "help", "hq", "join", "login", "logout", "new", "pay", "payments", "s", "settings", "setup", "signin", "signup", "static", "studio", "studios", "support", "widget", "www"];
    const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
    const accent = () => BP.accent || "#0c6156";
    const live = () => BP.saved && BP.enabled && STUDIO.lifecycle !== "onboarding";
    /** "Ana L.": instructors' first name and initial on public pages. */
    const pubName = (k) => { const [f, ...r] = instrName(k).split(" "); return r.length ? `${f} ${r[r.length - 1][0]}.` : f; };
    const OPEN_DAYS = 14;
    function availability(s) {
      const left = s.cap - s.roster.length;
      const opens = addDays(day(s.start), -OPEN_DAYS);
      if (NOW < opens) return { k: "soon", label: `Booking opens ${fmtDay(opens)}`, btn: "Soon" };
      if (left <= 0) return s.waitlist !== undefined ? { k: "waitlist", label: "Full: join the waitlist", btn: "Join waitlist" } : { k: "full", label: "Full", btn: "Full" };
      return { k: left <= 3 ? "few" : "open", label: `${plural(left, "spot")} left`, btn: "Book" };
    }
    /** What a visitor sees: classes (not appointments), from now on, cancelled ones hidden. */
    function publicDay(i, loc = V.loc, type = V.type) {
      const d = addDays(day(NOW), i);
      return SESSIONS.filter((s) => s.status === "scheduled" && !isAppt(s) && s.start > NOW && sameDay(s.start, d) && (!loc || s.loc === loc) && (!type || s.type === type)).sort((a, b) => a.start - b.start);
    }
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const dayLabel = (i) => (i === 0 ? "Today" : fmtDay(addDays(day(NOW), i)));
    const covering = (s) => PLANS.filter((p) => p.onSale && !p.archived && (!p.types.length || p.types.includes(s.type))).sort((a, b) => a.price - b.price).slice(0, 4);

    // --- Setup, Booking page ------------------------------------------------------------------
    NAV.push({ id: "booking-page", group: "Setup", roles: ["admin"], label: "Booking page", help: "Your public booking page and the timetable widget for your own website." });
    NAV_ORDER.find(([g]) => g === "Setup")[1].push("booking-page");
    { const t = HUBS.find((h) => h.id === "setup")?.tabs; if (t) t.splice(t.findIndex((x) => x[0] === "payments") + 1, 0, ["booking-page", "Booking page"]); }
    ICONS["booking-page"] = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>';

    function widgetHTML(opts = {}) {
      const days = Math.min(opts.days || 7, 7), loc = opts.loc || "", sel = Math.min(opts.sel ?? firstDayWithClasses(loc), days - 1);
      const list = publicDay(sel, loc, "");
      return `<div class="bpw ${opts.theme === "dark" ? "dark" : ""}" style="--bpa:${accent()}">
        <div class="bpw-h"><b>Demo Studio</b><a href="#" data-bpopen>All classes and packages</a></div>
        <div class="bpw-days" role="group" aria-label="Choose a day">${Array.from({ length: days }, (_, i) => `<button type="button" data-bpwday="${i}" aria-pressed="${i === sel}">${dayLabel(i)}</button>`).join("")}</div>
        ${list.length ? `<ul>${list.slice(0, 6).map((s) => { const a = availability(s); return `<li><div class="t">${clock(s.start)}<span>${Math.round((s.end - s.start) / 60000)} min</span></div><div class="n"><b><i style="background:${TYPES[s.type].color}"></i>${esc(TYPES[s.type].name)}</b><span>${esc(pubName(s.instr))} · ${esc(LOCS[s.loc])}</span></div><div class="r"><div class="s ${a.k === "few" ? "few" : a.k === "full" || a.k === "waitlist" ? "full" : ""}">${esc(a.label)}</div><a class="book ${["open", "few", "waitlist"].includes(a.k) ? "" : "off"}" href="#" data-bpclass="${s.id}">${a.btn}</a></div></li>`; }).join("")}</ul>` : `<div class="e">No classes this day.</div>`}
        <div class="f">Times are in the studio's time zone</div></div>`;
    }
    const firstDayWithClasses = (loc) => { for (let i = 0; i < 7; i++) if (publicDay(i, loc, "").length) return i; return 0; };
    const code = () => `<div data-studio-schedule="${BP.slug}"${V.wLoc ? ` data-location="${V.wLoc === "tp" ? "3f1c…" : "8a27…"}"` : ""}${V.wTheme !== "light" ? ` data-theme="${V.wTheme}"` : ""}></div>\n<scr` + `ipt src="${API}/v1/public/widget.js" async></scr` + `ipt>`; // split so the page's own script tag isn't closed early

    PAGES["booking-page"] = function () {
      const st = live() ? ["Live", "done"] : !BP.enabled ? ["Off", "off"] : STUDIO.lifecycle === "onboarding" ? ["Opens with the studio", "wait"] : ["Not saved", "open"];
      return head("Booking page", "Your public booking page, and the timetable for your own website. Visitors see classes and packages without signing in; they sign in to book.", `<button type="button" class="btn primary" id="bpOpen">Open booking page</button>`) +
        `<div class="stack bpsetup" style="gap:16px;max-width:900px">
        <div class="card stack" style="gap:12px"><div class="row" style="justify-content:space-between"><h3>Your link</h3><span class="status ${st[1]}">${st[0]}</span></div>
          <label class="fl bpslug" for="bpSlug">Link<span class="bplink"><span class="muted">${esc(APP.replace("https://", ""))}/s/</span><input id="bpSlug" value="${esc(BP.slug)}" autocomplete="off" spellcheck="false" aria-describedby="bpErr"></span></label>
          <span class="hint" id="bpErr" role="alert"></span>
          <div class="payrow" style="border:0;padding:0"><div><b>Booking page on</b><span>Off hides the page and the widget (people with the link see "not found").</span></div>${toggle("bpOn", BP.enabled, "Booking page on")}</div>
          <label class="fl" for="bpIntro"><span class="flhead">A line at the top<span class="count">${BP.intro.length}/300</span></span><textarea id="bpIntro" rows="3" maxlength="300">${esc(BP.intro)}</textarea></label>
          <label class="fl" for="bpAccent">Button colour<span class="inline2"><input id="bpAccent" type="color" value="${accent()}" aria-label="Button colour"><span class="muted" style="font-weight:400">${BP.accent ? esc(BP.accent) : "Your invoice colour"}</span></span></label>
          <div class="inline2 bpbtns"><button type="button" class="btn primary" id="bpSave">Save</button><button type="button" class="btn" id="bpCopyLink">Copy link</button></div>
        </div>
        <div class="card stack" style="gap:12px"><h3>On your website</h3>
          <span class="hint">Paste this where the timetable should appear. Most website builders (Wix, Squarespace, WordPress, Webflow) have an "Embed" or "Custom code" block. The Book buttons open your booking page.</span>
          <div class="bpcode"><pre id="bpCode">${esc(code())}</pre><button type="button" class="btn" id="bpCopy">Copy code</button></div>
          <div class="bpopts"><label class="fl">Location<select id="bpWLoc"><option value="">All locations</option>${Object.entries(LOCS).map(([k, v]) => `<option value="${k}" ${V.wLoc === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
            <label class="fl">Look<select id="bpWTheme">${[["light", "Light"], ["dark", "Dark"], ["auto", "Follow the visitor's device"]].map(([k, l]) => `<option value="${k}" ${V.wTheme === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
          <span class="lbl" style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">Preview</span>
          <div class="bpwhost">${widgetHTML({ loc: V.wLoc, theme: V.wTheme === "dark" ? "dark" : "light", sel: V.wSel })}</div>
          <span class="hint">No website? Put the link in your Instagram bio and Google Business profile instead.</span>
        </div></div>`;
    };
    BIND["booking-page"] = function () {
      $("#bpOpen").onclick = openVisitor;
      $("#bpSave").onclick = () => {
        const slug = $("#bpSlug").value.trim().toLowerCase();
        const err = !SLUG.test(slug) ? "Use 3 to 40 lowercase letters, numbers and dashes, starting and ending with a letter or number (like breathe-pilates)." : RESERVED.includes(slug) ? "That name is taken by the app itself. Try your studio's name." : slug === "breathe-pilates" ? "Another studio already uses that link. How about breathe-pilates-2?" : "";
        if (err) { $("#bpErr").textContent = err; $("#bpSlug").setAttribute("aria-invalid", "true"); $("#bpSlug").focus(); return; }
        Object.assign(BP, { slug, saved: true, enabled: $("#bpOn").checked, intro: $("#bpIntro").value.trim() });
        render(); toast(BP.enabled ? `Saved. Your booking page is ${APP.replace("https://", "")}/s/${slug}` : "Saved. Your booking page is off.");
      };
      $("#bpOn").onchange = (e) => { BP.enabled = e.target.checked; render(); toast(BP.enabled ? "Booking page on." : "Booking page off: the page and the widget are hidden."); };
      $("#bpIntro").oninput = (e) => { BP.intro = e.target.value; const c = e.target.closest(".fl")?.querySelector(".count"); if (c) c.textContent = `${e.target.value.length}/300`; };
      $("#bpAccent").onchange = (e) => { BP.accent = e.target.value; render(); };
      $("#bpCopy").onclick = () => { navigator.clipboard?.writeText(code()).catch(() => {}); toast("Code copied. Paste it into your website's embed block."); };
      $("#bpCopyLink").onclick = () => { navigator.clipboard?.writeText(`${APP}/s/${BP.slug}`).catch(() => {}); toast("Link copied."); };
      $("#bpWLoc").onchange = (e) => { V.wLoc = e.target.value; V.wSel = undefined; render(); };
      $("#bpWTheme").onchange = (e) => { V.wTheme = e.target.value; render(); };
      document.querySelectorAll(".bpwhost [data-bpwday]").forEach((b) => (b.onclick = () => { V.wSel = Number(b.dataset.bpwday); render(); }));
      document.querySelectorAll(".bpwhost [data-bpclass]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); if (a.classList.contains("off")) return; openVisitor(); V.open = Number(a.dataset.bpclass); renderVisitor(); }));
      document.querySelectorAll(".bpwhost [data-bpopen]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); openVisitor(); }));
    };

    // --- The public booking page ----------------------------------------------------------------
    function openVisitor() { state.visitor = true; V.open = null; V.signin = null; V.buy = null; renderVisitor(); }
    function closeVisitor() { state.visitor = false; renderVisitor(); }
    function classesHTML() {
      const list = publicDay(V.day);
      return `<div class="bp-days" role="group" aria-label="Choose a day">${Array.from({ length: V.days }, (_, i) => { const d = addDays(day(NOW), i); return `<button type="button" data-bpday="${i}" aria-pressed="${i === V.day}"><span>${i === 0 ? "Today" : d.toLocaleDateString("en-GB", { weekday: "short" })}</span><b>${d.getDate()}</b></button>`; }).join("")}</div>
        <div class="bp-filters"><select id="bpvLoc" aria-label="Location"><option value="">All locations</option>${Object.entries(LOCS).map(([k, v]) => `<option value="${k}" ${V.loc === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
          <select id="bpvType" aria-label="Class"><option value="">All classes</option>${Object.entries(TYPES).filter(([, t]) => t.kind === "class").map(([k, t]) => `<option value="${k}" ${V.type === k ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
        ${list.length ? `<ul class="bp-list">${list.map((s) => { const a = availability(s); return `<li><button type="button" class="bp-row" data-bpv="${s.id}"><span class="t">${clock(s.start)}<small>${Math.round((s.end - s.start) / 60000)} min</small></span><span class="n"><b><i style="background:${TYPES[s.type].color}"></i>${esc(TYPES[s.type].name)}</b><small>${esc(pubName(s.instr))} · ${esc(LOCS[s.loc])}</small></span><span class="s ${a.k}">${esc(a.label)}</span></button></li>`; }).join("")}</ul>` : `<p class="bp-empty">No classes ${V.day === 0 ? "left today" : "this day"}${V.loc || V.type ? " with these filters" : ""}.</p>`}`;
    }
    function packagesHTML() {
      const plans = PLANS.filter((p) => p.onSale && !p.archived).sort((a, b) => a.price - b.price);
      return `<div class="bp-packs">${plans.map((p) => `<div class="bp-pack"><b>${esc(p.name)}</b><span class="bp-price">${m$(p.price)}${p.billing === "recurring" ? ` <small>${esc(perText(p))}</small>` : ""}</span>${p.desc ? `<p>${esc(p.desc)}</p>` : ""}<ul>${termsOf(p).slice(0, 4).map((t) => `<li>${esc(t)}</li>`).join("")}</ul><button type="button" class="bp-btn" data-bpbuy="${p.id}">Buy</button></div>`).join("")}</div>`;
    }
    function classHTML(s) {
      const a = availability(s), t = TYPES[s.type], ok = ["open", "few", "waitlist"].includes(a.k);
      const plans = covering(s);
      return `<div class="bp-sheet" role="dialog" aria-modal="true" aria-labelledby="bpcT"><button type="button" class="bp-x" data-bpback aria-label="Back to the timetable">←</button>
        <span class="bp-chip" style="--c:${t.color}">${esc(LOCS[s.loc])}</span><h2 id="bpcT">${esc(t.name)}</h2>
        <p class="bp-when">${s.start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · ${clock(s.start)} to ${clock(s.end)}</p>
        <dl class="bp-dl"><dt>Instructor</dt><dd>${esc(pubName(s.instr))}</dd><dt>Where</dt><dd>${esc(ROOMS[s.room].name)}, ${esc(LOCS[s.loc])}</dd><dt>Spots</dt><dd class="s ${a.k}">${esc(a.label)}</dd></dl>
        <div class="bp-need"><b>To book</b><span>You'll need a package that covers this class. You can buy one when you book.</span>
          ${plans.map((p) => `<div class="bp-plan"><span><b>${esc(p.name)}</b><small>${esc(termsOf(p)[0] || "")}</small></span><span>${m$(p.price)}</span></div>`).join("")}</div>
        <p class="bp-small">Cancel up to 12 hours before to get the class back.</p>
        <button type="button" class="bp-btn big" data-bpbook="${s.id}" ${ok ? "" : "disabled"}>${ok ? (a.k === "waitlist" ? "Join the waitlist" : "Book this class") : esc(a.label)}</button></div>`;
    }
    function signinHTML() {
      const what = V.signin.kind === "class" ? `to book ${esc(TYPES[SESSIONS.find((x) => x.id === V.signin.id).type].name)}` : `to buy ${esc(PLANS.find((p) => p.id === V.signin.id).name)}`;
      return `<div class="bp-sheet" role="dialog" aria-modal="true" aria-labelledby="bpsT"><button type="button" class="bp-x" data-bpback aria-label="Back">←</button>
        <h2 id="bpsT">Sign in ${what}</h2><p class="bp-small">New here? Use your email and we'll set up your account with Demo Studio.</p>
        <label class="bp-fl" for="bpsEmail">Email<input id="bpsEmail" type="email" autocomplete="email" value="chloe.ng@example.com"></label>
        <button type="button" class="bp-btn big" id="bpsGo">Continue</button>
        <div class="bp-or"><span>or</span></div><div class="bp-social"><button type="button" class="bp-ghost" id="bpsG">Continue with Google</button><button type="button" class="bp-ghost" id="bpsA">Continue with Apple</button></div>
        <p class="bp-small">Preview: signing in here continues as the sample client, Chloe, in the client app.</p></div>`;
    }
    function renderVisitor() {
      let root = $("#bpRoot");
      if (!state.visitor) { if (root) root.remove(); document.body.classList.remove("bp-on"); return; }
      if (!root) { document.body.insertAdjacentHTML("beforeend", '<div id="bpRoot" class="bp" role="main" aria-label="Booking page"></div>'); root = $("#bpRoot"); }
      const s = V.open ? SESSIONS.find((x) => x.id === V.open) : null;
      const off = !live();
      root.style.setProperty("--bpa", accent());
      root.innerHTML = `<div class="wc-preview"><span>Preview: your public booking page at ${esc(APP.replace("https://", ""))}/s/${esc(BP.slug)}, as visitors see it.</span><button type="button" id="bpExit">Back to the studio view</button></div>
        ${off ? `<div class="bp-wrap"><div class="bp-off"><h1>Page not found</h1><p>${!BP.enabled ? "The booking page is switched off (Setup, Booking page)." : "The booking page opens when the studio does."}</p></div></div>` : `
        <header class="bp-top"><div class="bp-wrap"><span class="bp-logo">D</span><div><h1>Demo Studio</h1>${BP.intro ? `<p>${esc(BP.intro)}</p>` : ""}</div><button type="button" class="bp-ghost bp-in" id="bpSignin">Sign in</button></div></header>
        <div class="bp-wrap"><div class="bp-tabs" role="tablist"><button type="button" role="tab" aria-selected="${V.tab === "classes"}" data-bptab="classes">Classes</button><button type="button" role="tab" aria-selected="${V.tab === "packages"}" data-bptab="packages">Packages</button></div>
          ${V.tab === "classes" ? classesHTML() : packagesHTML()}
          <footer class="bp-foot"><span>${esc(Object.values(LOCS).join(" · "))}</span><span>Booking opens 14 days ahead · Cancel up to 12 hours before</span></footer></div>
        ${V.signin ? `<div class="bp-scrim" data-bpback></div>${signinHTML()}` : s ? `<div class="bp-scrim" data-bpback></div>${classHTML(s)}` : ""}`}`;
      document.body.classList.add("bp-on");
      bindVisitor();
    }
    /** After signing in: on to the client app, where the usual rules apply. */
    function handOver() {
      const sig = V.signin;
      state.visitor = false; renderVisitor();
      if (state.role !== "client") document.querySelector('#roles [data-role="client"]')?.click();
      if (sig.kind === "class") { go("schedule"); setTimeout(() => openDrawer(sig.id), 60); toast("Signed in. Check the details and book."); }
      else { state.buy = sig.id; state.ordered = null; go("checkout"); toast("Signed in. Choose how to pay."); }
    }
    function bindVisitor() {
      const r = $("#bpRoot");
      r.querySelector("#bpExit").onclick = closeVisitor;
      r.querySelectorAll("[data-bptab]").forEach((b) => (b.onclick = () => { V.tab = b.dataset.bptab; renderVisitor(); }));
      r.querySelectorAll("[data-bpday]").forEach((b) => (b.onclick = () => { V.day = Number(b.dataset.bpday); renderVisitor(); }));
      r.querySelectorAll("[data-bpv]").forEach((b) => (b.onclick = () => { V.open = Number(b.dataset.bpv); renderVisitor(); r.querySelector(".bp-sheet .bp-x")?.focus(); }));
      r.querySelectorAll("[data-bpback]").forEach((b) => (b.onclick = () => { if (V.signin) V.signin = null; else V.open = null; renderVisitor(); }));
      r.querySelectorAll("[data-bpbook]").forEach((b) => (b.onclick = () => { V.signin = { kind: "class", id: Number(b.dataset.bpbook) }; renderVisitor(); r.querySelector("#bpsEmail")?.focus(); }));
      r.querySelectorAll("[data-bpbuy]").forEach((b) => (b.onclick = () => { V.signin = { kind: "plan", id: b.dataset.bpbuy }; renderVisitor(); }));
      const loc = r.querySelector("#bpvLoc"), type = r.querySelector("#bpvType");
      if (loc) loc.onchange = () => { V.loc = loc.value; renderVisitor(); };
      if (type) type.onchange = () => { V.type = type.value; renderVisitor(); };
      if (r.querySelector("#bpSignin")) r.querySelector("#bpSignin").onclick = () => toast("In the app, this opens sign-in. For the preview, choose a class or package first.");
      ["#bpsGo", "#bpsG", "#bpsA"].forEach((id) => { const b = r.querySelector(id); if (b) b.onclick = handOver; });
    }
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.visitor && (V.open || V.signin)) { if (V.signin) V.signin = null; else V.open = null; renderVisitor(); } });
    if (location.hash === "#book") setTimeout(openVisitor, 0);
    window.addEventListener("hashchange", () => { if (location.hash === "#book") openVisitor(); });
  }
