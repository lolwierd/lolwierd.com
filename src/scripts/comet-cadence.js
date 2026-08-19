import { isNight, onSkyPhase, listenMedia, motionMedia } from "./sky-shared.js";

(function () {
  "use strict";



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

    if (motionMedia.matches || document.hidden || !isNight()) {
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
    if (!motionMedia.matches && isNight()) {
      arm(randomBetween(5000, 12000));
    }
  }

  onSkyPhase(resetForTheme);

  listenMedia(motionMedia, resetForTheme);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) clear();
    else resetForTheme();
  });

  resetForTheme();
})();
