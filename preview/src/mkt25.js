  // ===========================================================================
  // One place for each job (roadmap #5 and #6, same rules as the API):
  //  - Tell clients (POST /tell-clients): write it once, choose who and where (a notice in the
  //    app, a banner, a push, an email). Replaces Announcements in the menu; announcements,
  //    banners and campaigns made here still show on their own pages.
  //  - Automations (GET /automations): client journeys and team reminders in one list. Replaces
  //    Agents in the menu (the old pages still open from here).
  //  - Write with AI (POST /ai/write): a button next to text boxes. Ask stays the one chat.
  // ===========================================================================
  {
    const aiOn = () => (typeof featOn === "function" ? featOn("agents") : true);
    const mkOn = () => (typeof featOn === "function" ? featOn("marketing") : true);
    const T = (state.tell ||= { kind: "news", title: "", message: "", importance: "info", who: "everyone", loc: "tp", within: 7, seg: "", notice: true, banner: false, bannerImg: 0, push: true, email: false, when: "now", at: "", sentFlash: null });
    const allIds = () => CLIENTS.map((_, i) => i);
    function audience() {
      if (T.who === "segment" && T.seg) return audienceOf(T.seg);
      if (T.who === "location" || T.who === "booked_at_location") {
        const until = addDays(NOW, T.who === "booked_at_location" ? T.within : 3650), from = T.who === "booked_at_location" ? NOW : addDays(NOW, -90);
        return [...new Set(SESSIONS.filter((s) => s.loc === T.loc && s.start >= from && s.start <= until).flatMap((s) => s.roster.map((r) => r.ci)))];
      }
      return allIds();
    }
    const offer = () => T.kind === "offer";
    function reach() {
      const ids = audience();
      const email = T.email ? (offer() ? ids.filter((i) => factsOf(i).marketingEmail === "yes").length : ids.length) : 0;
      const push = T.push ? (offer() ? ids.filter((i) => hash(CLIENTS[i].name + "pu") % 4 !== 0).length : ids.length) : 0;
      return { ids, notice: T.notice && !offer() ? ids.length : 0, push, email };
    }
    function problems() {
      const out = [];
      if (!T.title.trim()) out.push("a short title");
      if (!T.message.trim()) out.push("the message");
      if (!T.notice && !T.banner && !T.push && !T.email) out.push("at least one place to show it");
      if (T.who === "segment" && !T.seg) out.push("a segment");
      return out;
    }
    const placeLine = (r) => [T.notice && !offer() && `a${T.importance === "important" ? "n important" : ""} notice in the app for ${plural(r.ids.length, "person", "people")}`, T.banner && "a banner on Home", T.push && `a push notification to ${plural(r.push, "person", "people")}`, T.email && `an email to ${plural(r.email, "person", "people")}`].filter(Boolean);
    const aiBtn = (forId, kind) => `<button type="button" class="aiw ${aiOn() ? "" : "locked"}" data-aiw="${kind}" data-for="${forId}">${aiOn() ? "✦ Write with AI" : "✦ Write with AI · In Signature"}</button>`;

    PAGES.tell = function () {
      const r = reach(), canMk = state.role === "admin" && mkOn();
      if (offer() && !canMk) T.kind = "news";
      if (offer()) T.notice = false;
      if (!canMk) { T.banner = false; T.email = false; }
      const hist = [
        ...ANNOUNCEMENTS.map((a) => ({ at: a.starts, place: "Notice", title: a.title, detail: `${a.importance === "important" ? "Important · " : ""}${a.pushed ? `push to ${a.pushed}` : "in the app"}`, state: a.state })),
        ...(state.role === "admin" ? BANNERS.map((b) => ({ at: b.starts || "Running", place: "Banner", title: b.title, detail: `${b.placement === "home" ? "Home" : b.placement === "schedule" ? "Book a class" : "Packages"}, ${b.clicks} taps`, state: b.active ? "showing" : "ended" })) : []),
        ...(state.role === "admin" ? CAMPAIGNS.map((c) => ({ at: c.when, place: "Email", title: c.name, detail: c.status === "sent" ? `to ${c.recipients}` : c.status, state: c.status === "scheduled" ? "scheduled" : "ended" })) : []),
      ];
      const who = `<div class="tcwho"><select id="tcWho" aria-label="Who"><option value="everyone" ${T.who === "everyone" ? "selected" : ""}>Everyone (${CLIENTS.length})</option><option value="location" ${T.who === "location" ? "selected" : ""}>People who come to one location</option><option value="booked_at_location" ${T.who === "booked_at_location" ? "selected" : ""}>People booked at a location soon</option>${canMk ? `<option value="segment" ${T.who === "segment" ? "selected" : ""}>A segment</option>` : ""}</select>
        ${T.who === "location" || T.who === "booked_at_location" ? `<select id="tcLoc" aria-label="Location">${Object.entries(LOCS).map(([k, v]) => `<option value="${k}" ${T.loc === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>` : ""}
        ${T.who === "booked_at_location" ? `<select id="tcWithin" aria-label="Booked within">${[1, 3, 7, 14].map((d) => `<option value="${d}" ${T.within === d ? "selected" : ""}>in the next ${plural(d, "day")}</option>`).join("")}</select>` : ""}
        ${T.who === "segment" ? `<select id="tcSeg" aria-label="Segment"><option value="">Choose a segment</option>${SEGMENTS.map((s) => `<option value="${s.id}" ${T.seg === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>` : ""}</div>`;
      const place = (k, label, hint, n, dis = "") => `<label class="tcplace ${T[k] ? "on" : ""} ${dis ? "off" : ""}" for="tc_${k}"><input type="checkbox" id="tc_${k}" data-tcp="${k}" ${T[k] ? "checked" : ""} ${dis ? "disabled" : ""}><span><b>${label}</b><span>${dis || hint}</span></span>${n !== null && T[k] && !dis ? `<em>${n}</em>` : ""}</label>`;
      return head("Tell clients", "Say it once, then choose who and where: a notice in the app, a banner, a push notification or an email.") +
        `<div class="tcgrid"><div class="card stack tccompose" style="gap:16px">
          <div class="seg" role="group" aria-label="What is it?"><button type="button" data-tck="news" aria-pressed="${!offer()}">Studio news</button><button type="button" data-tck="offer" aria-pressed="${offer()}" ${canMk ? "" : `disabled data-help="Offers are for owners and admins, with Marketing on Growth and Signature."`}>An offer</button></div>
          <span class="hint" style="margin-top:-8px">${offer() ? "Offers only reach people who agreed to marketing, and can't be notices." : "News reaches everyone it's about: a closure, a change, something people need to know."}</span>
          <label class="fl">Title <span class="count">${T.title.length}/60</span><input id="tcTitle" maxlength="60" value="${esc(T.title)}" placeholder="${offer() ? "e.g. Bring a friend free this weekend" : "e.g. Lift out of order"}"></label>
          <label class="fl">Message <span class="count">${T.message.length}/280</span><textarea id="tcMsg" rows="4" maxlength="280" placeholder="${offer() ? "What it is, when, and how to get it." : "What's happening, and what people need to do."}">${esc(T.message)}</textarea></label>
          ${aiBtn("tcMsg", "message")}
          <div class="stack" style="gap:6px"><b class="tclab">Who</b>${who}</div>
          <div class="stack" style="gap:8px"><b class="tclab">Where</b>
            <div class="tcplaces">
              ${place("notice", "Notice in the app", "At the top of Home and Book a class until it ends.", r.notice, offer() ? "Offers can't be notices. Use a banner, push or email." : "")}
              ${place("push", "Push notification", offer() ? "Only people who agreed to marketing pushes." : "To everyone it's about.", r.push)}
              ${place("email", "Email", offer() ? "Only people who agreed to marketing emails." : "To everyone it's about.", r.email, canMk ? "" : "Emails are for owners and admins, with Marketing.")}
              ${place("banner", "Banner", "A picture on Home that taps through to your offer.", null, !canMk ? "Banners come with Marketing on Growth and Signature." : T.who === "everyone" || T.who === "segment" ? "" : "Banners show to everyone or a segment.")}
            </div>
            ${T.notice && !offer() ? `<label class="check" for="tcImp"><input type="checkbox" id="tcImp" ${T.importance === "important" ? "checked" : ""}> Important (in red, for disruptions and safety)</label>` : ""}
          </div>
          <div class="row" style="gap:8px;flex-wrap:wrap"><div class="seg" role="group" aria-label="When"><button type="button" data-tcw="now" aria-pressed="${T.when === "now"}">Now</button><button type="button" data-tcw="later" aria-pressed="${T.when === "later"}">Schedule</button></div>${T.when === "later" ? `<input type="datetime-local" id="tcAt" value="${esc(T.at || "2026-11-12T09:00")}" aria-label="When to send">` : ""}</div>
          <p class="hint" id="tcErr" role="alert"></p>
          <div class="row" style="gap:8px"><button type="button" class="btn primary" id="tcSend">${T.when === "later" ? "Schedule" : "Send"}</button><span class="hint">${placeLine(r).length ? `${placeLine(r).join(", ")}.` : "Choose where it goes."}</span></div>
        </div>
        <div class="stack" style="gap:12px;min-width:0">
          <div class="card stack tcprev" style="gap:10px"><b class="tclab">How it looks</b>
            ${T.notice && !offer() ? `<div class="annbar ${T.importance}"><span class="ic">${T.importance === "important" ? "!" : "i"}</span><div><b>${esc(T.title || "Your title")}</b> ${esc(T.message || "Your message")}</div></div>` : ""}
            ${T.push ? `<div class="tcpush"><span class="ap" aria-hidden="true">D</span><div><b>${esc(T.title || "Your title")}</b><span>${esc((T.message || "Your message").slice(0, 110))}</span></div><i>now</i></div>` : ""}
            ${T.email ? `<div class="tcmail"><span class="hint">Subject</span><b>${esc(T.title || "Your title")}</b><p>${esc(T.message || "Your message")}</p><span class="btn small">Open the app</span></div>` : ""}
            ${T.banner ? `<div class="tcban"><b>${esc(T.title || "Your title")}</b><span>${esc((T.message || "").slice(0, 80))}</span></div>` : ""}
            ${!T.notice && !T.push && !T.email && !T.banner ? '<span class="hint">Choose where it goes to see it here.</span>' : ""}
          </div>
          <div class="card stack" style="gap:6px"><b class="tclab">What clients have been told</b>
            ${hist.slice(0, 8).map((h) => `<div class="tchist"><span class="tcpl">${h.place}</span><div class="stack" style="gap:1px;min-width:0"><b>${esc(h.title)}</b><span class="hint">${esc(h.at)} · ${esc(h.detail)}</span></div><span class="status ${h.state}">${{ showing: "Showing", scheduled: "Scheduled", ended: "Done" }[h.state] || h.state}</span></div>`).join("")}
          </div></div></div>`;
    };
    BIND.tell = function () {
      const keep = (id, fn) => { const el = $(id); if (!el) return; el.addEventListener("input", () => { fn(el); const pos = el.selectionStart; render(); const n = $(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }); };
      keep("#tcTitle", (el) => (T.title = el.value));
      keep("#tcMsg", (el) => (T.message = el.value));
      document.querySelectorAll("[data-tck]").forEach((b) => (b.onclick = () => { T.kind = b.dataset.tck; if (T.kind === "news") T.notice = true; render(); }));
      document.querySelectorAll("[data-tcw]").forEach((b) => (b.onclick = () => { T.when = b.dataset.tcw; render(); }));
      document.querySelectorAll("[data-tcp]").forEach((c) => (c.onchange = () => { T[c.dataset.tcp] = c.checked; render(); }));
      $("#tcWho") && ($("#tcWho").onchange = (e) => { T.who = e.target.value; if (!["everyone", "segment"].includes(T.who)) T.banner = false; render(); });
      $("#tcLoc") && ($("#tcLoc").onchange = (e) => { T.loc = e.target.value; render(); });
      $("#tcWithin") && ($("#tcWithin").onchange = (e) => { T.within = Number(e.target.value); render(); });
      $("#tcSeg") && ($("#tcSeg").onchange = (e) => { T.seg = e.target.value; render(); });
      $("#tcImp") && ($("#tcImp").onchange = (e) => { T.importance = e.target.checked ? "important" : "info"; render(); });
      $("#tcAt") && ($("#tcAt").onchange = (e) => (T.at = e.target.value));
      $("#tcSend").onclick = () => {
        const miss = problems();
        if (miss.length) { $("#tcErr").textContent = `Add ${miss.join(", ")}.`; return; }
        const r = reach(), parts = placeLine(r), later = T.when === "later";
        confirmFlags([{ level: "confirm", title: later ? "Schedule this?" : "Send this?", msg: `${later ? "Schedule" : "Send"} “${T.title}”: ${parts.join(", ")}?${T.push || T.email ? " Push notifications and emails can't be taken back once they're sent." : ""}` }, ...(offer() && (T.push || T.email) && (r.email < r.ids.length || r.push < r.ids.length) ? [{ level: "info", title: "Only people who agreed", msg: `It's an offer, so only people who agreed to marketing get it.` }] : [])], {
          title: later ? "Schedule this?" : "Send this?", proceedLabel: later ? "Schedule" : "Send",
          proceed: () => {
            const when = later ? "Scheduled" : "Today " + clock(NOW);
            if (T.notice && !offer()) ANNOUNCEMENTS.unshift({ id: `a${ANNOUNCEMENTS.length + 10}`, title: T.title, message: T.message, importance: T.importance, audience: T.who === "segment" ? "everyone" : T.who, loc: T.loc, within: T.within, starts: when, ends: "In 24 hours", state: later ? "scheduled" : "showing", pushed: T.push ? r.push : null, by: "You" });
            if (T.banner) BANNERS.unshift({ id: `b${BANNERS.length + 10}`, title: T.title, subtitle: T.message.slice(0, 160), img: BANNERS[0]?.img, placement: "home", link: "none", target: "", audience: T.who === "segment" ? "segment" : "everyone", segId: T.seg || null, starts: later ? T.at : "", ends: "", active: true, views: 0, clicks: 0 });
            if (T.email) CAMPAIGNS.unshift({ id: `cp${CAMPAIGNS.length + 10}`, name: T.title, emailId: EMAILS[0].id, segId: T.who === "segment" ? T.seg : null, status: later ? "scheduled" : "sent", when: later ? T.at : "Just now", recipients: later ? 0 : r.email, skipped: later ? 0 : r.ids.length - r.email, delivered: later ? 0 : r.email });
            closeModal();
            toast(`${later ? "Scheduled" : "Sent"}: ${parts.join(", ")}.`);
            Object.assign(T, { title: "", message: "", importance: "info" });
            render();
          },
        });
      };
    };

    // --- Automations: client journeys and team reminders in one list ---------------------------
    const TRIG = { account_created: "Creates an account", first_class_booked: "Books their first class", class_attended: "Attends a class", attendance_milestone: "Reaches a number of classes", package_bought: "Buys a package", package_expiring: "Package about to expire", package_used_up: "Uses their last class", membership_stopped: "Stops a membership", inactive: "Hasn't come for a while", joins_segment: "Joins a segment" };
    PAGES.automations = function () {
      const forClients = mkOn(), forTeam = aiOn();
      const row = (x) => `<div class="aurow"><span class="aufor ${x.for}">${x.for === "clients" ? "For clients" : "For your team"}</span><div class="stack" style="gap:2px;min-width:0"><b>${esc(x.name)}</b><span class="hint">${x.when ? `${esc(x.when)} · ` : ""}${esc(x.does)}</span></div><span class="status ${x.on ? "live" : "draft"}">${x.on ? "On" : x.status === "paused" ? "Paused" : x.status === "draft" ? "Draft" : "Off"}</span><button type="button" class="btn" data-auopen="${x.kind}:${x.id}">Open</button></div>`;
      const items = [
        ...(forClients ? JOURNEYS.map((j) => ({ kind: "journey", id: j.id, for: "clients", name: j.name, when: TRIG[j.def.trigger.type] || j.def.trigger.type, does: `${plural(j.def.steps.length, "step")}: messages to clients`, on: j.status === "live", status: j.status })) : []),
        ...(forTeam ? AGENTS.map((a) => ({ kind: "agent", id: a.id, for: "team", name: a.name, when: "", does: describeAg(a.def).replace(/\.$/, ""), on: a.enabled, status: a.enabled ? "on" : "off" })) : []),
      ];
      const f = state.auFor || "all";
      return head("Automations", "Everything that runs by itself: journeys that message clients, and reminders for your team.", `${forClients ? '<button type="button" class="btn" id="auNewJ">+ Journey for clients</button>' : ""}${forTeam ? '<button type="button" class="btn" id="auNewT">+ Reminder for your team</button>' : ""}`) +
        `<div class="seg" role="group" aria-label="Show" style="margin-bottom:12px"><button type="button" data-auf="all" aria-pressed="${f === "all"}">All (${items.length})</button><button type="button" data-auf="clients" aria-pressed="${f === "clients"}">For clients</button><button type="button" data-auf="team" aria-pressed="${f === "team"}">For your team</button></div>
        <div class="card stack" style="gap:0">${items.filter((x) => f === "all" || x.for === f).map(row).join("") || '<p class="muted">Nothing here yet.</p>'}</div>
        ${!forClients ? alertBox("info", "Journeys for clients", "Come with Marketing on Growth and Signature.") : ""}${!forTeam ? alertBox("info", "Reminders for your team", "Come with AI workflows on Signature: cover reminders, quiet-class checks, teaching line-ups.") : ""}
        ${alertBox("info", "Where did Agents go?", "Team reminders (what used to be Agents) live here now, next to client journeys. To ask a question or get help, use Ask; to write something, use Write with AI next to the text box.")}`;
    };
    BIND.automations = function () {
      document.querySelectorAll("[data-auf]").forEach((b) => (b.onclick = () => { state.auFor = b.dataset.auf; render(); }));
      document.querySelectorAll("[data-auopen]").forEach((b) => (b.onclick = () => { const [k, id] = b.dataset.auopen.split(":"); if (k === "journey") { state.mtab = "journeys"; state.jOpen = id; go("marketing"); } else { go("agents"); } }));
      $("#auNewJ") && ($("#auNewJ").onclick = () => { state.mtab = "journeys"; state.jOpen = null; go("marketing"); });
      $("#auNewT") && ($("#auNewT").onclick = () => go("agents"));
    };

    // --- Menu: Tell clients instead of Announcements; Automations instead of Agents -------------
    NAV.push({ id: "tell", roles: ["admin", "foh"], label: "Tell clients", help: "Say something to clients once: a notice in the app, a banner, a push notification or an email." });
    NAV.push({ id: "automations", roles: ["admin"], label: "Automations", help: "Journeys that message clients, and reminders for your team. Everything that runs by itself." });
    ICONS.tell = '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>';
    ICONS.automations = '<path d="M5 7h9M5 12h14M5 17h7"/><circle cx="17" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>';
    for (const id of ["announcements", "agents"]) { const n = NAV.find((x) => x.id === id); if (n) n.hidden = true; }
    NAV_ORDER.find(([g]) => g === "Day to day")[1].splice(NAV_ORDER.find(([g]) => g === "Day to day")[1].indexOf("announcements"), 1, "tell");
    { const team = NAV_ORDER.find(([g]) => g === "Team")[1]; team.splice(team.indexOf("agents"), 1); NAV_ORDER.find(([g]) => g === "Growth")[1].push("automations"); }
    { const c = HUBS.find((h) => h.id === "comms"); if (c) { c.tabs = c.tabs.map(([k, l]) => (k === "announcements" ? ["tell", "Tell clients"] : [k, l])); c.help = "Client messages, and telling clients things: notices, banners, pushes and emails."; } }
    for (const id of ["tell", "automations"]) { const n = NAV.find((x) => x.id === id); n.group = (role) => navGroup(id, role); }
    // Automations depends on Marketing or AI workflows.
    { const n = NAV.find((x) => x.id === "automations"); Object.defineProperty(n, "hidden", { get: () => !(mkOn() || aiOn()), configurable: true }); }

    // --- Write with AI, next to text boxes ------------------------------------------------------
    const AI_BOXES = [["#tcMsg", "message"], ["#ibxText", "reply"], ["#plDesc", "package_description"], ["#jfM", "journey_step"], ["#bkText", "journey_step"]];
    const DRAFTS = {
      message: () => (offer() ? ["Bring a friend free this weekend", "This Saturday and Sunday, your friend's first class is on us. Book them in with you in the app; spots are limited to the class size."] : ["Lift out of order", "The lift at Tanjong Pagar is being repaired until [date]. Please use the stairs on the left of the lobby. Thanks for bearing with us."]),
      reply: (ctx) => [null, `Hi! Thanks for your message${ctx ? ` about “${ctx.slice(0, 40)}${ctx.length > 40 ? "…" : ""}”` : ""}. [Answer here]. Let us know if there's anything else we can help with.`],
      package_description: () => [null, "Ten classes to use within three months of your first booking. Great if you come once or twice a week and want to mix classes."],
      journey_step: () => [null, "Hi {{first_name}}, we've missed you at the studio! Your next class is a tap away; book any class this week and say hi to the team."],
    };
    function decorateAI() {
      for (const [sel, kind] of AI_BOXES) {
        const box = document.querySelector(sel);
        if (!box || box.dataset.aiw || sel === "#tcMsg") continue;
        box.dataset.aiw = "1";
        box.insertAdjacentHTML("afterend", aiBtn(sel.slice(1), kind));
      }
      document.querySelectorAll("button.aiw:not([data-bound])").forEach((b) => {
        b.dataset.bound = "1";
        b.onclick = (e) => {
          e.preventDefault();
          if (!aiOn()) { toast("Write with AI comes with AI workflows on Signature. Ask is on every plan."); return; }
          const kind = b.dataset.aiw, el = document.getElementById(b.dataset.for);
          const ctx = kind === "reply" ? [...document.querySelectorAll("#ibxMsgs .msg.in, #ibxMsgs [class*='in']")].pop()?.textContent?.trim() : "";
          const [title, text] = DRAFTS[kind](ctx);
          if (kind === "message") { if (title) T.title = title; T.message = text; render(); }
          else if (el) { el.value = text; el.dispatchEvent(new Event("input", { bubbles: true })); }
          toast("Drafted with AI (1 AI credit). Check it, and fill in anything in [brackets].");
        };
      });
    }
    const renderBeforeOne = render;
    render = function () { renderBeforeOne(); decorateAI(); };
    const openModalBase = typeof openModal === "function" ? openModal : null;
    void openModalBase;
    document.addEventListener("click", () => setTimeout(decorateAI, 0), true);
  }
