  // ===========================================================================
  // Reviews, client feedback and celebrations. Same rules as the API
  // (apps/api/src/modules/reviews, feedback, moments):
  //  - After a class they came to, clients are asked to review it (only the latest one). Skip is
  //    fine: the next class asks again. With a review they can pause the pop-ups for N weeks.
  //  - After any review, everyone is offered the studio's Google review link with their words
  //    copied (never only happy clients: Google forbids that "review gating").
  //  - Feedback: clients write to the studio in a category; staff see categories apart, plus Needs
  //    attention (new feedback and low reviews), reply and mark it sorted.
  //  - Celebrations: fortnightly recaps and milestones for instructors and owners, with an AI
  //    summary of review comments and self-care tips when the studio has AI recaps on.
  // ===========================================================================
  Object.assign(STUDIO, { reviewsOn: true, googleUrl: "https://g.page/r/demo-studio/review", celebOn: true, aiRecaps: true });
  const LOW_STARS = 2;
  const STAR_WORDS = ["", "Not good", "Could be better", "Okay", "Good", "Loved it"];
  const FB_CATS = {
    facilities: ["Facilities and comfort", "Temperature, showers, cleanliness, lockers"],
    classes: ["Classes and schedule", "Class times, new classes, how full they get"],
    instructors: ["Instructors", "Praise or suggestions for the team"],
    app: ["App and booking", "Booking, payments, reminders, this app"],
    prices: ["Prices and packages", "Packages, memberships, discounts"],
    other: ["Something else", "Anything that doesn't fit above"],
  };
  const FB_STATUS = { new: ["New", "open"], in_progress: ["Replied", "wait"], resolved: ["Sorted", "done"] };
  const SNOOZE_WEEKS = [2, 4, 8, 12];
  const starsText = (n) => "★".repeat(n) + "☆".repeat(5 - n);

  // --- Sample reviews for classes that have finished ---------------------------------
  const RV_GOOD = ["Loved the music and the energy!", "Clear cues, I finally understood the footwork.", "Tough but so good. My core is on fire.", "Such a friendly class, I felt welcome straight away.", "Perfect pace for a Monday morning.", "Great playlist and lovely studio.", "Best class of my week, every week.", null, null];
  const RV_MID = ["Good class but the room got quite warm.", "Nice, a bit fast for a beginner.", "Good, but it started a few minutes late.", null];
  const REVIEWS = [];
  let nextRvId = 1;
  for (const s of SESSIONS) {
    if (s.end >= NOW || s.end < addDays(NOW, -30) || s.status !== "scheduled") continue;
    for (const r of s.roster) {
      const h = hash(`${s.id}-${r.ci}-rv`);
      if (h % 6 || r.att === "no_show") continue;
      const rating = h % 23 === 0 ? 3 : h % 9 === 0 ? 4 : h % 31 === 0 ? 3 : 5 - (h % 7 === 0 ? 1 : 0);
      const pool = rating >= 4 ? RV_GOOD : RV_MID;
      REVIEWS.push({ id: nextRvId++, sid: s.id, ci: r.ci, instr: s.instr, type: s.type, loc: s.loc, rating, comment: pool[(h >>> 3) % pool.length], at: addMin(s.end, 60 + (h % 600)), google: h % 3 === 0 ? "tapped" : "offered", handled: false, reply: null });
    }
  }
  // Two low ones to follow up, so Needs attention has something in it.
  {
    const late = SESSIONS.filter((s) => s.end < NOW && s.end > addDays(NOW, -4) && s.roster.length > 2 && s.status === "scheduled");
    if (late[0]) REVIEWS.push({ id: nextRvId++, sid: late[0].id, ci: late[0].roster[1].ci, instr: late[0].instr, type: late[0].type, loc: late[0].loc, rating: 2, comment: "The room was very warm and the aircon didn't seem to be on.", at: addMin(late[0].end, 90), google: "offered", handled: false, reply: null });
    if (late[1]) REVIEWS.push({ id: nextRvId++, sid: late[1].id, ci: late[1].roster[2].ci, instr: late[1].instr, type: late[1].type, loc: late[1].loc, rating: 1, comment: "Class started 15 minutes late and nobody said why.", at: addMin(late[1].end, 40), google: "offered", handled: false, reply: null });
  }
  const CLIENT_RV = { snoozeUntil: null, skipped: new Set(), shownThisVisit: false };

  // --- Sample feedback ----------------------------------------------------------------
  const FEEDBACK = [
    { id: 1, ci: 0, cat: "facilities", loc: "tp", message: "The aircon at Tanjong Pagar is really cold in the 7am classes. Could it be a little warmer?", status: "new", at: addMin(NOW, -95), replies: [] },
    { id: 2, ci: 3, cat: "facilities", loc: "hv", message: "One of the showers at Holland Village has been dripping for a week.", status: "in_progress", at: addDays(NOW, -2), replies: [{ studio: true, by: "Fiona", text: "Thanks for telling us! A plumber is booked for Friday morning.", at: addDays(NOW, -1) }] },
    { id: 3, ci: 5, cat: "classes", loc: null, message: "Could we have a 6am Reformer on Fridays? 7am is too late before work.", status: "new", at: addMin(NOW, -300), replies: [] },
    { id: 4, ci: 8, cat: "instructors", loc: null, message: "Priya's Thursday yoga is amazing. Please tell her thank you from me!", status: "resolved", at: addDays(NOW, -6), replies: [{ studio: true, by: "Olivia", text: "We've passed it on. She was so happy to hear it!", at: addDays(NOW, -6) }] },
    { id: 5, ci: 2, cat: "app", loc: null, message: "It would be great if classes could go straight into my Google Calendar.", status: "new", at: addDays(NOW, -1), replies: [] },
    { id: 6, ci: 11, cat: "prices", loc: null, message: "Do you have a student price? I'm at NUS.", status: "in_progress", at: addDays(NOW, -3), replies: [{ studio: true, by: "Olivia", text: "Not yet, but we're looking at it for January. We'll let you know!", at: addDays(NOW, -3) }, { studio: false, text: "Thank you!", at: addDays(NOW, -2) }] },
  ];
  let nextFbId = 7;

  // --- Client: the review pop-up ------------------------------------------------------
  /** The client's latest finished class they came to, if not yet reviewed or skipped. */
  function reviewPromptFor(ci) {
    if (!STUDIO.reviewsOn || (CLIENT_RV.snoozeUntil && CLIENT_RV.snoozeUntil > NOW)) return null;
    const last = SESSIONS.filter((s) => s.status === "scheduled" && s.end <= NOW && s.end > addDays(NOW, -14) && s.roster.some((r) => r.ci === ci && r.att !== "no_show")).sort((a, b) => b.end - a.end)[0];
    if (!last || CLIENT_RV.skipped.has(last.id) || REVIEWS.some((r) => r.sid === last.id && r.ci === ci)) return null;
    return last;
  }
  function openReviewPrompt(s, opts = {}) {
    const st = { rating: 0, comment: "", snooze: false, weeks: 4 };
    const paint = () => {
      $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><form class="modal rvmodal" id="rvForm" role="dialog" aria-modal="true" aria-labelledby="rvTitle">
        <header><div class="stack" style="gap:2px"><h2 id="rvTitle">How was ${esc(TYPES[s.type].name)}${s.instr ? ` with ${esc(firstName(STAFF[s.instr]))}` : ""}?</h2><span class="muted" style="font-size:13px">${fmtDay(s.start)} ${clock(s.start)} · ${esc(LOCS[s.loc])}</span></div></header>
        <div class="mb">
          <div class="rvstars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${st.rating === n}" aria-label="${n} ${n === 1 ? "star" : "stars"}: ${STAR_WORDS[n]}" data-star="${n}" class="${n <= st.rating ? "on" : ""}">★</button>`).join("")}</div>
          <div class="rvword" aria-live="polite">${st.rating ? STAR_WORDS[st.rating] : "Tap a star"}</div>
          <div class="field"><label for="rvText">Anything you'd like to tell us? <span class="muted" style="font-weight:400">(optional)</span></label><textarea id="rvText" maxlength="500" rows="3" placeholder="What did you enjoy? What could be better?">${esc(st.comment)}</textarea><span class="counter" id="rvCount">${st.comment.length}/500</span></div>
          <label class="check ${st.rating ? "" : "muted"}" for="rvSnooze"><input type="checkbox" id="rvSnooze" ${st.snooze ? "checked" : ""} ${st.rating ? "" : "disabled"}> Don't ask me again for <select id="rvWeeks" ${st.rating && st.snooze ? "" : "disabled"} aria-label="How long">${SNOOZE_WEEKS.map((w) => `<option value="${w}" ${st.weeks === w ? "selected" : ""}>${w} weeks</option>`).join("")}</select></label>
          ${st.rating ? "" : '<span class="hint">Choose a rating to send a review. You can also skip: we\'ll ask again after your next class.</span>'}
        </div>
        <footer><button type="button" class="btn ghost" id="rvSkip">Skip for now</button><button type="submit" class="btn primary" id="rvSend" ${st.rating ? "" : "disabled"}>Send review</button></footer></form></div>`;
      const keep = () => { st.comment = $("#rvText").value; st.snooze = $("#rvSnooze").checked; st.weeks = Number($("#rvWeeks").value); };
      document.querySelectorAll("[data-star]").forEach((b) => (b.onclick = () => { keep(); st.rating = Number(b.dataset.star); paint(); document.querySelector(`[data-star="${st.rating}"]`)?.focus(); }));
      $("#rvText").oninput = (e) => { $("#rvCount").textContent = `${e.target.value.length}/500`; };
      $("#rvSnooze").onchange = () => { keep(); paint(); };
      $("#rvSkip").onclick = () => { CLIENT_RV.skipped.add(s.id); closeModal(); toast("No problem. We'll ask again after your next class."); };
      $("#rvForm").onsubmit = (e) => {
        e.preventDefault(); keep();
        if (!st.rating) return;
        const rv = { id: nextRvId++, sid: s.id, ci: ME.client, instr: s.instr, type: s.type, loc: s.loc, rating: st.rating, comment: st.comment.trim() || null, at: NOW, google: STUDIO.googleUrl ? "offered" : null, handled: false, reply: null };
        REVIEWS.push(rv);
        if (st.snooze) CLIENT_RV.snoozeUntil = addDays(NOW, st.weeks * 7);
        renderNav();
        thanks(rv, st.snooze ? st.weeks : 0, opts.after);
      };
    };
    paint();
  }
  /** After a review: thank them, and offer Google to everyone (whatever they gave). */
  function thanks(rv, weeks, after) {
    const g = STUDIO.googleUrl;
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal rvmodal" role="dialog" aria-modal="true" aria-labelledby="tyTitle">
      <header><h2 id="tyTitle">Thank you, ${esc(firstName(CLIENTS[ME.client].name))}!</h2></header>
      <div class="mb"><div class="rvdone" aria-label="${rv.rating} out of 5 stars">${starsText(rv.rating)}</div>
        <span class="hint">${rv.rating <= LOW_STARS ? "Sorry it wasn't great. The studio has been told and will look into it." : "Your review helps the studio and your instructor."}${weeks ? ` We won't ask again for ${weeks} weeks.` : ""}</span>
        ${g ? `<div class="gcard"><b>Would you share this on Google too?</b><span>It helps other people find the studio.${rv.comment ? " Your words are copied, ready to paste." : ""}</span></div>` : ""}
      </div>
      <footer>${g ? '<button type="button" class="btn ghost" data-mclose>Not now</button><button type="button" class="btn primary" id="tyGoogle">Share on Google</button>' : '<button type="button" class="btn primary" data-mclose>Done</button>'}</footer></div></div>`;
    if ($("#tyGoogle")) $("#tyGoogle").onclick = async () => {
      rv.google = "tapped";
      if (rv.comment) { try { await navigator.clipboard.writeText(rv.comment); } catch {} }
      try { window.open(g, "_blank", "noopener"); } catch {}
      closeModal(); after?.();
      toast(`Opening your studio's Google page${rv.comment ? ". Your review is copied: paste it there" : ""}. Thank you!`);
    };
  }

  // --- Client: Feedback (and their reviews) -------------------------------------------
  PAGES.feedback = function () { return state.role === "client" ? clientFeedback() : staffFeedback(); };
  function thread(f, staffView) {
    return f.replies.map((r) => `<div class="fbmsg ${r.studio ? "studio" : "client"}"><b>${r.studio ? (staffView ? esc(r.by || "Studio") : "Demo Studio") : staffView ? esc(firstName(CLIENTS[f.ci].name)) : "You"}</b><span>${esc(r.text)}</span><span class="muted" style="font-size:11.5px">${fmtDay(r.at)} ${clock(r.at)}</span></div>`).join("");
  }
  function clientFeedback() {
    const tab = state.fbTab || "send";
    const mine = FEEDBACK.filter((f) => f.ci === ME.client).sort((a, b) => b.at - a.at);
    const myRv = REVIEWS.filter((r) => r.ci === ME.client).sort((a, b) => b.at - a.at);
    const f = state.fbDraft || (state.fbDraft = { cat: "", loc: "", msg: "" });
    const tabs = `<div class="tabs" role="tablist">${[["send", "Send feedback"], ["mine", `My feedback${mine.length ? `<span class="n">${mine.length}</span>` : ""}`], ["reviews", `My reviews${myRv.length ? `<span class="n">${myRv.length}</span>` : ""}`]].map(([k, l]) => `<button type="button" role="tab" data-fbt="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</div>`;
    let body = "";
    if (tab === "send") {
      body = `<form class="card mform" id="fbForm"><h3>What would you like us to know?</h3>
        <div class="fl">What's it about?<div class="fbcats" role="radiogroup" aria-label="Category">${Object.entries(FB_CATS).map(([k, [l, d]]) => `<button type="button" role="radio" aria-checked="${f.cat === k}" data-fbcat="${k}"><b>${l}</b><span>${d}</span></button>`).join("")}</div></div>
        <label class="fl">Which location? <span class="h">(optional)</span><select id="fbLoc"><option value="">Not about one location</option>${Object.entries(LOCS).map(([k, v]) => `<option value="${k}" ${f.loc === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
        <label class="fl">Your message <span class="count" id="fbCount">${f.msg.length}/1000</span><textarea id="fbMsg" rows="4" maxlength="1000" placeholder="e.g. The aircon at Tanjong Pagar is really cold in the morning.">${esc(f.msg)}</textarea></label>
        <div class="row" style="justify-content:flex-end"><button type="submit" class="btn primary">Send to the studio</button></div>
        <span class="hint">The studio's team reads every message and usually replies within a couple of days. You'll get their reply by email and here under My feedback.</span></form>`;
    } else if (tab === "mine") {
      body = mine.length ? mine.map((x) => `<div class="card fbcard"><div class="row" style="justify-content:space-between;gap:8px"><span class="row" style="gap:6px"><span class="status ${FB_STATUS[x.status][1]}">${FB_STATUS[x.status][0]}</span><b>${FB_CATS[x.cat][0]}</b></span><span class="muted" style="font-size:12.5px">${fmtDay(x.at)}</span></div>
        <div class="fbmsg client"><b>You${x.loc ? ` · ${esc(LOCS[x.loc])}` : ""}</b><span>${esc(x.message)}</span></div>${thread(x, false)}
        <div class="row fbreply"><input id="fbr-${x.id}" maxlength="1000" placeholder="Reply to the studio" aria-label="Reply to the studio"><button type="button" class="btn" data-fbcr="${x.id}">Send</button></div></div>`).join("")
        : '<div class="card"><span class="muted">You haven\'t sent any feedback yet.</span></div>';
    } else {
      const snoozed = CLIENT_RV.snoozeUntil && CLIENT_RV.snoozeUntil > NOW;
      body = `<div class="card"><h3>Review pop-ups</h3><span class="muted" style="font-size:13px">${snoozed ? `Paused until ${fmtDay(CLIENT_RV.snoozeUntil)}.` : "After a class, we ask how it went. You can always skip."}</span>
        <div class="inline2">${snoozed ? '<button type="button" class="btn" id="rvResume">Ask me again</button>' : `<label class="inline2" style="font-size:13px">Pause for <select id="rvPause">${SNOOZE_WEEKS.map((w) => `<option value="${w}">${w} weeks</option>`).join("")}</select></label><button type="button" class="btn" id="rvPauseGo">Pause</button>`}</div></div>
        ${myRv.length ? myRv.map((r) => { const s = SESSIONS.find((x) => x.id === r.sid); return `<div class="card rvcard"><div class="row" style="justify-content:space-between"><span class="rvst" aria-label="${r.rating} stars">${starsText(r.rating)}</span><span class="muted" style="font-size:12.5px">${fmtDay(r.at)}</span></div><b>${esc(TYPES[r.type].name)}${s ? ` · ${fmtDay(s.start)} ${short(s.start)}` : ""}</b>${r.comment ? `<span>“${esc(r.comment)}”</span>` : ""}${r.reply ? `<div class="fbmsg studio"><b>Demo Studio replied</b><span>${esc(r.reply)}</span></div>` : ""}</div>`; }).join("") : '<div class="card"><span class="muted">No reviews yet.</span></div>'}`;
    }
    return head("Feedback", "Tell the studio what you'd like to see, and see your reviews.") + tabs + body;
  }

  // --- Staff: Feedback -----------------------------------------------------------------
  const lowToHandle = () => REVIEWS.filter((r) => r.rating <= LOW_STARS && !r.handled).sort((a, b) => a.at - b.at);
  const fbNew = () => FEEDBACK.filter((f) => f.status === "new");
  function staffFeedback() {
    const tab = state.fbStaffTab || "attention";
    const low = lowToHandle(), fresh = fbNew();
    const count = (k) => FEEDBACK.filter((f) => f.cat === k && f.status !== "resolved").length;
    const tabs = `<div class="tabs" role="tablist" aria-label="Feedback">${[["attention", `Needs attention${low.length + fresh.length ? `<span class="n hot">${low.length + fresh.length}</span>` : ""}`], ...Object.entries(FB_CATS).map(([k, [l]]) => [k, `${l}${count(k) ? `<span class="n">${count(k)}</span>` : ""}`])].map(([k, l]) => `<button type="button" role="tab" data-fbst="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</div>`;
    const item = (f) => `<article class="card fbcard" id="fb-${f.id}"><div class="row" style="justify-content:space-between;gap:8px;align-items:flex-start">
        <span class="cellp">${avatar(CLIENTS[f.ci], "sm")}<span class="stack" style="gap:1px"><b>${esc(CLIENTS[f.ci].name)}</b><span class="muted" style="font-size:12.5px">${FB_CATS[f.cat][0]}${f.loc ? ` · ${esc(LOCS[f.loc])}` : ""} · ${fmtDay(f.at)} ${clock(f.at)}</span></span></span>
        <select data-fbstat="${f.id}" aria-label="Status">${Object.entries(FB_STATUS).map(([k, [l]]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="fbmsg client"><span>${esc(f.message)}</span></div>${thread(f, true)}
      <div class="row fbreply"><input id="fbs-${f.id}" maxlength="1000" placeholder="Reply to ${esc(firstName(CLIENTS[f.ci].name))} (they get it by email)" aria-label="Reply"><button type="button" class="btn primary" data-fbsr="${f.id}">Send reply</button></div></article>`;
    let body = "";
    if (tab === "attention") {
      body = `<section class="stack"><h3 class="hsec">Low reviews to follow up${low.length ? ` · ${low.length}` : ""}</h3>
        ${low.length ? low.map((r) => { const s = SESSIONS.find((x) => x.id === r.sid); return `<article class="card fbcard lowrv"><div class="row" style="justify-content:space-between;gap:8px"><span class="cellp">${avatar(CLIENTS[r.ci], "sm")}<span class="stack" style="gap:1px"><b>${esc(CLIENTS[r.ci].name)}</b><span class="muted" style="font-size:12.5px">${esc(TYPES[r.type].name)}${s ? ` · ${fmtDay(s.start)} ${short(s.start)}` : ""}${r.instr ? ` · ${esc(STAFF[r.instr])}` : ""}</span></span></span><span class="rvst low" aria-label="${r.rating} stars">${starsText(r.rating)}</span></div>
          ${r.comment ? `<div class="fbmsg client"><span>“${esc(r.comment)}”</span></div>` : ""}
          <div class="row fbreply"><input id="lrv-${r.id}" maxlength="1000" placeholder="Reply privately (optional): they get it by email" aria-label="Private reply"><button type="button" class="btn primary" data-lrv="${r.id}">Mark as followed up</button></div></article>`; }).join("") : '<div class="card"><span class="muted">No low reviews waiting. 🎉</span></div>'}
        <h3 class="hsec" style="margin-top:6px">New feedback${fresh.length ? ` · ${fresh.length}` : ""}</h3>
        ${fresh.length ? fresh.map(item).join("") : '<div class="card"><span class="muted">Nothing new. You\'re all caught up.</span></div>'}</section>`;
    } else {
      const show = state.fbShow || "open";
      const list = FEEDBACK.filter((f) => f.cat === tab && (show === "all" || (show === "open" ? f.status !== "resolved" : f.status === "resolved"))).sort((a, b) => (a.status === "new" ? -1 : 0) - (b.status === "new" ? -1 : 0) || b.at - a.at);
      body = `<span class="hint">${FB_CATS[tab][1]}.</span><div class="fbar">${[["open", "Open"], ["resolved", "Sorted"], ["all", "All"]].map(([k, l]) => `<button type="button" class="pickchip" data-fbshow="${k}" aria-pressed="${show === k}">${l}</button>`).join("")}</div>
        ${list.length ? list.map(item).join("") : '<div class="card"><span class="muted">Nothing here.</span></div>'}`;
    }
    return head("Feedback", "What clients would like you to know, kept apart by topic, plus low reviews to follow up.") + tabs + body;
  }

  // --- Staff: Reviews -----------------------------------------------------------------
  PAGES.reviews = function () {
    const own = state.role === "instructor";
    const f = state.rvf || (state.rvf = { days: 90, type: "", instr: "", stars: "", loc: "" });
    const scope = REVIEWS.filter((r) => (own ? r.instr === ME.instructor : !f.instr || r.instr === f.instr) && (!f.type || r.type === f.type) && (!f.loc || r.loc === f.loc) && (f.days === "all" || r.at >= addDays(NOW, -Number(f.days))));
    const list = scope.filter((r) => !f.stars || (f.stars === "low" ? r.rating <= LOW_STARS : r.rating === Number(f.stars))).sort((a, b) => b.at - a.at);
    const n = scope.length, avg = n ? Math.round((scope.reduce((a, r) => a + r.rating, 0) / n) * 10) / 10 : null;
    const dist = [5, 4, 3, 2, 1].map((s) => ({ s, c: scope.filter((r) => r.rating === s).length }));
    const offered = scope.filter((r) => r.google).length, tapped = scope.filter((r) => r.google === "tapped").length;
    const byI = own ? [] : Object.keys(STAFF).map((k) => { const m = scope.filter((r) => r.instr === k); return { k, n: m.length, avg: m.length ? Math.round((m.reduce((a, r) => a + r.rating, 0) / m.length) * 10) / 10 : null }; }).filter((x) => x.n);
    const sel = (id, label, opts, val) => `<label class="hfilter">${label}<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
    const filters = `<div class="fbar rvfilters">${sel("rvDays", "Period", [[30, "Last 30 days"], [90, "Last 90 days"], [365, "Last year"], ["all", "All time"]], f.days)}${sel("rvType", "Class", [["", "All classes"], ...Object.entries(liveTypes()).map(([k, t]) => [k, t.name])], f.type)}${own ? "" : sel("rvInstr", "Instructor", [["", "All instructors"], ...Object.entries(STAFF)], f.instr)}${sel("rvLoc", "Location", [["", "All locations"], ...Object.entries(LOCS)], f.loc)}${sel("rvStars", "Stars", [["", "Any rating"], ["5", "5 stars"], ["4", "4 stars"], ["3", "3 stars"], ["2", "2 stars"], ["1", "1 star"], ["low", `Low (${LOW_STARS} or fewer)`]], f.stars)}</div>`;
    const max = Math.max(1, ...dist.map((d) => d.c));
    const summary = `<div class="rvsum"><section class="card rvhero"><span class="muted" style="font-size:13px">${own ? "Your average" : "Average rating"}</span><div class="rvbig"><b>${avg ?? "–"}</b><span class="rvst" aria-hidden="true">${avg ? starsText(Math.round(avg)) : ""}</span></div><span class="muted" style="font-size:13px">${n ? `from ${plural(n, "review")}` : "No reviews for this choice yet"}</span></section>
      <section class="card"><h3>How people rated</h3><div class="rvdist">${dist.map((d) => `<div class="rvrow"><span>${d.s} ★</span><span class="rvbar" role="img" aria-label="${d.s} stars: ${d.c}"><span style="width:${(d.c / max) * 100}%"></span></span><b>${d.c}</b></div>`).join("")}</div></section>
      ${own ? "" : `<section class="card"><h3>Google reviews</h3>${STUDIO.googleUrl ? `<div class="rvbig sm"><b>${offered ? Math.round((tapped / offered) * 100) : 0}%</b></div><span class="muted" style="font-size:13px">${tapped} of ${offered} people who reviewed here tapped “Share on Google”. Everyone is asked, whatever they gave, as Google requires.</span>` : `<span class="muted" style="font-size:13px">Add your Google review link under Studio rules, and clients are offered it after they review.</span><button type="button" class="linkbtn" data-hgo="policies">Add the link →</button>`}</section>`}</div>`;
    const instrTable = byI.length ? `<div class="card"><h3>By instructor</h3><div class="rvdist">${byI.sort((a, b) => b.n - a.n).map((x) => `<button type="button" class="rvrow rvinstr" data-rvi="${x.k}" aria-label="Show ${esc(STAFF[x.k])}'s reviews">${instrAvatar(x.k, "sm")}<span>${esc(STAFF[x.k])}</span><span class="rvbar"><span style="width:${(x.avg / 5) * 100}%"></span></span><b>${x.avg} ★</b><span class="muted">${x.n}</span></button>`).join("")}</div></div>` : "";
    const rows = list.length ? list.slice(0, 60).map((r) => { const s = SESSIONS.find((x) => x.id === r.sid); const c = CLIENTS[r.ci]; return `<article class="card rvcard ${r.rating <= LOW_STARS ? "low" : ""}"><div class="row" style="justify-content:space-between;gap:8px"><span class="rvst ${r.rating <= LOW_STARS ? "low" : ""}" aria-label="${r.rating} stars">${starsText(r.rating)}</span><span class="muted" style="font-size:12.5px">${fmtDay(r.at)}</span></div>
      <span class="muted" style="font-size:12.5px">${esc(TYPES[r.type].name)}${s ? ` · ${fmtDay(s.start)} ${short(s.start)}` : ""}${!own && r.instr ? ` · ${esc(STAFF[r.instr])}` : ""} · ${esc(LOCS[r.loc])} · ${esc(own ? `${firstName(c.name)} ${c.name.split(" ").pop()[0]}.` : c.name)}</span>
      ${r.comment ? `<span>“${esc(r.comment)}”</span>` : '<span class="muted" style="font-size:13px">No comment</span>'}
      ${r.rating <= LOW_STARS && !own ? (r.handled ? `<span class="status done" style="align-self:flex-start">Followed up</span>` : `<button type="button" class="linkbtn" data-hgo="feedback" style="align-self:flex-start">Follow up under Feedback →</button>`) : ""}</article>`; }).join("") : '<div class="card"><span class="muted">No reviews match.</span></div>';
    return head(own ? "My reviews" : "Reviews", own ? "What clients said about your classes. Names are shortened to keep them private." : "What clients said after their classes. Filter by class, instructor, location or stars.") + filters + summary + instrTable + rows;
  };
  BIND.reviews = function () {
    const f = state.rvf;
    for (const [id, k] of [["rvDays", "days"], ["rvType", "type"], ["rvInstr", "instr"], ["rvLoc", "loc"], ["rvStars", "stars"]]) if ($(`#${id}`)) $(`#${id}`).onchange = (e) => { f[k] = e.target.value; render(); };
    document.querySelectorAll("[data-rvi]").forEach((b) => (b.onclick = () => { f.instr = b.dataset.rvi; render(); }));
    document.querySelectorAll("#pgOther [data-hgo]").forEach((b) => (b.onclick = () => go(b.dataset.hgo)));
  };

  BIND.feedback = function () {
    const root = $("#pgOther");
    root.querySelectorAll("[data-fbt]").forEach((b) => (b.onclick = () => { state.fbTab = b.dataset.fbt; render(); }));
    root.querySelectorAll("[data-fbst]").forEach((b) => (b.onclick = () => { state.fbStaffTab = b.dataset.fbst; render(); }));
    root.querySelectorAll("[data-fbshow]").forEach((b) => (b.onclick = () => { state.fbShow = b.dataset.fbshow; render(); }));
    // Client: send feedback.
    if ($("#fbForm")) {
      const f = state.fbDraft;
      root.querySelectorAll("[data-fbcat]").forEach((b) => (b.onclick = () => { f.msg = $("#fbMsg").value; f.loc = $("#fbLoc").value; f.cat = b.dataset.fbcat; render(); }));
      $("#fbMsg").oninput = (e) => { f.msg = e.target.value; $("#fbCount").textContent = `${e.target.value.length}/1000`; };
      $("#fbLoc").onchange = (e) => (f.loc = e.target.value);
      $("#fbForm").onsubmit = (e) => {
        e.preventDefault();
        const msg = $("#fbMsg").value.trim();
        if (!f.cat) return toast("Choose what it's about, so it reaches the right person.");
        if (msg.length < 5) { $("#fbMsg").focus(); return toast("Tell us a little more (at least a few words)."); }
        FEEDBACK.push({ id: nextFbId++, ci: ME.client, cat: f.cat, loc: f.loc || null, message: msg, status: "new", at: NOW, replies: [] });
        state.fbDraft = null; state.fbTab = "mine"; renderNav(); render(); toast("Sent. Thank you! The studio will reply by email.");
      };
    }
    root.querySelectorAll("[data-fbcr]").forEach((b) => (b.onclick = () => {
      const f = FEEDBACK.find((x) => x.id === Number(b.dataset.fbcr)), t = $(`#fbr-${f.id}`).value.trim();
      if (!t) return toast("Write your reply first.");
      f.replies.push({ studio: false, text: t, at: NOW }); if (f.status === "resolved") f.status = "new"; render(); toast("Sent to the studio.");
    }));
    // Staff: reply, status, low reviews.
    root.querySelectorAll("[data-fbsr]").forEach((b) => (b.onclick = () => {
      const f = FEEDBACK.find((x) => x.id === Number(b.dataset.fbsr)), t = $(`#fbs-${f.id}`).value.trim();
      if (!t) return toast("Write a reply first.");
      f.replies.push({ studio: true, by: { admin: "Olivia", foh: "Fiona" }[state.role] || "Studio", text: t, at: NOW }); if (f.status === "new") f.status = "in_progress";
      renderNav(); render(); toast(`Reply sent to ${firstName(CLIENTS[f.ci].name)} by email.`);
    }));
    root.querySelectorAll("[data-fbstat]").forEach((s) => (s.onchange = () => { const f = FEEDBACK.find((x) => x.id === Number(s.dataset.fbstat)); f.status = s.value; renderNav(); render(); toast(`Marked as “${FB_STATUS[s.value][0]}”.`); }));
    root.querySelectorAll("[data-lrv]").forEach((b) => (b.onclick = () => {
      const r = REVIEWS.find((x) => x.id === Number(b.dataset.lrv)), t = $(`#lrv-${r.id}`).value.trim();
      Object.assign(r, { handled: true, reply: t || null }); renderNav(); render();
      toast(t ? `Followed up. ${firstName(CLIENTS[r.ci].name)} gets your reply by email.` : "Marked as followed up.");
    }));
    // Client: review pop-up pause.
    if ($("#rvPauseGo")) $("#rvPauseGo").onclick = () => {
      if (!REVIEWS.some((r) => r.ci === ME.client)) return toast("Leave one review first, then you can pause the review pop-ups.");
      CLIENT_RV.snoozeUntil = addDays(NOW, Number($("#rvPause").value) * 7); render(); toast(`Paused until ${fmtDay(CLIENT_RV.snoozeUntil)}.`);
    };
    if ($("#rvResume")) $("#rvResume").onclick = () => { CLIENT_RV.snoozeUntil = null; render(); toast("We'll ask after your next class."); };
  };

  // --- Celebrations -------------------------------------------------------------------
  /** The last full fortnight (fortnights start on Mondays, counted from 5 Jan 2026). */
  function lastFortnight() {
    const epoch = new Date(2026, 0, 5), idx = Math.floor((day(NOW) - epoch) / 864e5 / 14) - 1;
    const start = addDays(epoch, idx * 14);
    return { start, end: addDays(start, 14), idx, label: `${start.getDate()} ${MON[start.getMonth()]} – ${addDays(start, 13).getDate()} ${MON[addDays(start, 13).getMonth()]}` };
  }
  function teachRecap(instr) {
    const p = lastFortnight();
    const mine = SESSIONS.filter((s) => s.instr === instr && s.status === "scheduled" && s.start >= p.start && s.start < p.end && s.end <= NOW);
    if (!mine.length) return null;
    const came = mine.flatMap((s) => s.roster.filter((r) => r.att !== "no_show").map((r) => r.ci));
    const per = came.reduce((m, c) => m.set(c, (m.get(c) || 0) + 1), new Map());
    const groups = mine.filter((s) => !isAppt(s));
    const fill = Math.round((groups.reduce((a, s) => a + s.roster.length, 0) / Math.max(1, groups.reduce((a, s) => a + s.cap, 0))) * 100);
    const minsT = mine.reduce((a, s) => a + mins(s), 0);
    const fullest = [...groups].sort((a, b) => b.roster.length / b.cap - a.roster.length / a.cap)[0];
    const rv = REVIEWS.filter((r) => r.instr === instr && r.at >= p.start && r.at < p.end);
    const avg = rv.length ? Math.round((rv.reduce((a, r) => a + r.rating, 0) / rv.length) * 10) / 10 : null;
    const quote = rv.find((r) => r.rating >= 4 && r.comment && r.comment.length < 160)?.comment;
    const lines = [
      ["🧘", `${plural(mine.length, "class", "classes")} taught: ${minsT < 120 ? plural(minsT, "minute") : plural(Math.round(minsT / 60), "hour")} of you at the front of the room.`],
      ["👋", `${plural(came.length, "visit")} from ${plural(per.size, "different person", "different people")}. ${[...per.values()].filter((v) => v >= 2).length} of them came back more than once.`],
      ["🔥", fill >= 90 ? `Your classes were ${fill}% full. Spots with you go fast!` : fill >= 70 ? `${fill}% of your spots were booked: busy, lively rooms.` : `${fill}% of your spots were booked. Everyone who came chose to spend that time with you.`],
      ...(fullest ? [["🏆", `Busiest class: ${TYPES[fullest.type].name} on ${fmtDay(fullest.start)}, ${fullest.roster.length} of ${fullest.cap} spots.`]] : []),
      ...(rv.length ? [["⭐", `${plural(rv.length, "review")}, averaging ${avg} stars.`]] : []),
      ...(quote ? [["💬", `“${quote}”`]] : []),
    ];
    return { kind: "recap", period: p.label, headline: STUDIO.aiRecaps ? "Two weeks of happy, sweaty smiles 😊" : avg >= 4.8 ? "Clients love your classes! 💛" : "Two weeks of great work 🙌", lines,
      summary: STUDIO.aiRecaps && rv.length ? "Clients keep mentioning your clear cues and great music, and several said your class is the best part of their week. A few beginners found the pace quick, so a short recap of the key moves at the start could help them feel at home." : null,
      care: STUDIO.aiRecaps ? [`You taught ${mine.length} classes: block out one slow evening this week, just for you.`, "Your voice did a lot of work. Sip warm water between classes and rest it on your day off."] : ["Drink a glass of water between classes.", "Plan one evening off this week, just for you."], byAi: STUDIO.aiRecaps };
  }
  function studioRecap() {
    const p = lastFortnight();
    const held = SESSIONS.filter((s) => s.status === "scheduled" && s.start >= p.start && s.start < p.end && s.end <= NOW);
    const visits = held.reduce((a, s) => a + s.roster.filter((r) => r.att !== "no_show").length, 0);
    const groups = held.filter((s) => !isAppt(s));
    const fill = Math.round((groups.reduce((a, s) => a + s.roster.length, 0) / Math.max(1, groups.reduce((a, s) => a + s.cap, 0))) * 100);
    const rv = REVIEWS.filter((r) => r.at >= p.start && r.at < p.end);
    const avg = rv.length ? Math.round((rv.reduce((a, r) => a + r.rating, 0) / rv.length) * 10) / 10 : null;
    const top = Object.entries(groups.reduce((m, s) => ((m[s.type] = (m[s.type] || 0) + s.roster.length), m), {})).sort((a, b) => b[1] - a[1])[0];
    return { kind: "recap", period: p.label, headline: STUDIO.aiRecaps ? "A full and happy fortnight! 🎉" : "Your studio's last two weeks 🙌",
      lines: [["📅", `${plural(held.length, "class", "classes")} held, with ${plural(visits, "visit")}.`], ["🔥", `Classes were ${fill}% full: busy, lively rooms.`], ...(top ? [["🏆", `Most popular: ${TYPES[top[0]].name}.`]] : []), ...(rv.length ? [["⭐", `${plural(rv.length, "review")}, averaging ${avg} stars.`]] : [])],
      summary: STUDIO.aiRecaps && rv.length ? "Clients love the music, the friendly welcome and how clear the instructors are. Two comments mentioned the rooms feeling warm, so the aircon may be worth a check." : null,
      care: STUDIO.aiRecaps ? ["Thank one instructor in person for something specific they did this fortnight.", "Take a real day off this week. The studio will still be there tomorrow."] : ["Block out one hour this week with no messages, just to plan."], byAi: STUDIO.aiRecaps };
  }
  const CELEB = { seen: new Set(), off: new Set(), shown: new Set() };
  function momentsFor(role) {
    if (!STUDIO.celebOn || CELEB.off.has(role)) return [];
    const out = [];
    if (role === "instructor") {
      out.push({ id: "ms-ana-250", kind: "milestone", headline: "250 classes taught! 🎉", lines: [["🏅", "You've now taught 250 classes here."], ["⏱️", "That's about 220 hours of teaching."], ["💛", "Thank you for every early start and every late class."]] });
      const r = teachRecap(ME.instructor); if (r) out.push({ id: "rc-ana", ...r });
    }
    if (role === "admin") {
      out.push({ id: "ms-studio-5000", kind: "milestone", headline: "5,000 visits! 🎉", lines: [["🏅", "Your studio has reached 5,000 visits."], ["💛", "Every one of them is someone who chose to come to you."]] });
      out.push({ id: "rc-studio", ...studioRecap() });
    }
    return out.filter((m) => !CELEB.seen.has(m.id));
  }
  function openCelebration(list, i = 0) {
    const m = list[i];
    if (!m) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("#modalRoot").innerHTML = `<div class="modal-wrap" data-mclose><div class="modal celeb" role="dialog" aria-modal="true" aria-labelledby="ceTitle">
      <div class="celebtop ${reduced ? "still" : ""}" aria-hidden="true">${["🎉", "⭐", "💛", "✨", "🎊", "💪", "✨", "🌟"].map((e, k) => `<i style="--k:${k}">${e}</i>`).join("")}</div>
      <header class="stack" style="gap:2px"><span class="celebkind">${m.kind === "milestone" ? "Milestone" : `Your fortnight · ${esc(m.period)}`}</span><h2 id="ceTitle">${esc(m.headline)}</h2></header>
      <div class="mb"><ul class="celeblines">${m.lines.map(([e, t]) => `<li><span aria-hidden="true">${e}</span><span>${esc(t)}</span></li>`).join("")}</ul>
        ${m.summary ? `<div class="celebbox"><b>What clients said</b><span>${esc(m.summary)}</span><span class="aitag">Summary written by Claude from this fortnight's reviews</span></div>` : ""}
        ${m.care?.length ? `<div class="celebbox care"><b>Look after yourself</b><ul>${m.care.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}</div>
      <footer><button type="button" class="linkbtn" id="ceOff" style="margin-right:auto;font-weight:500;color:var(--muted)">Don't show these</button>${list.length > 1 ? `<span class="muted" style="font-size:12.5px">${i + 1} of ${list.length}</span>` : ""}<button type="button" class="btn primary" id="ceNext">${i + 1 < list.length ? "Next" : "Thanks!"}</button></footer></div></div>`;
    $("#ceNext").onclick = () => { CELEB.seen.add(m.id); if (i + 1 < list.length) openCelebration(list, i + 1); else closeModal(); };
    $("#ceOff").onclick = () => { list.forEach((x) => CELEB.seen.add(x.id)); CELEB.off.add(state.role); closeModal(); toast("Celebrations are off for you. Turn them back on under Preferences."); };
    setTimeout(() => $("#ceNext")?.focus(), 0);
  }
  /** Shown once per visit, when Home opens. */
  // Checks that aren't about these pop-ups set window.__quiet before the page loads, so a pop-up doesn't cover what they test.
  function maybeCelebrate() {
    if (window.__quiet || state.page !== "home" || CELEB.shown.has(state.role) || $("#modalRoot").innerHTML) return;
    const list = momentsFor(state.role);
    CELEB.shown.add(state.role);
    if (list.length) setTimeout(() => openCelebration(list), 350);
  }
  function maybeAskReview() {
    if (window.__quiet || state.role !== "client" || state.page !== "schedule" || CLIENT_RV.shownThisVisit || $("#modalRoot").innerHTML) return;
    const s = reviewPromptFor(ME.client);
    CLIENT_RV.shownThisVisit = true;
    if (s) setTimeout(() => { if (!$("#modalRoot").innerHTML) openReviewPrompt(s); }, 400);
  }
  {
    const homeBind = BIND.home;
    BIND.home = function () { homeBind?.call(this); maybeCelebrate(); };
  }

  // Preferences: the personal switch for celebrations (staff).
  {
    const page = PAGES.preferences, bind = BIND.preferences;
    PAGES.preferences = function () {
      const base = page.call(this);
      if (!["admin", "instructor"].includes(state.role)) return base;
      return base + `<div class="card"><h3>Celebrations</h3><div class="row" style="justify-content:space-between;gap:12px"><span class="stack" style="gap:2px;min-width:0"><b style="font-size:14px">Show celebration pop-ups</b><span class="muted" style="font-size:12.5px">A fun recap every two weeks, and milestones like 100 classes taught.</span></span>${toggle("prefCeleb", !CELEB.off.has(state.role), "Show celebration pop-ups")}</div></div>`;
    };
    BIND.preferences = function () {
      bind?.call(this);
      if ($("#prefCeleb")) $("#prefCeleb").onchange = (e) => { if (e.target.checked) { CELEB.off.delete(state.role); CELEB.seen.clear(); CELEB.shown.delete(state.role); } else CELEB.off.add(state.role); toast(e.target.checked ? "Celebrations are on." : "Celebrations are off for you."); };
    };
  }

  // --- Menu and icons -----------------------------------------------------------------
  ICONS.reviews = '<path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.4 6.9 19.1l1-5.6-4.1-4 5.7-.8z"/>';
  ICONS.feedback = '<path d="M4 5h16v11H9l-5 4z"/><path d="M12 8v3M12 13.5v.5"/>';
  NAV_ORDER.find(([g]) => g === "Growth")[1].push("reviews");
  NAV_ORDER.find(([g]) => g === "Clients & sales")[1].push("feedback");
  NAV.push(
    { id: "reviews", roles: ["admin", "instructor"], label: (r) => (r === "instructor" ? "My reviews" : "Reviews"), help: "What clients said after their classes, with filters." },
    { id: "feedback", roles: ["admin", "foh", "client"], label: "Feedback", help: "What clients would like the studio to know, by topic, plus low reviews to follow up.", count: () => (state.role === "client" ? 0 : lowToHandle().length + fbNew().length) },
  );
  {
    const ng = navGroup;
    // Instructors find their reviews under Account; clients find Feedback under Account.
    for (const n of NAV) { const id = n.id; n.group = (role) => (id === "reviews" && role === "instructor") || (id === "feedback" && role === "client") ? "Account" : ng(id, role); }
  }
  NAV.sort((a, b) => navRank(a.id, "admin") - navRank(b.id, "admin"));
