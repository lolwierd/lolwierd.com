import {
  clamp,
  smoothstep as smooth,
  hash,
  hash2,
  baseState,
  listenMedia as listen,
  onFrame
} from "./sky-shared.js";

(function () {
  "use strict";

  var motionMedia = matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = motionMedia.matches;
  var visible = !document.hidden;
  var FIXED_TIME = 1400;
  var FRAME_MS = 1000 / 30;

  // Keep the summit weather in the same print language as the terrain.
  var BAYER_8 = [
     0, 32,  8, 40,  2, 34, 10, 42,
    48, 16, 56, 24, 50, 18, 58, 26,
    12, 44,  4, 36, 14, 46,  6, 38,
    60, 28, 52, 20, 62, 30, 54, 22,
     3, 35, 11, 43,  1, 33,  9, 41,
    51, 19, 59, 27, 49, 17, 57, 25,
    15, 47,  7, 39, 13, 45,  5, 37,
    63, 31, 55, 23, 61, 29, 53, 21
  ];

  var canvas = null;
  var ctx = null;
  var state = null;
  var ridge = null;
  var luminance = null;

  // Glacial snow crystal glints inside sunlit snow faces
  var snowCrystals = [];
  // Shadow couloir breathing dots in deep rock valleys
  var shadowDots = [];

  var mouse = { x: -1000, y: -1000, vx: 0, vy: 0, speed: 0, lastX: 0, lastY: 0, lastT: 0 };
  var last = 0;
  var tries = 0;
  var width = 0;
  var height = 0;
  var dpr = 1;

  window.addEventListener("pointermove", function (e) {
    var now = performance.now();
    var dt = Math.max(1, now - (mouse.lastT || now));
    var dx = e.clientX * dpr - mouse.lastX;
    var dy = e.clientY * dpr - mouse.lastY;
    mouse.x = e.clientX * dpr;
    mouse.y = e.clientY * dpr;
    mouse.vx = dx / dt;
    mouse.vy = dy / dt;
    mouse.speed = Math.min(3.0, Math.hypot(mouse.vx, mouse.vy));
    mouse.lastX = mouse.x;
    mouse.lastY = mouse.y;
    mouse.lastT = now;
  }, { passive: true });

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function bayer8Threshold(x, y) {
    var px = ((Math.floor(x) % 8) + 8) % 8;
    var py = ((Math.floor(y) % 8) + 8) % 8;
    return BAYER_8[py * 8 + px] / 64.0;
  }

  /* A slow interference field keeps the dots from moving as one sheet. */
  function ditherWave(x, y, time, freq, speed, seed) {
    var u = x * freq + ((seed & 255) * 0.031);
    var v = y * freq + (((seed >> 8) & 255) * 0.047);
    var t = time * speed;

    var w1 = Math.sin(u * 1.6 + t * 0.28 + Math.cos(v * 2.2 + t * 0.19));
    var w2 = Math.cos(v * 1.8 - t * 0.23 + Math.sin(u * 1.4 + t * 0.16));
    var w3 = Math.sin((u + v) * 1.1 + t * 0.35);

    return (w1 * 0.45 + w2 * 0.40 + w3 * 0.15) * 0.5 + 0.5; // [0, 1] range
  }



  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "sky-life";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "fixed",
      inset: "0",
      zIndex: "0",
      pointerEvents: "none",
      display: "block"
    });
    (document.getElementById("sky-stage") || document.body).appendChild(canvas);
    ctx = canvas.getContext("2d", { alpha: true });
  }

  /* Snow glints stay inside bright faces, never in the sky. */
  function seedSnowCrystals() {
    snowCrystals = [];
    if (!ridge || !luminance) return;

    var step = Math.max(2, Math.round(2.0 * dpr));
    var seed = width * 23 + height * 41 + 50101;

    for (var y = 0; y < height; y += step) {
      for (var x = 0; x < width; x += step) {
        var ridgeY = ridge[x];
        // Strictly inside the terrain, safely below the skyline boundary
        if (y < ridgeY + 3 * dpr) continue;

        var idx = y * width + x;
        var lum = luminance[idx];

        // Snow faces have high luminance in the source photograph
        if (lum < 135) continue;

        var snowWeight = smooth(135, 250, lum);
        var cellX = Math.floor(x / step);
        var cellY = Math.floor(y / step);

        // Sparse crystalline distribution
        if (hash2(cellX, cellY, seed) > 0.04 + snowWeight * 0.22) continue;

        snowCrystals.push({
          x: x,
          y: y,
          weight: snowWeight,
          lum: lum,
          phase: hash2(cellX, cellY, seed + 11) * Math.PI * 2,
          bayerCut: bayer8Threshold(cellX, cellY),
          sparkleSpeed: 0.6 + hash2(cellX, cellY, seed + 17) * 0.8
        });
      }
    }
  }

  /* ─── Diurnal Shadow Couloir Breathing (Inside Rock Valleys) ───────
     Strictly located inside dark shadow couloirs (y >= ridge[x] + 2*dpr).
     ──────────────────────────────────────────────────────────────── */
  function seedShadowCouloirs() {
    shadowDots = [];
    if (!ridge || !luminance) return;

    var step = Math.max(3, Math.round(2.8 * dpr));
    var seed = width * 17 + height * 31 + 60201;

    for (var y = 0; y < height; y += step) {
      for (var x = 0; x < width; x += step) {
        var ridgeY = ridge[x];
        if (y < ridgeY + 4 * dpr) continue;

        var idx = y * width + x;
        var lum = luminance[idx];

        // Shadow couloirs have mid-to-dark luminance in the source photo
        if (lum > 115) continue;

        var shadowWeight = smooth(115, 20, lum);
        var cellX = Math.floor(x / step);
        var cellY = Math.floor(y / step);

        if (hash2(cellX, cellY, seed) > 0.03 + shadowWeight * 0.18) continue;

        shadowDots.push({
          x: x,
          y: y,
          weight: shadowWeight,
          phase: hash2(cellX, cellY, seed + 23) * 19.0,
          bayerCut: bayer8Threshold(cellX, cellY)
        });
      }
    }
  }

  /* ─── build ─────────────────────────────────────────────────────── */
  function build() {
    var next = baseState();
    if (!next || !next.skyline || !next.luminance) {
      if (tries++ < 80) setTimeout(build, 80);
      return;
    }

    ensureCanvas();
    state = next;
    ridge = state.skyline;
    luminance = state.luminance;
    width = state.width;
    height = state.height;
    dpr = state.dpr;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = state.cssWidth + "px";
    canvas.style.height = state.cssHeight + "px";

    seedSnowCrystals();
    seedShadowCouloirs();
    draw(reduced ? FIXED_TIME : performance.now());

    last = 0;
  }

  /* ─── draw ──────────────────────────────────────────────────────── */

  function drawSnowCrystals(now) {
    if (!snowCrystals.length) return;

    var color = state.dark ? "#e4dac8" : "#293039";
    var t = now * 0.0005;

    ctx.fillStyle = color;

    for (var i = 0; i < snowCrystals.length; i++) {
      var dot = snowCrystals[i];

      // Mouse proximity creates a bright crystal glint
      var mdist = Math.hypot(dot.x - mouse.x, dot.y - mouse.y);
      var cursorGlint = mdist < 140 * dpr ? (1 - mdist / (140 * dpr)) * mouse.speed * 0.60 : 0;

      // Slow interference keeps neighbouring snow crystals from flashing together.
      var wave = ditherWave(dot.x, dot.y, t * dot.sparkleSpeed, 0.004, 1.0, 50501);
      var sparkle = 0.5 + 0.5 * Math.sin(dot.phase + t * 2.2 * dot.sparkleSpeed);

      var intensity = dot.weight * (0.20 + wave * 0.50 + sparkle * 0.30 + cursorGlint);

      // Bayer 8x8 threshold gating
      if (intensity < dot.bayerCut * (state.dark ? 0.60 : 0.55)) continue;

      var alpha = (state.dark ? 0.28 : 0.22) * dot.weight * smooth(0.10, 0.70, intensity) + cursorGlint * 0.35;
      if (alpha < 0.02) continue;

      ctx.globalAlpha = clamp(alpha, 0, state.dark ? 0.45 : 0.38);
      ctx.fillRect(dot.x, dot.y, 1, 1);
    }
  }

  function drawShadowCouloirs(now) {
    if (!shadowDots.length) return;

    var color = state.dark ? "#0b0e13" : "#eee9df";
    var t = now * 0.0002;

    var daylight = 0.85 + 0.15 * Math.sin(t * 0.3 + 1.1);
    ctx.fillStyle = color;

    for (var i = 0; i < shadowDots.length; i++) {
      var dot = shadowDots[i];

      var wave = ditherWave(dot.x, dot.y, t, 0.0025, 1.0, 60601);
      var density = dot.weight * (0.15 + wave * 0.85) * daylight;

      if (density < dot.bayerCut * 0.48) continue;

      var alpha = clamp((state.dark ? 0.12 : 0.16) + density * 0.18, 0, state.dark ? 0.28 : 0.35);
      if (alpha < 0.02) continue;

      ctx.globalAlpha = alpha;
      ctx.fillRect(dot.x, dot.y, 1, 1);
    }
  }

  function draw(now) {
    if (!ctx || !state) return;
    ctx.clearRect(0, 0, width, height);
    drawShadowCouloirs(now);
    drawSnowCrystals(now);
    ctx.globalAlpha = 1;
  }

  /* ─── loop ──────────────────────────────────────────────────────── */

  function tick(now) {
    if (!visible || reduced) return;
    if (last && now - last < FRAME_MS) return;
    last = now;
    draw(now);
  }

  onFrame(tick);
  window.addEventListener("skyphasechange", build);
  listen(motionMedia, function (event) {
    reduced = event.matches;
    build();
  });
  addEventListener("resize", function () {
    clearTimeout(build._timer);
    build._timer = setTimeout(build, 90);
  }, { passive: true });
  document.addEventListener("visibilitychange", function () {
    visible = !document.hidden;
  });

  window.__portfolioLife = {
    build: build,
    step: function (now) { draw(now == null ? (reduced ? FIXED_TIME : performance.now()) : now); },
    state: function () {
      return {
        ready: !!state,
        snowCrystals: snowCrystals.length,
        shadowDots: shadowDots.length,
        hasRidge: !!ridge,
        reduced: reduced
      };
    }
  };

  build();
})();
