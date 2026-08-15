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

  var state = null;
  var terrainImage = null;
  var edgeMotes = [];
  var stars = [];
  var wanderers = [];
  var seats = [];
  var cloud = { dots: [], valleyX: 0, valleyY: 0, top: 0, bottom: 0 };
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
  var visible = true;
  var reducedMotion = motionMedia.matches;
  var activeWork = null;

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
    inkAlpha: 0.90,
    edgeAlpha: 0.19,
    star: "#e8dfd0",
    starAlpha: 0.72,
    cloudAlpha: 0.24
  };

  var LIGHT = {
    ink: "#293039",
    inkAlpha: 0.87,
    edgeAlpha: 0.11,
    star: "#293039",
    starAlpha: 0,
    cloudAlpha: 0.15
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

    for (var octave = 0; octave < 3; octave++) {
      value += valueNoise(x * frequency, y * frequency, seed + octave * 97) * amplitude;
      frequency *= 2.03;
      amplitude *= 0.48;
    }

    return value / 0.998;
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

  function buildSkyline(pixels, w, h, bandTop, scale) {
    var skyline = new Int32Array(w);
    var warmup = Math.max(6, Math.round(8 * scale));
    var required = Math.max(2, Math.round(2 * scale));
    var tracking = 1 / Math.max(12, Math.round(18 * scale));

    function channels(x, y) {
      var pixel = (y * w + x) * 4;
      var red = pixels[pixel];
      var green = pixels[pixel + 1];
      var blue = pixels[pixel + 2];
      return {
        blueGreen: blue - green,
        greenRed: green - red,
        luminance: red * 0.2126 + green * 0.7152 + blue * 0.0722
      };
    }

    for (var x = 0; x < w; x++) {
      var referenceBlueGreen = 0;
      var referenceGreenRed = 0;
      var referenceLuminance = 0;
      var samples = 0;
      var y;

      for (y = bandTop; y < Math.min(h, bandTop + warmup); y++) {
        var initial = channels(x, y);
        referenceBlueGreen += initial.blueGreen;
        referenceGreenRed += initial.greenRed;
        referenceLuminance += initial.luminance;
        samples++;
      }

      referenceBlueGreen /= samples;
      referenceGreenRed /= samples;
      referenceLuminance /= samples;

      skyline[x] = h;
      var departureStart = -1;

      for (y = bandTop + warmup; y < h; y++) {
        var current = channels(x, y);
        var distance =
          Math.abs(current.blueGreen - referenceBlueGreen) +
          Math.abs(current.greenRed - referenceGreenRed) * 0.45 +
          Math.abs(current.luminance - referenceLuminance) * 0.12;
        var departing = distance > 26 || current.blueGreen < referenceBlueGreen - 20;

        if (departing) {
          if (departureStart < 0) departureStart = y;
          if (y - departureStart + 1 >= required) {
            skyline[x] = Math.max(bandTop, departureStart);
            break;
          }
          continue;
        }

        departureStart = -1;
        referenceBlueGreen += (current.blueGreen - referenceBlueGreen) * tracking;
        referenceGreenRed += (current.greenRed - referenceGreenRed) * tracking;
        referenceLuminance += (current.luminance - referenceLuminance) * tracking;
      }
    }

    var radius = Math.max(3, Math.round(4 * scale));
    var clean = new Int32Array(w);

    for (x = 0; x < w; x++) {
      var values = [];
      for (
        var neighbor = Math.max(0, x - radius);
        neighbor <= Math.min(w - 1, x + radius);
        neighbor++
      ) {
        values.push(skyline[neighbor]);
      }
      values.sort(function (a, b) { return a - b; });
      clean[x] = values[Math.floor(values.length / 2)];
    }

    var smoothRadius = Math.max(4, Math.round(6 * scale));
    var smoothed = new Int32Array(w);

    for (x = 0; x < w; x++) {
      var sum = 0;
      var weightSum = 0;
      for (var dx = -smoothRadius; dx <= smoothRadius; dx++) {
        var nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        var weight = smoothRadius + 1 - Math.abs(dx);
        sum += clean[nx] * weight;
        weightSum += weight;
      }
      smoothed[x] = Math.round(sum / weightSum);
    }

    return smoothed;
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
    var visibleBandH = Math.round(height * (portrait ? 0.58 : 0.53));
    var overscan = Math.round(height * 0.16);
    var drawH = visibleBandH + overscan;
    var bandTop = height - visibleBandH;
    var targetAspect = width / drawH;

    var sx = 0;
    var sy = 0;
    var sw = plateW;
    var sh = plateH;
    var focus = portrait ? 0.55 : 0.52;

    if (targetAspect > plateAspect) {
      sw = plateW * 0.86;
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
      var pixel = i * 4;
      luminance[i] = Math.round(
        pixels[pixel] * 0.2126 +
        pixels[pixel + 1] * 0.7152 +
        pixels[pixel + 2] * 0.0722
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
    makeEdgeMotes();
    makeStars();
    makeCloud();

    var now = performance.now();
    comet.active = false;
    comet.next = state.dark
      ? now + 105000 + hash2(width, height, 901) * 190000
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
          var lit = Math.pow(smoothstep(0.08, 0.92, value), 1.42);
          density = 0.08 + 0.92 * lit;
        } else {
          var shadow = Math.pow(smoothstep(0.04, 0.80, 1 - value), 1.18);
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
    var edgeFadeDepth = Math.max(3, Math.round(5.5 * dpr));

    for (var index = 0; index < dots.length; index++) {
      if (!dots[index]) continue;

      var py = Math.floor(index / width);
      var px = index - py * width;
      var depth = py - skyline[px];
      var edgeFade = smoothstep(0, edgeFadeDepth, depth);
      var alpha = activeTheme.inkAlpha * (0.26 + 0.74 * edgeFade);

      var p = index * 4;
      output[p] = red;
      output[p + 1] = green;
      output[p + 2] = blue;
      output[p + 3] = Math.round(alpha * 255);
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

  function makeEdgeMotes() {
    edgeMotes = [];
    if (!state) return;

    var reach = Math.max(6, Math.round(8 * dpr));
    var seed = width * 17 + height * 31 + 811;
    var xStep = Math.max(1, Math.round(dpr * 0.66));

    for (var x = 0; x < width; x += xStep) {
      var edge = state.skyline[x];
      if (edge >= height) continue;

      for (var distance = 1; distance <= reach; distance++) {
        var y = edge - distance;
        if (y < 0) break;

        var envelope = 1 - distance / (reach + 1);
        var keep = 0.055 + envelope * envelope * 0.16;
        if (hash2(x, y, seed) > keep) continue;

        edgeMotes.push({
          x: x,
          y: y,
          envelope: envelope,
          phase: hash2(x, y, seed + 3) * 11,
          scale: 0.8 + hash2(x, y, seed + 7) * 0.7,
          threshold: bayerThreshold(x, y)
        });
      }
    }
  }

  function drawEdgeMotes(now) {
    if (!edgeMotes.length) return;

    var activeTheme = theme();
    var time = now * 0.000014;
    ctx.fillStyle = activeTheme.ink;

    for (var i = 0; i < edgeMotes.length; i++) {
      var dot = edgeMotes[i];

      /*
       * React Bits' Dither feels alive because a slow noise field moves under a
       * fixed Bayer grid. Do the same thing only in the few pixels above the
       * ridge: the photograph and terrain plate never move.
       */
      var field = fbm(
        dot.x * 0.0024 + time * 0.72,
        dot.y * 0.0028 - time * 0.43 + dot.phase,
        991
      );
      var wave = 0.55 * field + 0.45 * (
        0.5 + 0.5 * Math.sin(
          dot.x * 0.0046 +
          dot.y * 0.0032 +
          dot.phase +
          time * 1.18
        )
      );

      var density = dot.envelope * (0.34 + wave * 0.50);
      if (density < dot.threshold * 0.72) continue;

      var drift = Math.round((wave - 0.5) * dpr * 1.35);
      var alpha =
        activeTheme.edgeAlpha *
        dot.envelope *
        dot.scale *
        smoothstep(0.28, 0.78, density);

      if (alpha < 0.008) continue;

      ctx.globalAlpha = clamp(alpha, 0, 0.34);
      ctx.fillRect(dot.x, dot.y - drift, 1, 1);
    }
  }

  function makeStars() {
    stars = [];
    seats = [];
    wanderers = [];

    if (!state.dark) return;

    var portrait = state.cssWidth < state.cssHeight;
    var count = portrait ? 18 : 24;
    var seatCount = count + 6;
    var horizon = Math.max(1, state.ridgeTop);
    var minDistance = Math.sqrt((width * horizon) / seatCount) * 0.5;
    var seed = Math.floor(Math.random() * 2147483647) + width + height;
    var guard = 0;

    while (seats.length < seatCount && guard++ < seatCount * 900) {
      var candidateX = Math.floor(hash(seed++) * width);
      var maxY = Math.max(8 * dpr, state.skyline[candidateX] - 34 * dpr);
      if (maxY <= 8 * dpr) continue;

      var candidateY = Math.floor((0.04 + hash(seed++) * 0.90) * maxY);
      var clear = true;

      for (var i = 0; i < seats.length; i++) {
        var dx = seats[i].x - candidateX;
        var dy = seats[i].y - candidateY;
        if (dx * dx + dy * dy < minDistance * minDistance) {
          clear = false;
          break;
        }
      }

      if (!clear) continue;

      var bright = hash(seed++) > 0.86;
      seats.push({
        x: candidateX,
        y: candidateY,
        size: 1,
        phase: hash(seed++) * Math.PI * 2,
        period: 22000 + hash(seed++) * 36000,
        magnitude: bright ? 0.75 + hash(seed++) * 0.16 : 0.34 + hash(seed++) * 0.30,
        breathePeriod: 44000 + hash(seed++) * 62000,
        breatheOffset: hash(seed++) * 100000
      });
    }

    for (i = 0; i < Math.min(count, seats.length); i++) {
      stars.push(seats[i]);
    }

    for (i = 0; i < Math.min(2, Math.max(0, seats.length - count - 1)); i++) {
      wanderers.push({
        first: count + i,
        second: count + i + 2,
        period: 98000 + i * 47000,
        offset: 21000 + i * 41000,
        magnitude: 0.50 + i * 0.07
      });
    }
  }

  function makeCloud() {
    cloud = { dots: [], valleyX: 0, valleyY: 0, top: 0, bottom: 0 };
    if (!state) return;

    var searchStart = Math.floor(width * 0.18);
    var searchEnd = Math.floor(width * 0.78);
    var sampleStep = Math.max(2, Math.floor(width / 180));
    var valleyX = searchStart;
    var valleyY = state.ridgeTop;

    for (var x = searchStart; x <= searchEnd; x += sampleStep) {
      if (state.skyline[x] > valleyY) {
        valleyX = x;
        valleyY = state.skyline[x];
      }
    }

    var depth = valleyY - state.ridgeTop;
    if (depth < 30 * dpr) return;

    var span = clamp(width * 0.62, 250 * dpr, 1050 * dpr);
    var cloudHeight = clamp(depth * 0.92, 90 * dpr, 230 * dpr);
    var top = Math.min(valleyY - cloudHeight, state.ridgeTop - 22 * dpr);
    var bottom = valleyY + 90 * dpr;
    var centerY = (top + bottom) * 0.5;
    var step = Math.max(2, Math.round(2.4 * dpr));

    cloud.valleyX = valleyX;
    cloud.valleyY = valleyY;
    cloud.top = top;
    cloud.bottom = bottom;

    for (var y = top; y <= bottom; y += step) {
      for (x = valleyX - span * 0.5; x <= valleyX + span * 0.5; x += step) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        var u = (x - valleyX) / (span * 0.5);
        var v = (y - centerY) / (cloudHeight * 0.5);

        var left = Math.exp(-((u + 0.46) * (u + 0.46) * 5.2) - ((v + 0.02) * (v + 0.02) * 6.2));
        var center = Math.exp(-((u + 0.02) * (u + 0.02) * 4.8) - ((v - 0.08) * (v - 0.08) * 5.6));
        var right = Math.exp(-((u - 0.43) * (u - 0.43) * 5.4) - ((v + 0.06) * (v + 0.06) * 6.0));
        var shape = clamp(left * 0.82 + center + right * 0.76, 0, 1);

        if (shape < 0.08) continue;

        var cellX = Math.floor(x / step);
        var cellY = Math.floor(y / step);
        if (hash2(cellX, cellY, 733) > 0.30 + shape * 0.42) continue;

        cloud.dots.push({
          x: x,
          y: y,
          alpha: 0.22 + shape * 0.58,
          phase: hash2(cellX, cellY, 739) * Math.PI * 2,
          threshold: bayerThreshold(cellX, cellY)
        });
      }
    }
  }

  function skylineAlpha(x, y) {
    var edge = state.skyline[clamp(Math.round(x), 0, width - 1)];
    return smoothstep(0, 26 * dpr, edge - y);
  }

  function drawCloud(now) {
    if (!cloud.dots.length) return;

    var activeTheme = theme();
    var t = now * 0.000022;
    var breath = 0.78 + 0.22 * Math.sin(t * 0.62 + 0.8);

    ctx.fillStyle = activeTheme.ink;

    for (var i = 0; i < cloud.dots.length; i++) {
      var dot = cloud.dots[i];
      var edge = state.skyline[clamp(Math.round(dot.x), 0, width - 1)];

      var ridgeFade = smoothstep(-110 * dpr, 28 * dpr, edge - dot.y);
      var wave = fbm(
        dot.x * 0.0022 + t * 0.25,
        dot.y * 0.0028 - t * 0.17 + dot.phase,
        1201
      );
      var density = clamp(0.22 + wave * 0.78, 0, 1);

      if (density < dot.threshold * 0.62) continue;

      var alpha =
        activeTheme.cloudAlpha *
        dot.alpha *
        ridgeFade *
        breath *
        (0.42 + density * 0.58);

      if (alpha < 0.008) continue;

      ctx.globalAlpha = alpha;
      ctx.fillRect(Math.round(dot.x), Math.round(dot.y), 1, 1);
    }
  }

  function drawStar(star, now, multiplier) {
    var activeTheme = theme();
    if (!state.dark || activeTheme.starAlpha <= 0) return;

    var primary = Math.sin((now / star.period) * Math.PI * 2 + star.phase);
    var secondary = Math.sin((now / (star.period * 1.83)) * Math.PI * 2 + star.phase * 1.7);
    var twinkle = 0.62 + primary * 0.13 + secondary * 0.05;

    var breathe =
      0.82 +
      0.18 *
        Math.sin(
          ((now + star.breatheOffset) / star.breathePeriod) * Math.PI * 2
        );

    var alpha =
      activeTheme.starAlpha *
      star.magnitude *
      clamp(twinkle, 0.34, 0.88) *
      breathe *
      multiplier *
      skylineAlpha(star.x, star.y);

    if (alpha < 0.01) return;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = activeTheme.star;
    ctx.fillRect(Math.round(star.x), Math.round(star.y), star.size, star.size);
  }

  function drawWanderer(wanderer, now) {
    if (!seats[wanderer.first] || !seats[wanderer.second]) return;

    var elapsed =
      ((now - wanderer.offset) % wanderer.period + wanderer.period) %
      wanderer.period;
    var phase = elapsed / wanderer.period;

    var source = seats[wanderer.first];
    var target = seats[wanderer.second];
    var chosen = source;
    var fade = 1;

    if (phase < 0.06) {
      chosen = source;
      fade = smoothstep(0, 0.06, phase);
    } else if (phase < 0.42) {
      chosen = source;
      fade = 1;
    } else if (phase < 0.50) {
      chosen = source;
      fade = 1 - smoothstep(0.42, 0.50, phase);
    } else if (phase < 0.56) {
      chosen = target;
      fade = 0;
    } else if (phase < 0.64) {
      chosen = target;
      fade = smoothstep(0.56, 0.64, phase);
    } else if (phase < 0.88) {
      chosen = target;
      fade = 1;
    } else if (phase < 0.96) {
      chosen = target;
      fade = 1 - smoothstep(0.88, 0.96, phase);
    } else {
      chosen = source;
      fade = 0;
    }

    drawStar(
      {
        x: chosen.x,
        y: chosen.y,
        size: 1,
        phase: chosen.phase,
        period: chosen.period * 1.2,
        magnitude: wanderer.magnitude,
        breathePeriod: chosen.breathePeriod,
        breatheOffset: chosen.breatheOffset
      },
      now,
      fade
    );
  }

  function scheduleComet(now) {
    if (!state.dark) return;

    var seed = Math.floor(now / 1000) + width * 3 + height * 5;
    var leftToRight = hash(seed) > 0.5;

    var startX = (0.18 + hash(seed + 1) * 0.62) * width;
    var startY = (0.10 + hash(seed + 2) * 0.24) * state.ridgeTop;
    var deltaX = (0.09 + hash(seed + 3) * 0.13) * width * (leftToRight ? 1 : -1);

    comet.active = true;
    comet.start = now;
    comet.duration = 1700 + hash(seed + 4) * 1400;
    comet.x0 = startX;
    comet.y0 = startY;
    comet.x1 = startX + deltaX;
    comet.y1 = startY + (0.10 + hash(seed + 5) * 0.10) * state.ridgeTop;
    comet.tail = (0.018 + hash(seed + 6) * 0.018) * width;
    comet.next = now + comet.duration + 150000 + hash(seed + 7) * 270000;
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
      smoothstep(0, 0.14, progress) *
      (1 - smoothstep(0.68, 1, progress));

    var x = lerp(comet.x0, comet.x1, progress);
    var y = lerp(comet.y0, comet.y1, progress);
    var directionX = comet.x1 - comet.x0;
    var directionY = comet.y1 - comet.y0;
    var distance = Math.sqrt(directionX * directionX + directionY * directionY) || 1;

    directionX /= distance;
    directionY /= distance;

    var activeTheme = theme();
    ctx.fillStyle = activeTheme.star;

    for (
      var step = comet.tail;
      step > 0;
      step -= Math.max(1, dpr * 0.8)
    ) {
      var tx = Math.round(x - directionX * step);
      var ty = Math.round(y - directionY * step);

      if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;
      if (ty >= state.skyline[tx] - 10 * dpr) continue;

      var tailAlpha =
        fade *
        Math.pow(1 - step / comet.tail, 1.5) *
        activeTheme.starAlpha *
        0.68;

      if (tailAlpha < 0.01) continue;

      ctx.globalAlpha = tailAlpha;
      ctx.fillRect(tx, ty, 1, 1);
    }

    var headX = clamp(Math.round(x), 0, width - 1);
    if (y < state.skyline[headX] - 14 * dpr) {
      ctx.globalAlpha = clamp(fade * activeTheme.starAlpha * 1.08, 0, 1);
      ctx.fillRect(headX, Math.round(y), 1, 1);
    }
  }

  function drawFrame(now) {
    if (!state || !terrainImage) return;

    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(terrainImage, 0, 0);

    drawEdgeMotes(now);
    drawCloud(now);

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
    if (now - lastDraw < 1000 / 24) return;

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
      var time = reducedMotion ? FIXED_TIME : (now == null ? performance.now() : now);
      if (state && state.dark) scheduleComet(time);
      drawFrame(time);
    },
    step: function (now) {
      var time = reducedMotion ? FIXED_TIME : (now == null ? performance.now() : now);
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
        edgeMotes: edgeMotes.length,
        stars: stars.length,
        wanderers: wanderers.length,
        cloudDots: cloud.dots.length,
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
