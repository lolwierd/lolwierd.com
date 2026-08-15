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
  var SOURCE = "/assets/mountain-range-v2.jpg";
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

  var DARK = {
    ink: "#e5dccb",
    inkAlpha: 0.91,
    star: "#e5dccb",
    starAlpha: 0.78,
    cloudAlpha: 0.32
  };
  var LIGHT = {
    ink: "#29303a",
    inkAlpha: 0.88,
    star: "#29303a",
    starAlpha: 0.56,
    cloudAlpha: 0.22
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

  function makeSmallLuminance(luminance, w, h, q) {
    var smallW = Math.max(2, Math.ceil(w / q));
    var smallH = Math.max(2, Math.ceil(h / q));
    var small = new Uint8Array(smallW * smallH);
    var x;
    var y;

    for (y = 0; y < smallH; y++) {
      for (x = 0; x < smallW; x++) {
        var sx = Math.min(w - 1, x * q);
        var sy = Math.min(h - 1, y * q);
        var total = 0;
        var count = 0;
        var yy;
        var xx;
        for (yy = 0; yy < q && sy + yy < h; yy++) {
          for (xx = 0; xx < q && sx + xx < w; xx++) {
            total += luminance[(sy + yy) * w + sx + xx];
            count++;
          }
        }
        small[y * smallW + x] = total / count;
      }
    }

    return { data: small, w: smallW, h: smallH };
  }

  function floodTop(test, w, h) {
    var mask = new Uint8Array(w * h);
    var stack = [];
    var x;
    var y;
    var i;

    for (x = 0; x < w; x++) {
      if (test(x, 0)) {
        mask[x] = 1;
        stack.push(x);
      }
    }

    while (stack.length) {
      i = stack.pop();
      x = i % w;
      y = (i / w) | 0;
      var nx;
      var ny;
      var ni;

      for (var k = 0; k < 4; k++) {
        nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        ni = ny * w + nx;
        if (!mask[ni] && test(nx, ny)) {
          mask[ni] = 1;
          stack.push(ni);
        }
      }
    }

    return mask;
  }

  function morph(mask, w, h, radius, take) {
    var horizontal = new Uint8Array(w * h);
    var output = new Uint8Array(w * h);
    var x;
    var y;
    var k;
    var xx;
    var value;

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        value = mask[y * w + x];
        for (k = -radius; k <= radius; k++) {
          xx = x + k;
          if (xx >= 0 && xx < w) value = take(value, mask[y * w + xx]);
        }
        horizontal[y * w + x] = value;
      }
    }

    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        value = horizontal[y * w + x];
        for (k = -radius; k <= radius; k++) {
          var yy = y + k;
          if (yy >= 0 && yy < h) value = take(value, horizontal[yy * w + x]);
        }
        output[y * w + x] = value;
      }
    }

    return output;
  }

  /* The skyline is a connected-region problem: bright snow inside the range
     must stay land, while bright sky above it is allowed to be sky. The
     connected mask only locates the handoff. Terrain below that row remains
     untouched, so the plate keeps its full hierarchy and the edge stays hard. */
  function buildSkyline(luminance, w, h) {
    var q = 4;
    var small = makeSmallLuminance(luminance, w, h, q);
    /* Keep the first pass conservative. The plate’s sky darkens toward the
       upper-right, so a high global threshold turns part of the sky into a
       rectangular land block. The second pass below closes false sky pockets
       inside the range. */
    var threshold = 105;
    var sky = floodTop(function (x, y) {
      return small.data[y * small.w + x] > threshold;
    }, small.w, small.h);
    var eroded = morph(sky, small.w, small.h, 1, Math.min);
    var reconnected = floodTop(function (x, y) {
      return eroded[y * small.w + x] > 0;
    }, small.w, small.h);
    var dilated = morph(reconnected, small.w, small.h, 1, Math.max);
    var x;
    var y;

    /* Keep the connected mask at quarter resolution, but do not expand its
       cells as four-pixel ledges. Interpolating between the cell handoffs
       gives the contour a continuous slope while keeping the boundary a
       single hard row of pixels. */
    var coarse = new Int32Array(small.w);
    for (x = 0; x < small.w; x++) {
      var edge = h;
      for (y = 0; y < small.h; y++) {
        if (!dilated[y * small.w + x]) {
          edge = y;
          break;
        }
      }
      coarse[x] = edge === h ? h : edge * q;
    }

    var skyline = new Int32Array(w);
    for (x = 0; x < w; x++) {
      var cell = Math.min(coarse.length - 1, Math.floor(x / q));
      var nextCell = Math.min(coarse.length - 1, cell + 1);
      var t = (x - cell * q) / q;
      skyline[x] = Math.round(lerp(coarse[cell], coarse[nextCell], t));
    }

    /* A narrow bright snow pocket can otherwise become a two-pixel-deep
       shaft in the contour. A small physical-pixel median removes those
       false notches while leaving the range’s real peaks and valleys alone. */
    var radius = Math.max(3, Math.round(q * 1.5 * dpr));
    var clean = new Int32Array(w);
    for (x = 0; x < w; x++) {
      var values = [];
      var from = Math.max(0, x - radius);
      var to = Math.min(w - 1, x + radius);
      for (var sample = from; sample <= to; sample++) values.push(skyline[sample]);
      values.sort(function (a, b) { return a - b; });
      clean[x] = values[Math.floor(values.length / 2)];
    }
    return clean;
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
    var bandH = Math.round(height * (cssW < cssH ? 0.62 : 0.64));
    var bandTop = height - bandH;
    var targetAspect = width / bandH;
    var sx = 0;
    var sy = 0;
    var sw = plateW;
    var sh = plateH;
    var focus = cssW < cssH ? 0.55 : 0.52;

    if (targetAspect > plateAspect) {
      sh = plateW / targetAspect;
      sy = Math.min(plateH - sh, plateH * 0.12);
    } else {
      sw = plateH * targetAspect;
      sx = clamp(plateW * focus - sw / 2, 0, plateW - sw);
    }

    bufferCtx.drawImage(plate, sx, sy, sw, sh, 0, bandTop, width, bandH);
    var pixels = bufferCtx.getImageData(0, 0, width, height).data;
    var luminance = new Uint8Array(width * height);
    var i;

    for (i = 0; i < luminance.length; i++) luminance[i] = pixels[i * 4];

    var skyline = buildSkyline(luminance, width, height);
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
    comet.next = performance.now() + 180000 + hash2(width, height, 901) * 240000;
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
    var count = state.dark ? 14 : 10;
    var seatCount = count + 7;
    var horizon = Math.max(1, state.ridgeTop);
    var minDistance = Math.sqrt((width * horizon) / seatCount) * 0.42;
    var seed = 20260815 + width + height;
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
        size: hash(seed++) > 0.80 ? 2 : 1,
        phase: hash(seed++) * Math.PI * 2,
        rate: 0.00007 + hash(seed++) * 0.00007,
        magnitude: 0.55 + hash(seed++) * 0.35
      });
    }

    for (i = 0; i < Math.min(count, seats.length); i++) stars.push(seats[i]);

    var periods = [58000, 79000];
    for (i = 0; i < Math.min(2, Math.max(0, seats.length - count)); i++) {
      wanderers.push({
        period: periods[i],
        offset: i * 24000 + 13000,
        first: count + i,
        second: count + i + 2,
        size: 2,
        magnitude: 0.82
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

    var span = clamp(width * 0.30, 150 * dpr, 520 * dpr);
    var cloudHeight = clamp(depth * 0.66, 48 * dpr, 170 * dpr);
    var top = valleyY - cloudHeight;
    var bottom = valleyY - 4 * dpr;
    var step = Math.max(3, Math.round(2.5 * dpr));
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
        var leftWisp = Math.exp(-((u + 0.48) * (u + 0.48) * 5.2) - ((v + 0.14) * (v + 0.14) * 7.0)) * 0.88;
        var middleWisp = Math.exp(-((u - 0.02) * (u - 0.02) * 7.4) - ((v - 0.04) * (v - 0.04) * 8.5)) * 0.74;
        var rightWisp = Math.exp(-((u - 0.48) * (u - 0.48) * 5.0) - ((v + 0.10) * (v + 0.10) * 6.4)) * 0.62;
        var shape = clamp(leftWisp + middleWisp + rightWisp, 0, 1);
        var cellX = Math.floor(x / step);
        var cellY = Math.floor(y / step);
        var keep = 0.12 + shape * 0.48;
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
    var cycle = now * 0.00007;
    var driftX = Math.sin(cycle) * 9 * dpr;
    var driftY = Math.sin(cycle * 0.71 + 1.2) * 2.5 * dpr;

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
      var groundFade = smoothstep(0, 28 * dpr, edge - y);
      var flow = 0.84 + 0.16 * Math.sin((x - driftX) * 0.027 + (y - driftY) * 0.016 + dot.phase);
      var pulse = 0.92 + 0.08 * Math.sin(cycle * 0.64 + dot.phase);
      var alpha = theme.cloudAlpha * dot.alpha * groundFade * flow * pulse;
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
      twinkle = 0.88 + 0.12 * Math.sin(now * star.rate + star.phase);
    }
    var alpha = theme.starAlpha * star.magnitude * twinkle * alphaMultiplier * skylineAlpha(star);
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
    comet.duration = 22000 + hash(seed + 4) * 10000;
    comet.x0 = startX;
    comet.y0 = startY;
    comet.x1 = startX + deltaX;
    comet.y1 = startY + (0.23 + hash(seed + 5) * 0.17) * state.ridgeTop;
    comet.tail = (0.035 + hash(seed + 6) * 0.025) * width;
    comet.next = now + comet.duration + 180000 + hash(seed + 7) * 240000;
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
      var tailAlpha = fade * Math.pow(1 - step / comet.tail, 1.65) * theme.starAlpha * 0.72;
      if (tailAlpha < 0.01) continue;
      var tx = Math.round(x - directionX * step);
      var ty = Math.round(y - directionY * step);
      if (ty >= state.skyline[clamp(tx, 0, width - 1)] - 2 * dpr) continue;
      ctx.globalAlpha = tailAlpha;
      ctx.fillStyle = theme.star;
      ctx.fillRect(tx, ty, 1, 1);
    }

    if (y < state.skyline[clamp(Math.round(x), 0, width - 1)] - 8 * dpr) {
      ctx.globalAlpha = fade * theme.starAlpha;
      ctx.fillStyle = theme.star;
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(dpr * 1.2)), Math.max(1, Math.round(dpr * 1.2)));
    }
  }

  function drawFrame(now) {
    if (!state || !terrainImage) return;
    ctx.globalAlpha = 1;
    ctx.putImageData(terrainImage, 0, 0);

    drawCloud(now);
    for (var i = 0; i < stars.length; i++) drawStar(stars[i], now, 1);
    for (i = 0; i < wanderers.length; i++) drawWanderer(wanderers[i], i, now);
    drawComet(now);
    ctx.globalAlpha = 1;
  }

  function tick(now) {
    rafId = window.requestAnimationFrame(tick);
    if (!state || reducedMotion || !visible) return;
    if (now - lastDraw < 1000 / 24) return;
    lastDraw = now;
    if (!comet.active && now >= comet.next) scheduleComet(now);
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
      drawFrame(time);
    },
    step: function (now) {
      var time = reducedMotion ? 12345 : (now == null ? performance.now() : now);
      if (!comet.active && time >= comet.next) scheduleComet(time);
      drawFrame(time);
    },
    cometNow: function (now) {
      var time = reducedMotion ? 12345 : (now == null ? performance.now() : now);
      scheduleComet(time);
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
        comet: { active: comet.active, next: comet.next }
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
