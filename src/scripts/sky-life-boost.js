(function () {
  "use strict";

  var themeMedia = matchMedia("(prefers-color-scheme: dark)");
  var motionMedia = matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = motionMedia.matches;
  var visible = !document.hidden;
  var SKYLINE_SOURCE = "/assets/annapurna-skyline.json";
  var FIXED_TIME = 1400;
  var FRAME_MS = 1000 / 30;
  var BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

  var canvas = null;
  var ctx = null;
  var state = null;
  var skylineData = null;
  var ridge = null;
  var banks = [];
  var raf = 0;
  var last = 0;
  var tries = 0;
  var width = 0;
  var height = 0;
  var dpr = 1;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function hash(n) {
    n = Math.imul(n ^ (n >>> 16), 2246822507);
    n = Math.imul(n ^ (n >>> 13), 3266489909);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function hash2(a, b, seed) {
    return hash(
      Math.imul(a | 0, 374761393) ^
      Math.imul(b | 0, 668265263) ^
      Math.imul(seed | 0, 2246822519)
    );
  }
  function threshold(x, y) {
    return BAYER[((Math.floor(y) & 3) << 2) + (Math.floor(x) & 3)] / 16;
  }
  function valueNoise(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }
  function fbm(x, y, seed) {
    var value = 0, amp = .58, freq = 1, norm = 0;
    for (var i = 0; i < 4; i++) {
      value += valueNoise(x * freq, y * freq, seed + i * 89) * amp;
      norm += amp;
      amp *= .47;
      freq *= 2.03;
    }
    return value / norm;
  }
  function listen(media, fn) {
    if (media.addEventListener) media.addEventListener("change", fn);
    else media.addListener(fn);
  }

  function baseState() {
    return window.__portfolioSky && window.__portfolioSky.state
      ? window.__portfolioSky.state()
      : null;
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
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d", { alpha: true });
  }

  function sampleSkyline(sourceX) {
    var p = clamp(sourceX / skylineData.step, 0, skylineData.y.length - 1);
    var a = Math.floor(p), b = Math.min(skylineData.y.length - 1, a + 1);
    return lerp(skylineData.y[a], skylineData.y[b], p - a);
  }

  function buildRidge() {
    ridge = null;
    if (!state || !skylineData) return;

    var plateW = skylineData.width || 3000;
    var plateH = skylineData.height || 2000;
    var portrait = state.cssWidth < state.cssHeight;
    var visibleBandH = Math.round(height * (portrait ? .56 : .52));
    var overscan = Math.round(height * (portrait ? .18 : .16));
    var drawH = visibleBandH + overscan;
    var bandTop = height - visibleBandH;
    var targetAspect = width / drawH;
    var sourceAspect = plateW / plateH;
    var sx = 0, sy = 0, sw = plateW, sh = plateH;
    var focus = portrait ? .55 : .52;

    if (targetAspect > sourceAspect) {
      sh = sw / targetAspect;
      sy = clamp(plateH * .10, 0, Math.max(0, plateH - sh));
    } else {
      sw = sh * targetAspect;
      sx = clamp(plateW * focus - sw / 2, 0, Math.max(0, plateW - sw));
    }

    ridge = new Int32Array(width);
    for (var x = 0; x < width; x++) {
      var sourceX = sx + ((x + .5) / width) * sw - .5;
      var sourceY = sampleSkyline(sourceX);
      ridge[x] = clamp(Math.round(bandTop + ((sourceY - sy) / sh) * drawH), 0, height);
    }

    var end = Math.floor(width * .14);
    var copy = new Int32Array(ridge);
    var maxStep = Math.max(2, Math.round(2.2 * dpr));
    for (x = 1; x < end; x++) {
      var prev = copy[x - 1], here = copy[x], next = copy[Math.min(width - 1, x + 1)];
      var median = prev + here + next - Math.min(prev, here, next) - Math.max(prev, here, next);
      if (Math.abs(here - median) > Math.max(2, Math.round(1.5 * dpr))) ridge[x] = median;
      ridge[x] = clamp(ridge[x], ridge[x - 1] - maxStep, ridge[x - 1] + maxStep);
    }
  }

  function seedBank(config, index) {
    var range = Math.max(1, state.ridgeLow - state.ridgeTop);
    var cx = width * config.cx;
    var cy = lerp(state.ridgeTop, state.ridgeLow, config.cy);
    var span = width * config.span;
    var tall = clamp(range * config.tall, config.min * dpr, config.max * dpr);
    var step = Math.max(2, Math.round(config.step * dpr));
    var dots = [];

    for (var y = cy - tall; y <= cy + tall; y += step) {
      for (var x = cx - span * .5; x <= cx + span * .5; x += step) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        var u = (x - cx) / (span * .5);
        var v = (y - cy) / tall;
        var shape = Math.exp(-(u * u * 2.15 + v * v * 3.15));
        shape += .48 * Math.exp(-((u + .44) * (u + .44) * 5.4 + (v + .02) * (v + .02) * 4.8));
        shape += .43 * Math.exp(-((u - .39) * (u - .39) * 5.8 + (v - .04) * (v - .04) * 5.0));
        shape = clamp(shape, 0, 1);
        if (shape < .045) continue;
        var ix = Math.floor(x / step), iy = Math.floor(y / step);
        if (hash2(ix, iy, config.seed) > .06 + shape * .92) continue;
        dots.push({
          x: x,
          y: y,
          shape: shape,
          cut: threshold(ix, iy),
          grain: hash2(ix, iy, config.seed + 17),
          phase: hash2(Math.floor(x / (80 * dpr)), Math.floor(y / (65 * dpr)), config.seed + 31) * Math.PI * 2
        });
      }
    }

    banks.push({ config: config, dots: dots, index: index });
  }

  function seedBanks() {
    banks = [];
    if (!state || state.dark) return;

    seedBank({ cx:.41, cy:.61, span:.37, tall:.35, min:50, max:135, step:1.1, seed:10101, phase:.35 }, 0);
    seedBank({ cx:.59, cy:.73, span:.49, tall:.40, min:56, max:155, step:1.1, seed:10201, phase:2.15 }, 1);
    seedBank({ cx:.53, cy:.49, span:.32, tall:.28, min:44, max:118, step:1.05, seed:10301, phase:4.10 }, 2);
  }

  function build() {
    var next = baseState();
    if (!next || !skylineData) {
      if (tries++ < 80) setTimeout(build, 80);
      return;
    }

    ensureCanvas();
    state = next;
    width = state.width;
    height = state.height;
    dpr = state.dpr;
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = state.cssWidth + "px";
    canvas.style.height = state.cssHeight + "px";

    buildRidge();
    seedBanks();
    draw(reduced ? FIXED_TIME : performance.now());

    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (!reduced && visible) raf = requestAnimationFrame(tick);
  }

  function drawRidgeCleanup() {
    if (!ridge || state.dark) return;

    var paper = "#eee9df";
    var end = Math.floor(width * .135);
    var fadeStart = Math.floor(width * .105);
    var eraseUp = Math.max(2, Math.round(2 * dpr));
    var eraseIn = Math.max(3, Math.round(4 * dpr));

    for (var x = 0; x < end; x++) {
      var y = ridge[x];
      if (y <= 0 || y >= height) continue;
      var fade = x <= fadeStart ? 1 : 1 - smooth(fadeStart, end, x);

      // Remove the artificial outer rim only. The real photographed rock/dither below becomes the edge.
      ctx.fillStyle = paper;
      ctx.globalAlpha = .985 * fade;
      ctx.fillRect(x, Math.max(0, y - eraseUp), 1, eraseUp + eraseIn);
    }
  }

  function drawBank(bank, now) {
    var config = bank.config;
    var paper = "#eee9df";
    var haze = "#616a72";

    var ox = (
      Math.sin(now / 5000 * Math.PI * 2 + config.phase) * 22 +
      Math.sin(now / 7900 * Math.PI * 2 + config.phase * .63) * 8
    ) * dpr;
    var oy = (
      Math.sin(now / 6100 * Math.PI * 2 + config.phase * 1.17) * 12 +
      Math.sin(now / 9300 * Math.PI * 2 + config.phase * .78) * 5
    ) * dpr;
    var swell = .58 + .42 * Math.sin(now / 3900 * Math.PI * 2 + config.phase);
    var t = now * .00048;

    for (var i = 0; i < bank.dots.length; i++) {
      var dot = bank.dots[i];
      var field = fbm(dot.x * .0020 + t, dot.y * .00185 - t * .72, 11101 + bank.index * 113);
      var local = .5 + .5 * Math.sin(now / 3900 * Math.PI * 2 + dot.phase);
      var density = dot.shape * (.24 + field * .66 + local * .40) * swell;
      if (density < dot.cut * .18 + .018) continue;

      var px = Math.round(dot.x + ox);
      var py = Math.round(dot.y + oy);
      if (px < 0 || px >= width || py < 0 || py >= height) continue;

      ctx.fillStyle = paper;
      ctx.globalAlpha = clamp(.74 + density * .24, 0, .97);
      ctx.fillRect(px, py, Math.max(2, Math.round(1.9 * dpr)), Math.max(1, Math.round(1.1 * dpr)));

      if (dot.grain < .96) {
        ctx.fillStyle = haze;
        ctx.globalAlpha = clamp(.24 + density * .34, 0, .55);
        ctx.fillRect(px, py, Math.max(1, Math.round(1.25 * dpr)), 1);
      }
    }
  }

  function draw(now) {
    if (!ctx || !state) return;
    ctx.clearRect(0, 0, width, height);
    drawRidgeCleanup();
    if (!state.dark) {
      for (var i = 0; i < banks.length; i++) drawBank(banks[i], now);
    }
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    if (!visible || reduced) {
      raf = 0;
      return;
    }
    if (!last || now - last >= FRAME_MS) {
      last = now;
      draw(now);
    }
    raf = requestAnimationFrame(tick);
  }

  listen(themeMedia, build);
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
    if (visible && !reduced && !raf) raf = requestAnimationFrame(tick);
  });

  window.__portfolioLife = {
    build: build,
    step: function (now) { draw(now == null ? (reduced ? FIXED_TIME : performance.now()) : now); },
    state: function () {
      return {
        ready: !!state,
        banks: banks.map(function (bank) { return bank.dots.length; }),
        cleanup: !!ridge,
        reduced: reduced
      };
    }
  };

  fetch(SKYLINE_SOURCE, { cache: "force-cache" })
    .then(function (response) {
      if (!response.ok) throw new Error("skyline");
      return response.json();
    })
    .then(function (data) {
      skylineData = data;
      build();
    })
    .catch(function () {
      build();
    });
})();
