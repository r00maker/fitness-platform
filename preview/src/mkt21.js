  // ===========================================================================
  // Setup by studio type (same presets and rules as setup.ts in the API): a first-run
  // "What kind of studio are you?" on Home, the studio type on Setup, Features, and
  // Studio rules with search and "Changed from the usual" marks.
  // ===========================================================================
  const STUDIO_TYPES = {
    independent: { label: "Independent studio", desc: "One room and a small team, or just you. Keeps it simple: booking, packages, reviews and gift cards. Walk-ins welcome.", features: ["giftCards", "reviews"],
      rules: { bookingClosesMinutesBefore: 0, clientsNeedPackage: false, lateCancelWindowHours: 6, spotBookingEnabled: false, waitlistModes: "automatic", substituteApproval: "manual", celebrationsEnabled: false } },
    boutique: { label: "Boutique studio", desc: "One or two locations with a team of instructors, and classes that fill up. Adds marketing, the shop, payroll and the WhatsApp inbox.", features: ["marketing", "giftCards", "referrals", "reviews", "shop", "payroll", "inbox"],
      rules: { bookingClosesMinutesBefore: 60, clientsNeedPackage: true, lateCancelWindowHours: 12, spotBookingEnabled: true, waitlistModes: "both", substituteApproval: "manual", celebrationsEnabled: true } },
    multi: { label: "Several locations", desc: "A growing brand with managers and a front desk at each location. Everything is switched on, including leads, loyalty and agents.", features: FEATURE_LIST.map((f) => f.key),
      rules: { bookingClosesMinutesBefore: 60, clientsNeedPackage: true, lateCancelWindowHours: 12, spotBookingEnabled: true, waitlistModes: "both", substituteApproval: "manual", celebrationsEnabled: true } },
  };
  // Each preset setting: label, where the preview keeps it, and its control on Studio rules.
  const PRESET_RULES = [
    { key: "bookingClosesMinutesBefore", label: "Booking closes", prop: "bookingClosesMins", ctl: "pClose" },
    { key: "clientsNeedPackage", label: "Clients need a package to book", prop: "needPackage", ctl: "pNeedPkg" },
    { key: "lateCancelWindowHours", label: "Late-cancellation window", prop: "lateCancelHours", ctl: "pLate" },
    { key: "spotBookingEnabled", label: "Clients choose a spot", prop: "spotsOn", ctl: "pSpots" },
    { key: "waitlistModes", label: "How waitlists work", prop: "wlModes", ctl: "pWlModes" },
    { key: "substituteApproval", label: "Approving cover", prop: "coverApproval", ctl: "pCover" },
    { key: "celebrationsEnabled", label: "Celebration pop-ups for staff", prop: "celebOn", ctl: "pCelebOn" },
  ];
  function presetText(key, v) {
    const hrs = (h) => `${h} ${h === 1 ? "hour" : "hours"}`;
    if (key === "bookingClosesMinutesBefore") return v === 0 ? "When class starts" : v % 60 === 0 ? `${hrs(v / 60)} before` : `${v} minutes before`;
    if (key === "lateCancelWindowHours") return `${hrs(v)} before class`;
    if (key === "clientsNeedPackage") return v ? "Yes" : "No, they can pay at the studio";
    if (key === "waitlistModes") return { both: "Clients choose", automatic: "Always book in automatically", manual: "Always ask first" }[v];
    if (key === "substituteApproval") return v === "automatic" ? "First to accept gets it" : "An admin chooses";
    return v ? "On" : "Off";
  }
  // The sample studio is two locations with everything on, already set up.
  STUDIO.studioType = "multi";
  STUDIO.setupDone = true;
  if (STUDIO.celebOn === undefined) STUDIO.celebOn = true;

  const andWords = (xs) => (xs.length <= 1 ? xs[0] || "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const aOrAn = (w) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
  /** What choosing a type would change, compared with the studio as it is now. */
  function typeChanges(t) {
    const p = STUDIO_TYPES[t];
    const features = FEATURE_LIST.map((f) => ({ key: f.key, label: f.label, on: p.features.includes(f.key) })).filter((f) => featOn(f.key) !== f.on);
    const rules = PRESET_RULES.map((r) => ({ ...r, from: STUDIO[r.prop], to: p.rules[r.key] })).filter((r) => r.from !== r.to);
    return { features, rules };
  }
  const changedFromUsual = () => (STUDIO.studioType ? PRESET_RULES.filter((r) => STUDIO[r.prop] !== STUDIO_TYPES[STUDIO.studioType].rules[r.key]) : []);

  /** Choose a type: a new studio just gets it; otherwise ask first with exactly what changes. */
  function chooseStudioType(t) {
    const p = STUDIO_TYPES[t];
    const { features, rules } = typeChanges(t);
    const effects = features.filter((f) => !f.on).flatMap((f) => featWhatHappens(f.key));
    const apply = () => {
      for (const f of features) { if (!f.on) featStopRunning(f.key); setFeat(f.key, f.on); }
      for (const r of rules) STUDIO[r.prop] = r.to;
      STUDIO.studioType = t;
      STUDIO.setupDone = true;
      render();
      toast(`Set up as ${aOrAn(p.label.toLowerCase())}. ${features.length ? plural(features.length, "feature") + " changed" : "Features unchanged"}, ${rules.length ? plural(rules.length, "rule") + " filled in" : "rules unchanged"}. You can change anything under Setup.`);
    };
    const running = STUDIO.setupDone || SESSIONS.length > 0 || effects.length > 0;
    if (!(features.length || rules.length) || !running) { apply(); return; }
    const on = features.filter((f) => f.on).map((f) => f.label), off = features.filter((f) => !f.on).map((f) => f.label);
    const parts = [
      on.length ? `Switches on ${andWords(on)}.` : "",
      off.length ? `Switches off ${andWords(off)} (nothing is deleted).` : "",
      rules.length ? `Changes ${rules.map((r) => `${r.label.toLowerCase()} from ${presetText(r.key, r.from).toLowerCase()} to ${presetText(r.key, r.to).toLowerCase()}`).join("; ")}.` : "",
      ...effects,
    ].filter(Boolean);
    confirmFlags([{ level: "confirm", title: "Use these settings?", msg: `Set up as ${aOrAn(p.label.toLowerCase())}? ${parts.join(" ")}` }], { proceed: apply, proceedLabel: "Use these settings" });
  }

  /** The three kinds of studio as cards to choose from. */
  function typeCards(selected) {
    return `<div class="stypes" role="radiogroup" aria-label="Kind of studio">${Object.entries(STUDIO_TYPES).map(([k, p]) => {
      const ch = typeChanges(k), n = ch.features.length + ch.rules.length;
      return `<button type="button" class="stype" role="radio" aria-checked="${selected === k}" data-stype="${k}">
        <b>${esc(p.label)}${STUDIO.setupDone && STUDIO.studioType === k ? ' <span class="tag">Current</span>' : ""}</b>
        <span>${esc(p.desc)}</span>
        <span class="muted stchg">${STUDIO.setupDone && STUDIO.studioType === k ? (n ? `${plural(n, "setting")} changed since` : "Matches your settings") : n ? `Would change ${plural(n, "setting")}` : "Matches your settings"}</span>
      </button>`;
    }).join("")}</div>`;
  }
  function typeDetail(k) {
    const p = STUDIO_TYPES[k], ch = typeChanges(k);
    const on = FEATURE_LIST.filter((f) => p.features.includes(f.key)).map((f) => f.label);
    return `<div class="stdetail" id="stDetail">
      <div><b>Switched on</b><p>${esc(andWords(on))}.</p></div>
      <div><b>Rules filled in</b><ul>${PRESET_RULES.map((r) => `<li>${esc(r.label)}: <b>${esc(presetText(r.key, p.rules[r.key]))}</b></li>`).join("")}</ul></div>
      <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><span class="muted">${ch.features.length + ch.rules.length ? `${[ch.features.length ? plural(ch.features.length, "feature") : "", ch.rules.length ? plural(ch.rules.length, "rule") : ""].filter(Boolean).join(" and ")} would change. You're asked first, and nothing is deleted.` : "Your studio already matches this."}</span>
      <button type="button" class="btn primary" id="stUse" ${ch.features.length + ch.rules.length || !STUDIO.setupDone || STUDIO.studioType !== k ? "" : "disabled"}>Use these settings</button></div>
    </div>`;
  }
  function bindTypeCards() {
    document.querySelectorAll("[data-stype]").forEach((b) => (b.onclick = () => { state.stPick = b.dataset.stype; render(); }));
    $("#stUse")?.addEventListener("click", () => chooseStudioType(state.stPick));
  }

  // --- Setup, Features: "Your kind of studio" at the top ----------------------------
  const pageFeatures = PAGES.features, bindFeatures = BIND.features;
  PAGES.features = function () {
    const html = pageFeatures();
    const pick = state.stPick || STUDIO.studioType || "boutique";
    const card = `<div class="card"><h3>Your kind of studio</h3><p class="muted" style="margin:0 0 10px;font-size:13px">A starting point: it switches on what that kind of studio usually needs and fills in sensible rules. You can change anything afterwards.</p>${typeCards(pick)}${typeDetail(pick)}</div>`;
    return html.replace('<p class="featsum">', `${card}<p class="featsum">`);
  };
  BIND.features = function () { bindFeatures(); bindTypeCards(); };

  // --- Home: the first-run welcome for owners and admins -------------------------------
  function setupChecklist() {
    return [
      ["Choose your kind of studio", STUDIO.setupDone],
      ["Add your location and rooms", Object.keys(LOCS).length > 0],
      ["Add the classes you teach", Object.keys(TYPES).length > 0],
      ["Add the packages and memberships you sell", PLANS.length > 0],
      ["Invite your instructors and front desk", Object.keys(STAFF).length > 0],
      ["Put your first classes on the schedule", SESSIONS.length > 0],
    ];
  }
  const pageHome = PAGES.home, bindHome = BIND.home;
  PAGES.home = function () {
    const html = pageHome();
    if (state.role !== "admin" || STUDIO.setupDone) return html;
    const pick = state.stPick || "boutique";
    const list = setupChecklist();
    const welcome = `<section class="card welcome" aria-labelledby="wlTitle"><h3 id="wlTitle">Welcome! What kind of studio do you run?</h3>
      <p class="muted">We'll switch on what you need and fill in sensible rules, so you start with a short menu. You can change anything later under Setup.</p>
      ${typeCards(pick)}${typeDetail(pick)}
      <details class="wlcheck"><summary>Getting started: ${list.filter(([, d]) => d).length} of ${list.length} done</summary><ul>${list.map(([l, d]) => `<li class="${d ? "done" : ""}">${d ? "✓" : "○"} ${esc(l)}</li>`).join("")}</ul></details>
    </section>`;
    // Straight after the greeting.
    return html.replace(/^(<div class="pagehead">[\s\S]*?<div class="actions">[\s\S]*?<\/div><\/div>)/, (m) => m + welcome);
  };
  BIND.home = function () { bindHome?.(); bindTypeCards(); };

  // --- Studio rules: search, and settings changed from the usual ------------------------
  const pagePolicies = PAGES.policies, bindPolicies = BIND.policies;
  PAGES.policies = function () {
    const html = pagePolicies();
    const t = STUDIO.studioType && STUDIO_TYPES[STUDIO.studioType];
    const n = changedFromUsual().length;
    const bar = `<div class="rulesearch"><input type="search" id="rlSearch" placeholder="Search studio rules, e.g. waitlist or fee" aria-label="Search studio rules" value="${esc(state.rlq || "")}">
      ${t ? `<span class="muted">Usual for ${esc(t.label.toLowerCase())}${n ? ` · <b>${plural(n, "setting")} changed</b>` : " · nothing changed"}</span>` : ""}</div>
      <p class="muted" id="rlNone" hidden>No settings match. Try another word, like “cancel”, “spot” or “pay”.</p>`;
    return html.replace('<form id="polForm"', `${bar}<form id="polForm"`);
  };
  BIND.policies = function () {
    bindPolicies?.();
    const t = STUDIO.studioType && STUDIO_TYPES[STUDIO.studioType];
    // "Changed" marks, with a one-tap way back to the usual.
    if (t) for (const r of changedFromUsual()) {
      const row = document.querySelector(`.rule[data-key="${r.key}"]`);
      if (!row) continue;
      const usual = t.rules[r.key];
      row.querySelector(".rl b").insertAdjacentHTML("beforeend", ` <span class="chg">Changed</span>`);
      row.querySelector(".rl").insertAdjacentHTML("beforeend", `<button type="button" class="linkbtn" data-usual="${r.key}">Use the usual: ${esc(presetText(r.key, usual))}</button>`);
    }
    document.querySelectorAll("[data-usual]").forEach((b) => (b.onclick = () => {
      const r = PRESET_RULES.find((x) => x.key === b.dataset.usual), v = t.rules[r.key];
      STUDIO[r.prop] = v;
      const ctl = $(`#${r.ctl}`);
      if (ctl) { if (ctl.type === "checkbox") ctl.checked = v; else ctl.value = String(v); }
      b.closest(".rule").querySelector(".chg")?.remove();
      b.remove();
      toast(`${r.label}: back to the usual (${presetText(r.key, v).toLowerCase()}).`);
    }));
    // Search: hide rules (and whole sections) that don't match.
    const search = $("#rlSearch");
    const filter = () => {
      const q = (state.rlq = search.value.trim().toLowerCase());
      let shown = 0;
      document.querySelectorAll("#polForm .card").forEach((card) => {
        let any = false;
        card.querySelectorAll(".rule").forEach((row) => {
          const hit = !q || row.textContent.toLowerCase().includes(q) || card.querySelector("h3").textContent.toLowerCase().includes(q) || (row.dataset.help || "").toLowerCase().includes(q);
          row.style.display = hit ? "" : "none";
          if (hit) any = true;
        });
        card.style.display = any ? "" : "none";
        if (any) shown++;
      });
      $("#rlNone").hidden = shown > 0;
    };
    if (search) { search.oninput = filter; filter(); }
  };
