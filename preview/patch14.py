# Run from inject.py after patch13 (uses its `s`, `once`, `swap`): deleting templates and the
# attendance lock (see mkt17.js).

# Templates: Delete on each row and in the editor.
swap('''<th>Instructor</th><th>Spots</th></tr></thead><tbody>
        ${TEMPLATE_LIST.map(''', '''<th>Instructor</th><th>Spots</th><th aria-label="Delete"></th></tr></thead><tbody>
        ${TEMPLATE_LIST.map(''')
swap('''${t.instr ? `<div class="cellp">${instrAvatar(t.instr, "sm")}${esc(STAFF[t.instr])}</div>` : "TBC"}</td><td>${t.cap}</td></tr>`).join("")}''',
     '''${t.instr ? `<div class="cellp">${instrAvatar(t.instr, "sm")}${esc(STAFF[t.instr])}</div>` : "TBC"}</td><td>${t.cap}</td><td><button type="button" class="btn ghost danger" data-tpldel="${t.id}" aria-label="Delete ${esc(t.label)}" data-help="Delete this template. Classes made from it stay as they are.">Delete</button></td></tr>`).join("")}''')
swap('''        tr.onkeydown = (e) => { if (e.key === "Enter") openTemplate(tr.dataset.tpl); };
      });''', '''        tr.onkeydown = (e) => { if (e.key === "Enter" && e.target === tr) openTemplate(tr.dataset.tpl); };
      });
      document.querySelectorAll("[data-tpldel]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); deleteTemplate(b.dataset.tpldel); }));''')
swap('''      <footer><button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">${id ? "Save template" : "Create template"}</button></footer></form></div>`;''',
     '''      <footer>${id ? '<button type="button" class="btn ghost danger" id="tDel" style="margin-right:auto">Delete template</button>' : ""}<button type="button" class="btn ghost" data-mclose>Cancel</button><button type="submit" class="btn primary">${id ? "Save template" : "Create template"}</button></footer></form></div>`;''')
swap('''    $("#tType").addEventListener("change", paintAc);
    paintAc();''', '''    $("#tType").addEventListener("change", paintAc);
    paintAc();
    if ($("#tDel")) $("#tDel").onclick = () => deleteTemplate(id);''')

# Attendance lock in the class panel.
swap('''    const attOpen = NOW >= addMin(s.start, -60);''', '''    // Attendance opens an hour before class and locks at midnight after it (admins can still correct it).
    const attOpen = NOW >= addMin(s.start, -60) && (NOW < attLockOf(s) || role === "admin");''')
swap('''        ${attOpen ? "" : `<span class="hint">Attendance opens an hour before class (${clock(addMin(s.start, -60))}).</span>`}
        ${attOpen ? `<span class="hint">Tap ✓ for attended or ✕ for a no-show. Tap a name for details.</span>` : ""}''', '''        ${attHint(s, role, attOpen)}''')
swap('''    if (t.dataset.att) {
      const [ci, val] = t.dataset.att.split(":");''', '''    if (t.dataset.att) {
      if (NOW >= attLockOf(current()) && !t._lockOk) {
        const btn = t;
        confirmFlags([{ level: "confirm", title: "Attendance is locked", msg: `Attendance for this class was locked at ${lockWords(current())}, and any no-show fees are final. Changing it now adds or removes a no-show fee. Change it anyway?` }], { proceedLabel: "Change it", proceed: () => { btn._lockOk = true; btn.click(); } });
        return;
      }
      const [ci, val] = t.dataset.att.split(":");''')

# Fees: no-show fees say when they become final; collecting one early asks first.
swap('''<td>${x.status === "pending" ? '<span class="status open">To be collected</span>' : `<span class="status off" data-help="${esc(x.reason || "")}">Waived</span>`}</td>''', '''<td>${feeStatus(x)}</td>''')
swap('''due.length ? `${money(total, STUDIO.currency)} to collect from ${plural(new Set(due.map((x) => x.ci)).size, "client")}. Fees are collected once payments are switched on.` : "Nothing to collect."''',
     '''due.length ? `${money(total, STUDIO.currency)} to collect from ${plural(new Set(due.map((x) => x.ci)).size, "client")}. Late-cancellation fees are final straight away; no-show fees become final at midnight after the class, when attendance locks.` : "Nothing to collect."''')
swap('''${rule("No-show fee", "Added when a client is marked as a no-show; removed if that's corrected.",''', '''${rule("No-show fee", "Added when a client is marked as a no-show; removed if that's corrected before attendance locks at midnight after the class. After that it's final.",''')
swap('''    noShowFeeEnabled: "Clients marked as a no-show are charged this fee. It's removed automatically if attendance is corrected.",''',
     '''    noShowFeeEnabled: "Clients marked as a no-show are charged this fee. It's removed automatically if attendance is corrected before it locks at midnight after the class. After that, only an admin can correct attendance, and the fee is final.",''')
