// The interior pages' one piece of scenery.
//
// It is the same mountain as the front page: the same photograph, the same ridge
// trace, the same tone curve and the same three inks, run through the same
// Atkinson dither. The only differences are the crop -- a short band at the foot
// of the page instead of a whole viewport -- and that nothing here moves. An
// error page and a reading page do not need weather.

import {
  atkinsonTiers,
  bayerThreshold,
  clamp,
  hash2,
  flickerOffset,
  hashUnit,
  isNight,
  listenMedia,
  motionMedia,
  onFrame,
  onSkyPhase,
  smoothstep,
  SKY_THEMES,
  TERRAIN_TIERS,
  terrainPaper
} from "./sky-shared.js";

var SOURCE = "/assets/annapurna-circuit.jpg";
var SKYLINE_SOURCE = "/assets/annapurna-skyline.json?v=20260817c";
var MAX_DPR = 2;

// How much taller than the skyline's own fall the crop has to be, so there is
// terrain under the lowest saddle rather than a ridge sitting on the page edge.
var RIDGE_FILL = 1.45;

// The living boundary, in the thin band just above the crest. Same idea as the
// hero's: the mountain never moves, and a sparse set of individual pixels
// outside the photographed skyline appear, vanish, or lift by about a pixel as a
// slow noise field drifts. Not blur, not glow, not an animated silhouette.
// Spindrift. DESIGN.md already describes the front page's version of this: a
// summit gust that pushes the highest loose pixels rightward off the crest. The
// interior pages have a lot of empty sky above the range and nothing happening
// in it, so the same wind carries the pixels further here -- individual grains
// of the same ink, lifting off the ridge line, drifting, and thinning out. No
// trails, no glow, no falling snow: it is the plate coming apart at the edge.
var DRIFT_MAX = 440;
var DRIFT_SPAWN_MS = 70;
var GUST_MIN_MS = 7000;
var GUST_MAX_MS = 17000;

var AIR_BAND = 7;
var AIR_STRIDE = 2;

// The phase reduced motion freezes at. Chosen rather than zero so the still
// composition is a normal moment of the field, not its starting seed.
var AIR_FROZEN = 21437;

var canvas = document.getElementById("ridge");
if (canvas) start(canvas);

