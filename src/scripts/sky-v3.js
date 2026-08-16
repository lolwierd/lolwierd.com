(function () {
  "use strict";

  var canvas = document.getElementById("sky");
  if (!canvas) return;

  var ctx = canvas.getContext("2d", { alpha: true });
  var plate = new Image();
  var buffer = document.createElement("canvas");
  var bufferCtx = buffer.getContext("2d", { willReadFrequently: true });
  var themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  var motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

  var SOURCE = "/assets/annapurna-circuit.jpg";
  var SKYLINE_SOURCE = "/assets/annapurna-skyline.json";
  var MAX_DPR = 2;
  var FIXED_TIME = 21437;

  var BAYER_8 = [
    0,48,12,60,3,51,15,63,32,16,44,28,35,19,47,31,
    8,56,4,52,11,59,7,55,40,24,36,20,43,27,39,23,
    2,50,14,62,1,49,13,61,34,18,46,30,33,17,45,29,
    10,58,6,54,9,57,5,53,42,26,38,22,41,25,37,21
  ];

  var THEMES = {
    dark: {
      ink: "#e4dac8",
      terrainAlpha: 0.91,
      dustAlpha: 0.19,
      cloudAlpha: 0.12,
      star: "#eee6d8",
      starAlpha: 0.90,
      satelliteAlpha: 0.30
    },
    light: {
      ink: "#293039",
      terrainAlpha: 0.87,
      dustAlpha: 0.105,
      cloudAlpha: 0.235,
      star: "#293039",
      starAlpha: 0,
      satelliteAlpha: 0
    }
  };

  var skylineData = null;
  var state = null;
  var terrainImage = null;
  var edgeDots = [];
  var cloudDots = [];
  var stars = [];
  var wanderers = [];

  var comet = {
    active: false,
    start: 0,
    duration: 0,
    next: Infinity,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    tail: 0
  };

  var satellite = {
    active: false,
    start: 0,
    duration: 0,
    next: Infinity,
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    magnitude: 0
  };

  var dpr = 1;
  var width = 0;
  var height = 0;
  var resizeTimer = 0;
  var rafId = 0;
  var lastDraw = 0;
  var reducedMotion = motionMedia.matches;
  var visible = !document.hidden;
  var activeWork = null;

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

  function hash2(x, y, seed) {
    return hash(
      Math.imul(x | 0, 374761393) ^
      Math.imul(y | 0, 668265263) ^
      Math.imul(seed | 0, 2246822519)
    );
  }

  function valueNoise(x, y, seed) {
    var ix = Math.floor(x);
    var iy = Math.floor(y);
    var fx = x - ix;
    var fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx);
    var uy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed);
    var b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed);
    var d = hash2(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }

  function fbm(x, y, seed) {
    var value = 0;
    var amplitude = 0.58;
    var frequency = 1;
    var normalizer = 0;

    for (var octave = 0; octave < 4; octave++) {
      value += valueNoise(x * frequency, y * frequency, seed + octave * 97) * amplitude;
      normalizer += amplitude;
      frequency *= 2.03;
      amplitude *= 0.47;
    }

    return normalizer ? value / normalizer : 0;
  }

  function warpedField(x, y, time, seed) {
    var inner = fbm(x - time * 0.18, y + time * 0.11, seed);
    return fbm(
      x + inner * 0.72 + time * 0.16,
      y + inner * 0.48 - time * 0.10,
      seed + 211
    );
  }

  function bayerThreshold(x, y) {
    var px = ((Math.floor(x) % 8) + 8) % 8;
    var py = ((Math.floor(y) % 8) + 8) % 8;
    return BAYER_8[py * 8 + px] / 64;
  }

  function theme() {
    return themeMedia.matches ? THEMES.dark : THEMES.light;
  }

  function listenMedia(media, callback) {
    if (media.addEventListener) media.addEventListener("change", callback);
    else media.addListener(callback);
  }

  function sampleSourceSkyline(sourceX) {
    if (!skylineData || !skylineData.y || !skylineData.y.length) return 0;
    var position = clamp(sourceX / skylineData.step, 0, skylineData.y.length - 1);
    var left = Math.floor(position);
    var right = Math.min(skylineData.y.length - 1, left + 1);
    return lerp(skylineData.y[left], skylineData.y[right], position - left);
  }

  function sourceCrop(targetW, targetH, portrait) {
    var plateW = plate.naturalWidth;
    var plateH = plate.naturalHeight;
    var sourceAspect = plateW / plateH;
    var targetAspect = targetW / targetH;
    var sx = 0;
    var sy = 0;
    var sw = plateW;
    var sh = plateH;
    var focus = portrait ? 0.55 : 0.52;

    if (targetAspect > sourceAspect) {
      sh = sw / targetAspect;
      sy = clamp(plateH * 0.10, 0, Math.max(0, plateH - sh));
    } else {
      sw = sh * targetAspect;
      sx = clamp(plateW * focus - sw / 2, 0, Math.max(0, plateW - sw));
    }

    return { sx: sx, sy: sy, sw: sw, sh: sh };
  }

  function buildRenderedSkyline(crop, bandTop, drawH) {
    var skyline = new Int32Array(width);

    for (var x = 0; x < width; x++) {
      var sourceX = crop.sx + ((x + 0.5) / width) * crop.sw - 0.5;
      var sourceY = sampleSourceSkyline(sourceX);
      skyline[x] = clamp(
        Math.round(bandTop + ((sourceY - crop.sy) / crop.sh) * drawH),
        0,
        height
      );
    }

    return skyline;
  }

  function diffuse(x, y, error, skyline) {
    if (x < 0 || y < 0 || x >= width || y >= height || y < skyline[x]) return;
    activeWork[y * width + x] += error;
  }

  function atkinson(paper, skyline) {
    activeWork = new Float32Array(paper);
    var dots = new Uint8Array(width * height);

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var i = y * width + x;

        if (y < skyline[x]) {
          activeWork[i] = 1;
          continue;
        }

        var old = activeWork[i];
        var quantized = old >= 0.5 ? 1 : 0;
        dots[i] = quantized ? 0 : 1;
        var error = (old - quantized) * 0.125;
        if (!error) continue;

        diffuse(x + 1, y, error, skyline);
        diffuse(x + 2, y, error, skyline);
        diffuse(x - 1, y + 1, error, skyline);
        diffuse(x, y + 1, error, skyline);
        diffuse(x + 1, y + 1, error, skyline);
        diffuse(x, y + 2, error, skyline);
      }
    }

    activeWork = null;
    return dots;
  }

  function makeTerrain(luminance, skyline) {
    var total = width * height;
    var paper = new Float32Array(total);
    var activeTheme = theme();

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var i = y * width + x;
        if (y < skyline[x]) {
          paper[i] = 1;
          continue;
        }

        var value = luminance[i] / 255;
        var density;
        if (state.dark) {
          density = 0.035 + 0.965 * Math.pow(smoothstep(0.055, 0.95, value), 1.27);
        } else {
          density = 0.018 + 0.982 * Math.pow(smoothstep(0.035, 0.84, 1 - value), 1.10);
        }
        paper[i] = 1 - clamp(density, 0, 1);
      }
    }

    var dots = atkinson(paper, skyline);
    terrainImage = ctx.createImageData(width, height);
    var output = terrainImage.data;
    var rgb = parseInt(activeTheme.ink.replace("#", ""), 16);
    var red = (rgb >> 16) & 255;
    var green = (rgb >> 8) & 255;
    var blue = rgb & 255;
    var edgeDepth = Math.max(3, Math.round(4 * dpr));
    var seed = width * 13 + height * 29 + 701;

    for (var index = 0; index < dots.length; index++) {
      if (!dots[index]) continue;

      var py = Math.floor(index / width);
      var px = index - py * width;
      var distance = py - skyline[px];
      var edgeMix = smoothstep(0, edgeDepth, distance);

      if (distance < edgeDepth && hash2(px, py, seed) < (1 - edgeMix) * 0.10) continue;

      var p = index * 4;
      output[p] = red;
      output[p + 1] = green;
      output[p + 2] = blue;
      output[p + 3] = Math.round(activeTheme.terrainAlpha * 255 * (0.78 + edgeMix * 0.22));
    }
  }

  function findValley() {
    var start = Math.floor(width * 0.12);
    var end = Math.floor(width * 0.88);
    var step = Math.max(2, Math.floor(width / 240));
    var valleyX = Math.floor(width * 0.5);
    var valleyY = state.ridgeTop;

    for (var x = start; x <= end; x += step) {
      if (state.skyline[x] > valleyY) {
        valleyX = x;
        valleyY = state.skyline[x];
      }
    }

    return { x: valleyX, y: valleyY, depth: valleyY - state.ridgeTop };
  }

  function makeEdgeDots() {
    edgeDots = [];
    var reach = Math.max(8, Math.round(13 * dpr));
    var xStep = Math.max(1, Math.round(dpr * 0.72));
    var seed = width * 17 + height * 31 + 811;

    for (var x = 0; x < width; x += xStep) {
      var edge = state.skyline[x];
      if (edge >= height) continue;

      for (var distance = 1; distance <= reach; distance++) {
        var y = edge - distance;
        if (y < 0) break;

        var envelope = 1 - distance / (reach + 1);
        var keep = 0.010 + envelope * envelope * 0.065;
        if (hash2(x, y, seed) > keep) continue;

        edgeDots.push({
          x: x,
          y: y,
          envelope: envelope,
          phase: hash2(x, y, seed + 3) * Math.PI * 2,
          threshold: bayerThreshold(x, y),
          strength: 0.48 + hash2(x, y, seed + 7) * 0.60,
          drift: 0.45 + hash2(x, y, seed + 13) * 0.75
        });
      }
    }
  }

  function drawEdge(now) {
    var activeTheme = theme();
    var t = now * 0.0000065;
    ctx.fillStyle = activeTheme.ink;

    for (var i = 0; i < edgeDots.length; i++) {
      var dot = edgeDots[i];
      var field = warpedField(dot.x * 0.0021, dot.y * 0.0025 + dot.phase, t, 991);
      var longPulse = 0.5 + 0.5 * Math.sin(dot.phase + t * 0.21);
      var density = dot.envelope * (0.27 + field * 0.58 + longPulse * 0.15);
      if (density < dot.threshold * 0.66) continue;

      var detach = smoothstep(0.59, 0.88, field) * dot.drift;
      var lift = Math.round(detach * (1.0 + (1 - dot.envelope) * 1.6) * dpr);
      var alpha =
        activeTheme.dustAlpha *
        dot.envelope *
        dot.strength *
        smoothstep(0.20, 0.80, density);

      if (alpha < 0.005) continue;
      ctx.globalAlpha = clamp(alpha, 0, state.dark ? 0.19 : 0.115);
      ctx.fillRect(dot.x, dot.y - lift, 1, 1);
    }
  }

  function makeClouds() {
    cloudDots = [];
    var valley = findValley();
    if (valley.depth < 28 * dpr) return;

    var span = clamp(width * (state.dark ? 0.50 : 0.74), 260 * dpr, 1280 * dpr);
    var cloudHeight = clamp(
      valley.depth * (state.dark ? 0.58 : 0.92),
      70 * dpr,
      state.dark ? 190 * dpr : 260 * dpr
    );
    var centerY = valley.y - cloudHeight * (state.dark ? 0.24 : 0.31);
    var dotStep = Math.max(2, Math.round((state.dark ? 3.0 : 2.55) * dpr));
    var seed = state.dark ? 1701 : 1801;
    var densityScale = state.dark ? 0.30 : 0.46;

    for (var y = centerY - cloudHeight; y <= centerY + cloudHeight * 0.58; y += dotStep) {
      for (var x = valley.x - span * 0.5; x <= valley.x + span * 0.5; x += dotStep) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        var u = (x - valley.x) / (span * 0.5);
        var v = (y - centerY) / cloudHeight;
        var basin = Math.exp(-(u * u * 2.20 + v * v * 4.25));
        var left = Math.exp(-((u + 0.48) * (u + 0.48) * 5.2 + (v + 0.04) * (v + 0.04) * 7.0));
        var right = Math.exp(-((u - 0.43) * (u - 0.43) * 5.1 + (v + 0.02) * (v + 0.02) * 7.5));
        var high = Math.exp(-((u - 0.05) * (u - 0.05) * 7.0 + (v + 0.52) * (v + 0.52) * 10.0));
        var shape = clamp(basin + left * 0.48 + right * 0.44 + high * (state.dark ? 0.16 : 0.36), 0, 1);
        if (shape < 0.055) continue;

        var cellX = Math.floor(x / dotStep);
        var cellY = Math.floor(y / dotStep);
        if (hash2(cellX, cellY, seed) > 0.06 + shape * densityScale) continue;

        cloudDots.push({
          x: x,
          y: y,
          shape: shape,
          phase: hash2(cellX, cellY, seed + 11) * 21,
          threshold: bayerThreshold(cellX, cellY),
          octave: hash2(cellX, cellY, seed + 17)
        });
      }
    }
  }

  function drawClouds(now) {
    var activeTheme = theme();
    var t = now * 0.0000085;
    var swell = 0.78 + 0.15 * Math.sin(t * 0.24 + 0.8) + 0.07 * Math.sin(t * 0.11 + 2.1);
    ctx.fillStyle = activeTheme.ink;

    for (var i = 0; i < cloudDots.length; i++) {
      var dot = cloudDots[i];
      var ix = clamp(Math.round(dot.x), 0, width - 1);
      var ridgeDistance = state.skyline[ix] - dot.y;
      var ridgeFade = 0.33 + 0.67 * smoothstep(-115 * dpr, 34 * dpr, ridgeDistance);
      var fieldA = warpedField(dot.x * 0.00145 + dot.phase * 0.009, dot.y * 0.00170, t, state.dark ? 1201 : 1401);
      var fieldB = warpedField(dot.x * 0.00205, dot.y * 0.00125 + dot.phase * 0.006, t * 0.63, state.dark ? 1327 : 1523);
      var weather = fieldA * 0.72 + fieldB * 0.28;
      var density = dot.shape * (0.19 + weather * 0.81) * swell;
      var threshold = dot.threshold * (state.dark ? 0.60 : 0.49);
      if (density < threshold) continue;

      var alpha = activeTheme.cloudAlpha * ridgeFade * (0.26 + density * 0.74);
      if (alpha < 0.005) continue;
      ctx.globalAlpha = clamp(alpha, 0, state.dark ? 0.155 : 0.31);
      ctx.fillRect(Math.round(dot.x), Math.round(dot.y), 1, 1);
    }
  }

  function makeStars() {
    stars = [];
    wanderers = [];
    if (!state.dark) return;

    var count = state.portrait ? 24 : 36;
    var seatCount = count + 10;
    var seats = [];
    var seed = width * 41 + height * 73 + 1901;
    var minDistance = Math.sqrt((width * Math.max(1, state.ridgeTop)) / seatCount) * 0.35;
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

      var bright = hash(seed++) > 0.87;
      seats.push({
        x: x,
        y: y,
        size: 1,
        magnitude: bright ? 0.76 + hash(seed++) * 0.22 : 0.24 + hash(seed++) * 0.43,
        period: 16000 + hash(seed++) * 51000,
        phase: hash(seed++) * Math.PI * 2,
        breathePeriod: 42000 + hash(seed++) * 98000,
        breatheOffset: hash(seed++) * 130000,
        vanishPeriod: 105000 + hash(seed++) * 175000,
        vanishOffset: hash(seed++) * 200000,
        sparkle: bright ? 0.12 + hash(seed++) * 0.13 : 0.02 + hash(seed++) * 0.05
      });
    }

    stars = seats.slice(0, count);
    for (var w = 0; w < Math.min(3, seats.length - count - 1); w++) {
      wanderers.push({
        first: seats[count + w],
        second: seats[count + w + 3],
        period: 150000 + w * 47000,
        offset: 33000 + w * 61000
      });
    }
  }

  function starAlpha(star, now) {
    var primary = Math.sin((now / star.period) * Math.PI * 2 + star.phase);
    var secondary = Math.sin((now / (star.period * 1.91)) * Math.PI * 2 + star.phase * 1.7);
    var shimmer = Math.sin((now / Math.max(9000, star.period * 0.37)) * Math.PI * 2 + star.phase * 2.3);
    var twinkle = 0.73 + primary * 0.13 + secondary * 0.06 + shimmer * star.sparkle;
    var breathe = 0.74 + 0.26 * Math.sin(((now + star.breatheOffset) / star.breathePeriod) * Math.PI * 2);

    var vanishPhase = (((now + star.vanishOffset) % star.vanishPeriod) + star.vanishPeriod) % star.vanishPeriod / star.vanishPeriod;
    var visibleFactor = 1;
    if (vanishPhase > 0.84) {
      var p = (vanishPhase - 0.84) / 0.16;
      visibleFactor = p < 0.42
        ? 1 - smoothstep(0, 0.42, p)
        : smoothstep(0.58, 1, p);
    }

    var edge = state.skyline[clamp(Math.round(star.x), 0, width - 1)];
    var horizonFade = smoothstep(0, 30 * dpr, edge - star.y);
    return theme().starAlpha * star.magnitude * twinkle * breathe * visibleFactor * horizonFade;
  }

  function drawOneStar(star, now, multiplier) {
    var alpha = starAlpha(star, now) * multiplier;
    if (alpha < 0.009) return;
    ctx.globalAlpha = clamp(alpha, 0, 0.93);
    ctx.fillRect(Math.round(star.x), Math.round(star.y), 1, 1);
  }

  function drawStars(now) {
    if (!state.dark) return;
    ctx.fillStyle = theme().star;

    for (var i = 0; i < stars.length; i++) drawOneStar(stars[i], now, 1);

    for (var w = 0; w < wanderers.length; w++) {
      var wanderer = wanderers[w];
      var phase = ((((now - wanderer.offset) % wanderer.period) + wanderer.period) % wanderer.period) / wanderer.period;
      var oldAlpha = 1;
      var newAlpha = 0;

      if (phase < 0.70) {
        oldAlpha = 1;
      } else if (phase < 0.80) {
        oldAlpha = 1 - smoothstep(0.70, 0.80, phase);
      } else if (phase < 0.88) {
        oldAlpha = 0;
      } else {
        oldAlpha = 0;
        newAlpha = smoothstep(0.88, 1, phase);
      }

      drawOneStar(wanderer.first, now, oldAlpha);
      drawOneStar(wanderer.second, now, newAlpha);
    }
  }

  function scheduleComet(now) {
    if (!state.dark) return;
    var seed = Math.floor(now / 1000) + width * 3 + height * 5;
    var direction = hash(seed) > 0.5 ? 1 : -1;

    comet.active = true;
    comet.start = now;
    comet.duration = 1250 + hash(seed + 1) * 1350;
    comet.x0 = (0.13 + hash(seed + 2) * 0.72) * width;
    comet.y0 = (0.06 + hash(seed + 3) * 0.25) * Math.max(state.ridgeTop, 1);
    comet.x1 = comet.x0 + direction * (0.09 + hash(seed + 4) * 0.14) * width;
    comet.y1 = comet.y0 + (0.055 + hash(seed + 5) * 0.09) * Math.max(state.ridgeTop, 1);
    comet.tail = (0.013 + hash(seed + 6) * 0.020) * width;
    comet.next = now + comet.duration + 180000 + hash(seed + 7) * 270000;
  }

  function drawComet(now) {
    if (!state.dark || !comet.active) return;
    var progress = (now - comet.start) / comet.duration;
    if (progress >= 1) {
      comet.active = false;
      return;
    }
    if (progress < 0) return;

    var fade = smoothstep(0, 0.12, progress) * (1 - smoothstep(0.73, 1, progress));
    var x = lerp(comet.x0, comet.x1, progress);
    var y = lerp(comet.y0, comet.y1, progress);
    var dx = comet.x1 - comet.x0;
    var dy = comet.y1 - comet.y0;
    var length = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= length;
    dy /= length;
    ctx.fillStyle = theme().star;

    for (var step = comet.tail; step > 0; step -= Math.max(1, dpr)) {
      var tx = Math.round(x - dx * step);
      var ty = Math.round(y - dy * step);
      if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
      if (ty >= state.skyline[tx] - 14 * dpr) continue;
      var alpha = fade * Math.pow(1 - step / comet.tail, 1.55) * 0.62;
      if (alpha < 0.008) continue;
      ctx.globalAlpha = alpha;
      ctx.fillRect(tx, ty, 1, 1);
    }
  }

  function scheduleSatellite(now) {
    if (!state.dark) return;
    var seed = Math.floor(now / 1000) + width * 11 + height * 17;
    var direction = hash(seed) > 0.5 ? 1 : -1;
    satellite.active = true;
    satellite.start = now;
    satellite.duration = 30000 + hash(seed + 1) * 26000;
    satellite.x0 = direction > 0 ? -10 * dpr : width + 10 * dpr;
    satellite.x1 = direction > 0 ? width + 10 * dpr : -10 * dpr;
    satellite.y0 = (0.12 + hash(seed + 2) * 0.28) * state.ridgeTop;
    satellite.y1 = satellite.y0 + (hash(seed + 3) - 0.5) * state.ridgeTop * 0.08;
    satellite.magnitude = 0.48 + hash(seed + 4) * 0.32;
    satellite.next = now + satellite.duration + 210000 + hash(seed + 5) * 300000;
  }

  function drawSatellite(now) {
    if (!state.dark || !satellite.active) return;
    var progress = (now - satellite.start) / satellite.duration;
    if (progress >= 1) {
      satellite.active = false;
      return;
    }
    if (progress < 0) return;

    var x = Math.round(lerp(satellite.x0, satellite.x1, progress));
    var y = Math.round(lerp(satellite.y0, satellite.y1, progress));
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    if (y >= state.skyline[x] - 18 * dpr) return;

    var fade = smoothstep(0, 0.12, progress) * (1 - smoothstep(0.88, 1, progress));
    var glint = 0.78 + 0.22 * Math.sin(now * 0.0016 + satellite.y0);
    ctx.fillStyle = theme().star;
    ctx.globalAlpha = theme().satelliteAlpha * satellite.magnitude * fade * glint;
    ctx.fillRect(x, y, 1, 1);
  }

  function drawFrame(now) {
    if (!state || !terrainImage) return;
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(terrainImage, 0, 0);
    drawEdge(now);
    drawClouds(now);
    drawStars(now);
    drawSatellite(now);
    drawComet(now);
    ctx.globalAlpha = 1;
  }

  function layoutPlate() {
    var cssW = window.innerWidth;
    var cssH = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    width = Math.max(1, Math.round(cssW * dpr));
    height = Math.max(1, Math.round(cssH * dpr));

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    buffer.width = width;
    buffer.height = height;
    bufferCtx.clearRect(0, 0, width, height);
    bufferCtx.imageSmoothingEnabled = true;
    bufferCtx.imageSmoothingQuality = "high";

    var portrait = cssW < cssH;
    var visibleBandH = Math.round(height * (portrait ? 0.56 : 0.52));
    var overscan = Math.round(height * (portrait ? 0.18 : 0.16));
    var drawH = visibleBandH + overscan;
    var bandTop = height - visibleBandH;
    var crop = sourceCrop(width, drawH, portrait);

    bufferCtx.drawImage(plate, crop.sx, crop.sy, crop.sw, crop.sh, 0, bandTop, width, drawH);
    var pixels = bufferCtx.getImageData(0, 0, width, height).data;
    var luminance = new Uint8Array(width * height);

    for (var i = bandTop * width; i < luminance.length; i++) {
      var p = i * 4;
      luminance[i] = Math.round(pixels[p] * 0.2126 + pixels[p + 1] * 0.7152 + pixels[p + 2] * 0.0722);
    }

    var skyline = buildRenderedSkyline(crop, bandTop, drawH);
    var ridgeTop = height;
    var ridgeLow = 0;
    for (i = 0; i < skyline.length; i++) {
      if (skyline[i] < ridgeTop) ridgeTop = skyline[i];
      if (skyline[i] < height && skyline[i] > ridgeLow) ridgeLow = skyline[i];
    }

    state = {
      width: width,
      height: height,
      cssWidth: cssW,
      cssHeight: cssH,
      dpr: dpr,
      dark: themeMedia.matches,
      portrait: portrait,
      skyline: skyline,
      ridgeTop: ridgeTop,
      ridgeLow: ridgeLow,
      crop: crop,
      bandTop: bandTop,
      drawHeight: drawH
    };

    makeTerrain(luminance, skyline);
    makeEdgeDots();
    makeClouds();
    makeStars();

    var now = performance.now();
    comet.active = false;
    satellite.active = false;
    comet.next = state.dark ? now + 180000 + hash2(width, height, 901) * 240000 : Infinity;
    satellite.next = state.dark ? now + 150000 + hash2(width, height, 903) * 270000 : Infinity;
    drawFrame(reducedMotion ? FIXED_TIME : now);
  }

  function tick(now) {
    rafId = window.requestAnimationFrame(tick);
    if (!state || reducedMotion || !visible || now - lastDraw < 1000 / 24) return;
    lastDraw = now;

    if (state.dark && !comet.active && now >= comet.next) scheduleComet(now);
    if (state.dark && !satellite.active && now >= satellite.next) scheduleSatellite(now);
    drawFrame(now);
  }

  function build() {
    if (!plate.complete || !plate.naturalWidth || !skylineData) return;
    window.cancelAnimationFrame(rafId);
    rafId = 0;
    layoutPlate();
    if (!reducedMotion) rafId = window.requestAnimationFrame(tick);
  }

  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(build, 180);
  }

  listenMedia(themeMedia, function () {
    window.setTimeout(build, 0);
  });

  listenMedia(motionMedia, function (event) {
    reducedMotion = event.matches;
    build();
  });

  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", function () {
    visible = !document.hidden;
    if (visible && !reducedMotion && !rafId) rafId = window.requestAnimationFrame(tick);
  });

  window.__portfolioSky = {
    build: build,
    step: function (now) {
      drawFrame(reducedMotion ? FIXED_TIME : now == null ? performance.now() : now);
    },
    cometNow: function (now) {
      var time = reducedMotion ? FIXED_TIME : now == null ? performance.now() : now;
      if (state && state.dark) scheduleComet(time);
      drawFrame(time);
    },
    satelliteNow: function (now) {
      var time = reducedMotion ? FIXED_TIME : now == null ? performance.now() : now;
      if (state && state.dark) scheduleSatellite(time);
      drawFrame(time);
    },
    state: function () {
      if (!state) return null;
      return {
        width: state.width,
        height: state.height,
        cssWidth: state.cssWidth,
        cssHeight: state.cssHeight,
        dpr: state.dpr,
        dark: state.dark,
        ridgeTop: state.ridgeTop,
        ridgeLow: state.ridgeLow,
        edgeDots: edgeDots.length,
        cloudDots: cloudDots.length,
        stars: stars.length,
        wanderers: wanderers.length,
        comet: { active: comet.active, next: comet.next },
        satellite: { active: satellite.active, next: satellite.next },
        motion: { reduced: reducedMotion, visible: visible, rafActive: !!rafId }
      };
    }
  };

  Promise.all([
    new Promise(function (resolve, reject) {
      plate.decoding = "async";
      plate.onload = resolve;
      plate.onerror = reject;
      plate.src = SOURCE;
    }),
    fetch(SKYLINE_SOURCE, { cache: "force-cache" }).then(function (response) {
      if (!response.ok) throw new Error("failed to load skyline");
      return response.json();
    })
  ])
    .then(function (values) {
      skylineData = values[1];
      build();
    })
    .catch(function () {
      document.documentElement.setAttribute("data-plate-error", "1");
    });
})();
