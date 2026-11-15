  // ===========================================================================
  // Feature switches and the grouped menu. Same rules as features.ts in the API:
  // switching a feature off hides it and stops it running; nothing is deleted.
  // Related pages share one menu item with tabs, so the staff menu stays short.
  // ===========================================================================
  const FEATURE_LIST = [
    { key: "marketing", group: "Grow", label: "Marketing emails and journeys", help: "Email campaigns to groups of clients, and automatic journeys such as a welcome series or a nudge for people who haven't been in for a while." },
    { key: "giftCards", group: "Grow", label: "Gift cards", help: "Clients buy gift cards in the app to give or keep. Cards already sold can always be used." },
    { key: "loyalty", group: "Grow", label: "Loyalty points and rewards", help: "Clients earn points for classes and swap them for rewards." },
    { key: "referrals", group: "Grow", label: "Refer a friend", help: "Clients share a link and both sides get a reward when a friend joins." },
    { key: "leads", group: "Grow", label: "Leads", help: "People who aren't paying members yet: ad enquiries, ClassPass clients and walk-ins, with follow-up emails." },
    { key: "reviews", group: "Grow", label: "Reviews", help: "Clients are asked to rate their latest class, and you see the results by class type and instructor." },
    { key: "shop", group: "Run", label: "Shop", help: "Sell drinks, merchandise and other products in the app, picked up at the front desk." },
    { key: "payroll", group: "Run", label: "Payroll", help: "Pay rates for instructors and staff, and what each person is owed for each pay period." },
    { key: "inbox", group: "Run", label: "Communication inbox", help: "Read and answer client WhatsApp messages in the app, alongside your phone." },
    { key: "agents", group: "Run", label: "Agents", help: "Automatic reminders and summaries sent to your staff, such as tomorrow's classes that still need an instructor." },
  ];
  // Gift cards, loyalty, referrals and reviews already had their own switch; those stay the one source of truth.
  STUDIO.featuresOff = new Set();
  function featOn(k) {
    if (k === "giftCards") return !!GC.on;
    if (k === "loyalty") return !!LOY.on;
    if (k === "referrals") return !!REF.on;
    if (k === "reviews") return !!STUDIO.reviewsOn;
    return !(STUDIO.featuresOff && STUDIO.featuresOff.has(k));
  }
  function setFeat(k, on) {
    if (k === "giftCards") GC.on = on;
    else if (k === "loyalty") LOY.on = on;
    else if (k === "referrals") REF.on = on;
    else if (k === "reviews") STUDIO.reviewsOn = on;
    else if (on) STUDIO.featuresOff.delete(k);
    else STUDIO.featuresOff.add(k);
  }
  /** Whether a page is available, given the features that are on (role checks happen in navFor). */
  function navAllowed(id, role) {
    if (!STUDIO.featuresOff) return true; // still starting up
    switch (id) {
      case "leads": return featOn("leads");
      case "payroll": case "my-pay": return featOn("payroll");
      case "reviews": return featOn("reviews");
      case "agents": return featOn("agents");
      case "loyalty": return featOn("loyalty");
      case "refer": return featOn("referrals");
      case "gift-cards": return featOn("giftCards");
      case "comms": return featOn("inbox");
      // Orders and rewards already waiting can always be handed over, even with the feature off.
      case "shop": return featOn("shop") || featOn("giftCards") || (role !== "client" && SHOP_ORDERS.some((o) => o.status === "waiting"));
      case "pickups": return featOn("shop") || featOn("loyalty") || SHOP_ORDERS.some((o) => o.status === "waiting") || LOY_PICKUPS.some((x) => x.status === "waiting");
      default: return true;
    }
  }

  // --- The grouped menu ---------------------------------------------------------
  const HUBS = [
    { id: "comms", label: "Communication", group: "Day to day", icon: "comms", help: "Client messages, and notices for everyone in the app.", tabs: [["comms", "Inbox"], ["announcements", "Announcements"]] },
    { id: "clients", label: "Clients", group: "Clients & sales", icon: "clients", help: "Everyone who books with you, and people who might.", tabs: [["clients", "Clients"], ["leads", "Leads"]] },
    { id: "money", label: "Money", group: "Clients & sales", icon: "sales", help: "Sales, fees to collect, the shop and gift cards.", tabs: [["sales", "Sales"], ["fees", "Fees"], ["shop", "Shop"]] },
    { id: "feedback", label: "Feedback", group: "Growth", icon: "feedback", help: "What clients tell you, and how they rate their classes.", tabs: [["feedback", "Feedback"], ["reviews", "Reviews"]] },
    { id: "staff", label: "Staff and pay", group: "Team", icon: "staff", help: "Your team, their access levels and what each person is paid.", tabs: [["staff", "Staff"], ["payroll", "Payroll"]] },
    { id: "setup", label: "Setup", group: "Setup", icon: "policies", help: "Your classes, locations, rules and which features you use.", tabs: [["class-types", "Class types"], ["templates", "Templates"], ["locations", "Locations and rooms"], ["closures", "Closures and holidays"], ["policies", "Studio rules"], ["features", "Features"]] },
  ];
  const HUB_LAST = {};
  NAV.push({ id: "features", group: "Setup", roles: ["admin"], label: "Features", help: "Switch on what your studio uses. Switching something off hides it; nothing is deleted." });
  NAV_ORDER.find(([g]) => g === "Setup")[1].push("features");
  ICONS.features = '<rect x="3.5" y="4" width="17" height="6" rx="3"/><circle cx="17" cy="7" r="1.6"/><rect x="3.5" y="14" width="17" height="6" rx="3"/><circle cx="7" cy="17" r="1.6"/>';

  /** The hub a page belongs to for this role, if it shows as tabs (two or more visible). */
  function hubFor(page, role = state.role) {
    const hub = HUBS.find((h) => h.tabs.some(([t]) => t === page));
    if (!hub) return null;
    const ids = new Set(navFor(role).filter((n) => !n.hidden).map((n) => n.id));
    const tabs = hub.tabs.filter(([t]) => ids.has(t));
    return tabs.length > 1 && tabs.some(([t]) => t === page) ? { hub, tabs } : null;
  }
  const navLabel = (i) => (typeof i.label === "function" ? i.label(state.role) : i.label);
  const navGrp = (g) => (typeof g === "function" ? g(state.role) : g);

  function renderNav() {
    const role = state.role;
    const items = navFor(role).filter((i) => !i.hidden);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const used = new Set();
    const entries = [];
    for (const i of items) {
      if (used.has(i.id)) continue;
      const h = hubFor(i.id, role);
      if (h) {
        h.tabs.forEach(([t]) => used.add(t));
        const count = h.tabs.reduce((a, [t]) => a + (byId[t].count ? byId[t].count() : 0), 0);
        const last = HUB_LAST[h.hub.id];
        entries.push({ group: h.hub.group, sortId: h.tabs[0][0], id: h.tabs.some(([t]) => t === last) ? last : h.tabs[0][0], label: h.hub.label, help: h.hub.help, icon: h.hub.icon, count, current: h.tabs.some(([t]) => t === state.page) });
      } else {
        used.add(i.id);
        // "Staff & pay" without Payroll is just Staff.
        const label = i.id === "staff" && !navFor(role).some((n) => n.id === "payroll") ? "Staff" : navLabel(i);
        entries.push({ group: navGrp(i.group), id: i.id, label, help: i.help, icon: i.id, count: i.count ? i.count() : 0, current: state.page === i.id });
      }
    }
    const rank = (g) => { const k = NAV_ORDER.findIndex(([n]) => n === g); return k < 0 ? 99 : k; };
    // Within a group, keep the group's own order; items that moved into it (like Feedback) go last.
    const within = (e) => { const ids = NAV_ORDER.find(([n]) => n === e.group)?.[1] || []; const k = ids.indexOf(e.sortId || e.id); return k < 0 ? 999 : k; };
    entries.sort((a, b) => rank(a.group) - rank(b.group) || within(a) - within(b));
    const groups = [...new Set(entries.map((e) => e.group))];
    $("#side").innerHTML = groups.map((g) => `<div class="navgrp"><h3>${g}</h3>${entries.filter((e) => e.group === g).map((e) =>
      `<button type="button" class="navitem" data-nav="${e.id}" ${e.current ? 'aria-current="page"' : ""} data-help="${esc(e.help)}">${icon(e.icon)}<span>${esc(e.label)}</span>${e.count ? `<span class="count" aria-label="${e.count} need attention">${e.count}</span>` : ""}</button>`).join("")}</div>`).join("");
  }

  /** Tabs across the top of a page that shares a menu item with others. */
  function hubTabs() {
    const h = hubFor(state.page);
    if (!h) return "";
    HUB_LAST[h.hub.id] = state.page;
    const byId = Object.fromEntries(navFor(state.role).map((i) => [i.id, i]));
    return `<div class="hubtabs" role="tablist" aria-label="${esc(h.hub.label)}"><span class="hubname">${esc(h.hub.label)}</span>${h.tabs.map(([t, l]) => {
      const n = byId[t].count ? byId[t].count() : 0;
      return `<button type="button" role="tab" data-hubtab="${t}" aria-selected="${t === state.page}">${esc(l)}${n ? `<span class="n">${n}</span>` : ""}</button>`;
    }).join("")}</div>`;
  }
  function bindHubTabs() {
    document.querySelectorAll("[data-hubtab]").forEach((b) => (b.onclick = () => go(b.dataset.hubtab)));
  }

  // --- Pages that hide parts for switched-off features ----------------------------
  // Marketing: emails, journeys, campaigns and segments need Marketing; loyalty, ads and referrals their own.
  const MTABS_ALL = MTABS.slice();
  const MTAB_FEATURE = { journeys: "marketing", emails: "marketing", campaigns: "marketing", segments: "marketing", loyalty: "loyalty", ads: "leads", referrals: "referrals" };
  const pageMarketing = PAGES.marketing;
  PAGES.marketing = function () {
    MTABS.splice(0, MTABS.length, ...MTABS_ALL.filter(([k]) => !MTAB_FEATURE[k] || featOn(MTAB_FEATURE[k])));
    if (!MTABS.some(([k]) => k === (state.mtab || "journeys"))) { state.mtab = MTABS[0][0]; state.jOpen = null; }
    return pageMarketing();
  };

  // --- Setup, Features -------------------------------------------------------------
  const plu = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  /** What switching a feature off affects, in plain words (empty when nothing is running). */
  function featWhatHappens(k) {
    const out = [];
    if (k === "marketing") {
      const live = JOURNEYS.filter((j) => j.status === "live").length, sched = CAMPAIGNS.filter((c) => c.status === "scheduled").length;
      if (live) out.push(`${plu(live, "live journey")} will be paused. When you switch Marketing back on, set ${live === 1 ? "it" : "them"} live again when you're ready.`);
      if (sched) out.push(`${plu(sched, "scheduled campaign")} will go back to ${sched === 1 ? "a draft" : "drafts"} and won't be sent.`);
    } else if (k === "leads") {
      const due = LEADS.filter((l) => l.status === "new" || l.status === "contacted").length;
      if (due) out.push(`${plu(due, "follow-up email")} to leads won't be sent.`);
    } else if (k === "shop") {
      const waiting = SHOP_ORDERS.filter((o) => o.status === "waiting").length;
      if (waiting) out.push(`${plu(waiting, "order")} waiting at the desk can still be handed over.`);
    } else if (k === "loyalty") {
      const waiting = LOY_PICKUPS.filter((x) => x.status === "waiting").length;
      out.push("Clients stop earning points. Their points are kept for when you switch it back on.");
      if (waiting) out.push(`${plu(waiting, "reward")} waiting to be handed over can still be given.`);
    } else if (k === "giftCards") {
      out.push("Gift cards already sold can still be used. Clients just can't buy new ones.");
    } else if (k === "agents") {
      const on = AGENTS.filter((a) => a.enabled).length;
      if (on) out.push(`${plu(on, "agent")} will stop sending reminders and summaries.`);
    } else if (k === "inbox") {
      const unread = CONVOS.filter((c) => c.status === "open" && c.unread > 0).length;
      if (unread) out.push(`${plu(unread, "conversation")} with unread messages will be hidden. Reply from your phone in the meantime.`);
    } else if (k === "payroll") {
      out.push("Pay rates are kept, and instructors stop seeing My pay.");
    } else if (k === "referrals") {
      out.push("Referral links stop giving rewards. Rewards already earned are kept.");
    } else if (k === "reviews") {
      out.push("Clients stop being asked for reviews. Reviews already left are kept.");
    }
    return out;
  }
  function featStopRunning(k) {
    if (k === "marketing") {
      JOURNEYS.forEach((j) => { if (j.status === "live") j.status = "paused"; });
      CAMPAIGNS.forEach((c) => { if (c.status === "scheduled") c.status = "draft"; });
    }
  }
  /** After switching on: what's left to do before clients see it, if anything. */
  function featNext(k) {
    return {
      giftCards: "Gift cards are on. Check the amounts and designs under Money, Shop, Gift cards.",
      loyalty: "Loyalty is on. Check how many points each class earns and add rewards under Marketing, Loyalty.",
      referrals: "Refer a friend is on. Choose the rewards for both sides under Marketing, Referrals.",
      marketing: "Marketing is on. Journeys and campaigns you paused before stay paused; set them going again when you're ready.",
      inbox: "The inbox is on. Connect your WhatsApp number under Communication if you haven't yet.",
      payroll: "Payroll is on. Set each person's pay rate under Staff and pay.",
      shop: "The shop is on. Add your products under Money, Shop.",
    }[k] || `${FEATURE_LIST.find((f) => f.key === k).label} is on.`;
  }
  const staffMenuSize = () => {
    const role = "admin", items = navFor(role).filter((i) => !i.hidden), used = new Set();
    let n = 0;
    for (const i of items) { if (used.has(i.id)) continue; const h = hubFor(i.id, role); (h ? h.tabs.map(([t]) => t) : [i.id]).forEach((t) => used.add(t)); n++; }
    return n;
  };

  PAGES.features = function () {
    const on = FEATURE_LIST.filter((f) => featOn(f.key)).length;
    const card = (g, title) => `<div class="card"><h3>${title}</h3><div class="featlist">${FEATURE_LIST.filter((f) => f.group === g).map((f) =>
      `<div class="featrow"><div><b>${esc(f.label)}</b><p>${esc(f.help)}</p></div>${toggle(`ft-${f.key}`, featOn(f.key), f.label)}</div>`).join("")}</div></div>`;
    return head("Features", "Switch on what your studio uses. Switching something off hides it from the menus and stops it running. Nothing is deleted, so you can switch it back on any time.") +
      `<p class="featsum"><b>${on} of ${FEATURE_LIST.length}</b> switched on · your menu has <b>${staffMenuSize()} items</b></p>` +
      card("Grow", "Growing the studio") + card("Run", "Running the studio");
  };
  BIND.features = function () {
    for (const f of FEATURE_LIST) {
      const el = $(`#ft-${f.key}`);
      if (!el) continue;
      el.onchange = () => {
        const want = el.checked;
        const apply = () => {
          if (!want) featStopRunning(f.key);
          setFeat(f.key, want);
          render();
          toast(want ? featNext(f.key) : `${f.label} is off. Nothing is deleted; switch it back on any time.`);
        };
        const lines = want ? [] : featWhatHappens(f.key);
        if (!lines.length) { apply(); return; }
        confirmFlags([{ level: "confirm", title: "Switch this off?", msg: `Switch off ${f.label}? It's hidden from the menus, and nothing is deleted. ${lines.join(" ")}` }], {
          proceed: apply,
          back: () => { el.checked = true; },
          proceedLabel: "Switch off",
        });
      };
    }
  };
