  // ===========================================================================
  // Home: the studio's front page for staff. Same rules as GET /dashboard
  // (apps/api/src/modules/dashboard/service.ts):
  //  - Today: one headline number (people booked), how full, what's next, each class's to-dos.
  //  - Needs attention: a short to-do list, most urgent first, only what this person can act on.
  //  - How it's going: the same sums as Reports, for the last 7 or 30 days against the period before.
  //  - The week ahead: how full the next 7 days are; closures and quiet classes coming up.
  // Clients keep "Book a class" as their front page.
  // ===========================================================================
  state.home = { days: 7, loc: "", table: false };
  const HOME_NAME = { admin: "Olivia", foh: "Fiona", instructor: "Ana" };
  const SEV = {
    urgent: { label: "Urgent", icon: "!" },
    soon: { label: "Soon", icon: "◷" },
    fyi: { label: "When you can", icon: "i" },
  };
  const homeOwn = () => state.role === "instructor";
  const inScope = (s) => (!state.home.loc || s.loc === state.home.loc) && (!homeOwn() || s.instr === ME.instructor);
  const live = (s) => s.status === "scheduled" && inScope(s);
  const hp = (n, one, many) => plural(n, one, many);

  function homeToday() {
    const list = SESSIONS.filter((s) => live(s) && sameDay(s.start, NOW)).sort((a, b) => a.start - b.start).map((s) => {
      const state_ = NOW >= s.end ? "finished" : NOW >= s.start ? "on_now" : "upcoming";
      const missing = s.roster.filter((r) => waiverMissing(CLIENTS[r.ci])).length;
      const unmarked = s.roster.filter((r) => r.att === "unmarked").length;
      const attOpen = NOW >= addMin(s.start, -60);
      const todo = [];
      if (!s.instr) todo.push({ kind: "no_instructor", text: "No instructor" });
      if (missing && state_ !== "finished") todo.push({ kind: "waiver", text: `${hp(missing, "waiver")} missing` });
      if (attOpen && unmarked && s.roster.length) todo.push({ kind: "attendance", text: state_ === "finished" ? `Attendance not taken (${unmarked})` : "Take attendance" });
      return { s, state: state_, todo };
    });
    const booked = list.reduce((a, x) => a + x.s.roster.length, 0), cap = list.reduce((a, x) => a + x.s.cap, 0);
    const next = list.find((x) => x.state === "on_now") || list.find((x) => x.state === "upcoming") || null;
    return { list, booked, cap, fill: pctOf(booked, cap), waiting: list.reduce((a, x) => a + x.s.waitlist.length, 0), next };
  }

  function homeAttention() {
    const out = [], role = state.role;
    const in48 = addMin(NOW, 48 * 60), in7 = addDays(NOW, 7);
    const sOf = (id) => SESSIONS.find((x) => x.id === id);
    if (role === "admin") {
      const cover = REQUESTS.filter((r) => (r.status === "open" || r.status === "awaiting") && sOf(r.sid) && sOf(r.sid).start > NOW && inScope({ ...sOf(r.sid), instr: null }));
      if (cover.length) {
        const soon = cover.filter((r) => sOf(r.sid).start < in48).length, ok = cover.filter((r) => r.status === "awaiting").length;
        out.push({ kind: "cover", sev: soon ? "urgent" : "soon", count: cover.length, title: `${hp(cover.length, "class needs", "classes need")} cover`, detail: [soon ? `${soon} in the next 2 days` : "", ok ? `${ok} waiting for your OK` : ""].filter(Boolean).join(" · ") || "Nobody has taken it yet", go: "cover", label: "Open cover requests" });
      }
      const noInstr = SESSIONS.filter((s) => live(s) && !s.instr && s.start > NOW && s.start < in7);
      if (noInstr.length) {
        const soon = noInstr.filter((s) => s.start < in48).length;
        out.push({ kind: "no_instructor", sev: soon ? "urgent" : "soon", count: noInstr.length, title: `${hp(noInstr.length, "class has", "classes have")} no instructor`, detail: soon ? `${soon} in the next 2 days` : "In the next 7 days", ...(noInstr.length === 1 ? { open: noInstr[0].id, label: "Open the class" } : { go: "schedule", label: "See the schedule" }) });
      }
      const risky = SESSIONS.filter((s) => live(s) && s.ac && s.start > NOW && s.roster.length < s.ac.min && addMin(s.start, -s.ac.h * 60) < addMin(NOW, 24 * 60));
      if (risky.length) out.push({ kind: "auto_cancel", sev: "soon", count: risky.length, title: `${hp(risky.length, "class", "classes")} may cancel automatically`, detail: "Fewer people booked than the minimum, with the cut-off in the next 24 hours", ...(risky.length === 1 ? { open: risky[0].id, label: "Open the class" } : { go: "schedule", label: "See the schedule" }) });
    }
    if (role !== "client") {
      const coming = SESSIONS.filter((s) => live(s) && s.start > NOW && s.start < in48);
      const missing = new Set(coming.flatMap((s) => s.roster.filter((r) => waiverMissing(CLIENTS[r.ci])).map((r) => r.ci)));
      if (missing.size) out.push({ kind: "waivers", sev: "urgent", count: missing.size, title: `${hp(missing.size, "client", "clients")} coming soon without a waiver`, detail: "Booked in the next 2 days. Ask them to sign before class, or mark a paper waiver as done", go: "schedule", label: "See today's classes" });
      const toMark = SESSIONS.filter((s) => live(s) && s.end < NOW && s.end > addMin(NOW, -24 * 60) && s.roster.some((r) => r.att === "unmarked"));
      if (toMark.length) out.push({ kind: "attendance", sev: "soon", count: toMark.length, title: `Attendance not taken for ${hp(toMark.length, "class", "classes")}`, detail: "Finished in the last 24 hours. Pay and no-show fees depend on it", ...(toMark.length === 1 ? { open: toMark[0].id, label: "Take attendance" } : { go: "schedule", label: "See the schedule" }) });
    }
    if (role === "instructor") {
      const forMe = REQUESTS.filter((r) => r.status === "open" && r.by !== ME.instructor && (!r.invited.length || r.invited.includes(ME.instructor)) && !r.responses[ME.instructor]);
      if (forMe.length) out.unshift({ kind: "cover", sev: "soon", count: forMe.length, title: `${hp(forMe.length, "cover request")} for you`, detail: "Say yes or no so the studio knows", go: "cover", label: "Open cover requests" });
    }
    if (role === "admin") {
      const fees = FEES.filter((f) => f.status === "pending");
      if (fees.length) out.push({ kind: "fees", sev: "fyi", count: fees.length, title: `${hp(fees.length, "fee")} to collect or waive`, detail: `${m$c(fees.reduce((a, f) => a + f.cents, 0))} in late-cancellation and no-show fees`, go: "fees", label: "Open fees" });
      const ext = EXTREQ.filter((r) => r.status === "pending").length, conf = ORDERS.filter((o) => o.status === "pending").length;
      if (ext || conf) out.push({ kind: "packages", sev: "soon", count: ext + conf, title: [ext ? hp(ext, "extension request") : "", conf ? `${hp(conf, "order")} to confirm` : ""].filter(Boolean).join(" and "), detail: conf ? "Mark orders paid when clients pay at the desk, so their package starts" : "Clients are waiting for an answer", go: "packages", label: "Open packages" });
    }
    if (role === "admin" || role === "foh") {
      const pick = SHOP_ORDERS.filter((o) => o.status === "waiting").length + (role === "foh" ? LOY_PICKUPS.filter((x) => x.status === "waiting").length : 0);
      if (pick) out.push({ kind: "pickups", sev: "fyi", count: pick, title: `${hp(pick, role === "foh" ? "order" : "shop order")} to hand over`, detail: role === "foh" ? "Shop orders and rewards waiting at the front desk" : "Waiting at the front desk", go: role === "foh" ? "pickups" : "shop", label: role === "foh" ? "Open pickups" : "Open the shop" });
      const unread = unreadTotal();
      if (unread) out.push({ kind: "messages", sev: "fyi", count: unread, title: `${hp(unread, "unread message")}`, detail: "From clients on WhatsApp and email", go: "comms", label: "Open Communication" });
    }
    if (role === "admin" || role === "foh") {
      const low = typeof lowToHandle === "function" ? lowToHandle().length : 0, fresh = typeof fbNew === "function" ? fbNew().length : 0;
      if (low) out.push({ kind: "low_reviews", sev: "soon", count: low, title: `${hp(low, "low review")} to follow up`, detail: "2 stars or fewer. A quick, kind reply often wins a client back", go: "feedback", label: "Open Feedback" });
      if (fresh) out.push({ kind: "feedback", sev: "fyi", count: fresh, title: `${hp(fresh, "new piece", "new pieces")} of feedback`, detail: "From clients, waiting for a reply", go: "feedback", label: "Open Feedback" });
    }
    const order = { urgent: 0, soon: 1, fyi: 2 };
    return out.sort((a, b) => order[a.sev] - order[b.sev]);
  }

  /** The same sums as Reports, so the two pages always agree. */
  function homeKpis() {
    const days = state.home.days;
    const from = addDays(day(NOW), -days + 1), to = addDays(day(NOW), 1), prevFrom = addDays(from, -days);
    const scoped = (cls) => cls.filter((c) => (!state.home.loc || c.loc === state.home.loc) && (!homeOwn() || c.instr === ME.instructor));
    const cur = rangeStats(from, to), prev = rangeStats(prevFrom, from);
    const booked = (cls) => scoped(cls).filter((c) => !c.cancelled).reduce((a, c) => a + c.booked, 0);
    const fill = (cls) => { const held = scoped(cls).filter((c) => !c.cancelled && TYPES[c.type]?.kind !== "appointment"); return pctOf(held.reduce((a, c) => a + c.booked, 0), held.reduce((a, c) => a + c.cap, 0)); };
    const trend = (fn) => cur.days.map(({ d, x }) => ({ d, v: fn(x) }));
    const nett = (x) => x.money.packages + x.money.gift + x.money.fees - x.money.refunds;
    const tiles = [
      { key: "bookings", label: "Bookings", help: "Spots booked in classes that ran in this period.", value: booked(cur.classes), prev: booked(prev.classes), show: (v) => v.toLocaleString("en"), trend: trend((x) => booked(x.classes)) },
      { key: "fill", label: "How full classes were", help: "Spots booked out of spots available, for group classes that have finished.", value: fill(cur.classes), prev: fill(prev.classes), show: (v) => `${v}%`, pct: true, trend: trend((x) => { const f = scoped(x.classes).filter((c) => !c.cancelled && TYPES[c.type]?.kind !== "appointment"); return f.length ? fill(x.classes) : null; }) },
    ];
    if (!homeOwn()) tiles.push({ key: "new_clients", label: "New clients", help: "People who joined in this period, for the whole studio.", value: cur.newClients, prev: prev.newClients, show: (v) => v.toLocaleString("en"), trend: trend((x) => x.newClients), studioWide: true });
    if (state.role === "admin") tiles.push({ key: "money", label: "Money in", help: "Packages, gift cards and fees paid, minus money refunded. For the whole studio, the same as Reports.", value: cur.nett, prev: prev.nett, show: (v) => mWhole(v), trend: trend(nett), studioWide: true });
    return tiles.map((t) => ({ ...t, change: chg(t.value, t.prev, { isPct: !!t.pct }) }));
  }

  function homeWeek() {
    return [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const d = addDays(day(NOW), i);
      const list = SESSIONS.filter((s) => live(s) && sameDay(s.start, d) && TYPES[s.type]?.kind !== "appointment");
      const booked = list.reduce((a, s) => a + s.roster.length, 0), cap = list.reduce((a, s) => a + s.cap, 0);
      const cl = closureOn(state.home.loc || null, ymd(d));
      return { d, classes: list.length, booked, cap, fill: pctOf(booked, cap), full: list.filter((s) => s.roster.length >= s.cap).length, closed: cl && !list.length ? cl.name : null };
    });
  }

  // --- Pieces ------------------------------------------------------------------------
  function sparkline(points, key) {
    const vals = points.map((p) => p.v).filter((v) => v !== null);
    if (vals.length < 2) return "";
    const W = 160, H = 36, pad = 4;
    const max = Math.max(...vals), min = Math.min(0, ...vals), span = max - min || 1;
    const xy = points.map((p, i) => (p.v === null ? null : [pad + (i * (W - pad * 2)) / (points.length - 1), H - pad - ((p.v - min) / span) * (H - pad * 2)]));
    const segs = []; let cur = [];
    for (const p of xy) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
    if (cur.length) segs.push(cur);
    const last = [...xy].reverse().find(Boolean);
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" data-k="${key}">
      ${segs.map((s) => `<polyline points="${s.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" />`).join("")}
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" /></svg>`;
  }
  function kpiTile(t) {
    const days = state.home.days;
    const arrow = t.change.dir === "up" ? "▲" : t.change.dir === "down" ? "▼" : "●";
    const tone = t.change.good === null ? "flat" : t.change.good ? "good" : "bad";
    const vals = t.trend.map((p) => p.v).filter((v) => v !== null);
    const summary = vals.length ? `Daily, from ${t.show(Math.min(...vals))} to ${t.show(Math.max(...vals))}` : "";
    return `<div class="card ktile" data-kpi="${t.key}">
      <span class="klabel" data-help="${esc(t.help)}">${esc(t.label)}${t.studioWide && (state.home.loc || homeOwn()) ? ' <span class="kscope">whole studio</span>' : ""}</span>
      <b class="kval">${t.show(t.value)}</b>
      <span class="kdelta ${tone}"><span aria-hidden="true">${arrow}</span> ${esc(t.change.text)} <span class="muted">vs the ${days} days before</span></span>
      <div class="ksp" role="img" aria-label="${esc(`${t.label}, last ${days} days. ${summary}`)}">${sparkline(t.trend, t.key)}</div>
    </div>`;
  }
  function attRow(a) {
    const sev = SEV[a.sev];
    return `<li class="attrow ${a.sev}"><span class="sevic" aria-hidden="true">${sev.icon}</span>
      <div class="stack" style="gap:2px;min-width:0"><span class="sevlbl">${sev.label}</span><b>${esc(a.title)}</b><span class="muted" style="font-size:12.5px">${esc(a.detail)}</span></div>
      <button type="button" class="btn" ${a.open ? `data-hopen="${a.open}"` : `data-hgo="${a.go}"`}>${esc(a.label)}</button></li>`;
  }
  function classRow(x) {
    const s = x.s;
    const chip = x.state === "on_now" ? '<span class="status done">On now</span>' : x.state === "finished" ? '<span class="status off">Finished</span>' : "";
    return `<button type="button" class="hclass ${x.state}" data-hopen="${s.id}" style="--t:var(--t-${s.type})" aria-label="${esc(`${TYPES[s.type].name} at ${clock(s.start)}, ${s.roster.length} of ${s.cap} booked`)}">
      <span class="ht">${short(s.start)}<small>${mins(s)} min</small></span><span class="hc" aria-hidden="true"></span>
      <span class="hn"><span class="row" style="gap:6px"><b>${esc(TYPES[s.type].name)}</b>${chip}</span><span class="muted">${s.instr ? esc(STAFF[s.instr]) : '<span class="tbc">No instructor</span>'} · ${esc(roomOrLoc(s.room))}</span>
        ${x.todo.length ? `<span class="htodo">${x.todo.map((t) => `<span class="todo ${t.kind}"><span aria-hidden="true">!</span> ${esc(t.text)}</span>`).join("")}</span>` : ""}</span>
      <span class="hm"><span class="hmeter" aria-hidden="true"><span style="width:${Math.min(100, (s.roster.length / s.cap) * 100)}%"></span></span><span><b>${s.roster.length}</b>/${s.cap}${s.waitlist.length ? ` · ${s.waitlist.length} waiting` : ""}</span></span>
    </button>`;
  }
  function weekChart(week) {
    if (state.home.table) {
      return `<table class="tbl wktbl"><thead><tr><th>Day</th><th class="num">Classes</th><th class="num">Booked</th><th class="num">How full</th><th class="num">Full classes</th></tr></thead><tbody>
        ${week.map((w) => `<tr><td>${fmtDay(w.d)}</td>${w.closed ? `<td colspan="4">Closed: ${esc(w.closed)}</td>` : `<td class="num">${w.classes}</td><td class="num">${w.booked} of ${w.cap}</td><td class="num">${w.classes ? `${w.fill}%` : "–"}</td><td class="num">${w.full}</td>`}</tr>`).join("")}</tbody></table>`;
    }
    return `<div class="wkchart" role="list" aria-label="How full the next 7 days are">
      <div class="wkgrid" aria-hidden="true"><span style="bottom:100%"><i>100%</i></span><span style="bottom:50%"><i>50%</i></span><span style="bottom:0"></span></div>
      ${week.map((w, i) => {
        const tip = w.closed ? `${fmtDay(w.d)}: closed (${w.closed})` : w.classes ? `${fmtDay(w.d)}: ${hp(w.classes, "class", "classes")}, ${w.booked} of ${w.cap} spots booked (${w.fill}%)${w.full ? `, ${w.full} full` : ""}` : `${fmtDay(w.d)}: no classes`;
        return `<button type="button" class="wkcol ${i === 0 ? "today" : ""}" role="listitem" data-hday="${ymd(w.d)}" data-tip="${esc(tip)}" aria-label="${esc(tip)}. Open this day.">
          <span class="wkplot">${w.closed ? '<span class="wkclosed">Closed</span>' : w.classes ? `<span class="wkval">${Math.round(w.fill)}%</span><span class="wkbar" style="height:${Math.max(2, w.fill)}%"></span>` : '<span class="wkval muted">–</span>'}</span>
          <span class="wkx">${i === 0 ? "Today" : DOW[w.d.getDay()]}<small>${w.d.getDate()}</small></span></button>`;
      }).join("")}<div class="wktip" id="hTip" hidden></div></div>`;
  }

  // --- The page ----------------------------------------------------------------------
  PAGES.home = function () {
    const role = state.role, own = homeOwn();
    const t = homeToday(), att = homeAttention(), kpis = homeKpis(), week = homeWeek();
    const part = NOW.getHours() < 12 ? "morning" : NOW.getHours() < 17 ? "afternoon" : "evening";
    const where = state.home.loc ? LOCS[state.home.loc] : Object.values(LOCS).join(" and ");
    const dateLine = `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][NOW.getDay()]} ${NOW.getDate()} ${MONTH_FULL[NOW.getMonth()]}`;
    const upcoming = CLOSURES.filter((c) => c.end >= ymd(NOW) && c.start <= ymd(addDays(NOW, 30)) && (!state.home.loc || !c.loc || c.loc === state.home.loc)).sort((a, b) => (a.start < b.start ? -1 : 1));
    const quiet = SESSIONS.filter((s) => live(s) && s.start > NOW && s.start < addDays(NOW, 3) && TYPES[s.type]?.kind !== "appointment" && s.roster.length / s.cap < 0.35).sort((a, b) => a.roster.length / a.cap - b.roster.length / b.cap).slice(0, 3);
    const n = t.next;

    const hero = `<section class="card hero" aria-labelledby="hToday">
      <div class="row" style="justify-content:space-between;align-items:baseline"><h3 id="hToday">${own ? "Your classes today" : "Today"}</h3><button type="button" class="linkbtn" data-hgo="schedule">${own ? "My schedule" : "Open the schedule"} →</button></div>
      ${t.list.length ? `<div class="herofig"><b class="heronum">${t.booked}</b><span>${t.booked === 1 ? "person" : "people"} booked into ${hp(t.list.length, "class", "classes")}${t.waiting ? `, ${t.waiting} waiting` : ""}</span></div>
      <div class="hmeterbig" role="img" aria-label="${t.fill}% of today's spots are booked"><span style="width:${t.fill}%"></span></div>
      <span class="muted" style="font-size:12.5px">${t.fill}% of today's ${t.cap} spots booked</span>
      ${n ? `<div class="upnext" style="--t:var(--t-${n.s.type})"><span class="unl">${n.state === "on_now" ? "On now" : "Up next"}</span>
        <div class="stack" style="gap:1px;min-width:0"><b>${esc(TYPES[n.s.type].name)} · ${clock(n.s.start)}</b><span class="muted" style="font-size:12.5px">${n.s.instr ? esc(STAFF[n.s.instr]) : "No instructor"} · ${esc(roomOrLoc(n.s.room))} · ${n.s.roster.length}/${n.s.cap} booked</span></div>
        <button type="button" class="btn primary" data-hopen="${n.s.id}">Open class</button></div>` : `<span class="muted">Today's classes have all finished.</span>`}`
        : `<div class="herofig"><b class="heronum">0</b><span>${own ? "You're not teaching today." : "No classes today."}</span></div>`}
    </section>`;

    const attention = `<section class="card hattsec" aria-labelledby="hAtt"><div class="row" style="justify-content:space-between"><h3 id="hAtt">Needs attention</h3>${att.length ? `<span class="muted" style="font-size:12.5px">${hp(att.length, "thing", "things")}</span>` : ""}</div>
      ${att.length ? `<ul class="attlist">${att.map(attRow).join("")}</ul>` : `<div class="allclear"><span class="okic" aria-hidden="true">✓</span><div><b>All caught up</b><span class="muted">Nothing needs you right now.</span></div></div>`}</section>`;

    const classes = `<section class="card hclassesec" aria-labelledby="hClasses"><div class="row" style="justify-content:space-between"><h3 id="hClasses">${own ? "Your classes today" : "Today's classes"}</h3><span class="muted" style="font-size:12.5px">Tap a class to open it</span></div>
      ${t.list.length ? `<div class="hclasses">${t.list.map(classRow).join("")}</div>` : `<span class="muted">${own ? "You're not teaching today." : "No classes today."}</span>`}</section>`;

    const how = `<section aria-labelledby="hHow" class="stack"><div class="row" style="justify-content:space-between"><h3 id="hHow" class="hsec">How it's going${own ? " in your classes" : ""}</h3>
        <span class="seg" role="group" aria-label="Period"><button type="button" data-hdays="7" aria-pressed="${state.home.days === 7}">Last 7 days</button><button type="button" data-hdays="30" aria-pressed="${state.home.days === 30}">Last 30 days</button></span></div>
      <div class="kpis">${kpis.map(kpiTile).join("")}</div>
      ${role === "admin" ? `<button type="button" class="linkbtn" data-hgo="reports" style="align-self:flex-start">More in Reports →</button>` : ""}</section>`;

    const ahead = `<section class="card" aria-labelledby="hWeek"><div class="row" style="justify-content:space-between"><h3 id="hWeek">The week ahead</h3><button type="button" class="linkbtn" id="hTable">${state.home.table ? "Show as chart" : "Show as table"}</button></div>
      <span class="muted" style="font-size:12.5px">How full each day's ${own ? "classes are" : "group classes are"} so far. Tap a day to open it.</span>${weekChart(week)}</section>`;

    const coming = `<section class="card" aria-labelledby="hComing"><h3 id="hComing">Coming up</h3>
      ${upcoming.length ? `<div class="stack" style="gap:6px">${upcoming.map((c) => `<div class="crow"><span class="cdot" aria-hidden="true">⦸</span><div class="stack" style="gap:1px"><b>${esc(c.name)}</b><span class="muted" style="font-size:12.5px">${clDates(c)} · ${esc(clWhere(c))}</span></div></div>`).join("")}</div>` : ""}
      ${quiet.length ? `<h4 class="hsub">Quiet classes in the next 3 days</h4><div class="stack" style="gap:6px">${quiet.map((s) => `<button type="button" class="crow cbtn" data-hopen="${s.id}" style="--t:var(--t-${s.type})"><span class="cbar" aria-hidden="true"></span><div class="stack" style="gap:1px;min-width:0"><b>${esc(TYPES[s.type].name)} · ${fmtDay(s.start)} ${short(s.start)}</b><span class="muted" style="font-size:12.5px">${s.roster.length} of ${s.cap} booked${role === "admin" ? ". Worth a nudge to your clients?" : ""}</span></div></button>`).join("")}</div>` : ""}
      ${!upcoming.length && !quiet.length ? '<span class="muted">No closures in the next 30 days, and every class in the next 3 days is filling well.</span>' : ""}
      ${role === "admin" ? `<button type="button" class="linkbtn" data-hgo="closures" style="align-self:flex-start">Closures &amp; holidays →</button>` : ""}</section>`;

    const locSel = `<label class="hfilter">Location <select id="hLoc" aria-label="Location"><option value="">All locations</option>${Object.entries(LOCS).map(([k, v]) => `<option value="${k}" ${state.home.loc === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`;
    return head(`Good ${part}, ${HOME_NAME[role] || ""}`, `${dateLine} · ${esc(where)}`, `${locSel}${role === "admin" ? '<button type="button" class="btn primary" data-hact="newClass">+ New class</button>' : ""}`) +
      `<div class="home">
        <div class="hgrid top"><div class="home">${hero}${classes}</div>${attention}</div>
        ${how}
        <div class="hgrid">${ahead}${coming}</div>
      </div>`;
  };

  BIND.home = function () {
    const root = $("#pgOther");
    if ($("#hLoc")) $("#hLoc").onchange = (e) => { state.home.loc = e.target.value; render(); };
    if ($("#hTable")) $("#hTable").onclick = () => { state.home.table = !state.home.table; render(); };
    root.querySelectorAll("[data-hdays]").forEach((b) => (b.onclick = () => { state.home.days = Number(b.dataset.hdays); render(); }));
    root.querySelectorAll("[data-hgo]").forEach((b) => (b.onclick = () => go(b.dataset.hgo)));
    root.querySelectorAll("[data-hopen]").forEach((b) => (b.onclick = () => openDrawer(Number(b.dataset.hopen))));
    root.querySelectorAll("[data-hday]").forEach((b) => (b.onclick = () => { state.anchor = fromYmdHm(b.dataset.hday, "00:00"); state.view = "day"; go("schedule"); }));
    root.querySelectorAll('[data-hact="newClass"]').forEach((b) => (b.onclick = () => openForm(null)));
    // Week-ahead tooltip: shows straight away on hover or keyboard focus (the label carries the same words).
    const tip = $("#hTip");
    if (tip) {
      const show = (b) => { tip.textContent = b.dataset.tip; tip.hidden = false; const r = b.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect(); tip.style.left = `${Math.min(Math.max(0, r.left - p.left + r.width / 2 - 110), p.width - 220)}px`; };
      root.querySelectorAll(".wkcol").forEach((b) => { b.onpointerenter = () => show(b); b.onfocus = () => show(b); b.onpointerleave = b.onblur = () => (tip.hidden = true); });
    }
  };

  // --- Menu: Home is the front page for staff -------------------------------------------
  ICONS.home = '<path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z"/>';
  NAV_ORDER.find(([g]) => g === "Day to day")[1].unshift("home");
  NAV.push({ id: "home", roles: ["admin", "foh", "instructor"], label: (r) => (r === "instructor" ? "My day" : "Home"), help: "Today at a glance: classes, what needs attention and how the studio is doing." });
  for (const n of NAV) { const id = n.id; n.group = (role) => navGroup(id, role); }
  NAV.sort((a, b) => navRank(a.id, "admin") - navRank(b.id, "admin"));
  state.page = "home";
