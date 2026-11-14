# Run from inject.py after patch10 (uses its `s`, `once`, `swap`): closures and holidays on the
# calendar (shaded days with the name), in the class form (repeats skip closed days, adding or
# moving a class onto one asks first).

# Week and day view: name closed days in the day heading (patch10 shades the column).
swap('''<span class="dcount">${n ? plural(n, "class", "classes") : ""}</span></div>`;''',
     '''<span class="dcount">${n ? plural(n, "class", "classes") : ""}</span>${closedTag(d)}</div>`;''')
swap('''      ${empty ? `<div class="empty">No classes match on this day. Try clearing the filters.</div>` : ""}''',
     '''      ${empty ? `<div class="empty">${closedEmpty(days[0]) || "No classes match on this day. Try clearing the filters."}</div>` : ""}''')
# Agenda (phones) and month view.
swap('''<span>${items.length ? plural(items.length, "class", "classes") : "No classes"}</span></div>` +''',
     '''<span>${items.length ? plural(items.length, "class", "classes") : "No classes"}</span>${closedTag(d)}</div>` +''')
swap('''      cells.push(`<button type="button" class="mc ${d.getMonth() !== a.getMonth() ? "out" : ""} ${sameDay(d, NOW) ? "today" : ""}" data-day="${ymd(d)}" aria-label="${fmtDay(d)}, ${plural(items.length, "class", "classes")}">
        <span class="n">${d.getDate()}</span>''',
     '''      cells.push(`<button type="button" class="mc ${d.getMonth() !== a.getMonth() ? "out" : ""} ${sameDay(d, NOW) ? "today" : ""} ${closedCls(d)}" data-day="${ymd(d)}" aria-label="${fmtDay(d)}, ${closedFor(d).length ? `${closedLabel(closedFor(d)[0])}, ` : ""}${plural(items.length, "class", "classes")}">
        <span class="n">${d.getDate()}</span>${closedChip(d)}''')

# Repeats skip closed days. Skipped days don't count, so "after 8 classes" still makes 8.
swap('''      const r = draft.rep, first = $("#fDate").value;
      if (!r.freq || !first) return first ? [first] : [];''',
     '''      const r = draft.rep, first = $("#fDate").value;
      REP_SKIPPED.length = 0;
      if (!r.freq || !first) return first ? [first] : [];''')
swap('''        if (wk % r.freq === 0 && days.includes(d.getDay())) out.push(ymd(d));''',
     '''        if (wk % r.freq === 0 && days.includes(d.getDay())) {
          if (closureOn(ROOMS[$("#fRoom")?.value]?.loc, ymd(d))) { REP_SKIPPED.push(ymd(d)); continue; }
          out.push(ymd(d));
        }''')
swap('''      let flags = [...flagsCp];
      const noPkg = appt''',
     '''      let flags = [...flagsCp];
      if (dates && dates.length && v.rep.freq && REP_SKIPPED.length) {
        const sk = REP_SKIPPED.slice(0, 5).map((x) => `${clDay(x)} (${closureOn(ROOMS[v.room].loc, x)?.name || "closed"})`).join(", ");
        flags.push({ level: "info", title: "Some dates skipped", msg: `${REP_SKIPPED.length === 1 ? "1 date is" : `${REP_SKIPPED.length} dates are`} left out because the studio is closed: ${sk}${REP_SKIPPED.length > 5 ? " and more" : ""}.` });
      }
      const noPkg = appt''')

# Adding or moving a class onto a closed day asks first (other edits to a class kept on a closed day don't).
swap('''    if (opts.isNew && c.start < NOW) f.push({ level: "confirm", title: "Date is in the past",''',
     '''    {
      const cl = closureOn(c.loc, ymd(c.start));
      const was = opts.excludeId ? SESSIONS.find((x) => x.id === opts.excludeId) : null;
      if (cl && (!was || ymd(was.start) !== ymd(c.start) || was.loc !== c.loc)) {
        f.push({ level: "confirm", title: "The studio is closed that day", msg: `The studio is closed on ${fmtDay(c.start)} (${cl.name}). ${was ? "Move the class there" : "Add the class"} anyway?` });
      }
    }
    if (opts.isNew && c.start < NOW) f.push({ level: "confirm", title: "Date is in the past",''')
