// the long way up: a sixty second film for lolwierd.com.
//
// The same print shop as reel/: dots on a two-pixel grid, gated by the 8x8
// bayer matrix, one ink per theme and a rust accent for the part that went
// wrong. This one tells the story instead of the stack: svit, the gate year,
// two free oracle boxes, the interviews that did not happen, a frontend ticket
// that turned into firecracker, three years at excloud, and the range at the top.
//
// render(t) is a pure function of time, so it plays live and renders
// frame-exact; cues() is every event it draws, for score.py.

(() => {
  "use strict";

  const W = 1920, H = 1080, C = 2, CW = 960, CH = 540, FPS = 60, DUR = 60;
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
        const b = bright * tw * starFade(i, t);
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
    txt("the long way up · 2026", 64, 1044, { screen: true, size: 11, color: credit, alpha: ca * 0.75 });
    const cl = sstep(27.75, 28.2, t);
    if (cl > 0) txt("still climbing.", X, 474, { screen: true, size: 22, color: P.css.dim, alpha: cl });
  }

  // =================================================================
  // THE FILM
  //
  // Everything above this line is the reel's print shop: the dither, the
  // buffers, the terrain, and the layers it climbed through. Below is the
  // story, told in the same dots: where the climb started, the year it stalled,
  // the frontend ticket that turned into firecracker two days in, and the range.
  // =================================================================

  const OFFSET = 30; // the summit is the reel's, run thirty seconds later

  const scratch = new Uint32Array(CW * CH);
  // Draw fn somewhere private, then print it through the dither at density d
  // (a number, or a function of screen cell). Two of these with d and 1 - d is
  // a crossfade made of dots.
  function dissolve(fn, d) {
    if (typeof d === "number") {
      if (d <= 0.001) return;
      if (d >= 0.999) { fn(); return; }
    }
    const saved = buf, savedA = TALPHA;
    buf = scratch;
    scratch.fill(0);
    if (typeof d === "number") TALPHA = savedA * d;
    fn();
    buf = saved;
    TALPHA = savedA;
    if (typeof d === "number") {
      for (let i = 0; i < scratch.length; i++) { const v = scratch[i]; if (v && d > THR[i]) buf[i] = v; }
    } else {
      for (let y = 0; y < CH; y++)
        for (let x = 0; x < CW; x++) { const i = y * CW + x, v = scratch[i]; if (v && d(x, y) > THR[i]) buf[i] = v; }
    }
  }
  function serifWidth(s, size, ls = -2) {
    OC.font = `${size}px ${SERIF}`;
    OC.letterSpacing = ls + "px";
    return OC.measureText(s).width;
  }

  // =================================================================
  // the words
  // =================================================================

  const NARR = [
    { t0: 3.75, t1: 5.55, s: "2018. computer engineering at svit." },
    { t0: 5.6, t1: 7.4, s: "i ran web and design for the college fest." },
    { t0: 7.45, t1: 9.35, s: "then the college asked us to build their app." },
    { t0: 9.65, t1: 12.35, s: "after college, one goal:", k: "small" },
    { t0: 12.75, t1: 14.75, s: "2022. full-time gate prep, aiming for iisc." },
    { t0: 14.8, t1: 16.35, s: "three months in: cramming is not for me." },
    { t0: 16.4, t1: 17.85, s: "so i learned how things actually work." },
    { t0: 18.2, t1: 19.85, s: "a raspberry pi. linux internals. go." },
    { t0: 19.9, t1: 21.85, s: "two free oracle arm servers. i self-hosted everything." },
    { t0: 21.9, t1: 23.35, s: "even my own mail server." },
    { t0: 23.75, t1: 25.15, s: "i thought i was ready." },
    { t0: 25.2, t1: 26.55, s: "i couldn't even get interviews." },
    { t0: 26.6, t1: 27.9, s: "so i applied to everything." },
    { t0: 28.75, t1: 30.0, s: "2023. a frontend opening at vaultci." },
    { t0: 30.05, t1: 31.25, s: "i did frontend for about two days." },
    { t0: 31.3, t1: 32.5, s: "arjun was building it on firecracker." },
    { t0: 35.15, t1: 37.45, s: "three years, one public cloud," },
    { t0: 37.5, t1: 39.85, s: "from the hypervisor up." },
    { t0: 40.15, t1: 41.35, s: "arjun reviewed everything i built." },
    { t0: 41.4, t1: 42.9, s: "design for the scale you have." },
    { t0: 41.9, t1: 42.9, s: "know where it breaks.", row: 1 },
    { t0: 46.15, t1: 48.85, s: "1 thing i love 2 do is overdo." },
    { t0: 49.2, t1: 51.7, s: "now: the infrastructure behind warpbuild's ci runners." }
  ];

  function narration(t, P) {
    for (const n of NARR) {
      if (t < n.t0 || t > n.t1) continue;
      const small = n.k === "small";
      const size = small ? 22 : 44, fam = small ? MONO : SERIF, ls = small ? 0 : -0.5;
      const x = 128, y = 152 + (n.row || 0) * 58;
      OC.font = `${size}px ${fam}`;
      OC.letterSpacing = ls + "px";
      const w = OC.measureText(n.s).width;
      const pin = (t - n.t0) / 0.38, pout = (n.t1 - t) / 0.18;
      printIn(() => txt(n.s, x, y, { screen: true, size, fam, color: small ? P.css.dim : P.css.strong, ls }),
        x - 8, y - size - 6, w + 24, size + 24,
        (gx) => Math.min((pin * (w / C + 50) - (gx - x / C)) / 26, pout * 1.15));
    }
  }

  // =================================================================
  // 0:00  the long way up
  // =================================================================

  const TITLE = "the long way up";

  function sTitle(t, P, st) {
    resetCam(); TY = st.ty;
    const oy = TY * C, cx = 480, cy = 262;
    if (t < 1.0) {
      if ((t % 0.5) < 0.27) rect(cx - 3, cy - 6, cx + 3, cy + 6, P.cell);
      return;
    }
    const dust = sstep(2.0, 2.9, t);
    if (dust > 0)
      for (let i = 0; i < 900; i++) {
        if (hu(i * 5 + 4) > dust) continue;
        const b = 0.12 + 0.4 * Math.pow(hu(i * 5 + 3), 2);
        pt(hu(i * 5 + 1) * CW, hu(i * 5 + 2) * CH, P.tone("cell", b * (0.7 + 0.3 * Math.sin(t * 2.3 + i))));
      }
    const W0 = tw(TITLE, 44), x0 = Math.round(960 - W0 / 2), yM = 554 + oy;
    if (t < 2.3) {
      const n = Math.min(TITLE.length, Math.floor((t - 1.0) / 0.0625) + 1);
      const s = TITLE.slice(0, n), fade = 1 - inv(2.0, 2.3, t);
      printIn(() => {
        txt(s, x0, yM, { screen: true, size: 44, color: P.css.ink });
        if (t < 2.0) { OC.fillStyle = P.css.ink; OC.fillRect(Math.round(x0 + tw(s, 44) + 4), yM - 34, 22, 40); }
      }, x0 - 10, yM - 50, W0 + 60, 70, () => fade * 1.02);
    }
    if (t >= 2.0) {
      const p = (t - 2.0) / 0.55, w = serifWidth(TITLE, 124, -3), yT = 566 + oy;
      printIn(() => txt(TITLE, 960, yT, { screen: true, size: 124, fam: SERIF, color: P.css.strong, align: "center", ls: -3 }),
        960 - w / 2 - 20, yT - 112, w + 40, 150, (gx) => p * 1.35 - (Math.abs(gx - 480) / (w / C / 2 + 1)) * 0.9);
      const q = (t - 2.45) / 0.4;
      if (q > 0) {
        const sub = "ayaan retiwala · 2018 → 2026", ws = tw(sub, 22);
        printIn(() => txt(sub, 960, 644 + oy, { screen: true, size: 22, color: P.css.dim, align: "center" }),
          960 - ws / 2 - 10, 614 + oy, ws + 20, 44, (gx) => (q * (ws / C + 40) - (gx - (960 - ws / 2) / C)) / 20);
      }
    }
  }

  // =================================================================
  // 0:03  2018, svit
  // =================================================================

  const WINDOWS = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 12; c++) {
      const x = 316 + c * 28;
      if (r === 2 && Math.abs(x + 8 - 480) < 24) continue;
      WINDOWS.push({ x, y: 266 + r * 36, o: hu(r * 31 + c * 7 + 5) });
    }
  const winT = (w) => 3.85 + w.o * 1.3;

  function drawBuilding(t, P) {
    line(170, 381, 790, 381, P.dim);
    box(300, 250, 660, 382, P.cell);
    rect(290, 243, 670, 250, P.cell, 0.55);
    box(450, 196, 510, 251, P.cell);
    rect(446, 190, 514, 196, P.cell, 0.55);
    ring(480, 222, 11, 1.4, P.cell, 1);
    const ang = t * 2.4 - Math.PI / 2;
    line(480, 222, 480 + Math.cos(ang) * 8, 222 + Math.sin(ang) * 8, P.strong);
    line(480, 222, 480 + Math.cos(ang / 12 - 1) * 5, 222 + Math.sin(ang / 12 - 1) * 5, P.cell);
    for (const w of WINDOWS) {
      const lit = t >= winT(w);
      if (lit && t - winT(w) < 0.05) { rect(w.x, w.y, w.x + 16, w.y + 22, P.strong); continue; }
      box(w.x, w.y, w.x + 16, w.y + 22, lit ? P.cell : P.dim, lit ? 1 : 0.5);
      if (lit) rect(w.x + 2, w.y + 2, w.x + 14, w.y + 20, P.cell, 0.3 + 0.3 * vnoise(w.x * 0.1, t * 0.8));
    }
    rect(466, 346, 494, 382, P.paper);
    box(466, 346, 494, 382, P.cell);
  }

  function drawBrowser(t, P) {
    rect(250, 128, 710, 400, P.paper);
    box(250, 128, 710, 400, P.cell);
    rect(251, 129, 709, 146, P.cell, 0.18);
    for (let k = 0; k < 3; k++) disc(262 + k * 10, 137.5, 2.6, P.cell);
    box(300, 133, 600, 142, P.dim, 0.8, 2);
    const px0 = 262, py0 = 158, px1 = 470, py1 = 388, pcx = 366, pcy = 245;
    rectFn(px0, py0, px1, py1, P.cell, (X, Y) => {
      if (Y > 336) return 0;
      const dx = X - pcx, dy = Y - pcy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const rays = Math.pow(Math.max(0, Math.cos(a * 9 + t * 1.2)), 6) * Math.exp(-r / 150) * 0.85;
      return Math.min(1, Math.exp(-r / 40) + rays);
    });
    box(px0, py0, px1, py1, P.cell, 0.9);
    rect(px0 + 12, 348, px0 + 150, 356, P.cell, 0.9);
    rect(px0 + 12, 364, px0 + 110, 369, P.cell, 0.5);
    for (let k = 0; k < 7; k++) {
      const a = sstep(5.8 + k * 0.1, 5.95 + k * 0.1, t);
      if (a <= 0) continue;
      const y = 164 + k * 32;
      rect(486, y, 516, y + 8, P.cell, a);
      rect(524, y, 524 + (60 + 110 * hu(k * 9 + 1)) * a, y + 8, P.cell, 0.4);
      line(486, y + 20, 698, y + 20, P.faint, 0.7, 1);
    }
  }

  function drawPhones(t, P) {
    const spread = EXPR(inv(7.45, 8.05, t));
    [["ios", -1], ["android", 1]].forEach(([os, side], k) => {
      const cx = 480 + side * 90 * spread, cy = 262, x0 = cx - 59, x1 = cx + 59, y0 = cy - 118, y1 = cy + 118;
      rect(x0, y0, x1, y1, P.paper);
      box(x0, y0, x1, y1, P.cell);
      box(x0 + 6, y0 + 16, x1 - 6, y1 - 16, P.dim, 0.8);
      if (os === "ios") { rect(cx - 16, y0 + 5, cx + 16, y0 + 10, P.cell); rect(cx - 20, y1 - 9, cx + 20, y1 - 7, P.cell); }
      else { disc(cx, y0 + 8, 2.4, P.cell); for (let j = -1; j <= 1; j++) rect(cx + j * 22 - 3, y1 - 10, cx + j * 22 + 3, y1 - 6, P.dim); }
      rect(x0 + 10, y0 + 20, x1 - 10, y0 + 34, P.cell, 0.55);
      for (let r = 0; r < 6; r++)
        for (let c = 0; c < 5; c++) {
          const tf = 7.75 + (r * 5 + c) * 0.035 + k * 0.05;
          const X = x0 + 11 + c * 19.5, Y = y0 + 42 + r * 27;
          if (t < tf) { box(X, Y, X + 16, Y + 22, P.faint, 0.5, 1); continue; }
          box(X, Y, X + 16, Y + 22, P.cell, 0.9);
          rect(X + 2, Y + 2, X + 14, Y + 20, P.cell, 0.15 + 0.6 * hu(r * 7 + c * 3 + 1));
        }
      txt(os, cx, y1 + 16, { size: 22, color: P.css.dim, align: "center", alpha: sstep(7.7, 7.9, t) });
    });
    txt("svit cms app", 480, 132, { size: 22, color: P.css.ink, align: "center", alpha: sstep(7.6, 7.8, t) });
    const bp = inv(7.75, 9.05, t);
    line(330, 424, 630, 424, P.faint, 0.8, 1);
    rect(330, 423, 330 + 300 * bp, 426, P.cell);
    txt("a year and a half", 330, 418, { size: 11, color: P.css.faint, alpha: sstep(7.7, 7.9, t) });
    txt(t < 9.05 ? "" : "shipped", 630, 418, { size: 11, color: P.css.ink, align: "right" });
  }

  function sCollege(t, P, st) {
    resetCam(); TY = st.ty;
    const grow = EXPR(inv(3.4, 4.2, t));
    const pA = 1 - sstep(5.45, 5.75, t);
    const pB = sstep(5.45, 5.75, t) * (1 - sstep(7.3, 7.6, t));
    const pC = sstep(7.3, 7.6, t);
    if (pA > 0) {
      dissolve(() => drawBuilding(t, P), (x, y) => Math.min(pA * 1.02, (grow * 220 - (382 - (y - TY))) / 10));
      txt("sardar vallabhbhai patel institute of technology · vasad", 480, 404, { size: 11, color: P.css.faint, align: "center", alpha: pA * sstep(4.0, 4.3, t) });
    }
    if (pB > 0) {
      dissolve(() => drawBrowser(t, P), pB);
      txt("web · design · the college fest", 480, 418, { size: 11, color: P.css.faint, align: "center", alpha: pB });
    }
    if (pC > 0) dissolve(() => drawPhones(t, P), pC);
  }

  // =================================================================
  // 0:09  one goal
  // =================================================================

  const BLOCKS = [];
  (() => {
    const r = mulberry(77);
    let x = 262;
    for (let k = 0; k < 10; k++) {
      const w = 30 + r() * 34;
      if (x + w > 700) break;
      BLOCKS.push({ x, w, h: 14 + r() * 24, base: 340 });
      x += w + 6;
    }
    const n1 = BLOCKS.length;
    for (let k = 0; k < 5; k++) {
      const b = BLOCKS[(k * 2 + 1) % n1], w = b.w * (0.5 + r() * 0.4);
      BLOCKS.push({ x: b.x + (b.w - w) * r(), w, h: 10 + r() * 16, base: b.base - b.h - 1 });
    }
  })();
  const blockT = (k) => 10.75 + k * 0.12;

  function sGoal(t, P, st) {
    resetCam(); TY = st.ty;
    const oy = TY * C;
    for (const [s, y, t0] of [["build the things", 330, 10.0], ["other people build on.", 428, 10.4]]) {
      if (t < t0) continue;
      const w = serifWidth(s, 88), p = (t - t0) / 0.5;
      printIn(() => txt(s, 960, y + oy, { screen: true, size: 88, fam: SERIF, color: P.css.strong, align: "center", ls: -2 }),
        960 - w / 2 - 20, y - 80 + oy, w + 40, 110, (gx) => (p * (w / C + 100) - (gx - (960 - w / 2) / C)) / 50);
    }
    const sp = EXPR(inv(10.3, 10.8, t));
    if (sp > 0) {
      rect(250, 340, 250 + 460 * sp, 352, P.cell, 0.9);
      box(250, 340, 250 + 460 * sp, 352, P.cell);
      txt("foundational software", 480, 370, { size: 11, color: P.css.faint, align: "center", alpha: sstep(10.6, 10.9, t) });
    }
    BLOCKS.forEach((b, k) => {
      const tk = blockT(k), land = tk + 0.22;
      if (t < tk) return;
      const fall = t < land ? (1 - E.inQuad(inv(tk, land, t))) * 46 : 0;
      const sq = t >= land ? 0.18 * Math.exp(-(t - land) * 16) : 0;
      const h = b.h * (1 - sq), w = b.w * (1 + sq * 0.5), x = b.x + (b.w - w) / 2;
      const y1 = b.base - fall, y0 = y1 - h;
      dissolve(() => {
        rect(x, y0, x + w, y1, P.paper);
        box(x, y0, x + w, y1, t - land < 0.05 && t >= land ? P.strong : P.cell);
        rect(x + 2, y0 + 2, x + w - 2, y1 - 2, P.cell, 0.2 + 0.5 * hu(k * 17 + 3));
      }, inv(tk, tk + 0.12, t) * 1.01);
    });
  }

  // =================================================================
  // 0:12  2022, gate, and the calendar under it
  // =================================================================

  const SUBJECTS = ["operating systems", "databases", "computer networks", "theory of computation", "compiler design", "algorithms",
    "data structures", "digital logic", "computer organization", "discrete mathematics", "engineering mathematics", "aptitude"];
  const subjT = (k) => 12.75 + k * 0.27;
  const TIERS = [["registers", "< 1 ns"], ["cache", "~ 1 to 10 ns"], ["memory", "~ 100 ns"], ["disk", "~ 100 µs"], ["network", "~ 1 ms and up"]];
  const tierT = (k) => 16.35 + k * 0.2;

  function sGate(t, P, st) {
    resetCam(); TY = st.ty;
    const oy = TY * C;
    const crack = inv(15.95, 16.3, t);
    if (t < 16.5) {
      const pileA = 1 - sstep(16.25, 16.5, t);
      const lh = lerp(30, 7, E.inQuad(inv(12.9, 15.9, t)));
      const base = 690;
      let top = base, landed = 0;
      SUBJECTS.forEach((s, k) => {
        const tk = subjT(k);
        if (t < tk) return;
        const land = tk + 0.22, slot = base - k * lh;
        let y, sy;
        if (t < land) { y = lerp(236, slot, E.inQuad(inv(tk, land, t))); sy = 1; }
        else { y = slot; sy = lh / 30; landed++; top = Math.min(top, slot - 22 * sy); }
        const shake = crack > 0
          ? (hu(k * 13 + Math.floor(t * 30)) - 0.5) * 14 * crack
          : (1 - lh / 30) * (hu(k + Math.floor(t * 20)) - 0.5) * 3;
        OC.save();
        OC.translate(960 + shake, y + oy);
        OC.scale(1, sy);
        txt(s, 0, 0, { screen: true, size: 22, color: crack > 0.15 ? P.css.accent : t < land ? P.css.strong : P.css.ink, align: "center", alpha: pileA });
        OC.restore();
      });
      // the press
      if (landed > 1 && pileA > 0) {
        const py = (top - 8) / C;
        dissolve(() => {
          rect(356, py - 4, 604, py, crack > 0.15 ? P.accent : P.cell, 0.9);
          line(480, 100, 480, py - 4, P.dim, 0.8, 2);
          rect(356, base / C + 6, 604, base / C + 10, P.cell, 0.9);
        }, pileA);
      }
    }
    TIERS.forEach(([name, lat], k) => {
      const tk = tierT(k), p = EXPR(inv(tk, tk + 0.35, t));
      if (p <= 0) return;
      const y0 = 128 + k * 44, y1 = y0 + 36, hw0 = 30 + k * 56, hw1 = 24 + (k + 1) * 56;
      const dens = [0.9, 0.7, 0.52, 0.36, 0.22][k];
      rectFn(480 - hw1, y0, 480 + hw1, y1, P.cell, (X, Y) => {
        const f = (Y - y0) / (y1 - y0), hw = lerp(hw0, hw1, f), dx = Math.abs(X - 480);
        if (dx > hw * p) return 0;
        return Math.abs(dx - hw) < 1.3 || Y - y0 < 1 || y1 - Y < 1 ? 1 : dens;
      });
      txt(name, 480 + hw1 + 16, y0 + 20, { size: 22, color: P.css.ink, alpha: sstep(tk + 0.12, tk + 0.3, t) });
      txt(lat, 480 + hw1 + 16, y0 + 32, { size: 11, color: P.css.faint, alpha: sstep(tk + 0.18, tk + 0.36, t) });
    });
  }

  const CAL = { x0: 246, y0: 392, pitch: 9, size: 7 };
  const CAL_SEG = [[0, 12.9], [91, 16.2], [150, 18.0], [240, 23.5], [363, 27.85]];
  function calFill(d) {
    for (let i = 1; i < CAL_SEG.length; i++)
      if (d <= CAL_SEG[i][0]) {
        const [d0, t0] = CAL_SEG[i - 1], [d1, t1] = CAL_SEG[i];
        return t0 + ((d - d0) / (d1 - d0)) * (t1 - t0);
      }
    return 99;
  }
  const calCell = (d) => ({ x: CAL.x0 + Math.floor(d / 7) * CAL.pitch, y: CAL.y0 + (d % 7) * CAL.pitch });
  const CAL_MONTHS = ["jul", "aug", "sep", "oct", "nov", "dec", "jan", "feb", "mar", "apr", "may", "jun"];

  function calendar(t, P) {
    const st = sceneState({ t0: 12.5, t1: 28.5 }, t);
    if (!st) return;
    layer.fill(0); buf = layer; resetCam(); TY = st.ty; OGHOST = st.vel * C;
    const ga = sstep(12.5, 12.9, t);
    CAL_MONTHS.forEach((m, k) => txt(m, CAL.x0 + (k * 30.4 / 7) * CAL.pitch, CAL.y0 - 7, { size: 11, color: P.css.faint, alpha: ga }));
    txt("2022", CAL.x0 - 10, CAL.y0 + 8, { size: 11, color: P.css.faint, align: "right", alpha: ga });
    txt("2023", CAL.x0 + 52 * CAL.pitch + 6, CAL.y0 + 62, { size: 11, color: P.css.faint, alpha: ga });
    for (let d = 0; d < 364; d++) {
      const { x, y } = calCell(d), tf = calFill(d);
      if (t < tf) { pt(x + 3, y + 3, P.faint, 0.7 * ga); continue; }
      if (t - tf < 0.06) { rect(x - 1, y - 1, x + CAL.size + 1, y + CAL.size + 1, P.strong); continue; }
      if (d === 363) {
        rect(x - 1, y - 1, x + CAL.size + 1, y + CAL.size + 1, t >= 28.32 ? P.strong : P.dim);
        continue;
      }
      if (d < 91) rect(x, y, x + CAL.size, y + CAL.size, t > 15.95 && t < 16.35 ? P.accent : P.cell, 0.95);
      else if (d < 150) { box(x, y, x + CAL.size, y + CAL.size, P.cell, 0.9); rect(x + 3, y + 3, x + 4, y + 4, P.cell); }
      else if (d < 240) { box(x, y, x + CAL.size, y + CAL.size, P.cell, 0.9); pt(x + 2, y + 2, P.cell); pt(x + 4, y + 4, P.cell); }
      else box(x, y, x + CAL.size, y + CAL.size, P.dim, 0.7);
    }
    const fl = pulse(16.1, 16.2, 16.4, 16.7, t);
    if (fl > 0) line(CAL.x0 + 13 * CAL.pitch - 1, CAL.y0 - 3, CAL.x0 + 13 * CAL.pitch - 1, CAL.y0 + 64, P.accent, fl);
    if (t >= 28.32) {
      const r = (t - 28.32) * 70;
      const { x, y } = calCell(363);
      if (r < 26) ring(x + 3.5, y + 3.5, r, 2, P.strong, 1 - r / 26);
    }
    composite(st.vel * 0.75);
    OGHOST = 0;
  }

  // =================================================================
  // 0:18  a raspberry pi, and two free servers
  // =================================================================

  const BOOTLOG = [
    "[    0.000000] Booting Linux on physical CPU 0x0000000000",
    "[    0.000000] Machine model: Raspberry Pi",
    "[    0.000000] Zone ranges:",
    "[    0.001244] Console: colour dummy device 80x30",
    "[    0.084211] smp: Brought up 1 node, 4 CPUs",
    "[    0.412903] EXT4-fs (mmcblk0p2): mounted filesystem",
    "[    1.603477] systemd[1]: Started Journal Service.",
    "[    2.402190] IPv6: ADDRCONF(NETDEV_CHANGE): wlan0: link becomes ready",
    "[    3.118502] ssh.service: Started OpenBSD Secure Shell server.",
    "[    3.700411] go version go1.19 linux/arm64"
  ];
  const logT = (k) => 18.5 + k * 0.13;
  const SERVICES = [["caddy", "tailscale", "blog", "mail"], ["plex", "flood", "tailscale"]];
  const chipT = (s, i) => 20.15 + (s * 4 + i) * 0.125;

  function sOracle(t, P, st) {
    resetCam(); TY = st.ty;
    const oy = TY * C;
    const pa = EXPR(inv(18.0, 18.45, t));
    dissolve(() => {
      const x0 = 70, y0 = 140, x1 = 240, y1 = 252;
      box(x0, y0, x1, y1, P.cell);
      rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1, P.cell, 0.06);
      for (const [hx, hy] of [[x0 + 7, y0 + 7], [x1 - 7, y0 + 7], [x0 + 7, y1 - 7], [x1 - 7, y1 - 7]]) ring(hx, hy, 3, 1.2, P.dim, 1);
      for (let k = 0; k < 20; k++) { rect(x0 + 24 + k * 6, y0 + 5, x0 + 27 + k * 6, y0 + 8, P.cell); rect(x0 + 24 + k * 6, y0 + 10, x0 + 27 + k * 6, y0 + 13, P.cell); }
      box(x0 + 48, y0 + 38, x0 + 90, y0 + 80, P.cell);
      rect(x0 + 52, y0 + 42, x0 + 86, y0 + 76, P.cell, 0.45);
      box(x0 + 100, y0 + 44, x0 + 124, y0 + 76, P.dim);
      rect(x0 + 102, y0 + 46, x0 + 122, y0 + 74, P.cell, 0.25);
      for (const yy of [20, 52, 80]) box(x1 - 26, y0 + yy, x1 + 4, y0 + yy + 22, P.cell);
      for (let k = 0; k < 14; k++) line(x0 + 30 + k * 4, y1 - 14, x0 + 30 + k * 4, y1 - 22 - 6 * vnoise(k, t * 3), P.faint, 0.8);
      if (Math.floor(t * 6) % 3 !== 0) rect(x0 + 10, y1 - 14, x0 + 14, y1 - 10, P.strong);
    }, (x, y) => (pa * 190 - ((x) - 70)) / 12);
    txt("raspberry pi", 155, 268, { size: 11, color: P.css.faint, align: "center", alpha: sstep(18.3, 18.6, t) });
    const shown = BOOTLOG.filter((_, k) => t >= logT(k)).length;
    for (let j = Math.max(0, shown - 7); j < shown; j++) {
      const row = j - Math.max(0, shown - 7);
      txt(BOOTLOG[j], 70 * C, 572 + row * 16 + oy, { screen: true, ghost: true, size: 11, color: j === shown - 1 ? P.css.ink : P.css.faint });
    }
    for (let s = 0; s < 2; s++) {
      const a = sstep(19.85 + s * 0.15, 20.1 + s * 0.15, t);
      if (a <= 0) continue;
      const x0 = 320, x1 = 840, y0 = 150 + s * 74, y1 = y0 + 52;
      dissolve(() => {
        rect(x0, y0, x1, y1, P.paper);
        box(x0, y0, x1, y1, P.cell);
        for (let b = 0; b < 4; b++) box(x0 + 8 + b * 14, y0 + 24, x0 + 18 + b * 14, y0 + 44, P.dim);
        if (Math.floor(t * 5 + s) % 2) rect(x0 + 66, y0 + 30, x0 + 70, y0 + 34, P.strong);
        rect(x0 + 66, y0 + 38, x0 + 70, y0 + 42, P.cell);
        for (let v = 0; v < 10; v++) line(x1 - 58 + v * 5, y0 + 10, x1 - 58 + v * 5, y0 + 42, P.faint, 0.7);
      }, a);
      txt("oracle cloud · always free · arm · 4 ocpu · 24 gb", x0 + 8, y0 + 14, { size: 11, color: P.css.dim, alpha: a });
      SERVICES[s].forEach((name, i) => {
        const tc = chipT(s, i);
        if (t < tc) return;
        const cx0 = x0 + 84 + i * 84, cy0 = y0 + 24, cx1 = cx0 + 76, cy1 = cy0 + 20;
        const err = name === "caddy" && t >= 22.15 && t < 22.95;
        const mail = name === "mail" && t >= 21.9 && t < 22.05;
        const flash = t - tc < 0.05 || mail;
        if (flash) rect(cx0, cy0, cx1, cy1, P.strong);
        else {
          rect(cx0, cy0, cx1, cy1, P.paper);
          box(cx0, cy0, cx1, cy1, err ? P.accent : P.cell);
          if (err) rect(cx0 + 1, cy0 + 1, cx1 - 1, cy1 - 1, P.accent, 0.3);
        }
        txt(name, (cx0 + cx1) / 2, cy0 + 14, { size: 22, color: flash ? P.css.paper : err ? P.css.accent : P.css.ink, align: "center" });
      });
    }
    // mail goes out, and comes back
    const mu = inv(21.95, 22.6, t);
    if (mu > 0 && mu < 1) {
      const sx = 320 + 84 + 3 * 84 + 76, sy = 184;
      const out = mu < 0.5, e = out ? E.inQuad(mu * 2) : E.outQuad((mu - 0.5) * 2);
      const x = out ? lerp(sx, 960, e) : lerp(960, sx, e), y = sy + (out ? -1 : 1) * 3;
      streak(x, y, out ? 12 : -12, 0, P.strong, 20);
    }
    const ea = pulse(22.15, 22.2, 22.9, 22.95, t);
    if (ea > 0) txt("err_too_many_redirects", 404, 142, { size: 22, color: P.css.accent, alpha: ea * (Math.floor((t - 22.15) * 8) % 2 ? 1 : 0.5) });
    const fa = pulse(22.95, 23.05, 23.3, 23.45, t);
    if (fa > 0) txt("fixed. a ten minute migration took four hours.", 404, 142, { size: 11, color: P.css.dim, alpha: fa });
  }

  // =================================================================
  // 0:23  the job hunt
  // =================================================================

  const ME = { x: 150, y: 250 }, WALL = 470;
  const sendT = (j) => 26.6 + 1.25 * Math.pow(j / 150, 0.75);

  function sHunt(t, P, st) {
    resetCam(); TY = st.ty;
    const a = sstep(23.55, 23.8, t);
    const gone = 1 - sstep(27.6, 27.9, t);
    let sent = false;
    for (let j = 0; j < 150; j++) { const L = sendT(j); if (t >= L && t - L < 0.05) sent = true; }
    box(ME.x - 12, ME.y - 12, ME.x + 12, ME.y + 12, P.cell, a);
    rect(ME.x - 9, ME.y - 9, ME.x + 9, ME.y + 9, sent ? P.strong : P.cell, (sent ? 1 : 0.5) * a);
    txt("me", ME.x, ME.y + 32, { size: 22, color: P.css.dim, align: "center", alpha: a });
    const tgt = { x0: 690, y0: 222, x1: 850, y1: 278 };
    const ta = sstep(23.7, 24.0, t) * (1 - 0.55 * sstep(25.3, 25.7, t)) * gone;
    box(tgt.x0, tgt.y0, tgt.x1, tgt.y1, t > 25.3 ? P.dim : P.cell, ta, t > 25.3 ? 2 : 0);
    txt("the job i wanted", (tgt.x0 + tgt.x1) / 2, tgt.y0 + 26, { size: 22, color: P.css.ink, align: "center", alpha: ta });
    txt("foundational software", (tgt.x0 + tgt.x1) / 2, tgt.y0 + 42, { size: 11, color: P.css.faint, align: "center", alpha: ta });
    const reach = EXPR(inv(23.8, 24.75, t));
    const lineEnd = lerp(ME.x + 14, tgt.x0 - 4, reach);
    const beyond = 1 - sstep(25.25, 25.6, t);
    for (let x = ME.x + 14; x < lineEnd; x += 3) pt(x, ME.y, P.cell, (x < WALL ? 1 : beyond) * gone);
    const wp = EXPR(inv(25.2, 25.4, t));
    if (wp > 0) {
      line(WALL, ME.y - 70 * wp, WALL, ME.y + 70 * wp, P.accent, gone);
      line(WALL + 1, ME.y - 70 * wp, WALL + 1, ME.y + 70 * wp, P.accent, gone * 0.5);
      const bu = inv(25.2, 25.55, t);
      if (bu > 0 && bu < 1)
        for (let k = 0; k < 14; k++) {
          const ang = Math.PI * (0.55 + 0.9 * hu(k * 3 + 1)), r = E.outCubic(bu) * (10 + 22 * hu(k * 3 + 2));
          pt(WALL + Math.cos(ang) * r, ME.y + Math.sin(ang) * r, P.accent, 1 - bu);
        }
      txt("no interviews", WALL, ME.y - 82, { size: 22, color: P.css.accent, align: "center", alpha: sstep(25.25, 25.4, t) * gone });
    }
    for (let j = 0; j < 150; j++) {
      const L = sendT(j), u = inv(L, L + 0.62, t);
      if (u <= 0 || u >= 1) continue;
      const ex = 1010 + 80 * hu(j * 3 + 1), ey = 30 + 470 * hu(j * 3 + 2);
      const c = { x: lerp(ME.x, ex, 0.5), y: lerp(ME.y, ey, 0.5) - 70 * (hu(j * 3 + 3) - 0.3) };
      const e = E.inQuad(u) * 0.55 + u * 0.45, e2 = E.inQuad(Math.max(0, u - 0.03)) * 0.55 + Math.max(0, u - 0.03) * 0.45;
      const q = quad(ME, c, { x: ex, y: ey }, e), q2 = quad(ME, c, { x: ex, y: ey }, e2);
      streak(q.x, q.y, q.x - q2.x, q.y - q2.y, P.cell, 10);
      rect(q.x - 1, q.y - 1, q.x + 1, q.y + 1, P.cell);
    }
    // one comes back
    const r = inv(27.95, 28.32, t);
    if (r > 0 && r < 1) {
      const { x, y } = calCell(363), to = { x: x + 3.5, y: y + 3.5 }, from = { x: 975, y: 170 };
      const c = { x: 820, y: 330 };
      const q = quad(from, c, to, SWIFT(r)), q2 = quad(from, c, to, SWIFT(inv(27.95, 28.32, t - 1 / 60)));
      streak(q.x, q.y, q.x - q2.x, q.y - q2.y, P.strong, 24);
      rect(q.x - 2, q.y - 2, q.x + 2, q.y + 2, P.strong);
    }
  }

  // =================================================================
  // 0:28  the frontend ticket
  // =================================================================

  const VMS = [];
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * TAU + 0.2; VMS.push({ x: 480 + Math.cos(a) * 250, y: 255 + Math.sin(a) * 150, t: 31.35 + k * 0.0625 }); }

  function sTicket(t, P, st) {
    if (t >= 33.75) return;
    resetCam(); TY = st.ty;
    const oy = TY * C;
    const dim = 1 - 0.8 * sstep(32.5, 32.75, t);
    const x0 = 330, y0 = 196, x1 = 630, y1 = 314;
    const bp = inv(28.62, 28.95, t);
    dissolve(() => {
      const per = 2 * (x1 - x0 + y1 - y0);
      let left = bp * per;
      const seg = (ax, ay, bx, by) => {
        const len = Math.hypot(bx - ax, by - ay);
        if (left <= 0) return;
        const f = Math.min(1, left / len);
        line(ax, ay, ax + (bx - ax) * f, ay + (by - ay) * f, P.cell);
        left -= len;
      };
      seg(x0, y0, x1, y0); seg(x1, y0, x1, y1); seg(x1, y1, x0, y1); seg(x0, y1, x0, y0);
      if (bp >= 1) line(x0 + 12, y0 + 34, x1 - 12, y0 + 34, P.faint, 0.8, 1);
      rect(x1 - 10, y0 + 6, x1 - 6, y0 + 10, P.strong);
    }, dim);
    const ta = sstep(28.85, 29.05, t) * dim;
    txt("vaultci", 684, 432 + oy, { screen: true, ghost: true, size: 22, color: P.css.dim, alpha: ta });
    txt("frontend engineer", 684, 510 + oy, { screen: true, ghost: true, size: 44, color: P.css.ink, alpha: ta });
    txt("remote · jun 2023", 684, 566 + oy, { screen: true, ghost: true, size: 22, color: P.css.faint, alpha: ta });
    txt("later renamed excloud", 1240, 608 + oy, { screen: true, ghost: true, size: 11, color: P.css.faint, align: "right", alpha: ta });
    if (t >= 30.3) txt(t < 30.7 ? "day 1" : "day 2", 1236, 432 + oy, { screen: true, size: 22, color: P.css.ink, align: "right", alpha: dim });
    const sp = inv(31.0, 31.2, t);
    if (sp > 0) {
      OC.globalAlpha = dim;
      OC.fillStyle = P.css.accent;
      OC.fillRect(680, 494 + oy, (tw("frontend engineer", 44) + 8) * sp, 4);
      OC.globalAlpha = 1;
    }
    for (const v of VMS) {
      if (t < v.t) continue;
      if (t - v.t < 0.05) { rect(v.x - 9, v.y - 7, v.x + 9, v.y + 7, P.strong); continue; }
      dissolve(() => {
        box(v.x - 9, v.y - 7, v.x + 9, v.y + 7, P.cell);
        rect(v.x - 7, v.y - 5, v.x + 7, v.y + 5, P.cell, 0.35 + 0.3 * vnoise(v.x, t * 3));
      }, dim);
    }
    const la = sstep(31.5, 31.7, t) * dim;
    txt("firecracker microvms · they boot in about 125 ms", 480, 340, { size: 11, color: P.css.dim, align: "center", alpha: la });
    txt("i'd already raced it against docker on my oracle box", 480, 354, { size: 11, color: P.css.faint, align: "center", alpha: sstep(31.8, 32.0, t) * dim });
    const q = (t - 32.6) / 0.35;
    if (q > 0) {
      const quote = "“want to give it a shot?”", w = serifWidth(quote, 66, -1);
      printIn(() => {
        txt(quote, 960, 880 + oy, { screen: true, size: 66, fam: SERIF, italic: true, color: P.css.strong, align: "center", ls: -1 });
        txt("arjun", 960, 932 + oy, { screen: true, size: 22, color: P.css.dim, align: "center" });
      }, 960 - w / 2 - 20, 800 + oy, w + 40, 150, (gx) => (q * (w / C + 60) - (gx - (960 - w / 2) / C)) / 30);
    }
  }

  // =================================================================
  // 0:34  yes.
  // =================================================================

  function sYes(t, P, st) {
    resetCam(); TY = st.ty;
    const oy = TY * C;
    const p = inv(34.0, 34.55, t);
    if (t < 34.034) rect(0, 0, CW, CH, P.strong);
    const R = E.outCubic(p) * 720;
    if (p < 1) ring(480, 282, R, 6 + 30 * (1 - p), P.cell, 0.85 * (1 - p));
    for (let i = 0; i < 700; i++) {
      const x = hu(i * 5 + 11) * CW, y = hu(i * 5 + 12) * CH;
      if (Math.hypot(x - 480, y - 282) > R) continue;
      pt(x, y, P.tone("cell", 0.15 + 0.3 * hu(i * 5 + 13)));
    }
    const s = 1 + 0.12 * (1 - E.outBack(inv(34.0, 34.35, t), 2.2));
    txt("yes.", 960, 650 + oy, { screen: true, ghost: true, size: Math.round(240 * s), fam: SERIF, color: t < 34.034 ? P.css.paper : P.css.strong, align: "center", ls: -6 });
  }

  // =================================================================
  // 0:35  three years, one public cloud (the reel, fast)
  // =================================================================

  const MONTAGE = [
    { t0: 35, t1: 36, tau0: 2.5, k: 2.0, draw: sMetal, slug: "compute · a go control plane for qemu/kvm" },
    { t0: 36, t1: 37, tau0: 6.3, k: 1.7, draw: sCompute, slug: "380 vms · firecracker · live migration" },
    { t0: 37, t1: 38, tau0: 10.4, k: 1.0, draw: sStorage, slug: "block storage · spdk · nvme-of · a reconciler" },
    { t0: 38, t1: 39, tau0: 14.3, k: 1.2, draw: sK8s, slug: "managed kubernetes · csi · a karpenter provider" },
    { t0: 39, t1: 40, tau0: 16.3, k: 1.4, draw: sTooling, slug: "openapi from go types · sdk · cli · terraform" }
  ];

  // =================================================================
  // 0:40  postgres and a loop
  // =================================================================

  const LOOP = { cx: 480, cy: 270, r: 112 };
  const LOOP_K = 1.282;
  function loopU(t) {
    if (t < 41.5) return (t - 40.2) * LOOP_K;
    if (t < 41.85) return (41.5 - 40.2) * LOOP_K;
    return (41.5 - 40.2) * LOOP_K + (t - 41.85) * LOOP_K;
  }
  const loopNode = (f) => ({ x: LOOP.cx + LOOP.r * Math.sin(f * TAU), y: LOOP.cy - LOOP.r * Math.cos(f * TAU) });

  function sLoop(t, P, st) {
    resetCam(); TY = st.ty;
    const a = sstep(39.95, 40.3, t);
    for (let k = 0; k < 360; k += 2) { const n = loopNode(k / 360); pt(n.x, n.y, P.faint, 0.9 * a); }
    for (const f of [1 / 6, 1 / 2, 5 / 6]) {
      const n = loopNode(f), ang = f * TAU, tx = Math.cos(ang), ty = Math.sin(ang);
      line(n.x, n.y, n.x - tx * 7 - ty * 5, n.y - ty * 7 + tx * 5, P.dim, a);
      line(n.x, n.y, n.x - tx * 7 + ty * 5, n.y - ty * 7 - tx * 5, P.dim, a);
    }
    const D = loopNode(0), Rc = loopNode(1 / 3), Re = loopNode(2 / 3);
    const u = t >= 40.2 ? loopU(t) : -1;
    const near = (f) => u >= 0 && Math.abs(((u - f) % 1 + 1) % 1) < 0.04;
    const crashed = t >= 41.5 && t < 42.63;
    // postgres
    rect(D.x - 20, D.y - 12, D.x + 20, D.y + 12, P.paper);
    for (let k = 0; k < 120; k++) {
      const ang = (k / 120) * TAU, ex = D.x + Math.cos(ang) * 20, ey = Math.sin(ang) * 5;
      pt(ex, D.y - 12 + ey, P.cell, a);
      if (ey > 0) { pt(ex, D.y + 12 + ey, P.cell, a); pt(ex, D.y + ey, P.dim, a * 0.6); }
    }
    line(D.x - 20, D.y - 12, D.x - 20, D.y + 12, P.cell, a);
    line(D.x + 20, D.y - 12, D.x + 20, D.y + 12, P.cell, a);
    rect(D.x - 18, D.y - 6, D.x + 18, D.y + 12, near(0) ? P.strong : P.cell, (near(0) ? 1 : 0.2) * a);
    txt("desired state", D.x, D.y - 30, { size: 22, color: P.css.ink, align: "center", alpha: a });
    txt("postgres", D.x, D.y - 20, { size: 11, color: P.css.faint, align: "center", alpha: a });
    // reconciler
    rect(Rc.x - 18, Rc.y - 18, Rc.x + 18, Rc.y + 18, P.paper);
    const spin = t * 4;
    for (let k = 0; k < 90; k++) {
      const ang = spin + (k / 90) * TAU * 0.85;
      pt(Rc.x + Math.cos(ang) * 13, Rc.y + Math.sin(ang) * 13, near(1 / 3) || (t > 42.3 && t < 42.45) ? P.strong : P.cell, a);
    }
    const ah = spin + TAU * 0.85;
    rect(Rc.x + Math.cos(ah) * 13 - 2, Rc.y + Math.sin(ah) * 13 - 2, Rc.x + Math.cos(ah) * 13 + 2, Rc.y + Math.sin(ah) * 13 + 2, P.cell, a);
    txt("reconciler", Rc.x + 26, Rc.y + 5, { size: 22, color: P.css.ink, alpha: a });
    if (t > 42.3 && t < 42.7) txt("retry", Rc.x + 26, Rc.y + 18, { size: 11, color: P.css.dim });
    // reality
    const col = crashed ? P.accent : P.cell;
    rect(Re.x - 22, Re.y - 15, Re.x + 22, Re.y + 15, P.paper);
    box(Re.x - 22, Re.y - 15, Re.x + 22, Re.y + 15, col, a);
    for (let k = 0; k < 3; k++) line(Re.x - 16, Re.y - 8 + k * 7, Re.x + 8, Re.y - 8 + k * 7, P.dim, a);
    rect(Re.x + 12, Re.y - 9, Re.x + 16, Re.y - 5, near(2 / 3) ? P.strong : col, a);
    if (crashed) for (let d = -9; d <= 9; d++) { pt(Re.x + d, Re.y + d, P.accent); pt(Re.x + d, Re.y - d, P.accent); }
    txt("reality", Re.x - 30, Re.y + 5, { size: 22, color: crashed ? P.css.accent : P.css.ink, align: "right", alpha: a });
    if (crashed) txt("crashed mid-provision", Re.x - 30, Re.y + 18, { size: 11, color: P.css.accent, align: "right" });
    if (t >= 42.63) txt("converged", Re.x - 30, Re.y + 18, { size: 11, color: P.css.ink, align: "right" });
    // the token
    if (u >= 0) {
      for (let k = 1; k < 26; k++) { const n = loopNode(u - k * 0.006); pt(n.x, n.y, crashed ? P.accent : P.cell, 1 - k / 26); }
      const n = loopNode(u);
      const blink = crashed ? Math.floor(t * 10) % 2 === 0 : true;
      if (blink) rect(n.x - 2, n.y - 2, n.x + 2, n.y + 2, crashed ? P.accent : P.strong);
    }
    txt("postgres and a loop. again.", LOOP.cx, LOOP.cy + 4, { size: 11, color: P.css.faint, align: "center", alpha: sstep(40.4, 40.7, t) });
  }

  // =================================================================
  // 0:46  1 thing i love 2 do is overdo
  // =================================================================

  const TILES = [
    ["dbconsole", "a postgres workbench", "for web and macos"],
    ["cbmanager", "a native macos", "clipboard manager"],
    ["rig", "coding agents on my", "machines, from my phone"],
    ["tachyon", "an offline-first", "manga reader"],
    ["flickturn", "my kobo turns the page", "when i flick it"],
    ["lolwierd.com", "a sky that follows", "the sun over vadodara"]
  ];
  const tileT = (k) => 46.2 + k * 0.25;

  function tileIcon(k, cx, cy, t, P) {
    if (k === 0) {
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) box(cx - 26 + c * 12, cy - 30 + r * 9, cx - 15 + c * 12, cy - 22 + r * 9, r === 0 ? P.cell : P.dim);
      const hl = Math.floor(t * 4) % 3 + 1;
      rect(cx - 25, cy - 29 + hl * 9, cx + 9, cy - 24 + hl * 9, P.cell, 0.5);
      const g = [[cx - 18, cy + 18], [cx + 2, cy + 8], [cx + 20, cy + 24]];
      line(g[0][0], g[0][1], g[1][0], g[1][1], P.dim); line(g[1][0], g[1][1], g[2][0], g[2][1], P.dim);
      for (const [x, y] of g) disc(x, y, 3, P.cell);
    } else if (k === 1) {
      const slide = E.outCubic(inv(0, 0.35, (t % 1.2)));
      for (let j = 2; j >= 0; j--) {
        const off = j * 7 - (j === 0 ? (1 - slide) * 10 : 0);
        rect(cx - 22 + off, cy - 26 + j * 12, cx + 18 + off, cy - 4 + j * 12, P.paper);
        box(cx - 22 + off, cy - 26 + j * 12, cx + 18 + off, cy - 4 + j * 12, j === 0 ? P.cell : P.dim);
        rect(cx - 18 + off, cy - 20 + j * 12, cx + 6 + off, cy - 17 + j * 12, P.cell, 0.6);
      }
    } else if (k === 2) {
      box(cx - 14, cy - 26, cx + 14, cy + 26, P.cell);
      rect(cx - 10, cy - 18, cx - 6, cy - 16, P.cell);
      const sc = (t * 22) % 8;
      for (let j = 0; j < 5; j++) { const y = cy - 12 + j * 8 - sc; if (y < cy - 14 || y > cy + 20) continue; rect(cx - 10, y, cx - 10 + 6 + 14 * hu(j + Math.floor(t * 22 / 8) * 5), y + 2, P.cell, 0.8); }
      if (Math.floor(t * 3) % 2) rect(cx - 10, cy + 20, cx - 6, cy + 22, P.strong);
    } else if (k === 3) {
      const flip = (t % 0.9) / 0.9;
      box(cx - 26, cy - 20, cx - 2, cy + 20, P.cell);
      for (const [a0, a1, b0, b1] of [[-24, -4, -18, -2], [-24, -14, 0, 18], [-12, -4, 0, 18]]) box(cx + a0, cy + b0, cx + a1, cy + b1, P.dim);
      const w = 24 * Math.abs(Math.cos(flip * Math.PI));
      box(cx + 2, cy - 20, cx + 2 + w, cy + 20, P.cell);
      if (w > 8) rect(cx + 4, cy - 16, cx + w - 2, cy + 16, P.cell, 0.25);
    } else if (k === 4) {
      const ang = Math.sin(t * 5) * 0.22;
      const pts = [[-16, -24], [16, -24], [16, 24], [-16, 24]].map(([x, y]) => [cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang)]);
      for (let j = 0; j < 4; j++) line(pts[j][0], pts[j][1], pts[(j + 1) % 4][0], pts[(j + 1) % 4][1], P.cell);
      for (let j = 0; j < 4; j++) {
        const y = -14 + j * 8, x0 = -10, x1 = 10;
        line(cx + x0 * Math.cos(ang) - y * Math.sin(ang), cy + x0 * Math.sin(ang) + y * Math.cos(ang), cx + x1 * Math.cos(ang) - y * Math.sin(ang), cy + x1 * Math.sin(ang) + y * Math.cos(ang), P.dim);
      }
      for (let j = 0; j < 12; j++) { const a2 = -0.6 + j * 0.1; pt(cx + Math.cos(a2) * 30, cy - 8 + Math.sin(a2) * 30, P.cell, Math.abs(Math.sin(t * 5)) * (1 - j / 12)); }
    } else {
      const ridge = (x) => cy + 14 - 16 * Math.abs(Math.sin((x - cx) * 0.09 + 1.3)) - 6 * Math.sin((x - cx) * 0.21);
      for (let x = cx - 28; x <= cx + 28; x++) for (let y = Math.ceil(ridge(x)); y <= cy + 24; y++) pt(x, y, P.cell, 0.55);
      disc(cx + 12, cy - 14, 5, P.accent);
      for (let j = 0; j < 6; j++) if (Math.sin(t * 4 + j * 2) > 0.3) pt(cx - 24 + hu(j) * 30, cy - 26 + hu(j + 9) * 14, P.cell);
    }
  }

  function sOverdo(t, P, st) {
    resetCam(); TY = st.ty;
    TILES.forEach((tile, k) => {
      const tk = tileT(k), p = inv(tk, tk + 0.3, t);
      if (p <= 0) return;
      const s = E.outBack(p, 1.8);
      const col = k % 3, row = Math.floor(k / 3);
      const x0 = 186 + col * 204, y0 = 176 + row * 134, w = 180, h = 110;
      const cx = x0 + w / 2, cy = y0 + h / 2;
      const X0 = cx - (w / 2) * s, X1 = cx + (w / 2) * s, Y0 = cy - (h / 2) * s, Y1 = cy + (h / 2) * s;
      rect(X0, Y0, X1, Y1, P.paper);
      box(X0, Y0, X1, Y1, t - tk < 0.05 ? P.strong : P.cell);
      const ca = sstep(tk + 0.15, tk + 0.3, t);
      if (ca > 0) dissolve(() => tileIcon(k, x0 + 42, y0 + 55, t, P), ca);
      txt(tile[0], x0 + 80, y0 + 44, { size: 22, color: P.css.ink, alpha: ca });
      txt(tile[1], x0 + 80, y0 + 62, { size: 11, color: P.css.faint, alpha: ca });
      txt(tile[2], x0 + 80, y0 + 73, { size: 11, color: P.css.faint, alpha: ca });
    });
  }

  // =================================================================
  // 0:49  now
  // =================================================================

  const JOBS = [];
  ["build", "test", "lint", "e2e", "docker", "bench", "release", "deploy"].forEach((name, r) => {
    let s = 49.3 + r * 0.09 + 0.15 * hu(r * 7 + 1);
    while (s < 51.4) { const d = 0.45 + 0.4 * hu(r * 31 + Math.floor(s * 10)); JOBS.push({ r, name, s, d }); s += d + 0.12 + 0.2 * hu(r + s); }
  });
  const jobX = (t) => 220 + (t - 49.2) * 220;

  function sNow(t, P, st) {
    resetCam(); TY = st.ty;
    const a = sstep(49.0, 49.3, t), out = 1 - sstep(51.55, 51.85, t);
    ["build", "test", "lint", "e2e", "docker", "bench", "release", "deploy"].forEach((name, r) =>
      txt(name, 200, 140 + r * 30, { size: 22, color: P.css.dim, align: "right", alpha: a * out }));
    dissolve(() => {
      for (let r = 0; r < 8; r++) line(214, 136 + r * 30, 840, 136 + r * 30, P.faint, 0.5, 1);
      for (const j of JOBS) {
        if (t < j.s) continue;
        const y = 128 + j.r * 30, x0 = jobX(j.s), end = j.s + j.d, x1 = jobX(Math.min(t, end));
        const done = t >= end;
        const gone = done ? sstep(end + 0.25, end + 0.5, t) : 0;
        if (t - j.s < 0.06) { rect(x0 - 2, y - 2, x0 + 10, y + 16, P.strong); continue; }
        box(x0, y, x0 + 8, y + 14, P.cell, 1 - gone);
        rect(x0 + 10, y + 3, x1, y + 11, P.cell, (done ? 0.35 : 0.6) * (1 - gone * 0.7));
        if (done) {
          const cx = jobX(end) + 6, cy = y + 8;
          for (let d = 0; d < 4; d++) pt(cx - 3 + d, cy - 1 + d, P.cell);
          for (let d = 0; d < 7; d++) pt(cx + 1 + d, cy + 2 - d, P.cell);
        }
      }
      const px = jobX(t);
      line(px, 120, px, 372, P.strong, 0.9);
    }, a * out);
    txt("ci jobs", 214, 110, { size: 11, color: P.css.faint, alpha: a * out });
  }

  // =================================================================
  // the summit belongs to the reel; the stars print in with the range
  // =================================================================

  function starFade(i, t) {
    const d = 0.6 * hu(i * 7 + 11);
    return sstep(21.9 + d, 22.3 + d, t);
  }

  // =================================================================
  // scenes, whips and chrome
  // =================================================================

  const SCENES = [
    { t0: 0, t1: 3.5, draw: sTitle },
    { t0: 3.5, t1: 9.5, draw: sCollege },
    { t0: 9.5, t1: 12.5, draw: sGoal },
    { t0: 12.5, t1: 18, draw: sGate },
    { t0: 18, t1: 23.5, draw: sOracle },
    { t0: 23.5, t1: 28.5, draw: sHunt },
    { t0: 28.5, t1: 34, draw: sTicket },
    { t0: 34, t1: 35, draw: sYes },
    ...MONTAGE.map((m) => ({ t0: m.t0, t1: m.t1, slug: m.slug, draw: (t, P, st) => m.draw(m.tau0 + (t - m.t0) * m.k, P, st) })),
    { t0: 40, t1: 43, draw: sLoop },
    { t0: 43, t1: 46, draw: (t, P, st) => sPeople(17.85 + (t - 43) * 0.53, P, st) },
    { t0: 46, t1: 49, draw: sOverdo },
    { t0: 49, t1: 52, draw: sNow }
  ];
  const WHIP = { 3.5: 0.25, 9.5: 0.25, 12.5: 0.25, 18: 0.25, 23.5: 0.25, 28.5: 0.25, 35: 0.2, 36: 0.12, 37: 0.12, 38: 0.12, 39: 0.12, 40: 0.2, 43: 0.25, 46: 0.25, 49: 0.25, 52: 0.25 };
  const wipe = (T, h, x) => E.inOutExpo(inv(T - h, T + h, x));

  function sceneState(S, t) {
    const hin = WHIP[S.t0] || 0, hout = WHIP[S.t1] || 0;
    const a = S.t0 - hin, b = S.t1 + hout;
    if (t < a || t >= b) return null;
    let ty = 0, vel = 0;
    const dt = 1 / FPS;
    if (hin && t < S.t0 + hin) { ty = (wipe(S.t0, hin, t) - 1) * CH; vel = (wipe(S.t0, hin, t + dt) - wipe(S.t0, hin, t)) * CH; }
    else if (hout && t > S.t1 - hout) { ty = wipe(S.t1, hout, t) * CH; vel = (wipe(S.t1, hout, t + dt) - wipe(S.t1, hout, t)) * CH; }
    return { ty, vel };
  }

  const CHAPTERS = [
    { t0: 3.5, n: "2018", name: "svit, vasad" },
    { t0: 9.5, n: "2022", name: "graduation" },
    { t0: 12.5, n: "2022", name: "gate" },
    { t0: 18, n: "2022", name: "oracle free tier" },
    { t0: 23.5, n: "2023", name: "job hunt" },
    { t0: 28.5, n: "2023", name: "vaultci" },
    { t0: 35, n: "2023–26", name: "excloud" },
    { t0: 43, n: "2026", name: "handover" },
    { t0: 46, n: "always", name: "side projects" },
    { t0: 49, n: "2026", name: "warpbuild" },
    { t0: 52, n: "now", name: "vadodara" }
  ];

  const YEARS = [[0, 2018.55], [3.5, 2018.55], [9.5, 2022.45], [12.5, 2022.5], [18, 2022.8], [23.5, 2023.1], [28.5, 2023.42],
    [34, 2023.45], [35, 2023.46], [40, 2026.5], [43, 2026.62], [46, 2026.63], [49, 2026.68], [52, 2026.72], [60, 2026.73]];
  function yearAt(t) {
    for (let i = 1; i < YEARS.length; i++)
      if (t <= YEARS[i][0]) return lerp(YEARS[i - 1][1], YEARS[i][1], E.inOutSine(inv(YEARS[i - 1][0], YEARS[i][0], t)));
    return YEARS[YEARS.length - 1][1];
  }
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const TAPE = [[2018.55, "svit"], [2022.45, "graduated"], [2023.42, "vaultci"], [2026.7, "warpbuild"]];

  function chrome(t, P) {
    const a = sstep(3.5, 3.9, t) * (1 - sstep(53.7, 54.15, t));
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
    OC.beginPath(); OC.arc(960.5, 26.5, 7, 0, TAU); OC.moveTo(948.5, 26.5); OC.lineTo(972.5, 26.5); OC.moveTo(960.5, 14.5); OC.lineTo(960.5, 38.5); OC.stroke();
    OC.globalAlpha = 1;

    const label = (c, dy, al) => {
      txt(c.n, 64, 84 + dy, { screen: true, size: 22, color: P.css.faint, alpha: al });
      txt(c.name, 64 + tw(c.n, 22) + 22, 84 + dy, { screen: true, size: 22, color: P.css.ink, alpha: al });
    };
    let idx = 0;
    for (let i = 0; i < CHAPTERS.length; i++) if (t >= CHAPTERS[i].t0) idx = i;
    const nextI = CHAPTERS.findIndex((c) => c.t0 > t);
    const next = nextI >= 0 ? CHAPTERS[nextI] : null;
    const h = next ? WHIP[next.t0] || 0.2 : 0;
    if (next && t > next.t0 - h) {
      const p = wipe(next.t0, h, t);
      label(CHAPTERS[idx], p * 26, 1 - p);
      label(next, -(1 - p) * 26, p);
    } else label(CHAPTERS[idx], 0, 1);

    const tc = Math.min(t, 60 - 1 / FPS);
    const ff = Math.floor((tc % 1) * FPS + 1e-6), ss = Math.floor(tc);
    txt(`the long way up    00:${String(ss).padStart(2, "0")}:${String(ff).padStart(2, "0")}`, 1856, 84, { screen: true, size: 22, color: P.css.faint, align: "right" });
    txt("22.3072°n 73.1812°e", 1856, 1024, { screen: true, size: 22, color: P.css.faint, align: "right" });
    for (const S of SCENES) {
      if (!S.slug) continue;
      const al = pulse(S.t0 - 0.05, S.t0 + 0.1, S.t1 - 0.1, S.t1 + 0.05, t);
      if (al > 0) txt(S.slug, 64, 1024, { screen: true, size: 22, color: P.css.faint, alpha: al });
    }

    // the tape counts years now, not metres
    const yr = yearAt(t), X = 1848, CY = 540, K = 150;
    OC.fillStyle = P.css.faint;
    for (let m = Math.floor((yr - 2.7) * 12); m <= Math.ceil((yr + 2.7) * 12); m++) {
      const y = Math.round(CY - (m / 12 - yr) * K);
      const f = 1 - Math.pow(Math.abs(y - CY) / 380, 2);
      if (f <= 0) continue;
      const len = m % 12 === 0 ? 16 : m % 6 === 0 ? 9 : 4;
      OC.globalAlpha = a * f * 0.9;
      OC.fillRect(X - len, y, len, 1);
      if (m % 12 === 0 && Math.abs(y - CY) > 26) txt(String(m / 12), X - 22, y + 4, { screen: true, size: 11, color: P.css.faint, align: "right", alpha: f });
    }
    OC.globalAlpha = a * 0.5;
    OC.fillRect(X, CY - 380, 1, 760);
    for (const [y0, name] of TAPE) {
      const y = Math.round(CY - (y0 - yr) * K);
      const f = 1 - Math.pow(Math.abs(y - CY) / 380, 2);
      if (f <= 0) continue;
      OC.globalAlpha = a * f;
      OC.fillRect(X - 12, y, 12, 1);
      if (Math.abs(y - CY) > 26) txt(name, X - 64, y + 4, { screen: true, size: 11, color: P.css.dim, align: "right", alpha: f });
    }
    OC.globalAlpha = a;
    OC.fillStyle = P.css.accent;
    OC.beginPath(); OC.moveTo(X + 5, CY + 0.5); OC.lineTo(X + 15, CY - 5.5); OC.lineTo(X + 15, CY + 6.5); OC.closePath(); OC.fill();
    OC.globalAlpha = 1;
    const mo = Math.min(11, Math.floor((yr % 1) * 12 + 1e-6));
    txt(`${MONTHS[mo]} ${Math.floor(yr)}`, X - 22, CY + 8, { screen: true, size: 22, color: P.css.ink, align: "right" });
    TALPHA = saved;
  }

  // =================================================================
  // frame
  // =================================================================

  function drawAll(t, P, fb, oc) {
    FB = fb; OC = oc;
    oc.clearRect(0, 0, W, H);
    fb.fill(P.paper);
    const tau = t - OFFSET;
    if (P === NIGHT || tau < DAY_T0) {
      for (const S of SCENES) {
        const st = sceneState(S, t);
        if (!st) continue;
        layer.fill(0); buf = layer; resetCam();
        TALPHA = 1; OGHOST = st.vel * C;
        S.draw(t, P, st);
        OGHOST = 0; TALPHA = 1;
        composite(st.vel * 0.75);
      }
      calendar(t, P);
    }
    buf = layer;
    if (tau >= 21.75) { resetCam(); TALPHA = 1; OGHOST = 0; sSummit(tau, P); }
    buf = layer; resetCam(); TALPHA = 1; OGHOST = 0;
    narration(t, P);
    chrome(t, P);
  }

  const canvas = document.getElementById("film");
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
    const tau = t - OFFSET;
    if (tau < DAY_T0) {
      drawAll(t, NIGHT, frameN, ovNx);
      blit(frameN); ctx.drawImage(ovN, 0, 0);
      return;
    }
    if (tau >= DAY_T1 + 0.05) {
      drawAll(t, DAY, frameD, ovDx);
      blit(frameD); ctx.drawImage(ovD, 0, 0);
      return;
    }
    drawAll(t, NIGHT, frameN, ovNx);
    drawAll(t, DAY, frameD, ovDx);
    const r = dayR(tau), sx = SUN_X, sy = sunY(tau);
    const out = frameN;
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const i = y * CW + x, v = (r - Math.hypot(x - sx, y - sy)) / 90, th = THR[i];
        if (v > th) { out[i] = v - th < 0.1 ? DAY.accent : frameD[i]; maskU32[i] = 0xff000000; }
        else maskU32[i] = 0;
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

  const FILM_CUES = [];
  function buildFilmCues() {
    const RAW = CUES.slice();
    const c = (t, type, v = 0) => FILM_CUES.push({ t: +t.toFixed(4), type, v });
    c(0, "tick"); c(0.5, "tick");
    for (let k = 0; k < TITLE.length; k++) c(1.0 + k * 0.0625, "key", k);
    c(2.0, "title"); c(2.45, "sub");
    for (const T of Object.keys(WHIP)) c(+T - WHIP[T], WHIP[T] < 0.15 ? "cut" : "whip", +T);
    for (const n of NARR) c(n.t0, "line", n.k === "small" ? 0 : 1);
    for (const w of WINDOWS) c(winT(w), "window");
    c(5.5, "browser"); for (let k = 0; k < 7; k++) c(5.8 + k * 0.1, "row", k);
    c(7.4, "phones"); for (let r = 0; r < 6; r++) c(7.75 + r * 5 * 0.035, "cellrow", r); c(9.05, "shipped");
    c(10.0, "word"); c(10.4, "word"); c(10.3, "slab");
    BLOCKS.forEach((_, k) => c(blockT(k) + 0.22, "block", k));
    SUBJECTS.forEach((_, k) => c(subjT(k) + 0.22, "cram", k));
    c(15.95, "crack");
    TIERS.forEach((_, k) => c(tierT(k), "tier", k));
    for (let w = 0; w < 52; w++) c(calFill(w * 7), "week", w * 7 < 91 ? 0 : w * 7 < 240 ? 1 : 2);
    c(18.0, "pi"); BOOTLOG.forEach((_, k) => c(logT(k), "log", k));
    c(19.85, "server"); c(20.0, "server");
    SERVICES.forEach((row, s) => row.forEach((_, i) => c(chipT(s, i), "chip", s * 4 + i)));
    c(21.95, "mail"); c(22.15, "error"); c(22.95, "fixed");
    c(23.6, "me"); c(23.8, "reach"); c(25.2, "wall");
    for (let j = 0; j < 150; j++) c(sendT(j), "send", j);
    c(27.95, "reply"); c(28.32, "land");
    c(28.62, "card"); c(30.3, "day"); c(30.7, "day"); c(31.0, "strike");
    VMS.forEach((v, k) => c(v.t, "microvm", k));
    c(32.6, "quote"); c(33.75, "silence"); c(34.0, "yes");
    // the montage runs the reel's own events through each piece's time map
    const map = (m, tau) => m.t0 + (tau - m.tau0) / m.k;
    const inside = (m, t) => t >= m.t0 && t < m.t1;
    const [m1, m2, m3, m4, m5] = MONTAGE;
    for (let k = 0; k < 16; k++) { const t = map(m1, 2.5 + k * 0.125); if (inside(m1, t)) c(t, "boot", k); }
    for (const r of RAW) {
      if (r.type === "split") { const t = map(m2, r.t); if (inside(m2, t)) c(t, "split", r.v); }
      if (r.type === "reconcile") { const t = map(m3, r.t); if (inside(m3, t)) c(t, "reconcile"); }
    }
    for (const p of PODS) { const t = map(m4, p.t); if (inside(m4, t)) c(t, "pod", p.node); }
    { const t = map(m4, EVICT.t); if (inside(m4, t)) c(t, "evict"); }
    { const t = map(m4, 15.3); if (inside(m4, t)) c(t, "node"); }
    for (const b of BOXES) { const t = map(m5, b.tf); if (inside(m5, t)) c(t, "fill", b.r); }
    for (let n = 0; n < 12; n++) {
      for (const [f, name] of [[0, "desired"], [1 / 3, "reconciler"], [2 / 3, "reality"]]) {
        const u = n + f;
        const t = u <= (41.5 - 40.2) * LOOP_K ? 40.2 + u / LOOP_K : 41.85 + (u - (41.5 - 40.2) * LOOP_K) / LOOP_K;
        if (t >= 40.2 && t < 43 && !(t >= 41.5 && t < 41.85)) c(t, "loop", name === "desired" ? 0 : name === "reconciler" ? 1 : 2);
      }
    }
    c(41.5, "crash"); c(42.63, "converge");
    const pm = (tau) => 43 + (tau - 17.85) / 0.53;
    c(pm(17.95), "gather");
    for (const s of STATS) c(pm(s.t), "slam");
    TILES.forEach((_, k) => c(tileT(k), "tile", k));
    for (const j of JOBS) { c(j.s, "job", j.r); c(j.s + j.d, "pass", j.r); }
    c(RIDGE_T0 + OFFSET, "hit", 2); c(RIDGE_T0 + OFFSET, "ridge");
    c(22.42 + OFFSET, "headline"); c(22.82 + OFFSET, "headline"); c(24.05 + OFFSET, "header");
    c(24.9 + OFFSET, "sunrise"); c(DAY_T0 + OFFSET, "daybreak");
    for (let k = 0; k < 12; k++) c(27.05 + (k * 0.55) / 12 + OFFSET, "type", k);
    for (let b = 28.1; b < 30; b += 0.5) c(b + OFFSET, "blink");
    c(57.75, "closing");
    FILM_CUES.sort((a, b) => a.t - b.t);
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
    buildFilmCues();
  }

  const params = new URLSearchParams(location.search);
  const ready = init();
  window.film = { ready, render, cues: () => FILM_CUES, fps: FPS, duration: DUR };

  if (params.has("capture")) { document.body.classList.add("capture"); return; }

  ready.then(() => {
    const audio = document.getElementById("score");
    let playing = false, start = 0, offset = params.has("t") ? parseFloat(params.get("t")) : 0;
    const now = () => (playing ? (audio.readyState > 1 && !audio.paused ? audio.currentTime : (performance.now() - start) / 1000) : offset);
    render(offset);
    const loop = () => {
      if (!playing) return;
      const t = now();
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
        offset = clamp(offset + (e.code === "ArrowRight" ? 2 : -2), 0, DUR);
        render(offset); if (was) play();
      }
    });
  });
})();
