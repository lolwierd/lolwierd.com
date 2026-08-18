(function () {
  "use strict";

  var motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var raf = 0;
  var observer = null;
  var layers = [];

  var specs = [
    { id: "sky", desktop: 0.012, mobile: 0.006 },
    { id: "twilight-sky", desktop: 0.030, mobile: 0.015 },
    { id: "night-sky-tune", desktop: 0.024, mobile: 0.012 },
    { id: "sky-life", desktop: 0.018, mobile: 0.009 }
  ];

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function listen(media, callback) {
    if (media.addEventListener) media.addEventListener("change", callback);
    else media.addListener(callback);
  }

  function collect() {
    var next = [];
    var mobile = window.innerWidth < 768;

    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var element = document.getElementById(spec.id);
      if (!element) continue;

      element.style.willChange = "transform";
      element.style.backfaceVisibility = "hidden";
      next.push({
        element: element,
        factor: mobile ? spec.mobile : spec.desktop
      });
    }

    layers = next;
  }

  function reset() {
    for (var i = 0; i < layers.length; i++) {
      layers[i].element.style.transform = "translate3d(0, 0, 0)";
    }
  }

  function apply() {
    raf = 0;
    collect();

    if (motionMedia.matches) {
      reset();
      return;
    }

    var scrollY = window.scrollY || window.pageYOffset || 0;
    var maxShift = window.innerWidth < 768 ? 9 : 18;

    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var shift = clamp(scrollY * layer.factor, 0, maxShift);
      layer.element.style.transform = "translate3d(0, " + shift.toFixed(2) + "px, 0)";
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
