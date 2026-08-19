import { isNight, effects, budget, motionMedia, isCoarse } from "./sky-shared.js";

(function () {
  "use strict";

  // Type a word anywhere on the page and the sky answers. None of this is
  // needed to read the site; it exists because a page whose whole subject is one
  // sky over one town should let you go and look at its other hours.
  //
  // The time words are not canned looks: they move the renderer's clock and let
  // it recompute, so the sun sits where it really would at that hour.

  var CHEATS = [
    ["dawn / sunrise", "the sun coming up over vadodara"],
    ["blue", "the blue hour, before either of them"],
    ["dusk / sunset", "and going back down"],
    ["night", "the small hours"],
    ["moon", "next hour the moon is actually up"],
    ["noon / day", "overhead"],
    ["now / reset", "back to the real hour"],
    ["comet", "throw one, if it is dark enough"],
    ["stars", "light up the constellations"],
    ["snow", "weather"],
    ["ridge", "show the skyline the page computed"],
    ["budget", "what this scene actually costs"],
    ["still", "stop every moving thing"],
    ["↑↑↓↓←→←→ba", "a whole day in fifteen seconds"],
    ["?", "this list"]
  ];

  var POINTER_NOTE =
    "the sun, the moon and the constellations are all where they really are over " +
    "vadodara right now.";

  var toast = null;
  var toastTimer = 0;
  var sheet = null;
  var buffer = "";
  var arrows = [];
  var KONAMI = "uuddlrlrba";

  function sky() {
    return window.__portfolioSky;
  }

  function say(text, dwell) {
    if (!toast) {
      toast = document.createElement("p");
      toast.className = "sky-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.setAttribute("data-visible", "");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.removeAttribute("data-visible");
    }, dwell || 2400);
  }

  function setClock(moment, message) {
    var api = sky();
    if (!api || !api.setClock) return;
    toTop();
    api.setClock(moment);
    say(message);
  }

  function toggleSheet(force) {
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.className = "sky-sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-label", "Typed sky commands");
      var rows = CHEATS.map(function (row) {
        return "<dt>" + row[0] + "</dt><dd>" + row[1] + "</dd>";
      }).join("");
      sheet.innerHTML =
        '<p class="sky-sheet-label">type anywhere</p><dl>' + rows + "</dl>" +
        '<p class="sky-sheet-note">' + POINTER_NOTE + "</p>" +
        '<p class="sky-sheet-foot">? or esc to close</p>';
      document.body.appendChild(sheet);
    }
    var open = force == null ? !sheet.hasAttribute("data-open") : force;
    if (open) sheet.setAttribute("data-open", "");
    else sheet.removeAttribute("data-open");
  }

  // Sky commands are pointless if the sky is off screen.
  function toTop() {
    if (window.scrollY <= 4) return;
    window.scrollTo({ top: 0, behavior: motionMedia.matches ? "auto" : "smooth" });
  }

  var dayRun = 0;

  // Walk the clock continuously rather than cutting between four hours. Stepping
  // at ~7fps: each step repaints the sky palette and rebuilds the sun, which is
  // too much to ask sixty times a second, and the sun's own travel is slow
  // enough that this still reads as motion rather than as frames. Fifteen
  // seconds at 140ms is about 107 steps, roughly a degree of sun per step.
  var DAY_MS = 15000;
  var STEP_MS = 140;

  // Sun altitude is a terrible clock to run at a constant rate. Two thirds of
  // the arc is daylight above ten degrees, where the palette, the veil and the
  // accent are all pinned and nothing on screen changes; the twelve degrees of
  // twilight where every one of them moves went past in about a second, so the
  // accent jumped straight from its daylight tone to its night one and skipped
  // the pale band in between entirely.
  //
  // So the run spends its time in proportion to how much the scene is changing:
  // a tall narrow bell over the twilight where the veil, the palette and the
  // accent all move at once, a lower one over golden hour where the sun is worth
  // watching, and a floor under both so noon passes rather than stalling. The
  // run then walks the cumulative weight instead of the hours.
  var PACE_STOPS = 240;

  function paceArc(api, arc) {
    var weights = new Array(PACE_STOPS + 1);
    var cumulative = new Array(PACE_STOPS + 1);

    for (var i = 0; i <= PACE_STOPS; i++) {
      var at = new Date(arc.from + (arc.to - arc.from) * (i / PACE_STOPS));
      var altitude = api.sunAltitudeAt(at);
      var twilight = (altitude + 13.5) / 6;
      var golden = (altitude - 1) / 7;
      weights[i] = 0.04 + 1.4 * Math.exp(-twilight * twilight) + 0.35 * Math.exp(-golden * golden);
    }

    var total = 0;
    cumulative[0] = 0;
    for (var j = 1; j <= PACE_STOPS; j++) {
      total += (weights[j - 1] + weights[j]) / 2;
      cumulative[j] = total;
    }
    if (!total) return null;
    for (var k = 0; k <= PACE_STOPS; k++) cumulative[k] /= total;
    return cumulative;
  }

  // Where along the arc the run should be, given how much of its budget it has
  // spent. Inverts the cumulative weight by bisection.
  function arcAt(cumulative, spent) {
    if (!cumulative) return spent;
    var lo = 0;
    var hi = PACE_STOPS;
    while (lo + 1 < hi) {
      var mid = (lo + hi) >> 1;
      if (cumulative[mid] <= spent) lo = mid;
      else hi = mid;
    }
    var span = cumulative[hi] - cumulative[lo];
    return (lo + (span > 0 ? (spent - cumulative[lo]) / span : 0)) / PACE_STOPS;
  }

  function runTheDay() {
    var api = sky();
    if (!api || !api.stepClock || !api.dayArc) return;
    if (dayRun) window.clearInterval(dayRun);

    toTop();
    var arc = api.dayArc();
    var pacing = api.sunAltitudeAt ? paceArc(api, arc) : null;
    var started = performance.now();
    say("a whole day, fifteen seconds");

    dayRun = window.setInterval(function () {
      var t = (performance.now() - started) / DAY_MS;
      if (t >= 1) {
        window.clearInterval(dayRun);
        dayRun = 0;
        api.setClock(null);
        say("back to the real hour");
        return;
      }
      // Ease the ends so the run settles into dawn and out at night instead of
      // starting and stopping at full speed.
      var eased = t * t * (3 - 2 * t);
      api.stepClock(new Date(arc.from + (arc.to - arc.from) * arcAt(pacing, eased)));
    }, STEP_MS);
  }

  // A lunar month in about eight seconds. Stepping a whole day at a time keeps
  // the hour of the night roughly where it was, so the sky stays dark and only
  // the moon changes -- which is the entire point of watching it.
  var monthRun = 0;
  var MONTH_STEPS = 30;
  var MONTH_MS = 8000;

  function runTheMonth() {
    var api = sky();
    if (!api || !api.stepClock || !api.clock) return;
    if (monthRun) window.clearInterval(monthRun);

    var from = api.clock().getTime();
    var step = 0;
    say("a lunar month, eight seconds");

    monthRun = window.setInterval(function () {
      step++;
      if (step > MONTH_STEPS) {
        window.clearInterval(monthRun);
        monthRun = 0;
        api.setClock(null);
        say("back to the real hour");
        return;
      }
      api.stepClock(new Date(from + step * 86400000));
    }, MONTH_MS / MONTH_STEPS);
  }

  window.addEventListener("skyrunday", function () { markUsed(); runTheDay(); });
  window.addEventListener("skyrunmonth", function () {
    markUsed();
    // Watching the phase change only means anything against a dark sky; in
    // daylight the moon is a pale disc and the month is invisible.
    if (!isNight()) {
      say("the month only shows in the dark. try 'night'");
      return;
    }
    runTheMonth();
  });

  var WORDS = {
    dawn: function () { setClock("dawn", "dawn over vadodara"); },
    sunrise: function () { setClock("dawn", "dawn over vadodara"); },
    dusk: function () { setClock("dusk", "dusk over vadodara"); },
    sunset: function () { setClock("dusk", "dusk over vadodara"); },
    night: function () { setClock("night", "night over vadodara"); },
    noon: function () { setClock("noon", "noon over vadodara"); },
    day: function () { setClock("noon", "noon over vadodara"); },
    blue: function () { setClock("blue", "the blue hour, forty minutes before sunrise"); },
    bluehour: function () { setClock("blue", "the blue hour, forty minutes before sunrise"); },
    now: function () { setClock(null, "back to the real hour"); },
    reset: function () { setClock(null, "back to the real hour"); },

    moon: function () {
      var api = sky();
      if (!api || !api.setClock) return;
      toTop();
      api.setClock("moon");
      // The moon is below the horizon all night for much of the month, and an
      // empty sky with a "moon" toast just looks broken.
      say(api.moonUp && api.moonUp() ? "moonrise over vadodara" : "the moon is down tonight");
    },

    comet: function () {
      toTop();
      if (!isNight()) {
        say("comets want a dark sky. try 'night'");
        return;
      }
      if (window.__nightSkyTune && window.__nightSkyTune.cometNow) {
        window.__nightSkyTune.cometNow();
        say("watch the sky");
      }
    },

    stars: function () {
      toTop();
      if (!isNight()) {
        say("stars want a dark sky. try 'night'");
        return;
      }
      effects.stars = !effects.stars;
      say(effects.stars ? "the figures, lit" : "figures dimmed");
    },

    snow: function () {
      toTop();
      effects.snow = !effects.snow;
      say(effects.snow ? "snow" : "snow stopped");
    },

    still: function () {
      effects.frozen = !effects.frozen;
      say(effects.frozen ? "everything holds still" : "moving again");
    },

    ridge: function () {
      toTop();
      effects.ridge = !effects.ridge;
      say(effects.ridge ? "the line everything else is measured from" : "ridge hidden");
    },

    budget: function () {
      toggleBudget();
    }
  };

  var budgetPanel = null;
  var budgetTimer = 0;

  function toggleBudget() {
    if (budgetPanel) {
      window.clearInterval(budgetTimer);
      budgetPanel.remove();
      budgetPanel = null;
      say("meter off");
      return;
    }
    budgetPanel = document.createElement("div");
    budgetPanel.className = "sky-budget";
    document.body.appendChild(budgetPanel);
    say("what the sky costs");

    var tick = function () {
      var layers = document.querySelectorAll("#sky-stage canvas").length;
      budgetPanel.innerHTML =
        '<p class="sky-budget-label">this scene</p>' +
        "<dl>" +
        "<dt>frame rate</dt><dd>" + budget.fps + " fps</dd>" +
        "<dt>canvas layers</dt><dd>" + layers + "</dd>" +
        "<dt>animation loops</dt><dd>1</dd>" +
        "<dt>terrain cells lit</dt><dd>" + budget.terrainCells + "</dd>" +
        "<dt>corona cells</dt><dd>" + budget.sunCells + "</dd>" +
        "<dt>ridge wisps</dt><dd>" + budget.wisps + "</dd>" +
        "</dl>";
    };
    tick();
    budgetTimer = window.setInterval(tick, 500);
  }

  // Longest first: "snow" ends with "now", and matching shortest-first reset the
  // clock instead of starting the weather.
  var ORDER = Object.keys(WORDS).sort(function (a, b) { return b.length - a.length; });
  var LONGEST = ORDER[0].length;

  // The eggs are worth finding but not worth advertising. If someone has been on
  // the page a while and touched nothing, the toast mentions the key once, in
  // its own quiet corner, and never again this session. It holds for eleven
  // seconds because it is the only message here that asks for anything.
  var nudged = false;

  function markUsed() {
    nudged = true;
    try { window.sessionStorage.setItem("sky-nudged", "1"); } catch (error) {}
  }

  try { nudged = window.sessionStorage.getItem("sky-nudged") === "1"; } catch (error) {}

  // Twelve seconds: long enough that the hero has been read and the nudge is not
  // talking over it, short enough that most visitors are still here. Five felt
  // like being interrupted mid-sentence.
  window.setTimeout(function () {
    // No nudge on touch: there is no keyboard to press ? on.
    if (nudged || document.hidden || isCoarse()) return;
    markUsed();
    say("psst — the sky does tricks. press ?", 11000);
  }, 12000);

  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    var target = event.target;
    var tag = target && target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (target && target.isContentEditable)) return;

    if (event.key === "Escape") {
      toggleSheet(false);
      return;
    }
    if (event.key === "?") {
      markUsed();
      toggleSheet();
      return;
    }

    // Konami runs on its own buffer, since arrows never reach the word buffer.
    var arrow = { ArrowUp: "u", ArrowDown: "d", ArrowLeft: "l", ArrowRight: "r" }[event.key];
    if (arrow || event.key === "b" || event.key === "a") {
      arrows.push(arrow || event.key);
      if (arrows.length > KONAMI.length) arrows.shift();

      // Swallow the arrow only once the sequence is clearly under way, so plain
      // arrow-key scrolling keeps working for anyone not entering the code.
      var typed = arrows.join("");
      var progress = 0;
      while (progress < typed.length && KONAMI.startsWith(typed.slice(typed.length - progress - 1))) progress++;
      if (arrow && progress >= 3) event.preventDefault();

      if (typed === KONAMI) {
        arrows = [];
        buffer = "";
        runTheDay();
        return;
      }
    }

    if (event.key.length !== 1 || !/[a-z]/i.test(event.key)) return;

    buffer = (buffer + event.key.toLowerCase()).slice(-LONGEST);
    for (var i = 0; i < ORDER.length; i++) {
      if (buffer.endsWith(ORDER[i])) {
        markUsed();
        WORDS[ORDER[i]]();
        buffer = "";
        return;
      }
    }
  });
})();
