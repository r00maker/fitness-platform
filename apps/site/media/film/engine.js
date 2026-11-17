// A small timeline engine for the website's product films. A film is a list of layers, each with
// its own time window; seek(t) sets every layer's state for time t, so frames render exactly the
// same every time (the renderer steps through them one by one).
// Layers: shot (a still of the product in a window or phone frame, with a camera that pans and
// zooms between details), caption (kinetic headline + line), title (big time stamp), callout
// (a ring around a detail with a label, moving with the camera), endcard.
(() => {
  "use strict";
  const W = 1920, H = 1080;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    io: (k) => (k < 0.5 ? 4 * k ** 3 : 1 - Math.pow(-2 * k + 2, 3) / 2), // smooth in-out: camera moves
    out: (k) => 1 - Math.pow(1 - k, 4),                                      // arrivals
    in: (k) => k * k * k,                                                    // exits
  };
  const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; parent?.append(e); return e; };
  const stage = document.getElementById("stage");
  const layers = [];
  const DATA = window.STILLS_DATA; // { name: { w, h, boxes } }

  // --- Shots: a still in a frame, with a camera --------------------------------------------------
  // cam: [[t, focus, zoom, {ox, oy}]], focus = box name | "center" | [x, y] in still pixels.
  // zoom 1 = the whole frame fits the stage with a margin; 2 = twice that.
  function shot(name, o) {
    const d = DATA[name];
    if (!d) throw new Error("no still " + name);
    const phone = d.w < d.h;
    const wrap = el("div", "shot", stage);
    const frame = el("div", phone ? "frame phone" : "frame window", wrap);
    const img = el("img", "", frame); img.src = `../stills/${name}.png`; img.width = d.w; img.height = d.h;
    const fit = phone ? (H * 0.86) / d.h : Math.min((W * 0.8) / d.w, (H * 0.8) / d.h);
    const pt = (f) => {
      if (f === "center" || f == null) return [d.w / 2, d.h / 2];
      if (Array.isArray(f)) return f;
      const b = d.boxes[f]; if (!b) throw new Error(`${name}: no box ${f}`);
      return [b[0] + b[2] / 2, b[1] + b[3] / 2];
    };
    const keys = o.cam.map(([t, f, z, off = {}]) => ({ t, p: pt(f), z, ox: off.ox ?? 0, oy: off.oy ?? 0 }));
    const camAt = (t) => {
      if (t <= keys[0].t) return keys[0];
      for (let i = 1; i < keys.length; i++) {
        const a = keys[i - 1], b = keys[i];
        if (t <= b.t) { const k = E.io(prog(t, a.t, b.t)); return { p: [lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k)], z: lerp(a.z, b.z, k), ox: lerp(a.ox, b.ox, k), oy: lerp(a.oy, b.oy, k) }; }
      }
      return keys.at(-1);
    };
    // A slow drift on top of the keyed camera keeps still moments alive.
    const drift = o.drift ?? 0.025;
    const L = {
      o, wrap,
      // Where a point of the still lands on the stage at time t.
      map(t, x, y) {
        const inK = E.out(prog(t, o.t0, o.t0 + (o.inDur ?? 0.55))), outK = E.in(prog(t, o.t1 - (o.outDur ?? 0.45), o.t1));
        const enter = o.cut ? 1 : lerp(0.94, 1, inK), leave = o.keep ? 1 : lerp(1, 1.06, outK);
        const c = camAt(t), s = fit * c.z * (1 + drift * prog(t, o.t0, o.t1)) * enter * leave;
        return { x: W / 2 + c.ox * W + (x - c.p[0]) * s, y: H / 2 + c.oy * H + (y - c.p[1]) * s, s };
      },
      box(k) { return d.boxes[k]; },
      update(t) {
        const inK = E.out(prog(t, o.t0, o.t0 + (o.inDur ?? 0.55))), outK = E.in(prog(t, o.t1 - (o.outDur ?? 0.45), o.t1));
        const vis = t >= o.t0 && t <= o.t1;
        wrap.style.display = vis ? "" : "none";
        if (!vis) return;
        // Points are in the still's pixels; a phone's image sits inside its bezel, so the frame starts a bezel earlier.
        const pad = phone ? 22 : 0;
        const m = L.map(t, -pad, -pad);
        frame.style.transform = `translate3d(${m.x}px, ${m.y}px, 0) scale(${m.s})`;
        wrap.style.opacity = String(o.cut ? prog(t, o.t0, o.t0 + 0.25) * (1 - prog(t, o.t1 - 0.25, o.t1)) : inK * (1 - outK));
        wrap.style.filter = o.cut ? "" : `blur(${(1 - inK) * 10 + outK * 8}px)`;
      },
    };
    layers.push(L);
    return L;
  }

  // --- Captions: a headline whose lines rise into place, and an optional second line ------------
  function caption(text, o) {
    const box = el("div", `cap ${o.pos ?? "bl"}`, stage);
    if (o.scrim !== false) box.classList.add("scrim");
    const h = el("div", "cap-h", box);
    const lines = text.split("\n").map((ln) => { const m = el("span", "cap-l", h); const i = el("span", "cap-i", m); i.textContent = ln; return i; });
    const sub = o.sub ? el("div", "cap-s", box, null) : null;
    if (sub) sub.textContent = o.sub;
    if (o.size) h.style.fontSize = o.size + "px";
    layers.push({
      update(t) {
        const vis = t >= o.t0 && t <= o.t1; box.style.display = vis ? "" : "none"; if (!vis) return;
        const outK = E.in(prog(t, o.t1 - 0.4, o.t1));
        lines.forEach((ln, i) => { const k = E.out(prog(t, o.t0 + i * 0.09, o.t0 + i * 0.09 + 0.6)); ln.style.transform = `translateY(${(1 - k) * 110}%)`; });
        if (sub) { const k = E.out(prog(t, o.t0 + 0.25, o.t0 + 0.85)); sub.style.opacity = String(k); sub.style.transform = `translateY(${(1 - k) * 18}px)`; }
        box.style.opacity = String(1 - outK);
        box.style.transform = `translateY(${-outK * 20}px)`;
      },
    });
  }

  // --- Big title (a time stamp) that lands, then tucks into a corner chip ------------------------
  function title(text, o) {
    const big = el("div", "title", stage); big.textContent = text;
    if (o.kicker) { const k = el("div", "kicker", big); k.textContent = o.kicker; }
    const chip = el("div", "chip", stage); chip.textContent = text;
    layers.push({
      update(t) {
        const bigEnd = o.t0 + (o.hold ?? 1.15);
        const vis = t >= o.t0 && t <= bigEnd; big.style.display = vis ? "" : "none";
        if (vis) {
          const k = E.out(prog(t, o.t0, o.t0 + 0.55)), out = E.in(prog(t, bigEnd - 0.3, bigEnd));
          big.style.opacity = String(k * (1 - out));
          big.style.transform = `translate(-50%, -50%) scale(${lerp(1.08, 1, k) * lerp(1, 0.9, out)})`;
          big.style.letterSpacing = `${lerp(-0.02, -0.05, k)}em`;
        }
        const cv = t >= bigEnd - 0.1 && t <= o.t1; chip.style.display = cv ? "" : "none";
        if (cv) { const k = E.out(prog(t, bigEnd - 0.1, bigEnd + 0.4)), out = E.in(prog(t, o.t1 - 0.3, o.t1)); chip.style.opacity = String(k * (1 - out)); chip.style.transform = `translateY(${(1 - k) * -14}px)`; }
      },
    });
  }

  // --- Callouts: a ring around a detail of a shot, and a label beside it ------------------------
  function callout(sh, key, text, o) {
    const ring = el("div", "ring", stage);
    const tag = el("div", `tag ${o.side ?? "right"}`, stage); tag.textContent = text;
    const line = el("div", "tagline", stage);
    const pad = o.pad ?? 14;
    layers.push({
      update(t) {
        const vis = t >= o.t0 && t <= o.t1; for (const x of [ring, tag, line]) x.style.display = vis ? "" : "none"; if (!vis) return;
        const b = sh.box(key);
        const a = sh.map(t, b[0], b[1]), z = sh.map(t, b[0] + b[2], b[1] + b[3]);
        const x0 = a.x - pad, y0 = a.y - pad, w = z.x - a.x + pad * 2, h = z.y - a.y + pad * 2;
        const k = E.out(prog(t, o.t0, o.t0 + 0.5)), out = E.in(prog(t, o.t1 - 0.3, o.t1)), op = k * (1 - out);
        ring.style.cssText = `left:${x0}px;top:${y0}px;width:${w}px;height:${h}px;opacity:${op};transform:scale(${lerp(1.12, 1, k)})`;
        const tk = E.out(prog(t, o.t0 + 0.18, o.t0 + 0.7));
        const gap = 48 * (Number(getComputedStyle(stage).getPropertyValue("--k")) || 1);
        let tx, ty;
        const side = o.side ?? "right";
        if (side === "right") { tx = x0 + w + gap; ty = y0 + h / 2; }
        else if (side === "left") { tx = x0 - gap; ty = y0 + h / 2; }
        else if (side === "top") { tx = x0 + w / 2; ty = y0 - gap; }
        else { tx = x0 + w / 2; ty = y0 + h + gap; }
        tag.style.left = tx + "px"; tag.style.top = ty + "px";
        tag.style.opacity = String(tk * (1 - out));
        const shift = (1 - tk) * 16;
        tag.style.transform = side === "right" ? `translate(${shift}px, -50%)` : side === "left" ? `translate(calc(-100% - ${shift}px), -50%)` : side === "top" ? `translate(-50%, calc(-100% - ${shift}px))` : `translate(-50%, ${shift}px)`;
        // The connector from ring to label.
        const lx = side === "right" ? x0 + w : side === "left" ? tx : x0 + w / 2, ly = side === "top" ? ty : side === "bottom" ? y0 + h : y0 + h / 2;
        const len = side === "right" || side === "left" ? gap : gap;
        line.style.cssText = side === "right" || side === "left"
          ? `left:${lx}px;top:${ly - 1}px;width:${len * tk}px;height:2px;opacity:${op}`
          : `left:${lx - 1}px;top:${side === "top" ? ty : y0 + h}px;width:2px;height:${len * tk}px;opacity:${op}`;
      },
    });
  }

  // --- End card ---------------------------------------------------------------------------------
  function endcard(text, o) {
    const box = el("div", "end", stage);
    const h = el("div", "end-h", box); h.textContent = text;
    if (o.sub) { const s = el("div", "end-s", box); s.textContent = o.sub; }
    layers.push({
      update(t) {
        const vis = t >= o.t0 && t <= o.t1; box.style.display = vis ? "" : "none"; if (!vis) return;
        const k = E.out(prog(t, o.t0, o.t0 + 0.8)), out = E.in(prog(t, o.t1 - 0.45, o.t1));
        box.style.opacity = String(k * (1 - out));
        h.style.transform = `translateY(${(1 - k) * 40}px)`;
        h.style.backgroundPosition = `${lerp(100, 0, E.io(prog(t, o.t0 + 0.1, o.t0 + 1.3)))}% 0`;
      },
    });
  }

  // The background's light drifts slowly through each film.
  const glow = document.getElementById("glow");
  layers.push({ update(t) { glow.style.transform = `translate(${Math.sin(t / 4) * 80}px, ${Math.cos(t / 5) * 50}px)`; } });

  // Labels and rings bigger, for films shown small on the page.
  const labels = (k) => stage.style.setProperty("--k", String(k));
  window.FILM = { shot, caption, title, callout, endcard, labels };
  window.seek = (t) => { for (const L of layers) L.update(t); };
})();
