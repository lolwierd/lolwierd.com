(function () {
  "use strict";

  var canvas = null;
  var ctx = null;
  var tries = 0;
  var themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

  var BAYER_8 = [
    0,48,12,60,3,51,15,63,32,16,44,28,35,19,47,31,
    8,56,4,52,11,59,7,55,40,24,36,20,43,27,39,23,
    2,50,14,62,1,49,13,61,34,18,46,30,33,17,45,29,
    10,58,6,54,9,57,5,53,42,26,38,22,41,25,37,21
  ];

  var PALETTES = {
    day: { top: "#eee9df", horizon: "#eadfd1" },
    gold: { top: "#eaded8", horizon: "#dfa27c" },
    civil: { top: "#d8d7dc", horizon: "#d89373" },
    nautical: { top: "#c9cdd6", horizon: "#d6b2a2" },
    night: { top: "#dadbe0", horizon: "#e4dbd4" }
  };

  function baseState() {
    return window.__portfolioSky && window.__portfolioSky.state
      ? window.__portfolioSky.state()
      : null;
  }

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

  function bayerThreshold(x, y) {
    var px = ((Math.floor(x) % 8) + 8) % 8;
    var py = ((Math.floor(y) % 8) + 8) % 8;
    return BAYER_8[py * 8 + px] / 64;
  }

  function rgb(hex) {
    var value = hex.replace("#", "");
    var number = parseInt(value, 16);
    return {
      r: (number >> 16) & 255,
      g: (number >> 8) & 255,
      b: number & 255
    };
  }

  function color(value) {
    return "rgb(" + value.r + "," + value.g + "," + value.b + ")";
  }

  function mixColor(a, b, t) {
    var left = rgb(a);
    var right = rgb(b);
    return color({
      r: Math.round(lerp(left.r, right.r, t)),
      g: Math.round(lerp(left.g, right.g, t)),
      b: Math.round(lerp(left.b, right.b, t))
    });
  }

  function palette(altitude) {
    if (altitude >= 12) return PALETTES.day;
    if (altitude >= 0) {
      var dayToGold = 1 - altitude / 12;
      return {
        top: mixColor(PALETTES.day.top, PALETTES.gold.top, dayToGold),
        horizon: mixColor(PALETTES.day.horizon, PALETTES.gold.horizon, dayToGold)
      };
    }
    if (altitude >= -6) {
      var goldToCivil = -altitude / 6;
      return {
        top: mixColor(PALETTES.gold.top, PALETTES.civil.top, goldToCivil),
        horizon: mixColor(PALETTES.gold.horizon, PALETTES.civil.horizon, goldToCivil)
      };
    }
    if (altitude >= -12) {
      var civilToNautical = (-altitude - 6) / 6;
      return {
        top: mixColor(PALETTES.civil.top, PALETTES.nautical.top, civilToNautical),
        horizon: mixColor(PALETTES.civil.horizon, PALETTES.nautical.horizon, civilToNautical)
      };
    }

    var nauticalToNight = clamp((-altitude - 12) / 8, 0, 1);
    return {
      top: mixColor(PALETTES.nautical.top, PALETTES.night.top, nauticalToNight),
      horizon: mixColor(PALETTES.nautical.horizon, PALETTES.night.horizon, nauticalToNight)
    };
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "twilight-sky";
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

  function findValleyX(state) {
    var start = Math.floor(state.width * 0.22);
    var end = Math.ceil(state.width * 0.78);
    var bestX = Math.floor(state.width * 0.5);
    var bestY = -Infinity;
    var radius = Math.max(4, Math.round(7 * state.dpr));

    for (var x = start; x < end; x += Math.max(1, Math.round(state.dpr))) {
      var total = 0;
      var count = 0;
      for (var dx = -radius; dx <= radius; dx += Math.max(1, Math.round(state.dpr))) {
        var sampleX = x + dx;
        if (sampleX < 0 || sampleX >= state.width) continue;
        total += state.skyline[sampleX];
        count++;
      }
      var y = count ? total / count : state.skyline[x];
      if (y > bestY) {
        bestY = y;
        bestX = x;
      }
    }

    return bestX;
  }

  function clipSky(state) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(state.width, 0);
    ctx.lineTo(state.width, state.skyline[state.width - 1]);
    for (var x = state.width - 1; x >= 0; x--) ctx.lineTo(x, state.skyline[x]);
    ctx.closePath();
    ctx.clip();
  }

  function drawDitheredSky(state, colors) {
    ctx.fillStyle = colors.top;
    ctx.fillRect(0, 0, state.width, state.height);

    var step = Math.max(2, Math.round(1.7 * state.dpr));
    var horizonReach = state.height * 0.42;
    ctx.fillStyle = colors.horizon;

    for (var y = step; y < state.ridgeLow; y += step) {
      for (var x = step; x < state.width; x += step) {
        var ridge = state.skyline[x];
        if (y >= ridge) continue;
        var distance = ridge - y;
        var envelope = 1 - clamp(distance / horizonReach, 0, 1);
        var density = envelope * envelope * 0.86;
        if (density <= bayerThreshold(x / step, y / step)) continue;
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  function drawAfterglow(state, altitude, valleyX) {
    if (altitude > 10 || altitude < -16) return;

    var peak = 1 - clamp(Math.abs(altitude + 2) / 14, 0, 1);
    var radiusX = state.width * (state.portrait ? 0.34 : 0.24);
    var radiusY = state.height * 0.19;
    var centerY = state.skyline[valleyX] - radiusY * 0.14;
    var step = Math.max(2, Math.round(2 * state.dpr));
    ctx.fillStyle = altitude >= -6 ? "#cb7758" : "#c89886";

    for (var y = Math.max(0, Math.floor(centerY - radiusY)); y < centerY + radiusY; y += step) {
      for (var x = Math.max(0, Math.floor(valleyX - radiusX)); x < Math.min(state.width, valleyX + radiusX); x += step) {
        if (y >= state.skyline[x]) continue;
        var nx = (x - valleyX) / radiusX;
        var ny = (y - centerY) / radiusY;
        var distance = nx * nx + ny * ny;
        if (distance >= 1) continue;
        var density = (1 - distance) * peak * 0.42;
        if (density <= bayerThreshold(x / step, y / step)) continue;
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  function drawSun(state, altitude, azimuth, valleyX) {
    if (altitude <= -0.83) return;

    var radius = Math.round((state.portrait ? 16 : 22) * state.dpr);
    var azimuthX = state.width * (0.5 + clamp(azimuth / Math.PI, -0.5, 0.5) * 0.78);
    var lowBlend = 1 - smoothstep(4, 15, altitude);
    var sunX = Math.round(lerp(azimuthX, valleyX, lowBlend * 0.94));
    var ridgeY = state.skyline[clamp(sunX, 0, state.width - 1)];
    var highY = state.height * (0.48 - clamp(altitude, 0, 75) / 75 * 0.38);
    var lowY = ridgeY + radius * 0.18;
    var sunY = Math.round(lerp(highY, lowY, lowBlend));
    var core = Math.max(1, Math.round(state.dpr));
    var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#9d4429";
    ctx.fillStyle = accent;

    for (var dy = -radius; dy <= radius; dy += core) {
      for (var dx = -radius; dx <= radius; dx += core) {
        var distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > radius) continue;
        var px = sunX + dx;
        var py = sunY + dy;
        if (px < 0 || px >= state.width || py < 0 || py >= state.skyline[px]) continue;
        var edge = smoothstep(radius * 0.80, radius, distance);
        if (edge > 0 && bayerThreshold(px / core, py / core) < edge * 0.72) continue;
        ctx.fillRect(px, py, core, core);
      }
    }
  }

  function draw() {
    var state = baseState();
    if (!state || !state.skyline || !state.celestial || !state.celestial.sun) {
      if (tries++ < 80) window.setTimeout(draw, 80);
      return;
    }

    ensureCanvas();
    tries = 0;

    if (canvas.width !== state.width || canvas.height !== state.height) {
      canvas.width = state.width;
      canvas.height = state.height;
      canvas.style.width = state.cssWidth + "px";
      canvas.style.height = state.cssHeight + "px";
    }

    ctx.clearRect(0, 0, state.width, state.height);
    if (themeMedia.matches) return;

    // SunCalc returns radians. sky-v3's exposed state keeps the raw values, so
    // convert here before deciding whether we are in day, golden hour, or twilight.
    var altitude = state.celestial.sun.altitude * 180 / Math.PI;
    var azimuth = state.celestial.sun.azimuth;
    var colors = palette(altitude);
    var valleyX = findValleyX(state);

    ctx.save();
    clipSky(state);
    drawDitheredSky(state, colors);
    drawAfterglow(state, altitude, valleyX);
    drawSun(state, altitude, azimuth, valleyX);
    ctx.restore();
  }

  function redrawSoon() {
    window.clearTimeout(redrawSoon.timer);
    redrawSoon.timer = window.setTimeout(draw, 180);
  }

  if (themeMedia.addEventListener) themeMedia.addEventListener("change", redrawSoon);
  else themeMedia.addListener(redrawSoon);
  window.addEventListener("resize", redrawSoon, { passive: true });
  window.setInterval(draw, 60000);

  draw();
})();
