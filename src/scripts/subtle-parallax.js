(function () {
  "use strict";

  var motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var layerIds = ["sky", "twilight-sky", "night-sky-tune", "sky-life"];
  var layers = [];
  var observer = null;
  var raf = 0;
  var currentShift = 0;
  var targetShift = 0;
  var lastFrame = 0;

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function listen(media, callback) {
    if (media.addEventListener) media.addEventListener("change", callback);
    else media.addListener(callback);
  }

  function collect() {
    var next = [];

    for (var i = 0; i < layerIds.length; i++) {
      var element = document.getElementById(layerIds[i]);
      if (!element) continue;

      element.style.willChange = "transform";
      element.style.backfaceVisibility = "hidden";
      element.style.transformOrigin = "50% 50%";
      next.push(element);
    }

    layers = next;
  }

  function writeTransform(shift) {
    var transform = "translate3d(0, " + shift.toFixed(2) + "px, 0)";
    for (var i = 0; i < layers.length; i++) layers[i].style.transform = transform;
  }

  function measureTarget() {
    if (motionMedia.matches) {
      targetShift = 0;
      return;
    }

    var mobile = window.innerWidth < 768;
    var scrollY = window.scrollY || window.pageYOffset || 0;

    // Strong enough to read as real depth, but still bounded so the scene never
    // detaches from the hero. Every skyline-dependent canvas moves together.
    var factor = mobile ? 0.18 : 0.22;
    var maxShift = mobile ? 64 : 92;
    targetShift = clamp(scrollY * factor, 0, maxShift);
  }

  function frame(now) {
    raf = 0;

    if (!layers.length) collect();
    if (!lastFrame) lastFrame = now;

    var dt = Math.min(48, Math.max(1, now - lastFrame));
    lastFrame = now;

    if (motionMedia.matches) {
      currentShift = 0;
      targetShift = 0;
      writeTransform(0);
      return;
    }

    // Time-based exponential smoothing removes the stepped/janky feel from
    // mobile scroll events without adding a long floaty delay after scrolling.
    var ease = 1 - Math.exp(-dt / 58);
    currentShift += (targetShift - currentShift) * ease;

    if (Math.abs(targetShift - currentShift) < 0.05) currentShift = targetShift;
    writeTransform(currentShift);

    if (currentShift !== targetShift) raf = window.requestAnimationFrame(frame);
  }

  function schedule() {
    measureTarget();
    if (!raf) {
      lastFrame = 0;
      raf = window.requestAnimationFrame(frame);
    }
  }

  function observeInjectedLayers() {
    if (observer || !document.body) return;

    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (!mutations[i].addedNodes.length) continue;
        collect();
        writeTransform(currentShift);
        break;
      }
    });

    observer.observe(document.body, { childList: true });
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("load", function () {
    collect();
    schedule();
  }, { passive: true });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) schedule();
  });

  listen(motionMedia, function () {
    collect();
    schedule();
  });

  collect();
  observeInjectedLayers();
  measureTarget();
  currentShift = targetShift;
  writeTransform(currentShift);

  window.setTimeout(function () {
    collect();
    writeTransform(currentShift);
  }, 120);
})();
