  // ===========================================================================
  // Cancelled classes on the calendar ("Show cancelled", staff only) and each class's
  // Cancellations tab. Same rules as GET /calendar?includeCancelled=true and the
  // `cancellations` part of GET /sessions/:id (apps/api/src/modules/sessions/cancellations.ts).
  // ===========================================================================
  const CX_VIA = { self: "Cancelled by the client", staff: "Cancelled by the studio", class_cancelled: "Class cancelled", moved: "Moved to another class", membership_ended: "Membership ended" };
  const CX_REASONS = ["Called in sick", "Travelling for work", "Injured their back", "Childcare fell through"];
  state.showCancelled = false;
  state.drTab = "list";

  /** Record a cancelled booking on the class, for its Cancellations tab. */
  function logCancel(s, ci, o) {
    (s.cancels ||= []).push({ ci, at: NOW, late: !!o.late, how: o.how, by: o.how === "self" ? null : o.by || "You", reason: o.reason || null, returned: !!o.returned, fee: o.fee || null });
  }

  // Sample cancellations: a few on most classes, all made before "now".
  for (const s of SESSIONS) {
    s.cancels ||= [];
    const h = hash(`${s.id}-cx`);
    const n = h % 5 === 0 ? 2 : h % 3 === 0 ? 1 : 0;
    const taken = new Set([...s.roster.map((r) => r.ci), ...s.waitlist.map((w) => w.ci)]);
    const free = CLIENTS.map((_, i) => i).filter((i) => !taken.has(i) && (CLIENTS[i].source !== "direct" || CLIENTS[i].waiver));
    for (let k = 0; k < n && free.length; k++) {
      const ci = free.splice((h >> (k + 2)) % free.length, 1)[0];
      const before = [70, 30, 5, 1.5, 40, 20][(h >> (k * 3 + 1)) % 6];
      const at = new Date(+s.start - before * 36e5);
      if (at > NOW) continue;
      const late = before < STUDIO.lateCancelHours;
      const how = (h >> (k + 4)) % 4 === 0 ? "staff" : (h >> (k + 4)) % 7 === 1 && !late ? "moved" : "self";
      const cp = CLIENTS[ci].source === "classpass";
      s.cancels.push({ ci, at, late, how, by: how === "self" ? null : "Olivia Tan (owner)", reason: how === "staff" ? CX_REASONS[h % CX_REASONS.length] : null, returned: !late && !cp, fee: late && !cp && STUDIO.lateFeeOn ? STUDIO.lateFeeCents : null, cp });
    }
  }
  // Today's 10:45 Reformer has one late and one on-time cancellation, so the tab always has something to show.
  {
    const s = SESSIONS.find((x) => ymd(x.start) === "2026-11-11" && hhmm(x.start) === "10:45");
    if (s) {
      const out = CLIENTS.map((_, i) => i).filter((i) => !s.roster.some((r) => r.ci === i) && CLIENTS[i].source !== "classpass" && CLIENTS[i].waiver);
      s.cancels = [
        { ci: out[0], at: new Date(+s.start - 26 * 36e5), late: false, how: "self", by: null, reason: null, returned: true, fee: null },
        { ci: out[1], at: new Date(+s.start - 3 * 36e5), late: true, how: "self", by: null, reason: null, returned: false, fee: STUDIO.lateFeeCents },
      ];
    }
  }
  // Two sample cancelled classes: one cancelled by an admin last Monday, one cancelled automatically tonight.
  {
    const mon = SESSIONS.find((x) => ymd(x.start) === "2026-11-09" && hhmm(x.start) === "12:30");
    if (mon) Object.assign(mon, { status: "cancelled", cancelledAt: new Date(2026, 10, 9, 8, 5), cancelReason: "Instructor unwell", cancelRefund: "credit", cancelledBy: "Olivia Tan (owner)" });
    const tonight = SESSIONS.filter((x) => ymd(x.start) === "2026-11-11" && x.start.getHours() >= 19 && x.status === "scheduled").sort((a, b) => a.roster.length - b.roster.length)[0];
    if (tonight) {
      tonight.roster = tonight.roster.slice(0, 2);
      tonight.ac = { min: 3, h: 12 };
      Object.assign(tonight, { status: "cancelled", cancelledAt: new Date(+tonight.start - 12 * 36e5), cancelReason: "Fewer than 3 people booked 12 hours before", cancelRefund: "credit", autoCancelled: true, cancelledBy: null });
    }
  }

  /** Everyone whose booking ended: their own cancellations, plus (for a cancelled class) everyone who was booked. */
  function allCancels(s) {
    const list = [...(s.cancels || [])];
    if (s.status === "cancelled") {
      for (const r of s.roster) list.push({ ci: r.ci, at: s.cancelledAt || NOW, late: false, how: "class_cancelled", by: s.autoCancelled ? "Cancelled automatically" : s.cancelledBy || "You", reason: s.cancelReason || null, returned: s.cancelRefund !== "none" && r.pay?.kind === "package", fee: null, cp: CLIENTS[r.ci].source === "classpass" });
    }
    return list.sort((a, b) => a.at - b.at);
  }
  function beforeText(s, at) {
    const m = Math.round((s.start - at) / 6e4);
    if (m < 0) return "after it started";
    if (m < 60) return `${plural(m, "minute")} before class`;
    if (m < 48 * 60) return `${plural(Math.round(m / 60), "hour")} before class`;
    return `${plural(Math.round(m / 1440), "day")} before class`;
  }
  function cxSummary(list) {
    const moved = list.filter((c) => c.how === "moved").length;
    const n = list.length - moved, late = list.filter((c) => c.late).length;
    const parts = [n ? `${plural(n, "cancellation")}${late ? ` (${late} late)` : ""}` : "", moved ? `${moved} moved to another class` : ""].filter(Boolean);
    return parts.length ? `${parts.join(", ")}.` : "No one has cancelled this class.";
  }
  function cxRow(s, c) {
    const who = CLIENTS[c.ci];
    const badge = c.how === "moved" ? '<span class="status wait">Moved</span>' : c.how === "class_cancelled" ? '<span class="status off">Class cancelled</span>' : c.late ? '<span class="status open">Late cancel</span>' : '<span class="status done">On time</span>';
    const credit = c.cp ? "ClassPass handles the credit" : c.how === "moved" ? "Moved with their package" : c.returned ? "Class back on their package" : c.late ? "Class not given back (late)" : "No package class to give back";
    const by = c.how === "self" ? CX_VIA.self : c.how === "class_cancelled" ? `Class cancelled${c.by ? ` · ${esc(c.by)}` : ""}` : `${CX_VIA[c.how]}${c.by ? ` · by ${esc(c.by)}` : ""}`;
    return `<div class="cxrow">${avatar(who)}<div class="stack" style="gap:2px;min-width:0">
      <div class="row" style="gap:6px"><b>${esc(who.name)}</b>${badge}</div>
      <span class="cxmeta">${fmtDay(c.at)} ${clock(c.at)} · ${beforeText(s, c.at)}</span>
      <span class="cxmeta">${by}${c.reason ? ` · “${esc(c.reason)}”` : ""}</span>
      <span class="cxmeta">${credit}${c.fee ? ` · Late fee ${money(c.fee, STUDIO.currency)} to collect under Fees` : ""}</span></div></div>`;
  }
  function cancelsSection(s) {
    const list = allCancels(s);
    return `<div class="dr-sec"><span class="hint">${esc(cxSummary(list))} Only staff see this list.</span>
      ${list.length ? `<div class="roster cxlist">${list.map((c) => cxRow(s, c)).join("")}</div>` : ""}</div>`;
  }
  function drTabs(s) {
    const n = allCancels(s).filter((c) => c.how !== "moved").length;
    return `<div class="tabs drtabs" role="tablist" aria-label="Class list or cancellations">
      <button type="button" role="tab" data-drtab="list" aria-selected="${state.drTab !== "cx"}">Class list<span class="n">${s.roster.length}</span></button>
      <button type="button" role="tab" data-drtab="cx" aria-selected="${state.drTab === "cx"}">Cancellations<span class="n">${n}</span></button></div>`;
  }
  /** A cancelled class opens read-only: why, when, and everyone affected. */
  function cancelledDrawer(s) {
    const when = s.cancelledAt ? `${fmtDay(s.cancelledAt)} at ${clock(s.cancelledAt)}` : "";
    const head = s.autoCancelled
      ? alertBox("warn", "Cancelled automatically", `${esc(s.cancelReason || "Not enough people booked.")}${when ? ` (${when})` : ""}. Everyone booked was told and got their class back.`)
      : alertBox("warn", "This class was cancelled", `${s.cancelReason ? `Reason: “${esc(s.cancelReason)}”. ` : ""}${when ? `Cancelled ${when}${s.cancelledBy ? ` by ${esc(s.cancelledBy)}` : ""}. ` : ""}Everyone booked was told.`);
    return `<div class="dr-sec">${head}</div><div class="stats">
      <div class="stat"><b>${s.roster.length}</b><span>Were booked</span></div>
      <div class="stat"><b>${s.waitlist.length}</b><span>Were waiting</span></div>
      <div class="stat"><b>${(s.cancels || []).filter((c) => c.how !== "moved").length}</b><span>Cancelled before</span></div></div>
      <div class="dr-sec"><h3>Cancellations</h3></div>${cancelsSection(s)}
      <span class="hint">Cancelled classes can't be brought back. To run it after all, add a new class at the same time.</span>`;
  }

  // Calendar toggle and drawer tabs.
  $("#fCx").onchange = (e) => { state.showCancelled = e.target.checked; render(); toast(state.showCancelled ? "Showing cancelled classes, struck through." : "Cancelled classes hidden."); };
  $("#drawerRoot").addEventListener("click", (e) => {
    const t = e.target.closest("[data-drtab]");
    if (!t) return;
    state.drTab = t.dataset.drtab;
    renderDrawer();
    document.querySelector(`[data-drtab="${state.drTab}"]`)?.focus();
  });
