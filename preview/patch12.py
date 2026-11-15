# Run from inject.py after patch11 (uses its `s`, `once`, `swap`): cancelled classes on the calendar
# ("Show cancelled", staff only), read-only cancelled classes, and the Cancellations tab (see mkt14.js).

# The toggle, next to the other filters. Hidden for clients.
swap('''            <input id="fQ" type="search" placeholder="Search classes, people, rooms" aria-label="Search" data-help="Type a class, instructor, room or location name to find it.">
          </div>''',
     '''            <input id="fQ" type="search" placeholder="Search classes, people, rooms" aria-label="Search" data-help="Type a class, instructor, room or location name to find it.">
            <label class="check calcx" id="fCxWrap" for="fCx" data-help="Show cancelled classes too, struck through. Open one to see why it was cancelled and who was booked."><input type="checkbox" id="fCx"> Show cancelled</label>
          </div>''')
swap('''    $("#fInstr").hidden = state.role === "instructor";''',
     '''    $("#fInstr").hidden = state.role === "instructor";
    $("#fCxWrap").hidden = state.role === "client";''')
swap('''      if (s.status !== "scheduled") return false;
      if (state.role === "instructor" && s.instr !== ME.instructor) return false;''',
     '''      if (s.status !== "scheduled" && !(s.status === "cancelled" && state.showCancelled && isStaff() && !state.selecting)) return false;
      if (state.role === "instructor" && s.instr !== ME.instructor) return false;''')

# Cancelled classes look struck through and don't count towards a day's classes.
swap('''    const flags = isStaff() ? calendarFlags(s) : [];
    const warn = flags.filter((f) => f !== "No instructor yet");''',
     '''    const flags = isStaff() && s.status === "scheduled" ? calendarFlags(s) : [];
    const warn = flags.filter((f) => f !== "No instructor yet");''')
swap('''    const metaLine = `${instrLabel(s, { avatar: single })} · ${spotsText(s)}`;''',
     '''    const metaLine = s.status === "cancelled" ? `Cancelled${s.cancelReason ? ` · ${esc(s.cancelReason)}` : ""}` : `${instrLabel(s, { avatar: single })} · ${spotsText(s)}`;''')
swap('''    const right = state.role === "client"''',
     '''    const right = s.status === "cancelled" ? `<span class="evr"><span class="evcount">Cancelled</span></span>` : state.role === "client"''')
swap('''<span class="em">${instrLabel(s)} · ${where}</span></span>${right}`''',
     '''<span class="em">${s.status === "cancelled" ? metaLine : `${instrLabel(s)} · ${where}`}</span></span>${right}`''')
swap('''<span class="em">${instrLabel(s, { avatar: true })} · ${where}</span></span>${right}`''',
     '''<span class="em">${s.status === "cancelled" ? metaLine : `${instrLabel(s, { avatar: true })} · ${where}`}</span></span>${right}`''')
swap('''    return `<div class="ev ${s.end < NOW ? "past" : ""} ${isAppt(s) ? "appt" : ""}''',
     '''    return `<div class="ev ${s.end < NOW ? "past" : ""} ${s.status === "cancelled" ? "cx" : ""} ${isAppt(s) ? "appt" : ""}''')
swap('''aria-label="${esc(TYPES[s.type].name)}, ${fmtDay(s.start)} ${clock(s.start)}">${inner}${flagDot}</button></div>`;''',
     '''aria-label="${esc(TYPES[s.type].name)}, ${fmtDay(s.start)} ${clock(s.start)}${s.status === "cancelled" ? ", cancelled" : ""}">${inner}${flagDot}</button></div>`;''')
swap('''      const n = list.filter((s) => sameDay(s.start, d)).length;
      return `<div class="dh''',
     '''      const n = list.filter((s) => sameDay(s.start, d) && s.status === "scheduled").length;
      return `<div class="dh''')
swap('''          const flags = isStaff() ? calendarFlags(s) : [];
          return `<button type="button" class="ag-row ${state.selected.has(s.id) ? "selected" : ""}"''',
     '''          const flags = isStaff() && s.status === "scheduled" ? calendarFlags(s) : [];
          return `<button type="button" class="ag-row ${state.selected.has(s.id) ? "selected" : ""} ${s.status === "cancelled" ? "cx" : ""}"''')
