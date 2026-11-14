  // ===========================================================================
  // Locations & rooms: locations are set up with the studio during onboarding;
  // rooms can be added, changed and removed here (same rules as the API).
  // ===========================================================================
  let nextRoomNo = 1;
  const upcomingIn = (rk) => SESSIONS.filter((s) => s.room === rk && s.status === "scheduled" && s.start > NOW);
  PAGES.locations = function () {
    const wk = startOfWeek(NOW);
    return head("Locations & rooms", "Your locations are set up with you when you join. Add, change or remove the rooms in each one here.") + Object.entries(LOCS).map(([lk, ln]) => {
      const rooms = Object.entries(ROOMS).filter(([, r]) => r.loc === lk && !r.archived);
      return `<div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start"><div><h3>${esc(ln)}</h3><span class="muted" style="font-size:13px">Singapore time (UTC+8) · ${STUDIO.dst ? "adjusts for daylight saving" : "no daylight saving"}</span></div><button type="button" class="btn" data-roomadd="${lk}">+ Add room</button></div>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Room</th><th class="num">Holds</th><th>Spots clients choose from</th><th class="num">Classes this week</th><th></th></tr></thead><tbody>
        ${rooms.map(([rk, r]) => `<tr><td><b>${esc(r.name)}</b></td><td class="num">${r.cap}</td><td>${r.labels.length ? `${plural(r.labels.length, "spot")} · ${esc(r.labels[0])}${r.labels.length > 1 ? ` to ${esc(r.labels.at(-1))}` : ""}` : '<span class="muted">No named spots</span>'}</td>
          <td class="num">${SESSIONS.filter((s) => s.room === rk && s.status === "scheduled" && s.start >= wk && s.start < addDays(wk, 7)).length}</td>
          <td><span class="inline2" style="flex-wrap:nowrap;justify-content:flex-end"><button type="button" class="btn" data-roomedit="${rk}">Edit</button><button type="button" class="btn ghost danger" data-roomdel="${rk}">Remove</button></span></td></tr>`).join("") || `<tr><td colspan="5" class="muted">No rooms yet. Add one to start scheduling classes here.</td></tr>`}
        </tbody></table></div></div>`;
    }).join("") + `<span class="hint">Need another location? Get in touch and we'll add it for you.</span>`;
  };
  BIND.locations = function () {
    document.querySelectorAll("[data-roomadd]").forEach((b) => (b.onclick = () => openRoom(null, b.dataset.roomadd)));
    document.querySelectorAll("[data-roomedit]").forEach((b) => (b.onclick = () => openRoom(b.dataset.roomedit)));
    document.querySelectorAll("[data-roomdel]").forEach((b) => (b.onclick = () => removeRoom(b.dataset.roomdel)));
  };

  /** Add or edit a room: name, how many it holds, and (optionally) named spots and their layout. */
  function openRoom(rk, loc) {
    const cur = rk ? ROOMS[rk] : null;
    const d = cur ? { name: cur.name, cap: cur.cap, spots: cur.labels.length > 0, labels: [...cur.labels], cols: cur.cols || 4 } : { name: "", cap: 12, spots: false, labels: [], cols: 4 };
    const where = LOCS[cur ? cur.loc : loc];
    // Redrawing removes the focused field, which fires its change event; ignore those mid-redraw.
    let painting = false;
    const paint = () => {
      if (painting) return;
      painting = true;
      try { draw(); } finally { painting = false; }
    };
    const draw = () => {
      const n = d.labels.length;
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="rmForm" role="dialog" aria-modal="true" aria-labelledby="rmTitle" style="width:min(580px,100%)"><header><h2 id="rmTitle">${cur ? `Edit ${esc(cur.name)}` : `New room at ${esc(where)}`}</h2></header><div class="mb mform">
        <label class="fl">Name<input id="rmName" maxlength="120" value="${esc(d.name)}" placeholder="e.g. Reformer Studio"></label>
        <label class="check"><input type="checkbox" id="rmSpots" ${d.spots ? "checked" : ""}> Clients choose a spot (e.g. a reformer or bike) when they book</label>
        ${d.spots ? `
          <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Number of spots<input type="number" id="rmN" min="1" max="200" value="${n || 12}"></label><label class="fl">Spots per row<input type="number" id="rmCols" min="1" max="20" value="${d.cols}"><span class="h">How the room looks when clients pick.</span></label></div>
          <div class="fl">Spot names <span class="h">One per line, front-left first. Or fill them in:</span>
            <div class="copyrow"><input id="rmPrefix" placeholder="e.g. Reformer" value="${esc((d.labels[0] || "").replace(/\s*\d+$/, ""))}" style="background:var(--surface)"><button type="button" class="btn" id="rmFill">Number them</button></div>
            <textarea id="rmLabels" rows="5">${esc(d.labels.join("\n"))}</textarea></div>
          <div class="fl">How clients see it<div class="room" style="margin:0"><div class="front">Front of room · Instructor</div><div class="spots" id="rmGrid"></div></div></div>
          <span class="hint" id="rmHint"></span>`
        : `<label class="fl">Holds (people)<input type="number" id="rmCap" min="1" max="500" value="${d.cap}"></label>`}
        </div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">${cur ? "Save" : "Add room"}</button></footer></form></div>`;
      const keep = () => {
        d.name = $("#rmName").value;
        if ($("#rmCap")) d.cap = Math.max(1, Number($("#rmCap").value) || 1);
        if ($("#rmCols")) d.cols = Math.min(20, Math.max(1, Number($("#rmCols").value) || 4));
        if ($("#rmLabels")) d.labels = $("#rmLabels").value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 200);
      };
      // Spot count, names and layout update in place, so typing and clicking never get interrupted.
      const refresh = () => {
        if (!$("#rmGrid")) return;
        $("#rmGrid").style.cssText = `--cols:${d.cols};--cols-sm:${Math.min(d.cols, 4)}`;
        $("#rmGrid").innerHTML = d.labels.map((l) => `<span class="spot" style="min-height:40px;cursor:default"><span class="sl">${esc(l)}</span></span>`).join("");
        $("#rmHint").textContent = `With named spots, the room holds as many people as it has spots (${d.labels.length}).`;
        if (document.activeElement !== $("#rmLabels")) $("#rmLabels").value = d.labels.join("\n");
        if (document.activeElement !== $("#rmN")) $("#rmN").value = d.labels.length;
      };
      refresh();
      $("#rmSpots").onchange = (e) => { keep(); d.spots = e.target.checked; if (d.spots && !d.labels.length) d.labels = Array.from({ length: Math.min(d.cap, 200) }, (_, i) => `Spot ${i + 1}`); paint(); };
      if ($("#rmFill")) $("#rmFill").onclick = () => { const pre = $("#rmPrefix").value.trim() || "Spot"; const count = Math.min(200, Math.max(1, Number($("#rmN").value) || d.labels.length || 1)); d.labels = Array.from({ length: count }, (_, i) => `${pre} ${i + 1}`); refresh(); };
      if ($("#rmN")) $("#rmN").oninput = () => { const count = Math.min(200, Math.max(1, Number($("#rmN").value) || 1)); const pre = $("#rmPrefix").value.trim() || (d.labels[0] || "Spot 1").replace(/\s*\d+$/, "") || "Spot"; d.labels = Array.from({ length: count }, (_, i) => d.labels[i] || `${pre} ${i + 1}`); refresh(); };
      if ($("#rmCols")) $("#rmCols").oninput = () => { d.cols = Math.min(20, Math.max(1, Number($("#rmCols").value) || 4)); refresh(); };
      if ($("#rmLabels")) $("#rmLabels").oninput = () => { d.labels = $("#rmLabels").value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 200); refresh(); };
      $("#rmForm").onsubmit = (e) => {
        e.preventDefault(); keep();
        if (!d.name.trim()) { $("#rmName").focus(); return toast("Give the room a name."); }
        if (d.spots && !d.labels.length) return toast("Add at least one spot, or switch spot choosing off.");
        const cap = d.spots ? d.labels.length : d.cap;
        const labels = d.spots ? d.labels : [];
        const save = () => {
          if (cur) {
            // Bookings on spots that no longer exist keep their place, without a spot number.
            upcomingIn(rk).forEach((s) => s.roster.forEach((r) => { if (r.spot && r.spot > labels.length) r.spot = null; }));
            Object.assign(cur, { name: d.name.trim(), cap, labels, cols: d.cols });
          } else {
            const key = `nr${nextRoomNo++}`;
            ROOMS[key] = { name: d.name.trim(), cap, loc, labels, cols: d.cols };
          }
          closeModal(); render(); toast(cur ? "Room saved." : `${d.name.trim()} added. You can schedule classes in it now.`);
        };
        if (!cur) return save();
        const up = upcomingIn(rk);
        const flags = [];
        const big = up.filter((s) => s.cap > cap);
        if (big.length) {
          const over = big.filter((s) => s.roster.length > cap).length;
          flags.push({ level: "confirm", title: "Classes are bigger than the room", msg: `${plural(big.length, "upcoming class is", "upcoming classes are")} set for more than the ${cap} people ${d.name.trim()} will hold${over ? `, and ${over} already ${over === 1 ? "has" : "have"} more bookings than that` : ""}. ${big.length === 1 ? "It keeps its" : "They keep their"} numbers; change ${big.length === 1 ? "it" : "them"} if needed.` });
        }
        const lost = up.reduce((a, s) => a + s.roster.filter((r) => r.spot && r.spot > labels.length).length, 0);
        if (lost) flags.push({ level: "confirm", title: "Some booked spots will go", msg: `${plural(lost, "upcoming booking has a spot", "upcoming bookings have spots")} that won't exist any more. ${lost === 1 ? "It keeps its place" : "They keep their places"} in class, just without a spot number.` });
        confirmFlags(flags, { proceed: save, proceedLabel: "Save anyway", back: paint });
      };
      setTimeout(() => $("#rmName")?.focus(), 0);
    };
    paint();
  }

  /** Remove a room: its upcoming classes move to another room at the same location. */
  function removeRoom(rk) {
    const r = ROOMS[rk];
    const up = upcomingIn(rk);
    const others = Object.entries(ROOMS).filter(([k, x]) => k !== rk && x.loc === r.loc && !x.archived);
    const finish = (target) => {
      up.forEach((s) => {
        s.room = target;
        const keep = ROOMS[target].labels.length;
        s.roster.forEach((b) => { if (b.spot && b.spot > keep) b.spot = null; });
      });
      Object.values(TEMPLATES).forEach((t) => { if (t.room === rk) t.room = target; });
      r.archived = true;
      closeModal(); render();
      toast(!up.length ? `${r.name} removed.` : target.startsWith("none_") ? `${r.name} removed. ${up.length === 1 ? "Its upcoming class stays" : `Its ${up.length} upcoming classes stay`} on the schedule without a room until you choose one.` : `${r.name} removed. ${plural(up.length, "upcoming class", "upcoming classes")} moved to ${ROOMS[target].name}.`);
    };
    if (!up.length) {
      confirmFlags([{ level: "confirm", title: `Remove ${r.name}?`, msg: "It has no upcoming classes. Past classes keep it in their history." }], { proceedLabel: "Remove room", proceed: () => { Object.values(TEMPLATES).forEach((t) => { if (t.room === rk && others[0]) t.room = others[0][0]; }); r.archived = true; render(); toast(`${r.name} removed.`); } });
      return;
    }
    const placeholder = `none_${r.loc}`;
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="rrForm" role="dialog" aria-modal="true" aria-labelledby="rrTitle"><header><h2 id="rrTitle">Remove ${esc(r.name)}?</h2></header><div class="mb mform">
      <p style="margin:0;font-size:14px">${plural(up.length, "upcoming class is", "upcoming classes are")} in ${esc(r.name)}. Past classes keep it in their history.</p>
      ${others.length ? `<label class="fl">Move ${up.length === 1 ? "it" : "them"}, with ${up.length === 1 ? "its" : "their"} bookings, to<select id="rrTo">${others.map(([k, x]) => `<option value="${k}">${esc(x.name)} (holds ${x.cap}${x.labels.length ? `, ${plural(x.labels.length, "spot")}` : ""})</option>`).join("")}</select></label><div id="rrNote"></div>` : alertBox("warn", "", `This is the only room at ${esc(LOCS[r.loc])}. ${up.length === 1 ? "The class" : "The classes"} will stay on the schedule, with bookings, but without a room until you choose one.`)}
      </div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn danger">Remove room</button></footer></form></div>`;
    const note = () => {
      if (!$("#rrTo")) return;
      const t = ROOMS[$("#rrTo").value];
      const big = up.filter((s) => s.cap > t.cap).length;
      const spotsLost = up.reduce((a, s) => a + s.roster.filter((b) => b.spot && b.spot > t.labels.length).length, 0);
      $("#rrNote").innerHTML = big || spotsLost ? alertBox("warn", "", [big ? `${plural(big, "class is", "classes are")} set for more than ${esc(t.name)} holds (${t.cap}). ${big === 1 ? "It keeps its" : "They keep their"} numbers; change ${big === 1 ? "it" : "them"} if needed.` : "", spotsLost ? `${plural(spotsLost, "booking loses its spot number", "bookings lose their spot numbers")} (${esc(t.name)} ${t.labels.length ? `has ${plural(t.labels.length, "spot")}` : "has no named spots"}).` : ""].filter(Boolean).join(" ")) : "";
    };
    if ($("#rrTo")) { $("#rrTo").onchange = note; note(); }
    $("#rrForm").onsubmit = (e) => {
      e.preventDefault();
      if ($("#rrTo")) return finish($("#rrTo").value);
      ROOMS[placeholder] = ROOMS[placeholder] || { name: "Room to be chosen", cap: 999, loc: r.loc, labels: [], cols: 4, archived: true };
      finish(placeholder);
    };
  }

  // ===========================================================================
  // Banner rotation: several banners in one place take turns.
  // ===========================================================================
  let BANNER_ROTATE = 6;
  let carouselTimer = null;
  function carouselHTML(list) {
    if (list.length === 1) return `<div class="bnrs one"><button type="button" class="bnrbtn" data-btap="${list[0].id}" aria-label="${esc(list[0].title)}">${bannerView(list[0])}</button></div>`;
    return `<div class="bcar" role="region" aria-roledescription="carousel" aria-label="Offers and news" data-idx="0">
      <div class="btrack">${list.map((b, i) => `<button type="button" class="bnrbtn" data-btap="${b.id}" aria-roledescription="slide" aria-label="${i + 1} of ${list.length}: ${esc(b.title)}" ${i ? 'tabindex="-1"' : ""}>${bannerView(b)}</button>`).join("")}</div>
      <button type="button" class="bnav prev" aria-label="Previous">‹</button><button type="button" class="bnav next" aria-label="Next">›</button>
      <div class="bdots">${list.map((b, i) => `<button type="button" data-bdot="${i}" aria-label="Show banner ${i + 1}" aria-current="${i === 0}"></button>`).join("")}</div></div>`;
  }
  function startCarousels() {
    clearInterval(carouselTimer);
    const cars = [...document.querySelectorAll(".bcar")];
    if (!cars.length) return;
    const show = (car, i) => {
      const slides = car.querySelectorAll(".bnrbtn");
      const n = slides.length;
      i = ((i % n) + n) % n;
      car.dataset.idx = i;
      car.querySelector(".btrack").style.transform = `translateX(-${i * 100}%)`;
      slides.forEach((sl, k) => sl.setAttribute("tabindex", k === i ? "0" : "-1"));
      car.querySelectorAll("[data-bdot]").forEach((d, k) => d.setAttribute("aria-current", String(k === i)));
    };
    cars.forEach((car) => {
      car.querySelector(".prev").onclick = () => show(car, Number(car.dataset.idx) - 1);
      car.querySelector(".next").onclick = () => show(car, Number(car.dataset.idx) + 1);
      car.querySelectorAll("[data-bdot]").forEach((d) => (d.onclick = () => show(car, Number(d.dataset.bdot))));
      // Pause while someone is pointing at, touching or tabbing through it.
      const pause = () => (car.dataset.paused = "1"), resume = () => delete car.dataset.paused;
      car.onmouseenter = pause; car.onmouseleave = resume; car.onfocusin = pause; car.onfocusout = resume;
      car.ontouchstart = pause; car.ontouchend = () => setTimeout(resume, 4000);
      let x0 = null;
      car.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
      car.addEventListener("touchend", (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(car, Number(car.dataset.idx) + (dx < 0 ? 1 : -1)); x0 = null; }, { passive: true });
    });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    carouselTimer = setInterval(() => cars.forEach((car) => { if (!car.isConnected) return; if (!car.dataset.paused) show(car, Number(car.dataset.idx) + 1); }), BANNER_ROTATE * 1000);
  }
