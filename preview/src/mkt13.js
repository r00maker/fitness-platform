  // ===========================================================================
  // Closures and holidays: days a location (or the whole studio) is closed.
  // Same rules as apps/api/src/modules/closures: adding one cancels the classes on those days
  // (after asking) and tells each person once; repeats skip closed days; adding or moving a
  // class onto a closed day asks first; removing a closure leaves cancelled classes cancelled.
  // ===========================================================================
  const CLOSURES = [
    { id: "cl1", name: "Floor repairs", loc: "hv", start: "2026-11-28", end: "2026-11-29", msg: "Tanjong Pagar is open as usual.", cancelled: 0 },
    { id: "cl2", name: "Christmas Day", loc: null, start: "2026-12-25", end: "2026-12-25", msg: "Merry Christmas! Back on the 26th.", cancelled: 0 },
    { id: "cl3", name: "New Year's Day", loc: null, start: "2027-01-01", end: "2027-01-01", msg: "", cancelled: 0 },
  ];
  let nextClId = 4;
  /** Repeat dates the class form left out because of a closure (filled in by repDates). */
  const REP_SKIPPED = [];
  const CL_MAX_DAYS = 366;
  const clDay = (x) => fmtDay(fromYmdHm(x, "00:00"));
  const clDates = (c) => (c.start === c.end ? clDay(c.start) : `${clDay(c.start)} – ${clDay(c.end)}`);
  const clWhere = (c) => (c.loc ? LOCS[c.loc] : "All locations");
  const clDaysLong = (c) => Math.round((fromYmdHm(c.end, "00:00") - fromYmdHm(c.start, "00:00")) / 864e5) + 1;
  /** The closure covering a location on a date (a studio-wide one covers every location). */
  function closureOn(loc, date) {
    return CLOSURES.find((c) => (!c.loc || !loc || c.loc === loc) && c.start <= date && c.end >= date) || null;
  }
  /** Upcoming classes on the closed days. */
  const clClasses = (span) => SESSIONS.filter((s) => s.status === "scheduled" && s.start > NOW && (!span.loc || s.loc === span.loc) && ymd(s.start) >= span.start && ymd(s.start) <= span.end);
  function clCancel(c, list) {
    for (const s of list) { s.status = "cancelled"; s.cancelReason = `Studio closed: ${c.name}`; s.closure = c.id; }
    c.cancelled += list.length;
  }
  // The sample closure at Holland Village has already cancelled that weekend's classes there.
  clCancel(CLOSURES[0], clClasses({ loc: "hv", start: "2026-11-28", end: "2026-11-29" }));

  // --- On the calendar: closed days are shaded, with the name in the day heading ---------
  /** Closures to show on the calendar for a day, given the location filter. Clients see them too. */
  const closedFor = (d) => CLOSURES.filter((c) => c.start <= ymd(d) && c.end >= ymd(d) && (!state.loc || !c.loc || c.loc === state.loc));
  function closedCls(d) { return closedFor(d).length ? "closed" : ""; }
  function closedLabel(c) { return `Closed${c.loc && !state.loc ? ` at ${LOCS[c.loc]}` : ""}: ${c.name}`; }
  function closedTag(d) {
    return closedFor(d).map((c) => `<span class="closedtag" data-help="${esc(`${clDates(c)} · ${clWhere(c)}${c.msg ? ` · ${c.msg}` : ""}`)}">${esc(closedLabel(c))}</span>`).join("");
  }
  function closedChip(d) {
    return closedFor(d).map((c) => `<span class="closedchip">${esc(closedLabel(c))}</span>`).join("");
  }
  /** The day view's empty message on a closed day. */
  function closedEmpty(d) {
    const c = closedFor(d)[0];
    return c ? `${esc(closedLabel(c))}.${c.msg ? ` ${esc(c.msg)}` : ""}` : "";
  }

  // --- The Closures page ----------------------------------------------------------------
  PAGES.closures = function () {
    const today = ymd(NOW);
    const upcoming = CLOSURES.filter((c) => c.end >= today).sort((a, b) => (a.start < b.start ? -1 : 1));
    const past = CLOSURES.filter((c) => c.end < today);
    const card = (c) => {
      const now = c.start <= today;
      return `<article class="card clcard"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:12px">
        <div class="stack" style="gap:4px;min-width:0"><div class="row" style="gap:8px"><b>${esc(c.name)}</b><span class="status ${now ? "open" : "wait"}">${now ? "Closed now" : "Coming up"}</span></div>
          <span style="font-size:13.5px">${clDates(c)}${clDaysLong(c) > 1 ? ` (${plural(clDaysLong(c), "day")})` : ""} · ${esc(clWhere(c))}</span>
          ${c.msg ? `<span class="muted" style="font-size:13px">Clients see: “${esc(c.msg)}”</span>` : ""}
          <span class="muted" style="font-size:12.5px">${c.cancelled ? `${plural(c.cancelled, "class", "classes")} cancelled for this closure` : "No classes were cancelled"} · recurring classes skip these days</span></div>
        <span class="inline2" style="flex-wrap:nowrap"><button type="button" class="btn" data-cledit="${c.id}">Edit</button><button type="button" class="btn ghost danger" data-cldel="${c.id}">Remove</button></span></div></article>`;
    };
    return head("Closures & holidays", "Days you're closed, like public holidays or repairs. Recurring classes skip them, and clients see them on the schedule.", `<button type="button" class="btn primary" id="clNew">+ Add closure</button>`) +
      (upcoming.length ? `<div class="stack">${upcoming.map(card).join("")}</div>` : `<div class="card"><span class="muted">No closures coming up. Add one when you know you'll be closed, and the classes on those days are cancelled in one go.</span></div>`) +
      `<span class="hint">Open on a public holiday? There's nothing to do: classes run as normal unless you add a closure.</span>` +
      (past.length ? `<details class="card"><summary>Past closures (${past.length})</summary><div class="stack" style="margin-top:8px">${past.map((c) => `<span style="font-size:13px">${esc(c.name)} · ${clDates(c)} · ${esc(clWhere(c))}</span>`).join("")}</div></details>` : "");
  };
  BIND.closures = function () {
    $("#clNew").onclick = () => openClosure(null);
    document.querySelectorAll("[data-cledit]").forEach((b) => (b.onclick = () => openClosure(b.dataset.cledit)));
    document.querySelectorAll("[data-cldel]").forEach((b) => (b.onclick = () => removeClosure(CLOSURES.find((c) => c.id === b.dataset.cldel))));
  };

  /** What the new closure will do, shown live in the window as details change. */
  function clSummary(d) {
    if (!d.start || !d.end || d.end < d.start) return "";
    const list = clClasses(d);
    const people = list.reduce((a, s) => a + s.roster.length, 0);
    const other = CLOSURES.filter((c) => c.id !== d.id && c.start <= d.end && c.end >= d.start && (!c.loc || !d.loc || c.loc === d.loc));
    const lines = [];
    if (!list.length) lines.push("No classes are on the schedule for these days.");
    else {
      lines.push(`${plural(list.length, "class is", "classes are")} on the schedule for these days${people ? ` (${plural(people, "person", "people")} booked)` : ", none booked yet"}.`);
      lines.push(d.cancel ? `They'll be cancelled. ${d.notify ? "Everyone booked or on the waitlist gets one message listing their classes." : "Clients will NOT be told."}` : "They stay on the schedule.");
    }
    lines.push("Recurring classes skip these days from now on.");
    if (other.length) lines.push(`Already closed on some of these days: ${other.map((c) => `${esc(c.name)} (${clDates(c)})`).join(", ")}.`);
    return alertBox(list.length && d.cancel ? "warn" : "info", "What will happen", `<span>${lines.join(" ")}</span>${list.length ? `<ul class="terms cllist">${list.slice(0, 6).map((s) => `<li>${esc(TYPES[s.type].name)}, ${fmtDay(s.start)} ${clock(s.start)}${state.loc || d.loc ? "" : ` · ${esc(LOCS[s.loc])}`} · ${s.roster.length} booked</li>`).join("")}${list.length > 6 ? `<li>and ${list.length - 6} more</li>` : ""}</ul>` : ""}`);
  }

  function openClosure(id) {
    const cur = id ? CLOSURES.find((c) => c.id === id) : null;
    const d = cur ? { ...cur } : { name: "", loc: null, start: ymd(addDays(NOW, 7)), end: ymd(addDays(NOW, 7)), msg: "", cancel: true, refund: "credit", notify: true };
    const paint = () => {
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="clForm" role="dialog" aria-modal="true" aria-labelledby="clTitle" style="width:min(560px,100%)"><header><h2 id="clTitle">${cur ? "Edit closure" : "Add a closure"}</h2></header><div class="mb mform">
        <label class="fl">Name ${tip("closureName")}<input id="clN" maxlength="80" value="${esc(d.name)}" placeholder="e.g. Hari Raya Puasa"></label>
        ${cur ? `<div class="fl">When<span style="font-weight:400;font-size:13.5px">${clDates(cur)} · ${esc(clWhere(cur))}</span><span class="h">To change the days or location, remove this closure and add it again.</span></div>` : `
        <label class="fl">Location ${tip("closureLocation")}<select id="clL"><option value="">All locations</option>${Object.entries(LOCS).map(([k, l]) => `<option value="${k}" ${d.loc === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">First day closed<input type="date" id="clS" value="${d.start}" min="${ymd(NOW)}"></label><label class="fl">Last day closed<input type="date" id="clE" value="${d.end}" min="${d.start || ymd(NOW)}"></label></div>`}
        <label class="fl">Message to clients <span class="h">(optional)</span> ${tip("closureMessage")}<textarea id="clM" rows="2" maxlength="500" placeholder="e.g. Back on Monday!">${esc(d.msg || "")}</textarea></label>
        ${cur ? "" : `<label class="check"><input type="checkbox" id="clC" ${d.cancel ? "checked" : ""}> Cancel the classes already on these days ${tip("closureCancel")}</label>
        ${d.cancel ? `<div class="two" style="grid-template-columns:1fr 1fr;margin-left:26px"><label class="fl">Refund ${tip("refund")}<select id="clR"><option value="credit" ${d.refund === "credit" ? "selected" : ""}>Return class credit</option><option value="payment" ${d.refund === "payment" ? "selected" : ""}>Refund payment</option><option value="none" ${d.refund === "none" ? "selected" : ""}>No refund</option></select></label>
          <label class="check" style="align-self:end"><input type="checkbox" id="clT" ${d.notify ? "checked" : ""}> Tell clients</label></div>` : ""}
        <div id="clSum">${clSummary(d)}</div>`}
      </div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">${cur ? "Save" : "Add closure"}</button></footer></form></div>`;
      const keep = () => {
        d.name = $("#clN").value; d.msg = $("#clM").value;
        if (cur) return;
        d.loc = $("#clL").value || null; d.start = $("#clS").value; d.end = $("#clE").value;
        d.cancel = $("#clC").checked;
        if ($("#clR")) { d.refund = $("#clR").value; d.notify = $("#clT").checked; }
      };
      if (!cur) {
        const live = () => { keep(); $("#clSum").innerHTML = clSummary(d); };
        $("#clL").onchange = live;
        // A one-day closure moves as one day; a longer one only moves its end if it would be before the start.
        $("#clS").onchange = () => { const single = d.start === d.end; keep(); if (!d.end || d.end < d.start || single) d.end = d.start; paint(); };
        $("#clE").onchange = live;
        $("#clC").onchange = () => { keep(); paint(); };
        if ($("#clR")) $("#clR").onchange = $("#clT").onchange = live;
      }
      $("#clForm").onsubmit = (e) => {
        e.preventDefault(); keep();
        d.name = d.name.trim(); d.msg = d.msg.trim();
        if (!d.name) { $("#clN").focus(); return toast("Give the closure a name, like “Hari Raya”."); }
        if (cur) { cur.name = d.name; cur.msg = d.msg; closeModal(); render(); return toast("Closure saved."); }
        if (!d.start || !d.end) return toast("Choose the first and last days you're closed.");
        if (d.end < d.start) return toast("The last day can't be before the first day.");
        if (d.end < ymd(NOW)) return toast("Those days have already passed. Choose today or a later date.");
        if (clDaysLong(d) > CL_MAX_DAYS) return toast("A closure can be up to a year long.");
        const list = clClasses(d);
        const booked = list.reduce((a, s) => a + s.roster.length, 0);
        const go = () => {
          const c = { id: `cl${nextClId++}`, name: d.name, loc: d.loc, start: d.start, end: d.end, msg: d.msg, cancelled: 0 };
          CLOSURES.push(c);
          const people = new Set(), staff = new Set();
          if (d.cancel) {
            for (const s of list) { if (d.notify) { s.roster.forEach((r) => people.add(r.ci)); s.waitlist.forEach((w) => people.add(w.ci)); } if (s.instr) staff.add(s.instr); }
            clCancel(c, list);
          }
          closeModal(); renderNav(); render();
          const told = [people.size ? plural(people.size, "client") : "", staff.size ? plural(staff.size, "instructor") : ""].filter(Boolean).join(" and ");
          toast(d.cancel && list.length ? `Closure added. ${plural(list.length, "class", "classes")} cancelled.${told ? ` ${told} told, one message each.` : ""}` : `Closure added for ${clDates(c)}.${list.length ? ` ${plural(list.length, "class stays", "classes stay")} on the schedule.` : ""}`);
        };
        if (!d.cancel || !list.length) return go();
        confirmFlags([{ level: "confirm", title: "Classes will be cancelled", msg: `This will cancel ${plural(list.length, "class", "classes")}${booked ? ` and ${plural(booked, "booking")}` : ""}.${booked && d.refund === "none" ? " Clients will NOT get their class back." : ""} ${d.notify ? "Everyone booked and on the waitlist will get one message about it." : "Clients will NOT be told."}` }], {
          title: "Please check before closing",
          proceedLabel: `Cancel ${plural(list.length, "class", "classes")} and close`,
          back: () => paint(),
          proceed: go,
        });
      };
    };
    paint();
  }

  function removeClosure(c) {
    const still = SESSIONS.filter((s) => s.closure === c.id && s.status === "cancelled" && s.start > NOW).length;
    confirmFlags([{ level: "confirm", title: `Remove “${c.name}”?`, msg: `Recurring classes it left out come back on the schedule.${still ? ` The ${plural(still, "class", "classes")} it cancelled ${still === 1 ? "stays" : "stay"} cancelled, because people were already told and given their class back. Add ${still === 1 ? "it" : "them"} again from the calendar if you need to.` : ""}` }], {
      proceedLabel: "Remove closure",
      proceed: () => { CLOSURES.splice(CLOSURES.indexOf(c), 1); render(); toast(`“${c.name}” removed.`); },
    });
  }

  // --- Menu and help --------------------------------------------------------------------
  Object.assign(FIELD_HELP, {
    closureName: "What clients will see, like “Hari Raya” or “Studio renovation”.",
    closureLocation: "Close one location, or all of them.",
    closureMessage: "Shown on the schedule and in the email, e.g. “Back on Monday!”.",
    closureCancel: "Cancel the classes already on the schedule and tell everyone booked. Turn off to keep them, e.g. for a special event.",
  });
  ICONS.closures = '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M9.5 13.5l5 5M14.5 13.5l-5 5"/>';
  NAV_ORDER.find(([g]) => g === "Setup")[1].splice(3, 0, "closures");
  NAV.push({ id: "closures", roles: ["admin"], label: "Closures & holidays", help: "Days you're closed. Recurring classes skip them and the classes on those days are cancelled in one go." });
  for (const n of NAV) { const id = n.id; n.group = (role) => navGroup(id, role); }
  NAV.sort((a, b) => navRank(a.id, "admin") - navRank(b.id, "admin"));
