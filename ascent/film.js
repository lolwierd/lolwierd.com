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
      printIn(() => {
        txt(name, 64, 72, { screen: true, size: 22, color: P.css.ink });
        txt(role, 64 + tw(name, 22), 72, { screen: true, size: 22, color: P.css.faint });
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
  // is cut: everything he walked is engraved backwards. At the end the plate
  // turns over and a roller prints it the right way round, as the front page.
  //
  // Rust is his, and only his. Failures print as broken ink instead.
  // =================================================================

  const DAY_OFFSET = 86.5; // film time = the reel's summit clock + this

  const scratch = new Uint32Array(CW * CH);
  function dissolve(fn, d) {
    if (d <= 0.001) return;
    if (d >= 0.999) { fn(); return; }
    const saved = buf, savedA = TALPHA;
    buf = scratch; scratch.fill(0); TALPHA = savedA * d;
    fn();
    buf = saved; TALPHA = savedA;
    for (let i = 0; i < scratch.length; i++) { const v = scratch[i]; if (v && d > THR[i]) buf[i] = v; }
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

  // ---------------------------------------------------------------- the plate

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

  // ---------------------------------------------------------------- the clock

  const T = {
    title0: 3.0, title1: 8.6,
    flag: 16.6,
    thesis0: 20.2, thesis1: 25.6,
    crack: 33.4, hood0: 34.6, hood1: 39.6,
    fog0: 48.0, send0: 54.4, send1: 57.6, alone: 57.9,
    reply: 61.8, land: 62.5, quote0: 63.0, quote1: 66.2, silence: 66.3, yes: 66.9, yes1: 69.4,
    numeral0: 90.2, burst: 93.6,
    spur0: 95.4, summit: 103.6,
    pull0: 104.0, pull1: 107.5, print0: 107.5, hold0: 109.0,
    flip0: 111.0, flip1: 111.7, press1: 113.3
  };

  const WALK = [
    [0, 0], [2.0, 0], [9.0, 30], [20.0, 184], [26, 200], [28.5, 214], [33.4, 238], [35.0, 240], [39.6, 252], [46.5, 331],
    [56.5, 372], [57.9, 382], [T.yes, 383], [T.yes1, 392], [80, 520], [82.5, 530], [86, 548], [92, 690], [97, 800], [T.summit, 952], [200, 952]
  ];
  function linX(t) {
    if (t <= WALK[0][0]) return WALK[0][1];
    for (let i = 1; i < WALK.length; i++) if (t <= WALK[i][0]) return lerp(WALK[i - 1][1], WALK[i][1], inv(WALK[i - 1][0], WALK[i][0], t));
    return WALK[WALK.length - 1][1];
  }
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

  // camera: where on screen he stands, and how close we are
  const ANCHOR = [[0, 480, 270], [2.0, 480, 270], [6.5, 310, 300], [44, 320, 295], [50, 480, 280], [T.yes1, 480, 280], [72.5, 550, 190], [88.6, 550, 190], [90.4, 600, 285], [94.8, 600, 285], [97.6, 550, 190], [T.pull0, 550, 190]];
  const ZOOM = [[0, 40, "hold"], [1.5, 40, "hold"], [4.5, 6, "expr"], [48, 6, "hold"], [55, 6.6, "sine"], [61.5, 10, "sine"], [T.yes1, 10, "hold"], [71.6, 5, "expr"], [T.pull0, 3.6, "sine"]];
  const pullE = (t) => E.inOutCubic(inv(T.pull0, T.pull1, t));
  function keyed(list, t, idx, ease) {
    if (t <= list[0][0]) return list[0][idx];
    for (let i = 1; i < list.length; i++) if (t <= list[i][0]) return lerp(list[i - 1][idx], list[i][idx], ease(inv(list[i - 1][0], list[i][0], t)));
    return list[list.length - 1][idx];
  }
  function zoomAt(t) {
    if (t >= T.pull0) return Math.pow(3.6, 1 - pullE(t));
    for (let i = 1; i < ZOOM.length; i++) {
      const [t1, z1, kind] = ZOOM[i], [t0, z0] = ZOOM[i - 1];
      if (t <= t1) {
        const p = inv(t0, t1, t);
        const e = kind === "expr" ? EXPR(p) : kind === "sine" ? E.inOutSine(p) : p;
        return z0 * Math.pow(z1 / z0, e);
      }
    }
    return 3.6;
  }
  function camAt(t) {
    const z = zoomAt(t);
    let cx = 0, cy = 0;
    for (let k = 0; k < 6; k++) { const x = walkX(t - k * 0.1); cx += x; cy += pathY(x); }
    cx /= 6; cy /= 6;
    const dip = E.inOutSine(pulse(T.hood0, T.hood0 + 1.4, T.hood1 - 1.4, T.hood1, t));
    const f = t >= T.pull0 ? pullE(t) : 0;
    const ax = keyed(ANCHOR, t, 1, E.inOutSine), ay = keyed(ANCHOR, t, 2, E.inOutSine) - 150 * dip;
    return { z, cx, cy, sx: lerp(ax, cx, f), sy: lerp(ay, cy, f), f };
  }
  function applyCam(c) { TS = c.z; OX = c.cx; OY = c.cy; TX = c.sx - c.cx; TY = c.sy - c.cy; }
  const scrX = (c, x) => (x - c.cx) * c.z + c.sx;
  const scrY = (c, y) => (y - c.cy) * c.z + c.sy;
  const worldX = (c, s) => (s - c.sx) / c.z + c.cx;
  const worldY = (c, s) => (s - c.sy) / c.z + c.cy;

  const GROUND = new Float32Array(CW);
  const GROUNDX = new Float32Array(CW);
  const groundAt = (s) => GROUND[clamp(Math.round(s), 0, CW - 1)];

  // ---------------------------------------------------------------- the words
  //
  // Few, large, and next to him: each line sits just ahead of where he is
  // standing when it appears, and does not move. Only the lines that turn the
  // story are printed in through the dither; the rest fade.

  const WORDS = [
    { t0: T.title0, t1: T.title1, s: "the long way up", k: "title" },
    { t0: 3.7, t1: T.title1, s: "ayaan retiwala", k: "sub" },
    { t0: 10.2, t1: 14.6, s: "in college, we built our college's app." },
    { t0: T.thesis0, t1: T.thesis1, s: "after college, one goal:", k: "small" },
    { t0: 20.9, t1: T.thesis1, s: "build the things", k: "big", row: 0 },
    { t0: 21.4, t1: T.thesis1, s: "other people build on.", k: "big", row: 1 },
    { t0: 29.0, t1: 33.2, s: "a year of gate prep. cramming didn't work," },
    { t0: 35.0, t1: 38.6, s: "so i went under the hood instead.", at: T.hood0 + 1.5 },
    { t0: 40.6, t1: 45.2, s: "two free oracle servers. i self-hosted everything." },
    { t0: 47.4, t1: 50.4, s: "i thought i was ready." },
    { t0: 50.9, t1: 54.2, s: "i couldn't even get interviews." },
    { t0: T.quote0, t1: T.quote1, s: "“want to give it a shot?”", k: "quote" },
    { t0: 63.5, t1: T.quote1, s: "arjun · vaultci", k: "attrib" },
    { t0: T.yes, t1: T.yes1, s: "yes.", k: "yes" },
    { t0: 72.4, t1: 77.4, s: "three years building a public cloud, from the hypervisor up." },
    { t0: 85.8, t1: 89.8, s: "design for the scale you have. know where it breaks." },
    { t0: 98.8, t1: 103.2, s: "now: the infrastructure behind warpbuild's ci runners." }
  ];

  function wrap(s, size, fam, maxW, ls) {
    OC.font = `${size}px ${fam}`;
    OC.letterSpacing = ls + "px";
    const out = [];
    let line = "";
    for (const w of s.split(" ")) {
      const next = line ? line + " " + w : w;
      if (OC.measureText(next).width > maxW && line) { out.push(line); line = w; } else line = next;
    }
    if (line) out.push(line);
    return out;
  }

  function words(t, P) {
    for (const w of WORDS) {
      if (t < w.t0 || t > w.t1) continue;
      const k = w.k || "line";
      if (k === "yes") {
        const s = 1 + 0.14 * (1 - E.outBack(inv(T.yes, T.yes + 0.35, t), 2.2));
        const fade = 1 - sstep(T.yes1 - 0.4, T.yes1, t);
        txt("yes.", 1190, 470, { screen: true, size: Math.round(270 * s), fam: SERIF, color: t < T.yes + 0.034 ? P.css.paper : P.css.strong, align: "center", ls: -7, alpha: fade });
        continue;
      }
      if (k === "line") {
        // anchored beside him at the moment the line appears
        const ta = w.at || w.t0, c = camAt(ta), X = walkX(ta);
        const dx = scrX(c, X) * C, dy = scrY(c, pathY(X)) * C;
        const left = Math.round(Math.min(dx + 100, 1920 - 80 - 860)), top = clamp(dy - 130, 120, 700);
        const lines = wrap(w.s, 54, SERIF, 1920 - left - 80, -0.5);
        const a = sstep(w.t0, w.t0 + 0.35, t) * (1 - sstep(w.t1 - 0.3, w.t1, t));
        const y0 = top - (lines.length - 1) * 62;
        lines.forEach((l, i) => txt(l, left, Math.round(y0 + i * 62), { screen: true, size: 54, fam: SERIF, color: P.css.strong, ls: -0.5, alpha: a }));
        continue;
      }
      let size, fam, color, x, y, italic = false, ls = 0, print = false;
      if (k === "small") { size = 33; fam = MONO; color = P.css.dim; x = 960; y = 250; }
      else if (k === "big") { size = 96; fam = SERIF; color = P.css.strong; x = 960; y = 360 + (w.row || 0) * 104; ls = -2; print = true; }
      else if (k === "title") { size = 140; fam = SERIF; color = P.css.strong; x = 960; y = 390; ls = -3; print = true; }
      else if (k === "sub") { size = 33; fam = MONO; color = P.css.strong; x = 960; y = 458; }
      else if (k === "quote") { size = 84; fam = SERIF; color = P.css.strong; x = 1150; y = 400; italic = true; ls = -1; print = true; }
      else { size = 33; fam = MONO; color = P.css.dim; x = 1150; y = 470; }
      if (!print) {
        const a = sstep(w.t0, w.t0 + 0.35, t) * (1 - sstep(w.t1 - 0.3, w.t1, t));
        txt(w.s, x, y, { screen: true, size, fam, italic, color, align: "center", ls, alpha: a });
        continue;
      }
      OC.font = `${italic ? "italic " : ""}${size}px ${fam}`;
      OC.letterSpacing = ls + "px";
      const wd = OC.measureText(w.s).width, x0 = x - wd / 2;
      const pin = (t - w.t0) / 0.6, pout = (w.t1 - t) / 0.3;
      printIn(() => txt(w.s, x, y, { screen: true, size, fam, italic, color, align: "center", ls }),
        x0 - 12, y - size - 8, wd + 30, size * 1.35 + 16,
        (gx) => Math.min((pin * (wd / C + 60) - (gx - x0 / C)) / 30, pout * 1.15));
    }
  }

  // the tag that walks with him: it owns every date in the film
  const YEARS = [[9, 2018.6], [20, 2022.4], [28.5, 2022.5], [46.5, 2022.9], [57.9, 2023.3], [T.yes, 2023.45], [T.summit, 2026.7]];
  function yearAt(t) {
    let y = YEARS[0][1];
    for (let i = 1; i < YEARS.length; i++) if (t >= YEARS[i - 1][0]) y = lerp(YEARS[i - 1][1], YEARS[i][1], inv(YEARS[i - 1][0], YEARS[i][0], t));
    return Math.floor(y);
  }
  function tagAt(t) {
    if (t < 2.2) return "";
    if (t >= T.numeral0 - 0.3 && t < T.burst + 1.4) return "";
    if (t >= T.summit) return "now";
    if (t >= T.yes && t < T.yes1) return "";
    const y = yearAt(t);
    if (t < 9) return String(y);
    if (t < 20) return `${y} · svit`;
    if (t < 28.5) return String(y);
    if (t < 39.8) return `${y} · gate · day ${Math.max(1, Math.round(inv(214, 252, walkX(t)) * 365))}`;
    if (t < 46.5) return `${y} · oracle free tier`;
    if (t < T.reply + 0.5) return `${y} · job hunt · 0 replies`;
    if (t < T.yes) return `${y} · job hunt · 1 reply`;
    if (t < 76) return `${y} · vaultci, later excloud`;
    if (t < 98.8) return `${y} · excloud`;
    return `${y} · warpbuild`;
  }

  // ---------------------------------------------------------------- the sky

  const SKY = [];
  const NUM_DX = -200, NUM_DY = -108;
  function buildSky() {
    const rnd = mulberry(952);
    const seat = (band) => {
      for (;;) {
        let x, y;
        if (band) { const u = rnd(); x = u * CW; y = 40 + u * 180 + (rnd() + rnd() - 1) * 55; }
        else { x = rnd() * CW; y = 8 + (PATH[Math.floor(x)] - 22) * Math.pow(rnd(), 1.3); }
        if (y > 6 && y < PATH[Math.floor(x)] - 14) return [x, y];
      }
    };
    for (let i = 0; i < 160; i++) { const [x, y] = seat(false); SKY.push({ x, y, b: 0.18 + 0.4 * Math.pow(rnd(), 2), t0: 2.5 + rnd() * 5, kind: "old" }); }
    for (let i = 0; i < 4000; i++) {
      const [x, y] = seat(rnd() < 0.55);
      const cls = rnd();
      SKY.push({ x, y, b: cls < 0.05 ? 1 : cls < 0.2 ? 0.5 : 0.16, big: cls < 0.05, i, kind: "account", r1: rnd(), r2: rnd(), r3: rnd() });
    }
  }
  function skyOff(c) {
    const k = 1 - c.f;
    return [-0.05 * c.cx * c.z * k, -0.05 * (c.cy - 330) * c.z * k];
  }
  const wrapX = (x) => ((x % CW) + CW) % CW;

  function accountPos(s, t, c, dot) {
    const [ox, oy] = skyOff(c);
    const nx = NUM[s.i * 2] + NUM_DX, ny = NUM[s.i * 2 + 1] + NUM_DY;
    const a0 = T.numeral0 + 0.55 * s.r1, a = EXPR(inv(a0, a0 + 1.1, t));
    const b0 = T.burst + 0.35 * s.r2, b = EXPR(inv(b0, b0 + 1.4, t));
    const sx = wrapX(s.x + ox), sy = s.y + oy;
    if (b > 0) {
      const sw = Math.sin(Math.PI * b) * 70 * (s.r3 - 0.5);
      return [lerp(nx, sx, b) + sw, lerp(ny, sy, b) - sw * 0.4, b, 2];
    }
    const hx = dot.x - 40 - s.r2 * 260, hy = dot.y + 20 + s.r3 * 180;
    const jit = sstep(0.95, 1, a);
    return [lerp(hx, nx, a) + (vnoise(s.i * 0.13, t * 2.2) - 0.5) * 1.4 * jit, lerp(hy, ny, a) + (vnoise(s.i * 0.13 + 50, t * 2.2) - 0.5) * 1.4 * jit, a, 1];
  }

  function drawSky(t, P, c, dot) {
    const [ox, oy] = skyOff(c);
    const occluded = (x, y) => y >= groundAt(x) - 1;
    for (const s of SKY) {
      if (s.kind === "old") {
        if (t < s.t0) continue;
        const x = wrapX(s.x + ox), y = s.y + oy;
        if (occluded(x, y)) continue;
        const tw = 0.65 + 0.35 * Math.sin(t * (2 + 4 * hu(Math.floor(s.x * 7))) + s.y);
        pS(Math.floor(x), Math.floor(y), P.tone("cell", s.b * tw * sstep(s.t0, s.t0 + 0.6, t)));
        continue;
      }
      if (t < T.numeral0 - 0.1) continue;
      const [x, y, p, phase] = accountPos(s, t, c, dot);
      if (phase === 1 && p <= 0) continue;
      if (phase === 2 && p >= 0.999) {
        if (occluded(x, y)) continue;
        const tw = 0.62 + 0.38 * Math.sin(t * (2.5 + 5 * s.r1) + s.r2 * TAU);
        const col = P.tone("cell", s.b * tw), X = Math.floor(x), Y = Math.floor(y);
        pS(X, Y, col);
        if (s.big) { pS(X + 1, Y, col); pS(X, Y + 1, col); pS(X + 1, Y + 1, col); }
        continue;
      }
      const [x2, y2] = accountPos(s, t - 1 / 60, c, dot);
      const bright = phase === 2 ? lerp(1, s.b, sstep(0.8, 1, p)) : 1;
      streakS(x, y, x - x2, y - y2, P.tone("cell", bright), 20);
    }
  }

  // ---------------------------------------------------------------- college

  function drawCollege(t, P, c, dot) {
    // friends walk behind him, then stop where they are
    for (let i = 0; i < 4; i++) {
      const join = 9.6 + i * 0.35, leave = 19.2 + i * 0.3;
      if (t < join || t > leave + 1.4) continue;
      const off = [-15, -11.5, -8, -4.5][i];
      const x = walkX(Math.min(t, leave)) + off;
      const bob = t < leave && speedAt(t) > 2 && Math.floor(walkX(t) / 1.2 + i) % 2 ? -1 : 0;
      const sx = scrX(c, x), sy = scrY(c, pathY(x)) - 6 + bob;
      const a = sstep(join, join + 0.4, t) * (1 - sstep(leave + 0.3, leave + 1.4, t));
      fillS(Math.round(sx - 2), Math.round(sy - 2), Math.round(sx + 3), Math.round(sy + 3), P.cell, a * 1.02);
    }
    // the app he shipped: a flag planted where he stands
    const fx = walkX(T.flag), fp = EXPR(inv(T.flag, T.flag + 0.5, t));
    if (fp > 0) {
      const a = 1 - sstep(27.5, 28.5, t);
      const bx = scrX(c, fx), by = scrY(c, pathY(fx));
      const top = by - 34 * fp;
      for (let y = Math.round(top); y < by - 1; y++) pS(Math.round(bx), y, P.cell, a);
      if (fp > 0.9) for (let r = 0; r < 8; r++) hS(Math.round(bx + 1), Math.round(bx + 1 + 14 - r * 1.6), Math.round(top + r), P.cell, a);
      txt("svit app · shipped", (bx - 8) * C, (top + 6) * C, { screen: true, size: 33, color: P.css.ink, align: "right", alpha: a * sstep(T.flag + 0.3, T.flag + 0.6, t) * (1 - sstep(18.4, 19.0, t)) });
    }
  }

  // ---------------------------------------------------------------- gate

  const HOOD = [["registers", 0.35], ["cache", 0.27], ["memory", 0.2], ["disk", 0.14], ["network", 0.09]];

  function drawGate(t, P, c, dot) {
    // a tick for every day walked; the cramming days break
    for (let x = 214; x <= Math.min(walkX(t), 252); x += 1.2) {
      const s = Math.round(scrX(c, x)), g = groundAt(s);
      if (s < 0 || s >= CW || g > 1e8) continue;
      const broken = x > 228 && x < 240 && t > T.crack && t < T.crack + 1.2;
      if (broken && hu(Math.floor(x * 10) + Math.floor(t * 18)) > 0.5) continue;
      for (let k = 2; k <= 6; k++) pS(s, Math.round(g) + k, broken ? P.strong : P.cell, k < 6 ? 1 : 0.5);
    }
    const ha = sstep(T.hood0 + 0.8, T.hood0 + 1.2, t) * (1 - sstep(T.hood1 - 1.4, T.hood1 - 0.6, t));
    if (ha <= 0) return;
    const bandH = 8 * c.z;
    for (let s = 0; s < CW; s++) {
      const g = GROUND[s];
      if (g > 1e8) continue;
      const edge = clamp((dot.x - s) / 30 + 0.1);
      for (let k = 0; k < HOOD.length; k++) {
        const tk = T.hood0 + 0.9 + k * 0.2;
        if (t < tk) continue;
        const y0 = Math.round(g + 24 + k * bandH), y1 = Math.round(g + 24 + (k + 1) * bandH - 4);
        const reveal = ((t - tk) / 0.4) * 400 - (dot.x - s);
        if (reveal <= 0) continue;
        for (let y = y0; y < y1; y++) pS(s, y, y === y0 ? P.cell : P.tone("cell", 0.7), (y === y0 ? 0.8 : HOOD[k][1]) * ha * edge * Math.min(1, reveal / 40));
      }
    }
    const gd = groundAt(dot.x - 2);
    if (gd > 1e8) return;
    HOOD.forEach(([name], k) => {
      const tk = T.hood0 + 0.9 + k * 0.2;
      txt(name, dot.x * C + 24, (gd + 24 + (k + 0.5) * bandH) * C + 11, { screen: true, size: 33, color: P.css.ink, alpha: ha * sstep(tk + 0.1, tk + 0.3, t) });
    });
  }

  // ---------------------------------------------------------------- oracle

  const PROPS = [
    { x: 283, w: 12, d0: 6, d1: 12, name: "raspberry pi", kind: "pi" },
    { x: 306, w: 16, d0: 8, d1: 15, name: "2 × oracle arm", kind: "srv" }
  ];
  function drawOracle(t, P, c) {
    for (const p of PROPS) {
      const ta = passAt(p.x) - 0.9;
      if (t < ta || t > 49) continue;
      const a = sstep(ta, ta + 0.45, t) * (1 - sstep(47.5, 49, t));
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
          for (let k = 0; k < 5; k++) { const bx = Math.round(x0 + 6 + k * 10); hS(bx, bx + 7, Math.round(y0 + 12), P.dim); hS(bx, bx + 7, Math.round(y1 - 8), P.dim); vS(bx, Math.round(y0 + 12), Math.round(y1 - 8), P.dim); vS(bx + 7, Math.round(y0 + 12), Math.round(y1 - 8), P.dim); }
          for (let k = 0; k < 3; k++) if (Math.floor(t * 5 + k * 1.7) % 3) fillS(Math.round(x1 - 12), Math.round(y0 + 8 + k * 8), Math.round(x1 - 8), Math.round(y0 + 12 + k * 8), P.strong, 1);
        }
        const wx0 = Math.round((x0 + x1) / 2), gs = scrY(c, gy);
        for (let y = Math.round(gs) + 2; y < y0; y += 2) pS(wx0, y, P.dim);
        for (let q = 0; q < 2; q++) {
          const yy = lerp(y0, gs, (t * 1.3 + q * 0.5 + p.x * 0.01) % 1);
          fillS(wx0 - 1, Math.round(yy) - 1, wx0 + 2, Math.round(yy) + 2, P.strong, 1);
        }
      }, a);
      txt(p.name, (x0 + x1) / 2 * C, y1 * C + 40, { screen: true, size: 33, color: P.css.ink, align: "center", alpha: a });
    }
  }

  // ---------------------------------------------------------------- job hunt

  const FOGW = 480, FOGH = 270;
  const FOG = new Float32Array(FOGW * FOGH);
  function drawFog(t, P, c, dot) {
    const amt = sstep(T.fog0, 55, t) * (1 - sstep(T.yes, T.yes + 0.8, t));
    if (amt <= 0) return;
    const ox = c.cx * c.z * 0.5;
    for (let j = 0; j < FOGH; j++) {
      const sy = j * 2, dyv = Math.abs(sy - dot.y);
      if (dyv > 95) { for (let i = 0; i < FOGW; i++) FOG[j * FOGW + i] = 0; continue; }
      const prof = Math.pow(1 - dyv / 95, 1.5);
      for (let i = 0; i < FOGW; i++) {
        const sx = i * 2;
        const n = fbm((sx + ox) * 0.009 + t * 0.06, sy * 0.03 - t * 0.02, 3);
        const clear = clamp((Math.hypot(sx - dot.x, sy - dot.y) - 45) / 30);
        FOG[j * FOGW + i] = amt * 0.5 * clamp((n - 0.3) * 2.2) * prof * clear;
      }
    }
    const col = P.tone("cell", 0.22);
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const d = FOG[(y >> 1) * FOGW + (x >> 1)], i = y * CW + x;
        if (d > THR[i]) buf[i] = col;
      }
  }

  const SENDS = [];
  for (let j = 0; j < 24; j++) SENDS.push({ t: T.send0 + (T.send1 - T.send0) * Math.pow(j / 24, 0.85), dx: 30 + 55 * hu(j * 3 + 1), dy: -10 - 34 * hu(j * 3 + 2), bend: hu(j * 3 + 3) });
  function envelope(x, y, P, d, col) {
    const X = Math.round(x) - 6, Y = Math.round(y) - 4;
    hS(X, X + 12, Y, col, d); hS(X, X + 12, Y + 8, col, d); vS(X, Y, Y + 8, col, d); vS(X + 12, Y, Y + 8, col, d);
    for (let k = 1; k <= 5; k++) { pS(X + k, Y + k * 0.8 + 0.5 | 0, col, d); pS(X + 12 - k, Y + k * 0.8 + 0.5 | 0, col, d); }
    pS(X + 6, Y + 5, col, d);
  }
  function drawHunt(t, P, c, dot) {
    const X = walkX(t), Y = pathY(X);
    for (const s of SENDS) {
      const u = inv(s.t, s.t + 1.3, t);
      if (u <= 0 || u >= 1) continue;
      const from = { x: X, y: Y - 3 }, to = { x: X + s.dx, y: Y + s.dy }, mid = { x: X + s.dx * 0.45, y: Y + s.dy - 10 * s.bend };
      const q = quad(from, mid, to, E.outQuad(u));
      envelope(scrX(c, q.x), scrY(c, q.y), P, (1 - u) * 1.02, P.cell);
    }
    // one comes back
    const r = inv(T.reply, T.land, t);
    if (r > 0 && r < 1) {
      const from = { x: X + 60, y: Y - 34 }, to = { x: X + 2, y: Y - 3 }, mid = { x: X + 32, y: Y - 34 };
      const q = quad(from, mid, to, SWIFT(r));
      envelope(scrX(c, q.x), scrY(c, q.y), P, 1, P.strong);
    }
    if (t >= T.land && t < T.yes) {
      const ex = dot.x + 9, ey = dot.y - 3;
      envelope(ex, ey, P, 1 - sstep(T.quote0 - 0.2, T.quote0 + 0.4, t) * 0.4, t - T.land < 0.08 ? P.strong : P.cell);
    }
  }

  // ---------------------------------------------------------------- the climb

  const STRATA = ["sdk · cli · terraform · console", "managed kubernetes", "networking · dns", "block storage", "compute · firecracker · qemu/kvm", "metal"];
  const BAND = 6;
  const CRASH_X = 525;
  const crashT = () => passAt(CRASH_X);
  const scanX = (t) => lerp(CRASH_X - 26, CRASH_X + 30, inv(crashT() + 2.0, crashT() + 3.0, t));
  const builtAt = (k, x) => Math.max(passAt(x), T.yes + 0.4) + 0.12 + (STRATA.length - 1 - k) * 0.09;

  function strataCell(k, u, v, t, x) {
    switch (k) {
      case 0: {
        if (x > 812) {
          const bx = Math.floor(u / 10), by = Math.floor(v / 8), a = u - bx * 10, b = v - by * 8;
          if (a > 7 || b > 5) return 0;
          if (h2(bx, by, Math.floor(t * 3 + h2(bx, by, 5) * 3)) <= 0.55) return 0;
          return a === 0 || a === 7 || b === 0 || b === 5 ? 0.9 : 0.3;
        }
        if (v % 5 !== 2) return 0;
        const row = (v / 5) | 0, uu = u + row * 13, seg = Math.floor(uu / 9), w = uu - seg * 9;
        const len = 2 + ((h2(seg, row, 3) * 6) | 0);
        return w < len && h2(seg, row, 4) > 0.28 ? (h2(seg, row, 5) > 0.93 ? 1 : 0.6) : 0;
      }
      case 1: {
        const bx = Math.floor(u / 13), by = Math.floor(v / 9), a = u - bx * 13, b = v - by * 9;
        if (a > 8 || b > 5) return a > 8 && b === 3 ? 0.35 : 0;
        if (a === 0 || a === 8 || b === 0 || b === 5) return 0.8;
        return (a === 3 || a === 5) && (b === 2 || b === 3) ? (Math.floor(t * 2 + h2(bx, by, 2) * 4) % 3 ? 0.95 : 0.2) : 0;
      }
      case 2: {
        const lane = Math.floor(v / 7), lv = v - lane * 7;
        if (lv !== 3) return 0;
        const p = ((u + t * 55 * (lane % 2 ? 1 : -1) + h2(lane, 0, 7) * 400) % 40 + 40) % 40;
        return p < 3 ? 1 : (u & 1) ? 0.4 : 0;
      }
      case 3: {
        const lane = Math.floor(v / 8), lv = v - lane * 8;
        if (lv === 0 || lv > 6) return 0;
        const uu = u + t * 16 * (lane % 2 ? 1 : -1), blk = Math.floor(uu / 11), bu = uu - blk * 11;
        if (bu >= 9) return 0;
        if (bu < 1 || bu >= 8 || lv === 1 || lv === 6) return 0.8;
        return h2(blk, lane, 8) * 0.5;
      }
      case 4: {
        const bx = Math.floor(u / 11), by = Math.floor(v / 8), a = u - bx * 11, b = v - by * 8;
        if (a === 10 || b === 7) return 0;
        if (a === 0 || a === 9 || b === 0 || b === 6) return 0.75;
        return h2(bx, by, Math.floor(t * 2 + h2(bx, by, 1) * 4)) * 0.45;
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
    const fadeStrata = 1 - sstep(T.pull0 + 0.5, T.print0 + 0.5, t);
    const fadeFill = 1 - sstep(T.pull0 + 0.3, T.print0, t);
    const bandH = BAND * c.z;
    const u0 = Math.round(scrX(c, 0));
    const lit = P.cell, dim = P.tone("cell", 0.62);
    const ct = crashT();
    const crashR = 22 * sstep(ct, ct + 1.0, t);
    for (let s = 0; s < CW; s++) {
      const g = GROUND[s];
      if (g > 1e8) continue;
      const x = GROUNDX[s], gi = Math.ceil(g);
      const edge = clamp((dotX - x) / 14 + 0.15);
      const inClimb = t >= T.yes + 0.4 && x >= 382 && fadeStrata > 0;
      const crash = t > ct && Math.abs(x - CRASH_X) < crashR && x > (t > ct + 2.0 ? scanX(t) : -1);
      for (let y = Math.max(0, gi); y < CH; y++) {
        const i = y * CW + s, v = y - gi;
        if (inClimb) {
          const k = Math.floor(v / bandH);
          if (k < STRATA.length) {
            const ta = builtAt(k, x);
            if (t >= ta) {
              const grow = clamp((t - ta) / 0.35);
              const vb = v - Math.round(k * bandH);
              if (vb === 0) { if ((s & 1) && 0.6 * fadeStrata * grow > THR[i]) buf[i] = P.faint; continue; }
              let d = strataCell(k, s - u0, vb, t, x) * fadeStrata * grow;
              if (crash && k >= 2 && k <= 4) {
                // broken ink: the layer scrambles instead of turning a colour
                const n = h2(s, y, Math.floor(t * 20));
                d = n > 0.55 ? 0.95 : 0;
                if (d > THR[i]) buf[i] = P.strong;
                continue;
              }
              if (d > THR[i]) buf[i] = d > 0.85 ? lit : dim;
              continue;
            }
          }
        }
        const d = (0.04 + 0.12 * Math.exp(-(v / c.z) / 3)) * fadeFill * edge;
        if (d > THR[i]) buf[i] = P.dim;
      }
    }
    if (t > ct + 2.0 && t < ct + 3.05) {
      const sx = Math.round(scrX(c, scanX(t))), g = groundAt(sx);
      if (g < 1e8) for (let y = Math.round(g + 2 * bandH); y < Math.round(g + 5 * bandH); y++) { pS(sx, y, P.strong); pS(sx + 1, y, P.strong); }
    }
  }

  function strataLabels(t, P, c, dot) {
    if (t < T.yes1 || t > T.pull0 + 0.8) return;
    const s = Math.round(dot.x - 130), x = GROUNDX[clamp(s, 0, CW - 1)];
    const g = groundAt(s);
    if (g > 1e8 || x < 384) return;
    const bandH = BAND * c.z;
    const ct = crashT();
    const a = (1 - sstep(T.pull0, T.pull0 + 0.8, t)) * (1 - pulse(T.numeral0 - 0.6, T.numeral0, T.burst + 0.6, T.burst + 1.2, t)) * (1 - pulse(ct, ct + 0.2, ct + 4.4, ct + 4.8, t));
    if (a <= 0) return;
    OC.font = `33px ${MONO}`; OC.letterSpacing = "0px";
    STRATA.forEach((name0, k) => {
      const name = k === 0 && walkX(t) > 812 ? "ci runners" : name0;
      const al = sstep(builtAt(k, x) + 0.2, builtAt(k, x) + 0.6, t) * a;
      if (al <= 0) return;
      const yc = g + (k + 0.5) * bandH;
      const wpx = OC.measureText(name).width, x0 = s - wpx / C - 8;
      if (yc * C + 8 > H - 10) return;
      // never let a label ride up into the sky
      for (let q = Math.max(0, Math.floor(x0)); q <= s; q += 6) if (yc - 12 < groundAt(q)) return;
      chip(name, ix(s), iy(yc + 7), { size: 33, color: P.css.ink, bg: P.css.paper, align: "right", alpha: al });
    });
  }

  function drawCrash(t, P, c) {
    const ct = crashT();
    const a = pulse(ct + 0.2, ct + 0.4, ct + 2.1, ct + 2.3, t);
    const b = pulse(ct + 3.0, ct + 3.2, ct + 4.4, ct + 4.6, t);
    const s = scrX(c, CRASH_X), g = groundAt(s);
    if (g > 1e8) return;
    const y = g + 3.5 * BAND * c.z;
    if (a > 0) chip("crashed mid-provision", ix(s), iy(y), { size: 33, color: P.css.strong, bg: P.css.paper, align: "center", alpha: a });
    if (b > 0) chip("reconciled", ix(s), iy(y), { size: 33, color: P.css.ink, bg: P.css.paper, align: "center", alpha: b });
  }

  function drawNumbers(t, P) {
    const a = sstep(T.numeral0 + 1.2, T.numeral0 + 1.6, t) * (1 - sstep(T.burst - 0.3, T.burst + 0.1, t));
    if (a <= 0) return;
    txt("accounts", 560, 404, { screen: true, size: 33, color: P.css.dim, align: "center", alpha: a });
  }

  const SPURS = ["dbconsole", "cbmanager", "rig", "tachyon", "flickturn", "lolwierd.com"].map((name, k) => ({ name, t: T.spur0 + k * 0.55 }));
  function drawSpurs(t, P, c) {
    SPURS.forEach((sp, k) => {
      if (t < sp.t) return;
      const x = walkX(sp.t), y = pathY(x);
      const p = EXPR(inv(sp.t, sp.t + 0.45, t));
      const a = 1 - sstep(T.pull0, T.pull0 + 0.6, t);
      const len = [16, 27, 38][k % 3], ang = -2.02 + 0.06 * (k % 2);
      const ex = x + Math.cos(ang) * len * p, ey = y + Math.sin(ang) * len * p;
      const n = Math.ceil(len * p * c.z / 3);
      for (let q = 0; q < n; q++) { const f = q / Math.max(1, n); pt(lerp(x, ex, f), lerp(y, ey, f), P.cell, a); }
      if (p > 0.95) {
        const sx = scrX(c, ex), sy = scrY(c, ey);
        for (let d = 0; d < 5; d++) hS(Math.round(sx - d), Math.round(sx + d), Math.round(sy - 5 + d), P.cell, a);
        txt(sp.name, sx * C, (sy - 10) * C, { screen: true, size: 33, color: P.css.ink, align: "center", alpha: a * sstep(sp.t + 0.3, sp.t + 0.5, t) });
      }
    });
  }

  // ---------------------------------------------------------------- the reveal

  const WAYPOINTS = [[0, "2018 · svit", "left"], [382, "2023 · vaultci", "center"], [952, "2026 · warpbuild", "right"]];
  function drawWaypoints(t, P, c) {
    const a = sstep(T.hold0 + 0.2, T.hold0 + 0.6, t) * (1 - sstep(T.flip0 - 0.4, T.flip0, t));
    if (a <= 0) return;
    WAYPOINTS.forEach(([x, name, align], k) => {
      const al = a * sstep(T.hold0 + 0.2 + k * 0.2, T.hold0 + 0.6 + k * 0.2, t);
      const sx = scrX(c, x), sy = scrY(c, pathY(x));
      for (let d = 4; d < 16; d++) pS(Math.round(sx), Math.round(sy - d), P.strong, al);
      const px = align === "left" ? 64 : align === "right" ? 1856 : sx * C;
      chip(name, ix(px / C), iy(sy - 20), { size: 33, color: P.css.ink, bg: P.css.paper, align, alpha: al });
    });
  }

  function drawMirrorRange(t, P, c) {
    if (t < T.print0) return;
    const ramp = P.ramp;
    for (let s = 0; s < CW; s++) {
      const g = GROUND[s];
      if (g > 1e8) continue;
      const front = (t - T.print0) * 230 * c.z;
      for (let y = Math.max(0, Math.ceil(g)); y < CH; y++) {
        const i = y * CW + s, v = (front - (y - g)) / (46 * c.z);
        if (v <= THR[i]) continue;
        const wxv = Math.floor(GROUNDX[s]), wyv = Math.floor(worldY(c, y + 0.5));
        if (wxv < 0 || wxv >= CW || wyv < 0 || wyv >= CH) continue;
        const tier = TIERS_M[wyv * CW + wxv];
        if (tier >= 3) { buf[i] = P.paper; continue; }
        buf[i] = v - THR[i] < 0.22 && front - (y - g) < 60 ? P.strong : ramp[tier];
      }
    }
  }

  // ---------------------------------------------------------------- one frame of the plate

  let DOT = { x: 0, y: 0, size: 8 };
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
    drawMirrorRange(t, P, c);

    // the line he has walked: fresh for the last stretch, rust once it is done
    const inked = sstep(T.hold0 - 0.4, T.hold0 + 0.4, t);
    let prev = null;
    for (let s = 0; s < CW; s++) {
      const g = GROUND[s];
      if (g > 1e8) { prev = null; continue; }
      const y = Math.round(g);
      const fresh = s <= dot.x && dot.x - s < 60;
      const col = inked > 0 ? P.accent : fresh ? P.strong : P.cell;
      const d = inked > 0 ? inked : 1;
      const y0 = prev === null ? y : Math.min(prev, y), y1 = prev === null ? y : Math.max(prev, y);
      for (let yy = y0; yy <= y1; yy++) { pS(s, yy, col, d); if (fresh || inked > 0) pS(s, yy + 1, col, d); }
      prev = y;
    }

    if (t > 9 && t < 29) drawCollege(t, P, c, dot);
    if (t > 28.5 && t < 40.5) drawGate(t, P, c, dot);
    if (t > 38 && t < 49.5) drawOracle(t, P, c);
    if (t > T.send0 - 0.2 && t < T.yes) drawHunt(t, P, c, dot);
    drawFog(t, P, c, dot);
    if (t > crashT() && t < crashT() + 5) drawCrash(t, P, c);
    if (t > T.spur0 && t < T.pull0 + 0.8) drawSpurs(t, P, c);
    strataLabels(t, P, c, dot);
    drawNumbers(t, P);
    drawWaypoints(t, P, c);

    // him: rust, knocked out of whatever is behind him, blinking when he waits
    const lowPoint = inv(55, 61.5, t) * (1 - inv(T.yes1, 71.6, t));
    const size = t < 4.5 ? Math.round(lerp(22, 8, EXPR(inv(1.5, 4.5, t)))) : lowPoint > 0.5 ? 10 : 8;
    const waiting = (t < 1.5) || (t >= T.alone && t < T.reply);
    const open = waiting ? ((t - (t < 1.5 ? 0 : T.alone)) % 0.5) < 0.27 : true;
    const bob = speedAt(t) > 2 && Math.floor(X / 1.2) % 2 ? -1 : 0;
    const x0 = Math.round(dot.x - size / 2), y0 = Math.round(dot.y) - size + bob - 1;
    fillS(x0 - 1, y0 - 1, x0 + size + 1, y0 + size + 1, P.paper, 1);
    if (open) fillS(x0, y0, x0 + size, y0 + size, P.accent, 1);
    DOT = { x: dot.x, y: dot.y, size };
    const tg = tagAt(t), ta = sstep(2.2, 2.8, t) * (1 - sstep(T.hold0 - 0.5, T.hold0, t));
    if (tg && ta > 0) txt(tg, Math.round(dot.x * C + size + 18), Math.round((dot.y - size - 6) * C), { screen: true, size: 33, color: P.css.dim, alpha: ta });

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
  const turned = new Uint32Array(CW * CH);

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
    const tau = t - DAY_OFFSET;
    sSummit(tau, DAY);
    buf = layer;
  }

  // the plate turns over: column scale 1 -> -1, darkening as it goes edge on
  function turnPlate(src, s) {
    const cx = (CW - 1) / 2, shade = 1 - Math.abs(s);
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const i = y * CW + x;
        if (Math.abs(s) < 0.02) { turned[i] = NIGHT.paper; continue; }
        const sxp = Math.round(cx + (x - cx) / s);
        if (sxp < 0 || sxp >= CW) { turned[i] = NIGHT.paper; continue; }
        turned[i] = shade * 0.8 > THR[i] ? NIGHT.paper : src[y * CW + sxp];
      }
    return turned;
  }

  function render(t) {
    t = clamp(t, 0, DUR);
    if (t < T.flip0) { drawNight(t, NIGHT, frameN, ovNx); blit(frameN); ctx.drawImage(ovN, 0, 0); return; }
    if (t >= T.press1) { drawDay(t, frameD, ovDx); blit(frameD); ctx.drawImage(ovD, 0, 0); return; }
    drawNight(T.flip0 - 0.001, NIGHT, frameN, ovNx);
    if (t < T.flip1) { blit(turnPlate(frameN, Math.cos(Math.PI * E.inOutCubic(inv(T.flip0, T.flip1, t))))); return; }
    // the roller: from his summit, left to right, leaving the print behind it
    const plate = turnPlate(frameN, -1);
    drawDay(t, frameD, ovDx);
    const rx = E.inOutCubic(inv(T.flip1, T.press1, t)) * (CW + 60) - 10;
    const out = frameN;
    for (let y = 0; y < CH; y++)
      for (let x = 0; x < CW; x++) {
        const i = y * CW + x, behind = rx - x;
        if (behind <= 0) { out[i] = plate[i]; continue; }
        if (behind < 45) {
          const shade = 0.2 + 0.7 * (1 - Math.sin((Math.PI * behind) / 45));
          out[i] = shade > THR[i] ? DAY.strong : DAY.dim;
          continue;
        }
        out[i] = frameD[i];
      }
    blit(out);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Math.max(0, (rx - 45) * C), H); ctx.clip(); ctx.drawImage(ovD, 0, 0); ctx.restore();
  }

  // ---------------------------------------------------------------- cues

  const FILM_CUES = [];
  function buildFilmCues() {
    const c = (t, type, v = 0) => FILM_CUES.push({ t: +t.toFixed(4), type, v });
    c(0, "blink"); c(0.5, "blink"); c(1.0, "blink");
    c(2.0, "start");
    let last = -1;
    for (let t = 2; t < T.summit + 0.1; t += 1 / 120) {
      const st = Math.floor(walkX(t) / 1.2);
      if (st !== last && speedAt(t) > 2) { c(t, "step", walkX(t)); last = st; }
    }
    for (const w of WORDS) c(w.t0, "word", ["line", "small", "big", "title", "sub", "quote", "attrib", "yes"].indexOf(w.k || "line"));
    for (let i = 0; i < 4; i++) { c(9.6 + i * 0.35, "join", i); c(19.2 + i * 0.3, "leave", i); }
    c(T.flag, "flag");
    for (let x = 214; x <= 252; x += 1.2) c(passAt(x), "day", x);
    c(T.crack, "crack"); c(T.hood0, "under");
    HOOD.forEach((_, k) => c(T.hood0 + 0.9 + k * 0.2, "hood", k));
    c(T.hood1 - 1.4, "surface");
    for (const p of PROPS) c(passAt(p.x) - 0.9, p.kind === "pi" ? "pi" : "server");
    c(T.fog0, "fog");
    for (const s of SENDS) c(s.t, "send");
    c(T.alone, "alone");
    for (let b = T.alone; b < T.reply; b += 0.5) c(b, "blink");
    c(T.reply, "reply"); c(T.land, "land"); c(T.silence, "silence"); c(T.yes, "yes");
    for (let x = 384; x <= 952; x += 24) for (let k = STRATA.length - 1; k >= 0; k--) c(builtAt(k, x), "layer", k);
    const ct = crashT();
    c(ct, "crash"); c(ct + 2.0, "reconcile"); c(ct + 3.0, "fixed");
    c(T.numeral0, "gather"); c(T.numeral0 + 1.2, "numeral"); c(T.burst, "burst");
    SPURS.forEach((sp, k) => c(sp.t, "spur", k));
    c(98.8, "runners"); c(T.summit, "summit");
    c(T.pull0, "pull"); c(T.print0, "print"); c(T.hold0, "hold");
    WAYPOINTS.forEach((_, k) => c(T.hold0 + 0.2 + k * 0.2, "waypoint", k));
    c(T.flip0, "flip"); c(T.flip1, "press"); c(T.press1, "pressed");
    // the day is already printed under the roller: its marks sound as the roller uncovers them
    const rolled = (x) => { let lo = T.flip1, hi = T.press1; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (E.inOutCubic(inv(T.flip1, T.press1, m)) * (CW + 60) - 10 - 45 < x) lo = m; else hi = m; } return lo; };
    c(rolled(32), "header");
    c(rolled(SUN_X), "sunrise");
    for (let k = 0; k < 12; k++) c(27.05 + (k * 0.55) / 12 + DAY_OFFSET, "type", k);
    c(27.75 + DAY_OFFSET, "closing");
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
