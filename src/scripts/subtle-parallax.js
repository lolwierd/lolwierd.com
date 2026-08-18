(function () {
  "use strict";

  var motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var raf = 0;
  var observer = null;
  var layers = [];

  // Move the whole ambient scene together. The mountain renderer, star masks,
  // twilight and ridge cleanup all share one skyline, so keeping them aligned
  // avoids the old wobble/seam bugs while the scene itself lags behind content.
  var layerIds = ["sky", "twilight-sky", "night-sky-tune", "sky-life"];

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

  function reset() {
    for (var i = 0; i < layers.length; i++) {
      layers[i].style.transform = "translate3d(0, 0, 0)";
    }
  }

  function apply() {
    raf = 0;
    collect();

    if (motionMedia.matches) {
      reset();
      return;
    }

    var mobile = window.innerWidth < 768;
    var scrollY = window.scrollY || window.pageYOffset || 0;

    // Noticeable when you look for it, but still restrained. This moves both
    // mountain and sky/background, not just the star overlay.
    var factor = mobile ? 0.11 : 0.14;
    var maxShift = mobile ? 42 : 64;
    var shift = clamp(scrollY * factor, 0, maxShift);
    var transform = "translate3d(0, " + shift.toFixed(2) + "px, 0)";

    for (var i = 0; i < layers.length; i++) {
      layers[i].style.transform = transform;
    }
  }

  function schedule() {
    if (raf) return;
    raf = window.requestAnimationFrame(apply);
  }

  function observeInjectedLayers() {
    if (observer || !document.body) return;

    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (!mutations[i].addedNodes.length) continue;
        schedule();
        break;
      }
    });

    observer.observe(document.body, { childList: true });
  }

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("load", schedule, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) schedule();
  });

  listen(motionMedia, schedule);
  observeInjectedLayers();

  schedule();
  window.setTimeout(schedule, 80);
  window.setTimeout(schedule, 320);
})();
