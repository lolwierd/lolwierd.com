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
    duration: 0,
    next: Infinity,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    tail: 0,
    seed: 0
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
    canvas.id = "night-sky-boost";
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

  // Reproduce the base renderer's deterministic star seats so the extra glints
  // land on the existing stars instead of adding another unrelated star field.
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
      var sparkle = bright ? 0.22 + hash(seed++) * 0.22 : 0.08 + hash(seed++) * 0.12;

      seats.push({
        x: x,
        y: y,
        bright: bright,
        magnitude: magnitude,
        period: period,
        phase: phase,
        sparkle: sparkle
      });
    }

    stars = seats.slice(0, count);
  }

  function scheduleComet(now, first) {
    if (!state || !state.dark || reduced) return;

    var seed = Math.floor(now / 701) + state.width * 7 + state.height * 13;
    var direction = hash(seed) > 0.5 ? 1 : -1;
    var ridge = Math.max(state.ridgeTop, 1);

    comet.active = true;
    comet.start = now;
    comet.duration = 900 + hash(seed + 1) * 650;
    comet.x0 = (0.15 + hash(seed + 2) * 0.68) * state.width;
    comet.y0 = (0.055 + hash(seed + 3) * 0.20) * ridge;
    comet.x1 = comet.x0 + direction * (0.20 + hash(seed + 4) * 0.16) * state.width;
    comet.y1 = comet.y0 + (0.09 + hash(seed + 5) * 0.10) * ridge;
    comet.tail = (0.075 + hash(seed + 6) * 0.065) * state.width;
    comet.seed = seed;

    // First one arrives quickly so a reload makes the treatment easy to inspect.
    // After that they go back to being something you can miss.
    comet.next = now + comet.duration + (first ? 6000 : 65000 + hash(seed + 7) * 85000);
  }

  function armFirstComet(now) {
    comet.active = false;
    comet.next = state && state.dark && !reduced
      ? now + 3800 + hash(state.width + state.height) * 2600
      : Infinity;
  }

  function drawStars(now) {
    if (!state.dark || !stars.length) return;

    var dpr = state.dpr;
    var core = Math.max(1, Math.round(dpr));
    ctx.fillStyle = "#eee6d8";

    for (var i = 0; i < stars.length; i++) {
      var star = stars[i];
      var fast = 0.5 + 0.5 * Math.sin((now / Math.max(900, star.period * 0.42)) * Math.PI * 2 + star.phase);
      var second = 0.5 + 0.5 * Math.sin((now / Math.max(1300, star.period * 0.77)) * Math.PI * 2 + star.phase * 1.83);
      var pulse = clamp(fast * 0.72 + second * 0.28, 0, 1);
      var flash = Math.pow(pulse, 2.6);
      var alpha = (0.035 + flash * 0.34) * (0.55 + star.magnitude * 0.45);

      var edge = state.skyline[clamp(Math.round(star.x), 0, state.width - 1)];
      var horizon = smoothstep(0, 36 * dpr, edge - star.y);
      alpha *= horizon;
      if (alpha < 0.012) continue;

      var x = Math.round(star.x - core * 0.5);
      var y = Math.round(star.y - core * 0.5);
      ctx.globalAlpha = clamp(alpha, 0, 0.48);
      ctx.fillRect(x, y, core, core);

      // A one-pixel wink gives even the dim stars an obvious twinkle without
      // turning the whole sky into sparkles.
      if (pulse > 0.78) {
        var wink = smoothstep(0.78, 1, pulse) * (star.bright ? 0.46 : 0.24) * horizon;
        ctx.globalAlpha = wink;
        ctx.fillRect(x - core, y, core, core);
        ctx.fillRect(x + core, y, core, core);
        if (star.bright || pulse > 0.91) {
          ctx.fillRect(x, y - core, core, core);
          ctx.fillRect(x, y + core, core, core);
        }
      }
    }
  }

  function drawComet(now) {
    if (!state.dark || !comet.active) return;

    var progress = (now - comet.start) / comet.duration;
    if (progress >= 1) {
      comet.active = false;
      return;
    }
    if (progress < 0) return;

    var fade = smoothstep(0, 0.08, progress) * (1 - smoothstep(0.72, 1, progress));
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
    var stepSize = Math.max(1, Math.round(dpr));

    ctx.fillStyle = "#eee6d8";

    // Long, tapered two-strand tail. Still pixel-built, so it belongs with the
    // dithered mountain instead of reading as a smooth CSS shooting-star effect.
    for (var step = 0; step <= comet.tail; step += stepSize) {
      var t = step / comet.tail;
      var taper = Math.pow(1 - t, 1.75);
      var tx = Math.round(x - dx * step);
      var ty = Math.round(y - dy * step);
      if (tx < 0 || tx >= state.width || ty < 0 || ty >= state.height) continue;
      if (ty >= state.skyline[tx] - 12 * dpr) continue;

      var alpha = fade * taper * (0.18 + (1 - t) * 0.70);
      if (alpha < 0.012) continue;
      ctx.globalAlpha = clamp(alpha, 0, 0.88);
      ctx.fillRect(tx, ty, stepSize, stepSize);

      if (t < 0.42 && hash(comet.seed + Math.floor(step / stepSize) * 13) > 0.40) {
        var spread = (0.45 + t * 2.2) * dpr;
        var side = hash(comet.seed + Math.floor(step) * 19) > 0.5 ? 1 : -1;
        var sx = Math.round(tx + nx * spread * side);
        var sy = Math.round(ty + ny * spread * side);
        if (sx >= 0 && sx < state.width && sy >= 0 && sy < state.skyline[sx] - 10 * dpr) {
          ctx.globalAlpha = alpha * 0.42;
          ctx.fillRect(sx, sy, stepSize, stepSize);
        }
      }
    }

    // Bright nucleus and a tiny leading spark make the object read as a comet,
    // not merely a diagonal line.
    var hx = Math.round(x);
    var hy = Math.round(y);
    if (hx >= 0 && hx < state.width && hy >= 0 && hy < state.skyline[hx] - 10 * dpr) {
      ctx.globalAlpha = 0.96 * fade;
      ctx.fillRect(hx, hy, stepSize * 2, stepSize * 2);
      ctx.globalAlpha = 0.54 * fade;
      ctx.fillRect(Math.round(hx + dx * 2 * dpr), Math.round(hy + dy * 2 * dpr), stepSize, stepSize);
      ctx.fillRect(Math.round(hx + nx * dpr), Math.round(hy + ny * dpr), stepSize, stepSize);
      ctx.fillRect(Math.round(hx - nx * dpr), Math.round(hy - ny * dpr), stepSize, stepSize);
    }
  }

  function draw(now) {
    if (!ctx || !state) return;
    ctx.clearRect(0, 0, state.width, state.height);
    if (!state.dark) return;
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
      if (state && state.dark && !comet.active && now >= comet.next) {
        scheduleComet(now, false);
      }
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

  window.__nightSkyBoost = {
    build: build,
    cometNow: function () {
      if (!state || !state.dark || reduced) return;
      scheduleComet(performance.now(), false);
    }
  };

  build();
})();
