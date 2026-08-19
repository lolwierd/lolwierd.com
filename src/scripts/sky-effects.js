// Optional scene effects, drawn by twilight-sky.js on top of its cached base.
//
// They live here rather than in that file because none of them belong to the
// sky's normal job: they only exist because someone typed a word. Keeping them
// separate means the everyday render path stays readable.

import { clamp, smoothstep, hashUnit, hash2, bayerThreshold, flickerOffset, effects } from "./sky-shared.js";

var flakes = null;
var flakeKey = "";

// ── snow ────────────────────────────────────────────────────────────────────

export function drawSnow(ctx, state, now) {
  var key = state.width + "x" + state.height;
  if (!flakes || flakeKey !== key) {
    flakeKey = key;
    flakes = [];
    var count = state.portrait ? 190 : 380;
    for (var i = 0; i < count; i++) {
      flakes.push({
        x: hashUnit(i * 3.7) * state.width,
        y: hashUnit(i * 8.1) * state.height,
        // Depth: near flakes fall faster, drift wider and sit brighter.
        depth: 0.35 + hashUnit(i * 1.9) * 0.65,
        sway: (6 + hashUnit(i * 5.3) * 22) * state.dpr,
        period: 3200 + hashUnit(i * 6.7) * 5200,
        phase: hashUnit(i * 2.3) * Math.PI * 2
      });
    }
  }

  var core = Math.max(1, Math.round(state.dpr));
  ctx.fillStyle = state.dark ? "#e4dac8" : "#5a5954";

  for (var f = 0; f < flakes.length; f++) {
    var flake = flakes[f];
    var fall = (flake.y + now * 0.034 * flake.depth * state.dpr) % state.height;
    var x = Math.round(flake.x + Math.sin(now / flake.period + flake.phase) * flake.sway);
    var y = Math.round(fall);
    if (x < 0 || x >= state.width) continue;

    ctx.globalAlpha = 0.12 + flake.depth * 0.34;
    var size = flake.depth > 0.8 ? core * 2 : core;
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;
}

// ── constellations ──────────────────────────────────────────────────────────

// Right ascension in hours, declination in degrees. A small catalogue: the
// figures that are actually recognisable, not a full sky survey.
var STARS = {
  dubhe: [11.062, 61.75], merak: [11.031, 56.38], phecda: [11.897, 53.69],
  megrez: [12.257, 57.03], alioth: [12.900, 55.96], mizar: [13.399, 54.93],
  alkaid: [13.792, 49.31],

  betelgeuse: [5.919, 7.41], bellatrix: [5.418, 6.35], alnitak: [5.679, -1.94],
  alnilam: [5.604, -1.20], mintaka: [5.533, -0.30], saiph: [5.796, -9.67],
  rigel: [5.242, -8.20],

  schedar: [0.675, 56.54], caph: [0.153, 59.15], gamcas: [0.945, 60.72],
  ruchbah: [1.430, 60.24], segin: [1.906, 63.67],

  antares: [16.490, -26.43], graffias: [16.090, -19.81], dschubba: [16.005, -22.62],
  sargas: [17.622, -42.998], shaula: [17.560, -37.104], lesath: [17.513, -37.296],
  girtab: [17.708, -39.03],

  deneb: [20.690, 45.28], sadr: [20.370, 40.257], gienah: [20.770, 33.97],
  delcyg: [19.750, 45.13], albireo: [19.512, 27.96],

  regulus: [10.139, 11.97], denebola: [11.818, 14.57], algieba: [10.333, 19.84],
  zosma: [11.235, 20.52], adhafera: [10.278, 23.42]
};

var FIGURES = [
  ["dubhe", "merak", "phecda", "megrez", "dubhe"],
  ["megrez", "alioth", "mizar", "alkaid"],
  ["betelgeuse", "bellatrix", "mintaka", "alnilam", "alnitak", "betelgeuse"],
  ["alnitak", "saiph"], ["mintaka", "rigel"],
  ["caph", "schedar", "gamcas", "ruchbah", "segin"],
  ["graffias", "dschubba", "antares", "sargas", "shaula", "lesath", "girtab"],
  ["deneb", "sadr", "albireo"], ["delcyg", "sadr", "gienah"],
  ["regulus", "algieba", "adhafera", "zosma", "denebola", "regulus"]
];

var RAD = Math.PI / 180;
var LAT = 22.3072;
var LON = 73.1812;

function localSiderealDegrees(date) {
  var d = date.valueOf() / 86400000 - 10957.5;
  return (((18.697374558 + 24.06570982441908 * d) % 24) * 15 + LON + 360) % 360;
}

// Equatorial to horizontal for Vadodara.
function altAz(raHours, decDegrees, lst) {
  var ha = (lst - raHours * 15) * RAD;
  var dec = decDegrees * RAD;
  var lat = LAT * RAD;
  var sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
  var alt = Math.asin(clamp(sinAlt, -1, 1));
  var az = Math.atan2(
    Math.sin(ha),
    Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)
  );
  return { alt: alt / RAD, az: ((az / RAD + 180) % 360 + 360) % 360 };
}

