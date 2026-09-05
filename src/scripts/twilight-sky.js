import {
  clamp,
  smoothstep,
  lerp,
  hashUnit as hash,
  bayerThreshold,
  baseState,
  isNight,
  onSkyPhase,
  onFrame,
  flickerOffset,
  effects,
  budget,
  motionMedia
} from "./sky-shared.js";
import { drawSnow, drawConstellations, figureHits, drawRidge, drawBodyHalo, drawBodyPulse, buildMoon, paintMoonSolids, drawMoon } from "./sky-effects.js";

(function () {
  "use strict";

  var canvas = null;
  var ctx = null;
  var tries = 0;


  // The sky and afterglow are expensive to redraw, so they are painted once into
  // `base`. The animated corona then only has to restore the sun's bounding box
  // from that snapshot each frame instead of re-dithering the whole sky.
  var base = null;
  var baseCtx = null;
  var sunScene = null;
  var ridgeScene = null;
  var moonScene = null;
  var sunPaused = false;
  var lastSunFrame = 0;


  var PALETTES = {
    day: { top: "#e2e7e5", horizon: "#ead7bb" },
    gold: { top: "#eaded8", horizon: "#dfa27c" },
    civil: { top: "#d8d7dc", horizon: "#d89373" },
    nautical: { top: "#c9cdd6", horizon: "#d6b2a2" },
    night: { top: "#dadbe0", horizon: "#e4dbd4" }
  };







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
    (document.getElementById("sky-stage") || document.body).appendChild(canvas);
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
        var density = envelope * envelope * 0.86 * (0.08 + 0.92 * inkRoom(x, y, state));
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
        var density = (1 - distance) * peak * 0.42 * inkRoom(x, y, state);
        if (density <= bayerThreshold(x / step, y / step)) continue;
        ctx.fillRect(x, y, step, step);
      }
    }
  }

  // This layer paints an opaque sky over sky-v3's canvas, so the sun the visitor
  // sees has to be drawn here. It used to be placed from
  // `clamp(azimuth / Math.PI, -0.5, 0.5)` -- azimuth arrives in DEGREES from this
  // build of suncalc, so that clamp was permanently saturated and pinned a sun to
  // x = 0.89 * width at every hour of the day. It also landed a beat after
  // sky-v3's hidden disc, which read as the sun jumping to the top-right on load.
  // Placement now comes from the renderer's own sunrise-to-sunset projection.
  // A wisp's life runs dot -> plus -> cross -> dot before it thins out. These are
  // the shapes an ordered dither already produces at rising density, so the motion
  // reads as the dither breathing rather than as sprites drifting over it.
  var GLYPHS = [
    [[0, 0]],
    [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]],
    [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]],
    [[0, 0]]
  ];

  function drawGlyph(x, y, core, life, width, skyline) {
    var cells = GLYPHS[Math.min(3, Math.floor(life * 4))];
    for (var i = 0; i < cells.length; i++) {
      var gx = x + cells[i][0] * core;
      var gy = y + cells[i][1] * core;
      if (gx < 0 || gx >= width || gy < 0 || gy >= skyline[gx]) continue;
      ctx.fillRect(gx, gy, core, core);
    }
  }

  // sky-v3 seeds drifting dust along the ridge, but this layer paints an opaque
  // sky on top of it, so none of it was ever visible in light mode. Re-seed it
  // here: pale wisps that lift off the skyline, lean with a slow gust, and thin out.
  function buildRidge(state, tint, night) {
    var dpr = state.dpr;
    var core = Math.max(1, Math.round(dpr));
    var count = state.portrait ? 52 : 94;
    var motes = [];

    for (var i = 0; i < count; i++) {
      var x = Math.round(hash(i * 5.13) * (state.width - 1));
      var ridge = state.skyline[x];
      if (!ridge || ridge <= 0 || ridge >= state.height) continue;
      motes.push({
        x: x,
        y: ridge - core,
        rise: (28 + hash(i * 2.7) * 62) * dpr,
        sway: (4 + hash(i * 9.1) * 13) * dpr,
        period: 9000 + hash(i * 4.4) * 11000,
        phase: hash(i * 1.9),
        // At noon the wisp tint matches the page and they are invisible; against
        // a warm dusk sky the same alpha made them the busiest thing on screen.
        // Trimmed so golden hour is not more restless than midday.
        alpha: night ? 0.065 + hash(i * 6.6) * 0.115 : 0.105 + hash(i * 6.6) * 0.16
      });
    }

    ridgeScene = {
      motes: motes,
      core: core,
      width: state.width,
      skyline: state.skyline,
      tint: tint
    };
  }

  function renderRidge(now) {
    if (!ridgeScene || motionMedia.matches) return;
    ctx.fillStyle = ridgeScene.tint;

    for (var i = 0; i < ridgeScene.motes.length; i++) {
      var m = ridgeScene.motes[i];
      var life = (now / m.period + m.phase) % 1;
      var y = Math.round(m.y - life * m.rise);
      var x = Math.round(m.x + Math.sin(life * Math.PI * 1.6 + m.phase * 6.28) * m.sway);
      ctx.globalAlpha = clamp(m.alpha * Math.sin(Math.PI * life), 0, 1);
      if (ctx.globalAlpha < 0.01) continue;
      drawGlyph(x, y, ridgeScene.core, life, ridgeScene.width, ridgeScene.skyline);
    }
    ctx.globalAlpha = 1;
  }

  // Dither-threshold animation, after the technique on dark.ronacher.eu: instead
  // of moving anything, re-decide each dithered cell every frame against a
  // threshold nudged by slow value noise. Only cells sitting near their threshold
  // can flip, so the texture crawls organically while the shape stays put.
  //
  // Their version is a WebGL shader over the whole image. This renderer dithers on
  // the CPU, so cells are split at build time: ones safely above or below their
  // threshold are baked into the cached base layer, and only the marginal ones are
  // re-evaluated per frame. Same look, a few hundred cells of work instead of tens
  // of thousands.
  var FLICKER_BAND = 0.13;
  var FLICKER_AMP = 0.15;


  // Atmosphere yields to the writing, with a feathered margin rather than a panel.
  var copyBox = null;
  function measureCopy(state) {
    var copy = document.querySelector(".hero-copy");
    if (!copy) { copyBox = null; return; }
    var a = copy.getBoundingClientRect(), b = canvas.getBoundingClientRect();
    var scale = state.dpr;
    copyBox = { left: (a.left-b.left)*scale, right: (a.right-b.left)*scale,
      top: (a.top-b.top)*scale, bottom: (a.bottom-b.top)*scale };
  }
  function inkRoom(x, y, state) {
    if (!copyBox) return 1;
    var dx = Math.max(copyBox.left-x, 0, x-copyBox.right);
    var dy = Math.max(copyBox.top-y, 0, y-copyBox.bottom);
    return smoothstep(12*state.dpr, 80*state.dpr, Math.hypot(dx, dy));
  }
  function clearOfCopy(state, x, y, radius) {
    if (!copyBox || x+radius < copyBox.left || x-radius > copyBox.right || y-radius > copyBox.bottom || y+radius < copyBox.top) return y;
    var below = copyBox.bottom + radius + 24*state.dpr;
    var ridge = state.skyline[clamp(Math.round(x), 0, state.width-1)];
    if (below + radius < ridge) return below;
    return Math.max(radius + 72*state.dpr, copyBox.top-radius-20*state.dpr);
  }

  // A broad, irregular cloud bank counterbalances the writing. Baked once into
  // the sky, so there is no extra animation loop or per-frame cloud rasterization.
  function drawDayClouds(state, altitude) {
    if (altitude < 0 || state.portrait) return;
    var step = Math.max(2, Math.round(state.dpr*1.6));
    ctx.fillStyle = "#fbf4e7";
    var banks = [[0.75,0.23,0.24,0.07], [0.91,0.33,0.24,0.055], [0.62,0.18,0.13,0.04]];
    for (var y=step; y<state.height*0.46; y+=step) {
      for (var x=Math.round(state.width*0.4); x<state.width; x+=step) {
        if (y>=state.skyline[x]) continue;
        var density=0;
        for (var i=0;i<banks.length;i++) {
          var c=banks[i], nx=(x/state.width-c[0])/c[2];
          var ripple=Math.sin(nx*7+i)*0.14+Math.sin(nx*17+i)*0.07;
          var ny=(y/state.height-c[1])/c[3]+ripple;
          density=Math.max(density, Math.max(0,1-nx*nx-ny*ny));
        }
        density *= (0.6+0.18*Math.sin(x/state.dpr*0.025+y/state.dpr*0.06))*inkRoom(x,y,state);
        if(density>bayerThreshold(x/step,y/step)) ctx.fillRect(x,y,step,step);
      }
    }
  }

  function buildSun(state, altitude, valleyX) {
    sunScene = null;
    if (altitude <= -0.83) return;

    var dpr = state.dpr;
    var radius = Math.round((state.portrait ? 30 : 44) * dpr);
    var core = Math.max(1, Math.round(dpr));

    // The corona answers to the hour: tight and contained at noon, spreading and
    // thickening as the sun drops toward the ridge and the light goes long.
    var blaze = 1 - smoothstep(2, 55, altitude);
    var coronaR = radius * (1.35 + blaze * 0.55);
    var spread = 0.5 + blaze * 0.42;
    // The low sun's corona covers ~3x the area of the noon one, so constant
    // settings would treble the motion exactly when the sky is at its most
    // dramatic and most worth looking at. The band is scaled by the inverse of
    // that area so the amount of flicker stays roughly flat across the day.
    var band = FLICKER_BAND * (1 - blaze * 0.66);
    var amp = FLICKER_AMP * (1 - blaze * 0.5);

    var lowBlend = 1 - smoothstep(4, 15, altitude);
    var composedX = state.portrait ? state.celestial.sun.x : state.width * (0.65 + 0.22 * clamp(state.celestial.sun.x / state.width, 0, 1));
    var sunX = Math.round(lerp(composedX, valleyX, lowBlend * 0.35));
    var ridgeY = state.skyline[clamp(sunX, 0, state.width - 1)];
    var sunY = Math.round(lerp(state.celestial.sun.y, ridgeY - radius * 0.55, lowBlend));
    sunY = clearOfCopy(state, sunX, sunY, radius * 1.4);

    var solid = [];
    var marginal = [];

    for (var cy = Math.floor(sunY - coronaR); cy <= sunY + coronaR; cy += core) {
      for (var cx = Math.floor(sunX - coronaR); cx <= sunX + coronaR; cx += core) {
        if (cx < 0 || cx >= state.width || cy < 0 || cy >= state.skyline[cx]) continue;
        var dx = cx - sunX;
        var dy = cy - sunY;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > coronaR) continue;

        var bayer = bayerThreshold(cx / core, cy / core);
        var density;
        var alpha;

        if (d <= radius) {
          // Solid to the rim. The old dithered limb thinned cells to ~50% just
          // inside the edge while the corona started at ~100% just outside it,
          // and that mismatch was the pale ring around the sun. All of the
          // softening now happens outside the disc, in the corona's falloff.
          density = 1;
          alpha = 1;
        } else {
          // Start the corona inside the disc's dithered limb, otherwise the sparse
          // annulus between the two reads as a pale eclipse ring around the sun.
          // Density and alpha both reach 1 at the rim so the corona is continuous
          // with the disc. Capping alpha at 0.72 left a step at the limb that read
          // as a pale ring around the sun.
          var falloff = 1 - (d - radius) / (coronaR - radius);
          density = Math.pow(falloff, 1.9) * spread + Math.pow(falloff, 14) * (1 - spread);
          alpha = 0.05 + Math.pow(falloff, 1.15) * 0.95;
        }

        // density >= 1 is the disc's solid body. Without this guard the cells whose
        // Bayer threshold happens to sit above 0.8 fall inside the flicker band and
        // punch holes through the nucleus.
        var margin = density >= 0.98 ? 1 : density - bayer;
        if (margin > band) solid.push(cx, cy, alpha);
        else if (margin > -band) marginal.push({ x: cx, y: cy, a: alpha, d: density, b: bayer, s: hash(cx * 0.37 + cy * 0.71) });
      }
    }

    sunScene = {
      solid: solid,
      marginal: marginal,
      amp: amp,
      disc: { x: sunX, y: sunY, radius: radius },
      core: core,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#9d4429"
    };
  }

  // Baked into the cached layer once, so the per-frame pass only touches flickers.
  function paintSunSolids() {
    if (!sunScene) return;
    ctx.fillStyle = sunScene.accent;
    var core = sunScene.core;
    var solid = sunScene.solid;
    for (var i = 0; i < solid.length; i += 3) {
      ctx.globalAlpha = solid[i + 2];
      ctx.fillRect(solid[i], solid[i + 1], core, core);
    }
    ctx.globalAlpha = 1;
  }

  function renderSun(now) {
    if (!sunScene || !ctx) return;
    var core = sunScene.core;
    var still = motionMedia.matches;
    ctx.fillStyle = sunScene.accent;

    for (var i = 0; i < sunScene.marginal.length; i++) {
      var m = sunScene.marginal[i];
      var threshold = still ? m.b : m.b + flickerOffset(m.s, now, sunScene.amp);
      if (m.d <= threshold) continue;
      ctx.globalAlpha = m.a;
      ctx.fillRect(m.x, m.y, core, core);
    }
    ctx.globalAlpha = 1;
  }

  // What the readout points at. CSS pixels, because that is what a pointer uses.
  function publishBodies(state) {
    var scale = state.dpr;
    var rect = canvas.getBoundingClientRect();
    window.__skyBodies = {
      top: rect.top,
      left: rect.left,
      sun: sunScene && sunScene.disc
        ? { x: sunScene.disc.x / scale, y: sunScene.disc.y / scale, r: sunScene.disc.radius / scale }
        : null,
      moon: moonScene && moonScene.centre
        ? { x: moonScene.centre.x / scale, y: moonScene.centre.y / scale, r: moonScene.centre.r / scale }
        : null,
      // Only while they are actually drawn. figureHits is rebuilt inside
      // drawConstellations, which does not run in daylight, so the list from the
      // last dark frame used to survive and stay hoverable over a sunlit sky.
      figures: state.dark ? figureHits : []
    };
  }

  function skyDate() {
    var api = window.__portfolioSky;
    return api && api.clock ? api.clock() : new Date();
  }

  var accentCache = "";
  var accentPhase = null;

  function pageInk() {
    return getComputedStyle(document.documentElement).getPropertyValue("--page").trim() || "#eee9df";
  }

  function accentInk() {
    var phase = document.documentElement.dataset.sky;
    if (phase !== accentPhase || !accentCache) {
      accentPhase = phase;
      accentCache = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#9d4429";
    }
    return accentCache;
  }

  function moonInk(night) {
    // Bone against a dark sky; the page's own ink when the sky is bright, so a
    // daytime moon reads as a pale disc rather than a glowing one.
    return night ? "#e4dac8" : "#8b8578";
  }

  function renderScene(now) {
    if (!base || !ctx) return;
    // One GPU blit of the cached sky is cheaper and far simpler than tracking
    // dirty rectangles for motes spread along the whole ridge.
    ctx.clearRect(0, 0, base.width, base.height);
    ctx.drawImage(base, 0, 0);
    renderRidge(now);
    drawMoon(ctx, moonScene, moonInk(isNight()), now, motionMedia.matches);
    renderSun(now);

    var state = baseState();
    if (!state) return;
    // Always at night now, quietly. "stars" lifts them rather than summoning them.
    if (state.dark) drawConstellations(ctx, state, skyDate(), effects.stars, effects.hovered);
    // Touch feedback sits above the bodies but below the weather. `night` is
    // local to draw(); reaching for it here threw on every frame that had a
    // pulse running, which killed the rest of this function -- including
    // publishBodies, so the moon quietly stopped being hoverable.
    var sunDisc = sunScene && sunScene.disc;
    var moonDisc = moonScene && moonScene.centre;
    var moonTone = moonInk(state.dark);
    var accent = accentInk();

    // The sun's rim is drawn in the page colour so it cuts through its own
    // corona; the moon's is bone, because it sits on empty sky.
    if (effects.bodyHover === "sun") drawBodyHalo(ctx, state, sunDisc, pageInk(), 1, now);
    if (effects.bodyHover === "moon") drawBodyHalo(ctx, state, moonDisc, moonTone, 1, now);

    if (effects.bodyPulse) {
      var disc = effects.bodyPulse.kind === "sun" ? sunDisc : moonDisc;
      var ink = effects.bodyPulse.kind === "sun" ? accent : moonTone;
      if (!disc || !drawBodyPulse(ctx, state, disc, ink, effects.bodyPulse, now)) effects.bodyPulse = null;
    }

    if (effects.snow) drawSnow(ctx, state, now);
    if (effects.ridge) drawRidge(ctx, state);
    publishBodies(state);
    budget.sunCells = sunScene ? sunScene.marginal.length : 0;
    budget.wisps = ridgeScene ? ridgeScene.motes.length : 0;
  }

  // 24fps is plenty for a shimmer this slow. The loop itself is shared.
  function sunFrame(now) {
    if (sunPaused) return;
    if (now - lastSunFrame < 1000 / 24) return;
    lastSunFrame = now;
    renderScene(now);
  }

  function stopSunLoop() {
    sunPaused = true;
  }

  function startSunLoop() {
    sunPaused = false;
  }

  function snapshotBase(state) {
    if (!base) {
      base = document.createElement("canvas");
      baseCtx = base.getContext("2d", { alpha: true });
    }
    if (base.width !== state.width || base.height !== state.height) {
      base.width = state.width;
      base.height = state.height;
    }
    baseCtx.clearRect(0, 0, state.width, state.height);
    baseCtx.drawImage(canvas, 0, 0);
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

    measureCopy(state);
    ctx.clearRect(0, 0, state.width, state.height);
    stopSunLoop();
    sunScene = null;
    ridgeScene = null;
    moonScene = null;

    // This build of suncalc reports altitude and azimuth in DEGREES, not radians.
    var altitude = state.celestial.sun.altitude;
    var night = isNight();
    var colors = palette(altitude);
    var valleyX = findValleyX(state);

    // The page's own colours flip at -6 degrees, but the sky does not: there are
    // another twelve degrees of real twilight after that. Painting stopped dead
    // at the flip, so dusk cut straight to black. The dithered sky now carries on
    // through nautical and astronomical twilight, thinning to nothing by -18,
    // which also lets the stars come out gradually underneath instead of
    // switching on.
    var veil = typeof state.veil === "number" ? state.veil : (altitude > -6 ? 1 : clamp((altitude + 18) / 12, 0, 1));

    if (veil > 0.01) {
      ctx.save();
      clipSky(state);
      ctx.globalAlpha = veil;
      drawDitheredSky(state, colors);
      drawAfterglow(state, altitude, valleyX);
      drawDayClouds(state, altitude);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    buildRidge(state, night ? "#e4dac8" : colors.top, night);
    // Both bodies, every hour. A moon hanging in a sunset is the commonest sight
    // in the sky and the old night-only moon could never show it.
    moonScene = buildMoon(state, clearOfCopy);
    buildSun(state, altitude, valleyX);
    paintSunSolids();
    paintMoonSolids(ctx, moonScene, moonInk(night));
    snapshotBase(state);
    renderScene(performance.now());
    startSunLoop();
  }

  function redrawSoon() {
    window.clearTimeout(redrawSoon.timer);
    redrawSoon.timer = window.setTimeout(draw, 180);
  }

  onFrame(sunFrame);
  onSkyPhase(redrawSoon);
  // A clock step moves the sun and repaints the palette, so this layer is stale.
  window.addEventListener("skyclockstep", draw);
  if (motionMedia.addEventListener) motionMedia.addEventListener("change", redrawSoon);
  else if (motionMedia.addListener) motionMedia.addListener(redrawSoon);
  window.addEventListener("resize", redrawSoon, { passive: true });
  window.addEventListener("herocopyplaced", redrawSoon);

  // Coming back to a tab that has been in the background for an hour used to
  // show an hour-old sun for up to another minute, because the only thing that
  // moved it was this interval and the scene had no idea it had gone stale.
  // rAF is halted while hidden, so nothing else was going to catch it either.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) redrawSoon();
  });

  // Every half minute rather than every minute. The sun crosses the frame at
  // about a pixel a minute, so this is not about covering more ground -- it is
  // that a full minute of dead stillness followed by a step is what reads as a
  // page that has stopped, and half that is enough to read as drift. It is not
  // cheaper than this: the redraw rebuilds the dithered sky, the ridge and both
  // bodies, and costs about 23ms, so it stays as rare as it can stand to be.
  window.setInterval(draw, 30000);

  draw();
})();
