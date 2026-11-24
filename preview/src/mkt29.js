  // ===========================================================================
  // The free trial (the same rules as modules/trial in the API): 14 days, no card.
  //  - New studio: everything on the plan they're trying, except payments and WhatsApp, up to 25
  //    clients. A bar across the top says how long is left, with Start my plan.
  //  - Test studio (already on another system): sample data; nothing reaches anyone.
  //  - Ended: read-only until they start their plan (our team can extend it).
  // The Trial control in the header is for the preview only.
  // ===========================================================================
  {
    const TR = (STUDIO.trial ||= null);
    const TV = (state.trv ||= { asking: false, plan: "growth", app: false, asked: false });
    STUDIO.trial = TR;
    const TRIAL_CLIENTS = 25;
    const label = () => PLAN_INFO[STUDIO.plan].label;

    document.querySelector("#studioDemo")?.closest(".plandemo")?.insertAdjacentHTML("afterend", `<label class="plandemo" data-help="Preview only. A free trial is started by the studio from our website.">Trial <select id="trialDemo" aria-label="Free trial (preview only)"><option value="">None</option><option value="new">New studio, 12 days left</option><option value="existing">Test studio (sample data)</option><option value="ended">Trial ended</option></select></label>`);
    $("#trialDemo").onchange = (e) => {
      const v = e.target.value;
      STUDIO.trial = v ? { kind: v === "existing" ? "existing" : "new", daysLeft: v === "ended" ? 0 : 12, ended: v === "ended" } : null;
      TV.asked = false; TV.asking = false;
      render();
    };

    function bar() {
      const t = STUDIO.trial;
      if (!t) return "";
      const msg = t.ended
        ? `<b>Your free trial has ended.</b> Everything you set up is kept for 30 days: start your plan to carry on.`
        : t.kind === "existing"
          ? `<b>Test studio: ${t.daysLeft} days left in your free trial of ${label()}.</b> It's sample data, so nothing you do here reaches anyone.`
          : `<b>${t.daysLeft} days left in your free trial of ${label()}.</b> Payments and WhatsApp switch on when you start your plan. Up to ${TRIAL_CLIENTS} clients until then.`;
      const asked = TV.asked
        ? `<span class="trialdone">${t.kind === "existing" ? "Thanks! We'll be in touch within a working day to set up your real studio and move your data." : "Thanks! We'll be in touch within a working day to switch payments on."}</span>`
        : `<button type="button" class="btn primary sm" id="trialStart">Start my plan</button>`;
      return `<div class="trialbar ${t.ended ? "ended" : ""}" role="status"><span>${msg}</span>${asked}</div>`;
    }

    function startDialog() {
      return `<div class="trialask" role="dialog" aria-modal="true" aria-labelledby="trialAskT"><div class="trialask-in">
        <h3 id="trialAskT">Start your plan</h3>
        <p class="muted">${STUDIO.trial?.kind === "existing" ? "We'll set up your real studio and move your data across, then switch payments on." : "Everything you've set up carries on. We'll switch payments on and send your first invoice."}</p>
        <div class="trialplans" role="radiogroup" aria-label="Plan">${PLAN_KEYS.map((k) => `<button type="button" role="radio" aria-checked="${TV.plan === k}" data-trplan="${k}"><b>${PLAN_INFO[k].label}</b><span>SGD ${PLAN_INFO[k].price} a month</span></button>`).join("")}</div>
        ${TV.plan === "growth" ? `<label class="inline2"><input type="checkbox" id="trialApp" ${TV.app ? "checked" : ""}> Add the branded app (SGD 99 a month)</label>` : ""}
        <div class="inline2" style="justify-content:flex-end"><button type="button" class="btn" id="trialCancel">Not now</button><button type="button" class="btn primary" id="trialSend">Ask to start ${PLAN_INFO[TV.plan].label}</button></div>
      </div></div>`;
    }

    // Payments can't be connected during a trial.
    const payBase = PAGES.payments;
    PAGES.payments = function () {
      const html = payBase();
      if (!STUDIO.trial) return html;
      return `<div class="card trial-locked"><h3>Payments switch on when you start your plan</h3><p class="muted">During the free trial, Stripe can't be connected and clients can't pay online. Everything else works.</p></div>` + html.replace(/id="payConnect"/, 'id="payConnect" disabled');
    };

    const renderBase = render;
    render = function () { // eslint-disable-line no-func-assign
      renderBase();
      document.querySelector(".trialbar")?.remove();
      document.querySelector(".trialask")?.remove();
      if (!STUDIO.trial) return;
      document.querySelector(".main")?.insertAdjacentHTML("afterbegin", bar());
      if (TV.asking) document.body.insertAdjacentHTML("beforeend", startDialog());
      // Ended: read-only. Saving and adding are switched off (starting the plan still works).
      if (STUDIO.trial.ended) document.querySelectorAll(".main .btn.primary:not(#trialStart), .main button[id$='Save'], .main button[id^='new']").forEach((b) => { b.disabled = true; b.title = "Your free trial has ended."; });
      if ($("#trialStart")) $("#trialStart").onclick = () => { TV.asking = true; TV.plan = STUDIO.plan; render(); };
      document.querySelectorAll("[data-trplan]").forEach((b) => (b.onclick = () => { TV.plan = b.dataset.trplan; render(); }));
      if ($("#trialApp")) $("#trialApp").onchange = (e) => { TV.app = e.target.checked; };
      if ($("#trialCancel")) $("#trialCancel").onclick = () => { TV.asking = false; render(); };
      if ($("#trialSend")) $("#trialSend").onclick = () => { TV.asking = false; TV.asked = true; render(); toast(`Asked to start ${PLAN_INFO[TV.plan].label}. We'll be in touch within a working day.`); };
    };
  }
