(function () {
  "use strict";

  // The hero copy is positioned by CSS; the ridge is positioned by the photograph's
  // skyline inside the canvas. Nothing coordinated the two, so on short laptop
  // viewports (1280x720, 1366x768) the terrain climbed over the last line of the
  // paragraph and swallowed the "selected work" link almost entirely.
  //
  // The renderer already knows exactly where the ridge is, so ask it rather than
  // guessing at the crop maths, and lift the copy until the block clears.

  var canvas = document.getElementById("sky");
  var copy = document.querySelector(".hero-copy");
  var topbar = document.querySelector(".topbar");
  if (!canvas || !copy || !topbar) return;

  var GAP = 22;          // breathing room between the copy and the ridge
  var TOPBAR_GAP = 34;   // never crowd the masthead to buy that room
  var lift = 0;
  var scheduled = 0;

  // Terrain in dark mode is a sparse dither and the sky is full of single-pixel
  // stars, so "first opaque pixel" is not a ridge. Require a dense run instead.
  function ridgeFromPixels(x0, x1) {
    var ctx;
    try {
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    } catch (error) {
      return Infinity;
    }
    if (!ctx) return Infinity;

    var span = x1 - x0;
    var data;
    try {
      data = ctx.getImageData(x0, 0, span, canvas.height).data;
    } catch (error) {
      return Infinity; // tainted canvas; leave the layout alone
    }

    var stride = span * 4;
    var needed = Math.max(3, Math.round(span * 0.06));
    var streak = 0;

    for (var y = 0; y < canvas.height; y++) {
      var row = y * stride;
      var hits = 0;
      for (var i = 3; i < stride; i += 4) {
        if (data[row + i] > 110) hits++;
      }
      if (hits >= needed) {
        if (++streak >= 4) return y - streak + 1;
      } else {
        streak = 0;
      }
    }
    return Infinity;
  }

  function ridgeTopUnder(left, right) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !canvas.width || !canvas.height) return Infinity;

    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var x0 = Math.max(0, Math.floor((left - rect.left) * scaleX));
    var x1 = Math.min(canvas.width, Math.ceil((right - rect.left) * scaleX));
    if (x1 <= x0) return Infinity;

    var y = Infinity;
    var sky = window.__portfolioSky;
    var state = sky && sky.state && sky.state();
    var skyline = state && state.skyline;

    if (skyline && skyline.length) {
      // Authoritative: the renderer's own per-column ridge height.
      for (var x = x0; x < x1 && x < skyline.length; x++) {
        if (skyline[x] > 0 && skyline[x] < y) y = skyline[x];
      }
    } else {
      y = ridgeFromPixels(x0, x1);
    }

    return y === Infinity ? Infinity : rect.top + y / scaleY;
  }

  function apply() {
    scheduled = 0;

    // Measure from the unlifted position so the result does not drift on re-runs.
    var rect = copy.getBoundingClientRect();
    var naturalTop = rect.top + lift;
    var naturalBottom = rect.bottom + lift;

    var ridge = ridgeTopUnder(rect.left, rect.right);
    var wanted = ridge === Infinity ? 0 : Math.max(0, naturalBottom + GAP - ridge);

    // The masthead wins ties: better a small overlap than copy jammed under the nav.
    // The topbar sits in its own grid row and does not move with the lift, so its
    // rect is already absolute -- adding the lift here fed the result back into
    // itself and nudged the layout on every tick.
    var headroom = Math.max(0, naturalTop - topbar.getBoundingClientRect().bottom - TOPBAR_GAP);
    var next = Math.round(Math.min(wanted, headroom));

    // Lift alone cannot always clear the ridge without crowding the masthead.
    // Flag the leftover so the link can pick up a paper backing, and only then.
    if (wanted - next > 1) copy.setAttribute("data-ridge-overlap", "");
    else copy.removeAttribute("data-ridge-overlap");

    // Deadband: sub-pixel churn is not worth a layout shift.
    if (Math.abs(next - lift) <= 1) return true;
    lift = next;
    copy.style.setProperty("--hero-copy-lift", lift + "px");
    return false;
  }

  function release() {
    document.documentElement.removeAttribute("data-hero-hold");
  }

  // Never leave the hero invisible because a measurement stalled.
  window.setTimeout(release, 900);

  function schedule() {
    if (scheduled) return;
    scheduled = window.setTimeout(apply, 120);
  }

  // The canvas paints asynchronously (image decode + skyline fetch), and the
  // renderers rebuild on theme and resize. Re-measure whenever that can happen.
  var stableTicks = 0;
  var ticks = 0;
  var poll = window.setInterval(function () {
    if (apply()) stableTicks++;
    else stableTicks = 0;
    // Stop once the measurement has held still, or after ~5s of waiting for paint.
    if (stableTicks >= 3 || ++ticks >= 24) {
      window.clearInterval(poll);
      release();
    }
  }, 200);

  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });

  window.addEventListener("skyphasechange", schedule);

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
})();
