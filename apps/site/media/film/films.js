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

  // Home, a day at the studio: four chapters, each with its time stamp.
  day(F) {
    // 7:00am
    F.title("7:00am", { t0: 0, t1: 6.1, kicker: "Before the first class" });
    const h = F.shot("home", { t0: 0.9, t1: 3.6, cam: [[0.9, "center", 1.05], [2.2, "att", 2.3, { ox: -0.16 }], [3.6, "att", 2.4, { ox: -0.16 }]] });
    F.callout(h, "att", "Needs you today", { t0: 2.3, t1: 3.5, side: "left" });
    const c = F.shot("cover", { t0: 3.4, t1: 4.9, cut: true, cam: [[3.4, "approve", 2.6, { ox: 0.1 }], [4.9, "approve", 2.75, { ox: 0.1 }]] });
    F.callout(c, "approve", "One click", { t0: 3.6, t1: 4.8, side: "right" });
    const d = F.shot("covered", { t0: 4.8, t1: 6.2, cut: true, cam: [[4.8, "covered", 2.4, { ox: 0.1 }], [6.2, "covered", 2.5, { ox: 0.1 }]] });
    F.caption("Cover, sorted\nbefore coffee.", { t0: 4.9, t1: 6.1, pos: "bl" });
    // 12:20pm
    F.title("12:20pm", { t0: 6.1, t1: 12.1, kicker: "The door opens" });
    const u = F.shot("upnext", { t0: 7.0, t1: 8.9, cam: [[7.0, "center", 1], [8.9, "up", 1.55, { ox: 0.17 }]] });
    F.callout(u, "go", "Check-in opens", { t0: 7.8, t1: 8.8, side: "left" });
    const k = F.shot("checkin", { t0: 8.8, t1: 12.2, cut: true, cam: [[8.8, "rows", 1.7, { ox: 0.18 }], [10.4, "injury", 2.1, { ox: 0.18 }], [12.2, "head", 2.0, { ox: 0.18 }]] });
    F.callout(k, "injury", "Shoulder injury, flagged", { t0: 9.6, t1: 10.9, side: "left" });
    F.callout(k, "head", "3 of 12 in", { t0: 10.9, t1: 12.0, side: "left" });
    // 6:02pm
    F.title("6:02pm", { t0: 12.1, t1: 18.1, kicker: "After work" });
    const w = F.shot("whatsapp", { t0: 13.0, t1: 18.2, cam: [[13.0, "center", 1.05], [14.2, "question", 2.3, { ox: 0.1 }], [16.0, "reply", 2.2, { ox: -0.1 }], [18.2, "reply", 2.3, { ox: -0.1 }]] });
    F.callout(w, "question", "A question on WhatsApp", { t0: 14.3, t1: 15.7, side: "bottom" });
    F.callout(w, "reply", "Answered from one inbox", { t0: 16.1, t1: 18.0, side: "bottom" });
    // 11:59pm
    F.title("11:59pm", { t0: 18.1, t1: 25.0, kicker: "Lights off" });
    const p = F.shot("pay", { t0: 19.0, t1: 22.4, cam: [[19.0, "center", 1.05], [20.2, "rows", 2.0, { ox: 0.08 }], [22.4, "total", 2.5, { ox: 0.1 }]] });
    F.callout(p, "rows", "From who actually came", { t0: 20.2, t1: 21.4, side: "right" });
    const q = F.shot("paid", { t0: 22.3, t1: 25.0, cut: true, cam: [[22.3, "badge", 2.4, { ox: -0.06 }], [25.0, "badge", 2.55, { ox: -0.06 }]] });
    F.callout(q, "badge", "Paid. Figures locked.", { t0: 22.6, t1: 24.8, side: "bottom" });
    return 25.0;
  },

  // Home, made for here: closed days and shared packs.
  here(F) {
    const a = F.shot("closure", { t0: 0, t1: 6.6, cam: [[0, "center", 1.05], [1.3, "name", 2.1, { ox: 0.12 }], [3.4, "what", 1.75, { ox: 0.12 }], [6.6, "list", 1.9, { ox: 0.12 }]] });
    F.caption("Close for a holiday\nor a retreat.", { t0: 0.5, t1: 3.2, pos: "bl" });
    F.callout(a, "what", "5 classes, 28 people", { t0: 3.6, t1: 6.4, side: "top" });
    F.caption("Cancelled, credited,\neveryone told.", { t0: 3.7, t1: 6.5, pos: "bl" });
    const b = F.shot("share", { t0: 6.4, t1: 12.2, cam: [[6.4, "center", 1.05], [7.8, "family", 1.8, { ox: -0.12 }], [12.2, "mei", 2.3, { ox: -0.12 }]] });
    F.caption("One pack for\nthe whole family.", { t0: 6.9, t1: 12.1, pos: "br", sub: "Shared from the client's own app." });
    F.callout(b, "mei", "Joined", { t0: 9.0, t1: 12.0, side: "left" });
    return 12.2;
  },

  // Product, run the studio: a mistake caught, explained and fixed.
  run(F) {
    const a = F.shot("warning", { t0: 0, t1: 6.2, cam: [[0, "center", 1.05], [1.6, "title", 2.0, { ox: 0.1 }], [3.4, "double", 2.4, { ox: 0.1 }], [6.2, "why", 2.5, { ox: 0.1 }]] });
    F.caption("Mistakes caught\nbefore they happen.", { t0: 0.5, t1: 3.3, pos: "bl" });
    F.callout(a, "double", "Ana is already teaching at 7am", { t0: 3.5, t1: 6.0, side: "bottom" });
    F.caption("In plain English.", { t0: 3.7, t1: 6.1, pos: "tl" });
    const b = F.shot("checkin", { t0: 6.0, t1: 10.6, cam: [[6.0, "center", 1], [7.4, "done", 1.9, { ox: 0.18 }], [10.6, "head", 2.0, { ox: 0.18 }]] });
    F.caption("Instructors check in\nat the door.", { t0: 6.5, t1: 10.5, pos: "bl" });
    F.callout(b, "head", "Their pay follows", { t0: 8.4, t1: 10.4, side: "left" });
    return 10.6;
  },

  // Product, fill your classes: a journey that runs by itself.
  fill(F) {
    const a = F.shot("journey", { t0: 0, t1: 10.4, cam: [[0, "center", 1.05], [1.6, "start", 2.0, { ox: 0.16 }], [4.4, "wait", 2.0, { ox: 0.16 }], [7.6, "offer", 2.1, { ox: 0.16 }], [10.4, "offer", 2.2, { ox: 0.16 }]] });
    F.caption("Follow-ups that\nrun themselves.", { t0: 0.5, t1: 4.2, pos: "bl" });
    F.callout(a, "stats", "86 started", { t0: 1.0, t1: 2.9, side: "bottom" });
    F.callout(a, "wait", "41 bought a pack", { t0: 4.6, t1: 7.2, side: "right" });
    F.callout(a, "offer", "The rest get a nudge", { t0: 7.8, t1: 10.2, side: "right" });
    F.caption("Intro offers,\nwin-backs, welcomes.", { t0: 4.7, t1: 10.3, pos: "bl" });
    return 10.4;
  },

  // Product, run a brand: every location side by side.
  brand(F) {
    const a = F.shot("locations", { t0: 0, t1: 9.2, cam: [[0, "center", 1.05], [1.6, "headline", 1.9, { ox: 0.06 }], [4.2, "full", 2.3, { ox: 0.14 }], [6.6, "tp", 2.9, { ox: 0.14 }], [9.2, "tp", 3.0, { ox: 0.14 }]] });
    F.caption("Every location,\nside by side.", { t0: 0.5, t1: 4.0, pos: "bl" });
    F.callout(a, "headline", "The fullest, and the one with room", { t0: 1.9, t1: 3.9, side: "bottom" });
    F.caption("Compared with the\nperiod before.", { t0: 4.3, t1: 9.1, pos: "bl" });
    F.callout(a, "tp", "67.4% full", { t0: 6.7, t1: 9.0, side: "right" });
    return 9.2;
  },

  // Product, on every plan: Ask.
  ask(F) {
    const b = F.shot("ask", { t0: 0, t1: 8.4, cam: [[0, "center", 1.05], [1.6, "a", 2.2, { ox: -0.16 }], [8.4, "a", 2.4, { ox: -0.16 }]] });
    F.caption("Ask how to do\nanything.", { t0: 0.5, t1: 8.3, pos: "bl", sub: "In plain words, answered from the app itself." });
    F.callout(b, "a", "Answered in seconds", { t0: 2.2, t1: 8.1, side: "left" });
    return 8.4;
  },

  // Switching: our team's check before a move.
  move(F) {
    const a = F.shot("move", { t0: 0, t1: 10.8, cam: [[0, "center", 1.05], [1.6, "every", 2.1, { ox: 0.12 }], [4.6, "bar", 2.0, { ox: 0.12 }], [7.6, "problems", 1.9, { ox: 0.12 }], [10.8, "problems", 2.0, { ox: 0.12 }]] });
    F.caption("Every row,\naccounted for.", { t0: 0.5, t1: 4.4, pos: "bl" });
    F.callout(a, "every", "156 rows checked", { t0: 1.9, t1: 4.3, side: "bottom" });
    F.callout(a, "bar", "Created, linked, merged", { t0: 4.8, t1: 7.3, side: "bottom" });
    F.caption("Anything unclear\ncomes back to you.", { t0: 4.7, t1: 10.7, pos: "bl" });
    F.callout(a, "problems", "Listed in plain words", { t0: 7.8, t1: 10.6, side: "right" });
    return 10.8;
  },
};
