# Run from inject.py after patch12 (uses its `s`, `once`, `swap`): the waitlist setting (clients
# choose, or one way for everyone) and the attachment quick view (see mkt16.js).

# Waitlist: the studio's setting, on Studio rules.
swap('''    expiry: [5, 3, 1], hold: 10, coverApproval''', '''    expiry: [5, 3, 1], hold: 10, wlModes: "both", coverApproval''')
swap('''          ${rule("Hold time", "How long a spot is held for someone who chose “Ask me first”.",''',
     '''          ${rule("How waitlists work", "Let clients choose, or use one way for everyone. People already waiting keep the choice they made.", sel("pWlModes", [["both", "Clients choose"], ["automatic", "Always book in automatically"], ["manual", "Always ask first"]], STUDIO.wlModes), "waitlistModes")}
          ${rule("Hold time", "How long a spot is held for someone who chose “Ask me first”.",''')
swap('''    waitlistHoldMinutes: "How long a spot is held''',
     '''    waitlistModes: "“Clients choose”: each client picks “Book me in automatically” or “Ask me first” when they join. Or choose one way for everyone, and clients aren't asked.",
    waitlistHoldMinutes: "How long a spot is held''')
swap('''hold: Number($("#pHold").value), expiry:''', '''hold: Number($("#pHold").value), wlModes: $("#pWlModes").value, expiry:''')

# Joining a waitlist: clients only choose when the studio lets them.
swap('''      <div class="lbl" style="font-size:12.5px;font-weight:600;display:flex;gap:5px;align-items:center">When a spot opens ${tip("mode")}</div>
      <label class="opt"><input type="radio" name="wlmode" id="wlAuto" value="automatic" checked><div><b>Book me in automatically</b><span>We take the spot for you and let you know.</span></div></label>
      <label class="opt"><input type="radio" name="wlmode" id="wlAsk" value="manual"><div><b>Ask me first</b><span>We hold the spot for ${STUDIO.hold} minutes while you confirm.</span></div></label>''',
     '''      ${STUDIO.wlModes === "both" ? `<div class="lbl" style="font-size:12.5px;font-weight:600;display:flex;gap:5px;align-items:center">When a spot opens ${tip("mode")}</div>
      <label class="opt"><input type="radio" name="wlmode" id="wlAuto" value="automatic" checked><div><b>Book me in automatically</b><span>We take the spot for you and let you know.</span></div></label>
      <label class="opt"><input type="radio" name="wlmode" id="wlAsk" value="manual"><div><b>Ask me first</b><span>We hold the spot for ${STUDIO.hold} minutes while you confirm.</span></div></label>`
        : `<input type="radio" name="wlmode" value="${STUDIO.wlModes}" checked hidden>${alertBox("info", "When a spot opens", STUDIO.wlModes === "automatic" ? "We'll book you in automatically and let you know." : `We'll hold the spot for ${STUDIO.hold} minutes and ask you to confirm.`)}`}''')

# Attachments open in the quick view: on the Packages page, and on the client's own package.
swap('''${r.file ? `<br><span class="tag">📎 ${esc(r.file)}</span>` : ""}''', '''${r.file ? `<br>${attachChip(r)}` : ""}''')
swap('''<span>Extension request: ${plural(r.days, "day")}, “${esc(r.reason)}”</span>''', '''<span>Extension request: ${plural(r.days, "day")}, “${esc(r.reason)}”${r.file ? ` ${attachChip(r)}` : ""}</span>''')
# Keep the real file a client attaches, so it can be viewed.
swap('''keep(); st.file = f.name; paint(); };''', '''keep(); st.file = f.name; st.blob = f; paint(); };''')
swap('''        EXTREQ.push({ id: nextReqId++, pkg: pk.id, ci: ME.client, days: st.days, reason: st.why.trim(), file: st.file, status: "pending", when: "Just now" });''',
     '''        EXTREQ.push({ id: nextReqId++, pkg: pk.id, ci: ME.client, days: st.days, reason: st.why.trim(), file: st.file, status: "pending", when: "Just now" });
        if (st.blob) { const f = st.blob; ATTACH.set(EXTREQ.at(-1).id, { name: st.file, type: f.type || (/\\.pdf$/i.test(st.file) ? "application/pdf" : "image/jpeg"), data: () => Promise.resolve(f) }); }''')
