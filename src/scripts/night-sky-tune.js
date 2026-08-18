(function () {
  "use strict";

  var themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  var motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = motionMedia.matches;
  var visible = !document.hidden;

  var canvas = null;
  var ctx = null;
  var state = null;
  var stars = [];
  var raf = 0;
  var last = 0;
  var tries = 0;

  var comet = {
    active: false,
    start: 0,
    launchDelay: 0,
    duration: 0,
    next: Infinity,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    tail: 0,
    seed: 0,
    originIndex: -1,
    headSize: 0
  };

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(a, b, value) {
    var t = clamp((value - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function hash(value) {
    value = Math.imul(value ^ (value >>> 16), 2246822507);
    value = Math.imul(value ^ (value >>> 13), 3266489909);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function baseState() {
    return window.__portfolioSky && window.__portfolioSky.state
      ? window.__portfolioSky.state()
      : null;
  }

  function listen(media, callback) {
    if (media.addEventListener) media.addEventListener("change", callback);
    else media.addListener(callback);
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "night-sky-tune";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0 auto auto 0",
      zIndex: "0",
      width: "100%",
      height: "var(--hero-scene-height, 100svh)",
      pointerEvents: "none",
      display: "block"
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d", { alpha: true });
  }

  // Reproduce the base renderer's deterministic star seats. This layer only
  // nudges their brightness, so the sky still reads as one field of stars.
  function seedStars() {
    stars = [];
    if (!state || !state.dark) return;

    var width = state.width;
    var height = state.height;
    var dpr = state.dpr;
    var count = state.cssWidth < state.cssHeight ? 108 : 168;
    var seatCount = count + 24;
    var seats = [];
    var seed = width * 41 + height * 73 + 1901;
    var minDistance = Math.sqrt((width * Math.max(1, state.ridgeTop)) / seatCount) * 0.33;
    var guard = 0;

    while (seats.length < seatCount && guard++ < seatCount * 1800) {
      var x = Math.floor(hash(seed++) * width);
      var maxY = Math.max(8 * dpr, state.skyline[x] - 34 * dpr);
      if (maxY <= 10 * dpr) continue;

      var vertical = hash(seed++);
      if (hash(seed++) > 0.54) vertical *= vertical;
      var y = Math.floor((0.04 + vertical * 0.88) * maxY);
      var clear = true;

      for (var i = 0; i < seats.length; i++) {
        var dx = seats[i].x - x;
        var dy = seats[i].y - y;
        if (dx * dx + dy * dy < minDistance * minDistance) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;

      var bright = hash(seed++) > 0.78;
      var magnitude = bright ? 0.90 + hash(seed++) * 0.10 : 0.38 + hash(seed++) * 0.50;
      var period = 1700 + hash(seed++) * 6800;
      var phase = hash(seed++) * Math.PI * 2;
      hash(seed++);
      hash(seed++);
      hash(seed++);
      hash(seed++);
      hash(seed++);

      seats.push({
        x: x,
        y: y,
        bright: bright,
        magnitude: magnitude,
        period: period,
        phase: phase
      });
    }

    stars = seats.slice(0, count);
  }

  function drawRidgeClean() {
    // The base renderer has a dust field that can detach above the summit line.
    // Cover only that narrow sky-side strip. Stars already fade near the ridge,
    // so this removes the floating mountain dots without changing the night sky.
    var depth = Math.ceil(20 * state.dpr);
    ctx.fillStyle = "#0b0e13";
    ctx.globalAlpha = 1;

    for (var x = 0; x < state.width; x++) {
      var edge = state.skyline[x];
      if (edge <= 0 || edge >= state.height) continue;
      var top = Math.max(0, edge - depth);
      ctx.fillRect(x, top, 1, edge - top);
    }
  }

  function cometHasLaunched(now) {
    return comet.active && now >= comet.start + comet.launchDelay;
  }

  function maskOriginStar(now) {
    if (!cometHasLaunched(now) || comet.originIndex < 0 || !stars[comet.originIndex]) return;

    var star = stars[comet.originIndex];
    var core = Math.max(1, Math.round(state.dpr));
    var radius = core * 3;
    ctx.fillStyle = "#0b0e13";
    ctx.globalAlpha = 1;
    ctx.fillRect(
      Math.round(star.x - radius),
      Math.round(star.y - radius),
      radius * 2 + core,
      radius * 2 + core
    );
  }

  function drawStars(now) {
    if (!state.dark || !stars.length) return;

    var dpr = state.dpr;
    var core = Math.max(1, Math.round(dpr));
    ctx.fillStyle = "#eee6d8";

    for (var i = 0; i < stars.length; i++) {
      if (i === comet.originIndex && cometHasLaunched(now)) continue;

      var star = stars[i];
      var primary = 0.5 + 0.5 * Math.sin((now / Math.max(1800, star.period * 0.92)) * Math.PI * 2 + star.phase);
      var secondary = 0.5 + 0.5 * Math.sin((now / Math.max(3000, star.period * 1.55)) * Math.PI * 2 + star.phase * 1.71);
      var pulse = primary * 0.68 + secondary * 0.32;
      var glint = Math.pow(pulse, 3.4);
      var alpha = (0.006 + glint * 0.105) * (0.62 + star.magnitude * 0.38);

      var edge = state.skyline[clamp(Math.round(star.x), 0, state.width - 1)];
      var horizon = smoothstep(0, 40 * dpr, edge - star.y);
      alpha *= horizon;
      if (alpha < 0.008) continue;

      var sx = Math.round(star.x - core * 0.5);
      var sy = Math.round(star.y - core * 0.5);
      ctx.globalAlpha = clamp(alpha, 0, 0.15);
      ctx.fillRect(sx, sy, core, core);

      if (star.bright && pulse > 0.955) {
        var wink = smoothstep(0.955, 1, pulse) * 0.18 * horizon;
        ctx.globalAlpha = wink;
        ctx.fillRect(sx - core, sy, core, core);
        ctx.fillRect(sx + core, sy, core, core);
        ctx.fillRect(sx, sy - core, core, core);
        ctx.fillRect(sx, sy + core, core, core);
      }
    }
  }

  function pickOriginStar() {
    var candidates = [];
    var dpr = state.dpr;

    for (var i = 0; i < stars.length; i++) {
      var star = stars[i];
      var x = clamp(Math.round(star.x), 0, state.width - 1);
      var clearance = state.skyline[x] - star.y;
      if (clearance < 90 * dpr) continue;
      if (star.x < state.width * 0.08 || star.x > state.width * 0.92) continue;
      if (star.magnitude < 0.50) continue;
      candidates.push(i);
    }

    if (!candidates.length) {
      for (i = 0; i < stars.length; i++) candidates.push(i);
    }

    return candidates[Math.floor(Math.random() * candidates.length)] || 0;
  }

  function scheduleComet(now) {
    if (!state || !state.dark || reduced || !stars.length) return;

    var originIndex = pickOriginStar();
    var origin = stars[originIndex];
    var direction = Math.random() < 0.5 ? -1 : 1;
    var travelX = randomBetween(0.20, 0.34) * state.width;
    var x1 = origin.x + direction * travelX;

    if (x1 < state.width * 0.07 || x1 > state.width * 0.93) {
      direction *= -1;
      x1 = origin.x + direction * travelX;
    }
    x1 = clamp(x1, state.width * 0.06, state.width * 0.94);

    var ridge = Math.max(state.ridgeTop, 1);
    var desiredY = origin.y + randomBetween(0.075, 0.16) * ridge;
    var safeY = state.skyline[clamp(Math.round(x1), 0, state.width - 1)] - randomBetween(58, 92) * state.dpr;
    var y1 = Math.min(desiredY, safeY);
    if (y1 < origin.y + 18 * state.dpr) y1 = origin.y + 18 * state.dpr;

    comet.active = true;
    comet.start = now;
    comet.launchDelay = randomBetween(420, 760);
    comet.duration = randomBetween(5600, 7800);
    comet.x0 = origin.x;
    comet.y0 = origin.y;
    comet.x1 = x1;
    comet.y1 = y1;
    comet.tail = randomBetween(0.14, 0.22) * state.width;
    comet.seed = Math.floor(Math.random() * 2147483647);
    comet.originIndex = originIndex;
    comet.headSize = Math.max(3 * state.dpr, randomBetween(3.2, 4.1) * state.dpr);

    // The first one is easy to inspect; after that they are genuinely rare.
    comet.next = now + comet.launchDelay + comet.duration + randomBetween(120000, 300000);
  }

  function armFirstComet(now) {
    comet.active = false;
    comet.originIndex = -1;
    comet.next = state && state.dark && !reduced
      ? now + randomBetween(6500, 12000)
      : Infinity;
  }

  function drawLaunchStar(now) {
    if (!comet.active || comet.originIndex < 0 || cometHasLaunched(now)) return;

    var progress = clamp((now - comet.start) / comet.launchDelay, 0, 1);
    var pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 3.2);
    var size = Math.max(1, Math.round(state.dpr));
    var glow = 0.22 + smoothstep(0.15, 1, progress) * 0.48 + pulse * 0.12;

    ctx.fillStyle = "#eee6d8";
    ctx.globalAlpha = clamp(glow, 0, 0.82);
    ctx.fillRect(Math.round(comet.x0 - size), Math.round(comet.y0 - size), size * 3, size * 3);
  }

  function drawComet(now) {
    if (!state.dark || !comet.active) return;

    if (!cometHasLaunched(now)) {
      drawLaunchStar(now);
      return;
    }

    var motionStart = comet.start + comet.launchDelay;
    var progress = (now - motionStart) / comet.duration;
    if (progress >= 1) {
      comet.active = false;
      comet.originIndex = -1;
      return;
    }
    if (progress < 0) return;

    var fade = smoothstep(0, 0.035, progress) * (1 - smoothstep(0.94, 1, progress));
    var x = lerp(comet.x0, comet.x1, progress);
    var y = lerp(comet.y0, comet.y1, progress);
    var dx = comet.x1 - comet.x0;
    var dy = comet.y1 - comet.y0;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= length;
    dy /= length;
    var nx = -dy;
    var ny = dx;
    var dpr = state.dpr;
    var px = Math.max(1, Math.round(dpr));
    var tailGrowth = smoothstep(0, 0.16, progress);
    var visibleTail = comet.tail * tailGrowth;

    ctx.fillStyle = "#eee6d8";

    for (var step = 0; step <= visibleTail; step += px) {
      var t = visibleTail ? step / visibleTail : 0;
      var taper = Math.pow(1 - t, 1.42);
      var tx = Math.round(x - dx * step);
      var ty = Math.round(y - dy * step);
      if (tx < 0 || tx >= state.width || ty < 0 || ty >= state.height) continue;
      if (ty >= state.skyline[tx] - 18 * dpr) continue;

      var alpha = fade * taper * (0.18 + (1 - t) * 0.72);
      if (alpha < 0.01) continue;
      ctx.globalAlpha = clamp(alpha, 0, 0.90);
      ctx.fillRect(tx, ty, px, px);

      // Thicken the bright part of the tail instead of making the whole comet
      // a hairline. It stays pixel-built, just more legible on phone screens.
      if (t < 0.30) {
        var widthAlpha = alpha * (0.38 - t * 0.65);
        if (widthAlpha > 0.02) {
          ctx.globalAlpha = widthAlpha;
          ctx.fillRect(Math.round(tx + nx * px), Math.round(ty + ny * px), px, px);
          ctx.fillRect(Math.round(tx - nx * px), Math.round(ty - ny * px), px, px);
        }
      }

      if (t < 0.62 && hash(comet.seed + Math.floor(step / px) * 17) > 0.78) {
        var spread = (0.7 + t * 2.0) * dpr;
        var side = hash(comet.seed + Math.floor(step) * 23) > 0.5 ? 1 : -1;
        var fx = Math.round(tx + nx * spread * side);
        var fy = Math.round(ty + ny * spread * side);
        if (fx >= 0 && fx < state.width && fy >= 0 && fy < state.skyline[fx] - 18 * dpr) {
          ctx.globalAlpha = alpha * 0.24;
          ctx.fillRect(fx, fy, px, px);
        }
      }
    }

    var hx = Math.round(x);
    var hy = Math.round(y);
    if (hx >= 0 && hx < state.width && hy >= 0 && hy < state.skyline[hx] - 18 * dpr) {
      var head = Math.max(px * 3, Math.round(comet.headSize));
      var half = Math.floor(head / 2);

      ctx.globalAlpha = 0.98 * fade;
      ctx.fillRect(hx - half, hy - half, head, head);

      ctx.globalAlpha = 0.42 * fade;
      ctx.fillRect(Math.round(hx + dx * head), Math.round(hy + dy * head), px, px);
      ctx.fillRect(Math.round(hx + nx * head * 0.65), Math.round(hy + ny * head * 0.65), px, px);
      ctx.fillRect(Math.round(hx - nx * head * 0.65), Math.round(hy - ny * head * 0.65), px, px);
    }
  }

  function draw(now) {
    if (!ctx || !state) return;
    ctx.clearRect(0, 0, state.width, state.height);
    if (!state.dark) return;
    drawRidgeClean();
    maskOriginStar(now);
    drawStars(now);
    drawComet(now);
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    if (!visible || reduced) {
      raf = 0;
      return;
    }

    if (!last || now - last >= 1000 / 30) {
      last = now;
      if (state && state.dark && !comet.active && now >= comet.next) scheduleComet(now);
      draw(now);
    }
    raf = window.requestAnimationFrame(tick);
  }

  function build() {
    var next = baseState();
    if (!next || !next.skyline) {
      if (tries++ < 80) window.setTimeout(build, 80);
      return;
    }

    ensureCanvas();
    tries = 0;
    state = next;
    canvas.width = state.width;
    canvas.height = state.height;
    canvas.style.width = state.cssWidth + "px";
    canvas.style.height = state.cssHeight + "px";

    seedStars();
    armFirstComet(performance.now());
    draw(reduced ? 1400 : performance.now());

    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (!reduced && visible) raf = window.requestAnimationFrame(tick);
  }

  listen(themeMedia, build);
  listen(motionMedia, function (event) {
    reduced = event.matches;
    build();
  });

  window.addEventListener("resize", function () {
    window.clearTimeout(build._timer);
    build._timer = window.setTimeout(build, 220);
  }, { passive: true });

  document.addEventListener("visibilitychange", function () {
    visible = !document.hidden;
    if (visible && !reduced && !raf) raf = window.requestAnimationFrame(tick);
  });

  window.__nightSkyTune = {
    build: build,
    cometNow: function () {
      if (!state || !state.dark || reduced) return;
      scheduleComet(performance.now());
    }
  };

  build();
})();
