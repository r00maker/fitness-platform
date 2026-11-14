  // ===========================================================================
  // Loyalty: studio-named points, earned per class or per spend, swapped for rewards.
  // Same rules and wording as the API.
  // ===========================================================================
  const LOY = { on: true, name: "Petal", plural: "Petals", earn: "classes", perClass: 10, perUnit: 1, expiry: "inactivity", months: 12, classpass: false };
  const LOY_IDEAS = [["Point", "Points"], ["Petal", "Petals"], ["Sweat Point", "Sweat Points"], ["Star", "Stars"], ["Rep", "Reps"], ["Zen Coin", "Zen Coins"]];
  const pts = (n) => `${Number(n).toLocaleString("en")} ${Math.abs(n) === 1 ? LOY.name : LOY.plural}`;
  const LOY_KINDS = {
    free_classes: ["Free classes", "Classes added to their account, valid for the days you choose."],
    discount: ["Discount", "A percentage or amount off one purchase."],
    credit: ["Studio credit", "Money to spend on anything in your online store."],
    gift_card: ["Gift card", "A gift card in their Gift cards tab, to give to someone (or keep)."],
    experience: ["Something special", "Anything you hand over in person: a juice, a tote bag, a private session. Your team marks it given."],
  };
  const LOY_EXPIRY = {
    inactivity: ["Expire after a stretch without visits", "All points expire only if a client doesn't come to a class, earn or redeem for the months you choose. Regulars never lose points, and it gives lapsed clients a reason to come back.", true],
    fixed: ["Each point lasts a set time", "Points expire the chosen number of months after they're earned, oldest first. Fair, but even regulars see points disappear.", false],
    never: ["Never expire", "Simplest, but points pile up for people who've stopped coming, and you can't use expiry to bring them back.", false],
  };
  const LOY_REWARDS = [
    { id: "lr1", name: "Free class", kind: "free_classes", cost: 150, reward: { type: "free_classes", classes: 1, validDays: 60 }, desc: "Any group class.", bg: "linear-gradient(135deg,#0c6156,#5fc3a8)", stock: null, active: true },
    { id: "lr2", name: "15% off your next pack", kind: "discount", cost: 200, reward: { type: "discount", percent: 15, validDays: 60 }, desc: "", bg: "linear-gradient(135deg,#1d4ed8,#93c5fd)", stock: null, active: true },
    { id: "lr3", name: "SGD 30 gift card", kind: "gift_card", cost: 400, cents: 3000, desc: "Treat a friend.", bg: "linear-gradient(135deg,#be185d,#f9a8d4)", stock: null, active: true },
    { id: "lr4", name: "Cold-pressed juice", kind: "experience", cost: 80, desc: "Any juice from our fridge, after class.", bg: "linear-gradient(135deg,#a16207,#fde68a)", stock: null, active: true },
    { id: "lr5", name: "Private session with Ana", kind: "experience", cost: 1200, desc: "A 55-minute one-to-one reformer session.", bg: "linear-gradient(135deg,#6d28d9,#c4b5fd)", stock: 3, active: true },
  ];
  let nextLrId = 6;
  const LOY_BAL = { 0: 340, 1: 10, 10: 920, 18: 610 };
  const LOY_HISTORY = { 0: [["Today", "Earned", 10, "Class attended"], ["Mon 9 Nov", "Earned", 10, "Class attended"], ["Sat 7 Nov", "Redeemed", -80, "Cold-pressed juice"], ["Thu 5 Nov", "Earned", 10, "Class attended"], ["Tue 3 Nov", "Earned", 10, "Class attended"]], 1: [["Mon 9 Nov", "Earned", 10, "Class attended"]] };
  const LOY_PICKUPS = [
    { id: "p1", ci: 10, reward: "Cold-pressed juice", code: "R-7KQ2", when: "Today, 9:12am", status: "waiting" },
    { id: "p2", ci: 18, reward: "Private session with Ana", code: "R-M4XD", when: "Yesterday", status: "waiting" },
  ];
  let nextPickupId = 3;
  const lrWhat = (r) => (r.kind === "gift_card" ? `A ${m$c(r.cents)} gift card to give (or keep)` : r.kind === "experience" ? r.desc || "Collect it at the studio" : rewardText(r.reward));
  const loyEarnText = () => (LOY.earn === "classes" ? `Earn ${pts(LOY.perClass)} for every class you attend.` : `Earn ${pts(LOY.perUnit)} for every ${m$c(100)} you spend.`);
  const loyExpiryText = () =>
    LOY.expiry === "never" ? `Your ${LOY.plural} never expire.`
    : LOY.expiry === "inactivity" ? `Your ${LOY.plural} stay as long as you keep coming: they expire only if you don't come to a class, earn or redeem for ${plural(LOY.months, "month")}. We'll remind you first.`
    : `Each ${LOY.name} lasts ${plural(LOY.months, "month")} from when you earn it. The oldest are used first, and we'll remind you before any expire.`;
  const lrCard = (r, body) => `<div class="lrcard ${r.active ? "" : "off"}"><div class="lrtop" style="background:${r.img ? `url('${r.img}') center/cover` : r.bg}"><span class="lrcost">${esc(pts(r.cost))}</span></div><div class="lrbody"><b>${esc(r.name)}</b><span class="muted" style="font-size:12.5px">${esc(lrWhat(r))}</span>${body}</div></div>`;

  // --- Admin: Marketing → Loyalty ---
  function loyaltyAdmin() {
    const waiting = LOY_PICKUPS.filter((x) => x.status === "waiting");
    return `<div class="card"><div class="row" style="justify-content:space-between"><h3>Loyalty programme</h3>${toggle("lyOn", LOY.on, "Run a loyalty programme")}</div>
        <span class="hint">Clients earn points as they come (or spend) and swap them for rewards. Name the points after your studio so they feel like yours.</span>
        <div class="lygrid"><div class="mform">
          <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">One is called<input id="lyName" maxlength="24" value="${esc(LOY.name)}"></label><label class="fl">More than one<input id="lyPlural" maxlength="24" value="${esc(LOY.plural)}"></label></div>
          <div class="fl">Ideas<div class="fbar">${LOY_IDEAS.map(([a, b]) => `<button type="button" class="pickchip" data-lyidea="${esc(a)}|${esc(b)}" aria-pressed="${LOY.name === a}">${esc(b)}</button>`).join("")}</div></div>
        </div>
        <div class="lyexample" aria-label="Example"><span class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700">How clients see it</span><span class="lybal">${esc(pts(340))}</span><span style="font-size:13px">${esc(loyEarnText())}</span><span class="muted" style="font-size:12.5px">“60 more ${esc(LOY.plural)} for a Free class”</span></div></div></div>
      <div class="card mform"><h3>How clients earn</h3>
        <div class="seg" role="group" aria-label="Earn by"><button type="button" data-lyearn="classes" aria-pressed="${LOY.earn === "classes"}">For each class they attend</button><button type="button" data-lyearn="spend" aria-pressed="${LOY.earn === "spend"}">For what they spend</button></div>
        ${LOY.earn === "classes" ? `<label class="inline2 lyinline" style="font-size:13px"><input type="number" id="lyPer" min="1" max="10000" value="${LOY.perClass}" style="width:90px"> ${esc(LOY.plural)} per class attended</label><span class="hint">If attendance is corrected (e.g. to a no-show), the ${esc(LOY.plural)} are taken back.</span>`
          : `<label class="inline2 lyinline" style="font-size:13px"><input type="number" id="lyPer" min="1" max="1000" value="${LOY.perUnit}" style="width:90px"> ${esc(LOY.plural)} for every ${m$c(100)} spent</label><span class="hint">Counts packages and gift cards they pay for. Money refunded takes the ${esc(LOY.plural)} back; studio credit and rewards don't earn.</span>`}
        <label class="check"><input type="checkbox" id="lyCp" ${LOY.classpass ? "checked" : ""}> ClassPass clients earn too <span class="muted">(off by default: they pay ClassPass, not you)</span></label></div>
      <div class="card mform"><h3>When ${esc(LOY.plural)} expire</h3>
        ${Object.entries(LOY_EXPIRY).map(([k, [l, h, rec]]) => `<label class="opt"><input type="radio" name="lyExp" value="${k}" ${LOY.expiry === k ? "checked" : ""}><div><b>${l}</b>${rec ? ' <span class="status done">Recommended</span>' : ""}<br><span class="h">${h}</span></div></label>`).join("")}
        ${LOY.expiry !== "never" ? `<label class="inline2 lyinline" style="font-size:13px">${LOY.expiry === "inactivity" ? "After" : "Each lasts"} <select id="lyMonths">${[3, 6, 9, 12, 18, 24].map((n) => `<option value="${n}" ${LOY.months === n ? "selected" : ""}>${plural(n, "month")}</option>`).join("")}</select>${LOY.expiry === "inactivity" ? " without a visit" : ""}</label>` : ""}
        ${alertBox("info", "", `Clients read: “${esc(loyExpiryText())}”${LOY.expiry !== "never" ? " Everyone gets a reminder two weeks before anything expires." : ""}`)}</div>
      ${waiting.length ? `<div class="card"><h3>To hand over · ${waiting.length}</h3>${pickupRows(waiting)}</div>` : ""}
      <div class="card"><div class="row" style="justify-content:space-between"><h3>Rewards</h3><button type="button" class="btn primary" id="lyAdd">+ Add reward</button></div>
        <div class="lrgrid">${LOY_REWARDS.map((r) => lrCard(r, `<span class="muted" style="font-size:12px">${LOY_KINDS[r.kind][0]}${r.stock !== null ? ` · ${r.stock} left` : ""}${r.active ? "" : " · Hidden"}</span><div class="inline2"><button type="button" class="btn" data-lredit="${r.id}">Edit</button><button type="button" class="btn ghost" data-lrhide="${r.id}">${r.active ? "Hide" : "Show"}</button><button type="button" class="btn ghost danger" data-lrdel="${r.id}">Remove</button></div>`)).join("")}</div></div>`;
  }
  const pickupRows = (list) => `<div class="stack">${list.map((x) => `<div class="row" style="justify-content:space-between"><span class="cellp">${avatar(CLIENTS[x.ci], "sm")}<span><b>${esc(CLIENTS[x.ci].name)}</b> · ${esc(x.reward)}<br><span class="muted" style="font-size:12.5px">Code <b style="letter-spacing:.06em">${esc(x.code)}</b> · ${esc(x.when)}</span></span></span><span class="inline2"><button type="button" class="btn primary" data-pkgiven="${x.id}">Mark given</button><button type="button" class="btn ghost" data-pkcancel="${x.id}">Cancel</button></span></div>`).join("")}</div>`;
  function bindPickups() {
    document.querySelectorAll("[data-pkgiven]").forEach((b) => (b.onclick = () => { const x = LOY_PICKUPS.find((y) => y.id === b.dataset.pkgiven); x.status = "given"; render(); toast(`${x.reward} handed over to ${CLIENTS[x.ci].name.split(" ")[0]}.`); }));
    document.querySelectorAll("[data-pkcancel]").forEach((b) => (b.onclick = () => {
      const x = LOY_PICKUPS.find((y) => y.id === b.dataset.pkcancel);
      const r = LOY_REWARDS.find((y) => y.name === x.reward);
      confirmFlags([{ level: "confirm", title: `Cancel ${x.reward}?`, msg: `${CLIENTS[x.ci].name.split(" ")[0]} gets their ${r ? pts(r.cost) : LOY.plural} back and is told by email and push.` }], { proceedLabel: "Cancel it", proceed: () => { x.status = "cancelled"; if (r) { LOY_BAL[x.ci] = (LOY_BAL[x.ci] || 0) + r.cost; if (r.stock !== null) r.stock++; } render(); toast(`Cancelled. ${LOY.plural} returned.`); } });
    }));
  }
  function bindLoyaltyAdmin() {
    if (!$("#lyOn")) return;
    $("#lyOn").onchange = (e) => { LOY.on = e.target.checked; toast(LOY.on ? `${LOY.plural} are on. Clients see them under Rewards.` : `${LOY.plural} are off. Clients keep what they have.`); };
    $("#lyName").onchange = (e) => { const v = e.target.value.trim(); if (!v) return toast("Give your points a name."); LOY.name = v; LOY.plural = /s$/i.test(v) ? v : `${v}s`; render(); };
    $("#lyPlural").onchange = (e) => { const v = e.target.value.trim(); if (v) LOY.plural = v; render(); };
    document.querySelectorAll("[data-lyidea]").forEach((b) => (b.onclick = () => { [LOY.name, LOY.plural] = b.dataset.lyidea.split("|"); render(); }));
    document.querySelectorAll("[data-lyearn]").forEach((b) => (b.onclick = () => { LOY.earn = b.dataset.lyearn; render(); }));
    $("#lyPer").onchange = (e) => { const v = Math.max(1, Number(e.target.value) || 1); if (LOY.earn === "classes") LOY.perClass = v; else LOY.perUnit = v; render(); };
    $("#lyCp").onchange = (e) => { LOY.classpass = e.target.checked; };
    document.querySelectorAll("input[name=lyExp]").forEach((r) => (r.onchange = () => { LOY.expiry = r.value; render(); }));
    if ($("#lyMonths")) $("#lyMonths").onchange = (e) => { LOY.months = Number(e.target.value); render(); };
    $("#lyAdd").onclick = () => openLoyReward(null);
    document.querySelectorAll("[data-lredit]").forEach((b) => (b.onclick = () => openLoyReward(b.dataset.lredit)));
    document.querySelectorAll("[data-lrhide]").forEach((b) => (b.onclick = () => { const r = LOY_REWARDS.find((x) => x.id === b.dataset.lrhide); r.active = !r.active; render(); }));
    document.querySelectorAll("[data-lrdel]").forEach((b) => (b.onclick = () => { const r = LOY_REWARDS.find((x) => x.id === b.dataset.lrdel); confirmFlags([{ level: "confirm", title: `Remove ${r.name}?`, msg: "Clients won't see it any more. Anything already redeemed is kept." }], { proceedLabel: "Remove reward", proceed: () => { LOY_REWARDS.splice(LOY_REWARDS.indexOf(r), 1); render(); toast("Reward removed."); } }); }));
    bindPickups();
  }
  function openLoyReward(id) {
    const cur = id ? LOY_REWARDS.find((r) => r.id === id) : null;
    const d = cur ? clone(cur) : { name: "", kind: "free_classes", cost: 150, reward: { type: "free_classes", classes: 1, validDays: 60 }, cents: 3000, desc: "", bg: "linear-gradient(135deg,#0c6156,#5fc3a8)", stock: null, active: true };
    const paint = () => {
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="lrForm" role="dialog" aria-modal="true" aria-labelledby="lrTitle" style="width:min(600px,100%)"><header><h2 id="lrTitle">${cur ? "Edit reward" : "New reward"}</h2></header><div class="mb mform">
        <div class="fl">What they get<div class="kindgrid">${Object.entries(LOY_KINDS).map(([k, [l, h]]) => `<label class="opt kindopt"><input type="radio" name="lrK" value="${k}" ${d.kind === k ? "checked" : ""}><div><b>${l}</b><br><span class="h">${h}</span></div></label>`).join("")}</div></div>
        ${d.kind === "gift_card" ? `<label class="fl">Gift card value (${STUDIO.currency})<input type="number" id="lrCents" min="1" value="${d.cents / 100}"></label>` : d.kind === "experience" ? "" : rewardFormFixed(d)}
        <label class="fl">Name<input id="lrName" maxlength="80" value="${esc(d.name)}" placeholder="${d.kind === "experience" ? "e.g. Studio tote bag" : d.kind === "gift_card" ? `e.g. ${m$c(d.cents)} gift card` : "e.g. Free class"}"></label>
        <label class="fl">${d.kind === "experience" ? "What it is" : "Description"} <span class="h">${d.kind === "experience" ? "(clients read this before redeeming)" : "(optional)"}</span><input id="lrDesc" maxlength="300" value="${esc(d.desc)}" placeholder="${d.kind === "experience" ? "e.g. Our canvas tote, while stocks last." : ""}"></label>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Costs (${esc(LOY.plural)})<input type="number" id="lrCost" min="1" value="${d.cost}"><span class="h" id="lrWorth"></span></label>
          <label class="fl">How many available <span class="h">(blank = no limit)</span><input type="number" id="lrStock" min="0" value="${d.stock ?? ""}" placeholder="No limit"></label></div>
        <div class="row"><label class="btn" style="cursor:pointer">${d.img ? "Change photo" : "Add a photo"}<input type="file" id="lrImg" accept="image/jpeg,image/png,image/webp" hidden></label><span class="hint">Optional. Otherwise a colour block is used.</span></div>
        <div class="fl">Preview<div style="max-width:260px" id="lrPreview"></div></div>
      </div><footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">${cur ? "Save" : "Add reward"}</button></footer></form></div>`;
      const keep = () => {
        d.name = $("#lrName").value; d.desc = $("#lrDesc").value; d.cost = Math.max(1, Number($("#lrCost").value) || 1);
        d.stock = $("#lrStock").value === "" ? null : Math.max(0, Number($("#lrStock").value));
        if ($("#lrCents")) d.cents = Math.max(100, Math.round(Number($("#lrCents").value) * 100));
        if ($("#lrfCls") || $("#lrfOff") || $("#lrfAmt")) d.reward = readRewardFixed(d);
      };
      // Typing updates the preview in place, so a click on Save is never swallowed by a redraw.
      const refresh = () => {
        keep();
        $("#lrWorth").textContent = LOY.earn === "classes" ? `About ${Math.max(1, Math.round(d.cost / LOY.perClass))} classes' worth.` : `About ${m$c(Math.round((d.cost / LOY.perUnit) * 100))} of spending.`;
        $("#lrPreview").innerHTML = lrCard({ ...d, name: d.name || "Your reward" }, "");
      };
      refresh();
      ["#lrName", "#lrDesc", "#lrCost", "#lrStock", "#lrCents", "#lrfCls", "#lrfOff", "#lrfAmt", "#lrfDays"].forEach((sel) => { if ($(sel)) $(sel).oninput = refresh; });
      if ($("#lrfKind")) $("#lrfKind").onchange = refresh;
      document.querySelectorAll("input[name=lrK]").forEach((r) => (r.onchange = () => { keep(); d.kind = r.value; if (["free_classes", "discount", "credit"].includes(d.kind) && d.reward?.type !== d.kind) d.reward = { free_classes: { type: "free_classes", classes: 1, validDays: 60 }, discount: { type: "discount", percent: 10, validDays: 60 }, credit: { type: "credit", amountCents: 2000, validDays: 90 } }[d.kind]; paint(); }));
      $("#lrImg").onchange = (e) => { keep(); readImage(e.target, (url) => { d.img = url; paint(); }); };
      $("#lrForm").onsubmit = (e) => {
        e.preventDefault(); keep();
        if (!d.name.trim()) { $("#lrName").focus(); return toast("Give the reward a name."); }
        if (d.kind === "experience" && !d.desc.trim()) { $("#lrDesc").focus(); return toast("Say what it is, so clients know what they're getting."); }
        if (cur) Object.assign(cur, d); else LOY_REWARDS.push({ ...d, id: `lr${nextLrId++}` });
        LOY_REWARDS.sort((a, b) => a.cost - b.cost);
        closeModal(); render(); toast(cur ? "Reward saved." : `${d.name.trim()} added for ${pts(d.cost)}.`);
      };
    };
    paint();
  }
  const rewardFormFixed = (d) => d.kind === "free_classes"
    ? `<div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Classes<input type="number" id="lrfCls" min="1" max="50" value="${d.reward.classes}"></label><label class="fl">Valid for (days)<input type="number" id="lrfDays" min="1" value="${d.reward.validDays}"></label></div>`
    : d.kind === "discount"
      ? `<div class="two" style="grid-template-columns:110px 1fr 1fr"><label class="fl">Off<select id="lrfKind"><option value="pct" ${d.reward.percent ? "selected" : ""}>%</option><option value="amt" ${!d.reward.percent ? "selected" : ""}>${STUDIO.currency}</option></select></label><label class="fl">&nbsp;<input type="number" id="lrfOff" min="1" value="${d.reward.percent || (d.reward.amountCents || 1000) / 100}"></label><label class="fl">Use within (days)<input type="number" id="lrfDays" min="1" value="${d.reward.validDays}"></label></div>`
      : `<div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Credit (${STUDIO.currency})<input type="number" id="lrfAmt" min="1" value="${(d.reward.amountCents || 2000) / 100}"></label><label class="fl">Valid for (days)<input type="number" id="lrfDays" min="1" value="${d.reward.validDays}"></label></div>`;
  function readRewardFixed(d) {
    const days = Math.max(1, Number($("#lrfDays").value) || 30);
    if (d.kind === "free_classes") return { type: "free_classes", classes: Math.max(1, Number($("#lrfCls").value) || 1), validDays: days };
    if (d.kind === "credit") return { type: "credit", amountCents: Math.max(100, Math.round(Number($("#lrfAmt").value) * 100)), validDays: days };
    const pct = $("#lrfKind").value === "pct";
    const v = Math.max(1, Number($("#lrfOff").value) || 10);
    return { type: "discount", ...(pct ? { percent: Math.min(100, v) } : { amountCents: v * 100 }), validDays: days };
  }

  // --- Front desk: rewards to hand over ---
  PAGES.pickups = function () {
    const waiting = LOY_PICKUPS.filter((x) => x.status === "waiting");
    return head("Reward pickups", `Clients redeemed these with their ${LOY.plural}. Check the code they show you, hand it over, then mark it given.`) +
      `<div class="card">${waiting.length ? pickupRows(waiting) : '<span class="muted">Nothing waiting to be handed over.</span>'}</div>`;
  };
  BIND.pickups = bindPickups;

  // --- Client: Rewards ---
  PAGES.loyalty = function () {
    const me = ME.client;
    const c = CLIENTS[me];
    if (!LOY.on) return head("Rewards", "") + alertBox("info", "", "The studio isn't running its rewards programme right now.");
    if (c.source === "classpass" && !LOY.classpass) return head("Rewards", "") + alertBox("info", `${LOY.plural} are for studio members`, `You book through ClassPass, so ${LOY.plural} don't apply. Become a studio member to start earning.`);
    const bal = LOY_BAL[me] || 0;
    const next = LOY_REWARDS.filter((r) => r.active && r.cost > bal).sort((a, b) => a.cost - b.cost)[0];
    const waiting = LOY_PICKUPS.filter((x) => x.ci === me && x.status === "waiting");
    const hist = LOY_HISTORY[me] || [];
    const withYear = (d) => d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
    const expiry = LOY.expiry === "never" || !bal ? "" : LOY.expiry === "inactivity" ? `They stay while you keep coming. If you don't visit before ${withYear(new Date(NOW.getFullYear(), NOW.getMonth() + LOY.months, NOW.getDate()))}, they expire.` : `${pts(Math.min(bal, 60))} expire on ${withYear(addDays(NOW, 40))}. The oldest are used first.`;
    return head("Rewards", `Earn ${LOY.plural} as you come, then swap them for rewards.`) +
      `<div class="card lyhero"><span class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:700">You have</span><span class="lybal big">${esc(pts(bal))}</span>
        ${next ? `<div class="meterbar"><span style="width:${Math.round((bal / next.cost) * 100)}%"></span></div><span style="font-size:13px">${esc(pts(next.cost - bal))} more for <b>${esc(next.name)}</b></span>` : bal ? '<span style="font-size:13px">You can redeem any reward below.</span>' : ""}
        ${expiry ? `<span class="muted" style="font-size:12.5px">${esc(expiry)}</span>` : ""}</div>
      ${waiting.length ? `<div class="card"><h3>Ready to collect</h3>${waiting.map((x) => `<div class="row" style="justify-content:space-between"><span><b>${esc(x.reward)}</b><br><span class="muted" style="font-size:12.5px">Show this code at the front desk</span></span><span class="pickcode">${esc(x.code)}</span></div>`).join("")}</div>` : ""}
      <div class="steps3"><div>${esc(loyEarnText())}</div><div>Choose a reward below and tap <b>Redeem</b>. Most are added to your account straight away; for in-person rewards, show the code at the front desk.</div><div>${esc(loyExpiryText())}</div></div>
      <h2 style="margin:6px 0 0;font-size:18px">Rewards</h2>
      <div class="lrgrid">${LOY_REWARDS.filter((r) => r.active).map((r) => { const sold = r.stock !== null && r.stock <= 0; const can = !sold && bal >= r.cost; return lrCard(r, `${r.stock !== null && !sold && r.stock <= 5 ? `<span class="muted" style="font-size:12px">Only ${r.stock} left</span>` : ""}${can ? `<button type="button" class="btn primary" data-lyredeem="${r.id}" style="justify-content:center">Redeem</button>` : `<div class="meterbar" aria-hidden="true"><span style="width:${sold ? 0 : Math.round((bal / r.cost) * 100)}%"></span></div><span class="muted" style="font-size:12.5px">${sold ? "All claimed for now" : `${esc(pts(r.cost - bal))} to go`}</span>`}`); }).join("")}</div>
      <div class="card"><h3>History</h3>${hist.length ? `<div class="stack" style="gap:6px">${hist.map(([when, what, n, note]) => `<div class="lyhist"><span><b>${esc(what)}</b> <span class="muted">· ${esc(note)} · ${esc(when)}</span></span><b style="color:${n > 0 ? "var(--ok)" : "var(--fg)"}">${n > 0 ? "+" : "−"}${esc(pts(Math.abs(n)))}</b></div>`).join("")}</div>` : `<span class="muted">Nothing yet. ${esc(loyEarnText())}</span>`}</div>`;
  };
  BIND.loyalty = function () {
    const me = ME.client;
    document.querySelectorAll("[data-lyredeem]").forEach((b) => (b.onclick = () => {
      const r = LOY_REWARDS.find((x) => x.id === b.dataset.lyredeem);
      const bal = LOY_BAL[me] || 0;
      confirmFlags([{ level: "confirm", title: `Redeem ${r.name}?`, msg: `It uses ${pts(r.cost)}. You'll have ${pts(bal - r.cost)} left. ${r.kind === "experience" ? "You'll get a code to show at the front desk." : r.kind === "gift_card" ? "The gift card goes into your Gift cards tab, ready to give." : "It's added to your account straight away."}` }], {
        proceedLabel: `Use ${pts(r.cost)}`,
        proceed: () => {
          LOY_BAL[me] = bal - r.cost;
          if (r.stock !== null) r.stock--;
          (LOY_HISTORY[me] = LOY_HISTORY[me] || []).unshift(["Just now", "Redeemed", -r.cost, r.name]);
          if (r.kind === "experience") {
            const code = `R-${"ABCDEFGHJKMNPQRSTUVWXYZ23456789".split("").sort(() => Math.random() - 0.5).slice(0, 4).join("")}`;
            LOY_PICKUPS.push({ id: `p${nextPickupId++}`, ci: me, reward: r.name, code, when: "Just now", status: "waiting" });
            render();
            $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-labelledby="pcTitle"><header><h2 id="pcTitle">Show this at the front desk</h2></header><div class="mb" style="align-items:center;text-align:center"><span class="pickcode" style="font-size:30px;padding:10px 18px">${code}</span><span>${esc(r.name)}</span><span class="hint">It's also saved under “Ready to collect”.</span></div><footer><button type="button" class="btn primary" data-mclose>Done</button></footer></div></div>`;
          } else {
            if (r.kind === "gift_card") CARDS.push({ id: `gc${nextCardId++}`, code: `GIFT-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, amount: r.cents, design: GC.designs.find((x) => x.on).id, buyer: me, to: null, status: "unsent", daysLeft: GC.giveWithin });
            if (r.kind === "credit") GIFT_CREDIT[me] = (GIFT_CREDIT[me] || 0) + r.reward.amountCents;
            render();
            toast(r.kind === "gift_card" ? `Done! Your ${m$c(r.cents)} gift card is in your Gift cards tab, ready to give.` : `Done! You've got ${rewardText(r.reward)}.`);
          }
        },
      });
    }));
  };
