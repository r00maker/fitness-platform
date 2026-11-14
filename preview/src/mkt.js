  // ===========================================================================
  // Marketing: client filters (segments), journeys, email builder, campaigns,
  // gift cards and referrals. Same rules and wording as the API.
  // ===========================================================================
  const m$c = (cents) => money(cents, STUDIO.currency);
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isNarrow = () => window.matchMedia("(max-width: 640px)").matches;
  TAGS.push({ id: "t5", name: "Intro offer lead", color: SWATCH[4], pinned: false });

  // --- Sample facts per client (what the API works out from bookings, packages and payments) ---
  const ACQ = ["direct", "meta_ads", "referral", "google_ads", "direct", "other_campaign", "meta_ads"];
  const GIFT_CREDIT = { 0: 5000, 4: 10000 };
  function factsOf(i) {
    const c = CLIENTS[i];
    const h = hash(c.name + "facts");
    const types = Object.keys(TYPES).filter((k, j) => c.attended && (h >> j) % 3 !== 0);
    return {
      classesAttended: c.attended,
      daysSinceLastClass: c.attended ? ({ 3: 45, 11: 38, 17: 64, 19: 33 }[i] ?? h % 21) : null,
      upcomingBookings: c.attended ? h % 4 : 0,
      noShows: h % 3 === 0 && c.attended ? 1 : 0,
      lateCancels: h % 5 === 0 && c.attended ? 2 : 0,
      classTypes: types,
      instructors: Object.entries(c.withInstr).filter(([, n]) => n > 0).map(([k]) => k),
      locations: c.attended ? (h % 4 === 0 ? ["tp", "hv"] : ["tp"]) : [],
      nettSpend: c.source === "classpass" ? 0 : c.attended * 2650 + (h % 30) * 500,
      hasActivePackage: c.pkgSample ? "yes" : "no",
      packageTypes: c.pkgSample ? [c.pkgSample[0]] : [],
      creditsLeft: c.pkgSample?.[1] ?? 0,
      daysUntilExpiry: c.pkgSample && c.pkgSample[0] !== "p3" ? 3 + (h % 40) : null,
      membership: c.pkgSample?.[0] === "p3" ? (i === 4 ? "stopping" : "active") : "none",
      studioCredit: GIFT_CREDIT[i] ?? 0,
      daysSinceJoined: i === 1 ? 2 : 20 + (h % 700),
      source: c.source === "classpass" ? "classpass" : "direct",
      acquisition: i === 1 ? "meta_ads" : ACQ[h % ACQ.length],
      tags: c.tags,
      notTags: c.tags,
      waiver: c.waiver || c.source === "classpass" && c.attended === 0 ? (c.waiver ? "done" : "missing") : c.waiver ? "done" : "missing",
      marketingEmail: hash(c.name + "mk") % 3 !== 0 ? "yes" : "no",
      referrals: i === 0 ? 2 : i === 10 ? 1 : 0,
      wasReferred: i === 1 || i === 16 ? "yes" : "no",
    };
  }

  // --- Segment fields (same list and wording as the API) ---
  const SEG = {
    classesAttended: { group: "Activity", kind: "number", label: "Classes attended", unit: "classes", within: true },
    daysSinceLastClass: { group: "Activity", kind: "number", label: "Days since their last class", unit: "days" },
    upcomingBookings: { group: "Activity", kind: "number", label: "Classes booked ahead", unit: "classes" },
    noShows: { group: "Activity", kind: "number", label: "No-shows", unit: "no-shows", within: true },
    lateCancels: { group: "Activity", kind: "number", label: "Late cancellations", unit: "times", within: true },
    classTypes: { group: "Activity", kind: "pick", label: "Has attended", pick: () => Object.entries(TYPES).map(([id, t]) => [id, t.name]) },
    instructors: { group: "Activity", kind: "pick", label: "Has attended a class with", pick: () => Object.entries(STAFF) },
    locations: { group: "Activity", kind: "pick", label: "Has attended at", pick: () => Object.entries(LOCS) },
    nettSpend: { group: "Spending", kind: "number", label: "Nett spend", unit: "money", within: true },
    studioCredit: { group: "Spending", kind: "number", label: "Studio credit", unit: "money" },
    hasActivePackage: { group: "Packages", kind: "choice", label: "Has a package they can use", options: ["yes", "no"] },
    packageTypes: { group: "Packages", kind: "pick", label: "Has bought", pick: () => PLANS.filter((p) => !p.archived).map((p) => [p.id, p.name]) },
    creditsLeft: { group: "Packages", kind: "number", label: "Classes left", unit: "classes" },
    daysUntilExpiry: { group: "Packages", kind: "number", label: "Days until their package expires", unit: "days" },
    membership: { group: "Packages", kind: "choice", label: "Membership", options: ["active", "stopping", "none"] },
    daysSinceJoined: { group: "Profile", kind: "number", label: "Days since they joined", unit: "days" },
    source: { group: "Profile", kind: "choice", label: "Books through", options: ["direct", "classpass"] },
    acquisition: { group: "Profile", kind: "choice", label: "Came from", options: ["meta_ads", "google_ads", "referral", "other_campaign", "direct"] },
    tags: { group: "Profile", kind: "pick", label: "Has tag", pick: () => TAGS.map((t) => [t.id, t.name]) },
    notTags: { group: "Profile", kind: "pick", label: "Doesn't have tag", pick: () => TAGS.map((t) => [t.id, t.name]) },
    waiver: { group: "Profile", kind: "choice", label: "Waiver", options: ["done", "missing"] },
    marketingEmail: { group: "Profile", kind: "choice", label: "Happy to get marketing emails", options: ["yes", "no"] },
    referrals: { group: "Profile", kind: "number", label: "Friends referred", unit: "friends" },
    wasReferred: { group: "Profile", kind: "choice", label: "Joined through a referral", options: ["yes", "no"] },
  };
  const OPT = { yes: "Yes", no: "No", active: "Renewing", stopping: "Stopping", none: "None", direct: "Studio member", classpass: "ClassPass", done: "Done", missing: "Missing", meta_ads: "Meta ads (Facebook, Instagram)", google_ads: "Google ads", referral: "A friend's referral", other_campaign: "Another tagged link" };
  // "Came from" uses its own labels for "direct" so it doesn't read as "Studio member".
  const optLabel = (field, v) => (field === "acquisition" && v === "direct" ? "Found us directly" : OPT[v] ?? v);
  const newRule = (field = "classesAttended") => { const f = SEG[field]; return f.kind === "number" ? { field, op: "at_least", value: f.unit === "money" ? 100 : 1 } : f.kind === "choice" ? { field, value: f.options[0] } : { field, ids: [] }; };

  function ruleMatches(r, f) {
    const d = SEG[r.field];
    if (d.kind === "number") {
      let v = f[r.field];
      if (v === null || v === undefined) return false;
      if (r.withinDays && d.within) v = Math.round(v * Math.min(1, r.withinDays / 365) + (r.withinDays >= 30 && v ? 1 : 0));
      const k = d.unit === "money" ? 100 : 1;
      return r.op === "at_least" ? v >= r.value * k : r.op === "at_most" ? v <= r.value * k : v >= r.value * k && v <= (r.value2 ?? r.value) * k;
    }
    if (d.kind === "choice") return f[r.field] === r.value;
    if (!r.ids.length) return true;
    if (r.field === "notTags") return !r.ids.some((id) => f.tags.includes(id));
    return r.ids.some((id) => f[r.field].includes(id));
  }
  const matchSet = (def) => CLIENTS.map((_, i) => i).filter((i) => { const f = factsOf(i); const rs = def.rules.filter((r) => r.field); return !rs.length || (def.match === "any" ? rs.some((r) => ruleMatches(r, f)) : rs.every((r) => ruleMatches(r, f))); });
  function describeRule(r) {
    const d = SEG[r.field];
    const within = r.withinDays && d.within ? ` in the last ${r.withinDays} days` : "";
    if (d.kind === "number") {
      const v = (n) => (d.unit === "money" ? m$c(n * 100) : n);
      return `${d.label}: ${r.op === "at_least" ? `at least ${v(r.value)}` : r.op === "at_most" ? `at most ${v(r.value)}` : `${v(r.value)} to ${v(r.value2 ?? r.value)}`}${within}`;
    }
    if (d.kind === "choice") return `${d.label}: ${optLabel(r.field, r.value)}`;
    const names = d.pick().filter(([id]) => r.ids.includes(id)).map(([, n]) => n);
    return `${d.label}: ${names.length ? (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(" or ")) : "choose…"}${within}`;
  }

  /** One editable rule: field, comparison and value(s). `key` identifies it for binding. */
  function ruleRow(r, key, removable = true) {
    const d = SEG[r.field];
    const groups = [...new Set(Object.values(SEG).map((x) => x.group))];
    const fieldSel = `<select data-rfield="${key}" aria-label="Filter by">${groups.map((g) => `<optgroup label="${g}">${Object.entries(SEG).filter(([, x]) => x.group === g).map(([id, x]) => `<option value="${id}" ${id === r.field ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</optgroup>`).join("")}</select>`;
    let op = "", vals = "";
    if (d.kind === "number") {
      op = `<select class="op" data-rop="${key}" aria-label="Comparison"><option value="at_least" ${r.op === "at_least" ? "selected" : ""}>at least</option><option value="at_most" ${r.op === "at_most" ? "selected" : ""}>at most</option><option value="between" ${r.op === "between" ? "selected" : ""}>between</option></select>`;
      const unit = d.unit === "money" ? STUDIO.currency : d.unit;
      vals = `<div class="vals">${d.unit === "money" ? `<span class="unit">${unit}</span>` : ""}<input type="number" min="0" step="1" value="${r.value}" data-rval="${key}" aria-label="Value">${r.op === "between" ? `<span class="unit">and</span><input type="number" min="0" value="${r.value2 ?? r.value}" data-rval2="${key}" aria-label="Up to">` : ""}${d.unit !== "money" ? `<span class="unit">${unit}</span>` : ""}
        ${d.within ? `<select data-rwithin="${key}" aria-label="Time period" style="width:auto"><option value="">ever</option>${[7, 30, 90, 180, 365].map((n) => `<option value="${n}" ${r.withinDays === n ? "selected" : ""}>in the last ${n} days</option>`).join("")}</select>` : ""}</div>`;
    } else if (d.kind === "choice") {
      op = `<span class="op unit" style="font-size:12.5px;color:var(--muted)">is</span>`;
      vals = `<div class="vals"><select data-rchoice="${key}" aria-label="Value">${d.options.map((o) => `<option value="${o}" ${o === r.value ? "selected" : ""}>${esc(optLabel(r.field, o))}</option>`).join("")}</select></div>`;
    } else {
      op = `<span class="op unit" style="font-size:12.5px;color:var(--muted)">any of</span>`;
      vals = `<div class="vals picks">${d.pick().map(([id, n]) => `<button type="button" class="pickchip" data-rpick="${key}:${id}" aria-pressed="${r.ids.includes(id)}">${esc(n)}</button>`).join("")}</div>`;
    }
    return `<div class="frule">${fieldSel}${op}${vals}${removable ? `<button type="button" class="iconbtn rmv" data-rdel="${key}" aria-label="Remove this filter">×</button>` : "<span></span>"}</div>`;
  }
  /** Wire up rule rows. `get(key)` returns the rule object; `set(key, rule)` replaces it; `del(key)` removes it. */
  function bindRules(get, set, del, redraw) {
    document.querySelectorAll("[data-rfield]").forEach((el) => (el.onchange = () => { set(el.dataset.rfield, newRule(el.value)); redraw(); }));
    document.querySelectorAll("[data-rop]").forEach((el) => (el.onchange = () => { const r = get(el.dataset.rop); r.op = el.value; if (r.op === "between") r.value2 = Math.max(r.value2 ?? r.value, r.value); redraw(); }));
    document.querySelectorAll("[data-rval]").forEach((el) => (el.onchange = () => { get(el.dataset.rval).value = Math.max(0, Number(el.value) || 0); redraw(); }));
    document.querySelectorAll("[data-rval2]").forEach((el) => (el.onchange = () => { get(el.dataset.rval2).value2 = Math.max(0, Number(el.value) || 0); redraw(); }));
    document.querySelectorAll("[data-rwithin]").forEach((el) => (el.onchange = () => { const r = get(el.dataset.rwithin); if (el.value) r.withinDays = Number(el.value); else delete r.withinDays; redraw(); }));
    document.querySelectorAll("[data-rchoice]").forEach((el) => (el.onchange = () => { get(el.dataset.rchoice).value = el.value; redraw(); }));
    document.querySelectorAll("[data-rpick]").forEach((b) => (b.onclick = () => { const [key, id] = b.dataset.rpick.split(":"); const r = get(key); r.ids = r.ids.includes(id) ? r.ids.filter((x) => x !== id) : [...r.ids, id]; redraw(); }));
    document.querySelectorAll("[data-rdel]").forEach((b) => (b.onclick = () => { del(b.dataset.rdel); redraw(); }));
  }

  // --- Saved segments ---
  const SEGMENTS = [
    { id: "sg1", name: "Regulars", desc: "Came to 20 or more classes.", def: { match: "all", rules: [{ field: "classesAttended", op: "at_least", value: 20 }] } },
    { id: "sg2", name: "Lapsed: 30+ days", desc: "Used to come, haven't for a month, nothing booked.", def: { match: "all", rules: [{ field: "daysSinceLastClass", op: "at_least", value: 30 }, { field: "upcomingBookings", op: "at_most", value: 0 }] } },
    { id: "sg3", name: "Big spenders", desc: "Spent SGD 1,000 or more.", def: { match: "all", rules: [{ field: "nettSpend", op: "at_least", value: 1000 }] } },
    { id: "sg4", name: "Package expiring soon", desc: "A package ends in the next 14 days.", def: { match: "all", rules: [{ field: "daysUntilExpiry", op: "at_most", value: 14 }] } },
  ];
  let nextSegId = 5;
  const PRESETS = [
    ["Haven't come in 30+ days", { field: "daysSinceLastClass", op: "at_least", value: 30 }],
    ["20+ classes", { field: "classesAttended", op: "at_least", value: 20 }],
    ["Spent over SGD 1,000", { field: "nettSpend", op: "at_least", value: 1000 }],
    ["Package expires within 14 days", { field: "daysUntilExpiry", op: "at_most", value: 14 }],
    ["No package", { field: "hasActivePackage", value: "no" }],
    ["Joined in the last 30 days", { field: "daysSinceJoined", op: "at_most", value: 30 }],
    ["Came from Meta ads", { field: "acquisition", value: "meta_ads" }],
  ];

  // --- Clients page with filters (replaces the simpler search-only list) ---
  state.cf = state.cf || { match: "all", rules: [] };
  const lastClassText = (d) => (d === null ? '<span class="muted">Never</span>' : d === 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`);
  PAGES.clients = function () {
    const q = (state.clientQ || "").toLowerCase();
    const cf = state.cf;
    const live = cf.rules.filter((r) => SEG[r.field].kind !== "pick" || r.ids.length);
    const matched = new Set(matchSet({ match: cf.match, rules: live }));
    const rows = CLIENTS.map((c, i) => ({ c, i, f: factsOf(i) })).filter(({ c, i }) => matched.has(i) && (!q || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q)));
    const sort = state.clientSort || "name";
    rows.sort((a, b) => (sort === "classes" ? b.f.classesAttended - a.f.classesAttended : sort === "spend" ? b.f.nettSpend - a.f.nettSpend : sort === "last" ? (a.f.daysSinceLastClass ?? 1e9) - (b.f.daysSinceLastClass ?? 1e9) : a.c.name.localeCompare(b.c.name)));
    const canEmail = rows.filter((r) => r.f.marketingEmail === "yes").length;
    const loaded = SEGMENTS.find((s) => s.id === state.cfSeg);
    const th = (k, label) => `<th${k !== "name" ? ' class="num"' : ""}><button type="button" class="thsort" data-csort="${k}" aria-pressed="${sort === k}">${label}${sort === k ? " ↓" : ""}</button></th>`;
    return head("Clients", `${plural(CLIENTS.length, "client")}. Filter to find a group, then save it as a segment to email them or start a journey.`, `<select id="cSeg" data-help="Load a saved segment's filters."><option value="">Saved segments…</option>${SEGMENTS.map((s) => `<option value="${s.id}" ${s.id === state.cfSeg ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select><button type="button" class="btn ${state.cfOpen ? "" : "primary"}" id="cfToggle" aria-expanded="${!!state.cfOpen}" data-help="Find clients by classes, spending, when they last came, packages, tags and more.">${state.cfOpen ? "Hide filters" : `Filters${live.length ? ` (${live.length})` : ""}`}</button>`) +
      `<div class="row"><input id="cQ" type="search" placeholder="Search by name, email or phone" value="${esc(state.clientQ || "")}" style="height:34px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--surface);flex:1 1 240px;min-width:0" data-help="Find a client by name, email or phone number."></div>
      ${state.cfOpen ? `<div class="card"><div class="rulebox">
          <div class="matchline">Show clients who match <select id="cfMatch" aria-label="Match"><option value="all" ${cf.match === "all" ? "selected" : ""}>all</option><option value="any" ${cf.match === "any" ? "selected" : ""}>any</option></select> of these:</div>
          ${cf.rules.map((r, i) => ruleRow(r, `cf${i}`)).join("") || '<span class="hint">No filters yet. Add one, or start from a common one below.</span>'}
          <div class="row"><button type="button" class="btn" id="cfAdd">+ Add filter</button>${cf.rules.length ? '<button type="button" class="btn ghost" id="cfClear">Clear all</button>' : ""}</div>
          <div class="fbar"><span class="hint">Quick filters:</span>${PRESETS.map(([l], i) => `<button type="button" class="preset" data-preset="${i}">${esc(l)}</button>`).join("")}</div>
        </div></div>` : live.length ? `<div class="fbar">${live.map((r) => `<span class="fchip">${esc(describeRule(r))}<button type="button" data-cfx="${cf.rules.indexOf(r)}" aria-label="Remove filter">×</button></span>`).join("")}${live.length > 1 ? `<span class="hint">(${cf.match === "all" ? "all must match" : "any can match"})</span>` : ""}</div>` : ""}
      ${live.length || q ? `<div class="resultline"><span><b class="big">${rows.length}</b> of ${CLIENTS.length} clients</span><span class="muted">${canEmail} can get marketing emails</span><span class="grow"></span>
          ${live.length ? `<button type="button" class="btn" id="cfSave" data-help="Keep these filters as a segment you can email, put on a banner or use in a journey. It stays up to date by itself.">${loaded ? "Update segment" : "Save as segment"}</button><button type="button" class="btn primary" id="cfEmail" data-help="Send an email to everyone in this list who has agreed to marketing emails.">Email them</button>` : ""}</div>` : ""}
      <div class="tblwrap"><table class="tbl"><thead><tr>${th("name", "Client")}${STUDIO.waiverOn ? "<th>Waiver</th>" : ""}<th>Health</th><th>Package</th>${th("classes", "Classes")}${th("last", "Last class")}${th("spend", "Nett spend")}<th>Tags</th></tr></thead><tbody>
      ${rows.map(({ c, i, f }) => `<tr class="click" data-client="${i}" tabindex="0">
        <td><div class="cellp">${avatar(c, "sm")}<b>${esc(c.name)}</b>${c.source === "classpass" ? '<span class="bdg">ClassPass</span>' : ""}</div></td>
        ${STUDIO.waiverOn ? `<td>${c.waiver ? '<span class="bdg ok">Done</span>' : '<span class="bdg bad">No waiver</span>'}</td>` : ""}
        <td>${activeHealth(c).map((h) => `<span class="bdg health" data-help="${esc(h.text)}">${esc(healthLabel(h))}</span>`).join(" ") || '<span class="muted">–</span>'}</td>
        <td>${esc(clientPkgLine(i))}</td><td class="num">${c.attended || '<span class="bdg ok">New</span>'}</td><td class="num" style="white-space:nowrap">${lastClassText(f.daysSinceLastClass)}</td><td class="num" style="white-space:nowrap">${f.nettSpend ? m$c(f.nettSpend) : '<span class="muted">–</span>'}</td>
        <td><span class="tags">${c.tags.map((id) => TAGS.find((t) => t.id === id)).filter(Boolean).map((t) => `<span class="ctag" style="--c:${t.color}">${esc(t.name)}</span>`).join("")}</span></td></tr>`).join("") || `<tr><td colspan="8" class="muted">No clients match. Try removing a filter.</td></tr>`}
      </tbody></table></div>`;
  };
  BIND.clients = function () {
    const q = $("#cQ");
    q.oninput = () => { state.clientQ = q.value; render(); const el = $("#cQ"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); };
    document.querySelectorAll("[data-client]").forEach((tr) => {
      tr.onclick = () => openClient(Number(tr.dataset.client));
      tr.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openClient(Number(tr.dataset.client)); } };
    });
    document.querySelectorAll("[data-csort]").forEach((b) => (b.onclick = () => { state.clientSort = b.dataset.csort; render(); }));
    $("#cfToggle").onclick = () => { state.cfOpen = !state.cfOpen; if (state.cfOpen && !state.cf.rules.length) state.cf.rules.push(newRule()); render(); };
    $("#cSeg").onchange = (e) => { const s = SEGMENTS.find((x) => x.id === e.target.value); state.cfSeg = s?.id || null; state.cf = s ? clone(s.def) : { match: "all", rules: [] }; render(); };
    const cf = state.cf;
    const idx = (k) => Number(k.slice(2));
    bindRules((k) => cf.rules[idx(k)], (k, r) => (cf.rules[idx(k)] = r), (k) => cf.rules.splice(idx(k), 1), render);
    if ($("#cfMatch")) $("#cfMatch").onchange = (e) => { cf.match = e.target.value; render(); };
    if ($("#cfAdd")) $("#cfAdd").onclick = () => { cf.rules.push(newRule()); render(); };
    if ($("#cfClear")) $("#cfClear").onclick = () => { cf.rules = []; state.cfSeg = null; render(); };
    document.querySelectorAll("[data-preset]").forEach((b) => (b.onclick = () => { cf.rules = cf.rules.filter((r) => SEG[r.field].kind !== "pick" || r.ids.length); cf.rules.push(clone(PRESETS[Number(b.dataset.preset)][1])); render(); }));
    document.querySelectorAll("[data-cfx]").forEach((b) => (b.onclick = () => { cf.rules.splice(Number(b.dataset.cfx), 1); render(); }));
    if ($("#cfSave")) $("#cfSave").onclick = () => openSaveSegment();
    if ($("#cfEmail")) $("#cfEmail").onclick = () => {
      const s = SEGMENTS.find((x) => x.id === state.cfSeg && JSON.stringify(x.def) === JSON.stringify(state.cf));
      if (s) return openCampaign({ segId: s.id });
      openSaveSegment((seg) => openCampaign({ segId: seg.id }));
    };
  };
  function openSaveSegment(then) {
    const loaded = SEGMENTS.find((s) => s.id === state.cfSeg);
    const n = matchSet(state.cf).length;
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="sgForm" role="dialog" aria-modal="true" aria-labelledby="sgTitle"><header><h2 id="sgTitle">${loaded ? "Update segment" : "Save as a segment"}</h2></header>
      <div class="mb mform"><span class="hint">${plural(n, "client matches", "clients match")} right now. Segments stay up to date by themselves: people join and leave as their details change.</span>
        <ul class="terms">${state.cf.rules.map((r) => `<li>${esc(describeRule(r))}</li>`).join("")}</ul>
        <label class="fl">Name<input id="sgName" maxlength="80" value="${esc(loaded?.name || "")}" placeholder="e.g. Lapsed regulars"></label>
        <label class="fl">Description <span class="h">(optional)</span><input id="sgDesc" maxlength="300" value="${esc(loaded?.desc || "")}" placeholder="Who this is, in a few words"></label></div>
      <footer><button type="button" class="btn ghost" data-mclose>Cancel</button>${loaded ? '<button type="button" class="btn" id="sgNew">Save as new</button>' : ""}<button type="submit" class="btn primary">${loaded ? "Update" : "Save segment"}</button></footer></form></div>`;
    const save = (asNew) => {
      const name = $("#sgName").value.trim();
      if (!name) { toast("Give the segment a name."); $("#sgName").focus(); return; }
      let seg;
      if (loaded && !asNew) Object.assign(loaded, { name, desc: $("#sgDesc").value.trim(), def: clone(state.cf) }), (seg = loaded);
      else SEGMENTS.push((seg = { id: `sg${nextSegId++}`, name, desc: $("#sgDesc").value.trim(), def: clone(state.cf) }));
      state.cfSeg = seg.id;
      closeModal(); render(); toast(`Saved “${name}”. Use it for campaigns, banners and journeys under Marketing.`);
      then && then(seg);
    };
    $("#sgForm").onsubmit = (e) => { e.preventDefault(); save(false); };
    if ($("#sgNew")) $("#sgNew").onclick = () => save(true);
    setTimeout(() => $("#sgName")?.focus(), 0);
  }

  // --- Emails ---
  const svgImg = (a, b, label) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="1200" height="520" fill="url(#g)"/><circle cx="930" cy="140" r="210" fill="#fff" opacity=".12"/><circle cx="240" cy="470" r="160" fill="#fff" opacity=".1"/><text x="70" y="290" font-family="Helvetica,Arial" font-size="72" font-weight="700" fill="#fff">${label}</text></svg>`)}`;
  const IMAGES = { i1: { name: "Studio photo", url: svgImg("#0e6b5f", "#58b8a0", "New timetable") }, i2: { name: "Offer", url: svgImg("#be185d", "#f59e9e", "Intro offer") }, i3: { name: "Celebrate", url: svgImg("#6d28d9", "#c4b5fd", "50 classes!") } };
  let nextImgId = 4;
  const THEME0 = { background: "#f4f6f4", content: "#ffffff", text: "#17201c", accent: "#0e6b5f", font: "sans", buttonShape: "rounded" };
  const EMAILS = [
    { id: "e1", name: "Welcome to the studio", category: "Onboarding", purpose: "service", updated: "2 days ago", design: { subject: "Welcome to {{studio_name}}, {{first_name}}", preheader: "Everything you need for your first class.", theme: { ...THEME0 }, blocks: [
      { type: "heading", text: "Welcome, {{first_name}}!", level: 1, align: "left" },
      { type: "text", text: "We're so glad you've joined {{studio_name}}. Here's how to get started:\n\n**1.** Pick a class that suits you.\n**2.** Arrive 10 minutes early for your first one.\n**3.** Bring water and grip socks.", align: "left" },
      { type: "button", label: "Book your first class", url: "https://app.example.com/schedule", align: "left", style: "filled" },
      { type: "text", text: "Questions? Just reply to this email.", align: "left" } ] } },
    { id: "e2", name: "Your intro offer is waiting", category: "Promotions", purpose: "marketing", updated: "5 days ago", design: { subject: "{{first_name}}, your intro offer is waiting", preheader: "The easiest way to try us out.", theme: { ...THEME0, accent: "#be185d" }, blocks: [
      { type: "image", img: "i2", alt: "Intro offer", width: "full", align: "center" },
      { type: "heading", text: "Try us out for less", level: 1, align: "left" },
      { type: "text", text: "Hi {{first_name}}, our 5-class pack is the best-value way to find the classes you love.", align: "left" },
      { type: "package", planId: "p2", buttonLabel: "Buy now" } ] } },
    { id: "e3", name: "We miss you", category: "Win-back", purpose: "marketing", updated: "3 weeks ago", design: { subject: "We miss you, {{first_name}}", preheader: "Your spot on the mat is waiting.", theme: { ...THEME0 }, blocks: [
      { type: "heading", text: "It's been a while!", level: 1, align: "left" },
      { type: "text", text: "Hi {{first_name}}, we haven't seen you in a little while and wanted to say hi. New classes are on the schedule every week.", align: "left" },
      { type: "button", label: "See this week's classes", url: "https://app.example.com/schedule", align: "left", style: "filled" } ] } },
    { id: "e4", name: "50 classes!", category: "Milestones", purpose: "marketing", updated: "1 month ago", design: { subject: "{{classes_attended}} classes, {{first_name}}!", preheader: "That's a big milestone.", theme: { ...THEME0, accent: "#6d28d9" }, blocks: [
      { type: "image", img: "i3", alt: "", width: "medium", align: "center" },
      { type: "heading", text: "{{classes_attended}} classes. Amazing!", level: 1, align: "center" },
      { type: "text", text: "Thank you for showing up for yourself, {{first_name}}. We've added a free class to your account.", align: "center" } ] } },
    { id: "e5", name: "November timetable", category: "Newsletters", purpose: "marketing", updated: "8 days ago", design: { subject: "New classes this November", preheader: "Barre is back on Saturdays.", theme: { ...THEME0 }, blocks: [
      { type: "image", img: "i1", alt: "Our new timetable", width: "full", align: "center" },
      { type: "heading", text: "What's new this month", level: 1, align: "left" },
      { type: "columns", columns: [{ type: "text", text: "**Barre is back** on Saturdays at 10:30am in Holland Village." }, { type: "text", text: "**Early Reformer** at 7am every weekday, with Ana and Ben." }] },
      { type: "button", label: "Book now", url: "https://app.example.com/schedule", align: "center", style: "filled" },
      { type: "divider" },
      { type: "social", style: "icons", links: { instagram: "https://instagram.com/demostudio", facebook: "https://facebook.com/demostudio", website: "https://demostudio.example.com" }, align: "center" } ] } },
  ];
  let nextEmailId = 6;
  const MERGE = { first_name: ["First name", "Chloe"], last_name: ["Last name", "Ng"], studio_name: ["Studio name", "Demo Studio"], classes_attended: ["Classes attended", "24"], credits_left: ["Classes left", "6"], studio_credit: ["Studio credit", "SGD 50.00"], referral_code: ["Referral code", "CHLOE-7K2P"], referral_link: ["Referral link", "app.example.com/join?ref=CHLOE-7K2P"], join_link: ["Sign-up link", "app.example.com/join"] };
  const BLOCKS = {
    heading: ["Heading", '<path d="M6 4v16M18 4v16M6 12h12"/>', "A title. Use one big heading at the top."],
    text: ["Text", '<path d="M4 6h16M4 11h16M4 16h10"/>', "Paragraphs, with bold, italic, links and personal details."],
    image: ["Image", '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 6-5 4 3 3-2 3 3"/>', "A photo or graphic. Add a short description for people who can't see images."],
    button: ["Button", '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>', "A clear call to action, e.g. “Book your first class”."],
    package: ["Package", '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M4 11h16M9 7V4h6v3"/>', "One of your packages with its price and a buy button. Stays up to date."],
    columns: ["Two columns", '<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/>', "Two things side by side. They stack on phones."],
    divider: ["Divider", '<path d="M3 12h18"/>', "A thin line between sections."],
    spacer: ["Space", '<path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4"/>', "Extra space between blocks."],
    social: ["Social links", '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 11 7.6-4M8.2 13l7.6 4"/>', "Links to Instagram, Facebook, TikTok, YouTube or your website."],
  };
  const newBlock = (type) => ({
    heading: { type, text: "Your heading", level: 1, align: "left" },
    text: { type, text: "Hi {{first_name}}, write your message here.", align: "left" },
    image: { type, img: "i1", alt: "", width: "full", align: "center" },
    button: { type, label: "Book a class", url: "https://app.example.com/schedule", align: "center", style: "filled" },
    package: { type, planId: PLANS.find((p) => p.onSale && !p.archived).id, buttonLabel: "Buy now" },
    columns: { type, columns: [{ type: "image", img: "i1", alt: "" }, { type: "text", text: "Write something here." }] },
    divider: { type },
    spacer: { type, height: 24 },
    social: { type, style: "icons", links: { instagram: "https://instagram.com/yourstudio" }, align: "center" },
  })[type];

  // Same list as the API: four fonts every device has, then Google Fonts (Gmail and Outlook show the fallback).
  const EMAIL_FONTS = {
    sans: ["Clean", "Helvetica, Arial, sans-serif"], serif: ["Classic", "Georgia, 'Times New Roman', serif"], rounded: ["Friendly", "'Trebuchet MS', 'Segoe UI', sans-serif"], modern: ["Modern", "Verdana, Geneva, Tahoma, sans-serif"],
    montserrat: ["Montserrat (bold, modern)", "Montserrat, Arial, sans-serif", "Arial"], poppins: ["Poppins (geometric)", "Poppins, Helvetica, Arial, sans-serif", "Helvetica"], lato: ["Lato (warm)", "Lato, Helvetica, Arial, sans-serif", "Helvetica"],
    dmsans: ["DM Sans (soft)", "'DM Sans', Helvetica, Arial, sans-serif", "Helvetica"], playfair: ["Playfair Display (elegant)", "'Playfair Display', Georgia, serif", "Georgia"], cormorant: ["Cormorant (refined)", "'Cormorant Garamond', Georgia, serif", "Georgia"],
  };
  const FONTS = Object.fromEntries(Object.entries(EMAIL_FONTS).map(([k, v]) => [k, v[1]]));
  const fontOpts = (cur, first = "") => `${first}${Object.entries(EMAIL_FONTS).map(([k, v], i) => `${i === 4 ? '<optgroup label="Web fonts (Gmail shows a standard font instead)">' : ""}<option value="${k}" ${cur === k ? "selected" : ""}>${v[0]}</option>`).join("")}</optgroup>`;
  const RAD = { rounded: "8px", pill: "999px", square: "0" };
  const onAccent = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#111" : "#fff"; };
  /** Text with **bold**, *italic*, [links](…) and {{tags}} shown as pills (or sample values). */
  function richText(raw, asTags) {
    let s = esc(raw);
    s = s.replace(/\[([^\]]{1,200})\]\(([^)\s]{1,500})\)/g, (_, t, u) => (/^(https?:\/\/|mailto:)/i.test(u.replace(/&amp;/g, "&")) ? `<a href="#" onclick="return false" title="${u}">${t}</a>` : t));
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (MERGE[k] ? (asTags ? `<span class="mt">${MERGE[k][0]}</span>` : esc(MERGE[k][1])) : `<span class="mt" style="background:#fde8e6;color:#b42318">${esc(k)}?</span>`));
    return s.replace(/\n/g, "<br>");
  }
  function blockView(b, t, asTags) {
    const al = `text-align:${b.align || "left"}`;
    switch (b.type) {
      case "heading": return b.level === 2 ? `<h2 style="${al}">${richText(b.text, asTags)}</h2>` : `<h1 style="${al}">${richText(b.text, asTags)}</h1>`;
      case "text": return `<p style="${al}">${richText(b.text, asTags)}</p>`;
      case "image": { const im = IMAGES[b.img]; const w = { full: "100%", medium: "60%", small: "34%" }[b.width || "full"]; return im ? `<img class="eimg" src="${im.url}" alt="${esc(b.alt || "")}" style="width:${w};margin:${b.align === "center" ? "0 auto" : b.align === "right" ? "0 0 0 auto" : "0"}">` : `<div class="eimgph">Choose an image</div>`; }
      case "button": return `<div style="${al}"><span class="ebtn ${b.style}" style="border-radius:${RAD[t.buttonShape]}">${richText(b.label, asTags)}</span></div>`;
      case "divider": return `<div class="ehr"></div>`;
      case "spacer": return `<div style="height:${b.height}px"></div>`;
      case "package": { const p = PLANS.find((x) => x.id === b.planId); if (!p) return `<div class="eimgph">Choose a package</div>`; return `<div class="epkg"><b style="font-size:18px">${esc(p.name)}</b><span class="pr">${m$c(p.price)}${p.billing === "recurring" ? `<span style="font-size:13px;font-weight:500"> ${perText(p)}</span>` : ""}</span>${p.desc ? `<span style="font-size:15px">${esc(p.desc)}</span>` : ""}<ul>${termsOf(p).slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join("")}</ul><div><span class="ebtn filled" style="border-radius:${RAD[t.buttonShape]};padding:9px 18px">${esc(b.buttonLabel)}</span></div></div>`; }
      case "social": { const names = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", website: "Website" }; const ks = Object.keys(names).filter((k) => b.links[k]); if (b.style === "icons" && ks.length) return `<div class="esoc icons" style="justify-content:${b.align === "center" ? "center" : b.align === "right" ? "flex-end" : "flex-start"}">${ks.map((k) => `<img src="${SOCIAL_SVG[k]}" width="32" height="32" alt="${names[k]}">`).join("")}</div>`; return `<div class="esoc" style="justify-content:${b.align === "center" ? "center" : b.align === "right" ? "flex-end" : "flex-start"}">${ks.map((k) => `<a href="#" onclick="return false">${names[k]}</a>`).join("") || '<span class="muted" style="font-weight:400">Add a link</span>'}</div>`; }
      case "columns": return `<div class="ecols">${b.columns.map((c) => `<div>${blockView({ ...c, align: c.align || "left" }, t, asTags)}</div>`).join("")}</div>`;
    }
    return "";
  }
  const themeVars = (t) => `--e-bg:${t.background};--e-content:${t.content};--e-text:${t.text};--e-accent:${t.accent};--e-on-accent:${onAccent(t.accent)};--e-font:${FONTS[t.font]};--e-hfont:${FONTS[t.headingFont || t.font]}`;
  const emailById = (id) => EMAILS.find((e) => e.id === id);

  // --- Journeys ---
  const ICO = {
    trigger: '<path d="M13 3 4 14h7l-1 7 9-11h-7z"/>',
    wait: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
    send_email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
    send_push: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/><circle cx="17" cy="5" r="3" fill="currentColor" stroke="none"/>',
    send_whatsapp: '<path d="M4 20l1.3-4A8 8 0 1 1 8.6 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.5-2-1.5-2.5-2.5l1-1-1-2z"/>',
    add_tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>',
    remove_tag: '<path d="M3 12V4h8l9 9-8 8z"/><path d="M6 6l5 5M11 6l-5 5"/>',
    give_reward: '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M12 9v11M3.5 13h17M12 9C10 4 6 5 7.5 7.5 8.5 9 12 9 12 9Zm0 0c2-5 6-4 4.5-1.5C15.5 9 12 9 12 9Z"/>',
    notify_staff: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
    check: '<path d="M12 3v6M12 9 5 16v5M12 9l7 7v5"/>',
    wait_for: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/><path d="M19 3l2 2"/>',
  };
  const svgI = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg>`;
  const KIND = { wait: "k-wait", wait_for: "k-split", check: "k-split", send_email: "k-send", send_push: "k-send", send_whatsapp: "k-send", add_tag: "k-do", remove_tag: "k-do", give_reward: "k-do", notify_staff: "k-do" };
  const STEP_TYPES = {
    send_email: ["Send an email", "One of your saved emails. Marketing emails skip people who haven't agreed to them.", "Do something"],
    send_push: ["Send a push notification", "A short message to their phone, if they have the app.", "Do something"],
    send_whatsapp: ["Send a WhatsApp message", "One of your WhatsApp templates (WhatsApp approves these first). Only goes to clients who've said yes to WhatsApp messages and have a mobile number.", "Do something"],
    give_reward: ["Give a reward", "Studio credit, free classes or a one-time discount.", "Do something"],
    add_tag: ["Add a tag", "Label them so staff can see it and you can filter by it.", "Do something"],
    remove_tag: ["Remove a tag", "Take a tag off them.", "Do something"],
    notify_staff: ["Tell the team", "Email your admins, e.g. “Give this client a call”.", "Do something"],
    wait: ["Wait", "Pause for a while before the next step.", "Wait"],
    wait_for: ["Wait for something (yes / no)", "Wait up to a set time for them to buy, book or come. Yes if they do, No if time runs out.", "Split"],
    check: ["Check (yes / no)", "Split by anything you can filter clients by, e.g. “Classes attended: at least 1”.", "Split"],
  };
  const TRIGGERS = {
    account_created: "Creates an account", first_class_booked: "Books their first class", class_attended: "Attends a class", attendance_milestone: "Reaches a number of classes",
    package_bought: "Buys a package", package_expiring: "Package is about to expire", package_used_up: "Uses their last class", membership_stopped: "Stops a membership",
    inactive: "Hasn't come for a while", joins_segment: "Joins a segment", referral_qualified: "Refers a friend who qualifies", gift_card_received: "Receives a gift card",
  };
  const TRIGGER_HELP = {
    account_created: "Starts when someone joins the studio in the app. Add a check on “Came from” to follow up ad leads differently.", first_class_booked: "Starts the first time they book.", class_attended: "Starts each time they're marked as attended.",
    attendance_milestone: "Starts when they attend their Nth class, e.g. their 50th.", package_bought: "Starts when they buy one of the package types you choose (or any).", package_expiring: "Starts a set number of days before a package expires.",
    package_used_up: "Starts when a credit pack runs out of classes.", membership_stopped: "Starts when a recurring package is stopped.", inactive: "Starts when it's been a set number of days since their last class (and nothing's booked).",
    joins_segment: "Starts when a client starts matching a saved segment. Checked every hour; people already in it when you go live aren't included.", referral_qualified: "Starts when a friend they referred meets your referral rule.", gift_card_received: "Starts when someone gives them a gift card.",
  };
  const EVENTS = { package_bought: "Buys a package", class_booked: "Books a class", class_attended: "Attends a class" };
  const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`);
  const dur = (d) => `${d.value} ${d.value === 1 ? d.unit.replace(/s$/, "") : d.unit}`;
  function triggerText(t) {
    if (t.type === "attendance_milestone") return `When a client attends their ${ord(t.count || 1)} class`;
    if (t.type === "package_expiring") return `${plural(t.days || 7, "day")} before a client's package expires`;
    if (t.type === "inactive") return `When a client hasn't come for ${t.days || 30} days`;
    if (t.type === "joins_segment") return `When a client joins “${SEGMENTS.find((s) => s.id === t.segmentId)?.name || "a segment"}”`;
    if (t.type === "package_bought" && t.planIds?.length) return `When a client buys ${t.planIds.map((id) => PLANS.find((p) => p.id === id)?.name).filter(Boolean).join(" or ")}`;
    return `When a client ${TRIGGERS[t.type].toLowerCase()}`;
  }
  function rewardText(r) {
    if (r.type === "credit") return `${m$c(r.amountCents)} studio credit, valid for ${r.validDays} days`;
    if (r.type === "free_classes") return `${plural(r.classes, "free class", "free classes")}, valid for ${r.validDays} days`;
    return `${r.percent ? `${r.percent}%` : m$c(r.amountCents || 0)} off one purchase, used within ${r.validDays} days`;
  }
  function stepText(s) {
    switch (s.type) {
      case "wait": return `Wait ${dur(s.for)}`;
      case "send_email": return emailById(s.emailId)?.name || "Choose an email";
      case "send_push": return s.title || "Write the message";
      case "send_whatsapp": return waTpl(s) ? waTpl(s).label : "Choose a template";
      case "add_tag": return `Add “${TAGS.find((t) => t.id === s.tagId)?.name || "?"}”`;
      case "remove_tag": return `Remove “${TAGS.find((t) => t.id === s.tagId)?.name || "?"}”`;
      case "give_reward": return rewardText(s.reward);
      case "notify_staff": return s.message;
      case "check": return describeRule(s.rule);
      case "wait_for": return `${EVENTS[s.event]}${s.event === "package_bought" && s.planIds?.length ? ` (${s.planIds.map((id) => PLANS.find((p) => p.id === id)?.name).join(" or ")})` : ""} within ${dur(s.within)}`;
    }
  }
  const waTpl = (s) => WA.templates.find((t) => t.name === s.template && t.language === s.language);
  const waBlanks = (body) => new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size;
  const stepProblem = (s) => (s.type === "send_whatsapp" ? (!WA.connected ? "Connect WhatsApp first" : !waTpl(s) ? "Choose a template" : s.variables.length < waBlanks(waTpl(s).body) || s.variables.some((v) => !v.trim()) ? "Fill in the blanks" : null) : s.type === "send_email" && !emailById(s.emailId) ? "Choose an email" : s.type === "send_push" && (!s.title.trim() || !s.body.trim()) ? "Write the title and message" : s.type === "check" && SEG[s.rule.field].kind === "pick" && !s.rule.ids.length ? "Choose at least one" : null);

  const JOURNEYS = [
    { id: "j1", name: "New member: intro offer follow-up", category: "Onboarding", desc: "Welcome new members, nudge anyone who hasn't bought after 3 days, and ask the team to call if they still haven't after a week.", status: "live", reentry: "once", quiet: true, version: 2, since: "12 Sep",
      def: { trigger: { type: "account_created" }, steps: [
        { id: "a1", type: "wait", for: { value: 1, unit: "hours" } },
        { id: "a2", type: "send_email", emailId: "e1" },
        { id: "a3", type: "wait_for", event: "package_bought", planIds: [], within: { value: 3, unit: "days" },
          yes: [{ id: "a4", type: "add_tag", tagId: "t5" }],
          no: [{ id: "a5", type: "send_email", emailId: "e2" }, { id: "a6", type: "wait_for", event: "package_bought", planIds: [], within: { value: 4, unit: "days" }, yes: [], no: [{ id: "a7", type: "notify_staff", message: "This new member hasn't bought a package a week after joining. A friendly call could help." }] }] },
      ] },
      stats: { started: 86, inProgress: 9, finished: 77, steps: { a1: { done: 86 }, a2: { done: 84 }, a3: { yes: 41, no: 36 }, a4: { done: 41 }, a5: { done: 30, skipped: 6 }, a6: { yes: 9, no: 23 }, a7: { done: 23 } }, waitingAt: { a3: 5, a6: 4 } } },
    { id: "j2", name: "Win back lapsed clients", category: "Win-back", desc: "Say hi to anyone who hasn't come for 30 days, then offer 20% off if they still haven't booked a week later.", status: "live", reentry: "every_time", quiet: true, version: 1, since: "3 Oct",
      def: { trigger: { type: "inactive", days: 30 }, steps: [
        { id: "b1", type: "send_email", emailId: "e3" },
        { id: "b2", type: "wait_for", event: "class_booked", within: { value: 7, unit: "days" }, yes: [], no: [
          { id: "b3", type: "give_reward", reward: { type: "discount", percent: 20, validDays: 14 } },
          { id: "b4", type: "send_push", title: "20% off, just for you", body: "We've added a one-time 20% discount to your account. Use it within 14 days." }] },
      ] },
      stats: { started: 24, inProgress: 3, finished: 21, steps: { b1: { done: 17, skipped: 7 }, b2: { yes: 9, no: 12 }, b3: { done: 12 }, b4: { done: 10, skipped: 2 } }, waitingAt: { b2: 3 } } },
    { id: "j3", name: "50th class celebration", category: "Milestones", desc: "Congratulate clients on their 50th class with a free class.", status: "draft", reentry: "once", quiet: true, version: 1,
      def: { trigger: { type: "attendance_milestone", count: 50 }, steps: [
        { id: "c1", type: "give_reward", reward: { type: "free_classes", classes: 1, validDays: 60 } },
        { id: "c2", type: "send_email", emailId: "e4" } ] },
      stats: { started: 0, inProgress: 0, finished: 0, steps: {}, waitingAt: {} } },
    { id: "jw1", name: "Last class used: top up", category: "Retention", desc: "When a pack runs out, a WhatsApp nudge, then an email two days later. People who buy a new pack leave straight away.", status: "live", reentry: "every_time", quiet: true, version: 1, since: "2 Oct",
      def: { trigger: { type: "package_used_up" }, goal: { event: "package_bought" }, steps: [
        { id: "d1", type: "send_whatsapp", template: "pack_used_up", language: "en", variables: ["{{first_name}}"] },
        { id: "d2", type: "wait", for: { value: 2, unit: "days" } },
        { id: "d3", type: "send_email", emailId: "e2" } ] },
      stats: { started: 38, inProgress: 4, finished: 34, converted: 21, steps: { d1: { done: 29, skipped: 9 }, d2: { done: 22 }, d3: { done: 14, skipped: 3 } }, waitingAt: { d2: 4 } } },
  ];
  let nextJId = 4, nextStepId = 1;
  const RECIPES = [
    { name: "New member: intro offer follow-up", desc: "Welcome, then nudge people who haven't bought after 3 days.", def: () => clone(JOURNEYS[0].def) },
    { name: "Win back lapsed clients", desc: "Say hi after 30 days away; a discount if they still don't book.", def: () => clone(JOURNEYS[1].def) },
    { name: "Ad leads: Meta and Google", desc: "Follow up people who joined from an ad differently from everyone else.", def: () => ({ trigger: { type: "account_created" }, steps: [{ id: "x", type: "check", rule: { field: "acquisition", value: "meta_ads" }, yes: [{ id: "y", type: "add_tag", tagId: "t5" }, { id: "z", type: "send_email", emailId: "e2" }], no: [{ id: "w", type: "send_email", emailId: "e1" }] }] }) },
    { name: "Milestone celebration", desc: "A reward and a note on their 50th class.", def: () => clone(JOURNEYS[2].def) },
    { name: "Package running out", desc: "Remind people a week before their package expires, if they still have classes left.", def: () => ({ trigger: { type: "package_expiring", days: 7 }, steps: [{ id: "x", type: "check", rule: { field: "creditsLeft", op: "at_least", value: 1 }, yes: [{ id: "y", type: "send_push", title: "Use them before they go", body: "You've still got classes left on your package. Book them before it expires." }], no: [] }] }) },
  ];
  const freshIds = (steps) => steps.forEach((s) => { s.id = `n${nextStepId++}`; if (s.yes) { freshIds(s.yes); freshIds(s.no); } });

  // Paths: "2.yes.0" = first step on the Yes side of the 3rd step.
  const P = (s) => (s === "" ? [] : s.split(".").map((x) => (/^\d+$/.test(x) ? Number(x) : x)));
  const listAt = (steps, prefix) => { let l = steps; for (let i = 0; i < prefix.length; i += 2) l = l[prefix[i]][prefix[i + 1]]; return l; };
  const stepAtP = (steps, path) => listAt(steps, path.slice(0, -1))[path.at(-1)];
  function findStep(steps, id, prefix = []) {
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.id === id) return [...prefix, i];
      if (s.yes) for (const side of ["yes", "no"]) { const r = findStep(s[side], id, [...prefix, i, side]); if (r) return r; }
    }
    return null;
  }
  function* walk(steps) { for (const s of steps) { yield s; if (s.yes) { yield* walk(s.yes); yield* walk(s.no); } } }

  /** The journey read aloud: what happens, in order. */
  function narrate(steps, depth = 0) {
    return steps.map((s) => {
      const pad = depth ? "" : "";
      if (s.type === "check" || s.type === "wait_for") {
        const q = s.type === "check" ? `Check: ${describeRule(s.rule)}` : `Wait up to ${dur(s.within)} for them to ${EVENTS[s.event].toLowerCase().replace(/^buys/, "buy").replace(/^books/, "book").replace(/^attends/, "attend")}`;
        return `<li>${pad}${esc(q)}<ul><li><b>${s.type === "check" ? "Yes" : "If they do"}:</b> ${s.yes.length ? `<ol>${narrate(s.yes, depth + 1)}</ol>` : "nothing more"}</li><li><b>${s.type === "check" ? "No" : "If not"}:</b> ${s.no.length ? `<ol>${narrate(s.no, depth + 1)}</ol>` : "nothing more"}</li></ul></li>`;
      }
      const tag = () => TAGS.find((x) => x.id === s.tagId)?.name;
      const t = {
        wait: () => `Wait ${dur(s.for)}`, send_email: () => `Send the email “${emailById(s.emailId)?.name || "?"}”`, send_push: () => `Send a push: “${s.title || "…"}”`, send_whatsapp: () => `Send the WhatsApp message “${waTpl(s)?.label || "?"}”`,
        add_tag: () => `Add the tag “${tag()}”`, remove_tag: () => `Remove the tag “${tag()}”`, give_reward: () => `Give ${rewardText(s.reward)}`, notify_staff: () => `Tell the team: “${s.message}”`,
      }[s.type]();
      return `<li>${esc(t)}</li>`;
    }).join("");
  }

  function statLine(j, s) {
    if (j.status === "draft") return "";
    const st = j.stats.steps[s.id] || {};
    const waiting = j.stats.waitingAt[s.id];
    const bits = [];
    if (s.type === "send_email") bits.push(`<b>${st.done || 0}</b> sent`, ...(st.skipped ? [`${st.skipped} skipped (not opted in)`] : []));
    else if (s.type === "send_push") bits.push(`<b>${st.done || 0}</b> sent`, ...(st.skipped ? [`${st.skipped} skipped`] : []));
    else if (s.type === "send_whatsapp") bits.push(`<b>${st.done || 0}</b> sent`, ...(st.skipped ? [`${st.skipped} skipped (no WhatsApp yes or no mobile)`] : []));
    else if (s.type === "check" || s.type === "wait_for") bits.push(`<b>${st.yes || 0}</b> yes`, `<b>${st.no || 0}</b> no`);
    else bits.push(`<b>${st.done || 0}</b> reached`);
    if (waiting) bits.push(`${waiting} waiting here now`);
    return `<div class="nstat">${bits.join(" · ")}</div>`;
  }
  function nodeHTML(j, s, path) {
    const sel = state.jSel === s.id;
    const prob = stepProblem(s);
    return `<div class="node ${KIND[s.type]} ${prob ? "warn" : ""}" role="button" tabindex="0" draggable="true" data-jstep="${s.id}" data-jpath="${path.join(".")}" aria-current="${sel}" aria-label="${esc(STEP_TYPES[s.type][0])}: ${esc(stepText(s))}">
      <span class="ico">${svgI(s.type)}</span><span><span class="kind">${esc(STEP_TYPES[s.type][0].replace(/ \(yes \/ no\)/, ""))}</span><div class="what">${esc(stepText(s))}</div>${prob ? `<div class="nstat" style="color:var(--warn)">${prob}</div>` : statLine(j, s)}</span>
      <span class="grip" aria-hidden="true" title="Drag to move">⠿</span></div>`;
  }
  const slot = (prefix, i) => `<div class="add" data-jslot="${[...prefix, i].join(".")}"><button type="button" class="plus" data-jadd="${[...prefix, i].join(".")}" aria-label="Add a step here" data-help="Add a step here. You can also drag a step onto any +.">+</button></div>`;
  function flowHTML(j, steps, prefix) {
    let h = `<div class="link"></div>${slot(prefix, 0)}`;
    steps.forEach((s, i) => {
      const path = [...prefix, i];
      h += `<div class="link"></div>${nodeHTML(j, s, path)}`;
      if (s.yes) {
        const st = j.stats.steps[s.id] || {};
        const lbl = (side) => `${s.type === "check" ? (side === "yes" ? "Yes" : "No") : side === "yes" ? "Yes: they did" : "No: time ran out"}${j.status !== "draft" ? `<small>${st[side] || 0}</small>` : ""}`;
        h += `<div class="link"></div><div class="lanes">${["yes", "no"].map((side) => `<div class="lane ${side}"><span class="lbl">${lbl(side)}</span>${flowHTML(j, s[side], [...path, side])}${s[side].length ? "" : '<span class="empty">Nothing more</span>'}</div>`).join("")}</div>`;
      }
      h += `<div class="link"></div>${slot(prefix, i + 1)}`;
    });
    return h;
  }
  function journeyCanvas(j) {
    const t = j.def.trigger;
    return `<div class="jcanvas"><div class="flow">
      <div class="node trigger k-trig" role="button" tabindex="0" data-jstep="trigger" aria-current="${state.jSel === "trigger"}"><span class="ico">${svgI("trigger")}</span><span><span class="kind">Starts</span><div class="what">${esc(triggerText(t))}</div>${j.status !== "draft" ? `<div class="nstat"><b>${j.stats.started}</b> started · ${j.stats.inProgress} in progress · ${j.stats.finished} finished</div>` : ""}</span><span></span></div>
      ${flowHTML(j, j.def.steps, [])}
      <div class="link"></div><span class="endcap">End</span>
    </div></div>`;
  }

  // Forms for the side panel (or a sheet on phones).
  const unitSel = (id, v) => `<select id="${id}">${["minutes", "hours", "days", "weeks"].map((u) => `<option value="${u}" ${u === v ? "selected" : ""}>${u}</option>`).join("")}</select>`;
  function rewardForm(r, pre) {
    return `<div class="seg" role="group" aria-label="Reward">${[["credit", "Studio credit"], ["free_classes", "Free classes"], ["discount", "Discount"]].map(([k, l]) => `<button type="button" data-${pre}rt="${k}" aria-pressed="${r.type === k}">${l}</button>`).join("")}</div>
      ${r.type === "credit" ? `<label class="fl">Amount (${STUDIO.currency})<input type="number" id="${pre}Amt" min="1" value="${(r.amountCents || 2000) / 100}"></label>` : r.type === "free_classes" ? `<label class="fl">Classes<input type="number" id="${pre}Cls" min="1" max="50" value="${r.classes || 1}"></label>` : `<div class="two"><label class="fl">Off<select id="${pre}Kind"><option value="pct" ${r.percent ? "selected" : ""}>%</option><option value="amt" ${!r.percent ? "selected" : ""}>${STUDIO.currency}</option></select></label><label class="fl">&nbsp;<input type="number" id="${pre}Off" min="1" value="${r.percent || (r.amountCents || 1000) / 100}"></label></div>`}
      <label class="fl">Valid for (days)<input type="number" id="${pre}Days" min="1" max="3650" value="${r.validDays}"></label>`;
  }
  function readReward(pre, r) {
    const v = (id) => Number($(`#${pre}${id}`)?.value);
    if (r.type === "credit") return { type: "credit", amountCents: Math.max(1, v("Amt") || 20) * 100, validDays: v("Days") || 30 };
    if (r.type === "free_classes") return { type: "free_classes", classes: Math.max(1, v("Cls") || 1), validDays: v("Days") || 30 };
    const pct = $(`#${pre}Kind`)?.value !== "amt";
    return { type: "discount", ...(pct ? { percent: Math.min(100, Math.max(1, v("Off") || 10)) } : { amountCents: Math.max(1, v("Off") || 10) * 100 }), validDays: v("Days") || 30 };
  }
  function stepForm(j, s) {
    const help = `<span class="sub">${esc(STEP_TYPES[s.type][1])}</span>`;
    let f = "";
    if (s.type === "wait") f = `<div class="two"><label class="fl">For<input type="number" id="jfV" min="1" max="1000" value="${s.for.value}"></label><label class="fl">&nbsp;${unitSel("jfU", s.for.unit)}</label></div>`;
    if (s.type === "send_email") { const e = emailById(s.emailId); f = `<label class="fl">Email<select id="jfE">${EMAILS.map((e) => `<option value="${e.id}" ${e.id === s.emailId ? "selected" : ""}>${esc(e.name)}${e.purpose === "service" ? " (service)" : ""}</option>`).join("")}</select></label>${e ? `<div class="inbox"><b>${richText(e.design.subject, false)}</b><span>${esc(e.design.preheader)}</span></div><span class="hint">${e.purpose === "marketing" ? "Marketing email: only sent to people who've agreed to marketing emails." : "Service email: sent to everyone, because it's about their account."}</span>` : ""}<div class="row"><button type="button" class="btn" id="jfEdit">Edit this email</button><button type="button" class="btn ghost" id="jfNew">+ New email</button></div>`; }
    if (s.type === "send_push") f = `<label class="fl">Title <span class="count" id="jfTc">${s.title.length}/60</span><input id="jfT" maxlength="60" value="${esc(s.title)}" placeholder="e.g. We miss you!"></label><label class="fl">Message <span class="count" id="jfBc">${s.body.length}/180</span><textarea id="jfB" rows="3" maxlength="180" placeholder="Keep it short and friendly">${esc(s.body)}</textarea></label><span class="hint">Marketing push: only sent to people who've agreed to notifications.</span>`;
    if (s.type === "send_whatsapp") {
      const t = waTpl(s);
      const filled = t ? esc(t.body).replace(/\{\{(\d+)\}\}/g, (_, n) => `<b class="wablank">${esc(s.variables[n - 1] || `{{${n}}}`)}</b>`) : "";
      f = !WA.connected ? alertBox("warn", "WhatsApp isn't connected", "Connect your WhatsApp number under Communication → Settings first.")
        : `<label class="fl">Template<select id="jfWa">${WA.templates.map((x) => `<option value="${esc(x.name)}|${esc(x.language)}" ${t && x.name === t.name && x.language === t.language ? "selected" : ""}>${esc(x.label)} (${x.category})</option>`).join("")}</select></label>
          ${t ? `${[...Array(waBlanks(t.body)).keys()].map((i) => `<label class="fl">Blank {{${i + 1}}}<input data-jfwav="${i}" maxlength="200" value="${esc(s.variables[i] || "")}" placeholder="e.g. {{first_name}}"></label>`).join("")}
          <div class="fl">How it looks<div class="wabubble">${filled}</div></div>
          <span class="hint">Use details like {{first_name}} in the blanks. WhatsApp only allows messages it has approved, so the wording itself is changed in WhatsApp Manager.</span>` : ""}`;
    }
    if (s.type === "add_tag" || s.type === "remove_tag") f = `<label class="fl">Tag<select id="jfTag">${TAGS.map((t) => `<option value="${t.id}" ${t.id === s.tagId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`;
    if (s.type === "give_reward") f = rewardForm(s.reward, "jr") + `<span class="hint">They're told by email and push. It shows in their account straight away.</span>`;
    if (s.type === "notify_staff") f = `<label class="fl">Message to the team<textarea id="jfM" rows="3" maxlength="500">${esc(s.message)}</textarea></label><span class="hint">Emailed to admins with the client's name and a link to their profile.</span>`;
    if (s.type === "check") f = `<div class="rulebox">${ruleRow(s.rule, "jc", false)}</div><span class="hint">Clients who match go down <b>Yes</b>; everyone else goes down <b>No</b>.</span>`;
    if (s.type === "wait_for") f = `<label class="fl">Wait for them to<select id="jfEv">${Object.entries(EVENTS).map(([k, l]) => `<option value="${k}" ${k === s.event ? "selected" : ""}>${l.toLowerCase().replace(/^buys/, "buy").replace(/^books/, "book").replace(/^attends/, "attend")}</option>`).join("")}</select></label>
      ${s.event === "package_bought" ? `<div class="fl">Which packages <span class="h">(none chosen = any)</span><div class="picks" style="display:flex;flex-wrap:wrap;gap:4px">${PLANS.filter((p) => !p.archived).map((p) => `<button type="button" class="pickchip" data-jfplan="${p.id}" aria-pressed="${(s.planIds || []).includes(p.id)}">${esc(p.name)}</button>`).join("")}</div></div>` : ""}
      <div class="two"><label class="fl">Up to<input type="number" id="jfWV" min="1" max="1000" value="${s.within.value}"></label><label class="fl">&nbsp;${unitSel("jfWU", s.within.unit)}</label></div><span class="hint">If they do it in time they go down <b>Yes</b> straight away. If time runs out, <b>No</b>.</span>`;
    const path = findStep(j.def.steps, s.id);
    const sib = listAt(j.def.steps, path.slice(0, -1));
    return `<h3>${esc(STEP_TYPES[s.type][0])}</h3>${help}<div class="mform">${f}</div>
      <div class="row" style="border-top:1px solid var(--line);padding-top:10px"><button type="button" class="btn" data-jmove="-1" ${path.at(-1) === 0 ? "disabled" : ""} aria-label="Move up">↑ Up</button><button type="button" class="btn" data-jmove="1" ${path.at(-1) === sib.length - 1 ? "disabled" : ""} aria-label="Move down">↓ Down</button><button type="button" class="btn" id="jDup">Duplicate</button><span class="grow"></span><button type="button" class="btn ghost danger" id="jDel">Delete${s.yes && (s.yes.length || s.no.length) ? "…" : ""}</button></div>`;
  }
  function triggerForm(j) {
    const t = j.def.trigger;
    return `<h3>How it starts</h3><span class="sub">${esc(TRIGGER_HELP[t.type])}</span><div class="mform">
      <label class="fl">When a client…<select id="jtT">${Object.entries(TRIGGERS).map(([k, l]) => `<option value="${k}" ${k === t.type ? "selected" : ""}>${l.toLowerCase()}</option>`).join("")}</select></label>
      ${t.type === "attendance_milestone" ? `<label class="fl">Class number<input type="number" id="jtN" min="1" value="${t.count || 50}"></label>` : ""}
      ${t.type === "package_expiring" || t.type === "inactive" ? `<label class="fl">${t.type === "inactive" ? "Days since their last class" : "Days before it expires"}<input type="number" id="jtD" min="1" max="365" value="${t.days || (t.type === "inactive" ? 30 : 7)}"></label>` : ""}
      ${t.type === "joins_segment" ? `<label class="fl">Segment<select id="jtS">${SEGMENTS.map((s) => `<option value="${s.id}" ${s.id === t.segmentId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>` : ""}
      ${t.type === "package_bought" ? `<div class="fl">Which packages <span class="h">(none chosen = any)</span><div style="display:flex;flex-wrap:wrap;gap:4px">${PLANS.filter((p) => !p.archived).map((p) => `<button type="button" class="pickchip" data-jtplan="${p.id}" aria-pressed="${(t.planIds || []).includes(p.id)}">${esc(p.name)}</button>`).join("")}</div></div>` : ""}
      <div class="fl">Can people go through it more than once?
        <label class="opt"><input type="radio" name="jre" value="once" ${j.reentry === "once" ? "checked" : ""}><div>Once only<br><span class="h">Each client goes through it a single time.</span></div></label>
        <label class="opt"><input type="radio" name="jre" value="every_time" ${j.reentry === "every_time" ? "checked" : ""}><div>Every time it happens<br><span class="h">Never twice at the same time.</span></div></label></div>
      <label class="check"><input type="checkbox" id="jQuiet" ${j.quiet ? "checked" : ""}> Quiet hours: hold emails, pushes and WhatsApp messages due between 9pm and 8am until the morning</label>
      <label class="fl">Goal ${tip("goal")}<select id="jtG"><option value="">No goal</option>${Object.entries(GOAL_EVENTS).map(([k, l]) => `<option value="${k}" ${j.def.goal?.event === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      ${j.def.goal ? `<span class="hint">Counts everyone who ${GOAL_VERB[j.def.goal.event]} while they're in the journey. If a “Wait for” step is waiting for the same thing, they carry on down its Yes side; otherwise the journey ends for them there.</span>` : '<span class="hint">Optional. Pick what counts as success to see how many people it converts.</span>'}
    </div>`;
  }
  // Goals: the three things a journey usually aims for (same list as GOAL_EVENTS in the API).
  const GOAL_EVENTS = { class_booked: "Books a class", class_attended: "Comes to a class", package_bought: "Buys a package" };
  const GOAL_VERB = { class_booked: "books a class", class_attended: "comes to a class", package_bought: "buys a package" };
  const goalLine = (j) => (j.def.goal ? `Goal: ${(GOAL_EVENTS[j.def.goal.event] || EVENTS[j.def.goal.event]).toLowerCase()}${j.status !== "draft" && j.stats.started ? `. ${j.stats.converted || 0} of ${j.stats.started} reached it (${Math.round(((j.stats.converted || 0) / j.stats.started) * 100)}%)` : ""}.` : "");
  function overviewPanel(j) {
    return `<label class="fl mform" style="gap:4px">Category<input id="jCat" list="jCats" maxlength="40" value="${esc(j.category || "")}" placeholder="e.g. Onboarding"><datalist id="jCats">${journeyCats().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <h3>What this journey does</h3><span class="sub">Click any step to change it. Use + to add a step, or drag a step onto a + to move it.</span>
      <ol class="terms" style="color:var(--fg);gap:6px"><li>${esc(triggerText(j.def.trigger))}</li>${narrate(j.def.steps)}</ol>
      ${j.def.goal ? `<span class="goalpill">🎯 ${esc(goalLine(j))}</span>` : `<span class="hint">No goal set. Add one under “How it starts” to see how many people it converts.</span>`}
      ${j.status === "live" ? alertBox("info", "Editing a live journey", "People part-way through finish the version they started. Changes apply to everyone who starts from now on.") : ""}`;
  }

  function bindJourney(j) {
    const panelEl = () => (isNarrow() ? null : $("#jPanel"));
    const redraw = () => { const y = window.scrollY; render(); window.scrollTo(0, y); if (isNarrow() && state.jSel && $("#modalRoot").innerHTML) openStepSheet(j); };
    document.querySelectorAll("[data-jstep]").forEach((n) => {
      const open = () => { state.jSel = n.dataset.jstep; if (isNarrow()) { render(); openStepSheet(j); } else redraw(); };
      n.onclick = (e) => { if (e.target.closest(".grip")) return; open(); };
      n.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
    });
    document.querySelectorAll("[data-jadd]").forEach((b) => (b.onclick = () => openStepPicker(j, P(b.dataset.jadd))));
    // Drag a step onto any + to move it there (with everything under it, for splits).
    let dragId = null;
    document.querySelectorAll(".node[draggable=true]").forEach((n) => {
      n.ondragstart = (e) => { dragId = n.dataset.jstep; n.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragId); } catch {} document.querySelectorAll(".add").forEach((a) => a.classList.add("drop-ok")); };
      n.ondragend = () => { n.classList.remove("dragging"); document.querySelectorAll(".add").forEach((a) => a.classList.remove("drop-ok", "over")); };
    });
    document.querySelectorAll("[data-jslot]").forEach((a) => {
      a.ondragover = (e) => { if (dragId) { e.preventDefault(); a.classList.add("over"); } };
      a.ondragleave = () => a.classList.remove("over");
      a.ondrop = (e) => { e.preventDefault(); a.classList.remove("over"); if (dragId) moveStep(j, dragId, P(a.dataset.jslot)); dragId = null; };
    });
    $("#jName").onchange = (e) => { j.name = e.target.value.trim() || j.name; toast("Name saved."); };
    $("#jBack").onclick = () => { state.jOpen = null; state.jSel = null; render(); };
    if ($("#jLive")) $("#jLive").onclick = () => goLive(j);
    if ($("#jPause")) $("#jPause").onclick = () => { j.status = "paused"; render(); toast(`Paused. Nobody new starts “${j.name}”, and people part-way through wait where they are.`); };
    if ($("#jTry")) $("#jTry").onclick = () => tryOnClient(j);
    if ($("#jHow")) $("#jHow").onclick = () => { state.jSel = null; openStepSheet(j); };
    $("#jDupJ").onclick = () => { const c = { ...clone(j), id: `j${nextJId++}`, name: `${j.name} (copy)`.slice(0, 80), status: "draft", version: 1, since: null, stats: { started: 0, inProgress: 0, finished: 0, steps: {}, waitingAt: {} } }; freshIds(c.def.steps); JOURNEYS.push(c); state.jOpen = c.id; state.jSel = null; render(); toast("Copied as a draft."); };
    $("#jDelJ").onclick = () => deleteJourney(j);
    bindJCat(j);
    if (panelEl()) bindStepForm(j, redraw);
  }
  function bindStepForm(j, redraw) {
    const sel = state.jSel;
    const touch = () => { if (j.status === "live") j.version += 0; };
    if (sel === "trigger") {
      const t = j.def.trigger;
      $("#jtT").onchange = (e) => { j.def.trigger = { type: e.target.value }; if (e.target.value === "joins_segment") j.def.trigger.segmentId = SEGMENTS[0].id; redraw(); };
      if ($("#jtN")) $("#jtN").onchange = (e) => { t.count = Math.max(1, Number(e.target.value) || 1); redraw(); };
      if ($("#jtD")) $("#jtD").onchange = (e) => { t.days = Math.max(1, Number(e.target.value) || 1); redraw(); };
      if ($("#jtS")) $("#jtS").onchange = (e) => { t.segmentId = e.target.value; redraw(); };
      document.querySelectorAll("[data-jtplan]").forEach((b) => (b.onclick = () => { const id = b.dataset.jtplan; t.planIds = (t.planIds || []).includes(id) ? t.planIds.filter((x) => x !== id) : [...(t.planIds || []), id]; redraw(); }));
      document.querySelectorAll("input[name=jre]").forEach((r) => (r.onchange = () => { j.reentry = r.value; }));
      $("#jQuiet").onchange = (e) => { j.quiet = e.target.checked; };
      $("#jtG").onchange = (e) => { j.def.goal = e.target.value ? { event: e.target.value } : null; redraw(); };
      return;
    }
    const path = sel ? findStep(j.def.steps, sel) : null;
    if (!path) return;
    const s = stepAtP(j.def.steps, path);
    const num = (id, fn) => { if ($(id)) $(id).onchange = (e) => { fn(Math.max(1, Number(e.target.value) || 1)); touch(); redraw(); }; };
    if (s.type === "wait") { num("#jfV", (v) => (s.for.value = v)); $("#jfU").onchange = (e) => { s.for.unit = e.target.value; redraw(); }; }
    if (s.type === "send_email") {
      $("#jfE").onchange = (e) => { s.emailId = e.target.value; redraw(); };
      $("#jfEdit").onclick = () => openEmail(s.emailId, { back: "journey" });
      $("#jfNew").onclick = () => { const e = newEmail(); s.emailId = e.id; openEmail(e.id, { back: "journey" }); };
    }
    if (s.type === "send_push") {
      $("#jfT").oninput = (e) => { s.title = e.target.value; $("#jfTc").textContent = `${s.title.length}/60`; };
      $("#jfB").oninput = (e) => { s.body = e.target.value; $("#jfBc").textContent = `${s.body.length}/180`; };
      $("#jfT").onchange = $("#jfB").onchange = () => redraw();
    }
    if (s.type === "send_whatsapp" && $("#jfWa")) {
      $("#jfWa").onchange = (e) => { [s.template, s.language] = e.target.value.split("|"); s.variables = []; redraw(); };
      document.querySelectorAll("[data-jfwav]").forEach((el) => (el.onchange = () => { s.variables[Number(el.dataset.jfwav)] = el.value; redraw(); }));
    }
    if (s.type === "add_tag" || s.type === "remove_tag") $("#jfTag").onchange = (e) => { s.tagId = e.target.value; redraw(); };
    if (s.type === "give_reward") {
      document.querySelectorAll("[data-jrrt]").forEach((b) => (b.onclick = () => { s.reward = { ...newRewardOf(b.dataset.jrrt), validDays: s.reward.validDays }; redraw(); }));
      ["jrAmt", "jrCls", "jrKind", "jrOff", "jrDays"].forEach((id) => { if ($(`#${id}`)) $(`#${id}`).onchange = () => { s.reward = readReward("jr", s.reward); redraw(); }; });
    }
    if (s.type === "notify_staff") $("#jfM").onchange = (e) => { s.message = e.target.value.trim() || s.message; redraw(); };
    if (s.type === "check") bindRules(() => s.rule, (_, r) => (s.rule = r), () => {}, redraw);
    if (s.type === "wait_for") {
      $("#jfEv").onchange = (e) => { s.event = e.target.value; redraw(); };
      document.querySelectorAll("[data-jfplan]").forEach((b) => (b.onclick = () => { const id = b.dataset.jfplan; s.planIds = (s.planIds || []).includes(id) ? s.planIds.filter((x) => x !== id) : [...(s.planIds || []), id]; redraw(); }));
      num("#jfWV", (v) => (s.within.value = v));
      $("#jfWU").onchange = (e) => { s.within.unit = e.target.value; redraw(); };
    }
    document.querySelectorAll("[data-jmove]").forEach((b) => (b.onclick = () => { const list = listAt(j.def.steps, path.slice(0, -1)); const i = path.at(-1), k = i + Number(b.dataset.jmove); [list[i], list[k]] = [list[k], list[i]]; redraw(); }));
    $("#jDup").onclick = () => { const list = listAt(j.def.steps, path.slice(0, -1)); const copy = clone(s); freshIds([copy]); list.splice(path.at(-1) + 1, 0, copy); state.jSel = copy.id; redraw(); };
    $("#jDel").onclick = () => {
      const kids = s.yes ? [...walk(s.yes), ...walk(s.no)].length : 0;
      const del = () => { listAt(j.def.steps, path.slice(0, -1)).splice(path.at(-1), 1); state.jSel = null; closeModal(); render(); toast("Step deleted."); };
      if (kids) confirmFlags([{ level: "confirm", title: "Delete this split?", msg: `This also deletes the ${plural(kids, "step")} on its Yes and No sides.` }], { proceed: del, proceedLabel: "Delete them all" });
      else del();
    };
  }
  const newRewardOf = (type) => ({ credit: { type, amountCents: 2000 }, free_classes: { type, classes: 1 }, discount: { type, percent: 10 } })[type];
  function openStepSheet(j) {
    const sel = state.jSel;
    const s = sel && sel !== "trigger" ? stepAtP(j.def.steps, findStep(j.def.steps, sel) || [0]) : null;
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-label="Edit step"><div class="mb" id="jSheet" style="padding-top:16px">${sel === "trigger" ? triggerForm(j) : s ? stepForm(j, s) : overviewPanel(j)}</div><footer><button type="button" class="btn primary" data-mclose>Done</button></footer></div></div>`;
    bindStepForm(j, () => { render(); openStepSheet(j); });
    bindJCat(j);
  }
  function moveStep(j, id, dest) {
    const from = findStep(j.def.steps, id);
    const destPrefix = dest.slice(0, -1);
    if (from.every((x, i) => destPrefix[i] === x) && destPrefix.length > from.length) { toast("A split can't be moved inside itself."); return; }
    const fromList = listAt(j.def.steps, from.slice(0, -1));
    const [s] = fromList.splice(from.at(-1), 1);
    let at = dest.at(-1);
    const toList = listAt(j.def.steps, destPrefix);
    if (toList === fromList && from.at(-1) < at) at -= 1;
    toList.splice(at, 0, s);
    state.jSel = s.id;
    render();
    toast("Step moved.");
  }
  function openStepPicker(j, slotPath) {
    const groups = ["Do something", "Wait", "Split"];
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-labelledby="pkTitle" style="width:min(560px,100%)"><header><h2 id="pkTitle">Add a step</h2></header><div class="mb">
      ${groups.map((g) => `<div class="pickgrp">${g}</div><div class="picker">${Object.entries(STEP_TYPES).filter(([, v]) => v[2] === g).map(([k, v]) => `<button type="button" class="${KIND[k]}" data-pick="${k}"><span class="ico">${svgI(k)}</span><span><b>${esc(v[0])}</b><span class="h">${esc(v[1])}</span></span></button>`).join("")}</div>`).join("")}
      </div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button></footer></div></div>`;
    document.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => {
      const type = b.dataset.pick;
      const id = `n${nextStepId++}`;
      const s = { wait: { id, type, for: { value: 1, unit: "days" } }, send_email: { id, type, emailId: EMAILS[0].id }, send_push: { id, type, title: "", body: "" }, send_whatsapp: { id, type, template: WA.templates[0]?.name || "", language: WA.templates[0]?.language || "en", variables: [] }, add_tag: { id, type, tagId: TAGS[0].id }, remove_tag: { id, type, tagId: TAGS[0].id }, give_reward: { id, type, reward: { type: "credit", amountCents: 2000, validDays: 30 } }, notify_staff: { id, type, message: "Give this client a call." }, check: { id, type, rule: newRule(), yes: [], no: [] }, wait_for: { id, type, event: "package_bought", planIds: [], within: { value: 3, unit: "days" }, yes: [], no: [] } }[type];
      listAt(j.def.steps, slotPath.slice(0, -1)).splice(slotPath.at(-1), 0, s);
      state.jSel = id;
      closeModal(); render();
      if (isNarrow()) openStepSheet(j);
    }));
  }
  function journeyProblems(j) {
    const out = [];
    if (!j.def.steps.length) out.push("Add at least one step.");
    for (const s of walk(j.def.steps)) { const p = stepProblem(s); if (p) out.push(`${STEP_TYPES[s.type][0]}: ${p.toLowerCase()}.`); }
    return out;
  }
  function goLive(j) {
    const probs = journeyProblems(j);
    if (probs.length) { $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="pTitle"><header><h2 id="pTitle">A few things to finish first</h2></header><div class="mb"><ul class="terms" style="color:var(--fg)">${probs.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div><footer><button type="button" class="btn primary" data-mclose>OK</button></footer></div></div>`; return; }
    const t = triggerText(j.def.trigger);
    confirmFlags([{ level: "confirm", title: "Start this journey?", msg: `“${j.name}” will start running: ${t.charAt(0).toLowerCase()}${t.slice(1)}, they'll go through its steps.${j.def.trigger.type === "joins_segment" ? " People already in the segment aren't included." : ""}${j.status === "paused" ? " People who were part-way through carry on from where they stopped." : ""}` }], {
      proceedLabel: "Go live",
      proceed: () => { j.status = "live"; j.since = j.since || "today"; render(); toast(`“${j.name}” is live.`); },
    });
  }
  function tryOnClient(j) {
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="tryForm" role="dialog" aria-modal="true" aria-labelledby="tryTitle"><header><h2 id="tryTitle">Add someone by hand</h2></header><div class="mb mform"><span class="hint">Useful to test it on yourself, or for a client who missed the trigger. They start at the first step now.</span>
      <label class="fl">Client<select id="tryC">${CLIENTS.map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join("")}</select></label></div>
      <footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">Add them</button></footer></form></div>`;
    $("#tryForm").onsubmit = (e) => { e.preventDefault(); const c = CLIENTS[Number($("#tryC").value)]; j.stats.started++; j.stats.inProgress++; closeModal(); render(); toast(`${c.name} has started “${j.name}”.`); };
  }

  // --- Campaigns ---
  const CAMPAIGNS = [
    { id: "cp1", name: "November timetable", emailId: "e5", segId: null, status: "sent", when: "Tue 3 Nov, 9:00am", recipients: 12, skipped: 8, delivered: 12 },
    { id: "cp2", name: "Black Friday: 20% off packs", emailId: "e2", segId: "sg1", status: "scheduled", when: "Fri 27 Nov, 9:00am", recipients: 0, skipped: 0 },
  ];
  let nextCampId = 3;
  const audienceOf = (segId) => (segId ? matchSet(SEGMENTS.find((s) => s.id === segId).def) : CLIENTS.map((_, i) => i));
  function openCampaign(pre = {}) {
    const c = { name: pre.name || "", emailId: pre.emailId || EMAILS.find((e) => e.purpose === "marketing")?.id || EMAILS[0].id, segId: pre.segId ?? null, when: "now", at: "2026-11-13T09:00" };
    const paint = () => {
      const ids = audienceOf(c.segId);
      const e = emailById(c.emailId);
      const ok = e.purpose === "marketing" ? ids.filter((i) => factsOf(i).marketingEmail === "yes").length : ids.length;
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="cpForm" role="dialog" aria-modal="true" aria-labelledby="cpTitle"><header><h2 id="cpTitle">New campaign</h2></header><div class="mb mform">
        <label class="fl">Name <span class="h">(just for you)</span><input id="cpName" maxlength="80" value="${esc(c.name)}" placeholder="e.g. December timetable"></label>
        <label class="fl">Email<select id="cpEmail">${EMAILS.map((x) => `<option value="${x.id}" ${x.id === c.emailId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        <div class="inbox"><b>${richText(e.design.subject, false)}</b><span>${esc(e.design.preheader)}</span></div>
        <label class="fl">Who gets it<select id="cpSeg"><option value="">Everyone</option>${SEGMENTS.map((s) => `<option value="${s.id}" ${s.id === c.segId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
        ${alertBox(ok ? "info" : "warn", "", `<b>${plural(ok, "person", "people")}</b> will get it.${e.purpose === "marketing" && ok < ids.length ? ` ${ids.length - ok} of the ${ids.length} haven't agreed to marketing emails, so they're skipped.` : ""}`)}
        <div class="fl">When
          <label class="opt"><input type="radio" name="cpW" value="now" ${c.when === "now" ? "checked" : ""}><div>Send now</div></label>
          <label class="opt"><input type="radio" name="cpW" value="later" ${c.when === "later" ? "checked" : ""}><div>Schedule it<br>${c.when === "later" ? `<input type="datetime-local" id="cpAt" value="${c.at}" style="margin-top:4px;max-width:240px">` : ""}</div></label></div></div>
        <footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="button" class="btn" id="cpTest">Send me a test</button><button type="submit" class="btn primary" ${ok ? "" : "disabled"}>${c.when === "now" ? "Send…" : "Schedule…"}</button></footer></form></div>`;
      $("#cpName").oninput = (ev) => (c.name = ev.target.value);
      $("#cpEmail").onchange = (ev) => { c.emailId = ev.target.value; paint(); };
      $("#cpSeg").onchange = (ev) => { c.segId = ev.target.value || null; paint(); };
      document.querySelectorAll("input[name=cpW]").forEach((r) => (r.onchange = () => { c.when = r.value; paint(); }));
      if ($("#cpAt")) $("#cpAt").onchange = (ev) => (c.at = ev.target.value);
      $("#cpTest").onclick = () => toast("A test copy is on its way to your inbox.");
      $("#cpForm").onsubmit = (ev) => {
        ev.preventDefault();
        const name = c.name.trim() || e.name;
        const later = c.when === "later";
        const whenTxt = later ? new Date(c.at).toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "now";
        confirmFlags([{ level: "confirm", title: later ? "Schedule this email?" : "Send this email?", msg: `${later ? "Schedule" : "Send"} “${e.design.subject.replace(/\{\{first_name\}\}/g, "…")}” to ${plural(ok, "person", "people")} ${later ? `on ${whenTxt}` : "now"}? It can't be unsent once it's gone.` }], {
          proceedLabel: later ? "Schedule" : "Send",
          proceed: () => { if (pre.draftId) { const di = CAMPAIGNS.findIndex((x) => x.id === pre.draftId); if (di >= 0) CAMPAIGNS.splice(di, 1); } CAMPAIGNS.unshift({ id: `cp${nextCampId++}`, name, emailId: c.emailId, emailName: e.name, segId: c.segId, status: later ? "scheduled" : "sent", when: later ? whenTxt : "Just now", recipients: later ? 0 : ok, skipped: later ? 0 : ids.length - ok, delivered: later ? 0 : ok }); state.page = "marketing"; state.mtab = "campaigns"; state.jOpen = state.eOpen = null; try { location.hash = "marketing"; } catch {} render(); toast(later ? `Scheduled for ${whenTxt}.` : `Sending to ${plural(ok, "person", "people")}.`); },
          back: () => paint(),
        });
      };
    };
    paint();
  }

  // --- Email builder page ---
  function newEmail() {
    const e = { id: `e${nextEmailId++}`, name: "Untitled email", purpose: "marketing", updated: "just now", design: { subject: "", preheader: "", theme: { ...THEME0 }, blocks: [newBlock("heading"), newBlock("text"), newBlock("button")] } };
    EMAILS.unshift(e);
    return e;
  }
  function openEmail(id, opts = {}) {
    const e = emailById(id);
    state.eOpen = id; state.eDraft = clone(e); state.eSel = null; state.eBack = opts.back || null; state.eDirty = false;
    state.page = "marketing"; closeModal();
    try { location.hash = "marketing"; } catch {}
    render(); window.scrollTo(0, 0);
  }
  function emailPanel(d) {
    const sel = state.eSel;
    if (sel === null || !d.design.blocks[sel]) {
      const t = d.design.theme;
      return `<h3>Email settings</h3><div class="mform">
        <label class="fl">Name <span class="h">(just for you)</span><input id="emName" maxlength="80" value="${esc(d.name)}"></label>
        <div class="fl">Type
          <label class="opt"><input type="radio" name="emP" value="marketing" ${d.purpose === "marketing" ? "checked" : ""}><div>Marketing<br><span class="h">News and offers. Only sent to people who've agreed, with an unsubscribe link.</span></div></label>
          <label class="opt"><input type="radio" name="emP" value="service" ${d.purpose === "service" ? "checked" : ""}><div>Service<br><span class="h">About their account or bookings (e.g. a welcome). Sent to everyone. Don't use it for offers.</span></div></label></div>
        <label class="fl">Category <span class="h">(to keep emails tidy)</span><input id="emCat" list="emCats" maxlength="40" value="${esc(d.category || "")}" placeholder="e.g. Promotions"><datalist id="emCats">${emailCats().map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
        <label class="fl">Subject line <span class="count">${d.design.subject.length}/150</span><input id="emSubj" maxlength="150" value="${esc(d.design.subject)}" placeholder="e.g. Welcome to the studio, {{first_name}}"></label>
        <label class="fl">Preview text <span class="h">(the grey line after the subject in most inboxes)</span><input id="emPre" maxlength="150" value="${esc(d.design.preheader)}"></label>
        <div class="fmtbar"><span class="hint">Add to subject:</span>${["first_name", "studio_name"].map((k) => `<button type="button" data-subjtag="${k}">${MERGE[k][0]}</button>`).join("")}</div>
        <div class="fl">In the inbox<div class="inbox"><b>${d.design.subject ? richText(d.design.subject, false) : '<span class="muted">No subject yet</span>'}</b><span>${esc(d.design.preheader || "")}</span></div></div>
        <div class="fl">Colours <span class="h">Pick a colour or type your brand's hex code.</span><div class="hexgrid">${[["background", "Page"], ["content", "Email"], ["text", "Text"], ["accent", "Buttons & links"]].map(([k, l]) => `<label class="hexrow"><span>${l}</span><input type="color" data-themec="${k}" value="${t[k]}" aria-label="${l} colour"><input type="text" class="hex" data-themehex="${k}" value="${t[k].toUpperCase()}" maxlength="7" spellcheck="false" aria-label="${l} hex code"></label>`).join("")}</div></div>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Text font<select id="emFont">${fontOpts(t.font)}</select></label><label class="fl">Heading font<select id="emHFont">${fontOpts(t.headingFont || "", `<option value="" ${!t.headingFont ? "selected" : ""}>Same as text</option>`)}</select></label></div>
        ${[t.font, t.headingFont].some((f) => f && EMAIL_FONTS[f][2]) ? `<span class="hint">Web fonts show in Apple Mail and most phones. Gmail and Outlook show ${[...new Set([t.font, t.headingFont].filter((f) => f && EMAIL_FONTS[f][2]).map((f) => EMAIL_FONTS[f][2]))].join(" / ")} instead.</span>` : ""}
        <div class="two" style="grid-template-columns:1fr 1fr">
          <label class="fl">Buttons<select id="emShape"><option value="rounded" ${t.buttonShape === "rounded" ? "selected" : ""}>Rounded</option><option value="pill" ${t.buttonShape === "pill" ? "selected" : ""}>Pill</option><option value="square" ${t.buttonShape === "square" ? "selected" : ""}>Square</option></select></label></div>
        ${onAccent(t.accent) === "#111" ? alertBox("info", "", "Light button colour: button text will be dark so it stays readable.") : ""}
      </div>`;
    }
    const b = d.design.blocks[sel];
    const al = (k = "al") => `<div class="fl">Alignment<div class="seg" role="group">${["left", "center", "right"].map((a) => `<button type="button" data-${k}="${a}" aria-pressed="${(b.align || "left") === a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join("")}</div></div>`;
    const tags = `<div class="fmtbar"><button type="button" data-fmt="b" aria-label="Bold"><b>B</b></button><button type="button" data-fmt="i" aria-label="Italic"><i>I</i></button><button type="button" data-fmt="link">Link</button><select id="emTag" style="height:28px;border-radius:7px;font-size:12.5px"><option value="">+ Personal detail</option>${Object.entries(MERGE).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join("")}</select></div>`;
    const imgPick = (cur, key) => `<div class="fl">Image<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${Object.entries(IMAGES).map(([id, im]) => `<button type="button" data-${key}="${id}" aria-pressed="${cur === id}" style="padding:0;border:2px solid ${cur === id ? "var(--accent)" : "var(--line)"};border-radius:8px;overflow:hidden;background:none"><img src="${im.url}" alt="${esc(im.name)}" style="display:block;width:100%;aspect-ratio:16/7;object-fit:cover"></button>`).join("")}</div>
      <label class="btn" style="justify-content:center;cursor:pointer">Upload an image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-upl="${key}" hidden></label><span class="h">JPG, PNG, WebP or GIF, up to 2 MB.</span></div>`;
    let f = "";
    if (b.type === "heading") f = `<label class="fl">Text<input id="bkText" maxlength="200" value="${esc(b.text)}"></label><div class="fl">Size<div class="seg" role="group"><button type="button" data-lvl="1" aria-pressed="${b.level !== 2}">Big</button><button type="button" data-lvl="2" aria-pressed="${b.level === 2}">Medium</button></div></div>${al()}`;
    if (b.type === "text") f = `<label class="fl">Text<textarea id="bkText" rows="7" maxlength="5000">${esc(b.text)}</textarea></label>${tags}<span class="h hint">**bold**, *italic*, [link text](https://…). Personal details are filled in for each person.</span>${al()}`;
    if (b.type === "image") f = imgPick(b.img, "bimg") + `<label class="fl">Description <span class="h">(for screen readers and when images are off)</span><input id="bkAlt" maxlength="200" value="${esc(b.alt || "")}" placeholder="e.g. Reformer class in our Tanjong Pagar studio"></label><label class="fl">Link <span class="h">(optional)</span><input id="bkLink" maxlength="2000" value="${esc(b.link || "")}" placeholder="https://…"></label><div class="fl">Size<div class="seg" role="group">${[["full", "Full"], ["medium", "Medium"], ["small", "Small"]].map(([k, l]) => `<button type="button" data-iw="${k}" aria-pressed="${(b.width || "full") === k}">${l}</button>`).join("")}</div></div>${al()}`;
    if (b.type === "button") f = `<label class="fl">Label<input id="bkLabel" maxlength="60" value="${esc(b.label)}"></label><label class="fl">Link<input id="bkUrl" maxlength="2000" value="${esc(b.url)}" placeholder="https://…"></label><div class="fl">Style<div class="seg" role="group"><button type="button" data-bs="filled" aria-pressed="${b.style === "filled"}">Filled</button><button type="button" data-bs="outline" aria-pressed="${b.style === "outline"}">Outline</button></div></div>${al()}`;
    if (b.type === "spacer") f = `<label class="fl">Height: <span id="spH">${b.height}px</span><input type="range" id="bkH" min="8" max="120" step="4" value="${b.height}"></label>`;
    if (b.type === "divider") f = `<span class="hint">A thin line. Nothing to set.</span>`;
    if (b.type === "package") f = `<label class="fl">Package<select id="bkPlan">${PLANS.filter((p) => p.onSale && !p.archived).map((p) => `<option value="${p.id}" ${p.id === b.planId ? "selected" : ""}>${esc(p.name)} · ${m$c(p.price)}</option>`).join("")}</select></label><label class="fl">Button<input id="bkBL" maxlength="60" value="${esc(b.buttonLabel)}"></label><span class="hint">Shows the package's current price and rules, so it's never out of date.</span>`;
    if (b.type === "social") f = `<div class="fl">Show as<div class="seg" role="group"><button type="button" data-socstyle="icons" aria-pressed="${b.style === "icons"}">Icons</button><button type="button" data-socstyle="text" aria-pressed="${b.style !== "icons"}">Names</button></div></div>` + ["instagram", "facebook", "tiktok", "youtube", "website"].map((k) => `<label class="fl">${k === "tiktok" ? "TikTok" : k === "youtube" ? "YouTube" : k[0].toUpperCase() + k.slice(1)}<input data-soc="${k}" maxlength="2000" value="${esc(b.links[k] || "")}" placeholder="https://…"></label>`).join("") + al();
    if (b.type === "columns") f = b.columns.map((c, ci) => `<div class="fl" style="border:1px solid var(--line);border-radius:10px;padding:8px">${ci ? "Right" : "Left"}<select data-coltype="${ci}">${[["text", "Text"], ["image", "Image"], ["button", "Button"]].map(([k, l]) => `<option value="${k}" ${c.type === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${c.type === "text" ? `<textarea data-coltext="${ci}" rows="4">${esc(c.text)}</textarea>` : c.type === "image" ? imgPick(c.img, `cimg${ci}`) : `<input data-collabel="${ci}" value="${esc(c.label)}" placeholder="Label"><input data-colurl="${ci}" value="${esc(c.url)}" placeholder="https://…">`}</div>`).join("") + `<span class="hint">Side by side on computers; one above the other on phones.</span>`;
    return `<h3>${BLOCKS[b.type][0]}</h3><span class="sub">${esc(BLOCKS[b.type][2])}</span><div class="mform">${f}</div><button type="button" class="btn ghost" id="bkDone">Back to email settings</button>`;
  }
  function emailBuilder() {
    const d = state.eDraft;
    const t = d.design.theme;
    const asTags = state.eTags !== false;
    const blocks = d.design.blocks;
    return `<div class="jhead"><div class="row" style="gap:6px;min-width:0;flex:1"><button type="button" class="btn ghost" id="emBack">← ${state.eBack === "journey" ? "Back to journey" : "Emails"}</button><input class="nm" id="emNameTop" value="${esc(d.name)}" aria-label="Email name"><span class="status ${d.purpose === "marketing" ? "wait" : "off"}">${d.purpose === "marketing" ? "Marketing" : "Service"}</span>${state.eDirty ? '<span class="hint">Unsaved changes</span>' : ""}</div>
      <div class="row"><span class="seg" role="group" aria-label="Preview size"><button type="button" data-dev="desk" aria-pressed="${state.eDev !== "phone"}">Computer</button><button type="button" data-dev="phone" aria-pressed="${state.eDev === "phone"}">Phone</button></span><span class="seg" role="group" aria-label="Personal details"><button type="button" data-tagv="1" aria-pressed="${asTags}" data-help="Show personal details as labels, so you can see where they go.">Labels</button><button type="button" data-tagv="0" aria-pressed="${!asTags}" data-help="Show a sample client's details, as they'd see it.">Sample</button></span><button type="button" class="btn" id="emTest">Send me a test</button><button type="button" class="btn" id="emDup" data-help="Make a copy to start a new email from this one.">Duplicate</button><button type="button" class="btn ghost danger" id="emDel">Delete</button><button type="button" class="btn primary" id="emSave">Save</button></div></div>
      ${isNarrow() ? alertBox("info", "Easier on a bigger screen", "Building an email works best on a computer or tablet. On a phone it's handy for quick fixes, checking how it looks and sending yourself a test.") : ""}
      <div class="ebuilder">
        <div class="epalette" aria-label="Add a block"><span class="hint">Click or drag to add</span>${Object.entries(BLOCKS).map(([k, v]) => `<button type="button" draggable="true" data-addblk="${k}" data-help="${esc(v[2])}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${v[1]}</svg>${v[0]}</button>`).join("")}</div>
        <div class="estage ${state.eDev === "phone" ? "phone" : ""}" style="${themeVars(t)}"><div class="email">
          <div class="edrop" data-edrop="0"></div>
          ${blocks.map((b, i) => `<div class="eblock" tabindex="0" data-eblk="${i}" aria-current="${state.eSel === i}" draggable="true"><div class="etools"><button type="button" data-eup="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button><button type="button" data-edown="${i}" ${i === blocks.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button><button type="button" data-edup="${i}" aria-label="Duplicate">⧉</button><button type="button" data-edel="${i}" aria-label="Delete">🗑</button></div>${blockView(b, t, asTags)}</div><div class="edrop" data-edrop="${i + 1}"></div>`).join("") || '<p style="text-align:center;color:#6b7570;padding:30px">Add a block from the left to start.</p>'}
          <div class="efoot">Demo Studio · 1 Tanjong Pagar Road<br>${d.purpose === "marketing" ? "You're getting this because you said yes to news from Demo Studio. <u>Unsubscribe</u>" : "This email is about your account with Demo Studio."}</div>
        </div></div>
        <div class="jpanel" id="emPanel">${emailPanel(d)}</div>
      </div>`;
  }
  function bindEmail() {
    const d = state.eDraft;
    const blocks = d.design.blocks;
    const dirty = () => { state.eDirty = true; };
    const redraw = () => { const y = window.scrollY; const focus = document.activeElement?.id; render(); window.scrollTo(0, y); if (focus && $(`#${focus}`)) { const el = $(`#${focus}`); el.focus(); if (el.setSelectionRange && typeof el.value === "string") el.setSelectionRange(el.value.length, el.value.length); } };
    const leave = () => { state.eOpen = null; state.eDraft = null; if (state.eBack === "journey") { state.mtab = "journeys"; } render(); };
    $("#emBack").onclick = () => {
      if (!state.eDirty) return leave();
      confirmFlags([{ level: "confirm", title: "Leave without saving?", msg: "Your changes to this email haven't been saved." }], { proceedLabel: "Leave without saving", proceed: leave });
    };
    $("#emNameTop").onchange = (e) => { d.name = e.target.value.trim() || d.name; dirty(); redraw(); };
    document.querySelectorAll("[data-dev]").forEach((b) => (b.onclick = () => { state.eDev = b.dataset.dev; redraw(); }));
    document.querySelectorAll("[data-tagv]").forEach((b) => (b.onclick = () => { state.eTags = b.dataset.tagv === "1"; redraw(); }));
    $("#emTest").onclick = () => toast("A test copy is on its way to your inbox, with your own details filled in.");
    $("#emDup").onclick = () => { const copy = { ...clone(d), id: `e${nextEmailId++}`, name: `${d.name} (copy)`.slice(0, 80), updated: "just now" }; EMAILS.unshift(copy); state.eOpen = copy.id; state.eDraft = clone(copy); state.eDirty = false; state.eSel = null; redraw(); toast("Copy made. You're now editing the copy."); };
    $("#emDel").onclick = () => deleteEmail(d.id, leave);
    $("#emSave").onclick = () => {
      const bad = [...JSON.stringify(d.design).matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !MERGE[k]);
      if (!d.design.subject.trim()) { state.eSel = null; redraw(); toast("Add a subject line."); $("#emSubj")?.focus(); return; }
      if (bad.length) { toast(`{{${bad[0]}}} isn't something we can fill in. Use the “+ Personal detail” list.`); return; }
      const e = emailById(d.id); Object.assign(e, clone(d), { updated: "just now" }); state.eDirty = false; redraw(); toast("Email saved.");
    };
    const addAt = (type, i) => { blocks.splice(i, 0, newBlock(type)); state.eSel = i; dirty(); redraw(); };
    document.querySelectorAll("[data-addblk]").forEach((b) => {
      b.onclick = () => addAt(b.dataset.addblk, state.eSel === null ? blocks.length : state.eSel + 1);
      b.ondragstart = (e) => { try { e.dataTransfer.setData("text/plain", `new:${b.dataset.addblk}`); } catch {} state.eDrag = `new:${b.dataset.addblk}`; };
    });
    document.querySelectorAll("[data-eblk]").forEach((el) => {
      el.onclick = (e) => { if (e.target.closest(".etools")) return; state.eSel = Number(el.dataset.eblk); redraw(); };
      el.onkeydown = (e) => { if (e.target === el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); state.eSel = Number(el.dataset.eblk); redraw(); } };
      el.ondragstart = (e) => { state.eDrag = `move:${el.dataset.eblk}`; try { e.dataTransfer.setData("text/plain", state.eDrag); } catch {} };
    });
    document.querySelectorAll("[data-edrop]").forEach((z) => {
      const host = z;
      host.ondragover = (e) => { e.preventDefault(); host.classList.add("over"); };
      host.ondragleave = () => host.classList.remove("over");
      host.ondrop = (e) => {
        e.preventDefault(); host.classList.remove("over");
        const what = state.eDrag; state.eDrag = null; const at = Number(host.dataset.edrop);
        if (!what) return;
        if (what.startsWith("new:")) return addAt(what.slice(4), at);
        const from = Number(what.slice(5)); const [b] = blocks.splice(from, 1); const to = from < at ? at - 1 : at; blocks.splice(to, 0, b); state.eSel = to; dirty(); redraw();
      };
    });
    // Let blocks themselves be drop targets too (drop on the lower half = after).
    document.querySelectorAll("[data-eblk]").forEach((el) => {
      el.ondragover = (e) => { e.preventDefault(); };
      el.ondrop = (e) => { e.preventDefault(); const r = el.getBoundingClientRect(); const at = Number(el.dataset.eblk) + (e.clientY > r.top + r.height / 2 ? 1 : 0); const z = document.querySelector(`[data-edrop="${at}"]`); z?.ondrop?.(e); };
    });
    const tool = (attr, fn) => document.querySelectorAll(`[data-${attr}]`).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); fn(Number(b.dataset[attr])); dirty(); redraw(); }));
    tool("eup", (i) => { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; state.eSel = i - 1; });
    tool("edown", (i) => { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; state.eSel = i + 1; });
    tool("edup", (i) => { blocks.splice(i + 1, 0, clone(blocks[i])); state.eSel = i + 1; });
    tool("edel", (i) => { blocks.splice(i, 1); state.eSel = null; });

    // Settings panel
    const t = d.design.theme;
    const on = (sel, ev, fn) => { const el = $(sel); if (el) el[ev] = fn; };
    on("#emName", "onchange", (e) => { d.name = e.target.value.trim() || d.name; dirty(); redraw(); });
    document.querySelectorAll("input[name=emP]").forEach((r) => (r.onchange = () => { d.purpose = r.value; dirty(); redraw(); }));
    on("#emSubj", "oninput", (e) => { d.design.subject = e.target.value; dirty(); });
    on("#emSubj", "onchange", () => redraw());
    on("#emPre", "oninput", (e) => { d.design.preheader = e.target.value; dirty(); });
    on("#emPre", "onchange", () => redraw());
    document.querySelectorAll("[data-subjtag]").forEach((b) => (b.onclick = () => { d.design.subject = `${d.design.subject}${d.design.subject && !/\s$/.test(d.design.subject) ? " " : ""}{{${b.dataset.subjtag}}}`; dirty(); redraw(); }));
    document.querySelectorAll("[data-themec]").forEach((el) => (el.oninput = () => { t[el.dataset.themec] = el.value; dirty(); const st = $(".estage"); st.setAttribute("style", themeVars(t)); }));
    document.querySelectorAll("[data-themec]").forEach((el) => (el.onchange = () => redraw()));
    on("#emFont", "onchange", (e) => { t.font = e.target.value; dirty(); redraw(); });
    on("#emHFont", "onchange", (e) => { t.headingFont = e.target.value || null; dirty(); redraw(); });
    document.querySelectorAll("[data-themehex]").forEach((el) => (el.onchange = () => {
      let v = el.value.trim();
      if (/^[0-9a-f]{6}$/i.test(v)) v = `#${v}`;
      if (/^#[0-9a-f]{3}$/i.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
      if (!/^#[0-9a-f]{6}$/i.test(v)) { toast("Use a hex code like #0E6B5F."); el.value = t[el.dataset.themehex].toUpperCase(); return; }
      t[el.dataset.themehex] = v.toLowerCase(); dirty(); redraw();
    }));
    on("#emCat", "onchange", (e) => { d.category = e.target.value.trim() || null; dirty(); redraw(); });
    on("#emShape", "onchange", (e) => { t.buttonShape = e.target.value; dirty(); redraw(); });
    on("#bkDone", "onclick", () => { state.eSel = null; redraw(); });
    const b = state.eSel !== null ? blocks[state.eSel] : null;
    if (!b) return;
    const live = (sel, key) => on(sel, "oninput", (e) => { b[key] = e.target.value; dirty(); const host = document.querySelector(`[data-eblk="${state.eSel}"]`); if (host) { const tools = host.querySelector(".etools").outerHTML; host.innerHTML = tools + blockView(b, t, state.eTags !== false); bindEmailTools(); } });
    const bindEmailTools = () => { tool("eup", (i) => { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; state.eSel = i - 1; }); tool("edown", (i) => { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; state.eSel = i + 1; }); tool("edup", (i) => { blocks.splice(i + 1, 0, clone(blocks[i])); state.eSel = i + 1; }); tool("edel", (i) => { blocks.splice(i, 1); state.eSel = null; }); };
    live("#bkText", "text"); live("#bkAlt", "alt"); live("#bkLink", "link"); live("#bkLabel", "label"); live("#bkUrl", "url"); live("#bkBL", "buttonLabel");
    on("#bkUrl", "onchange", (e) => { if (!/^(https?:\/\/|mailto:|\{\{(referral|join)_link\}\}$)/i.test(e.target.value.trim())) toast("Links need to start with https://, http:// or mailto:."); });
    on("#bkLink", "onchange", (e) => { if (e.target.value.trim() && !/^https?:\/\//i.test(e.target.value.trim())) toast("Links need to start with https:// or http://."); });
    const segBtn = (attr, key, conv = (x) => x) => document.querySelectorAll(`[data-${attr}]`).forEach((x) => (x.onclick = () => { b[key] = conv(x.dataset[attr]); dirty(); redraw(); }));
    segBtn("al", "align"); segBtn("lvl", "level", Number); segBtn("iw", "width"); segBtn("bs", "style"); segBtn("socstyle", "style");
    on("#bkH", "oninput", (e) => { b.height = Number(e.target.value); $("#spH").textContent = `${b.height}px`; dirty(); const host = document.querySelector(`[data-eblk="${state.eSel}"] > div:last-child`); if (host) host.style.height = `${b.height}px`; });
    on("#bkPlan", "onchange", (e) => { b.planId = e.target.value; dirty(); redraw(); });
    document.querySelectorAll("[data-soc]").forEach((el) => (el.onchange = () => { const v = el.value.trim(); if (v && !/^https?:\/\//i.test(v)) { toast("Links need to start with https://."); return; } if (v) b.links[el.dataset.soc] = v; else delete b.links[el.dataset.soc]; dirty(); redraw(); }));
    document.querySelectorAll("[data-bimg]").forEach((x) => (x.onclick = () => { b.img = x.dataset.bimg; dirty(); redraw(); }));
    // Formatting buttons wrap the selected text in the textarea.
    const ta = $("#bkText");
    const wrap = (before, after = before, placeholder = "text") => { const s = ta.selectionStart, e = ta.selectionEnd; const sel = ta.value.slice(s, e) || placeholder; b.text = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e); dirty(); redraw(); };
    document.querySelectorAll("[data-fmt]").forEach((x) => (x.onclick = () => (x.dataset.fmt === "b" ? wrap("**") : x.dataset.fmt === "i" ? wrap("*") : wrap("[", "](https://)", "link text"))));
    on("#emTag", "onchange", (e) => { if (!e.target.value) return; const s = ta.selectionStart; b.text = ta.value.slice(0, s) + `{{${e.target.value}}}` + ta.value.slice(s); dirty(); redraw(); });
    // Columns
    document.querySelectorAll("[data-coltype]").forEach((el) => (el.onchange = () => { const ci = Number(el.dataset.coltype); b.columns[ci] = { image: { type: "image", img: "i1", alt: "" }, text: { type: "text", text: "Write something here." }, button: { type: "button", label: "Find out more", url: "https://", style: "filled", align: "left" } }[el.value]; dirty(); redraw(); }));
    document.querySelectorAll("[data-coltext]").forEach((el) => (el.onchange = () => { b.columns[Number(el.dataset.coltext)].text = el.value; dirty(); redraw(); }));
    document.querySelectorAll("[data-collabel]").forEach((el) => (el.onchange = () => { b.columns[Number(el.dataset.collabel)].label = el.value; dirty(); redraw(); }));
    document.querySelectorAll("[data-colurl]").forEach((el) => (el.onchange = () => { b.columns[Number(el.dataset.colurl)].url = el.value; dirty(); redraw(); }));
    [0, 1].forEach((ci) => document.querySelectorAll(`[data-cimg${ci}]`).forEach((x) => (x.onclick = () => { b.columns[ci].img = x.dataset[`cimg${ci}`]; dirty(); redraw(); })));
    // Uploads: checked for type and size, then shown straight away.
    document.querySelectorAll("[data-upl]").forEach((inp) => (inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return toast("Email images need to be JPG, PNG, WebP or GIF.");
      if (f.size > 2 * 1024 * 1024) return toast("That image is too big. The limit is 2 MB.");
      const r = new FileReader();
      r.onload = () => {
        const id = `i${nextImgId++}`; IMAGES[id] = { name: f.name, url: r.result };
        const key = inp.dataset.upl;
        if (key === "bimg") b.img = id; else b.columns[Number(key.slice(4))].img = id;
        dirty(); redraw(); toast("Image added.");
      };
      r.readAsDataURL(f);
    }));
  }

  // --- Gift cards and referrals (studio settings) ---
  const GC = {
    on: true, amounts: [5000, 10000, 20000], customMin: 3000, customMax: 50000, validity: 365, giveWithin: 90,
    designs: [
      { id: "g1", name: "Thank you", bg: "linear-gradient(135deg,#0c6156,#5fc3a8)", on: true },
      { id: "g2", name: "Happy birthday", bg: "linear-gradient(135deg,#be185d,#f9a8d4)", on: true },
      { id: "g3", name: "Season's greetings", bg: "linear-gradient(135deg,#7f1d1d,#15803d)", on: true },
      { id: "g4", name: "Just because", bg: "linear-gradient(135deg,#1d4ed8,#93c5fd)", on: false },
    ],
  };
  const CARDS = [
    { id: "gc1", code: "GIFT-7K2P-9QXM", amount: 10000, design: "g2", buyer: 0, to: null, status: "unsent", daysLeft: 74 },
    { id: "gc2", code: "GIFT-H4WD-2MRT", amount: 5000, design: "g1", buyer: 10, to: 0, status: "given", from: "Mei Ling", message: "Thanks for being the best gym buddy!", when: "20 Oct" },
    { id: "gc3", code: "GIFT-Q8NB-6TZC", amount: 5000, design: "g3", buyer: 0, to: 2, status: "given", from: "Chloe", message: "Merry Christmas, Sarah!", when: "2 Jan" },
    { id: "gc4", code: "GIFT-RC3F-8JHA", amount: 10000, design: "g1", buyer: 5, to: 4, status: "given", from: "James", when: "1 Nov" },
  ];
  let nextCardId = 5;
  const REF = { on: true, qualify: "classes_attended", value: 3, within: 60, referrer: { type: "credit", amountCents: 3000, validDays: 90 }, referee: { type: "discount", percent: 15, validDays: 30 }, window: 7, cap: null };
  const REFERRALS = [
    { by: 0, friend: 16, status: "rewarded", when: "12 Oct" },
    { by: 0, friend: 15, status: "pending", when: "9 Nov", progress: 1 },
    { by: 10, friend: 19, status: "pending", when: "28 Oct", progress: 2 },
    { by: 2, friend: 13, status: "expired", when: "14 Jul" },
  ];
  const refGoal = () => (REF.qualify === "classes_attended" ? `attends ${plural(REF.value, "class", "classes")}` : REF.qualify === "spend" ? `spends ${m$c(REF.value * 100)}` : "buys their first package");
  const refRules = () => [
    "Share your link or code with a friend who's new to Demo Studio.",
    `They add your code when they sign up${REF.window ? ` (or within ${REF.window} days, before their first purchase)` : ""}.`,
    ...(REF.referee ? [`They get ${rewardText(REF.referee)} as a welcome gift.`] : []),
    `When your friend ${refGoal()} within ${REF.within} days of joining, you get ${rewardText(REF.referrer)}.`,
    ...(REF.cap ? [`You can earn up to ${plural(REF.cap, "reward")} a month.`] : []),
  ];
  const codeOf = (i) => { const h = hash(CLIENTS[i].name), A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; return `${CLIENTS[i].name.split(" ")[0].toUpperCase().replace(/[^A-Z]/g, "")}-${[0, 5, 10, 15].map((k) => A[(h >>> k) % A.length]).join("")}`; };
  const gcardHTML = (c, opts = {}) => { const d = GC.designs.find((x) => x.id === c.design) || GC.designs[0]; return `<div class="gcard" style="--g:${d.img ? `url('${d.img}')` : d.bg}"><span class="gst">Demo Studio · ${esc(d.name)}</span><span class="gamt">${m$c(c.amount)}</span><span class="gcode">${opts.code === false ? "Gift card" : esc(c.code)}</span></div>`; };

  // --- Marketing page ---
  const MTABS = [["journeys", "Journeys"], ["emails", "Emails"], ["campaigns", "Campaigns"], ["segments", "Segments"], ["banners", "Banners"], ["loyalty", "Loyalty"], ["ads", "Ads"], ["referrals", "Referrals"]];
  PAGES.marketing = function () {
    if (state.eOpen && state.eDraft) return emailBuilder();
    const j = state.jOpen && JOURNEYS.find((x) => x.id === state.jOpen);
    if (j) {
      const sel = state.jSel;
      const s = sel && sel !== "trigger" ? (() => { const p = findStep(j.def.steps, sel); return p ? stepAtP(j.def.steps, p) : null; })() : null;
      return `<div class="jhead"><div class="row" style="gap:6px;min-width:0;flex:1"><button type="button" class="btn ghost" id="jBack">← Journeys</button><input class="nm" id="jName" value="${esc(j.name)}" aria-label="Journey name"><span class="status ${j.status}">${{ live: "Live", draft: "Draft", paused: "Paused" }[j.status]}</span></div>
        <div class="row">${j.status === "live" ? `<button type="button" class="btn" id="jTry" data-help="Add a client by hand, e.g. yourself to test it.">Add someone</button><button type="button" class="btn" id="jPause" data-help="Stop new people starting; everyone part-way through waits where they are.">Pause</button>` : `<button type="button" class="btn primary" id="jLive">${j.status === "paused" ? "Resume" : "Go live"}</button>`}<button type="button" class="btn" id="jDupJ" data-help="Copy this journey as a new draft.">Duplicate</button><button type="button" class="btn ghost danger" id="jDelJ">Delete</button></div></div>
        ${j.status === "live" ? `<div class="resultline"><span><b class="big">${j.stats.started}</b> started</span><span><b>${j.stats.inProgress}</b> in progress</span><span><b>${j.stats.finished}</b> finished</span>${j.def.goal ? `<span><b>${j.stats.converted || 0}</b> reached the goal (${j.stats.started ? Math.round(((j.stats.converted || 0) / j.stats.started) * 100) : 0}%)</span>` : ""}<span class="muted">Live since ${esc(j.since)}${j.version > 1 ? ` · version ${j.version}` : ""}</span></div>` : ""}
        <div class="jlayout">${journeyCanvas(j)}${isNarrow() ? "" : `<div class="jpanel side" id="jPanel">${sel === "trigger" ? triggerForm(j) : s ? stepForm(j, s) : overviewPanel(j)}</div>`}</div>
        ${isNarrow() ? `<button type="button" class="btn" id="jHow" style="align-self:flex-start">What this journey does</button>` : ""}`;
    }
    const tab = state.mtab || "journeys";
    const tabs = `<div class="tabs" role="tablist">${MTABS.map(([k, l]) => `<button type="button" role="tab" data-mtab="${k}" aria-selected="${tab === k}">${l}${k === "journeys" ? `<span class="n">${JOURNEYS.filter((x) => x.status === "live").length} live</span>` : ""}</button>`).join("")}</div>`;
    let body = "";
    if (tab === "journeys") {
      const jc = state.jcat || "";
      const shownJ = JOURNEYS.filter((x) => !jc || x.category === jc);
      body = catChips(journeyCats(true), jc, "jcat", JOURNEYS.length, (c) => JOURNEYS.filter((x) => x.category === c).length) + `<div class="mgrid">${shownJ.map((x) => `<button type="button" class="mcard" data-jopen="${x.id}"><div class="top"><b>${esc(x.name)}</b><span class="status ${x.status}">${{ live: "Live", draft: "Draft", paused: "Paused" }[x.status]}</span>${x.category ? `<span class="tag">${esc(x.category)}</span>` : ""}</div><span class="muted" style="font-size:13px">${esc(triggerText(x.def.trigger))}</span><span style="font-size:13px">${esc(x.desc || "")}</span>${x.status !== "draft" ? `<div class="nums"><span><b>${x.stats.started}</b> started</span><span><b>${x.stats.inProgress}</b> in progress</span><span><b>${x.stats.finished}</b> finished</span></div>` : '<div class="nums"><span>Not live yet</span></div>'}</button>`).join("")}</div>
        <h3 style="margin:8px 0 0;font-size:15px">Start from a ready-made journey</h3><div class="mgrid">${RECIPES.map((r, i) => `<button type="button" class="mcard recipe" data-recipe="${i}"><b>${esc(r.name)}</b><span class="muted" style="font-size:13px">${esc(r.desc)}</span></button>`).join("")}<button type="button" class="mcard recipe" data-recipe="blank"><b>Start from scratch</b><span class="muted" style="font-size:13px">Choose how it starts, then add steps.</span></button></div>`;
    }
    const ec = state.ecat || "";
    if (tab === "emails") body = catChips(emailCats(true), ec, "ecat", EMAILS.length, (c) => EMAILS.filter((x) => x.category === c).length) + `<div class="mgrid">${EMAILS.filter((e) => !ec || e.category === ec).map((e) => `<button type="button" class="mcard" data-eopen="${e.id}"><div class="top"><b>${esc(e.name)}</b><span class="status ${e.purpose === "marketing" ? "wait" : "off"}">${e.purpose === "marketing" ? "Marketing" : "Service"}</span>${e.category ? `<span class="tag">${esc(e.category)}</span>` : ""}</div><div class="inbox"><b>${richText(e.design.subject || "No subject", false)}</b><span>${esc(e.design.preheader)}</span></div><span class="muted" style="font-size:12.5px">Edited ${esc(e.updated)}${(() => { const used = JOURNEYS.filter((x) => [...walk(x.def.steps)].some((s) => s.emailId === e.id)); return used.length ? ` · Used in ${used.map((x) => `“${x.name}”`).join(", ")}` : ""; })()}</span></button>`).join("")}</div>`;
    if (tab === "campaigns") body = `<div class="tblwrap"><table class="tbl"><thead><tr><th>Campaign</th><th>Email</th><th>Audience</th><th>When</th><th>Status</th><th class="num">Sent</th><th class="num">Skipped</th><th></th></tr></thead><tbody>${CAMPAIGNS.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(emailById(c.emailId)?.name || c.emailName || "(deleted email)")}</td><td>${esc(c.segId ? SEGMENTS.find((s) => s.id === c.segId)?.name : "Everyone")}</td><td style="white-space:nowrap">${esc(c.when)}</td><td><span class="status ${c.status === "sent" ? "done" : c.status === "draft" ? "draft" : "wait"}">${c.status === "sent" ? "Sent" : c.status === "draft" ? "Draft" : "Scheduled"}</span></td><td class="num">${c.status === "sent" ? c.recipients : "–"}</td><td class="num">${c.status === "sent" ? c.skipped : "–"}</td><td><span class="inline2" style="flex-wrap:nowrap">${c.status === "draft" ? `<button type="button" class="tagbtn" data-eopen="${c.emailId}">Open email</button><button type="button" class="tagbtn" data-csend="${c.id}">Send…</button>` : ""}<button type="button" class="tagbtn" data-cdup="${c.id}" data-help="A new draft with the same email and audience.">Duplicate</button><button type="button" class="tagbtn" data-cdel="${c.id}">Delete</button></span></td></tr>`).join("") || '<tr><td colspan="8" class="muted">No campaigns yet.</td></tr>'}</tbody></table></div><span class="hint">Skipped = people in the audience who haven't agreed to marketing emails.</span>`;
    if (tab === "segments") body = `<div class="mgrid">${SEGMENTS.map((s) => { const n = matchSet(s.def).length; return `<div class="mcard"><div class="top"><b>${esc(s.name)}</b><span class="grow"></span><b style="font-family:var(--display);font-size:20px">${n}</b></div><span class="muted" style="font-size:13px">${esc(s.desc || "")}</span><ul class="terms">${s.def.rules.map((r) => `<li>${esc(describeRule(r))}</li>`).join("")}</ul><div class="inline2"><button type="button" class="btn" data-segview="${s.id}">See clients</button><button type="button" class="btn" data-segmail="${s.id}">Email them</button><button type="button" class="btn ghost" data-segj="${s.id}" data-help="Start a journey whenever someone joins this segment.">Journey…</button><button type="button" class="btn ghost danger" data-segdel="${s.id}">Delete</button></div></div>`; }).join("") || '<div class="card"><span class="muted">No segments yet.</span></div>'}</div><span class="hint">Make a new segment from the Clients page: add filters, then “Save as segment”. Segments are always up to date.</span>`;
    if (tab === "banners") body = bannerAdmin();
    if (tab === "loyalty") body = loyaltyAdmin();
    if (tab === "ads") body = adsAdmin();
    if (tab === "giftcards") body = giftAdmin();
    if (tab === "referrals") body = referralAdmin();
    const act = { journeys: `<button type="button" class="btn primary" data-recipe="blank">New journey</button>`, emails: `<button type="button" class="btn primary" id="mNewEmail">New email</button>`, campaigns: `<button type="button" class="btn primary" id="mNewCamp">New campaign</button>`, segments: `<button type="button" class="btn primary" data-goclients>New segment</button>`, banners: `<button type="button" class="btn primary" id="mNewBanner">New banner</button>`, ads: `<button type="button" class="btn primary" id="adsAddLead">+ Add lead</button>` }[tab] || "";
    return head("Marketing", "Reach the right clients at the right time: journeys run by themselves, campaigns go out once.", act) + tabs + body;
  };
  function giftAdmin() {
    const sold = CARDS;
    return `<div class="card"><div class="row" style="justify-content:space-between"><h3>Gift cards</h3>${toggle("gcOn", GC.on, "Sell gift cards")}</div>
        <span class="hint">Gift cards are studio credit for anything in your online store. Clients buy them in the Shop, and can give one now (to someone with an account) or later.</span>
        <div class="mform" style="max-width:640px">
          <div class="fl">Amounts on offer<div class="amts">${GC.amounts.map((a) => `<button type="button" data-gcamt="${a}" aria-pressed="true">${m$c(a)} ×</button>`).join("")}<input type="number" id="gcAdd" min="1" placeholder="Add amount" style="width:120px"></div></div>
          <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Custom amount from (${STUDIO.currency})<input type="number" id="gcMin" min="1" value="${GC.customMin / 100}"></label><label class="fl">up to (${STUDIO.currency})<input type="number" id="gcMax" min="1" value="${GC.customMax / 100}"></label></div>
          <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Valid for (days, from when it's given)<input type="number" id="gcVal" min="30" value="${GC.validity}"></label><label class="fl">Time to give it (days)<input type="number" id="gcGive" min="1" value="${GC.giveWithin}"><span class="h">After this, an unsent card becomes the buyer's own credit.</span></label></div>
        </div></div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3>Designs</h3><label class="btn" style="cursor:pointer">+ Add design<input type="file" accept="image/jpeg,image/png,image/webp" id="gcNewImg" hidden></label></div>
        <div class="gpick">${GC.designs.map((d) => `<div class="stack" style="gap:6px"><div class="gcard" style="--g:${d.img ? `url('${d.img}')` : d.bg};opacity:${d.on ? 1 : 0.45}"><span class="gst">Demo Studio · ${esc(d.name)}</span><span class="gamt">${m$c(10000)}</span><span class="gcode">GIFT-XXXX-XXXX</span></div><div class="row" style="justify-content:space-between"><b style="font-size:13px">${esc(d.name)}</b><span class="inline2"><label class="tagbtn" style="cursor:pointer">Change photo<input type="file" accept="image/jpeg,image/png,image/webp" data-gcimg="${d.id}" hidden></label><button type="button" class="tagbtn" data-gchide="${d.id}">${d.on ? "Hide" : "Show"}</button></span></div></div>`).join("")}</div>
        <span class="hint">Photos: JPG, PNG or WebP, up to 2 MB. Cards already bought keep the design they had.</span></div>
      <div class="card"><h3>Sold</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Card</th><th class="num">Amount</th><th>Bought by</th><th>For</th><th>Status</th></tr></thead><tbody>${sold.map((c) => `<tr><td style="font-variant-numeric:tabular-nums">${esc(c.code)}</td><td class="num">${m$c(c.amount)}</td><td>${esc(CLIENTS[c.buyer].name)}</td><td>${c.to !== null ? esc(CLIENTS[c.to].name) : '<span class="muted">Not given yet</span>'}</td><td><span class="status ${c.status === "given" ? "done" : c.status === "kept" ? "off" : "wait"}">${{ unsent: "Ready to give", given: "Given", kept: "Kept as credit", pending: "Waiting for payment" }[c.status]}</span></td></tr>`).join("")}</tbody></table></div></div>`;
  }
  function referralAdmin() {
    return `<div class="card"><div class="row" style="justify-content:space-between"><h3>Referrals</h3>${toggle("rfOn", REF.on, "Run referrals")}</div>
      <div class="mform" style="max-width:640px">
        <div class="fl">A friend qualifies when they…<div class="seg" role="group">${[["classes_attended", "Attend classes"], ["spend", "Spend an amount"], ["package_bought", "Buy a package"]].map(([k, l]) => `<button type="button" data-rfq="${k}" aria-pressed="${REF.qualify === k}">${l}</button>`).join("")}</div></div>
        <div class="two" style="grid-template-columns:1fr 1fr">${REF.qualify !== "package_bought" ? `<label class="fl">${REF.qualify === "spend" ? `Amount (${STUDIO.currency})` : "Classes"}<input type="number" id="rfV" min="1" value="${REF.value}"></label>` : "<span></span>"}<label class="fl">Within (days of joining)<input type="number" id="rfW" min="7" value="${REF.within}"></label></div>
        <div class="fl">The referrer gets</div>${rewardForm(REF.referrer, "rr")}
        <label class="check"><input type="checkbox" id="rfWel" ${REF.referee ? "checked" : ""}> Give the new member a welcome gift too</label>
        ${REF.referee ? rewardForm(REF.referee, "re") : ""}
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Days to add a code after joining<input type="number" id="rfWin" min="0" max="60" value="${REF.window}"><span class="h">Also only before their first purchase.</span></label><label class="fl">Most rewards a month <span class="h">(blank = no limit)</span><input type="number" id="rfCap" min="1" value="${REF.cap ?? ""}"></label></div>
      </div></div>
      <div class="card"><h3>How clients see it</h3><ol class="terms" style="color:var(--fg)">${refRules().map((r) => `<li>${esc(r)}</li>`).join("")}</ol><span class="hint">Self-referrals (same account, email or phone) are refused. Staff can add a code a client forgot from their profile.</span></div>
      <div class="card"><h3>Referrals so far</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Referred by</th><th>Friend</th><th>Joined</th><th>Status</th></tr></thead><tbody>${REFERRALS.map((r) => `<tr><td>${esc(CLIENTS[r.by].name)}</td><td>${esc(CLIENTS[r.friend].name)}</td><td>${esc(r.when)}</td><td><span class="status ${r.status === "rewarded" ? "done" : r.status === "pending" ? "wait" : "off"}">${{ rewarded: "Rewarded", pending: REF.qualify === "classes_attended" ? `${r.progress ?? 0} of ${REF.value} classes` : "Not qualified yet", expired: "Didn't qualify in time" }[r.status]}</span></td></tr>`).join("")}</tbody></table></div></div>`;
  }
  const readImage = (inp, done) => { const f = inp.files[0]; if (!f) return; if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return toast("Photos need to be JPG, PNG or WebP."); if (f.size > 2 * 1024 * 1024) return toast("That photo is too big. The limit is 2 MB."); const r = new FileReader(); r.onload = () => done(r.result, f.name); r.readAsDataURL(f); };
  BIND.marketing = function () {
    if (state.eOpen && state.eDraft) return bindEmail();
    const j = state.jOpen && JOURNEYS.find((x) => x.id === state.jOpen);
    if (j) return bindJourney(j);
    document.querySelectorAll("[data-mtab]").forEach((b) => (b.onclick = () => { state.mtab = b.dataset.mtab; render(); }));
    document.querySelectorAll("[data-jopen]").forEach((b) => (b.onclick = () => { state.jOpen = b.dataset.jopen; state.jSel = null; render(); window.scrollTo(0, 0); }));
    document.querySelectorAll("[data-recipe]").forEach((b) => (b.onclick = () => {
      const r = b.dataset.recipe === "blank" ? null : RECIPES[Number(b.dataset.recipe)];
      const def = r ? r.def() : { trigger: { type: "account_created" }, steps: [] };
      freshIds(def.steps);
      const j2 = { id: `j${nextJId++}`, name: r ? r.name : "New journey", desc: r ? r.desc : "", status: "draft", reentry: "once", quiet: true, version: 1, def, stats: { started: 0, inProgress: 0, finished: 0, steps: {}, waitingAt: {} } };
      JOURNEYS.push(j2); state.jOpen = j2.id; state.jSel = r ? null : "trigger"; render(); window.scrollTo(0, 0);
      toast(r ? "Ready-made journey added as a draft. Check the emails, then go live." : "Choose how it starts, then add steps with +.");
    }));
    document.querySelectorAll("[data-eopen]").forEach((b) => (b.onclick = () => openEmail(b.dataset.eopen)));
    if ($("#mNewEmail")) $("#mNewEmail").onclick = () => openEmail(newEmail().id);
    if ($("#mNewCamp")) $("#mNewCamp").onclick = () => openCampaign();
    document.querySelectorAll("[data-goclients]").forEach((b) => (b.onclick = () => { state.cfOpen = true; state.cf = { match: "all", rules: [newRule()] }; state.cfSeg = null; go("clients"); }));
    document.querySelectorAll("[data-segview]").forEach((b) => (b.onclick = () => { const s = SEGMENTS.find((x) => x.id === b.dataset.segview); state.cf = clone(s.def); state.cfSeg = s.id; state.cfOpen = false; go("clients"); }));
    document.querySelectorAll("[data-segmail]").forEach((b) => (b.onclick = () => openCampaign({ segId: b.dataset.segmail })));
    bindMarketingExtras();
    bindLoyaltyAdmin();
    bindAdsAdmin();
    document.querySelectorAll("[data-segj]").forEach((b) => (b.onclick = () => { const id = b.dataset.segj; const j2 = { id: `j${nextJId++}`, name: `When someone joins “${SEGMENTS.find((s) => s.id === id).name}”`, desc: "", status: "draft", reentry: "every_time", quiet: true, version: 1, def: { trigger: { type: "joins_segment", segmentId: id }, steps: [] }, stats: { started: 0, inProgress: 0, finished: 0, steps: {}, waitingAt: {} } }; JOURNEYS.push(j2); state.mtab = "journeys"; state.jOpen = j2.id; state.jSel = null; render(); }));
    bindGiftAdmin();
  };
  /** Gift card settings (on the Shop page) and referral settings (Marketing). */
  function bindGiftAdmin() {
    if ($("#gcOn")) {
      $("#gcOn").onchange = (e) => { GC.on = e.target.checked; toast(GC.on ? "Gift cards are on sale." : "Gift cards are off. Cards already bought still work."); };
      document.querySelectorAll("[data-gcamt]").forEach((b) => (b.onclick = () => { GC.amounts = GC.amounts.filter((a) => a !== Number(b.dataset.gcamt)); render(); }));
      $("#gcAdd").onchange = (e) => { const v = Math.round(Number(e.target.value) * 100); if (v >= 100 && !GC.amounts.includes(v)) { GC.amounts.push(v); GC.amounts.sort((a, b) => a - b); } render(); };
      $("#gcMin").onchange = (e) => (GC.customMin = Math.round(Number(e.target.value) * 100));
      $("#gcMax").onchange = (e) => (GC.customMax = Math.round(Number(e.target.value) * 100));
      $("#gcVal").onchange = (e) => (GC.validity = Math.max(30, Number(e.target.value) || 365));
      $("#gcGive").onchange = (e) => (GC.giveWithin = Math.max(1, Number(e.target.value) || 90));
      document.querySelectorAll("[data-gchide]").forEach((b) => (b.onclick = () => { const d = GC.designs.find((x) => x.id === b.dataset.gchide); if (d.on && GC.designs.filter((x) => x.on).length === 1) return toast("Keep at least one design showing while gift cards are on sale."); d.on = !d.on; render(); }));
      document.querySelectorAll("[data-gcimg]").forEach((inp) => (inp.onchange = () => readImage(inp, (url) => { GC.designs.find((x) => x.id === inp.dataset.gcimg).img = url; render(); toast("Photo changed."); })));
      $("#gcNewImg").onchange = (e) => readImage(e.target, (url, name) => { GC.designs.push({ id: `g${GC.designs.length + 1}`, name: name.replace(/\.[^.]+$/, "").slice(0, 40) || "New design", img: url, on: true }); render(); toast("Design added."); });
    }
    if ($("#rfOn")) {
      $("#rfOn").onchange = (e) => { REF.on = e.target.checked; toast(REF.on ? "Referrals are on. Clients see their link under “Refer a friend”." : "Referrals are off."); };
      document.querySelectorAll("[data-rfq]").forEach((b) => (b.onclick = () => { REF.qualify = b.dataset.rfq; REF.value = REF.qualify === "spend" ? 200 : 3; render(); }));
      if ($("#rfV")) $("#rfV").onchange = (e) => { REF.value = Math.max(1, Number(e.target.value) || 1); render(); };
      $("#rfW").onchange = (e) => { REF.within = Math.max(7, Number(e.target.value) || 60); render(); };
      $("#rfWin").onchange = (e) => { REF.window = Math.min(60, Math.max(0, Number(e.target.value) || 0)); render(); };
      $("#rfCap").onchange = (e) => { REF.cap = Number(e.target.value) || null; render(); };
      $("#rfWel").onchange = (e) => { REF.referee = e.target.checked ? { type: "discount", percent: 15, validDays: 30 } : null; render(); };
      for (const [pre, key] of [["rr", "referrer"], ["re", "referee"]]) {
        document.querySelectorAll(`[data-${pre}rt]`).forEach((b) => (b.onclick = () => { REF[key] = { ...newRewardOf(b.dataset[`${pre}rt`]), validDays: REF[key].validDays }; render(); }));
        ["Amt", "Cls", "Kind", "Off", "Days"].forEach((id) => { if ($(`#${pre}${id}`)) $(`#${pre}${id}`).onchange = () => { REF[key] = readReward(pre, REF[key]); render(); }; });
      }
    }
  };

  // --- Client: gift cards ---
  PAGES["gift-cards"] = function () {
    const me = ME.client;
    const tab = state.gtab || "buy";
    const toGive = CARDS.filter((c) => c.buyer === me && c.status === "unsent");
    const received = CARDS.filter((c) => c.to === me && c.buyer !== me);
    const given = CARDS.filter((c) => c.buyer === me && c.status === "given" && c.to !== me);
    const credit = GIFT_CREDIT[me] || 0;
    const tabs = `<div class="tabs" role="tablist">${[["buy", "Buy a gift card"], ["give", "To give", toGive.length], ["received", "Received", received.length], ["given", "Given", given.length]].map(([k, l, n]) => `<button type="button" role="tab" data-gtab="${k}" aria-selected="${tab === k}">${l}${n ? `<span class="n">${n}</span>` : ""}</button>`).join("")}</div>`;
    const credLine = `<div class="card"><div class="creditbar"><span class="muted">Your studio credit</span><span class="big">${m$c(credit)}</span>${credit ? '<span class="hint">Gift cards you receive go straight into your credit; there\'s no code to enter. It\'s used automatically at checkout.</span>' : '<span class="hint">Gift cards you receive and rewards you earn are added here automatically.</span>'}</div></div>`;
    if (!GC.on) return head("Gift cards", "") + credLine + alertBox("info", "", "The studio isn't selling gift cards right now.");
    let body = "";
    if (tab === "buy") {
      const g = state.gbuy || (state.gbuy = { design: GC.designs.find((d) => d.on).id, amount: GC.amounts[1] ?? GC.amounts[0], how: "later", to: "", from: CLIENTS[me].name.split(" ")[0], msg: "" });
      body = `<div class="card"><h3>1. Choose a design</h3><div class="gpick">${GC.designs.filter((d) => d.on).map((d) => `<button type="button" data-gd="${d.id}" aria-pressed="${g.design === d.id}" aria-label="${esc(d.name)}">${gcardHTML({ design: d.id, amount: g.amount, code: "" }, { code: false })}</button>`).join("")}</div></div>
        <div class="card"><h3>2. Choose an amount</h3><div class="amts">${GC.amounts.map((a) => `<button type="button" data-ga="${a}" aria-pressed="${g.amount === a}">${m$c(a)}</button>`).join("")}${GC.customMin ? `<input type="number" id="gaCustom" min="${GC.customMin / 100}" max="${GC.customMax / 100}" placeholder="Other (${GC.customMin / 100}–${GC.customMax / 100})" style="width:170px;height:40px;border:1px solid var(--line);border-radius:10px;padding:0 10px;background:var(--surface);color:var(--fg)" value="${GC.amounts.includes(g.amount) ? "" : g.amount / 100}">` : ""}</div></div>
        <div class="card mform"><h3>3. Give it now or later?</h3>
          <label class="opt"><input type="radio" name="gHow" value="now" ${g.how === "now" ? "checked" : ""}><div><b>Give it now</b><br><span class="h">Enter their email or phone number. They need an account with us; it arrives as soon as you've paid, valid for ${GC.validity} days.</span></div></label>
          ${g.how === "now" ? `<div class="stack" style="padding-left:26px"><label class="fl">Their email or phone<input id="gTo" value="${esc(g.to)}" placeholder="e.g. sarah@example.com or 9123 4567" autocomplete="off"></label><label class="fl">From<input id="gFrom" maxlength="60" value="${esc(g.from)}"></label><label class="fl">Message <span class="h">(optional)</span><textarea id="gMsg" rows="2" maxlength="300" placeholder="Happy birthday!">${esc(g.msg)}</textarea></label>${state.gNotFound ? alertBox("warn", "We couldn't find them", `There's no account at Demo Studio with that ${g.to.includes("@") ? "email address" : "phone number"}. You can buy it now and give it from <b>To give</b> once they've joined. <button type="button" class="btn" id="gLater" style="margin-top:6px">Buy now, give later</button>`) : ""}</div>` : ""}
          <label class="opt"><input type="radio" name="gHow" value="later" ${g.how === "later" ? "checked" : ""}><div><b>Give it later</b><br><span class="h">It waits under “To give” for up to ${GC.giveWithin} days. Send it whenever you're ready; if you don't, it becomes your own credit.</span></div></label></div>
        <div class="card"><div class="row" style="justify-content:space-between"><span><b>Total</b> <span class="muted">· pay at the front desk</span></span><b style="font-family:var(--display);font-size:22px">${m$c(g.amount)}</b></div><button type="button" class="btn primary" id="gBuy" style="justify-content:center">Place order</button><span class="hint">Gift cards can't be bought with studio credit.</span></div>`;
    }
    if (tab === "give") body = toGive.length ? `<div class="mgrid">${toGive.map((c) => `<div class="mcard">${gcardHTML(c)}<span class="hint">Give by ${esc(fmtDay(new Date(NOW.getTime() + c.daysLeft * 864e5)))} (${c.daysLeft} days left), or it becomes your own credit.</span><div class="inline2"><button type="button" class="btn primary" data-ggive="${c.id}">Give it</button><button type="button" class="btn" data-gkeep="${c.id}">Keep it for myself</button></div></div>`).join("")}</div>` : `<div class="card"><span class="muted">Nothing waiting to be given.</span></div>`;
    if (tab === "received") body = received.length ? `<div class="mgrid">${received.map((c) => `<div class="mcard">${gcardHTML(c)}<b>From ${esc(c.from)}</b>${c.message ? `<span style="font-size:13px">“${esc(c.message)}”</span>` : ""}<span class="hint">Added to your studio credit on ${esc(c.when)}.</span></div>`).join("")}</div>` : `<div class="card"><span class="muted">No gift cards yet.</span></div>`;
    if (tab === "given") body = given.length ? `<div class="mgrid">${given.map((c) => `<div class="mcard">${gcardHTML(c)}<b>To ${esc(CLIENTS[c.to].name.split(" ")[0])} ${esc(CLIENTS[c.to].name.split(" ")[1][0])}.</b>${c.message ? `<span style="font-size:13px">“${esc(c.message)}”</span>` : ""}<span class="hint">Given on ${esc(c.when)}.</span></div>`).join("")}</div>` : `<div class="card"><span class="muted">You haven't given any yet.</span></div>`;
    return head("Gift cards", "Give classes at Demo Studio to someone special, or keep track of cards you've received.") + credLine + tabs + body;
  };
  const findByContact = (to) => { const t = to.trim().toLowerCase(); const digits = t.replace(/\D/g, ""); return CLIENTS.findIndex((c) => (t.includes("@") ? c.email === t : digits.length >= 8 && c.phone.replace(/\D/g, "").slice(-8) === digits.slice(-8))); };
  BIND["gift-cards"] = function () {
    const me = ME.client;
    document.querySelectorAll("[data-gtab]").forEach((b) => (b.onclick = () => { state.gtab = b.dataset.gtab; state.gNotFound = false; render(); }));
    const g = state.gbuy;
    document.querySelectorAll("[data-gd]").forEach((b) => (b.onclick = () => { g.design = b.dataset.gd; render(); }));
    document.querySelectorAll("[data-ga]").forEach((b) => (b.onclick = () => { g.amount = Number(b.dataset.ga); render(); }));
    if ($("#gaCustom")) $("#gaCustom").onchange = (e) => { const v = Math.round(Number(e.target.value) * 100); if (v < GC.customMin || v > GC.customMax) return toast(`Choose an amount from ${m$c(GC.customMin)} to ${m$c(GC.customMax)}.`); g.amount = v; render(); };
    document.querySelectorAll("input[name=gHow]").forEach((r) => (r.onchange = () => { g.how = r.value; state.gNotFound = false; render(); }));
    if ($("#gTo")) { $("#gTo").oninput = (e) => (g.to = e.target.value); $("#gFrom").oninput = (e) => (g.from = e.target.value); $("#gMsg").oninput = (e) => (g.msg = e.target.value); }
    const place = (how) => {
      const card = { id: `gc${nextCardId++}`, code: `GIFT-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`.replace(/[01IO]/g, "7"), amount: g.amount, design: g.design, buyer: me };
      if (how === "now") {
        const to = findByContact(g.to);
        if (!g.to.trim()) return toast("Enter their email address or phone number.");
        if (to < 0) { state.gNotFound = true; render(); return; }
        if (to === me) return toast("That's you! Choose “Give it later”, then “Keep it for myself”.");
        CARDS.push({ ...card, to, status: "given", from: g.from || CLIENTS[me].name.split(" ")[0], message: g.msg, when: "today" });
        state.gtab = "given"; state.gbuy = null; render();
        toast(`Order placed. Once you've paid at the desk, ${CLIENTS[to].name.split(" ")[0]} gets it straight away. (Shown as paid in this preview.)`);
      } else {
        CARDS.push({ ...card, to: null, status: "unsent", daysLeft: GC.giveWithin });
        state.gtab = "give"; state.gbuy = null; state.gNotFound = false; render();
        toast("Order placed. Once you've paid at the desk it's ready to give here. (Shown as paid in this preview.)");
      }
    };
    if ($("#gBuy")) $("#gBuy").onclick = () => place(g.how);
    if ($("#gLater")) $("#gLater").onclick = () => place("later");
    document.querySelectorAll("[data-gkeep]").forEach((b) => (b.onclick = () => {
      const c = CARDS.find((x) => x.id === b.dataset.gkeep);
      confirmFlags([{ level: "confirm", title: "Keep it for yourself?", msg: `${m$c(c.amount)} is added to your studio credit, valid for ${GC.validity} days. You won't be able to give it after this.` }], { proceedLabel: "Keep it", proceed: () => { c.status = "kept"; GIFT_CREDIT[me] = (GIFT_CREDIT[me] || 0) + c.amount; render(); toast(`${m$c(c.amount)} added to your credit.`); } });
    }));
    document.querySelectorAll("[data-ggive]").forEach((b) => (b.onclick = () => {
      const c = CARDS.find((x) => x.id === b.dataset.ggive);
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="ggForm" role="dialog" aria-modal="true" aria-labelledby="ggTitle"><header><h2 id="ggTitle">Give your ${m$c(c.amount)} gift card</h2></header><div class="mb mform">${gcardHTML(c)}
        <label class="fl">Their email or phone<input id="ggTo" placeholder="e.g. 9123 4567" autocomplete="off"></label><label class="fl">From<input id="ggFrom" value="${esc(CLIENTS[me].name.split(" ")[0])}" maxlength="60"></label><label class="fl">Message <span class="h">(optional)</span><textarea id="ggMsg" rows="2" maxlength="300"></textarea></label><div id="ggErr"></div>
        <span class="hint">It's valid for ${GC.validity} days from today.</span></div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">Give it</button></footer></form></div>`;
      $("#ggForm").onsubmit = (e) => {
        e.preventDefault();
        const to = findByContact($("#ggTo").value);
        if (to < 0 || to === me) { $("#ggErr").innerHTML = alertBox("warn", "", to === me ? "That's you! Use “Keep it for myself” instead." : "We couldn't find an account at Demo Studio with that. Ask them to join first, then try again."); return; }
        Object.assign(c, { to, status: "given", from: $("#ggFrom").value.trim() || "A friend", message: $("#ggMsg").value.trim(), when: "today" });
        closeModal(); state.gtab = "given"; render(); toast(`Sent! ${CLIENTS[to].name.split(" ")[0]} has been told by email and push.`);
      };
      setTimeout(() => $("#ggTo")?.focus(), 0);
    }));
  };

  // --- Client: refer a friend ---
  PAGES.refer = function () {
    const me = ME.client;
    if (!REF.on) return head("Refer a friend", "") + alertBox("info", "", "The studio isn't running referrals right now.");
    const code = codeOf(me);
    const link = `https://app.demostudio.example/join?ref=${code}`;
    const mine = REFERRALS.filter((r) => r.by === me);
    const isNew = state.clientSource === "new";
    const myRef = REFERRALS.find((r) => r.friend === me);
    return head("Refer a friend", "Bring a friend to Demo Studio and you both get something.") +
      `<div class="card"><span class="muted">Your code</span><span class="bigcode">${esc(code)}</span>
        <div class="copyrow"><input id="rfLink" value="${esc(link)}" readonly aria-label="Your referral link"><button type="button" class="btn primary" id="rfCopy">Copy link</button></div>
        <span class="hint">Send it by WhatsApp, Instagram or text. Your friend's code is filled in when they join from your link.</span></div>
      <div class="steps3"><div>Share your link or code with a friend who's new to Demo Studio.</div><div>They add your code when they join${REF.window ? ` (or within ${REF.window} days, before their first purchase)` : ""}.${REF.referee ? ` They get ${esc(rewardText(REF.referee))} as a welcome gift.` : ""}</div><div>When your friend ${esc(refGoal())} within ${REF.within} days of joining, <b>you get ${esc(rewardText(REF.referrer))}</b>.</div></div>
      ${REF.cap ? `<span class="hint">You can earn up to ${plural(REF.cap, "reward")} a month.</span>` : ""}
      ${isNew && !myRef ? `<div class="card mform"><h3>Did a friend refer you?</h3><span class="hint">Add their code within ${REF.window} days of joining, before your first purchase. It can't be changed afterwards.</span><div class="copyrow"><input id="rfAdd" placeholder="e.g. CHLOE-7K2P" style="background:var(--surface)"><button type="button" class="btn" id="rfAddBtn">Add code</button></div></div>` : ""}
      <div class="card"><h3>Friends you've referred</h3>${mine.length ? `<div class="stack">${mine.map((r) => `<div class="row" style="justify-content:space-between"><span class="cellp">${avatar(CLIENTS[r.friend], "sm")}<b>${esc(CLIENTS[r.friend].name.split(" ")[0])} ${esc(CLIENTS[r.friend].name.split(" ")[1][0])}.</b><span class="muted">joined ${esc(r.when)}</span></span><span class="status ${r.status === "rewarded" ? "done" : "wait"}">${r.status === "rewarded" ? `You got ${rewardText(REF.referrer).split(",")[0]}` : REF.qualify === "classes_attended" ? `${r.progress ?? 0} of ${REF.value} classes` : "Not qualified yet"}</span></div>`).join("")}</div>` : '<span class="muted">No one yet. Share your link to get started.</span>'}</div>`;
  };
  BIND.refer = function () {
    if ($("#rfCopy")) $("#rfCopy").onclick = async () => { const el = $("#rfLink"); try { await navigator.clipboard.writeText(el.value); toast("Link copied."); } catch { el.select(); toast("Press Ctrl+C (or ⌘C) to copy."); } };
    if ($("#rfAddBtn")) $("#rfAddBtn").onclick = () => {
      const v = $("#rfAdd").value.trim().toUpperCase();
      const who = CLIENTS.findIndex((_, i) => codeOf(i) === v);
      if (!v) return toast("Enter the code.");
      if (who === ME.client) return toast("That's your own code. Codes are for friends who are new to the studio.");
      if (who < 0) return toast("We couldn't find that code. Check it with your friend.");
      REFERRALS.push({ by: who, friend: ME.client, status: "pending", when: "today", progress: 0 });
      render();
      toast(`Thanks! ${CLIENTS[who].name.split(" ")[0]} will be rewarded once you qualify.${REF.referee ? ` You've got ${rewardText(REF.referee)}.` : ""}`);
    };
  };
