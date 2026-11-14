  // ===========================================================================
  // Sales: every sale gets an invoice, and a receipt once it's paid. Transactions, refunds and the
  // studio's invoice design. Same rules as modules/sales in the API. Plus membership payment holds
  // (modules/packages/payments.ts): a failed renewal holds the membership for 7 days with 2 retries.
  // ===========================================================================
  const PAY_METHODS = { card: "Card", cash: "Cash", qr: "QR payment (PayNow, DuitNow, PromptPay)", bank_transfer: "Bank transfer", online: "Paid online", credit: "Studio credit", other: "Other" };
  const DESK_METHODS = ["card", "cash", "qr", "bank_transfer", "other"];
  const INV_SOURCES = { package: "Package", renewal: "Membership renewal", gift_card: "Gift card", product: "Shop", fee: "Fee", desk_sale: "Sold at the desk" };
  const INV_STATUS = { open: ["Not paid yet", "open"], paid: ["Paid", "done"], partly_refunded: ["Partly refunded", "wait"], refunded: ["Refunded", "off"], void: ["Cancelled", "off"] };
  const INV = {
    settings: {
      businessName: "Demo Studio Pte. Ltd.", address: "12 Tanjong Pagar Road, #03-01\nSingapore 088443", registrationLabel: "UEN", registrationNumber: "202312345K",
      email: "hello@demostudio.sg", phone: "+65 6123 4567", website: "demostudio.sg", logo: null, accentColor: "#0C6156",
      invoicePrefix: "INV-", receiptPrefix: "RCT-", paymentTerms: "Please pay at the front desk or by PayNow to UEN 202312345K before your first class.",
      footerNote: "Thank you for moving with us. Packages can't be exchanged for cash.", tax: { enabled: false, label: "GST", ratePercent: 9 }, autoEmailReceipts: true,
    },
    nextInv: 1, nextRct: 1, list: [],
  };
  const invNo = (n, prefix) => `${prefix}${String(n).padStart(5, "0")}`;
  const invTotal = (inv) => Math.max(0, inv.lines.reduce((a, l) => a + l.qty * l.unit, 0) - (inv.discount || 0) - (inv.creditUsed || 0));
  const invRefunded = (inv) => inv.refunds.reduce((a, r) => a + r.amount, 0);
  const invStatus = (inv) => (inv.void ? "void" : !inv.paidAt ? "open" : !inv.refunds.length ? "paid" : invRefunded(inv) >= invTotal(inv) ? "refunded" : "partly_refunded");
  const clientOf = (inv) => CLIENTS[inv.ci];

  function issue(o) {
    const inv = { id: `iv${INV.list.length + 1}`, no: invNo(INV.nextInv++, INV.settings.invoicePrefix), rct: null, refunds: [], discount: 0, creditUsed: 0, method: null, paidAt: null, void: false, emailed: null, ...o };
    // The seller's details are kept as they were when it was issued, like a printed invoice.
    inv.seller = { ...INV.settings, tax: { ...INV.settings.tax } };
    INV.list.push(inv);
    if (o.paidAt) payInv(inv, o.method || "card", o.paidAt, { quiet: true });
    return inv;
  }
  function payInv(inv, method, at = NOW, { quiet = false } = {}) {
    inv.paidAt = at; inv.method = method;
    if (!inv.rct) inv.rct = invNo(INV.nextRct++, INV.settings.receiptPrefix);
    if (INV.settings.autoEmailReceipts && !quiet) inv.emailed = at;
    return inv;
  }
  const findInv = (pred) => INV.list.find(pred);

  // Invoices for what happened before (packages, gift cards, fees, orders), oldest first so numbers run in order.
  function syncInvoices() {
    const seed = [];
    // Orders waiting for payment (and ones paid since).
    for (const o of ORDERS) {
      let inv = findInv((x) => x.ref?.order === o.id);
      const pl = PLANS.find((x) => x.id === o.plan);
      if (!inv && o.status !== "cancelled") inv = issue({ ci: o.ci, source: "package", issued: NOW, lines: [{ desc: pl.name, qty: 1, unit: pl.price }], discount: o.discount || 0, creditUsed: o.credit || 0, ref: { order: o.id } });
      if (!inv) continue;
      if (o.status === "paid" && !inv.paidAt) {
        payInv(inv, invTotal(inv) ? "card" : "credit");
        const pk = [...CPKG].reverse().find((p) => p.owner === o.ci && p.plan === o.plan && !p._inv);
        if (pk) { pk._inv = inv.id; inv.ref.pkg = pk.id; }
      }
      if (o.status === "cancelled" && !inv.paidAt) inv.void = true;
    }
    for (const pk of CPKG) {
      if (pk._inv || !pk.paid) continue;
      seed.push({ at: pk.bought, make: () => { const inv = issue({ ci: pk.owner, source: +day(pk.bought) === +day(NOW) ? "desk_sale" : "package", issued: pk.bought, paidAt: pk.bought, method: ["card", "online", "qr", "card", "cash"][pk.id % 5], lines: [{ desc: pk.name, qty: 1, unit: pk.paid }], ref: { pkg: pk.id } }); pk._inv = inv.id; } });
    }
    for (const [i, c] of CARDS.entries()) {
      if (c._inv) continue;
      const at = c._at || addDays(NOW, -(9 + i * 11));
      seed.push({ at, make: () => { const inv = issue({ ci: c.buyer, source: "gift_card", issued: at, paidAt: at, method: "online", lines: [{ desc: `Gift card ${c.code}`, qty: 1, unit: c.amount }], ref: { card: c.id } }); c._inv = inv.id; } });
    }
    for (const f of FEES) {
      let inv = findInv((x) => x.ref?.fee === f.id);
      if (!inv) {
        const s = SESSIONS.find((x) => x.id === f.sid);
        const at = s ? s.start : NOW;
        seed.push({ at, make: () => { const x = issue({ ci: f.ci, source: "fee", issued: at, lines: [{ desc: `${FEE_TYPE[f.type]} fee${s ? `: ${TYPES[s.type].name}, ${fmtDay(s.start)} ${clock(s.start)}` : ""}`, qty: 1, unit: f.cents }], ref: { fee: f.id } }); syncFee(x, f); } });
      } else syncFee(inv, f);
    }
    seed.sort((a, b) => a.at - b.at).forEach((x) => x.make());
  }
  function syncFee(inv, f) {
    if (f.status === "waived" && !inv.paidAt) inv.void = true;
    if (f.status === "paid" && !inv.paidAt) payInv(inv, f.method || "card");
  }

  // --- Sample data: Chloe's membership renewal didn't go through 2 days ago ----------
  const HOLD_DAYS = 7, RETRY_DAYS = [3, 7];
  {
    const pk = sellPkg(0, "p3", { daysAgo: 33 });
    pk.cycle = 2;
    const failed = new Date(+pk.expires + 9 * 36e5);
    pk.hold = { at: failed, retries: 0, card: "4242", amount: pk.paid };
    pk.history.push({ when: fmtDay(failed), text: "Renewal payment failed", detail: "Card ending 4242 was declined. Booking is paused until it's paid.", change: "", by: "Automatic", kind: "payment_failed" });
  }
  syncInvoices();
  // The held renewal's invoice, waiting for payment.
  for (const pk of CPKG.filter((p) => p.hold)) issue({ ci: pk.owner, source: "renewal", issued: pk.hold.at, lines: [{ desc: `${pk.name} (renewal, period 2)`, qty: 1, unit: pk.hold.amount }], ref: { pkg: pk.id, renewal: true }, note: `Card ending ${pk.hold.card} declined on ${fmtDay(pk.hold.at)}.` });
  // A refund from earlier in the month, for the sample.
  {
    const inv = INV.list.find((x) => x.source === "package" && x.paidAt && x.ci !== 0 && invTotal(x) >= 15000);
    if (inv) inv.refunds.push({ amount: 2800, reason: "Studio cancelled a class at short notice", method: "original_payment", at: addDays(NOW, -6), by: "Fiona Lee" });
  }

  const holdUntil = (pk) => addDays(pk.hold.at, HOLD_DAYS);
  const nextRetry = (pk) => RETRY_DAYS.map((d) => addDays(pk.hold.at, d)).find((d) => d > NOW) || null;
  const commitEnd = (pk) => (pk.commit ? addUnit(pk.bought, pk.commit * pk.vVal, pk.vUnit) : null);
  const earlyFeeFor = (pk) => (commitEnd(pk) && commitEnd(pk) > holdUntil(pk) && pk.earlyMode !== "none" ? pk.earlyFee || 0 : 0);
  /** Why a held membership can't be used to book (the same words the API gives). */
  const holdWhy = (pk) => `Its renewal payment didn't go through, so it's on hold until it's paid (by ${fmtDay(holdUntil(pk))})`;
  function holdBox(pk, as) {
    const fee = earlyFeeFor(pk), retry = nextRetry(pk);
    const mine = as === "client";
    const msg = mine
      ? `We tried your card ending ${esc(pk.hold.card)} on ${fmtDay(pk.hold.at)} and it didn't go through. Until it's paid, you can't book classes with this membership.${retry ? ` We'll try again on ${fmtDay(retry)}.` : ""} If it still hasn't gone through by ${fmtDay(holdUntil(pk))}, the membership ends${fee ? ` and an early termination fee of ${m$(fee)} applies, as it's within the minimum term` : ""}. To keep going after that, you'd buy a new one${pk.commit ? ` (with a new ${plural(pk.commit, "month")} minimum)` : ""}.`
      : `The renewal on ${fmtDay(pk.hold.at)} was declined (card ending ${esc(pk.hold.card)}). ${esc(firstName(CLIENTS[pk.owner].name))} can't book with it until it's paid.${retry ? ` Next automatic try: ${fmtDay(retry)}.` : ""} If it's still unpaid on ${fmtDay(holdUntil(pk))}, it ends${fee ? ` and the ${m$(fee)} early termination fee is charged` : ""}, and their upcoming bookings with it are cancelled.`;
    return `<div class="holdbox">${alertBox("warn", mine ? "Your payment didn't go through" : "Renewal payment failed", msg)}
      <div class="inline2">${mine ? `<button type="button" class="btn primary" data-hold="card:${pk.id}">Update card and pay ${m$(pk.hold.amount)}</button>` : `<button type="button" class="btn primary" data-hold="desk:${pk.id}">Take payment at the desk</button><button type="button" class="btn" data-hold="retry:${pk.id}">Try the card again</button>`}</div></div>`;
  }
  function liftHold(pk, method) {
    const inv = findInv((x) => x.ref?.pkg === pk.id && x.ref?.renewal && !x.paidAt);
    if (inv) payInv(inv, method);
    pk.started = new Date(pk.expires); pk.expires = addUnit(pk.expires, pk.vVal, pk.vUnit);
    pk.history.push({ when: fmtDay(NOW), text: "Renewal paid", detail: `${PAY_METHODS[method]}. Booking is open again.`, change: "", by: method === "card" && state.role === "client" ? "You" : "The studio", kind: "payment_recovered" });
    pk.hold = null;
    return inv;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hold]");
    if (!b) return;
    const [a, id] = b.dataset.hold.split(":");
    const pk = CPKG.find((x) => x.id === Number(id));
    if (!pk?.hold) return;
    if (a === "card") {
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="hcForm" role="dialog" aria-modal="true" aria-labelledby="hcT" style="width:min(440px,100%)"><header><h2 id="hcT">Update your card</h2></header><div class="mb mform">
        <span class="hint">Your new card is saved for future renewals, and ${m$(pk.hold.amount)} is charged now.</span>
        <label class="fl">Card number<input id="hcNum" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456" maxlength="23"></label>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Expiry<input id="hcExp" autocomplete="cc-exp" placeholder="MM / YY" maxlength="7"></label><label class="fl">Security code<input id="hcCvc" inputmode="numeric" autocomplete="cc-csc" placeholder="3 digits" maxlength="4"></label></div>
        <span class="hint">Card details go straight to the payment provider; the studio never sees them. (Sample: any numbers work.)</span></div>
        <footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">Pay ${m$(pk.hold.amount)}</button></footer></form></div>`;
      $("#hcForm").onsubmit = (ev) => {
        ev.preventDefault();
        const num = $("#hcNum").value.replace(/\D/g, "");
        if (num.length < 12) return toast("Enter the card number.");
        if (!/^\d{2}\s*\/\s*\d{2}$/.test($("#hcExp").value.trim())) return toast("Enter the expiry as MM / YY.");
        if (!/^\d{3,4}$/.test($("#hcCvc").value.trim())) return toast("Enter the 3 or 4 digit security code.");
        liftHold(pk, "card"); closeModal(); render();
        toast(`Paid. Your ${pk.name} is active again, and your receipt is on its way to ${CLIENTS[pk.owner].email}.`);
      };
    }
    if (a === "desk") {
      payMethodModal(`Take ${m$(pk.hold.amount)} for ${pk.name}`, `${esc(CLIENTS[pk.owner].name)} can book with it again straight away, and gets a receipt.`, (m) => { liftHold(pk, m); render(); toast(`Paid by ${PAY_METHODS[m].toLowerCase()}. ${firstName(CLIENTS[pk.owner].name)} can book again.`); });
    }
    if (a === "retry") {
      pk.hold.retries++;
      pk.history.push({ when: fmtDay(NOW), text: "Payment tried again", detail: `Card ending ${pk.hold.card} declined`, change: "", by: "The studio", kind: "payment_failed" });
      render(); toast(`Card ending ${pk.hold.card} was declined again. ${firstName(CLIENTS[pk.owner].name)} has been asked to update it.`);
    }
  });

  function payMethodModal(title, hint, done) {
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="pmForm" role="dialog" aria-modal="true" aria-labelledby="pmT" style="width:min(440px,100%)"><header><h2 id="pmT">${esc(title)}</h2></header><div class="mb mform">
      <span class="hint">${hint}</span><fieldset class="fl" style="border:0;padding:0;margin:0"><legend class="lbl" style="margin-bottom:6px">How did they pay?</legend><div class="stack" style="gap:6px">${DESK_METHODS.map((k, i) => `<label class="check"><input type="radio" name="pmM" value="${k}" ${i === 0 ? "checked" : ""}> ${esc(PAY_METHODS[k])}</label>`).join("")}</div></fieldset></div>
      <footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">Mark as paid</button></footer></form></div>`;
    $("#pmForm").onsubmit = (e) => { e.preventDefault(); const m = document.querySelector("input[name=pmM]:checked").value; closeModal(); done(m); };
  }

  // --- The invoice and receipt document (what's emailed, printed or saved as PDF) -----------
  function invDoc(inv, kind, { sample = false, settings = null } = {}) {
    const st = settings || inv.seller;
    const c = clientOf(inv), status = invStatus(inv), total = invTotal(inv), refunded = invRefunded(inv);
    const isRct = kind === "receipt";
    const sub = inv.lines.reduce((a, l) => a + l.qty * l.unit, 0);
    const tax = st.tax?.enabled ? Math.round((total * st.tax.ratePercent) / (100 + st.tax.ratePercent)) : 0;
    const dt = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const pill = isRct ? "" : `<span class="ivpill ${status}">${INV_STATUS[status][0]}</span>`;
    const lines = inv.lines.map((l) => `<tr><td>${esc(l.desc)}</td><td class="n">${l.qty}</td><td class="n">${m$(l.unit)}</td><td class="n">${m$(l.qty * l.unit)}</td></tr>`).join("");
    const tot = [
      inv.discount || inv.creditUsed ? ["Subtotal", m$(sub)] : null,
      inv.discount ? ["Discount", `−${m$(inv.discount).replace("−", "")}`] : null,
      inv.creditUsed ? ["Studio credit used", `−${m$(inv.creditUsed).replace("−", "")}`] : null,
      ["Total", m$(total), "big"],
      tax ? [`Includes ${esc(st.tax.label)} at ${st.tax.ratePercent}%`, m$(tax), "muted"] : null,
      isRct ? [`Paid${inv.method ? ` by ${PAY_METHODS[inv.method].toLowerCase()}` : ""}`, m$(total)] : null,
      refunded ? ["Refunded", `−${m$(refunded).replace("−", "")}`] : null,
    ].filter(Boolean);
    return `<div class="invdoc" style="--iv:${esc(st.accentColor)}"><div class="ivtop">
        <div class="ivbrand">${st.logo ? `<img src="${st.logo}" alt="${esc(st.businessName)}">` : `<b class="ivname">${esc(st.businessName)}</b>`}</div>
        <div class="ivtitle"><h3>${isRct ? "Receipt" : "Invoice"}</h3>${pill}</div></div>
      <div class="ivmeta"><div class="ivfrom">${st.logo ? `<b>${esc(st.businessName)}</b><br>` : ""}${esc(st.address).replace(/\n/g, "<br>")}${st.registrationNumber ? `<br>${esc(st.registrationLabel)} ${esc(st.registrationNumber)}` : ""}${st.tax?.enabled ? `<br>${esc(st.tax.label)} registered` : ""}<br>${[st.email, st.phone, st.website].filter(Boolean).map(esc).join(" · ")}</div>
        <dl class="ivnums"><dt>${isRct ? "Receipt no." : "Invoice no."}</dt><dd>${esc(isRct ? inv.rct : inv.no)}</dd>${isRct ? `<dt>For invoice</dt><dd>${esc(inv.no)}</dd><dt>Paid on</dt><dd>${dt(inv.paidAt)}</dd>` : `<dt>Date</dt><dd>${dt(inv.issued)}</dd>`}</dl></div>
      <div class="ivto"><span class="ivlbl">${isRct ? "Received from" : "Billed to"}</span><b>${esc(c.name)}</b><br>${esc(c.email)}</div>
      <table class="ivlines"><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${lines}</tbody></table>
      <table class="ivtot">${tot.map(([l, v, k]) => `<tr class="${k || ""}"><td>${l}</td><td class="n">${v}</td></tr>`).join("")}</table>
      ${!isRct && status === "open" && st.paymentTerms ? `<p class="ivterms"><b>How to pay</b><br>${esc(st.paymentTerms)}</p>` : ""}
      ${st.footerNote ? `<p class="ivfoot">${esc(st.footerNote)}</p>` : ""}
      ${sample ? '<p class="ivsample">Sample</p>' : ""}</div>`;
  }
  function openDoc(inv, kind) {
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal docmodal" role="dialog" aria-modal="true" aria-label="${kind === "receipt" ? `Receipt ${esc(inv.rct)}` : `Invoice ${esc(inv.no)}`}"><div class="mb">${invDoc(inv, kind)}</div>
      <footer>${state.role !== "client" && kind === "receipt" ? `<button type="button" class="btn" id="docEmail">Email to ${esc(firstName(clientOf(inv).name))}</button>` : ""}<button type="button" class="btn" id="docPrint">Print or save as PDF</button><button type="button" class="btn primary" data-mclose>Close</button></footer></div></div>`;
    $("#docPrint").onclick = () => printDoc(invDoc(inv, kind), `${kind === "receipt" ? inv.rct : inv.no}`);
    if ($("#docEmail")) $("#docEmail").onclick = () => emailReceipt(inv);
  }
  /** A clean page with just the document, for printing or "Save as PDF". */
  function printDoc(html, title) {
    const css = [...document.styleSheets].map((sh) => { try { return [...sh.cssRules].map((r) => r.cssText).filter((t) => /\.(invdoc|iv[a-z]+|vr[a-z-]*)/.test(t)).join("\n"); } catch { return ""; } }).join("\n");
    const w = window.open("", "_blank");
    if (!w) { offerFile(`${title}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{margin:24px;background:#fff;font-family:system-ui,sans-serif}${css}</style></head><body>${html}</body></html>`, "text/html").then((r) => r === "saved" && toast("Saved as a web page. Open it and print, or choose Save as PDF.")); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{margin:0;background:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}@page{size:A4;margin:14mm}${css}</style></head><body>${html}<script>setTimeout(()=>print(),200)<\/script></body></html>`);
    w.document.close();
  }
  function emailReceipt(inv) {
    inv.emailed = NOW;
    toast(`Receipt ${inv.rct} emailed to ${clientOf(inv).email}.`);
  }

  // --- Refunds -----------------------------------------------------------------------
  function openRefund(inv) {
    const left = invTotal(inv) - invRefunded(inv);
    const pk = inv.ref?.pkg && CPKG.find((x) => x.id === inv.ref.pkg);
    const card = inv.ref?.card && CARDS.find((x) => x.id === inv.ref.card);
    const order = inv.ref?.shop && SHOP_ORDERS.find((x) => x.id === inv.ref.shop);
    const undo = pk && !pk.cancelled ? `Also cancel ${esc(pk.name)} (any classes left on it can't be used)` : card && card.status !== "cancelled" ? (card.status === "given" ? "" : "Also cancel the gift card (it hasn't been given yet)") : order && order.status !== "cancelled" ? "Also put the items back in stock" : "";
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="rfForm" role="dialog" aria-modal="true" aria-labelledby="rfT"><header><h2 id="rfT">Refund ${esc(inv.no)}</h2></header><div class="mb mform">
      <span class="hint">${esc(clientOf(inv).name)} paid ${m$(invTotal(inv))}${inv.method ? ` by ${PAY_METHODS[inv.method].toLowerCase()}` : ""}.${invRefunded(inv) ? ` ${m$(invRefunded(inv))} has already been refunded.` : ""}</span>
      <label class="fl">Amount to refund (${STUDIO.currency})<input type="number" id="rfAmt" min="0.01" step="0.01" max="${left / 100}" value="${(left / 100).toFixed(2)}" style="max-width:180px"><span class="h">Up to ${m$(left)}.</span></label>
      <label class="fl">Reason<input id="rfWhy" maxlength="300" placeholder="e.g. Moving overseas, studio cancelled the class"></label>
      <fieldset class="fl" style="border:0;padding:0;margin:0"><legend class="lbl" style="margin-bottom:6px">How they get it back</legend>
        <label class="opt"><input type="radio" name="rfHow" value="original_payment" checked><div><b>The way they paid</b><br><span class="h">${inv.method === "card" || inv.method === "online" ? "Refund it through your card terminal or payment provider; this records it and emails them." : "Pay it back by cash, PayNow or bank transfer; this records it and emails them."}</span></div></label>
        <label class="opt"><input type="radio" name="rfHow" value="credit"><div><b>As studio credit</b><br><span class="h">Added to their account straight away and used automatically at checkout.</span></div></label></fieldset>
      ${undo ? `<label class="check"><input type="checkbox" id="rfUndo" ${invRefunded(inv) === 0 ? "checked" : ""}> ${undo}</label>` : ""}</div>
      <footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn danger">Refund</button></footer></form></div>`;
    $("#rfForm").onsubmit = (e) => {
      e.preventDefault();
      const amount = Math.round(Number($("#rfAmt").value) * 100), reason = $("#rfWhy").value.trim(), how = document.querySelector("input[name=rfHow]:checked").value, doUndo = !!$("#rfUndo")?.checked;
      if (!(amount > 0)) return toast("Enter an amount to refund.");
      if (amount > left) return toast(`You can refund up to ${m$(left)}.`);
      if (!reason) { $("#rfWhy").focus(); return toast("Add a short reason. It's kept on the record and shown to the client."); }
      const c = clientOf(inv);
      confirmFlags([{ level: "confirm", title: `Refund ${m$(amount)} to ${c.name}?`, msg: `${how === "credit" ? `${m$(amount)} is added to their studio credit.` : `Remember to pay ${m$(amount)} back ${inv.method === "card" || inv.method === "online" ? "through your card terminal or payment provider" : "to them"}.`}${doUndo ? (pk ? ` ${pk.name} is cancelled.` : card ? " The gift card is cancelled." : " The items go back in stock.") : ""} They're emailed a refund note. Refunds can't be undone.` }], {
        title: "Check the refund", proceedLabel: `Refund ${m$(amount)}`, back: () => openRefund(inv),
        proceed: () => {
          inv.refunds.push({ amount, reason, method: how, at: NOW, by: "You" });
          if (how === "credit") GIFT_CREDIT[inv.ci] = (GIFT_CREDIT[inv.ci] || 0) + amount;
          if (doUndo && pk) { pk.cancelled = NOW; pk.history.push({ when: fmtDay(NOW), text: "Cancelled", detail: `Refunded ${m$(amount)}: ${reason}`, change: "", by: "The studio", kind: "cancelled" }); }
          if (doUndo && card) card.status = "cancelled";
          if (doUndo && order) { order.status = "cancelled"; restockOrder(order); }
          render(); toast(`Refunded ${m$(amount)}${how === "credit" ? " as studio credit" : ""}. ${firstName(c.name)} has been emailed.`);
        },
      });
    };
  }

  // --- The Sales page: transactions, and the studio's invoice design -------------------------
  const SALES = { tab: "transactions", q: "", status: "all", source: "", days: 30, open: null, draft: null };
  PAGES.sales = function () {
    syncInvoices();
    const tabs = `<div class="tabs" role="tablist">${[["transactions", "Transactions"], ["design", "Invoice design"]].map(([k, l]) => `<button type="button" role="tab" data-stab="${k}" aria-selected="${SALES.tab === k}">${l}</button>`).join("")}</div>`;
    const body = SALES.tab === "design" ? invoiceDesign() : transactions();
    return head("Sales", "Every sale, with its invoice and receipt. Take payments, email receipts and give refunds here.") + tabs + body;
  };
  function transactions() {
    const from = SALES.days ? addDays(NOW, -SALES.days) : new Date(0);
    const q = SALES.q.toLowerCase();
    const inPeriod = INV.list.filter((x) => x.issued >= from || (x.paidAt && x.paidAt >= from) || x.refunds.some((r) => r.at >= from));
    const list = inPeriod
      .filter((x) => SALES.status === "all" || (SALES.status === "refunded" ? ["refunded", "partly_refunded"].includes(invStatus(x)) : invStatus(x) === SALES.status))
      .filter((x) => !SALES.source || x.source === SALES.source || (SALES.source === "package" && x.source === "desk_sale"))
      .filter((x) => !q || [x.no, x.rct || "", clientOf(x).name, clientOf(x).email, ...x.lines.map((l) => l.desc)].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.paidAt || b.issued) - (a.paidAt || a.issued));
    const takenIn = INV.list.filter((x) => x.paidAt && x.paidAt >= from && !x.void).reduce((a, x) => a + invTotal(x), 0);
    const refunded = INV.list.reduce((a, x) => a + x.refunds.filter((r) => r.at >= from).reduce((b, r) => b + r.amount, 0), 0);
    const unpaid = INV.list.filter((x) => invStatus(x) === "open");
    const toCollect = unpaid.reduce((a, x) => a + invTotal(x), 0);
    const tiles = [["Taken in", m$(takenIn), "Paid sales in this period."], ["Refunded", m$(refunded), "Paid back or given as credit."], ["Nett", m$(takenIn - refunded), "Taken in, minus refunds."], ["Still to collect", m$(toCollect), `${plural(unpaid.length, "invoice")} not paid yet, from any time.`]];
    return `<div class="rtiles stiles">${tiles.map(([l, v, h]) => `<div class="rtile"><span class="rl">${l}</span><b class="rv">${v}</b><span class="rx">${h}</span></div>`).join("")}</div>
      <div class="card"><div class="sfilters"><input type="search" id="sQ" placeholder="Search by client, number or item" value="${esc(SALES.q)}" aria-label="Search transactions">
        <select id="sSrc" aria-label="What was sold"><option value="">Everything</option>${Object.entries(INV_SOURCES).filter(([k]) => k !== "desk_sale").map(([k, l]) => `<option value="${k}" ${SALES.source === k ? "selected" : ""}>${l}${k === "package" ? "s" : k === "fee" ? "s" : k === "gift_card" ? "s" : k === "renewal" ? "s" : ""}</option>`).join("")}</select>
        <select id="sDays" aria-label="Period">${[[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [0, "All time"]].map(([d, l]) => `<option value="${d}" ${SALES.days === d ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="fbar">${[["all", "All"], ["open", "Not paid yet"], ["paid", "Paid"], ["refunded", "Refunded"], ["void", "Cancelled"]].map(([k, l]) => `<button type="button" class="pickchip" data-sst="${k}" aria-pressed="${SALES.status === k}">${l}${k === "open" && unpaid.length ? ` · ${unpaid.length}` : ""}</button>`).join("")}</div>
        <div class="tblwrap"><table class="tbl stbl"><thead><tr><th>Date</th><th>Invoice</th><th>Client</th><th>What</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((x) => { const st = invStatus(x); return `<tr data-inv="${x.id}" tabindex="0"><td style="white-space:nowrap">${fmtDay(x.paidAt || x.issued)}</td><td><b>${esc(x.no)}</b>${x.rct ? `<br><span class="muted">${esc(x.rct)}</span>` : ""}</td><td><div class="cellp">${avatar(clientOf(x), "xs")}${esc(clientOf(x).name)}</div></td>
          <td>${esc(x.lines[0].desc)}${x.lines.length > 1 ? ` <span class="muted">+${x.lines.length - 1} more</span>` : ""}<br><span class="muted">${INV_SOURCES[x.source]}</span></td>
          <td class="num"><b>${m$(invTotal(x))}</b>${invRefunded(x) ? `<br><span class="muted">−${m$(invRefunded(x)).replace("−", "")} refunded</span>` : ""}</td>
          <td><span class="status ${INV_STATUS[st][1]}">${INV_STATUS[st][0]}</span>${x.method && st !== "open" ? `<br><span class="muted">${esc(PAY_METHODS[x.method])}</span>` : ""}</td>
          <td><button type="button" class="btn ghost" data-inv="${x.id}">Open</button></td></tr>`; }).join("") || '<tr><td colspan="7" class="muted">No transactions match.</td></tr>'}
        </tbody></table></div></div>`;
  }
  function openInv(inv) {
    const st = invStatus(inv), c = clientOf(inv), left = invTotal(inv) - invRefunded(inv);
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-labelledby="ivT" style="width:min(560px,100%)"><header><h2 id="ivT">${esc(inv.no)} · ${esc(c.name)}</h2></header><div class="mb">
      <div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><span class="status ${INV_STATUS[st][1]}">${INV_STATUS[st][0]}</span><b style="font-family:var(--display);font-size:22px">${m$(invTotal(inv))}</b></div>
      <dl class="ivdl"><dt>What</dt><dd>${inv.lines.map((l) => `${esc(l.desc)}${l.qty > 1 ? ` × ${l.qty}` : ""}`).join("<br>")}</dd><dt>Type</dt><dd>${INV_SOURCES[inv.source]}</dd><dt>Issued</dt><dd>${fmtDay(inv.issued)}</dd>
        ${inv.paidAt ? `<dt>Paid</dt><dd>${fmtDay(inv.paidAt)} · ${esc(PAY_METHODS[inv.method])} · receipt ${esc(inv.rct)}</dd>` : ""}${inv.emailed ? `<dt>Receipt emailed</dt><dd>${fmtDay(inv.emailed)} to ${esc(c.email)}</dd>` : ""}${inv.note ? `<dt>Note</dt><dd>${esc(inv.note)}</dd>` : ""}</dl>
      ${inv.refunds.length ? `<h3 style="font-size:14px;margin:12px 0 4px">Refunds</h3><ul class="bklist">${inv.refunds.map((r) => `<li><b>${m$(r.amount)}</b> ${r.method === "credit" ? "as studio credit" : "the way they paid"} · ${fmtDay(r.at)} by ${esc(r.by)}<br><span class="muted">${esc(r.reason)}</span></li>`).join("")}</ul>` : ""}
      ${st === "void" ? alertBox("info", "", inv.source === "fee" ? "The fee was waived, so this invoice was cancelled." : "This order was cancelled before it was paid.") : ""}</div>
      <footer class="ivacts"><button type="button" class="btn" id="ivDocI">View invoice</button>${inv.paidAt ? `<button type="button" class="btn" id="ivDocR">View receipt</button><button type="button" class="btn" id="ivMail">Email receipt</button>` : ""}
        ${st === "open" ? `<button type="button" class="btn primary" id="ivPay">Mark as paid</button>` : ""}${inv.paidAt && left > 0 ? `<button type="button" class="btn danger" id="ivRefund">Refund…</button>` : ""}</footer></div></div>`;
    $("#ivDocI").onclick = () => openDoc(inv, "invoice");
    if ($("#ivDocR")) $("#ivDocR").onclick = () => openDoc(inv, "receipt");
    if ($("#ivMail")) $("#ivMail").onclick = () => { emailReceipt(inv); openInv(inv); };
    if ($("#ivRefund")) $("#ivRefund").onclick = () => openRefund(inv);
    if ($("#ivPay")) $("#ivPay").onclick = () => payMethodModal(`Mark ${inv.no} as paid`, `${esc(c.name)} · ${m$(invTotal(inv))}. ${INV.settings.autoEmailReceipts ? "They're emailed a receipt." : "You can email the receipt afterwards."}`, (m) => {
      const pk = inv.ref?.pkg && CPKG.find((x) => x.id === inv.ref.pkg);
      if (inv.ref?.renewal && pk?.hold) liftHold(pk, m);
      else if (inv.ref?.order) { const o = ORDERS.find((x) => x.id === inv.ref.order); payInv(inv, m); if (o && o.status === "pending") { const p2 = sellPkg(o.ci, o.plan, { daysAgo: 0 }); p2._inv = inv.id; inv.ref.pkg = p2.id; o.status = "paid"; } }
      else if (inv.ref?.fee) { const f = FEES.find((x) => x.id === inv.ref.fee); if (f) { f.status = "paid"; f.method = m; } payInv(inv, m); }
      else { payInv(inv, m); const so = inv.ref?.shop && SHOP_ORDERS.find((x) => x.id === inv.ref.shop); if (so) so.paid = true; }
      renderNav(); render(); toast(`${inv.no} paid by ${PAY_METHODS[m].toLowerCase()}.${INV.settings.autoEmailReceipts ? ` Receipt ${inv.rct} emailed to ${c.email}.` : ""}`);
    });
  }

  function invoiceDesign() {
    const d = SALES.draft || (SALES.draft = clone(INV.settings));
    const ok = /^#[0-9a-f]{6}$/i.test(d.accentColor) && whiteContrast(d.accentColor) >= 3;
    const sample = { no: invNo(INV.nextInv, d.invoicePrefix), rct: invNo(INV.nextRct, d.receiptPrefix), ci: 0, source: "package", issued: NOW, paidAt: NOW, method: "card", lines: [{ desc: "10-class pack", qty: 1, unit: 28000 }, { desc: "Grip socks (M)", qty: 2, unit: 1800 }], discount: 0, creditUsed: 0, refunds: [], seller: d };
    return `<div class="ivdesign"><div class="card mform ivform"><h3>Your details</h3>
        <label class="fl">Business name<input id="idName" maxlength="120" value="${esc(d.businessName)}"></label>
        <label class="fl">Address<textarea id="idAddr" rows="3" maxlength="400">${esc(d.address)}</textarea></label>
        <div class="two" style="grid-template-columns:1fr 1.4fr"><label class="fl">Registration label<input id="idRegL" maxlength="30" value="${esc(d.registrationLabel)}" placeholder="e.g. UEN, SSM, NPWP"></label><label class="fl">Registration number<input id="idRegN" maxlength="40" value="${esc(d.registrationNumber)}"></label></div>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Email<input id="idEmail" type="email" maxlength="200" value="${esc(d.email)}"></label><label class="fl">Phone<input id="idPhone" maxlength="40" value="${esc(d.phone)}"></label></div>
        <label class="fl">Website<input id="idWeb" maxlength="200" value="${esc(d.website)}"></label>
        <h3>Look</h3>
        <div class="fl">Logo<div class="row" style="gap:8px;flex-wrap:wrap">${d.logo ? `<img src="${d.logo}" alt="" style="height:36px;border-radius:6px;background:#fff;padding:2px">` : '<span class="muted" style="font-size:13px">None: your business name is shown instead.</span>'}<label class="btn" style="cursor:pointer">${d.logo ? "Change" : "Upload logo"}<input type="file" id="idLogo" accept="image/jpeg,image/png,image/webp" hidden></label>${d.logo ? '<button type="button" class="tagbtn" id="idLogoX">Remove</button>' : ""}</div><span class="h">JPG, PNG or WebP, up to 2 MB. A wide logo on a white or clear background works best.</span></div>
        <label class="fl">Accent colour<span class="row" style="gap:8px"><input type="color" id="idAccC" value="${esc(ok || /^#[0-9a-f]{6}$/i.test(d.accentColor) ? d.accentColor : "#0C6156")}" style="width:44px;height:34px;padding:2px" aria-label="Pick a colour"><input id="idAcc" maxlength="7" value="${esc(d.accentColor)}" style="max-width:110px" aria-label="Accent colour code"></span>${ok ? "" : '<span class="h" style="color:var(--warn)">Pick a darker colour so text on it stays readable.</span>'}</label>
        <h3>Numbers, tax and wording</h3>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Invoice numbers start with<input id="idIP" maxlength="8" value="${esc(d.invoicePrefix)}"></label><label class="fl">Receipt numbers start with<input id="idRP" maxlength="8" value="${esc(d.receiptPrefix)}"></label></div>
        <span class="h">Capital letters, numbers and dashes, up to 8. Numbers carry on from ${invNo(INV.nextInv, "")} and are never reused.</span>
        <label class="check"><input type="checkbox" id="idTax" ${d.tax.enabled ? "checked" : ""}> Prices include a sales tax (e.g. GST or SST)</label>
        ${d.tax.enabled ? `<div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Tax name<input id="idTaxL" maxlength="20" value="${esc(d.tax.label)}"></label><label class="fl">Rate (%)<input id="idTaxR" type="number" min="0" max="30" step="0.1" value="${d.tax.ratePercent}"></label></div><span class="h">Invoices show how much of each price is tax. Prices themselves don't change.</span>` : ""}
        <label class="fl">How to pay <span class="h">(on unpaid invoices)</span><textarea id="idTerms" rows="2" maxlength="500">${esc(d.paymentTerms)}</textarea></label>
        <label class="fl">Note at the bottom<textarea id="idFoot" rows="2" maxlength="500" placeholder="e.g. Thank you! Packages can't be exchanged for cash.">${esc(d.footerNote)}</textarea></label>
        <label class="check"><input type="checkbox" id="idAuto" ${d.autoEmailReceipts ? "checked" : ""}> Email receipts automatically when a sale is paid</label>
        <div class="row" style="gap:8px"><button type="button" class="btn primary" id="idSave">Save</button><button type="button" class="btn ghost" id="idReset">Undo changes</button></div></div>
      <div class="ivprev"><div class="row" style="justify-content:space-between;gap:8px"><h3 style="margin:0">Preview</h3><div class="seg" role="group" aria-label="Show">${["invoice", "receipt"].map((k) => `<button type="button" data-idk="${k}" aria-pressed="${(SALES.prevKind || "invoice") === k}">${k === "invoice" ? "Invoice" : "Receipt"}</button>`).join("")}</div></div>
        <div id="idPrev">${invDoc({ ...sample, paidAt: (SALES.prevKind || "invoice") === "receipt" ? NOW : null, method: (SALES.prevKind || "invoice") === "receipt" ? "card" : null }, SALES.prevKind || "invoice", { sample: true, settings: d })}</div>
        <span class="hint">Changes apply to new invoices and receipts. Ones already issued keep the details they were issued with.</span></div></div>`;
  }

  BIND.sales = function () {
    document.querySelectorAll("[data-stab]").forEach((b) => (b.onclick = () => { SALES.tab = b.dataset.stab; render(); }));
    document.querySelectorAll("[data-sst]").forEach((b) => (b.onclick = () => { SALES.status = b.dataset.sst; render(); }));
    if ($("#sQ")) $("#sQ").onchange = (e) => { SALES.q = e.target.value; render(); };
    if ($("#sSrc")) $("#sSrc").onchange = (e) => { SALES.source = e.target.value; render(); };
    if ($("#sDays")) $("#sDays").onchange = (e) => { SALES.days = Number(e.target.value); render(); };
    document.querySelectorAll("[data-inv]").forEach((el) => {
      const open = (e) => { e.stopPropagation(); openInv(INV.list.find((x) => x.id === el.dataset.inv)); };
      el.onclick = open;
      if (el.tagName === "TR") el.onkeydown = (e) => { if (e.key === "Enter") open(e); };
    });
    if (SALES.tab !== "design") return;
    const d = SALES.draft;
    const repaint = () => { const kind = SALES.prevKind || "invoice"; const sample = { no: invNo(INV.nextInv, d.invoicePrefix), rct: invNo(INV.nextRct, d.receiptPrefix), ci: 0, source: "package", issued: NOW, paidAt: kind === "receipt" ? NOW : null, method: kind === "receipt" ? "card" : null, lines: [{ desc: "10-class pack", qty: 1, unit: 28000 }, { desc: "Grip socks (M)", qty: 2, unit: 1800 }], discount: 0, creditUsed: 0, refunds: [] }; $("#idPrev").innerHTML = invDoc(sample, kind, { sample: true, settings: d }); };
    const bindText = (id, k) => { const el = $(id); if (el) el.oninput = () => { d[k] = el.value; repaint(); }; };
    [["#idName", "businessName"], ["#idAddr", "address"], ["#idRegL", "registrationLabel"], ["#idRegN", "registrationNumber"], ["#idEmail", "email"], ["#idPhone", "phone"], ["#idWeb", "website"], ["#idTerms", "paymentTerms"], ["#idFoot", "footerNote"]].forEach(([id, k]) => bindText(id, k));
    $("#idIP").oninput = (e) => { d.invoicePrefix = e.target.value.toUpperCase(); repaint(); };
    $("#idRP").oninput = (e) => { d.receiptPrefix = e.target.value.toUpperCase(); repaint(); };
    $("#idAccC").oninput = (e) => { d.accentColor = e.target.value.toUpperCase(); $("#idAcc").value = d.accentColor; repaint(); };
    $("#idAccC").onchange = () => render();
    $("#idAcc").onchange = (e) => { d.accentColor = e.target.value.trim(); render(); };
    $("#idTax").onchange = (e) => { d.tax.enabled = e.target.checked; render(); };
    if ($("#idTaxL")) $("#idTaxL").oninput = (e) => { d.tax.label = e.target.value; repaint(); };
    if ($("#idTaxR")) $("#idTaxR").oninput = (e) => { d.tax.ratePercent = Math.min(30, Math.max(0, Number(e.target.value) || 0)); repaint(); };
    $("#idAuto").onchange = (e) => (d.autoEmailReceipts = e.target.checked);
    $("#idLogo").onchange = (e) => readImage(e.target, (url) => { d.logo = url; render(); });
    if ($("#idLogoX")) $("#idLogoX").onclick = () => { d.logo = null; render(); };
    document.querySelectorAll("[data-idk]").forEach((b) => (b.onclick = () => { SALES.prevKind = b.dataset.idk; render(); }));
    $("#idReset").onclick = () => { SALES.draft = null; render(); toast("Changes undone."); };
    $("#idSave").onclick = () => {
      if (!d.businessName.trim()) return toast("Add your business name.");
      if (!/^[A-Z0-9-]{1,8}$/.test(d.invoicePrefix) || !/^[A-Z0-9-]{1,8}$/.test(d.receiptPrefix)) return toast("Number prefixes can use capital letters, numbers and dashes, up to 8.");
      if (!/^#[0-9a-f]{6}$/i.test(d.accentColor)) return toast("The accent colour should look like #0C6156.");
      if (whiteContrast(d.accentColor) < 3) return toast("Pick a darker accent colour so text on it stays readable.");
      if (d.email && !/^\S+@\S+\.\S+$/.test(d.email)) return toast("Check the email address.");
      if (d.tax.enabled && !d.tax.label.trim()) return toast("Give the tax a name, e.g. GST.");
      INV.settings = clone(d); SALES.draft = null; render(); toast("Saved. New invoices and receipts use this design.");
    };
  };

  // --- Clients: receipts for what they've bought -------------------------------------------
  function openMyPurchases() {
    syncInvoices();
    const me = ME.client;
    const mine = INV.list.filter((x) => x.ci === me && !x.void).sort((a, b) => (b.paidAt || b.issued) - (a.paidAt || a.issued));
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-labelledby="mpT" style="width:min(560px,100%)"><header><h2 id="mpT">Receipts and invoices</h2></header><div class="mb">
      ${mine.length ? `<ul class="bklist">${mine.map((x) => { const st = invStatus(x); return `<li class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><span><b>${esc(x.lines[0].desc)}</b><br><span class="muted">${fmtDay(x.paidAt || x.issued)} · ${m$(invTotal(x))} · ${INV_STATUS[st][0]}</span></span><span class="inline2">${x.paidAt ? `<button type="button" class="btn" data-mydoc="${x.id}:receipt">Receipt</button>` : ""}<button type="button" class="btn ghost" data-mydoc="${x.id}:invoice">Invoice</button></span></li>`; }).join("")}</ul>` : '<p class="muted">Nothing yet.</p>'}</div>
      <footer><button type="button" class="btn primary" data-mclose>Close</button></footer></div></div>`;
    document.querySelectorAll("[data-mydoc]").forEach((b) => (b.onclick = () => { const [id, k] = b.dataset.mydoc.split(":"); openDoc(INV.list.find((x) => x.id === id), k); }));
  }
  {
    const page = PAGES["my-packages"], bind = BIND["my-packages"];
    PAGES["my-packages"] = function () {
      const out = page.call(this);
      const held = myPkgs(ME.client).filter((pk) => pk.hold && pk.owner === ME.client);
      if (CLIENTS[ME.client].source === "classpass") return out;
      return out.replace('<div class="actions"></div></div>', `<div class="actions"><button type="button" class="btn" id="myRcpts">Receipts and invoices</button></div></div>${held.map((pk) => holdBox(pk, "client")).join("")}`);
    };
    BIND["my-packages"] = function () { bind?.call(this); if ($("#myRcpts")) $("#myRcpts").onclick = openMyPurchases; };
  }
