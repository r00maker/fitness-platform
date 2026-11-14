# Run from inject.py (uses its `s` and `once`): menu groups, Agents, bell + Ask hooks, Edit many.

once('{ id: "agents", group:', '    { id: "checkout", group: "Studio"',
     '    { id: "agents", group: "Team", roles: ["admin"], label: "Agents", help: "Helpers that remind your team about things (cover classes, quiet classes), plus the assistant\'s settings and usage." },\n')
once("    agents: '<rect", PREF_ICON,
     "    agents: '<rect x=\"5\" y=\"8\" width=\"14\" height=\"11\" rx=\"3\"/><path d=\"M12 4v4M9.5 13h.01M14.5 13h.01M9.5 16h5\"/><circle cx=\"12\" cy=\"3.5\" r=\"1\"/>',\n")


def swap(old, new):
    """Replace once; skip if it's already been done."""
    global s
    if new in s:
        return
    assert old in s, old[:90]
    s = s.replace(old, new, 1)


# Menu groups can depend on the role (e.g. Schedule sits under "Classes" for clients).
swap("""    const groups = [...new Set(items.map((i) => i.group))];
    $("#side").innerHTML = groups.map((g) => `<div class="navgrp"><h3>${g}</h3>${items.filter((i) => i.group === g).map((i) => {""",
     """    const grp = (i) => (typeof i.group === "function" ? i.group(state.role) : i.group);
    const groups = [...new Set(items.map(grp))];
    $("#side").innerHTML = groups.map((g) => `<div class="navgrp"><h3>${g}</h3>${items.filter((i) => grp(i) === g).map((i) => {""")

# The bell and Ask button redraw with everything else.
swap("""    renderChrome();
    renderNav();
    const onSchedule""", """    renderChrome();
    renderNav();
    renderAgentChrome(); renderAsk();
    const onSchedule""")

# One "Edit many" button instead of "Change many" + "Select classes".
swap("""            <button type="button" class="btn" id="bulkChange" data-help="Change or cancel lots of classes in one go: everything matching a filter (e.g. every Monday 7am Reformer for the next 3 months), not just what's on screen.">Change many</button>
            <button type="button" class="btn" id="selectMode" aria-pressed="false" data-help="Pick several classes on the calendar, then change or cancel them all in one go.">Select classes</button>
""", """            <button type="button" class="btn" id="bulkChange" data-help="Change or cancel several classes at once: pick them on the calendar, or choose them with filters (e.g. every Monday 7am Reformer for the next 3 months).">Edit many</button>
""")
swap("""    $("#selectMode").hidden = state.role !== "admin";
    $("#bulkChange").hidden = state.role !== "admin";
    $("#selectMode").setAttribute("aria-pressed", String(state.selecting));""", """    $("#bulkChange").hidden = state.role !== "admin";
    $("#bulkChange").setAttribute("aria-pressed", String(state.selecting));""")
swap("""  $("#selectMode").onclick = () => { state.selecting = !state.selecting; state.selected.clear(); closeDrawer(); render(); };""",
     """  /** Edit many: pick classes on the calendar (chosen from the Edit many window). */
  function startPicking() { state.selecting = true; state.selected.clear(); closeDrawer(); closeModal(); render(); toast("Tap the classes you want to change, then press Next."); }""")
swap("""  $("#bulkChange").onclick = () => { state.selected.clear(); openBulkChange(); };""",
     """  $("#bulkChange").onclick = () => { if (state.selecting && state.selected.size) return openBulkChange(); state.selecting = false; state.selected.clear(); render(); openBulkChange(); };""")
swap("""      <b>${n ? plural(n, "class", "classes") + " selected" : "Tap classes to select them"}</b>
      <button type="button" class="btn" data-sel="all">Select all shown</button>
      ${n ? `<button type="button" class="btn" data-sel="clear">Clear</button>` : ""}
      <button type="button" class="btn" data-sel="edit" ${n ? "" : "disabled"}>Change selected</button>
      <button type="button" class="btn danger" data-sel="cancel" ${n ? "" : "disabled"}>Cancel selected</button>
      <button type="button" class="btn primary" data-sel="done">Done</button></div>` : "";""",
     """      <b>${n ? plural(n, "class", "classes") + " picked" : "Tap classes to pick them"}</b>
      <button type="button" class="btn" data-sel="all">Pick all shown</button>
      ${n ? `<button type="button" class="btn" data-sel="clear">Clear</button>` : ""}
      <button type="button" class="btn ghost" data-sel="done">Stop picking</button>
      <button type="button" class="btn primary" data-sel="edit" ${n ? "" : "disabled"}>Next: change or cancel</button></div>` : "";""")

# Room picker: group rooms by location so the chosen room fits (the location is the group heading).
swap("""<select id="fRoom">${opt(liveRooms(), v0.room, (r) => `${r.name} · ${LOCS[r.loc]} (holds ${r.cap})`)}</select>""",
     """<select id="fRoom">${Object.entries(LOCS).map(([lk, ln]) => { const rs = Object.entries(liveRooms()).filter(([, r]) => r.loc === lk && !r.none); return `<optgroup label="${esc(ln)}">${rs.map(([k, r]) => `<option value="${k}" ${String(v0.room) === k ? "selected" : ""}>${esc(r.name)} (holds ${r.cap})</option>`).join("")}<option value="none_${lk}" ${String(v0.room) === `none_${lk}` ? "selected" : ""}>No room: anywhere at ${esc(ln)}</option></optgroup>`; }).join("")}</select>""")

# Dropdowns with inline styles that hid the chevron.
s = s.replace('<select id="cTag" style="height:34px;border:1px solid var(--line);border-radius:8px;padding:0 8px;background:var(--surface)"', '<select id="cTag"')
