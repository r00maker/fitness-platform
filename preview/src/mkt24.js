  // ===========================================================================
  // The welcome page (modules/welcome in the API). On the owner's first sign-in, until the
  // studio is ready: one form to get to know the studio and move its data. Answers save as you
  // go; "Send to our team" fills the studio in from them; "Send updates" sends changes after
  // that. The dashboard opens when the data move is verified. The "Studio" control in the header
  // is for this preview only (our team sets this in HQ).
  // ===========================================================================
  {
    const UEN = /^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])$/;
    const PLATFORMS = ["Mindbody", "Momence", "Glofox", "PunchPass", "TeamUp", "Arketa", "Vibefam", "Rezerv", "Walla", "Mariana Tek", "bsport", "Spreadsheet", "Other"];
    const TIPS = {
      Mindbody: ["Reports → Mailing Lists: All clients, opt-in status All → Generate → export", "Reports → Clients → Membership → Detail view", "Client series/packages with remaining visits"],
      Momence: ["Customers list → Export (contact details, memberships and credits left)", "Packages/Subscriptions → export active ones if they're separate"],
      Glofox: ["Reports → Memberships → Members → Download (needs the Admin role)", "Client list export (Clients Export permission)"],
      Other: ["Client list with emails and phone numbers", "Active class packs with classes left and expiry dates", "Active memberships with price, renewal and next billing date", "Upcoming bookings (class, date and time)"],
    };
    const MOVE_STEPS = ["Form sent", "Data in", "Checked", "Moved", "Double-checked", "Studio opens"];
    const SECTIONS = [
      ["wcBiz", "Your business", ["tradingName", "legalName", "uen", "gstRegistered", "gstNumber", "address", "phone", "website", "instagram"]],
      ["wcLoc", "Locations and rooms", ["locations"]],
      ["wcTeach", "What you teach", ["classTypeList"]],
      ["wcSell", "What you sell", ["packages"]],
      ["wcTeam", "Your team", ["team"]],
      ["wcMove", "Moving your data", ["nothingToMove", "oldPlatform", "switchDate", "activeClients", "activeMemberships", "activePackages", "dateFormat", "access", "accessLogin", "consent"]],
      ["wcTalk", "Who we talk to", ["contactName", "contactPhone", "notes"]],
    ];
    const OWNER = "Olivia";
    const W = (STUDIO.welcome ||= {
      form: {
        tradingName: "Demo Studio", legalName: "", uen: "", gstRegistered: false, gstNumber: "", address: "", phone: "", website: "", instagram: "",
        locations: Object.entries(LOCS).map(([k, name]) => ({ name, address: "", rooms: Object.values(ROOMS).filter((r) => r.loc === k && !r.none).map((r) => r.name) })),
        classTypeList: Object.values(TYPES).filter((t) => t.kind === "class").map((t) => ({ name: t.name, minutes: t.usual })),
        packages: PLANS.filter((p) => p.onSale).slice(0, 4).map((p) => ({ name: p.name, type: p.billing === "recurring" ? "membership" : "pack", classes: p.credits, price: p.price / 100, validityValue: p.vVal, validityUnit: p.vUnit })),
        team: Object.values(STAFF).map((n) => ({ firstName: n.split(" ")[0], lastName: n.split(" ").slice(1).join(" "), email: `${n.split(" ")[0].toLowerCase()}@demostudio.sg`, role: "instructor" })),
        nothingToMove: false, oldPlatform: "", switchDate: "", activeClients: "", activeMemberships: "", activePackages: "", dateFormat: "unsure", access: "", accessLogin: "", consent: false, contactName: "Olivia Tan", contactPhone: "", notes: "",
      },
      passwordSaved: false, files: [], sentAt: null, updatedAt: null, sentSnapshot: null, step: 0, played: false, setUp: null, opened: false,
    });
    const f = W.form;
    const val = (k) => f[k];
    const snap = () => JSON.stringify(f);
    const changedSections = () => (!W.sentSnapshot ? [] : SECTIONS.filter(([, , keys]) => { const was = JSON.parse(W.sentSnapshot); return keys.some((k) => JSON.stringify(f[k] ?? null) !== JSON.stringify(was[k] ?? null)); }).map(([, name]) => name));
    function missing() {
      const u = String(f.uen || "").toUpperCase();
      return [
        !f.tradingName && ["wcBiz", "your studio's name"], !f.legalName && ["wcBiz", "the registered business name"],
        !u && ["wcBiz", "your UEN"], u && !UEN.test(u) && ["wcBiz", "a UEN in the right format (like 201912345K or 53412345D)"],
        f.gstRegistered && !f.gstNumber && ["wcBiz", "your GST registration number"], !f.address && ["wcBiz", "your registered address"],
        !f.locations.filter((l) => l.name.trim()).length && ["wcLoc", "at least one location"],
        !f.switchDate && ["wcMove", f.nothingToMove ? "when you'd like to open" : "when you'd like to switch"],
        !f.nothingToMove && !f.oldPlatform && ["wcMove", "which system you use now (or tick nothing to move)"],
        !f.nothingToMove && !f.access && ["wcMove", "how we get your data"],
        !f.nothingToMove && f.access === "password" && !f.accessLogin && ["wcMove", "the login to use"],
        !f.nothingToMove && f.access === "password" && !W.passwordSaved && ["wcMove", "the temporary password"],
        !f.nothingToMove && !f.consent && ["wcMove", "your OK for us to move your clients' details"],
      ].filter(Boolean);
    }
    const sectionDone = (id) => !missing().some(([s]) => s === id) && (id !== "wcTeach" || f.classTypeList.length) && (id !== "wcSell" || f.packages.length);
    // Shown until the studio opens, then once more to say it's open.
    const showWelcome = () => (STUDIO.lifecycle === "onboarding" || W.opened) && state.role === "admin";
    const nice = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "long" }); };

    // --- The stage: a week filling up with classes ----------------------------------------------
    // Blocks drop into a Mon–Sun grid and settle: the studio "moving in". Played once per visit;
    // when the move is done, the rest of the week fills in.
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const BLOCKS = [[0, 7, "reformer"], [0, 18, "barre"], [1, 7, "yoga"], [1, 12, "mat"], [1, 19, "hiit"], [2, 8, "reformer"], [2, 18, "yoga"], [3, 7, "hiit"], [3, 12, "barre"], [3, 19, "reformer"], [4, 7, "mat"], [4, 18, "barre"], [5, 9, "reformer"], [5, 12, "yoga"], [6, 10, "mat"]];
    const MORE = [[0, 12, "mat"], [2, 12, "hiit"], [4, 12, "yoga"], [5, 16, "barre"], [6, 14, "reformer"], [2, 15, "barre"], [6, 18, "hiit"]];
    function weekHTML(full) {
      const list = full ? [...BLOCKS, ...MORE] : BLOCKS;
      const top = (h) => ((h - 6) / 15) * 100;
      return `<div class="wc-week ${W.played ? "still" : ""} ${full ? "full" : ""}" aria-hidden="true">
        ${DAYS.map((d, i) => `<div class="wc-col"><span class="wc-dow">${d}</span><div class="wc-lane">${list.filter(([c]) => c === i).map(([, h, t], k) => `<span class="wc-blk ${MORE.some(([c, hh]) => c === i && hh === h) ? "late" : ""}" style="top:${top(h)}%;--c:${TYPES[t].color};--d:${(i * 90 + k * 140)}ms"><b>${esc(TYPES[t].name.split(" ")[0])}</b><i>${h > 12 ? h - 12 : h}${h >= 12 ? "pm" : "am"}</i></span>`).join("")}</div></div>`).join("")}
      </div>`;
    }
    function stageHTML() {
      const sent = !!W.sentAt, open = STUDIO.lifecycle !== "onboarding";
      const step = W.step;
      const head = open ? `Demo Studio is open.` : sent ? `Thanks, ${OWNER}. We're moving you in.` : `Let's move Demo Studio in.`;
      const sub = open ? "Everything's moved and double-checked. Your dashboard is ready." : sent
        ? (f.nothingToMove ? `We're setting your studio up from your answers. It opens on ${nice(f.switchDate)}.` : `We're getting your data out of ${esc(f.oldPlatform)}, checking every row, and moving it within a day. Your dashboard opens as soon as it's double-checked.`)
        : "Tell us about your studio and where your clients are now. We set everything up and move your data within a day. Your dashboard opens when it's done.";
      const path = sent || open
        ? `<ol class="wc-track" aria-label="Moving in">${MOVE_STEPS.map((t, i) => `<li class="${i < step || open ? "done" : i === step ? "now" : ""}"><span class="wc-dot" aria-hidden="true"></span>${t}</li>`).join("")}</ol>`
        : `<ol class="wc-path"><li><b>You tell us about your studio</b><span>About 10 minutes. Answers save as you go.</span></li><li><b>We move you in</b><span>Clients, packs, memberships and bookings, within a day.</span></li><li><b>Your studio opens</b><span>On your switch date, with your team invited.</span></li></ol>`;
      return `<section class="wc-stage"><div class="wc-stagein">
        <div class="wc-copy">
          <p class="wc-hello">${open ? "Welcome to your studio" : `Welcome, ${OWNER}`}</p>
          <h1 class="wc-h1">${head}</h1>
          <p class="wc-sub">${sub}</p>
          ${path}
          ${open ? `<button type="button" class="wc-cta" id="wcOpen">Open your dashboard</button>` : sent ? `<div class="wc-row"><button type="button" class="wc-ghost" data-wcgo="wcBiz">Review your answers</button>${W.step < 5 ? '<button type="button" class="wc-ghost wc-demo" id="wcFinish" title="Preview only">Preview: finish the move</button>' : ""}</div>` : `<button type="button" class="wc-cta" data-wcgo="wcBiz">Start with your studio</button>`}
          ${W.setUp ? `<p class="wc-setup">Set up from your answers: ${esc(W.setUp)}</p>` : ""}
        </div>
        ${weekHTML(open)}
      </div></section>`;
    }

    // --- The form -----------------------------------------------------------------------------
    const field = (id, label, input, hint = "") => `<label class="wc-f" for="${id}"><span class="wc-l">${label}</span>${hint ? `<span class="wc-h">${hint}</span>` : ""}${input}</label>`;
    const inp = (id, key, attrs = "") => `<input id="${id}" data-wk="${key}" value="${esc(val(key) ?? "")}" ${attrs}>`;
    const listRow = (kind, i, cells) => `<div class="wc-item" data-wlist="${kind}" data-i="${i}">${cells}<button type="button" class="wc-x" data-wdel="${kind}:${i}" aria-label="Remove">×</button></div>`;
    function formHTML() {
      const err = W.err ? `<p class="wc-err" role="alert">${esc(W.err)}</p>` : "";
      const tips = TIPS[f.oldPlatform] || TIPS.Other;
      return `<div class="wc-body">
        <nav class="wc-rail" aria-label="Sections">${SECTIONS.map(([id, name]) => `<a href="#" data-wcgo="${id}" class="${sectionDone(id) ? "ok" : ""}"><span class="wc-tick" aria-hidden="true"></span>${name}</a>`).join("")}</nav>
        <form class="wc-form" id="wcForm" novalidate>
          <section id="wcBiz" class="wc-sec"><h2>Your business</h2><p class="wc-lede">For your invoices, receipts and studio profile. You can change these later in Setup.</p>
            <div class="wc-grid">
              ${field("wcName", "Studio name", inp("wcName", "tradingName"), "What clients see.")}
              ${field("wcLegal", "Registered business name", inp("wcLegal", "legalName", 'placeholder="e.g. Demo Studio Pte. Ltd."'))}
              ${field("wcUen", "UEN", inp("wcUen", "uen", 'placeholder="e.g. 201912345K" autocapitalize="characters"'), "Your Unique Entity Number from ACRA.")}
              <div class="wc-f"><span class="wc-l">GST-registered?</span><div class="wc-seg" role="group" aria-label="GST-registered"><button type="button" data-wgst="1" aria-pressed="${!!f.gstRegistered}">Yes</button><button type="button" data-wgst="0" aria-pressed="${!f.gstRegistered}">No</button></div></div>
              ${f.gstRegistered ? field("wcGst", "GST registration number", inp("wcGst", "gstNumber", 'placeholder="e.g. M90123456X"'), "Shown on invoices and receipts.") : ""}
              ${field("wcAddr", "Registered address", inp("wcAddr", "address", 'placeholder="Street, unit, postal code"'))}
              ${field("wcPhone", "Studio phone", inp("wcPhone", "phone", 'type="tel"'))}
              ${field("wcWeb", "Website", inp("wcWeb", "website", 'placeholder="yourstudio.sg"'))}
              ${field("wcIg", "Instagram", inp("wcIg", "instagram", 'placeholder="@yourstudio"'))}
            </div></section>
          <section id="wcLoc" class="wc-sec"><h2>Locations and rooms</h2><p class="wc-lede">Rooms are optional; add them if classes run in different spaces.</p>
            ${f.locations.map((l, i) => listRow("locations", i, `<input aria-label="Location name" data-wl="locations:${i}:name" value="${esc(l.name)}" placeholder="Location name"><input aria-label="Address" data-wl="locations:${i}:address" value="${esc(l.address || "")}" placeholder="Address"><input aria-label="Rooms" data-wl="locations:${i}:rooms" value="${esc(l.rooms.join(", "))}" placeholder="Rooms, separated by commas" class="wide">`)).join("")}
            <button type="button" class="wc-add" data-wadd="locations">Add a location</button></section>
          <section id="wcTeach" class="wc-sec"><h2>What you teach</h2><p class="wc-lede">Name them the way your studio does, like “Reformer - Beginner”. Clients see these names.</p>
            ${f.classTypeList.map((c, i) => listRow("classTypeList", i, `<input aria-label="Class name" data-wl="classTypeList:${i}:name" value="${esc(c.name)}" placeholder="Class name" class="wide"><label class="wc-mini">Minutes<input type="number" min="5" data-wl="classTypeList:${i}:minutes" value="${esc(c.minutes ?? "")}" aria-label="Minutes"></label>`)).join("")}
            <button type="button" class="wc-add" data-wadd="classTypeList">Add a class</button></section>
          <section id="wcSell" class="wc-sec"><h2>What you sell</h2><p class="wc-lede">Packs and memberships. When we move your clients, their packs are matched to these by name.</p>
            ${f.packages.map((p, i) => listRow("packages", i, `<input aria-label="Package name" data-wl="packages:${i}:name" value="${esc(p.name)}" placeholder="Name" class="wide"><select aria-label="Type" data-wl="packages:${i}:type"><option value="pack" ${p.type === "pack" ? "selected" : ""}>Class pack</option><option value="membership" ${p.type === "membership" ? "selected" : ""}>Membership</option></select><label class="wc-mini">Classes<input type="number" min="1" data-wl="packages:${i}:classes" value="${esc(p.classes ?? "")}" placeholder="Unlimited" aria-label="Classes"></label><label class="wc-mini">${STUDIO.currency}<input type="number" min="0" step="1" data-wl="packages:${i}:price" value="${esc(p.price ?? "")}" aria-label="Price"></label>`)).join("")}
            <button type="button" class="wc-add" data-wadd="packages">Add a package</button></section>
          <section id="wcTeam" class="wc-sec"><h2>Your team</h2><p class="wc-lede">We add them now and invite them when your studio opens, so nobody signs in to an empty app.</p>
            ${f.team.map((m, i) => listRow("team", i, `<input aria-label="First name" data-wl="team:${i}:firstName" value="${esc(m.firstName)}" placeholder="First name"><input aria-label="Last name" data-wl="team:${i}:lastName" value="${esc(m.lastName)}" placeholder="Last name"><input aria-label="Email" type="email" data-wl="team:${i}:email" value="${esc(m.email)}" placeholder="Email" class="wide"><select aria-label="Role" data-wl="team:${i}:role"><option value="instructor" ${m.role === "instructor" ? "selected" : ""}>Instructor</option><option value="front_desk" ${m.role === "front_desk" ? "selected" : ""}>Front of House</option><option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin</option></select>`)).join("")}
            <button type="button" class="wc-add" data-wadd="team">Add someone</button></section>
          <section id="wcMove" class="wc-sec"><h2>Moving your data</h2>
            <label class="wc-check" for="wcNone"><input type="checkbox" id="wcNone" ${f.nothingToMove ? "checked" : ""}> <span>We're a new studio: there's nothing to move</span></label>
            <div class="wc-grid">
              ${f.nothingToMove ? "" : field("wcPlat", "Which system do you use now?", `<select id="wcPlat" data-wk="oldPlatform"><option value="">Choose…</option>${PLATFORMS.map((p) => `<option ${f.oldPlatform === p ? "selected" : ""}>${p}</option>`).join("")}</select>`)}
              ${field("wcDate", f.nothingToMove ? "When would you like to open?" : "When would you like to switch?", inp("wcDate", "switchDate", 'type="date"'))}
              ${f.nothingToMove ? "" : `${field("wcCl", "Active clients, roughly", inp("wcCl", "activeClients", 'type="number" min="0"'), "We check our count against yours.")}${field("wcMem", "Active memberships", inp("wcMem", "activeMemberships", 'type="number" min="0"'))}${field("wcPk", "Active class packs", inp("wcPk", "activePackages", 'type="number" min="0"'))}${field("wcDf", "In your old system, 03/04/2026 means…", `<select id="wcDf" data-wk="dateFormat"><option value="dmy" ${f.dateFormat === "dmy" ? "selected" : ""}>3 April (day first)</option><option value="mdy" ${f.dateFormat === "mdy" ? "selected" : ""}>4 March (month first)</option><option value="ymd" ${f.dateFormat === "ymd" ? "selected" : ""}>Dates look like 2026-04-03</option><option value="unsure" ${f.dateFormat === "unsure" ? "selected" : ""}>Not sure</option></select>`)}`}
            </div>
            ${f.nothingToMove ? "" : `<span class="wc-l">How should we get your data?</span><div class="wc-accs">
              ${[["staff_login", "Add our team as a staff user", `Easiest. Add moving@ as staff in ${esc(f.oldPlatform || "your old system")} with access to reports, and remove us when we're done.`], ["password", "Share a temporary password", "Kept encrypted, seen only by the person doing your move, deleted after the move (7 days at most)."], ["files", "Upload the exports myself", "Download the reports below and add them here. CSV and Excel both work."]].map(([v, t, d]) => `<label class="wc-acc ${f.access === v ? "on" : ""}"><input type="radio" name="wcAccess" value="${v}" ${f.access === v ? "checked" : ""}><span><b>${t}</b><span>${d}</span></span></label>`).join("")}</div>
              ${f.access === "password" ? `<div class="wc-grid">${field("wcLogin", "Login", inp("wcLogin", "accessLogin", 'autocomplete="off"'))}${field("wcPass", "Temporary password", `<input id="wcPass" type="password" autocomplete="new-password" placeholder="${W.passwordSaved ? "Saved. Type to replace it." : ""}">`)}</div>` : ""}
              <div class="wc-tips"><b>What we'll take from ${esc(f.oldPlatform || "your system")}</b><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
              <div class="wc-row"><label class="wc-add" for="wcFile">Add files</label><input type="file" id="wcFile" multiple accept=".csv,.tsv,.xlsx,.xls,.txt" hidden><span class="wc-h">${W.files.length ? W.files.map((x) => `${esc(x.name)} (${esc(x.kind)})`).join(", ") : "Optional unless you chose to upload them."}</span></div>
              <label class="wc-check" for="wcOk"><input type="checkbox" id="wcOk" ${f.consent ? "checked" : ""}> <span>I'm OK for your team to move my clients' details into my studio here. They're used only for my studio, and the old files are deleted 30 days after the move is checked.</span></label>`}
          </section>
          <section id="wcTalk" class="wc-sec"><h2>Who we talk to</h2>
            <div class="wc-grid">${field("wcCn", "Name", inp("wcCn", "contactName"))}${field("wcCp", "Phone or WhatsApp", inp("wcCp", "contactPhone", 'type="tel"'))}</div>
            ${field("wcNotes", "Anything we should know?", `<textarea id="wcNotes" data-wk="notes" rows="3" placeholder="e.g. 20 clients pay by bank transfer; we're closed 24–26 Dec">${esc(f.notes || "")}</textarea>`)}
          </section>
          ${err}
        </form>
      </div>`;
    }
    function barHTML() {
      const sent = !!W.sentAt, changes = changedSections();
      const status = !sent ? "Answers save as you go." : changes.length ? `Changed since you sent it: ${changes.join(", ")}.` : `Sent ${W.updatedAt ? `and updated ${W.updatedAt}` : W.sentAt}. We'll message you if we need anything.`;
      return `<div class="wc-bar"><span class="wc-status" id="wcStatus">${esc(status)}</span><div class="wc-row">
        <button type="button" class="wc-btn ghost" id="wcUpdate" ${sent && changes.length ? "" : "disabled"} title="${sent ? "" : "After you've sent the form"}">Send updates</button>
        <button type="button" class="wc-btn" id="wcSend" ${sent ? "disabled" : ""}>${sent ? "Sent to our team" : "Send to our team"}</button></div></div>`;
    }
    function renderWelcome() {
      let root = $("#wcRoot");
      if (!showWelcome()) { if (root) root.remove(); document.body.classList.remove("wc-on"); return; }
      if (!root) { document.body.insertAdjacentHTML("beforeend", '<div id="wcRoot" class="wc" role="main" aria-label="Welcome"></div>'); root = $("#wcRoot"); }
      const y = root.scrollTop;
      root.innerHTML = stageHTML() + (STUDIO.lifecycle === "onboarding" ? formHTML() + barHTML() : "");
      root.scrollTop = y;
      document.body.classList.add("wc-on");
      if (!W.played) setTimeout(() => (W.played = true), 2400);
      bindWelcome();
    }
    function refreshChrome() {
      // Update the rail ticks and the bar without redrawing the inputs (keeps focus while typing).
      document.querySelectorAll(".wc-rail a").forEach((a) => a.classList.toggle("ok", sectionDone(a.dataset.wcgo)));
      const bar = $(".wc-bar"); if (bar) { bar.outerHTML = barHTML(); bindBar(); }
    }
    function send(mode) {
      const m = missing();
      if (m.length) { W.err = `Before sending, add ${m.map(([, t]) => t).join(", ")}.`; renderWelcome(); const first = document.getElementById(m[0][0]); first?.scrollIntoView({ block: "start", behavior: "smooth" }); return; }
      W.err = null;
      const changes = changedSections();
      const now = fmtDay(NOW);
      W.sentSnapshot = snap();
      if (mode === "send") { W.sentAt = now; W.step = f.nothingToMove ? 1 : W.files.length || f.access === "files" ? 1 : 1; } else W.updatedAt = now;
      const n = (k) => f[k].filter((x) => (x.name || x.email || "").trim()).length;
      W.setUp = `${plural(n("locations"), "location")}, ${plural(f.locations.reduce((a, l) => a + l.rooms.length, 0), "room")}, ${plural(n("classTypeList"), "class", "classes")}, ${plural(n("packages"), "package")} and ${plural(n("team"), "team member")} (added now, invited when you open).`;
      STUDIO.biz = { legalName: f.legalName, uen: String(f.uen).toUpperCase(), gstNumber: f.gstRegistered ? f.gstNumber : "", address: f.address, phone: f.phone, website: f.website, instagram: f.instagram };
      renderWelcome();
      $("#wcRoot").scrollTo({ top: 0, behavior: "smooth" });
      toast(mode === "send" ? "Sent to our team. Your studio is set up from your answers." : `Updates sent: ${changes.join(", ")}.`);
    }
    function bindBar() {
      $("#wcSend")?.addEventListener("click", () => send("send"));
      $("#wcUpdate")?.addEventListener("click", () => send("update"));
    }
    function bindWelcome() {
      const root = $("#wcRoot");
      root.querySelectorAll("[data-wcgo]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); document.getElementById(b.dataset.wcgo)?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }));
      root.querySelectorAll("[data-wk]").forEach((el) => { const h = () => { const k = el.dataset.wk; f[k] = el.type === "number" ? (el.value === "" ? "" : Number(el.value)) : k === "uen" || k === "gstNumber" ? el.value.toUpperCase() : el.value; refreshChrome(); }; el.addEventListener("input", h); el.addEventListener("change", h); });
      $("#wcPlat")?.addEventListener("change", () => renderWelcome());
      root.querySelectorAll("[data-wl]").forEach((el) => { const h = () => { const [list, i, k] = el.dataset.wl.split(":"); const row = f[list][Number(i)]; row[k] = k === "rooms" ? el.value.split(",").map((x) => x.trim()).filter(Boolean) : el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value; refreshChrome(); }; el.addEventListener("input", h); el.addEventListener("change", h); });
      root.querySelectorAll("[data-wadd]").forEach((b) => (b.onclick = () => { const k = b.dataset.wadd; f[k].push(k === "locations" ? { name: "", address: "", rooms: [] } : k === "classTypeList" ? { name: "", minutes: 50 } : k === "packages" ? { name: "", type: "pack", classes: 10, price: null } : { firstName: "", lastName: "", email: "", role: "instructor" }); renderWelcome(); root.querySelector(`[data-wlist="${k}"]:last-of-type input`)?.focus(); }));
      root.querySelectorAll("[data-wdel]").forEach((b) => (b.onclick = () => { const [k, i] = b.dataset.wdel.split(":"); f[k].splice(Number(i), 1); renderWelcome(); }));
      root.querySelectorAll("[data-wgst]").forEach((b) => (b.onclick = () => { f.gstRegistered = b.dataset.wgst === "1"; renderWelcome(); }));
      $("#wcNone")?.addEventListener("change", (e) => { f.nothingToMove = e.target.checked; renderWelcome(); });
      $("#wcOk")?.addEventListener("change", (e) => { f.consent = e.target.checked; refreshChrome(); });
      root.querySelectorAll('input[name="wcAccess"]').forEach((r) => r.addEventListener("change", () => { f.access = r.value; renderWelcome(); }));
      $("#wcPass")?.addEventListener("input", (e) => { if (e.target.value) { W.passwordSaved = true; refreshChrome(); } });
      $("#wcFile")?.addEventListener("change", (e) => { for (const x of e.target.files) if (!W.files.some((y) => y.name === x.name)) W.files.push({ name: x.name, kind: /member|contract|subscri/i.test(x.name) ? "memberships" : /pack|pass|series|credit/i.test(x.name) ? "class packs" : /book/i.test(x.name) ? "bookings" : "clients" }); renderWelcome(); toast("Files added. We'll check them when you send the form."); });
      $("#wcFinish")?.addEventListener("click", () => { if (W.step < 4) { W.step++; renderWelcome(); toast(["", "Data in: we have your exports.", "Checked: every row accounted for.", "Moved: clients, packs, memberships and bookings are in.", ""][W.step] || ""); } else { W.step = 5; STUDIO.lifecycle = "live"; W.opened = true; renderWelcome(); toast("Double-checked. Your studio is open."); } });
      $("#wcOpen")?.addEventListener("click", () => { W.opened = false; $("#wcRoot")?.remove(); document.body.classList.remove("wc-on"); syncStudioDemo(); go("home"); });
      bindBar();
    }

    // Preview only: the studio's status, as our team sets it in HQ.
    document.querySelector(".plandemo")?.insertAdjacentHTML("afterend", `<label class="plandemo" data-help="Preview only. Setting up shows the owner's first sign-in: the welcome page. Our team opens the studio in HQ.">Studio <select id="studioDemo" aria-label="Studio status (preview only)"><option value="live">Open</option><option value="onboarding">Setting up</option></select></label>`);
    function syncStudioDemo() { const el = $("#studioDemo"); if (el) el.value = STUDIO.lifecycle === "onboarding" ? "onboarding" : "live"; }
    STUDIO.lifecycle ||= location.hash === "#welcome" ? "onboarding" : "live";
    $("#studioDemo").onchange = (e) => { STUDIO.lifecycle = e.target.value; W.opened = false; if (e.target.value === "onboarding") { W.played = false; if (state.role !== "admin") document.querySelector('#roles [data-role="admin"]')?.click(); } render(); };
    syncStudioDemo();

    // The dashboard: business details from the welcome form, under Setup.
    NAV.push({ id: "studio-details", group: "Setup", roles: ["admin"], label: "Studio details", help: "Your business details for invoices and receipts: registered name, UEN, GST, address and contact details." });
    NAV_ORDER.find(([g]) => g === "Setup")[1].push("studio-details");
    { const t = HUBS.find((h) => h.id === "setup")?.tabs; if (t) t.unshift(["studio-details", "Studio details"]); }
    ICONS["studio-details"] = '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>';
    PAGES["studio-details"] = function () {
      const b = (STUDIO.biz ||= { legalName: "Demo Studio Pte. Ltd.", uen: "201912345K", gstNumber: "", address: "10 Anson Road, #05-01, Singapore 079903", phone: "+65 6123 4567", website: "demostudio.sg", instagram: "@demostudio" });
      const row = (id, l, k, ph = "") => `<label class="fld" for="${id}">${l}<input id="${id}" data-biz="${k}" value="${esc(b[k] || "")}" placeholder="${esc(ph)}"></label>`;
      return head("Studio details", "Your business details, shown on invoices and receipts. First filled in from your welcome form.") +
        `<div class="card stack" style="gap:12px;max-width:720px"><div class="bizgrid">${row("bzLegal", "Registered business name", "legalName")}${row("bzUen", "UEN", "uen", "e.g. 201912345K")}${row("bzGst", "GST registration number", "gstNumber", "Leave empty if not GST-registered")}${row("bzAddr", "Registered address", "address")}${row("bzPhone", "Studio phone", "phone")}${row("bzWeb", "Website", "website")}${row("bzIg", "Instagram", "instagram")}</div>
          <div class="row" style="gap:8px"><button type="button" class="btn primary" id="bzSave">Save details</button><span class="hint" id="bzErr" role="alert"></span></div></div>`;
    };
    BIND["studio-details"] = function () {
      $("#bzSave").onclick = () => {
        const b = STUDIO.biz;
        document.querySelectorAll("[data-biz]").forEach((el) => (b[el.dataset.biz] = el.dataset.biz === "uen" || el.dataset.biz === "gstNumber" ? el.value.trim().toUpperCase() : el.value.trim()));
        if (b.uen && !UEN.test(b.uen)) { $("#bzErr").textContent = "That UEN isn't in the right format (like 201912345K or 53412345D)."; return; }
        $("#bzErr").textContent = ""; toast("Studio details saved.");
      };
    };

    const renderBeforeWelcome = render;
    render = function () { renderBeforeWelcome(); renderWelcome(); };
  }
