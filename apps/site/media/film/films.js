// The website's product films. Each returns its length in seconds.
// shot(still, { t0, t1, cam: [[t, focus, zoom, {ox, oy}]] }), caption(text, { t0, t1, pos, sub }),
// title(text, { t0, t1 }), callout(shot, box, label, { t0, t1, side }), endcard(text, { t0, t1, sub }).
// Camera offsets (ox, oy) are fractions of the frame: they slide the detail aside to leave room for words.
window.FILMS = {
  // Home, the hero: what the studio's day is made of, one verb at a time.
  hero(F) {
    const a = F.shot("schedule", { t0: 0, t1: 3.3, cam: [[0, "center", 1.05], [1.2, "center", 1.05], [3.3, [1830, 760], 2.0, { ox: 0.16 }]] });
    F.caption("Plan the week.", { t0: 0.5, t1: 3.2, pos: "bl" });
    const b = F.shot("checkin", { t0: 3.1, t1: 6.4, cam: [[3.1, "center", 1], [4.4, "done", 1.9, { ox: 0.18 }], [6.4, "done", 2.05, { ox: 0.18 }]] });
    F.caption("Check them in.", { t0: 3.6, t1: 6.3, pos: "bl" });
    F.callout(b, "injury", "Injuries flagged at the door", { t0: 4.8, t1: 6.3, side: "right" });
    const c = F.shot("whatsapp", { t0: 6.2, t1: 9.5, cam: [[6.2, "center", 1.05], [7.4, "reply", 2.2, { ox: -0.14 }], [9.5, "reply", 2.3, { ox: -0.14 }]] });
    F.caption("Answer every\nmessage.", { t0: 6.7, t1: 9.4, pos: "br" });
    const d = F.shot("pay", { t0: 9.3, t1: 12.6, cam: [[9.3, "center", 1.05], [10.5, "total", 2.6, { ox: 0.12 }], [12.6, "total", 2.7, { ox: 0.12 }]] });
    F.caption("Pay the team.", { t0: 9.8, t1: 12.5, pos: "bl" });
    F.callout(d, "total", "Worked out for you", { t0: 10.9, t1: 12.5, side: "bottom" });
    F.shot("journey", { t0: 12.4, t1: 15.6, cam: [[12.4, "start", 1.9, { ox: 0.14 }], [15.6, "offer", 2.1, { ox: 0.14 }]] });
    F.caption("Fill the next\nclass.", { t0: 12.9, t1: 15.5, pos: "bl" });
    F.endcard("One app for the whole studio.", { t0: 15.4, t1: 18.4 });
    return 18.4;
  },

  // Home, a day at the studio: one short clip per moment (no big captions: the page's words sit beside them).
  // 7:00am: cover, sorted by the instructors; you approve.
  dayCover(F) {
    F.labels(1.7);
    const h = F.shot("home", { t0: 0, t1: 2.9, cam: [[0, "center", 1.05], [1.3, "att", 2.2], [2.9, "att", 2.3]] });
    F.callout(h, "att", "Needs you today", { t0: 1.4, t1: 2.8, side: "bottom" });
    const c = F.shot("cover", { t0: 2.7, t1: 5.0, cut: true, cam: [[2.7, "approve", 2.4, { ox: -0.12 }], [5.0, "approve", 2.55, { ox: -0.12 }]] });
    F.callout(c, "ben", "Ben said yes", { t0: 2.9, t1: 3.9, side: "top" });
    F.callout(c, "approve", "You approve", { t0: 3.9, t1: 4.9, side: "right" });
    const d = F.shot("covered", { t0: 4.8, t1: 7.2, cut: true, cam: [[4.8, "covered", 2.3, { ox: -0.1 }], [7.2, "covered", 2.4, { ox: -0.1 }]] });
    F.callout(d, "covered", "Everyone's told", { t0: 5.1, t1: 7.0, side: "right" });
    return 7.2;
  },
  // 12:20pm: one tap at the door settles the class.
  dayCheckin(F) {
    F.labels(1.7);
    const u = F.shot("upnext", { t0: 0, t1: 2.4, cam: [[0, "center", 1], [2.4, "up", 1.45, { ox: -0.2 }]] });
    F.callout(u, "go", "Opens an hour before", { t0: 0.9, t1: 2.3, side: "right" });
    const k = F.shot("checkin", { t0: 2.2, t1: 7.4, cut: true, cam: [[2.2, "rows", 1.6, { ox: -0.2 }], [4.6, "done", 1.9, { ox: -0.2 }], [5.4, "done", 1.9, { ox: 0.16 }], [7.4, "head", 1.85, { ox: 0.05 }]] });
    F.callout(k, "done", "One tap: they're in", { t0: 3.0, t1: 4.8, side: "right" });
    F.callout(k, "injury", "Injury flagged", { t0: 4.9, t1: 5.9, side: "left" });
    F.callout(k, "head", "Pay and fees follow", { t0: 6.0, t1: 7.3, side: "bottom" });
    return 7.4;
  },
  // 6:02pm: a WhatsApp question, answered by whoever's on.
  dayWhatsapp(F) {
    F.labels(1.7);
    const w = F.shot("whatsapp", { t0: 0, t1: 6.8, cam: [[0, "center", 1.05], [1.4, "question", 2.2], [3.6, "reply", 2.1], [6.8, "reply", 2.2]] });
    F.callout(w, "question", "A question on WhatsApp", { t0: 1.5, t1: 3.3, side: "bottom" });
    F.callout(w, "reply", "Answered by whoever's on", { t0: 3.8, t1: 6.6, side: "bottom" });
    return 6.8;
  },
  // 11:59pm: pay, already worked out.
  dayPay(F) {
    F.labels(1.7);
    const p = F.shot("pay", { t0: 0, t1: 4.4, cam: [[0, "center", 1.05], [1.3, "rows", 1.9, { ox: -0.12 }], [3.0, "total", 2.4], [4.4, "total", 2.5]] });
    F.callout(p, "rows", "From who actually came", { t0: 1.4, t1: 2.8, side: "bottom" });
    F.callout(p, "total", "Already worked out", { t0: 3.1, t1: 4.3, side: "bottom" });
    const q = F.shot("paid", { t0: 4.2, t1: 6.8, cut: true, cam: [[4.2, "badge", 2.3], [6.8, "badge", 2.4]] });
    F.callout(q, "badge", "Paid and locked", { t0: 4.5, t1: 6.6, side: "bottom" });
    return 6.8;
  },

  // Switching: our team's check before a move.
  move(F) {
    F.labels(1.4);
    const a = F.shot("move", { t0: 0, t1: 10.8, cam: [[0, "center", 1.05], [1.6, "every", 2.1, { ox: 0.12 }], [4.6, "bar", 2.0, { ox: 0.12 }], [7.6, "problems", 1.9, { ox: 0.12 }], [10.8, "problems", 2.0, { ox: 0.12 }]] });
    F.caption("Every row,\naccounted for.", { t0: 0.5, t1: 4.4, pos: "bl" });
    F.callout(a, "every", "156 rows checked", { t0: 1.9, t1: 4.3, side: "bottom" });
    F.callout(a, "bar", "Created, linked, merged", { t0: 4.8, t1: 7.3, side: "bottom" });
    F.caption("Anything unclear\ncomes back to you.", { t0: 4.7, t1: 10.7, pos: "bl" });
    F.callout(a, "problems", "Listed in plain words", { t0: 7.8, t1: 10.6, side: "right" });
    return 10.8;
  },
};
