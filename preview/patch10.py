# Run from inject.py after patch9 (uses its `s`, `once`, `swap`): calendar shortcuts, rooms optional,
# membership holds, class type kinds, goal help, menu icons.

# Calendar columns know their date (for double-click to add and drag to move), and whether it's a closed day (see mkt13.js).
swap('''      return `<div class="dcol ${sameDay(d, NOW) ? "today" : ""}" style="height:''',
     '''      return `<div class="dcol ${sameDay(d, NOW) ? "today" : ""} ${closedCls(d)}" data-date="${ymd(d)}" style="height:''')
swap('''      <div class="wg-body"><div class="gutter">${hours.join("")}</div>${cols.join("")}</div>
    </div></div>`;''', '''      <div class="wg-body"><div class="gutter">${hours.join("")}</div>${cols.join("")}</div>
    </div></div>${state.role === "admin" && !narrow() ? '<p class="calhint">Double-click an empty time to add a class. Drag a class to move it to another time.</p>' : ""}`;''')

# Classes without a room: "No room" in the room picker, and where it's shown.
swap('''    const where = `${esc(ROOMS[s.room].name)}, ${esc(LOCS[s.loc])}`;''',
     '''    const where = ROOMS[s.room].none ? esc(LOCS[s.loc]) : `${esc(ROOMS[s.room].name)}, ${esc(LOCS[s.loc])}`;''')
swap('''${instrLabel(s, { avatar: true })} · ${esc(ROOMS[s.room].name)}${flags.length''', '''${instrLabel(s, { avatar: true })} · ${esc(roomOrLoc(s.room))}${flags.length''')
swap('''<dt>Where</dt><dd>${esc(LOCS[s.loc])} · ${esc(ROOMS[s.room].name)}</dd>''', '''<dt>Where</dt><dd>${esc(LOCS[s.loc])}${ROOMS[s.room].none ? "" : ` · ${esc(ROOMS[s.room].name)}`}</dd>''')
swap('''const where = (s) => `${ROOMS[s.room]?.name || ""}, ${LOCS[s.loc]}`;''', '''const where = (s) => (ROOMS[s.room]?.none ? LOCS[s.loc] : `${ROOMS[s.room]?.name || ""}, ${LOCS[s.loc]}`);''')
swap('''    if (room && c.cap > room.cap) f.push(''', '''    if (room && !room.none && c.cap > room.cap) f.push(''')
swap('''      if (c.room && o.room === c.room) f.push(''', '''      if (c.room && !ROOMS[c.room]?.none && o.room === c.room) f.push(''')
swap('''      if (o.room === s.room && !out.includes("Room already in use")) out.push''', '''      if (o.room === s.room && !ROOMS[s.room]?.none && !out.includes("Room already in use")) out.push''')
swap('''      const rooms = Object.entries(ROOMS).filter(([, r]) => r.loc === lk && !r.archived);''', '''      const rooms = Object.entries(ROOMS).filter(([, r]) => r.loc === lk && !r.archived && !r.none);''')
swap('''    const others = Object.entries(ROOMS).filter(([k, x]) => k !== rk && x.loc === r.loc && !x.archived);''', '''    const others = Object.entries(ROOMS).filter(([k, x]) => k !== rk && x.loc === r.loc && !x.archived && !x.none);''')
swap('''}).join("") + `<span class="hint">Need another location? Get in touch and we'll add it for you.</span>`;''',
     '''}).join("") + `<span class="hint">One open space? You don't need any rooms: choose “No room” when you add a class, and it's shown at the location. Need another location? Get in touch and we'll add it for you.</span>`;''')

# Membership payment holds: the package is on hold, and can't be used to book, until it's paid.
swap('''    if (pk.cancelled) return "cancelled";
    if (pk.expires && NOW >= pk.expires) return "expired";''', '''    if (pk.cancelled) return "cancelled";
    if (pk.hold) return "held";
    if (pk.expires && NOW >= pk.expires) return "expired";''')
swap('''  const STATE_LABEL = { not_started: "Not started", active: "Active", used_up: "Used up", expired: "Expired", cancelled: "Cancelled" };''',
     '''  const STATE_LABEL = { not_started: "Not started", active: "Active", used_up: "Used up", expired: "Expired", cancelled: "Cancelled", held: "Payment on hold" };''')
swap('''  const STATE_CLASS = { not_started: "wait", active: "done", used_up: "off2", expired: "off2", cancelled: "off2" };''',
     '''  const STATE_CLASS = { not_started: "wait", active: "done", used_up: "off2", expired: "off2", cancelled: "off2", held: "open" };''')
swap('''    if (st === "cancelled") return "It's been cancelled";''', '''    if (st === "cancelled") return "It's been cancelled";
    if (st === "held") return holdWhy(pk);''')
s = s.replace('["active", "not_started"].includes(pkgState(pk))', '["active", "not_started", "held"].includes(pkgState(pk))')
swap('''      ${req ? alertBox("info", "Extension requested",''', '''      ${pk.hold ? (as === "admin" ? holdBox(pk, "admin") : alertBox("warn", "", "Its payment didn't go through. Pay at the top of this page to use it again.")) : ""}
      ${req ? alertBox("info", "Extension requested",''')

# New class / New appointment type buttons open the editor on the right kind.
swap('''  function openTypeEditor(key) {
    const cur = key ? TYPES[key] : null;
    const d = cur ? { name: cur.name, kind: cur.kind, color: cur.color, usual: cur.usual } : { name: "", kind: "class",''',
     '''  function openTypeEditor(key, kind) {
    const cur = key ? TYPES[key] : null;
    const d = cur ? { name: cur.name, kind: cur.kind, color: cur.color, usual: cur.usual } : { name: "", kind: kind === "appointment" ? "appointment" : "class",''')

# Journey goals: the three choices, and what happens when someone reaches one.
swap('''    goal: "What the journey is for, e.g. buying a package. Reaching it ends''', '''    goal: "What counts as success: booking a class, coming to one, or buying a package. If a “Wait for” step is waiting for the same thing, they carry on down its Yes side; otherwise reaching it ends''')

# Menu icons.
once("    sales: '<path", PREF_ICON,
     "    sales: '<path d=\"M6 3h12v18l-3-2-3 2-3-2-3 2z\"/><path d=\"M9 8h6M9 12h6M9 16h3\"/>',\n"
     "    shop: '<path d=\"M4 8h16l-1.2 11.2a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8z\"/><path d=\"M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8\"/>',\n")
