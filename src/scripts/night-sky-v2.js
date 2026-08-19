import {
  clamp,
  smoothstep,
  lerp,
  hash,
  baseState,
  listenMedia as listen,
  onFrame
} from "./sky-shared.js";

(function () {
  "use strict";

  var motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = motionMedia.matches;
  var visible = !document.hidden;

  var canvas = null;
  var ctx = null;
  var state = null;
  var stars = [];
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
    dx: 1,
    dy: 0,
    distance: 0,
    collisionDistance: 0,
    tail: 0,
    seed: 0,
    originIndex: -1,
    headRadius: 0
  };





  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
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

  // Reproduce the base renderer's deterministic star seats so a comet can
  // genuinely depart from a star already visible in the sky.
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
      hash(seed++); // breathe period
      hash(seed++); // breathe offset
      hash(seed++); // vanish period
      hash(seed++); // vanish offset
      hash(seed++); // sparkle

      seats.push({
        x: x,
        y: y,
        bright: bright,
        magnitude: magnitude,
        period: period,
        phase: phase,
        recoverStart: 0,
        recoverEnd: 0
      });
    }

    stars = seats.slice(0, count);
  }

  function recoveryFactor(star, now) {
    if (!star.recoverEnd || now >= star.recoverEnd) return 1;
    if (now < star.recoverStart) return 0;
    return smoothstep(star.recoverStart, star.recoverEnd, now);
  }

  function cometHasLaunched(now) {
    return comet.active && now >= comet.start + comet.launchDelay;
  }

  function maskSpentStars(now) {
    if (!state.dark) return;

    var dpr = state.dpr;
    ctx.fillStyle = "#0b0e13";

    for (var i = 0; i < stars.length; i++) {
      var star = stars[i];
      var factor = recoveryFactor(star, now);
      var isOrigin = i === comet.originIndex && cometHasLaunched(now);
      if (!isOrigin && factor >= 0.999) continue;

      var mask = isOrigin ? 1 : 1 - factor;
      var radius = Math.ceil((star.bright ? 4.5 : 3.2) * dpr);
      ctx.globalAlpha = clamp(mask, 0, 1);
      ctx.fillRect(
        Math.round(star.x - radius),
        Math.round(star.y - radius),
        radius * 2 + 1,
        radius * 2 + 1
      );
    }
  }

  function drawRidgeClean() {
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

  function drawStars(now) {
    if (!state.dark || !stars.length) return;

    var dpr = state.dpr;
    var core = Math.max(1, Math.round(dpr));
    ctx.fillStyle = "#eee6d8";

    for (var i = 0; i < stars.length; i++) {
      if (i === comet.originIndex && cometHasLaunched(now)) continue;

      var star = stars[i];
      var recovery = recoveryFactor(star, now);
      if (recovery <= 0) continue;

      var primary = 0.5 + 0.5 * Math.sin((now / Math.max(1800, star.period * 0.92)) * Math.PI * 2 + star.phase);
      var secondary = 0.5 + 0.5 * Math.sin((now / Math.max(3000, star.period * 1.55)) * Math.PI * 2 + star.phase * 1.71);
      var pulse = primary * 0.68 + secondary * 0.32;
      var glint = Math.pow(pulse, 3.4);
      var alpha = (0.006 + glint * 0.105) * (0.62 + star.magnitude * 0.38) * recovery;

      var edge = state.skyline[clamp(Math.round(star.x), 0, state.width - 1)];
      var horizon = smoothstep(0, 40 * dpr, edge - star.y);
      alpha *= horizon;
      if (alpha < 0.008) continue;

      var sx = Math.round(star.x - core * 0.5);
      var sy = Math.round(star.y - core * 0.5);
      ctx.globalAlpha = clamp(alpha, 0, 0.15);
      ctx.fillRect(sx, sy, core, core);

      if (star.bright && pulse > 0.955) {
        var wink = smoothstep(0.955, 1, pulse) * 0.18 * horizon * recovery;
        ctx.globalAlpha = wink;
        ctx.fillRect(sx - core, sy, core, core);
        ctx.fillRect(sx + core, sy, core, core);
        ctx.fillRect(sx, sy - core, core, core);
        ctx.fillRect(sx, sy + core, core, core);
      }
    }
  }

  function pickOriginStar(now) {
    var candidates = [];
    var dpr = state.dpr;

    for (var i = 0; i < stars.length; i++) {
      var star = stars[i];
      if (recoveryFactor(star, now) < 0.999) continue;
      var x = clamp(Math.round(star.x), 0, state.width - 1);
      var clearance = state.skyline[x] - star.y;
      if (clearance < 100 * dpr) continue;
      if (star.x < state.width * 0.08 || star.x > state.width * 0.92) continue;
      if (star.magnitude < 0.48) continue;
      candidates.push(i);
    }

    if (!candidates.length) {
      for (i = 0; i < stars.length; i++) {
        if (recoveryFactor(stars[i], now) >= 0.999) candidates.push(i);
      }
    }

    if (!candidates.length) return -1;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function traceTrajectory(origin, tail) {
    var best = null;
    var dpr = state.dpr;
    var step = Math.max(1, Math.round(1.5 * dpr));
    var maxDistance = Math.hypot(state.width, state.height) * 1.35;

    for (var attempt = 0; attempt < 18; attempt++) {
      var direction = Math.random() < 0.5 ? -1 : 1;
      var angle = randomBetween(14, 31) * Math.PI / 180;
      var dx = Math.cos(angle) * direction;
      var dy = Math.sin(angle);
      var collision = maxDistance;
      var kind = "screen";

      for (var distance = step; distance <= maxDistance; distance += step) {
        var x = origin.x + dx * distance;
        var y = origin.y + dy * distance;

        if (x < 0 || x >= state.width || y < 0 || y >= state.height) {
          collision = distance;
          kind = "screen";
          break;
        }

        var ix = clamp(Math.round(x), 0, state.width - 1);
        if (y >= state.skyline[ix] - 1 * dpr) {
          collision = distance;
          kind = "mountain";
          break;
        }
      }

      var score = collision;
      if (!best || score > best.score) {
        best = { dx: dx, dy: dy, collision: collision, kind: kind, score: score };
      }

      if (collision > state.width * 0.34) break;
    }

    if (!best) return null;

    // Continue far enough past the collision that the tail follows the head
    // behind the ridge or completely out of the viewport instead of fading out.
    var followThrough = tail * (best.kind === "mountain" ? 0.92 : 1.05);
    best.distance = best.collision + followThrough;
    return best;
  }

  function scheduleNext(now, first) {
    // Random periodic appearances: no fixed cadence and no deterministic seed.
    comet.next = now + (first ? randomBetween(12000, 42000) : randomBetween(85000, 260000));
  }

  function scheduleComet(now) {
    if (!state || !state.dark || reduced || !stars.length) return;

    var originIndex = pickOriginStar(now);
    if (originIndex < 0) {
      scheduleNext(now, false);
      return;
    }

    var origin = stars[originIndex];
    var tail = randomBetween(0.15, 0.23) * state.width;
    var trajectory = traceTrajectory(origin, tail);
    if (!trajectory) {
      scheduleNext(now, false);
      return;
    }

    var mobile = state.cssWidth < 768;
    // At the old 50-70 px/s a "comet" took ~16 seconds to cross the sky, which the
    // eye reads as a faint static hairline rather than as motion. These speeds put
    // a full crossing at roughly 3-4 seconds: still unhurried, but unmistakably moving.
    var speed = randomBetween(mobile ? 170 : 240, mobile ? 230 : 330) * state.dpr;

    comet.active = true;
    comet.start = now;
    comet.launchDelay = randomBetween(500, 900);
    comet.duration = trajectory.distance / speed * 1000;
    comet.x0 = origin.x;
    comet.y0 = origin.y;
    comet.dx = trajectory.dx;
    comet.dy = trajectory.dy;
    comet.distance = trajectory.distance;
    comet.collisionDistance = trajectory.collision;
    comet.tail = tail;
    comet.seed = Math.floor(Math.random() * 2147483647);
    comet.originIndex = originIndex;
    comet.headRadius = randomBetween(2.7, 3.6) * state.dpr;
    comet.next = Infinity;
  }

  function retireOriginStar(now) {
    if (comet.originIndex < 0 || !stars[comet.originIndex]) return;
    var star = stars[comet.originIndex];
    star.recoverStart = now + randomBetween(18000, 52000);
    star.recoverEnd = star.recoverStart + randomBetween(9000, 18000);
  }

  function finishComet(now) {
    retireOriginStar(now);
    comet.active = false;
    comet.originIndex = -1;
    scheduleNext(now, false);
  }

  function armFirstComet(now) {
    comet.active = false;
    comet.originIndex = -1;
    scheduleNext(now, true);
  }

  function drawLaunchStar(now) {
    if (!comet.active || comet.originIndex < 0 || cometHasLaunched(now)) return;

    var progress = clamp((now - comet.start) / comet.launchDelay, 0, 1);
    var pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 3.0);
    var unit = Math.max(1, Math.round(state.dpr));
    var alpha = 0.18 + smoothstep(0.05, 1, progress) * 0.42 + pulse * 0.10;

    ctx.fillStyle = "#eee6d8";
    ctx.globalAlpha = clamp(alpha, 0, 0.74);
    ctx.fillRect(Math.round(comet.x0), Math.round(comet.y0), unit, unit);
    ctx.globalAlpha *= 0.45;
    ctx.fillRect(Math.round(comet.x0 - unit), Math.round(comet.y0), unit, unit);
    ctx.fillRect(Math.round(comet.x0 + unit), Math.round(comet.y0), unit, unit);
    ctx.fillRect(Math.round(comet.x0), Math.round(comet.y0 - unit), unit, unit);
    ctx.fillRect(Math.round(comet.x0), Math.round(comet.y0 + unit), unit, unit);
  }

  function skyPixel(x, y, margin) {
    if (x < 0 || x >= state.width || y < 0 || y >= state.height) return false;
    var ix = clamp(Math.round(x), 0, state.width - 1);
    return y < state.skyline[ix] - (margin || 0);
  }

  function drawCometHead(x, y, fade, now) {
    var radius = comet.headRadius;
    var seed = comet.seed + Math.floor(now / 90);
    var minX = Math.floor(x - radius * 1.35);
    var maxX = Math.ceil(x + radius * 1.35);
    var minY = Math.floor(y - radius * 1.35);
    var maxY = Math.ceil(y + radius * 1.35);

    ctx.fillStyle = "#eee6d8";

    // Pixel-dithered round coma: no solid 2x2/4x4 square nucleus.
    for (var py = minY; py <= maxY; py++) {
      for (var px = minX; px <= maxX; px++) {
        if (!skyPixel(px, py, 0)) continue;
        var ox = (px - x) / radius;
        var oy = (py - y) / radius;
        var radial = Math.sqrt(ox * ox + oy * oy);
        if (radial > 1.18) continue;

        // Slightly stretch the coma backward along the trajectory.
        var behind = -(ox * comet.dx + oy * comet.dy);
        var envelope = clamp(1 - radial, 0, 1) + clamp(behind, 0, 0.7) * 0.16;
        var keep = 0.18 + envelope * 0.92;
        if (hash(comet.seed + px * 31 + py * 73) > keep) continue;

        ctx.globalAlpha = clamp(fade * (0.20 + envelope * 0.80), 0, 0.96);
        ctx.fillRect(px, py, 1, 1);
      }
    }

    // Tiny bright central point, still one physical pixel rather than a block.
    if (skyPixel(x, y, 0)) {
      ctx.globalAlpha = 0.98 * fade;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }

  function drawComet(now) {
    if (!state.dark || !comet.active) return;

    if (!cometHasLaunched(now)) {
      drawLaunchStar(now);
      return;
    }

    var motionStart = comet.start + comet.launchDelay;
    var elapsed = now - motionStart;
    var progress = elapsed / comet.duration;

    if (progress >= 1) {
      finishComet(now);
      return;
    }
    if (progress < 0) return;

    // It does not fade in the middle of the trip. Visibility ends naturally as
    // the head/tail cross the skyline or viewport; only the first few frames ease in.
    var fade = smoothstep(0, 0.025, progress);
    var travelled = comet.distance * progress;
    var x = comet.x0 + comet.dx * travelled;
    var y = comet.y0 + comet.dy * travelled;
    var nx = -comet.dy;
    var ny = comet.dx;
    var dpr = state.dpr;
    var step = 1;
    var tailGrowth = smoothstep(0, 0.12, progress);
    var visibleTail = comet.tail * tailGrowth;

    ctx.fillStyle = "#eee6d8";

    for (var distance = 0; distance <= visibleTail; distance += step) {
      var t = visibleTail ? distance / visibleTail : 0;
      var tx = Math.round(x - comet.dx * distance);
      var ty = Math.round(y - comet.dy * distance);
      if (!skyPixel(tx, ty, 0)) continue;

      var taper = Math.pow(1 - t, 1.48);
      var alpha = fade * taper * (0.15 + (1 - t) * 0.70);
      if (alpha < 0.01) continue;

      ctx.globalAlpha = clamp(alpha, 0, 0.88);
      ctx.fillRect(tx, ty, 1, 1);

      // A modestly wider inner tail so it reads on phones without becoming a beam.
      if (t < 0.24 && distance % Math.max(1, Math.round(dpr)) === 0) {
        var sideAlpha = alpha * (0.30 - t * 0.75);
        if (sideAlpha > 0.018) {
          ctx.globalAlpha = sideAlpha;
          var spread = Math.max(1, Math.round(dpr * 0.75));
          var ax = Math.round(tx + nx * spread);
          var ay = Math.round(ty + ny * spread);
          var bx = Math.round(tx - nx * spread);
          var by = Math.round(ty - ny * spread);
          if (skyPixel(ax, ay, 0)) ctx.fillRect(ax, ay, 1, 1);
          if (skyPixel(bx, by, 0)) ctx.fillRect(bx, by, 1, 1);
        }
      }

      if (t < 0.58 && hash(comet.seed + Math.floor(distance) * 17) > 0.982) {
        var fray = randomBetween(1.2, 2.8) * dpr;
        var side = hash(comet.seed + Math.floor(distance) * 23) > 0.5 ? 1 : -1;
        var fx = Math.round(tx + nx * fray * side);
        var fy = Math.round(ty + ny * fray * side);
        if (skyPixel(fx, fy, 0)) {
          ctx.globalAlpha = alpha * 0.25;
          ctx.fillRect(fx, fy, 1, 1);
        }
      }
    }

    drawCometHead(x, y, fade, now);
  }

  function draw(now) {
    if (!ctx || !state) return;
    ctx.clearRect(0, 0, state.width, state.height);
    if (!state.dark) return;

    drawRidgeClean();
    maskSpentStars(now);
    drawStars(now);
    drawComet(now);
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    if (!visible || reduced) return;
    if (last && now - last < 1000 / 30) return;
    last = now;
    if (state && state.dark && !comet.active && now >= comet.next) scheduleComet(now);
    draw(now);
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

    last = 0;
  }

  onFrame(tick);
  window.addEventListener("skyphasechange", build);
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
  });

  window.__nightSkyTune = {
    build: build,
    cometNow: function () {
      if (!state || !state.dark || reduced || comet.active) return;
      scheduleComet(performance.now());
    },
    state: function () {
      return {
        active: comet.active,
        originIndex: comet.originIndex,
        next: comet.next,
        duration: comet.duration,
        distance: comet.distance,
        collisionDistance: comet.collisionDistance
      };
    }
  };

  build();
})();
