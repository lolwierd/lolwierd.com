// the long way up: a two minute film for lolwierd.com, in one shot.
//
// A dot walks and the ground appears under it. The ground is the skyline of
// the range, mirrored, the way a plate is cut: the college years are the first
// small rises, the gate year is flat, the job hunt is the valley, and the long
// climb after "yes." is the three years at excloud, with the machine he built
// filling the mountain under his feet from the bottom up. At the end the camera
// pulls back until the line he walked is the whole ridge, and a press prints
// it the right way round, onto paper, as the front page.
//
// render(t) is a pure function of time; cues() is every event it draws.

(() => {
  "use strict";

  const W = 1920, H = 1080, C = 2, CW = 960, CH = 540, FPS = 60, DUR = 120;
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
  // 08  summit
  // =================================================================

  const PRINT_LEAD = 1.5;
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
      const age = t - tp - 0.03 + PRINT_LEAD;
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
    const lineA = 1 - sstep(23.0, 23.8, t + PRINT_LEAD);
    if (lineA > 0) {
      let prev = null;
      for (let x = 0; x < Math.min(CW, hx); x++) {
        const y = Math.round(RIDGE[x]);
        if (prev !== null) for (let yy = Math.min(prev, y); yy <= Math.max(prev, y); yy++) pS(x, yy, P.strong, lineA);
        else pS(x, y, P.strong, lineA);
        prev = y;
      }
    }
    if (hx > 0 && hx < CW && !PRINT_LEAD) {
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
  // THE ASCENT
  //
  // One shot. A dot walks, and the ground appears under it as it goes. The
  // ground is the skyline of the range, mirrored, because that is how a plate
  // is cut: everything he walked is engraved backwards, and at the end the
  // press prints it the right way round, onto paper, as the front page.
  // =================================================================

  const DAY_OFFSET = 88.5; // film time = the reel's summit clock + this

  const scratch = new Uint32Array(CW * CH);
  // draw fn somewhere private, then print it through the dither at density d
  function dissolve(fn, d) {
    if (d <= 0.001) return;
    if (d >= 0.999) { fn(); return; }
    const saved = buf, savedA = TALPHA;
    buf = scratch; scratch.fill(0); TALPHA = savedA * d;
    fn();
    buf = saved; TALPHA = savedA;
    for (let i = 0; i < scratch.length; i++) { const v = scratch[i]; if (v && d > THR[i]) buf[i] = v; }
  }

  let PATH = null, PATHI = null, TIERS_M = null;
  const PASS = new Float32Array(CW + 1);
  const pathY = (x) => {
    x = clamp(x, 0, CW - 1);
    const i = Math.floor(x), f = x - i;
    return lerp(PATH[i], PATH[Math.min(CW - 1, i + 1)], f);
  };

  function buildMirror(img) {
    PATH = new Float32Array(CW);
    PATHI = new Int32Array(CW);
    for (let x = 0; x < CW; x++) { PATH[x] = RIDGE[CW - 1 - x]; PATHI[x] = RIDGEI[CW - 1 - x]; }
    const cv = document.createElement("canvas"); cv.width = CW; cv.height = CH;
    const g = cv.getContext("2d", { willReadFrequently: true });
    g.translate(CW, 0); g.scale(-1, 1);
    g.drawImage(img, PHOTO.x, PHOTO.y, 3000 * PHOTO.s, 2000 * PHOTO.s);
    const d = g.getImageData(0, 0, CW, CH).data;
    const pn = new Float32Array(CW * CH);
    for (let i = 0; i < CW * CH; i++) pn[i] = terrainPaper(0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2], true);
    TIERS_M = atkinson(pn, PATHI);
  }

  // ---------------------------------------------------------------- walking

  const WALK = [
    [0, 0], [2.0, 0], [10, 44], [26, 184], [34, 214], [40.3, 244], [43.4, 247], [48, 270], [58, 331],
    [69.6, 378], [70.6, 382], [78.0, 383], [86.3, 505], [88.2, 528], [91, 548], [96, 690], [100.5, 820], [105.6, 952], [200, 952]
  ];
  function linX(t) {
    if (t <= WALK[0][0]) return WALK[0][1];
    for (let i = 1; i < WALK.length; i++) if (t <= WALK[i][0]) return lerp(WALK[i - 1][1], WALK[i][1], inv(WALK[i - 1][0], WALK[i][0], t));
    return WALK[WALK.length - 1][1];
  }
  // a box filter over the keyframes, so the dot eases between speeds instead of
  // snapping; the dot is the one thing on screen the eye never leaves
  function walkX(t) { let s = 0; for (let k = 0; k < 9; k++) s += linX(t - 0.4 + k * 0.1); return s / 9; }
  const speedAt = (t) => (walkX(t + 0.03) - walkX(t - 0.03)) / 0.06;

  function buildPass() {
    let x = 0;
    for (let t = 0; t <= 110; t += 1 / 240) {
      const w = walkX(t);
      while (x <= CW && x <= w) PASS[x++] = t;
    }
    while (x <= CW) PASS[x++] = 1e9;
  }
  const passAt = (x) => PASS[clamp(Math.round(x), 0, CW)];

  const ZOOM = [[0, 40, "hold"], [1.5, 40, "hold"], [4.5, 6, "expr"], [59, 6, "hold"], [72, 8.2, "sine"], [78.0, 8.4, "sine"], [79.3, 5, "expr"], [106, 5, "hold"]];
  const PULL0 = 106, PULL1 = 111;
  const pullE = (t) => E.inOutCubic(inv(PULL0, PULL1, t));
  function zoomAt(t) {
    if (t >= PULL0) return Math.pow(5, 1 - pullE(t));
    for (let i = 1; i < ZOOM.length; i++) {
      const [t1, z1, kind] = ZOOM[i], [t0, z0] = ZOOM[i - 1];
      if (t <= t1) {
        const p = inv(t0, t1, t);
        const e = kind === "expr" ? EXPR(p) : kind === "sine" ? E.inOutSine(p) : p;
        return z0 * Math.pow(z1 / z0, e);
      }
    }
    return 5;
  }

  function camAt(t) {
    const z = zoomAt(t);
    let cx = 0, cy = 0;
    for (let k = 0; k < 6; k++) { const x = walkX(t - k * 0.1); cx += x; cy += pathY(x); }
    cx /= 6; cy /= 6;
    const dip = pulse(43.6, 45.2, 46.9, 48.4, t);
    const f = t >= PULL0 ? pullE(t) : 0;
    return { z, cx, cy, sx: lerp(360, cx, f), sy: lerp(272 - 165 * E.inOutSine(dip), cy, f), f };
  }
  function applyCam(c) { TS = c.z; OX = c.cx; OY = c.cy; TX = c.sx - c.cx; TY = c.sy - c.cy; }
  const scrX = (c, x) => (x - c.cx) * c.z + c.sx;
  const scrY = (c, y) => (y - c.cy) * c.z + c.sy;
  const worldX = (c, s) => (s - c.sx) / c.z + c.cx;
  const worldY = (c, s) => (s - c.sy) / c.z + c.cy;

  const GROUND = new Float32Array(CW);
  const GROUNDX = new Float32Array(CW);

  // ---------------------------------------------------------------- the words

  const WORDS = [
    { t0: 3.0, t1: 9.3, s: "the long way up", k: "title" },
    { t0: 3.7, t1: 9.3, s: "ayaan retiwala", k: "sub" },
    { t0: 10.2, t1: 13.6, s: "2018. computer engineering at svit, vasad." },
    { t0: 13.9, t1: 17.6, s: "i ran web and design for the college fest." },
    { t0: 18.2, t1: 22.0, s: "then the college asked us to build their app." },
    { t0: 22.3, t1: 26.0, s: "a year and a half later, it shipped." },
    { t0: 28.0, t1: 33.6, s: "after college, one goal:", k: "small" },
    { t0: 29.3, t1: 33.6, s: "build the things", k: "big", row: 0 },
    { t0: 29.8, t1: 33.6, s: "other people build on.", k: "big", row: 1 },
    { t0: 35.0, t1: 39.4, s: "2022. a year of full-time gate prep." },
    { t0: 39.8, t1: 43.2, s: "three months in, cramming stopped working." },
    { t0: 43.6, t1: 47.6, s: "so i went under the hood instead." },
    { t0: 48.6, t1: 51.8, s: "a raspberry pi. linux. go." },
    { t0: 52.1, t1: 57.4, s: "two free oracle arm servers. i self-hosted everything," },
    { t0: 54.6, t1: 57.4, s: "even my own mail.", row: 1 },
    { t0: 59.0, t1: 62.2, s: "i thought i was ready." },
    { t0: 62.5, t1: 65.7, s: "i couldn't even get interviews." },
    { t0: 66.0, t1: 69.6, s: "so i applied to everything." },
    { t0: 74.4, t1: 77.6, s: "2023. one reply: a frontend role at vaultci." },
    { t0: 76.2, t1: 77.72, s: "“want to give it a shot?”", k: "quote" },
    { t0: 76.55, t1: 77.72, s: "arjun, two days in", k: "attrib" },
    { t0: 78.0, t1: 80.3, s: "yes.", k: "yes" },
    { t0: 80.6, t1: 85.6, s: "three years building a public cloud," },
    { t0: 82.6, t1: 85.6, s: "from the hypervisor up.", row: 1 },
    { t0: 86.2, t1: 88.0, s: "arjun reviewed everything i built." },
    { t0: 88.2, t1: 91.2, s: "design for the scale you have." },
    { t0: 89.2, t1: 91.2, s: "know where it breaks.", row: 1 },
    { t0: 96.2, t1: 100.2, s: "1 thing i love 2 do is overdo." },
    { t0: 100.6, t1: 105.4, s: "now: the infrastructure behind warpbuild's ci runners." }
  ];

  // Words hang in the sky and drift with the camera at a third of its speed,
  // so they read as far away rather than stuck to the glass.
  const skyShift = (t) => { const c = camAt(t); return c.cx * c.z; };

  function words(t, P) {
    for (const w of WORDS) {
      if (t < w.t0 || t > w.t1) continue;
      const k = w.k || "line";
      const drift = -(skyShift(t) - skyShift(w.t0)) * C * (k === "line" || k === "small" ? 0.34 : 0.14);
      let size, fam, color, x, y, align = "left", italic = false, ls = 0;
      if (k === "line") { size = 44; fam = SERIF; color = P.css.strong; x = 560 + drift; y = 150 + (w.row || 0) * 56; ls = -0.5; }
      else if (k === "small") { size = 22; fam = MONO; color = P.css.dim; x = 560 + drift; y = 150; }
      else if (k === "big") { size = 92; fam = SERIF; color = P.css.strong; x = 960 + drift; y = 330 + (w.row || 0) * 100; align = "center"; ls = -2; }
      else if (k === "title") { size = 132; fam = SERIF; color = P.css.strong; x = 960 + drift; y = 380; align = "center"; ls = -3; }
      else if (k === "sub") { size = 22; fam = MONO; color = P.css.dim; x = 960 + drift; y = 440; align = "center"; }
      else if (k === "quote") { size = 72; fam = SERIF; color = P.css.strong; x = 960 + drift; y = 360; align = "center"; italic = true; ls = -1; }
      else if (k === "attrib") { size = 22; fam = MONO; color = P.css.dim; x = 960 + drift; y = 416; align = "center"; }
      else { // yes.
        const s = 1 + 0.14 * (1 - E.outBack(inv(78.0, 78.35, t), 2.2));
        const fade = 1 - sstep(79.9, 80.3, t);
        txt("yes.", 960 + drift, 470, { screen: true, size: Math.round(270 * s), fam: SERIF, color: t < 78.034 ? P.css.paper : P.css.strong, align: "center", ls: -7, alpha: fade });
        continue;
      }
      OC.font = `${italic ? "italic " : ""}${size}px ${fam}`;
      OC.letterSpacing = ls + "px";
      const wd = OC.measureText(w.s).width;
      const x0 = align === "center" ? x - wd / 2 : x;
      const pin = (t - w.t0) / (size > 60 ? 0.6 : 0.4), pout = (w.t1 - t) / 0.22;
      printIn(() => txt(w.s, x, y, { screen: true, size, fam, italic, color, align, ls }),
        x0 - 12, y - size - 8, wd + 30, size * 1.35 + 16,
        (gx) => Math.min((pin * (wd / C + 60) - (gx - x0 / C)) / 30, pout * 1.15));
    }
  }

  // the tag that walks with him
  const TAGS = [[2, "2018"], [10, "2018 · svit"], [28, "2022"], [34, "2022 · gate"], [48, "2022 · oracle free tier"], [58, "2023 · job hunt"],
    [74, "2023 · vaultci"], [78, "2023 · excloud"], [100.5, "2026 · warpbuild"], [105.6, "now"]];
  const YEARS = [[10, 2018.6], [26, 2022.4], [34, 2022.5], [48, 2022.8], [70, 2023.3], [78, 2023.45], [100.5, 2026.62], [106, 2026.72]];
  function tagAt(t) {
    let s = "";
    for (const [t0, l] of TAGS) if (t >= t0) s = l;
    if (t >= 10 && t < 105.6 && s.includes("·")) {
      let y = YEARS[0][1];
      for (let i = 1; i < YEARS.length; i++) if (t >= YEARS[i - 1][0]) y = lerp(YEARS[i - 1][1], YEARS[i][1], inv(YEARS[i - 1][0], YEARS[i][0], t));
      s = s.replace(/^\d{4}/, String(Math.floor(y)));
    }
    if (t >= 34 && t < 48) s += ` · day ${Math.max(1, Math.round(inv(214, 270, walkX(t)) * 270))}`;
    return s;
  }

  // ---------------------------------------------------------------- the sky

  const SKY = []; // {x, y, b, t0, kind}
  const NUM_LIFT = -80;
  function buildSky() {
    const rnd = mulberry(952);
    const seat = () => { const x = rnd() * CW; const y = 8 + (PATH[Math.floor(x)] - 22) * Math.pow(rnd(), 1.3); return [x, y]; };
    for (let i = 0; i < 160; i++) { const [x, y] = seat(); SKY.push({ x, y, b: 0.18 + 0.4 * Math.pow(rnd(), 2), t0: 2.5 + rnd() * 5, kind: "old" }); }
    for (let i = 0; i < 4000; i++) {
      const [x, y] = seat();
      const cls = rnd();
      SKY.push({ x, y, b: cls < 0.05 ? 1 : cls < 0.2 ? 0.5 : 0.16, i, kind: "account", r1: rnd(), r2: rnd(), r3: rnd() });
    }
  }
  const APP_STAR = { x: 610, y: 150 };
  function skyOff(c) {
    const k = 1 - c.f;
    return [-0.05 * c.cx * c.z * k, -0.05 * (c.cy - 330) * c.z * k];
  }
  const wrapX = (x) => ((x % CW) + CW) % CW;

  function accountPos(s, t, c, dot) {
    const [ox, oy] = skyOff(c);
    const nx = NUM[s.i * 2], ny = NUM[s.i * 2 + 1] + NUM_LIFT;
    const a0 = 91.0 + 0.55 * s.r1, a = EXPR(inv(a0, a0 + 1.1, t));
    const b0 = 94.0 + 0.35 * s.r2, b = EXPR(inv(b0, b0 + 1.4, t));
    const sx = wrapX(s.x + ox), sy = s.y + oy;
    if (b > 0) {
      const sw = Math.sin(Math.PI * b) * 70 * (s.r3 - 0.5);
      return [lerp(nx, sx, b) + sw, lerp(ny, sy, b) - sw * 0.4, b, 2];
    }
    const hx = dot.x + (s.r2 - 0.5) * 300, hy = dot.y + 20 + s.r3 * 180;
    const jit = sstep(0.95, 1, a);
    return [lerp(hx, nx, a) + (vnoise(s.i * 0.13, t * 2.2) - 0.5) * 1.4 * jit, lerp(hy, ny, a) + (vnoise(s.i * 0.13 + 50, t * 2.2) - 0.5) * 1.4 * jit, a, 1];
  }

  function drawSky(t, P, c, dot) {
    const [ox, oy] = skyOff(c);
    const occluded = (x, y) => { const s = clamp(Math.floor(x), 0, CW - 1); return y >= GROUND[s] - 1; };
    for (const s of SKY) {
      if (s.kind === "old") {
        if (t < s.t0) continue;
        const x = wrapX(s.x + ox), y = s.y + oy;
        if (occluded(x, y)) continue;
        const tw = 0.65 + 0.35 * Math.sin(t * (2 + 4 * hu(Math.floor(s.x * 7))) + s.y);
        pS(Math.floor(x), Math.floor(y), P.tone("cell", s.b * tw * sstep(s.t0, s.t0 + 0.6, t)));
        continue;
      }
      if (t < 90.9) continue;
      const [x, y, p, phase] = accountPos(s, t, c, dot);
      if (phase === 1 && p <= 0) continue;
      if (phase === 2 && p >= 0.999) {
        if (occluded(x, y)) continue;
        const tw = 0.62 + 0.38 * Math.sin(t * (2.5 + 5 * s.r1) + s.r2 * TAU);
        pS(Math.floor(x), Math.floor(y), P.tone("cell", s.b * tw));
        continue;
      }
      const [x2, y2] = accountPos(s, t - 1 / 60, c, dot);
      const bright = phase === 2 ? lerp(1, s.b, sstep(0.8, 1, p)) : 1;
      streakS(x, y, x - x2, y - y2, P.tone("cell", bright), 20);
    }
    // the first thing he shipped stays up there
    if (t >= 23.9) {
      const x = wrapX(APP_STAR.x + ox), y = APP_STAR.y + oy;
      if (!occluded(x, y)) {
        const b = 0.8 + 0.2 * Math.sin(t * 3);
        pS(Math.floor(x), Math.floor(y), P.tone("strong", b));
        if (Math.sin(t * 1.1) > 0.6) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) pS(Math.floor(x) + dx, Math.floor(y) + dy, P.tone("cell", 0.4));
      }
    }
  }

  // ---------------------------------------------------------------- college

  function drawCollege(t, P, c, dot) {
    const [ox, oy] = skyOff(c);
    // friends walk with him, then peel off
    for (let i = 0; i < 5; i++) {
      const join = 10.6 + i * 0.3, leave = 25.6 + i * 0.35;
      if (t < join || t > leave + 1.4) continue;
      const off = [-7, -4, 3.5, 6, -10][i];
      const x = walkX(t) + off;
      const up = t > leave ? E.inQuad(inv(leave, leave + 1.4, t)) * (18 + 6 * i) : 0;
      const side = t > leave ? E.inQuad(inv(leave, leave + 1.4, t)) * (i - 2) * 8 : 0;
      const bob = speedAt(t) > 2 && Math.floor(walkX(t) / 1.2 + i) % 2 ? -1 : 0;
      const sx = scrX(c, x + side), sy = scrY(c, pathY(x) - up) - 3 + bob;
      const a = sstep(join, join + 0.3, t) * (1 - sstep(leave + 0.6, leave + 1.4, t));
      fillS(Math.round(sx - 1), Math.round(sy - 1), Math.round(sx + 1), Math.round(sy + 1), P.cell, a * 1.02);
    }
    // the fest: a burst in the sky
    const fa = sstep(13.9, 14.3, t) * (1 - sstep(17.2, 17.8, t));
    if (fa > 0) {
      const cx = 590 + ox * 2, cy = 150 + oy * 2, R = EXPR(inv(13.9, 14.7, t)) * 78;
      for (let y = Math.floor(cy - R); y <= cy + R; y++)
        for (let x = Math.floor(cx - R); x <= cx + R; x++) {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
          if (r > R) continue;
          const a = Math.atan2(dy, dx);
          const rays = Math.pow(Math.max(0, Math.cos(a * 11 + t * 0.9)), 8) * (1 - r / (R + 1));
          const core = Math.exp(-r / 16);
          pS(x, y, P.cell, fa * Math.min(1, core + rays * 0.9));
        }
      txt("the college fest", (cx) * C, (cy + R + 18) * C, { screen: true, size: 22, color: P.css.dim, align: "center", alpha: fa });
    }
    // the app, assembled in the sky, then shipped into it
    if (t >= 18.2 && t < 24.4) {
      const cx = APP_STAR.x + ox * 1.0, cy = APP_STAR.y + oy;
      const s = 1 - E.inExpo(inv(23.2, 23.9, t));
      const w = 44 * s, h = 84 * s;
      const draw = inv(18.3, 18.9, t);
      if (s > 0.02) {
        const per = 2 * (w + h);
        let left = draw * per;
        const seg = (ax, ay, bx, by) => { const len = Math.hypot(bx - ax, by - ay); if (left <= 0) return; const f = Math.min(1, left / len); lineS(ax, ay, ax + (bx - ax) * f, ay + (by - ay) * f, P.cell); left -= len; };
        seg(cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2); seg(cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
        seg(cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2); seg(cx - w / 2, cy + h / 2, cx - w / 2, cy - h / 2);
        for (let r = 0; r < 6; r++)
          for (let q = 0; q < 4; q++) {
            const tf = 18.95 + (r * 4 + q) * 0.1;
            if (t < tf) continue;
            const x0 = cx - w / 2 + (5 + q * 9) * s, y0 = cy - h / 2 + (10 + r * 11) * s;
            if (t - tf < 0.05) fillS(Math.round(x0), Math.round(y0), Math.round(x0 + 7 * s), Math.round(y0 + 9 * s), P.strong, 1);
            else fillS(Math.round(x0), Math.round(y0), Math.round(x0 + 7 * s), Math.round(y0 + 9 * s), P.cell, 0.2 + 0.6 * hu(r * 7 + q));
          }
        txt("svit cms app · ios + android", cx * C, (cy + h / 2 + 16) * C, { screen: true, size: 22, color: P.css.dim, align: "center", alpha: sstep(19.1, 19.4, t) * (1 - sstep(23.0, 23.3, t)) });
      }
      if (t > 23.9) {
        const r = (t - 23.9) * 90;
        ringS(cx, cy, r, 1.5, P.strong, 1 - r / 45);
      }
    }
  }

  function streakS(x, y, vx, vy, c, len, d = 1) {
    const sp = Math.hypot(vx, vy), n = Math.min(len, Math.ceil(sp));
    pS(Math.floor(x), Math.floor(y), c, d);
    for (let k = 1; k <= n; k++) pS(Math.floor(x - (vx / sp) * k), Math.floor(y - (vy / sp) * k), c, d * (1 - k / (n + 1)));
  }
  const quad = (a, c, b, e) => ({
    x: (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * c.x + e * e * b.x,
    y: (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * c.y + e * e * b.y
  });
  function lineS(x0, y0, x1, y1, c, d = 1) {
    let a = Math.round(x0), b = Math.round(y0);
    const e = Math.round(x1), f = Math.round(y1);
    const dx = Math.abs(e - a), dy = -Math.abs(f - b), sx = a < e ? 1 : -1, sy = b < f ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      pS(a, b, c, d);
      if (a === e && b === f) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; a += sx; }
      if (e2 <= dx) { err += dx; b += sy; }
    }
  }
  function ringS(cx, cy, r, th, c, d) {
    if (d <= 0) return;
    for (let y = Math.floor(cy - r - th); y <= cy + r + th; y++)
      for (let x = Math.floor(cx - r - th); x <= cx + r + th; x++)
        if (Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r) <= th) pS(x, y, c, d);
  }

  // ---------------------------------------------------------------- gate

  const HOOD = [["registers", 0.8], ["cache", 0.6], ["memory", 0.42], ["disk", 0.27], ["network", 0.15]];

  function drawGate(t, P, c, dot) {
    // a tick under every day he walked
    for (let x = 214; x <= Math.min(walkX(t), 270); x += 1.5) {
      const s = Math.round(scrX(c, x)), g = GROUND[clamp(s, 0, CW - 1)];
      if (s < 0 || s >= CW || g > 1e8) continue;
      const rust = x > 236 && x < 250 && t > 40.2 && t < 44.5;
      for (let k = 1; k <= 4; k++) pS(s, Math.round(g) + k, rust ? P.accent : P.cell, k < 4 ? 1 : 0.5);
    }
    // under the hood: how a machine actually works, printed as strata
    const ha = sstep(44.2, 44.6, t) * (1 - sstep(47.4, 48.4, t));
    if (ha <= 0) return;
    const bandH = 8 * c.z;
    for (let s = 0; s < CW; s++) {
      const g = GROUND[s];
      if (g > 1e8) continue;
      for (let k = 0; k < HOOD.length; k++) {
        const tk = 44.3 + k * 0.22;
        if (t < tk) continue;
        const y0 = Math.round(g + 30 + k * bandH), y1 = Math.round(g + 30 + (k + 1) * bandH - 4);
        const reveal = (t - tk) / 0.4 * 400 - Math.abs(s - dot.x);
        if (reveal <= 0) continue;
        for (let y = y0; y < y1; y++) pS(s, y, y === y0 ? P.cell : P.tone("cell", 0.7), (y === y0 ? 0.9 : HOOD[k][1]) * ha * Math.min(1, reveal / 40));
      }
    }
    HOOD.forEach(([name], k) => {
      const tk = 44.3 + k * 0.22;
      const s = Math.round(dot.x + 70), g = GROUND[clamp(s, 0, CW - 1)];
      if (g > 1e8) return;
      chip(name, ix(s), iy(g + 30 + (k + 0.5) * bandH + 4), { size: 22, color: P.css.ink, bg: P.css.paper, alpha: ha * sstep(tk + 0.1, tk + 0.3, t) });
    });
  }

  // ---------------------------------------------------------------- oracle

  const PROPS = [
    { x: 283, w: 12, d0: 6, d1: 12, name: "raspberry pi", sub: "", kind: "pi" },
    { x: 301, w: 14, d0: 8, d1: 14, name: "oracle arm", sub: "4 ocpu · 24 gb · free", kind: "srv" },
    { x: 318, w: 14, d0: 8, d1: 14, name: "oracle arm", sub: "caddy · tailscale · plex · mail", kind: "srv" }
  ];
  function drawOracle(t, P, c) {
    for (const p of PROPS) {
      const ta = passAt(p.x) - 0.9;
      if (t < ta || t > 60) continue;
      const a = sstep(ta, ta + 0.45, t) * (1 - sstep(58.5, 60, t));
      const gy = pathY(p.x + p.w / 2);
      const x0 = scrX(c, p.x), x1 = scrX(c, p.x + p.w), y0 = scrY(c, gy + p.d0), y1 = scrY(c, gy + p.d1);
      dissolve(() => {
        fillS(Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), P.paper, 1);
        hS(Math.round(x0), Math.round(x1) - 1, Math.round(y0), P.cell); hS(Math.round(x0), Math.round(x1) - 1, Math.round(y1) - 1, P.cell);
        vS(Math.round(x0), Math.round(y0), Math.round(y1) - 1, P.cell); vS(Math.round(x1) - 1, Math.round(y0), Math.round(y1) - 1, P.cell);
        if (p.kind === "pi") {
          for (let k = 0; k < 10; k++) pS(Math.round(x0 + 6 + k * 6), Math.round(y0 + 4), P.cell);
          fillS(Math.round(x0 + 18), Math.round(y0 + 12), Math.round(x0 + 38), Math.round(y0 + 30), P.cell, 0.5);
        } else {
          for (let k = 0; k < 4; k++) { const bx = Math.round(x0 + 6 + k * 9); hS(bx, bx + 6, Math.round(y0 + 12), P.dim); hS(bx, bx + 6, Math.round(y1 - 8), P.dim); vS(bx, Math.round(y0 + 12), Math.round(y1 - 8), P.dim); vS(bx + 6, Math.round(y0 + 12), Math.round(y1 - 8), P.dim); }
          for (let k = 0; k < 3; k++) if (Math.floor(t * 5 + k * 1.7 + p.x) % 3) fillS(Math.round(x1 - 12), Math.round(y0 + 8 + k * 8), Math.round(x1 - 8), Math.round(y0 + 12 + k * 8), P.strong, 1);
        }
        // a wire up to the surface, and traffic on it
        const wx0 = Math.round((x0 + x1) / 2), gs = scrY(c, gy);
        for (let y = Math.round(gs) + 2; y < y0; y += 2) pS(wx0, y, P.dim);
        for (let q = 0; q < 2; q++) {
          const ph = ((t * 1.3 + q * 0.5 + p.x * 0.01) % 1);
          const yy = lerp(y0, gs, ph);
          fillS(wx0 - 1, Math.round(yy) - 1, wx0 + 2, Math.round(yy) + 2, P.strong, 1);
        }
      }, a);
      const lx = (x0 + x1) / 2 * C, ly = y1 * C + 26;
      txt(p.name, lx, ly, { screen: true, size: 22, color: P.css.ink, align: "center", alpha: a });
      if (p.sub) txt(p.sub, lx, ly + 22, { screen: true, size: 11, color: P.css.dim, align: "center", alpha: a });
    }
  }

  // ---------------------------------------------------------------- job hunt

  const FOGW = 480, FOGH = 270;
  const FOG = new Float32Array(FOGW * FOGH);
  function drawFog(t, P, c, dot) {
    const amt = sstep(59.5, 68.5, t);
    if (amt <= 0 || t > 80.2) return;
    const R = t >= 78 ? (t - 78) * 720 : -1;
    const ox = c.cx * c.z * 0.5;
    for (let j = 0; j < FOGH; j++)
      for (let i = 0; i < FOGW; i++) {
        const sx = i * 2, sy = j * 2;
        const n = fbm((sx + ox) * 0.011 + t * 0.07, sy * 0.021 - t * 0.025, 3);
        const prof = 0.4 + 0.6 * Math.exp(-Math.pow((sy - dot.y - 10) / 150, 2));
        let d = amt * clamp((n - 0.36) * 2.1) * prof * 0.85;
        if (R >= 0) d *= clamp((Math.hypot(sx - dot.x, sy - dot.y) - R) / 70);
        FOG[j * FOGW + i] = d;
      }
    const col = P.tone("cell", 0.34);
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const d = FOG[(y >> 1) * FOGW + (x >> 1)];
        const i = y * CW + x;
        if (d > THR[i]) buf[i] = col;
      }
    if (R >= 0 && R < 1300) ringS(dot.x, dot.y, R, 5, P.strong, 0.9 * (1 - R / 1300));
  }

  const SENDS = [];
  for (let j = 0; j < 90; j++) SENDS.push({ t: 66.3 + 3.3 * Math.pow(j / 90, 0.8), dx: 25 + 60 * hu(j * 3 + 1), dy: -12 - 50 * hu(j * 3 + 2), bend: hu(j * 3 + 3) });
  function drawHunt(t, P, c, dot) {
    const X = walkX(t), Y = pathY(X);
    for (const s of SENDS) {
      const u = inv(s.t, s.t + 0.95, t);
      if (u <= 0 || u >= 1) continue;
      const from = { x: X, y: Y - 2 }, to = { x: X + s.dx, y: Y + s.dy }, mid = { x: X + s.dx * 0.5, y: Y + s.dy - 12 * s.bend };
      const e = E.outQuad(u), e2 = E.outQuad(Math.max(0, u - 0.03));
      const q = quad(from, mid, to, e), q2 = quad(from, mid, to, e2);
      const a = 1 - u;
      streak(q.x, q.y, (q.x - q2.x), (q.y - q2.y), P.cell, 10, a);
      rect(q.x - 0.2, q.y - 0.2, q.x + 0.2, q.y + 0.2, P.cell, a);
    }
    // one comes back
    const r = inv(73.6, 74.25, t);
    if (r > 0 && r < 1) {
      const from = { x: X + 55, y: Y - 45 }, to = { x: X + 1.5, y: Y - 1 }, mid = { x: X + 30, y: Y - 40 };
      const q = quad(from, mid, to, SWIFT(r)), q2 = quad(from, mid, to, SWIFT(inv(73.6, 74.25, t - 1 / 60)));
      streak(q.x, q.y, q.x - q2.x, q.y - q2.y, P.strong, 30);
      pt(q.x, q.y, P.strong);
    }
    if (t >= 74.25 && t < 74.9) ringS(dot.x, dot.y, (t - 74.25) * 60, 1.4, P.strong, 1 - (t - 74.25) / 0.65);
  }

  // ---------------------------------------------------------------- the climb

  const STRATA = [
    "sdk · cli · terraform · console",
    "managed kubernetes",
    "networking · dns",
    "block storage",
    "compute · firecracker · qemu/kvm",
    "metal"
  ];
  const BAND = 9;
  const CLIMB0 = 382;
  const CRASH_X = 525;
  const scanX = (t) => lerp(498, 556, inv(89.5, 90.6, t));
  const builtAt = (k, x) => passAt(x) + 0.12 + (STRATA.length - 1 - k) * 0.09;

  function strataCell(k, u, v, t, x) {
    switch (k) {
      case 0: {
        if (x > 812) { // ephemeral runners, now
          const bx = Math.floor(u / 10), by = Math.floor(v / 8), a = u - bx * 10, b = v - by * 8;
          if (a > 7 || b > 5) return 0;
          const live = h2(bx, by, Math.floor(t * 3 + h2(bx, by, 5) * 3)) > 0.55;
          if (!live) return 0;
          return a === 0 || a === 7 || b === 0 || b === 5 ? 0.9 : 0.3;
        }
        if (v % 5 !== 2) return 0;
        const row = (v / 5) | 0, uu = u + row * 13, seg = Math.floor(uu / 9), w = uu - seg * 9;
        const len = 2 + ((h2(seg, row, 3) * 6) | 0);
        return w < len && h2(seg, row, 4) > 0.28 ? (h2(seg, row, 5) > 0.93 ? 1 : 0.6) : 0;
      }
      case 1: {
        const row = Math.floor(v / 15), off = row % 2 ? 9 : 0, col = Math.floor((u + off) / 18);
        const a = (u + off) - col * 18, b = v - row * 15;
        const d = Math.hypot(a - 9, (b - 7) * 1.15);
        if (Math.abs(d - 4.2) < 0.75) return 0.85;
        if (d < 1.6) return Math.floor(t * 2 + h2(col, row, 2) * 4) % 3 ? 0.9 : 0.25;
        if (b === 7 && a > 13) return 0.35;
        return 0;
      }
      case 2: {
        const lane = Math.floor(v / 9), lv = v - lane * 9;
        if (lv !== 4) return u % 48 === 0 && Math.abs(lv - 4) <= 2 ? 0.9 : 0;
        const p = ((u + t * 55 * (lane % 2 ? 1 : -1) + h2(lane, 0, 7) * 400) % 48 + 48) % 48;
        return p < 4 ? 1 : 0.3;
      }
      case 3: {
        const lane = Math.floor(v / 9), lv = v - lane * 9;
        if (lv === 0 || lv > 7) return 0;
        const uu = u + t * 16 * (lane % 2 ? 1 : -1), blk = Math.floor(uu / 11), bu = uu - blk * 11;
        if (bu >= 9) return 0;
        if (bu < 1 || bu >= 8 || lv === 1 || lv === 7) return 0.8;
        return h2(blk, lane, 8) * 0.55;
      }
      case 4: {
        const bx = Math.floor(u / 11), by = Math.floor(v / 8), a = u - bx * 11, b = v - by * 8;
        if (a === 10 || b === 7) return 0;
        if (a === 0 || a === 9 || b === 0 || b === 6) return 0.75;
        return h2(bx, by, Math.floor(t * 2 + h2(bx, by, 1) * 4)) * 0.5;
      }
      default: {
        if (v % 6 === 3 && h2(Math.floor(u / 13), Math.floor(v / 6), 9) > 0.25) return 0.75;
        if (u % 13 === 0 && v % 6 < 4) return 0.6;
        if (u % 26 < 3 && v % 12 < 2) return 1;
        return 0.03;
      }
    }
  }

  function drawGround(t, P, c, dotX) {
    const fadeStrata = 1 - sstep(107.2, 109.6, t);
    const fadeFill = 1 - sstep(107.0, 108.8, t);
    const bandH = BAND * c.z;
    const u0 = Math.round(scrX(c, 0));
    const rustCol = P.accent, lit = P.cell, dim = P.tone("cell", 0.62);
    for (let s = 0; s < CW; s++) {
      const g = GROUND[s];
      if (g > 1e8) continue;
      const x = GROUNDX[s];
      const gi = Math.ceil(g);
      const edge = clamp((dotX - x) / 14 + 0.15);
      const inClimb = x >= CLIMB0 && fadeStrata > 0;
      const crash = x > CRASH_X - 22 * sstep(86.3, 87.6, t) && x < CRASH_X + 22 * sstep(86.3, 87.6, t) && t > 86.3 && x > (t > 89.5 ? scanX(t) : -1);
      for (let y = Math.max(0, gi); y < CH; y++) {
        const i = y * CW + s, v = y - gi;
        if (inClimb) {
          const k = Math.floor(v / bandH);
          if (k < STRATA.length) {
            const ta = builtAt(k, x);
            if (t >= ta) {
              const grow = clamp((t - ta) / 0.35);
              if (grow < 0.3 && 0.45 * (1 - grow / 0.3) > THR[i]) { buf[i] = P.strong; continue; }
              const vb = v - Math.round(k * bandH);
              if (vb === 0) { if ((s & 1) && 0.6 * fadeStrata * grow > THR[i]) buf[i] = P.faint; continue; }
              const d = strataCell(k, s - u0, vb, t, x) * fadeStrata * grow;
              if (d > THR[i]) buf[i] = crash && k >= 2 && k <= 4 ? rustCol : d > 0.85 ? lit : dim;
              continue;
            }
          }
        }
        const depth = v / c.z;
        const d = (0.03 + 0.1 * Math.exp(-depth / 3)) * fadeFill * edge;
        if (d > THR[i]) buf[i] = P.dim;
      }
    }
    if (t > 89.5 && t < 90.7) {
      const sx = Math.round(scrX(c, scanX(t)));
      const g = GROUND[clamp(sx, 0, CW - 1)];
      if (g < 1e8) for (let y = Math.round(g + 2 * bandH); y < Math.round(g + 5 * bandH); y++) pS(sx, y, P.strong);
    }
  }

  function strataLabels(t, P, c) {
    if (t < 79 || t > 107.5) return;
    const s = 40, g = GROUND[s], x = GROUNDX[s];
    if (g > 1e8 || x < CLIMB0) return;
    const bandH = BAND * c.z;
    const a = 1 - sstep(106.3, 107.2, t);
    STRATA.forEach((name, k) => {
      const al = sstep(builtAt(k, x), builtAt(k, x) + 0.4, t) * a;
      if (al <= 0) return;
      const y = g + (k + 0.5) * bandH + 4;
      if (y > CH - 6) return;
      chip(k === 0 && walkX(t) > 812 && t > 100.6 ? "ci runners · warpbuild" : name, ix(s + 6), iy(y), { size: 22, color: P.css.ink, bg: P.css.paper, alpha: al });
    });
  }

  function drawCrash(t, P, c, dot) {
    const a = pulse(86.6, 86.9, 89.4, 89.6, t);
    const b = pulse(90.6, 90.8, 91.6, 91.9, t);
    const s = scrX(c, CRASH_X), g = GROUND[clamp(Math.round(s), 0, CW - 1)];
    if (g > 1e8) return;
    const y = g + 2.5 * BAND * c.z;
    if (a > 0) chip("crashed mid-provision", ix(s), iy(y), { size: 22, color: P.css.accent, bg: P.css.paper, align: "center", alpha: a });
    if (b > 0) chip("reconciled", ix(s), iy(y), { size: 22, color: P.css.ink, bg: P.css.paper, align: "center", alpha: b });
  }

  // the numbers, in the sky he is climbing into
  function drawNumbers(t, P) {
    const a = sstep(91.8, 92.4, t) * (1 - sstep(93.8, 94.3, t));
    if (a <= 0) return;
    txt("when i left, aug 2026", 960, 86, { screen: true, size: 22, color: P.css.faint, align: "center", alpha: a });
    txt("accounts", 960, 452, { screen: true, size: 22, color: P.css.dim, align: "center", alpha: a });
    txt("380 vms · 140 postgres clusters · 20+ internal services", 960, 488, { screen: true, size: 22, color: P.css.dim, align: "center", alpha: sstep(92.6, 93.0, t) * a });
  }

  // side projects branch off the trail as he passes them
  const SPURS = ["dbconsole", "cbmanager", "rig", "tachyon", "flickturn", "lolwierd.com"].map((name, k) => ({ name, t: 96.6 + k * 0.6 }));
  function drawSpurs(t, P, c) {
    for (const sp of SPURS) {
      if (t < sp.t) continue;
      if (!sp.x) sp.x = walkX(sp.t);
      const x = sp.x, y = pathY(x);
      const p = EXPR(inv(sp.t, sp.t + 0.45, t));
      const a = 1 - sstep(106.2, 107, t);
      const len = 15, ang = -0.95 - 0.12 * (SPURS.indexOf(sp) % 3);
      const ex = x + Math.cos(ang) * len * p, ey = y + Math.sin(ang) * len * p;
      const n = Math.ceil(len * p * c.z / 3);
      for (let k = 0; k < n; k++) { const f = k / Math.max(1, n); pt(lerp(x, ex, f), lerp(y, ey, f), P.cell, a); }
      if (p > 0.95) {
        const sx = scrX(c, ex), sy = scrY(c, ey);
        for (let d = 0; d < 4; d++) hS(Math.round(sx - d), Math.round(sx + d), Math.round(sy - 4 + d), P.cell, a);
        txt(sp.name, sx * C, (sy - 8) * C, { screen: true, size: 22, color: P.css.ink, align: "center", alpha: a * sstep(sp.t + 0.3, sp.t + 0.5, t) });
      }
    }
  }

  // ---------------------------------------------------------------- the reveal

  const WAYPOINTS = [[0, "2018 · svit"], [214, "2022 · gate"], [382, "2023 · vaultci"], [952, "2026 · warpbuild"]];
  function drawWaypoints(t, P, c) {
    const a = sstep(107.2, 107.9, t) * (1 - sstep(110.0, 110.6, t));
    if (a <= 0) return;
    WAYPOINTS.forEach(([x, name], k) => {
      const al = a * sstep(107.2 + k * 0.15, 107.6 + k * 0.15, t);
      const sx = scrX(c, x), sy = scrY(c, pathY(x));
      for (let d = 3; d < 12; d++) pS(Math.round(sx), Math.round(sy - d), P.strong, al);
      txt(name, clamp(sx * C, 110, 1810), (sy - 16) * C, { screen: true, size: 22, color: P.css.ink, align: "center", alpha: al });
    });
  }

  function drawMirrorRange(t, P, c) {
    const t0 = 107.9;
    if (t < t0) return;
    const ramp = P.ramp;
    for (let s = 0; s < CW; s++) {
      const g = GROUND[s];
      if (g > 1e8) continue;
      const age = t - t0 - 0.35 * hu(s * 3 + 1) * 0;
      const front = age * 170 * c.z;
      for (let y = Math.max(0, Math.ceil(g)); y < CH; y++) {
        const i = y * CW + s, v = (front - (y - g)) / (46 * c.z);
        if (v <= THR[i]) continue;
        const wxv = Math.floor(GROUNDX[s]), wyv = Math.floor(worldY(c, y + 0.5));
        if (wxv < 0 || wxv >= CW || wyv < 0 || wyv >= CH) continue;
        const tier = TIERS_M[wyv * CW + wxv];
        if (tier >= 3) { if (v - THR[i] < 0.2) buf[i] = P.paper; continue; }
        buf[i] = v - THR[i] < 0.22 && front - (y - g) < 60 ? P.strong : ramp[tier];
      }
    }
  }

  // ---------------------------------------------------------------- one frame of the night

  function drawNight(t, P, fb, oc) {
    FB = fb; OC = oc; buf = fb;
    oc.clearRect(0, 0, W, H);
    fb.fill(P.paper);
    resetCam(); TALPHA = 1; OGHOST = 0;
    const c = camAt(t);
    applyCam(c);
    const X = walkX(t);
    for (let s = 0; s < CW; s++) {
      const x = worldX(c, s + 0.5);
      GROUNDX[s] = x;
      GROUND[s] = x >= 0 && x <= X ? scrY(c, pathY(x)) : 1e9;
    }
    const dot = { x: scrX(c, X), y: scrY(c, pathY(X)) };

    drawSky(t, P, c, dot);
    drawGround(t, P, c, X);
    if (t > 106) drawMirrorRange(t, P, c);

    // the line he has walked
    const lineFade = 1 - sstep(110.1, 110.9, t);
    let prev = null;
    for (let s = 0; s < CW; s++) {
      const g = GROUND[s];
      if (g > 1e8) { prev = null; continue; }
      const y = Math.round(g);
      const near = dot.x - s < 40 && s <= dot.x;
      const col = near ? P.strong : P.cell;
      if (prev !== null) for (let yy = Math.min(prev, y); yy <= Math.max(prev, y); yy++) pS(s, yy, col, lineFade);
      else pS(s, y, col, lineFade);
      prev = y;
    }

    if (t > 9.8 && t < 28) drawCollege(t, P, c, dot);
    if (t > 34 && t < 49) drawGate(t, P, c, dot);
    if (t > 46 && t < 60.5) drawOracle(t, P, c);
    if (t > 66 && t < 75) drawHunt(t, P, c, dot);
    if (t > 85 && t < 92) drawCrash(t, P, c, dot);
    if (t > 96 && t < 107.2) drawSpurs(t, P, c);
    drawFog(t, P, c, dot);
    strataLabels(t, P, c);
    drawNumbers(t, P);
    drawWaypoints(t, P, c);

    // him
    const size = clamp(Math.round((3 * c.z) / 6), 3, 22);
    const blinkOpen = t < 1.5 ? (t % 0.5) < 0.27 : t >= 70.6 && t < 73.6 ? ((t - 70.6) % 0.5) < 0.27 : true;
    const bob = speedAt(t) > 2 && Math.floor(X / 1.2) % 2 ? -1 : 0;
    const shake = t > 40.3 && t < 41.3 ? Math.round((hu(Math.floor(t * 30)) - 0.5) * 3) : 0;
    const dotA = 1 - sstep(110.6, 111.0, t);
    if (blinkOpen && dotA > 0) {
      const h = Math.floor(size / 2);
      const x0 = Math.round(dot.x) - h + shake, y0 = Math.round(dot.y) - size + bob - 1;
      fillS(x0, y0, x0 + size, y0 + size, P.strong, dotA * 1.01);
    }
    const tg = tagAt(t), ta = sstep(2.2, 2.8, t) * (1 - sstep(110.2, 110.7, t));
    if (tg && ta > 0) txt(tg, Math.round(dot.x * C + 18), Math.round((dot.y - size - 4) * C), { screen: true, size: 22, color: P.css.dim, alpha: ta });

    words(t, P);
  }

  // ---------------------------------------------------------------- output

  const canvas = document.getElementById("film");
  const ctx = canvas.getContext("2d");
  const cellCv = document.createElement("canvas"); cellCv.width = CW; cellCv.height = CH;
  const cellCx = cellCv.getContext("2d");
  const cellImg = cellCx.createImageData(CW, CH);
  const cellU32 = new Uint32Array(cellImg.data.buffer);
  const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  const ovN = mk(W, H), ovD = mk(W, H);
  const ovNx = ovN.getContext("2d"), ovDx = ovD.getContext("2d");

  function blit(src) {
    cellU32.set(src);
    cellCx.putImageData(cellImg, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cellCv, 0, 0, W, H);
  }
  function drawDay(t, fb, oc) {
    FB = fb; OC = oc; buf = fb;
    oc.clearRect(0, 0, W, H);
    fb.fill(DAY.paper);
    resetCam(); TALPHA = 1; OGHOST = 0;
    sSummit(t - DAY_OFFSET, DAY);
    buf = layer;
  }

  const PRESS0 = 111, PRESS1 = 113;
  function render(t) {
    t = clamp(t, 0, DUR);
    if (t < PRESS0) { drawNight(t, NIGHT, frameN, ovNx); blit(frameN); ctx.drawImage(ovN, 0, 0); return; }
    if (t >= PRESS1) { drawDay(t, frameD, ovDx); blit(frameD); ctx.drawImage(ovD, 0, 0); return; }
    // the press: a roller crosses the plate and leaves the print behind it
    drawNight(t, NIGHT, frameN, ovNx);
    drawDay(t, frameD, ovDx);
    const rx = E.inOutCubic(inv(PRESS0, PRESS1, t)) * (CW + 24) - 12;
    const out = frameN;
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const i = y * CW + x;
        if (x < rx) {
          const behind = rx - x;
          out[i] = behind < 3 ? DAY.accent : behind < 14 && (1 - behind / 14) * 0.5 > THR[i] ? DAY.strong : frameD[i];
        }
      }
    blit(out);
    ctx.save(); ctx.beginPath(); ctx.rect(Math.max(0, rx * C), 0, W, H); ctx.clip(); ctx.drawImage(ovN, 0, 0); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Math.max(0, rx * C), H); ctx.clip(); ctx.drawImage(ovD, 0, 0); ctx.restore();
  }

  // ---------------------------------------------------------------- cues

  const FILM_CUES = [];
  function buildFilmCues() {
    const c = (t, type, v = 0) => FILM_CUES.push({ t: +t.toFixed(4), type, v });
    c(0, "blink"); c(0.5, "blink"); c(1.0, "blink");
    c(2.0, "start");
    // footsteps: one per step while he is actually walking
    let last = -1;
    for (let t = 2; t < 105.7; t += 1 / 120) {
      const st = Math.floor(walkX(t) / 1.2);
      if (st !== last && speedAt(t) > 2) { c(t, "step", walkX(t)); last = st; }
    }
    for (const w of WORDS) c(w.t0, "word", ["line", "small", "big", "title", "sub", "quote", "attrib", "yes"].indexOf(w.k || "line"));
    for (let i = 0; i < 5; i++) { c(10.6 + i * 0.3, "join", i); c(25.6 + i * 0.35, "leave", i); }
    c(13.9, "fest"); c(18.3, "phone");
    for (let k = 0; k < 24; k++) c(18.95 + k * 0.1, "cell", k);
    c(23.3, "shipped"); c(23.9, "star");
    for (let x = 214; x <= 270; x += 1.5) c(passAt(x), "day", x);
    c(40.3, "crack"); c(43.6, "under");
    HOOD.forEach((_, k) => c(44.3 + k * 0.22, "hood", k));
    c(47.4, "surface");
    for (const p of PROPS) c(passAt(p.x) - 0.9, p.kind === "pi" ? "pi" : "server");
    c(59.5, "fog");
    for (const s of SENDS) c(s.t, "send");
    c(70.6, "alone");
    for (let b = 70.6; b < 73.6; b += 0.5) c(b, "blink");
    c(73.6, "reply"); c(74.25, "land"); c(77.72, "silence"); c(78.0, "yes");
    for (let x = CLIMB0; x <= 952; x += 24) for (let k = STRATA.length - 1; k >= 0; k--) c(builtAt(k, x), "layer", k);
    c(86.3, "crash"); c(89.5, "reconcile"); c(90.6, "fixed");
    c(91.0, "gather"); c(92.2, "numeral"); c(94.0, "burst");
    for (const sp of SPURS) c(sp.t, "spur", SPURS.indexOf(sp));
    c(100.6, "runners"); c(105.6, "summit");
    c(PULL0, "pull"); WAYPOINTS.forEach((_, k) => c(107.2 + k * 0.15, "waypoint", k));
    c(107.9, "print"); c(PRESS0, "press"); c(PRESS1, "pressed");
    c(24.9 + DAY_OFFSET, "sunrise");
    c(24.05 + DAY_OFFSET, "header");
    for (let k = 0; k < 12; k++) c(27.05 + (k * 0.55) / 12 + DAY_OFFSET, "type", k);
    c(27.75 + DAY_OFFSET, "closing");
    for (let b = 28.1 + DAY_OFFSET; b < 120; b += 0.5) c(b, "cursor");
    FILM_CUES.sort((a, b) => a.t - b.t);
  }

  // ---------------------------------------------------------------- boot

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
    buildMirror(img);
    buildNumeral();
    buildPass();
    buildSky();
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
        offset = clamp(offset + (e.code === "ArrowRight" ? 5 : -5), 0, DUR);
        render(offset); if (was) play();
      }
    });
  });
})();
