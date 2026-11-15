  // ===========================================================================
  // Deleting templates, and the attendance lock. Same rules as the API:
  //  - DELETE /templates/:id asks first; classes made from a template keep every detail.
  //  - Attendance locks at midnight at the end of the class's day. Until then staff can change it
  //    and no-show fees follow it; after it, it's final: only admins can correct it, after a
  //    warning. Collecting a no-show fee before the lock asks first. Late-cancellation fees are
  //    final straight away.
  // ===========================================================================
  /** Midnight at the end of the class's day. */
  const attLockOf = (s) => day(addDays(s.start, 1));
  const lockWords = (s) => `midnight at the end of ${fmtDay(s.start)}`;
  function attHint(s, role, attOpen) {
    if (NOW < addMin(s.start, -60)) return `<span class="hint">Attendance opens an hour before class (${clock(addMin(s.start, -60))}) and locks at ${lockWords(s)}.</span>`;
    if (NOW >= attLockOf(s)) {
      return alertBox("info", "Attendance is locked", role === "admin"
        ? `It locked at ${lockWords(s)}, and no-show fees are final. You can still correct it; you'll be asked first, because it adds or removes a no-show fee.`
        : `It locked at ${lockWords(s)}, and no-show fees are final. Ask an admin if it needs correcting.`);
    }
    return `<span class="hint">Tap ✓ for attended or ✕ for a no-show. Tap a name for details. Attendance locks at ${lockWords(s)}${sameDay(s.start, NOW) ? " (tonight)" : ""}; until then, no-show fees follow it.</span>`;
  }
  /** Before a no-show fee is collected: is attendance still open? */
  function feeFinalAt(f) {
    if (f.type !== "no_show") return null;
    const s = SESSIONS.find((x) => x.id === f.sid);
    return s ? { at: attLockOf(s), s } : null;
  }
  function feeGate(inv, go) {
    const f = inv.ref?.fee && FEES.find((x) => x.id === inv.ref.fee);
    const fin = f && feeFinalAt(f);
    if (!fin || NOW >= fin.at) return go();
    confirmFlags([{ level: "confirm", title: "Attendance can still change", msg: `Attendance for this class can still change until ${lockWords(fin.s)}, which would remove this no-show fee. Collect it now anyway?` }], { proceed: go, proceedLabel: "Collect anyway" });
  }
  function feeStatus(x) {
    if (x.status !== "pending") return x.status === "paid" ? '<span class="status done">Paid</span>' : `<span class="status off" data-help="${esc(x.reason || "")}">Waived</span>`;
    const fin = feeFinalAt(x);
    if (fin && NOW < fin.at) return `<span class="status wait" data-help="If attendance is corrected before ${esc(lockWords(fin.s))}, this fee is removed.">Final after midnight</span>`;
    return '<span class="status open">To be collected</span>';
  }

  // --- Deleting a template ------------------------------------------------------------
  function deleteTemplate(id) {
    const t = TEMPLATES[id];
    if (!t) return;
    const upcoming = SESSIONS.filter((s) => s.tpl === id && s.status === "scheduled" && s.start > NOW);
    const repeats = new Set(upcoming.map((s) => s.series).filter(Boolean)).size;
    const used = [upcoming.length ? plural(upcoming.length, "upcoming class", "upcoming classes") : "", repeats ? plural(repeats, "repeating schedule") : ""].filter(Boolean).join(" and ");
    confirmFlags([{ level: "confirm", title: "Delete this template?", msg: `“${t.label}” will be deleted, so it can't be used for new classes.${used ? ` The ${used} made from it stay exactly as they are.` : " No upcoming classes use it."}` }], {
      proceedLabel: "Delete template",
      proceed: () => { t.archived = true; const i = TEMPLATE_LIST.indexOf(t); if (i >= 0) TEMPLATE_LIST.splice(i, 1); closeModal(); render(); toast(`“${t.label}” deleted.${upcoming.length ? ` Its ${plural(upcoming.length, "class", "classes")} are unchanged.` : ""}`); },
    });
  }
