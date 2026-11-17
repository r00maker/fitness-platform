  // ===========================================================================
  // Plans (same rules as plans.ts in the API): Essentials, Growth and Signature. Our staff set
  // the plan; studios see it on Setup, Features, and features outside it are locked with the
  // plan that includes them. Each plan starts a studio with the rules for its kind (setup.ts),
  // and Studio rules has search and "Changed from the usual" marks.
  // The "Plan" control in the header is for this preview only.
  // ===========================================================================
  const STUDIO_TYPES = {
    independent: { label: "Independent studio", rules: { bookingClosesMinutesBefore: 0, clientsNeedPackage: false, lateCancelWindowHours: 6, spotBookingEnabled: false, waitlistModes: "automatic", substituteApproval: "manual", celebrationsEnabled: false } },
    boutique: { label: "Boutique studio", rules: { bookingClosesMinutesBefore: 60, clientsNeedPackage: true, lateCancelWindowHours: 12, spotBookingEnabled: true, waitlistModes: "both", substituteApproval: "manual", celebrationsEnabled: true } },
    multi: { label: "Several locations", rules: { bookingClosesMinutesBefore: 60, clientsNeedPackage: true, lateCancelWindowHours: 12, spotBookingEnabled: true, waitlistModes: "both", substituteApproval: "manual", celebrationsEnabled: true } },
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

  const PLAN_INFO = {
    essentials: { label: "Essentials", tagline: "For one independent studio. Everything to run classes, take bookings, pay instructors and get paid.", price: 129, included: 1, max: 1, extra: null, app: "not_available", appAddOn: null, admins: 1, studioType: "independent",
      features: ["giftCards", "reviews", "payroll"] },
    growth: { label: "Growth", tagline: "For studios with a team, up to 3 locations. Adds marketing, WhatsApp and the shop.", price: 399, included: 3, max: 3, extra: null, app: "add_on", appAddOn: 129, admins: "per_location", studioType: "boutique",
      features: ["giftCards", "reviews", "payroll", "marketing", "loyalty", "referrals", "shop", "inbox"] },
    signature: { label: "Signature", tagline: "For brands with up to 5 locations. Your own app included, plus AI that does the work for you.", price: 799, included: 5, max: null, extra: 199, app: "included", appAddOn: null, admins: "unlimited", studioType: "multi",
      features: FEATURE_LIST.map((f) => f.key) },
  };
  const PLAN_KEYS = ["essentials", "growth", "signature"];
  // The sample studio: two locations on Signature, already set up.
  STUDIO.plan = "signature";
  STUDIO.brandedApp = false;
  STUDIO.studioType = "multi";
  STUDIO.setupDone = true;
  if (STUDIO.celebOn === undefined) STUDIO.celebOn = true;

  const inPlan = (k, plan = STUDIO.plan) => PLAN_INFO[plan].features.includes(k);
  const planWith = (k) => PLAN_KEYS.find((p) => inPlan(k, p));
  const plansWith = (k) => andWords(PLAN_KEYS.filter((p) => inPlan(k, p)).map((p) => PLAN_INFO[p].label));
  const andWords = (xs) => (xs.length <= 1 ? xs[0] || "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const planUsd = (n) => `SGD ${n}`; // plans are priced in Singapore dollars
  const locCount = () => Object.keys(LOCS).length;
  const adminCount = () => AG_PEOPLE.filter((x) => x.role === "owner" || x.role === "admin").length;
  const planSeats = (plan = STUDIO.plan) => { const a = PLAN_INFO[plan].admins; return a === "unlimited" ? null : a === "per_location" ? Math.max(1, locCount()) : a; };
  const planHasApp = () => PLAN_INFO[STUDIO.plan].app === "included" || (PLAN_INFO[STUDIO.plan].app === "add_on" && STUDIO.brandedApp);
  function planPrice() {
    const p = PLAN_INFO[STUDIO.plan], extra = p.extra ? Math.max(0, locCount() - p.included) : 0;
    const parts = [[`${p.label} (${plural(p.included, "location")} included)`, p.price]];
    if (extra) parts.push([`${plural(extra, "extra location")} at ${planUsd(p.extra)} each`, extra * p.extra]);
    if (p.app === "add_on" && STUDIO.brandedApp) parts.push(["Your own app", p.appAddOn]);
    return { parts, total: parts.reduce((a, [, n]) => a + n, 0) };
  }
  // A feature outside the plan is always off (the plan switch turns it off; nothing is deleted).
  // Banners (and so the Marketing page) come with plans that include marketing, whatever the switch says.
  const navAllowedBase = navAllowed;
  navAllowed = function (id, role) { return id === "marketing" && STUDIO.plan && !inPlan("marketing") ? false : navAllowedBase(id, role); }; // eslint-disable-line no-func-assign
  const featOnBase = featOn;
  featOn = function (k) { return inPlan(k) && featOnBase(k); }; // eslint-disable-line no-func-assign

  /** Change the plan (our staff in the real app; anyone in this preview). Same rules as setPlan in the API. */
  function changePlan(plan, brandedApp) {
    const from = STUDIO.plan, before = PLAN_INFO[from].features, after = PLAN_INFO[plan].features;
    // Not in the new plan: off. New in this plan: on. In both: the studio's own choice stays.
    const features = FEATURE_LIST.map((f) => ({ key: f.key, label: f.label, on: !after.includes(f.key) ? false : !before.includes(f.key) ? true : featOnBase(f.key) }))
      .filter((f) => featOn(f.key) !== f.on || featOnBase(f.key) !== f.on);
    const effects = features.filter((f) => !f.on).flatMap((f) => featWhatHappens(f.key));
    const info = PLAN_INFO[plan], seats = info.admins === "unlimited" ? null : info.admins === "per_location" ? Math.max(1, locCount()) : info.admins;
    const limits = [];
    if (info.max !== null && locCount() > info.max) limits.push(`It has ${plural(locCount(), "location")} and ${info.label} includes ${info.max}: they keep working, but no more can be added.`);
    if (seats !== null && adminCount() > seats) limits.push(`It has ${plural(adminCount(), "admin account")} and ${info.label} includes ${seats}: they keep their access, but no more can be added.`);
    const apply = () => {
      for (const f of features) { if (!f.on) featStopRunning(f.key); setFeat(f.key, f.on); }
      STUDIO.plan = plan;
      STUDIO.brandedApp = info.app === "add_on" ? !!brandedApp : false;
      STUDIO.studioType = info.studioType;
      render();
      syncPlanDemo();
      toast(`Now on ${info.label}${planHasApp() ? ", with its own app" : ""}: ${planUsd(planPrice().total)} a month.`);
    };
    const off = features.filter((f) => !f.on).map((f) => f.label), on = features.filter((f) => f.on).map((f) => f.label);
    if (!off.length && !limits.length) { apply(); return; }
    confirmFlags([{ level: "confirm", title: "Change this studio's plan?", msg: `Move the studio from ${PLAN_INFO[from].label} to ${info.label}? ${[on.length ? `Switches on ${andWords(on)}.` : "", off.length ? `Switches off ${andWords(off)} (nothing is deleted).` : "", ...effects, ...limits].filter(Boolean).join(" ")}` }], { proceed: apply, back: syncPlanDemo, proceedLabel: "Change plan" });
  }

  // --- The preview's plan control (our staff's switch in the real app) -------------------
  const PLAN_DEMO = [["essentials", "Essentials"], ["growth", "Growth"], ["growth+app", "Growth + app"], ["signature", "Signature"]];
  document.querySelector("#roles").insertAdjacentHTML("afterend", `<label class="plandemo" data-help="Preview only. In the real app, only our staff can change a studio's plan.">Plan <select id="planDemo" aria-label="Plan (preview only)">${PLAN_DEMO.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>`);
  function syncPlanDemo() { const el = $("#planDemo"); if (el) el.value = STUDIO.plan === "growth" && STUDIO.brandedApp ? "growth+app" : STUDIO.plan; }
  syncPlanDemo();
  $("#planDemo").onchange = (e) => { const v = e.target.value; const [plan, app] = v === "growth+app" ? ["growth", true] : [v, false]; if (plan === STUDIO.plan && app === STUDIO.brandedApp) return; changePlan(plan, app); };

  // --- Setup, Features: your plan, and locked features ----------------------------------
  function planCard() {
    const p = PLAN_INFO[STUDIO.plan], price = planPrice(), seats = planSeats();
    const locs = locCount(), admins = adminCount();
    const over = [p.max !== null && locs > p.max ? `You have ${plural(locs, "location")} and ${p.label} includes ${p.max}. They keep working, but no more can be added.` : "", seats !== null && admins > seats ? `You have ${plural(admins, "admin account")} and ${p.label} includes ${seats}. They keep their access, but no more can be added.` : ""].filter(Boolean);
    const facts = [
      ["Locations", p.max === null ? `${locs} of ${p.included} included${p.extra ? `, then ${planUsd(p.extra)} each` : ""}` : `${locs} of ${p.max}`],
      ["Admin accounts", seats === null ? `${admins}, no limit` : `${admins} of ${seats}${p.admins === "per_location" ? " (one per location)" : ""}`],
      ["Instructor and front desk accounts", "No limit"],
      ["Your own app", planHasApp() ? (p.app === "included" ? "Included" : `Added, ${planUsd(p.appAddOn)} a month`) : p.app === "add_on" ? `Available for ${planUsd(p.appAddOn)} a month` : "Comes with Growth and Signature"],
      ["AI workflows", inPlan("agents") ? "Included" : "Comes with Signature"],
    ];
    return `<div class="card plancard"><div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
        <div><span class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">Your plan</span><h3 style="margin:2px 0 4px">${esc(p.label)}</h3><p class="muted" style="margin:0;font-size:13.5px;max-width:60ch">${esc(p.tagline)}</p></div>
        <div class="planprice"><b>${planUsd(price.total)}</b><span class="muted">a month</span></div></div>
      ${price.parts.length > 1 ? `<ul class="planparts">${price.parts.map(([l, n]) => `<li><span>${esc(l)}</span><span>${planUsd(n)}</span></li>`).join("")}</ul>` : ""}
      <dl class="planfacts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      ${over.map((t) => `<p class="planover">${esc(t)}</p>`).join("")}
      <div class="planlist">${PLAN_KEYS.map((k) => `<div class="planopt ${k === STUDIO.plan ? "cur" : ""}"><b>${PLAN_INFO[k].label}${k === STUDIO.plan ? ' <span class="tag">Current</span>' : ""}</b><span class="planoptprice">${planUsd(PLAN_INFO[k].price)}/month</span><span class="muted">${esc(PLAN_INFO[k].tagline)}</span></div>`).join("")}</div>
      <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap"><span class="muted" style="font-size:13px">Every plan: we set you up and move your data for you, the same support, and no cut of your sales.</span>
      <button type="button" class="btn" id="planTalk">Talk to us about your plan</button></div>
    </div>`;
  }
  const pageFeatures = PAGES.features, bindFeatures = BIND.features;
  PAGES.features = function () {
    let html = pageFeatures();
    // Locked features: say which plan includes them; the switch can't be turned on.
    for (const f of FEATURE_LIST) {
      if (inPlan(f.key)) continue;
      html = html.replace(`id="ft-${f.key}"`, `id="ft-${f.key}" disabled`).replace(`<b>${esc(f.label)}</b>`, `<b>${esc(f.label)}</b> <span class="tag lock">In ${PLAN_INFO[planWith(f.key)].label}</span>`);
    }
    return html.replace('<p class="featsum">', `${planCard()}<p class="featsum">`);
  };
  BIND.features = function () {
    bindFeatures();
    $("#planTalk")?.addEventListener("click", () => toast("Thanks. We'll message you within one working day to talk about your plan, and set any change up for you."));
    document.querySelectorAll(".featrow").forEach((row) => { const sw = row.querySelector("input[disabled]"); if (sw) row.setAttribute("data-help", `Comes with ${plansWith(sw.id.slice(3))}. Talk to us to change your plan.`); });
  };

  // --- Home: a getting-started list until the basics are in --------------------------------
  function setupChecklist() {
    return [
      ["Your plan is set up", STUDIO.setupDone],
      ["Add your location and rooms", Object.keys(LOCS).length > 0],
      ["Add the classes you teach", Object.keys(TYPES).length > 0],
      ["Add the packages and memberships you sell", PLANS.length > 0],
      ["Invite your instructors and front desk", Object.keys(STAFF).length > 0],
      ["Put your first classes on the schedule", SESSIONS.length > 0],
    ];
  }
  const pageHome = PAGES.home;
  PAGES.home = function () {
    const html = pageHome();
    const list = setupChecklist(), done = list.filter(([, d]) => d).length;
    if (state.role !== "admin" || done === list.length || STUDIO.hideStarted) return html;
    const card = `<section class="card welcome" aria-labelledby="wlTitle"><div class="row" style="justify-content:space-between;gap:8px"><h3 id="wlTitle">Getting started: ${done} of ${list.length} done</h3><button type="button" class="btn ghost" id="wlHide">Hide</button></div>
      <p class="muted">We've set your studio up on ${esc(PLAN_INFO[STUDIO.plan].label)} with the usual rules for ${esc(STUDIO_TYPES[STUDIO.studioType].label.toLowerCase())}s. Here's what's left. Change anything under Setup.</p>
      <ul class="wlcheck">${list.map(([l, d]) => `<li class="${d ? "done" : ""}">${d ? "✓" : "○"} ${esc(l)}</li>`).join("")}</ul></section>`;
    return html.replace(/^(<div class="pagehead">[\s\S]*?<div class="actions">[\s\S]*?<\/div><\/div>)/, (m) => m + card);
  };
  const bindHome = BIND.home;
  BIND.home = function () { bindHome?.(); $("#wlHide")?.addEventListener("click", () => { STUDIO.hideStarted = true; render(); }); };

  // --- Studio rules: search, changed from the usual, and AI recaps on Signature ---------------
  const changedFromUsual = () => (STUDIO.studioType ? PRESET_RULES.filter((r) => STUDIO[r.prop] !== STUDIO_TYPES[STUDIO.studioType].rules[r.key]) : []);
  const pagePolicies = PAGES.policies, bindPolicies = BIND.policies;
  PAGES.policies = function () {
    let html = pagePolicies();
    const t = STUDIO.studioType && STUDIO_TYPES[STUDIO.studioType];
    const n = changedFromUsual().length;
    const bar = `<div class="rulesearch"><input type="search" id="rlSearch" placeholder="Search studio rules, e.g. waitlist or fee" aria-label="Search studio rules" value="${esc(state.rlq || "")}">
      ${t ? `<span class="muted">Usual for ${esc(t.label.toLowerCase())}${n ? ` · <b>${plural(n, "setting")} changed</b>` : " · nothing changed"}</span>` : ""}</div>
      <p class="muted" id="rlNone" hidden>No settings match. Try another word, like “cancel”, “spot” or “pay”.</p>`;
    if (!inPlan("agents")) html = html.replace('id="pAiRecaps"', 'id="pAiRecaps" disabled');
    return html.replace('<form id="polForm"', `${bar}<form id="polForm"`);
  };
  BIND.policies = function () {
    bindPolicies?.();
    if (!inPlan("agents")) {
      const row = document.querySelector('.rule[data-key="aiRecaps"]');
      row?.querySelector(".rl b")?.insertAdjacentHTML("beforeend", ' <span class="tag lock">In Signature</span>');
    }
    const t = STUDIO.studioType && STUDIO_TYPES[STUDIO.studioType];
    // "Changed" marks, with a one-tap way back to the usual.
    if (t) for (const r of changedFromUsual()) {
      const row = document.querySelector(`.rule[data-key="${r.key}"]`);
      if (!row) continue;
      row.querySelector(".rl b").insertAdjacentHTML("beforeend", ` <span class="chg">Changed</span>`);
      row.querySelector(".rl").insertAdjacentHTML("beforeend", `<button type="button" class="linkbtn" data-usual="${r.key}">Use the usual: ${esc(presetText(r.key, t.rules[r.key]))}</button>`);
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