swap('''${instrLabel(s, { avatar: true })} · ${esc(roomOrLoc(s.room))}${flags.length''',
     '''${s.status === "cancelled" ? "Cancelled · " : ""}${instrLabel(s, { avatar: true })} · ${esc(roomOrLoc(s.room))}${flags.length''')
swap('''${shown.map((s) => `<span class="mchip" style="--t:var(--t-${s.type})">''',
     '''${shown.map((s) => `<span class="mchip ${s.status === "cancelled" ? "cx" : ""}" style="--t:var(--t-${s.type})">''')

# The class panel: cancelled classes open read-only; staff get Class list / Cancellations tabs.
swap('''    if (!s || s.status !== "scheduled") { closeDrawer(); return; }''',
     '''    if (!s || (s.status !== "scheduled" && !(s.status === "cancelled" && isStaff()))) { closeDrawer(); return; }''')
swap('''    let body = "";

    if (flags.length) {
      body += `<div class="dr-sec">${flags.map((f) => {''',
     '''    let body = "";
    if (s.status === "cancelled") body = cancelledDrawer(s);
    else {
    if (flags.length) {
      body += `<div class="dr-sec">${flags.map((f) => {''')
swap('''    if (seesRoster) {
      const addBtn''',
     '''    if (seesRoster) body += drTabs(s);
    if (seesRoster && state.drTab === "cx") body += cancelsSection(s);
    else if (seesRoster) {
      const addBtn''')
swap('''      body += clientSection(s);
    }

    const r = ROOMS[s.room];''',
     '''      body += clientSection(s);
    }
    }

    const r = ROOMS[s.room];''')
swap('''  function openDrawer(id) { state.clientOpen = null; state.openId = id;''',
     '''  function openDrawer(id) { state.clientOpen = null; if (state.openId !== id) state.drTab = "list"; state.openId = id;''')

# Record each cancelled booking, and when and why a class was cancelled.
swap('''        if (st.late && st.fee && STUDIO.lateFeeOn) FEES.unshift({ id: FEES.length + 1, ci, type: "late_cancel", sid: s.id, cents: STUDIO.lateFeeCents, status: "pending", added: fmtDay(NOW) });
        s.roster = s.roster.filter((x) => x !== r);''',
     '''        if (st.late && st.fee && STUDIO.lateFeeOn) FEES.unshift({ id: FEES.length + 1, ci, type: "late_cancel", sid: s.id, cents: STUDIO.lateFeeCents, status: "pending", added: fmtDay(NOW) });
        logCancel(s, ci, { how: "staff", late: st.late, reason: ($("#scReason")?.value || "").trim(), returned: !!back, fee: st.late && st.fee && STUDIO.lateFeeOn ? STUDIO.lateFeeCents : null });
        s.roster = s.roster.filter((x) => x !== r);''')
swap('''        if (use) useClass(use, ci, to);
        s.roster = s.roster.filter((x) => x !== r);''',
     '''        if (use) useClass(use, ci, to);
        logCancel(s, ci, { how: "moved", returned: !!old });
        s.roster = s.roster.filter((x) => x !== r);''')
swap('''        const back = !late && mine ? giveBack(mine, s, "Cancelled in time") : null;
        s.roster = s.roster.filter((r) => r.ci !== ME.client);''',
     '''        const back = !late && mine ? giveBack(mine, s, "Cancelled in time") : null;
        logCancel(s, ME.client, { how: "self", late, returned: !!back, fee: late && STUDIO.lateFeeOn ? STUDIO.lateFeeCents : null });
        s.roster = s.roster.filter((r) => r.ci !== ME.client);''')
swap('''        const refund = $("#cRefund").value;''',
     '''        const refund = $("#cRefund").value;
        const why = ($("#cReason")?.value || "").trim();''')
swap('''            s.status = "cancelled";
            const n = s.roster.length + s.waitlist.length;''',
     '''            s.status = "cancelled";
            Object.assign(s, { cancelledAt: NOW, cancelReason: why || null, cancelRefund: refund, cancelledBy: "You" });
            const n = s.roster.length + s.waitlist.length;''')
swap('''          picked.forEach((x) => (x.status = "cancelled"));''',
     '''          picked.forEach((x) => Object.assign(x, { status: "cancelled", cancelledAt: NOW, cancelledBy: "You" }));''')
