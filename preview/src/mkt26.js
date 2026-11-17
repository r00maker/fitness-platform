  // ===========================================================================
  // Online payments (Stripe Connect), the same rules as apps/api/src/modules/payments:
  //  - Setup, Payments: connect Stripe (the studio's own account; money goes straight to it),
  //    where it is with Stripe, how clients pay, passing the fee on (cards and GrabPay only,
  //    never PayNow), and recent online payments.
  //  - Checkout: choose how to pay, with any fee shown before paying. A stand-in for Stripe's
  //    page opens; paying completes the order the same way a desk payment does.
  //  - My packages: the card kept for membership renewals (replace or remove).
  // ===========================================================================
  {
    const PAY = (STUDIO.pay ||= { status: location.hash === "#payments-ready" ? "ready" : "not_connected", payouts: false, online: true, desk: true, passOn: false, cardBps: 340, cardFixed: 50, grabBps: 330, recent: [] });
    const CARD = (STUDIO.payCard ||= { brand: "Visa", last4: "4242", exp: "08/28" });
    /** (price + fixed) / (1 − rate), rounded up, minus the price: the studio still gets the full price. */
    const passedOn = (amt, bps, fixed) => (amt <= 0 || (bps <= 0 && fixed <= 0) ? 0 : Math.ceil((amt + fixed) / (1 - bps / 10000)) - amt);
    const ready = () => PAY.status === "ready" && PAY.online;
    const feeFor = (m, amt) => (!PAY.passOn || m === "paynow" ? 0 : m === "card" ? passedOn(amt, PAY.cardBps, PAY.cardFixed) : passedOn(amt, PAY.grabBps, 0));
    const pct = (bps) => `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
    const LBL = { online: "Pay online", card: "Card, Apple Pay or Google Pay", paynow: "PayNow", grabpay: "GrabPay", desk: "Pay at the studio" };
    /** The ways a client can pay this amount (the same list GET /checkout/quote gives). */
    function payOptions(amt, recurring) {
      const out = [];
      if (amt > 0 && ready()) {
        if (PAY.passOn) for (const k of ["card", ...(recurring || STUDIO.currency !== "SGD" ? [] : ["paynow", "grabpay"])]) out.push({ k, fee: feeFor(k, amt) });
        else out.push({ k: recurring ? "card" : "online", fee: 0 });
      }
      if (amt > 0 && (PAY.desk || !ready())) out.push({ k: "desk", fee: 0 });
      return out;
    }
    const STEPS = [["not_connected", "Connect Stripe"], ["pending", "Stripe checks your details"], ["ready", "Take payments"]];
    const STATUS_TEXT = {
      not_connected: "Connect Stripe to take cards, PayNow and GrabPay. Money goes straight to your own Stripe account, and you can see every payment in Stripe too.",
      needs_details: "Stripe needs a few more details (2 to go) before you can take payments.",
      pending: "Stripe is checking your details. This usually takes a few minutes, sometimes a day or two. We'll tell you when it's done.",
      ready: "Ready: clients can pay online.",
    };
    const stepAt = () => (PAY.status === "ready" ? 2 : PAY.status === "not_connected" ? 0 : 1);

    // --- Setup, Payments ---------------------------------------------------------------------
    NAV.push({ id: "payments", group: "Setup", roles: ["admin"], label: "Payments", help: "Take cards, PayNow and GrabPay online through your own Stripe account, and choose how clients pay." });
    NAV_ORDER.find(([g]) => g === "Setup")[1].push("payments");
    { const t = HUBS.find((h) => h.id === "setup")?.tabs; if (t) t.splice(t.findIndex((x) => x[0] === "studio-details") + 1, 0, ["payments", "Payments"]); }
    ICONS.payments = '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>';

    PAGES.payments = function () {
      const at = stepAt();
      const ex = 3000, m = (c) => m$(c);
      const steps = `<ol class="paysteps">${STEPS.map(([, l], i) => `<li class="${i < at ? "done" : i === at ? "now" : ""}"><span>${i < at ? "✓" : i + 1}</span>${l}</li>`).join("")}</ol>`;
      const action = {
        not_connected: `<button type="button" class="btn primary" id="payConnect" data-help="Only the owner can connect Stripe, as the account is in the business's name.">Connect Stripe</button>`,
        needs_details: `<button type="button" class="btn primary" id="payConnect">Continue on Stripe</button>`,
        pending: `<button type="button" class="btn" id="payCheck">Check again</button>`,
        ready: `<button type="button" class="btn" id="payDash">Open your Stripe dashboard</button>${PAY.payouts ? "" : `<span class="hint">Add your bank account in Stripe to receive payouts.</span>`}`,
      }[PAY.status];
      const tg = (id, on, title, hint, dis = "") => `<div class="payrow ${dis ? "off" : ""}"><div><b>${title}</b><span>${hint}</span></div>${toggle(id, on, title)}</div>`;
      const recent = PAY.recent.length
        ? `<table class="tbl"><thead><tr><th>Client</th><th>For</th><th>Paid with</th><th class="num">Amount</th><th>When</th></tr></thead><tbody>${PAY.recent.map((r) => `<tr><td>${esc(r.client)}</td><td>${esc(r.what)}</td><td>${esc(r.method)}</td><td class="num">${m(r.amount)}${r.fee ? `<br><span class="muted" style="font-size:12px">incl. ${m(r.fee)} fee</span>` : ""}</td><td>${esc(r.at)}</td></tr>`).join("")}</tbody></table>`
        : `<span class="muted">No online payments yet. They'll show here, and in your Stripe dashboard.</span>`;
      return head("Payments", "Take cards, PayNow and GrabPay online. Money goes straight to your own Stripe account; the studio is the seller, and Stripe's fees are paid from each payment.") +
        `<div class="stack" style="gap:16px;max-width:820px">
          <div class="card stack paystatus" style="gap:12px">${steps}<p style="margin:0">${STATUS_TEXT[PAY.status]}</p><div class="row" style="gap:8px;flex-wrap:wrap">${action}</div></div>
          <div class="card stack" style="gap:4px"><h3>How clients pay</h3>
            ${tg("payOnline", PAY.online, "Online payments", PAY.status === "ready" ? "Clients can pay online when they buy packages, gift cards and shop items, and memberships renew on the card they used." : "Switches on once Stripe has checked your details.", PAY.status === "ready" ? "" : "off")}
            ${tg("payDesk", PAY.desk, "Paying at the studio", "Clients can still choose to pay at the front desk. Staff mark it paid, as now.")}
            ${tg("payPass", PAY.passOn, "Pass the fee on to clients", "Add Stripe's fee for cards and GrabPay, shown as its own line before they pay. Never for PayNow: the banks' PayNow rules don't allow it.")}
            ${PAY.passOn ? `<div class="payfees">
              <label class="fl">Card fee<span class="inline2"><input id="payCardPct" type="number" min="0" max="10" step="0.01" value="${PAY.cardBps / 100}" aria-label="Card fee percent"> % + ${esc(STUDIO.currency)}<input id="payCardFix" type="number" min="0" max="5" step="0.01" value="${PAY.cardFixed / 100}" aria-label="Card fee fixed"></span></label>
              <label class="fl">GrabPay fee<span class="inline2"><input id="payGrabPct" type="number" min="0" max="10" step="0.01" value="${PAY.grabBps / 100}" aria-label="GrabPay fee percent"> %</span></label>
              <div class="payex"><b>On a ${m(ex)} package</b><span>Card: +${m(feeFor("card", ex))} (they pay ${m(ex + feeFor("card", ex))})</span><span>GrabPay: +${m(feeFor("grabpay", ex))}</span><span>PayNow: no fee</span></div>
              <span class="hint">Set these to the rates on your Stripe account (Stripe's standard Singapore rates are filled in). Card networks and your Stripe agreement have their own rules on card surcharges: check them before switching this on.</span></div>` : ""}
            <span class="hint" style="margin-top:8px">Which methods clients see (cards, Apple Pay, Google Pay, PayNow, GrabPay and others) is set in your Stripe dashboard, under Settings, Payment methods.</span>
          </div>
          <div class="card stack" style="gap:8px"><h3>Recent online payments</h3>${recent}<span class="hint">Refunds are made from the sale (Sales): ones back to how they paid go through Stripe. Disputes are answered in your Stripe dashboard; we'll tell you when one comes in.</span></div>
        </div>`;
    };

    function standIn(title, body, actions) {
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal stripestand" role="dialog" aria-modal="true" aria-labelledby="ssT" style="width:min(460px,100%)"><header><h2 id="ssT">${title}</h2></header><div class="mb stack" style="gap:10px"><span class="ssnote">Preview: in the app, Stripe's own secure page opens here.</span>${body}</div><footer>${actions}</footer></div></div>`;
    }
    BIND.payments = function () {
      if ($("#payConnect")) $("#payConnect").onclick = () => {
        standIn("Set up payments with Stripe", `<p style="margin:0">Stripe asks for the business's details (registered name, UEN, address), the owner's details and the bank account for payouts. It takes about 10 minutes.</p>`,
          `<button type="button" class="btn ghost" id="ssLater">Leave it for later</button><button type="button" class="btn primary" id="ssDone">Finish on Stripe</button>`);
        $("#ssLater").onclick = () => { PAY.status = "needs_details"; closeModal(); render(); toast("Saved. You can carry on with Stripe any time."); };
        $("#ssDone").onclick = () => { PAY.status = "pending"; closeModal(); render(); toast("Thanks. Stripe is checking your details."); };
      };
      if ($("#payCheck")) $("#payCheck").onclick = () => { PAY.status = "ready"; render(); toast("Stripe has checked your details: clients can now pay online."); };
      if ($("#payDash")) $("#payDash").onclick = () => toast("In the app, this opens dashboard.stripe.com in a new tab.");
      const set = () => {
        const online = $("#payOnline").checked, desk = $("#payDesk").checked;
        // Refused: show the switches as they really are again.
        if (!online && !desk) { render(); return toast("Clients need a way to pay: keep paying online or paying at the studio switched on."); }
        if (!desk && !(PAY.status === "ready" && online)) { render(); return toast("Online payments aren't ready yet, so clients still need to be able to pay at the studio."); }
        PAY.online = online; PAY.desk = desk; render();
      };
      if (PAY.status !== "ready") $("#payOnline").disabled = true;
      $("#payOnline").onchange = set; $("#payDesk").onchange = set;
      $("#payPass").onchange = (e) => {
        if (!e.target.checked) { PAY.passOn = false; return render(); }
        e.target.checked = false;
        confirmFlags([{ level: "confirm", title: "Pass the fee on to clients?", msg: "Clients paying by card or GrabPay will see the fee as a separate line before they pay (never for PayNow). Card networks and your Stripe agreement have their own rules on card surcharges: check they allow it for your business." }], { proceedLabel: "Pass it on", proceed: () => { PAY.passOn = true; render(); toast("The fee is shown to clients before they pay."); } });
      };
      const num = (id, max) => Math.max(0, Math.min(max, Math.round(Number($(id)?.value || 0) * 100)));
      ["#payCardPct", "#payCardFix", "#payGrabPct"].forEach((id) => { if ($(id)) $(id).onchange = () => { PAY.cardBps = num("#payCardPct", 1000); PAY.cardFixed = num("#payCardFix", 500); PAY.grabBps = num("#payGrabPct", 1000); render(); }; });
    };

    // --- Checkout: choose how to pay ------------------------------------------------------------
    const pageCheckout = PAGES.checkout;
    let paying = false;
    PAGES.checkout = function () {
      let out = pageCheckout.call(this);
      const pl = PLANS.find((x) => x.id === state.buy) || PLANS[0];
      const recurring = pl.billing === "recurring";
      if (state.ordered) {
        const od = ORDERS.find((o) => o.id === state.ordered);
        if (od?.online) return out.replace(/<div class="alert ok">[\s\S]*?<\/div><\/div>/, alertBox("ok", `${esc(pl.name)} is on your account`, `Paid with ${esc(od.online.method)}. Your receipt is in Receipts and invoices, and you can book straight away.${recurring ? " Your card is kept securely by Stripe for the renewals." : ""}`)).replace(/<dt>Paid<\/dt><dd>[^<]*<\/dd>/, `<dt>Paid</dt><dd>${m$(od.due + od.online.fee)}</dd>${od.online.fee ? `<dt>Includes</dt><dd>${m$(od.online.fee)} ${od.online.k === "grabpay" ? "GrabPay" : "card"} fee</dd>` : ""}`);
        if (od?.status === "pending" && ready()) {
          return out.replace("Pay at the front desk and your package will be ready straight away. Online payment is coming soon.", "Your order is saved. Pay online now, or at the front desk; your package is ready as soon as it's paid.")
            .replace('<div class="actions"><button type="button" class="btn primary" data-nav="my-packages">', `<div class="actions"><button type="button" class="btn primary" data-paynow="${od.id}">Pay now</button><button type="button" class="btn" data-nav="my-packages">`);
        }
        return out;
      }
      const pr = checkoutPrice(ME.client, pl);
      const opts = payOptions(pr.due, recurring);
      if (!opts.some((o) => o.k !== "desk")) return out;
      if (!opts.some((o) => o.k === state.coPay)) state.coPay = opts[0].k;
      const sel = opts.find((o) => o.k === state.coPay);
      const box = `<div class="paybox"><b>Pay with</b>${opts.map((o) => `<label class="payopt ${o.k === state.coPay ? "on" : ""}" for="coPay_${o.k}"><input type="radio" name="coPay" id="coPay_${o.k}" value="${o.k}" ${o.k === state.coPay ? "checked" : ""}><span><b>${LBL[o.k]}</b><span>${o.k === "desk" ? "Order now, pay at the front desk" : o.fee ? `+${m$(o.fee)} ${o.k === "card" ? "card" : "GrabPay"} fee` : o.k === "paynow" && PAY.passOn ? "No fee" : recurring ? "Kept securely by Stripe for the renewals" : "Card, PayNow, GrabPay and more"}</span></span><em>${m$(pr.due + o.fee)}</em></label>`).join("")}
        <span class="lockbadge">🔒 Paid securely through Stripe. The studio never sees your card number.</span></div>`;
      out = out.replace(/<div class="paybox">[\s\S]*?<\/div>/, box);
      if (sel.fee) out = out.replace('<div class="totalrow">', `<div class="row" style="justify-content:space-between"><span>${sel.k === "card" ? "Card fee" : "GrabPay fee"}</span><span>+${m$(sel.fee)}</span></div><div class="totalrow">`).replace(/(<div class="totalrow"><span>[^<]*<\/span><span>)[^<]*(<\/span>)/, `$1${m$(pr.due + sel.fee)}$2`);
      return out.replace(/(data-order="place" style="justify-content:center">)[^<]*</, `$1${sel.k === "desk" ? `Place order · ${m$(pr.due)}` : `Continue to payment · ${m$(pr.due + sel.fee)}`}<`);
    };
    const bindCheckout = BIND.checkout;
    BIND.checkout = function () {
      bindCheckout?.call(this);
      document.querySelectorAll('input[name="coPay"]').forEach((r) => (r.onchange = () => { state.coPay = r.value; render(); }));
    };
    const METHOD_NAME = { online: "Visa ending 4242", card: "Visa ending 4242", paynow: "PayNow", grabpay: "GrabPay" };
    function payOnline(od, k) {
      const pl = PLANS.find((x) => x.id === od.plan), fee = feeFor(k === "online" ? "card" : k, od.due);
      const recurring = pl.billing === "recurring";
      standIn(`Pay ${esc(document.querySelector(".brand h1, header h1")?.textContent || "the studio")}`, `<dl class="summary"><dt>${esc(pl.name)}</dt><dd>${m$(od.due)}</dd>${fee ? `<dt>${k === "grabpay" ? "GrabPay" : "Card"} fee</dt><dd>${m$(fee)}</dd>` : ""}<dt><b>Total</b></dt><dd><b>${m$(od.due + fee)}</b></dd></dl>
        <span class="hint">${k === "paynow" ? "Scan the PayNow QR code with your banking app." : k === "grabpay" ? "You'll confirm in the Grab app." : "Card, Apple Pay or Google Pay."}${recurring ? " Your card is saved for the renewals." : ""}</span>`,
        `<button type="button" class="btn ghost" data-mclose>Back</button><button type="button" class="btn primary" id="ssPay">Pay ${m$(od.due + fee)}</button>`);
      $("#ssPay").onclick = () => {
        closeModal();
        const b = document.createElement("button"); b.type = "button"; b.hidden = true; b.dataset.order = `paid:${od.id}`; document.body.append(b); b.click(); b.remove();
        od.online = { k, fee, method: METHOD_NAME[k] };
        PAY.recent.unshift({ client: CLIENTS[od.ci].name, what: pl.name, method: METHOD_NAME[k], amount: od.due + fee, fee, at: "Just now" });
        if (recurring && k !== "paynow") Object.assign(CARD, { brand: "Visa", last4: "4242", exp: "08/28" });
        render(); toast(`Paid ${m$(od.due + fee)}. ${pl.name} is on your account.`);
      };
    }
    document.addEventListener("click", (e) => {
      const place = e.target.closest('[data-order="place"]');
      if (place && !paying && state.page === "checkout" && ready()) {
        const pl = PLANS.find((x) => x.id === state.buy) || PLANS[0];
        const pr = checkoutPrice(ME.client, pl);
        const k = state.coPay;
        if (pr.due > 0 && k && k !== "desk") {
          e.stopImmediatePropagation(); e.preventDefault();
          // The order is made first (as in the app), then Stripe's page opens for it. (A click
          // can't start another click on the same button while it's running, hence the wait.)
          setTimeout(() => {
            paying = true; place.click(); paying = false;
            $("#toastRoot").innerHTML = ""; // not "pay at the front desk": they're paying now
            const od = ORDERS.find((o) => o.id === state.ordered);
            if (od?.status === "pending") payOnline(od, k);
          });
        }
        return;
      }
      const pn = e.target.closest("[data-paynow]");
      if (pn) {
        const od = ORDERS.find((o) => o.id === Number(pn.dataset.paynow));
        const pl = PLANS.find((x) => x.id === od.plan);
        const opts = payOptions(od.due, pl.billing === "recurring").filter((o) => o.k !== "desk");
        if (opts.length === 1) return payOnline(od, opts[0].k);
        standIn("How would you like to pay?", opts.map((o) => `<button type="button" class="btn" data-ssk="${o.k}" style="justify-content:space-between">${LBL[o.k]}<span>${m$(od.due + o.fee)}</span></button>`).join(""), `<button type="button" class="btn ghost" data-mclose>Back</button>`);
        document.querySelectorAll("[data-ssk]").forEach((b) => (b.onclick = () => payOnline(od, b.dataset.ssk)));
      }
    }, true);

    // --- My packages: the card for membership renewals ------------------------------------------
    const pageMine = PAGES["my-packages"], bindMine = BIND["my-packages"];
    const hasMembership = () => myPkgs(ME.client).some((pk) => PLANS.find((p) => p.id === pk.plan)?.billing === "recurring" && pk.owner === ME.client && !pk.cancelled);
    PAGES["my-packages"] = function () {
      const out = pageMine.call(this);
      if (PAY.status !== "ready" || !hasMembership()) return out;
      const card = CARD.last4 ? `<b>${esc(CARD.brand)} ending ${esc(CARD.last4)}</b><span class="muted">Expires ${esc(CARD.exp)} · used for your membership's renewals</span>` : `<b>No card saved</b><span class="muted">Your next renewal is due at the studio. Add a card so it renews by itself.</span>`;
      return out + `<div class="card paycard"><div class="stack" style="gap:2px">${card}</div><div class="inline2"><button type="button" class="btn" id="cardReplace">${CARD.last4 ? "Replace card" : "Add a card"}</button>${CARD.last4 ? `<button type="button" class="btn ghost danger" id="cardRemove">Remove</button>` : ""}</div></div>`;
    };
    BIND["my-packages"] = function () {
      bindMine?.call(this);
      if ($("#cardReplace")) $("#cardReplace").onclick = () => {
        standIn("Save a card", `<p style="margin:0">Add the card for your membership's renewals. Nothing is charged now.</p>`, `<button type="button" class="btn ghost" data-mclose>Back</button><button type="button" class="btn primary" id="ssSave">Save card</button>`);
        $("#ssSave").onclick = () => { Object.assign(CARD, { brand: "Mastercard", last4: "5454", exp: "03/29" }); closeModal(); render(); toast("Card saved for your renewals."); };
      };
      if ($("#cardRemove")) $("#cardRemove").onclick = () => confirmFlags([{ level: "confirm", title: "Remove the card for your membership?", msg: "Your membership renews by card. Without a card, its next payment is due at the studio, and the membership goes on hold if it isn't paid." }], { proceedLabel: "Remove card", proceed: () => { CARD.last4 = ""; render(); toast("Card removed."); } });
    };
  }
