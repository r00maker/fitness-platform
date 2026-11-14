  // ===========================================================================
  // Shop (studio merch and gift cards), the writing agents, report exports and the menu entries.
  // Same rules as modules/shop, modules/assistant/writer.ts and modules/reports/export.ts.
  // ===========================================================================

  // --- Shop ---------------------------------------------------------------------------
  const PROD_TINT = ["#0C6156", "#7c3aed", "#b45309", "#1d4ed8", "#be185d", "#475569"];
  const PRODUCTS = [
    { id: "pr1", name: "Grip socks", desc: "Non-slip socks for Reformer and mat classes. Required in every class.", price: 1800, photo: null, category: "Accessories", onSale: true, options: [{ name: "S", stock: 4 }, { name: "M", stock: 0 }, { name: "L", stock: 6 }], stock: null, sold: 41 },
    { id: "pr2", name: "Studio tote bag", desc: "Heavy cotton tote with the studio logo. Fits a mat.", price: 2500, photo: null, category: "Bags", onSale: true, options: null, stock: 12, sold: 9 },
    { id: "pr3", name: "Insulated water bottle", desc: "750 ml, keeps water cold for 24 hours.", price: 3200, photo: null, category: "Accessories", onSale: true, options: null, stock: 3, sold: 17 },
    { id: "pr4", name: "Logo tee", desc: "Soft, breathable cotton blend. Relaxed fit.", price: 3900, photo: null, category: "Clothing", onSale: true, options: [{ name: "XS", stock: 2 }, { name: "S", stock: 5 }, { name: "M", stock: 5 }, { name: "L", stock: 3 }], stock: null, sold: 12 },
    { id: "pr5", name: "Resistance band set", desc: "Three bands, light to heavy, for at-home practice.", price: 2200, photo: null, category: "Accessories", onSale: false, options: null, stock: 0, sold: 4 },
  ];
  let nextProdId = 6, nextSoNo = 1004;
  const SHOP_ORDERS = [
    { id: "so3", no: 1001, ci: 0, items: [{ pid: "pr3", option: null, qty: 1, price: 3200 }], status: "collected", paid: true, at: addDays(NOW, -5), collectedAt: addDays(NOW, -4) },
    { id: "so1", no: 1002, ci: 2, items: [{ pid: "pr1", option: "L", qty: 2, price: 1800 }], status: "waiting", paid: true, at: addDays(NOW, -1) },
    { id: "so2", no: 1003, ci: 9, items: [{ pid: "pr2", option: null, qty: 1, price: 2500 }, { pid: "pr4", option: "M", qty: 1, price: 3900 }], status: "waiting", paid: false, at: new Date(+NOW - 2 * 36e5) },
  ];
  const prodById = (id) => PRODUCTS.find((p) => p.id === id);
  const soTotal = (o) => o.items.reduce((a, i) => a + i.qty * i.price, 0) - (o.credit || 0);
  const itemText = (i) => `${prodById(i.pid)?.name || "Item"}${i.option ? ` (${i.option})` : ""}${i.qty > 1 ? ` × ${i.qty}` : ""}`;
  const stockOf = (p, opt) => (p.options ? p.options.find((o) => o.name === opt)?.stock ?? 0 : p.stock);
  const inStock = (p, opt, qty = 1) => { const n = stockOf(p, opt); return n === null || n >= qty; };
  const anyStock = (p) => (p.options ? p.options.some((o) => o.stock === null || o.stock > 0) : p.stock === null || p.stock > 0);
  const totalStock = (p) => (p.options ? (p.options.some((o) => o.stock === null) ? null : p.options.reduce((a, o) => a + o.stock, 0)) : p.stock);
  const takeStock = (p, opt, qty) => { if (p.options) { const o = p.options.find((x) => x.name === opt); if (o && o.stock !== null) o.stock -= qty; } else if (p.stock !== null) p.stock -= qty; };
  function restockOrder(o) { for (const i of o.items) { const p = prodById(i.pid); if (p) takeStock(p, i.option, -i.qty); } }
  const onSaleProducts = () => PRODUCTS.filter((p) => p.onSale);
  /** Clients only see the Shop when there's something in it. */
  const shopVisible = () => onSaleProducts().length > 0 || GC.on;
  const prodPhoto = (p, cls = "") => p.photo ? `<div class="prodph ${cls}" style="background-image:url('${p.photo}')" role="img" aria-label="${esc(p.name)}"></div>` : `<div class="prodph ${cls} blank" style="--pt:${PROD_TINT[Number(p.id.slice(2)) % PROD_TINT.length]}" aria-hidden="true"><span>${esc(p.name.trim() ? initials(p.name.trim().replace(/\s+/g, " ")) : "?")}</span></div>`;
  // Invoices for the sample orders.
  for (const o of SHOP_ORDERS) issue({ ci: o.ci, source: "product", issued: o.at, paidAt: o.paid ? o.at : null, method: o.paid ? "online" : null, lines: o.items.map((i) => ({ desc: itemText({ ...i, qty: 1 }), qty: i.qty, unit: i.price })), ref: { shop: o.id } });

  const SHOP = { tab: "products", show: "waiting", basket: [], useCredit: true, ctab: "merch", sel: {} };
  PAGES.shop = function () {
    return state.role === "client" ? clientShop() : adminShop();
  };
  function adminShop() {
    const waiting = SHOP_ORDERS.filter((o) => o.status === "waiting");
    const tabs = `<div class="tabs" role="tablist">${[["products", "Products"], ["orders", `Orders${waiting.length ? `<span class="n">${waiting.length}</span>` : ""}`], ["giftcards", "Gift cards"]].map(([k, l]) => `<button type="button" role="tab" data-shtab="${k}" aria-selected="${SHOP.tab === k}">${l}</button>`).join("")}</div>`;
    let body = "";
    if (SHOP.tab === "products") {
      body = `${!shopVisible() ? alertBox("info", "Clients can't see the Shop yet", "Put a product on sale (or turn gift cards on) and the Shop appears in clients' menu.") : ""}
        <div class="prodgrid">${PRODUCTS.map((p) => { const n = totalStock(p); return `<article class="card prodcard ${p.onSale ? "" : "off"}">${prodPhoto(p)}
          <div class="row" style="justify-content:space-between;gap:8px"><b>${esc(p.name)}</b><b>${m$(p.price)}</b></div>
          <span class="muted" style="font-size:12.5px">${esc(p.category || "No category")} · ${p.options ? p.options.map((o) => `${esc(o.name)} ${o.stock === null ? "∞" : o.stock}`).join(" · ") : n === null ? "No stock limit" : `${n} in stock`}${p.sold ? ` · ${p.sold} sold` : ""}</span>
          ${p.onSale && !anyStock(p) ? '<span class="status open" style="align-self:flex-start">Sold out</span>' : p.onSale && n !== null && n <= 3 ? `<span class="status wait" style="align-self:flex-start">Only ${n} left</span>` : ""}
          <div class="row" style="justify-content:space-between;gap:8px"><label class="inline2" style="font-size:13px">${toggle(`ps-${p.id}`, p.onSale, `${p.name} on sale`)} On sale</label><button type="button" class="btn" data-prodedit="${p.id}">Edit</button></div></article>`; }).join("")}</div>`;
    }
    if (SHOP.tab === "orders") {
      const list = SHOP_ORDERS.filter((o) => SHOP.show === "all" || o.status === SHOP.show).sort((a, b) => b.at - a.at);
      body = `<div class="card"><div class="fbar">${[["waiting", "To hand over"], ["collected", "Collected"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, l]) => `<button type="button" class="pickchip" data-sosh="${k}" aria-pressed="${SHOP.show === k}">${l}</button>`).join("")}</div>${orderRows(list, true)}</div>
        <span class="hint">Clients order in the app and collect at the front desk. Front of House sees orders to hand over under Pickups.</span>`;
    }
    if (SHOP.tab === "giftcards") body = giftAdmin();
    return head("Shop", "Studio merch and gift cards that clients can buy in the app and collect at the front desk.", SHOP.tab === "products" ? `<button type="button" class="btn primary" id="prodNew">+ New product</button>` : "") + tabs + body;
  }
  function orderRows(list, admin) {
    return list.length ? `<div class="stack sorders">${list.map((o) => `<div class="sorder"><div class="cellp" style="min-width:0">${avatar(CLIENTS[o.ci], "sm")}<span style="min-width:0"><b>${esc(CLIENTS[o.ci].name)}</b> · Order ${o.no}<br><span class="muted" style="font-size:12.5px">${o.items.map(itemText).map(esc).join(", ")} · ${m$(soTotal(o))} · ${o.status === "collected" ? `collected ${fmtDay(o.collectedAt)}` : o.status === "cancelled" ? "cancelled" : o.paid ? "paid" : "pay when they collect"} · ordered ${fmtDay(o.at)}</span></span></div>
      ${o.status === "waiting" ? `<span class="inline2">${o.paid ? "" : '<span class="status open">Not paid yet</span>'}<button type="button" class="btn primary" data-socollect="${o.id}">${o.paid ? "Mark collected" : "Take payment and hand over"}</button>${admin ? `<button type="button" class="btn ghost" data-socancel="${o.id}">Cancel</button>` : ""}</span>` : `<span class="status ${o.status === "collected" ? "done" : "off"}">${o.status === "collected" ? "Collected" : "Cancelled"}</span>`}</div>`).join("")}</div>`
      : '<p class="muted" style="margin:0">Nothing here.</p>';
  }
  function bindOrders() {
    document.querySelectorAll("[data-socollect]").forEach((b) => (b.onclick = () => {
      const o = SHOP_ORDERS.find((x) => x.id === b.dataset.socollect);
      const inv = findInv((x) => x.ref?.shop === o.id);
      const done = () => { o.status = "collected"; o.collectedAt = NOW; renderNav(); render(); };
      if (o.paid) { done(); return toast(`Order ${o.no} handed to ${firstName(CLIENTS[o.ci].name)}.`); }
      payMethodModal(`Take ${m$(soTotal(o))} for order ${o.no}`, `${esc(CLIENTS[o.ci].name)}: ${o.items.map(itemText).map(esc).join(", ")}. They're emailed a receipt.`, (m) => { o.paid = true; if (inv) payInv(inv, m); done(); toast(`Paid by ${PAY_METHODS[m].toLowerCase()} and handed over.`); });
    }));
    document.querySelectorAll("[data-socancel]").forEach((b) => (b.onclick = () => {
      const o = SHOP_ORDERS.find((x) => x.id === b.dataset.socancel);
      const inv = findInv((x) => x.ref?.shop === o.id);
      confirmFlags([{ level: "confirm", title: `Cancel order ${o.no}?`, msg: `The items go back in stock and ${firstName(CLIENTS[o.ci].name)} is told by email.${o.paid ? ` They've already paid ${m$(soTotal(o))}, so refund them under Sales afterwards.` : ""}` }], { proceedLabel: "Cancel order", proceed: () => { o.status = "cancelled"; restockOrder(o); if (inv && !inv.paidAt) inv.void = true; renderNav(); render(); toast(`Order ${o.no} cancelled.`); } });
    }));
  }
  function openProduct(id) {
    const cur = id ? prodById(id) : null;
    const d = cur ? clone(cur) : { name: "", desc: "", price: 2000, photo: null, category: "", onSale: true, options: null, stock: null, sold: 0 };
    const paint = () => {
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="prForm" role="dialog" aria-modal="true" aria-labelledby="prT"><header><h2 id="prT">${cur ? `Edit ${esc(cur.name)}` : "New product"}</h2></header><div class="mb mform">
        <label class="fl">Name<input id="prName" maxlength="80" value="${esc(d.name)}" placeholder="e.g. Grip socks"></label>
        <label class="fl">Description <span class="h">(optional)</span><textarea id="prDesc" rows="2" maxlength="500">${esc(d.desc)}</textarea></label>
        <div class="two" style="grid-template-columns:1fr 1fr"><label class="fl">Price (${STUDIO.currency})<input id="prPrice" type="number" min="0" step="0.01" value="${(d.price / 100).toFixed(2)}"></label><label class="fl">Category <span class="h">(optional)</span><input id="prCat" maxlength="40" value="${esc(d.category)}" placeholder="e.g. Clothing" list="prCats"><datalist id="prCats">${[...new Set(PRODUCTS.map((p) => p.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label></div>
        <div class="fl">Photo<div class="row" style="gap:8px">${prodPhoto({ ...d, id: cur?.id || "pr0" }, "sm")}<label class="btn" style="cursor:pointer">${d.photo ? "Change photo" : "Add a photo"}<input type="file" id="prImg" accept="image/jpeg,image/png,image/webp" hidden></label>${d.photo ? '<button type="button" class="tagbtn" id="prImgX">Remove</button>' : ""}</div><span class="h">JPG, PNG or WebP, up to 2 MB. Square photos look best.</span></div>
        <label class="check"><input type="checkbox" id="prOpts" ${d.options ? "checked" : ""}> Comes in sizes or colours</label>
        ${d.options ? `<div class="fl">Sizes or colours, and how many you have<div class="stack" style="gap:6px">${d.options.map((o, i) => `<div class="row" style="gap:6px"><input data-oname="${i}" maxlength="30" value="${esc(o.name)}" placeholder="e.g. M or Black" aria-label="Option ${i + 1}" style="flex:1"><input data-ostock="${i}" type="number" min="0" value="${o.stock ?? ""}" placeholder="No limit" aria-label="Stock for option ${i + 1}" style="width:110px"><button type="button" class="iconbtn" data-odel="${i}" aria-label="Remove option ${i + 1}" ${d.options.length === 1 ? "disabled" : ""}>×</button></div>`).join("")}</div><button type="button" class="tagbtn" id="prOptAdd" style="align-self:flex-start">+ Add another</button></div>`
          : `<label class="fl">How many you have <span class="h">(leave empty for no limit)</span><input id="prStock" type="number" min="0" value="${d.stock ?? ""}" placeholder="No limit" style="max-width:160px"></label>`}
        <label class="check"><input type="checkbox" id="prOn" ${d.onSale ? "checked" : ""}> On sale (clients can see and order it)</label></div>
        <footer>${cur ? '<button type="button" class="btn ghost danger" id="prDel" style="margin-right:auto">Delete</button>' : ""}<button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">${cur ? "Save" : "Add product"}</button></footer></form></div>`;
      const keep = () => {
        d.name = $("#prName").value; d.desc = $("#prDesc").value; d.price = Math.round(Number($("#prPrice").value) * 100); d.category = $("#prCat").value.trim(); d.onSale = $("#prOn").checked;
        if (d.options) d.options = d.options.map((o, i) => ({ name: document.querySelector(`[data-oname="${i}"]`).value.trim(), stock: document.querySelector(`[data-ostock="${i}"]`).value === "" ? null : Math.max(0, Number(document.querySelector(`[data-ostock="${i}"]`).value)) }));
        else d.stock = $("#prStock").value === "" ? null : Math.max(0, Number($("#prStock").value));
      };
      $("#prOpts").onchange = (e) => { keep(); d.options = e.target.checked ? [{ name: "S", stock: null }, { name: "M", stock: null }, { name: "L", stock: null }] : null; paint(); };
      if ($("#prOptAdd")) $("#prOptAdd").onclick = () => { keep(); d.options.push({ name: "", stock: null }); paint(); };
      document.querySelectorAll("[data-odel]").forEach((b) => (b.onclick = () => { keep(); d.options.splice(Number(b.dataset.odel), 1); paint(); }));
      $("#prImg").onchange = (e) => { keep(); readImage(e.target, (url) => { d.photo = url; paint(); }); };
      if ($("#prImgX")) $("#prImgX").onclick = () => { keep(); d.photo = null; paint(); };
      if ($("#prDel")) $("#prDel").onclick = () => {
        const open = SHOP_ORDERS.filter((o) => o.status === "waiting" && o.items.some((i) => i.pid === cur.id));
        if (open.length) return toast(`${plural(open.length, "order is", "orders are")} still waiting to be collected with this. Hand ${open.length === 1 ? "it" : "them"} over or cancel first, or just take it off sale.`);
        confirmFlags([{ level: "confirm", title: `Delete ${cur.name}?`, msg: "It's removed from the Shop. Past orders and receipts keep it." }], { proceedLabel: "Delete", back: paint, proceed: () => { cur.deleted = true; PRODUCTS.splice(PRODUCTS.indexOf(cur), 1); render(); toast(`${cur.name} deleted.`); } });
      };
      $("#prForm").onsubmit = (e) => {
        e.preventDefault(); keep();
        if (!d.name.trim()) { $("#prName").focus(); return toast("Give the product a name."); }
        if (!(d.price >= 0)) return toast("Enter a price.");
        if (d.options && d.options.some((o) => !o.name)) return toast("Give every size or colour a name, or remove the empty one.");
        if (d.options && new Set(d.options.map((o) => o.name.toLowerCase())).size !== d.options.length) return toast("Each size or colour needs a different name.");
        d.name = d.name.trim();
        if (cur) Object.assign(cur, d); else PRODUCTS.push({ ...d, id: `pr${nextProdId++}` });
        closeModal(); renderNav(); render(); toast(cur ? "Saved." : `${d.name} added${d.onSale ? " to the Shop" : ". It's not on sale yet"}.`);
      };
    };
    paint();
  }

  function clientShop() {
    const me = ME.client;
    if (!shopVisible()) return head("Shop", "") + alertBox("info", "", "The studio's shop is empty right now.");
    const products = onSaleProducts();
    const tabs = products.length && GC.on ? `<div class="tabs" role="tablist">${[["merch", "Merch"], ["gifts", "Gift cards"]].map(([k, l]) => `<button type="button" role="tab" data-cshtab="${k}" aria-selected="${SHOP.ctab === k}">${l}</button>`).join("")}</div>` : "";
    const tab = !products.length ? "gifts" : !GC.on ? "merch" : SHOP.ctab;
    if (tab === "gifts") {
      const gc = PAGES["gift-cards"]().replace(/^<div class="pagehead">[\s\S]*?<div class="actions">[\s\S]*?<\/div><\/div>/, "");
      return head("Shop", "Gifts and studio merch, to collect at the front desk.") + tabs + gc;
    }
    const credit = GIFT_CREDIT[me] || 0;
    const sub = SHOP.basket.reduce((a, i) => a + i.qty * prodById(i.pid).price, 0);
    const useCr = SHOP.useCredit ? Math.min(credit, sub) : 0;
    const mineOpen = SHOP_ORDERS.filter((o) => o.ci === me && o.status === "waiting");
    const basket = `<aside class="card basket"><h3>Your basket</h3>${SHOP.basket.length ? `<ul class="bklist">${SHOP.basket.map((i, k) => `<li class="row" style="justify-content:space-between;gap:8px"><span>${esc(itemText(i))}</span><span class="inline2"><b>${m$(i.qty * prodById(i.pid).price)}</b><button type="button" class="iconbtn" data-bkdel="${k}" aria-label="Remove ${esc(itemText(i))}">×</button></span></li>`).join("")}</ul>
        ${credit ? `<label class="check"><input type="checkbox" id="bkCr" ${SHOP.useCredit ? "checked" : ""}> Use my studio credit (${m$(credit)})</label>` : ""}
        <div class="row" style="justify-content:space-between"><b>To pay</b><b style="font-family:var(--display);font-size:20px">${m$(sub - useCr)}</b></div>
        <button type="button" class="btn primary" id="bkPlace" style="justify-content:center">Place order</button><span class="hint">${sub - useCr > 0 ? "Pay at the front desk when you collect it." : "Paid with your credit. Collect it at the front desk."}</span>` : '<span class="muted" style="font-size:13px">Nothing yet. Add something from the shop.</span>'}</aside>`;
    return head("Shop", "Gifts and studio merch, to collect at the front desk.") + tabs +
      (mineOpen.length ? alertBox("info", "Ready to collect", mineOpen.map((o) => `Order ${o.no}: ${esc(o.items.map(itemText).join(", "))}. Show this at the front desk${o.paid ? "" : ` and pay ${m$(soTotal(o))}`}.`).join("<br>")) : "") +
      `<div class="shoplayout"><div class="prodgrid">${products.map((p) => {
        const sel = SHOP.sel[p.id] || (p.options ? p.options.find((o) => o.stock === null || o.stock > 0)?.name : null);
        const ok = anyStock(p) && (!p.options || (sel && inStock(p, sel)));
        const n = p.options ? (sel ? stockOf(p, sel) : 0) : p.stock;
        return `<article class="card prodcard">${prodPhoto(p)}<div class="row" style="justify-content:space-between;gap:8px"><b>${esc(p.name)}</b><b>${m$(p.price)}</b></div>
          ${p.desc ? `<span class="muted" style="font-size:12.5px">${esc(p.desc)}</span>` : ""}
          ${p.options ? `<div class="optchips" role="group" aria-label="Size or colour">${p.options.map((o) => `<button type="button" data-psel="${p.id}:${esc(o.name)}" aria-pressed="${sel === o.name}" ${o.stock === 0 ? 'disabled aria-label="' + esc(o.name) + ', sold out"' : ""}>${esc(o.name)}</button>`).join("")}</div>` : ""}
          ${!anyStock(p) ? '<span class="status off" style="align-self:flex-start">Sold out</span>' : n !== null && n <= 3 ? `<span class="hint">Only ${n} left</span>` : ""}
          <button type="button" class="btn" data-padd="${p.id}" ${ok ? "" : "disabled"}>Add to basket</button></article>`;
      }).join("")}</div>${basket}</div>`;
  }

  BIND.shop = function () {
    document.querySelectorAll("[data-shtab]").forEach((b) => (b.onclick = () => { SHOP.tab = b.dataset.shtab; render(); }));
    document.querySelectorAll("[data-cshtab]").forEach((b) => (b.onclick = () => { SHOP.ctab = b.dataset.cshtab; render(); }));
    if (state.role === "client") {
      if (SHOP.ctab === "gifts" || !onSaleProducts().length) { BIND["gift-cards"]?.(); return; }
      document.querySelectorAll("[data-psel]").forEach((b) => (b.onclick = () => { const [pid, opt] = b.dataset.psel.split(":"); SHOP.sel[pid] = opt; render(); }));
      document.querySelectorAll("[data-padd]").forEach((b) => (b.onclick = () => {
        const p = prodById(b.dataset.padd), opt = p.options ? SHOP.sel[p.id] || p.options.find((o) => o.stock === null || o.stock > 0)?.name : null;
        const line = SHOP.basket.find((i) => i.pid === p.id && i.option === opt);
        if (!inStock(p, opt, (line?.qty || 0) + 1)) return toast(`Sorry, there aren't any more${opt ? ` in ${opt}` : ""}.`);
        if (line) line.qty++; else SHOP.basket.push({ pid: p.id, option: opt, qty: 1 });
        render(); toast(`${p.name}${opt ? ` (${opt})` : ""} added.`);
      }));
      document.querySelectorAll("[data-bkdel]").forEach((b) => (b.onclick = () => { SHOP.basket.splice(Number(b.dataset.bkdel), 1); render(); }));
      if ($("#bkCr")) $("#bkCr").onchange = (e) => { SHOP.useCredit = e.target.checked; render(); };
      if ($("#bkPlace")) $("#bkPlace").onclick = () => {
        const me = ME.client;
        const short = SHOP.basket.find((i) => !inStock(prodById(i.pid), i.option, i.qty));
        if (short) return toast(`Sorry, ${itemText(short)} just sold out. Remove it to carry on.`);
        const items = SHOP.basket.map((i) => ({ ...i, price: prodById(i.pid).price }));
        const sub = items.reduce((a, i) => a + i.qty * i.price, 0);
        const credit = SHOP.useCredit ? Math.min(GIFT_CREDIT[me] || 0, sub) : 0;
        const o = { id: `so${nextSoNo}`, no: nextSoNo++, ci: me, items, credit, status: "waiting", paid: sub - credit === 0, at: NOW };
        items.forEach((i) => { const p = prodById(i.pid); takeStock(p, i.option, i.qty); p.sold = (p.sold || 0) + i.qty; });
        if (credit) GIFT_CREDIT[me] -= credit;
        SHOP_ORDERS.push(o);
        issue({ ci: me, source: "product", issued: NOW, paidAt: o.paid ? NOW : null, method: o.paid ? "credit" : null, creditUsed: credit, lines: items.map((i) => ({ desc: itemText({ ...i, qty: 1 }), qty: i.qty, unit: i.price })), ref: { shop: o.id } });
        SHOP.basket = []; renderNav(); render();
        toast(o.paid ? `Order ${o.no} placed and paid with your credit. Collect it at the front desk.` : `Order ${o.no} placed. Pay ${m$(sub - credit)} when you collect it at the front desk.`);
      };
      return;
    }
    if ($("#prodNew")) $("#prodNew").onclick = () => openProduct(null);
    document.querySelectorAll("[data-prodedit]").forEach((b) => (b.onclick = () => openProduct(b.dataset.prodedit)));
    PRODUCTS.forEach((p) => { const t = $(`#ps-${p.id}`); if (t) t.onchange = (e) => { p.onSale = e.target.checked; renderNav(); render(); toast(p.onSale ? `${p.name} is on sale.` : `${p.name} is off sale. Orders already placed still go ahead.`); }; });
    document.querySelectorAll("[data-sosh]").forEach((b) => (b.onclick = () => { SHOP.show = b.dataset.sosh; render(); }));
    bindOrders();
    if (SHOP.tab === "giftcards") { bindGiftAdmin(); if ($("#gcOn")) { const prev = $("#gcOn").onchange; $("#gcOn").onchange = (e) => { prev(e); renderNav(); }; } }
  };

  // Front of House: shop orders and rewards to hand over, in one place.
  PAGES.pickups = function () {
    const orders = SHOP_ORDERS.filter((o) => o.status === "waiting");
    const rewards = LOY_PICKUPS.filter((x) => x.status === "waiting");
    return head("Pickups", "Shop orders and rewards to hand over at the desk. Check the client's name or code, hand it over, then mark it done.") +
      `<div class="card"><h3>Shop orders${orders.length ? ` · ${orders.length}` : ""}</h3>${orderRows(orders, false)}</div>
      <div class="card"><h3>Rewards${rewards.length ? ` · ${rewards.length}` : ""}</h3>${rewards.length ? pickupRows(rewards) : '<span class="muted">Nothing waiting to be handed over.</span>'}</div>`;
  };
  BIND.pickups = () => { bindPickups(); bindOrders(); };

  // --- Writing agents: announcements and campaign emails, from a short brief ----------------
  const credLeft = () => Math.max(0, agState.allowance - agState.used) + agState.topUps;
  function spendCredits(n) {
    if (credLeft() < n) { toast(`This needs ${plural(n, "AI credit")} and your studio has ${credLeft()} left this month. Top up under Agents, Usage.`); return false; }
    for (let i = 0; i < n; i++) { if (agState.used < agState.allowance) agState.used++; else agState.topUps--; }
    return true;
  }
  const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  /** A stand-in for the writer in this preview. The real one writes from the brief with the studio's own examples. */
  function draftAnnouncement(brief) {
    const b = brief.trim().replace(/\s+/g, " ");
    const loc = Object.values(LOCS).find((l) => b.toLowerCase().includes(l.toLowerCase().split(" ")[0])) || "";
    if (/lift|elevator/i.test(b)) return { title: `Lift out of order${loc ? ` at ${loc}` : ""}`, message: `The lift${loc ? ` at ${loc}` : ""} is being repaired. Please take the stairs, and give yourself a few extra minutes to get to class.`, importance: "important" };
    if (/closed|closure|holiday|shut/i.test(b)) return { title: `Studio closed on [date]`, message: `We're closed on [date]${/holiday/i.test(b) ? " for the public holiday" : ""}. Classes that day are cancelled and your class credit is back on your package. See you when we reopen!`, importance: "important" };
    if (/aircon|air-con|air con|power|water|parking|renovat/i.test(b)) return { title: cap1(b.split(/[,.]/)[0]).slice(0, 60), message: `Heads up: ${b.replace(/\.$/, "")}. We're sorry for the trouble and will let you know as soon as it's sorted.`, importance: "important" };
    if (/new class|launch|introduc|starting/i.test(b)) return { title: `New: ${cap1(b.replace(/^(new class|launch(ing)?|introducing)\s*:?\s*/i, "")).slice(0, 50)}`, message: `${cap1(b.replace(/\.$/, ""))}. Classes start on [date] and you can book now in the app.`, importance: "info" };
    return { title: cap1(b.split(/[,.]/)[0]).slice(0, 60), message: `${cap1(b.replace(/\.$/, ""))}. [Add any details clients need, like the date or time.]`, importance: "info" };
  }
  function draftCampaign(brief) {
    const b = brief.trim().replace(/\s+/g, " ");
    const type = Object.values(TYPES).find((t) => b.toLowerCase().includes(t.name.toLowerCase().split(" ")[0].toLowerCase()))?.name || "a class";
    const month = (b.match(/january|february|march|april|may|june|july|august|september|october|november|december/i) || [""])[0];
    const friend = /friend|bring/i.test(b);
    return {
      name: cap1(b.split(/[,.]/)[0]).slice(0, 60),
      subject: friend ? `Bring a friend to ${type}${month ? ` this ${cap1(month)}` : ""}` : `Your next ${type} class${month ? ` this ${cap1(month)}` : ""}`,
      preheader: friend ? "Twice the fun, and [offer] for both of you." : "A little something to get you back on the mat.",
      heading: friend ? `Hi {{first_name}}, bring a friend${month ? ` this ${cap1(month)}` : ""}` : `Hi {{first_name}}, we've saved you a spot`,
      paragraphs: [friend ? `Book ${type} for you and a friend, and you both get **[offer]**.` : `${cap1(b.replace(/\.$/, ""))}. [Add the offer or details.]`, "- 50 minutes\n- All levels welcome\n- [Location and times]", "Spots go quickly, so book early."],
      button: "Book a class",
    };
  }
  function writersTab() {
    return `<div class="adsgrid"><div class="card"><h3>Announcement writer</h3><p style="margin:0">Turns a quick note (“lift broken at Tanjong Pagar, use stairs”) into a clear announcement for the app. <b>1 AI credit</b> per draft.</p><div class="row"><button type="button" class="btn primary" data-wgo="announcements">Write an announcement</button></div></div>
      <div class="card"><h3>Campaign drafter</h3><p style="margin:0">Drafts a marketing email in your studio's look, with a campaign ready to send to the audience you choose. <b>3 AI credits</b> per draft.</p><div class="row"><button type="button" class="btn primary" data-wgo="campaigns">Draft a campaign</button></div></div></div>
      <div class="card"><h3>How the writers work</h3><ul class="agul"><li>They write in your studio's voice, using your recent announcements and emails as examples.</li><li>They only use facts you give them. Anything missing, like a date or a price, is left as a [placeholder] for you to fill in.</li><li>They always make a draft. Nothing is posted or sent until someone checks it and presses the button.</li><li>They see your class and location names, never client names, contact details or payments.</li><li>They use the studio's AI credits (${credLeft()} left this month). Reminder agents don't.</li></ul>
        <span class="hint">Who can use them: anyone who can post announcements (owners, admins and Front of House) for the announcement writer; owners and admins for the campaign drafter.</span></div>`;
  }
  {
    const bind = BIND.agents;
    BIND.agents = function () {
      bind?.call(this);
      document.querySelectorAll("[data-wgo]").forEach((b) => (b.onclick = () => { if (b.dataset.wgo === "campaigns") { state.mtab = "campaigns"; go("marketing"); setTimeout(openCampaignDrafter, 0); } else { state.annWriter = true; go("announcements"); } }));
    };
  }
  {
    const page = PAGES.announcements, bind = BIND.announcements;
    PAGES.announcements = function () {
      const out = page.call(this);
      const w = state.annBrief ?? "";
      const box = `<div class="card writer"><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><h3 style="margin:0">✦ Write it for me</h3><span class="muted" style="font-size:12.5px">1 AI credit · ${credLeft()} left</span></div>
        <label class="fl">What's it about? <span class="h">A sentence or two is plenty.</span><textarea id="wrBrief" rows="2" maxlength="1000" placeholder="e.g. lift broken at Tanjong Pagar today, use the stairs">${esc(w)}</textarea></label>
        <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="wrGo">Write a draft</button><span class="hint">It fills in the form below for you to check. Nothing is posted until you press Post.</span></div></div>`;
      return out.replace('<form class="card mform" id="annForm">', `${box}<form class="card mform" id="annForm">`);
    };
    BIND.announcements = function () {
      bind?.call(this);
      if (state.annWriter) { state.annWriter = false; setTimeout(() => $("#wrBrief")?.focus(), 0); }
      $("#wrBrief").oninput = (e) => (state.annBrief = e.target.value);
      $("#wrGo").onclick = () => {
        const brief = $("#wrBrief").value.trim();
        if (brief.length < 5) { $("#wrBrief").focus(); return toast("Tell the writer what it's about (a sentence or two is plenty)."); }
        if (!spendCredits(1)) return;
        const d = draftAnnouncement(brief);
        Object.assign(state.ann, { title: d.title, message: d.message, importance: d.importance });
        render(); setTimeout(() => $("#anT")?.focus(), 0);
        toast(`Draft ready.${/\[/.test(d.message + d.title) ? " Fill in anything in [brackets]," : ""} Check it, then post it.`);
      };
    };
  }
  function openCampaignDrafter() {
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal" id="cdForm" role="dialog" aria-modal="true" aria-labelledby="cdT"><header><h2 id="cdT">Draft a campaign with AI</h2></header><div class="mb mform">
      <label class="fl">What's the campaign about?<textarea id="cdBrief" rows="3" maxlength="1000" placeholder="e.g. intro offer for December, Reformer, bring a friend and both get 20% off"></textarea><span class="h">Mention the offer, dates and who it's for. Anything you leave out becomes a [placeholder].</span></label>
      <label class="fl">Who it's for<select id="cdSeg"><option value="">Everyone who's agreed to marketing emails</option>${SEGMENTS.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select></label>
      <span class="hint">Uses 3 AI credits (${credLeft()} left). It drafts the email in your latest email's colours and fonts, plus a campaign. Nothing is sent until you check it and press Send.</span></div>
      <footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">Write the draft</button></footer></form></div>`;
    setTimeout(() => $("#cdBrief")?.focus(), 0);
    $("#cdForm").onsubmit = (e) => {
      e.preventDefault();
      const brief = $("#cdBrief").value.trim(), segId = $("#cdSeg").value || null;
      if (brief.length < 5) { $("#cdBrief").focus(); return toast("Tell the drafter what the campaign is about."); }
      if (!spendCredits(3)) return;
      const d = draftCampaign(brief);
      const last = EMAILS.filter((x) => x.purpose === "marketing").at(-1);
      const id = `e${EMAILS.length + 1}${Date.now() % 1000}`;
      EMAILS.push({ id, name: d.name, category: "Promotions", purpose: "marketing", updated: "Just now", design: { subject: d.subject, preheader: d.preheader, theme: { ...(last?.design.theme || THEME0) }, blocks: [
        { type: "heading", text: d.heading, level: 1, align: "left" },
        ...d.paragraphs.map((t) => ({ type: "text", text: t, align: "left" })),
        { type: "button", label: d.button, url: "https://app.example.com/schedule", align: "left", style: "filled" } ] } });
      CAMPAIGNS.unshift({ id: `cp${nextCampId++}`, name: d.name, emailId: id, emailName: d.name, segId, status: "draft", when: "Not sent", recipients: 0, skipped: 0 });
      closeModal(); state.mtab = "campaigns"; render();
      toast("Drafted, not sent. Open the email to check it and fill in anything in [brackets], then press Send.");
    };
  }
  {
    const page = PAGES.marketing, bind = BIND.marketing;
    PAGES.marketing = function () {
      return page.call(this).replace('<button type="button" class="btn primary" id="mNewCamp">New campaign</button>', '<button type="button" class="btn" id="mDraftCamp" data-help="Describe the campaign in a sentence or two and get a draft email and campaign to check. Uses 3 AI credits.">✦ Draft with AI</button><button type="button" class="btn primary" id="mNewCamp">New campaign</button>');
    };
    BIND.marketing = function () {
      bind?.call(this);
      if ($("#mDraftCamp")) $("#mDraftCamp").onclick = openCampaignDrafter;
      document.querySelectorAll("[data-csend]").forEach((b) => (b.onclick = () => { const c = CAMPAIGNS.find((x) => x.id === b.dataset.csend); openCampaign({ name: c.name, emailId: c.emailId, segId: c.segId, draftId: c.id }); }));
    };
  }

  // --- Report exports: raw data (CSV) and a visual one-pager -------------------------------
  const csvCell = (v) => { let t = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const toCsv = (rows) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const rptRange = () => { const days = state.rDays || 30; return { days, from: addDays(NOW, -days), to: NOW }; };
  const zoomState = () => state.rZoom || { type: "", loc: "", instr: "", days: [], band: "" };
  function rptFilterWords() {
    const { days } = rptRange(), z = zoomState(), tab = state.rTab || "overview";
    const w = [`Last ${RPERIODS.find(([d]) => d === days)?.[1] || `${days} days`}`];
    if (tab === "classes" && zoomOn(z)) w.push(zoomWords(z));
    if (tab === "instructors" && state.rInstr) w.push(STAFF[state.rInstr]);
    return w;
  }
  function csvRows(tab) {
    const { from, to } = rptRange();
    const cur = rangeStats(from, to);
    const dstr = (d) => ymd(d);
    if (tab === "classes" || tab === "instructors") {
      let cls = cur.days.flatMap(({ d, x }) => x.classes.map((c) => ({ ...c, date: d })));
      if (tab === "classes" && zoomOn(zoomState())) cls = zoomed(zoomState(), cls);
      if (tab === "instructors" && state.rInstr) cls = cls.filter((c) => c.instr === state.rInstr);
      return [["Date", "Day", "Time", "Class", "Kind", "Location", "Instructor", "Cover", "Spots", "Booked", "Came", "No-shows", "Full %", "Cancelled"],
        ...cls.map((c) => [dstr(c.date), DOW[c.dow], c.hhmm, TYPES[c.type]?.name, TYPES[c.type]?.kind === "appointment" ? "Appointment" : "Class", LOCS[c.loc], STAFF[c.instr] || "", c.cover ? "Yes" : "No", c.cap, c.booked, c.present, c.noShow, c.cap ? Math.round((c.booked / c.cap) * 100) : 0, c.cancelled ? (c.auto ? "Auto (too few booked)" : "Yes") : "No"])];
    }
    if (tab === "sales") {
      syncInvoices();
      const rows = INV.list.filter((x) => (x.paidAt && x.paidAt >= from) || x.issued >= from || x.refunds.some((r) => r.at >= from)).sort((a, b) => a.issued - b.issued);
      return [["Invoice", "Receipt", "Issued", "Paid", "Client", "What", "Type", "Total", "Refunded", "Status", "Paid by"],
        ...rows.map((x) => [x.no, x.rct || "", dstr(x.issued), x.paidAt ? dstr(x.paidAt) : "", clientOf(x).name, x.lines.map((l) => `${l.desc}${l.qty > 1 ? ` x${l.qty}` : ""}`).join("; "), INV_SOURCES[x.source], (invTotal(x) / 100).toFixed(2), (invRefunded(x) / 100).toFixed(2), INV_STATUS[invStatus(x)][0], x.method ? PAY_METHODS[x.method] : ""])];
    }
    if (tab === "clients") return [["Client", "Joined via", "Classes attended", "Has a package"], ...CLIENTS.map((c, i) => [c.name, c.source === "classpass" ? "ClassPass" : "Direct", c.attended ?? "", CPKG.some((p) => p.owner === i && ["active", "not_started", "held"].includes(pkgState(p))) ? "Yes" : "No"])];
    if (tab === "conversion") return [["Lead", "Source", "Status", "Days since enquiry", "Spent"], ...LEADS.map((l) => [`${l.first} ${l.last}`.trim(), SRC[l.source] || l.source, l.status, l.days, l.cents ? (l.cents / 100).toFixed(2) : ""])];
    return [["Date", "Money in", "Packages", "Gift cards", "Fees", "Refunds", "Classes held", "Booked", "Came", "New clients"],
      ...cur.days.map(({ d, x }) => { const held = x.classes.filter((c) => !c.cancelled); return [dstr(d), ((x.money.packages + x.money.gift + x.money.fees - x.money.refunds) / 100).toFixed(2), (x.money.packages / 100).toFixed(2), (x.money.gift / 100).toFixed(2), (x.money.fees / 100).toFixed(2), (x.money.refunds / 100).toFixed(2), held.length, held.reduce((a, c) => a + c.booked, 0), held.reduce((a, c) => a + c.present, 0), x.newClients]; })];
  }
  // In the claude.ai viewer, files are offered through its downloads capability; opened as a plain file, a normal download link works.
  let dlCap = null;
  async function offerFile(filename, data, type) {
    if (!dlCap) dlCap = window.claude?.use ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);
    const dl = await dlCap;
    if (dl) {
      try { await dl.save({ filename, data }); return "saved"; }
      catch (e) { if (e?.code === "declined") return "declined"; if (e?.code === "rate_limited") return "busy"; }
    }
    try {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return "saved";
    } catch { return "failed"; }
  }
  async function exportCsv() {
    const tab = state.rTab || "overview";
    const rows = csvRows(tab);
    const name = `${tab}-${ymd(rptRange().from)}-to-${ymd(NOW)}.csv`;
    const r = await offerFile(name, toCsv(rows), "text/csv;charset=utf-8");
    if (r === "saved") return toast(`Downloaded ${name} (${plural(rows.length - 1, "row")}).`);
    if (r === "busy") return toast("A download is already waiting for you to confirm.");
    if (r === "declined") return;
    navigator.clipboard?.writeText(toCsv(rows)).then(() => toast("Copied the CSV. Paste it into a spreadsheet."), () => toast("Your browser didn't allow the download."));
  }
  function visualReport() {
    const tab = state.rTab || "overview", { days, from, to } = rptRange();
    const cur = rangeStats(from, to), prev = rangeStats(addDays(from, -days), from);
    const rt = RTABS.find(([k]) => k === tab)[1];
    const z = zoomState();
    const cls = tab === "classes" && zoomOn(z) ? zoomStats(zoomed(z, cur.classes)) : null;
    const kpis = tab === "sales"
      ? [["Money in", mWhole(cur.nett), chg(cur.nett, prev.nett)], ["Packages sold", String(cur.sold.length), chg(cur.sold.length, prev.sold.length)], ["Gift cards", mWhole(cur.money.gift), chg(cur.money.gift, prev.money.gift)], ["Refunded", mWhole(cur.money.refunds), chg(cur.money.refunds, prev.money.refunds, { goodUp: false })]]
      : tab === "classes" ? [["Classes held", String((cls || cur).held.length), cls ? null : chg(cur.held.length, prev.held.length)], ["How full", `${(cls || cur).fill}%`, cls ? null : chg(cur.fill, prev.fill, { isPct: true })], ["Visits", String((cls || cur).visits), cls ? null : chg(cur.visits, prev.visits)], ["No-shows", `${(cls || cur).noShow}%`, cls ? null : chg(cur.noShow, prev.noShow, { isPct: true, goodUp: false })]]
        : [["Money in", mWhole(cur.nett), chg(cur.nett, prev.nett)], ["Clients who came", String(cur.active), chg(cur.active, prev.active)], ["New clients", String(cur.newClients), chg(cur.newClients, prev.newClients)], ["How full", `${cur.fill}%`, chg(cur.fill, prev.fill, { isPct: true })]];
    // Money by week (or month), as columns.
    const monthly = days > 90, buckets = [];
    for (const { d, x } of cur.days) { const k = monthly ? `${d.getFullYear()}-${d.getMonth()}` : ymd(startOfWeek(d)); let b = buckets.find((y) => y.k === k); if (!b) buckets.push((b = { k, label: monthly ? d.toLocaleDateString("en-GB", { month: "short" }) : fmtShortDay(startOfWeek(d)), v: 0 })); b.v += x.money.packages + x.money.gift + x.money.fees - x.money.refunds; }
    const max = Math.max(1, ...buckets.map((b) => b.v));
    const columns = `<div class="vrcols">${buckets.map((b) => `<div class="vrcol"><span class="vrbar" style="height:${Math.max(3, (b.v / max) * 100)}%"></span><span class="vrcl">${esc(b.label)}</span></div>`).join("")}</div>`;
    // Fullness by class type, as bars.
    const held = cls ? cls.held : cur.held;
    const byType = Object.entries(TYPES).map(([k, t]) => { const h = held.filter((c) => c.type === k); return { name: t.name, color: t.color, n: h.length, fill: pctOf(h.reduce((a, c) => a + c.booked, 0), h.reduce((a, c) => a + c.cap, 0)) }; }).filter((x) => x.n).sort((a, b) => b.fill - a.fill);
    const bars = `<div class="vrbars">${byType.map((x) => `<div class="vrrow"><span>${esc(x.name)}</span><span class="vrtrack"><span style="width:${x.fill}%;background:${x.color}"></span></span><b>${x.fill}%</b></div>`).join("")}</div>`;
    // When it's busiest: weekday by time of day.
    const heat = `<table class="vrheat"><thead><tr><th></th>${BANDS.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${ZDAYS.map(([d, n]) => `<tr><th>${n}</th>${BANDS.map(([b]) => { const h = held.filter((c) => c.dow === d && bandOf(c.hhmm) === b); const f = pctOf(h.reduce((a, c) => a + c.booked, 0), h.reduce((a, c) => a + c.cap, 0)); return `<td style="--f:${h.length ? f / 100 : 0}">${h.length ? `${Math.round(f)}%` : "–"}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
    const sl = slots(held);
    const best = sl.slice(0, 3).map((x) => `<li><b>${esc(x.label)}</b> · ${x.fill}% full</li>`).join("");
    const parts = [["Packages", cur.money.packages], ["Gift cards", cur.money.gift], ["Fees", cur.money.fees]];
    const gross = parts.reduce((a, [, v]) => a + v, 0);
    const mix = `<div class="vrmix">${parts.map(([l, v], i) => `<span style="flex:${Math.max(1, v)};background:${["#0C6156", "#7c3aed", "#b45309"][i]}" title="${esc(l)}"></span>`).join("")}</div><div class="vrkey">${parts.map(([l, v], i) => `<span><i style="background:${["#0C6156", "#7c3aed", "#b45309"][i]}"></i>${esc(l)} ${pctOf(v, gross)}%</span>`).join("")}</div>`;
    const cards = tab === "sales" ? [["Money in each " + (monthly ? "month" : "week"), columns], ["Where the money came from", mix]]
      : tab === "classes" || tab === "instructors" ? [["How full each class was", bars], ["When classes are busiest", heat], ["Fullest regular classes", `<ul class="vrlist">${best || "<li>Not enough classes yet.</li>"}</ul>`]]
        : [["Money in each " + (monthly ? "month" : "week"), columns], ["How full each class was", bars], ["When classes are busiest", heat]];
    const summary = rSummary(kpis.filter(([, , c]) => c).map(([l, , c]) => [l, c]), days);
    const range = `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} – ${to.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
    return `<div class="vreport" style="--vr:${esc(INV.settings.accentColor)}"><header class="vrhead"><div><span class="vrkicker">${esc(INV.settings.businessName.replace(/ Pte\.? Ltd\.?$/i, ""))} · ${esc(rt)} report</span><h1>${esc(range)}</h1><div class="vrchips">${rptFilterWords().map((w) => `<span>${esc(w)}</span>`).join("")}</div></div></header>
      <div class="vrkpis">${kpis.map(([l, v, c]) => `<div class="vrkpi"><span>${esc(l)}</span><b>${esc(v)}</b>${c ? `<em class="${c.good === null ? "" : c.good ? "good" : "bad"}">${esc(c.text)}</em>` : ""}</div>`).join("")}</div>
      <p class="vrsum">${esc(summary)}</p>
      <div class="vrgrid">${cards.map(([h, x]) => `<section class="vrcard"><h2>${esc(h)}</h2>${x}</section>`).join("")}</div>
      <footer class="vrfoot">Made ${NOW.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · compared with the ${days === 365 ? "year" : `${days} days`} before</footer></div>`;
  }
  function openExport() {
    const tab = state.rTab || "overview";
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal" role="dialog" aria-modal="true" aria-labelledby="exT" style="width:min(480px,100%)"><header><h2 id="exT">Export this report</h2></header><div class="mb">
      <span class="hint">Uses what you're looking at: the ${esc(RTABS.find(([k]) => k === tab)[1])} tab, ${esc(rptFilterWords().join(", ").replace(/^L/, "l"))}.</span>
      <div class="exopts"><button type="button" class="exopt" id="exCsv"><b>Raw data (CSV)</b><span>Every row behind the numbers, for Excel, Google Sheets or your accountant.${tab === "clients" ? " No contact details are included." : ""}</span></button>
        <button type="button" class="exopt" id="exVis"><b>Visual report</b><span>A clean one-page summary with the key numbers and charts. Print it or save it as a PDF to share.</span></button></div></div>
      <footer><button type="button" class="btn ghost" data-mclose>Cancel</button></footer></div></div>`;
    $("#exCsv").onclick = () => { closeModal(); exportCsv(); };
    $("#exVis").onclick = () => {
      const html = visualReport();
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal vrmodal" role="dialog" aria-modal="true" aria-label="Visual report"><div class="mb">${html}</div><footer><button type="button" class="btn ghost" data-mclose>Close</button><button type="button" class="btn primary" id="vrPrint">Print or save as PDF</button></footer></div></div>`;
      $("#vrPrint").onclick = () => printDoc(html, `${RTABS.find(([k]) => k === tab)[1]} report`);
    };
  }
  {
    const page = PAGES.reports, bind = BIND.reports;
    PAGES.reports = function () {
      return page.call(this).replace('<div class="actions"></div></div>', '<div class="actions"><button type="button" class="btn" id="rExport" data-help="Download the raw data as a CSV, or make a one-page visual report to print or share.">Export</button></div></div>');
    };
    BIND.reports = function () { bind?.call(this); if ($("#rExport")) $("#rExport").onclick = openExport; };
  }

  // --- Menu -----------------------------------------------------------------------------
  NAV.push(
    { id: "sales", roles: ["admin"], label: "Sales", help: "Every sale with its invoice and receipt: take payments, email receipts, give refunds, and design your invoices.", count: () => INV.list.filter((x) => invStatus(x) === "open" && x.source !== "fee").length },
    { id: "shop", roles: ["admin", "client"], label: "Shop", help: "Studio merch and gift cards clients can buy in the app and collect at the desk.", get hidden() { return state.role === "client" && !shopVisible(); }, count: () => (state.role === "client" ? 0 : SHOP_ORDERS.filter((o) => o.status === "waiting").length) },
  );
  {
    const gc = NAV.find((n) => n.id === "gift-cards"); if (gc) gc.hidden = true; // Gift cards live in the Shop now.
    const pu = NAV.find((n) => n.id === "pickups"); if (pu) Object.assign(pu, { label: "Pickups", help: "Shop orders and rewards to hand over at the desk.", count: () => LOY_PICKUPS.filter((x) => x.status === "waiting").length + SHOP_ORDERS.filter((o) => o.status === "waiting").length });
    const cm = NAV.find((n) => n.id === "comms"); if (cm) cm.help = "Read and answer client messages from WhatsApp and email (Gmail or Outlook), in one inbox.";
    const mk = NAV.find((n) => n.id === "marketing"); if (mk) mk.help = "Journeys that run by themselves, emails, campaigns, segments, banners and referrals.";
  }
  for (const n of NAV) { const id = n.id; n.group = (role) => navGroup(id, role); }
  NAV.sort((a, b) => navRank(a.id, "admin") - navRank(b.id, "admin"));
