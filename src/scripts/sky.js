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

  var MAX_DPR = 3;
  var SOURCE = "/assets/annapurna-circuit.jpg";
  var FIXED_TIME = 21437;

  var BAYER_8 = [
    0, 48, 12, 60, 3, 51, 15, 63,
    32, 16, 44, 28, 35, 19, 47, 31,
    8, 56, 4, 52, 11, 59, 7, 55,
    40, 24, 36, 20, 43, 27, 39, 23,
    2, 50, 14, 62, 1, 49, 13, 61,
    34, 18, 46, 30, 33, 17, 45, 29,
    10, 58, 6, 54, 9, 57, 5, 53,
    42, 26, 38, 22, 41, 25, 37, 21
  ];

  var DARK = {
    ink: "#e4dac8",
    inkAlpha: 0.91,
    edgeAlpha: 0.34,
    star: "#eee6d8",
    starAlpha: 0.88,
    cloudAlpha: 0.20,
    cloudSpan: 0.58,
    cloudHeight: 0.86,
    cloudDensity: 0.42
  };

  var LIGHT = {
    ink: "#293039",
    inkAlpha: 0.88,
    edgeAlpha: 0.17,
    star: "#293039",
    starAlpha: 0,
    cloudAlpha: 0.31,
    cloudSpan: 0.84,
    cloudHeight: 1.36,
    cloudDensity: 0.68
  };

  var state = null;
  var terrainImage = null;
  var edgeDots = [];
  var cloudDots = [];
  var stars = [];
  var wanderers = [];
  var starSeats = [];
  var activeWork = null;

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

  var dpr = 1;
  var width = 0;
  var height = 0;
  var resizeTimer = 0;
  var rafId = 0;
  var lastDraw = 0;
  var reducedMotion = motionMedia.matches;
  var visible = !document.hidden;

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

  // The useful idea from React Bits Dither: move a low-frequency FBM field
  // underneath a fixed ordered-dither grid. The mountain plate itself never moves.
  function fbm(x, y, seed) {
    var value = 0;
    var amplitude = 0.56;
    var frequency = 1;
    var normalizer = 0;

    for (var octave = 0; octave < 4; octave++) {
      value += valueNoise(x * frequency, y * frequency, seed + octave * 97) * amplitude;
      normalizer += amplitude;
      frequency *= 2.07;
      amplitude *= 0.48;
    }

    return normalizer ? value / normalizer : 0;
  }

  function warpedField(x, y, time, seed) {
    var inner = fbm(x - time * 0.28, y + time * 0.16, seed);
    return fbm(
      x + inner * 0.86 + time * 0.31,
      y + inner * 0.57 - time * 0.19,
      seed + 211
    );
  }

  function bayerThreshold(x, y) {
    var px = ((Math.floor(x) % 8) + 8) % 8;
    var py = ((Math.floor(y) % 8) + 8) % 8;
    return BAYER_8[py * 8 + px] / 64;
  }

  function theme() {
    return themeMedia.matches ? DARK : LIGHT;
  }

  function listenMedia(media, callback) {
    if (media.addEventListener) media.addEventListener("change", callback);
    else media.addListener(callback);
  }

  function medianFilterSkyline(source, scale) {
    var radius = Math.max(2, Math.round(2.25 * scale));
    var clean = new Int32Array(source.length);

    for (var x = 0; x < source.length; x++) {
      var values = [];
      for (
        var neighbor = Math.max(0, x - radius);
        neighbor <= Math.min(source.length - 1, x + radius);
        neighbor++
      ) {
        values.push(source[neighbor]);
      }
      values.sort(function (a, b) { return a - b; });
      clean[x] = values[Math.floor(values.length / 2)];
    }

    return clean;
  }

  /*
   * Per-column sky classification can occasionally "fall through" a run of
   * columns when snow/sky colours are close. That produced the fake rectangular
   * bite in the middle of the range. A real ridge can be sharp, but it should not
   * jump down tens of pixels, remain missing for a short span, then jump back up.
   *
   * Repair only those paired discontinuities. We never smooth the whole ridge:
   * detected terrain above the reconstructed chord is preserved, so actual peaks,
   * teeth and rock detail stay crisp.
   */
  function repairSkylineCuts(source, scale) {
    var out = new Int32Array(source);
    var jump = Math.max(16, Math.round(18 * scale));
    var recovery = Math.max(11, Math.round(12 * scale));
    var maxSpan = Math.max(28, Math.round(48 * scale));
    var tolerance = Math.max(5, Math.round(6 * scale));

    for (var x = 1; x < out.length - 2; x++) {
      var downJump = out[x] - out[x - 1];
      if (downJump < jump) continue;

      var end = -1;
      var limit = Math.min(out.length - 1, x + maxSpan);

      for (var j = x + 1; j <= limit; j++) {
        var upJump = out[j - 1] - out[j];
        if (upJump >= recovery) {
          end = j;
          break;
        }
      }

      if (end < 0) continue;

      var leftX = x - 1;
      var rightX = end;
      var leftY = out[leftX];
      var rightY = out[rightX];
      var suspicious = 0;
      var samples = 0;

      for (var k = x; k < end; k++) {
        var t = (k - leftX) / (rightX - leftX);
        var chord = lerp(leftY, rightY, t);
        if (out[k] > chord + tolerance) suspicious++;
        samples++;
      }

      if (!samples || suspicious / samples < 0.60) continue;

      for (k = x; k < end; k++) {
        t = (k - leftX) / (rightX - leftX);
        chord = Math.round(lerp(leftY, rightY, t));

        // Smaller y means "terrain starts higher". Only fill missing terrain;
        // never erase a real peak that the detector already found.
        out[k] = Math.min(out[k], chord);
      }

      x = end - 1;
    }

    // Second safety net: a one-column detector failure should never create a
    // vertical wall. This only clamps truly implausible instantaneous drops.
    var maxStep = Math.max(5, Math.round(5 * scale));
    var forward = new Int32Array(out);
    var backward = new Int32Array(out);

    for (x = 1; x < out.length; x++) {
      forward[x] = Math.min(forward[x], forward[x - 1] + maxStep);
    }

    for (x = out.length - 2; x >= 0; x--) {
      backward[x] = Math.min(backward[x], backward[x + 1] + maxStep);
    }

    for (x = 0; x < out.length; x++) {
      out[x] = Math.min(out[x], forward[x], backward[x]);
    }

    return out;
  }

  function buildSkyline(pixels, w, h, bandTop, scale) {
    var skyline = new Int32Array(w);
    var warmup = Math.max(6, Math.round(8 * scale));
    var required = Math.max(2, Math.round(2 * scale));
    var tracking = 1 / Math.max(12, Math.round(18 * scale));

    function channels(x, y) {
      var p = (y * w + x) * 4;
      var r = pixels[p];
      var g = pixels[p + 1];
      var b = pixels[p + 2];
      return {
        blueGreen: b - g,
        greenRed: g - r,
        luminance: r * 0.2126 + g * 0.7152 + b * 0.0722
      };
    }

    for (var x = 0; x < w; x++) {
      var bg = 0;
      var gr = 0;
      var lum = 0;
      var samples = 0;
      var y;

      for (y = bandTop; y < Math.min(h, bandTop + warmup); y++) {
        var initial = channels(x, y);
        bg += initial.blueGreen;
        gr += initial.greenRed;
        lum += initial.luminance;
        samples++;
      }

      bg /= samples;
      gr /= samples;
      lum /= samples;
      skyline[x] = h;
      var departureStart = -1;

      for (y = bandTop + warmup; y < h; y++) {
        var current = channels(x, y);
        var distance =
          Math.abs(current.blueGreen - bg) +
          Math.abs(current.greenRed - gr) * 0.45 +
          Math.abs(current.luminance - lum) * 0.12;
        var departing = distance > 26 || current.blueGreen < bg - 20;

        if (departing) {
          if (departureStart < 0) departureStart = y;
          if (y - departureStart + 1 >= required) {
            skyline[x] = Math.max(bandTop, departureStart);
            break;
          }
          continue;
        }

        departureStart = -1;
        bg += (current.blueGreen - bg) * tracking;
        gr += (current.greenRed - gr) * tracking;
        lum += (current.luminance - lum) * tracking;
      }
    }

    return repairSkylineCuts(medianFilterSkyline(skyline, scale), scale);
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
    bufferCtx.imageSmoothingEnabled = true;
    bufferCtx.imageSmoothingQuality = "high";
    bufferCtx.fillStyle = "#ffffff";
    bufferCtx.fillRect(0, 0, width, height);

    var portrait = cssW < cssH;
    var plateW = plate.naturalWidth;
    var plateH = plate.naturalHeight;
    var plateAspect = plateW / plateH;
    var visibleBandH = Math.round(height * (portrait ? 0.60 : 0.56));
    var overscan = Math.round(height * 0.18);
    var drawH = visibleBandH + overscan;
    var bandTop = height - visibleBandH;
    var targetAspect = width / drawH;

    var sx = 0;
    var sy = 0;
    var sw = plateW;
    var sh = plateH;
    var focus = portrait ? 0.55 : 0.52;

    if (targetAspect > plateAspect) {
      sw = plateW * 0.88;
      sx = clamp(plateW * focus - sw / 2, 0, plateW - sw);
      sh = sw / targetAspect;
      sy = Math.min(plateH - sh, plateH * 0.12);
    } else {
      sw = plateH * targetAspect;
      sx = clamp(plateW * focus - sw / 2, 0, plateW - sw);
    }

    bufferCtx.drawImage(plate, sx, sy, sw, sh, 0, bandTop, width, drawH);

    var pixels = bufferCtx.getImageData(0, 0, width, height).data;
    var luminance = new Uint8Array(width * height);

    for (var i = 0; i < luminance.length; i++) {
      var p = i * 4;
      luminance[i] = Math.round(
        pixels[p] * 0.2126 + pixels[p + 1] * 0.7152 + pixels[p + 2] * 0.0722
      );
    }

    var skyline = buildSkyline(pixels, width, height, bandTop, dpr);
    var top = height;
    var bottom = 0;

    for (i = 0; i < skyline.length; i++) {
      if (skyline[i] < top) top = skyline[i];
      if (skyline[i] > bottom && skyline[i] < height) bottom = skyline[i];
    }

    state = {
      width: width,
      height: height,
      cssWidth: cssW,
      cssHeight: cssH,
      dpr: dpr,
      skyline: skyline,
      ridgeTop: top,
      ridgeLow: bottom,
      dark: themeMedia.matches
    };

    makeTerrain(luminance, skyline);
    makeEdgeDots();
    makeClouds();
    makeStars();

    var now = performance.now();
    comet.active = false;
    comet.next = state.dark
      ? now + 70000 + hash2(width, height, 901) * 120000
      : Infinity;

    drawFrame(reducedMotion ? FIXED_TIME : now);
  }

  function makeTerrain(luminance, skyline) {
    var total = width * height;
    var paper = new Float32Array(total);
    var activeTheme = theme();
    var dark = state.dark;

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        var i = y * width + x;

        if (y < skyline[x]) {
          paper[i] = 1;
          continue;
        }

        var value = luminance[i] / 255;
        var density;

        if (dark) {
          var lit = Math.pow(smoothstep(0.07, 0.94, value), 1.34);
          density = 0.07 + 0.93 * lit;
        } else {
          var shadow = Math.pow(smoothstep(0.04, 0.82, 1 - value), 1.15);
          density = 0.025 + 0.975 * shadow;
        }

        paper[i] = 1 - clamp(density, 0, 1);
      }
    }

    var dots = atkinson(paper, skyline);
    terrainImage = ctx.createImageData(width, height);
    var output = terrainImage.data;
    var hex = activeTheme.ink.replace("#", "");
    var rgb = parseInt(hex, 16);
    var red = (rgb >> 16) & 255;
    var green = (rgb >> 8) & 255;
    var blue = rgb & 255;
    var alpha = Math.round(activeTheme.inkAlpha * 255);

    for (var index = 0; index < dots.length; index++) {
      if (!dots[index]) continue;
      var p = index * 4;
      output[p] = red;
      output[p + 1] = green;
      output[p + 2] = blue;
      output[p + 3] = alpha;
    }
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

  function makeEdgeDots() {
    edgeDots = [];
    if (!state) return;

    var reach = Math.max(7, Math.round(9 * dpr));
    var xStep = Math.max(1, Math.round(dpr * 0.55));
    var seed = width * 17 + height * 31 + 811;

    for (var x = 0; x < width; x += xStep) {
      var edge = state.skyline[x];
      if (edge >= height) continue;

      for (var distance = 1; distance <= reach; distance++) {
        var y = edge - distance;
        if (y < 0) break;

        var envelope = 1 - distance / (reach + 1);
        var keep = 0.08 + envelope * envelope * 0.25;
        if (hash2(x, y, seed) > keep) continue;

        edgeDots.push({
          x: x,
          y: y,
          envelope: envelope,
          phase: hash2(x, y, seed + 3) * 13,
          threshold: bayerThreshold(x, y),
          strength: 0.72 + hash2(x, y, seed + 7) * 0.74
        });
      }
    }
  }

  function drawEdge(now) {
    if (!edgeDots.length) return;

    var activeTheme = theme();
    var t = now * 0.000020;
    ctx.fillStyle = activeTheme.ink;

    for (var i = 0; i < edgeDots.length; i++) {
      var dot = edgeDots[i];
      var field = warpedField(
        dot.x * 0.0025,
        dot.y * 0.0028 + dot.phase,
        t,
        991
      );
      var pulse = 0.5 + 0.5 * Math.sin(dot.phase + t * 0.72 + dot.x * 0.0034);
      var density = dot.envelope * (0.16 + field * 0.64 + pulse * 0.20);

      if (density < dot.threshold * 0.70) continue;

      var lift = Math.round((field - 0.48) * dpr * 1.8);
      var alpha =
        activeTheme.edgeAlpha *
        dot.envelope *
        dot.strength *
        smoothstep(0.22, 0.80, density);

      if (alpha < 0.008) continue;

      ctx.globalAlpha = clamp(alpha, 0, 0.45);
      ctx.fillRect(dot.x, dot.y - lift, 1, 1);
    }
  }

  function findValley() {
    var start = Math.floor(width * 0.14);
    var end = Math.floor(width * 0.84);
    var step = Math.max(2, Math.floor(width / 200));
    var valleyX = start;
    var valleyY = state.ridgeTop;

    for (var x = start; x <= end; x += step) {
      if (state.skyline[x] > valleyY) {
        valleyX = x;
        valleyY = state.skyline[x];
      }
    }

    return {
      x: valleyX,
      y: valleyY,
      depth: valleyY - state.ridgeTop
    };
  }

  function makeClouds() {
    cloudDots = [];
    if (!state) return;

    var activeTheme = theme();
    var valley = findValley();
    if (valley.depth < 26 * dpr) return;

    var span = clamp(width * activeTheme.cloudSpan, 300 * dpr, 1500 * dpr);
    var cloudHeight = clamp(
      valley.depth * activeTheme.cloudHeight,
      (state.dark ? 75 : 145) * dpr,
      (state.dark ? 220 : 360) * dpr
    );

    var top = valley.y - cloudHeight;
    if (!state.dark) top -= 0.24 * cloudHeight;

    var bottom = valley.y + (state.dark ? 85 : 150) * dpr;
    var centerY = (top + bottom) * 0.5;
    var dotStep = Math.max(2, Math.round((state.dark ? 2.6 : 2.2) * dpr));
    var seed = state.dark ? 1701 : 1801;

    for (var y = top; y <= bottom; y += dotStep) {
      for (
        var x = valley.x - span * 0.5;
        x <= valley.x + span * 0.5;
        x += dotStep
      ) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        var u = (x - valley.x) / (span * 0.5);
        var v = (y - centerY) / (cloudHeight * 0.5);

        var basin = Math.exp(-(u * u * 2.4 + v * v * 4.0));
        var left = Math.exp(
          -((u + 0.48) * (u + 0.48) * 4.2 + (v + 0.02) * (v + 0.02) * 5.0)
        );
        var right = Math.exp(
          -((u - 0.47) * (u - 0.47) * 4.4 + (v + 0.05) * (v + 0.05) * 5.2)
        );
        var upper = Math.exp(
          -((u - 0.06) * (u - 0.06) * 3.1 + (v + 0.52) * (v + 0.52) * 10.0)
        );

        var shape = clamp(
          basin +
            left * 0.78 +
            right * 0.72 +
            upper * (state.dark ? 0.18 : 0.62),
          0,
          1
        );

        if (shape < 0.055) continue;

        var cellX = Math.floor(x / dotStep);
        var cellY = Math.floor(y / dotStep);
        var keep = 0.12 + shape * activeTheme.cloudDensity;

        if (hash2(cellX, cellY, seed) > keep) continue;

        cloudDots.push({
          x: x,
          y: y,
          shape: shape,
          phase: hash2(cellX, cellY, seed + 11) * 19,
          threshold: bayerThreshold(cellX, cellY)
        });
      }
    }
  }

  function drawClouds(now) {
    if (!cloudDots.length) return;

    var activeTheme = theme();
    var t = now * 0.000024;
    var swell = state.dark
      ? 0.82 + 0.18 * Math.sin(t * 0.44 + 0.8)
      : 0.72 + 0.28 * Math.sin(t * 0.36 + 0.8);

    ctx.fillStyle = activeTheme.ink;

    for (var i = 0; i < cloudDots.length; i++) {
      var dot = cloudDots[i];
      var edge = state.skyline[clamp(Math.round(dot.x), 0, width - 1)];
      var ridgeFade = smoothstep(-150 * dpr, 36 * dpr, edge - dot.y);

      var field = warpedField(
        dot.x * 0.00155 + dot.phase * 0.01,
        dot.y * 0.0019,
        t,
        state.dark ? 1201 : 1401
      );

      var localSwell = 0.88 + 0.12 * Math.sin(dot.phase + t * 0.52);
      var density = dot.shape * (0.18 + field * 0.82) * swell * localSwell;
      var thresholdScale = state.dark ? 0.64 : 0.49;

      if (density < dot.threshold * thresholdScale) continue;

      var alpha =
        activeTheme.cloudAlpha *
        ridgeFade *
        (0.34 + density * 0.76);

      if (alpha < 0.008) continue;

      ctx.globalAlpha = clamp(alpha, 0, state.dark ? 0.28 : 0.46);
      ctx.fillRect(Math.round(dot.x), Math.round(dot.y), 1, 1);
    }
  }

  function makeStars() {
    stars = [];
    starSeats = [];
    wanderers = [];

    if (!state.dark) return;

    var portrait = state.cssWidth < state.cssHeight;
    var count = portrait ? 68 : 104;
    var seatCount = count + 18;
    var horizon = Math.max(1, state.ridgeTop);
    var minDistance = Math.sqrt((width * horizon) / seatCount) * 0.20;
    var seed = Math.floor(Math.random() * 2147483647) + width + height;
    var guard = 0;

    while (starSeats.length < seatCount && guard++ < seatCount * 1600) {
      var candidateX = Math.floor(hash(seed++) * width);
      var maxY = Math.max(8 * dpr, state.skyline[candidateX] - 34 * dpr);
      if (maxY <= 8 * dpr) continue;

      var vertical = hash(seed++);
      if (hash(seed++) > 0.66) vertical *= vertical;
      var candidateY = Math.floor((0.025 + vertical * 0.94) * maxY);
      var clear = true;

      for (var i = 0; i < starSeats.length; i++) {
        var dx = starSeats[i].x - candidateX;
        var dy = starSeats[i].y - candidateY;

        if (dx * dx + dy * dy < minDistance * minDistance) {
          clear = false;
          break;
        }
      }

      if (!clear) continue;

      var classRoll = hash(seed++);
      var kind = classRoll > 0.94 ? 2 : classRoll > 0.76 ? 1 : 0;

      starSeats.push({
        x: candidateX,
        y: candidateY,
        size: kind === 2 ? Math.max(1, Math.round(dpr * 0.65)) : 1,
        phase: hash(seed++) * Math.PI * 2,
        period: 6200 + hash(seed++) * 27000,
        magnitude:
          kind === 2
            ? 0.92 + hash(seed++) * 0.08
            : kind === 1
              ? 0.62 + hash(seed++) * 0.27
              : 0.24 + hash(seed++) * 0.45,
        breathePeriod: 16000 + hash(seed++) * 62000,
        breatheOffset: hash(seed++) * 95000,
        shimmerPeriod: 2100 + hash(seed++) * 7800,
        shimmerOffset: hash(seed++) * 12000,
        flarePeriod: 24000 + hash(seed++) * 80000,
        flareOffset: hash(seed++) * 104000,
        sparkle: kind === 2 ? 1 : kind === 1 ? 0.5 : 0.12
      });
    }

    for (i = 0; i < Math.min(count, starSeats.length); i++) {
      stars.push(starSeats[i]);
    }

    for (
      i = 0;
      i < Math.min(5, Math.max(0, starSeats.length - count - 6));
      i++
    ) {
      wanderers.push({
        first: count + i,
        second: count + i + 6,
        period: 72000 + i * 28000,
        offset: 12000 + i * 23000,
        magnitude: 0.40 + i * 0.055
      });
    }
  }

  function skylineAlpha(x, y) {
    var edge = state.skyline[clamp(Math.round(x), 0, width - 1)];
    return smoothstep(0, 22 * dpr, edge - y);
  }

  function drawStar(star, now, multiplier) {
    if (!state.dark) return;

    var activeTheme = theme();
    var primary = Math.sin((now / star.period) * Math.PI * 2 + star.phase);
    var secondary = Math.sin(
      (now / (star.period * 1.73)) * Math.PI * 2 + star.phase * 1.7
    );
    var shimmer = Math.sin(
      ((now + star.shimmerOffset) / star.shimmerPeriod) * Math.PI * 2 +
        star.phase * 2.2
    );

    var twinkle =
      0.57 +
      primary * 0.18 +
      secondary * 0.10 +
      shimmer * 0.06 * star.sparkle;

    var breathe =
      0.72 +
      0.28 *
        Math.sin(
          ((now + star.breatheOffset) / star.breathePeriod) * Math.PI * 2
        );

    var flarePhase =
      (((now + star.flareOffset) % star.flarePeriod) + star.flarePeriod) %
      star.flarePeriod;
    var flarePos = flarePhase / star.flarePeriod;
    var flare = 0;

    if (star.sparkle > 0.25 && flarePos < 0.06) {
      flare =
        Math.sin((flarePos / 0.06) * Math.PI) *
        star.sparkle *
        0.52;
    }

    var alpha =
      activeTheme.starAlpha *
      star.magnitude *
      clamp(twinkle + flare, 0.10, 1.22) *
      breathe *
      multiplier *
      skylineAlpha(star.x, star.y);

    if (alpha < 0.01) return;

    ctx.fillStyle = activeTheme.star;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.fillRect(
      Math.round(star.x),
      Math.round(star.y),
      star.size,
      star.size
    );

    if (flare > 0.26 && star.sparkle > 0.65) {
      ctx.globalAlpha = clamp(alpha * flare * 0.30, 0, 0.42);
      ctx.fillRect(Math.round(star.x - dpr), Math.round(star.y), 1, 1);
      ctx.fillRect(Math.round(star.x + dpr), Math.round(star.y), 1, 1);
      ctx.fillRect(Math.round(star.x), Math.round(star.y - dpr), 1, 1);
      ctx.fillRect(Math.round(star.x), Math.round(star.y + dpr), 1, 1);
    }
  }

  function drawWanderer(wanderer, now) {
    if (!starSeats[wanderer.first] || !starSeats[wanderer.second]) return;

    var phase =
      ((((now - wanderer.offset) % wanderer.period) + wanderer.period) %
        wanderer.period) /
      wanderer.period;

    var source = starSeats[wanderer.first];
    var target = starSeats[wanderer.second];
    var chosen = source;
    var fade = 1;

    if (phase < 0.39) {
      chosen = source;
      fade = phase < 0.06 ? smoothstep(0, 0.06, phase) : 1;
    } else if (phase < 0.48) {
      chosen = source;
      fade = 1 - smoothstep(0.39, 0.48, phase);
    } else if (phase < 0.56) {
      chosen = target;
      fade = 0;
    } else if (phase < 0.65) {
      chosen = target;
      fade = smoothstep(0.56, 0.65, phase);
    } else if (phase < 0.89) {
      chosen = target;
      fade = 1;
    } else if (phase < 0.97) {
      chosen = target;
      fade = 1 - smoothstep(0.89, 0.97, phase);
    } else {
      chosen = source;
      fade = 0;
    }

    drawStar(
      {
        x: chosen.x,
        y: chosen.y,
        size: chosen.size,
        phase: chosen.phase,
        period: chosen.period * 1.2,
        magnitude: wanderer.magnitude,
        breathePeriod: chosen.breathePeriod,
        breatheOffset: chosen.breatheOffset,
        shimmerPeriod: chosen.shimmerPeriod,
        shimmerOffset: chosen.shimmerOffset,
        flarePeriod: chosen.flarePeriod,
        flareOffset: chosen.flareOffset,
        sparkle: chosen.sparkle * 0.72
      },
      now,
      fade
    );
  }

  function scheduleComet(now) {
    if (!state.dark) return;

    var seed = Math.floor(now / 1000) + width * 3 + height * 5;
    var leftToRight = hash(seed) > 0.5;
    var startX = (0.12 + hash(seed + 1) * 0.74) * width;
    var startY = (0.07 + hash(seed + 2) * 0.28) * state.ridgeTop;
    var deltaX =
      (0.10 + hash(seed + 3) * 0.18) *
      width *
      (leftToRight ? 1 : -1);

    comet.active = true;
    comet.start = now;
    comet.duration = 1500 + hash(seed + 4) * 1400;
    comet.x0 = startX;
    comet.y0 = startY;
    comet.x1 = startX + deltaX;
    comet.y1 =
      startY +
      (0.08 + hash(seed + 5) * 0.13) *
        state.ridgeTop;
    comet.tail = (0.020 + hash(seed + 6) * 0.026) * width;
    comet.next =
      now +
      comet.duration +
      100000 +
      hash(seed + 7) * 220000;
  }

  function drawComet(now) {
    if (!state.dark || !comet.active) return;

    var progress = (now - comet.start) / comet.duration;

    if (progress >= 1) {
      comet.active = false;
      return;
    }

    if (progress < 0) return;

    var fade =
      smoothstep(0, 0.12, progress) *
      (1 - smoothstep(0.70, 1, progress));

    var x = lerp(comet.x0, comet.x1, progress);
    var y = lerp(comet.y0, comet.y1, progress);
    var dx = comet.x1 - comet.x0;
    var dy = comet.y1 - comet.y0;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;

    dx /= len;
    dy /= len;

    var activeTheme = theme();
    ctx.fillStyle = activeTheme.star;

    for (
      var step = comet.tail;
      step > 0;
      step -= Math.max(1, dpr * 0.75)
    ) {
      var tx = Math.round(x - dx * step);
      var ty = Math.round(y - dy * step);

      if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
      if (ty >= state.skyline[tx] - 10 * dpr) continue;

      var alpha =
        fade *
        Math.pow(1 - step / comet.tail, 1.42) *
        activeTheme.starAlpha *
        0.80;

      if (alpha < 0.01) continue;

      ctx.globalAlpha = alpha;
      ctx.fillRect(tx, ty, 1, 1);
    }

    var headX = clamp(Math.round(x), 0, width - 1);

    if (y < state.skyline[headX] - 14 * dpr) {
      ctx.globalAlpha = clamp(
        fade * activeTheme.starAlpha * 1.18,
        0,
        1
      );
      ctx.fillRect(
        headX,
        Math.round(y),
        Math.max(1, Math.round(dpr * 0.55)),
        Math.max(1, Math.round(dpr * 0.55))
      );
    }
  }

  function drawFrame(now) {
    if (!state || !terrainImage) return;

    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(terrainImage, 0, 0);

    drawEdge(now);
    drawClouds(now);

    for (var i = 0; i < stars.length; i++) {
      drawStar(stars[i], now, 1);
    }

    for (i = 0; i < wanderers.length; i++) {
      drawWanderer(wanderers[i], now);
    }

    drawComet(now);
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    rafId = window.requestAnimationFrame(tick);

    if (!state || reducedMotion || !visible) return;
    if (now - lastDraw < 1000 / 30) return;

    lastDraw = now;

    if (state.dark && !comet.active && now >= comet.next) {
      scheduleComet(now);
    }

    drawFrame(now);
  }

  function build() {
    if (!plate.complete || !plate.naturalWidth) return;

    window.cancelAnimationFrame(rafId);
    rafId = 0;

    layoutPlate();

    if (!reducedMotion) {
      rafId = window.requestAnimationFrame(tick);
    }
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

    if (visible && !reducedMotion && !rafId) {
      rafId = window.requestAnimationFrame(tick);
    }
  });

  window.__portfolioSky = {
    build: build,
    stop: function () {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    },
    start: function () {
      if (!reducedMotion && !rafId) {
        rafId = window.requestAnimationFrame(tick);
      }
    },
    cometNow: function (now) {
      var time =
        reducedMotion
          ? FIXED_TIME
          : now == null
            ? performance.now()
            : now;

      if (state && state.dark) scheduleComet(time);
      drawFrame(time);
    },
    step: function (now) {
      drawFrame(
        reducedMotion
          ? FIXED_TIME
          : now == null
            ? performance.now()
            : now
      );
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
        comet: {
          active: comet.active,
          next: comet.next
        },
        motion: {
          reduced: reducedMotion,
          visible: visible,
          rafActive: !!rafId
        }
      };
    }
  };

  plate.decoding = "async";
  plate.onload = build;
  plate.onerror = function () {
    document.documentElement.setAttribute("data-plate-error", "1");
  };
  plate.src = SOURCE;
})();
