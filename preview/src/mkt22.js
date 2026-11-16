  // ===========================================================================
  // Reports by location (Signature), same numbers as locationsReport in the API's
  // modules/reports/routes.ts: each location side by side against the period before.
  // ===========================================================================
  {
    const page = PAGES.reports, bind = BIND.reports;
    function locationsBody(days) {
      const from = addDays(NOW, -days), prevFrom = addDays(from, -days);
      const cur = rangeStats(from, NOW).classes, prev = rangeStats(prevFrom, from).classes;
      const of = (list, loc) => {
        const all = list.filter((c) => c.loc === loc && TYPES[c.type]?.kind !== "appointment");
        const held = all.filter((c) => !c.cancelled);
        const booked = held.reduce((a, c) => a + c.booked, 0);
        return { held: held.length, cancelled: all.length - held.length, fill: pctOf(booked, held.reduce((a, c) => a + c.cap, 0)), visits: held.reduce((a, c) => a + c.present, 0), noShow: pctOf(held.reduce((a, c) => a + c.noShow, 0), booked) };
      };
      const rows = Object.entries(LOCS).map(([k, name]) => ({ k, name, n: of(cur, k), p: of(prev, k) }));
      const ranked = rows.filter((r) => r.n.held).sort((a, b) => b.n.fill - a.n.fill);
      const summary = ranked.length < 2 ? "Not enough classes yet to compare locations." : `${ranked[0].name} is the fullest (${ranked[0].n.fill}%); ${ranked.at(-1).name} has the most room (${ranked.at(-1).n.fill}%).`;
      const lines = [
        ["Classes held", (s) => String(s.held), (r) => chg(r.n.held, r.p.held)],
        ["How full", (s) => `${s.fill}%`, (r) => chg(r.n.fill, r.p.fill, { isPct: true })],
        ["Visits", (s) => String(s.visits), (r) => chg(r.n.visits, r.p.visits)],
        ["No-shows", (s) => `${s.noShow}%`, (r) => chg(r.n.noShow, r.p.noShow, { isPct: true, goodUp: false })],
        ["Classes cancelled", (s) => String(s.cancelled), (r) => chg(r.n.cancelled, r.p.cancelled, { goodUp: false })],
      ];
      const cell = (c) => (c ? `<span class="rchg ${c.good === null ? "flat" : c.good ? "good" : "bad"}"><span aria-hidden="true">${c.dir === "up" ? "↑" : c.dir === "down" ? "↓" : "→"}</span> ${esc(c.text)}</span>` : "");
      return `<div class="card rsum"><b>${esc(summary)}</b></div>
        <div class="card"><h3>Locations side by side</h3><div class="tblwrap"><table class="tbl" id="locReport"><thead><tr><th></th>${rows.map((r) => `<th>${esc(r.name)}</th>`).join("")}</tr></thead>
          <tbody>${lines.map(([l, v, c]) => `<tr><th scope="row">${esc(l)}</th>${rows.map((r) => `<td><b>${esc(v(r.n))}</b><br>${cell(c(r))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <p class="muted" style="font-size:12.5px;margin:10px 0 0">Sales from packs and memberships aren't split by location, because they can be used at any of them.</p></div>
        <div class="adsgrid">${rows.map((r) => `<div class="card"><h3>${esc(r.name)}: how full</h3><div class="row" style="justify-content:space-between;font-size:13px"><span>${plural(r.n.held, "class", "classes")} held</span><b>${r.n.fill}%</b></div>${meter(r.n.fill)}</div>`).join("")}</div>`;
    }
    PAGES.reports = function () {
      const html = page.call(this);
      const sig = STUDIO.plan === "signature";
      const tabBtn = `<button type="button" role="tab" data-rtab="locations" aria-selected="${state.rTab === "locations"}">Locations${sig ? "" : ' <span class="tag lock">In Signature</span>'}</button>`;
      let out = html.replace('data-rtab="conversion"', 'data-rtab="conversion"').replace(/(<button type="button" role="tab" data-rtab="conversion"[^>]*>Conversion<\/button>)/, `$1${tabBtn}`);
      if (state.rTab !== "locations") return out;
      out = out.replace(/<button type="button" class="btn" id="rExport"[^>]*>Export<\/button>/, "");
      const days = state.rDays || 30;
      const body = sig ? locationsBody(days) : `<div class="card" id="locLocked"><h3>Reports by location come with Signature</h3><p class="muted">See every location side by side: how full, visits, no-shows and cancellations, each compared with the period before. You're on ${esc(PLAN_INFO[STUDIO.plan].label)}: talk to us to change your plan, and we'll set it up for you.</p></div>`;
      // The other tabs' body sits after the period row; swap it for this one.
      const cut = out.indexOf("</div>", out.indexOf('class="row rhead"'));
      const end = out.indexOf("</div>", cut + 6) + 6;
      return out.slice(0, end) + body;
    };
    BIND.reports = function () { bind?.call(this); };
  }
