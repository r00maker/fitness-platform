  // ===========================================================================
  // Quick view for attachments (e.g. a physio's note on an extension request), on the page:
  // PDFs are drawn page by page with pdf.js, photos shown as they are. Nothing opens in a new
  // window. The API keeps serving PDFs as downloads; the app fetches the file and draws it.
  // Also: the studio's waitlist setting (clients choose, or one way for everyone).
  // ===========================================================================
  const PDFJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
  let pdfjsReady = null;
  /** pdf.js loads only when someone opens a PDF. Its worker runs on the page (no separate worker file to fetch). */
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsReady) {
      const add = (src) => new Promise((ok, fail) => { const el = document.createElement("script"); el.src = src; el.onload = ok; el.onerror = () => fail(new Error("load")); document.head.appendChild(el); });
      pdfjsReady = add(`${PDFJS_BASE}/pdf.worker.min.js`).then(() => add(`${PDFJS_BASE}/pdf.min.js`)).then(() => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
        return window.pdfjsLib;
      }).catch((e) => { pdfjsReady = null; throw e; });
    }
    return pdfjsReady;
  }

  // --- A real sample PDF for the sample request, made here so the preview needs no files ---
  function samplePdf(pages) {
    const esc_ = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
    const stream = (lines) => {
      const out = ["0.05 0.38 0.34 RG 2 w 60 764 m 535 764 l S"];
      let y = 795;
      for (const [size, bold, text, gap] of lines) {
        y -= gap ?? size + 8;
        out.push(`BT /${bold ? "F2" : "F1"} ${size} Tf 60 ${y} Td (${esc_(text)}) Tj ET`);
      }
      return out.join("\n");
    };
    const objs = ["<</Type/Catalog/Pages 2 0 R>>", "", "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>", "<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>"];
    const kids = [];
    for (const lines of pages) {
      const body = stream(lines);
      objs.push(`<</Length ${body.length}>>\nstream\n${body}\nendstream`);
      objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>/Contents ${objs.length} 0 R>>`);
      kids.push(`${objs.length} 0 R`);
    }
    objs[1] = `<</Type/Pages/Kids[${kids.join(" ")}]/Count ${kids.length}>>`;
    let pdf = "%PDF-1.4\n";
    const at = [];
    objs.forEach((o, i) => { at.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${at.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
    return new Uint8Array([...pdf].map((c) => c.charCodeAt(0)));
  }
  const PHYSIO_NOTE = () => samplePdf([
    [[20, true, "Bukit Timah Physio Clinic", 0], [10, false, "12 Jalan Jurong Kechil, Singapore 598593  |  6466 1234"], [12, true, "Medical certificate", 34], [11, false, "Date: 10 November 2026"],
      [11, false, "Patient: Sarah Lee", 22], [11, false, "To whom it may concern,", 30], [11, false, "Ms Lee was seen today for a sprained right ankle (grade 1)."],
      [11, false, "She should avoid exercise classes, including Pilates and yoga, for"], [11, false, "two weeks, from 10 November to 24 November 2026."],
      [11, false, "She can return to normal activity after that, starting gently.", 30], [11, false, "Yours sincerely,", 40], [11, true, "Dr Mei Chen, Physiotherapist"], [10, false, "Registration no. PT-04567"]],
    [[16, true, "Treatment plan", 0], [11, false, "Week 1: rest, ice, compression and keeping the ankle raised.", 30], [11, false, "Week 2: gentle range-of-motion exercises at home."],
      [11, false, "Review appointment: 24 November 2026, 10:00am.", 22], [10, false, "This note is for the patient's studio and may be shared with them.", 40]],
  ]);
  /** Bytes or a File for each attachment, keyed by its request. */
  const ATTACH = new Map();
  { const r = EXTREQ.find((x) => x.file === "physio-note.pdf"); if (r) ATTACH.set(r.id, { name: r.file, type: "application/pdf", data: () => Promise.resolve(PHYSIO_NOTE()) }); }
  const attachOf = (r) => ATTACH.get(r.id) || (r.file ? { name: r.file, type: /\.pdf$/i.test(r.file) ? "application/pdf" : "image/*", data: null } : null);
  /** The attachment chip on an extension request: opens the quick view. */
  function attachChip(r) {
    if (!r.file) return "";
    const isPdf = /\.pdf$/i.test(r.file);
    return `<button type="button" class="attchip" data-qv="${r.id}" data-help="Open it here, without leaving the page."><span aria-hidden="true">${isPdf ? "📄" : "🖼"}</span> ${esc(r.file)} <span class="qvlink">Quick view</span></button>`;
  }

  // --- The viewer ---------------------------------------------------------------------
  const QV = { zoom: null, doc: null, img: null, page: 1, url: null, fit: true };
  async function openQuickView(reqId) {
    const r = EXTREQ.find((x) => x.id === reqId);
    const a = r && attachOf(r);
    if (!a) return;
    const isPdf = a.type === "application/pdf";
    Object.assign(QV, { zoom: 1, doc: null, img: null, page: 1, fit: true, name: a.name });
    if (QV.url) { URL.revokeObjectURL(QV.url); QV.url = null; }
    $("#modalRoot").innerHTML = `<div class="modal-wrap qvwrap" data-mclose><div class="modal qv" role="dialog" aria-modal="true" aria-labelledby="qvTitle">
      <header class="qvhead"><div class="stack" style="gap:1px;min-width:0"><h2 id="qvTitle">${esc(a.name)}</h2><span class="muted" style="font-size:12.5px">${esc(CLIENTS[r.ci].name)} · extension request · <span id="qvMeta">${isPdf ? "PDF" : "Photo"}</span></span></div>
        <div class="qvtools" role="toolbar" aria-label="Quick view">
          <button type="button" class="iconbtn" id="qvOut" aria-label="Zoom out" data-help="Zoom out">−</button><span id="qvZoom" class="qvz" aria-live="polite">Fit</span><button type="button" class="iconbtn" id="qvIn" aria-label="Zoom in" data-help="Zoom in">+</button>
          <button type="button" class="btn" id="qvFit">Fit width</button>
          ${isPdf ? '<span id="qvPage" class="qvz" aria-live="polite"></span>' : ""}
          <button type="button" class="btn" id="qvDl" data-help="Save a copy to your device.">Download</button>
          <button type="button" class="iconbtn" data-mclose aria-label="Close quick view">✕</button></div></header>
      <div class="qvbody" id="qvBody" tabindex="0" aria-label="${esc(a.name)}"><div class="qvmsg" id="qvMsg">Opening…</div></div></div></div>`;
    const body = $("#qvBody");
    const fail = (why) => { body.innerHTML = `<div class="qvmsg">${alertBox("warn", "This file couldn't be shown here", `${esc(why)} You can download it instead.`)}</div>`; };
    $("#qvIn").onclick = () => zoomBy(1.25);
    $("#qvOut").onclick = () => zoomBy(0.8);
    $("#qvFit").onclick = () => { QV.fit = true; QV.zoom = 1; draw(); };
    $("#qvDl").onclick = async () => {
      const bytes = a.data ? await a.data() : null;
      if (!bytes) return toast("This sample file is only a name. Attach a real file to an extension request to try it.");
      const res = await offerFile(a.name, bytes instanceof Uint8Array ? bytes : new Uint8Array(await bytes.arrayBuffer()), a.type);
      toast(res === "saved" ? `Downloaded ${a.name}.` : res === "busy" ? "A download is already waiting for you to confirm." : "Your browser didn't allow the download.");
    };
    body.onkeydown = (e) => { if (e.key === "+" || e.key === "=") zoomBy(1.25); if (e.key === "-") zoomBy(0.8); };
    if (!a.data) return fail("This sample request only has a file name, not a real file.");
    try {
      const raw = await a.data();
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(await raw.arrayBuffer());
      if (!$("#qvBody")) return; // closed while loading
      if (isPdf) {
        const lib = await loadPdfJs();
        QV.doc = await lib.getDocument({ data: bytes }).promise;
        $("#qvMeta").textContent = `PDF, ${plural(QV.doc.numPages, "page")}`;
      } else {
        QV.url = URL.createObjectURL(new Blob([bytes], { type: a.type }));
        QV.img = QV.url;
      }
      await draw();
      body.focus();
    } catch (e) {
      fail(e?.message === "load" ? "The PDF reader didn't load. Check your connection and try again." : "It may be damaged or in a format we can't show.");
    }
  }
  function zoomBy(f) {
    if (!QV.doc && !QV.img) return;
    QV.fit = false;
    QV.zoom = Math.min(4, Math.max(0.25, Math.round(QV.zoom * f * 100) / 100));
    draw();
  }
  let drawing = 0;
  async function draw() {
    const body = $("#qvBody");
    if (!body) return;
    const run = ++drawing;
    const avail = Math.max(200, body.clientWidth - 32);
    if (QV.img) {
      body.innerHTML = `<img class="qvimg" src="${QV.img}" alt="${esc(QV.name)}" style="${QV.fit ? "width:100%;max-width:100%" : `width:${Math.round(avail * QV.zoom)}px;max-width:none`}">`;
      $("#qvZoom").textContent = QV.fit ? "Fit" : `${Math.round(QV.zoom * 100)}%`;
      return;
    }
    if (!QV.doc) return;
    const first = await QV.doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    const fitScale = avail / base.width;
    const scale = QV.fit ? fitScale : fitScale * QV.zoom;
    $("#qvZoom").textContent = QV.fit ? "Fit" : `${Math.round(QV.zoom * 100)}%`;
    const frag = document.createElement("div");
    frag.className = "qvpages";
    const dpr = window.devicePixelRatio || 1;
    for (let n = 1; n <= QV.doc.numPages; n++) {
      const page = await QV.doc.getPage(n);
      if (run !== drawing) return; // a newer zoom started
      const vp = page.getViewport({ scale });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      c.style.width = `${Math.floor(vp.width)}px`; c.style.height = `${Math.floor(vp.height)}px`;
      c.className = "qvpage"; c.dataset.page = String(n);
      c.setAttribute("role", "img"); c.setAttribute("aria-label", `Page ${n} of ${QV.doc.numPages}`);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      frag.appendChild(c);
    }
    if (run !== drawing || !$("#qvBody")) return;
    body.replaceChildren(frag);
    const pageNow = () => {
      const top = body.scrollTop + body.clientHeight / 3;
      const pages = [...body.querySelectorAll(".qvpage")];
      const cur = pages.filter((p) => p.offsetTop <= top).pop() || pages[0];
      QV.page = Number(cur?.dataset.page || 1);
      if ($("#qvPage")) $("#qvPage").textContent = `Page ${QV.page} of ${QV.doc.numPages}`;
    };
    body.onscroll = pageNow;
    pageNow();
  }

  // Clicking an attachment opens the quick view (anywhere it appears).
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-qv]");
    if (!b) return;
    e.preventDefault();
    openQuickView(Number(b.dataset.qv));
  });
  window.addEventListener("resize", () => { if ($("#qvBody") && QV.fit) draw(); });
