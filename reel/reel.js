// from the machine up: a thirty second reel for lolwierd.com.
//
// Everything here is a pure function of time. render(t) draws the frame at t
// and remembers nothing, so the same file plays live in a browser and renders
// frame-exact video (render.mjs steps it at 60fps). The score is synthesised
// from cues() below, which is the same data the pictures are drawn from, so a
// sound lands on the frame its event does rather than near it.
//
// The print language is the site's: dots on a two-pixel grid, gated by the
// same 8x8 bayer matrix, one ink per theme and a single rust accent that only
// ever marks the part that failed. The reel climbs the stack a layer at a time
// and ends where the site begins, on the range.

(() => {
  "use strict";

  const W = 1920, H = 1080, C = 2, CW = 960, CH = 540, FPS = 60, DUR = 30;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------------ math

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const inv = (a, b, v) => clamp((v - a) / (b - a));
  const sstep = (a, b, v) => { const x = inv(a, b, v); return x * x * (3 - 2 * x); };
  const pulse = (a, b, c, d, v) => sstep(a, b, v) * (1 - sstep(c, d, v));

  const E = {
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inCubic: (t) => t * t * t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    outQuint: (t) => 1 - Math.pow(1 - t, 5),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
    inOutExpo: (t) =>
      t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
    outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
    outElastic: (t) =>
      t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1
  };

  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (t) => ((ax * t + bx) * t + cx) * t;
    const Y = (t) => ((ay * t + by) * t + cy) * t;
    const D = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 10; i++) {
        const e = X(t) - x;
        if (Math.abs(e) < 1e-6) break;
        const d = D(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      return Y(clamp(t));
    };
  }
  // The two curves most of the motion is cut from: a long confident
  // deceleration, and a symmetrical move for things that travel.
  const EXPR = bezier(0.16, 1, 0.3, 1);
  const SWIFT = bezier(0.7, 0, 0.2, 1);

  function h32(n) {
    n |= 0;
    n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
    n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
    n ^= n >>> 16;
    return n >>> 0;
  }
  const hu = (n) => h32(n) / 4294967296;
  const h2 = (x, y, s = 0) => hu(Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177));

  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }
  function fbm(x, y, oct = 4) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f + i * 17.3, y * f - i * 9.1); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  function mulberry(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------ palettes

  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const pk = (c) => ((255 << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // Straight from global.css and sky-shared.js. Night and day are composed
  // separately, as they are on the site; neither is the other inverted.
  function palette(def) {
    const P = { name: def.name, rgb: {}, css: {} };
    for (const k of ["paper", "cell", "ink", "strong", "dim", "faint", "accent"]) {
      P.rgb[k] = hex(def[k]);
      P.css[k] = def[k];
      P[k] = pk(P.rgb[k]);
    }
    P.ramp = def.ramp.map((h, i) => pk(mix3(P.rgb.paper, hex(h), def.rampW[i] * def.rampA)));
    P.rampFull = def.ramp.map((h) => pk(hex(h)));
    const cache = new Map();
    P.tone = (key, a) => {
      const q = Math.round(clamp(a) * 48);
      const id = key + q;
      let v = cache.get(id);
      if (v === undefined) { v = pk(mix3(P.rgb.paper, P.rgb[key], q / 48)); cache.set(id, v); }
      return v;
    };
    return P;
  }

  const NIGHT = palette({
    name: "night", paper: "#0b0e13", cell: "#e4dac8", ink: "#d0c9bb", strong: "#ece4d5",
    dim: "#99958c", faint: "#7e7a70", accent: "#c45b36",
    ramp: ["#c6d2db", "#94a2ad", "#3c5470"], rampW: [1, 0.95, 0.46], rampA: 0.91 * 0.9
  });
  const DAY = palette({
    name: "day", paper: "#eee9df", cell: "#293039", ink: "#2b2d31", strong: "#181a1e",
    dim: "#5a5954", faint: "#6b6961", accent: "#9d4429",
    ramp: ["#232a34", "#4a5a6d", "#7d8b9a"], rampW: [1, 0.9, 0.44], rampA: 0.87
  });

  // ------------------------------------------------------------- dither

  const B8 = [
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21
  ];
  const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // The site's lattice: seven eighths ordered, one eighth hash, so a flat
  // density never settles into a checkerboard.
  const THR = new Float32Array(CW * CH);
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++)
      THR[y * CW + x] = ((B8[((y & 7) << 3) | (x & 7)] + 0.5) / 64) * 0.875 + h2(x, y, 77) * 0.125;

  // ------------------------------------------------------------ buffers

  const frameN = new Uint32Array(CW * CH);
  const frameD = new Uint32Array(CW * CH);
  const layer = new Uint32Array(CW * CH);
  let FB = frameN;
  let buf = layer;

  // camera: screen = (world - O) * S + O + T, in cells
  let TX = 0, TY = 0, TS = 1, OX = 480, OY = 270;
  const wx = (x) => (x - OX) * TS + OX + TX;
  const wy = (y) => (y - OY) * TS + OY + TY;
  const ix = (x) => (x - TX - OX) / TS + OX;
  const iy = (y) => (y - TY - OY) / TS + OY;
  const R = Math.round;

  function resetCam() { TX = 0; TY = 0; TS = 1; OX = 480; OY = 270; }

  function fillS(a, b, e, f, c, d) {
    if (a < 0) a = 0; if (b < 0) b = 0; if (e > CW) e = CW; if (f > CH) f = CH;
    if (a >= e || b >= f || d <= 0) return;
    if (d >= 1) { for (let y = b; y < f; y++) buf.fill(c, y * CW + a, y * CW + e); return; }
    for (let y = b; y < f; y++) { const r = y * CW; for (let x = a; x < e; x++) if (d > THR[r + x]) buf[r + x] = c; }
  }
  function rect(x0, y0, x1, y1, c, d = 1) {
    let a = R(wx(x0)), b = R(wy(y0)), e = R(wx(x1)), f = R(wy(y1));
    if (a > e) [a, e] = [e, a];
    if (b > f) [b, f] = [f, b];
    fillS(a, b, e, f, c, d);
  }
  function rectFn(x0, y0, x1, y1, c, fn) {
    const a = Math.max(0, R(wx(x0))), b = Math.max(0, R(wy(y0))), e = Math.min(CW, R(wx(x1))), f = Math.min(CH, R(wy(y1)));
    for (let y = b; y < f; y++) {
      const r = y * CW, yy = iy(y + 0.5);
      for (let x = a; x < e; x++) { const d = fn(ix(x + 0.5), yy, x, y); if (d > THR[r + x]) buf[r + x] = c; }
    }
  }
  function pS(x, y, c, d = 1) {
    if (x < 0 || y < 0 || x >= CW || y >= CH) return;
    const i = y * CW + x;
    if (d >= 1 || d > THR[i]) buf[i] = c;
  }
  const pt = (x, y, c, d = 1) => pS(Math.floor(wx(x)), Math.floor(wy(y)), c, d);
  function hS(x0, x1, y, c, d = 1, dash = 0) {
    if (y < 0 || y >= CH) return;
    if (x0 > x1) [x0, x1] = [x1, x0];
    x0 = Math.max(0, x0); x1 = Math.min(CW - 1, x1);
    const r = y * CW;
    for (let x = x0; x <= x1; x++) { if (dash && ((x / dash) | 0) & 1) continue; if (d >= 1 || d > THR[r + x]) buf[r + x] = c; }
  }
  function vS(x, y0, y1, c, d = 1, dash = 0) {
    if (x < 0 || x >= CW) return;
    if (y0 > y1) [y0, y1] = [y1, y0];
    y0 = Math.max(0, y0); y1 = Math.min(CH - 1, y1);
    for (let y = y0; y <= y1; y++) { if (dash && ((y / dash) | 0) & 1) continue; const i = y * CW + x; if (d >= 1 || d > THR[i]) buf[i] = c; }
  }
  function box(x0, y0, x1, y1, c, d = 1, dash = 0) {
    const a = R(wx(x0)), b = R(wy(y0)), e = R(wx(x1)) - 1, f = R(wy(y1)) - 1;
    if (e < a || f < b) return;
    hS(a, e, b, c, d, dash); hS(a, e, f, c, d, dash); vS(a, b, f, c, d, dash); vS(e, b, f, c, d, dash);
  }
  function line(x0, y0, x1, y1, c, d = 1, dash = 0) {
    let a = R(wx(x0)), b = R(wy(y0));
    const e = R(wx(x1)), f = R(wy(y1));
    const dx = Math.abs(e - a), dy = -Math.abs(f - b), sx = a < e ? 1 : -1, sy = b < f ? 1 : -1;
    let err = dx + dy, n = 0;
    for (;;) {
      if (!dash || !(((n / dash) | 0) & 1)) pS(a, b, c, d);
      if (a === e && b === f) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; a += sx; }
      if (e2 <= dx) { err += dx; b += sy; }
      n++;
    }
  }
  function ring(cx, cy, r, th, c, d) {
    const sx = wx(cx), sy = wy(cy), sr = r * TS, st = (th * TS) / 2;
    const a = Math.floor(sx - sr - st), e = Math.ceil(sx + sr + st), b = Math.floor(sy - sr - st), f = Math.ceil(sy + sr + st);
    for (let y = Math.max(0, b); y <= Math.min(CH - 1, f); y++)
      for (let x = Math.max(0, a); x <= Math.min(CW - 1, e); x++) {
        const dist = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
        if (Math.abs(dist - sr) <= st) pS(x, y, c, d);
      }
  }
  function disc(cx, cy, r, c, d = 1) {
    const sx = wx(cx), sy = wy(cy), sr = r * TS;
    for (let y = Math.max(0, Math.floor(sy - sr)); y <= Math.min(CH - 1, Math.ceil(sy + sr)); y++)
      for (let x = Math.max(0, Math.floor(sx - sr)); x <= Math.min(CW - 1, Math.ceil(sx + sr)); x++)
        if (Math.hypot(x + 0.5 - sx, y + 0.5 - sy) <= sr) pS(x, y, c, d);
  }
  // a short streak behind a moving dot, thinning to nothing
  function streak(x, y, vx, vy, c, len, d = 1) {
    const sp = Math.hypot(vx, vy);
    const n = Math.min(len, Math.ceil(sp));
    pt(x, y, c, d);
    if (n < 1) return;
    for (let k = 1; k <= n; k++) pt(x - (vx / sp) * k, y - (vy / sp) * k, c, d * (1 - k / (n + 1)));
  }

  // Composite the scratch layer onto the frame. A whip smears it along the
  // move: each lit cell drags a dithered tail, so blur is printed in the same
  // dots as everything else instead of being an alpha wash.
  function composite(smear) {
    const n = Math.min(Math.abs(smear), 240) | 0;
    if (n < 2) { for (let i = 0; i < layer.length; i++) { const v = layer[i]; if (v) FB[i] = v; } return; }
    // Box filter along the move: a cell's density is how much of the shutter
    // interval something lit spent over it. Thin things moving fast nearly
    // vanish and solid things stretch, which is what a camera does.
    const up = smear > 0, gain = 2.2 / (n + 1);
    for (let x = 0; x < CW; x++) {
      let sum = 0, col = 0;
      for (let k = 0; k < CH; k++) {
        const y = up ? CH - 1 - k : k, i = y * CW + x, v = layer[i];
        if (v) { sum++; col = v; }
        if (k > n) { const yo = up ? y + n + 1 : y - n - 1; if (layer[yo * CW + x]) sum--; }
        if (sum > 0 && Math.min(1, sum * gain) > THR[i]) FB[i] = col;
      }
    }
  }

  // ------------------------------------------------------------ overlay

  const MONO = '"Departure Mono"';
  const SERIF = '"Newsreader"';
  let OC = null;
  let TALPHA = 1;
  let OGHOST = 0;

  function txt(s, x, y, o = {}) {
    const a = (o.alpha == null ? 1 : o.alpha) * TALPHA;
    if (a <= 0.004 || !s) return;
    const size = o.size || 22;
    let px = o.screen ? x : wx(x) * C, py = o.screen ? y : wy(y) * C;
    px = Math.round(px); py = Math.round(py);
    OC.font = `${o.italic ? "italic " : ""}${size}px ${o.fam || MONO}`;
    OC.textAlign = o.align || "left";
    OC.textBaseline = o.base || "alphabetic";
    OC.letterSpacing = (o.ls || 0) + "px";
    OC.fillStyle = o.color;
    if (Math.abs(OGHOST) > 3 && (!o.screen || o.ghost)) {
      const K = Math.round(clamp((Math.abs(OGHOST) * 0.75) / 4, 3, 28));
      OC.globalAlpha = a * Math.min(1, 2.4 / K);
      for (let k = 0; k < K; k++) OC.fillText(s, px, Math.round(py - (OGHOST * 0.75 * k) / (K - 1)));
      OC.globalAlpha = 1;
      return;
    }
    OC.globalAlpha = a;
    OC.fillText(s, px, py);
    OC.globalAlpha = 1;
  }
  function tw(s, size, fam = MONO, ls = 0) {
    OC.font = `${size}px ${fam}`;
    OC.letterSpacing = ls + "px";
    return OC.measureText(s).width;
  }

  // Text on a paper chip, for labels that sit over something busy.
  function chip(s, x, y, o) {
    const size = o.size || 22, px = Math.round(wx(x) * C), py = Math.round(wy(y) * C);
    const w = tw(s, size, o.fam || MONO);
    OC.globalAlpha = (o.alpha == null ? 1 : o.alpha) * TALPHA;
    OC.fillStyle = o.bg;
    const x0 = o.align === "center" ? px - w / 2 : o.align === "right" ? px - w : px;
    OC.fillRect(x0 - 8, py - size + 1, w + 16, size + 10);
    OC.globalAlpha = 1;
    txt(s, x, y, o);
  }

  // Print text in through the dither: a cell of the glyph shows once the
  // reveal field beats that cell's bayer threshold. Ends as clean type.
  const TCV = document.createElement("canvas"); TCV.width = W; TCV.height = H;
  const TCX = TCV.getContext("2d");
  const MCV = document.createElement("canvas"); MCV.width = CW; MCV.height = CH;
  const MCX = MCV.getContext("2d");
  function printIn(draw, bx, by, bw, bh, reveal) {
    const cx0 = Math.max(0, Math.floor(bx / C)), cy0 = Math.max(0, Math.floor(by / C));
    const cx1 = Math.min(CW, Math.ceil((bx + bw) / C)), cy1 = Math.min(CH, Math.ceil((by + bh) / C));
    const cw = cx1 - cx0, ch = cy1 - cy0;
    if (cw <= 0 || ch <= 0) return;
    TCX.clearRect(0, 0, W, H);
    const saved = OC; OC = TCX; draw(); OC = saved;
    const img = MCX.createImageData(cw, ch);
    let any = false, full = true;
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const gx = cx0 + x, gy = cy0 + y;
        const on = reveal(gx, gy) > THR[gy * CW + gx];
        if (on) { img.data[(y * cw + x) * 4 + 3] = 255; any = true; } else full = false;
      }
    if (!any) return;
    if (!full) {
      MCX.clearRect(0, 0, CW, CH);
      MCX.putImageData(img, 0, 0);
      TCX.globalCompositeOperation = "destination-in";
      TCX.imageSmoothingEnabled = false;
      TCX.drawImage(MCV, 0, 0, cw, ch, cx0 * C, cy0 * C, cw * C, ch * C);
      TCX.globalCompositeOperation = "source-over";
    }
    OC.drawImage(TCV, cx0 * C, cy0 * C, cw * C, ch * C, cx0 * C, cy0 * C, cw * C, ch * C);
  }

  // =================================================================
  // precomputed structure (built once in init)
  // =================================================================

  const PHOTO = { s: 0.34, x: -30, y: 92 };
  let RIDGE = null;       // float y of the skyline per cell column
  let RIDGEI = null;      // integer version
  let TIERS_N = null, TIERS_D = null;
  let TREE = null, LEAVES = null, MIG_A = null, MIG_B = null;
  let NUM = null;         // 4,000 points of the numeral
  let STAR = null;        // seats for the same 4,000 points
  let LANES = null;
  const CUES = [];
  const cue = (t, type, v = 0) => CUES.push({ t: +t.toFixed(4), type, v });

  // --- terrain, exactly the site's pipeline at two-pixel cells ---------
  function terrainPaper(l, dark) {
    const v = l / 255;
    const density = dark
      ? 0.035 + 0.965 * Math.pow(sstep(0.055, 0.95, v), 1.27)
      : 0.018 + 0.982 * Math.pow(sstep(0.035, 0.84, 1 - v), 1.62);
    return 1 - clamp(density);
  }
  function atkinson(paper, ridge) {
    const TIERS = 3, work = new Float32Array(paper), dots = new Uint8Array(CW * CH);
    const diffuse = (x, y, e) => { if (x < 0 || y < 0 || x >= CW || y >= CH || y < ridge[x]) return; work[y * CW + x] += e; };
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const i = y * CW + x;
        if (y < ridge[x]) { dots[i] = TIERS; continue; }
        const old = work[i], level = Math.round(clamp(old) * TIERS);
        dots[i] = level;
        const e = (old - level / TIERS) * 0.125;
        if (!e) continue;
        diffuse(x + 1, y, e); diffuse(x + 2, y, e); diffuse(x - 1, y + 1, e);
        diffuse(x, y + 1, e); diffuse(x + 1, y + 1, e); diffuse(x, y + 2, e);
      }
    return dots;
  }
  function buildTerrain(img, sky) {
    const cv = document.createElement("canvas"); cv.width = CW; cv.height = CH;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, PHOTO.x, PHOTO.y, 3000 * PHOTO.s, 2000 * PHOTO.s);
    const d = g.getImageData(0, 0, CW, CH).data;
    RIDGE = new Float32Array(CW); RIDGEI = new Int32Array(CW);
    for (let x = 0; x < CW; x++) {
      const px = (x + 0.5 - PHOTO.x) / PHOTO.s, f = px / sky.step;
      const i0 = clamp(Math.floor(f), 0, sky.y.length - 1), i1 = Math.min(sky.y.length - 1, i0 + 1);
      const yy = lerp(sky.y[i0], sky.y[i1], f - Math.floor(f));
      RIDGE[x] = yy * PHOTO.s + PHOTO.y;
      RIDGEI[x] = Math.ceil(RIDGE[x]);
    }
    const pn = new Float32Array(CW * CH), pd = new Float32Array(CW * CH);
    for (let i = 0; i < CW * CH; i++) {
      const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      pn[i] = terrainPaper(l, true); pd[i] = terrainPaper(l, false);
    }
    TIERS_N = atkinson(pn, RIDGEI);
    TIERS_D = atkinson(pd, RIDGEI);
  }
  const ridgeAt = (x) => RIDGE[clamp(Math.round(x), 0, CW - 1)];

  // --- the compute host, split until there are 380 of it --------------
  function buildTree() {
    const rnd = mulberry(1729);
    const root = { id: 0, x: 282, y: 94, w: 556, h: 352, kids: null, ts: Infinity, parent: null };
    let leaves = [root], id = 1, s = 0;
    while (leaves.length < 380) {
      let bi = 0;
      for (let i = 1; i < leaves.length; i++) if (leaves[i].w * leaves[i].h > leaves[bi].w * leaves[bi].h) bi = i;
      const n = leaves[bi];
      const axis = n.w / n.h > 1.3 ? 0 : n.h / n.w > 1.3 ? 1 : rnd() < 0.5 ? 0 : 1;
      n.axis = axis; n.r = 0.36 + rnd() * 0.28;
      n.ts = 6.3 + 0.19 * Math.log2(s + 1); s++;
      let a, b;
      if (axis === 0) {
        a = { x: n.x, y: n.y, w: n.w * n.r, h: n.h };
        b = { x: n.x + n.w * n.r, y: n.y, w: n.w * (1 - n.r), h: n.h };
      } else {
        a = { x: n.x, y: n.y, w: n.w, h: n.h * n.r };
        b = { x: n.x, y: n.y + n.h * n.r, w: n.w, h: n.h * (1 - n.r) };
      }
      a = Object.assign(a, { id: id++, kids: null, ts: Infinity, parent: n });
      b = Object.assign(b, { id: id++, kids: null, ts: Infinity, parent: n });
      n.kids = [a, b];
      leaves.splice(bi, 1, a, b);
      cue(n.ts, "split", s);
    }
    TREE = root; LEAVES = leaves;
    const near = (px, py) => leaves.filter((l) => l.w >= 24 && l.h >= 18).reduce((best, l) => {
      const d = Math.hypot(l.x + l.w / 2 - px, l.y + l.h / 2 - py);
      return d < best.d ? { l, d } : best;
    }, { l: null, d: Infinity }).l;
    MIG_A = near(350, 390);
    MIG_B = near(780, 140);
  }

  // --- storage lanes ---------------------------------------------------
  const LANE = { n: 9, x0: 150, x1: 850, xr: 560, pitch: 24, bw: 18, bh: 20 };
  function laneY(k) { return 104 + k * 38; }
  function laneSpeed(k) { return 120 + 80 * hu(k * 13 + 5); }
  function buildLanes() {
    LANES = [];
    const L = LANE.x1 - LANE.x0 + LANE.pitch;
    const N = Math.ceil(L / LANE.pitch);
    let fixed = [];
    for (let k = 0; k < LANE.n; k++) {
      const sp = laneSpeed(k);
      for (let b = 0; b < N; b++)
        for (let g = 0; g < 8; g++) {
          // block centre crosses the reconciler when u - g*L - pitch + bw/2 = xr - x0
          const u = g * L + (LANE.xr - LANE.x0) + LANE.pitch - LANE.bw / 2;
          const tc = 9.5 + (u - b * LANE.pitch) / sp;
          const id = h32(k * 7919 + b * 131 + g * 104729);
          if (id / 4294967296 < 0.16 && tc >= 10.05 && tc <= 12.0) fixed.push(tc);
        }
    }
    fixed.sort((a, b) => a - b);
    LANES.fixed = fixed;
    for (const tc of fixed) cue(tc, "reconcile", 1);
  }

  // --- the numeral and the sky it becomes ------------------------------
  function buildNumeral() {
    const cv = document.createElement("canvas"); cv.width = CW; cv.height = CH;
    const g = cv.getContext("2d", { willReadFrequently: true });
    const text = "4,000+";
    g.font = `100px ${SERIF}`;
    const m = g.measureText(text);
    const size = Math.floor((100 * 430) / m.width);
    g.font = `${size}px ${SERIF}`;
    g.textAlign = "center"; g.textBaseline = "alphabetic";
    g.fillStyle = "#fff";
    g.fillText(text, 480, 282);
    const d = g.getImageData(0, 0, CW, CH).data;
    const pts = [];
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (d[(y * CW + x) * 4 + 3] > 127) pts.push(x, y);
    const n = pts.length / 2, rnd = mulberry(4000), order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    NUM = new Float32Array(8000);
    for (let i = 0; i < 4000; i++) { const o = order[i % n]; NUM[i * 2] = pts[o * 2] + 0.5; NUM[i * 2 + 1] = pts[o * 2 + 1] + 0.5; }
    STAR = new Float32Array(8000);
    for (let i = 0; i < 4000; i++) {
      const x = hu(i * 7 + 1) * CW;
      const top = 10, bottom = ridgeAt(x) - 12;
      STAR[i * 2] = x;
      STAR[i * 2 + 1] = top + (bottom - top) * Math.pow(hu(i * 7 + 2), 1.35);
    }
  }

  // =================================================================
  // timeline
  // =================================================================

  const WHIPS = [6, 10, 12, 14, 16, 18, 20];
  const HW = 0.25;
  const whipP = (T, t) => E.inOutExpo(inv(T - HW, T + HW, t));

  const SECTIONS = [
    { key: "boot", t0: 0, t1: 2 },
    { key: "metal", t0: 2, t1: 6, n: "01", name: "metal", slug: "bare-metal hosts · the go control plane for qemu/kvm" },
    { key: "compute", t0: 6, t1: 10, n: "02", name: "compute", slug: "firecracker · qemu/kvm · live migration with resumable sessions" },
    { key: "storage", t0: 10, t1: 12, n: "03", name: "storage", slug: "spdk · nvme-of · vfio-user · reconciling bdev, lvol and raid state" },
    { key: "network", t0: 12, t1: 14, n: "04", name: "network", slug: "af_packet arp/ndp proxy · bpf · authoritative dns, axfr, ixfr, tsig" },
    { key: "k8s", t0: 14, t1: 16, n: "05", name: "kubernetes", slug: "managed kubernetes · oidc and jwks · cilium · csi · a karpenter provider" },
    { key: "tooling", t0: 16, t1: 18, n: "06", name: "tooling", slug: "openapi 3.1 generated from go types · one spec, three clients" },
    { key: "people", t0: 18, t1: 20, n: "07", name: "people", slug: "excloud · jun 2023 to aug 2026" },
    { key: "summit", t0: 20, t1: 30.5, n: "08", name: "summit", slug: "annapurna i · printed in the same order as the first dot" }
  ];

  // altitude tape keyframes: creep inside a layer, spin through a whip
  const ALT = [
    [2.0, 0, "lin"], [5.75, 420, "lin"], [6.25, 1000, "whip"], [9.75, 1540, "lin"], [10.25, 2000, "whip"],
    [11.75, 2280, "lin"], [12.25, 3000, "whip"], [13.75, 3300, "lin"], [14.25, 4000, "whip"],
    [15.75, 4320, "lin"], [16.25, 5000, "whip"], [17.75, 5416, "lin"], [18.25, 6000, "whip"],
    [19.55, 6380, "lin"], [20.9, 8091, "expr"]
  ];
  function altitude(t) {
    if (t <= ALT[0][0]) return 0;
    for (let i = 1; i < ALT.length; i++) {
      const [t1, a1, kind] = ALT[i], [t0, a0] = ALT[i - 1];
      if (t <= t1) {
        const p = inv(t0, t1, t);
        const e = kind === "whip" ? E.inOutExpo(p) : kind === "expr" ? EXPR(p) : p;
        return lerp(a0, a1, e);
      }
    }
    return 8091;
  }
  const TAPE_MARKS = [
    [0, "metal"], [1000, "compute"], [2000, "storage"], [3000, "network"], [4000, "kubernetes"],
    [5000, "tooling"], [5416, "thorong la"], [6000, "people"], [8091, "annapurna i"]
  ];

  // =================================================================
  // 00  boot: one dot, then the order every other dot is printed in
  // =================================================================

  function sBoot(t, P) {
    const cx = 480, cy = 262, pitch = 14, sq = 11;
    const pos = (i, j, s) => [cx + (i - 3.5) * pitch * s, cy + (j - 3.5) * pitch * s];
    if (t < 1.0) {
      if (!((t % 0.5) < 0.27 || t >= 0.75)) return;
      let x = cx, y = cy, w = 6, h = 12;
      if (t >= 0.75) {
        const p = SWIFT(inv(0.75, 1.0, t)), [tx, ty] = pos(0, 0, 1);
        x = lerp(cx, tx, p); y = lerp(cy, ty, p); w = lerp(6, sq, p); h = lerp(12, sq, p);
      }
      rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2, P.cell);
      return;
    }
    let s = 1;
    if (t > 1.8) s = lerp(1, 1.07, E.outCubic(inv(1.8, 1.9, t)));
    if (t > 1.9) s = lerp(1.07, 0, E.inExpo(inv(1.9, 2.0, t)));
    if (s <= 0.002) return;
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 8; i++) {
        const v = B8[j * 8 + i], ta = 1.0 + v * (0.75 / 64);
        const p = inv(ta, ta + 0.16, t);
        if (p <= 0) continue;
        const half = (sq * E.outBack(p, 2.2) * s) / 2, [x, y] = pos(i, j, s);
        rect(x - half, y - half, x + half, y + half, t - ta < 0.05 ? P.strong : P.cell);
        if (p > 0.55 && s > 0.99) txt(String(v), x + 0.25, y + 0.5, { size: 11, color: P.css.paper, align: "center", base: "middle" });
      }
    const ca = pulse(1.2, 1.45, 1.8, 1.88, t);
    txt("ordered dither · 8 × 8", cx, cy + 76, { size: 22, color: P.css.faint, align: "center", alpha: ca });
    txt("every dot in this film is printed in this order", cx, cy + 92, { size: 11, color: P.css.faint, align: "center", alpha: ca * 0.8 });
  }

  // =================================================================
  // 01  metal
  // =================================================================

  const DIE = { x0: 340, y0: 122, x1: 620, y1: 402 };
  const FAILK = 9;
  const REGS = ["rip", "rsp", "rbp", "cr3", "rflags", "cs", "efer", "tsc"];

  function sMetal(t, P, st) {
    // the flood: the collapsed matrix hits and the die prints outward from it
    const flood = inv(2.0, 2.42, t);
    const floodR = E.outCubic(flood) * 700;
    TALPHA = sstep(0.1, 0.7, flood);

    // left column stays put while the die pushes in, which is the depth
    resetCam(); TY = st.ty;
    const clkA = sstep(2.3, 2.6, t);
    if (clkA > 0) {
      const x0 = 70, x1 = 290, yHi = 176, yLo = 190, per = 30, ph = (t / 0.5) % 1;
      let prev = null;
      for (let x = x0; x <= x1; x++) {
        const u = ((x - x0) / per + ph) % 1, y = u < 0.5 ? yHi : yLo;
        if (prev !== null && prev !== y) for (let yy = yHi; yy <= yLo; yy++) pt(x, yy, P.cell, clkA);
        pt(x, y, P.cell, clkA);
        prev = y;
      }
      txt("clk", 70, 166, { size: 22, color: P.css.dim, alpha: clkA });
      txt("120 bpm · 2 hz", 290, 166, { size: 11, color: P.css.faint, align: "right", alpha: clkA });
      const tick = Math.floor(t * 8);
      for (let r = 0; r < REGS.length; r++) {
        const ra = sstep(2.35 + r * 0.06, 2.5 + r * 0.06, t);
        let v = "";
        for (let k = 0; k < 12; k++) v += "0123456789abcdef"[Math.floor(hu(r * 97 + k * 13 + (k > 7 ? tick * 31 : Math.floor(t * 1.5) * 7)) * 16)];
        txt(REGS[r].padEnd(7, " "), 70, 232 + r * 17, { size: 22, color: P.css.dim, alpha: ra });
        txt("0x" + v, 150, 232 + r * 17, { size: 22, color: P.css.faint, alpha: ra });
      }
    }

    TS = lerp(1, 1.1, E.inOutSine(inv(2.0, 6.2, t))); OX = 480; OY = 262;
    rect(DIE.x0, DIE.y0, DIE.x1, DIE.y1, P.cell, 0.045);
    box(DIE.x0, DIE.y0, DIE.x1, DIE.y1, P.cell);
    box(DIE.x0 + 6, DIE.y0 + 6, DIE.x1 - 6, DIE.y1 - 6, P.dim, 0.5, 2);
    const NP = 18, step = (DIE.x1 - DIE.x0) / (NP + 1);
    for (let k = 1; k <= NP; k++) {
      const o = k * step;
      rect(DIE.x0 + o - 1.5, DIE.y0 - 11, DIE.x0 + o + 1.5, DIE.y0 - 2, P.dim);
      rect(DIE.x0 + o - 1.5, DIE.y1 + 2, DIE.x0 + o + 1.5, DIE.y1 + 11, P.dim);
      rect(DIE.x0 - 11, DIE.y0 + o - 1.5, DIE.x0 - 2, DIE.y0 + o + 1.5, P.dim);
      rect(DIE.x1 + 2, DIE.y0 + o - 1.5, DIE.x1 + 11, DIE.y0 + o + 1.5, P.dim);
    }
    disc(DIE.x0 + 15, DIE.y0 + 15, 2.6, P.cell);

    // gutters and the signals running in them
    const sigA = sstep(2.55, 2.9, t);
    for (let g = 0; g < 3; g++) {
      const gx = 420 + g * 60, gy = 202 + g * 60;
      line(gx, DIE.y0 + 8, gx, DIE.y1 - 8, P.faint, 0.7, 1);
      line(DIE.x0 + 8, gy, DIE.x1 - 8, gy, P.faint, 0.7, 1);
      if (sigA <= 0) continue;
      for (let q = 0; q < 2; q++) {
        const L = DIE.y1 - DIE.y0 - 16;
        const sp = 150 + 60 * hu(g * 5 + q), ph = hu(g * 11 + q * 3) * L;
        const sv = ((t - 2.5) * sp + ph) % L, sh = (((t - 2.5) * sp * 1.1 + ph * 1.7) % L);
        for (let k = 0; k < 12; k++) {
          const d = sigA * (1 - k / 12);
          if (q === 0) pt(gx, DIE.y0 + 8 + ((sv - k + L) % L), P.strong, d);
          else pt(DIE.x1 - 8 - ((sh - k + L) % L), gy, P.strong, d);
        }
      }
    }

    for (let j = 0; j < 4; j++)
      for (let i = 0; i < 4; i++) {
        const k = j * 4 + i, tb = 2.5 + B4[k] * 0.125;
        const x0 = 364 + i * 60, y0 = 146 + j * 60, x1 = x0 + 52, y1 = y0 + 52;
        if (t < tb) { box(x0, y0, x1, y1, P.dim, 0.5); continue; }
        if (t - tb < 0.06) { rect(x0, y0, x1, y1, P.strong); continue; }
        drawCore(k, x0, y0, x1, y1, tb, P.cell, t, P);
        if (k === FAILK && t >= 4.5 && t < 5.3) {
          const scan = t < 5.0 ? y0 : lerp(y0, y1, SWIFT(inv(5.0, 5.25, t)));
          const blink = t < 5.0 ? (Math.floor((t - 4.5) * 8) % 2 === 0 ? 0.6 : 0.3) : 0.5;
          if (scan < y1) {
            rect(x0, scan, x1, y1, P.paper);
            rect(x0 + 1, scan, x1 - 1, y1 - 1, P.accent, blink);
            box(x0, Math.min(scan, y1 - 2), x1, y1, P.accent);
            // the x of a panic, printed not drawn
            for (let d = -10; d <= 10; d++) {
              const cy = (y0 + y1) / 2;
              if (cy + d >= scan) { pt((x0 + x1) / 2 + d, cy + d, P.accent); pt((x0 + x1) / 2 - d, cy + d, P.accent); }
            }
          }
          if (t >= 5.0) { line(x0 - 4, scan, x1 + 4, scan, P.strong); }
        }
      }

    // callout for the failure
    const fx1 = 424 + 52, fy = 266 + 26;
    const la = inv(4.5, 4.64, t) * (1 - sstep(5.75, 5.95, t));
    if (la > 0) {
      const col = t < 5.25 ? P.accent : P.dim;
      const reach = lerp(fx1, 648, E.outCubic(inv(4.5, 4.64, t)));
      line(fx1 + 1, fy, reach, fy, col, 1, t < 5.25 ? 0 : 2);
      pt(reach, fy, col); pt(reach, fy - 1, col); pt(reach, fy + 1, col);
      const ta = sstep(4.56, 4.62, t) * (1 - sstep(5.75, 5.95, t));
      if (t < 5.25) {
        txt("failed transition", 656, fy + 4, { size: 22, color: P.css.accent, alpha: ta * (Math.floor((t - 4.56) * 8) % 2 || t > 4.8 ? 1 : 0.55) });
        txt("vm exit · host lost mid-boot", 656, fy + 16, { size: 11, color: P.css.accent, alpha: ta * 0.8 });
      } else {
        txt("rescue boot · reconciled", 656, fy + 4, { size: 22, color: P.css.ink, alpha: ta });
        txt("state matches the database again", 656, fy + 16, { size: 11, color: P.css.faint, alpha: ta });
      }
    }

    // the flood mask: everything outside the expanding front is still paper
    if (flood < 1) {
      for (let y = 0; y < CH; y++)
        for (let x = 0; x < CW; x++) {
          const i = y * CW + x, dist = Math.hypot(x - 480, y - 262), v = (floodR - dist) / 70;
          if (v <= THR[i]) layer[i] = 0;
          else if (v - THR[i] < 0.09 && dist > 8) layer[i] = P.strong;
        }
    }
  }

  function drawCore(k, x0, y0, x1, y1, tb, col, t, P) {
    box(x0, y0, x1, y1, col);
    rectFn(x0 + 5, y0 + 5, x0 + 23, y0 + 23, col, (X, Y) => (((X - x0) | 0) % 3 === 0 || ((Y - y0) | 0) % 3 === 0 ? 0.9 : 0));
    for (let r = 0; r < 5; r++) rect(x0 + 5, y0 + 28 + r * 4, x0 + 23, y0 + 29 + r * 4, P.dim, 0.9);
    const act = 0.1 + 0.46 * Math.pow(vnoise(k * 3.1, t * 2.6), 1.6);
    rect(x0 + 27, y0 + 5, x1 - 5, y1 - 12, col, act);
    const led = Math.floor((t - tb) * 4 + k) % 2 === 0;
    if (led) rect(x1 - 9, y1 - 9, x1 - 5, y1 - 5, P.strong);
    rect(x0 + 27, y1 - 9, x0 + 27 + 14 * vnoise(k, t * 3), y1 - 7, P.dim);
  }

  // =================================================================
  // 02  compute
  // =================================================================

  function sCompute(t, P, st) {
    resetCam(); TY = st.ty;
    // counter
    let count = 1;
    (function countLeaves(n) { if (n.kids && t >= n.ts) { countLeaves(n.kids[0]); countLeaves(n.kids[1]); count++; } })(TREE);
    const shown = Math.min(380, count);
    txt(String(shown), 62, 232, { size: 88, color: P.css.strong });
    txt("active vms", 64, 256, { size: 22, color: P.css.dim });
    txt("when i left, aug 2026", 64, 272, { size: 11, color: P.css.faint });

    drawNode(TREE, TREE.x, TREE.y, TREE.w, TREE.h, t, P);
    drawMigration(t, P);
  }

  function drawNode(n, x, y, w, h, t, P) {
    if (n.kids && t >= n.ts) {
      const p = inv(n.ts, n.ts + 0.24, t), g = 2 * E.outBack(p, 3);
      const [a, b] = n.kids;
      if (n.axis === 0) {
        const cut = x + w * n.r;
        drawNode(a, x, y, cut - g / 2 - x, h, t, P);
        drawNode(b, cut + g / 2, y, x + w - cut - g / 2, h, t, P);
        if (t - n.ts < 0.05) line(cut, y - 2, cut, y + h + 2, P.strong);
      } else {
        const cut = y + h * n.r;
        drawNode(a, x, y, w, cut - g / 2 - y, t, P);
        drawNode(b, x, cut + g / 2, w, y + h - cut - g / 2, t, P);
        if (t - n.ts < 0.05) line(x - 2, cut, x + w + 2, cut, P.strong);
      }
      return;
    }
    drawLeaf(n, x, y, w, h, t, P);
  }

  function drawLeaf(n, x, y, w, h, t, P) {
    if (n === MIG_B && t >= 8.0) { if (t < 9.15) box(x, y, x + w, y + h, P.dim, 0.9, 2); return; }
    if (n === MIG_A && t >= 8.1) {
      if (t < 9.55) { box(x, y, x + w, y + h, P.dim, 0.9, 2); return; }
      const bp = inv(9.55, 9.85, t);
      box(x, y, x + w, y + h, P.cell, 0.9);
      rect(x + 1, y + 1, x + 1 + (w - 2) * E.outCubic(bp), y + h - 1, P.cell, bp < 1 ? 0.6 : 0.2);
      return;
    }
    box(x, y, x + w, y + h, P.cell, 0.92);
    const born = n.parent ? n.parent.ts : 5.5;
    const bp = inv(born, born + 0.35, t);
    // big boxes print sparse or they read as static; a finished vm is small
    const sparse = clamp(28 / Math.sqrt(Math.max(1, w * h)), 0.15, 1);
    const load = (0.05 + 0.34 * Math.pow(vnoise(n.id * 0.37, t * 1.3), 1.6)) * sparse;
    if (bp < 1) rect(x + 1, y + 1, x + 1 + (w - 2) * E.outCubic(bp), y + h - 1, P.cell, 0.58 * Math.max(0.3, sparse));
    else rect(x + 1, y + 1, x + w - 1, y + h - 1, P.cell, load);
    if (w > 16 && h > 12 && Math.floor(t * 4 + n.id * 0.37) % 3 === 0) rect(x + 3, y + 3, x + 5, y + 5, P.strong);
  }

  function leafRect(n, t) {
    // the settled rect of a leaf, with the gaps its ancestors opened
    const chain = [];
    for (let m = n; m.parent; m = m.parent) chain.unshift(m);
    let x = TREE.x, y = TREE.y, w = TREE.w, h = TREE.h, node = TREE;
    for (const kid of chain) {
      const g = 2, first = node.kids[0] === kid;
      if (node.axis === 0) {
        const cut = x + w * node.r;
        if (first) w = cut - g / 2 - x; else { const nx = cut + g / 2; w = x + w - nx; x = nx; }
      } else {
        const cut = y + h * node.r;
        if (first) h = cut - g / 2 - y; else { const ny = cut + g / 2; h = y + h - ny; y = ny; }
      }
      node = kid;
    }
    return { x, y, w, h };
  }

  function drawMigration(t, P) {
    if (t < 8.0) return;
    const A = leafRect(MIG_A, t), B = leafRect(MIG_B, t);
    const ca = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, cb = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    const ctrl = { x: (ca.x + cb.x) / 2 - 40, y: Math.min(ca.y, cb.y) - 150 };
    const bz = (u) => ({
      x: (1 - u) * (1 - u) * ca.x + 2 * (1 - u) * u * ctrl.x + u * u * cb.x,
      y: (1 - u) * (1 - u) * ca.y + 2 * (1 - u) * u * ctrl.y + u * u * cb.y
    });
    const p = SWIFT(inv(8.25, 9.15, t));
    const fadeTrail = 1 - sstep(9.3, 9.9, t);
    if (t >= 8.1 && fadeTrail > 0) {
      for (let k = 0; k <= 120; k++) {
        const u = k / 120;
        if (u > p) break;
        if (k % 2) continue;
        const q = bz(u);
        pt(q.x, q.y, P.accent, 0.85 * fadeTrail);
      }
      for (let c = 1; c <= 4; c++) {
        const u = c / 5, q = bz(u), lit = p >= u;
        const col = lit ? P.strong : P.accent;
        for (let d = -2; d <= 2; d++) { pt(q.x + d, q.y, col, fadeTrail); pt(q.x, q.y + d, col, fadeTrail); }
      }
    }
    if (t < 8.1) return;
    const lift = E.outCubic(inv(8.1, 8.25, t)) * (1 - E.outCubic(inv(9.05, 9.15, t)));
    const q = bz(p);
    const w = lerp(A.w, B.w, p), h = lerp(A.h, B.h, p);
    let sc = 1 + 0.45 * lift;
    if (t > 9.15) sc = 1 + 0.14 * (1 - E.outElastic(inv(9.15, 9.6, t)));
    const hw = (w * sc) / 2, hh = (h * sc) / 2, ox = -5 * lift, oy = -5 * lift;
    if (lift > 0.01) rect(q.x - hw + 6 * lift, q.y - hh + 6 * lift, q.x + hw + 6 * lift, q.y + hh + 6 * lift, P.dim, 0.4 * lift);
    const thaw = inv(9.3, 9.55, t);
    rect(q.x - hw + ox, q.y - hh + oy, q.x + hw + ox, q.y + hh + oy, P.paper);
    box(q.x - hw + ox, q.y - hh + oy, q.x + hw + ox, q.y + hh + oy, P.accent);
    rect(q.x - hw + 1 + ox, q.y - hh + 1 + oy, q.x + hw - 1 + ox, q.y + hh - 1 + oy, P.accent, 0.5);
    if (thaw > 0) {
      box(q.x - hw + ox, q.y - hh + oy, q.x + hw + ox, q.y + hh + oy, P.cell, thaw);
      rect(q.x - hw + 1 + ox, q.y - hh + 1 + oy, q.x + hw - 1 + ox, q.y + hh - 1 + oy, P.cell, thaw * 1.2);
      if (thaw >= 1) {
        rect(q.x - hw + 1, q.y - hh + 1, q.x + hw - 1, q.y + hh - 1, P.paper);
        rect(q.x - hw + 1, q.y - hh + 1, q.x + hw - 1, q.y + hh - 1, P.cell, 0.22);
      }
    }
    const la = sstep(8.1, 8.2, t) * (1 - sstep(9.75, 9.95, t));
    const ck = Math.min(4, Math.floor(p * 5 + 1e-6));
    const label = t < 9.15 ? `live migration · checkpoint ${ck}/4` : t < 9.3 ? "landed · thawing" : "thawed · idempotent";
    const right = q.x > 640;
    chip(label, (right ? q.x + hw : q.x - hw) + ox, q.y - hh + oy - 7, { size: 22, color: t < 9.3 ? P.css.accent : P.css.ink, bg: P.css.paper, align: right ? "right" : "left", alpha: la });
  }

  // =================================================================
  // 03  storage
  // =================================================================

  function sStorage(t, P, st) {
    resetCam(); TY = st.ty;
    const L = LANE.x1 - LANE.x0 + LANE.pitch, N = Math.ceil(L / LANE.pitch);
    const groups = [["bdev", 0], ["lvol", 3], ["raid", 6]];
    for (const [name, k0] of groups) {
      const ga = sstep(9.95 + k0 * 0.03, 10.2 + k0 * 0.03, t);
      line(140, laneY(k0) - 2, 140, laneY(k0 + 2) + LANE.bh + 2, P.faint, ga);
      line(140, laneY(k0) - 2, 144, laneY(k0) - 2, P.faint, ga);
      line(140, laneY(k0 + 2) + LANE.bh + 2, 144, laneY(k0 + 2) + LANE.bh + 2, P.faint, ga);
      txt(name, 130, laneY(k0 + 1) + 14, { size: 22, color: P.css.dim, align: "right", alpha: ga });
    }
    let lastFlash = -1;
    for (let k = 0; k < LANE.n; k++) {
      const y0 = laneY(k), sp = laneSpeed(k);
      const grow = EXPR(inv(9.85 + k * 0.035, 10.4 + k * 0.035, t));
      const xe = LANE.x0 + (LANE.x1 - LANE.x0) * grow;
      line(LANE.x0, y0 + LANE.bh + 3, xe, y0 + LANE.bh + 3, P.faint, 0.8, 1);
      for (let b = 0; b < N; b++) {
        const u = b * LANE.pitch + (t - 9.5) * sp, g = Math.floor(u / L);
        const x = LANE.x0 + (u - g * L) - LANE.pitch;
        if (x + LANE.bw < LANE.x0 || x > xe) continue;
        const id = h32(k * 7919 + b * 131 + g * 104729);
        const mismatch = id / 4294967296 < 0.16;
        const past = x + LANE.bw / 2 - LANE.xr;
        const xa = Math.max(x, LANE.x0), xb = Math.min(x + LANE.bw, xe);
        if (xb <= xa) continue;
        if (mismatch && past < 0) {
          box(xa, y0, xb, y0 + LANE.bh, P.accent);
          rect(xa + 1, y0 + 1, xb - 1, y0 + LANE.bh - 1, P.accent, 0.55);
        } else if (mismatch && past < 14) {
          rect(xa, y0, xb, y0 + LANE.bh, P.strong);
          lastFlash = Math.max(lastFlash, 1 - past / 14);
        } else {
          box(xa, y0, xb, y0 + LANE.bh, P.cell, 0.9);
          rect(xa + 1, y0 + 1, xb - 1, y0 + LANE.bh - 1, P.cell, 0.15 + 0.45 * ((id >>> 8) % 97) / 97);
          if (mismatch) { pt(xa + 3, y0 - 3, P.strong); pt(xa + 4, y0 - 2, P.strong); pt(xa + 5, y0 - 3, P.strong); pt(xa + 6, y0 - 4, P.strong); pt(xa + 7, y0 - 5, P.strong); }
        }
      }
    }
    const ra = sstep(10.0, 10.3, t);
    const flash = lastFlash > 0 ? P.strong : P.cell;
    line(LANE.xr, 92, LANE.xr, LANE.n * 38 + 104, flash, ra);
    for (let d = 0; d < 5; d++) line(LANE.xr - d, 86 - d, LANE.xr + d, 86 - d, P.cell, ra);
    txt("reconciler", LANE.xr, 76, { size: 22, color: P.css.ink, align: "center", alpha: ra });
    txt("live", LANE.xr - 10, 96, { size: 11, color: P.css.faint, align: "right", alpha: ra });
    txt("database", LANE.xr + 10, 96, { size: 11, color: P.css.faint, alpha: ra });
    let fixed = 0;
    for (const tc of LANES.fixed) if (tc <= t) fixed++;
    txt(`drift fixed  ${String(fixed).padStart(2, "0")}`, 850, 76, { size: 22, color: P.css.dim, align: "right", alpha: ra });
  }

  // =================================================================
  // 04  network
  // =================================================================

  const PROXY = { x: 250, y: 280 };
  const HOSTS = [];
  for (let k = 0; k < 15; k++) {
    const a = (k / 15) * TAU + (hu(k * 3 + 1) - 0.5) * 0.35, r = 72 + 118 * hu(k * 3 + 2);
    HOSTS.push({ x: PROXY.x + Math.cos(a) * r * 1.15, y: PROXY.y + Math.sin(a) * r * 0.82 });
  }
  const TARGET = 10;
  const RINGS = [12.05, 12.3, 12.55];
  const DNS = {
    root: { x: 720, y: 118, label: "." },
    com: { x: 625, y: 205, label: "com." },
    dev: { x: 730, y: 205, label: "dev." },
    net: { x: 830, y: 205, label: "net." },
    lol: { x: 625, y: 292, label: "lolwierd.com." },
    exc: { x: 730, y: 292, label: "excloud.dev." },
    res: { x: 830, y: 372, label: "resolver" }
  };
  const DNS_EDGES = [["root", "com", 12.3], ["root", "dev", 12.36], ["root", "net", 12.42], ["com", "lol", 12.5], ["dev", "exc", 12.56]];
  const HOPS = [["res", "root", 12.8], ["root", "com", 13.0], ["com", "lol", 13.2], ["lol", "res", 13.42]];

  function sNetwork(t, P, st) {
    resetCam(); TY = st.ty;
    const pa = sstep(11.85, 12.1, t);
    // arp side
    for (const te of RINGS) {
      const r = (t - te) * 380;
      if (r <= 0 || r > 250) continue;
      ring(PROXY.x, PROXY.y, r, 3, P.cell, 0.95 * Math.pow(1 - r / 250, 1.1));
    }
    HOSTS.forEach((h, k) => {
      const dist = Math.hypot(h.x - PROXY.x, h.y - PROXY.y);
      let lit = 0;
      for (const te of RINGS) { const r = (t - te) * 380; if (r > dist - 8 && r < dist + 20) lit = Math.max(lit, 1 - Math.abs(r - dist - 6) / 14); }
      const tgt = k === TARGET;
      const col = tgt ? P.accent : P.cell;
      const hit = tgt && t > 12.05 + dist / 380;
      box(h.x - 3, h.y - 3, h.x + 4, h.y + 4, tgt ? P.accent : P.dim, pa);
      if (lit > 0 || hit) rect(h.x - 2, h.y - 2, h.x + 3, h.y + 3, lit > 0.5 ? P.strong : col, hit ? 1 : lit);
      if (tgt) txt("10.0.0.7", h.x + 8, h.y + 5, { size: 11, color: P.css.accent, alpha: pa });
    });
    box(PROXY.x - 9, PROXY.y - 6, PROXY.x + 10, PROXY.y + 7, P.cell, pa);
    rect(PROXY.x - 6, PROXY.y - 3, PROXY.x + 7, PROXY.y + 4, P.cell, 0.5 * pa);
    txt("arp/ndp proxy", PROXY.x, PROXY.y + 22, { size: 22, color: P.css.dim, align: "center", alpha: pa });
    const qa = sstep(12.02, 12.08, t) * (1 - sstep(13.85, 14.0, t));
    txt("who-has 10.0.0.7? tell 10.0.0.1", 60, 92, { size: 22, color: P.css.ink, alpha: qa });
    // reply
    const h = HOSTS[TARGET];
    const rp = inv(12.72, 13.02, t);
    if (rp > 0 && rp < 1) {
      const e = SWIFT(rp), x = lerp(h.x, PROXY.x, e), y = lerp(h.y, PROXY.y, e);
      const e2 = SWIFT(inv(12.72, 13.02, t - 1 / 60));
      streak(x, y, x - lerp(h.x, PROXY.x, e2), y - lerp(h.y, PROXY.y, e2), P.strong, 18);
      rect(x - 1, y - 1, x + 2, y + 2, P.strong);
    }
    const reply = "10.0.0.7 is-at 52:54:00:3f:a1:07";
    const ra = inv(13.02, 13.3, t);
    txt(reply.slice(0, Math.floor(reply.length * ra)), 60, 108, { size: 22, color: P.css.accent, alpha: ra > 0 ? 1 - sstep(13.85, 14.0, t) : 0 });

    // dns side
    for (const [a, b, ts] of DNS_EDGES) {
      const p = EXPR(inv(ts, ts + 0.3, t));
      if (p <= 0) continue;
      const A = DNS[a], B = DNS[b];
      line(A.x, A.y, lerp(A.x, B.x, p), lerp(A.y, B.y, p), P.dim, 1, 0);
    }
    for (const key in DNS) {
      const n = DNS[key];
      const na = sstep(12.2, 12.4, t);
      if (key === "res") { box(n.x - 6, n.y - 5, n.x + 7, n.y + 6, P.cell, na); }
      else { ring(n.x, n.y, 4, 1.4, P.cell, na); if (key === "lol") disc(n.x, n.y, 2.5, P.cell, na); }
      txt(n.label, n.x + (key === "res" ? 0 : 9), n.y + (key === "res" ? 22 : 5), { size: 22, color: key === "lol" ? P.css.ink : P.css.dim, align: key === "res" ? "center" : "left", alpha: na });
    }
    for (const [a, b, ts] of HOPS) {
      const p = inv(ts, ts + 0.2, t);
      if (p <= 0 || p >= 1) continue;
      const A = DNS[a], B = DNS[b], e = SWIFT(p), e2 = SWIFT(inv(ts, ts + 0.2, t - 1 / 60));
      const x = lerp(A.x, B.x, e), y = lerp(A.y, B.y, e);
      streak(x, y, x - lerp(A.x, B.x, e2), y - lerp(A.y, B.y, e2), P.strong, 14);
      rect(x - 1, y - 1, x + 2, y + 2, P.strong);
    }
    const aa = sstep(13.62, 13.7, t);
    txt("lolwierd.com. 300 IN A  ✓", DNS.res.x, DNS.res.y + 40, { size: 22, color: P.css.ink, align: "center", alpha: aa });
    const qa2 = sstep(13.1, 13.4, t);
    txt("all i wanted was for one name to return one ip.", 480, 470, { size: 33, fam: SERIF, italic: true, color: P.css.dim, align: "center", alpha: qa2 });
  }

  // =================================================================
  // 05  kubernetes
  // =================================================================

  const POD_INIT = [3, 2, 4, 2, 3, 3, 2, 3, 0];
  const PODS = [];
  [0, 3, 5, 1, 6, 2, 7, 4, 0, 5, 3, 6].forEach((node, p) => PODS.push({ node, t: 14.3 + p * 0.125, fly: 0.36 }));
  const EVICT = { from: 2, to: 8, t: 15.0, fly: 0.6 };
  PODS.push({ node: 8, t: 15.62, fly: 0.3 }, { node: 8, t: 15.74, fly: 0.3 });
  const K8 = { cx: 480, cy: 300, rx: 330, ry: 104 };

  function k8sNodes(t) {
    const rot = 0.35 + (t - 14) * 0.55;
    const wNew = clamp(E.outBack(inv(15.3, 15.7, t), 1.6), 0, 1.3);
    const w = [1, 1, 1, 1, 1, 1, 1, 1, wNew];
    const total = w.reduce((a, b) => a + b, 0);
    let cum = 0;
    return w.map((wk, k) => {
      const th = rot + (TAU * (cum + wk / 2)) / total;
      cum += wk;
      const z = Math.sin(th);
      const s = (0.68 + 0.42 * (z + 1) / 2) * (k === 8 ? clamp(wNew, 0, 1.15) : 1);
      return { k, x: K8.cx + K8.rx * Math.cos(th), y: K8.cy + K8.ry * z, z, s, d: 0.45 + 0.55 * (z + 1) / 2 };
    });
  }
  function podCount(k, t) {
    let n = POD_INIT[k];
    for (const p of PODS) if (p.node === k && t >= p.t + p.fly) n++;
    if (k === EVICT.from && t >= EVICT.t) n--;
    if (k === EVICT.to && t >= EVICT.t + EVICT.fly) n++;
    return n;
  }
  function podSlot(node, i) {
    const col = i % 4, row = (i / 4) | 0;
    return { x: node.x + (-18 + col * 12) * node.s, y: node.y + (-5 + row * 11) * node.s };
  }
  const quad = (a, c, b, e) => ({
    x: (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * c.x + e * e * b.x,
    y: (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * c.y + e * e * b.y
  });

  function sK8s(t, P, st) {
    resetCam(); TY = st.ty;
    const { cx, cy } = K8;
    const na = sstep(13.9, 14.2, t);
    // the orbit, brighter on the near side
    for (let k = 0; k < 360; k += 2) {
      const a = (k / 360) * TAU, z = Math.sin(a);
      pt(cx + K8.rx * Math.cos(a), cy + K8.ry * z, z > 0 ? P.dim : P.faint, na * (z > 0 ? 0.95 : 0.55));
    }
    const nodes = k8sNodes(t).sort((a, b) => a.z - b.z);
    // spokes from the control plane: they turn with the ring, which is the depth
    for (const n of nodes) if (n.s > 0.1) line(cx, cy, n.x, n.y, n.z > 0 ? P.dim : P.faint, na * 0.8 * n.d, 2);
    const drawNodeBox = (n) => {
      if (n.s < 0.05) return;
      const hw = 30 * n.s, hh = 20 * n.s;
      rect(n.x - hw, n.y - hh, n.x + hw, n.y + hh, P.paper);
      box(n.x - hw, n.y - hh, n.x + hw, n.y + hh, P.cell, n.d * na);
      rect(n.x - hw, n.y - hh, n.x + hw, n.y - hh + 5 * n.s, P.cell, 0.55 * n.d * na);
      const cnt = podCount(n.k, t);
      for (let i = 0; i < cnt && i < 8; i++) {
        const s = podSlot(n, i), q = 3.4 * n.s;
        const fresh = n.k === EVICT.to && i === 0 && t < EVICT.t + EVICT.fly + 0.2;
        rect(s.x - q, s.y - q, s.x + q, s.y + q, fresh ? P.accent : P.cell, n.d * na);
      }
    };
    for (const n of nodes) if (n.z < 0) drawNodeBox(n);
    for (let p = 0; p < 3; p++) {
      const y = cy - 20 + p * 14, beat = 1 - inv(0, 0.18, (t + p * 0.08) % 0.5);
      rect(cx - 40, y, cx + 40, y + 10, P.paper);
      box(cx - 40, y, cx + 40, y + 10, P.cell, na);
      rect(cx - 39, y + 1, cx + 39, y + 9, P.cell, (0.2 + 0.45 * beat) * na);
    }
    txt("control plane", cx, cy - 30, { size: 22, color: P.css.ink, align: "center", alpha: na });
    txt("etcd · api · scheduler", cx, cy + 44, { size: 11, color: P.css.faint, align: "center", alpha: na });
    for (const n of nodes) if (n.z >= 0) drawNodeBox(n);

    const byK = {};
    for (const n of nodes) byK[n.k] = n;
    for (const p of PODS) {
      const u = inv(p.t, p.t + p.fly, t);
      if (u <= 0 || u >= 1) continue;
      const tgt = podSlot(byK[p.node], Math.max(0, podCount(p.node, p.t + p.fly) - 1));
      const s0 = { x: cx, y: cy - 8 }, ctrl = { x: (s0.x + tgt.x) / 2, y: Math.min(s0.y, tgt.y) - 80 };
      const q = quad(s0, ctrl, tgt, EXPR(u)), q2 = quad(s0, ctrl, tgt, EXPR(inv(p.t, p.t + p.fly, t - 1 / 60)));
      streak(q.x, q.y, q.x - q2.x, q.y - q2.y, P.strong, 12);
      rect(q.x - 3, q.y - 3, q.x + 3, q.y + 3, P.strong);
    }
    // an eviction, and the node karpenter brings up to take it
    const ev = k8sNodes(EVICT.t).find((n) => n.k === EVICT.from);
    const el = pulse(14.98, 15.04, 15.5, 15.62, t);
    if (el > 0) chip("evicted", ev.x, ev.y - 20 * ev.s - 10, { size: 22, color: P.css.accent, bg: P.css.paper, align: "center", alpha: el });
    const eu = inv(EVICT.t, EVICT.t + EVICT.fly, t);
    if (eu > 0 && eu < 1) {
      const from = podSlot(byK[EVICT.from], podCount(EVICT.from, EVICT.t - 0.01) - 1);
      const to = podSlot(byK[EVICT.to], 0);
      const ctrl = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 130 };
      for (let k = 1; k < 22; k++) {
        const q2 = quad(from, ctrl, to, SWIFT(inv(EVICT.t, EVICT.t + EVICT.fly, t - k / 120)));
        pt(q2.x, q2.y, P.accent, 1 - k / 22);
      }
      const q = quad(from, ctrl, to, SWIFT(eu));
      rect(q.x - 4, q.y - 4, q.x + 4, q.y + 4, P.accent);
    }
    const nn = byK[8];
    const ka = pulse(15.5, 15.62, 16.0, 16.12, t);
    if (nn.s > 0.1) chip("karpenter · +1 node", nn.x, nn.y + 20 * nn.s + 26, { size: 22, color: P.css.ink, bg: P.css.paper, align: "center", alpha: ka });
  }

  // =================================================================
  // 06  tooling
  // =================================================================

  const SPEC = [
    "openapi: 3.1.0", "info:", "  title: compute", "  version: v1", "paths:",
    "  /v1/instances:", "    post:", "      operationId: createInstance",
    "      requestBody:", "        $ref: '#/components/schemas/Instance'",
    "  /v1/instances/{id}/rescue:", "    post:", "      operationId: rescueInstance",
    "  /v1/volumes/{id}/attach:", "    post:", "      operationId: attachVolume",
    "  /v1/subnets:", "    get:", "      operationId: listSubnets",
    "  /v1/buckets/{name}/uploads:", "    post:", "      operationId: createMultipartUpload",
    "components:", "  schemas:", "    Instance:", "      type: object",
    "      required: [id, state, image]", "      properties:", "        state:",
    "          enum: [pending, running, rescue]", "  securitySchemes:", "    sigv4: { type: apiKey }"
  ];
  const ROWS = [
    { label: (n) => `sdk · ${n} services`, count: 8, hollow: 0, y: 138 },
    { label: (n) => `cli · ${n} command groups`, count: 20, hollow: 0, y: 228 },
    { label: (n, m) => `terraform · ${n} resources · ${m} data sources`, count: 30, hollow: 13, y: 318 }
  ];
  const BOXES = [];
  ROWS.forEach((r, ri) => {
    const total = r.count + r.hollow;
    for (let j = 0; j < total; j++) {
      const line = ri === 2 ? (j >= 22 ? 1 : 0) : 0, col = ri === 2 ? j % 22 : j;
      BOXES.push({ r: ri, j, hollow: j >= r.count, x: 556 + col * 13, y: r.y + line * 14, tf: 16.35 + 1.3 * (j / total) + ri * 0.06 });
    }
  });
  const FLOW = [];
  BOXES.forEach((b, i) => {
    for (let k = 0; k < 4; k++) FLOW.push({ b, born: b.tf - 0.55 + k * 0.035 - 0.105, y0: 120 + hu(i * 17 + k) * 300, lead: k === 3 });
  });
  for (let i = 0; i < 220; i++) FLOW.push({ b: null, born: 15.95 + hu(i * 5 + 900) * 1.9, y0: 120 + hu(i * 5 + 901) * 300, yo: 110 + hu(i * 5 + 902) * 320 });

  function sTooling(t, P, st) {
    resetCam(); TY = st.ty;
    const ba = sstep(15.9, 16.2, t);
    box(56, 104, 330, 436, P.dim, ba);
    for (const [x, y] of [[56, 104], [330, 104], [56, 436], [330, 436]]) { rect(x - 2, y - 2, x + 2, y + 2, P.cell, ba); }
    txt("openapi 3.1 · 8 services", 56, 94, { size: 22, color: P.css.dim, alpha: ba });
    // the spec scrolling past
    OC.save();
    OC.beginPath(); OC.rect(58 * C, wy(106) * C, 270 * C, 328 * C); OC.clip();
    const scroll = (t - 15.8) * 170, lh = 30;
    for (let k = -1; k < 26; k++) {
      const idx = Math.floor(scroll / lh) + k, line = SPEC[((idx % SPEC.length) + SPEC.length) % SPEC.length];
      const y = 106 * C + 28 + k * lh - (scroll % lh);
      const hot = line.includes("operationId");
      OC.save(); OC.translate(0, wy(0) * C);
      txt(line, 66 * C, y, { screen: true, ghost: true, size: 22, color: hot ? P.css.ink : P.css.faint, alpha: ba });
      OC.restore();
    }
    OC.restore();
    // the generator
    rect(474, 104, 486, 436, P.cell, 0.12 * ba);
    line(480, 104, 480, 436, P.strong, ba);
    txt("codegen", 480, 94, { size: 22, color: P.css.ink, align: "center", alpha: ba });
    txt("reflection → openapi → clients", 480, 452, { size: 11, color: P.css.faint, align: "center", alpha: ba });
    // particles
    for (const f of FLOW) {
      const u = inv(f.born, f.born + 0.55, t);
      if (u <= 0 || u >= 1) continue;
      let x, y;
      const ty = f.b ? f.b.y + 4 : f.yo, tx = f.b ? f.b.x + 4 : 520 + 40 * hu(f.y0);
      const yp = lerp(f.y0, ty, 0.5);
      if (u < 0.5) { const e = E.inQuad(u / 0.5); x = lerp(332, 480, e); y = lerp(f.y0, yp, e); }
      else { const e = E.outCubic((u - 0.5) / 0.5); x = lerp(480, tx, e); y = lerp(yp, ty, e); }
      const a = f.b ? 1 : 1 - inv(0.5, 1, u);
      rect(x - 1, y, x + 1, y + 1, f.lead ? P.strong : P.cell, a);
      pt(x - 3, y, P.cell, a * 0.5);
    }
    // outputs
    const counts = [0, 0, 0, 0];
    for (const b of BOXES) {
      const on = t >= b.tf;
      if (on) { if (b.r === 2 && b.hollow) counts[3]++; else counts[b.r]++; }
      if (!on) { box(b.x, b.y, b.x + 10, b.y + 10, P.faint, 0.5 * ba, 1); continue; }
      if (t - b.tf < 0.06) { rect(b.x - 1, b.y - 1, b.x + 11, b.y + 11, P.strong); continue; }
      box(b.x, b.y, b.x + 10, b.y + 10, P.cell);
      if (!b.hollow) rect(b.x + 2, b.y + 2, b.x + 8, b.y + 8, P.cell, 0.85);
    }
    ROWS.forEach((r, ri) => {
      const s = ri === 2 ? r.label(counts[2], counts[3]) : r.label(counts[ri]);
      txt(s, 556, r.y - 8, { size: 22, color: counts[ri] ? P.css.ink : P.css.faint, alpha: ba });
    });
  }

  // =================================================================
  // 07  people
  // =================================================================

  function numeralPoint(i, t) {
    const sx = hu(i * 5 + 1) * 1100 - 70, sy = hu(i * 5 + 2) * 760 - 110;
    const tx = NUM[i * 2], ty = NUM[i * 2 + 1];
    const s = 17.95 + 0.38 * Math.pow(hu(i * 5 + 3), 1.3);
    const p = EXPR(inv(s, s + 0.62, t));
    const dx = tx - sx, dy = ty - sy, len = Math.hypot(dx, dy) || 1;
    const sw = Math.sin(Math.PI * p) * 70 * (hu(i * 5 + 4) - 0.5);
    let x = lerp(sx, tx, p) - (dy / len) * sw, y = lerp(sy, ty, p) + (dx / len) * sw;
    const settle = sstep(0.9, 1, p);
    x += (vnoise(i * 0.13, t * 2.2) - 0.5) * 1.4 * settle;
    y += (vnoise(i * 0.13 + 50, t * 2.2) - 0.5) * 1.4 * settle;
    return [x, y, p];
  }

  const STATS = [
    { v: "380", l: "active vms", t: 18.55, x: 230 },
    { v: "140", l: "managed postgres clusters", t: 18.8, x: 480 },
    { v: "20+", l: "internal services", t: 19.05, x: 730 }
  ];

  function sPeople(t, P, st) {
    resetCam(); TY = st.ty;
    if (t < 19.5) {
      for (let i = 0; i < 4000; i++) {
        const [x, y, p] = numeralPoint(i, t);
        const [x2, y2] = numeralPoint(i, t - 1 / 60);
        const col = hu(i * 5 + 9) < 0.1 ? P.strong : P.cell;
        if (p < 0.98) streak(x, y, x - x2, y - y2, col, 10);
        else pt(x, y, col);
      }
    }
    const la = sstep(18.1, 18.35, t);
    txt("when i left, aug 2026", 480, 118, { size: 22, color: P.css.faint, align: "center", alpha: la });
    txt("accounts", 480, 310, { size: 22, color: P.css.dim, align: "center", alpha: sstep(18.45, 18.65, t) * (1 - sstep(19.45, 19.6, t)) });
    for (const s of STATS) {
      const a = sstep(s.t - 0.02, s.t + 0.04, t);
      if (a <= 0) continue;
      let v = "";
      for (let j = 0; j < s.v.length; j++) {
        const settle = s.t + 0.14 + j * 0.07;
        const ch = s.v[j];
        v += t >= settle || !/[0-9]/.test(ch) ? ch : String(Math.floor(hu(j * 31 + Math.floor(t * 40) * 7 + s.x) * 10));
      }
      const pop = 1 + 0.25 * (1 - E.outCubic(inv(s.t, s.t + 0.18, t)));
      const yo = (1 - E.outBack(inv(s.t, s.t + 0.2, t), 2)) * 12;
      txt(v, s.x, 408 + yo, { size: Math.round(44 * pop / 11) * 11, color: P.css.strong, align: "center", alpha: a });
      txt(s.l, s.x, 432 + yo, { size: 22, color: P.css.dim, align: "center", alpha: a });
    }
    for (let k = 0; k < 2; k++) {
      const a = sstep(19.05 + k * 0.1, 19.2 + k * 0.1, t);
      const x = 355 + k * 250;
      line(x, 386, x, 438, P.faint, a);
    }
  }

  // =================================================================
  // 08  summit
  // =================================================================

  const ICOC = (y) => (y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2);
  const RIDGE_T0 = 22.0, RIDGE_DUR = 0.58;
  const headX = (t) => E.inOutCubic(inv(RIDGE_T0, RIDGE_T0 + RIDGE_DUR, t)) * CW;
  const passT = (x) => RIDGE_T0 + RIDGE_DUR * ICOC(clamp(x / CW));
  const SUN_X = 770;
  function sunY(t) {
    const y = lerp(ridgeAt(SUN_X) + 40, 172, E.outCubic(inv(24.9, 27.4, t)));
    return t > 27.4 ? y - (t - 27.4) * 1.6 : y;
  }
  const DAY_T0 = 25.35, DAY_T1 = 26.95;
  const dayR = (t) => E.inOutCubic(inv(DAY_T0, DAY_T1, t)) * 1150;

  function starPoint(i, t) {
    const [nx, ny] = numeralPoint(i, 19.5);
    const d = 0.22 * hu(i * 7 + 6);
    const p = EXPR(inv(19.5 + d, 20.75 + d, t));
    const sx = STAR[i * 2], sy = STAR[i * 2 + 1];
    const dx = sx - nx, dy = sy - ny, len = Math.hypot(dx, dy) || 1;
    const sw = Math.sin(Math.PI * p) * 90 * (hu(i * 7 + 8) - 0.5);
    return [lerp(nx, sx, p) - (dy / len) * sw, lerp(ny, sy, p) + (dx / len) * sw, p];
  }

  function sSummit(t, P) {
    resetCam();
    const night = P === NIGHT;
    buf = FB;

    // ---- sky -------------------------------------------------------
    if (night) {
      for (let i = 0; i < 4000; i++) {
        const [x, y, p] = starPoint(i, t);
        if (p <= 0) continue;
        const cls = hu(i * 7 + 3);
        const bright = cls < 0.045 ? 1 : cls < 0.17 ? 0.55 : cls < 0.4 ? 0.2 : 0;
        if (p < 0.999) {
          const [x2, y2] = starPoint(i, t - 1 / 60);
          const land = sstep(0.8, 1, p);
          const a = lerp(1, bright, land);
          if (a <= 0.01) continue;
          streak(x, y, x - x2, y - y2, P.tone("cell", a), 26, 1);
          continue;
        }
        if (bright <= 0) continue;
        if (y >= ridgeAt(x) - 1 && t > passT(x)) continue;
        const tw = 0.62 + 0.38 * Math.sin(t * (2.5 + 5 * hu(i * 7 + 4)) + hu(i * 7 + 5) * TAU);
        const b = bright * tw;
        const X = Math.floor(x), Y = Math.floor(y);
        pS(X, Y, P.tone("cell", b));
        if (bright === 1) {
          const g = Math.sin(t * 1.3 + i) > 0.93 ? 0.5 : 0;
          if (g) { pS(X + 1, Y, P.tone("cell", g * b)); pS(X - 1, Y, P.tone("cell", g * b)); pS(X, Y + 1, P.tone("cell", g * b)); pS(X, Y - 1, P.tone("cell", g * b)); }
        }
      }
      // a comet, quick and above the ridge
      const cu = inv(21.15, 21.72, t);
      if (cu > 0 && cu < 1) {
        const e = E.outQuad(cu), x = lerp(900, 360, e), y = lerp(36, 150, e);
        const vx = -540, vy = 114, len = Math.hypot(vx, vy);
        const tail = 70 * (1 - Math.pow(cu, 3)) + 10;
        for (let k = 0; k < tail; k++) {
          const d = (1 - k / tail) * (1 - cu * 0.6);
          pt(x - (vx / len) * k, y - (vy / len) * k, P.strong, d);
          if (k < tail * 0.4) pt(x - (vx / len) * k, y - (vy / len) * k + 1, P.cell, d * 0.5);
        }
        rect(x - 1, y - 1, x + 1, y + 1, P.strong);
      }
      // a satellite, easy to miss
      const su = inv(23.2, 26.0, t);
      if (su > 0 && su < 1) pt(lerp(120, 520, su), lerp(40, 22, su), P.tone("cell", 0.5 * pulse(0, 0.1, 0.8, 1, su)));
    } else {
      // paper texture and the afterglow that follows the sun
      for (let y = 0; y < 330; y++)
        for (let x = 0; x < CW; x++) {
          if (y >= RIDGEI[x]) continue;
          if (h2(x, y, 5) < 0.006) pS(x, y, P.tone("cell", 0.16));
        }
      drawClouds(t, P);
    }
    // dawn glow (both themes; stronger before the light arrives)
    const glowA = night ? sstep(24.3, 25.6, t) * 0.34 : 0.08;
    if (glowA > 0) {
      const sy = sunY(t);
      for (let x = Math.max(0, SUN_X - 420); x < Math.min(CW, SUN_X + 420); x++) {
        const top = Math.floor(RIDGE[x] - 140);
        for (let y = Math.max(0, top); y < RIDGEI[x]; y++) {
          const d = glowA * Math.exp(-Math.pow((x - SUN_X) / 200, 2)) * Math.exp(-(RIDGE[x] - y) / 46) * (0.6 + 0.4 * sstep(sy + 60, sy - 60, y + 60));
          pS(x, y, P.accent, d);
        }
      }
    }
    // the sun comes up behind the ridge
    if (t > 24.9) drawSun(t, P);

    // ---- the range ------------------------------------------------
    if (t >= RIDGE_T0) drawRange(t, P, night);

    // ---- type ----------------------------------------------------------
    drawHero(t, P);
  }

  function drawSun(t, P) {
    const cx = SUN_X, cy = sunY(t), Rr = 24;
    const occl = (x, y) => y >= RIDGE[clamp(x, 0, CW - 1)];
    for (let y = Math.floor(cy - Rr * 2.3); y <= Math.ceil(cy + Rr * 2.3); y++)
      for (let x = Math.floor(cx - Rr * 2.3); x <= Math.ceil(cx + Rr * 2.3); x++) {
        if (x < 0 || y < 0 || x >= CW || y >= CH || occl(x, y)) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        let v = 0;
        if (d < Rr - 2) v = 1;
        else if (d < Rr + 1.5) v = 1 - (d - (Rr - 2)) / 3.5 * 0.55;
        else if (d < Rr * 2.2) v = 0.26 * Math.pow(1 - (d - Rr) / (Rr * 1.2), 2) * (0.75 + 0.25 * vnoise(x * 0.3 + t * 0.7, y * 0.3));
        if (v > 0) pS(x, y, P.accent, v);
      }
    for (let i = 0; i < 90; i++) {
      const cyc = 1.6 + 2.6 * hu(i + 300), ph = (t / cyc + hu(i + 400)) % 1;
      const a = hu(i + 500) * TAU + Math.sin(t * 0.7 + i) * 0.02;
      const r = Rr + 1 + E.outCubic(ph) * (4 + 3 * hu(i + 600));
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (occl(Math.round(x), y)) continue;
      pS(Math.floor(x), Math.floor(y), P.accent, 1 - ph * 0.9);
    }
  }

  function drawClouds(t, P) {
    const clouds = [
      { cx: 575 + (t - 25) * 5, cy: 238, rx: 110, ry: 17, seed: 3, heavy: 0.5, d: 0.46 },
      { cx: 640 + (t - 25) * 10, cy: 72, rx: 200, ry: 7, seed: 7, heavy: -0.4, d: 0.34 }
    ];
    for (const c of clouds) {
      const x0 = Math.max(0, Math.floor(c.cx - c.rx)), x1 = Math.min(CW, Math.ceil(c.cx + c.rx));
      const y0 = Math.max(0, Math.floor(c.cy - c.ry * 1.6)), y1 = Math.min(CH, Math.ceil(c.cy + c.ry * 1.1));
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          if (y >= RIDGEI[x]) continue;
          const dx = (x - c.cx) / c.rx, dy = (y - c.cy) / (c.ry * 1.6);
          let e = 1 - (dx * dx + dy * dy);
          if (e <= 0) continue;
          e *= 1 + c.heavy * dx;
          const n = fbm((x - c.cx) * 0.03 + c.seed, y * 0.08 + t * 0.05, 4);
          let d = clamp(e * 1.3 + (n - 0.55) * 1.6) * c.d;
          if (dy > 0.25) d *= 1 - inv(0.25, 0.6, dy);
          pS(x, y, P.rampFull[2], d);
        }
    }
  }

  function drawRange(t, P, night) {
    const tiers = night ? TIERS_N : TIERS_D, ramp = P.ramp;
    const hx = headX(t);
    for (let x = 0; x < CW; x++) {
      const tp = passT(x);
      if (t < tp) continue;
      const age = t - tp - 0.03;
      if (age <= 0) continue;
      const front = age * 280, r = RIDGE[x];
      const yEnd = Math.min(CH, Math.ceil(r + front + 4));
      for (let y = RIDGEI[x]; y < yEnd; y++) {
        const i = y * CW + x, tier = tiers[i];
        const v = (front - (y - r)) / 46;
        if (v <= THR[i]) continue;
        if (tier >= 3) continue;
        buf[i] = v - THR[i] < 0.22 && front - (y - r) < 60 ? P.strong : ramp[tier];
      }
    }
    // the trace of the skyline, drawn before anything under it
    const lineA = 1 - sstep(23.0, 23.8, t);
    if (lineA > 0) {
      let prev = null;
      for (let x = 0; x < Math.min(CW, hx); x++) {
        const y = Math.round(RIDGE[x]);
        if (prev !== null) for (let yy = Math.min(prev, y); yy <= Math.max(prev, y); yy++) pS(x, yy, P.strong, lineA);
        else pS(x, y, P.strong, lineA);
        prev = y;
      }
    }
    if (hx > 0 && hx < CW) {
      const y = RIDGE[Math.floor(hx)];
      rect(hx - 2, y - 2, hx + 2, y + 2, P.accent);
      for (let k = 3; k < 16; k++) pt(hx, y - k, P.accent, 1 - k / 16);
    }
    // the living boundary: a few loose dots just outside the edge
    const la = sstep(22.7, 23.4, t);
    if (la > 0)
      for (let x = 0; x < CW; x++) {
        for (let k = 1; k <= 3; k++) {
          const n = vnoise(x * 0.23 + t * 0.9, k * 3.7 + t * 0.55);
          if (n > 0.74 + k * 0.035) {
            const lift = vnoise(x * 0.5, t * 2) > 0.8 ? 1 : 0;
            pS(x, RIDGEI[x] - k - lift, night ? P.ramp[0] : P.cell, la * 0.85);
          }
        }
      }
  }

  function drawHero(t, P) {
    const X = 96;
    // headline, printed in
    const lines = [["i build systems", 238, 22.42], ["from the machine up.", 330, 22.82]];
    for (const [s, base, t0] of lines) {
      if (t < t0) continue;
      OC.font = `92px ${SERIF}`; OC.letterSpacing = "-2px";
      const w = OC.measureText(s).width;
      const p = (t - t0) / 0.75;
      printIn(() => txt(s, X, base, { screen: true, size: 92, fam: SERIF, color: P.css.strong, ls: -2 }),
        X - 10, base - 80, w + 40, 110,
        (cx, cy) => (p * (w / C + 120) - (cx - X / C)) / 60);
    }
    // the site header arrives as the production marks leave
    const hp = (t - 24.05) / 0.5;
    if (hp > 0) {
      const name = "ayaan retiwala", role = " · platform engineer";
      const nav = "work    projects    writing    resume    contact";
      printIn(() => {
        txt(name, 64, 72, { screen: true, size: 22, color: P.css.ink });
        txt(role, 64 + tw(name, 22), 72, { screen: true, size: 22, color: P.css.faint });
        txt(nav, 1856, 72, { screen: true, size: 22, color: P.css.dim, align: "right" });
      }, 40, 40, 1840, 44, (cx) => hp * 1.4 - Math.abs(cx - 480) / 480 + 0.2);
    }
    // the address, typed
    const url = "lolwierd.com";
    const up = inv(27.05, 27.6, t);
    if (up > 0) {
      const n = Math.floor(up * url.length + 1e-6);
      const s = url.slice(0, n);
      txt(s, X, 416, { screen: true, size: 44, color: P.css.accent });
      const w = tw(s, 44);
      if (n > 0) { OC.fillStyle = P.css.accent; OC.globalAlpha = 0.6; OC.fillRect(X, 426, w, 2); OC.globalAlpha = 1; }
      const blink = t < 27.6 || t > 29.72 || (t - 27.6) % 0.5 < 0.27;
      if (blink) { OC.fillStyle = P.css.ink; OC.fillRect(Math.round(X + w + 6), 384, 22, 40); }
    }
    const ca = sstep(27.4, 28.0, t);
    const credit = P === DAY ? P.css.paper : P.css.faint;
    txt("photograph: alexis rodriguez at annapurna i, via unsplash", 1856, 1044, { screen: true, size: 11, color: credit, align: "right", alpha: ca * 0.75 });
    txt("reel · 2026", 64, 1044, { screen: true, size: 11, color: credit, alpha: ca * 0.75 });
  }

  // =================================================================
  // chrome: the production marks around the sheet
  // =================================================================

  function currentSection(t) {
    let s = SECTIONS[1];
    for (const S of SECTIONS) if (t >= S.t0 && S.n) s = S;
    return s;
  }

  function chrome(t, P) {
    const a = sstep(2.0, 2.35, t) * (1 - sstep(23.7, 24.15, t));
    if (a <= 0) return;
    const saved = TALPHA; TALPHA = a;
    OC.globalAlpha = a;
    OC.strokeStyle = P.css.faint; OC.lineWidth = 1;
    OC.beginPath();
    for (const [x, y, sx, sy] of [[40, 40, -1, -1], [1880, 40, 1, -1], [40, 1040, -1, 1], [1880, 1040, 1, 1]]) {
      OC.moveTo(x + sx * 8 + 0.5, y + 0.5); OC.lineTo(x + sx * 26 + 0.5, y + 0.5);
      OC.moveTo(x + 0.5, y + sy * 8 + 0.5); OC.lineTo(x + 0.5, y + sy * 26 + 0.5);
    }
    OC.stroke();
    // registration target, top centre
    OC.beginPath(); OC.arc(960.5, 26.5, 7, 0, TAU); OC.moveTo(948.5, 26.5); OC.lineTo(972.5, 26.5); OC.moveTo(960.5, 14.5); OC.lineTo(960.5, 38.5); OC.stroke();
    OC.globalAlpha = 1;

    // section label, rolling through a whip
    const drawLabel = (S, dy, al) => {
      txt(S.n, 64, 84 + dy, { screen: true, size: 22, color: P.css.faint, alpha: al });
      txt(S.name, 108, 84 + dy, { screen: true, size: 22, color: P.css.ink, alpha: al });
      txt(S.slug, 64, 1024 + dy, { screen: true, size: 22, color: P.css.faint, alpha: al });
    };
    let rolled = false;
    for (let k = 0; k < WHIPS.length; k++) {
      const T = WHIPS[k];
      if (t > T - HW && t < T + HW) {
        const p = whipP(T, t), prev = SECTIONS.find((S) => S.t1 === T), next = SECTIONS.find((S) => S.t0 === T);
        drawLabel(prev, p * 26, 1 - p);
        drawLabel(next, -(1 - p) * 26, p);
        rolled = true;
      }
    }
    if (!rolled) drawLabel(currentSection(t), 0, 1);

    const tc = Math.min(t, DUR - 1 / FPS);
    const ff = Math.floor((tc % 1) * FPS + 1e-6), ss = Math.floor(tc);
    txt(`reel · 2026    00:${String(ss).padStart(2, "0")}:${String(ff).padStart(2, "0")}`, 1856, 84, { screen: true, size: 22, color: P.css.faint, align: "right" });
    txt("22.3072°n 73.1812°e", 1856, 1024, { screen: true, size: 22, color: P.css.faint, align: "right" });

    // the altimeter tape
    const alt = altitude(t), X = 1848, CY = 540, K = 0.34;
    OC.fillStyle = P.css.faint;
    for (let m = Math.floor((alt - 1250) / 100) * 100; m <= alt + 1250; m += 100) {
      if (m < 0) continue;
      const y = Math.round(CY - (m - alt) * K);
      const f = 1 - Math.pow(Math.abs(y - CY) / 380, 2);
      if (f <= 0) continue;
      const len = m % 1000 === 0 ? 16 : m % 500 === 0 ? 10 : 5;
      OC.globalAlpha = a * f * 0.9;
      OC.fillRect(X - len, y, len, 1);
      if (m % 1000 === 0 && Math.abs(y - CY) > 16) txt(String(m), X - 22, y + 4, { screen: true, size: 11, color: P.css.faint, align: "right", alpha: f });
    }
    OC.globalAlpha = a * 0.5;
    OC.fillRect(X, CY - 380, 1, 760);
    for (const [m, name] of TAPE_MARKS) {
      const y = Math.round(CY - (m - alt) * K);
      const f = 1 - Math.pow(Math.abs(y - CY) / 380, 2);
      if (f <= 0) continue;
      if (m % 1000 !== 0) { OC.globalAlpha = a * f; OC.fillRect(X - 12, y, 12, 1); }
      if (Math.abs(y - CY) > 16) txt(name, X - 64, y + 4, { screen: true, size: 11, color: P.css.dim, align: "right", alpha: f });
    }
    OC.globalAlpha = a;
    OC.fillStyle = P.css.accent;
    OC.beginPath(); OC.moveTo(X + 5, CY + 0.5); OC.lineTo(X + 15, CY - 5.5); OC.lineTo(X + 15, CY + 6.5); OC.closePath(); OC.fill();
    OC.globalAlpha = 1;
    txt(`${Math.round(alt).toLocaleString("en-US")} m`, X - 22, CY + 8, { screen: true, size: 22, color: P.css.ink, align: "right" });
    TALPHA = saved;
  }

  // =================================================================
  // frame
  // =================================================================

  const DRAW = { boot: sBoot, metal: sMetal, compute: sCompute, storage: sStorage, network: sNetwork, k8s: sK8s, tooling: sTooling, people: sPeople };

  function sectionState(S, t) {
    const inW = WHIPS.includes(S.t0), outW = WHIPS.includes(S.t1);
    const a = inW ? S.t0 - HW : S.t0, b = outW ? S.t1 + HW : S.t1;
    if (t < a || t >= b) return null;
    let ty = 0, vel = 0;
    const dt = 1 / FPS;
    if (inW && t < S.t0 + HW) { ty = (whipP(S.t0, t) - 1) * CH; vel = (whipP(S.t0, t + dt) - whipP(S.t0, t)) * CH; }
    else if (outW && t > S.t1 - HW) { ty = whipP(S.t1, t) * CH; vel = (whipP(S.t1, t + dt) - whipP(S.t1, t)) * CH; }
    return { ty, vel };
  }

  function drawAll(t, P, fb, oc) {
    FB = fb; OC = oc;
    oc.clearRect(0, 0, W, H);
    fb.fill(P.paper);
    if (P === NIGHT || t < DAY_T0) {
      for (const S of SECTIONS) {
        const fn = DRAW[S.key];
        if (!fn) continue;
        const st = sectionState(S, t);
        if (!st) continue;
        layer.fill(0); buf = layer; resetCam();
        TALPHA = 1; OGHOST = st.vel * C;
        fn(t, P, st);
        OGHOST = 0; TALPHA = 1;
        composite(st.vel * 0.75);
      }
    }
    if (t >= 19.5) { resetCam(); TALPHA = 1; OGHOST = 0; sSummit(t, P); }
    buf = layer;
    chrome(t, P);
  }

  // ------------------------------------------------------------ output

  const canvas = document.getElementById("reel");
  const ctx = canvas.getContext("2d");
  const cellCv = document.createElement("canvas"); cellCv.width = CW; cellCv.height = CH;
  const cellCx = cellCv.getContext("2d");
  const cellImg = cellCx.createImageData(CW, CH);
  const cellU32 = new Uint32Array(cellImg.data.buffer);
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const ovN = mk(W, H), ovD = mk(W, H), maskCv = mk(CW, CH);
  const ovNx = ovN.getContext("2d"), ovDx = ovD.getContext("2d"), maskCx = maskCv.getContext("2d");
  const maskImg = maskCx.createImageData(CW, CH);
  const maskU32 = new Uint32Array(maskImg.data.buffer);

  function blit(src) {
    cellU32.set(src);
    cellCx.putImageData(cellImg, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cellCv, 0, 0, W, H);
  }

  function render(t) {
    t = clamp(t, 0, DUR);
    if (t < DAY_T0) {
      drawAll(t, NIGHT, frameN, ovNx);
      blit(frameN); ctx.drawImage(ovN, 0, 0);
      return;
    }
    if (t >= DAY_T1 + 0.05) {
      drawAll(t, DAY, frameD, ovDx);
      blit(frameD); ctx.drawImage(ovD, 0, 0);
      return;
    }
    // sunrise: two plates, and the light arriving through the dither
    drawAll(t, NIGHT, frameN, ovNx);
    drawAll(t, DAY, frameD, ovDx);
    const r = dayR(t), sx = SUN_X, sy = sunY(t);
    const out = frameN;
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const i = y * CW + x, v = (r - Math.hypot(x - sx, y - sy)) / 90, th = THR[i];
        if (v > th) {
          out[i] = v - th < 0.1 ? DAY.accent : frameD[i];
          maskU32[i] = 0xff000000;
        } else maskU32[i] = 0;
      }
    blit(out);
    maskCx.putImageData(maskImg, 0, 0);
    ovDx.globalCompositeOperation = "destination-in"; ovDx.imageSmoothingEnabled = false;
    ovDx.drawImage(maskCv, 0, 0, W, H); ovDx.globalCompositeOperation = "source-over";
    ovNx.globalCompositeOperation = "destination-out"; ovNx.imageSmoothingEnabled = false;
    ovNx.drawImage(maskCv, 0, 0, W, H); ovNx.globalCompositeOperation = "source-over";
    ctx.drawImage(ovN, 0, 0);
    ctx.drawImage(ovD, 0, 0);
  }

  // ------------------------------------------------------------- cues

  function buildCues() {
    cue(0, "tick"); cue(0.5, "tick"); cue(0.75, "glide");
    for (let v = 0; v < 64; v++) cue(1.0 + v * (0.75 / 64), "bayer", v);
    cue(1.8, "swell"); cue(2.0, "hit", 1);
    for (let k = 0; k < 16; k++) cue(2.5 + k * 0.125, "boot", k);
    cue(4.5, "fail"); cue(4.625, "fail"); cue(4.75, "fail"); cue(5.0, "scan"); cue(5.25, "fixed");
    for (const T of WHIPS) cue(T - HW, "whip", T);
    cue(8.1, "lift"); for (let c = 1; c <= 4; c++) {
      // the moment the migrating vm passes checkpoint c
      let lo = 8.25, hi = 9.15;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (SWIFT(inv(8.25, 9.15, mid)) < c / 5) lo = mid; else hi = mid; }
      cue(hi, "checkpoint", c);
    }
    cue(9.15, "land"); cue(9.3, "thaw");
    for (const te of RINGS) cue(te, "ping");
    cue(12.72, "reply"); for (const [, , ts] of HOPS) cue(ts, "hop"); cue(13.62, "answer");
    for (const p of PODS) cue(p.t, "pod", p.node);
    cue(EVICT.t, "evict"); cue(15.3, "node");
    for (const b of BOXES) cue(b.tf, "fill", b.r);
    cue(17.95, "converge");
    for (const s of STATS) cue(s.t, "slam");
    cue(19.5, "burst"); cue(21.15, "comet");
    cue(RIDGE_T0, "hit", 2); cue(RIDGE_T0, "ridge");
    cue(22.42, "word"); cue(22.82, "word"); cue(24.05, "header");
    cue(24.9, "sunrise"); cue(DAY_T0, "daybreak");
    for (let k = 0; k < 12; k++) cue(27.05 + (k * 0.55) / 12, "type", k);
    for (let b = 28.1; b < 30; b += 0.5) cue(b, "blink");
    CUES.sort((a, b) => a.t - b.t);
  }

  // ------------------------------------------------------------- boot

  async function init() {
    const fonts = [
      new FontFace("Departure Mono", "url(../public/DepartureMono-Regular.woff2)"),
      new FontFace("Newsreader", "url(assets/newsreader-latin-400-normal.woff2)"),
      new FontFace("Newsreader", "url(assets/newsreader-latin-400-italic.woff2)", { style: "italic" })
    ];
    await Promise.all(fonts.map((f) => f.load().then((ff) => document.fonts.add(ff))));
    const img = new Image();
    img.src = "../public/assets/annapurna-circuit.jpg";
    await img.decode();
    const sky = await (await fetch("../public/assets/annapurna-skyline.json")).json();
    buildTerrain(img, sky);
    buildTree();
    buildLanes();
    buildNumeral();
    buildCues();
  }

  const params = new URLSearchParams(location.search);
  const ready = init();
  window.reel = { ready, render, cues: () => CUES, fps: FPS, duration: DUR };

  if (params.has("capture")) { document.body.classList.add("capture"); return; }

  ready.then(() => {
    const audio = document.getElementById("score");
    let playing = false, start = 0, offset = params.has("t") ? parseFloat(params.get("t")) : 0;
    const now = () => (playing ? (audio.readyState > 1 && !audio.paused ? audio.currentTime : (performance.now() - start) / 1000) : offset);
    render(offset);
    const loop = () => {
      if (!playing) return;
      let t = now();
      if (t >= DUR) { playing = false; offset = DUR; render(DUR); return; }
      render(t);
      requestAnimationFrame(loop);
    };
    const play = () => {
      if (offset >= DUR) offset = 0;
      playing = true; start = performance.now() - offset * 1000;
      audio.currentTime = offset;
      audio.play().catch(() => {});
      requestAnimationFrame(loop);
    };
    const pause = () => { offset = now(); playing = false; audio.pause(); };
    canvas.addEventListener("click", () => (playing ? pause() : play()));
    addEventListener("keydown", (e) => {
      if (e.code === "Space") { e.preventDefault(); playing ? pause() : play(); }
      if (e.code === "ArrowRight" || e.code === "ArrowLeft") {
        const was = playing; if (was) pause();
        offset = clamp(offset + (e.code === "ArrowRight" ? 1 : -1), 0, DUR);
        render(offset); if (was) play();
      }
    });
  });
})();
