(function () {
  "use strict";

  var themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  var motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  var timer = 0;

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function clear() {
    if (!timer) return;
    window.clearTimeout(timer);
    timer = 0;
  }

  function arm(delay) {
    clear();
    timer = window.setTimeout(run, delay);
  }

  function run() {
    timer = 0;

    if (motionMedia.matches || document.hidden || !themeMedia.matches) {
      arm(randomBetween(10000, 20000));
      return;
    }

    var controller = window.__nightSkyTune;
    if (!controller || !controller.state || !controller.cometNow) {
      arm(1500);
      return;
    }

    var snapshot = controller.state();
    if (snapshot && snapshot.active) {
      arm(randomBetween(7000, 14000));
      return;
    }

    controller.cometNow();

    // Random-periodic, but actually visible during a normal portfolio visit.
    arm(randomBetween(30000, 75000));
  }

  function resetForTheme() {
    clear();
    if (!motionMedia.matches && themeMedia.matches) {
      arm(randomBetween(5000, 12000));
    }
  }

  if (themeMedia.addEventListener) themeMedia.addEventListener("change", resetForTheme);
  else themeMedia.addListener(resetForTheme);

  if (motionMedia.addEventListener) motionMedia.addEventListener("change", resetForTheme);
  else motionMedia.addListener(resetForTheme);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) clear();
    else resetForTheme();
  });

  resetForTheme();
})();
