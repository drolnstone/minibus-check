/* A DOODLE VIDEO, ONE FRAME AT A TIME.

   Everything on screen is an item with a start time and a length. renderAt(t)
   sets every item to where it would be at t, so any frame can be drawn in
   any order and the same t always gives the same picture: the renderer steps
   t through the clip and photographs each one.

   Drawings are rough.js shapes (fixed seeds, so they never wobble between
   frames), revealed stroke by stroke. Captions are written line by line. A
   pencil follows whatever is being drawn or written. Real screens from the
   passenger page sit in drawn phones, with rings and close-ups taken from
   where the page actually put each button (marks.js). */
(function () {
  const W = 540, H = 960;
  const INK = "#22303c", SOFT = "#5b6773", YEL = "#f5c518", GREEN = "#1f7a4a", RED = "#c0392b", BLUE = "#2b5fb3", PAPER = "#fbf8f1";
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("stage");
  const rc = rough.svg(svg);
  let seed = 7;
  const O = (o) => Object.assign({ roughness: 1.1, bowing: 0.8, stroke: INK, strokeWidth: 2.4, seed: seed++ }, o || {});
  const FILLS = [YEL, "#dcf8c6", "#ffffff", "#fff", "#f3d7b8"];

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e);
    return e;
  };
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ease = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  let uid = 0;
  const id = (p) => p + (++uid);

  /* ---- the pencil ------------------------------------------------------ */
  const pencil = el("g", { id: "pencil" });
  pencil.innerHTML =
    '<g transform="rotate(-38)">' +
    '<path d="M0 0 L7 -16 L-7 -16 Z" fill="#e8c9a0" stroke="#7a5a3a" stroke-width="1"/>' +
    '<path d="M0 0 L2.6 -6 L-2.6 -6 Z" fill="#333"/>' +
    '<rect x="-7" y="-86" width="14" height="70" fill="#f2b705" stroke="#8a6a00" stroke-width="1"/>' +
    '<rect x="-7" y="-96" width="14" height="10" fill="#b8b8b8" stroke="#777" stroke-width="1"/>' +
    '<rect x="-7" y="-110" width="14" height="14" rx="3" fill="#f19aa8" stroke="#a5606c" stroke-width="1"/></g>';

  /* ---- scenes and items -------------------------------------------------- */
  const clips = {};
  let cur = null;          /* the scene being built */

  /* Built visible, because text and paths can only be measured when shown;
     hidden once the scene is complete. */
  function Scene(clipId) {
    const g = el("g", { class: "scene" });
    return { g, items: [], t: 0, hold: 0, clipId, chars: 0 };
  }

  /* A drawn shape: every <path> in it revealed in turn over dur seconds.
     Outlines first, then the colouring in, the way a hand does it. */
  function drawItem(node, dur, o) {
    o = o || {};
    cur.g.appendChild(node);
    let paths = [...node.querySelectorAll("path")];
    const isFill = (p) => p.getAttribute("stroke") === "none" || FILLS.indexOf(p.getAttribute("stroke")) >= 0;
    paths = paths.filter((p) => !isFill(p)).concat(paths.filter(isFill));
    const lens = paths.map((p) => { const L = p.getTotalLength() || 1; p.style.strokeDasharray = L + " " + L; p.style.strokeDashoffset = L; return L; });
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    const item = { at: cur.t + (o.delay || 0), dur, kind: "draw", paths, lens, total, node, pen: o.pen !== false };
    cur.items.push(item);
    if (!o.with) cur.t = item.at + dur;
    return item;
  }

  /* Text written line by line: a <text> per line, each uncovered from the
     left by a growing clip. **bold** spans are allowed. */
  function writeItem(lines, x, y, o) {
    o = o || {};
    const size = o.size || 36, lh = o.lh || Math.round(size * 1.17), family = o.font || "Patrick Hand";
    const g = el("g", {}, cur.g);
    const rows = [];
    lines.forEach((ln, i) => {
      const cid = id("c");
      const cp = el("clipPath", { id: cid }, g);
      const r = el("rect", { x: 0, y: y + i * lh - size * 1.05, width: 0, height: size * 1.45 }, cp);
      const t = el("text", { x, y: y + i * lh, "font-family": family, "font-size": size, fill: o.color || INK,
                             "text-anchor": o.anchor || "start", "clip-path": "url(#" + cid + ")" }, g);
      String(ln).split(/(\*\*[^*]+\*\*)/).forEach((part) => {
        if (!part) return;
        const s = el("tspan", {}, t);
        if (/^\*\*/.test(part)) { s.textContent = part.slice(2, -2); s.setAttribute("fill", o.boldColor || BLUE); }
        else s.textContent = part;
      });
      rows.push({ t, r, y: y + i * lh });
    });
    let chars = 0;
    rows.forEach((row) => {
      const bb = row.t.getBBox();
      row.bx = bb.x; row.w = bb.width + 6; row.chars = Math.max(1, row.t.textContent.length);
      row.r.setAttribute("x", bb.x - 4);
      chars += row.chars;
      /* A line running off the edge is caught here, not by eye. */
      if (bb.x < 12 || bb.x + bb.width > W - 12) (window.OVER = window.OVER || []).push(row.t.textContent + " [" + Math.round(bb.x) + ".." + Math.round(bb.x + bb.width) + "]");
    });
    const item = { at: cur.t + (o.delay || 0), kind: "write", rows, g, pen: o.pen !== false, chars };
    item.dur = o.dur || Math.max(0.5, chars / (o.speed || 30));
    cur.items.push(item);
    if (o.read !== false) cur.chars += chars;
    if (!o.with) cur.t = item.at + item.dur;
    return item;
  }

  /* Words that are simply there (labels), faded in. */
  function labelItem(text, x, y, o) {
    o = o || {};
    const t = el("text", { x, y, "font-family": o.font || "Patrick Hand", "font-size": o.size || 22, fill: o.color || SOFT,
                           "text-anchor": o.anchor || "middle", opacity: 0 }, cur.g);
    if (o.weight) t.setAttribute("font-weight", o.weight);
    t.textContent = text;
    const item = { at: cur.t + (o.delay || 0), dur: 0.35, kind: "fade", node: t };
    cur.items.push(item);
    return t;
  }

  /* A real screen inside a drawn phone: frame first, then the picture wipes
     down into it. Returns where the screen landed, for rings and close-ups. */
  function screenItem(name, x, y, w, o) {
    o = o || {};
    const h = w * 844 / 390;
    const pad = 8;
    const bg = el("rect", { x: x - pad, y: y - pad * 2.4, width: w + pad * 2, height: h + pad * 4.8, rx: 24, fill: "#ffffff", opacity: 0 }, cur.g);
    cur.items.push({ at: cur.t, dur: 0.3, kind: "fade", node: bg });
    const frame = rc.path(roundRect(x - pad, y - pad * 2.4, w + pad * 2, h + pad * 4.8, 24), O({ strokeWidth: 3.2 }));
    drawItem(frame, o.frameDur || 0.8);
    const cid = id("s");
    const cp = el("clipPath", { id: cid }, cur.g);
    const r = el("rect", { x, y, width: w, height: 0, rx: 4 }, cp);
    el("image", { href: "build/shots/" + name + ".png", x, y, width: w, height: h, "clip-path": "url(#" + cid + ")",
                  preserveAspectRatio: "none" }, cur.g);
    const item = { at: cur.t, dur: o.dur || 0.7, kind: "wipe", r, h };
    cur.items.push(item);
    cur.t = item.at + item.dur;
    return { name, x, y, w, h, s: w / 390 };
  }

  function markBox(scr, key, pad) {
    const m = (window.MARKS[scr.name] || {})[key];
    if (!m) throw new Error("no mark " + scr.name + "." + key);
    pad = pad === undefined ? 6 : pad;
    return { x: scr.x + (m.x - pad) * scr.s, y: scr.y + (m.y - pad) * scr.s, w: (m.w + pad * 2) * scr.s, h: (m.h + pad * 2) * scr.s, css: m };
  }

  /* A hand-drawn ring round a marked thing on a screen. */
  function ringItem(scr, key, o) {
    o = o || {};
    const b = markBox(scr, key, o.pad);
    const node = rc.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w * 1.12 + 10, b.h * 1.35 + 10, O({ stroke: o.color || RED, strokeWidth: 3.6, roughness: 1.5 }));
    return drawItem(node, o.dur || 0.7, o);
  }

  /* A close-up of a marked part of a screen, lifted out and enlarged. */
  function zoomItem(scr, key, dx, dy, dw, o) {
    o = o || {};
    const m = (window.MARKS[scr.name] || {})[key];
    if (!m) throw new Error("no mark " + scr.name + "." + key);
    const p = o.pad === undefined ? 10 : o.pad;
    const vx = Math.max(0, m.x - p), vy = Math.max(0, m.y - p), vw = Math.min(390 - vx, m.w + p * 2), vh = m.h + p * 2;
    const dh = dw * vh / vw;
    const g = el("g", { opacity: 0 }, cur.g);
    el("rect", { x: dx + 5, y: dy + 7, width: dw, height: dh, rx: 14, fill: "rgba(0,0,0,0.18)" }, g);
    const inner = el("svg", { x: dx, y: dy, width: dw, height: dh, viewBox: vx + " " + vy + " " + vw + " " + vh, preserveAspectRatio: "none" }, g);
    el("image", { href: "build/shots/" + scr.name + ".png", x: 0, y: 0, width: 390, height: 844, preserveAspectRatio: "none" }, inner);
    const border = rc.path(roundRect(dx, dy, dw, dh, 12), O({ strokeWidth: 3, stroke: o.color || INK }));
    g.appendChild(border);
    const item = { at: cur.t + (o.delay || 0), dur: 0.45, kind: "pop", g, cx: dx + dw / 2, cy: dy + dh / 2 };
    cur.items.push(item);
    if (!o.with) cur.t = item.at + item.dur;
    return { x: dx, y: dy, w: dw, h: dh };
  }

  /* A phone notification: the app's icon, its name, and the words the
     server sends, word for word. o.app and o.icon name another app than
     Sunday Bus (the driver video's notifications come from Driver). */
  function noteItem(x, y, w, title, body, o) {
    o = o || {};
    const g = el("g", { opacity: 0 }, cur.g);
    const lines = wrapPx(body, w - 28, "16px Barlow");
    const tlines = wrapPx(title, w - 28, "700 18px Barlow");
    const hgt = 52 + tlines.length * 23 + lines.length * 21 + 10;
    el("rect", { x: x + 3, y: y + 5, width: w, height: hgt, rx: 16, fill: "rgba(0,0,0,0.16)" }, g);
    el("rect", { x, y, width: w, height: hgt, rx: 16, fill: "#ffffff", stroke: "#c9ced4", "stroke-width": 1.2 }, g);
    el("image", { href: o.icon || "../icon-192.png", x: x + 12, y: y + 11, width: 22, height: 22 }, g);
    el("text", { x: x + 42, y: y + 27, "font-family": "Barlow", "font-size": 13.5, fill: SOFT }, g).textContent = (o.app || "Sunday Bus") + (o.when ? " · " + o.when : "");
    tlines.forEach((ln, i) => {
      el("text", { x: x + 14, y: y + 58 + i * 23, "font-family": "Barlow", "font-size": 18, "font-weight": 700, fill: INK }, g).textContent = ln;
    });
    lines.forEach((ln, i) => {
      el("text", { x: x + 14, y: y + 58 + tlines.length * 23 + i * 21, "font-family": "Barlow", "font-size": 16, fill: "#39434d" }, g).textContent = ln;
    });
    const item = { at: cur.t + (o.delay || 0), dur: 0.45, kind: "pop", g, cx: x + w / 2, cy: y + hgt / 2 };
    cur.items.push(item);
    cur.chars += Math.round((title.length + body.length) * 0.6);
    if (!o.with) cur.t = item.at + item.dur;
    return { h: hgt };
  }

  /* A picture file (the app icon on the home screen), popped in. */
  function picItem(href, x, y, w, h, o) {
    o = o || {};
    const g = el("g", { opacity: 0 }, cur.g);
    el("image", { href, x, y, width: w, height: h }, g);
    const item = { at: cur.t + (o.delay || 0), dur: 0.4, kind: "pop", g, cx: x + w / 2, cy: y + h / 2 };
    cur.items.push(item);
    if (!o.with) cur.t = item.at + item.dur;
    return g;
  }

  /* ---- helpers --------------------------------------------------------- */
  function roundRect(x, y, w, h, r) {
    return "M" + (x + r) + " " + y + " H" + (x + w - r) + " Q" + (x + w) + " " + y + " " + (x + w) + " " + (y + r) +
           " V" + (y + h - r) + " Q" + (x + w) + " " + (y + h) + " " + (x + w - r) + " " + (y + h) +
           " H" + (x + r) + " Q" + x + " " + (y + h) + " " + x + " " + (y + h - r) + " V" + (y + r) +
           " Q" + x + " " + y + " " + (x + r) + " " + y + " Z";
  }
  const ctx2d = document.createElement("canvas").getContext("2d");
  function wrapPx(s, maxW, font) {
    ctx2d.font = font;
    const out = []; let line = "";
    String(s).split(" ").forEach((w) => {
      const tryL = line ? line + " " + w : w;
      if (ctx2d.measureText(tryL).width > maxW && line) { out.push(line); line = w; } else line = tryL;
    });
    if (line) out.push(line);
    return out;
  }
  function group(children) { const g = document.createElementNS(NS, "g"); children.forEach((c) => g.appendChild(c)); return g; }

  /* ---- the doodles ----------------------------------------------------- */
  const D = {
    bus(x, y, s) {
      s = s || 1;
      const k = (v) => v * s;
      return group([
        rc.path(roundRect(x, y, k(200), k(92), k(14)), O({ fill: YEL, fillStyle: "hachure", hachureGap: 7, fillWeight: 1.6 })),
        rc.rectangle(x + k(14), y + k(14), k(34), k(28), O()),
        rc.rectangle(x + k(56), y + k(14), k(34), k(28), O()),
        rc.rectangle(x + k(98), y + k(14), k(34), k(28), O()),
        rc.rectangle(x + k(150), y + k(14), k(36), k(58), O()),
        rc.line(x + k(8), y + k(56), x + k(140), y + k(56), O({ strokeWidth: 1.6 })),
        rc.circle(x + k(44), y + k(94), k(32), O({ fill: INK, fillStyle: "solid" })),
        rc.circle(x + k(156), y + k(94), k(32), O({ fill: INK, fillStyle: "solid" }))
      ]);
    },
    church(x, y, s) {
      s = s || 1;
      const k = (v) => v * s;
      return group([
        rc.polygon([[x, y + k(70)], [x + k(70), y + k(20)], [x + k(140), y + k(70)]], O()),
        rc.rectangle(x + k(12), y + k(70), k(116), k(80), O()),
        rc.path("M" + (x + k(56)) + " " + (y + k(150)) + " V" + (y + k(118)) + " Q" + (x + k(70)) + " " + (y + k(100)) + " " + (x + k(84)) + " " + (y + k(118)) + " V" + (y + k(150)), O()),
        rc.line(x + k(70), y - k(14), x + k(70), y + k(20), O({ strokeWidth: 3 })),
        rc.line(x + k(58), y - k(2), x + k(82), y - k(2), O({ strokeWidth: 3 }))
      ]);
    },
    road(x1, x2, y) {
      const out = [rc.line(x1, y, x2, y, O({ strokeWidth: 2 }))];
      for (let x = x1 + 20; x + 40 < x2; x += 90) out.push(rc.line(x, y + 14, x + 40, y + 14, O({ strokeWidth: 2, stroke: SOFT })));
      return group(out);
    },
    phone(x, y, w, h) { return group([rc.path(roundRect(x, y, w, h, 26), O({ strokeWidth: 3.2 })), rc.line(x + w / 2 - 22, y + 16, x + w / 2 + 22, y + 16, O())]); },
    clock(x, y, r, hh, mm) {
      const a = (mm / 60) * 2 * Math.PI - Math.PI / 2, b = ((hh % 12) / 12 + mm / 720) * 2 * Math.PI - Math.PI / 2;
      const ticks = [];
      for (let i = 0; i < 12; i += 3) { const q = i / 12 * 2 * Math.PI; ticks.push(rc.line(x + Math.cos(q) * r * 0.8, y + Math.sin(q) * r * 0.8, x + Math.cos(q) * r * 0.95, y + Math.sin(q) * r * 0.95, O({ strokeWidth: 2 }))); }
      return group([rc.circle(x, y, r * 2, O({ strokeWidth: 3 }))].concat(ticks).concat([
        rc.line(x, y, x + Math.cos(b) * r * 0.5, y + Math.sin(b) * r * 0.5, O({ strokeWidth: 4, roughness: 0.5 })),
        rc.line(x, y, x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, O({ strokeWidth: 2.6, roughness: 0.5 }))]));
    },
    bubble(x, y, w, h) { return rc.path(roundRect(x, y, w, h, 16) + " M" + (x + 24) + " " + (y + h) + " L" + (x + 12) + " " + (y + h + 20) + " L" + (x + 44) + " " + (y + h), O({ fill: "#dcf8c6", fillStyle: "solid" })); },
    tick(x, y, s) { s = s || 1; return rc.path("M" + x + " " + (y + 20 * s) + " L" + (x + 16 * s) + " " + (y + 38 * s) + " L" + (x + 48 * s) + " " + y, O({ stroke: GREEN, strokeWidth: 5 })); },
    arrow(x1, y1, x2, y2, c) {
      const a = Math.atan2(y2 - y1, x2 - x1), L = 16;
      return group([rc.line(x1, y1, x2, y2, O({ stroke: c || INK, strokeWidth: 3 })),
        rc.line(x2, y2, x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45), O({ stroke: c || INK, strokeWidth: 3 })),
        rc.line(x2, y2, x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45), O({ stroke: c || INK, strokeWidth: 3 }))]);
    },
    curve(x1, y1, cx, cy, x2, y2, c) {
      const a = Math.atan2(y2 - cy, x2 - cx), L = 16;
      return group([rc.path("M" + x1 + " " + y1 + " Q" + cx + " " + cy + " " + x2 + " " + y2, O({ stroke: c || INK, strokeWidth: 3 })),
        rc.line(x2, y2, x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45), O({ stroke: c || INK, strokeWidth: 3 })),
        rc.line(x2, y2, x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45), O({ stroke: c || INK, strokeWidth: 3 }))]);
    },
    ring(x, y, w, h, c) { return rc.ellipse(x, y, w, h, O({ stroke: c || RED, strokeWidth: 3.5, roughness: 1.6 })); },
    underline(x1, x2, y, c) { return rc.line(x1, y, x2, y, O({ stroke: c || YEL, strokeWidth: 7, roughness: 1.4 })); },
    bell(x, y, s) {
      s = s || 1; const k = (v) => v * s;
      return group([rc.path("M" + (x - k(24)) + " " + (y + k(18)) + " Q" + (x - k(20)) + " " + (y - k(26)) + " " + x + " " + (y - k(28)) +
                            " Q" + (x + k(20)) + " " + (y - k(26)) + " " + (x + k(24)) + " " + (y + k(18)) + " Z", O({ fill: YEL, fillStyle: "hachure", hachureGap: 5 })),
                    rc.circle(x, y + k(25), k(11), O()),
                    rc.path("M" + (x - k(38)) + " " + (y - k(14)) + " Q" + (x - k(44)) + " " + y + " " + (x - k(38)) + " " + (y + k(14)), O({ strokeWidth: 2 })),
                    rc.path("M" + (x + k(38)) + " " + (y - k(14)) + " Q" + (x + k(44)) + " " + y + " " + (x + k(38)) + " " + (y + k(14)), O({ strokeWidth: 2 }))]);
    },
    person(x, y, s) {
      s = s || 1; const k = (v) => v * s;
      return group([rc.circle(x, y, k(26), O()), rc.line(x, y + k(13), x, y + k(52), O()),
        rc.line(x, y + k(24), x - k(16), y + k(40), O()), rc.line(x, y + k(24), x + k(16), y + k(40), O()),
        rc.line(x, y + k(52), x - k(12), y + k(76), O()), rc.line(x, y + k(52), x + k(12), y + k(76), O())]);
    },
    stopSign(x, y) { return group([rc.line(x, y, x, y + 90, O({ strokeWidth: 3 })), rc.rectangle(x - 22, y - 30, 44, 34, O({ fill: "#ffffff", fillStyle: "solid" }))]); },
    homeGrid(x, y, w, skip, cols) {
      const out = [];
      cols = cols || 4;
      const gap = w / cols, sz = gap * 0.62;
      for (let r = 0; r < 4; r++) for (let c = 0; c < cols; c++) {
        if (skip && skip[0] === r && skip[1] === c) continue;
        out.push(rc.path(roundRect(x + c * gap + (gap - sz) / 2, y + r * gap * 1.3, sz, sz, 12), O({ strokeWidth: 1.8, stroke: "#9aa3ab" })));
      }
      return group(out);
    },
    finger(x, y) {
      return rc.path("M" + x + " " + y + " q -8 -4 -10 6 l 2 34 q -16 -10 -20 2 q 10 16 22 30 l 34 0 q 8 -18 6 -40 q -2 -10 -10 -8 q -2 -10 -10 -8 q -2 -10 -10 -6 l 0 -14 q -2 -8 -8 -6 z",
        O({ fill: "#f3d7b8", fillStyle: "solid", strokeWidth: 2.2 }));
    }
  };

  /* ---- the public builder -------------------------------------------- */
  const api = {
    W, H, INK, SOFT, YEL, GREEN, RED, BLUE, PAPER, D, rc, O,
    clip(cid, build) {
      clips[cid] = [];
      build((fn) => {
        cur = Scene(cid);
        fn(api);
        /* Holds until the words on it can be read at an unhurried pace. */
        const hold = cur.hold || Math.max(1.8, cur.chars / 17);
        cur.dur = cur.t + hold + 0.5;
        cur.g.style.display = "none";
        clips[cid].push(cur);
      });
    },
    draw: (node, dur, o) => drawItem(node, dur, o),
    write: (lines, x, y, o) => writeItem(lines, x, y, o),
    label: (text, x, y, o) => labelItem(text, x, y, o),
    screen: (name, x, y, w, o) => screenItem(name, x, y, w, o),
    ringOn: (scr, key, o) => ringItem(scr, key, o),
    zoom: (scr, key, dx, dy, dw, o) => zoomItem(scr, key, dx, dy, dw, o),
    box: (scr, key, pad) => markBox(scr, key, pad),
    note: (x, y, w, title, body, o) => noteItem(x, y, w, title, body, o),
    pic: (href, x, y, w, h, o) => picItem(href, x, y, w, h, o),
    rect: (attrs) => el("rect", attrs, cur.g),
    wait: (s) => { cur.t += s; },
    hold: (s) => { cur.hold = s; },
    at: () => cur.t
  };
  window.DOODLE = api;

  /* ---- rendering ------------------------------------------------------ */
  window.clipLength = (cid) => (clips[cid] || []).reduce((a, s) => a + s.dur, 0);
  window.clipScenes = (cid) => (clips[cid] || []).map((s) => +s.dur.toFixed(2));

  window.renderAt = (cid, T) => {
    let t0 = 0, scene = null;
    const list = clips[cid];
    for (const s of list) { if (T < t0 + s.dur || s === list[list.length - 1]) { scene = s; break; } t0 += s.dur; }
    for (const c in clips) for (const s of clips[c]) s.g.style.display = s === scene ? "" : "none";
    const t = T - t0;
    let tip = null;
    for (const it of scene.items) {
      const p = clamp((t - it.at) / it.dur);
      if (it.kind === "draw") {
        let left = p * it.total;
        it.paths.forEach((path, i) => {
          const L = it.lens[i], d = Math.max(0, Math.min(L, left));
          path.style.strokeDashoffset = String(L - d);
          if (path.getAttribute("stroke") === "none") path.style.opacity = d >= L * 0.98 ? 1 : 0;
          if (p > 0 && p < 1 && d > 0 && d < L && it.pen) {
            const pt = path.getPointAtLength(d);
            tip = { x: pt.x, y: pt.y };
          }
          left -= L;
        });
      } else if (it.kind === "write") {
        let left = p * it.chars;
        it.rows.forEach((row) => {
          const f = clamp(left / row.chars);
          row.r.setAttribute("width", row.w * f + 4);
          if (p > 0 && p < 1 && f > 0 && f < 1 && it.pen) tip = { x: row.bx + row.w * f, y: row.y };
          left -= row.chars;
        });
      } else if (it.kind === "wipe") {
        it.r.setAttribute("height", it.h * ease(p));
      } else if (it.kind === "fade") {
        it.node.setAttribute("opacity", ease(p));
      } else if (it.kind === "pop") {
        const q = ease(p);
        it.g.setAttribute("opacity", q);
        it.g.setAttribute("transform", "translate(" + it.cx + " " + it.cy + ") scale(" + (0.8 + 0.2 * q) + ") translate(" + -it.cx + " " + -it.cy + ")");
      }
    }
    const fade = Math.min(clamp(t / 0.25), clamp((scene.dur - t) / 0.3));
    scene.g.setAttribute("opacity", fade);
    if (tip && fade > 0.9) { pencil.style.display = ""; pencil.setAttribute("transform", "translate(" + tip.x + " " + tip.y + ")"); svg.appendChild(pencil); }
    else pencil.style.display = "none";
  };
})();
