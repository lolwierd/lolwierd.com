import * as SunCalc from "suncalc";
import {
  clamp,
  smoothstep,
  lerp,
  hash,
  hash2,
  bayerThreshold,
  isNight,
  onSkyPhase,
  setSkyPhase,
  markThemeShift,
  listenMedia,
  onFrame,
  flickerOffset,
  budget,
  effects,
  motionMedia
} from "./sky-shared.js";

(function () {
  "use strict";

  var canvas = document.getElementById("sky");
  if (!canvas) return;

  var ctx = canvas.getContext("2d", { alpha: true });
  var plate = new Image();
  var buffer = document.createElement("canvas");
  var bufferCtx = buffer.getContext("2d", { willReadFrequently: true });



  // Full-resolution colour JPEG on purpose. The plate is dithered to 1-bit, so it
  // looks like it should compress hard -- it does not. Measured alternatives:
  // 2000px AVIF (306KB) rendered the terrain almost black, exact Rec.709 greyscale
  // at 3000px only reached 1.34MB and softened the dither. The photograph is the
  // site, so it ships whole and is preloaded instead.
  var SOURCE = "/assets/annapurna-circuit.jpg";
  var SKYLINE_SOURCE = "/assets/annapurna-skyline.json?v=20260817c";
  var MAX_DPR = 2;
  var FIXED_TIME = 21437;
  var VADODARA = { latitude: 22.3072, longitude: 73.1812 };
  var CELESTIAL_REFRESH_MS = 60000;


  var THEMES = {
    dark: {
      ink: "#e4dac8",
      terrainAlpha: 0.91,
      dustAlpha: 0.23,
      star: "#eee6d8",
      starAlpha: 0.94,
      satelliteAlpha: 0.34
    },
    light: {
      ink: "#293039",
      terrainAlpha: 0.87,
      dustAlpha: 0.18,
      star: "#293039",
      starAlpha: 0,
      satelliteAlpha: 0
    }
  };

  var skylineData = null;
  var state = null;
  var terrainImage = null;

  // The terrain is baked into an offscreen canvas once per layout and blitted
  // each frame. It used to be re-uploaded with putImageData on every frame --
  // 20MB at 2x, twenty-four times a second -- which is the single most expensive
  // thing the page did, and which Safari handles far worse than Chrome.
  var terrainCanvas = null;
  var terrainInk = "#000000";
  var terrainFlickerAlpha = 1;

  // Mid-tone terrain cells, the only ones whose dither decision can realistically
  // flip. Re-deciding these against a noise-nudged threshold each frame is what
  // makes the whole mountain breathe rather than just the sun.
  var terrainFlicker = null;
  var TERRAIN_BAND = 0.14;
  var TERRAIN_AMP = 0.15;
  var TERRAIN_BUDGET = 7000;
  var edgeDots = [];
  var celestial = null;
  var lastCelestialUpdate = 0;

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
  var lastDraw = 0;
  var reducedMotion = motionMedia.matches;
  var visible = !document.hidden;
  var activeWork = null;






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


  function theme() {
    return isNight() ? THEMES.dark : THEMES.light;
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
      sy = clamp(plateH * 0.17, 0, Math.max(0, plateH - sh));
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

    var candidates = [];

    for (var index = 0; index < dots.length; index++) {
      if (!dots[index]) continue;

      var py = Math.floor(index / width);
      var px = index - py * width;
      var distance = py - skyline[px];
      var edgeMix = smoothstep(0, edgeDepth, distance);

      if (distance < edgeDepth && hash2(px, py, seed) < (1 - edgeMix) * 0.10) continue;

      var p = index * 4;
      var alpha = Math.round(activeTheme.terrainAlpha * 255 * (0.78 + edgeMix * 0.22));
      output[p] = red;
      output[p + 1] = green;
      output[p + 2] = blue;
      output[p + 3] = alpha;

      // Only mid-tones can flip. Anything solidly lit or solidly dark stays put,
      // which is what keeps the ridge line and the snow fields stable.
      var tone = paper[index];
      if (tone > 0.5 - TERRAIN_BAND && tone < 0.5 + TERRAIN_BAND) candidates.push(index, alpha);
    }

    // Sample down to a fixed budget so the per-frame cost does not scale with
    // resolution: on a 2x display the raw candidate set is tens of thousands.
    var pairs = candidates.length / 2;
    var step = Math.max(1, Math.ceil(pairs / TERRAIN_BUDGET));
    var kept = Math.floor(pairs / step);
    terrainFlicker = kept ? {
      index: new Int32Array(kept),
      tone: new Float32Array(kept)
    } : null;

    var alphaSum = 0;
    for (var k = 0, c = 0; k < kept; k++, c += step) {
      var src = c * 2;
      var cell = candidates[src];
      terrainFlicker.index[k] = cell;
      terrainFlicker.tone[k] = paper[cell];
      alphaSum += candidates[src + 1];
      // Baked with the flicker cells off, so each frame only has to add the ones
      // currently lit rather than rewrite the whole bitmap.
      output[cell * 4 + 3] = 0;
    }

    // One alpha for the whole flickering set. They span 0.78 to 1.0 of the
    // terrain alpha, and a single value lets every cell go down in one fill
    // instead of thousands of state changes.
    terrainFlickerAlpha = kept ? (alphaSum / kept) / 255 : 1;
    terrainInk = activeTheme.ink;

    if (!terrainCanvas) terrainCanvas = document.createElement("canvas");
    terrainCanvas.width = width;
    terrainCanvas.height = height;
    terrainCanvas.getContext("2d").putImageData(terrainImage, 0, 0);
  }

  // Every lit cell goes into one Path2D and down in a single fill, so the cost
  // is one draw call rather than one per cell.
  function flickerTerrain(now) {
    if (!terrainFlicker) return;
    var idx = terrainFlicker.index;
    var tone = terrainFlicker.tone;
    var path = new Path2D();
    var drew = false;

    for (var i = 0; i < idx.length; i++) {
      if (!reducedMotion && tone[i] >= 0.5 + flickerOffset(idx[i] * 0.0137, now, TERRAIN_AMP)) continue;
      var cell = idx[i];
      var y = (cell / width) | 0;
      path.rect(cell - y * width, y, 1, 1);
      drew = true;
    }

    if (!drew) return;
    ctx.globalAlpha = terrainFlickerAlpha;
    ctx.fillStyle = terrainInk;
    ctx.fill(path);
    ctx.globalAlpha = 1;
  }


  function makeEdgeDots() {
    edgeDots = [];
    var reach = Math.max(9, Math.round((state.dark ? 15 : 38) * dpr));
    var xStep = Math.max(1, Math.round(dpr * 0.70));
    var seed = width * 17 + height * 31 + 811;

    for (var x = 0; x < width; x += xStep) {
      var edge = state.skyline[x];
      if (edge >= height) continue;
      if (!state.dark && edge > state.ridgeTop + height * 0.14) continue;

      for (var distance = 1; distance <= reach; distance++) {
        var y = edge - distance;
        if (y < 0) break;

        var envelope = 1 - distance / (reach + 1);
        var keep = state.dark
          ? 0.014 + envelope * envelope * 0.084
          : 0.045 + envelope * envelope * 0.22;
        if (hash2(x, y, seed) > keep) continue;

        edgeDots.push({
          x: x,
          y: y,
          envelope: envelope,
          phase: hash2(x, y, seed + 3) * Math.PI * 2,
          threshold: bayerThreshold(x, y),
          strength: 0.48 + hash2(x, y, seed + 7) * 0.62,
          drift: 0.45 + hash2(x, y, seed + 13) * 0.78
        });
      }
    }
  }

  function drawEdge(now) {
    var activeTheme = theme();
    var t = now * 0.0000095;
    var gustPhase = ((now % 18000) + 18000) % 18000 / 18000;
    var gust = state.dark ? 0 : smoothstep(0.14, 0.19, gustPhase) * (1 - smoothstep(0.30, 0.38, gustPhase));
    ctx.fillStyle = activeTheme.ink;

    for (var i = 0; i < edgeDots.length; i++) {
      var dot = edgeDots[i];
      var field = warpedField(dot.x * 0.0021, dot.y * 0.0025 + dot.phase, t, 991);
      var longPulse = 0.5 + 0.5 * Math.sin(dot.phase + t * 0.28);
      var density = dot.envelope * (0.24 + field * 0.60 + longPulse * 0.16);
      if (density < dot.threshold * 0.60) continue;

      var detach = smoothstep(0.54, 0.84, field) * dot.drift;
      var lift = Math.round(detach * (1.2 + (1 - dot.envelope) * (state.dark ? 2.0 : 8.0)) * dpr);
      var wind = state.dark ? 0 : Math.round(gust * detach * (7 + (1 - dot.envelope) * 18) * dpr);
      var alpha =
        activeTheme.dustAlpha *
        dot.envelope *
        dot.strength *
        smoothstep(0.17, 0.78, density);

      if (alpha < 0.005) continue;
      ctx.globalAlpha = clamp(alpha * (state.dark ? 1 : 0.7 + gust * 1.9), 0, state.dark ? 0.23 : 0.26);
      ctx.fillRect(dot.x + wind, dot.y - lift, Math.max(1, Math.round(dpr)), Math.max(1, Math.round(dpr)));
    }
  }

  function projectAltitude(altitude) {
    return height * (0.50 - (clamp(altitude, 0, 90) / 90) * 0.42);
  }

  function updateCelestial(date) {
    var sunPosition = SunCalc.getPosition(date, VADODARA.latitude, VADODARA.longitude);
    var moonPosition = SunCalc.getMoonPosition(date, VADODARA.latitude, VADODARA.longitude);
    var moonLight = SunCalc.getMoonIllumination(date);
    var sunTimes = SunCalc.getTimes(date, VADODARA.latitude, VADODARA.longitude);
    var sunrise = sunTimes.sunrise && sunTimes.sunrise.getTime();
    var sunset = sunTimes.sunset && sunTimes.sunset.getTime();
    var daylightProgress = sunrise && sunset && sunset > sunrise
      ? clamp((date.getTime() - sunrise) / (sunset - sunrise), 0, 1)
      : clamp(sunPosition.azimuth / 360, 0, 1);

    celestial = {
      sun: {
        altitude: sunPosition.altitude,
        azimuth: sunPosition.azimuth,
        visible: sunPosition.altitude > -6,
        x: width * (0.13 + daylightProgress * 0.74),
        y: projectAltitude(sunPosition.altitude)
      },
      moon: {
        altitude: moonPosition.altitude,
        azimuth: moonPosition.azimuth,
        visible: moonPosition.altitude > -1 && moonLight.fraction > 0.015,
        x: width * (0.10 + clamp(moonPosition.azimuth / 360, 0, 1) * 0.80),
        y: projectAltitude(moonPosition.altitude),
        fraction: moonLight.fraction,
        phase: moonLight.phase,
        waxing: moonLight.waxing,
        limbAngle: (moonLight.angle - moonPosition.parallacticAngle) * Math.PI / 180
      }
    };

    lastCelestialUpdate = Date.now();

    // Authoritative phase, from real ephemeris rather than the inline estimate.
    setSkyPhase(celestial.sun.altitude > -6 ? "day" : "night");

    // How much twilight is still painted over the night sky. The page's colours
    // flip at -6 but the sky keeps fading to -18, so every layer that cares about
    // "is it actually dark yet" has to read this rather than the phase alone.
    twilightVeil = celestial.sun.altitude > -6 ? 1 : clamp((celestial.sun.altitude + 18) / 12, 0, 1);
    root_veil(twilightVeil);
    document.documentElement.dataset.moonPhase = celestial.moon.phase.toFixed(3);
  }

  // An override lets the easter eggs walk the scene to a chosen hour without
  // touching the wall clock. Null means "follow Vadodara", which is the default
  // and what every normal visit uses.
  var clockOverride = null;
  var twilightVeil = 1;

  function root_veil(value) {
    var root = document.documentElement;
    root.style.setProperty("--sky-veil", value.toFixed(3));
    // The page switches to night ink at -6, but the sky behind the hero stays
    // bright for another few degrees. While it is still lit, the hero needs the
    // daylight inks or its text is light-on-light.
    // Three bands, because the sky passes through every luminance on the way
    // down and the page's two ink sets only cover the ends of that range.
    var band = value > 0.55 ? "lit" : value > 0.04 ? "dim" : "";
    if (root.getAttribute("data-sky-veil") === (band || null)) return;
    if (band) root.setAttribute("data-sky-veil", band);
    else root.removeAttribute("data-sky-veil");
    markThemeShift();
  }

  function skyNow() {
    return clockOverride == null ? new Date() : new Date(clockOverride);
  }

  // Solar nadir is not when you can see the moon -- tonight the moon is 26
  // degrees below the horizon at that hour. Find the moment in the next day
  // when the moon is highest while the sky is genuinely dark.
  // Ask for proper astronomical night first. At -6 the sky is still bright civil
  // twilight and the moon egg was landing there and calling it night. Loosen only
  // if the moon is genuinely never up once it is dark.
  function bestMoonMoment(from) {
    return searchMoon(from, -18) || searchMoon(from, -12) || searchMoon(from, -6);
  }

  function searchMoon(from, sunBelow) {
    var best = null;
    var bestAlt = -90;
    for (var minutes = 0; minutes < 1440; minutes += 10) {
      var when = new Date(from.getTime() + minutes * 60000);
      if (SunCalc.getPosition(when, VADODARA.latitude, VADODARA.longitude).altitude > sunBelow) continue;
      var moon = SunCalc.getMoonPosition(when, VADODARA.latitude, VADODARA.longitude);
      if (moon.altitude > bestAlt) {
        bestAlt = moon.altitude;
        best = when;
      }
    }
    return bestAlt > 3 ? best : null;
  }

  function updateSky() {
    updateCelestial(skyNow());
  }

  function makeStars() {
    stars = [];
    wanderers = [];
    if (!state.dark) return;

    var count = state.portrait ? 108 : 168;
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
      seats.push({
        x: x,
        y: y,
        size: 1,
        bright: bright,
        magnitude: bright ? 0.90 + hash(seed++) * 0.10 : 0.38 + hash(seed++) * 0.50,
        period: 1700 + hash(seed++) * 6800,
        phase: hash(seed++) * Math.PI * 2,
        breathePeriod: 9000 + hash(seed++) * 28000,
        breatheOffset: hash(seed++) * 110000,
        vanishPeriod: 26000 + hash(seed++) * 70000,
        vanishOffset: hash(seed++) * 170000,
        sparkle: bright ? 0.22 + hash(seed++) * 0.22 : 0.08 + hash(seed++) * 0.12
      });
    }

    stars = seats.slice(0, count);
    for (var w = 0; w < Math.min(7, seats.length - count - 7); w++) {
      wanderers.push({
        first: seats[count + w],
        second: seats[count + w + 8],
        period: 34000 + w * 9000,
        offset: 7000 + w * 11000
      });
    }
  }

  function starAlpha(star, now) {
    var primary = Math.sin((now / star.period) * Math.PI * 2 + star.phase);
    var secondary = Math.sin((now / (star.period * 1.91)) * Math.PI * 2 + star.phase * 1.7);
    var shimmer = Math.sin((now / Math.max(7000, star.period * 0.34)) * Math.PI * 2 + star.phase * 2.3);
    var twinkle = 0.70 + primary * 0.21 + secondary * 0.10 + shimmer * star.sparkle;
    var breathe = 0.72 + 0.28 * Math.sin(((now + star.breatheOffset) / star.breathePeriod) * Math.PI * 2);

    var vanishPhase = (((now + star.vanishOffset) % star.vanishPeriod) + star.vanishPeriod) % star.vanishPeriod / star.vanishPeriod;
    var visibleFactor = 1;
    if (vanishPhase > 0.80) {
      var p = (vanishPhase - 0.80) / 0.20;
      visibleFactor = p < 0.40
        ? 1 - smoothstep(0, 0.40, p)
        : smoothstep(0.60, 1, p);
    }

    var edge = state.skyline[clamp(Math.round(star.x), 0, width - 1)];
    var horizonFade = smoothstep(0, 30 * dpr, edge - star.y);
    var alpha = theme().starAlpha * star.magnitude * twinkle * breathe * visibleFactor * horizonFade;
    return star.bright ? Math.max(alpha, theme().starAlpha * star.magnitude * 0.34 * horizonFade) : alpha;
  }

  function drawOneStar(star, now, multiplier) {
    var alpha = starAlpha(star, now) * multiplier;
    if (alpha < 0.008) return;
    var core = Math.max(1, Math.round(dpr));
    var x = Math.round(star.x - core * 0.5);
    var y = Math.round(star.y - core * 0.5);
    ctx.globalAlpha = clamp(alpha, 0, 0.96);
    ctx.fillRect(x, y, core, core);
    if (star.bright && alpha > 0.72) {
      ctx.globalAlpha = (alpha - 0.72) * 0.72;
      ctx.fillRect(x - core, y, core * 3, core);
      ctx.fillRect(x, y - core, core, core * 3);
    }
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

      if (phase < 0.62) {
        oldAlpha = 1;
      } else if (phase < 0.72) {
        oldAlpha = 1 - smoothstep(0.62, 0.72, phase);
      } else if (phase < 0.82) {
        oldAlpha = 0;
      } else {
        oldAlpha = 0;
        newAlpha = smoothstep(0.82, 1, phase);
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
    comet.next = now + comet.duration + 18000 + hash(seed + 7) * 32000;
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
    satellite.next = now + satellite.duration + 30000 + hash(seed + 5) * 48000;
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
    if (!state || !terrainCanvas) return;
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    if (terrainCanvas) ctx.drawImage(terrainCanvas, 0, 0);
    flickerTerrain(now);
    drawEdge(now);
    drawStars(now);
    drawSatellite(now);
    drawComet(now);
    ctx.globalAlpha = 1;
    budget.terrainCells = terrainFlicker ? terrainFlicker.index.length : 0;
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
    var visibleBandH = Math.round(height * (portrait ? 0.72 : 0.58));
    var overscan = Math.round(height * (portrait ? 0.18 : 0.14));
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
      dark: isNight(),
      portrait: portrait,
      skyline: skyline,
      luminance: luminance,
      ridgeTop: ridgeTop,
      ridgeLow: ridgeLow,
      crop: crop,
      bandTop: bandTop,
      drawHeight: drawH
    };

    makeTerrain(luminance, skyline);
    makeEdgeDots();
    makeStars();
    updateSky();

    var now = performance.now();
    comet.active = false;
    satellite.active = false;
    comet.next = state.dark ? now + 4500 + hash2(width, height, 901) * 3000 : Infinity;
    satellite.next = state.dark ? now + 9000 + hash2(width, height, 903) * 5000 : Infinity;
    drawFrame(reducedMotion ? FIXED_TIME : now);

    // First real frame is on the canvas: let the scene fade up. The hero copy
    // waits on this so the mountain arrives before the words, rather than the
    // text sitting on an empty page while a 1.8MB plate decodes.
    document.documentElement.setAttribute("data-scene-ready", "");
  }

  function tick(now) {
    if (!state || reducedMotion || !visible || now - lastDraw < 1000 / 24) return;
    lastDraw = now;

    if (Date.now() - lastCelestialUpdate >= CELESTIAL_REFRESH_MS) updateSky();

    if (state.dark && !comet.active && now >= comet.next) scheduleComet(now);
    if (state.dark && !satellite.active && now >= satellite.next) scheduleSatellite(now);
    drawFrame(now);
  }

  function build() {
    if (!plate.complete || !plate.naturalWidth || !skylineData) return;
    layoutPlate();
  }

  function onResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(build, 180);
  }

  onSkyPhase(function () {
    window.setTimeout(build, 0);
  });

  listenMedia(motionMedia, function (event) {
    reducedMotion = event.matches;
    build();
  });

  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", function () {
    visible = !document.hidden;
  });

  onFrame(tick);

  window.__portfolioSky = {
    build: build,
    step: function (now) {
      drawFrame(reducedMotion ? FIXED_TIME : now == null ? performance.now() : now);
    },
    // Move the sky to a moment: "dawn", "dusk", "night", "noon", or null to go
    // back to the real hour over Vadodara.
    // Reports whether the moon is actually up at the override, so callers can
    // say so rather than silently showing an empty sky.
    clock: skyNow,
    moonUp: function () {
      return !!(celestial && celestial.moon && celestial.moon.visible);
    },
    // Animation path. setClock relayouts the plate, which re-dithers the whole
    // terrain -- far too heavy to run per frame. Stepping only recomputes the
    // ephemeris and repaints, and pays for a relayout only when day flips to
    // night and the terrain palette genuinely changes.
    stepClock: function (date) {
      clockOverride = date.getTime();
      var wasDark = state && state.dark;
      updateSky();

      // updateSky publishes the phase, and the layers above rebuild from
      // baseState() the moment it does -- before the relayout below has produced
      // the state that matches it. On a day/night flip they would cache the old
      // one and, in night-sky-v2's case, paint its night ridge mask over a
      // daylit mountain. Relayout first, then tell them again.
      if (state && state.dark !== isNight()) {
        layoutPlate();
        if (state.dark !== wasDark) window.dispatchEvent(new Event("skyphasechange"));
      }

      window.dispatchEvent(new Event("skyclockstep"));
      drawFrame(reducedMotion ? FIXED_TIME : performance.now());
    },

    // The span a full-day run walks: first light through to the small hours.
    dayArc: function () {
      var base = new Date();
      var times = SunCalc.getTimes(base, VADODARA.latitude, VADODARA.longitude);
      var from = times.sunrise ? times.sunrise.getTime() - 40 * 60000 : base.getTime();
      // Run on past the moon's high point so the day ends in real darkness
      // rather than stopping at -6 degrees, which still reads as late twilight.
      var moon = bestMoonMoment(base);
      var to = (moon || times.nadir || base).getTime() + 75 * 60000;
      if (to <= from) to = from + 18 * 3600000;
      return { from: from, to: to };
    },

    setClock: function (moment) {
      var base = new Date();
      var times = SunCalc.getTimes(base, VADODARA.latitude, VADODARA.longitude);
      var target = null;

      if (moment === "dawn") target = times.sunrise;
      else if (moment === "dusk") target = times.sunset;
      else if (moment === "night" || moment === "moon") target = bestMoonMoment(base) || times.nadir;
      else if (moment === "noon") target = times.solarNoon;
      // Sun at about -9 degrees: the nautical palette, cool blue overhead and
      // warm at the horizon. It is the first frame of the day run and the
      // best-looking minute of the whole cycle.
      else if (moment === "blue") target = times.sunrise ? new Date(times.sunrise.getTime() - 40 * 60000) : null;
      else if (moment instanceof Date) target = moment;

      clockOverride = target ? target.getTime() : null;
      updateSky();
      layoutPlate();
      // Layers above cache geometry per phase, so make them all rebuild even when
      // the day/night label itself has not changed (noon -> dusk is still "day").
      window.dispatchEvent(new Event("skyphasechange"));
      drawFrame(reducedMotion ? FIXED_TIME : performance.now());
      return clockOverride;
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
        // Layers above size themselves off this. It was missing from the public
        // state, so twilight-sky read `undefined` and used landscape values on
        // every phone.
        portrait: state.portrait,
        veil: twilightVeil,
        skyline: state.skyline,
        luminance: state.luminance,
        ridgeTop: state.ridgeTop,
        ridgeLow: state.ridgeLow,
        edgeDots: edgeDots.length,
        stars: stars.length,
        wanderers: wanderers.length,
        comet: { active: comet.active, next: comet.next },
        satellite: { active: satellite.active, next: satellite.next },
        celestial: celestial && {
          sun: {
            altitude: celestial.sun.altitude,
            azimuth: celestial.sun.azimuth,
            visible: celestial.sun.visible,
            x: celestial.sun.x,
            y: celestial.sun.y
          },
          moon: {
            altitude: celestial.moon.altitude,
            azimuth: celestial.moon.azimuth,
            visible: celestial.moon.visible,
            fraction: celestial.moon.fraction,
            phase: celestial.moon.phase,
            waxing: celestial.moon.waxing,
            x: celestial.moon.x,
            y: celestial.moon.y,
            limbAngle: celestial.moon.limbAngle
          }
        },
        motion: { reduced: reducedMotion, visible: visible }
      };
    }
  };

  Promise.all([
    new Promise(function (resolve, reject) {
      plate.decoding = "async";
      plate.fetchPriority = "high";
      plate.onload = resolve;
      plate.onerror = reject;
      plate.src = SOURCE;
    }),
    fetch(SKYLINE_SOURCE, { cache: "reload" }).then(function (response) {
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
