  // ===========================================================================
  // Setup, App look (the same rules as /app-theme in the API and app-theme.ts in shared): how the
  // studio's own client app looks. Start from a look (Classic, Sage, Cobalt, Indigo), then change
  // any part: colours, the two typefaces, corners, how celebrations look, the welcome line on
  // Home and the class milestones the app celebrates. A phone beside it shows the result live
  // (Home, the timetable, a celebration). Custom looks come with the branded app (Signature, or
  // Growth with the add-on); without it, the app uses the Studio look in the booking-page colour.
  // ===========================================================================
  {
    const FONTS = {
      "Young Serif": { css: "Young+Serif", kind: "serif", note: "Soft, old-style serif for calm, crafted studios" },
      "Shippori Mincho": { css: "Shippori+Mincho:wght@500;700", kind: "serif", note: "Fine, high-contrast serif with a quiet, Japanese feel" },
      "Bricolage Grotesque": { css: "Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..800", kind: "sans", note: "Punchy, characterful sans for energetic studios" },
      "Figtree": { css: "Figtree:wght@400;500;600;700", kind: "sans", note: "Clear, friendly sans for body text" },
      "Zen Kaku Gothic New": { css: "Zen+Kaku+Gothic+New:wght@400;500;700", kind: "sans", note: "Even, open sans that pairs with Mincho" },
      "Manrope": { css: "Manrope:wght@400;500;600;700;800", kind: "sans", note: "Neat, modern sans" },
    };
    const PRESETS = {
      classic: { label: "Classic", description: "Clean and neutral, in your booking-page colour.", background: "#F4F5F7", surface: "#FFFFFF", ink: "#171B21", muted: "#5D6673", line: "#E1E4E9", accent: "#0C6156", onAccent: "#FFFFFF", highlight: "#E9B949", displayFont: "Manrope", bodyFont: "Manrope", corners: "soft", motif: "spark", welcome: "", milestones: [10, 20, 50, 100, 150, 200, 300, 500, 1000] },
      sage: { label: "Sage", description: "Calm and botanical: sage and deep green, a soft serif and leaf-shaped badges.", background: "#EEF1EA", surface: "#FBFCF8", ink: "#1B2A21", muted: "#5B6B60", line: "#D9E0D2", accent: "#2F5D46", onAccent: "#F4F8EF", highlight: "#B9CF7A", displayFont: "Young Serif", bodyFont: "Figtree", corners: "soft", motif: "leaf", welcome: "Slow is still forward.", milestones: [10, 20, 50, 100, 150, 200, 300, 500] },
      cobalt: { label: "Cobalt", description: "Bright and bold: cobalt and pink, a heavy sans-serif, pill shapes and badges with a ripple.", background: "#F3F4FF", surface: "#FFFFFF", ink: "#0F1238", muted: "#545A86", line: "#DCDFFA", accent: "#2B3BE8", onAccent: "#FFFFFF", highlight: "#FF8FCB", displayFont: "Bricolage Grotesque", bodyFont: "Bricolage Grotesque", corners: "round", motif: "wave", welcome: "Tuck, pulse, repeat.", milestones: [5, 20, 50, 100, 200, 500] },
      indigo: { label: "Indigo", description: "Still and exact: stone and indigo, a fine serif, square corners and a red seal for each achievement.", background: "#ECEBE7", surface: "#F8F7F4", ink: "#1E2030", muted: "#626473", line: "#D8D6D0", accent: "#2E3D73", onAccent: "#F3F1EA", highlight: "#C2412D", displayFont: "Shippori Mincho", bodyFont: "Zen Kaku Gothic New", corners: "square", motif: "stamp", welcome: "Arrive. Breathe. Begin.", milestones: [10, 25, 50, 108, 200, 500] },
    };
    const RADII = { square: [2, 4], soft: [10, 18], round: [999, 26] };
    const MOTIFS = [["leaf", "Leaf"], ["wave", "Wave"], ["stamp", "Seal"], ["spark", "Spark"]];
    const COLOURS = [["accent", "Brand colour", "Buttons, the next class, progress"], ["onAccent", "Text on the brand colour", ""], ["highlight", "Highlight", "Achievements and the next milestone"], ["background", "Background", ""], ["surface", "Cards", ""], ["ink", "Text", ""], ["muted", "Quieter text", ""], ["line", "Lines", ""]];
    const LOOK = (STUDIO.appLook ||= { saved: null });
    const AV = (state.alv ||= { view: "home", draft: null, milestoneInput: "" });
    const strip = ({ label, description, ...t }) => t; // eslint-disable-line no-unused-vars
    const basic = () => ({ ...strip(PRESETS.classic), preset: "classic", accent: (STUDIO.bp && STUDIO.bp.accent) || PRESETS.classic.accent });
    /** What members see now: the saved look with the branded app, otherwise the plain Studio look. */
    const inUse = () => (planHasApp() && LOOK.saved ? LOOK.saved : basic());
    const draft = () => (AV.draft ||= structuredClone(inUse()));
    const changed = () => JSON.stringify(draft()) !== JSON.stringify(inUse());

    // Contrast (WCAG): text on the brand colour, and text on the background.
    const lum = (hex) => { const c = hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const loaded = new Set();
    function loadFonts(names) {
      const want = names.filter((n) => FONTS[n] && !loaded.has(n));
      if (!want.length) return;
      want.forEach((n) => loaded.add(n));
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = `https://fonts.googleapis.com/css2?${want.map((n) => `family=${FONTS[n].css}`).join("&")}&display=swap`;
      document.head.appendChild(l);
    }

    NAV.push({ id: "app-look", group: "Setup", roles: ["admin"], label: "App look", help: "How your own client app looks: colours, typefaces, celebrations and milestones." });
    NAV_ORDER.find(([g]) => g === "Setup")[1].push("app-look");
    { const t = HUBS.find((h) => h.id === "setup")?.tabs; if (t) t.splice(t.findIndex((x) => x[0] === "booking-page") + 1, 0, ["app-look", "App look"]); }
    ICONS["app-look"] = '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><circle cx="12" cy="10" r="2.5"/>';

    const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="m-leaf" d="M4 18 C 6 8 14 4 20 4 C 20 11 15 19 4 18 Z M5 17 L 15 9"/><path class="m-wave" d="M2 15 C 5 9 9 9 12 13 S 19 17 22 9"/><rect class="m-stamp" x="4" y="4" width="16" height="16"/><path class="m-spark" d="M12.00 2.00 L14.29 4.96 L17.88 3.91 L17.99 7.65 L21.51 8.91 L19.40 12.00 L21.51 15.09 L17.99 16.35 L17.88 20.09 L14.29 19.04 L12.00 22.00 L9.71 19.04 L6.12 20.09 L6.01 16.35 L2.49 15.09 L4.60 12.00 L2.49 8.91 L6.01 7.65 L6.12 3.91 L9.71 4.96 Z"/></svg>';

    /** The phone: the studio's app with this look, from the sample studio's own classes. */
    function phone(t) {
      const [rs, rl] = RADII[t.corners];
      const ms = [...t.milestones].sort((a, b) => a - b), done = 47, prev = [...ms].reverse().find((m) => m <= done) ?? 0, next = ms.find((m) => m > done);
      const vars = `--a-bg:${t.background};--a-sf:${t.surface};--a-ink:${t.ink};--a-mu:${t.muted};--a-ln:${t.line};--a-ac:${t.accent};--a-on:${t.onAccent};--a-hi:${t.highlight};--a-onhi:${contrast(t.highlight, "#FFFFFF") >= contrast(t.highlight, t.ink) ? "#FFFFFF" : t.ink};--a-rs:${rs}px;--a-rl:${rl}px;--a-disp:"${t.displayFont}",Georgia,serif;--a-body:"${t.bodyFont}",system-ui,sans-serif`;
      const name = esc(STUDIO.name || "Demo Studio");
      const upcoming = SESSIONS.filter((s) => s.status === "scheduled" && !isAppt(s) && s.start > NOW).sort((a, b) => a.start - b.start).slice(0, 3);
      const nx = upcoming[0];
      const tabs = `<div class="alp-tabs"><span class="on">Home</span><span>Book</span><span>Shop</span><span>My classes</span><span>Me</span></div>`;
      const top = `<div class="alp-top"><i class="alp-logo">${name.slice(0, 1)}</i>${name}</div>`;
      let body = "";
      if (AV.view === "book") {
        body = `<h4 class="alp-h">Book a class</h4><div class="alp-chips"><span class="alp-chip on">★ Classes with Ana</span>${Object.values(TYPES).slice(0, 2).map((ty) => `<span class="alp-chip"><i style="background:${ty.color}"></i>${esc(ty.name)}</span>`).join("")}</div>
          <ul class="alp-list">${upcoming.map((s, i) => `<li style="--ty:${TYPES[s.type].color}"><b>${clock(s.start)}</b><span><em>${esc(TYPES[s.type].name)}</em><small>${esc(instrName(s.instr).split(" ")[0])}, ${esc(LOCS[s.loc])}</small></span><i class="alp-btn">${i === 0 ? "Booked" : "Book"}</i></li>`).join("")}</ul>`;
      } else if (AV.view === "celebrate") {
        body = `<div class="alp-cel"><div class="alp-cel-art"><b class="alp-cel-badge">${prev || 10}</b></div><h4>${prev || 10} classes</h4><p>That's your ${prev || 10}th class with ${name}.${next ? ` Next stop: ${next}.` : ""}</p><i class="alp-btn wide">Book your next class</i></div>`;
      } else {
        body = `<h4 class="alp-hello">Good morning, Rachel.</h4>${t.welcome ? `<p class="alp-wel">${esc(t.welcome)}</p>` : ""}
          ${nx ? `<div class="alp-next"><small>${fmtDay(nx.start)}, ${clock(nx.start)}</small><b>${esc(TYPES[nx.type].name)}</b><small>${esc(LOCS[nx.loc])}</small></div>` : ""}
          <div class="alp-card"><div class="alp-ms"><b>${done}</b> classes<span>${next ? `${next - done} to your ${next}th` : "Every milestone reached"}</span></div>${next ? `<div class="alp-bar"><i style="width:${Math.round(((done - prev) / (next - prev)) * 100)}%"></i><em>${MARK}</em></div>` : ""}</div>
          <div class="alp-card"><div class="alp-ms"><b class="sm">November</b><span>5 of 8</span></div><div class="alp-dots">${Array.from({ length: 8 }, (_, i) => `<i class="${i < 5 ? "d" : i < 7 ? "b" : ""}"></i>`).join("")}</div></div>
          <div class="alp-badges">${["10", "20", "4w"].map((x) => `<span class="alp-badge">${x}</span>`).join("")}<small>6 achievements</small></div>`;
      }
      return `<div class="alp" data-motif="${t.motif}" data-corners="${t.corners}" data-kind="${FONTS[t.displayFont].kind}" style='${vars}'><div class="alp-screen">${top}${body}</div>${tabs}</div>`;
    }

    PAGES["app-look"] = function () {
      const has = planHasApp(), t = draft(), p = PRESETS[t.preset] || PRESETS.classic;
      loadFonts([t.displayFont, t.bodyFont, ...Object.values(PRESETS).map((x) => x.displayFont)]);
      const warn = [];
      if (contrast(t.accent, t.onAccent) < 4.5) warn.push(["onAccent", `Text on the brand colour is hard to read (contrast ${contrast(t.accent, t.onAccent).toFixed(1)} to 1; aim for 4.5).`]);
      if (contrast(t.background, t.ink) < 7 && contrast(t.surface, t.ink) < 4.5) warn.push(["ink", "Text is hard to read on the cards."]);
      const locked = has ? "" : "disabled";
      return head("App look", "How your own client app looks to members. Start from a look and change anything; the phone shows it as you go.", has ? `<button type="button" class="btn" id="alReset" ${changed() ? "" : "disabled"}>Undo changes</button><button type="button" class="btn primary" id="alSave" ${changed() ? "" : "disabled"}>Save look</button>` : "") +
        `<div class="algrid">
          <div class="stack" style="gap:16px;min-width:0">
            ${has ? "" : `<div class="card al-lock"><h3>Your own look comes with the branded app</h3><p class="muted">${STUDIO.plan === "growth" ? "Add the branded app to Growth for SGD 99 a month, or move to Signature, where it's included." : STUDIO.plan === "essentials" ? "It's included in Signature, and an add-on on Growth." : ""} Until then, members see the Studio look in your booking-page colour, as on the phone.</p><div><button type="button" class="btn" id="alTalk">Talk to us about your plan</button></div></div>`}
            <section class="card"><h3>Start from a look</h3>
              <div class="alpresets" role="radiogroup" aria-label="Looks">${Object.entries(PRESETS).map(([k, x]) => `<button type="button" role="radio" aria-checked="${t.preset === k}" data-alpreset="${k}" ${locked}><span class="alsw">${[x.background, x.accent, x.highlight, x.ink].map((c) => `<i style="background:${c}"></i>`).join("")}</span><b style="font-family:'${x.displayFont}',serif">${x.label}</b><small>${esc(x.description)}</small></button>`).join("")}</div>
            </section>
            <section class="card"><h3>Colours</h3>
              <div class="alcolours">${COLOURS.map(([k, l, help]) => `<label class="fl" for="al-${k}">${l}${help ? `<small class="muted">${help}</small>` : ""}<span class="inline2"><input type="color" id="al-${k}" value="${t[k].toLowerCase()}" data-alcol="${k}" ${locked}><input class="alhex" value="${t[k].toUpperCase()}" data-alhex="${k}" maxlength="7" aria-label="${l} as a hex code" ${locked}></span></label>`).join("")}</div>
              ${warn.map(([k, m]) => `<p class="alwarn" role="status">${m} ${k === "onAccent" ? `<button type="button" class="btn sm" id="alFixOn" ${locked}>Use ${lum(t.accent) > 0.4 ? "dark" : "white"} text</button>` : ""}</p>`).join("")}
            </section>
            <section class="card"><h3>Typefaces</h3>
              <div class="inline2" style="gap:12px;align-items:flex-start">
                ${[["displayFont", "Headings and numbers"], ["bodyFont", "Everything else"]].map(([k, l]) => `<label class="fl" for="al-${k}" style="flex:1;min-width:200px">${l}<select id="al-${k}" data-alfont="${k}" ${locked}>${Object.keys(FONTS).map((f) => `<option ${t[k] === f ? "selected" : ""}>${f}</option>`).join("")}</select><small class="muted">${esc(FONTS[t[k]].note)}</small></label>`).join("")}
              </div>
            </section>
            <section class="card"><h3>Shape and celebrations</h3>
              <div class="fl">Corners<div class="seg" role="group" aria-label="Corners">${[["square", "Square"], ["soft", "Soft"], ["round", "Round"]].map(([k, l]) => `<button type="button" aria-pressed="${t.corners === k}" data-alcorner="${k}" ${locked}>${l}</button>`).join("")}</div></div>
              <div class="fl">When a member reaches a milestone<div class="seg almotifs" role="group" aria-label="Celebration">${MOTIFS.map(([k, l]) => `<button type="button" aria-pressed="${t.motif === k}" data-almotif="${k}" ${locked}><span class="alpm" data-motif="${k}">${MARK}</span>${l}</button>`).join("")}</div><small class="muted">It's also the shape of achievement badges. <button type="button" class="linkbtn" id="alSeeCel">See it</button></small></div>
            </section>
            <section class="card"><h3>Words and milestones</h3>
              <label class="fl" for="alWelcome"><span class="inline2" style="justify-content:space-between;width:100%;max-width:420px">Welcome line on Home <span class="count">${(t.welcome || "").length}/120</span></span><input id="alWelcome" maxlength="120" value="${esc(t.welcome || "")}" placeholder="For example: Slow is still forward." ${locked}></label>
              <div class="fl">Milestones the app celebrates<small class="muted">Class counts. Members see a bar to the next one and a celebration when they reach it.</small>
                <div class="chips almil">${[...t.milestones].sort((a, b) => a - b).map((m) => `<button type="button" data-almil="${m}" aria-label="Remove ${m}" ${locked}>${m} <span aria-hidden="true">×</span></button>`).join("")}</div>
                <span class="inline2"><input type="number" id="alMilAdd" min="1" max="5000" placeholder="Add, e.g. 75" value="${esc(AV.milestoneInput)}" ${locked}><button type="button" class="btn" id="alMilBtn" ${locked || t.milestones.length >= 12 ? "disabled" : ""}>Add</button></span>
                <p class="alerr" id="alMilErr" role="alert"></p>
              </div>
            </section>
          </div>
          <div class="alside">
            <div class="seg" role="group" aria-label="Show on the phone">${[["home", "Home"], ["book", "Timetable"], ["celebrate", "Celebration"]].map(([k, l]) => `<button type="button" aria-pressed="${AV.view === k}" data-alview="${k}">${l}</button>`).join("")}</div>
            <div class="alphone">${phone(has ? t : basic())}</div>
            <p class="muted" style="font-size:12px;text-align:center">${has ? (changed() ? "Not saved yet: members still see the saved look." : `${p.label === "Studio" && !LOOK.saved ? "The Studio look" : "Saved"}. This is what members see.`) : "What members see now."}</p>
          </div>
        </div>`;
    };

    BIND["app-look"] = function () {
      const t = draft();
      const set = (k, v) => { t[k] = v; render(); };
      document.querySelectorAll("[data-alpreset]").forEach((b) => (b.onclick = () => { const x = PRESETS[b.dataset.alpreset]; AV.draft = { ...structuredClone(strip(x)), preset: b.dataset.alpreset }; render(); }));
      document.querySelectorAll("[data-alcol]").forEach((i) => (i.oninput = () => { t[i.dataset.alcol] = i.value.toUpperCase(); const h = document.querySelector(`[data-alhex="${i.dataset.alcol}"]`); if (h) h.value = i.value.toUpperCase(); const ph = $(".alphone"); if (ph) ph.innerHTML = phone(t); }));
      document.querySelectorAll("[data-alcol]").forEach((i) => (i.onchange = () => render()));
      document.querySelectorAll("[data-alhex]").forEach((i) => (i.onchange = () => { const v = i.value.trim().toUpperCase(); if (/^#[0-9A-F]{6}$/.test(v)) set(i.dataset.alhex, v); else { i.value = t[i.dataset.alhex]; toast("Use a colour like #2F5D46."); } }));
      document.querySelectorAll("[data-alfont]").forEach((s) => (s.onchange = () => set(s.dataset.alfont, s.value)));
      document.querySelectorAll("[data-alcorner]").forEach((b) => (b.onclick = () => set("corners", b.dataset.alcorner)));
      document.querySelectorAll("[data-almotif]").forEach((b) => (b.onclick = () => { AV.view = "celebrate"; set("motif", b.dataset.almotif); }));
      document.querySelectorAll("[data-alview]").forEach((b) => (b.onclick = () => { AV.view = b.dataset.alview; render(); }));
      document.querySelectorAll("[data-almil]").forEach((b) => (b.onclick = () => { if (t.milestones.length <= 1) { $("#alMilErr").textContent = "Keep at least one milestone."; return; } set("milestones", t.milestones.filter((m) => m !== Number(b.dataset.almil))); }));
      const add = () => {
        const n = Number($("#alMilAdd").value);
        const err = !Number.isInteger(n) || n < 1 || n > 5000 ? "Use a whole number of classes from 1 to 5000." : t.milestones.includes(n) ? `${n} is already there.` : t.milestones.length >= 12 ? "Up to 12 milestones." : "";
        if (err) { $("#alMilErr").textContent = err; return; }
        AV.milestoneInput = "";
        set("milestones", [...t.milestones, n].sort((a, b) => a - b));
      };
      if ($("#alMilBtn")) $("#alMilBtn").onclick = add;
      if ($("#alMilAdd")) $("#alMilAdd").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
      if ($("#alWelcome")) $("#alWelcome").oninput = (e) => { t.welcome = e.target.value; const c = e.target.closest(".fl")?.querySelector(".count"); if (c) c.textContent = `${e.target.value.length}/120`; const ph = $(".alphone"); if (ph) ph.innerHTML = phone(t); const sv = $("#alSave"); if (sv) sv.disabled = !changed(); const rs = $("#alReset"); if (rs) rs.disabled = !changed(); };
      if ($("#alFixOn")) $("#alFixOn").onclick = () => set("onAccent", lum(t.accent) > 0.4 ? "#111111" : "#FFFFFF");
      if ($("#alSeeCel")) $("#alSeeCel").onclick = () => { AV.view = "celebrate"; render(); };
      if ($("#alTalk")) $("#alTalk").onclick = () => $("#planTalk") ? $("#planTalk").click() : toast("We'll be in touch about your plan.");
      if ($("#alReset")) $("#alReset").onclick = () => { AV.draft = null; render(); toast("Back to the saved look."); };
      if ($("#alSave")) $("#alSave").onclick = () => { LOOK.saved = structuredClone(t); AV.draft = null; render(); toast("Saved. Members see the new look next time they open the app."); };
    };
  }