function start(canvas) {
  var ctx = canvas.getContext("2d", { alpha: true });
  var buffer = document.createElement("canvas");
  var bufferCtx = buffer.getContext("2d", { willReadFrequently: true });
  var plate = new Image();
  var skylineData = null;
  var ready = false;
  var air = null;
  var airCtx = null;
  var drift = null;
  var driftCtx = null;
  var grains = [];
  var lastSpawn = 0;
  var gustUntil = 0;
  var nextGust = 0;
  var lastDriftFrame = 0;
  var skyline = null;
  var inkRGB = null;
  var scale = 1;

  // Both are already in cache for anyone arriving from the front page, which
  // preloads them. On a cold hit they load after paint and the page reads fine
  // without them.
  Promise.all([
    new Promise(function (resolve, reject) {
      plate.onload = resolve;
      plate.onerror = reject;
      plate.decoding = "async";
      plate.src = SOURCE;
    }),
    fetch(SKYLINE_SOURCE)
      .then(function (response) { return response.json(); })
      .then(function (data) { skylineData = data; })
  ])
    .then(function () {
      ready = true;
      draw();
      canvas.dataset.ready = "";
    })
    .catch(function () {
      // No plate, no mountain. Nothing else on the page depends on it.
    });

  var resizeTimer = 0;
  var lastKey = "";

  window.addEventListener("resize", function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(draw, 200);
  });

  // The plate is a baked bitmap, so its ink is baked in with it: crossing
  // twilight means re-dithering, exactly as it does in the hero.
  onSkyPhase(draw);
  listenMedia(window.matchMedia("(prefers-color-scheme: dark)"), draw);

  function draw() {
    if (!ready) return;

    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var cssWidth = canvas.clientWidth;
    var cssHeight = canvas.clientHeight;
    if (!cssWidth || !cssHeight) return;

    var width = Math.round(cssWidth * dpr);
    var height = Math.round(cssHeight * dpr);
    var dark = isNight();

    // Re-dithering a band is tens of milliseconds. Only pay it when something
    // that changes the plate actually changed.
    var key = width + "x" + height + (dark ? "n" : "d");
    if (key === lastKey) return;
    lastKey = key;

    canvas.width = width;
    canvas.height = height;

    var crop = bandCrop(width / height, cssWidth < 760);

    buffer.width = width;
    buffer.height = height;
    bufferCtx.clearRect(0, 0, width, height);
    bufferCtx.drawImage(plate, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
    var source = bufferCtx.getImageData(0, 0, width, height).data;

    skyline = buildSkyline(crop, width, height);
    var theme = dark ? SKY_THEMES.dark : SKY_THEMES.light;
    var paper = new Float32Array(width * height);

    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        var i = y * width + x;
        if (y < skyline[x]) {
          paper[i] = 1;
          continue;
        }
        var p = i * 4;
        // Rec.709 luminance, the same measurement the hero dithers.
        var luminance = 0.2126 * source[p] + 0.7152 * source[p + 1] + 0.0722 * source[p + 2];
        paper[i] = terrainPaper(luminance, dark);
      }
    }

    var dots = atkinsonTiers(paper, skyline, width, height);
    var image = ctx.createImageData(width, height);
    var output = image.data;
    var ramp = theme.terrainRamp;
    var red = [];
    var green = [];
    var blue = [];

    for (var t = 0; t < TERRAIN_TIERS; t += 1) {
      var rgb = parseInt(ramp[t].ink.replace("#", ""), 16);
      red[t] = (rgb >> 16) & 255;
      green[t] = (rgb >> 8) & 255;
      blue[t] = rgb & 255;
    }

    // The same sparse thinning the hero applies just under the skyline, so the
    // crest is a printed edge rather than a cut one.
    var edgeDepth = Math.max(3, Math.round(4 * dpr));
    var seed = width * 13 + height * 29 + 701;

    for (var index = 0; index < dots.length; index += 1) {
      var tier = dots[index];
      if (tier >= TERRAIN_TIERS) continue;

      var py = Math.floor(index / width);
      var px = index - py * width;
      var distance = py - skyline[px];
      var edgeMix = smoothstep(0, edgeDepth, distance);

      if (distance < edgeDepth && hash2(px, py, seed) < (1 - edgeMix) * 0.1) continue;

      var q = index * 4;
      output[q] = red[tier];
      output[q + 1] = green[tier];
      output[q + 2] = blue[tier];
      output[q + 3] = Math.round(
        theme.terrainAlpha * 255 * ramp[tier].weight * (0.78 + edgeMix * 0.22)
      );
    }

    ctx.putImageData(image, 0, 0);

    // Tier 0 is the crest ink: the loose pixels above the ridge are the same
    // colour the ridge line itself prints in.
    inkRGB = [red[0], green[0], blue[0]];
    scale = dpr;
    startAir(width, height);
    startDrift();
  }

  // The sky above the range, where the grains live. Sized in CSS pixels at the
  // device ratio like every other plate here, and sitting behind the words: the
  // page body is the layer above it, so nothing ever drifts over the reading.
  function startDrift() {
    if (!drift) {
      drift = document.createElement("canvas");
      drift.id = "drift";
      drift.setAttribute("aria-hidden", "true");
      var page = canvas.closest(".page");
      if (!page) return;
      page.insertBefore(drift, page.firstChild);
      driftCtx = drift.getContext("2d");
      onFrame(stepDrift);
    }

    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    drift.width = Math.round(drift.clientWidth * dpr);
    drift.height = Math.round(drift.clientHeight * dpr);
    grains.length = 0;

    // Seeded mid-flight rather than from nothing: a visitor arrives to weather
    // already happening, instead of watching an empty sky fill up for the first
    // ten seconds.
    var now = performance.now();
    spawn(now, drift.clientWidth, dpr, 90);
    for (var i = 0; i < grains.length; i += 1) {
      grains[i].age = grains[i].life * hashUnit(i * 3.1) * 0.85;
      grains[i].x += grains[i].vx * (grains[i].age / 1000);
      grains[i].y += grains[i].vy * (grains[i].age / 1000);
    }

    // Draw one frame straight away rather than waiting on the scheduler, so the
    // sky is never briefly empty after a resize, and so the reduced-motion field
    // is painted even where frames are throttled to nothing.
    stepDrift(now);
  }


  // Where the crest sits in the drift canvas, for a given x across it. The band
  // is anchored to the bottom of that canvas, so the two share an x axis and the
  // skyline only has to be shifted down by the sky's height.
  function crestAt(cssX, dpr) {
    if (!skyline || !canvas.clientWidth) return null;
    var band = canvas.clientHeight;
    var sky = drift.clientHeight - band;
    var index = Math.round((cssX / canvas.clientWidth) * (skyline.length - 1));
    if (index < 0 || index >= skyline.length) return null;
    return sky + skyline[index] / dpr;
  }

  function stepDrift(now) {
    if (!driftCtx || !skyline || !inkRGB) return;

    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    var width = drift.clientWidth;
    var height = drift.clientHeight;
    if (!width || !height) return;

    if (drift.width !== Math.round(width * dpr)) {
      drift.width = Math.round(width * dpr);
      drift.height = Math.round(height * dpr);
    }

    var elapsed = lastDriftFrame ? Math.min(64, now - lastDriftFrame) : 16;
    lastDriftFrame = now;

    var still = motionMedia.matches;
    var grainSize = Math.max(1, Math.round(dpr));

    // The gust is the deterministic one DESIGN.md asks for: the first arrives a
    // few seconds in, later ones at irregular tens of seconds.
    if (!nextGust) nextGust = now + 3200;
    if (now > nextGust) {
      gustUntil = now + 1400 + hashUnit(now) * 1200;
      nextGust = now + GUST_MIN_MS + hashUnit(now * 0.7) * (GUST_MAX_MS - GUST_MIN_MS);
    }
    var gusting = now < gustUntil;

    if (!still && grains.length < DRIFT_MAX && now - lastSpawn > DRIFT_SPAWN_MS) {
      lastSpawn = now;
      spawn(now, width, dpr, gusting ? 4 : 1);
    }

    driftCtx.clearRect(0, 0, drift.width, drift.height);

    for (var i = grains.length - 1; i >= 0; i -= 1) {
      var grain = grains[i];

      if (!still) {
        grain.age += elapsed;
        var push = gusting ? 2.4 : 1;
        grain.x += grain.vx * push * (elapsed / 1000);
        grain.y += grain.vy * (elapsed / 1000);
      }

      if (grain.age >= grain.life || grain.x > width + 8 || grain.y < -8) {
        grains.splice(i, 1);
        continue;
      }

      // In and out over its own lifetime, so grains arrive and leave rather than
      // blinking on at full strength.
      var t = grain.age / grain.life;
      var presence = Math.sin(Math.PI * t);
      var px = Math.round(grain.x * dpr);
      var py = Math.round(grain.y * dpr);

      // The same ordered-dither gate the plate uses: a grain is a printed dot or
      // it is nothing. Never a translucent smudge.
      if (bayerThreshold(px, py) >= presence * grain.weight) continue;

      driftCtx.fillStyle =
        "rgba(" + inkRGB[0] + "," + inkRGB[1] + "," + inkRGB[2] + "," +
        (0.42 + 0.38 * presence).toFixed(3) + ")";
      // One CSS pixel, not one device pixel. The plate below can print at device
      // resolution because it is a dense field; a scattering of half-pixel dots
      // on a retina screen is invisible.
      driftCtx.fillRect(px, py, grainSize, grainSize);
    }
  }

  // Grains come off the crest, and more often off the high parts of it, which is
  // where wind actually strips snow from a ridge.
  function spawn(now, width, dpr, count) {
    for (var n = 0; n < count; n += 1) {
      var seed = now * 0.013 + n * 7.3 + grains.length;
      var cssX = hashUnit(seed) * width;
      var crest = crestAt(cssX, dpr);
      if (crest === null) return;

      // Two tries at a high spot: sample twice and keep the higher crest, which
      // biases the field toward the summits without excluding anywhere.
      var altX = hashUnit(seed * 1.7 + 4.2) * width;
      var altCrest = crestAt(altX, dpr);
      if (altCrest !== null && altCrest < crest) {
        cssX = altX;
        crest = altCrest;
      }

      grains.push({
        x: cssX,
        y: crest - hashUnit(seed * 2.3) * 3,
        vx: 5 + hashUnit(seed * 3.1) * 26,
        vy: -(4 + hashUnit(seed * 4.7) * 20),
        life: 5200 + hashUnit(seed * 5.9) * 7000,
        age: 0,
        weight: 0.62 + hashUnit(seed * 6.7) * 0.55
      });
    }
  }

  // A second canvas for the moving pixels, so the plate underneath is dithered
  // once and never repainted. Only the thin band above the crest is ever
  // cleared, which is what keeps this cheap enough for a page that is mostly
  // there to be read.
  function startAir(width, height) {
    if (!air) {
      air = document.createElement("canvas");
      air.id = "ridge-air";
      air.setAttribute("aria-hidden", "true");
      canvas.parentNode.insertBefore(air, canvas.nextSibling);
      airCtx = air.getContext("2d");
      onFrame(drawAir);
    }

    air.width = width;
    air.height = height;
    drawAir(performance.now());
  }

  // prefers-reduced-motion freezes the same field at a stable phase rather than
  // removing it, so the composition is identical, just still.
  function drawAir(now) {
    if (!skyline || !inkRGB || !airCtx) return;

    var time = motionMedia.matches ? AIR_FROZEN : now;
    var band = AIR_BAND * scale;
    var width = air.width;

    airCtx.clearRect(0, 0, width, Math.ceil(band) + 2);
    airCtx.save();

    for (var x = 0; x < width; x += AIR_STRIDE) {
      var top = skyline[x];
      if (top <= 0 || top >= air.height) continue;

      airCtx.clearRect(x, Math.max(0, top - band - 2), AIR_STRIDE, band + 2);

      // One slow term per column, so a stretch of crest can lift together the
      // way wind off a summit does, rather than every pixel deciding alone.
      var gust = 0.5 + flickerOffset(x * 0.004, time * 0.35, 1);

      for (var d = 1; d <= band; d += 1) {
        var y = top - d;
        if (y < 0) break;

        // Each pixel keeps its own long cycle on top of that. flickerOffset is
        // the same smooth noise the hero's terrain flickers on, so these pixels
        // breathe at the same rate as the ones in the plate below them.
        var own = 0.5 + flickerOffset(x * 0.0137 + y * 0.31, time, 1);

        // Density falls off fast with height, so the crest stays decisive and
        // only a few pixels ever get far from it.
        var strength = (own * 0.65 + gust * 0.35) * (1 - smoothstep(0, band, d));
        if (bayerThreshold(x, y) >= strength * 0.75) continue;

        airCtx.fillStyle =
          "rgba(" + inkRGB[0] + "," + inkRGB[1] + "," + inkRGB[2] + "," +
          (0.5 * strength).toFixed(3) + ")";
        airCtx.fillRect(x, y, 1, 1);
      }
    }

    airCtx.restore();
  }

  // The hero fits the whole photograph to a whole viewport. A band at the foot of
  // a page cannot do that: at six-to-one the proportional crop is a horizontal
  // slice a few hundred pixels tall, and this ridge falls 575 pixels from its
  // highest peak to its lowest saddle -- so most of the range ended up below the
  // slice and printed as empty sky.
  //
  // So the band is cropped to the ridge instead of to the frame. It takes as much
  // of the photograph's width as it can while still being tall enough to hold the
  // whole fall of the skyline, and sits with the highest peak a tenth of the way
  // down. The proportions of the photograph are never stretched; only how much of
  // it is in view changes.
  function bandCrop(aspect, portrait) {
    var plateW = plate.naturalWidth;
    var plateH = plate.naturalHeight;

    var sw = plateW;
    var sh = Math.min(plateH, sw / aspect);
    var sx = 0;
    var span = ridgeSpan(0, plateW);

    // A narrow frame gets a narrower crop of the same range rather than a
    // squeezed copy of it -- the same rule the hero follows.
    if (sh < span.range * RIDGE_FILL) {
      sh = Math.min(plateH, span.range * RIDGE_FILL);
      sw = Math.min(plateW, sh * aspect);
      sx = clamp(plateW * (portrait ? 0.55 : 0.52) - sw / 2, 0, plateW - sw);
      span = ridgeSpan(sx, sx + sw);
    }

    var sy = clamp(span.min - sh * 0.1, 0, Math.max(0, plateH - sh));
    return { sx: sx, sy: sy, sw: sw, sh: sh };
  }

  // Highest and lowest the photographed skyline gets between two source columns.
  function ridgeSpan(fromX, toX) {
    var ys = skylineData.y;
    var step = skylineData.step || 1;
    var first = clamp(Math.floor(fromX / step), 0, ys.length - 1);
    var last = clamp(Math.ceil(toX / step), 0, ys.length - 1);
    var min = Infinity;
    var max = -Infinity;

    for (var i = first; i <= last; i += 1) {
      if (ys[i] < min) min = ys[i];
      if (ys[i] > max) max = ys[i];
    }

    return { min: min, max: max, range: Math.max(1, max - min) };
  }

  // The ridge trace is a y-per-step sample of the source photograph, so it maps
  // through the crop the same way any other source coordinate does.
  function buildSkyline(crop, width, height) {
    var skyline = new Int32Array(width);
    var ys = skylineData.y;
    var step = skylineData.step || 1;

    for (var x = 0; x < width; x += 1) {
      var sourceX = crop.sx + ((x + 0.5) / width) * crop.sw - 0.5;
      var position = clamp(sourceX / step, 0, ys.length - 1);
      var left = Math.floor(position);
      var right = Math.min(ys.length - 1, left + 1);
      var sourceY = ys[left] + (ys[right] - ys[left]) * (position - left);
      skyline[x] = clamp(Math.round(((sourceY - crop.sy) / crop.sh) * height), 0, height);
    }

    return skyline;
  }
}
