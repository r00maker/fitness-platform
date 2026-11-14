  // ===========================================================================
  // WhatsApp, the Leads page and Reports. Same rules and wording as the API
  // (modules/marketing/whatsapp.ts, ads.ts and modules/reports/routes.ts).
  // ===========================================================================

  // --- WhatsApp -------------------------------------------------------------------
  const WA = {
    connected: true, phone: "+65 6123 4567", phoneNumberId: "109876543210123", accountId: "204567890123456", country: "65", lastError: null,
    templates: [
      { name: "pack_used_up", language: "en", category: "marketing", label: "Pack used up", body: "Hi {{1}}, you've used the last class on your pack. Want to keep your streak going? Reply YES and we'll send you a link to top up." },
      { name: "intro_offer_reminder", language: "en", category: "marketing", label: "Intro offer reminder", body: "Hi {{1}}! Your intro offer at Demo Studio ends on {{2}}. Book your next class in the app." },
      { name: "class_reminder", language: "en", category: "utility", label: "Class reminder", body: "Hi {{1}}, a reminder that you're booked into {{2}} tomorrow. See you there!" },
    ],
  };
  const waYes = () => CLIENTS.filter((c, i) => i % 3 !== 2 && c.phone).length;

  function whatsappAdmin() {
    const steps = [
      "In <b>Meta Business Suite</b>, set up <b>WhatsApp Manager</b> and add your studio's phone number (it can't already be used in the normal WhatsApp app).",
      "Verify your business with Meta and choose a display name. Meta checks these, usually within a few days.",
      "In <b>WhatsApp Manager → Phone numbers</b>, copy the <b>Phone number ID</b> and <b>WhatsApp Business Account ID</b>. Create a permanent access token for a system user with WhatsApp messaging permission.",
      "Paste them below, then create your message templates in WhatsApp Manager and press <b>Sync templates</b>.",
    ];
    return `<div class="adsgrid">
      <div class="card mform"><div class="row" style="justify-content:space-between"><h3><span class="cellp" style="gap:8px"><span class="srcdot wa" aria-hidden="true">W</span>WhatsApp Business</span></h3><span class="status ${WA.connected ? "live" : "draft"}">${WA.connected ? "Connected" : "Not connected"}</span></div>
        ${WA.connected ? alertBox("ok", "", `Sending from ${esc(WA.phone)}. ${waYes()} clients have said yes to WhatsApp messages.`) : ""}
        <details class="howto"><summary>How to connect (about 20 minutes, plus Meta's checks)</summary><ol>${steps.map((x) => `<li>${x}</li>`).join("")}</ol></details>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Phone number ID<input id="waPid" inputmode="numeric" value="${esc(WA.phoneNumberId)}"></label><label class="fl">Business account ID<input id="waAid" inputmode="numeric" value="${esc(WA.accountId)}"></label></div>
        <label class="fl"><span class="flh">Access token${WA.connected ? '<span class="status done">Saved</span>' : ""}</span><input type="password" id="waTok" autocomplete="off" placeholder="${WA.connected ? "•••••••••••• (paste a new one to replace it)" : "Paste it here"}"></label>
        <label class="inline2 lyinline" style="font-size:13px">Numbers without a country code are in <select id="waCc">${[["65", "Singapore (+65)"], ["60", "Malaysia (+60)"], ["62", "Indonesia (+62)"], ["63", "Philippines (+63)"], ["66", "Thailand (+66)"]].map(([c, l]) => `<option value="${c}" ${WA.country === c ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <span class="hint">The token is stored encrypted and never shown again.</span>
        <div class="row"><button type="button" class="btn primary" id="waSave">Save</button></div></div>
      <div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3>Message templates</h3><span class="inline2"><button type="button" class="btn" id="waSync" data-help="Fetch your approved templates from WhatsApp.">Sync templates</button></span></div>
        <span class="hint">WhatsApp only lets businesses start a conversation with a message it has approved. Write and submit these in WhatsApp Manager (approval usually takes minutes to a day), then sync them here to use them in journeys.</span>
        <div class="stack" style="margin-top:8px">${WA.templates.map((t) => `<div class="watpl"><div class="row" style="justify-content:space-between;gap:8px"><b>${esc(t.label)}</b><span class="status ${t.category === "marketing" ? "wait" : "off"}">${t.category === "marketing" ? "Marketing" : "Service"}</span></div><div class="wabubble">${esc(t.body).replace(/\{\{(\d+)\}\}/g, '<b class="wablank">{{$1}}</b>')}</div><span class="muted" style="font-size:12px">${esc(t.name)} · ${esc(t.language)}</span></div>`).join("")}</div></div>
    </div>
    ${alertBox("info", "Good to know", "Meta charges for each template message (marketing ones cost more than service ones); you'll see the rates in WhatsApp Manager. Clients only get WhatsApp messages if they've said yes in their profile, and they can reply STOP at any time. Two-way chat (seeing and answering replies here) is coming next.")}`;
  }
  function bindWhatsapp() {
    if (!$("#waSave")) return;
    $("#waSave").onclick = () => {
      const pid = $("#waPid").value.trim(), aid = $("#waAid").value.trim(), tok = $("#waTok").value.trim();
      if (!/^\d{5,25}$/.test(pid) || !/^\d{5,25}$/.test(aid)) return toast("The phone number and account IDs are long numbers from WhatsApp Manager.");
      if (tok && tok.length < 20) return toast("That token looks too short. Copy the whole thing.");
      if (!WA.connected && !tok) return toast("Paste the access token to connect.");
      Object.assign(WA, { phoneNumberId: pid, accountId: aid, country: $("#waCc").value, connected: true });
      render(); toast("WhatsApp settings saved.");
    };
    $("#waSync").onclick = () => toast(`Synced: ${plural(WA.templates.length, "approved template")}. Templates waiting for approval, and one-time-code templates, aren't shown.`);
  }

  // --- Leads: ad enquiries, ClassPass clients and walk-ins, in one place --------------
  SRC.classpass = "ClassPass"; SRC_SHORT.classpass = "ClassPass";
  for (const [ci, days, status, cents] of [[7, 9, "new"], [13, 16, "contacted"], [16, 34, "bought", 28000]]) {
    const c = CLIENTS[ci];
    if (!c) continue;
    const [first, ...rest] = c.name.split(" ");
    LEADS.push({ id: `l${nextLeadId++}`, first, last: rest.join(" "), email: c.email, phone: c.phone || "", source: "classpass", campaign: "", days, status, cents, note: status === "bought" ? "Bought a 10-class pack after 4 ClassPass visits" : status === "contacted" ? "Offered the intro week at the desk" : "Books through ClassPass. Becomes a member when they buy one of your packages." });
  }
  LEADS.sort((a, b) => a.days - b.days);

  PAGES.leads = function () {
    return head("Leads", "People who aren't paying members yet: enquiries from your ads, ClassPass clients and walk-ins. When they join or buy, their lead updates by itself.", `<button type="button" class="btn primary" id="adsAddLead">+ Add lead</button>`) +
      `<div id="leadsPage">${adsLeads()}</div>${alertBox("info", "ClassPass clients", "Everyone who books through ClassPass is added here. They pay ClassPass, not you, so turning them into members (with an intro offer at the desk, for example) is often your cheapest way to grow.")}`;
  };
  BIND.leads = () => bindAdsAdmin();

  // --- Reports ----------------------------------------------------------------------
  const RTABS = [["overview", "Overview"], ["sales", "Sales"], ["classes", "Classes"], ["instructors", "Instructors"], ["clients", "Clients"], ["conversion", "Conversion"]];
  /** One instructor's (or everyone's) numbers from a range. */
  function teachStats(classes) {
    const grp = classes.filter((c) => !c.cancelled && TYPES[c.type]?.kind !== "appointment");
    return {
      classes: grp.length, appts: classes.filter((c) => !c.cancelled && TYPES[c.type]?.kind === "appointment").length, covers: grp.filter((c) => c.cover).length,
      avg: grp.length ? Math.round((grp.reduce((a, c) => a + c.booked, 0) / grp.length) * 10) / 10 : 0,
      fill: pctOf(grp.reduce((a, c) => a + c.booked, 0), grp.reduce((a, c) => a + c.cap, 0)),
      visits: classes.reduce((a, c) => a + c.present, 0),
      noShow: pctOf(classes.reduce((a, c) => a + c.noShow, 0), classes.reduce((a, c) => a + c.present + c.noShow, 0)),
      held: grp,
    };
  }
  const RPERIODS = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "12 months"]];
  /**
   * A day of studio history. Real classes where the sample schedule has them; before that, the same
   * timetable with steadily growing bookings (about 10% a quarter), so comparisons look like a real studio.
   */
  const DAY_CACHE = new Map();
  function dayStats(d) {
    const key = ymd(d);
    if (DAY_CACHE.has(key)) return DAY_CACHE.get(key);
    const out = { classes: [], money: { packages: 0, gift: 0, fees: 0, refunds: 0 }, sold: [], newClients: 0 };
    const real = SESSIONS.filter((s) => ymd(s.start) === key && s.end <= NOW);
    const age = Math.max(0, (NOW - d) / 864e5);
    const growth = 1 / (1 + age / 900);
    if (real.length || d >= new Date(2026, 9, 26)) {
      for (const s of real) if (s.status === "scheduled") out.classes.push({ loc: s.loc, instr: s.instr, cover: !!s.coverFor, type: s.type, hhmm: hhmm(s.start), dow: s.start.getDay(), cap: s.cap, booked: s.roster.length, present: s.roster.filter((r) => r.att === "present").length, noShow: s.roster.filter((r) => r.att === "no_show").length, auto: false });
    } else {
      for (const [time, type, instr, room, , cap] of PATTERN[d.getDay()]) {
        const loc = ROOMS[room]?.loc || "tp";
        const h = hash(key + time + type);
        const booked = type === "private" ? (h % 4 ? 1 : 0) : Math.min(cap, Math.round(cap * (0.42 + (h % 45) / 100) * growth + (time === "07:00" || time === "18:00" ? 2 : 0)));
        const ns = booked > 3 && h % 7 === 0 ? 1 : 0;
        if (type !== "private" && booked < 3 && h % 5 === 0) { out.classes.push({ loc, instr, type, hhmm: time, dow: d.getDay(), cap, booked, present: 0, noShow: 0, auto: true, cancelled: true }); continue; }
        out.classes.push({ loc, instr, cover: h % 17 === 0, type, hhmm: time, dow: d.getDay(), cap, booked, present: booked - ns, noShow: ns, auto: false });
      }
    }
    const h = hash(`money${key}`);
    const sales = Math.round((2 + (h % 5)) * growth);
    const onSale = PLANS.filter((p) => p.onSale && !p.archived).flatMap((p) => (p.types.some((t) => TYPES[t]?.kind === "appointment") ? [p] : [p, p, p, p]));
    for (let i = 0; i < sales; i++) { const pl = onSale[(h >>> (i + 2)) % onSale.length]; out.money.packages += pl.price; out.sold.push(pl.name); }
    if (h % 6 === 0) out.money.gift += [5000, 10000, 15000][h % 3];
    if (h % 4 === 0) out.money.fees += 1500;
    if (h % 23 === 0) out.money.refunds += 2800;
    out.newClients = Math.round(((h >>> 3) % 4) * growth);
    DAY_CACHE.set(key, out);
    return out;
  }
  function rangeStats(from, to) {
    const t = { classes: [], money: { packages: 0, gift: 0, fees: 0, refunds: 0 }, sold: [], newClients: 0, days: [] };
    for (let d = day(from); d < to; d = addDays(d, 1)) {
      const x = dayStats(d);
      t.days.push({ d, x });
      t.classes.push(...x.classes);
      for (const k of Object.keys(t.money)) t.money[k] += x.money[k];
      t.sold.push(...x.sold);
      t.newClients += x.newClients;
    }
    const held = t.classes.filter((c) => !c.cancelled && TYPES[c.type]?.kind !== "appointment");
    t.held = held;
    t.appts = t.classes.filter((c) => !c.cancelled && TYPES[c.type]?.kind === "appointment").length;
    t.nett = t.money.packages + t.money.gift + t.money.fees - t.money.refunds;
    t.fill = pctOf(held.reduce((a, c) => a + c.booked, 0), held.reduce((a, c) => a + c.cap, 0));
    t.visits = t.classes.reduce((a, c) => a + c.present, 0);
    t.noShow = pctOf(t.classes.reduce((a, c) => a + c.noShow, 0), t.classes.reduce((a, c) => a + c.present + c.noShow, 0));
    t.active = Math.round(t.visits / Math.max(1.6, 1 + (to - from) / 864e5 / 9));
    t.cancelled = t.classes.filter((c) => c.cancelled).length;
    t.auto = t.classes.filter((c) => c.auto).length;
    return t;
  }
  /** Headline money: whole amounts read faster ("SGD 69,009"); tables keep the cents. */
  const mWhole = (c) => m$c(Math.round(c / 100) * 100).replace(/\.00$/, "");
  const pctOf = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  function chg(cur, prev, { goodUp = true, isPct = false } = {}) {
    if (isPct) { const d = Math.round((cur - prev) * 10) / 10; return { text: d === 0 ? "Same as before" : `${d > 0 ? "+" : ""}${d} points`, dir: d > 0 ? "up" : d < 0 ? "down" : "flat", good: d === 0 ? null : (d > 0) === goodUp }; }
    if (!prev) return { text: cur ? "New this period" : "None either period", dir: cur ? "up" : "flat", good: cur ? goodUp : null };
    const p = Math.round(((cur - prev) / prev) * 100);
    return { text: p === 0 ? "Same as before" : `${p > 0 ? "Up" : "Down"} ${Math.abs(p)}%`, dir: p > 0 ? "up" : p < 0 ? "down" : "flat", good: p === 0 ? null : (p > 0) === goodUp };
  }
  const tile = (label, value, c, explain) => `<div class="rtile"><span class="rl">${esc(label)}</span><b class="rv">${esc(value)}</b>${c ? `<span class="rchg ${c.good === null ? "flat" : c.good ? "good" : "bad"}"><span aria-hidden="true">${c.dir === "up" ? "↑" : c.dir === "down" ? "↓" : "→"}</span> ${esc(c.text)}${c.good === null ? "" : `<span class="sr"> (${c.good ? "good" : "worth watching"})</span>`}</span>` : ""}<span class="rx">${esc(explain)}</span></div>`;
  function rSummary(items, days) {
    const period = days === 365 ? "the year before" : `the previous ${days} days`;
    const moved = items.filter(([, c]) => c && c.good !== null);
    if (!moved.length) return `Much the same as ${period}.`;
    const good = moved.find(([, c]) => c.good), bad = moved.find(([, c]) => !c.good);
    const say = ([l, c]) => `${l.toLowerCase()} ${c.dir === "up" ? "went up" : "went down"}${/\d/.test(c.text) ? ` (${c.text.toLowerCase()})` : ""}`;
    return `${good ? `Good news: ${say(good)}` : ""}${bad ? `${good ? "; worth watching: " : "Worth watching: "}${say(bad)}` : ""} compared with ${period}.`;
  }
  const slotLabel = (c) => `${TYPES[c.type].name}, ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][c.dow]} ${short(fromYmdHm("2026-01-01", c.hhmm))}`;
  function slots(held) {
    const m = new Map();
    for (const c of held) { const k = `${c.type}|${c.dow}|${c.hhmm}`; const v = m.get(k) || { c, n: 0, cap: 0, booked: 0 }; v.n++; v.cap += c.cap; v.booked += c.booked; m.set(k, v); }
    return [...m.values()].filter((v) => v.n >= 2).map((v) => ({ label: slotLabel(v.c), n: v.n, avg: Math.round((v.booked / v.n) * 10) / 10, fill: pctOf(v.booked, v.cap) })).sort((a, b) => b.fill - a.fill);
  }
  const meter = (pct) => `<span class="rmeter" aria-hidden="true"><span style="width:${Math.min(100, pct)}%"></span></span>`;

  // Zoom in (Classes tab): narrow to a class type, location, instructor, days and/or time of day.
  const BANDS = [["morning", "Mornings", "before 12pm"], ["afternoon", "Afternoons", "12pm to 5pm"], ["evening", "Evenings", "5pm on"]];
  const bandOf = (hm) => { const h = Number(hm.slice(0, 2)); return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening"; };
  const ZDAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]];
  const zoomOn = (z) => !!(z.type || z.loc || z.instr || z.days.length || z.band);
  const zoomed = (z, classes) => classes.filter((c) => (!z.type || c.type === z.type) && (!z.loc || c.loc === z.loc) && (!z.instr || c.instr === z.instr) && (!z.days.length || z.days.includes(c.dow)) && (!z.band || bandOf(c.hhmm) === z.band));
  function zoomStats(classes) {
    const held = classes.filter((c) => !c.cancelled && TYPES[c.type]?.kind !== "appointment");
    return {
      held, appts: classes.filter((c) => !c.cancelled && TYPES[c.type]?.kind === "appointment").length,
      fill: pctOf(held.reduce((a, c) => a + c.booked, 0), held.reduce((a, c) => a + c.cap, 0)),
      visits: classes.reduce((a, c) => a + c.present, 0),
      noShow: pctOf(classes.reduce((a, c) => a + c.noShow, 0), classes.reduce((a, c) => a + c.present + c.noShow, 0)),
      cancelled: classes.filter((c) => c.cancelled).length, auto: classes.filter((c) => c.auto).length,
    };
  }
  function zoomWords(z) {
    const parts = [z.type && TYPES[z.type]?.name, z.loc && LOCS[z.loc], z.instr && `taught by ${STAFF[z.instr]}`, z.days.length && ZDAYS.filter(([d]) => z.days.includes(d)).map(([, n]) => n).join(", "), z.band && BANDS.find((b) => b[0] === z.band)[1].toLowerCase()].filter(Boolean);
    return parts.join(" · ");
  }

  PAGES.reports = function () {
    const tab = state.rTab || "overview", days = state.rDays || 30;
    const to = NOW, from = addDays(NOW, -days), prevFrom = addDays(from, -days);
    const cur = rangeStats(from, to), prev = rangeStats(prevFrom, from);
    const nav = `<div class="tabs" role="tablist">${RTABS.map(([k, l]) => `<button type="button" role="tab" data-rtab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</div>`;
    const period = `<div class="row rhead" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="seg" role="group" aria-label="Period">${RPERIODS.map(([d, l]) => `<button type="button" data-rdays="${d}" aria-pressed="${days === d}">Last ${l}</button>`).join("")}</div><span class="muted" style="font-size:12.5px">Compared with ${days === 365 ? "the 12 months before" : `the ${days} days before`} · sample data</span></div>`;
    let body = "";
    if (tab === "overview") {
      const t = [
        ["Money in", mWhole(cur.nett), chg(cur.nett, prev.nett), "Packages, gift cards and fees paid, minus money refunded."],
        ["Clients who came", String(cur.active), chg(cur.active, prev.active), "Different people who came to at least one class."],
        ["New clients", String(cur.newClients), chg(cur.newClients, prev.newClients), "People who joined the studio."],
        ["Classes held", String(cur.held.length), chg(cur.held.length, prev.held.length), "Group classes that ran (appointments are counted separately)."],
        ["How full classes were", `${cur.fill}%`, chg(cur.fill, prev.fill, { isPct: true }), `On average, about ${Math.round(cur.fill / 10)} of every 10 spots were taken.`],
      ];
      const sl = slots(cur.held);
      body = `<div class="card rsum"><b>${esc(rSummary(t.map(([l, , c]) => [l, c]), days))}</b></div><div class="rtiles">${t.map((x) => tile(...x)).join("")}</div>
        <div class="card"><h3>Worth knowing</h3><ul class="rhl">${[sl[0] ? `Your fullest regular class is <b>${esc(sl[0].label)}</b> (${sl[0].fill}% full on average).` : "", sl.length > 1 ? `Your quietest is <b>${esc(sl[sl.length - 1].label)}</b> (${sl[sl.length - 1].fill}% full). Worth a look.` : "", cur.auto ? `${plural(cur.auto, "class was", "classes were")} cancelled automatically for low bookings.` : ""].filter(Boolean).map((x) => `<li>${x}</li>`).join("")}</ul></div>`;
    }
    if (tab === "sales") {
      const sold = cur.sold.length, avg = sold ? Math.round(cur.money.packages / sold) : 0, avgPrev = prev.sold.length ? Math.round(prev.money.packages / prev.sold.length) : 0;
      const t = [
        ["Money in", mWhole(cur.nett), chg(cur.nett, prev.nett), "Packages, gift cards and fees paid, minus money refunded."],
        ["Packages sold", String(sold), chg(sold, prev.sold.length), "Paid packages and memberships (free ones aren't counted)."],
        ["Average package sale", mWhole(avg), chg(avg, avgPrev), "What a package sold for, on average."],
        ["Money refunded", mWhole(cur.money.refunds), chg(cur.money.refunds, prev.money.refunds, { goodUp: false }), "Money paid back to clients (not studio credit)."],
      ];
      const monthly = days > 90;
      const buckets = [];
      for (const { d, x } of cur.days) {
        const k = monthly ? `${d.getFullYear()}-${d.getMonth()}` : ymd(startOfWeek(d));
        let b = buckets.find((y) => y.k === k);
        if (!b) buckets.push((b = { k, label: monthly ? d.toLocaleDateString("en-GB", { month: "short" }) : fmtShortDay(startOfWeek(d)), cents: 0 }));
        b.cents += x.money.packages + x.money.gift + x.money.fees - x.money.refunds;
      }
      const max = Math.max(1, ...buckets.map((b) => b.cents));
      const gross = cur.money.packages + cur.money.gift + cur.money.fees;
      const parts = [["Packages and memberships", cur.money.packages], ["Gift cards", cur.money.gift], ["Fees (late cancellation, no-show)", cur.money.fees]];
      const byName = new Map(); cur.sold.forEach((n) => byName.set(n, (byName.get(n) || 0) + 1));
      const top = [...byName.entries()].map(([n, c]) => ({ n, c, cents: c * (PLANS.find((p) => p.name === n)?.price || 0) })).sort((a, b) => b.cents - a.cents).slice(0, 6);
      const showTable = state.rTable;
      body = `<div class="card rsum"><b>${esc(rSummary(t.map(([l, , c]) => [l, c]), days))}</b></div><div class="rtiles">${t.map((x) => tile(...x)).join("")}</div>
        <div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3>Money in each ${monthly ? "month" : "week"}</h3><button type="button" class="btn ghost" id="rTbl" aria-pressed="${!!showTable}">${showTable ? "Show as chart" : "Show as table"}</button></div>
          ${showTable ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>${monthly ? "Month" : "Week starting"}</th><th class="num">Money in</th></tr></thead><tbody>${buckets.map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${m$c(b.cents)}</td></tr>`).join("")}</tbody></table></div>`
            : `<span class="muted" style="font-size:12.5px">Highest ${monthly ? "month" : "week"}: ${m$c(max)}. Point at a bar for its amount.</span><div class="rbars" role="img" aria-label="Money in each ${monthly ? "month" : "week"}: highest ${m$c(max)}">${buckets.map((b) => `<div class="rbar" data-tipv="${esc(`${b.label}: ${m$c(b.cents)}`)}" tabindex="0"><span class="rbf" style="height:${Math.max(2, (b.cents / max) * 100)}%"></span><span class="rbl">${esc(b.label)}</span></div>`).join("")}</div><div class="rtip" id="rTip" hidden></div>`}
        </div>
        <div class="adsgrid"><div class="card"><h3>Where the money came from</h3><div class="stack">${parts.map(([l, c]) => `<div><div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(l)}</span><b>${m$c(c)} <span class="muted" style="font-weight:400">· ${pctOf(c, gross)}%</span></b></div>${meter(pctOf(c, gross))}</div>`).join("")}</div></div>
          <div class="card"><h3>Best-selling packages</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Package</th><th class="num">Sold</th><th class="num">Money in</th></tr></thead><tbody>${top.map((x) => `<tr><td>${esc(x.n)}</td><td class="num">${x.c}</td><td class="num">${m$c(x.cents)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
    }
    if (tab === "classes") {
      const z = state.rZoom || (state.rZoom = { type: "", loc: "", instr: "", days: [], band: "" });
      const on = zoomOn(z);
      const zc = zoomStats(zoomed(z, cur.classes)), zp = zoomStats(zoomed(z, prev.classes));
      const t = [
        ["Classes held", String(zc.held.length), chg(zc.held.length, zp.held.length), "Group classes that ran."],
        ["How full classes were", `${zc.fill}%`, chg(zc.fill, zp.fill, { isPct: true }), `About ${Math.round(zc.fill / 10)} of every 10 spots were taken.`],
        ["Visits", String(zc.visits), chg(zc.visits, zp.visits), "Times someone was marked as attended."],
        ["No-shows", `${zc.noShow}%`, chg(zc.noShow, zp.noShow, { isPct: true, goodUp: false }), `Out of every 100 people booked, about ${Math.round(zc.noShow)} didn't turn up.`],
        ["Appointments held", String(zc.appts), chg(zc.appts, zp.appts), "Private sessions, counted separately from classes."],
      ];
      const group = (keyOf, rows) => { const m = new Map(); for (const c of zc.held) { const k = keyOf(c); const v = m.get(k) || { k, n: 0, cap: 0, b: 0, ns: 0, pr: 0 }; v.n++; v.cap += c.cap; v.b += c.booked; v.ns += c.noShow; v.pr += c.present; m.set(k, v); } return [...m.values()].map((v) => ({ ...v, avg: Math.round((v.b / v.n) * 10) / 10, fill: pctOf(v.b, v.cap), nsr: pctOf(v.ns, v.ns + v.pr) })); };
      const byType = group((c) => c.type).filter((x) => TYPES[x.k]).sort((a, b) => b.n - a.n);
      const byLoc = group((c) => c.loc).sort((a, b) => b.n - a.n);
      const cells = group((c) => `${c.dow}|${bandOf(c.hhmm)}`).map((x) => ({ ...x, fill: Math.round(x.fill) }));
      const cell = (d, b) => cells.find((x) => x.k === `${d}|${b}`);
      const ranked = cells.filter((x) => x.n >= 2).sort((a, b) => b.fill - a.fill);
      const cellName = (x) => { const [d, b] = x.k.split("|"); return `${ZDAYS.find(([n]) => String(n) === d)[1]} ${b}s`; };
      const sl = slots(zc.held);
      const list = (rows) => `<div class="stack">${rows.map((x) => `<div><div class="row" style="justify-content:space-between;font-size:13px;gap:8px"><span>${esc(x.label)}</span><b>${x.fill}%</b></div>${meter(x.fill)}<span class="muted" style="font-size:12px">${plural(x.n, "class", "classes")}, ${x.avg} booked on average</span></div>`).join("")}</div>`;
      const zsel = (id, cur2, opts, any) => `<select id="${id}"><option value="">${any}</option>${opts.map(([k, l]) => `<option value="${k}" ${cur2 === k ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
      const zbar = `<div class="card rzoom"><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><h3 style="margin:0">Zoom in</h3>${on ? `<button type="button" class="tagbtn" id="rzClear">Show everything</button>` : '<span class="muted" style="font-size:12.5px">Narrow every number on this tab.</span>'}</div>
        <div class="rzgrid">
          <label class="fl">Class${zsel("rzType", z.type, Object.entries(liveTypes()).filter(([, ty]) => ty.kind === "class").map(([k, ty]) => [k, ty.name]), "All classes")}</label>
          <label class="fl">Location${zsel("rzLoc", z.loc, Object.entries(LOCS), "All locations")}</label>
          <label class="fl">Instructor${zsel("rzIns", z.instr, Object.entries(STAFF), "Everyone")}</label>
        </div>
        <div class="rzgrid2"><div class="fl">Days<div class="seg dows" role="group" aria-label="Days">${ZDAYS.map(([d, n]) => `<button type="button" data-rzday="${d}" aria-pressed="${z.days.includes(d)}">${n}</button>`).join("")}</div></div>
          <div class="fl">Time of day<div class="seg" role="group" aria-label="Time of day"><button type="button" data-rzband="" aria-pressed="${!z.band}">Any time</button>${BANDS.map(([k, l, h]) => `<button type="button" data-rzband="${k}" aria-pressed="${z.band === k}" data-help="${h}">${l}</button>`).join("")}</div></div></div>
        ${on ? `<p class="rzon">Showing <b>${esc(zoomWords(z))}</b> only.</p>` : ""}</div>`;
      const heat = `<div class="card"><h3>When classes are busiest</h3><span class="hint">How full classes were, by day and time of day. Tap a box to zoom in on it.</span>
        <div class="tblwrap" style="margin-top:8px"><table class="tbl rheat"><thead><tr><th></th>${ZDAYS.map(([, n]) => `<th>${n}</th>`).join("")}</tr></thead><tbody>${BANDS.map(([b, l]) => `<tr><th scope="row">${l}</th>${ZDAYS.map(([d]) => { const x = cell(d, b); return x ? `<td><button type="button" class="rhc" data-rzcell="${d}|${b}" aria-label="${esc(`${l}, ${ZDAYS.find(([n]) => n === d)[1]}: ${x.fill}% full, ${plural(x.n, "class", "classes")}`)}">${x.fill}%<span class="rhb" aria-hidden="true"><span style="width:${Math.min(100, x.fill)}%"></span></span></button></td>` : `<td class="muted">–</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
        ${ranked.length > 1 ? `<p class="muted" style="font-size:13px;margin:8px 0 0">Busiest: <b>${esc(cellName(ranked[0]))}</b> (${ranked[0].fill}% full). Quietest: <b>${esc(cellName(ranked.at(-1)))}</b> (${ranked.at(-1).fill}% full).</p>` : ""}</div>`;
      body = `<div class="card rsum"><b>${esc(rSummary(t.map(([l, , c]) => [l, c]), days))}</b></div>${zbar}<div class="rtiles">${t.map((x) => tile(...x)).join("")}</div>
        ${zc.held.length ? `<div class="card"><h3>By class</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Class</th><th class="num">Held</th><th class="num">Booked on average</th><th>How full</th><th class="num">No-shows</th></tr></thead><tbody>${byType.map((x) => `<tr class="click" data-rzpick="type:${x.k}" tabindex="0"><td><span class="cellp" style="gap:8px"><span class="sw" style="--t:var(--t-${x.k});display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--t)"></span>${esc(TYPES[x.k].name)}</span></td><td class="num">${x.n}</td><td class="num">${x.avg}</td><td style="min-width:140px"><span class="inline2" style="flex-wrap:nowrap">${meter(x.fill)}<b style="font-size:12.5px">${x.fill}%</b></span></td><td class="num">${x.nsr}%</td></tr>`).join("")}</tbody></table></div></div>
        ${heat}
        <div class="card"><h3>By location</h3><div class="stack">${byLoc.map((x) => `<button type="button" class="rzrow" data-rzpick="loc:${x.k}"><div class="row" style="justify-content:space-between;font-size:13px;gap:8px"><span>${esc(LOCS[x.k] || x.k)} <span class="muted">· ${plural(x.n, "class", "classes")}, ${x.avg} booked on average</span></span><b>${x.fill}%</b></div>${meter(x.fill)}</button>`).join("")}</div></div>
        <div class="adsgrid"><div class="card"><h3>Fullest regular classes</h3>${sl.length ? list(sl.slice(0, 5)) : '<span class="muted">Not enough classes yet.</span>'}</div><div class="card"><h3>Quietest regular classes</h3>${sl.length > 5 ? list(sl.slice(-5).reverse()) : '<span class="muted">Not enough classes yet.</span>'}<span class="hint" style="margin-top:8px;display:block">Quiet ones might suit auto-cancel, a different time, or a promotion.</span></div></div>` : `<div class="card"><p class="muted" style="margin:0">No classes match. Try zooming out a little.</p></div>`}
        <div class="card"><span class="muted" style="font-size:13px">${zc.cancelled ? `${plural(zc.cancelled, "class was", "classes were")} cancelled${zc.auto ? `, ${zc.auto} of them automatically for low bookings` : ""}.` : "No classes were cancelled."}</span></div>`;
    }
    if (tab === "instructors") {
      const who = state.rInstr;
      if (!who) {
        const rows = Object.entries(STAFF).map(([k, n]) => ({ k, n, c: teachStats(cur.classes.filter((x) => x.instr === k)), p: teachStats(prev.classes.filter((x) => x.instr === k)) })).filter((r) => r.c.classes + r.c.appts).sort((a, b) => b.c.classes - a.c.classes);
        body = `<div class="card"><h3>Everyone who teaches</h3><span class="hint">Click someone to see their classes in detail. Covers count for whoever taught. “How full” is for group classes.</span>
          <div class="tblwrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Instructor</th><th class="num">Classes</th><th class="num">Booked per class</th><th>How full</th><th class="num">No-shows</th><th class="num">Covers</th><th class="num">Appointments</th></tr></thead><tbody>${rows.map((r) => { const ch = chg(r.c.fill, r.p.fill, { isPct: true }); return `<tr class="click" data-rinstr="${r.k}" tabindex="0"><td><span class="cellp">${instrAvatar(r.k, "sm")}<b>${esc(r.n)}</b></span></td><td class="num">${r.c.classes}</td><td class="num">${r.c.avg}</td><td style="min-width:160px"><span class="inline2" style="flex-wrap:nowrap">${meter(r.c.fill)}<b style="font-size:12.5px">${r.c.fill}%</b><span class="rchg ${ch.good === null ? "flat" : ch.good ? "good" : "bad"}" style="font-size:11px">${ch.dir === "up" ? "↑" : ch.dir === "down" ? "↓" : "→"} ${esc(ch.text.replace(" points", ""))}</span></span></td><td class="num">${r.c.noShow}%</td><td class="num">${r.c.covers}</td><td class="num">${r.c.appts}</td></tr>`; }).join("")}</tbody></table></div></div>`;
      } else {
        const mine = cur.classes.filter((x) => x.instr === who), before = prev.classes.filter((x) => x.instr === who);
        const c = teachStats(mine), p = teachStats(before);
        const t = [
          ["Classes taught", String(c.classes), chg(c.classes, p.classes), c.covers ? `Including ${c.covers} they covered for someone else.` : "Group classes they taught."],
          ["Booked per class", String(c.avg), chg(c.avg, p.avg), "On average, how many people booked each of their classes."],
          ["How full their classes were", `${c.fill}%`, chg(c.fill, p.fill, { isPct: true }), `About ${Math.round(c.fill / 10)} of every 10 spots were taken.`],
          ["Visits", String(c.visits), chg(c.visits, p.visits), "Times someone was marked as attended in their classes and appointments."],
          ["No-shows", `${c.noShow}%`, chg(c.noShow, p.noShow, { isPct: true, goodUp: false }), `Out of every 100 people booked with them, about ${Math.round(c.noShow)} didn't turn up.`],
          ["Appointments", String(c.appts), chg(c.appts, p.appts), "Private sessions, counted separately."],
        ];
        const byType = Object.entries(liveTypes()).filter(([, ty]) => ty.kind === "class").map(([k, ty]) => { const cs = c.held.filter((x) => x.type === k); return { k, ty, n: cs.length, avg: cs.length ? Math.round((cs.reduce((a, x) => a + x.booked, 0) / cs.length) * 10) / 10 : 0, fill: pctOf(cs.reduce((a, x) => a + x.booked, 0), cs.reduce((a, x) => a + x.cap, 0)) }; }).filter((x) => x.n);
        const sl = slots(c.held);
        const weekly = [];
        for (const { d, x } of cur.days) { const k = ymd(startOfWeek(d)); let w = weekly.find((y) => y.k === k); if (!w) weekly.push((w = { k, label: fmtShortDay(startOfWeek(d)), n: 0, b: 0 })); for (const cl of x.classes) if (cl.instr === who && !cl.cancelled && TYPES[cl.type]?.kind !== "appointment") { w.n++; w.b += cl.booked; } }
        const wk = weekly.filter((w) => w.n).map((w) => ({ ...w, avg: Math.round((w.b / w.n) * 10) / 10 }));
        const maxA = Math.max(1, ...wk.map((w) => w.avg));
        body = `<div class="row" style="gap:8px"><button type="button" class="btn ghost" id="rInstrBack">← All instructors</button><span class="cellp">${instrAvatar(who, "sm")}<b>${esc(STAFF[who])}</b></span></div>
          <div class="card rsum"><b>${esc(rSummary(t.map(([l, , ch]) => [l, ch]), days))}</b></div><div class="rtiles">${t.map((x) => tile(...x)).join("")}</div>
          ${wk.length > 1 && days <= 90 ? `<div class="card"><h3>Booked per class, each week</h3><span class="muted" style="font-size:12.5px">Point at a bar for the week.</span><div class="rbars" role="img" aria-label="Average booked per class each week">${wk.map((w) => `<div class="rbar" data-tipv="${esc(`Week of ${w.label}: ${w.avg} booked per class (${plural(w.n, "class", "classes")})`)}" tabindex="0"><span class="rbf" style="height:${Math.max(2, (w.avg / maxA) * 100)}%"></span><span class="rbl">${esc(w.label)}</span></div>`).join("")}</div><div class="rtip" id="rTip" hidden></div></div>` : ""}
          <div class="adsgrid"><div class="card"><h3>By class</h3>${byType.length ? `<div class="stack">${byType.map((x) => `<div><div class="row" style="justify-content:space-between;font-size:13px;gap:8px"><span>${esc(x.ty.name)} <span class="muted">· ${plural(x.n, "class", "classes")}, ${x.avg} booked on average</span></span><b>${x.fill}%</b></div>${meter(x.fill)}</div>`).join("")}</div>` : '<span class="muted">No group classes in this period.</span>'}</div>
            <div class="card"><h3>Their regular slots</h3>${sl.length ? `<div class="stack">${sl.slice(0, 6).map((x) => `<div><div class="row" style="justify-content:space-between;font-size:13px;gap:8px"><span>${esc(x.label)}</span><b>${x.fill}%</b></div>${meter(x.fill)}</div>`).join("")}</div>` : '<span class="muted">No regular slots yet.</span>'}</div></div>`;
      }
    }
    if (tab === "clients") {
      const kept = Math.min(92, 58 + (hash(`kept${days}`) % 15)), keptPrev = kept - 3;
      const back = Math.min(90, 52 + (hash(`back${days}`) % 18)), backPrev = back + 2;
      const t = [
        ["Clients who came", String(cur.active), chg(cur.active, prev.active), "Different people who came to at least one class."],
        ["New clients", String(cur.newClients), chg(cur.newClients, prev.newClients), "People who joined the studio."],
        ["Clients who kept coming", `${kept}%`, chg(kept, keptPrev, { isPct: true }), "Of the people who came in the period before, the share who came again in this one."],
        ["Came back after their first class", `${back}%`, chg(back, backPrev, { isPct: true }), "First-timers who came to a second class within 30 days."],
      ];
      const atRisk = CLIENTS.map((c, i) => ({ c, i })).filter(({ c, i }) => c.attended >= 8 && !SESSIONS.some((s) => s.roster.some((r) => r.ci === i) && s.start > addDays(NOW, -21))).slice(0, 6);
      const regulars = CLIENTS.map((c, i) => ({ c, n: SESSIONS.filter((s) => s.end <= NOW && s.start >= addDays(NOW, -days) && s.roster.some((r) => r.ci === i && r.att === "present")).length })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 6);
      body = `<div class="card rsum"><b>${esc(rSummary(t.map(([l, , c]) => [l, c]), days))}</b></div><div class="rtiles">${t.map((x) => tile(...x)).join("")}</div>
        <div class="adsgrid"><div class="card"><h3>Regulars you might be losing</h3><span class="hint">People who came often but haven't been for 3 weeks and have nothing booked. A friendly message now often brings them back.</span>
          ${atRisk.length ? `<div class="stack" style="margin-top:8px">${atRisk.map(({ c }) => `<div class="cellp">${avatar(c, "sm")}<span><b>${esc(c.name)}</b><br><span class="muted" style="font-size:12.5px">${plural(c.attended, "class", "classes")} so far</span></span></div>`).join("")}</div><div class="row" style="margin-top:10px"><button type="button" class="btn" id="rWinback">Set up a win-back journey</button></div>` : '<p class="muted">Nobody right now. Nice.</p>'}</div>
          <div class="card"><h3>Most visits</h3>${regulars.length ? `<div class="stack">${regulars.map(({ c, n }) => `<div class="row" style="justify-content:space-between"><span class="cellp">${avatar(c, "sm")}<b>${esc(c.name)}</b></span><span>${plural(n, "visit")}</span></div>`).join("")}</div>` : '<p class="muted">No visits in this period.</p>'}</div></div>`;
    }
    if (tab === "conversion") {
      const { rows, tot } = funnelData(days);
      const cpRow = rows.find((r) => r.src === "classpass") || { leads: 0, bought: 0 };
      const paying = Math.min(88, 41 + (hash(`pay${days}`) % 20)), payingPrev = paying - 4;
      const back = Math.min(90, 52 + (hash(`back${days}`) % 18)), backPrev = back + 2;
      const t = [
        ["New clients who bought a package", `${paying}%`, chg(paying, payingPrev, { isPct: true }), "Of the people who joined, the share who've bought a package."],
        ["First-timers who came back", `${back}%`, chg(back, backPrev, { isPct: true }), "Came to a second class within 30 days of their first."],
        ["Leads who became paying clients", `${pctOf(tot.bought, tot.leads + tot.direct)}%`, null, `${tot.bought} of ${tot.leads + tot.direct} leads (from ads, ClassPass and enquiries) have bought a package.`],
        ["ClassPass clients who became members", `${pctOf(cpRow.bought, cpRow.leads)}%`, null, cpRow.leads ? `${cpRow.bought} of ${cpRow.leads} people who came through ClassPass bought one of your packages.` : "No new ClassPass clients in this period."],
      ];
      const goals = JOURNEYS.filter((j) => j.def.goal && j.status !== "draft");
      body = `<div class="card rsum"><b>${esc(rSummary(t.slice(0, 2).map(([l, , c]) => [l, c]), days))}</b></div><div class="rtiles">${t.map((x) => tile(...x)).join("")}</div>
        <div class="card"><h3>Leads by where they came from</h3><div class="tblwrap"><table class="tbl"><thead><tr><th>Source</th><th class="num">Came in</th><th class="num">Joined</th><th class="num">Bought</th><th class="num">First purchases</th></tr></thead><tbody>${rows.filter((r) => r.leads + r.direct).map((r) => `<tr><td><span class="cellp">${srcDot(r.src)}${esc(SRC[r.src])}</span></td><td class="num">${r.leads + r.direct}</td><td class="num">${r.joined}</td><td class="num">${r.bought}</td><td class="num">${m$c(r.rev)}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="card"><h3>Journeys with a goal</h3>${goals.length ? `<div class="stack">${goals.map((j) => { const r = pctOf(j.stats.converted || 0, j.stats.started); return `<div><div class="row" style="justify-content:space-between;font-size:13px;gap:8px"><span><b>${esc(j.name)}</b> <span class="muted">· goal: ${esc(EVENTS[j.def.goal.event].toLowerCase())}</span></span><b>${r}%</b></div>${meter(r)}<span class="muted" style="font-size:12px">${j.stats.converted || 0} of ${j.stats.started} reached it</span></div>`; }).join("")}</div>` : '<span class="muted">No journeys have a goal yet. Add one in the journey editor to see how well it converts.</span>'}</div>`;
    }
    return head("Reports", "How the studio is doing, in plain numbers. Each one is compared with the period before.") + nav + period + body;
  };
  const fmtShortDay = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  BIND.reports = () => {
    document.querySelectorAll("[data-rtab]").forEach((b) => (b.onclick = () => { state.rTab = b.dataset.rtab; state.rInstr = null; render(); }));
    document.querySelectorAll("[data-rdays]").forEach((b) => (b.onclick = () => { state.rDays = Number(b.dataset.rdays); render(); }));
    if ($("#rTbl")) $("#rTbl").onclick = () => { state.rTable = !state.rTable; render(); };
    const z = state.rZoom;
    if (z && $("#rzType")) {
      $("#rzType").onchange = (e) => { z.type = e.target.value; render(); };
      $("#rzLoc").onchange = (e) => { z.loc = e.target.value; render(); };
      $("#rzIns").onchange = (e) => { z.instr = e.target.value; render(); };
      document.querySelectorAll("[data-rzday]").forEach((b) => (b.onclick = () => { const d = Number(b.dataset.rzday); z.days = z.days.includes(d) ? z.days.filter((x) => x !== d) : [...z.days, d]; render(); }));
      document.querySelectorAll("[data-rzband]").forEach((b) => (b.onclick = () => { z.band = b.dataset.rzband; render(); }));
      document.querySelectorAll("[data-rzcell]").forEach((b) => (b.onclick = () => { const [d, band] = b.dataset.rzcell.split("|"); z.days = [Number(d)]; z.band = band; render(); }));
      document.querySelectorAll("[data-rzpick]").forEach((b) => { const pick = () => { const [k, v] = b.dataset.rzpick.split(":"); z[k] = v; render(); }; b.onclick = pick; b.onkeydown = (e) => { if (e.key === "Enter") pick(); }; });
      if ($("#rzClear")) $("#rzClear").onclick = () => { state.rZoom = { type: "", loc: "", instr: "", days: [], band: "" }; render(); };
    }
    document.querySelectorAll("[data-rinstr]").forEach((r) => { const go2 = () => { state.rInstr = r.dataset.rinstr; render(); window.scrollTo(0, 0); }; r.onclick = go2; r.onkeydown = (e) => { if (e.key === "Enter") go2(); }; });
    if ($("#rInstrBack")) $("#rInstrBack").onclick = () => { state.rInstr = null; render(); };
    if ($("#rWinback")) $("#rWinback").onclick = () => { state.mtab = "journeys"; go("marketing"); };
    const tipEl = $("#rTip");
    if (tipEl) document.querySelectorAll(".rbar").forEach((b) => {
      const show = () => { tipEl.textContent = b.dataset.tipv; tipEl.hidden = false; const r = b.getBoundingClientRect(), p = b.parentElement.getBoundingClientRect(); tipEl.style.left = `${Math.min(p.width - 150, Math.max(0, r.left - p.left + r.width / 2 - 75))}px`; };
      b.onmouseenter = b.onfocus = show;
      b.onmouseleave = b.onblur = () => (tipEl.hidden = true);
    });
  };
