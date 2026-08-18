(function () {
  "use strict";

  var canvas = null;
  var ctx = null;
  var tries = 0;
  var themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

  function baseState() {
    return window.__portfolioSky && window.__portfolioSky.state
      ? window.__portfolioSky.state()
      : null;
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "mountain-edge-mask";
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
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d", { alpha: true });
  }

  function draw() {
    var state = baseState();
    if (!state || !state.skyline) {
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

    ctx.clearRect(0, 0, state.width, state.height);
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--page")
      .trim() || (themeMedia.matches ? "#0b0e13" : "#eee9df");

    // The renderer used to throw animated dust pixels above the photo-derived
    // ridge. Mask only that narrow sky-side band so the mountain silhouette is
    // crisp while leaving the terrain itself and the rest of the sky untouched.
    var depth = Math.ceil(56 * state.dpr);
    for (var x = 0; x < state.width; x++) {
      var edge = state.skyline[x];
      if (edge <= 0 || edge >= state.height) continue;
      var top = Math.max(0, edge - depth);
      ctx.fillRect(x, top, 1, edge - top);
    }
  }

  function redrawSoon() {
    window.clearTimeout(redrawSoon.timer);
    redrawSoon.timer = window.setTimeout(draw, 240);
  }

  if (themeMedia.addEventListener) themeMedia.addEventListener("change", redrawSoon);
  else themeMedia.addListener(redrawSoon);
  window.addEventListener("resize", redrawSoon, { passive: true });

  draw();
})();
