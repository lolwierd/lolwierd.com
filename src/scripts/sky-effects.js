// Optional scene effects, drawn by twilight-sky.js on top of its cached base.
//
// They live here rather than in that file because none of them belong to the
// sky's normal job: they only exist because someone typed a word. Keeping them
// separate means the everyday render path stays readable.

import { clamp, hashUnit, effects } from "./sky-shared.js";

var flakes = null;
var flakeKey = "";

// ── snow ────────────────────────────────────────────────────────────────────

export function drawSnow(ctx, state, now) {
  var key = state.width + "x" + state.height;
  if (!flakes || flakeKey !== key) {
    flakeKey = key;
    flakes = [];
    var count = state.portrait ? 90 : 170;
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
    var fall = (flake.y + now * 0.018 * flake.depth * state.dpr) % state.height;
    var x = Math.round(flake.x + Math.sin(now / flake.period + flake.phase) * flake.sway);
    var y = Math.round(fall);
    if (x < 0 || x >= state.width) continue;

    ctx.globalAlpha = 0.10 + flake.depth * 0.30;
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
