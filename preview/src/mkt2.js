  // --- Categories (free text with suggestions, like the API) ---
  const EMAIL_CAT_SUGGEST = ["Onboarding", "Promotions", "Newsletters", "Reminders", "Milestones"];
  const JOURNEY_CAT_SUGGEST = ["Onboarding", "Retention", "Win-back", "Milestones", "Ads & leads"];
  const emailCats = (usedOnly = false) => [...new Set([...EMAILS.map((e) => e.category).filter(Boolean), ...(usedOnly ? [] : EMAIL_CAT_SUGGEST)])].sort();
  const journeyCats = (usedOnly = false) => [...new Set([...JOURNEYS.map((j) => j.category).filter(Boolean), ...(usedOnly ? [] : JOURNEY_CAT_SUGGEST)])].sort();
  const catChips = (cats, cur, key, total, countOf) => (cats.length ? `<div class="fbar" role="group" aria-label="Category"><button type="button" class="pickchip" data-${key}="" aria-pressed="${!cur}">All · ${total}</button>${cats.map((c) => `<button type="button" class="pickchip" data-${key}="${esc(c)}" aria-pressed="${cur === c}">${esc(c)} · ${countOf(c)}</button>`).join("")}</div>` : "");
  function bindJCat(j) {
    const el = $("#jCat");
    if (el) el.onchange = () => { j.category = el.value.trim() || null; toast(j.category ? `Filed under “${j.category}”.` : "Category removed."); };
  }

  // --- Deleting ---
  function deleteEmail(id, after) {
    const e = emailById(id);
    const inJ = JOURNEYS.filter((x) => [...walk(x.def.steps)].some((s) => s.emailId === id));
    const waiting = CAMPAIGNS.filter((c) => c.emailId === id && c.status !== "sent");
    if (inJ.length || waiting.length) {
      const where = [...inJ.map((x) => `the journey “${x.name}”`), ...waiting.map((c) => `the campaign “${c.name}”`)];
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="edTitle"><header><h2 id="edTitle">This email is in use</h2></header><div class="mb"><p style="margin:0;font-size:14px">“${esc(e.name)}” is used by:</p><ul class="terms" style="color:var(--fg)">${where.map((w) => `<li>${esc(w)}</li>`).join("")}</ul><span class="hint">Change ${where.length === 1 ? "it" : "them"} to use another email first, then delete this one.</span></div><footer><button type="button" class="btn primary" data-mclose>OK</button></footer></div></div>`;
      return;
    }
    const sent = CAMPAIGNS.filter((c) => c.emailId === id).length;
    confirmFlags([{ level: "confirm", title: `Delete “${e.name}”?`, msg: `It's deleted for good.${sent ? ` ${plural(sent, "sent campaign")} will still show its name in your history.` : ""}` }], {
      proceedLabel: "Delete email",
      proceed: () => { CAMPAIGNS.filter((c) => c.emailId === id).forEach((c) => { c.emailName = e.name; c.emailId = null; }); EMAILS.splice(EMAILS.indexOf(e), 1); after ? after() : render(); toast("Email deleted."); },
    });
  }
  function deleteJourney(j) {
    const live = j.status === "live";
    confirmFlags([{ level: "confirm", title: `Delete “${j.name}”?`, msg: live ? `It's live. Deleting it stops it now: nobody new starts it, and the ${plural(j.stats.inProgress, "person", "people")} part-way through won't get any more steps. Its numbers are deleted too.` : "It's deleted for good, with its numbers. The emails it uses are kept." }], {
      proceedLabel: live ? "Stop and delete" : "Delete journey",
      proceed: () => { JOURNEYS.splice(JOURNEYS.indexOf(j), 1); state.jOpen = null; state.jSel = null; render(); toast("Journey deleted."); },
    });
  }
  function bindMarketingExtras() {
    document.querySelectorAll("[data-jcat]").forEach((b) => (b.onclick = () => { state.jcat = b.dataset.jcat; render(); }));
    document.querySelectorAll("[data-ecat]").forEach((b) => (b.onclick = () => { state.ecat = b.dataset.ecat; render(); }));
    document.querySelectorAll("[data-cdup]").forEach((b) => (b.onclick = () => {
      const c = CAMPAIGNS.find((x) => x.id === b.dataset.cdup);
      if (!c.emailId) { toast("The email this campaign used has been deleted. Choose another in the copy."); }
      openCampaign({ emailId: c.emailId || undefined, segId: c.segId, name: `${c.name} (copy)` });
    }));
    document.querySelectorAll("[data-cdel]").forEach((b) => (b.onclick = () => {
      const c = CAMPAIGNS.find((x) => x.id === b.dataset.cdel);
      confirmFlags([{ level: "confirm", title: `Delete “${c.name}”?`, msg: c.status === "sent" ? "It's removed from this list. Emails already sent can't be unsent." : "It won't be sent, and it's removed from this list." }], { proceedLabel: "Delete campaign", proceed: () => { CAMPAIGNS.splice(CAMPAIGNS.indexOf(c), 1); render(); toast("Campaign deleted."); } });
    }));
    document.querySelectorAll("[data-segdel]").forEach((b) => (b.onclick = () => {
      const s = SEGMENTS.find((x) => x.id === b.dataset.segdel);
      const usedJ = JOURNEYS.filter((x) => x.def.trigger.segmentId === s.id);
      if (usedJ.length) { toast(`“${s.name}” starts the journey “${usedJ[0].name}”. Change or delete that journey first.`); return; }
      confirmFlags([{ level: "confirm", title: `Delete “${s.name}”?`, msg: "The segment is deleted. Clients aren't affected, and campaigns already sent keep their history." }], { proceedLabel: "Delete segment", proceed: () => { SEGMENTS.splice(SEGMENTS.indexOf(s), 1); BANNERS.forEach((x) => { if (x.segId === s.id) { x.audience = "everyone"; x.segId = null; } }); if (state.cfSeg === s.id) state.cfSeg = null; render(); toast("Segment deleted."); } });
    }));
    if ($("#mNewBanner")) $("#mNewBanner").onclick = () => openBanner(null);
    if ($("#bRot")) $("#bRot").onchange = (e) => { BANNER_ROTATE = Number(e.target.value); toast(`Banners now change every ${BANNER_ROTATE} seconds.`); };
    document.querySelectorAll("[data-bedit]").forEach((b) => (b.onclick = () => openBanner(b.dataset.bedit)));
    document.querySelectorAll("[data-bpause]").forEach((b) => (b.onclick = () => { const x = BANNERS.find((y) => y.id === b.dataset.bpause); x.active = !x.active; render(); toast(x.active ? "Banner showing again." : "Banner paused. It's hidden until you resume it."); }));
    document.querySelectorAll("[data-bmove]").forEach((b) => (b.onclick = () => { const [id, dir] = b.dataset.bmove.split(":"); const x = BANNERS.find((y) => y.id === id); const same = BANNERS.filter((y) => y.placement === x.placement); const other = same[same.indexOf(x) + Number(dir)]; if (!other) return; const a = BANNERS.indexOf(x), z = BANNERS.indexOf(other); [BANNERS[a], BANNERS[z]] = [BANNERS[z], BANNERS[a]]; render(); }));
    document.querySelectorAll("[data-bdel]").forEach((b) => (b.onclick = () => { const x = BANNERS.find((y) => y.id === b.dataset.bdel); confirmFlags([{ level: "confirm", title: `Delete “${x.title}”?`, msg: "It disappears from the app straight away, with its view and click numbers." }], { proceedLabel: "Delete banner", proceed: () => { BANNERS.splice(BANNERS.indexOf(x), 1); render(); toast("Banner deleted."); } }); }));
  }

  // --- Studio credit and discounts at checkout ---
  const VOUCHERS = [
    { id: 1, ci: 0, pct: 20, note: "Welcome back offer", expires: "25 Nov" },
    { id: 2, ci: 1, pct: 15, note: "Referral welcome gift", expires: "9 Dec" },
  ];
  function checkoutPrice(me, pl) {
    const vouchers = VOUCHERS.filter((v) => v.ci === me && !v.used);
    const voucher = vouchers.find((v) => v.id === state.coVoucher) || null;
    const discount = voucher ? Math.min(pl.price, voucher.pct ? Math.round((pl.price * voucher.pct) / 100) : voucher.cents) : 0;
    const credit = GIFT_CREDIT[me] || 0;
    const useCredit = state.coCredit !== false;
    const creditUsed = useCredit ? Math.min(credit, pl.price - discount) : 0;
    return { vouchers, voucher, discount, credit, useCredit, creditUsed, due: pl.price - discount - creditUsed };
  }
  BIND.checkout = function () {
    if ($("#coV")) $("#coV").onchange = (e) => { state.coVoucher = Number(e.target.value) || null; render(); };
    if ($("#coC")) $("#coC").onchange = (e) => { state.coCredit = e.target.checked; render(); };
  };

  // --- Banners ---
  const BANNERS = [
    { id: "b1", title: "Intro offer: 5 classes for SGD 150", subtitle: "New here? The easiest way to try us out.", img: svgImg("#be185d", "#f9a8d4", ""), placement: "home", link: "package", target: "p2", audience: "new_clients", segId: null, starts: "", ends: "2026-11-30", active: true, views: 412, clicks: 37 },
    { id: "b2", title: "Gift cards are here", subtitle: "Give the gift of movement this Christmas.", img: svgImg("#7f1d1d", "#15803d", ""), placement: "home", link: "gift_cards", target: "", audience: "everyone", segId: null, starts: "", ends: "", active: true, views: 980, clicks: 41 },
    { id: "b3", title: "Black Friday: 20% off packs", subtitle: "This weekend only.", img: svgImg("#111827", "#6b7280", ""), placement: "packages", link: "category", target: "c1", audience: "everyone", segId: null, starts: "2026-11-27", ends: "2026-11-30", active: true, views: 0, clicks: 0 },
    { id: "b4", title: "Refer a friend, get SGD 30", subtitle: "", img: svgImg("#0c6156", "#5fc3a8", ""), placement: "home", link: "referrals", target: "", audience: "everyone", segId: null, starts: "", ends: "2026-12-31", active: true, views: 655, clicks: 22 },
  ];
  let nextBannerId = 5;
  const PLACES = { home: "Home (Book a class)", packages: "Packages page", schedule: "Above the timetable" };
  const LINKS = { none: "Nothing (just a picture)", package: "A package", category: "A package category", class_type: "A class type", gift_cards: "The gift card shop", referrals: "Refer a friend", url: "A web page" };
  const todayYmd = () => ymd(NOW);
  const bannerState = (b) => (!b.active ? "paused" : b.starts && b.starts > todayYmd() ? "scheduled" : b.ends && b.ends < todayYmd() ? "ended" : "live");
  const STATE_LBL = { live: ["Showing", "done"], scheduled: ["Scheduled", "wait"], ended: ["Ended", "off"], paused: ["Paused", "open"] };
  const fmtYmd = (s) => (s ? fmtDay(fromYmdHm(s, "00:00")) : "");
  function bannerLinkText(b) {
    if (b.link === "package") return `Opens ${PLANS.find((p) => p.id === b.target)?.name || "a package"}`;
    if (b.link === "category") return `Opens ${CATS.find((c) => c.id === b.target)?.name || "a category"}`;
    if (b.link === "class_type") return `Opens ${TYPES[b.target]?.name || "a class type"}`;
    if (b.link === "url") return `Opens ${b.target}`;
    return b.link === "none" ? "No link" : `Opens ${LINKS[b.link].toLowerCase()}`;
  }
  const audienceText = (b) => (b.audience === "new_clients" ? "New clients (no classes yet)" : b.audience === "segment" ? `Segment: ${SEGMENTS.find((s) => s.id === b.segId)?.name || "?"}` : "Everyone");
  const bannerView = (b) => `<div class="bnr" style="background-image:url('${b.img}')"><div><b>${esc(b.title)}</b>${b.subtitle ? `<span>${esc(b.subtitle)}</span>` : ""}</div></div>`;
  function bannerAdmin() {
    return `<span class="hint">Banners show at the top of the client app. Use them for offers, new packages or news. Each one can link somewhere and be shown to everyone, new clients only, or a segment.</span>
      <div class="card"><div class="row" style="justify-content:space-between;gap:12px"><div class="stack" style="gap:2px;min-width:0"><b>Taking turns</b><span class="muted" style="font-size:13px">When a client can see more than one banner in the same place, they take turns in the order below. It pauses while someone is touching or reading one, and people can swipe or tap the dots.</span></div><label class="inline2" style="flex-wrap:nowrap;font-size:13px">Each shows for<select id="bRot">${[4, 5, 6, 8, 10, 15].map((n) => `<option value="${n}" ${BANNER_ROTATE === n ? "selected" : ""}>${n} seconds</option>`).join("")}</select></label></div></div>` +
      Object.entries(PLACES).map(([pl, label]) => {
        const list = BANNERS.filter((b) => b.placement === pl);
        return `<div class="card"><h3>${label}</h3>${list.length ? `<div class="stack">${list.map((b, i) => { const st = bannerState(b); return `<div class="brow">${bannerView(b)}<div class="stack" style="gap:4px;min-width:0"><div class="row"><span class="status ${STATE_LBL[st][1]}">${STATE_LBL[st][0]}</span><span class="muted" style="font-size:12.5px">${b.starts ? `From ${fmtYmd(b.starts)}` : ""}${b.starts && b.ends ? " · " : ""}${b.ends ? `${st === "ended" ? "Ended" : "Until"} ${fmtYmd(b.ends)}` : !b.starts ? "No end date" : ""}</span></div>
          <span style="font-size:13px">${esc(bannerLinkText(b))} · ${esc(audienceText(b))}</span>
          <span class="muted" style="font-size:12.5px">${b.views ? `${b.views} views · ${b.clicks} taps · ${Math.round((b.clicks / b.views) * 1000) / 10}% tapped` : "No views yet"}</span>
          <div class="inline2"><button type="button" class="btn" data-bedit="${b.id}">Edit</button><button type="button" class="btn" data-bpause="${b.id}">${b.active ? "Pause" : "Resume"}</button><button type="button" class="iconbtn" data-bmove="${b.id}:-1" aria-label="Move up" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="iconbtn" data-bmove="${b.id}:1" aria-label="Move down" ${i === list.length - 1 ? "disabled" : ""}>↓</button><button type="button" class="btn ghost danger" data-bdel="${b.id}">Delete</button></div></div></div>`; }).join("")}</div>` : '<span class="muted">No banners here.</span>'}</div>`;
      }).join("");
  }
  function openBanner(id) {
    const cur = id ? BANNERS.find((b) => b.id === id) : null;
    const b = cur ? clone(cur) : { title: "", subtitle: "", img: null, placement: "home", link: "none", target: "", audience: "everyone", segId: null, starts: "", ends: "", active: true, views: 0, clicks: 0 };
    const paint = () => {
      const targetField = b.link === "package" ? `<select id="bnT">${PLANS.filter((p) => p.onSale && !p.archived).map((p) => `<option value="${p.id}" ${b.target === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`
        : b.link === "category" ? `<select id="bnT">${CATS.map((c) => `<option value="${c.id}" ${b.target === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`
        : b.link === "class_type" ? `<select id="bnT">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${b.target === k ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`
        : b.link === "url" ? `<input id="bnT" value="${esc(b.target)}" placeholder="https://…" maxlength="2000">` : "";
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="bnForm" role="dialog" aria-modal="true" aria-labelledby="bnTitle" style="width:min(600px,100%)"><header><h2 id="bnTitle">${cur ? "Edit banner" : "New banner"}</h2></header><div class="mb mform">
        <div class="fl">Preview${b.img ? bannerView({ ...b, title: b.title || "Your headline", subtitle: b.subtitle }) : `<div class="bnr empty"><span>Upload an image to see the banner</span></div>`}</div>
        <div class="row"><label class="btn" style="cursor:pointer">${b.img ? "Change image" : "Upload image"}<input type="file" id="bnImg" accept="image/jpeg,image/png,image/webp" hidden></label><span class="hint">Wide images work best (about 3:1, e.g. 1200 × 400). JPG, PNG or WebP, up to 2 MB. Keep important words away from the edges.</span></div>
        <label class="fl">Headline<input id="bnTi" maxlength="80" value="${esc(b.title)}" placeholder="e.g. Intro offer: 5 classes for SGD 150"></label>
        <label class="fl">Smaller line <span class="h">(optional)</span><input id="bnSu" maxlength="160" value="${esc(b.subtitle)}"></label>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Where it shows<select id="bnP">${Object.entries(PLACES).map(([k, l]) => `<option value="${k}" ${b.placement === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="fl">Tapping it opens<select id="bnL">${Object.entries(LINKS).map(([k, l]) => `<option value="${k}" ${b.link === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
        ${targetField ? `<label class="fl">${b.link === "url" ? "Web address" : "Which one"}${targetField}</label>` : ""}
        <div class="fl">Who sees it
          <label class="opt"><input type="radio" name="bnA" value="everyone" ${b.audience === "everyone" ? "checked" : ""}><div>Everyone</div></label>
          <label class="opt"><input type="radio" name="bnA" value="new_clients" ${b.audience === "new_clients" ? "checked" : ""}><div>New clients<br><span class="h">People who haven't come to a class yet. Good for intro offers.</span></div></label>
          <label class="opt"><input type="radio" name="bnA" value="segment" ${b.audience === "segment" ? "checked" : ""}><div>A segment${b.audience === "segment" ? `<br><select id="bnS" style="margin-top:4px">${SEGMENTS.map((s) => `<option value="${s.id}" ${b.segId === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>` : ""}</div></label></div>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Show from <span class="h">(blank = now)</span><input type="date" id="bnFrom" value="${b.starts}"></label><label class="fl">Until <span class="h">(blank = no end)</span><input type="date" id="bnTo" value="${b.ends}"></label></div>
      </div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">${cur ? "Save" : "Add banner"}</button></footer></form></div>`;
      const keep = () => { b.title = $("#bnTi").value; b.subtitle = $("#bnSu").value; b.starts = $("#bnFrom").value; b.ends = $("#bnTo").value; if ($("#bnT")) b.target = $("#bnT").value; if ($("#bnS")) b.segId = $("#bnS").value; };
      $("#bnImg").onchange = (e) => { keep(); readImage(e.target, (url) => { b.img = url; paint(); }); };
      $("#bnTi").oninput = $("#bnSu").oninput = () => { keep(); const pv = document.querySelector("#bnForm .bnr"); if (pv && b.img) pv.outerHTML = bannerView({ ...b, title: b.title || "Your headline" }); };
      $("#bnP").onchange = (e) => { keep(); b.placement = e.target.value; };
      $("#bnL").onchange = (e) => { keep(); b.link = e.target.value; b.target = b.link === "package" ? PLANS.find((p) => p.onSale && !p.archived).id : b.link === "category" ? CATS[0]?.id : b.link === "class_type" ? Object.keys(TYPES)[0] : ""; paint(); };
      document.querySelectorAll("input[name=bnA]").forEach((r) => (r.onchange = () => { keep(); b.audience = r.value; if (b.audience === "segment" && !b.segId) b.segId = SEGMENTS[0]?.id; paint(); }));
      $("#bnForm").onsubmit = (e) => {
        e.preventDefault(); keep();
        if (!b.img) return toast("Upload the banner image.");
        if (!b.title.trim()) { $("#bnTi").focus(); return toast("Add a headline. It's also read out by screen readers."); }
        if (b.link === "url" && !/^https?:\/\//i.test(b.target)) return toast("Web links need to start with https:// or http://.");
        if (b.starts && b.ends && b.ends < b.starts) return toast("The end date needs to be after the start date.");
        if (cur) Object.assign(cur, b); else BANNERS.push({ ...b, id: `b${nextBannerId++}` });
        closeModal(); state.mtab = "banners"; render(); toast(cur ? "Banner saved." : bannerState(b) === "scheduled" ? `Banner scheduled from ${fmtYmd(b.starts)}.` : "Banner is showing in the app.");
      };
    };
    paint();
  }

  // --- Announcements ---
  const ANNOUNCEMENTS = [
    { id: "a1", title: "Lift out of order", message: "The lift at Tanjong Pagar is being repaired. Please use the stairs on the left of the lobby. Sorry for the hassle!", importance: "important", audience: "location", loc: "tp", within: 7, starts: "Today 8:05am", ends: "End of today", state: "showing", pushed: 13, by: "Fiona (front desk)" },
    { id: "a2", title: "Holiday timetable", message: "We're closed on 25 Dec and 1 Jan. Classes run as normal on the other days.", importance: "info", audience: "everyone", loc: null, within: 7, starts: "Mon 14 Dec", ends: "Fri 2 Jan", state: "scheduled", pushed: null, by: "You" },
    { id: "a3", title: "Washroom closed", message: "The washroom at Holland Village is closed for cleaning until 2pm.", importance: "info", audience: "booked_at_location", loc: "hv", within: 1, starts: "Tue 10 Nov 9:00am", ends: "Tue 10 Nov 2:00pm", state: "ended", pushed: 6, by: "Fiona (front desk)" },
  ];
  let nextAnnId = 4;
  const DURS = { "2h": "2 hours", end_of_day: "Until the end of today", "24h": "24 hours", "3d": "3 days", "1w": "1 week", custom: "Until a date and time I choose" };
  const annAudience = (a) => (a.audience === "everyone" ? CLIENTS.length : CLIENTS.filter((_, i) => { const f = factsOf(i); return f.locations.includes(a.loc) && (a.audience === "location" || f.upcomingBookings > 0); }).length);
  const annWho = (a) => (a.audience === "everyone" ? "Everyone" : a.audience === "location" ? `Clients of ${LOCS[a.loc]}` : `Clients booked at ${LOCS[a.loc]} in the next ${plural(a.within, "day")}`);
  PAGES.announcements = function () {
    const f = state.ann || (state.ann = { title: "", message: "", importance: "info", audience: "everyone", loc: "tp", within: 7, dur: "end_of_day", until: "2026-11-12T18:00", when: "now", at: "2026-11-12T09:00", push: true });
    const n = annAudience(f);
    const group = (st, title) => { const list = ANNOUNCEMENTS.filter((a) => a.state === st); return list.length ? `<h3 style="margin:6px 0 0;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">${title}</h3>${list.map((a) => `<div class="card ann ${a.importance}"><div class="row" style="justify-content:space-between;align-items:flex-start"><div class="stack" style="gap:3px;min-width:0"><div class="row"><b>${esc(a.title)}</b>${a.importance === "important" ? '<span class="status open">Important</span>' : ""}</div><span style="font-size:13.5px">${esc(a.message)}</span><span class="muted" style="font-size:12.5px">${esc(annWho(a))} · ${esc(a.starts)} → ${esc(a.ends)}${a.pushed !== null ? ` · push sent to ${a.pushed}` : ""} · by ${esc(a.by)}</span></div>${st !== "ended" ? `<span class="inline2"><button type="button" class="btn" data-aend="${a.id}">${st === "scheduled" ? "Cancel" : "End now"}</button></span>` : ""}</div></div>`).join("")}` : ""; };
    return head("Announcements", "Quick notices for clients, like a lift out of order. They show at the top of the app for as long as you choose, with an optional push notification.") +
      `<form class="card mform" id="annForm"><h3>New announcement</h3>
        <label class="fl">Title<input id="anT" maxlength="80" value="${esc(f.title)}" placeholder="e.g. Lift out of order"></label>
        <label class="fl">Message <span class="count" id="anC">${f.message.length}/500</span><textarea id="anM" rows="3" maxlength="500" placeholder="What's happening and what clients should do.">${esc(f.message)}</textarea></label>
        <div class="fl">How important<div class="seg" role="group"><button type="button" data-anI="info" aria-pressed="${f.importance === "info"}">Information</button><button type="button" data-anI="important" aria-pressed="${f.importance === "important"}">Important</button></div><span class="h">Important ones show first, in a stronger colour.</span></div>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Who it's for<select id="anA"><option value="everyone" ${f.audience === "everyone" ? "selected" : ""}>Everyone</option><option value="location" ${f.audience === "location" ? "selected" : ""}>Clients of one location</option><option value="booked_at_location" ${f.audience === "booked_at_location" ? "selected" : ""}>Clients booked at a location soon</option></select></label>
          ${f.audience !== "everyone" ? `<label class="fl">Location<select id="anL">${Object.entries(LOCS).map(([k, l]) => `<option value="${k}" ${f.loc === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : "<span></span>"}</div>
        ${f.audience === "booked_at_location" ? `<label class="fl">Booked in the next (days)<input type="number" id="anW" min="1" max="30" value="${f.within}" style="max-width:120px"></label>` : ""}
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Starts<select id="anWhen"><option value="now" ${f.when === "now" ? "selected" : ""}>Now</option><option value="later" ${f.when === "later" ? "selected" : ""}>Later</option></select>${f.when === "later" ? `<input type="datetime-local" id="anAt" value="${f.at}" style="margin-top:4px">` : ""}</label>
          <label class="fl">Stays for<select id="anD">${Object.entries(DURS).map(([k, l]) => `<option value="${k}" ${f.dur === k ? "selected" : ""}>${l}</option>`).join("")}</select>${f.dur === "custom" ? `<input type="datetime-local" id="anU" value="${f.until}" style="margin-top:4px">` : ""}</label></div>
        <label class="check"><input type="checkbox" id="anP" ${f.push ? "checked" : ""}> Send a push notification ${f.push ? `<span class="muted">(${plural(n, "person", "people")}${f.when === "later" ? ", when it starts" : ""})</span>` : ""}</label>
        <span class="hint">Announcements are about the studio itself, so they reach everyone affected, including people who've turned off marketing messages.</span>
        <div class="row"><span class="grow"></span><button type="submit" class="btn primary">${f.when === "later" ? "Schedule" : "Post"}</button></div></form>` +
      group("showing", "Showing now") + group("scheduled", "Scheduled") + group("ended", "Ended recently");
  };
  BIND.announcements = function () {
    const f = state.ann;
    const keep = () => { f.title = $("#anT").value; f.message = $("#anM").value; if ($("#anAt")) f.at = $("#anAt").value; if ($("#anU")) f.until = $("#anU").value; if ($("#anW")) f.within = Math.max(1, Number($("#anW").value) || 1); f.push = $("#anP").checked; };
    $("#anM").oninput = () => ($("#anC").textContent = `${$("#anM").value.length}/500`);
    document.querySelectorAll("[data-anI]").forEach((b) => (b.onclick = () => { keep(); f.importance = b.dataset.ani; render(); }));
    [["#anA", "audience"], ["#anL", "loc"], ["#anWhen", "when"], ["#anD", "dur"]].forEach(([sel, k]) => { if ($(sel)) $(sel).onchange = (e) => { keep(); f[k] = e.target.value; render(); }; });
    if ($("#anW")) $("#anW").onchange = () => { keep(); render(); };
    $("#anP").onchange = () => { keep(); render(); };
    $("#annForm").onsubmit = (e) => {
      e.preventDefault(); keep();
      if (!f.title.trim()) { $("#anT").focus(); return toast("Add a short title, e.g. “Lift out of order”."); }
      if (!f.message.trim()) { $("#anM").focus(); return toast("Add the message."); }
      const later = f.when === "later";
      const n = annAudience(f);
      const fmt = (v) => new Date(v).toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      ANNOUNCEMENTS.unshift({ id: `a${nextAnnId++}`, title: f.title.trim(), message: f.message.trim(), importance: f.importance, audience: f.audience, loc: f.loc, within: f.within, starts: later ? fmt(f.at) : "Just now", ends: f.dur === "custom" ? fmt(f.until) : DURS[f.dur].replace(/^Until the end of today$/, "End of today"), state: later ? "scheduled" : "showing", pushed: f.push && !later ? n : null, by: state.role === "foh" ? "Fiona (front desk)" : "You" });
      state.ann = null; render();
      toast(later ? "Scheduled." : f.push ? `Posted. ${plural(n, "person", "people")} will get a push notification.` : "Posted in the app.");
    };
    document.querySelectorAll("[data-aend]").forEach((b) => (b.onclick = () => { const a = ANNOUNCEMENTS.find((x) => x.id === b.dataset.aend); const sch = a.state === "scheduled"; confirmFlags([{ level: "confirm", title: sch ? "Cancel this announcement?" : "Take it down now?", msg: sch ? "It won't show, and its push notification won't be sent." : "It disappears from the app straight away." }], { proceedLabel: sch ? "Cancel it" : "End now", proceed: () => { a.state = "ended"; a.ends = "Ended just now"; render(); toast("Done."); } }); }));
  };

  // --- What clients see: announcements and banners at the top of the app ---
  const dismissedAnn = new Set();
  function clientFront(placement) {
    const me = ME.client;
    const f = factsOf(me);
    const anns = placement === "home" ? ANNOUNCEMENTS.filter((a) => a.state === "showing" && !dismissedAnn.has(a.id) && (a.audience === "everyone" || f.locations.includes(a.loc) || state.clientSource !== "new")).sort((a, b) => (a.importance === "important" ? -1 : 0) - (b.importance === "important" ? -1 : 0)) : [];
    const isNew = state.clientSource === "new" || f.classesAttended === 0;
    const bans = BANNERS.filter((b) => b.placement === placement && bannerState(b) === "live" && (b.audience === "everyone" || (b.audience === "new_clients" && isNew) || (b.audience === "segment" && matchSet(SEGMENTS.find((s) => s.id === b.segId)?.def || { rules: [] }).includes(me))));
    return anns.map((a) => `<div class="annbar ${a.importance}" role="${a.importance === "important" ? "alert" : "status"}"><span class="ic">${a.importance === "important" ? "!" : "i"}</span><div><b>${esc(a.title)}</b>${a.loc ? `<span class="muted"> · ${esc(LOCS[a.loc])}</span>` : ""}<br><span>${esc(a.message)}</span></div><button type="button" class="iconbtn" data-dismiss="${a.id}" aria-label="Dismiss">×</button></div>`).join("") +
      (bans.length ? carouselHTML(bans) : "");
  }
  function bindFront() {
    startCarousels();
    document.querySelectorAll("[data-dismiss]").forEach((b) => (b.onclick = () => { dismissedAnn.add(b.dataset.dismiss); render(); }));
    document.querySelectorAll("[data-btap]").forEach((b) => (b.onclick = () => {
      const x = BANNERS.find((y) => y.id === b.dataset.btap); x.clicks++;
      if (x.link === "package") { state.buy = x.target; state.ordered = null; go("checkout"); }
      else if (x.link === "gift_cards") go("gift-cards");
      else if (x.link === "referrals") go("refer");
      else if (x.link === "category" || x.link === "class_type") go("my-packages");
      else if (x.link === "url") toast(`Opens ${x.target} in the browser.`);
    }));
  }
  // The client "Book a class" page and My packages get the strip at the top.
  const scheduleHead = document.querySelector("#pgSchedule .pagehead");
  if (scheduleHead && !$("#clientFront")) scheduleHead.insertAdjacentHTML("afterend", '<div id="clientFront" class="stack" style="gap:10px"></div>');
  const renderBase = render;
  render = function () {
    renderBase();
    const front = $("#clientFront");
    if (front) {
      const show = state.role === "client" && state.page === "schedule";
      front.innerHTML = show ? clientFront("home") + clientFront("schedule") : "";
      front.hidden = !front.innerHTML;
      if (show) bindFront();
    }
    if (state.role === "client" && state.page === "my-packages" && !state.eOpen) {
      const html = clientFront("packages");
      const pg = $("#pgOther .pagehead");
      if (html && pg && !document.querySelector("#pgOther .bnrs, #pgOther .bcar")) { pg.insertAdjacentHTML("afterend", html); bindFront(); }
    }
  };
