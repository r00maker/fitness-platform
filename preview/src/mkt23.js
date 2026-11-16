  // ===========================================================================
  // Phones. Clients booking: a date strip and the day's classes first, the studio's notices
  // shrunk to one line each, and every filter behind one Filter button (GET /calendar/strip
  // and GET /calendar?view=day in the API). Instructors: "Up next" with Check in first on My
  // day, and Check-in mode with big rows and search (GET /sessions/:id/check-in).
  // ===========================================================================
  {
    const phone = () => window.matchMedia("(max-width: 760px)").matches;
    const PB = (state.pb ||= { day: null, filters: false, notices: false });
    const STRIP_DAYS = 14;
    const dayKey = (d) => ymd(d);
    const booked = (s) => s.roster.some((r) => r.ci === ME.client);
    const waiting = (s) => s.waitlist.some((w) => (w.ci ?? w) === ME.client);
    const forDay = (d) => visibleSessions().filter((s) => sameDay(s.start, d) && s.end > NOW);
    const activeFilters = () => [state.loc, state.instr, state.tod, state.q.trim(), state.types.size, state.favOnly].filter(Boolean).length;

    function stripHTML() {
      const start = day(NOW);
      if (!PB.day) {
        // Open on today, or the next day with something left to book.
        for (let i = 0; i < STRIP_DAYS; i++) { const d = addDays(start, i); if (forDay(d).length) { PB.day = dayKey(d); break; } }
        PB.day ||= dayKey(start);
      }
      const cells = Array.from({ length: STRIP_DAYS }, (_, i) => {
        const d = addDays(start, i), list = forDay(d), k = dayKey(d);
        const mine = list.some(booked), closed = closedFor(d).length > 0;
        return `<button type="button" class="pbday ${k === PB.day ? "on" : ""} ${list.length ? "" : "none"} ${closed ? "closed" : ""}" data-pbday="${k}" aria-pressed="${k === PB.day}" aria-label="${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}: ${closed ? "closed" : list.length ? plural(list.length, "class", "classes") : "no classes"}${mine ? ", you're booked" : ""}"><span class="w">${i === 0 ? "Today" : DOW[d.getDay()]}</span><b>${d.getDate()}</b>${closed ? '<span class="cl" aria-hidden="true">Closed</span>' : `<span class="dot ${mine ? "mine" : list.length ? "" : "empty"}" aria-hidden="true"></span>`}</button>`;
      }).join("");
      return `<div class="pbstrip" role="group" aria-label="Choose a day">${cells}</div>`;
    }
    function rowHTML(s) {
      const left = s.cap - s.roster.length;
      const right = booked(s) ? '<span class="pbtag ok">Booked</span>' : waiting(s) ? '<span class="pbtag">On the waitlist</span>' : left <= 0 ? `<span class="pbtag full">Full${s.waitlist.length ? ` · ${s.waitlist.length} waiting` : ""}</span>` : `<span class="pbtag">${plural(left, "spot")} left</span>`;
      return `<button type="button" class="pbrow" data-open="${s.id}" style="--t:var(--t-${s.type})"><span class="pbt"><b>${short(s.start)}</b><span>${mins(s)} min</span></span><span class="pbc" aria-hidden="true"></span>
        <span class="pbm"><b>${esc(TYPES[s.type].name)}</b><span>${instrLabel(s, { avatar: true })} · ${esc(roomOrLoc(s.room))}</span></span>${right}</button>`;
    }
    function filterSheet() {
      const fav = favouriteOf(CLIENTS[ME.client]);
      const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`;
      return `<div class="pbsheet" id="pbSheet"><div class="pbsheetgrid">
          <label class="fld">Location<select id="pbLoc">${opt("", "All locations", state.loc || "")}${Object.entries(LOCS).map(([k, v]) => opt(k, v, state.loc)).join("")}</select></label>
          <label class="fld">Instructor<select id="pbInstr">${opt("", "All instructors", state.instr ? String(state.instr) : "")}${Object.entries(STAFF).filter(([k]) => SESSIONS.some((s) => String(s.instr) === k)).map(([k, v]) => opt(k, v, state.instr ? String(state.instr) : "")).join("")}</select></label>
          <label class="fld">Time of day<select id="pbTod">${opt("", "Any time", state.tod || "")}${opt("morning", "Morning (before 12pm)", state.tod)}${opt("afternoon", "Afternoon (12–5pm)", state.tod)}${opt("evening", "Evening (after 5pm)", state.tod)}</select></label>
          <label class="fld">Search<input id="pbQ" type="search" value="${esc(state.q)}" placeholder="Class or instructor"></label></div>
        <div class="pbtypes" role="group" aria-label="Class types">${Object.entries(TYPES).filter(([, t]) => t.kind !== "appointment").map(([k, t]) => `<button type="button" class="pbchip" data-pbtype="${k}" aria-pressed="${state.types.has(k)}" style="--t:var(--t-${k})">${esc(t.name)}</button>`).join("")}</div>
        ${fav ? `<label class="row" style="gap:8px"><input type="checkbox" id="pbFav" ${state.favOnly ? "checked" : ""}> Only classes with ${esc(firstName(STAFF[fav]))}</label>` : ""}
        <div class="row" style="gap:8px"><button type="button" class="btn primary" id="pbDone">Show classes</button><button type="button" class="btn ghost" id="pbClear">Clear filters</button></div></div>`;
    }
    function noticesLine() {
      const anns = [...document.querySelectorAll("#clientFront .annbar b")].map((b) => b.textContent);
      const bans = [...document.querySelectorAll("#clientFront .bcar [data-btap]")].map((b) => (b.getAttribute("aria-label") || b.textContent.trim().split("\n")[0]).replace(/^\d+ of \d+: /, "")).filter(Boolean);
      const items = [...anns.map((t) => ["ann", t]), ...bans.slice(0, 1).map((t) => ["ban", t])];
      if (!items.length) return "";
      return `<div class="pbnotes">${items.map(([k, t]) => `<button type="button" class="pbnote ${k}" data-pbnotes aria-expanded="false"><span aria-hidden="true">${k === "ann" ? "!" : "★"}</span><span class="tx">${esc(t)}</span><span aria-hidden="true">›</span></button>`).join("")}</div>`;
    }
    function renderPhoneBooking() {
      const pg = $("#pgSchedule");
      pg.classList.add("pbmode");
      const front = $("#clientFront");
      if (front && !PB.notices) { const line = noticesLine(); front.hidden = true; pg.querySelector(".pbnotes")?.remove(); if (line) front.insertAdjacentHTML("afterend", line); }
      else pg.querySelector(".pbnotes")?.remove();
      const strip = stripHTML(); // picks the day on first open
      const d = fromYmdHm(PB.day, "00:00");
      const list = forDay(d);
      const n = activeFilters();
      let empty = "";
      if (!list.length) {
        const next = Array.from({ length: 30 }, (_, i) => addDays(d, i + 1)).find((x) => forDay(x).length);
        empty = `<div class="pbempty"><b>${closedFor(d).length ? "The studio is closed this day." : n ? "No classes match your filters on this day." : "No classes left on this day."}</b>${next ? `<button type="button" class="btn" data-pbday="${dayKey(next)}">See ${DOW[next.getDay()]} ${next.getDate()} ${MON[next.getMonth()]}</button>` : ""}${n ? '<button type="button" class="btn ghost" id="pbClear2">Clear filters</button>' : ""}</div>`;
      }
      $("#canvas").innerHTML = strip +
        `<div class="pbbar"><b class="pbdate">${sameDay(d, NOW) ? "Today" : `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`}${closedTag(d)}</b><button type="button" class="btn ${n ? "primary" : ""}" id="pbFilter" aria-expanded="${PB.filters}">Filter${n ? ` · ${n}` : ""}</button></div>` +
        (PB.filters ? filterSheet() : "") +
        `<div class="pblist">${list.map(rowHTML).join("")}${empty}</div>`;
      // Keep the strip's chosen day in view.
      const on = $(".pbday.on"); if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
      bindPhoneBooking();
    }
    function syncToolbar() { const set = (id, v) => { const el = $(id); if (el) el.value = v; }; set("#fLoc", state.loc || ""); set("#fInstr", state.instr ? String(state.instr) : ""); set("#fTod", state.tod || ""); set("#fQ", state.q); }
    function bindPhoneBooking() {
      document.querySelectorAll("[data-pbday]").forEach((b) => (b.onclick = () => { PB.day = b.dataset.pbday; render(); }));
      $("#pbFilter").onclick = () => { PB.filters = !PB.filters; render(); if (PB.filters) $("#pbLoc")?.focus(); };
      document.querySelectorAll("[data-pbnotes]").forEach((b) => (b.onclick = () => { PB.notices = true; render(); }));
      const clear = () => { state.loc = ""; state.instr = ""; state.tod = ""; state.q = ""; state.types.clear(); state.favOnly = false; syncToolbar(); render(); };
      if ($("#pbClear")) $("#pbClear").onclick = clear;
      if ($("#pbClear2")) $("#pbClear2").onclick = clear;
      if ($("#pbDone")) $("#pbDone").onclick = () => { PB.filters = false; render(); };
      if ($("#pbLoc")) $("#pbLoc").onchange = (e) => { state.loc = e.target.value; syncToolbar(); render(); };
      if ($("#pbInstr")) $("#pbInstr").onchange = (e) => { state.instr = e.target.value ? Number(e.target.value) : ""; syncToolbar(); render(); };
      if ($("#pbTod")) $("#pbTod").onchange = (e) => { state.tod = e.target.value; syncToolbar(); render(); };
      if ($("#pbQ")) $("#pbQ").oninput = (e) => { state.q = e.target.value; syncToolbar(); const pos = e.target.selectionStart; render(); const q = $("#pbQ"); if (q) { q.focus(); q.setSelectionRange(pos, pos); } };
      if ($("#pbFav")) $("#pbFav").onchange = (e) => { state.favOnly = e.target.checked; render(); };
      document.querySelectorAll("[data-pbtype]").forEach((b) => (b.onclick = () => { const k = b.dataset.pbtype; state.types.has(k) ? state.types.delete(k) : state.types.add(k); render(); }));
    }

    // --- Instructors: Up next with Check in, and Check-in mode -------------------------------
    const CI = (state.ci ||= { open: null, q: "", ask: null });
    function myNext() {
      const mine = SESSIONS.filter((s) => s.status === "scheduled" && s.instr === ME.instructor && sameDay(s.start, NOW) && s.end > NOW && TYPES[s.type]?.kind !== "appointment").sort((a, b) => a.start - b.start);
      return { now: mine[0] || null, then: mine[1] || null };
    }
    function upNextCard() {
      const { now: s, then } = myNext();
      if (!s) return `<section class="card upfirst" aria-labelledby="upTitle"><h3 id="upTitle">Up next</h3><p class="muted">You've no more classes today.${(() => { const n = SESSIONS.filter((x) => x.status === "scheduled" && x.instr === ME.instructor && x.start > NOW).sort((a, b) => a.start - b.start)[0]; return n ? ` Next: ${esc(TYPES[n.type].name)}, ${fmtDay(n.start)} at ${clock(n.start)}.` : ""; })()}</p></section>`;
      const onNow = NOW >= s.start, mins_ = Math.round((s.start - NOW) / 60000);
      const open = NOW >= addMin(s.start, -60);
      const inn = s.roster.filter((r) => r.att === "present").length;
      const noWaiver = s.roster.filter((r) => waiverMissing(CLIENTS[r.ci])).length;
      const first = s.roster.filter((r) => (CLIENTS[r.ci].attended || 0) === 0).length;
      const health = s.roster.filter((r) => activeHealth(CLIENTS[r.ci]).length).length;
      const when = onNow ? "On now" : mins_ < 60 ? `In ${mins_} min` : `At ${clock(s.start)}`;
      return `<section class="card upfirst" aria-labelledby="upTitle" style="--t:var(--t-${s.type})">
        <div class="row" style="justify-content:space-between;gap:8px"><h3 id="upTitle">${onNow ? "On now" : "Up next"}</h3><span class="upwhen">${when}</span></div>
        <div class="stack" style="gap:2px"><b class="upname">${esc(TYPES[s.type].name)}</b><span class="muted">${clock(s.start)}–${clock(s.end)} · ${esc(roomOrLoc(s.room))}</span></div>
        <div class="upfacts"><span><b>${s.roster.length}</b> of ${s.cap} booked</span>${open ? `<span><b>${inn}</b> checked in</span>` : ""}${noWaiver ? `<span class="bad">${plural(noWaiver, "waiver")} missing</span>` : ""}${first ? `<span>${plural(first, "first-timer")}</span>` : ""}${health ? `<span>${plural(health, "health note")}</span>` : ""}</div>
        <button type="button" class="btn primary upgo" data-checkin="${s.id}">${open ? (inn ? `Check in (${inn} of ${s.roster.length} in)` : "Check in") : "See who's coming"}</button>
        ${open ? "" : `<span class="muted" style="font-size:12.5px">Check-in opens at ${clock(addMin(s.start, -60))}, an hour before class.</span>`}
        ${then ? `<span class="muted" style="font-size:12.5px">Then: ${esc(TYPES[then.type].name)} at ${clock(then.start)}</span>` : ""}
      </section>`;
    }
    function checkInHTML() {
      const s = SESSIONS.find((x) => x.id === CI.open);
      const open = NOW >= addMin(s.start, -60), locked = NOW >= attLockOf(s);
      const q = CI.q.trim().toLowerCase();
      const people = s.roster.map((r) => ({ r, c: CLIENTS[r.ci] })).sort((a, b) => a.c.name.localeCompare(b.c.name)).filter(({ c }) => !q || c.name.toLowerCase().includes(q));
      const inn = s.roster.filter((r) => r.att === "present").length, ns = s.roster.filter((r) => r.att === "no_show").length;
      const flags = (c) => [waiverMissing(c) ? '<span class="cif bad">No waiver</span>' : "", ...activeHealth(c).map((h) => `<span class="cif warn">${esc(healthLabel(h))}</span>`), (c.attended || 0) === 0 ? '<span class="cif">First class</span>' : ""].join("");
      return `<div class="cimode" role="dialog" aria-modal="true" aria-labelledby="ciTitle">
        <div class="cihead"><div class="stack" style="gap:1px;min-width:0"><b id="ciTitle">${esc(TYPES[s.type].name)} · ${clock(s.start)}</b><span class="muted">${inn} of ${s.roster.length} checked in${ns ? ` · ${ns} no-show` : ""}</span></div><button type="button" class="btn" id="ciClose">Done</button></div>
        <div class="cimeter" role="img" aria-label="${inn} of ${s.roster.length} checked in"><span style="width:${s.roster.length ? (inn / s.roster.length) * 100 : 0}%"></span></div>
        ${open ? "" : `<div class="cinote">Check-in opens at ${clock(addMin(s.start, -60))}. You can see who's coming now.</div>`}
        ${locked ? `<div class="cinote">Attendance locked at ${lockWords(s)}. Changes now add or remove no-show fees, so they're done from the class page.</div>` : ""}
        <input id="ciQ" type="search" class="ciq" placeholder="Find a name" value="${esc(CI.q)}" aria-label="Find a name" autocomplete="off">
        <div class="cilist">${people.map(({ r, c }) => {
          const st = r.att;
          return `<div class="cirow ${st}"><div class="cip">${avatar(c)}<div class="stack" style="gap:3px;min-width:0"><b>${esc(c.name)}</b><span class="ciflags">${flags(c)}${c.source === "classpass" ? '<span class="cif">ClassPass</span>' : ""}</span></div></div>
            <div class="ciact">${st === "present" ? `<button type="button" class="cibtn in" data-ci="${r.ci}:present" ${!open || locked ? "disabled" : ""} aria-label="${esc(c.name)} is checked in. Tap to undo.">✓ In</button>` : st === "no_show" ? `<button type="button" class="cibtn ns" data-ci="${r.ci}:no_show" ${!open || locked ? "disabled" : ""} aria-label="${esc(c.name)} marked no-show. Tap to undo.">No-show</button>` : `<button type="button" class="cibtn" data-ci="${r.ci}:present" ${!open || locked ? "disabled" : ""}>Check in</button>${NOW >= s.start ? `<button type="button" class="cibtn small" data-ci="${r.ci}:no_show" ${locked ? "disabled" : ""} aria-label="Mark ${esc(c.name)} as a no-show">No-show</button>` : ""}`}</div>
            ${CI.ask === r.ci ? `<div class="ciask"><b>${esc(firstName(c.name))} hasn't signed the waiver.</b><span>Ask them to sign in the app now, or mark a paper copy done.</span><div class="row" style="gap:8px"><button type="button" class="btn" data-ciwaiver="${r.ci}">Mark paper waiver done</button><button type="button" class="btn ghost" data-ciskip="${r.ci}">Not now</button></div></div>` : ""}</div>`;
        }).join("") || '<p class="muted" style="padding:12px 0">Nobody by that name is booked.</p>'}</div>
        ${open && !locked && NOW >= s.start && s.roster.some((r) => r.att === "unmarked") ? `<button type="button" class="btn" id="ciRest">Mark everyone not here as no-show</button>` : ""}
      </div>`;
    }
    function renderCheckIn() {
      let root = $("#ciRoot");
      if (!root) { document.body.insertAdjacentHTML("beforeend", '<div id="ciRoot"></div>'); root = $("#ciRoot"); }
      if (CI.open === null) { root.innerHTML = ""; document.body.classList.remove("cilock"); return; }
      root.innerHTML = checkInHTML();
      document.body.classList.add("cilock");
      bindCheckIn();
    }
    function setAtt(s, ci, val) {
      const r = s.roster.find((x) => x.ci === ci);
      r.att = r.att === val ? "unmarked" : val;
      if (r.att === "no_show" && STUDIO.noShowFeeOn) FEES.unshift({ id: FEES.length + 1, ci, type: "no_show", sid: s.id, cents: STUDIO.noShowFeeCents, status: "pending", added: fmtDay(NOW) });
      else FEES.filter((f) => f.ci === ci && f.sid === s.id && f.type === "no_show" && f.status === "pending").forEach((f) => Object.assign(f, { status: "waived", reason: "Attendance corrected" }));
      return r.att;
    }
    function bindCheckIn() {
      const s = SESSIONS.find((x) => x.id === CI.open);
      $("#ciClose").onclick = () => { CI.open = null; CI.q = ""; CI.ask = null; renderCheckIn(); render(); };
      $("#ciQ").oninput = (e) => { CI.q = e.target.value; const pos = e.target.selectionStart; renderCheckIn(); const q = $("#ciQ"); q.focus(); q.setSelectionRange(pos, pos); };
      document.querySelectorAll("[data-ci]").forEach((b) => (b.onclick = () => {
        const [ci, val] = b.dataset.ci.split(":"), c = CLIENTS[Number(ci)];
        const r = s.roster.find((x) => x.ci === Number(ci));
        if (val === "present" && r.att !== "present" && waiverMissing(c) && CI.ask !== Number(ci)) { CI.ask = Number(ci); return renderCheckIn(); }
        CI.ask = null;
        const now = setAtt(s, Number(ci), val);
        renderCheckIn();
        toast(now === "present" ? `${firstName(c.name)} is checked in.` : now === "no_show" ? `${firstName(c.name)} marked as a no-show${STUDIO.noShowFeeOn ? `; a ${STUDIO.noShowFee} fee was added` : ""}.` : `Undone: ${firstName(c.name)} isn't marked yet.`);
        if (!CI.q) return;
        CI.q = ""; renderCheckIn(); $("#ciQ").focus(); // ready for the next name
      }));
      document.querySelectorAll("[data-ciwaiver]").forEach((b) => (b.onclick = () => { const ci = Number(b.dataset.ciwaiver); CLIENTS[ci].waiver = { method: "staff", by: "Ana Lim", at: fmtDay(NOW) }; CI.ask = null; setAtt(s, ci, "present"); renderCheckIn(); toast(`Waiver marked as done and ${firstName(CLIENTS[ci].name)} is checked in.`); }));
      document.querySelectorAll("[data-ciskip]").forEach((b) => (b.onclick = () => { CI.ask = null; renderCheckIn(); }));
      if ($("#ciRest")) $("#ciRest").onclick = () => { const n = s.roster.filter((r) => r.att === "unmarked"); n.forEach((r) => setAtt(s, r.ci, "no_show")); renderCheckIn(); toast(`${plural(n.length, "person", "people")} marked as no-show.`); };
    }

    const pageHome = PAGES.home;
    PAGES.home = function () {
      const html = pageHome();
      if (state.role !== "instructor") return html;
      // Instructors: what's next comes first; the day's numbers move below it.
      return html.replace('<div class="home">', `<div class="home insthome">${upNextCard()}`);
    };
    const bindHome = BIND.home;
    BIND.home = function () { bindHome?.(); document.querySelectorAll("[data-checkin]").forEach((b) => (b.onclick = () => { CI.open = Number(b.dataset.checkin); renderCheckIn(); })); };

    const renderPrev = render;
    render = function () {
      renderPrev();
      const pg = $("#pgSchedule");
      if (state.role === "client" && state.page === "schedule" && phone()) renderPhoneBooking();
      else { pg?.classList.remove("pbmode"); pg?.querySelector(".pbnotes")?.remove(); }
      renderCheckIn();
    };
    window.addEventListener("resize", () => { if (state.role === "client" && state.page === "schedule") render(); });
  }
