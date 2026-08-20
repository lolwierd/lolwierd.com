import {
  clamp,
  smoothstep,
  lerp,
  hash,
  hash2,
  bayerThreshold,
  isNight,
  onSkyPhase,
  onFrame,
  listenMedia,
  motionMedia,
  budget,
  baseState
} from "./sky-shared.js";

// Daytime had one inhabitant.
//
// Night fills the same frame with a hundred and seventy stars, a moon with a
// real terminator, comets and satellites -- and half of those are events, so
// staying in the hero is repaid. Day had a sun, a shimmer along the ridge and a
// shadow field in the valley: four systems, three of them purely textural, and
// the only thing that ever arrived did so at the bottom of the composition
// where nobody was looking.
//
// This layer is the day's answer to the comet. Everything in it is a real
// phenomenon of a big massif in daylight, and none of it moves the mountain.
(function () {
  "use strict";

  var canvas = null;
  var ctx = null;
  var state = null;
  var width = 0;
  var height = 0;
  var dpr = 1;
  var reducedMotion = motionMedia.matches;

  // Reduced motion freezes the composition at a stable phase rather than
  // emptying it, the same bargain the rest of the scene strikes.
  var FIXED_TIME = 21437;

  var INK = "#293039";

  // The page ground, for a bird crossing dark rock. Read from the stylesheet
  // rather than pinned here, so it cannot drift out of step with the palette.
  var PAPER = "#eee9df";

  var pools = null;

  // The fog field is resolved roughly seven times a second rather than every
  // frame: fast enough that the flow is continuous to look at, slow enough that
  // a warped fbm per cell is not the whole frame budget.
  var POOL_FIELD_MS = 140;
  var POOL_PEAK = 0.14;
  var POOL_ALPHA_STEPS = 4;
  var lastPoolField = 0;
  var birds = [];
  var nextBird = Infinity;

  // A ceiling, not a target. The spawn rate is deliberately slower than the rate
  // they leave the frame, so the number aloft drifts between none and this
  // rather than pinning to it -- an always-full sky is a flock, and a saturated
  // cap also eats the randomised count before it can show.
  var MAX_BIRDS = 4;

  // Birds run on their own clock, not the wall one.
  //
  // A griffon is not on a timer, it is on a thermal, and a thermal is the sun
  // heating a slope. So how many are up and how often another arrives both come
  // off the sun's altitude -- none at dawn, most at midday, gone by dusk. That
  // is also what stops them feeling bolted on: when the typed commands walk the
  // sky to another hour, the birds are already somewhere else too, because they
  // were never reading the hour from anything but the sun.
  //
  // And when a whole day is run in fifteen seconds, this clock runs with it, so
  // they cross the frame as part of the time-lapse instead of plodding through
  // it at wall speed and outliving the day itself.
  var flightClock = 0;
  var lastRealTime = 0;
  var lastSceneTime = 0;
  var timeScale = 1;
  var sunAltitude = 90;
  var lastDraw = 0;

  function valueNoise(x, y, seed) {
    var ix = Math.floor(x);
    var iy = Math.floor(y);
    var fx = x - ix;
    var fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx);
    var uy = fy * fy * (3 - 2 * fy);
    return lerp(
      lerp(hash2(ix, iy, seed), hash2(ix + 1, iy, seed), ux),
      lerp(hash2(ix, iy + 1, seed), hash2(ix + 1, iy + 1, seed), ux),
      uy
    );
  }

  function fbm(x, y, seed) {
    var value = 0;
    var amplitude = 0.58;
    var frequency = 1;
    var normalizer = 0;

    for (var octave = 0; octave < 3; octave++) {
      value += valueNoise(x * frequency, y * frequency, seed + octave * 97) * amplitude;
      normalizer += amplitude;
      frequency *= 2.03;
      amplitude *= 0.47;
    }

    return normalizer ? value / normalizer : 0;
  }

  function warpedField(x, y, time, seed) {
    var inner = fbm(x - time * 0.18, y + time * 0.11, seed);
    return fbm(x + inner * 0.72 + time * 0.16, y + inner * 0.48 - time * 0.10, seed + 211);
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "day-atmosphere";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0 auto auto 0",
      zIndex: "1",
      pointerEvents: "none",
      display: "block"
    });
    (document.getElementById("sky-stage") || document.body).appendChild(canvas);
    ctx = canvas.getContext("2d", { alpha: true });
  }

  // ---------------------------------------------------------------------------
  // Cloud pooling in the saddles
  //
  // The valley inversion, built from the only geometry the page actually has.
  // There is no depth map here -- the plate is one silhouette with one skyline
  // -- so anything claiming to know which ridge stands in front of which would
  // be inventing it.
  //
  // The skyline alone is enough for the honest version. Cloud collects in the
  // low ground and pours through the passes, so the notches in the ridge are
  // exactly where it belongs. At the deepest saddles it is allowed a few pixels
  // above the skyline, because a pass that is full does overtop.
  //
  // "Low" has to mean locally low. Measuring each column against the highest
  // point of the whole range put fog across the entire right-hand side of the
  // plate, simply because that side of the photograph sits lower than the peak
  // in the upper left -- which is the bounded-rectangle mistake again, keyed to
  // a global gradient instead of a window. The measure that works is prominence:
  // how far a column falls below the shoulders standing on either side of it.
  // That finds passes wherever they are and leaves open faces alone.
  // ---------------------------------------------------------------------------
  function shoulderOf(skyline, x, reach, stride) {
    var highest = skyline[x];
    for (var offset = -reach; offset <= reach; offset += stride) {
      var probe = x + offset;
      if (probe < 0 || probe >= width) continue;
      if (skyline[probe] < highest) highest = skyline[probe];
    }
    return highest;
  }

  function buildPools() {
    pools = null;
    if (!state) return;

    var skyline = state.skyline;
    var cells = [];
    var seed = width * 11 + height * 23 + 6607;
    var step = Math.max(1, Math.round(dpr));
    var budgetCap = state.portrait ? 2600 : 4200;

    // A pass is a dip of a decent fraction of the frame, not a metre of noise in
    // the ridge trace, so both the window and the reference are generous.
    var reach = Math.round(width * 0.075);
    var stride = Math.max(1, Math.round(width * 0.004));
    var reference = height * 0.085;

    for (var x = 0; x < width; x += step) {
      var edge = skyline[x];
      if (edge >= height) continue;

      var dip = edge - shoulderOf(skyline, x, reach, stride);
      var depth = smoothstep(0.22, 1, dip / reference);
      if (depth <= 0.02) continue;

      var fall = Math.round(height * (0.016 + depth * 0.055));
      var overtop = Math.round(depth * depth * height * 0.014);

      for (var d = -overtop; d <= fall; d++) {
        var y = edge + d;
        if (y < 0 || y >= height) continue;

        // Densest at the surface of the pool, thinning downward into the basin
        // and upward into the air above the pass.
        var vertical = d < 0
          ? 1 - smoothstep(0, Math.max(1, overtop), -d)
          : 1 - smoothstep(0, fall, d) * 0.85;
        var weight = depth * vertical;
        if (weight <= 0.05) continue;
        if (hash2(x, y, seed) > weight * 0.38) continue;

        cells.push({
          x: x,
          y: y,
          weight: weight,
          threshold: bayerThreshold(x, y),
          seed: hash2(x, y, seed + 53),
          // Resolved by drawPools a few times a second and held in between.
          lit: 0
        });
      }
    }

    // The portrait crop is a zoom into the middle of the range, and it can hold
    // no real pass at all -- it came out with thirty-odd cells, which is not fog,
    // it is a scatter of dust in the sky. Below the point where this reads as
    // weather it is dropped completely; a phone gets the simpler sky and the
    // birds, which is the same call the rest of the scene makes.
    if (cells.length < 600) return;

    // Sampled down to a fixed count so the per-frame cost does not scale with
    // resolution, the same bargain the terrain flicker makes.
    var keepStep = Math.max(1, Math.ceil(cells.length / budgetCap));
    var kept = [];
    for (var i = 0; i < cells.length; i += keepStep) kept.push(cells[i]);
    pools = kept;
    lastPoolField = 0;
  }

  function drawPools(now) {
    if (!pools) return;

    // Two costs live in here and neither of them needed paying every frame.
    //
    // The field is a warped fbm -- two fbms, three octaves each -- and running
    // it per cell per frame was most of a ten millisecond frame on its own. Fog
    // this slow does not change meaningfully in forty milliseconds, so the
    // density is recomputed a few times a second and held in between. Nothing
    // about the motion reads differently; the arithmetic drops by two thirds.
    //
    // The other cost was one fill per cell with a globalAlpha change between
    // each. The cells are bucketed by alpha instead and go down as a handful of
    // paths, the same trick the terrain flicker uses.
    var resolve = now - lastPoolField >= POOL_FIELD_MS;

    if (resolve) {
      lastPoolField = now;
      var t = now * 0.0000042;

      // Fog in a pass is not a texture sitting still, it is air being pushed
      // through a gap. Advecting the sample point sideways streams the density
      // across the notch while the envelope that decides which cells may light
      // at all stays exactly where the ridge put it -- so the fog visibly moves
      // and still cannot spill outside the saddle it belongs to.
      var flow = now * 0.000042;

      for (var i = 0; i < pools.length; i++) {
        var cell = pools[i];
        var field = warpedField(cell.x * 0.0016 - flow, cell.y * 0.0042 + cell.seed * 3, t, 733);

        // A slow swell on top of the flow, so the pool also rises and settles
        // instead of only sliding past.
        var swell = 0.5 + 0.5 * Math.sin(now * 0.000068 + cell.seed * 6.28);
        var density = cell.weight * (0.30 + field * 0.78 + swell * 0.16);
        cell.lit = density >= cell.threshold * 0.68
          ? clamp(density * 0.15, 0, POOL_PEAK)
          : 0;
      }
    }

    var buckets = [];
    var b;
    for (b = 0; b < POOL_ALPHA_STEPS; b++) buckets.push(null);

    var unit = Math.max(1, Math.round(dpr));
    var drawn = 0;

    for (var k = 0; k < pools.length; k++) {
      var lit = pools[k].lit;
      if (lit < 0.005) continue;

      b = clamp(Math.round((lit / POOL_PEAK) * (POOL_ALPHA_STEPS - 1)), 0, POOL_ALPHA_STEPS - 1);
      if (!buckets[b]) buckets[b] = new Path2D();
      buckets[b].rect(pools[k].x, pools[k].y, unit, unit);
      drawn++;
    }

    for (b = 0; b < POOL_ALPHA_STEPS; b++) {
      if (!buckets[b]) continue;
      ctx.globalAlpha = POOL_PEAK * ((b + 1) / POOL_ALPHA_STEPS);
      ctx.fill(buckets[b]);
    }

    budget.poolCells = drawn;
  }

  // ---------------------------------------------------------------------------
  // Birds
  //
  // The arrival. A griffon working the valley is the one thing that can happen
  // in an alpine sky at midday, and it answers the comet: rare, easy to miss,
  // out in the part of the frame that was empty.
  //
  // Motion
  // ------
  // The first version was a straight traverse with a circle laid over it, and
  // the circle was the whole problem. `turns` ran between two and five over the
  // crossing, so a near bird that cleared the frame in nine seconds whipped
  // through a full loop every two -- not a bird riding a thermal, a bird on a
  // fairground ride. Worse, the vertical was re-read from the skyline under a
  // cx that was itself swinging back and forth several times a second, so the
  // height juddered against the ridge profile and then slammed into a clamp.
  // No amount of smoothing frames fixes a path that wrong.
  //
  // A soaring bird crossing a valley holds a long line and lets the air bend it.
  // So the path is a slow traverse with two out-of-phase sine terms on the
  // vertical, their periods measured in whole crossings rather than seconds, and
  // nothing reads the terrain per frame. The silhouette is tilted to whatever
  // direction the path is actually going, sampled from the path itself.
  //
  // Depth
  // -----
  // One number per bird decides size, speed, height and ink together -- the same
  // argument as the aerial perspective on the range. 0 is close, 1 is far off
  // down the valley.
  // ---------------------------------------------------------------------------
  // One place that builds a bird, so the typed command and the thermal produce
  // the same animal rather than two that drift apart.
  function spawn(seed, ceiling, rightward, count, stagger) {
    // Where a bird is allowed to be. The sky band is clear air above the range;
    // the slope band is in front of the mountain itself, which is the half of
    // the frame they were previously forbidden from ever entering.
    var skyTop = height * 0.07;
    var skyFloor = ceiling * 0.92;
    var slopeTop = ceiling * 1.04;
    var slopeFloor = Math.min(height * 0.80, ceiling + height * 0.30);

    for (var i = 0; i < count; i++) {
      var s = seed + i * 977;
      var depth = Math.pow(hash(s + 15), 0.72);
      var nearness = lerp(1, 0.34, depth);

      // Three ways to cross. Most hold the open sky; some come up off the slope
      // and climb out into it; some run the face the whole way.
      var mode = hash(s + 17);
      var entry;
      var exit;

      if (mode < 0.52) {
        entry = lerp(skyTop, skyFloor, hash(s + 18));
        exit = lerp(skyTop, skyFloor, hash(s + 19));
      } else if (mode < 0.78) {
        entry = lerp(slopeTop, slopeFloor, hash(s + 18));
        exit = lerp(skyTop, skyFloor * 0.8, hash(s + 19));
      } else {
        entry = lerp(slopeTop, slopeFloor, hash(s + 18));
        exit = lerp(slopeTop, slopeFloor, hash(s + 19));
      }

      var margin = width * 0.10;

      birds.push({
        start: flightClock + i * stagger * (900 + hash(s + 2) * 2200),

        // Slow. They were crossing in nine seconds, which is a bird being
        // thrown across the frame rather than a bird flying over a valley. A
        // near one now takes twenty seconds and a far one a full minute, which
        // is the same bird at the same airspeed seen from two distances.
        duration: lerp(21000, 62000, depth) * (0.88 + hash(s + 3) * 0.26),

        depth: depth,
        x0: rightward ? -margin : width + margin,
        x1: rightward ? width + margin : -margin,
        entry: entry,
        exit: exit,

        // Under two long undulations across the whole crossing, plus a shorter
        // one to keep the line from being a clean sine. Both scale with nearness
        // so a distant bird's wander is as small as its wings.
        f1: (0.8 + hash(s + 6) * 1.0) * Math.PI * 2,
        f2: (2.0 + hash(s + 7) * 1.6) * Math.PI * 2,
        a1: height * (0.018 + hash(s + 8) * 0.030) * nearness,
        a2: height * (0.006 + hash(s + 9) * 0.012) * nearness,
        p1: hash(s + 20) * Math.PI * 2,
        p2: hash(s + 21) * Math.PI * 2,

        span: (7.0 + hash(s + 10) * 4.0) * dpr * nearness * 1.55,
        scale: 0.86 + hash(s + 12) * 0.30,
        sway: 0.6 + hash(s + 22) * 0.8
      });
    }

  }

  // How well the slope is working. Nothing soars before the sun has put any heat
  // into the rock, and nothing is still up once it has gone off it.
  function thermal() {
    return smoothstep(3, 32, sunAltitude);
  }

  function scheduleBird(now) {
    if (!state) return;

    var lift = thermal();

    // Dead air. Try again shortly in case the sun is climbing.
    if (lift <= 0.02) {
      nextBird = now + 4000;
      return;
    }

    // The ceiling itself answers to the sun: one bird working a weak morning
    // slope, the full four over a midday one.
    var ceilingNow = Math.max(1, Math.round(lerp(1, MAX_BIRDS, lift)));

    if (birds.length >= ceilingNow) {
      nextBird = now + 5000;
      return;
    }

    var ceiling = Math.max(1, state.ridgeTop);
    var seed = Math.floor(now) ^ (width * 3);
    var rightward = hash(seed + 5) > 0.5;

    // Usually one, sometimes a pair, occasionally three. Squared so the small
    // numbers win: a fixed two or three every time is a formation, and these are
    // meant to be birds that happened to be there.
    var roll = hash(seed + 11);
    var count = 1 + Math.floor(roll * roll * 3);
    count = Math.min(count, ceilingNow - birds.length);

    spawn(seed, ceiling, rightward, count, 1);

    // Frequent over a working midday slope, rare over a cold one.
    nextBird = now + lerp(26000, 8000, lift) + hash(seed + 13) * lerp(14000, 9000, lift);
  }

  // The path, as one function of its own progress. Everything that needs to know
  // where a bird is -- the drawing, the tilt, the contrast test -- asks this, so
  // there is exactly one definition of the curve.
  function birdAt(bird, t) {
    var glide = smoothstep(0, 1, clamp(t, 0, 1));
    return {
      x: lerp(bird.x0, bird.x1, t),
      y: lerp(bird.entry, bird.exit, glide) +
        Math.sin(t * bird.f1 + bird.p1) * bird.a1 +
        Math.sin(t * bird.f2 + bird.p2) * bird.a2
    };
  }

  // Ink against paper, paper against ink. A bird in front of the mountain is the
  // same colour as the mountain, so on dark rock it simply disappeared. The
  // photograph's own luminance is already loaded for the dither, so the bird
  // asks it what it is standing against and takes the opposite.
  function birdInk(x, y) {
    if (!state.luminance) return INK;
    var px = clamp(Math.round(x), 0, width - 1);
    var py = clamp(Math.round(y), 0, height - 1);
    if (py < state.skyline[px]) return INK;
    return state.luminance[py * width + px] < 118 ? PAPER : INK;
  }

  function drawBird(bird) {
    var age = flightClock - bird.start;
    if (age < 0) return;

    var life = age / bird.duration;
    if (life >= 1) return;

    var here = birdAt(bird, life);
    var cx = here.x;
    var cy = here.y;

    // NaN fails every comparison, so a bounds check alone is no guard against a
    // bird built from a missing field -- it would draw silently into space.
    if (!isFinite(cx) || !isFinite(cy)) return;
    if (cx < -60 || cx > width + 60 || cy < 0 || cy > height) return;

    // Fade in and out at the ends so it enters the frame rather than appearing
    // in it. Never fully opaque, and thinner the further off it is -- the same
    // aerial perspective the range behind it now has.
    var presence = smoothstep(0, 0.09, life) * (1 - smoothstep(0.88, 1, life));
    if (presence <= 0.01) return;

    // Which way it is actually going, taken from the path rather than from a
    // separate angle that could disagree with it. Measured against the absolute
    // horizontal so a bird heading left tilts nose-down like one heading right,
    // instead of being rotated on to its back.
    var step = 0.006;
    var ahead = birdAt(bird, Math.min(1, life + step));
    var behind = birdAt(bird, Math.max(0, life - step));
    var tilt = Math.atan2(ahead.y - behind.y, Math.abs(ahead.x - behind.x) + 0.0001) * 0.62;

    var cosB = Math.cos(tilt);
    var sinB = Math.sin(tilt);

    // The span breathes a little on its own long cycle: a soaring bird is not
    // held perfectly broadside to you for a whole minute.
    var breathe = 0.78 + 0.22 * Math.sin(life * Math.PI * 2 * bird.sway + bird.p1);
    var spread = bird.span * bird.scale * breathe;
    var unit = Math.max(1, Math.round(dpr));
    var alpha = clamp(lerp(0.54, 0.26, bird.depth) * presence, 0, 0.56);

    ctx.fillStyle = birdInk(cx, cy);

    // A body two cells deep. One left the wings meeting at a point with nothing
    // in the middle, and the eye needs a centre to read a bird around.
    ctx.globalAlpha = alpha;
    ctx.fillRect(Math.round(cx), Math.round(cy), unit, unit * 2);

    // A soaring raptor holds its wings in a shallow V -- tips highest, rising
    // steadily from the shoulder -- with the outer primaries splayed and
    // drooping at the very end.
    for (var side = -1; side <= 1; side += 2) {
      var cells = Math.max(3, Math.round(spread / unit));

      for (var c = 1; c <= cells; c++) {
        var along = c / cells;
        var wx = side * along * spread;
        var wy = -Math.pow(along, 0.78) * spread * 0.34;
        if (along > 0.86) wy += spread * 0.20;

        var rx = wx * cosB - wy * sinB;
        var ry = wx * sinB + wy * cosB;

        ctx.globalAlpha = alpha * (1 - along * 0.22);
        ctx.fillRect(Math.round(cx + rx), Math.round(cy + ry), unit, unit);
      }
    }
  }

  function drawBirds() {
    for (var i = birds.length - 1; i >= 0; i--) {
      if (flightClock - birds[i].start >= birds[i].duration) {
        birds.splice(i, 1);
        continue;
      }
      drawBird(birds[i]);
    }

    budget.birds = birds.length;
  }

  function rebuild() {
    if (!state) return;

    width = state.width;
    height = state.height;
    dpr = state.dpr;

    PAPER = getComputedStyle(document.documentElement)
      .getPropertyValue("--page").trim() || "#eee9df";

    ensureCanvas();
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = state.cssWidth + "px";
    canvas.style.height = state.cssHeight + "px";

    birds = [];
    pools = null;

    if (isNight()) {
      ctx.clearRect(0, 0, width, height);
      nextBird = Infinity;
      return;
    }

    buildPools();

    // Later than the comet's four and a half seconds on purpose. Night is
    // supposed to feel populated the moment you arrive; midday is supposed to
    // feel still, and then have something in it.
    var boot = performance.now();

    // Sooner than the comet. A visit is short, the birds are the only thing that
    // happens in daylight, and one that arrives after you have gone is the same
    // as no bird at all.
    flightClock = 0;
    lastRealTime = 0;
    nextBird = 2000 + hash2(width, height, 907) * 1000;
    draw(reducedMotion ? FIXED_TIME : boot);
  }

  function draw(now) {
    if (!ctx || !state) return;

    ctx.clearRect(0, 0, width, height);

    if (isNight()) {
      // The budget panel reports what the renderer is actually doing, so these
      // have to fall to zero rather than sit at whatever daylight left behind.
      budget.poolCells = 0;
      budget.birds = 0;
      return;
    }

    ctx.fillStyle = INK;
    drawPools(now);
    drawBirds();
    ctx.globalAlpha = 1;
  }

  // sky-v3 relayouts for more reasons than a window resize -- its own debounced
  // handler, a phase flip, the typed commands calling build() directly -- and it
  // announces none of them. Listening for `resize` here meant this layer kept
  // whatever geometry it happened to build first and silently drew a stale
  // skyline. The published state is the contract, so watch that instead: one
  // read per frame, and every relayout is caught whatever caused it.
  //
  // Geometry means geometry. Day and night used to count as a change here, which
  // tore the whole layer down and reset the flight clock every time the phase
  // moved -- and walking a day in fifteen seconds moves it a dozen times, so the
  // clock never got far enough from zero to launch a single bird. Nothing about
  // the fog or the flight depends on the phase; only whether they are drawn does,
  // and draw() already decides that.
  function geometryChanged(next) {
    return !state || next.width !== width || next.height !== height;
  }

  // How fast scene time is running against real time. One during a normal visit;
  // several thousand while a whole day is being walked in fifteen seconds. It is
  // read from the clock itself rather than from a flag, so anything that moves
  // the sky -- the day run, the month run, a typed hour -- carries the birds
  // with it without having to know they exist.
  function measureTimeScale(api, now) {
    var sceneNow = api && api.clock ? api.clock().getTime() : Date.now();

    if (!lastRealTime) {
      lastRealTime = now;
      lastSceneTime = sceneNow;
      return;
    }

    var realStep = now - lastRealTime;
    var sceneStep = sceneNow - lastSceneTime;
    lastRealTime = now;
    lastSceneTime = sceneNow;

    if (realStep <= 0) return;

    // Capped hard. A fifteen-second day is nearly six thousand times real speed,
    // and birds at that rate are not a time-lapse, they are static. Twenty is
    // enough to read as "these belong to the day going past".
    var rate = clamp(sceneStep / realStep, 1, 20);

    // Eased, so a single ragged frame does not jolt every bird on screen.
    timeScale = lerp(timeScale, rate, 0.25);

    // Real steps are clamped so returning to a backgrounded tab does not
    // teleport the whole flight forward by however long you were away.
    flightClock += Math.min(realStep, 120) * timeScale;
  }

  function tick(now) {
    var next = baseState();
    if (!next) return;

    var moved = geometryChanged(next);

    // Adopted every frame, not only on a rebuild. The sun's altitude and the
    // scene clock live in here and both change constantly; holding the snapshot
    // taken at the last layout meant the thermal was reading an hour that had
    // already gone.
    state = next;
    if (moved) rebuild();
    if (reducedMotion) return;

    if (state.celestial && state.celestial.sun) sunAltitude = state.celestial.sun.altitude;
    measureTimeScale(window.__portfolioSky, now);

    if (isNight()) {
      // Nothing soars after dark. They are dropped rather than paused, so
      // daybreak starts with an empty sky and fills it again from the thermal.
      if (birds.length) {
        birds.length = 0;
        budget.birds = 0;
        draw(now);
      }
      return;
    }

    if (now - lastDraw < 1000 / 24) return;
    lastDraw = now;

    if (flightClock >= nextBird) scheduleBird(flightClock);
    draw(now);
  }

  listenMedia(motionMedia, function (event) {
    reducedMotion = event.matches;
    rebuild();
  });

  // Under reduced motion the shared loop never starts, so a day that turned to
  // night mid-session would leave this canvas holding a lit daytime sky over a
  // night scene. A repaint is all that needs to happen -- draw() clears itself
  // at night -- and calling rebuild() here was half of why the flight clock kept
  // going back to zero.
  onSkyPhase(function () {
    window.setTimeout(function () {
      if (!state) return;
      if (isNight()) {
        birds.length = 0;
        budget.birds = 0;
      }
      draw(reducedMotion ? FIXED_TIME : performance.now());
    }, 60);
  });

  // The shared loop never starts under reduced motion, so tick's geometry watch
  // would never get a first run. The scene still has to exist there -- frozen at
  // a stable phase, not empty -- which is what this initial build is for.
  function waitForScene() {
    var first = baseState();
    if (first) {
      state = first;
      rebuild();
      return;
    }
    window.setTimeout(waitForScene, 120);
  }

  onFrame(tick);
  waitForScene();

  // The same shape night-sky-v2 exposes for the comet, because the typed
  // commands should reach one kind of thing one way.
  window.__dayAtmosphere = {
    birdNow: function () {
      if (!state || isNight()) return false;
      // Deliberately ignores the thermal gate and the ceiling. If someone has
      // asked for a bird they get a bird, whatever the slope is doing.
      var ceiling = Math.max(1, state.ridgeTop);
      var seed = (Math.floor(performance.now()) ^ (width * 7)) >>> 0;
      spawn(seed, ceiling, hash(seed + 5) > 0.5, 1, 0);
      return true;
    }
  };
})();
