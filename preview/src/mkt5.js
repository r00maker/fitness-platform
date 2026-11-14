  // ===========================================================================
  // Ads & leads: lead forms from Meta and Google, follow-up, results sent back, and the funnel.
  // Same rules and wording as the API (apps/api/src/modules/marketing/ads.ts).
  // ===========================================================================
  const ADS = {
    meta: { pageId: "104882736512", pageName: "Demo Studio", pageConnected: true, pixelId: "8812004417", conversionsConnected: true, send: true, lastError: null, sentThisWeek: 23 },
    google: { key: "f3a91c07d2b84e6a", feedKey: "9b2e71d0c4a8f5e3b6d1a7c2", feedOn: true, signupName: "Studio sign-up", purchaseName: "First purchase", leadsOn: true },
    phoneCc: "65",
    follow: { on: true, first: "e_lead1", reminder: "e_lead2", days: 3, team: true },
  };
  const API_BASE = "https://api.demostudio.app";
  const metaHook = `${API_BASE}/v1/public/ads/meta/webhook`;
  const googleHook = `${API_BASE}/v1/public/ads/google/7c1e…/leads`;
  const googleFeed = () => `${API_BASE}/v1/public/ads/google/7c1e…/conversions.csv?key=${ADS.google.feedKey}`;
  const SRC = { meta: "Meta (Facebook, Instagram)", google: "Google", manual: "Added by the studio" };
  const SRC_SHORT = { meta: "Meta", google: "Google", manual: "Added by you" };
  const LSTAT = { new: ["New", "open"], contacted: ["Contacted", "wait"], joined: ["Joined", "live"], bought: ["Bought", "done"], lost: ["Not interested", "off"] };

  EMAILS.push(
    { id: "e_lead1", name: "Lead welcome: your free trial", category: "Leads", purpose: "marketing", updated: "Today", design: { subject: "Your first class at {{studio_name}}, {{first_name}}", preheader: "Thanks for asking about classes. Here's how to start.", theme: { ...THEME0 }, blocks: [
      { type: "heading", text: "Hi {{first_name}}, thanks for asking!", level: 1, align: "left" },
      { type: "text", text: "Your **first class is on us**. Make your account, pick a time that suits you, and we'll take it from there.", align: "left" },
      { type: "button", label: "Book your free trial", url: "{{join_link}}", align: "left", style: "filled" },
      { type: "text", text: "Questions? Just reply to this email or WhatsApp us.", align: "left" } ] } },
    { id: "e_lead2", name: "Lead reminder: still keen?", category: "Leads", purpose: "marketing", updated: "Today", design: { subject: "Your free class is still waiting, {{first_name}}", preheader: "", theme: { ...THEME0 }, blocks: [
      { type: "text", text: "Hi {{first_name}}, just checking in. Your free trial class is still here whenever you're ready.", align: "left" },
      { type: "button", label: "Claim my free class", url: "{{join_link}}", align: "left", style: "filled" } ] } },
  );

  // Sample leads (days = days ago).
  const LEADS = [
    { id: "l1", first: "Mei Ling", last: "Tan", email: "meiling.tan@example.com", phone: "+65 9123 4567", source: "meta", campaign: "November free trial", ad: "Reformer video", days: 0, status: "new" },
    { id: "l2", first: "Arjun", last: "Nair", email: "arjun.n@example.com", phone: "+65 8123 4567", source: "google", campaign: "Pilates near me", days: 0, status: "new", gclid: true },
    { id: "l3", first: "Sofia", last: "Reyes", email: "sofia.r@example.com", phone: "", source: "meta", campaign: "November free trial", ad: "Carousel: studio tour", days: 1, status: "contacted", note: "Called, coming Saturday 9am" },
    { id: "l4", first: "Hannah", last: "Lim", email: "hannah.lim@example.com", phone: "+65 9765 1122", source: "meta", campaign: "Bring a friend", ad: "Friends reel", days: 2, status: "joined" },
    { id: "l5", first: "Wei Jie", last: "Goh", email: "", phone: "+65 9001 2345", source: "google", campaign: "Pilates near me", days: 3, status: "new", gclid: true },
    { id: "l6", first: "Priya", last: "Kumar", email: "priya.k@example.com", phone: "+65 8222 4141", source: "meta", campaign: "November free trial", ad: "Reformer video", days: 4, status: "bought", cents: 5900 },
    { id: "l7", first: "Daniel", last: "Ong", email: "dan.ong@example.com", phone: "", source: "manual", campaign: "", days: 5, status: "bought", cents: 28000, note: "Walked in after the open day" },
    { id: "l8", first: "Nur", last: "Aisyah", email: "nur.aisyah@example.com", phone: "+65 9333 7788", source: "meta", campaign: "Bring a friend", ad: "Friends reel", days: 6, status: "lost", note: "Moving overseas" },
    { id: "l9", first: "Kenji", last: "Sato", email: "kenji.s@example.com", phone: "", source: "google", campaign: "Reformer classes", days: 8, status: "bought", cents: 5900, gclid: true },
    { id: "l10", first: "Grace", last: "Chua", email: "grace.chua@example.com", phone: "+65 9555 0101", source: "meta", campaign: "November free trial", ad: "Carousel: studio tour", days: 9, status: "joined" },
    { id: "l11", first: "Ravi", last: "Menon", email: "ravi.m@example.com", phone: "", source: "meta", campaign: "November free trial", ad: "Reformer video", days: 12, status: "contacted" },
    { id: "l12", first: "Emily", last: "Wong", email: "emily.w@example.com", phone: "+65 9888 2020", source: "google", campaign: "Pilates near me", days: 15, status: "bought", cents: 22000, gclid: true },
    { id: "l13", first: "Farah", last: "Hassan", email: "farah.h@example.com", phone: "", source: "meta", campaign: "Bring a friend", ad: "Friends reel", days: 21, status: "bought", cents: 5900 },
    { id: "l14", first: "Lucas", last: "Teo", email: "lucas.t@example.com", phone: "", source: "meta", campaign: "October open day", ad: "Open day poster", days: 40, status: "bought", cents: 28000 },
    { id: "l15", first: "Alicia", last: "Pereira", email: "alicia.p@example.com", phone: "", source: "google", campaign: "Reformer classes", days: 55, status: "lost" },
  ];
  // People who joined straight from an ad click, without filling in a form.
  const AD_DIRECT = [{ source: "meta", days: 3, cents: 5900 }, { source: "meta", days: 10, cents: 0 }, { source: "google", days: 6, cents: 28000 }, { source: "google", days: 18, cents: 0 }, { source: "google", days: 70, cents: 5900 }];
  let nextLeadId = 16;
  const leadName = (l) => [l.first, l.last].filter(Boolean).join(" ") || l.email || l.phone;
  const agoText = (d) => (d === 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`);
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");

  function funnelData(days) {
    const ls = LEADS.filter((l) => l.days < days);
    const d = AD_DIRECT.filter((x) => x.days < days);
    const row = (src) => {
      const m = ls.filter((l) => l.source === src), dx = d.filter((x) => x.source === src);
      const joinedL = m.filter((l) => l.status === "joined" || l.status === "bought").length;
      const boughtL = m.filter((l) => l.status === "bought");
      const joined = joinedL + dx.length, bought = boughtL.length + dx.filter((x) => x.cents).length;
      const rev = boughtL.reduce((a, l) => a + l.cents, 0) + dx.reduce((a, x) => a + x.cents, 0);
      return { src, leads: m.length, direct: dx.length, joinedL, joined, bought, rev };
    };
    const rows = ["meta", "google", "classpass", "manual"].map(row);
    const tot = rows.reduce((a, r) => ({ leads: a.leads + r.leads, joined: a.joined + r.joined, bought: a.bought + r.bought, rev: a.rev + r.rev, direct: a.direct + r.direct }), { leads: 0, joined: 0, bought: 0, rev: 0, direct: 0 });
    const camps = [...new Set(ls.map((l) => l.campaign).filter(Boolean))].map((c) => {
      const m = ls.filter((l) => l.campaign === c);
      return { name: c, src: m[0].source, leads: m.length, joined: m.filter((l) => l.status === "joined" || l.status === "bought").length, bought: m.filter((l) => l.status === "bought").length, rev: m.reduce((a, l) => a + (l.cents || 0), 0) };
    }).sort((a, b) => b.rev - a.rev || b.leads - a.leads);
    return { rows, tot, camps };
  }

  function adsAdmin() {
    const v = ["funnel", "connect", "follow"].includes(state.adsView) ? state.adsView : "funnel";
    const views = [["funnel", "Results"], ["connect", "Connect ads"], ["follow", "Follow-up"]];
    const nav = `<div class="seg adsnav" role="group" aria-label="Ads & leads">${views.map(([k, l]) => `<button type="button" data-adsv="${k}" aria-pressed="${v === k}">${l}</button>`).join("")}</div>`;
    const newLeads = LEADS.filter((l) => l.status === "new").length;
    return nav + `<div class="card row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><span style="font-size:13.5px">Enquiries from your ads, plus ClassPass clients and walk-ins, are under <b>Leads</b> in the menu.${newLeads ? ` <span class="status open">${newLeads} new</span>` : ""}</span><button type="button" class="btn" data-goleads>Open Leads</button></div>` + ({ funnel: adsFunnel, connect: adsConnect, follow: adsFollow }[v])();
  }

  function adsFunnel() {
    const days = state.adsDays || 30;
    const { rows, tot, camps } = funnelData(days);
    const stage = (label, n, of, help, cls) => `<div class="fnl ${cls}"><div class="fnlhead"><span>${label}</span><b>${n}</b></div><div class="fnlbar"><span style="width:${of ? Math.max(4, Math.round((n / of) * 100)) : 0}%"></span></div><span class="h">${help}</span></div>`;
    const top = Math.max(tot.leads + tot.direct, 1);
    return `<div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3>From ad to paying client</h3>
        <div class="seg" role="group" aria-label="Period">${[[30, "Last 30 days"], [90, "Last 90 days"], [365, "Last year"]].map(([d, l]) => `<button type="button" data-adsdays="${d}" aria-pressed="${days === d}">${l}</button>`).join("")}</div></div>
        <div class="fnlgrid">
          ${stage("Came in", tot.leads + tot.direct, top, `${plural(tot.leads, "lead")} from forms, ${tot.direct} straight from an ad`, "s1")}
          ${stage("Joined", tot.joined, top, `${pct(tot.joined, tot.leads + tot.direct)} made an account`, "s2")}
          ${stage("Bought", tot.bought, top, `${pct(tot.bought, tot.joined)} of those who joined paid`, "s3")}
          <div class="fnl rev"><div class="fnlhead"><span>First purchases</span><b>${m$c(tot.rev)}</b></div><span class="h">What new clients from ads paid the first time. Compare it with what you spent on the ads.</span></div>
        </div></div>
      <div class="card"><h3>By platform</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Platform</th><th class="num" data-help="People who filled in a lead form.">Leads</th><th class="num" data-help="Joined straight from an ad click, without a form.">From ad clicks</th><th class="num">Joined</th><th class="num">Bought</th><th class="num" data-help="Of everyone who joined, how many paid.">Join → buy</th><th class="num">First purchases</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td><span class="cellp">${srcDot(r.src)}<b>${esc(SRC[r.src])}</b></span></td><td class="num">${r.leads}</td><td class="num">${r.src === "manual" || r.src === "classpass" ? "–" : r.direct}</td><td class="num">${r.joined}</td><td class="num">${r.bought}</td><td class="num">${pct(r.bought, r.joined)}</td><td class="num"><b>${m$c(r.rev)}</b></td></tr>`).join("")}</tbody></table></div></div>
      <div class="card"><h3>By campaign</h3><span class="hint">Lead form campaigns, best first. Campaign names come from Meta and Google.</span>
        ${camps.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Campaign</th><th>Platform</th><th class="num">Leads</th><th class="num">Joined</th><th class="num">Bought</th><th class="num">First purchases</th></tr></thead><tbody>${camps.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${SRC_SHORT[c.src]}</td><td class="num">${c.leads}</td><td class="num">${c.joined}</td><td class="num">${c.bought}</td><td class="num">${m$c(c.rev)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No lead form campaigns in this period.</p>`}</div>
      ${alertBox("info", "Sent back to your ads", `Each sign-up and first purchase from an ad is sent back to ${ADS.meta.send ? "Meta" : ""}${ADS.meta.send && ADS.google.feedOn ? " and " : ""}${ADS.google.feedOn ? "Google" : ""}${!ADS.meta.send && !ADS.google.feedOn ? "nobody yet (see Connect ads)" : ""}, so they can find more people who actually pay, not just people who click.`)}`;
  }
  const srcDot = (s) => `<span class="srcdot ${s}" aria-hidden="true">${{ meta: "M", google: "G", classpass: "C", manual: "+" }[s]}</span>`;

  function adsLeads() {
    const f = state.leadF || "open", q = (state.leadQ || "").toLowerCase(), sf = state.leadS || "";
    const counts = { open: LEADS.filter((l) => l.status === "new" || l.status === "contacted").length, joined: LEADS.filter((l) => l.status === "joined").length, bought: LEADS.filter((l) => l.status === "bought").length, lost: LEADS.filter((l) => l.status === "lost").length, all: LEADS.length };
    const shown = LEADS.filter((l) => (f === "all" ? true : f === "open" ? l.status === "new" || l.status === "contacted" : l.status === f))
      .filter((l) => !sf || l.source === sf)
      .filter((l) => !q || [leadName(l), l.email, l.phone, l.campaign].join(" ").toLowerCase().includes(q));
    const chips = [["open", "To follow up"], ["joined", "Joined"], ["bought", "Bought"], ["lost", "Not interested"], ["all", "All"]];
    return `<div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="fbar">${chips.map(([k, l]) => `<button type="button" class="pickchip" data-leadf="${k}" aria-pressed="${f === k}">${l} <span class="muted">${counts[k]}</span></button>`).join("")}</div>
        <div class="inline2"><select id="leadS" aria-label="Platform"><option value="">All platforms</option>${Object.entries(SRC_SHORT).map(([k, l]) => `<option value="${k}" ${sf === k ? "selected" : ""}>${l}</option>`).join("")}</select><input type="search" id="leadQ" placeholder="Search name, email, campaign" value="${esc(state.leadQ || "")}" style="width:220px"></div></div>
        <span class="hint">New enquiries from your lead ads land here by themselves. ${ADS.follow.on ? `Each one has been sent “${esc(emailById(ADS.follow.first)?.name || "your welcome email")}” with their own sign-up link.` : "Follow-up emails are off (see Follow-up)."} When someone joins or buys, their lead updates by itself.</span>
        ${shown.length ? `<div class="tblwrap"><table class="tbl leadtbl"><thead><tr><th>Name</th><th>Contact</th><th>Came from</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>${shown.map(leadRow).join("")}</tbody></table></div>` : `<p class="muted" style="margin:6px 0 0">${f === "open" ? "Nobody waiting. Nice work." : "No leads here."}</p>`}</div>`;
  }
  const leadRow = (l) => {
    const [label, cls] = LSTAT[l.status];
    const open = l.status === "new" || l.status === "contacted";
    return `<tr><td><span class="cellp">${avatar({ name: leadName(l) }, "sm")}<span><b>${esc(leadName(l))}</b>${l.note ? `<br><span class="muted" style="font-size:12.5px">${esc(l.note)}</span>` : ""}</span></span></td>
      <td style="font-size:13px">${l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ""}${l.email && l.phone ? "<br>" : ""}${l.phone ? `<a href="https://wa.me/${l.phone.replace(/\D/g, "")}" target="_blank" rel="noopener" data-help="Opens WhatsApp">${esc(l.phone)}</a>` : ""}</td>
      <td><span class="cellp" style="gap:6px">${srcDot(l.source)}<span>${SRC_SHORT[l.source]}${l.campaign ? `<br><span class="muted" style="font-size:12.5px">${esc(l.campaign)}${l.ad ? ` · ${esc(l.ad)}` : ""}</span>` : ""}</span></span></td>
      <td class="muted" style="white-space:nowrap">${agoText(l.days)}</td>
      <td><span class="status ${cls}">${label}</span>${l.status === "bought" ? `<br><span class="muted" style="font-size:12px">${m$c(l.cents)}</span>` : ""}</td>
      <td><div class="inline2 leadacts">${open ? `${l.status === "new" ? `<button type="button" class="btn" data-leadc="${l.id}" data-help="You've called, messaged or emailed them.">Contacted</button>` : ""}<button type="button" class="btn ghost" data-leadn="${l.id}">Note</button><button type="button" class="btn ghost" data-leadl="${l.id}" data-help="Stops follow-up emails.">Not interested</button>` : l.status === "lost" ? `<button type="button" class="btn ghost" data-leadr="${l.id}">Reopen</button>` : `<span class="muted" style="font-size:12.5px">Follows what they do</span>`}<button type="button" class="btn ghost danger" data-leadd="${l.id}" data-help="Erase their details, e.g. if they ask you to.">Delete</button></div></td></tr>`;
  };

  const copyField = (id, value, label, btn = "Copy") => `<div class="copyrow"><input id="${id}" value="${esc(value)}" readonly aria-label="${esc(label)}"><button type="button" class="btn" data-copyf="${id}">${btn}</button></div>`;
  const secretField = (id, on, label) => `<label class="fl"><span class="flh">${label}${on ? `<span class="status done">Saved</span>` : ""}</span><div class="copyrow"><input type="password" id="${id}" autocomplete="off" placeholder="${on ? "•••••••••••• (paste a new one to replace it)" : "Paste it here"}" style="background:var(--surface)">${on ? `<button type="button" class="btn ghost danger" data-adsclear="${id}">Remove</button>` : ""}</div></label>`;

  function adsConnect() {
    const m = ADS.meta, g = ADS.google;
    const stepsMeta = [
      "In Meta Business Suite, open <b>Settings → Business assets → Pages</b> and copy your Page ID.",
      "In <b>Events Manager</b>, pick your dataset (pixel), open <b>Settings</b>, copy the dataset ID and under <b>Conversions API</b> choose <b>Generate access token</b>.",
      "For lead forms: create a Page access token with <b>leads_retrieval</b> (your developer or agency can help), and paste it below. Leads then arrive here within seconds.",
      "Save, then press <b>Send a test</b> and check <b>Test events</b> in Events Manager.",
    ];
    const stepsGoogle = [
      "In Google Ads, open your lead form asset, choose <b>Lead delivery → Webhook integration</b>, and paste the webhook address and key below. Press <b>Send test data</b>: a test lead appears here (it's never emailed).",
      `For results: in <b>Goals → Conversions → Summary</b>, create two <b>Import</b> conversions from <b>clicks</b>, named exactly “${esc(g.signupName)}” and “${esc(g.purchaseName)}”.`,
      "Then <b>Goals → Conversions → Uploads → Schedules</b>: add a schedule with source <b>HTTPS</b>, paste the conversions address, and set it to daily.",
    ];
    return `<div class="adsgrid">
      <div class="card mform"><div class="row" style="justify-content:space-between"><h3><span class="cellp" style="gap:8px">${srcDot("meta")}Meta (Facebook, Instagram)</span></h3><span class="status ${m.pageConnected && m.conversionsConnected ? "live" : m.pageConnected || m.conversionsConnected ? "open" : "draft"}">${m.pageConnected && m.conversionsConnected ? "Connected" : m.pageConnected || m.conversionsConnected ? "Partly set up" : "Not connected"}</span></div>
        ${m.lastError ? alertBox("warn", "Meta reported a problem", esc(m.lastError) + ". Check the token is still valid, then save it again.") : m.send ? alertBox("ok", "", `${m.sentThisWeek} sign-ups and purchases sent to Meta this week.`) : ""}
        <details class="howto"><summary>How to set it up (about 10 minutes)</summary><ol>${stepsMeta.map((s) => `<li>${s}</li>`).join("")}</ol></details>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Page ID<input id="amPage" inputmode="numeric" value="${esc(m.pageId)}" placeholder="e.g. 104882736512"></label><label class="fl">Dataset (pixel) ID<input id="amPixel" inputmode="numeric" value="${esc(m.pixelId)}" placeholder="e.g. 8812004417"></label></div>
        ${secretField("amPageTok", m.pageConnected, "Page access token <span class=\"h\">(for lead forms)</span>")}
        ${secretField("amCapiTok", m.conversionsConnected, "Conversions API token <span class=\"h\">(for sending results)</span>")}
        <span class="hint">Tokens are stored encrypted and never shown again, only “Saved”.</span>
        <div><label class="check"><input type="checkbox" id="amSend" ${m.send ? "checked" : ""}> Send sign-ups and first purchases to Meta</label><span class="hint" style="display:block;margin:2px 0 0 26px">Email and phone are scrambled (hashed) before they leave, as Meta requires.</span></div>
        <div class="fl">Address for your Meta app's lead webhook <span class="h">(only needed once, by whoever runs the app)</span>${copyField("amHook", metaHook, "Meta webhook address")}</div>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" id="amSave">Save</button><input id="amTest" placeholder="Test code, e.g. TEST4821" style="width:190px" aria-label="Test event code"><button type="button" class="btn" id="amTestBtn">Send a test</button></div></div>

      <div class="card mform"><div class="row" style="justify-content:space-between"><h3><span class="cellp" style="gap:8px">${srcDot("google")}Google Ads</span></h3><span class="status ${g.leadsOn && g.feedOn ? "live" : g.leadsOn || g.feedOn ? "open" : "draft"}">${g.leadsOn && g.feedOn ? "Connected" : g.leadsOn || g.feedOn ? "Partly set up" : "Not connected"}</span></div>
        <details class="howto"><summary>How to set it up (about 10 minutes)</summary><ol>${stepsGoogle.map((s) => `<li>${s}</li>`).join("")}</ol></details>
        <h4 class="sub">Lead forms</h4>
        <div class="fl">Webhook address${copyField("agHook", googleHook, "Google webhook address")}</div>
        <div class="fl">Key${copyField("agKey", g.key, "Google webhook key")}</div>
        <h4 class="sub">Results back to Google</h4>
        <label class="check"><input type="checkbox" id="agFeed" ${g.feedOn ? "checked" : ""}> Share sign-ups and first purchases from Google ad clicks</label>
        ${g.feedOn ? `<div class="fl">Conversions address <span class="h">(private: Google reads it on your schedule)</span>${copyField("agFeedUrl", googleFeed(), "Google conversions address")}</div>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Sign-up conversion name<input id="agSignup" maxlength="100" value="${esc(g.signupName)}"></label><label class="fl">Purchase conversion name<input id="agPurchase" maxlength="100" value="${esc(g.purchaseName)}"></label></div><span class="hint">These must match the names in Google Ads exactly.</span>` : ""}
        <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" id="agSave">Save</button><button type="button" class="btn ghost" id="agRotate" data-help="If the key or address was shared by mistake. You'll need to paste the new ones into Google Ads.">Get new key and address</button></div></div>
    </div>
    <div class="card mform" style="max-width:520px"><h3>Phone numbers</h3><label class="inline2 lyinline" style="font-size:13px">Numbers without a country code are in <select id="adsCc">${[["65", "Singapore (+65)"], ["60", "Malaysia (+60)"], ["62", "Indonesia (+62)"], ["63", "Philippines (+63)"], ["66", "Thailand (+66)"], ["84", "Vietnam (+84)"]].map(([c, l]) => `<option value="${c}" ${ADS.phoneCc === c ? "selected" : ""}>${l}</option>`).join("")}</select></label><span class="hint">Used to match people from your ads by phone.</span></div>`;
  }

  function adsFollow() {
    const f = ADS.follow;
    const opts = (sel, none) => `<option value="">${none}</option>${EMAILS.map((e) => `<option value="${e.id}" ${sel === e.id ? "selected" : ""}>${esc(e.name)}${e.category ? ` (${esc(e.category)})` : ""}</option>`).join("")}`;
    const first = emailById(f.first);
    return `<div class="card mform" style="max-width:720px"><div class="row" style="justify-content:space-between"><h3>Follow up new leads</h3>${toggle("afOn", f.on, "Email new leads automatically")}</div>
        <span class="hint">People who fill in a lead form are warmest in the first hour. This emails them straight away with their own sign-up link, so when they join, the lead is matched and your ads get the credit.</span>
        <label class="fl">First email, sent straight away<select id="afFirst">${opts(f.first, "Choose an email…")}</select><span class="h">Put <b>{{join_link}}</b> on a button: it's their personal sign-up link.</span></label>
        <div class="two" style="grid-template-columns:2fr 1fr"><label class="fl">Reminder if they haven't joined<select id="afRem">${opts(f.reminder, "No reminder")}</select></label><label class="fl">after (days)<input type="number" id="afDays" min="1" max="30" value="${f.days}" ${f.reminder ? "" : "disabled"}></label></div>
        <label class="check"><input type="checkbox" id="afTeam" ${f.team ? "checked" : ""}> Tell the owner, admins and front desk about each new lead, by email and push</label>
        ${first && !JSON.stringify(first.design).includes("{{join_link}}") ? alertBox("warn", "No sign-up link yet", `“${esc(first.name)}” doesn't use {{join_link}}. Add a button with it so leads can join in one tap.`) : ""}
        ${alertBox("info", "", "Leads only get these emails, each with a “Stop these emails” link. They join your marketing list only if they say yes when they make an account.")}
        <div class="row" style="gap:8px">${first ? `<button type="button" class="btn" data-eopen="${first.id}">Edit “${esc(first.name)}”</button>` : ""}<button type="button" class="btn primary" id="afSave">Save</button></div></div>`;
  }

  function openLeadForm() {
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="leadForm" role="dialog" aria-modal="true" aria-labelledby="leadTitle" style="width:min(520px,100%)"><header><h2 id="leadTitle">Add a lead</h2></header><div class="mb mform">
      <span class="hint">Someone who called, messaged or walked in. ${ADS.follow.on ? "They'll get your first follow-up email if you add an email address." : ""}</span>
      <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">First name<input id="lfFirst" maxlength="60" required></label><label class="fl">Last name<input id="lfLast" maxlength="60"></label></div>
      <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Email<input type="email" id="lfEmail" maxlength="200"></label><label class="fl">Phone<input type="tel" id="lfPhone" maxlength="30"></label></div>
      <label class="fl">Note <span class="h">(optional)</span><input id="lfNote" maxlength="500" placeholder="e.g. Interested in mornings"></label>
      <span class="h" id="lfErr" role="alert" style="color:var(--danger)"></span>
    </div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">Add lead</button></footer></form></div>`;
    $("#leadForm").onsubmit = (e) => {
      e.preventDefault();
      const email = $("#lfEmail").value.trim(), phone = $("#lfPhone").value.trim(), first = $("#lfFirst").value.trim(), last = $("#lfLast").value.trim(), note = $("#lfNote").value.trim();
      if (!email && !phone) { $("#lfErr").textContent = "Add an email or phone number so you can reach them."; return; }
      const dup = LEADS.find((l) => (l.status === "new" || l.status === "contacted") && ((email && l.email.toLowerCase() === email.toLowerCase()) || (phone && l.phone.replace(/\D/g, "").slice(-8) === phone.replace(/\D/g, "").slice(-8))));
      closeModal();
      if (dup) { state.leadF = "open"; render(); return toast(`${leadName(dup)} is already in your leads.`); }
      LEADS.unshift({ id: `l${nextLeadId++}`, first, last, email, phone, source: "manual", campaign: "", days: 0, status: "new", note });
      state.leadF = "open"; render();
      toast(email && ADS.follow.on ? "Lead added and sent your welcome email." : "Lead added.");
    };
  }

  function bindAdsAdmin() {
    if (!$(".adsnav") && !$("#leadsPage")) return;
    document.querySelectorAll("[data-goleads]").forEach((b) => (b.onclick = () => go("leads")));
    document.querySelectorAll("[data-adsv]").forEach((b) => (b.onclick = () => { state.adsView = b.dataset.adsv; render(); }));
    document.querySelectorAll("[data-adsdays]").forEach((b) => (b.onclick = () => { state.adsDays = Number(b.dataset.adsdays); render(); }));
    document.querySelectorAll("[data-leadf]").forEach((b) => (b.onclick = () => { state.leadF = b.dataset.leadf; render(); }));
    if ($("#leadS")) $("#leadS").onchange = (e) => { state.leadS = e.target.value; render(); };
    if ($("#leadQ")) $("#leadQ").onchange = (e) => { state.leadQ = e.target.value; render(); };
    const lead = (id) => LEADS.find((l) => l.id === id);
    document.querySelectorAll("[data-leadc]").forEach((b) => (b.onclick = () => { lead(b.dataset.leadc).status = "contacted"; render(); toast("Marked as contacted."); }));
    document.querySelectorAll("[data-leadl]").forEach((b) => (b.onclick = () => { lead(b.dataset.leadl).status = "lost"; render(); toast("Marked not interested. No more follow-up emails."); }));
    document.querySelectorAll("[data-leadr]").forEach((b) => (b.onclick = () => { lead(b.dataset.leadr).status = "contacted"; render(); }));
    document.querySelectorAll("[data-leadn]").forEach((b) => (b.onclick = () => {
      const l = lead(b.dataset.leadn);
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="lnForm" role="dialog" aria-modal="true" aria-labelledby="lnTitle" style="width:min(460px,100%)"><header><h2 id="lnTitle">Note for ${esc(leadName(l))}</h2></header><div class="mb mform"><label class="fl">Note<input id="lnText" maxlength="500" value="${esc(l.note || "")}" placeholder="e.g. Called, coming Saturday 9am"></label><label class="check"><input type="checkbox" id="lnC" ${l.status === "contacted" ? "checked" : ""}> I've been in touch</label></div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">Save</button></footer></form></div>`;
      $("#lnText").focus();
      $("#lnForm").onsubmit = (e) => { e.preventDefault(); l.note = $("#lnText").value.trim(); if ($("#lnC").checked) l.status = "contacted"; closeModal(); render(); toast("Saved."); };
    }));
    document.querySelectorAll("[data-leadd]").forEach((b) => (b.onclick = () => {
      const l = lead(b.dataset.leadd);
      confirmFlags([{ level: "confirm", title: `Delete ${leadName(l)}?`, msg: "Their details are erased for good, and any follow-up email still waiting is cancelled. Use this if they ask you to delete their data; otherwise mark them Not interested." }], { proceedLabel: "Delete lead", proceed: () => { LEADS.splice(LEADS.indexOf(l), 1); render(); toast("Lead deleted."); } });
    }));
    if ($("#adsAddLead")) $("#adsAddLead").onclick = openLeadForm;
    document.querySelectorAll("[data-copyf]").forEach((b) => (b.onclick = async () => { const el = $(`#${b.dataset.copyf}`); try { await navigator.clipboard.writeText(el.value); toast("Copied."); } catch { el.select(); toast("Press Ctrl+C (or ⌘C) to copy."); } }));
    // Meta
    if ($("#amSave")) {
      document.querySelectorAll("[data-adsclear]").forEach((b) => (b.onclick = () => {
        const which = b.dataset.adsclear === "amPageTok" ? "pageConnected" : "conversionsConnected";
        confirmFlags([{ level: "confirm", title: "Remove this token?", msg: which === "pageConnected" ? "New Meta leads won't come in until you add one again." : "Results stop going to Meta until you add one again." }], { proceedLabel: "Remove token", proceed: () => { ADS.meta[which] = false; if (which === "conversionsConnected") ADS.meta.send = false; render(); toast("Token removed."); } });
      }));
      $("#amSave").onclick = () => {
        const m = ADS.meta, page = $("#amPage").value.trim(), pixel = $("#amPixel").value.trim();
        if ((page && !/^\d{5,25}$/.test(page)) || (pixel && !/^\d{5,25}$/.test(pixel))) return toast("Page and dataset IDs are numbers only.");
        const pt = $("#amPageTok").value.trim(), ct = $("#amCapiTok").value.trim();
        if ((pt && pt.length < 20) || (ct && ct.length < 20)) return toast("That token looks too short. Copy the whole thing.");
        const send = $("#amSend").checked;
        if (send && (!pixel || !(ct || m.conversionsConnected))) return toast("Add your dataset ID and Conversions API token before sending results.");
        Object.assign(m, { pageId: page, pixelId: pixel, send, lastError: null }); if (pt) m.pageConnected = true; if (ct) m.conversionsConnected = true;
        render(); toast("Meta settings saved.");
      };
      $("#amTestBtn").onclick = () => { if (!ADS.meta.conversionsConnected || !ADS.meta.pixelId) return toast("Save your dataset ID and Conversions API token first."); toast($("#amTest").value.trim() ? "Test sent. It shows under Test events in Events Manager within a minute." : "Sent. Add a test code from Events Manager to see it under Test events."); };
    }
    // Google
    if ($("#agSave")) {
      $("#agFeed").onchange = (e) => { ADS.google.feedOn = e.target.checked; render(); };
      $("#agSave").onclick = () => { if ($("#agSignup")) { ADS.google.signupName = $("#agSignup").value.trim() || "Studio sign-up"; ADS.google.purchaseName = $("#agPurchase").value.trim() || "First purchase"; } render(); toast("Google settings saved."); };
      $("#agRotate").onclick = () => confirmFlags([{ level: "confirm", title: "Get a new key and address?", msg: "The old ones stop working straight away. Paste the new key into your Google lead forms and the new address into your scheduled upload." }], { proceedLabel: "Replace them", proceed: () => { const hex = (n) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join(""); ADS.google.key = hex(16); ADS.google.feedKey = hex(24); render(); toast("New key and address ready. Update Google Ads."); } });
    }
    if ($("#adsCc")) $("#adsCc").onchange = (e) => { ADS.phoneCc = e.target.value; toast("Saved."); };
    // Follow-up
    if ($("#afSave")) {
      $("#afRem").onchange = (e) => { $("#afDays").disabled = !e.target.value; };
      $("#afSave").onclick = () => {
        const on = $("#afOn").checked, first = $("#afFirst").value;
        if (on && !first) return toast("Choose the first email new leads get.");
        Object.assign(ADS.follow, { on, first: first || null, reminder: $("#afRem").value || null, days: Math.min(30, Math.max(1, Number($("#afDays").value) || 3)), team: $("#afTeam").checked });
        render(); toast(on ? "Saved. New leads are followed up by themselves." : "Saved. Follow-up emails are off.");
      };
    }
  }
