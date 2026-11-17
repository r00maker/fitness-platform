// The website's product films. Each returns its length in seconds.
// shot(still, { t0, t1, cam: [[t, focus, zoom, { ox, oy, ease }]] }), caption(text, { t0, t1, pos, sub }),
// callout(shot, box, label, { t0, t1, side }), endcard(text, { t0, t1, sub }), labels(size).
// Camera rule: one move per beat, then hold still. A small second zoom straight after a big one
// reads as a stutter, so there are none (and no drift).
// Small films (shown in a card, about a third of their size) start closer in, zoom tighter and use
// bigger labels, so the product's own text stays readable.
window.FILMS = {
  // Home, the hero: what the studio's day is made of.
  hero(F) {
    F.shot("schedule", { t0: 0, t1: 3.3, cam: [[0, "center", 1.05], [0.9, "center", 1.05], [2.7, [1830, 760], 2.0, { ox: 0.16 }]] });
    F.caption("Plan the week.", { t0: 0.5, t1: 3.2, pos: "bl" });
    const b = F.shot("cover", { t0: 3.1, t1: 6.4, cam: [[3.1, "approve", 1.3, { ox: -0.1 }], [4.9, "approve", 2.5, { ox: -0.12 }]] });
    F.caption("Cover, sorted.", { t0: 3.6, t1: 6.3, pos: "br", sub: "Instructors offer. You approve." });
    F.callout(b, "approve", "One tap", { t0: 4.9, t1: 6.2, side: "bottom" });
    F.shot("whatsapp", { t0: 6.2, t1: 9.5, cam: [[6.2, "center", 1.05], [6.9, "center", 1.05], [8.5, "reply", 2.1, { ox: -0.14 }]] });
    F.caption("One inbox for\nevery message.", { t0: 6.7, t1: 9.4, pos: "br" });
    const d = F.shot("pay", { t0: 9.3, t1: 12.6, cam: [[9.3, "center", 1.05], [10.0, "center", 1.05], [11.6, "total", 2.5, { ox: 0.12 }]] });
    F.caption("Pay the team.", { t0: 9.8, t1: 12.5, pos: "bl" });
    F.callout(d, "total", "Worked out as you go", { t0: 11.6, t1: 12.5, side: "bottom" });
    const e = F.shot("journey", { t0: 12.4, t1: 15.6, cam: [[12.4, "start", 1.5, { ox: 0.14 }], [14.4, "wait", 2.0, { ox: 0.14 }]] });
    F.caption("Turn trials into\nregulars.", { t0: 12.9, t1: 15.5, pos: "bl" });
    F.callout(e, "wait", "41 bought a pack", { t0: 14.4, t1: 15.5, side: "right" });
    F.endcard("One app for the whole studio.", { t0: 15.4, t1: 18.4 });
    return 18.4;
  },

  // --- Small films: the day at the studio (Home) and Product's sub-points ------------------------
  // 7:00am: cover sorts itself out.
  dayCover(F) {
    F.labels(1.7);
    const h = F.shot("home", { t0: 0, t1: 2.8, cam: [[0, "att", 2.0], [1.2, "att", 3.0]] });
    F.callout(h, "att", "Needs you today", { t0: 1.2, t1: 2.7, side: "bottom" });
    const c = F.shot("cover", { t0: 2.6, t1: 5.1, cut: true, cam: [[2.6, "ben", 3.0], [3.9, "approve", 3.2]] });
    F.callout(c, "ben", "Ben said yes", { t0: 2.8, t1: 3.7, side: "top" });
    F.callout(c, "approve", "You approve", { t0: 4.0, t1: 5.0, side: "bottom" });
    const d = F.shot("covered", { t0: 4.9, t1: 7.2, cut: true, cam: [[4.9, "covered", 3.0]] });
    F.callout(d, "covered", "Everyone's told", { t0: 5.1, t1: 7.0, side: "bottom" });
    return 7.2;
  },
  // 12:20pm: classes look after themselves.
  dayClasses(F) {
    F.labels(1.7);
    const a = F.shot("newclass", { t0: 0, t1: 7.0, cam: [[0, "waitlist", 2.0], [1.2, "waitlist", 3.0], [3.6, "rule", 2.9]] });
    F.callout(a, "waitlist", "Spots refill from the waitlist", { t0: 1.2, t1: 3.3, side: "bottom" });
    F.callout(a, "rule", "Quiet classes cancel themselves", { t0: 3.8, t1: 6.8, side: "top" });
    return 7.0;
  },
  // 6:02pm: one inbox, not four phones.
  dayWhatsapp(F) {
    F.labels(1.7);
    const w = F.shot("whatsapp", { t0: 0, t1: 6.8, cam: [[0, "list", 2.0], [1.0, "list", 2.8], [3.4, "reply", 2.7]] });
    F.callout(w, "list", "WhatsApp and email, one inbox", { t0: 1.0, t1: 3.1, side: "bottom" });
    F.callout(w, "reply", "Whoever's on can answer", { t0: 3.6, t1: 6.6, side: "bottom" });
    return 6.8;
  },
  // 11:59pm: pay, worked out as you go.
  dayPay(F) {
    F.labels(1.7);
    const p = F.shot("pay", { t0: 0, t1: 4.9, cam: [[0, "rule", 1.6], [1.0, "rule", 2.0], [3.0, "total", 3.0]] });
    F.callout(p, "rule", "Your exact pay rules", { t0: 1.0, t1: 2.8, side: "bottom" });
    F.callout(p, "sofar", "Builds as classes finish", { t0: 3.1, t1: 4.8, side: "bottom" });
    const q = F.shot("paid", { t0: 4.7, t1: 7.0, cut: true, cam: [[4.7, "badge", 3.0]] });
    F.callout(q, "badge", "Paid and locked", { t0: 4.9, t1: 6.8, side: "bottom" });
    return 7.0;
  },
  // Product: anyone on your team can run the schedule.
  checks(F) {
    F.labels(1.7);
    const a = F.shot("warning", { t0: 0, t1: 6.6, cam: [[0, "title", 2.0], [1.0, "double", 3.0], [3.8, "back", 2.8, { ox: 0.08, oy: -0.1 }]] });
    F.callout(a, "double", "Caught before it's saved", { t0: 1.1, t1: 3.5, side: "top" });
    F.callout(a, "back", "Go back and fix it", { t0: 3.9, t1: 6.4, side: "bottom" });
    return 6.6;
  },
  // Product: turn trials into regulars.
  journey(F) {
    F.labels(1.7);
    const a = F.shot("journey", { t0: 0, t1: 7.4, cam: [[0, "start", 2.2], [0.8, "start", 2.8], [3.0, "wait", 2.8], [5.4, "offer", 2.8]] });
    F.callout(a, "start", "A client signs up", { t0: 0.8, t1: 2.8, side: "bottom" });
    F.callout(a, "wait", "41 bought a pack", { t0: 3.1, t1: 5.2, side: "bottom" });
    F.callout(a, "offer", "The rest get a nudge", { t0: 5.5, t1: 7.2, side: "top" });
    return 7.4;
  },
  // Product: every location side by side.
  locations(F) {
    F.labels(1.7);
    const a = F.shot("locations", { t0: 0, t1: 6.0, cam: [[0, "full", 2.0, { ox: 0.08 }], [1.2, "tp", 3.2]] });
    F.callout(a, "tp", "67.4% full, up 2.3 points", { t0: 1.3, t1: 5.8, side: "top" });
    return 6.0;
  },
  // Product: Ask.
  ask(F) {
    F.labels(1.7);
    const a = F.shot("ask", { t0: 0, t1: 6.4, cam: [[0, "q", 2.2], [1.0, "q", 2.8], [3.0, "a", 2.8]] });
    F.callout(a, "q", "Ask in plain words", { t0: 1.0, t1: 2.8, side: "bottom" });
    F.callout(a, "a", "Answered in the app", { t0: 3.1, t1: 6.2, side: "left" });
    return 6.4;
  },
  // Switching: our team's check before a move.
  move(F) {
    F.labels(1.7);
    const a = F.shot("move", { t0: 0, t1: 9.0, cam: [[0, "every", 2.0], [1.0, "every", 2.8], [3.4, "bar", 2.8], [6.2, "problems", 2.6]] });
    F.callout(a, "every", "Every row accounted for", { t0: 1.1, t1: 3.2, side: "bottom" });
    F.callout(a, "bar", "Created, linked or merged", { t0: 3.6, t1: 6.0, side: "bottom" });
    F.callout(a, "problems", "Anything unclear, listed", { t0: 6.4, t1: 8.8, side: "bottom" });
    return 9.0;
  },
};
