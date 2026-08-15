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
  var state = null;
  var terrainImage = null;
  var stars = [];
  var wanderers = [];
  var seats = [];
  var dpr = 1;
  var width = 0;
  var height = 0;
  var resizeTimer = 0;
  var rafId = 0;
  var lastDraw = 0;
  var visible = true;
  var reducedMotion = motionMedia.matches;
  var comet = { active: false, start: 0, duration: 0, next: 0, x0: 0, y0: 0, x1: 0, y1: 0, tail: 0 };
  var cloud = { dots: [], valleyX: 0, valleyY: 0, top: 0, bottom: 0 };
  var supernova = { active: false, start: 0, duration: 0, next: 0, x: 0, y: 0, radius: 0 };
  var satellite = { active: false, start: 0, duration: 0, next: 0, x0: 0, y0: 0, x1: 0, y1: 0, brightness: 0 };

  var DARK = {
    ink: "#e5dccb",
    inkAlpha: 0.91,
    star: "#e5dccb",
    starAlpha: 0.92,
    cloudAlpha: 0.46
  };
  var LIGHT = {
    ink: "#29303a",
    inkAlpha: 0.88,
    star: "#29303a",
    starAlpha: 0.74,
    cloudAlpha: 0.36
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

  function inkRgb() {
    return themeMedia.matches ? DARK : LIGHT;
  }

  function listenMedia(media, callback) {
    if (media.addEventListener) media.addEventListener("change", callback);
    else media.addListener(callback);
  }

  /* Each rendered column has one useful guarantee: open sky comes first, and
     everything after the first sustained departure from that sky is terrain.
     Tracking the sky per column preserves bright snow after the handoff. A
     flood mask cannot make that distinction because snow can be connected to
     the sky and still pass the same brightness test. */
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

    /* A JPEG speck or a bright snow notch can create a false departure in one
       or two columns. A local median removes those needle-like towers while
       retaining peaks that occupy a real run of neighboring columns. */
    var radius = Math.max(3, Math.round(4 * scale));
    var clean = new Int32Array(w);
    for (x = 0; x < w; x++) {
      var values = [];
      for (var neighbor = Math.max(0, x - radius); neighbor <= Math.min(w - 1, x + radius); neighbor++) {
        values.push(skyline[neighbor]);
      }
      values.sort(function (a, b) { return a - b; });
      clean[x] = values[Math.floor(values.length / 2)];
    }

    /* The median removes single-column spikes, but adjacent columns can still
       differ by tens of pixels when one detects a cloud edge and the next
       detects the ridge behind it. Those jumps produce vertical rectangular
       notches in the silhouette. A narrow triangular-weighted blur softens
       them without rounding genuine peaks, which occupy enough neighboring
       columns to survive. */
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

    var plateW = plate.naturalWidth;
    var plateH = plate.naturalHeight;
    var plateAspect = plateW / plateH;
    var visibleBandH = Math.round(height * (cssW < cssH ? 0.62 : 0.60));
    var overscan = Math.round(height * 0.18);
    var drawH = visibleBandH + overscan;
    var bandTop = height - visibleBandH;
    var targetAspect = width / drawH;
    var sx = 0;
    var sy = 0;
    var sw = plateW;
    var sh = plateH;
    var focus = cssW < cssH ? 0.55 : 0.52;

    if (targetAspect > plateAspect) {
      /* The source has dark approach slopes entering from both side edges.
         Keep a little of the photographic breathing room out of the wide
         crop so those slopes do not become vertical dither slabs at the
         viewport edges. The central chain still spans the full backdrop. */
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
    var i;

    for (i = 0; i < luminance.length; i++) {
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
    makeStars();
    makeCloud();
    comet.active = false;
    comet.next = performance.now() + 12000 + hash2(width, height, 901) * 38000;
    supernova.active = false;
    supernova.next = performance.now() + 45000 + hash2(width, height, 902) * 120000;
    satellite.active = false;
    satellite.next = performance.now() + 25000 + hash2(width, height, 903) * 60000;
    drawFrame(reducedMotion ? 12345 : performance.now());
  }

  function landAt(x, y) {
    return y >= state.skyline[clamp(x | 0, 0, width - 1)];
  }

  function makeTerrain(luminance, skyline) {
    var total = width * height;
    var paper = new Float32Array(total);
    var theme = inkRgb();
    var dark = state.dark;
    var i;
    var x;
    var y;

    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
        if (y < skyline[x]) {
          paper[i] = 1;
          continue;
        }
        var value = luminance[i] / 255;
        var density;
        if (dark) {
          var lit = Math.pow(smoothstep(0.08, 0.92, value), 1.38);
          density = 0.105 + 0.895 * lit;
        } else {
          var shadow = Math.pow(smoothstep(0.04, 0.78, 1 - value), 1.15);
          density = 0.035 + 0.965 * shadow;
        }
        paper[i] = 1 - clamp(density, 0, 1);
      }
    }

    var dots = atkinsonWithBuffer(paper, skyline);
    terrainImage = ctx.createImageData(width, height);
    var output = terrainImage.data;
    var alpha = Math.round(theme.inkAlpha * 255);
    var hex = theme.ink.replace("#", "");
    var rgb = parseInt(hex, 16);
    var red = (rgb >> 16) & 255;
    var green = (rgb >> 8) & 255;
    var blue = rgb & 255;

    for (i = 0; i < dots.length; i++) {
      if (!dots[i]) continue;
      var p = i * 4;
      output[p] = red;
      output[p + 1] = green;
      output[p + 2] = blue;
      output[p + 3] = alpha;
    }
  }

  function diffuse(x, y, error, skyline) {
    if (x < 0 || y < 0 || x >= width || y >= height || y < skyline[x]) return;
    var index = y * width + x;
    activeWork[index] += error;
  }

  var activeWork = null;

  function atkinsonWithBuffer(paper, skyline) {
    activeWork = new Float32Array(paper);
    var dots = new Uint8Array(width * height);
    var x;
    var y;
    var i;

    for (y = 0; y < height; y++) {
      for (x = 0; x < width; x++) {
        i = y * width + x;
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

  function makeStars() {
    stars = [];
    wanderers = [];
    seats = [];
    var count = state.dark ? 64 : 44;
    var seatCount = count + 16;
    var horizon = Math.max(1, state.ridgeTop);
    var minDistance = Math.sqrt((width * horizon) / seatCount) * 0.36;
    /* Give each visit a new sky, while the seats remain fixed for the life of
       that scene so stars can twinkle instead of jumping every frame. */
    var seed = Math.floor(Math.random() * 2147483647) + width + height;
    var guard = 0;

    while (seats.length < seatCount && guard++ < seatCount * 700) {
      var candidateX = Math.floor(hash(seed++) * width);
      var maxY = Math.max(8 * dpr, state.skyline[candidateX] - 26 * dpr);
      if (maxY <= 6 * dpr) continue;
      var candidateY = Math.floor(hash(seed++) * maxY);
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
      seats.push({
        x: candidateX,
        y: candidateY,
        size: hash(seed++) > 0.90 ? 3 : hash(seed++) > 0.72 ? 2 : 1,
        phase: hash(seed++) * Math.PI * 2,
        rate: 0.0008 + hash(seed++) * 0.0022,
        magnitude: 0.42 + hash(seed++) * 0.58,
        /* Each star has a slow visibility cycle. For most of the cycle the
           star is visible, but it periodically dims slightly and returns.
           With 2x stars, at any moment some are in their dim phase while
           others are bright — the sky shimmers. */
        visPeriod: 10000 + hash(seed++) * 20000,
        visOffset: hash(seed++) * 99999,
        visDepth: 0.15 + hash(seed++) * 0.35
      });
    }

    for (i = 0; i < Math.min(count, seats.length); i++) stars.push(seats[i]);

    var periods = [38000, 52000, 72000, 98000];
    for (i = 0; i < Math.min(4, Math.max(0, seats.length - count)); i++) {
      wanderers.push({
        period: periods[i],
        offset: i * 15000 + 9000,
        first: count + i,
        second: count + i + 2,
        size: 2,
        magnitude: 0.85
      });
    }
  }

  /* A small veil belongs in the basin, not across the whole sky. It is made
     from fixed one-pixel seats with a slow density field moving through them.
     That keeps the dither anchored and lets the cloud change shape without
     boiling like a re-dithered photograph. */
  function makeCloud() {
    cloud = { dots: [], valleyX: 0, valleyY: 0, top: 0, bottom: 0 };
    if (!state) return;

    var searchStart = Math.floor(width * 0.18);
    var searchEnd = Math.floor(width * 0.72);
    var sampleStep = Math.max(2, Math.floor(width / 180));
    var valleyX = searchStart;
    var valleyY = state.ridgeTop;
    var x;

    for (x = searchStart; x <= searchEnd; x += sampleStep) {
      if (state.skyline[x] > valleyY) {
        valleyX = x;
        valleyY = state.skyline[x];
      }
    }

    var depth = valleyY - state.ridgeTop;
    if (depth < 34 * dpr) return;

    /* This is a weather system, not a small valley puff. It stretches beyond
       the basin and rises across nearby shoulders so rough distant ridges can
       disappear into fog instead of cutting a hard silhouette. */
    var span = clamp(width * 0.72, 300 * dpr, 1100 * dpr);
    var cloudHeight = clamp(depth * 1.15, 120 * dpr, 290 * dpr);
    var top = Math.min(valleyY - cloudHeight, state.ridgeTop - 34 * dpr);
    var bottom = valleyY + 150 * dpr;
    var step = Math.max(2, Math.round(2.2 * dpr));
    var centerY = (top + bottom) * 0.5;
    var y;

    cloud.valleyX = valleyX;
    cloud.valleyY = valleyY;
    cloud.top = top;
    cloud.bottom = bottom;

    for (y = top; y <= bottom; y += step) {
      for (x = valleyX - span * 0.5; x <= valleyX + span * 0.5; x += step) {
        if (x < 0 || x >= width) continue;
        var u = (x - valleyX) / (span * 0.5);
        var v = (y - centerY) / (cloudHeight * 0.5);
        var leftWisp = Math.exp(-((u + 0.54) * (u + 0.54) * 4.2) - ((v + 0.10) * (v + 0.10) * 5.2)) * 0.92;
        var middleWisp = Math.exp(-((u + 0.04) * (u + 0.04) * 5.1) - ((v - 0.08) * (v - 0.08) * 6.1)) * 0.86;
        var rightWisp = Math.exp(-((u - 0.48) * (u - 0.48) * 4.1) - ((v + 0.02) * (v + 0.02) * 5.0)) * 0.80;
        var highWisp = Math.exp(-((u - 0.22) * (u - 0.22) * 7.0) - ((v + 0.58) * (v + 0.58) * 8.0)) * 0.55;
        var shape = clamp(leftWisp + middleWisp + rightWisp + highWisp, 0, 1);
        var cellX = Math.floor(x / step);
        var cellY = Math.floor(y / step);
        var keep = 0.22 + shape * 0.60;
        if (shape < 0.08 || hash2(cellX, cellY, 733) > keep) continue;
        cloud.dots.push({
          x: x,
          y: y,
          alpha: 0.22 + shape * 0.62,
          phase: hash2(cellX, cellY, 739) * Math.PI * 2
        });
      }
    }
  }

  function drawCloud(now) {
    if (!cloud.dots.length) return;
    var theme = inkRgb();
    var cycle = now * 0.00024;
    var driftX = Math.sin(cycle) * 34 * dpr + Math.sin(cycle * 0.43) * 13 * dpr;
    var driftY = Math.sin(cycle * 0.71 + 1.2) * 11 * dpr;
    var breath = 0.72 + 0.28 * Math.sin(cycle * 0.43);

    ctx.fillStyle = theme.ink;
    for (var i = 0; i < cloud.dots.length; i++) {
      var dot = cloud.dots[i];
      /* Keep the dot seats fixed. The slow field moves through them, which
         gives the veil drift without making individual one-pixel dots jump
         from column to column. */
      var x = dot.x;
      var y = dot.y;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      var edge = state.skyline[x];
      /* Let the veil cross the skyline and settle over the mountain face. */
      var groundFade = smoothstep(-150 * dpr, 34 * dpr, edge - y);
      var flow = 0.48 + 0.52 * Math.sin((x - driftX) * 0.031 + (y - driftY) * 0.021 + dot.phase);
      var pulse = 0.74 + 0.26 * Math.sin(cycle * 0.86 + dot.phase);
      var alpha = theme.cloudAlpha * dot.alpha * groundFade * flow * pulse * breath;
      if (alpha < 0.01) continue;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x, y, 1, 1);
    }
  }

  function skylineAlpha(star) {
    var edge = state.skyline[clamp(Math.round(star.x), 0, width - 1)];
    var distance = edge - star.y;
    return smoothstep(0, 20 * dpr, distance);
  }

  function drawStar(star, now, alphaMultiplier) {
    var theme = inkRgb();
    var twinkle = 1;
    if (star.rate) {
      var slow = Math.sin(now * star.rate + star.phase);
      var fast = Math.sin(now * star.rate * 3.3 + star.phase * 2.1);
      var envelope = Math.sin(now * star.rate * 0.13 + star.phase * 3.7);
      var flare = Math.pow(Math.max(0, envelope), 4);
      twinkle = 0.60 + 0.24 * slow + 0.12 * fast + 0.55 * flare;
    }
    /* Slow visibility cycle: the star dims and brightens over 8-24 seconds.
       At any given time, a fraction of the 2x stars are in their dim phase,
       so the visible count varies — the sky is never the same twice. */
    var vis = 1;
    if (star.visPeriod) {
      var visPhase = ((now + star.visOffset) % star.visPeriod) / star.visPeriod;
      /* Bright for ~80% of the cycle, dim for ~20% */
      if (visPhase > 0.80) {
        var dimProgress = (visPhase - 0.80) / 0.20;
        vis = 1 - star.visDepth * smoothstep(0, 0.5, dimProgress) * (1 - smoothstep(0.5, 1, dimProgress));
      }
    }
    var alpha = theme.starAlpha * star.magnitude * twinkle * vis * alphaMultiplier * skylineAlpha(star);
    if (alpha < 0.012) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = theme.star;
    var x = Math.round(star.x);
    var y = Math.round(star.y);
    ctx.fillRect(x, y, star.size, star.size);
  }

  function drawWanderer(wanderer, index, now) {
    if (!seats[wanderer.first] || !seats[wanderer.second]) return;
    var elapsed = ((now - wanderer.offset) % wanderer.period + wanderer.period) % wanderer.period;
    var phase = elapsed / wanderer.period;
    var fade = 0;
    var chosen = seats[wanderer.first];
    var outgoing = seats[wanderer.first];
    var incoming = seats[wanderer.second];
    var fadeStart = 0.78;
    var fadeEnd = 0.88;

    if (phase < fadeStart) {
      fade = 1;
    } else if (phase < fadeEnd) {
      fade = 1 - smoothstep(fadeStart, fadeEnd, phase);
      chosen = outgoing;
    } else if (phase < 0.91) {
      fade = 0;
      chosen = incoming;
    } else {
      fade = smoothstep(0.91, 0.99, phase);
      chosen = incoming;
    }

    drawStar({
      x: chosen.x,
      y: chosen.y,
      size: wanderer.size,
      phase: 0,
      rate: 0,
      magnitude: wanderer.magnitude
    }, now, fade);
  }

  function scheduleComet(now) {
    var seed = Math.floor(now / 1000) + width * 3 + height;
    var leftToRight = hash(seed) > 0.5;
    var startX = (0.18 + hash(seed + 1) * 0.64) * width;
    var startY = (0.06 + hash(seed + 2) * 0.10) * state.ridgeTop;
    var deltaX = (0.12 + hash(seed + 3) * 0.18) * width * (leftToRight ? 1 : -1);
    comet.active = true;
    comet.start = now;
    comet.duration = 16000 + hash(seed + 4) * 8000;
    comet.x0 = startX;
    comet.y0 = startY;
    comet.x1 = startX + deltaX;
    comet.y1 = startY + (0.23 + hash(seed + 5) * 0.17) * state.ridgeTop;
    comet.tail = (0.04 + hash(seed + 6) * 0.03) * width;
    comet.next = now + comet.duration + 25000 + hash(seed + 7) * 65000;
  }

  function drawComet(now) {
    if (!comet.active) return;
    var progress = (now - comet.start) / comet.duration;
    if (progress >= 1) {
      comet.active = false;
      return;
    }
    if (progress < 0) return;

    var fade = smoothstep(0, 0.12, progress) * (1 - smoothstep(0.72, 1, progress));
    var x = lerp(comet.x0, comet.x1, progress);
    var y = lerp(comet.y0, comet.y1, progress);
    var directionX = comet.x1 - comet.x0;
    var directionY = comet.y1 - comet.y0;
    var distance = Math.sqrt(directionX * directionX + directionY * directionY) || 1;
    directionX /= distance;
    directionY /= distance;
    var theme = inkRgb();

    for (var step = comet.tail; step > 0; step -= Math.max(1.2, dpr * 0.75)) {
      var tailAlpha = fade * Math.pow(1 - step / comet.tail, 1.65) * theme.starAlpha * 0.88;
      if (tailAlpha < 0.01) continue;
      var tx = Math.round(x - directionX * step);
      var ty = Math.round(y - directionY * step);
      if (ty >= state.skyline[clamp(tx, 0, width - 1)] - 2 * dpr) continue;
      ctx.globalAlpha = tailAlpha;
      ctx.fillStyle = theme.star;
      ctx.fillRect(tx, ty, 1, 1);
    }

    if (y < state.skyline[clamp(Math.round(x), 0, width - 1)] - 8 * dpr) {
      ctx.globalAlpha = clamp(fade * theme.starAlpha * 1.15, 0, 1);
      ctx.fillStyle = theme.star;
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(dpr * 1.4)), Math.max(1, Math.round(dpr * 1.4)));
    }
  }

  /* A supernova: a star suddenly flares to peak brightness, then a ring of
     light expands outward and fades. The whole event lasts 4-7 seconds and
     is rare enough to feel like a gift. */
  function scheduleSupernova(now) {
    var seed = Math.floor(now / 1000) + width * 7 + height * 3;
    supernova.active = true;
    supernova.start = now;
    supernova.duration = 4000 + hash(seed) * 3000;
    /* Pick a location in the sky, preferring upper half for visibility */
    supernova.x = (0.15 + hash(seed + 1) * 0.70) * width;
    supernova.y = (0.08 + hash(seed + 2) * 0.35) * state.ridgeTop;
    supernova.radius = (18 + hash(seed + 3) * 22) * dpr;
    supernova.next = now + supernova.duration + 90000 + hash(seed + 4) * 240000;
  }

  function drawSupernova(now) {
    if (!supernova.active) return;
    var progress = (now - supernova.start) / supernova.duration;
    if (progress >= 1) {
      supernova.active = false;
      return;
    }
    if (progress < 0) return;

    var theme = inkRgb();
    var cx = Math.round(supernova.x);
    var cy = Math.round(supernova.y);
    var skylineEdge = state.skyline[clamp(cx, 0, width - 1)];
    if (cy >= skylineEdge - 4 * dpr) {
      supernova.active = false;
      return;
    }

    /* Phase 1 (0-0.12): flash to peak brightness */
    /* Phase 2 (0.12-1.0): expanding ring fades outward, core fades */
    var flash = 1 - smoothstep(0, 0.12, progress);
    var ringProgress = smoothstep(0.08, 1, progress);
    var ringRadius = supernova.radius * ringProgress;
    var ringFade = 1 - ringProgress;
    var coreFade = (1 - smoothstep(0.12, 0.85, progress)) * 0.7;

    /* Bright core — a small bright square that flashes at the start then fades */
    if (flash > 0.02 || coreFade > 0.02) {
      var coreAlpha = clamp(theme.starAlpha * (flash + coreFade), 0, 1);
      if (coreAlpha > 0.02) {
        var coreSize = Math.max(1, Math.round(dpr * (1 + flash * 1.5)));
        ctx.globalAlpha = coreAlpha;
        ctx.fillStyle = theme.star;
        ctx.fillRect(cx - Math.floor(coreSize / 2), cy - Math.floor(coreSize / 2), coreSize, coreSize);
      }
    }

    /* Expanding ring of dots — the shockwave */
    if (ringFade > 0.02 && ringRadius > 2) {
      var circumference = 2 * Math.PI * ringRadius;
      var dotCount = Math.max(8, Math.round(circumference / Math.max(1.5, dpr)));
      for (var i = 0; i < dotCount; i++) {
        var angle = (i / dotCount) * Math.PI * 2;
        var rx = Math.round(cx + Math.cos(angle) * ringRadius);
        var ry = Math.round(cy + Math.sin(angle) * ringRadius);
        if (rx < 0 || rx >= width || ry < 0 || ry >= height) continue;
        if (ry >= state.skyline[clamp(rx, 0, width - 1)] - 2 * dpr) continue;
        /* Dithered ring — skip some dots for a pixel-art feel */
        if (hash2(rx, ry, 777) > 0.72) continue;
        var ringDotAlpha = ringFade * theme.starAlpha * 0.68;
        if (ringDotAlpha < 0.01) continue;
        ctx.globalAlpha = ringDotAlpha;
        ctx.fillStyle = theme.star;
        ctx.fillRect(rx, ry, 1, 1);
      }
    }
  }

  /* A satellite: a single dim dot that slowly drifts across the sky over
     20-40 seconds. Much slower and dimmer than a comet — it's the kind of
     thing you notice out of the corner of your eye. */
  function scheduleSatellite(now) {
    var seed = Math.floor(now / 1000) + width * 11 + height * 5;
    var leftToRight = hash(seed) > 0.5;
    satellite.active = true;
    satellite.start = now;
    satellite.duration = 20000 + hash(seed + 1) * 20000;
    satellite.x0 = leftToRight ? -20 * dpr : width + 20 * dpr;
    satellite.y0 = (0.10 + hash(seed + 2) * 0.40) * state.ridgeTop;
    satellite.x1 = leftToRight ? width + 20 * dpr : -20 * dpr;
    satellite.y1 = satellite.y0 + (hash(seed + 3) - 0.5) * state.ridgeTop * 0.15;
    satellite.brightness = 0.35 + hash(seed + 4) * 0.30;
    satellite.next = now + satellite.duration + 40000 + hash(seed + 5) * 120000;
  }

  function drawSatellite(now) {
    if (!satellite.active) return;
    var progress = (now - satellite.start) / satellite.duration;
    if (progress >= 1) {
      satellite.active = false;
      return;
    }
    if (progress < 0) return;

    var x = lerp(satellite.x0, satellite.x1, progress);
    var y = lerp(satellite.y0, satellite.y1, progress);
    var rx = Math.round(x);
    var ry = Math.round(y);
    if (rx < 0 || rx >= width || ry < 0 || ry >= height) return;
    if (ry >= state.skyline[clamp(rx, 0, width - 1)] - 8 * dpr) return;

    /* Fade in at start, fade out at end */
    var fade = smoothstep(0, 0.08, progress) * (1 - smoothstep(0.90, 1, progress));
    /* Subtle brightness oscillation — satellites reflect sunlight variably */
    var flicker = 0.82 + 0.18 * Math.sin(now * 0.004);
    var theme = inkRgb();
    var alpha = theme.starAlpha * satellite.brightness * fade * flicker;
    if (alpha < 0.012) return;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = theme.star;
    ctx.fillRect(rx, ry, 1, 1);
  }

  function drawFrame(now) {
    if (!state || !terrainImage) return;
    ctx.globalAlpha = 1;
    ctx.putImageData(terrainImage, 0, 0);

    drawCloud(now);
    drawSatellite(now);
    for (var i = 0; i < stars.length; i++) drawStar(stars[i], now, 1);
    for (i = 0; i < wanderers.length; i++) drawWanderer(wanderers[i], i, now);
    drawComet(now);
    drawSupernova(now);
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    rafId = window.requestAnimationFrame(tick);
    if (!state || reducedMotion || !visible) return;
    if (now - lastDraw < 1000 / 24) return;
    lastDraw = now;
    if (!comet.active && now >= comet.next) scheduleComet(now);
    if (!supernova.active && now >= supernova.next) scheduleSupernova(now);
    if (!satellite.active && now >= satellite.next) scheduleSatellite(now);
    drawFrame(now);
  }

  function build() {
    if (!plate.complete || !plate.naturalWidth) return;
    window.cancelAnimationFrame(rafId);
    rafId = 0;
    layoutPlate();
    if (!reducedMotion) rafId = window.requestAnimationFrame(tick);
  }

  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(build, 180);
  }

  function onThemeChange() {
    window.setTimeout(build, 0);
  }

  listenMedia(themeMedia, onThemeChange);
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
    stop: function () {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    },
    start: function () {
      if (!reducedMotion && !rafId) rafId = window.requestAnimationFrame(tick);
    },
    reset: function (now) {
      var time = reducedMotion ? 12345 : (now == null ? performance.now() : now);
      comet.active = false;
      comet.next = time + 1000000000;
      supernova.active = false;
      supernova.next = time + 1000000000;
      satellite.active = false;
      satellite.next = time + 1000000000;
      drawFrame(time);
    },
    step: function (now) {
      var time = reducedMotion ? 12345 : (now == null ? performance.now() : now);
      if (!comet.active && time >= comet.next) scheduleComet(time);
      if (!supernova.active && time >= supernova.next) scheduleSupernova(time);
      if (!satellite.active && time >= satellite.next) scheduleSatellite(time);
      drawFrame(time);
    },
    cometNow: function (now) {
      var time = reducedMotion ? 12345 : (now == null ? performance.now() : now);
      scheduleComet(time);
      drawFrame(time);
    },
    supernovaNow: function (now) {
      var time = reducedMotion ? 12345 : (now == null ? performance.now() : now);
      scheduleSupernova(time);
      drawFrame(time);
    },
    satelliteNow: function (now) {
      var time = reducedMotion ? 12345 : (now == null ? performance.now() : now);
      scheduleSatellite(time);
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
        edgeSamples: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(function (ratio) {
          return state.skyline[Math.min(width - 1, Math.round((width - 1) * ratio))];
        }),
        edgeTail: Array.prototype.slice.call(state.skyline, Math.max(0, width - 24)),
        edgeAt: function (x) {
          return state.skyline[clamp(Math.round(x), 0, width - 1)];
        },
        stars: stars.length,
        wanderers: wanderers.length,
        cloud: {
          dots: cloud.dots.length,
          valleyX: cloud.valleyX,
          valleyY: cloud.valleyY,
          top: cloud.top,
          bottom: cloud.bottom
        },
        motion: {
          reduced: reducedMotion,
          visible: visible,
          rafActive: !!rafId
        },
        comet: { active: comet.active, next: comet.next },
        supernova: { active: supernova.active, next: supernova.next },
        satellite: { active: satellite.active, next: satellite.next }
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
