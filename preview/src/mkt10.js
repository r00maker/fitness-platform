  // ===========================================================================
  // Calendar shortcuts (double-click to add, drag to move), classes without a room, class types
  // split into classes and appointments, and a tidier Categories window.
  // ===========================================================================

  // --- Classes without a room ----------------------------------------------------
  // Some locations are one open space. A class there has no room (room_id is null in the API);
  // here it uses a stand-in per location, so every screen still knows where it is.
  for (const lk of Object.keys(LOCS)) if (!ROOMS[`none_${lk}`]) ROOMS[`none_${lk}`] = { name: "No room", cap: 999, loc: lk, labels: [], cols: 1, none: true };
  const roomOrLoc = (rk) => (ROOMS[rk]?.none ? LOCS[ROOMS[rk].loc] : ROOMS[rk]?.name || "");

  // --- Calendar: double-click an empty time to add a class; drag a class to move it ---
  const SNAP = 15;
  const minsAt = (col, clientY) => {
    const y = clientY - col.getBoundingClientRect().top;
    const m = HOURS[0] * 60 + y / (HOUR_PX / 60);
    return Math.max(HOURS[0] * 60, Math.min(HOURS[1] * 60 - SNAP, Math.round(m / SNAP) * SNAP));
  };
  const atMins = (date, m) => fromYmdHm(date, `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  const canEditCal = () => state.role === "admin" && !state.selecting;

  $("#canvas").addEventListener("dblclick", (e) => {
    if (!canEditCal() || e.target.closest(".ev")) return;
    const col = e.target.closest(".dcol[data-date]");
    if (!col) return;
    const start = atMins(col.dataset.date, minsAt(col, e.clientY));
    if (start < NOW) return toast("That time has passed. Double-click a time from now on to add a class.");
    confirmFlags([{ level: "confirm", title: "Add a class here?", msg: `Add a new class on ${fmtDay(start)} at ${clock(start)}? You'll choose the details next.` }], {
      title: "Add a class",
      proceedLabel: "Add a class",
      proceed: () => { closeModal(); openForm(null, { ...FORM_DEFAULTS, date: ymd(start), start: hhmm(start) }); },
    });
  });

  let drag = null, swallowClick = false;
  $("#canvas").addEventListener("pointerdown", (e) => {
    if (!canEditCal() || e.button !== 0 || e.pointerType !== "mouse") return;
    const ev = e.target.closest(".ev");
    const btn = ev?.querySelector("[data-open]");
    if (!btn) return;
    const s = SESSIONS.find((x) => x.id === Number(btn.dataset.open));
    if (!s || s.status !== "scheduled" || s.start < NOW) return;
    const col = ev.closest(".dcol");
    drag = { s, ev, x: e.clientX, y: e.clientY, grab: minsAt(col, e.clientY) - (s.start.getHours() * 60 + s.start.getMinutes()), moving: false, to: null };
  });
  document.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.moving = true;
      drag.ev.classList.add("dragging");
      drag.ghost = document.createElement("div");
      drag.ghost.className = "evghost";
      drag.ghost.style.height = drag.ev.style.height;
      document.body.classList.add("caldrag");
    }
    drag.ev.style.pointerEvents = "none";
    const col = document.elementFromPoint(e.clientX, e.clientY)?.closest(".dcol[data-date]");
    drag.ev.style.pointerEvents = "";
    if (!col) return;
    const m = Math.max(HOURS[0] * 60, Math.min(HOURS[1] * 60 - mins(drag.s), minsAt(col, e.clientY) - drag.grab));
    const sm = Math.round(m / SNAP) * SNAP;
    drag.to = atMins(col.dataset.date, sm);
    if (drag.ghost.parentNode !== col) col.appendChild(drag.ghost);
    drag.ghost.style.top = `${(sm - HOURS[0] * 60) * (HOUR_PX / 60)}px`;
    drag.ghost.textContent = `${short(drag.to)} – ${short(addMin(drag.to, mins(drag.s)))}`;
  });
  document.addEventListener("pointerup", () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.body.classList.remove("caldrag");
    if (!d.moving) return;
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
    d.ghost?.remove(); d.ev.classList.remove("dragging");
    if (!d.to || +d.to === +d.s.start) return;
    if (d.to < NOW) { toast("Classes can't be moved to a time that has passed."); return render(); }
    moveClass(d.s, d.to);
  });
  // The click that ends a drag shouldn't also open the class.
  document.addEventListener("click", (e) => { if (swallowClick && e.target.closest("#canvas")) { e.stopPropagation(); e.preventDefault(); swallowClick = false; } }, true);

  function moveClass(s, to) {
    const cand = { tpl: s.tpl, start: to, end: addMin(to, mins(s)), type: s.type, instr: s.instr || null, room: s.room, loc: s.loc, cap: s.cap };
    const v = { ...fromSession(s), date: ymd(to), start: hhmm(to), cpOn: s.cpOn, cpSpots: s.cpSpots, ac: s.ac };
    const n = s.roster.length + s.waitlist.length;
    const noun = isAppt(s) ? "appointment" : "class";
    const flags = [
      { level: "confirm", title: `Move this ${noun}?`, msg: `Move ${TYPES[s.type].name} from ${fmtDay(s.start)} at ${clock(s.start)} to ${fmtDay(to)} at ${clock(to)}?${n ? ` ${plural(n, "person who's booked or waiting", "people who are booked or waiting")} will be told about the new time.` : " Nobody is booked yet."}${s.series ? " Only this one moves; the rest of the series stays where it is." : ""}` },
      ...checks(cand, { excludeId: s.id, checkList: false }).filter((f) => f.level === "confirm" || f.title !== "No instructor yet"),
    ];
    confirmFlags(flags, {
      title: `Move this ${noun}?`,
      proceedLabel: "Move it",
      back: () => { closeModal(); render(); },
      proceed: (notes) => { closeModal(); save([{ t: s, cand }], v, s, notes); },
    });
  }

  // --- Class types: classes and appointments listed separately ---------------------
  PAGES["class-types"] = function () {
    const wk = startOfWeek(NOW);
    const thisWeek = (k) => SESSIONS.filter((s) => s.type === k && s.status === "scheduled" && s.start >= wk && s.start < addDays(wk, 7)).length;
    const teach = (k) => `<span class="tags">${TEACH[k].length ? TEACH[k].map((i) => `<span class="pchip">${instrAvatar(i, "sm")}${esc(STAFF[i])}</span>`).join("") : '<span class="muted">Anyone who teaches</span>'}</span>`;
    const acts = (k) => `<td><div class="inline2" style="flex-wrap:nowrap"><button type="button" class="btn ghost" data-edittype="${k}" data-help="Change the name, colour or kind.">Edit</button><button type="button" class="btn ghost danger" data-deltype="${k}" data-help="Remove this type. Not possible while it's on the calendar.">Delete</button></div></td>`;
    const all = Object.entries(liveTypes());
    const classes = all.filter(([, t]) => t.kind !== "appointment"), appts = all.filter(([, t]) => t.kind === "appointment");
    const pkgsFor = (k) => PLANS.filter((p) => !p.archived && p.types.includes(k));
    return head("Class types", "Your group classes and private appointments, their calendar colours and who can teach them.", `<button type="button" class="btn" id="editTeach" data-help="Choose which instructors teach and cover each class and appointment.">Edit teaching lists</button>`) +
      `<section class="ctsec"><div class="ctsec-h"><div><h3>Classes</h3><span class="muted">Group classes on the schedule. Clients book a spot.</span></div><button type="button" class="btn primary" id="newType" data-newtype="class">+ New class</button></div>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Class</th><th>Usual length</th><th>Templates</th><th>Who teaches and covers</th><th class="num">This week</th><th></th></tr></thead><tbody>
        ${classes.map(([k, t]) => `<tr><td><div class="cellp">${sw(k)}<b>${esc(t.name)}</b></div></td><td>${t.usual} min</td><td>${TEMPLATE_LIST.filter((x) => x.type === k).map((x) => esc(x.label)).join("<br>") || '<span class="muted">None</span>'}</td><td>${teach(k)}</td><td class="num">${thisWeek(k)}</td>${acts(k)}</tr>`).join("") || '<tr><td colspan="6" class="muted">No classes yet.</td></tr>'}
        </tbody></table></div></section>
      <section class="ctsec"><div class="ctsec-h"><div><h3>Appointments</h3><span class="muted">Private or small-group sessions you book clients into. They need a package that covers them.</span></div><button type="button" class="btn primary" data-newtype="appointment">+ New appointment type</button></div>
        <div class="tblwrap"><table class="tbl"><thead><tr><th>Appointment</th><th>Usual length</th><th>Packages that cover it</th><th>Who teaches</th><th class="num">This week</th><th></th></tr></thead><tbody>
        ${appts.map(([k, t]) => `<tr><td><div class="cellp">${sw(k)}<b>${esc(t.name)}</b></div></td><td>${t.usual} min</td><td>${pkgsFor(k).map((p) => esc(p.name)).join("<br>") || '<span class="muted">None yet. Add one under Packages.</span>'}</td><td>${teach(k)}</td><td class="num">${thisWeek(k)}</td>${acts(k)}</tr>`).join("") || '<tr><td colspan="6" class="muted">No appointment types yet.</td></tr>'}
        </tbody></table></div></section>`;
  };
  BIND["class-types"] = function () {
    $("#editTeach").onclick = () => openTeachLists();
    document.querySelectorAll("[data-newtype]").forEach((b) => (b.onclick = () => openTypeEditor(null, b.dataset.newtype)));
    document.querySelectorAll("[data-edittype]").forEach((b) => (b.onclick = () => openTypeEditor(b.dataset.edittype)));
    document.querySelectorAll("[data-deltype]").forEach((b) => (b.onclick = () => deleteType(b.dataset.deltype)));
  };

  // --- Categories: one row per category; open one to rename it, describe it and choose its packages ---
  function openCategories(focusId) {
    const live = () => PLANS.filter((pl) => !pl.archived);
    const inCat = (id) => live().filter((pl) => (id ? pl.cat === id : !CATS.some((c) => c.id === pl.cat)));
    const where = (pl) => CATS.find((x) => x.id === pl.cat)?.name || "No category";
    const moveTo = (pl, catId) => { PLANS.splice(PLANS.indexOf(pl), 1); pl.cat = catId; const last = PLANS.map((x) => x.cat === catId).lastIndexOf(true); PLANS.splice(last + 1, 0, pl); };
    let open = focusId || null, adding = false;
    const paint = () => {
      const scroller = document.querySelector("#catForm .mb");
      const top = scroller ? scroller.scrollTop : 0;
      const loose = inCat(null);
      const pkgRow = (pl, j, n, catId) => `<li><span class="grow"><b>${esc(pl.name)}</b><span class="sub">${[m$(pl.price), pl.onSale ? "" : "Not on sale"].filter(Boolean).join(" · ")}</span></span>
        ${catId ? `<button type="button" class="iconbtn" data-cbmove="${pl.id}:-1" aria-label="Move ${esc(pl.name)} up" ${j === 0 ? "disabled" : ""}>↑</button><button type="button" class="iconbtn" data-cbmove="${pl.id}:1" aria-label="Move ${esc(pl.name)} down" ${j === n - 1 ? "disabled" : ""}>↓</button><button type="button" class="tagbtn" data-cbout="${pl.id}" data-help="Take it out of this category. It stays on sale, under “Other”.">Take out</button>`
          : CATS.length ? `<select data-cbto="${pl.id}" aria-label="Move ${esc(pl.name)} to a category"><option value="">Move to…</option>${CATS.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>` : ""}</li>`;
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal catmodal" id="catForm" role="dialog" aria-modal="true" aria-labelledby="catTitle"><header><h2 id="catTitle">Categories</h2></header>
        <div class="mb"><span class="hint">The groups on the buying page, in this order. Open one to rename it or choose its packages.</span>
          <div class="catacc">${CATS.map((c, i) => {
            const items = inCat(c.id), isOpen = open === c.id;
            const others = live().filter((pl) => pl.cat !== c.id);
            return `<section class="catrow ${isOpen ? "open" : ""}" id="cb-${c.id}">
              <div class="catrow-h"><button type="button" class="catrow-t" data-catopen="${c.id}" aria-expanded="${isOpen}"><span class="chev" aria-hidden="true">›</span><b>${esc(c.name)}</b><span class="muted">${plural(items.length, "package")}</span></button>
                <button type="button" class="iconbtn" data-catmove="${i}:-1" aria-label="Move ${esc(c.name)} up" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="iconbtn" data-catmove="${i}:1" aria-label="Move ${esc(c.name)} down" ${i === CATS.length - 1 ? "disabled" : ""}>↓</button></div>
              ${isOpen ? `<div class="catrow-b">
                <label class="fl">Name<input type="text" value="${esc(c.name)}" data-catname="${c.id}" maxlength="60"></label>
                <label class="fl">Description <span class="h">(optional, shown under the name)</span><textarea data-catdesc="${c.id}" rows="2" maxlength="300" placeholder="e.g. Renew every month. Stop any time after the minimum term.">${esc(c.desc || "")}</textarea></label>
                <div class="fl">Packages, in this order<ul class="cblist" aria-label="Packages in ${esc(c.name)}">${items.map((pl, j) => pkgRow(pl, j, items.length, c.id)).join("") || '<li class="empty">No packages yet.</li>'}</ul>
                ${others.length ? `<select class="cbadd" data-cbadd="${c.id}" aria-label="Add a package to ${esc(c.name)}"><option value="">+ Add a package…</option>${others.map((pl) => `<option value="${pl.id}">${esc(pl.name)} (now in ${esc(where(pl))})</option>`).join("")}</select>` : ""}</div>
                <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost danger" data-catdel="${c.id}" data-help="Its packages stay on sale, under “Other”.">Remove category</button></div>
              </div>` : ""}</section>`;
          }).join("")}
          ${loose.length ? `<section class="catrow loose ${open === "none" ? "open" : ""}"><div class="catrow-h"><button type="button" class="catrow-t" data-catopen="none" aria-expanded="${open === "none"}"><span class="chev" aria-hidden="true">›</span><b>No category</b><span class="muted">${plural(loose.length, "package")} · shown under “Other”</span></button></div>
            ${open === "none" ? `<div class="catrow-b"><ul class="cblist">${loose.map((pl) => pkgRow(pl, 0, 1, null)).join("")}</ul></div>` : ""}</section>` : ""}</div>
          ${adding ? `<div class="catnew"><input id="catNew" type="text" maxlength="60" placeholder="Category name, e.g. Corporate packages" aria-label="New category name"><button type="button" class="btn primary" id="catAdd">Add</button><button type="button" class="btn ghost" id="catAddX">Cancel</button></div>`
            : `<button type="button" class="btn ghost" id="catAddOpen" style="align-self:flex-start">+ Add a category</button>`}
        </div>
        <footer><button type="submit" class="btn primary">Done</button></footer></form></div>`;
      const body = document.querySelector("#catForm .mb");
      body.scrollTop = top;
      if (focusId) { const el = $(`#cb-${focusId}`); if (el) { el.scrollIntoView({ block: "nearest" }); el.classList.add("flash"); } focusId = null; }
      const keep = () => {
        document.querySelectorAll("[data-catname]").forEach((el) => { const c = CATS.find((x) => x.id === el.dataset.catname); if (c && el.value.trim()) c.name = el.value.trim(); });
        document.querySelectorAll("[data-catdesc]").forEach((el) => { const c = CATS.find((x) => x.id === el.dataset.catdesc); if (c) c.desc = el.value.trim(); });
      };
      document.querySelectorAll("[data-catopen]").forEach((b) => (b.onclick = () => { keep(); open = open === b.dataset.catopen ? null : b.dataset.catopen; paint(); }));
      document.querySelectorAll("[data-catmove]").forEach((b) => (b.onclick = () => { keep(); const [i, dir] = b.dataset.catmove.split(":").map(Number); const [c] = CATS.splice(i, 1); CATS.splice(i + dir, 0, c); paint(); }));
      document.querySelectorAll("[data-catdel]").forEach((b) => (b.onclick = () => { keep(); const c = CATS.find((x) => x.id === b.dataset.catdel); const n = inCat(c.id).length; CATS.splice(CATS.indexOf(c), 1); open = null; paint(); toast(`Removed “${c.name}”.${n ? ` ${plural(n, "package")} moved to No category.` : ""}`); }));
      document.querySelectorAll("[data-cbmove]").forEach((b) => (b.onclick = () => {
        keep();
        const [id, dir] = b.dataset.cbmove.split(":"); const pl = PLANS.find((x) => x.id === id);
        const sibs = inCat(pl.cat); const other = sibs[sibs.indexOf(pl) + Number(dir)];
        if (other) { const a = PLANS.indexOf(pl), z = PLANS.indexOf(other); [PLANS[a], PLANS[z]] = [PLANS[z], PLANS[a]]; }
        paint();
      }));
      document.querySelectorAll("[data-cbout]").forEach((b) => (b.onclick = () => { keep(); moveTo(PLANS.find((x) => x.id === b.dataset.cbout), null); paint(); }));
      document.querySelectorAll("[data-cbadd]").forEach((el) => (el.onchange = () => { if (!el.value) return; keep(); moveTo(PLANS.find((x) => x.id === el.value), el.dataset.cbadd); paint(); }));
      document.querySelectorAll("[data-cbto]").forEach((el) => (el.onchange = () => { if (!el.value) return; keep(); moveTo(PLANS.find((x) => x.id === el.dataset.cbto), el.value); paint(); }));
      if ($("#catAddOpen")) $("#catAddOpen").onclick = () => { keep(); adding = true; paint(); $("#catNew").focus(); };
      if ($("#catAddX")) $("#catAddX").onclick = () => { adding = false; paint(); };
      if ($("#catAdd")) {
        const add = () => {
          const n = $("#catNew").value.trim();
          if (!n) { $("#catNew").focus(); return toast("Give the category a name."); }
          keep(); const id = `c${nextCatId++}`; CATS.push({ id, name: n, desc: "" }); adding = false; open = id; focusId = id; paint();
        };
        $("#catAdd").onclick = add;
        $("#catNew").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
      }
      $("#catForm").onsubmit = (e) => { e.preventDefault(); keep(); closeModal(); render(); toast("Categories saved."); };
    };
    paint();
  }
