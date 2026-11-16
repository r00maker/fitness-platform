  // ===========================================================================
  // Moving your data (same rules as modules/migration/routes.ts in the API): the studio fills
  // in one form, chooses how we get the data, and can upload exports themselves. Our team
  // does the rest in HQ (check, import, compare a sample, verify).
  // ===========================================================================
  {
    const MOVE_PLATFORMS = ["Mindbody", "Momence", "Glofox", "PunchPass", "TeamUp", "Arketa", "Vibefam", "Rezerv", "Walla", "Mariana Tek", "bsport", "Spreadsheet", "Other"];
    const MOVE_TIPS = {
      Mindbody: ["Reports → Mailing Lists: All clients, opt-in status All → Generate → export", "Reports → Clients → Membership → Detail view", "Client series/packages with remaining visits (or ask Mindbody support for a full export; it may cost extra)"],
      Momence: ["Customers list → Export (contact details, memberships and credits left)", "Packages/Subscriptions → export active ones if they're separate"],
      Glofox: ["Reports → Memberships → Members → Download (needs the Admin role)", "Client list export (Clients Export permission)"],
      PunchPass: ["Customers → export customer list", "Passes report with visits remaining"],
      TeamUp: ["Customers → Customer List → Export filtered list → CSV/Excel", "Memberships report for remaining classes"],
      Other: ["Client list with emails and phone numbers", "Active class packs with classes left and expiry dates", "Active memberships with price, how often they renew and the next billing date", "Upcoming bookings (class, date and time)", "Visit history, if you want totals carried over"],
    };
    const MOVE_STEPS = ["Form started", "Form sent: we're getting your data", "Data received: we're checking it", "Checked: ready to move", "Moved: we're double-checking a sample", "Done and verified"];
    const MV = (STUDIO.move ||= { step: 0, oldPlatform: "", switchDate: "", activeClients: "", activeMemberships: "", activePackages: "", dateFormat: "unsure", includeInactive: false, packagesSold: "", access: "", accessLogin: "", passwordSaved: false, consent: false, contactName: "", contactPhone: "", files: [] });
    const kindOf = (n) => (/member|contract|subscri|autopay/i.test(n) ? "Memberships (recurring)" : /pack|pass|series|credit/i.test(n) ? "Class packs (classes left)" : /visit|attend|history/i.test(n) ? "Visit history" : /book/i.test(n) ? "Upcoming bookings" : "Clients");
    NAV.push({ id: "moving", group: "Setup", roles: ["admin"], label: "Moving your data", help: "Moving from another system: one form, and we do the rest within a day." });
    NAV_ORDER.find(([g]) => g === "Setup")[1].push("moving");
    { const t = HUBS.find((h) => h.id === "setup")?.tabs; if (t) t.splice(t.findIndex(([k]) => k === "features"), 0, ["moving", "Moving your data"]); } // Features stays last
    ICONS.moving = '<path d="M4 7h11l-3-3M20 17H9l3 3"/>';

    PAGES.moving = function () {
      const sent = MV.step >= 1, tips = MOVE_TIPS[MV.oldPlatform] || MOVE_TIPS.Other;
      const stepper = `<ol class="mvsteps" aria-label="Progress">${MOVE_STEPS.slice(1).map((t, i) => `<li class="${i + 1 < MV.step ? "done" : i + 1 === MV.step ? "now" : ""}">${esc(t)}</li>`).join("")}</ol>`;
      const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`;
      const accessCard = (v, title, body) => `<label class="mvacc ${MV.access === v ? "on" : ""}"><input type="radio" name="mvAccess" value="${v}" ${MV.access === v ? "checked" : ""} ${sent ? "disabled" : ""}><span><b>${title}</b><br><span class="muted">${body}</span></span></label>`;
      const form = `<div class="card mvform"><h3>About your move</h3>
        <div class="mvgrid">
          <label class="fld">Which system do you use now?<select id="mvPlatform" ${sent ? "disabled" : ""}>${opt("", "Choose…", MV.oldPlatform)}${MOVE_PLATFORMS.map((p) => opt(p, p, MV.oldPlatform)).join("")}</select></label>
          <label class="fld">When would you like to switch?<input type="date" id="mvDate" value="${esc(MV.switchDate)}" ${sent ? "disabled" : ""}></label>
          <label class="fld">Active clients (roughly)<input type="number" min="0" id="mvClients" value="${esc(MV.activeClients)}" placeholder="e.g. 400" ${sent ? "disabled" : ""}></label>
          <label class="fld">Active memberships<input type="number" min="0" id="mvMembers" value="${esc(MV.activeMemberships)}" ${sent ? "disabled" : ""}></label>
          <label class="fld">Active class packs<input type="number" min="0" id="mvPacks" value="${esc(MV.activePackages)}" ${sent ? "disabled" : ""}></label>
          <label class="fld">In your old system, 03/04/2026 means…<select id="mvDates" ${sent ? "disabled" : ""}>${opt("dmy", "3 April (day first)", MV.dateFormat)}${opt("mdy", "4 March (month first)", MV.dateFormat)}${opt("ymd", "Dates look like 2026-04-03", MV.dateFormat)}${opt("unsure", "Not sure", MV.dateFormat)}</select></label>
        </div>
        <label class="fld">The packages and memberships you sell<span class="hint">Names and prices are enough. We match clients' packs to them.</span><textarea id="mvSold" rows="2" ${sent ? "disabled" : ""}>${esc(MV.packagesSold)}</textarea></label>
        <label class="row" style="gap:8px"><input type="checkbox" id="mvInactive" ${MV.includeInactive ? "checked" : ""} ${sent ? "disabled" : ""}> Also move clients who haven't been in for a year or more</label>
      </div>
      <div class="card mvform"><h3>How we get your data</h3>
        <div class="mvaccs">
          ${accessCard("staff_login", "Invite our team as a staff user (easiest)", `Add moving@ as a staff member in ${esc(MV.oldPlatform || "your old system")} with access to reports. Remove them once we're done.`)}
          ${accessCard("password", "Share a temporary password", "Kept encrypted, seen only by the person doing your move, and deleted after the move (7 days at most). Change it afterwards.")}
          ${accessCard("files", "Upload the exports myself", "Download these reports and add them below. CSV and Excel files both work.")}
        </div>
        ${MV.access === "password" && !sent ? `<div class="mvgrid"><label class="fld">Login<input id="mvLogin" value="${esc(MV.accessLogin)}" autocomplete="off"></label><label class="fld">Temporary password${MV.passwordSaved ? '<span class="hint">Saved. Type a new one to replace it.</span>' : ""}<input id="mvPass" type="password" autocomplete="new-password"></label></div>` : ""}
        <div class="mvtips"><b>${MV.oldPlatform ? `What we'll take from ${esc(MV.oldPlatform)}` : "What we'll take"}</b><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>
        <div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn" for="mvFile" style="cursor:pointer">Add files</label><input type="file" id="mvFile" multiple accept=".csv,.xlsx,.xls,.txt,.tsv" hidden><span class="muted" style="font-size:12.5px">Optional with the other two choices: anything you add helps us start sooner.</span></div>
        ${MV.files.length ? `<div class="tblwrap"><table class="tbl" id="mvFiles"><thead><tr><th>File</th><th>We read it as</th></tr></thead><tbody>${MV.files.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.kind)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      </div>
      <div class="card mvform"><h3>Who we talk to</h3><div class="mvgrid">
          <label class="fld">Name<input id="mvContact" value="${esc(MV.contactName)}" ${sent ? "disabled" : ""}></label>
          <label class="fld">Phone or WhatsApp<input id="mvPhone" value="${esc(MV.contactPhone)}" ${sent ? "disabled" : ""}></label></div>
        <label class="row" style="gap:8px;align-items:flex-start"><input type="checkbox" id="mvConsent" ${MV.consent ? "checked" : ""} ${sent ? "disabled" : ""}> <span>I'm OK for your team to move my clients' details into my studio here. They're used only for my studio, and the old files are deleted 30 days after the move is checked.</span></label>
        ${sent ? "" : `<div class="row" style="gap:8px"><button type="button" class="btn primary" id="mvSend">Send to our team</button><button type="button" class="btn" id="mvSave">Save for later</button><span class="mverr" id="mvErr" role="alert"></span></div>`}
      </div>`;
      const after = sent ? alertBox("info", "What happens next", `We'll get your data out of ${esc(MV.oldPlatform)}, check every row and move it within a day. You'll get a summary: clients, packs and classes left, memberships and bookings moved, and anything that couldn't move with the reason. Nothing changes for your clients until your switch date.`) : "";
      return head("Moving your data", "Tell us about your old system and how to get your data. We check and move everything within a day, and nothing is guessed: anything unclear comes back to you.") + (sent ? stepper : "") + after + form;
    };
    BIND.moving = function () {
      const read = () => {
        const v = (id) => $(id)?.value ?? "";
        Object.assign(MV, { oldPlatform: v("#mvPlatform"), switchDate: v("#mvDate"), activeClients: v("#mvClients"), activeMemberships: v("#mvMembers"), activePackages: v("#mvPacks"), dateFormat: v("#mvDates"), packagesSold: v("#mvSold"), includeInactive: !!$("#mvInactive")?.checked, consent: !!$("#mvConsent")?.checked, contactName: v("#mvContact"), contactPhone: v("#mvPhone") });
        if ($("#mvLogin")) MV.accessLogin = v("#mvLogin");
        if ($("#mvPass")?.value) MV.passwordSaved = true;
      };
      // Keep every answer as it's typed, so nothing is lost if the page redraws.
      document.querySelectorAll(".mvform input:not([type=file]):not([type=radio]), .mvform select, .mvform textarea").forEach((el) => { el.addEventListener("input", read); el.addEventListener("change", read); });
      $("#mvPlatform")?.addEventListener("change", () => { read(); render(); });
      document.querySelectorAll('input[name="mvAccess"]').forEach((r) => r.addEventListener("change", () => { read(); MV.access = r.value; if (r.value !== "password") MV.passwordSaved = false; render(); }));
      $("#mvFile")?.addEventListener("change", (e) => { read(); for (const f of e.target.files) if (!MV.files.some((x) => x.name === f.name)) MV.files.push({ name: f.name, kind: kindOf(f.name) }); if (MV.step < 1 && MV.files.length) MV.step = Math.max(MV.step, 0); render(); toast(`${e.target.files.length === 1 ? "File" : "Files"} added.`); });
      $("#mvSave")?.addEventListener("click", () => { read(); toast("Saved. Come back any time to finish."); });
      $("#mvSend")?.addEventListener("click", () => {
        read();
        const missing = [!MV.oldPlatform && "which system you use now", !MV.switchDate && "when you'd like to switch", !MV.access && "how we get your data", MV.access === "password" && !MV.accessLogin && "the login to use", MV.access === "password" && !MV.passwordSaved && "the temporary password", !MV.consent && "your OK for us to move your clients' details"].filter(Boolean);
        if (missing.length) { $("#mvErr").textContent = `Before sending, add ${missing.join(", ")}.`; return; }
        MV.step = MV.files.length ? 2 : 1;
        render();
        toast("Sent. We'll be in touch within one working day.");
      });
    };
  }
