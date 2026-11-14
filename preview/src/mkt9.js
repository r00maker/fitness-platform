  // ===========================================================================
  // Menu groups, Agents (reminder agents + assistant settings + usage), the bell for agent
  // messages, and the Ask assistant. Same rules as the agents and assistant modules in the API.
  // ===========================================================================

  // --- Menu, grouped by what you're doing -------------------------------------
  const NAV_ORDER = [
    ["Day to day", ["schedule", "cover", "comms", "announcements", "pickups"]],
    ["Classes", ["schedule", "my-bookings", "checkout"]],
    ["Packages & rewards", ["my-packages", "gift-cards", "loyalty", "refer"]],
    ["Clients & sales", ["clients", "leads", "sales", "packages", "shop", "fees"]],
    ["Growth", ["marketing", "reports"]],
    ["Team", ["staff", "payroll", "agents"]],
    ["Setup", ["class-types", "templates", "locations", "policies"]],
    ["Account", ["my-pay", "health", "profile", "preferences"]],
  ];
  const navGroup = (id, role) => (id === "schedule" ? (role === "client" ? "Classes" : "Day to day") : id === "shop" && role === "client" ? "Packages & rewards" : NAV_ORDER.find(([, ids]) => ids.includes(id))?.[0] || "Account");
  const navRank = (id, role) => { const g = navGroup(id, role); const gi = NAV_ORDER.findIndex(([n]) => n === g); return gi * 100 + NAV_ORDER[gi][1].indexOf(id); };
  for (const n of NAV) { const id = n.id; n.group = (role) => navGroup(id, role); }
  NAV.sort((a, b) => navRank(a.id, "admin") - navRank(b.id, "admin"));

  // --- Reminder agents ---------------------------------------------------------
  const AG_SEES = { schedule: "Class times, names, rooms and locations", instructors: "Who teaches each class (names only)", booking_counts: "How many people are booked and waiting (numbers, never names)", cover: "Cover: who's covering which class, and cover requests" };
  const AG_NEVER = ["Client names, contact details or health notes", "Payments, prices, packages or pay", "Anything from another studio"];
  const AG_ROLES = { owner: "Owners", admin: "Admins", front_desk: "Front of House", instructor: "Instructors" };
  const AG_JOBS = {
    cover_classes: { label: "Cover class reminders", needs: ["schedule", "cover"], perClass: true, explain: "Reminds instructors about classes they're covering, which are outside their usual schedule and easy to miss." },
    low_bookings: { label: "Low bookings check", needs: ["schedule", "booking_counts"], perClass: true, explain: "Flags classes with few bookings, so someone can decide whether to cancel early." },
    teaching: { label: "Teaching line-up", needs: ["schedule"], perClass: true, explain: "Tells each instructor what they're teaching, e.g. tomorrow's classes." },
    no_instructor: { label: "Classes without an instructor", needs: ["schedule", "instructors"], perClass: false, explain: "Spots upcoming classes nobody is teaching yet." },
    busy_waitlist: { label: "Busy waitlists", needs: ["schedule", "booking_counts"], perClass: false, explain: "Points out full classes with people waiting, in case you can add spots or another class." },
    open_cover: { label: "Unfilled cover requests", needs: ["schedule", "cover"], perClass: false, explain: "Chases cover requests nobody has taken yet." },
  };
  const AG_STARTERS = [
    { key: "cover_reminder", name: "Jeff", title: "Remind instructors about cover classes", pitch: "The evening before, each instructor covering a class gets a nudge, since covers aren't on their usual schedule.", def: { when: { type: "daily", time: "19:00", days: [] }, job: { type: "cover_classes", daysAhead: 1 }, notify: { roles: ["instructor"], people: [] }, sees: ["schedule", "instructors", "cover"] } },
    { key: "low_bookings", name: "Agnes", title: "Warn about quiet classes the night before", pitch: "At 10pm, admins hear which of tomorrow's classes have fewer than 3 booked, so they can cancel early if they want to.", def: { when: { type: "daily", time: "22:00", days: [] }, job: { type: "low_bookings", daysAhead: 1, mode: "count", value: 3 }, notify: { roles: ["owner", "admin"], people: [] }, sees: ["schedule", "booking_counts"] } },
    { key: "teaching_lineup", name: "Theo", title: "Send instructors tomorrow's line-up", pitch: "Each instructor gets a list of what they're teaching tomorrow, with times and rooms.", def: { when: { type: "daily", time: "20:00", days: [] }, job: { type: "teaching", daysAhead: 1 }, notify: { roles: ["instructor"], people: [] }, sees: ["schedule", "cover"] } },
    { key: "no_instructor", name: "Nina", title: "Spot classes with no instructor", pitch: "Each morning, admins hear about classes in the next week that nobody is teaching yet.", def: { when: { type: "daily", time: "09:00", days: [] }, job: { type: "no_instructor", daysAhead: 7 }, notify: { roles: ["owner", "admin"], people: [] }, sees: ["schedule", "instructors"] } },
    { key: "busy_waitlist", name: "Walt", title: "Point out busy waitlists", pitch: "Each morning, the front desk hears which classes today and tomorrow have 3 or more people waiting.", def: { when: { type: "daily", time: "08:00", days: [] }, job: { type: "busy_waitlist", daysAhead: 1, atLeast: 3 }, notify: { roles: ["admin", "front_desk"], people: [] }, sees: ["schedule", "booking_counts"] } },
    { key: "open_cover", name: "Cora", title: "Chase unfilled cover requests", pitch: "Each morning, admins hear about cover requests for the next 3 days that nobody has taken.", def: { when: { type: "daily", time: "10:00", days: [] }, job: { type: "open_cover", daysAhead: 3 }, notify: { roles: ["owner", "admin"], people: [] }, sees: ["schedule", "instructors", "cover"] } },
  ];
  /** Everyone on staff an agent could message (owner, admin and front desk are sample people). */
  const AG_PEOPLE = [{ k: "olivia", name: "Olivia Tan", role: "owner" }, { k: "you", name: "You (admin)", role: "admin" }, { k: "faye", name: "Faye Ong", role: "front_desk" }, ...Object.entries(STAFF).map(([k, name]) => ({ k, name, role: "instructor" }))];
  /** Who you are in each "View as" role, for the bell. */
  const AG_ME = () => ({ admin: "you", foh: "faye", instructor: ME.instructor })[state.role];
  const agClone = (x) => JSON.parse(JSON.stringify(x));
  let nextAgentId = 3;
  const AGENTS = [
    { id: 1, name: "Jeff", starter: "cover_reminder", enabled: true, def: agClone(AG_STARTERS[0].def), runs: [] },
    { id: 2, name: "Agnes", starter: "low_bookings", enabled: true, def: agClone(AG_STARTERS[1].def), runs: [] },
  ];
  const AG_MUTED = new Set();
  const agState = { paused: false, assistant: { enabled: true, roles: ["owner", "admin", "front_desk", "instructor"], actions: true }, used: 62, allowance: 300, topUps: 0 };

  const hm12 = (t) => { const [h, m] = t.split(":").map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`; };
  const words = (xs) => (xs.length <= 1 ? xs[0] || "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  const DAYN = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  function describeAg(d) {
    const j = d.job, pc = d.when.type === "before_class";
    const ahead = (n) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in the next ${n} days`);
    const job = j.type === "cover_classes" ? (pc ? "reminds whoever is covering a class" : `reminds instructors about classes they're covering ${ahead(j.daysAhead)}`)
      : j.type === "low_bookings" ? `checks ${pc ? "each class" : `${ahead(j.daysAhead)}'s classes`} for ${j.mode === "count" ? `fewer than ${j.value} booked` : `less than ${j.value}% full`}`
      : j.type === "teaching" ? (pc ? "reminds instructors about each class they teach" : `sends instructors what they're teaching ${ahead(j.daysAhead)}`)
      : j.type === "no_instructor" ? `looks for classes ${ahead(j.daysAhead)} with no instructor`
      : j.type === "busy_waitlist" ? `looks for classes ${j.daysAhead === 1 ? "today and tomorrow" : ahead(j.daysAhead)} with ${j.atLeast} or more people waiting`
      : `chases cover requests ${ahead(j.daysAhead)} that nobody has taken`;
    const when = pc ? `${d.when.hours} ${d.when.hours === 1 ? "hour" : "hours"} before each class` : `${d.when.days.length && d.when.days.length < 7 ? `Every ${words(d.when.days.map((x) => DAYN[x]))}` : "Every day"} at ${hm12(d.when.time)}`;
    const who = words([...d.notify.roles.map((r) => AG_ROLES[r].toLowerCase()), ...(d.notify.people.length ? [plural(d.notify.people.length, "chosen person", "chosen people")] : [])]) || "nobody yet";
    // "Reminds instructors…" already says who hears it when only instructors are told.
    const onlyInstructors = d.notify.roles.length === 1 && d.notify.roles[0] === "instructor" && !d.notify.people.length && ["cover_classes", "teaching"].includes(j.type);
    return `${when[0].toUpperCase()}${when.slice(1)}, it ${job}${onlyInstructors ? "" : ` and tells ${who}`}.${d.notify.roles.includes("instructor") ? " Instructors only hear about their own classes." : ""}`;
  }

  /** What a job finds right now. Mirrors the API: only fields the agent may see are used. */
  function agFind(d, now = NOW) {
    const j = d.job, sees = new Set(d.sees), dayStart = day(now);
    const single = j.type === "low_bookings" || j.type === "teaching" || (j.type === "cover_classes" && j.daysAhead === 1);
    let from, to, period, sameDay = false;
    if (single) { const dd = addDays(dayStart, j.daysAhead); from = j.daysAhead === 0 ? now : dd; to = addDays(dd, 1); period = j.daysAhead === 0 ? "later today" : j.daysAhead === 1 ? "tomorrow" : `on ${fmtDay(dd)}`; sameDay = true; }
    else { from = now; to = addDays(dayStart, j.daysAhead + 1); period = j.type === "busy_waitlist" ? (j.daysAhead === 0 ? "today" : j.daysAhead === 1 ? "today and tomorrow" : `in the next ${j.daysAhead} days`) : `in the next ${j.daysAhead} days`; }
    const list = SESSIONS.filter((s) => s.status === "scheduled" && s.start >= from && s.start < to).sort((a, b) => a.start - b.start);
    const when = (s) => (sameDay ? short(s.start) : `${fmtDay(s.start)} ${short(s.start)}`);
    const where = (s) => `${ROOMS[s.room]?.name || ""}, ${LOCS[s.loc]}`;
    const nm = (k) => (sees.has("instructors") && k ? STAFF[k].split(" ")[0] + " " + STAFF[k].split(" ")[1][0] + "." : null);
    let found = [];
    if (j.type === "cover_classes") found = list.filter((s) => s.coverFor && s.instr).map((s) => ({ s, line: `${TYPES[s.type].name}, ${when(s)} at ${where(s)}${nm(s.coverFor) ? ` (covering for ${nm(s.coverFor)})` : ""}` }));
    if (j.type === "low_bookings") found = list.filter((s) => !isAppt(s) && (j.mode === "count" ? s.roster.length < j.value : (s.roster.length / s.cap) * 100 < j.value)).map((s) => ({ s, line: `${TYPES[s.type].name}, ${when(s)} (${s.roster.length} of ${s.cap} booked)` }));
    if (j.type === "teaching") found = list.filter((s) => s.instr).map((s) => ({ s, line: `${isAppt(s) ? "Appointment" : TYPES[s.type].name}, ${when(s)} at ${where(s)}${sees.has("cover") && s.coverFor ? " (cover)" : ""}` }));
    if (j.type === "no_instructor") found = list.filter((s) => !s.instr).map((s) => ({ s, line: `${TYPES[s.type].name}, ${fmtDay(s.start)} ${short(s.start)} at ${where(s)}` }));
    if (j.type === "busy_waitlist") found = list.filter((s) => !isAppt(s) && s.waitlist.length >= j.atLeast).map((s) => ({ s, line: `${TYPES[s.type].name}, ${fmtDay(s.start)} ${short(s.start)} (full, ${s.waitlist.length} waiting)` }));
    if (j.type === "open_cover") { const open = REQUESTS.filter((r) => r.status === "open" || r.status === "awaiting"); found = list.filter((s) => open.some((r) => r.sid === s.id)).map((s) => { const r = open.find((x) => x.sid === s.id); return { s, line: `${TYPES[s.type].name}, ${fmtDay(s.start)} ${short(s.start)}${nm(s.instr) ? ` (${nm(s.instr)})` : ""}${r.status === "awaiting" ? ": someone offered, waiting for you to approve" : ""}` }; }); }
    return { found, period };
  }
  const seesAll = (role) => role !== "instructor";
  function agCompose(d, res, mine, personal) {
    const n = mine.length, lines = mine.slice(0, 4).map((f) => f.line), more = n > 4 ? `, and ${n - 4} more` : "", list = `${lines.join("; ")}${more}.`;
    const cls = (k) => plural(k, "class", "classes"), soon = d.when.type === "before_class" ? `in ${plural(d.when.hours, "hour")}` : res.period;
    switch (d.job.type) {
      case "cover_classes": return personal ? `Reminder: you're covering ${n === 1 ? "a class" : cls(n)} ${soon}. ${list}` : `${cls(n)} ${n === 1 ? "is" : "are"} being covered ${soon}: ${list}`;
      case "low_bookings": return `${cls(n)} ${soon} ${n === 1 ? "looks" : "look"} quiet: ${list} Open the schedule if you want to cancel or promote ${n === 1 ? "it" : "them"}.`;
      case "teaching": return personal ? `You're teaching ${cls(n)} ${soon}: ${list}` : `${cls(n)} being taught ${soon}: ${list}`;
      case "no_instructor": return `${cls(n)} ${soon} ${n === 1 ? "has" : "have"} no instructor yet: ${list}`;
      case "busy_waitlist": return `${cls(n)} ${soon} ${n === 1 ? "has" : "have"} a busy waitlist: ${list} You could add spots or another class.`;
      default: return `${n} cover ${n === 1 ? "request hasn't" : "requests haven't"} been taken ${soon}: ${list}`;
    }
  }
  /** Who'd get what if the agent ran now. */
  function agMessages(a) {
    const d = a.def, res = agFind(d);
    const people = AG_PEOPLE.filter((p) => (d.notify.roles.includes(p.role) || d.notify.people.includes(p.k)) && !(a.id && AG_MUTED.has(`${a.id}:${p.k}`)));
    const out = [];
    for (const p of people) {
      const mine = seesAll(p.role) ? res.found : res.found.filter((f) => f.s.instr === p.k);
      if (!mine.length) continue;
      out.push({ to: p, title: a.name, body: agCompose(d, res, mine, mine.every((f) => f.s.instr === p.k)), sids: mine.map((f) => f.s.id) });
    }
    return { res, out, summary: res.found.length ? `Found ${plural(res.found.length, "class", "classes")} ${d.when.type === "before_class" ? "" : res.period + " "}and told ${plural(out.length, "person", "people")}.`.replace("  ", " ") : `Nothing to report ${d.when.type === "before_class" ? "" : res.period}.`.replace(" .", ".") };
  }
  /** When a daily agent runs next (or ran last). */
  function agNext(d, after = NOW, back = false) {
    if (d.when.type !== "daily") return null;
    const [h, m] = d.when.time.split(":").map(Number);
    let t = new Date(after); t.setHours(h, m, 0, 0);
    for (let i = 0; i < 9; i++) {
      const iso = ((t.getDay() + 6) % 7) + 1;
      if ((back ? t < after : t > after) && (!d.when.days.length || d.when.days.includes(iso))) return t;
      t = addDays(t, back ? -1 : 1);
    }
    return null;
  }
  const relDay = (t) => { const dd = Math.round((day(t) - day(NOW)) / 864e5); return dd === 0 ? "today" : dd === 1 ? "tomorrow" : dd === -1 ? "yesterday" : fmtDay(t); };
  const agAt = (t) => (t ? `${relDay(t)} at ${short(t)}` : "");
  // Sample: Ana is covering Ben's early class tomorrow, so Jeff has something to tell her.
  { const sx = SESSIONS.find((x) => ymd(x.start) === ymd(addDays(NOW, 1)) && x.instr === "ben" && !x.coverFor); if (sx) { sx.coverFor = "ben"; sx.instr = "ana"; } }
  // Messages already sent (the bell): what each sample agent sent at its last run.
  const AG_INBOX = [];
  for (const a of AGENTS) {
    const last = agNext(a.def, NOW, true);
    const m = agMessages(a);
    a.runs.unshift({ at: last, summary: m.summary, status: m.out.length ? "sent" : "nothing" });
    for (const x of m.out) AG_INBOX.push({ agent: a.id, to: x.to.k, title: x.title, body: x.body, at: last, read: false, sids: x.sids });
  }
  const myInbox = () => AG_INBOX.filter((x) => x.to === AG_ME()).sort((a, b) => b.at - a.at);

  // --- The bell ---------------------------------------------------------------
  function renderAgentChrome() {
    const top = $(".topbar");
    if (!top) return;
    let box = $("#agentChrome");
    if (!box) { box = document.createElement("div"); box.id = "agentChrome"; box.className = "agchrome"; top.insertBefore(box, $("#roles")); }
    const staff = state.role !== "client";
    const unread = staff ? myInbox().filter((x) => !x.read).length : 0;
    box.innerHTML = staff ? `<button type="button" class="iconbtn bell" id="bellBtn" aria-haspopup="dialog" aria-expanded="${!!state.bellOpen}" aria-label="Messages from agents${unread ? `, ${unread} new` : ""}" data-help="Reminders from your studio's agents (also sent to your phone).">${BELL}${unread ? `<span class="bdot">${unread}</span>` : ""}</button>${state.bellOpen ? bellPanel() : ""}` : "";
    if (!staff) { state.bellOpen = false; return; }
    $("#bellBtn").onclick = (e) => { e.stopPropagation(); state.bellOpen = !state.bellOpen; if (!state.bellOpen) myInbox().forEach((x) => (x.read = true)); renderAgentChrome(); };
    box.querySelectorAll("[data-agmsg]").forEach((b) => (b.onclick = () => {
      const m = myInbox()[Number(b.dataset.agmsg)];
      m.read = true; state.bellOpen = false;
      const s = SESSIONS.find((x) => x.id === m.sids[0]);
      if (s) { state.page = "schedule"; state.anchor = day(s.start); state.view = "day"; render(); if (m.sids.length === 1) openDrawer(s.id); } else renderAgentChrome();
    }));
    box.querySelectorAll("[data-agmute]").forEach((b) => (b.onclick = () => { const k = `${b.dataset.agmute}:${AG_ME()}`; AG_MUTED.has(k) ? AG_MUTED.delete(k) : AG_MUTED.add(k); toast(AG_MUTED.has(k) ? `You won't get messages from ${AGENTS.find((a) => a.id === Number(b.dataset.agmute)).name} any more.` : "Turned back on."); renderAgentChrome(); }));
  }
  const BELL = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  function bellPanel() {
    const list = myInbox();
    const mine = AGENTS.filter((a) => AG_PEOPLE.some((p) => p.k === AG_ME() && (a.def.notify.roles.includes(p.role) || a.def.notify.people.includes(p.k))));
    return `<div class="bellpanel" role="dialog" aria-label="Messages from agents"><h3>From your agents</h3>
      ${list.length ? `<ul class="agmsgs">${list.map((m, i) => `<li><button type="button" data-agmsg="${i}" class="${m.read ? "" : "new"}"><span class="agav sm" style="--h:${hash(m.title) % 360}" aria-hidden="true">${esc(m.title[0])}</span><span><b>${esc(m.title)}</b> <span class="muted">· ${esc(agAt(m.at))}</span><br>${esc(m.body)}</span></button></li>`).join("")}</ul>` : '<p class="muted" style="margin:0;font-size:13px">Nothing yet. Agents your studio sets up will remind you here and on your phone.</p>'}
      ${mine.length ? `<div class="agmutes"><span class="muted" style="font-size:12px">Agents that can message you</span>${mine.map((a) => { const muted = AG_MUTED.has(`${a.id}:${AG_ME()}`); return `<div class="row" style="justify-content:space-between;gap:8px;font-size:13px"><span>${esc(a.name)} <span class="muted">· ${esc(AG_JOBS[a.def.job.type].label)}</span></span><button type="button" class="tagbtn" data-agmute="${a.id}">${muted ? "Turn on" : "Mute"}</button></div>`; }).join("")}</div>` : ""}</div>`;
  }
  document.addEventListener("click", (e) => { if (state.bellOpen && !e.target.closest?.("#agentChrome")) { state.bellOpen = false; myInbox().forEach((x) => (x.read = true)); renderAgentChrome(); } });

  // --- Agents page ------------------------------------------------------------
  const agAvatar = (name, size = "") => `<span class="agav ${size}" style="--h:${hash(name) % 360}" aria-hidden="true">${esc((name || "?")[0].toUpperCase())}</span>`;
  PAGES.agents = function () {
    const tab = state.agTab || "agents";
    const tabs = `<div class="tabs" role="tablist">${[["agents", "Reminder agents"], ["writers", "Writers"], ["assistant", "Assistant"], ["usage", "Usage"]].map(([k, l]) => `<button type="button" role="tab" data-agtab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</div>`;
    let body = "";
    if (tab === "agents") {
      body = `${agState.paused ? alertBox("warn", "All agents are paused", "None of them will send anything until you resume them.") : ""}
        ${AGENTS.length ? `<div class="aglist">${AGENTS.map((a) => {
          const next = a.enabled && !agState.paused ? agNext(a.def) : null, last = a.runs[0];
          return `<div class="card agcard ${a.enabled ? "" : "off"}"><div class="row" style="gap:10px;align-items:flex-start">${agAvatar(a.name)}<div style="flex:1;min-width:0"><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><h3 style="margin:0">${esc(a.name)} <span class="muted" style="font-weight:500;font-size:13px">· ${esc(AG_JOBS[a.def.job.type].label)}</span></h3>${toggle(`agOn${a.id}`, a.enabled, `${a.name} on`)}</div>
            <p style="margin:4px 0 0">${esc(describeAg(a.def))}</p></div></div>
            <div class="agsees"><span class="muted">Can see:</span>${a.def.sees.map((k) => `<span class="agchip">${esc(AG_SEES[k])}</span>`).join("")}</div>
            <div class="agmeta">${a.enabled ? (agState.paused ? "Paused" : next ? `Next: ${esc(agAt(next))}` : "Runs before each class") : "Switched off"}${last ? ` · Last run ${esc(agAt(last.at))}: ${esc(last.summary)}` : ""}</div>
            <div class="row" style="gap:6px;flex-wrap:wrap"><button type="button" class="btn" data-agprev="${a.id}">Preview</button><button type="button" class="btn" data-agedit="${a.id}">Edit</button>${a.def.when.type === "daily" ? `<button type="button" class="btn" data-agrun="${a.id}" ${a.enabled ? "" : "disabled"}>Run now</button>` : ""}<button type="button" class="btn ghost" data-aglog="${a.id}">Activity</button><button type="button" class="btn ghost danger" data-agdel="${a.id}">Delete</button></div></div>`;
        }).join("")}</div>` : `<div class="card"><p class="muted" style="margin:0">No agents yet. Pick a ready-made one to get started.</p></div>`}
        <div class="card agrules"><h3>What agents can never do</h3><ul>${AG_NEVER.map((x) => `<li>See ${esc(x.charAt(0).toLowerCase() + x.slice(1))}</li>`).join("")}<li>Message clients</li><li>Change anything, like cancelling a class or booking someone in. They tell a person, who decides.</li><li>Tell someone more than they could see themselves: instructors only hear about their own classes.</li></ul></div>`;
    }
    if (tab === "assistant") {
      const a = agState.assistant;
      body = `<div class="card"><div class="row" style="justify-content:space-between;gap:10px"><div><h3 style="margin:0">Assistant</h3><span class="muted" style="font-size:13px">The Ask button: answers questions about the app and your studio, for your team.</span></div>${toggle("asOn", a.enabled, "Assistant on")}</div>
          <div class="fl">Who can use it<div class="chips">${Object.entries(AG_ROLES).map(([k, l]) => `<button type="button" data-asrole="${k}" aria-pressed="${a.roles.includes(k)}">${l}</button>`).join("")}</div></div>
          <label class="check" for="asAct"><input type="checkbox" id="asAct" ${a.actions ? "checked" : ""}> Let it do simple things once the person confirms (book a client in, add them to a waitlist, cancel a booking that's free to cancel)</label></div>
        <div class="adsgrid"><div class="card"><h3>What it can do</h3><ul class="agul"><li>Explain how to do things in the app</li><li>Look up your classes, clients and studio rules, but only what the person asking can see</li><li>Work out why something isn't working, e.g. why a client can't be booked in</li><li>Offer to do the simple things above, after a Confirm button</li></ul></div>
          <div class="card"><h3>What it never does</h3><ul class="agul"><li>Anything involving money: refunds, payments, prices, selling packages, fees or pay</li><li>Change settings, staff, permissions or the schedule</li><li>Delete anything</li><li>Share client contact details or health notes</li><li>See anything from another studio</li></ul><span class="hint">Asked for one of these, it says who can do it and where.</span></div></div>`;
    }
    if (tab === "writers") body = writersTab();
    if (tab === "usage") {
      const left = Math.max(0, agState.allowance - agState.used), pct = Math.min(100, Math.round((agState.used / agState.allowance) * 100));
      body = `<div class="card"><h3>AI credits this month</h3><div class="row" style="justify-content:space-between"><b class="credbal">${agState.used} of ${agState.allowance} used</b><span class="muted">${left} left · resets 1 December</span></div><span class="rmeter" aria-hidden="true"><span style="width:${pct}%"></span></span>
          <span class="hint">Your plan includes ${agState.allowance} AI credits a month, shared by the assistant and the writers. You'll be told at 80% and when they're used up.${agState.topUps ? ` You also have ${agState.topUps} top-up credits, used after the month's run out. They don't expire.` : ""}</span>
          <div class="tblwrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>What uses credits</th><th class="num">Credits</th></tr></thead><tbody><tr><td>An assistant answer (however much it looks up)</td><td class="num">1</td></tr><tr><td>An announcement draft</td><td class="num">1</td></tr><tr><td>A campaign email draft</td><td class="num">3</td></tr><tr><td>Reminder agents</td><td class="num">Free</td></tr></tbody></table></div></div>
        <div class="card"><h3>Need more?</h3><div class="row" style="gap:8px;flex-wrap:wrap">${[[200, 10], [1000, 40]].map(([n, p]) => `<button type="button" class="btn" data-astop="${n}">${n} more credits · US$${p}</button>`).join("")}</div><span class="hint">Prices are placeholders. Reminder agents don't use credits: they don't need AI, so they're included.</span></div>`;
    }
    return head("Agents", "Helpers for repetitive jobs. Reminder agents keep an eye on the schedule and tell your team; the assistant answers questions. Neither sees payments or client details, and neither decides for you.", tab === "agents" ? `<button type="button" class="btn" id="agPause">${agState.paused ? "Resume all" : "Pause all"}</button><button type="button" class="btn primary" id="agNew">+ New agent</button>` : "") + tabs + body;
  };
  BIND.agents = () => {
    document.querySelectorAll("[data-agtab]").forEach((b) => (b.onclick = () => { state.agTab = b.dataset.agtab; render(); }));
    if ($("#agNew")) $("#agNew").onclick = () => openAgentStarters();
    if ($("#agPause")) $("#agPause").onclick = () => { agState.paused = !agState.paused; toast(agState.paused ? "All agents paused." : "Agents resumed."); render(); };
    for (const a of AGENTS) { const t = $(`#agOn${a.id}`); if (t) t.onchange = (e) => { a.enabled = e.target.checked; toast(`${a.name} is ${a.enabled ? "on" : "off"}.`); render(); }; }
    const byId = (b, k) => AGENTS.find((a) => a.id === Number(b.dataset[k]));
    document.querySelectorAll("[data-agprev]").forEach((b) => (b.onclick = () => openAgentPreview(byId(b, "agprev"))));
    document.querySelectorAll("[data-agedit]").forEach((b) => (b.onclick = () => { const a = byId(b, "agedit"); openAgentEditor({ id: a.id, name: a.name, starter: a.starter, def: agClone(a.def) }); }));
    document.querySelectorAll("[data-agrun]").forEach((b) => (b.onclick = () => {
      const a = byId(b, "agrun"), m = agMessages(a);
      a.runs.unshift({ at: new Date(NOW), summary: m.summary, status: m.out.length ? "sent" : "nothing" });
      for (const x of m.out) AG_INBOX.push({ agent: a.id, to: x.to.k, title: x.title, body: x.body, at: new Date(NOW), read: false, sids: x.sids });
      toast(`${a.name}: ${m.summary}`); render();
    }));
    document.querySelectorAll("[data-aglog]").forEach((b) => (b.onclick = () => {
      const a = byId(b, "aglog");
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-labelledby="agLogT"><header><h2 id="agLogT">${esc(a.name)}'s activity</h2></header><div class="mb">${a.runs.length ? `<ul class="aglog">${a.runs.map((r) => `<li><b>${esc(agAt(r.at))}</b><br><span class="muted">${esc(r.summary)}</span></li>`).join("")}</ul>` : '<p class="muted">It hasn\'t run yet.</p>'}</div><footer><button type="button" class="btn primary" data-mclose>Close</button></footer></div></div>`;
    }));
    document.querySelectorAll("[data-agdel]").forEach((b) => (b.onclick = () => {
      const a = byId(b, "agdel");
      confirmFlags([{ level: "confirm", title: `Delete ${a.name}?`, msg: `${a.name} will stop sending reminders. Messages it already sent stay where they are.` }], { title: "Delete agent", proceedLabel: "Delete", proceed: () => { AGENTS.splice(AGENTS.indexOf(a), 1); toast(`${a.name} deleted.`); render(); } });
    }));
    if ($("#asOn")) {
      const a = agState.assistant;
      $("#asOn").onchange = (e) => { a.enabled = e.target.checked; toast(`Assistant ${a.enabled ? "on" : "off"}.`); render(); };
      $("#asAct").onchange = (e) => { a.actions = e.target.checked; toast(a.actions ? "It can offer to do simple things again." : "It'll only answer questions now."); };
      document.querySelectorAll("[data-asrole]").forEach((b) => (b.onclick = () => { const k = b.dataset.asrole; a.roles = a.roles.includes(k) ? a.roles.filter((x) => x !== k) : [...a.roles, k]; render(); }));
    }
    document.querySelectorAll("[data-astop]").forEach((b) => (b.onclick = () => { agState.topUps += Number(b.dataset.astop); toast(`In the live app this opens checkout. Added ${b.dataset.astop} credits for the preview.`); render(); }));
  };

  function openAgentStarters() {
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal agmodal" role="dialog" aria-modal="true" aria-labelledby="agStT"><header><h2 id="agStT">New agent</h2></header>
      <div class="mb"><span class="hint">Pick a ready-made agent. You'll name it and can change anything next.</span>
        <div class="agstarters">${AG_STARTERS.map((s, i) => `<button type="button" class="agstarter" data-agst="${i}">${agAvatar(s.name)}<span><b>${esc(s.title)}</b><span class="muted">${esc(s.pitch)}</span></span></button>`).join("")}</div>
        <span class="hint">Coming later: describe a job in your own words and build your own agent from the same building blocks.</span></div>
      <footer><button type="button" class="btn ghost" data-mclose>Cancel</button></footer></div></div>`;
    document.querySelectorAll("[data-agst]").forEach((b) => (b.onclick = () => { const s = AG_STARTERS[Number(b.dataset.agst)]; openAgentEditor({ name: AGENTS.some((a) => a.name.toLowerCase() === s.name.toLowerCase()) ? "" : s.name, starter: s.key, def: agClone(s.def) }); }));
  }

  function openAgentEditor(a) {
    const d = a.def;
    let painting = false;
    const paint = () => { if (painting) { setTimeout(paint, 0); return; } painting = true; try { paintNow(); } finally { painting = false; } };
    const paintNow = () => {
      const job = AG_JOBS[d.job.type];
      for (const n of job.needs) if (!d.sees.includes(n)) d.sees.push(n);
      if (d.when.type === "before_class" && !job.perClass) d.when = { type: "daily", time: "09:00", days: [] };
      const j = d.job, chipP = (attr, v, on, label, extra = "") => `<button type="button" class="pickchip" data-${attr}="${esc(String(v))}" aria-pressed="${on}" ${extra}>${label}</button>`;
      const aheadSel = (min, max) => `<select id="agAhead">${Array.from({ length: max - min + 1 }, (_, i) => i + min).map((n) => `<option value="${n}" ${j.daysAhead === n ? "selected" : ""}>${n === 0 ? "Later today" : n === 1 ? (["low_bookings", "teaching", "cover_classes"].includes(j.type) ? "Tomorrow" : "Today and tomorrow") : `The next ${n} days`}</option>`).join("")}</select>`;
      const jobFields = j.type === "low_bookings" ? `<div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Which classes${aheadSel(0, 7)}</label><label class="fl">Flag a class if<span class="inline2" style="flex-wrap:nowrap"><select id="agMode"><option value="count" ${j.mode === "count" ? "selected" : ""}>fewer than</option><option value="percent" ${j.mode === "percent" ? "selected" : ""}>less than</option></select><input id="agVal" type="number" min="1" max="${j.mode === "count" ? 200 : 100}" value="${j.value}" style="width:70px">${j.mode === "count" ? "booked" : "% full"}</span></label></div>`
        : j.type === "busy_waitlist" ? `<div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Which classes${aheadSel(0, 7)}</label><label class="fl">Flag a class with at least<span class="inline2"><input id="agAtLeast" type="number" min="1" max="50" value="${j.atLeast}" style="width:70px"> waiting</span></label></div>`
        : `<label class="fl">Which classes${aheadSel(j.type === "teaching" ? 0 : 1, j.type === "no_instructor" ? 30 : j.type === "teaching" ? 7 : 14)}</label>`;
      const prev = agMessages({ id: a.id, name: a.name || "Your agent", def: d });
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal agmodal" id="agForm" role="dialog" aria-modal="true" aria-labelledby="agEdT" novalidate><header><h2 id="agEdT">${a.id ? `Edit ${esc(a.name)}` : "Set up your agent"}</h2></header>
        <div class="mb mform">
          <label class="fl">Name<input id="agName" maxlength="30" value="${esc(a.name)}" placeholder="e.g. Agnes" autocomplete="off"></label>
          <p class="agdesc" aria-live="polite">${esc(describeAg(d))}</p>
          <fieldset class="agfs"><legend>1. When it runs</legend>
            ${job.perClass ? `<div class="seg" role="group" aria-label="When">${chipP("agwhen", "daily", d.when.type === "daily", "At a set time")}${chipP("agwhen", "before_class", d.when.type === "before_class", "Before each class")}</div>` : ""}
            ${d.when.type === "daily" ? `<div class="two" style="grid-template-columns:auto 1fr;align-items:end"><label class="fl">Time<input type="time" id="agTime" value="${d.when.time}" step="900"></label><div class="fl">Days <span class="h">(none = every day)</span><div class="seg dows" role="group" aria-label="Days">${[1, 2, 3, 4, 5, 6, 7].map((x) => `<button type="button" data-agday="${x}" aria-pressed="${d.when.days.includes(x)}">${DAYN[x]}</button>`).join("")}</div></div></div>`
              : `<label class="fl">How long before<select id="agHours">${[1, 2, 3, 4, 6, 8, 12, 24, 48].map((h) => `<option value="${h}" ${d.when.hours === h ? "selected" : ""}>${plural(h, "hour")}</option>`).join("")}</select></label>`}
          </fieldset>
          <fieldset class="agfs"><legend>2. What it checks</legend>
            <label class="fl">Job<select id="agJob">${Object.entries(AG_JOBS).map(([k, x]) => `<option value="${k}" ${j.type === k ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
            <span class="hint">${esc(job.explain)}</span>${jobFields}
          </fieldset>
          <fieldset class="agfs"><legend>3. Who it tells</legend>
            <div class="chips">${Object.entries(AG_ROLES).map(([k, l]) => `<button type="button" data-agrole="${k}" aria-pressed="${d.notify.roles.includes(k)}">${l}</button>`).join("")}</div>
            <div class="fl">Or particular people<div class="chips">${AG_PEOPLE.filter((p) => !d.notify.roles.includes(p.role)).map((p) => `<button type="button" data-agppl="${p.k}" aria-pressed="${d.notify.people.includes(p.k)}">${esc(p.name)}</button>`).join("")}</div></div>
            <span class="hint">Push notifications to the staff app, never to clients. Instructors only hear about their own classes.</span>
          </fieldset>
          <fieldset class="agfs"><legend>4. What it can see</legend>
            ${Object.entries(AG_SEES).map(([k, l]) => { const need = job.needs.includes(k); return `<label class="check" for="agSee_${k}"><input type="checkbox" id="agSee_${k}" data-agsee="${k}" ${d.sees.includes(k) ? "checked" : ""} ${need ? "disabled" : ""}> ${esc(l)}${need ? ' <span class="muted">(needed for this job)</span>' : ""}</label>`; }).join("")}
            <div class="agnever"><b>Never, whatever you choose:</b> ${esc(AG_NEVER.join("; ").toLowerCase())}.</div>
          </fieldset>
          <div class="agprevbox"><h3>If it ran now</h3>${prev.out.length ? prev.out.slice(0, 3).map((m) => pushMock(m)).join("") + (prev.out.length > 3 ? `<span class="muted" style="font-size:12.5px">and ${plural(prev.out.length - 3, "more person", "more people")}</span>` : "") : `<p class="muted" style="margin:0;font-size:13px">${esc(prev.summary)} It only sends something when there's something to say.</p>`}</div>
        </div>
        <footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">${a.id ? "Save" : "Create agent"}</button></footer></form></div>`;
      bind();
    };
    const keepName = () => { if ($("#agName")) a.name = $("#agName").value; };
    const bind = () => {
      const on = (sel, fn) => document.querySelectorAll(sel).forEach((b) => (b.onclick = () => { keepName(); fn(b); paint(); }));
      on("[data-agwhen]", (b) => (d.when = b.dataset.agwhen === "daily" ? { type: "daily", time: "09:00", days: [] } : { type: "before_class", hours: 2 }));
      on("[data-agday]", (b) => { const x = Number(b.dataset.agday); d.when.days = d.when.days.includes(x) ? d.when.days.filter((y) => y !== x) : [...d.when.days, x]; });
      on("[data-agrole]", (b) => { const k = b.dataset.agrole; d.notify.roles = d.notify.roles.includes(k) ? d.notify.roles.filter((x) => x !== k) : [...d.notify.roles, k]; d.notify.people = d.notify.people.filter((p) => !d.notify.roles.includes(AG_PEOPLE.find((x) => x.k === p).role)); });
      on("[data-agppl]", (b) => { const k = b.dataset.agppl; d.notify.people = d.notify.people.includes(k) ? d.notify.people.filter((x) => x !== k) : [...d.notify.people, k]; });
      document.querySelectorAll("[data-agsee]").forEach((c) => (c.onchange = () => { keepName(); const k = c.dataset.agsee; d.sees = c.checked ? [...new Set([...d.sees, k])] : d.sees.filter((x) => x !== k); paint(); }));
      const ch = (id, fn) => { if ($(id)) $(id).onchange = (e) => { keepName(); fn(e.target.value); paint(); }; };
      ch("#agTime", (v) => (d.when.time = v || "09:00"));
      ch("#agHours", (v) => (d.when.hours = Number(v)));
      ch("#agJob", (v) => { d.job = agClone(AG_STARTERS.find((s) => s.def.job.type === v).def.job); });
      ch("#agAhead", (v) => (d.job.daysAhead = Number(v)));
      ch("#agMode", (v) => { d.job.mode = v; d.job.value = v === "count" ? 3 : 30; });
      ch("#agVal", (v) => (d.job.value = Math.max(1, Math.min(d.job.mode === "count" ? 200 : 100, Number(v) || 1))));
      ch("#agAtLeast", (v) => (d.job.atLeast = Math.max(1, Math.min(50, Number(v) || 1))));
      $("#agName").oninput = () => { a.name = $("#agName").value; };
      $("#agForm").onsubmit = (e) => {
        e.preventDefault();
        keepName();
        const name = a.name.trim();
        if (!name) { toast("Give your agent a name."); $("#agName").focus(); return; }
        if (!/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u.test(name)) return toast("Use letters, numbers and spaces in the name.");
        if (AGENTS.some((x) => x.id !== a.id && x.name.toLowerCase() === name.toLowerCase())) return toast(`You already have an agent called ${name}. Pick another name.`);
        if (!d.notify.roles.length && !d.notify.people.length) return toast("Choose who the agent tells.");
        if (a.id) { const x = AGENTS.find((y) => y.id === a.id); x.name = name; x.def = d; toast(`${name} saved.`); }
        else { AGENTS.push({ id: nextAgentId++, name, starter: a.starter, enabled: true, def: d, runs: [] }); toast(`${name} is set up. ${d.when.type === "daily" ? `First run: ${agAt(agNext(d))}.` : "It'll run before each class."}`); }
        closeModal(); state.agTab = "agents"; render();
      };
    };
    paint();
  }
  const pushMock = (m) => `<div class="pushmock"><div class="pmtop"><span class="pmapp" aria-hidden="true">D</span><b>${esc(m.title)}</b><span class="muted">now</span></div><div class="pmto">To ${esc(m.to.name)} · ${esc(AG_ROLES[m.to.role])}</div><p>${esc(m.body)}</p></div>`;
  function openAgentPreview(a) {
    const m = agMessages(a);
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal agmodal" role="dialog" aria-modal="true" aria-labelledby="agPvT"><header><h2 id="agPvT">What ${esc(a.name)} would send now</h2></header>
      <div class="mb"><span class="hint">Nothing is sent from here. ${esc(m.summary)}</span>${m.out.length ? m.out.map(pushMock).join("") : ""}</div><footer><button type="button" class="btn primary" data-mclose>Close</button></footer></div></div>`;
  }

  // --- The assistant (Ask) ------------------------------------------------------
  // The live assistant uses Claude with the studio guide and the studio's own data. The preview
  // answers a handful of sample questions with the same rules, so you can see how it behaves.
  const askState = { open: false, msgs: [], busy: false };
  const AS_ROLE = () => ({ admin: "admin", foh: "front_desk", instructor: "instructor" })[state.role];
  function renderAsk() {
    let root = $("#askRoot");
    if (!root) { root = document.createElement("div"); root.id = "askRoot"; document.body.appendChild(root); }
    const r = AS_ROLE();
    // A different person (View as): a fresh chat.
    if (askState.role !== state.role) { askState.role = state.role; askState.msgs = []; askState.open = false; }
    if (!r || !agState.assistant.enabled || !agState.assistant.roles.includes(r === "admin" ? "admin" : r)) { root.innerHTML = ""; askState.open = false; return; }
    if (!askState.open) { root.innerHTML = `<button type="button" class="askbtn" id="askBtn" data-help="Ask the assistant how to do something, or why something isn't working.">${ASK_ICON}<span>Ask</span></button>`; $("#askBtn").onclick = () => { askState.open = true; renderAsk(); setTimeout(() => $("#askIn")?.focus(), 0); }; return; }
    const sugg = askSuggestions();
    root.innerHTML = `<section class="askpanel" role="dialog" aria-label="Assistant"><header><div><b>Assistant</b><span class="muted">Sees only what your role can see. Never handles payments.</span></div><button type="button" class="iconbtn" id="askClose" aria-label="Close assistant">✕</button></header>
      <div class="askmsgs" id="askMsgs" aria-live="polite">${askState.msgs.length ? "" : `<div class="askhi"><p>Hi! Ask me how to do something in the app, or why something isn't working, like why a client can't be booked in.</p></div>`}${askState.msgs.map((m, i) => `<div class="askmsg ${m.who}">${m.who === "me" ? esc(m.text) : m.html}${m.action ? actionCard(m.action, i) : ""}</div>`).join("")}${askState.busy ? '<div class="askmsg bot typing" aria-label="Thinking"><span></span><span></span><span></span></div>' : ""}</div>
      ${askState.msgs.length < 2 ? `<div class="asksugg">${sugg.map((s) => `<button type="button" data-asks="${esc(s)}">${esc(s)}</button>`).join("")}</div>` : ""}
      <form class="askform" id="askForm"><label class="sr" for="askIn">Your question</label><input id="askIn" maxlength="2000" placeholder="Ask a question…" autocomplete="off"><button type="submit" class="btn primary">Send</button></form>
      ${state.role === "admin" ? `<div class="askfoot">${Math.max(0, agState.allowance - agState.used) + agState.topUps} AI credits left this month · <button type="button" class="linkbtn" id="askUsage">Usage</button></div>` : ""}</section>`;
    $("#askClose").onclick = () => { askState.open = false; renderAsk(); };
    $("#askForm").onsubmit = (e) => { e.preventDefault(); const v = $("#askIn").value.trim(); if (v) askSend(v); };
    document.querySelectorAll("[data-asks]").forEach((b) => (b.onclick = () => askSend(b.dataset.asks)));
    document.querySelectorAll("[data-asyes]").forEach((b) => (b.onclick = () => askConfirm(Number(b.dataset.asyes))));
    document.querySelectorAll("[data-asno]").forEach((b) => (b.onclick = () => { const m = askState.msgs[Number(b.dataset.asno)]; m.action.status = "declined"; askState.msgs.push({ who: "bot", html: "<p>No problem, I've left it.</p>" }); renderAsk(); }));
    if ($("#askUsage")) $("#askUsage").onclick = () => { state.agTab = "usage"; go("agents"); };
    const box = $("#askMsgs"); box.scrollTop = box.scrollHeight;
  }
  const ASK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 18l-1 3 3.5-1.5A8 8 0 1 0 5 18z"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1v.5M12 16.5h.01"/></svg>';
  const actionCard = (a, i) => `<div class="askact ${a.status}"><b>${esc(a.summary)}</b>${a.warn ? `<span class="muted">${esc(a.warn)}</span>` : ""}${a.status === "proposed" ? `<div class="row" style="gap:6px"><button type="button" class="btn primary" data-asyes="${i}">Confirm</button><button type="button" class="btn ghost" data-asno="${i}">No thanks</button></div>` : `<span class="muted">${a.status === "done" ? "✓ Done" : "Not done"}</span>`}</div>`;

  // Finding things in a question.
  const DAYWORDS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
  function findClient(t) {
    const full = CLIENTS.findIndex((c) => t.includes(c.name.toLowerCase()));
    if (full >= 0) return full;
    const hits = CLIENTS.map((c, i) => ({ c, i })).filter(({ c }) => new RegExp(`\\b${c.name.split(" ")[0].toLowerCase()}\\b`).test(t));
    return hits.length === 1 ? hits[0].i : -1;
  }
  function findClass(t) {
    let date = null;
    if (/\btoday\b/.test(t)) date = day(NOW); else if (/\btomorrow\b/.test(t)) date = addDays(day(NOW), 1);
    else for (const [w, dn] of Object.entries(DAYWORDS)) if (new RegExp(`\\b${w}('s)?\\b`).test(t)) { let d = day(NOW); for (let i = 0; i < 7; i++) { if (d.getDay() === dn && (i || NOW.getHours() < 21)) break; d = addDays(d, 1); } date = d; break; }
    const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) || t.match(/\b(\d{1,2}):(\d{2})\b/);
    let hh = null, mm = 0;
    if (tm) { hh = Number(tm[1]); mm = Number(tm[2] || 0); if (tm[3] === "pm" && hh < 12) hh += 12; if (tm[3] === "am" && hh === 12) hh = 0; }
    const type = Object.entries(TYPES).find(([, ty]) => t.includes(ty.name.toLowerCase().split(" ")[0]))?.[0];
    if (!date && hh === null && !type) return null;
    const list = SESSIONS.filter((s) => s.start > addDays(NOW, -1) && (!date || ymd(s.start) === ymd(date)) && (hh === null || (s.start.getHours() === hh && s.start.getMinutes() === mm)) && (!type || s.type === type)).sort((a, b) => a.start - b.start);
    return { list, date, hh, type };
  }
  const clsLabel = (s) => `${TYPES[s.type].name}, ${fmtDay(s.start)} ${short(s.start)}`;
  /** Why a client can or can't be booked: the same checks as the booking rules. */
  function diagnose(ci, s) {
    const c = CLIENTS[ci], fn = firstName(c.name);
    if (s.status !== "scheduled") return { ok: false, why: "That class has been cancelled." };
    if (s.end <= NOW) return { ok: false, why: "That class has already finished." };
    if (s.roster.some((r) => r.ci === ci)) return { ok: false, why: `${c.name} is already booked into it.` };
    if (c.source === "classpass") {
      if (!s.cpOn) return { ok: false, why: `${c.name} comes through ClassPass, and ClassPass isn't switched on for this class. Turn it on in the class's settings first.` };
      if (cpTaken(s) >= s.cpSpots) return { ok: false, why: `${c.name} comes through ClassPass, and all ${s.cpSpots} ClassPass spots are taken. You can raise the number in the class's settings.` };
    } else if (waiverMissing(c)) return { ok: false, why: `${c.name} hasn't signed the studio's waiver yet. They sign it in the app at their first booking, or Front of House can mark a paper copy as done.` };
    if (s.roster.length >= s.cap) return { ok: false, full: true, why: `The class is full (${s.roster.length} of ${s.cap}).${s.waitlist.length ? ` ${plural(s.waitlist.length, "person is", "people are")} already waiting.` : ""} You could add ${fn} to the waitlist instead.` };
    if (c.source === "classpass") return { ok: true, why: `Nothing's stopping it: ${plural(s.cap - s.roster.length, "spot")} left, and ${fn} would book through ClassPass.` };
    const opts = pkgOptions(ci, s), good = opts.find((o) => !o.why);
    if (good) return { ok: true, pk: good.pk, why: `Nothing's stopping it: there ${s.cap - s.roster.length === 1 ? "is 1 spot" : `are ${s.cap - s.roster.length} spots`} left and ${fn}'s ${good.pk.name} covers it.` };
    if (!STUDIO.needPackage && !isAppt(s)) return { ok: true, payLater: true, why: `Nothing's stopping it: there are spots left, and your studio lets people pay at the studio.` };
    const reason = opts.length ? `${fn}'s ${opts[0].pk.name} can't be used: ${opts[0].why.charAt(0).toLowerCase()}${opts[0].why.slice(1)}.` : `${c.name} doesn't have a package that covers ${TYPES[s.type].name}.`;
    const showPkg = state.role === "admin";
    const why = showPkg ? reason : "They don't have a package that covers this class.";
    return STUDIO.allowNoPkg
      ? { ok: false, noPkg: true, why: `${why} You can still book them as “Pay at studio” after a warning${showPkg ? ", or sell them a package first" : " (owners and admins)"}. I can't do that one for you, as it's a payment decision.` }
      : { ok: false, noPkg: true, why: `${why} Your studio only allows bookings with a package (Studio rules), so ${showPkg ? "sell them one first, or book it as complimentary" : "an owner or admin will need to sell them one first"}.` };
  }
  function askSuggestions() {
    const sat = SESSIONS.filter((s) => s.start > NOW && s.start.getDay() === 6 && s.type === "reformer" && s.status === "scheduled").sort((a, b) => a.start - b.start)[0];
    const out = [];
    if (sat && state.role !== "instructor") {
      const ci = [1, ...CLIENTS.map((_, i) => i)].find((i) => !diagnose(i, sat).ok && diagnose(i, sat).noPkg) ?? 1;
      out.push(`Why can't I book ${CLIENTS[ci].name} into Saturday's ${short(sat.start)} Reformer class?`);
    }
    out.push("Can you refund Chloe Ng's recent package purchase?");
    out.push(state.role === "instructor" ? "How do I ask for cover?" : "How do I change lots of classes at once?");
    return out;
  }
  const FAQ = [
    [/edit many|change many|lots of classes|several classes|bulk|many classes at once/, "<p>Use <b>Edit many</b> on the Schedule. You can either pick classes on the calendar, or choose them with filters, like every Monday 7am Reformer for the next 3 months. Then change anything you'd set when creating a class, or cancel them all.</p>"],
    [/ask for cover|need cover|cover request|cover for/, "<p>Open your class on the schedule and choose <b>Ask for cover</b>. Your request goes to the instructors who can teach it, and an admin is told. You don't need to find someone yourself.</p>"],
    [/auto.?cancel/, "<p>A class can cancel itself if not enough people book. Set it in the class (or its template): <b>Cancel automatically</b>, then how many bookings it needs and how many hours before to check. Everyone booked is told and gets their class back.</p>"],
    [/agent/, "<p>Agents send your team reminders, like cover classes or quiet classes the night before. Owners and admins set them up under <b>Agents</b>: pick a ready-made one, name it, choose who it tells and what it can see. They never see client details or payments, and never change anything.</p>"],
    [/classpass/, "<p>Open the class's settings and switch on <b>ClassPass</b>, then choose how many spots ClassPass can have. Spots ClassPass doesn't use stay open to your members.</p>"],
    [/waitlist/, "<p>When a class is full, clients can join its waitlist. In automatic mode the first person waiting gets a spot that opens; in manual mode it's held for them for a few minutes (see Studio rules).</p>"],
    [/appointment/, "<p>Use <b>+ New appointment</b> on the Schedule for private sessions. They don't show on the public schedule, and you can add the client straight away. Clients need a package that covers appointments.</p>"],
    [/new class|add a class|create a class|recurring|repeat/, "<p>Use <b>+ New class</b> on the Schedule. Start from a template to fill most details in, and choose <b>Repeats</b> to make it recurring.</p>"],
    [/report|zoom|busiest|quiet/, "<p>Go to <b>Reports</b>, then <b>Classes</b>, and use <b>Zoom in</b> to narrow it to a class, location, instructor, days or time of day. <b>When classes are busiest</b> shows each day and time of day at a glance.</p>"],
    [/package/, "<p>Owners and admins set up packages under <b>Packages</b>, and sell one to a client from their profile (<b>Clients</b>, then their name, then <b>Sell a package</b>).</p>"],
  ];
  function askAnswer(q) {
    const t = q.toLowerCase(), role = state.role;
    const ci = findClient(t);
    const who = ci >= 0 ? CLIENTS[ci].name : "";
    const notAdmin = role !== "admin";
    if (/refund|charge|payment|pay back|price|invoice|discount|waive|\bfee|payroll|salary|wage|gift card balance|credit card/.test(t)) {
      return { html: `<p>I can't do anything involving payments${/refund/.test(t) ? ", including refunds" : ""}${who ? `, so I can't ${/refund/.test(t) ? "refund" : "change payments for"} ${esc(who)}` : ""}.</p><p>${/refund/.test(t) ? `Refunds are done by an owner or admin: open the client (<b>Clients</b>, then ${who ? esc(who) : "their name"}), find the package and choose <b>Refund</b>.` : /fee|waive/.test(t) ? "Owners and admins collect or waive fees under <b>Fees</b>." : /payroll|salary|wage/.test(t) ? "Owners and admins handle pay under <b>Payroll</b>." : "Owners and admins handle payments from the client's profile."}${notAdmin ? " Your role can't do this either, so you'll need to ask an owner or admin." : ""}</p>` };
    }
    if (ci >= 0 && /phone|email|contact|number|address|health|injur|pregnan|medical/.test(t)) return { html: `<p>I can't share client contact details or health notes. ${role === "admin" || role === "foh" ? "You'll find contact details on the class list for any class they're booked into." : "You can see contact details and active health notes for clients in your own classes, on the class list."}</p>` };
    if (/delete|remove (a )?staff|permission|change (the )?(setting|rule)|settings/.test(t) && !/how/.test(t)) return { html: "<p>I can't change settings, staff or permissions, or delete anything. Owners and admins do those under <b>Setup</b> and <b>Team</b> in the menu.</p>" };
    const fc = findClass(t);
    if (ci >= 0 && fc) {
      if (!fc.list.length) return { html: `<p>I couldn't find a class matching that${fc.date ? ` on ${esc(fmtDay(fc.date))}` : ""}. Could you check the day and time?</p>` };
      const own = role === "instructor" ? fc.list.filter((s) => s.instr === ME.instructor) : fc.list;
      if (!own.length) return { html: "<p>You can only see your own classes, so I can't look that one up for you. Front of House or an admin can help.</p>" };
      if (own.length > 1 && fc.hh === null) return { html: `<p>A few classes match. Which one?</p><ul>${own.slice(0, 4).map((s) => `<li>${esc(clsLabel(s))}</li>`).join("")}</ul>` };
      const s = own[0], dg = diagnose(ci, s);
      const cancel = /cancel/.test(t) && s.roster.some((r) => r.ci === ci);
      if (cancel) {
        const late = (s.start - NOW) / 36e5 < STUDIO.lateCancelHours;
        if (notAdmin) return { html: `<p>Only owners and admins can cancel bookings for clients, so I can't do it for you either.</p>` };
        if (late) return { html: `<p>That would be a late cancellation (it's within ${STUDIO.lateCancelHours} hours), which affects ${esc(firstName(who))}'s package and maybe a fee. Cancel it yourself from the class so you can choose what happens.</p>` };
        return { html: `<p>${esc(who)} is booked into ${esc(clsLabel(s))}, and it's free to cancel. I can cancel it and give the class back to their package.</p>`, action: agState.assistant.actions ? { type: "cancel", ci, sid: s.id, summary: `Cancel ${who}'s booking for ${clsLabel(s)}`, status: "proposed" } : null };
      }
      if (/waitlist/.test(t) && s.roster.length >= s.cap) {
        if (notAdmin) return { html: "<p>Only owners and admins can add clients to a waitlist.</p>" };
        return { html: `<p>${esc(clsLabel(s))} is full. I can add ${esc(who)} to the waitlist.</p>`, action: agState.assistant.actions ? { type: "waitlist", ci, sid: s.id, summary: `Add ${who} to the waitlist for ${clsLabel(s)}`, status: "proposed" } : null };
      }
      let html = `<p><b>${esc(clsLabel(s))}</b>: ${esc(dg.why)}</p>`;
      if (notAdmin) html += `<p>${dg.ok ? "Only owners and admins can book clients in, so an admin would need to do it." : "Also, only owners and admins can book clients in."}</p>`;
      const offer = !notAdmin && agState.assistant.actions && ((dg.ok && !dg.payLater) || (dg.full && s.wl !== false));
      if (offer && dg.ok) return { html: html + `<p>Want me to book ${esc(firstName(who))} in?</p>`, action: { type: "book", ci, sid: s.id, pk: dg.pk?.id, summary: `Book ${who} into ${clsLabel(s)}${dg.pk ? ` with their ${dg.pk.name}` : ""}`, status: "proposed" } };
      if (offer && dg.full && s.wl !== false) return { html, action: { type: "waitlist", ci, sid: s.id, summary: `Add ${who} to the waitlist for ${clsLabel(s)}`, status: "proposed" } };
      return { html };
    }
    if (fc && fc.list.length && /how many|booked|full|spots|space/.test(t)) {
      const own = role === "instructor" ? fc.list.filter((s) => s.instr === ME.instructor) : fc.list;
      if (!own.length) return { html: "<p>You can only see your own classes.</p>" };
      return { html: `<ul>${own.slice(0, 5).map((s) => `<li><b>${esc(clsLabel(s))}</b>: ${s.roster.length} of ${s.cap} booked${s.waitlist.length ? `, ${s.waitlist.length} waiting` : ""}${s.instr ? ` · ${esc(STAFF[s.instr])}` : " · no instructor yet"}</li>`).join("")}</ul>` };
    }
    for (const [re, a] of FAQ) if (re.test(t)) return { html: a };
    if (ci >= 0) return { html: `<p>What would you like to know about ${esc(who)}? For example, why they can't be booked into a class (tell me which one).</p>` };
    return { html: `<p>I'm the preview version, so I can only answer a few sample questions here. In the live app I answer from the studio guide and your studio's own data.</p><p>Try asking why a client can't be booked into a class, how to change lots of classes at once, or how agents work.</p>` };
  }
  function askSend(q) {
    if (askState.busy) return;
    if (state.role === "admin" && agState.used >= agState.allowance && !agState.topUps) { askState.msgs.push({ who: "me", text: q }, { who: "bot", html: "<p>Your studio has used all its AI credits for this month. They're back on 1 December, or you can buy a top-up under Agents, Usage.</p>" }); renderAsk(); return; }
    askState.msgs.push({ who: "me", text: q });
    askState.busy = true; renderAsk();
    setTimeout(() => {
      const a = askAnswer(q);
      askState.busy = false;
      askState.msgs.push({ who: "bot", html: a.html, action: a.action || null });
      if (agState.used < agState.allowance) agState.used++; else if (agState.topUps) agState.topUps--;
      renderAsk();
    }, 450);
  }
  function askConfirm(i) {
    const m = askState.msgs[i], a = m.action, s = SESSIONS.find((x) => x.id === a.sid), c = CLIENTS[a.ci];
    if (a.type === "book") {
      const dg = diagnose(a.ci, s);
      if (!dg.ok) { a.status = "failed"; askState.msgs.push({ who: "bot", html: `<p>Things have changed: ${esc(dg.why)}</p>` }); renderAsk(); return; }
      if (dg.pk) useClass(dg.pk, a.ci, s);
      s.roster.push({ ci: a.ci, spot: spotsFor(s) ? freeSpot(s) || null : null, att: "unmarked", pay: dg.pk ? { kind: "package", pkg: dg.pk.id } : { kind: c.source === "classpass" ? "classpass" : "pay_later" } });
      askState.msgs.push({ who: "bot", html: `<p>Done. ${esc(c.name)} is booked into ${esc(clsLabel(s))}${dg.pk ? ` with their ${esc(dg.pk.name)}` : ""}, and they've been sent a confirmation.</p>` });
    } else if (a.type === "cancel") {
      const r = s.roster.find((x) => x.ci === a.ci);
      if (r) { giveBack(r, s, "Cancelled"); s.roster.splice(s.roster.indexOf(r), 1); }
      askState.msgs.push({ who: "bot", html: `<p>Done. ${esc(c.name)}'s booking is cancelled and the class is back on their package. They've been told.</p>` });
    } else {
      if (!s.waitlist.some((w) => w.ci === a.ci)) s.waitlist.push({ ci: a.ci, mode: "automatic", cutoff: null });
      askState.msgs.push({ who: "bot", html: `<p>Done. ${esc(c.name)} is on the waitlist for ${esc(clsLabel(s))}. They'll be told if a spot opens.</p>` });
    }
    a.status = "done";
    render(); renderAsk();
  }
