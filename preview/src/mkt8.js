  // ===========================================================================
  // Communication: one inbox for WhatsApp and email (Gmail or Outlook). Same rules as modules/comms in the API:
  // nothing is sent until the studio has chosen how Meta is paid; free replies for 24 hours after
  // the client's last message; otherwise approved templates, with Meta's charge shown first.
  // ===========================================================================
  const MIN = 60_000, HR = 36e5;
  const COMMS = {
    billing: { mode: "credits", balance: 1840, ledger: [
      { when: "3 Nov", text: "Bought US$20.00 of message credits", change: 2000 },
      { when: "6 Nov", text: "WhatsApp marketing message (journey)", change: -6.5 },
      { when: "9 Nov", text: "WhatsApp marketing message", change: -6.5 },
      { when: "11 Nov", text: "12 journey messages", change: -147 },
    ] },
    rate: { marketing: 6.5, utility: 2.2 },
    wa: { connected: true, phone: "+65 6123 4567", coexistence: true },
    // The studio's own mailbox, connected with Google or Microsoft sign-in (no passwords stored).
    email: { connected: true, provider: "gmail", address: "hello@demostudio.sg", syncedMin: 2, error: null },
    tab: "inbox", filter: "open", chan: "all", q: "", open: null, draft: "",
  };
  const cname = (ci) => CLIENTS[ci]?.name;
  let nextMsgId = 1;
  const msg = (dir, origin, body, agoMin, extra = {}) => ({ id: nextMsgId++, dir, origin, body, at: new Date(+NOW - agoMin * MIN), status: dir === "in" ? "received" : "read", ...extra });
  const CONVOS = [
    { id: "c1", ci: 0, contact: "6591234567", status: "open", unread: 1, assigned: null, msgs: [
      msg("out", "journey", "Hi Chloe, you've used the last class on your pack. Want to keep your streak going? Reply YES and we'll send you a link to top up.", 60 * 26, { template: { name: "pack_used_up", category: "marketing" }, cost: 6.5 }),
      msg("in", "contact", "YES please! Also can I book Saturday 8am Reformer?", 60 * 25),
      msg("out", "phone_app", "Hi Chloe! Here's the link: demostudio.app/buy/10-pack. Saturday is booked for you 😊", 60 * 24.5),
      msg("in", "contact", "Thank you!! One more thing, is there parking near Tanjong Pagar?", 18) ] },
    { id: "c2", ci: 7, contact: "6582224141", status: "open", unread: 2, assigned: null, msgs: [
      msg("in", "contact", "Hello, I've been coming through ClassPass. What does a 10-class pack cost if I book with you directly?", 95),
      msg("in", "contact", "And do you have morning classes on weekdays?", 94) ] },
    { id: "c3", ci: null, contact: "6597771234", name: "Rachel", status: "open", unread: 1, assigned: null, msgs: [
      msg("in", "contact", "Hi, do you run prenatal pilates? I'm 20 weeks along.", 240) ] },
    { id: "c4", ci: 1, contact: "6581237788", status: "open", unread: 0, assigned: "fiona", msgs: [
      msg("in", "contact", "Hi, I need to cancel tomorrow's class, I'm sick 🤒", 60 * 52),
      msg("out", "platform", "Sorry to hear that Dev! I've cancelled it and your class credit is back. Get well soon.", 60 * 51.5, { by: "Fiona" }) ] },
    { id: "c5", ci: 10, contact: "6590012345", status: "closed", unread: 0, assigned: null, msgs: [
      msg("in", "contact", "Loved the private session today, thank you Ana!", 60 * 80),
      msg("out", "phone_app", "So glad! See you next week 💪", 60 * 79) ] },
    { id: "c6", channel: "email", ci: 4, contact: "farah.aziz@example.com", subject: "Receipt for my membership", status: "open", unread: 1, assigned: null, msgs: [
      msg("in", "contact", "Hi there, could you send me the receipt for this month's Unlimited membership? My company reimburses it. Thanks, Farah", 50) ] },
    { id: "c7", channel: "email", ci: null, contact: "grace.lim@acme-logistics.example", name: "Grace Lim", subject: "Corporate wellness sessions for our team", status: "open", unread: 1, assigned: null, msgs: [
      msg("in", "contact", "Hello, we're looking for a weekly lunchtime mat class for about 15 people at our office near Tanjong Pagar, starting in January. Do you run sessions on-site, and what would it cost?\n\nBest regards,\nGrace Lim\nPeople & Culture, Acme Logistics", 60 * 5) ] },
    { id: "c8", channel: "email", ci: 2, contact: "sarah.lee@example.com", subject: "Re: Your extension request", status: "closed", unread: 0, assigned: null, msgs: [
      msg("in", "contact", "Thanks so much for approving the extra two weeks, really appreciate it!", 60 * 30),
      msg("out", "platform", "You're welcome Sarah, rest up and see you soon.", 60 * 29, { by: "Fiona" }) ] },
  ];
  CONVOS.forEach((c) => { c.channel = c.channel || "whatsapp"; });
  const isEmail = (c) => c.channel === "email";
  const EMAIL_PROV = { gmail: "Gmail", outlook: "Outlook" };
  const convName = (c) => (c.ci !== null ? cname(c.ci) : c.name || `+${c.contact}`);
  const lastAt = (c) => c.msgs.at(-1).at;
  const lastIn = (c) => [...c.msgs].reverse().find((m) => m.dir === "in")?.at || null;
  const windowOpen = (c) => isEmail(c) || (!!lastIn(c) && NOW - lastIn(c) < 24 * HR);
  const ago = (d) => { const m = Math.round((NOW - d) / MIN); return m < 60 ? `${m} min ago` : m < 60 * 24 ? `${Math.round(m / 60)}h ago` : fmtDay(d); };
  const commsReady = () => (COMMS.billing.mode === "meta_direct" && COMMS.billing.confirmed) || COMMS.billing.mode === "credits";
  const usd = (c) => `US$${(c / 100).toFixed(2)}`;
  const unreadTotal = () => CONVOS.filter((c) => c.status === "open").reduce((a, c) => a + c.unread, 0);
  COMMS.billing.confirmed = true;

  PAGES.comms = function () {
    const tabs = `<div class="tabs" role="tablist">${[["inbox", `Inbox${unreadTotal() ? `<span class="n">${unreadTotal()}</span>` : ""}`], ["templates", "Templates"], ["settings", "Settings"]].map(([k, l]) => `<button type="button" role="tab" data-ctab="${k}" aria-selected="${COMMS.tab === k}">${l}</button>`).join("")}</div>`;
    const setup = !commsReady() || !COMMS.wa.connected;
    let body;
    if (COMMS.tab === "settings" || (setup && COMMS.tab === "inbox")) body = commsSettings(setup);
    else if (COMMS.tab === "templates") body = whatsappTemplatesCard();
    else body = commsInbox();
    return head("Communication", "Every message from clients in one place: WhatsApp and email.", `<span class="chanchips"><span class="chanchip ${COMMS.wa.connected ? "on" : ""}"><span class="srcdot wa" aria-hidden="true">W</span>WhatsApp</span><span class="chanchip ${COMMS.email.connected ? "on" : ""}" data-help="${COMMS.email.connected ? `Emails to ${esc(COMMS.email.address)} (${EMAIL_PROV[COMMS.email.provider]}) arrive here.` : "Connect Gmail or Outlook under Settings."}"><span class="srcdot em" aria-hidden="true">@</span>Email${COMMS.email.connected ? "" : " · not connected"}</span></span>`) + tabs + body;
  };

  function commsInbox() {
    const q = COMMS.q.toLowerCase();
    const list = CONVOS.filter((c) => (COMMS.filter === "all" ? true : COMMS.filter === "mine" ? c.assigned === "fiona" && c.status === "open" : c.status === COMMS.filter))
      .filter((c) => COMMS.chan === "all" || c.channel === COMMS.chan)
      .filter((c) => !q || [convName(c), c.contact, c.subject || "", c.msgs.at(-1).body].join(" ").toLowerCase().includes(q))
      .sort((a, b) => lastAt(b) - lastAt(a));
    const cur = CONVOS.find((c) => c.id === COMMS.open);
    const narrow = isNarrow();
    const listHTML = `<div class="ibx-list"><div class="ibx-tools"><input type="search" id="ibxQ" placeholder="Search messages" value="${esc(COMMS.q)}" aria-label="Search messages"><div class="fbar">${[["open", "Open"], ["mine", "Assigned to me"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => `<button type="button" class="pickchip" data-ibxf="${k}" aria-pressed="${COMMS.filter === k}">${l}</button>`).join("")}</div><div class="seg ibx-chan" role="group" aria-label="Channel">${[["all", "All"], ["whatsapp", "WhatsApp"], ["email", "Email"]].map(([k, l]) => `<button type="button" data-ibxch="${k}" aria-pressed="${COMMS.chan === k}">${l}</button>`).join("")}</div></div>
      ${list.length ? list.map((c) => { const last = c.msgs.at(-1); return `<button type="button" class="ibx-row ${cur?.id === c.id ? "on" : ""}" data-conv="${c.id}">${avatar({ name: convName(c) }, "sm")}<span class="ibx-main"><span class="ibx-top"><b><span class="srcdot ${isEmail(c) ? "em" : "wa"} sm" aria-label="${isEmail(c) ? "Email" : "WhatsApp"}">${isEmail(c) ? "@" : "W"}</span>${esc(convName(c))}</b><span class="muted">${ago(last.at)}</span></span>${isEmail(c) ? `<span class="ibx-subj">${esc(c.subject)}</span>` : ""}<span class="ibx-prev">${last.dir === "out" ? "You: " : ""}${esc(last.body)}</span><span class="ibx-tags">${c.ci === null ? '<span class="bdg">Not a client yet</span>' : CLIENTS[c.ci].source === "classpass" ? '<span class="bdg">ClassPass</span>' : ""}${c.assigned ? `<span class="bdg">${esc(PAYSTAFF[c.assigned]?.split(" ")[0] || "")}</span>` : ""}</span></span>${c.unread ? `<span class="ibx-unread" aria-label="${c.unread} unread">${c.unread}</span>` : ""}</button>`; }).join("") : '<p class="muted" style="padding:12px">Nothing here.</p>'}</div>`;
    const threadHTML = cur ? commsThread(cur) : `<div class="ibx-empty"><span class="muted">Choose a conversation.</span></div>`;
    if (narrow) return `<div class="ibx narrow">${cur ? threadHTML : listHTML}</div>`;
    return `<div class="ibx">${listHTML}${threadHTML}</div>`;
  }

  function commsThread(c) {
    const open = windowOpen(c);
    const until = lastIn(c) ? new Date(+lastIn(c) + 24 * HR) : null;
    const cl = c.ci !== null ? CLIENTS[c.ci] : null;
    const tick = (m) => (m.dir === "in" ? "" : `<span class="tick" aria-label="${m.status}">${m.status === "read" ? "✓✓" : m.status === "delivered" ? "✓✓" : m.status === "failed" ? "!" : "✓"}</span>`);
    const tag = (m) => (m.origin === "phone_app" ? "Sent from the phone app" : m.origin === "journey" ? "Journey" : m.by ? m.by : m.dir === "out" ? "You" : "");
    return `<div class="ibx-thread">
      <div class="ibx-head">${isNarrow() ? '<button type="button" class="iconbtn" id="ibxBack" aria-label="Back">‹</button>' : ""}${avatar({ name: convName(c) }, "sm")}<div style="min-width:0"><b>${esc(convName(c))}</b><div class="muted" style="font-size:12.5px">${isEmail(c) ? esc(c.contact) : `+${esc(c.contact)}`}${cl ? ` · ${cl.source === "classpass" ? "ClassPass client" : "Client"} · ${plural(cl.attended, "class", "classes")}` : " · not a client yet"}</div></div>
        <div class="inline2" style="margin-left:auto">${c.ci === null ? '<button type="button" class="btn" id="ibxLead">Add as a lead</button>' : ""}<select id="ibxAssign" aria-label="Assigned to"><option value="">Unassigned</option>${["fiona", "ana"].map((k) => `<option value="${k}" ${c.assigned === k ? "selected" : ""}>${esc(PAYSTAFF[k])}</option>`).join("")}</select><button type="button" class="btn ghost" id="ibxClose">${c.status === "open" ? "Close" : "Reopen"}</button></div></div>
      ${isEmail(c) ? `<div class="ibx-subjline"><span class="muted">Subject</span> <b>${esc(c.subject)}</b></div>` : ""}<div class="ibx-msgs ${isEmail(c) ? "ibx-mail" : ""}" id="ibxMsgs">${c.msgs.map((m) => `<div class="bub ${m.dir}"><div class="bubin">${m.template ? `<span class="bubtpl">Template · ${m.template.category === "marketing" ? "Marketing" : "Service"}${m.cost ? ` · ${usd(m.cost)}` : ""}</span>` : ""}${esc(m.body)}</div><span class="bubmeta">${tag(m) ? `${esc(tag(m))} · ` : ""}${ago(m.at)} ${tick(m)}</span></div>`).join("")}</div>
      <div class="ibx-compose">${isEmail(c)
        ? `<span class="hint">Replies go from ${esc(COMMS.email.address)} (${EMAIL_PROV[COMMS.email.provider]}), in the same email thread. They also show in your ${EMAIL_PROV[COMMS.email.provider]} Sent folder.</span><div class="row" style="gap:8px;align-items:flex-end"><textarea id="ibxText" rows="3" maxlength="10000" placeholder="Write a reply" aria-label="Reply">${esc(COMMS.draft)}</textarea><button type="button" class="btn primary" id="ibxSend">Send</button></div>`
        : open
        ? `<span class="hint">Free to reply until ${clock(until)}${until.getDate() !== NOW.getDate() ? ` ${fmtDay(until)}` : ""} (24 hours after their last message).</span><div class="row" style="gap:8px;align-items:flex-end"><textarea id="ibxText" rows="2" maxlength="4096" placeholder="Write a reply" aria-label="Reply">${esc(COMMS.draft)}</textarea><button type="button" class="btn primary" id="ibxSend">Send</button></div><button type="button" class="tagbtn" id="ibxTpl">Use a template instead</button>`
        : `${alertBox("info", "Reply window closed", "It's been more than 24 hours since their last message, so WhatsApp only allows one of your approved templates. Meta charges for these.")}<div class="row"><button type="button" class="btn primary" id="ibxTpl">Send a template…</button></div>`}</div>
    </div>`;
  }

  function openTemplatePicker(c) {
    const open = windowOpen(c);
    let pick = WA.templates[0], vars = [];
    const paint = () => {
      const blanks = waBlanks(pick.body);
      const cat = pick.category;
      const free = cat === "utility" && open;
      const cost = free ? 0 : COMMS.rate[cat] ?? 0;
      const preview = esc(pick.body).replace(/\{\{(\d+)\}\}/g, (_, n) => `<b class="wablank">${esc(vars[n - 1] || `{{${n}}}`)}</b>`);
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="tpForm" role="dialog" aria-modal="true" aria-labelledby="tpTitle" style="width:min(520px,100%)"><header><h2 id="tpTitle">Send a template to ${esc(convName(c))}</h2></header><div class="mb mform">
        <label class="fl">Template<select id="tpPick">${WA.templates.map((t) => `<option value="${t.name}" ${t.name === pick.name ? "selected" : ""}>${esc(t.label)} (${t.category === "marketing" ? "marketing" : "service"})</option>`).join("")}</select></label>
        ${[...Array(blanks).keys()].map((i) => `<label class="fl">Blank {{${i + 1}}}<input data-tpv="${i}" maxlength="200" value="${esc(vars[i] || (i === 0 && c.ci !== null ? firstName(cname(c.ci)) : ""))}"></label>`).join("")}
        <div class="fl">How it looks<div class="wabubble">${preview}</div></div>
        ${free ? alertBox("ok", "Free", "Service updates are free while the 24-hour reply window is open.")
          : alertBox("warn", "Meta charges for this message", COMMS.billing.mode === "credits" ? `It uses ${usd(cost)} of your message credits (${usd(COMMS.billing.balance)} left).` : "It's billed to your WhatsApp account at Meta's rates.")}
        ${cat === "marketing" && c.ci !== null && !open && c.ci % 3 === 2 ? alertBox("bad", "", `${esc(firstName(cname(c.ci)))} hasn't agreed to marketing messages on WhatsApp. Send a service update instead.`) : ""}
      </div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary" ${cat === "marketing" && c.ci !== null && !open && c.ci % 3 === 2 ? "disabled" : ""}>${free ? "Send" : `Send${COMMS.billing.mode === "credits" ? ` (${usd(cost)})` : ""}`}</button></footer></form></div>`;
      vars = [...Array(blanks).keys()].map((i) => $(`[data-tpv="${i}"]`).value);
      $("#tpPick").onchange = (e) => { pick = WA.templates.find((t) => t.name === e.target.value); vars = []; paint(); };
      document.querySelectorAll("[data-tpv]").forEach((el) => (el.onchange = () => { vars[Number(el.dataset.tpv)] = el.value; paint(); }));
      $("#tpForm").onsubmit = (e) => {
        e.preventDefault();
        if (vars.some((v) => !v.trim())) return toast("Fill in every blank.");
        if (cost > COMMS.billing.balance && COMMS.billing.mode === "credits") return toast(`Not enough message credits: this costs ${usd(cost)} and you have ${usd(COMMS.billing.balance)}. Buy more under Settings.`);
        const body = pick.body.replace(/\{\{(\d+)\}\}/g, (_, n) => vars[n - 1]);
        c.msgs.push(msg("out", "platform", body, 0, { template: { name: pick.name, category: cat }, cost: COMMS.billing.mode === "credits" ? cost : 0, status: "sent", by: "You" }));
        if (COMMS.billing.mode === "credits" && cost) { COMMS.billing.balance = Math.round((COMMS.billing.balance - cost) * 100) / 100; COMMS.billing.ledger.push({ when: "Today", text: `WhatsApp ${cat === "marketing" ? "marketing" : "service"} message`, change: -cost }); }
        closeModal(); render(); toast(free ? "Sent." : COMMS.billing.mode === "credits" ? `Sent. ${usd(cost)} of credits used.` : "Sent. Meta bills your WhatsApp account for it.");
      };
    };
    paint();
  }

  function whatsappTemplatesCard() {
    return `<div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3>WhatsApp message templates</h3><button type="button" class="btn" id="waSync">Sync from WhatsApp</button></div>
      <span class="hint">WhatsApp only lets businesses start a conversation (or write after 24 hours) with a message it has approved. Write and submit templates in WhatsApp Manager (approval usually takes minutes to a day), then sync them here. Use them in the inbox and in journeys.</span>
      <div class="lrgrid" style="margin-top:10px">${WA.templates.map((t) => `<div class="watpl"><div class="row" style="justify-content:space-between;gap:8px"><b>${esc(t.label)}</b><span class="status ${t.category === "marketing" ? "wait" : "off"}">${t.category === "marketing" ? "Marketing" : "Service"}</span></div><div class="wabubble">${esc(t.body).replace(/\{\{(\d+)\}\}/g, '<b class="wablank">{{$1}}</b>')}</div><span class="muted" style="font-size:12px">${COMMS.billing.mode === "credits" ? `${usd(COMMS.rate[t.category])} per message${t.category === "utility" ? ", free inside the 24-hour window" : ""}` : t.category === "utility" ? "Free inside the 24-hour window" : "Charged by Meta every time"}</span></div>`).join("")}</div></div>`;
  }

  function commsSettings(setup) {
    const b = COMMS.billing;
    const pay = `<div class="card mform"><div class="row" style="justify-content:space-between"><h3>1. How Meta gets paid</h3><span class="status ${commsReady() ? "live" : "open"}">${commsReady() ? (b.mode === "credits" ? "Message credits" : "Paying Meta directly") : "Needed first"}</span></div>
        ${alertBox("warn", "WhatsApp messages cost money", "Meta charges for WhatsApp messages: marketing messages every time, service updates outside the 24-hour reply window. Replies within 24 hours of a client's message are free. The studio pays for these, so choose how before using WhatsApp here.")}
        <label class="opt"><input type="radio" name="cbMode" value="meta_direct" ${b.mode === "meta_direct" ? "checked" : ""}><div><b>Pay Meta directly</b><br><span class="h">Add a card in WhatsApp Manager (Settings → Payment methods). Meta bills you each month. Nothing is charged here.</span></div></label>
        <label class="opt"><input type="radio" name="cbMode" value="credits" ${b.mode === "credits" ? "checked" : ""}><div><b>Buy message credits</b><br><span class="h">Top up here and we pay Meta for you. One bill, no card needed at Meta. Each charged message uses credits (e.g. ${usd(COMMS.rate.marketing)} for a marketing message in Singapore).</span></div></label>
        ${b.mode === "meta_direct" ? `<label class="check"><input type="checkbox" id="cbConfirm" ${b.confirmed ? "checked" : ""}> I've added a payment method for our WhatsApp account in Meta</label>` : ""}
        ${b.mode === "credits" ? `<div class="credbox"><div><span class="muted" style="font-size:12.5px">Message credits</span><br><b class="credbal">${usd(b.balance)}</b></div><div class="fbar">${[2000, 5000, 10000, 25000].map((a) => `<button type="button" class="btn" data-buy="${a}">+ ${usd(a)}</button>`).join("")}</div></div>
          <details class="howto"><summary>Credit history</summary><ul class="bklist" style="margin-top:6px">${[...b.ledger].reverse().map((l) => `<li><span class="muted">${esc(l.when)}</span> · ${esc(l.text)} <b style="float:right">${l.change > 0 ? "+" : ""}${usd(l.change)}</b></li>`).join("")}</ul></details>` : ""}
        <div class="row"><button type="button" class="btn primary" id="cbSave">Save</button></div></div>`;
    const conn = `<div class="card mform"><div class="row" style="justify-content:space-between"><h3>2. Your WhatsApp number</h3><span class="status ${COMMS.wa.connected ? "live" : "draft"}">${COMMS.wa.connected ? "Connected" : "Not connected"}</span></div>
        ${COMMS.wa.connected ? `${alertBox("ok", "", `${esc(COMMS.wa.phone)} is connected${COMMS.wa.coexistence ? ", and still works in the WhatsApp Business app on your phone. Replies sent from the phone show up here too." : "."}`)}<div class="row"><button type="button" class="btn ghost danger" id="waDisc">Disconnect</button></div>`
          : `<span class="hint">Keep using the WhatsApp Business app on your phone: connecting adds this inbox alongside it (WhatsApp calls this “coexistence”). Meta's window opens: you log in with Facebook, choose your business, then scan a code in the WhatsApp Business app. Chats from the last 6 months can be brought across.</span>
            <div class="row"><button type="button" class="btn primary" id="waConnect" ${commsReady() ? "" : "disabled"}>Connect WhatsApp</button>${commsReady() ? "" : '<span class="hint">Choose how Meta gets paid first.</span>'}</div>`}</div>`;
    const em = COMMS.email;
    const mail = `<div class="card mform"><div class="row" style="justify-content:space-between"><h3>3. Your email inbox</h3><span class="status ${em.connected ? "live" : "draft"}">${em.connected ? "Connected" : "Not connected"}</span></div>
        ${em.connected
          ? `${alertBox("ok", "", `${esc(em.address)} (${EMAIL_PROV[em.provider]}) is connected. New emails arrive here every couple of minutes; last checked ${em.syncedMin} min ago.`)}<span class="hint">Replies you send here go from that address and appear in its Sent folder. Emails from no-reply addresses and newsletters are left out.</span><div class="inline2"><button type="button" class="btn" id="emSync">Check for new emails</button><button type="button" class="btn ghost danger" id="emDisc">Disconnect</button></div>`
          : `<span class="hint">Bring your studio's email into this inbox, next to WhatsApp. You sign in with Google or Microsoft in their own window; we never see your password, and you can disconnect at any time.</span>
            <div class="inline2"><button type="button" class="btn primary" data-emconnect="gmail">Connect Gmail</button><button type="button" class="btn primary" data-emconnect="outlook">Connect Outlook</button></div>
            <span class="hint">Works with Gmail and Google Workspace, and Outlook, Hotmail and Microsoft 365. Other email providers aren't supported yet. Only an owner or admin can connect it.</span>`}</div>`;
    return `${setup ? alertBox("info", "Set up WhatsApp", "Two steps: choose how Meta's charges are paid, then connect your number. The inbox opens straight after.") : ""}<div class="adsgrid">${pay}${conn}${mail}</div>`;
  }

  BIND.comms = () => {
    document.querySelectorAll("[data-ctab]").forEach((b) => (b.onclick = () => { COMMS.tab = b.dataset.ctab; render(); }));
    document.querySelectorAll("[data-ibxf]").forEach((b) => (b.onclick = () => { COMMS.filter = b.dataset.ibxf; render(); }));
    document.querySelectorAll("[data-ibxch]").forEach((b) => (b.onclick = () => { COMMS.chan = b.dataset.ibxch; render(); }));
    document.querySelectorAll("[data-emconnect]").forEach((b) => (b.onclick = () => {
      const pv = b.dataset.emconnect, name = EMAIL_PROV[pv];
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-labelledby="emT" style="width:min(460px,100%)"><header><h2 id="emT">${pv === "gmail" ? "Google" : "Microsoft"} sign-in</h2></header><div class="mb"><ol class="rhl"><li>Choose the studio's email account (for example hello@yourstudio.com) and sign in.</li><li>${name} asks you to let the studio app read, send and organise email. Press <b>Allow</b>.</li><li>You come back here, and emails start arriving in the inbox within a couple of minutes.</li></ol><span class="hint">This is what ${pv === "gmail" ? "Google" : "Microsoft"} shows; in the real app it opens in their window.</span></div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="button" class="btn primary" id="emDone">Allow (sample)</button></footer></div></div>`;
      $("#emDone").onclick = () => { Object.assign(COMMS.email, { connected: true, provider: pv, address: pv === "gmail" ? "hello@demostudio.sg" : "hello@demostudio.com.sg", syncedMin: 0 }); closeModal(); render(); toast(`${name} connected. Emails will arrive in the inbox.`); };
    }));
    if ($("#emSync")) $("#emSync").onclick = () => { COMMS.email.syncedMin = 0; render(); toast("Checked: no new emails."); };
    if ($("#emDisc")) $("#emDisc").onclick = () => confirmFlags([{ level: "confirm", title: "Disconnect email?", msg: `New emails to ${COMMS.email.address} stop arriving here, and you can't reply from here. Nothing is deleted from your mailbox, and conversations here are kept.` }], { proceedLabel: "Disconnect", proceed: () => { COMMS.email.connected = false; COMMS.chan = "all"; render(); toast("Email disconnected."); } });
    if ($("#ibxQ")) $("#ibxQ").onchange = (e) => { COMMS.q = e.target.value; render(); };
    document.querySelectorAll("[data-conv]").forEach((b) => (b.onclick = () => { COMMS.open = b.dataset.conv; const c = CONVOS.find((x) => x.id === COMMS.open); c.unread = 0; COMMS.draft = ""; render(); renderNav(); const m = $("#ibxMsgs"); if (m) m.scrollTop = m.scrollHeight; }));
    const c = CONVOS.find((x) => x.id === COMMS.open);
    if ($("#ibxMsgs")) $("#ibxMsgs").scrollTop = $("#ibxMsgs").scrollHeight;
    if ($("#ibxBack")) $("#ibxBack").onclick = () => { COMMS.open = null; render(); };
    if ($("#ibxText")) $("#ibxText").oninput = (e) => (COMMS.draft = e.target.value);
    if ($("#ibxSend")) $("#ibxSend").onclick = () => {
      const text = $("#ibxText").value.trim();
      if (!text) return toast("Write a message.");
      if (isEmail(c) && !COMMS.email.connected) return toast("Connect your email under Settings to reply.");
      c.msgs.push(msg("out", "platform", text, 0, { status: "sent", by: "You" })); COMMS.draft = ""; render(); toast(isEmail(c) ? `Sent from ${COMMS.email.address}.` : "Sent. Replies within 24 hours are free.");
    };
    if ($("#ibxTpl")) $("#ibxTpl").onclick = () => openTemplatePicker(c);
    if ($("#ibxClose")) $("#ibxClose").onclick = () => { c.status = c.status === "open" ? "closed" : "open"; render(); toast(c.status === "closed" ? "Closed. It reopens if they write again." : "Reopened."); };
    if ($("#ibxAssign")) $("#ibxAssign").onchange = (e) => { c.assigned = e.target.value || null; render(); toast(c.assigned ? `Assigned to ${PAYSTAFF[c.assigned]}.` : "Unassigned."); };
    if ($("#ibxLead")) $("#ibxLead").onclick = () => { LEADS.unshift({ id: `l${nextLeadId++}`, first: c.name || "WhatsApp", last: "", email: "", phone: `+${c.contact}`, source: "manual", campaign: "", days: 0, status: "new", note: "Asked on WhatsApp" }); toast("Added to Leads."); renderNav(); };
    // Settings
    document.querySelectorAll("input[name=cbMode]").forEach((r) => (r.onchange = () => { COMMS.billing.mode = r.value; if (r.value === "meta_direct") COMMS.billing.confirmed = false; render(); }));
    if ($("#cbSave")) $("#cbSave").onclick = () => {
      if (COMMS.billing.mode === "meta_direct" && !$("#cbConfirm").checked) return toast("Add a payment method in WhatsApp Manager first, then tick the box.");
      if (COMMS.billing.mode === "meta_direct") COMMS.billing.confirmed = true;
      render(); toast(COMMS.billing.mode === "credits" ? "Saved. Messages that cost money use your credits." : "Saved. Meta bills your WhatsApp account directly.");
    };
    document.querySelectorAll("[data-buy]").forEach((b) => (b.onclick = () => {
      const a = Number(b.dataset.buy);
      confirmFlags([{ level: "confirm", title: `Buy ${usd(a)} of message credits?`, msg: "You'll pay by card. The credits are added as soon as the payment goes through, and they don't expire." }], { proceedLabel: `Pay ${usd(a)}`, proceed: () => { COMMS.billing.balance += a; COMMS.billing.ledger.push({ when: "Today", text: `Bought ${usd(a)} of message credits`, change: a }); render(); toast(`${usd(a)} of credits added.`); } });
    }));
    if ($("#waConnect")) $("#waConnect").onclick = () => {
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-labelledby="wcT" style="width:min(460px,100%)"><header><h2 id="wcT">Meta's sign-up window</h2></header><div class="mb"><ol class="rhl"><li>Log in with Facebook and choose your business.</li><li>Choose <b>Connect your existing WhatsApp Business app</b>.</li><li>Enter your number, then scan the code shown here with the WhatsApp Business app on your phone.</li><li>Choose whether to bring across chats from the last 6 months.</li></ol><span class="hint">This is what Meta shows; in the real app it opens in a pop-up.</span></div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="button" class="btn primary" id="wcDone">Finish (sample)</button></footer></div></div>`;
      $("#wcDone").onclick = () => { COMMS.wa.connected = true; closeModal(); COMMS.tab = "inbox"; render(); toast("WhatsApp connected. Your phone app keeps working as before."); };
    };
    if ($("#waDisc")) $("#waDisc").onclick = () => confirmFlags([{ level: "confirm", title: "Disconnect WhatsApp?", msg: "Messages stop arriving here. Your WhatsApp Business app on the phone keeps working, and your conversation history here is kept." }], { proceedLabel: "Disconnect", proceed: () => { COMMS.wa.connected = false; render(); toast("Disconnected."); } });
    if ($("#waSync")) $("#waSync").onclick = () => toast(`Synced: ${plural(WA.templates.length, "approved template")}.`);
  };
