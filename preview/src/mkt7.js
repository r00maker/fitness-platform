  // ===========================================================================
  // Change many classes at once: choose them (picked on the calendar, or by filters across
  // months), then change anything the class creator can. Same rules as POST /sessions/bulk-update.
  // ===========================================================================
  const DOW_ISO = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]];
  const isoDow = (d) => ((d.getDay() + 6) % 7) + 1;
  const RANGE_PRESETS = [[28, "Next 4 weeks"], [91, "Next 3 months"], [182, "Next 6 months"], [365, "Next 12 months"]];
  const KEEP = "__keep";

  function bulkMatches(f) {
    if (f.source === "picked") return SESSIONS.filter((x) => state.selected.has(x.id) && x.status === "scheduled" && x.start > NOW);
    const from = fromYmdHm(f.from, "00:00"), to = addDays(fromYmdHm(f.to, "00:00"), 1);
    return SESSIONS.filter((x) => x.status === "scheduled" && x.start > NOW && x.start >= from && x.start < to
      && (f.kind === "all" || (f.kind === "appointment") === isAppt(x))
      && (!f.types.length || f.types.includes(x.type))
      && (!f.instrs.length || f.instrs.includes(x.instr || "tbc"))
      && (!f.loc || x.loc === f.loc)
      && (!f.days.length || f.days.includes(isoDow(x.start)))
      && (!f.time || hhmm(x.start) === f.time)).sort((a, b) => a.start - b.start);
  }

  function openBulkChange(opts = {}) {
    const picked = state.selected.size;
    const f = opts.filter || { source: picked ? "picked" : "filter", preset: 91, from: ymd(NOW), to: ymd(addDays(NOW, 91)), kind: "class", types: [], instrs: [], loc: "", days: [], time: "" };
    const c = opts.changes || { type: KEEP, loc: KEEP, room: KEEP, instr: KEEP, cover: false, start: "", len: "", cap: "", wl: KEEP, cp: KEEP, cpSpots: 2, ac: KEEP, acMin: 3, acH: 12, notes: KEEP, notesText: "", notify: true };
    let step = opts.step || 1;
    const chip = (attr, v, on, label) => `<button type="button" class="pickchip" data-${attr}="${esc(String(v))}" aria-pressed="${on}">${label}</button>`;
    const keepSel = (id, cur, options, label = "Keep as is") => `<select id="${id}"><option value="${KEEP}" ${cur === KEEP ? "selected" : ""}>${label}</option>${options}</select>`;
    let painting = false;
    const paint = () => {
      if (painting) { setTimeout(paint, 0); return; }
      painting = true;
      try { paintNow(); } finally { painting = false; }
    };
    const paintNow = () => {
      const list = bulkMatches(f);
      const withB = list.filter((x) => x.roster.length);
      const people = withB.reduce((a, x) => a + x.roster.length, 0);
      const times = [...new Set(SESSIONS.filter((x) => x.start > NOW).map((x) => hhmm(x.start)))].sort();
      const summary = list.length ? `<b>${plural(list.length, "class", "classes")}</b>${withB.length ? `, ${withB.length} with bookings (${plural(people, "person", "people")} booked)` : ", none booked yet"}` : "No upcoming classes match.";
      const roomsAt = Object.entries(liveRooms()).filter(([, r]) => c.loc === KEEP || r.loc === c.loc);
      const body1 = `
        <div class="seg" role="group" aria-label="Which classes">${chip("bksrc", "filter", f.source === "filter", "Choose with filters")}${chip("bksrc", "picked", f.source === "picked", picked ? `Picked on the calendar (${picked})` : "Pick on the calendar")}</div>
        ${f.source === "picked" && picked ? `<span class="hint">${plural(picked, "class", "classes")} you picked. <button type="button" class="linkbtn" id="bkRepick">Pick again</button></span>` : ""}
        ${f.source === "filter" ? `<div class="bkfilters">
          <div class="fl">When<div class="fbar">${RANGE_PRESETS.map(([d, l]) => chip("bkpre", d, f.preset === d, l)).join("")}${chip("bkpre", "custom", f.preset === "custom", "Choose dates")}</div>
            ${f.preset === "custom" ? `<div class="two" style="grid-template-columns:1fr 1fr;margin-top:6px"><label class="fl">From<input type="date" id="bkFrom" value="${f.from}"></label><label class="fl">To<input type="date" id="bkTo" value="${f.to}"></label></div>` : `<span class="hint">${fmtDay(fromYmdHm(f.from, "00:00"))} to ${fmtDay(fromYmdHm(f.to, "00:00"))}</span>`}</div>
          <div class="fl">Class or appointment<div class="fbar">${chip("bkkind", "class", f.kind === "class", "Classes")}${chip("bkkind", "appointment", f.kind === "appointment", "Appointments")}${chip("bkkind", "all", f.kind === "all", "Both")}</div></div>
          <div class="fl">Class types <span class="h">(none = all)</span><div class="fbar">${Object.entries(liveTypes()).filter(([, t]) => f.kind === "all" || (t.kind === "appointment") === (f.kind === "appointment")).map(([k, t]) => chip("bktype", k, f.types.includes(k), `<span class="sw" style="--t:var(--t-${k});display:inline-block;width:8px;height:8px;border-radius:2px;background:var(--t);margin-right:4px"></span>${esc(t.name)}`)).join("")}</div></div>
          <div class="fl">Instructors <span class="h">(none = all)</span><div class="fbar">${Object.entries(STAFF).map(([k, n]) => chip("bkins", k, f.instrs.includes(k), esc(n))).join("")}${chip("bkins", "tbc", f.instrs.includes("tbc"), "TBC")}</div></div>
          <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Location<select id="bkLoc"><option value="">Any</option>${Object.entries(LOCS).map(([k, n]) => `<option value="${k}" ${f.loc === k ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
            <label class="fl">Start time<select id="bkTime"><option value="">Any</option>${times.map((t) => `<option value="${t}" ${f.time === t ? "selected" : ""}>${short(fromYmdHm("2026-01-01", t))}</option>`).join("")}</select></label></div>
          <div class="fl">Days<div class="seg dows" role="group" aria-label="Days">${DOW_ISO.map(([d, n]) => `<button type="button" data-bkday="${d}" aria-pressed="${f.days.includes(d)}">${n}</button>`).join("")}</div></div>
        </div>` : ""}
        <div class="bkcount" aria-live="polite">${summary}</div>
        ${list.length ? `<ul class="bklist">${list.slice(0, 5).map((x) => `<li><span class="sw" style="--t:var(--t-${x.type});background:var(--t)"></span>${fmtDay(x.start)} · ${short(x.start)} · ${esc(TYPES[x.type].name)} · ${esc(instrName(x.instr))}${x.roster.length ? ` <span class="muted">(${x.roster.length} booked)</span>` : ""}</li>`).join("")}${list.length > 5 ? `<li class="muted">and ${list.length - 5} more</li>` : ""}</ul>` : ""}`;
      const body2 = `
        <span class="hint">Everything set to “Keep as is” stays as it is on each class.</span>
        <div class="form">
          <div class="field"><label for="bkType">Class</label>${keepSel("bkType", c.type, Object.entries(liveTypes()).filter(([, t]) => (t.kind === "appointment") === (f.kind === "appointment")).map(([k, t]) => `<option value="${k}" ${c.type === k ? "selected" : ""}>${esc(t.name)}</option>`).join(""))}</div>
          <div class="field"><label for="bkIns">Instructor</label>${keepSel("bkIns", c.instr, `<option value="" ${c.instr === "" ? "selected" : ""}>TBC</option>${Object.entries(STAFF).map(([k, n]) => `<option value="${k}" ${c.instr === k ? "selected" : ""}>${esc(n)}</option>`).join("")}`)}</div>
          <div class="field"><label for="bkLoc2">Location</label>${keepSel("bkLoc2", c.loc, Object.entries(LOCS).map(([k, n]) => `<option value="${k}" ${c.loc === k ? "selected" : ""}>${esc(n)}</option>`).join(""))}</div>
          <div class="field"><label for="bkRoom">Room</label>${keepSel("bkRoom", c.room, roomsAt.map(([k, r]) => `<option value="${k}" ${c.room === k ? "selected" : ""}>${esc(r.name)} · ${esc(LOCS[r.loc])} (holds ${r.cap})</option>`).join(""), c.loc === KEEP ? "Keep as is" : "Choose a room")}</div>
          ${c.instr !== KEEP && c.instr ? `<div class="field full"><label class="check" for="bkCover"><input id="bkCover" type="checkbox" ${c.cover ? "checked" : ""}> Covering these classes (substitute for the usual instructor) ${tip("cover")}</label></div>` : ""}
          <div class="field"><span class="lbl">Starts</span>${timePicker("bkStart", c.start, { keep: true, label: "New start time" })}</div>
          <div class="field"><label for="bkLen">Length</label><select id="bkLen"><option value="">Keep as is</option>${LENGTHS.map((d) => `<option value="${d}" ${String(c.len) === String(d) ? "selected" : ""}>${lengthText(d)}</option>`).join("")}</select></div>
          <div class="field"><label for="bkCap">Spots available</label><input id="bkCap" type="number" min="1" placeholder="Keep as is" value="${esc(String(c.cap))}"></div>
          ${f.kind === "appointment" ? "" : `<div class="field"><label for="bkWl">Waitlist</label>${keepSel("bkWl", c.wl, `<option value="on" ${c.wl === "on" ? "selected" : ""}>Allow waitlist</option><option value="off" ${c.wl === "off" ? "selected" : ""}>No waitlist</option>`)}</div>
          <div class="field full cpbox"><label for="bkCp">ClassPass ${tip("classpass")}</label>${keepSel("bkCp", c.cp, `<option value="on" ${c.cp === "on" ? "selected" : ""}>Take ClassPass bookings</option><option value="off" ${c.cp === "off" ? "selected" : ""}>Members only</option>`)}
            ${c.cp === "on" ? `<label class="inline2" style="font-size:13px;margin-top:4px">Spots for ClassPass <input id="bkCpN" type="number" min="1" value="${c.cpSpots}"></label>` : ""}</div>
          <div class="field full cpbox"><label for="bkAc">Cancel automatically ${tip("autoCancel")}</label>${keepSel("bkAc", c.ac, `<option value="on" ${c.ac === "on" ? "selected" : ""}>Cancel if not enough people book</option><option value="off" ${c.ac === "off" ? "selected" : ""}>Don't cancel automatically</option>`)}
            ${c.ac === "on" ? `<div class="inline2" style="font-size:13px;margin-top:4px">If fewer than <input type="number" id="bkAcMin" min="1" value="${c.acMin}"> are booked <select id="bkAcH">${[1, 2, 3, 4, 6, 8, 12, 24, 48].map((h) => `<option value="${h}" ${c.acH === h ? "selected" : ""}>${h} ${h === 1 ? "hour" : "hours"}</option>`).join("")}</select> before</div>` : ""}</div>`}
          <div class="field full"><label for="bkNotes">Notes for the team</label>${keepSel("bkNotes", c.notes, `<option value="set" ${c.notes === "set" ? "selected" : ""}>Replace with…</option><option value="clear" ${c.notes === "clear" ? "selected" : ""}>Remove notes</option>`)}${c.notes === "set" ? `<input id="bkNotesT" maxlength="2000" value="${esc(c.notesText)}" placeholder="e.g. Bring a mat" style="margin-top:6px">` : ""}</div>
          <div class="field full"><label class="check" for="bkNotify"><input id="bkNotify" type="checkbox" ${c.notify ? "checked" : ""}> Tell booked clients about time or place changes</label></div>
        </div>`;
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal bkmodal" id="bkForm" role="dialog" aria-modal="true" aria-labelledby="bkTitle" novalidate>
        <header><h2 id="bkTitle">Edit many classes</h2><div class="bksteps"><span aria-current="${step === 1 ? "step" : "false"}">1. Which classes</span><span aria-current="${step === 2 ? "step" : "false"}">2. What to change</span></div></header>
        <div class="mb mform">${step === 1 ? body1 : `<div class="bkcount">${summary} <button type="button" class="tagbtn" id="bkBack">Change which</button></div>${body2}`}</div>
        <footer><button type="button" class="btn ghost" data-mclose>Cancel</button>${step === 1 ? `<button type="button" class="btn danger" id="bkCancelAll" ${list.length ? "" : "disabled"}>Cancel these classes…</button><button type="submit" class="btn primary" ${list.length ? "" : "disabled"}>Next: what to change</button>` : `<button type="submit" class="btn primary">Change ${plural(list.length, "class", "classes")}</button>`}</footer></form></div>`;
      bind(list);
    };
    const keep = () => {
      if (step !== 2) return;
      c.type = $("#bkType").value; c.instr = $("#bkIns").value; c.loc = $("#bkLoc2").value; c.room = $("#bkRoom").value; c.cover = !!$("#bkCover")?.checked;
      c.start = readTime("bkStart") || ""; c.len = $("#bkLen").value; c.cap = $("#bkCap").value; c.notify = $("#bkNotify").checked;
      if ($("#bkWl")) c.wl = $("#bkWl").value; if ($("#bkCp")) c.cp = $("#bkCp").value; if ($("#bkCpN")) c.cpSpots = Math.max(1, Number($("#bkCpN").value) || 1);
      if ($("#bkAc")) c.ac = $("#bkAc").value; if ($("#bkAcMin")) c.acMin = Math.max(1, Number($("#bkAcMin").value) || 1); if ($("#bkAcH")) c.acH = Number($("#bkAcH").value);
      c.notes = $("#bkNotes").value; if ($("#bkNotesT")) c.notesText = $("#bkNotesT").value;
    };
    const bind = (list) => {
      const on = (sel, fn) => document.querySelectorAll(sel).forEach((b) => (b.onclick = () => { fn(b); paint(); }));
      const toggleIn = (arr, v) => (arr.includes(v) ? arr.splice(arr.indexOf(v), 1) : arr.push(v));
      document.querySelectorAll("[data-bksrc]").forEach((b) => (b.onclick = () => { if (b.dataset.bksrc === "picked" && !picked) return startPicking(); f.source = b.dataset.bksrc; paint(); }));
      if ($("#bkRepick")) $("#bkRepick").onclick = () => startPicking();
      on("[data-bkpre]", (b) => { const v = b.dataset.bkpre; f.preset = v === "custom" ? "custom" : Number(v); if (v !== "custom") { f.from = ymd(NOW); f.to = ymd(addDays(NOW, Number(v))); } });
      on("[data-bkkind]", (b) => { f.kind = b.dataset.bkkind; f.types = []; });
      on("[data-bktype]", (b) => toggleIn(f.types, b.dataset.bktype));
      on("[data-bkins]", (b) => toggleIn(f.instrs, b.dataset.bkins));
      on("[data-bkday]", (b) => toggleIn(f.days, Number(b.dataset.bkday)));
      if ($("#bkFrom")) { $("#bkFrom").onchange = (e) => { f.from = e.target.value; paint(); }; $("#bkTo").onchange = (e) => { f.to = e.target.value; paint(); }; }
      if ($("#bkLoc")) $("#bkLoc").onchange = (e) => { f.loc = e.target.value; paint(); };
      if ($("#bkTime")) $("#bkTime").onchange = (e) => { f.time = e.target.value; paint(); };
      if ($("#bkBack")) $("#bkBack").onclick = () => { keep(); step = 1; paint(); };
      ["#bkLoc2", "#bkIns", "#bkCp", "#bkAc", "#bkNotes"].forEach((id) => { if ($(id)) $(id).addEventListener("change", () => { keep(); if (id === "#bkLoc2") c.room = KEEP; paint(); }); });
      if ($("#bkCancelAll")) $("#bkCancelAll").onclick = () => { state.selected = new Set(list.map((x) => x.id)); closeModal(); openBulkCancel(); };
      $("#bkForm").onsubmit = (e) => {
        e.preventDefault();
        if (step === 1) { if (f.preset === "custom" && f.to < f.from) return toast("The end date must be on or after the start date."); step = 2; paint(); return; }
        keep();
        if (c.loc !== KEEP && c.room === KEEP) return toast("Choose a room at the new location.");
        const changed = [c.type, c.instr, c.loc, c.wl, c.cp, c.ac, c.notes].some((v) => v !== KEEP) || c.start || c.len || c.cap;
        if (!changed) return toast("Change at least one thing.");
        const cap = Number(c.cap) || null;
        if (c.cp === "on" && cap && c.cpSpots > cap) return toast(`ClassPass can have at most ${cap} spots.`);
        if (c.ac === "on" && cap && c.acMin > cap) return toast(`The minimum to run can be at most ${cap}.`);
        const plans = list.map((t) => {
          const start = c.start ? fromYmdHm(ymd(t.start), c.start) : t.start;
          const dur = Number(c.len) || mins(t);
          const room = c.room !== KEEP ? c.room : t.room;
          return { t, cand: { tpl: t.tpl, start, end: addMin(start, dur), type: c.type !== KEEP ? c.type : t.type, instr: c.instr !== KEEP ? c.instr || null : t.instr, room, loc: ROOMS[room].loc, cap: cap || t.cap } };
        });
        const tooSmall = plans.find((p) => p.t.roster.length > p.cand.cap);
        if (tooSmall) return toast(`${tooSmall.t.roster.length} people are already booked on ${fmtDay(tooSmall.t.start)}, so spots can't go below ${tooSmall.t.roster.length}.`);
        let flags = [], affected = 0;
        for (const { t, cand } of plans) {
          flags.push(...checks(cand, { excludeId: t.id, checkList: cand.instr !== t.instr }).filter((x) => x.title !== "No instructor yet" || c.instr === ""));
          if (t.roster.length && (+cand.start !== +t.start || +cand.end !== +t.end || cand.loc !== t.loc)) affected += t.roster.length;
        }
        if (affected) flags.push({ level: "confirm", title: "Booked clients will be affected", msg: `${plural(affected, "booked client")} ${c.notify ? "will be told about" : "will NOT be told about"} the new time or place.` });
        if (plans.length > 20) flags.push({ level: "confirm", title: "Lots of classes at once", msg: `This will change ${plans.length} classes.` });
        flags = flags.filter((x, i) => flags.findIndex((g) => g.msg === x.msg) === i);
        confirmFlags(flags, {
          back: () => openBulkChange({ filter: f, changes: c, step: 2 }),
          proceed: () => {
            for (const { t, cand } of plans) {
              const usual = t.coverFor || t.instr;
              if (cand.instr !== t.instr) t.coverFor = c.cover && cand.instr !== usual ? usual : null;
              Object.assign(t, { start: cand.start, end: cand.end, type: cand.type, instr: cand.instr, room: cand.room, loc: cand.loc, cap: cand.cap });
              if (c.wl !== KEEP) t.wl = c.wl === "on";
              if (c.cp === "on") { t.cpOn = !isAppt(t); t.cpSpots = t.cpOn ? Math.min(c.cpSpots, t.cap) : null; } else if (c.cp === "off") { t.cpOn = false; t.cpSpots = null; }
              if (c.ac === "on" && !isAppt(t)) t.ac = { h: c.acH, min: Math.min(c.acMin, t.cap) }; else if (c.ac === "off") t.ac = null;
              if (c.notes === "set") t.notes = c.notesText.trim(); else if (c.notes === "clear") t.notes = "";
            }
            closeModal(); state.selected.clear(); state.selecting = false; render();
            toast(`Changed ${plural(plans.length, "class", "classes")}.${affected && c.notify ? ` ${plural(affected, "booked client")} told.` : ""}`);
          },
        });
      };
    };
    paint();
  }
