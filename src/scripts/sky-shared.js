// Shared foundation for the sky layers.
//
// The scene is drawn by several stacked canvases (sky-v3, sky-life-boost,
// twilight-sky, night-sky-v2), each of which had grown its own copy of the same
// maths helpers, its own theme test and its own requestAnimationFrame loop. The
// duplication is what let the sun bug hide: two layers disagreed about whether
// suncalc reports degrees or radians, and nothing forced them to agree.
//
// Everything here is the single definition the layers share.

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function smoothstep(a, b, value) {
  var t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Integer hash: stable across platforms, for grid coordinates and seeds.
export function hash(value) {
  value = Math.imul(value ^ (value >>> 16), 2246822507);
  value = Math.imul(value ^ (value >>> 13), 3266489909);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function hash2(x, y, seed) {
  return hash(Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519));
}

// Float hash, for callers that seed from fractional values -- the integer hash
// truncates those and neighbouring inputs collide.
export function hashUnit(n) {
  var v = Math.sin(n * 127.1) * 43758.5453;
  return v - Math.floor(v);
}

var BAYER_8 = [
  0,48,12,60,3,51,15,63,32,16,44,28,35,19,47,31,
  8,56,4,52,11,59,7,55,40,24,36,20,43,27,39,23,
  2,50,14,62,1,49,13,61,34,18,46,30,33,17,45,29,
  10,58,6,54,9,57,5,53,42,26,38,22,41,25,37,21
];

export function bayerThreshold(x, y) {
  var px = ((Math.floor(x) % 8) + 8) % 8;
  var py = ((Math.floor(y) % 8) + 8) % 8;
  return BAYER_8[py * 8 + px] / 64;
}

// sky-v3 owns the scene geometry and publishes it for the layers above.
export function baseState() {
  return window.__portfolioSky && window.__portfolioSky.state
    ? window.__portfolioSky.state()
    : null;
}

// Day and night follow the sun over Vadodara, not the visitor's OS theme.
// BaseLayout's inline script sets data-sky before first paint; sky-v3 corrects
// it from real ephemeris and fires skyphasechange when it flips.
export function isNight() {
  return document.documentElement.dataset.sky === "night";
}

export function onSkyPhase(handler) {
  window.addEventListener("skyphasechange", handler);
}

// Publishes the phase and keeps the browser-chrome colour in step with it.
// Also called on load, because the phase can flip mid-session at sunset and the
// inline boot script only ever gets to run once.
export function setSkyPhase(phase) {
  var root = document.documentElement;
  var changed = root.dataset.sky !== phase;
  root.dataset.sky = phase;

  var themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute("content", phase === "night" ? "#0b0e13" : "#eee9df");

  if (changed) {
    markThemeShift();
    window.dispatchEvent(new Event("skyphasechange"));
  }
}

// Interpolating the page from cream to black is not an option: at the midpoint
// the background sits at mid grey, where the best contrast any ink can manage
// is about 1.5:1. There is no readable colour there, so the page keeps its two
// designed ends and cross-fades between them instead. The steady states stay
// legible; only the half-second of change passes through the bad zone, and
// nobody is reading during it.
var shiftTimer = 0;

export function markThemeShift() {
  var root = document.documentElement;
  root.setAttribute("data-theme-shift", "");
  window.clearTimeout(shiftTimer);
  shiftTimer = window.setTimeout(function () {
    root.removeAttribute("data-theme-shift");
  }, 900);
}

export function listenMedia(media, handler) {
  if (media.addEventListener) media.addEventListener("change", handler);
  else if (media.addListener) media.addListener(handler);
}

export var motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

// Touch devices. Hover affordances, the parallax and the nudge all assume a
// pointer that can rest somewhere without committing to it. maxTouchPoints is
// checked as well as the media query, because iPadOS with a trackpad attached
// reports hover:hover while still being a touch device most of the time.
export var coarseMedia = window.matchMedia("(hover: none), (pointer: coarse)");

export function isCoarse() {
  return coarseMedia.matches || (navigator.maxTouchPoints || 0) > 0;
}

// Published so the stylesheet can key off the same answer the scripts use.
document.documentElement.dataset.pointer = isCoarse() ? "coarse" : "fine";

// Dither-threshold animation, after the technique on dark.ronacher.eu: nothing
// moves. Each dithered cell is re-decided against a threshold nudged by slow
// value noise, so only cells already sitting near their threshold can flip and
// the texture crawls without the shape shifting.
export var FLICKER_STEP = 900;

export function flickerOffset(seed, now, amplitude) {
  var t = now / FLICKER_STEP + seed;
  var i = Math.floor(t);
  var f = t - i;
  var n1 = hashUnit(seed * 13.7 + i);
  var n2 = hashUnit(seed * 13.7 + i + 1);
  return (n1 + (n2 - n1) * (f * f * (3 - 2 * f)) - 0.5) * amplitude;
}

// Optional scene effects, toggled by the typed commands in easter-eggs.js and
// read by the layers that draw them. Kept here rather than on window so the
// layers import it like anything else.
export var effects = {
  snow: false,
  stars: false,
  hovered: null,
  bodyHover: null,
  bodyPulse: null,
  ridge: false,
  frozen: false,
  // How fast scene time runs against the wall. `still` is this at zero by
  // another route; `fast` moves it up.
  rate: 1
};

// Scene time, which is not wall time.
//
// Everything that moves reads its clock from here, so one multiplier speeds the
// whole sky up at once and no layer has to know it happened. It is accumulated
// rather than scaled, so changing the rate bends the curve from where the scene
// already is instead of teleporting it, and steps are capped so coming back to a
// backgrounded tab does not fast-forward an hour of weather in one frame.
//
// The point of exporting it is that the layers must not mix clocks. Several used
// to seed a rebuild with performance.now() and then take frame times from the
// loop; once those two disagree, deltas come out negative and the layer either
// runs backwards or freezes.
var sceneTime = 0;
var lastPumpAt = 0;

export function sceneNow() {
  return sceneTime;
}

// What the "budget" overlay reports. Every layer contributes its own counts so
// the panel is describing the real renderer rather than an estimate of it.
export var budget = {
  fps: 0,
  frames: 0,
  since: 0,
  terrainCells: 0,
  sunCells: 0,
  wisps: 0,
  poolCells: 0,
  birds: 0
};

// One animation loop for every layer. Each layer keeps its own frame budget and
// its own guards; this just stops four independent rAF chains from running the
// same scheduling logic four times over.
var callbacks = [];
var raf = 0;

// Nothing in the sky needs to redraw while the page is moving past it. On iOS
// the compositor is already busy with the scroll, and a canvas repainting into a
// promoted layer at the same time is what the stutter was made of.
var scrolling = 0;
var scrollStop = 0;

window.addEventListener("scroll", function () {
  if (!scrolling) {
    scrolling = 1;
    document.documentElement.setAttribute("data-scrolling", "");
  }
  window.clearTimeout(scrollStop);
  scrollStop = window.setTimeout(function () {
    scrolling = 0;
    document.documentElement.removeAttribute("data-scrolling");
  }, 180);
}, { passive: true });

function pump(now) {
  raf = window.requestAnimationFrame(pump);

  // The frame counter is the one thing here that wants the wall: a scene running
  // at three times speed is not running at three times the frame rate, and the
  // meter would be lying if it said so.
  budget.frames++;
  if (!budget.since) budget.since = now;
  else if (now - budget.since >= 1000) {
    budget.fps = Math.round((budget.frames * 1000) / (now - budget.since));
    budget.frames = 0;
    budget.since = now;
  }

  if (lastPumpAt) sceneTime += Math.min(250, now - lastPumpAt) * effects.rate;
  lastPumpAt = now;

  if (effects.frozen) return;
  for (var i = 0; i < callbacks.length; i++) {
    // Painters stand down while the page is moving; anything that follows the
    // scroll has to keep up with it, or it is the jank.
    if (scrolling && !callbacks[i].whileScrolling) continue;
    callbacks[i](sceneTime);
  }
}

function resume() {
  if (raf || !callbacks.length || motionMedia.matches || document.hidden) return;
  raf = window.requestAnimationFrame(pump);
}

function halt() {
  // Dropped so the first frame after a resume measures from that frame rather
  // than from whenever the loop was stopped.
  lastPumpAt = 0;
  if (!raf) return;
  window.cancelAnimationFrame(raf);
  raf = 0;
}

export function onFrame(callback, whileScrolling) {
  callback.whileScrolling = !!whileScrolling;
  callbacks.push(callback);
  resume();
}

document.addEventListener("visibilitychange", function () {
  if (document.hidden) halt();
  else resume();
});

listenMedia(motionMedia, function () {
  if (motionMedia.matches) halt();
  else resume();
});


// --- the mountain --------------------------------------------------------
//
// The hero prints a living plate of the range and the interior pages print a
// static band of it. Those are two crops of one photograph, so what the ink
// looks like and how the photograph's luminance becomes ink density are defined
// once, here, rather than tuned twice and allowed to drift apart.

// Art-directed exposure, driven by the same ephemeris as the visible moon.
// Keep an ambient floor so unlit terrain remains legible. This is not a lux model.
export function terrainExposure(celestial) {
  if (!celestial) return 0.22;
  const moon = celestial.moon;
  const moonlight = Math.pow(clamp(moon.fraction, 0, 1), 1.6)
    * smoothstep(0, 45, moon.altitude);
  const twilight = smoothstep(-18, -6, celestial.sun.altitude);
  return clamp(0.22 + 0.70 * moonlight + 0.45 * twilight, 0.22, 0.92);
}

export var SKY_THEMES = {
  dark: {
    ink: "#e4dac8",
    // Cool snow, shadowed snow, then faint rock. Overall exposure follows
    // the moon's illuminated fraction and altitude when the plate is drawn.
    terrainRamp: [
      { ink: "#c6d2db", weight: 1.00 },
      { ink: "#94a2ad", weight: 0.95 },
      { ink: "#3c5470", weight: 0.46 }
    ],
    terrainAlpha: 0.91,
    dustAlpha: 0.23,
    star: "#eee6d8",
    starAlpha: 0.94,
    satelliteAlpha: 0.34
  },
  light: {
    ink: "#293039",
    // Day inverts the tone curve, so tier 0 is the near rock rather than the
    // snow. The ramp inverts with it: full ink up close, and the distance
    // going pale and blue the way a hazy ridge does at noon. This is the same
    // aerial perspective DAY_TONE_GAMMA already stretches, said in hue.
    terrainRamp: [
      { ink: "#232a34", weight: 1.00 },
      { ink: "#4a5a6d", weight: 0.90 },
      { ink: "#7d8b9a", weight: 0.44 }
    ],
    terrainAlpha: 0.87,
    dustAlpha: 0.18,
    star: "#293039",
    starAlpha: 0,
    satelliteAlpha: 0
  }
};

// Ink tiers, densest first. The quantiser has TERRAIN_TIERS + 1 levels: tiers
// 0..TERRAIN_TIERS-1 print, and tier TERRAIN_TIERS is bare paper. Four levels
// rather than two is the change that matters -- at 1 bit the plate had only
// "ink" and "nothing", so a lit snow field and a lit rock face printed
// identically and the whole range came out a flat cutout.
export var TERRAIN_TIERS = 3;

// Aerial perspective. The range used to print at one ink density from the
// nearest buttress to the farthest peak, which is why it read as a cutout
// rather than as miles of air.
//
// The fix is not a depth map. The photograph already recorded the haze -- the
// far ridges came back lower in contrast because there is more atmosphere in
// front of them -- and the old exponent was flattening that back out. Raising
// it stretches the mid densities down toward paper while anything at full
// density stays put, so the near silhouette keeps its weight and the distance
// recedes. It amplifies a real measurement instead of inventing a geometry.
//
// Set by measurement rather than by eye. At 1.32 the largest ink change
// anywhere on the plate was 6.6 points of density, confined to the mid-tones,
// which is a real difference and one nobody can see. This moves it to about
// 15, which separates the far ridges from the near buttress at a glance while
// still leaving everything at full density exactly where it was.
export var DAY_TONE_GAMMA = 1.62;

// Photographed luminance (0..255) to paper value, where 1 is bare paper and 0
// is full ink. Day and night are composed separately rather than inverted.
export function terrainPaper(luminance, dark) {
  var value = luminance / 255;
  var density = dark
    ? 0.035 + 0.965 * Math.pow(smoothstep(0.055, 0.95, value), 1.27)
    : 0.018 + 0.982 * Math.pow(smoothstep(0.035, 0.84, 1 - value), DAY_TONE_GAMMA);
  return 1 - clamp(density, 0, 1);
}

// Atkinson error diffusion, quantising to TERRAIN_TIERS + 1 evenly spaced tones
// rather than to black and white. The kernel and its weights are the classic
// ones; only the quantiser differs, so the grain is the same grain with more
// inks to land in. Everything at or above the skyline is left as bare paper.
// Returns the tier per cell: 0 is the densest ink, TERRAIN_TIERS is paper.
export function atkinsonTiers(paper, skyline, width, height) {
  var work = new Float32Array(paper);
  var dots = new Uint8Array(width * height);

  function diffuse(x, y, error) {
    if (x < 0 || y < 0 || x >= width || y >= height || y < skyline[x]) return;
    work[y * width + x] += error;
  }

  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var i = y * width + x;

      if (y < skyline[x]) {
        work[i] = 1;
        dots[i] = TERRAIN_TIERS;
        continue;
      }

      var old = work[i];
      var level = Math.round(clamp(old, 0, 1) * TERRAIN_TIERS);
      var quantized = level / TERRAIN_TIERS;
      dots[i] = level;
      var error = (old - quantized) * 0.125;
      if (!error) continue;

      diffuse(x + 1, y, error);
      diffuse(x + 2, y, error);
      diffuse(x - 1, y + 1, error);
      diffuse(x, y + 1, error);
      diffuse(x + 1, y + 1, error);
      diffuse(x, y + 2, error);
    }
  }

  return dots;
}