// The photograph has no recorded bearing, so azimuth maps linearly across the
// frame. The figures are the right shape and turn at the right rate; only which
// compass direction the camera faced is invented.
function project(pos, state) {
  return {
    x: (pos.az / 360) * state.width,
    y: state.height * (0.52 - clamp(pos.alt, 0, 90) / 90 * 0.46),
    up: pos.alt > 1
  };
}

export function drawConstellations(ctx, state, date) {
  var lst = localSiderealDegrees(date);
  var points = {};
  for (var name in STARS) {
    points[name] = project(altAz(STARS[name][0], STARS[name][1], lst), state);
  }

  var core = Math.max(1, Math.round(state.dpr));
  ctx.save();
  ctx.strokeStyle = "#8f9bb3";
  ctx.lineWidth = Math.max(1, state.dpr * 0.75);
  ctx.globalAlpha = 0.34;

  for (var f = 0; f < FIGURES.length; f++) {
    var figure = FIGURES[f];
    for (var i = 0; i < figure.length - 1; i++) {
      var a = points[figure[i]];
      var b = points[figure[i + 1]];
      if (!a || !b || !a.up || !b.up) continue;
      // Wrapping the azimuth seam would draw a line straight across the sky.
      if (Math.abs(a.x - b.x) > state.width * 0.5) continue;
      if (a.y >= state.skyline[clamp(Math.round(a.x), 0, state.width - 1)]) continue;
      if (b.y >= state.skyline[clamp(Math.round(b.x), 0, state.width - 1)]) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "#eee6d8";
  for (var star in points) {
    var p = points[star];
    if (!p.up) continue;
    var sx = Math.round(p.x);
    var sy = Math.round(p.y);
    if (sx < 0 || sx >= state.width) continue;
    if (sy >= state.skyline[clamp(sx, 0, state.width - 1)]) continue;
    ctx.fillRect(sx - core, sy, core * 3, core);
    ctx.fillRect(sx, sy - core, core, core * 3);
  }
  ctx.restore();
}

// ── eclipse ─────────────────────────────────────────────────────────────────

export var ECLIPSE_MS = 14000;

// A dark disc walks across the sun and the sky loses its light with it. The
// moon's real position is nowhere near the sun today, so this is staged: the
// one effect here that is a picture rather than a measurement.
export function drawEclipse(ctx, state, sun, now) {
  if (!effects.eclipseStart) return 0;
  var t = (now - effects.eclipseStart) / ECLIPSE_MS;
  if (t < 0 || t > 1) {
    effects.eclipseStart = 0;
    return 0;
  }

  var travel = sun.radius * 7;
  var mx = sun.x - travel / 2 + travel * t;
  var my = sun.y - sun.radius * 0.22;
  var moonR = sun.radius * 1.04;

  var page = getComputedStyle(document.documentElement).getPropertyValue("--page").trim() || "#eee9df";
  ctx.save();
  ctx.fillStyle = page;
  ctx.beginPath();
  ctx.arc(mx, my, moonR, 0, Math.PI * 2);
  ctx.fill();

  // A thin rim of light left along the leading edge reads as the corona.
  var coverage = 1 - clamp(Math.abs(mx - sun.x) / (sun.radius * 1.6), 0, 1);
  if (coverage > 0.72) {
    ctx.globalAlpha = (coverage - 0.72) / 0.28 * 0.5;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#9d4429";
    ctx.lineWidth = Math.max(1, state.dpr);
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, sun.radius * 1.08, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  return coverage;
}


// ── moon ────────────────────────────────────────────────────────────────────

// The moon used to be drawn by sky-v3, underneath the layer that paints the
// sky, and only once the sky was fully dark. That made the one thing everybody
// has actually seen -- a moon hanging in a sunset -- impossible. It lives up
// here now, and shows whenever it is above the horizon.

var MOON_BAND = 0.11;
var MOON_AMP = 0.12;

export function buildMoon(state, clearOfCopy) {
  var moon = state.celestial && state.celestial.moon;
  if (!moon || !moon.visible) return null;

  var dpr = state.dpr;
  var core = Math.max(1, Math.round(dpr));
  var radius = Math.round((state.portrait ? 20 : 27) * dpr);
  var x = moon.x;
  // Unlike the sun this nudges in any orientation: the moon is small and the
  // sky is wide, and a crescent sitting behind a paragraph reads as a defect.
  var y = clearOfCopy ? clearOfCopy(state, moon.x, moon.y, radius * 1.6, true) : moon.y;

  var cos = Math.cos(moon.limbAngle);
  var sin = Math.sin(moon.limbAngle);
  var seed = state.width * 47 + state.height * 61 + 4409;

  // In full daylight a washed-out moon reads as a smudge behind the text rather
  // than as the moon, so it is not drawn at all until the sun is near the
  // horizon. It fades up through golden hour and is at full strength once the
  // sun is properly down -- which is also every hour the typed commands land on.
  var reveal = 1 - smoothstep(-4, 4, state.celestial.sun.altitude);
  if (reveal < 0.03) return null;
  var strength = 0.45 + reveal * 0.55;

  var solid = [];
  var marginal = [];

  for (var dy = -radius; dy <= radius; dy += core) {
    for (var dx = -radius; dx <= radius; dx += core) {
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;

      // Terminator: which side of the disc the sun is lighting, tilted by the
      // limb angle so the crescent points the right way for the hour.
      var rx = dx * cos - dy * sin;
      var ry = dx * sin + dy * cos;
      var rowHalf = Math.sqrt(Math.max(0, radius * radius - ry * ry));
      var terminator = rowHalf * (1 - 2 * moon.fraction);
      var lit = moon.waxing ? rx >= terminator : rx <= -terminator;
      if (!lit) continue;

      var px = Math.round(x + dx);
      var py = Math.round(y + dy);
      if (px < 0 || px >= state.width || py < 0 || py >= state.skyline[px]) continue;

      var edge = smoothstep(radius * 0.84, radius, distance);
      var density = 1 - edge * 0.76;
      if (hash2(dx, dy, seed) < 0.035 + edge * 0.08) continue;

      var alpha = (0.66 + (1 - edge) * 0.24) * strength;
      var bayer = bayerThreshold(px / core, py / core);
      var margin = density >= 0.98 ? 1 : density - bayer;

      if (margin > MOON_BAND) solid.push(px, py, alpha);
      else if (margin > -MOON_BAND) {
        marginal.push({ x: px, y: py, a: alpha, d: density, b: bayer, s: hashUnit(px * 0.29 + py * 0.53) });
      }
    }
  }

  // A ring of motes around the limb, brighter on the lit side, breathing slowly.
  var aura = [];
  var rays = state.portrait ? 68 : 92;
  for (var ray = 0; ray < rays; ray++) {
    var angle = (ray / rays) * Math.PI * 2;
    var ux = Math.cos(angle);
    var uy = Math.sin(angle);
    var ex = ux * radius * 0.94;
    var ey = uy * radius * 0.94;
    var rotX = ex * cos - ey * sin;
    var rotY = ex * sin + ey * cos;
    var half = Math.sqrt(Math.max(0, radius * radius - rotY * rotY));
    var illuminated = moon.waxing
      ? rotX >= half * (1 - 2 * moon.fraction)
      : rotX <= -half * (1 - 2 * moon.fraction);
    if (hash2(ray, radius, seed + 31) > (illuminated ? 0.66 : 0.38)) continue;

    aura.push({
      x: x + ex,
      y: y + ey,
      ux: ux,
      uy: uy,
      reach: (illuminated ? 3 + hash2(ray, radius, seed + 37) * 8 : 2 + hash2(ray, radius, seed + 37) * 5) * dpr,
      alpha: (illuminated
        ? 0.075 + hash2(ray, radius, seed + 41) * 0.095
        : 0.035 + hash2(ray, radius, seed + 41) * 0.045) * strength,
      phase: hash2(ray, radius, seed + 43) * Math.PI * 2,
      phase2: hash2(ray, radius, seed + 45) * Math.PI * 2,
      tangent: (0.25 + hash2(ray, radius, seed + 46) * 0.75) * dpr,
      period: 4600 + hash2(ray, radius, seed + 47) * 7200
    });
  }

  return { solid: solid, marginal: marginal, aura: aura, core: core, width: state.width, skyline: state.skyline };
}

export function paintMoonSolids(ctx, scene, ink) {
  if (!scene) return;
  ctx.fillStyle = ink;
  for (var i = 0; i < scene.solid.length; i += 3) {
    ctx.globalAlpha = scene.solid[i + 2];
    ctx.fillRect(scene.solid[i], scene.solid[i + 1], scene.core, scene.core);
  }
  ctx.globalAlpha = 1;
}

// The moon does not twinkle -- it has no atmosphere to twinkle through -- but
// its dithered limb can breathe, and the aura around it drifts. Enough motion
// to notice, not enough to look like a star.
export function drawMoon(ctx, scene, ink, now, still) {
  if (!scene) return;
  ctx.fillStyle = ink;

  for (var i = 0; i < scene.marginal.length; i++) {
    var m = scene.marginal[i];
    var threshold = still ? m.b : m.b + flickerOffset(m.s, now, MOON_AMP);
    if (m.d <= threshold) continue;
    ctx.globalAlpha = m.a;
    ctx.fillRect(m.x, m.y, scene.core, scene.core);
  }

  for (var a = 0; a < scene.aura.length; a++) {
    var mote = scene.aura[a];
    var release = still ? 0.5 : 0.5 + 0.5 * Math.sin((now / mote.period) * Math.PI * 2 + mote.phase);
    var wobble = still ? 0 : Math.sin((now / (mote.period * 0.41)) * Math.PI * 2 + mote.phase2) * mote.tangent;
    var ax = Math.round(mote.x + mote.ux * mote.reach * release - mote.uy * wobble);
    var ay = Math.round(mote.y + mote.uy * mote.reach * release + mote.ux * wobble);
    if (ax < 0 || ax >= scene.width || ay < 0 || ay >= scene.skyline[ax]) continue;
    ctx.globalAlpha = mote.alpha * (0.36 + (1 - release) * 0.64);
    ctx.fillRect(ax, ay, scene.core, scene.core);
  }
  ctx.globalAlpha = 1;
}