// The plate prints mirrored.
//
// The photograph's tallest ridge is at its left edge and the skyline runs
// downhill from there: 447 at x=0 against a mean of 764 and around 900 across
// the right third, where the range gives out into a featureless near slope.
// The hero copy is set flush left, so unmirrored the heaviest part of the
// photograph and the only text on the page are stacked in the same corner --
// hero-clearance lifts the copy to clear the peak -- while the side of the
// page with nothing on it gets the emptiest part of the frame. Mirrored, the
// copy sits over the low end of the range and the peaks carry the right.
//
// Nothing in the scene is handed; the range reads the same either way.
export var PLATE_FLIP = true;

// How much tighter than the full frame the landscape crop sits. Only the
// landscape branch takes it: that branch is the one that prints the whole
// width of the photograph, so it is the one with room to give. Portrait
// already shows about a third of the width and tightening that clips peaks.
export var PLATE_ZOOM = 1.4;

// The ridge trace's own extent, and where the crop's top edge sits at 1x, all
// as fractions of plate height. Two things depend on these.
//
// First, the zoom is taken about the top of the ridge rather than about the
// top edge of the crop, and the difference is the whole effect. Hold the top
// edge still and a tighter window puts the skyline further down inside it, so
// the range slides toward the bottom of the viewport and the page gains sky:
// zooming in, and getting a smaller mountain. Taken about the ridge, the
// skyline stays put and the range grows underneath it. It also keeps the
// origin above the ridge at every zoom, which is what stops a tighter crop
// pulling the skyline out of the band the renderer measures luminance in and
// printing the bare paper above it as solid ink.
//
// Second, the zoom is capped so the whole ridge stays inside the part of the
// band the viewport actually shows. The skyline drops 0.29 of the plate from
// its high point to its low one, and a column whose ridge falls past the
// bottom of the viewport is all sky: no mountain in it at all. On a 16:9
// screen there is room for about 1.47x before that starts happening; on an
// ultrawide there is room for almost none, and a fixed zoom applied blind
// there empties the left half of the page. So the cap is computed per layout
// from how much of the drawn band is on screen, and PLATE_ZOOM is the ceiling
// rather than the value.
var PLATE_ORIGIN = 0.17;
var PLATE_RIDGE_TOP = 0.211;
var PLATE_RIDGE_LOW = 0.499;

// The crop of the photograph that fills a frame of the given size. The hero
// uses it for a whole viewport; the interior pages use it for a short band, and
// because the rule is the same the ridge lands in the same place in both.
//
// `visible` is how much of that frame the viewport actually shows -- the band
// is drawn with overscan below the fold -- and only the zoom cap reads it.
export function terrainCrop(plateW, plateH, targetW, targetH, portrait, visible) {
  var sourceAspect = plateW / plateH;
  var targetAspect = targetW / targetH;
  var sx = 0;
  var sy = 0;
  var sw = plateW;
  var sh = plateH;
  var focus = portrait ? 0.55 : 0.52;

  if (targetAspect > sourceAspect) {
    // The whole trim comes off the plate's right end, and it has to. The
    // highest point of the ridge is at x=112 of 3000, so a centred crop eats
    // the tallest peak in the photograph before it takes anything else, which
    // is the one thing on the plate worth keeping. The right end is the
    // featureless near slope. Mirrored, that reads as trimming the empty side
    // of the page and holding the peaks against the other edge.
    var full = plateW / targetAspect;
    var lift = plateH * (PLATE_RIDGE_TOP - PLATE_ORIGIN);
    var reach = plateH * (PLATE_RIDGE_LOW - PLATE_RIDGE_TOP);
    var onscreen = full * clamp(visible || 1, 0, 1);
    var zoom = clamp((onscreen - lift) / reach, 1, PLATE_ZOOM);

    sw = plateW / zoom;
    sh = sw / targetAspect;
    sx = 0;
    sy = clamp(plateH * PLATE_RIDGE_TOP - lift / zoom, 0, Math.max(0, plateH - sh));
  } else {
    sw = sh * targetAspect;
    sx = clamp(plateW * focus - sw / 2, 0, Math.max(0, plateW - sw));
  }

  return { sx: sx, sy: sy, sw: sw, sh: sh };
}
