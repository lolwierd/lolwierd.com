import { isNight, effects, motionMedia } from "./sky-shared.js";

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
    ["dusk / sunset", "and going back down"],
    ["night", "the small hours"],
    ["moon", "next hour the moon is actually up"],
    ["noon / day", "overhead"],
    ["now / reset", "back to the real hour"],
    ["comet", "throw one, if it is dark enough"],
    ["stars", "constellations, truly placed"],
    ["snow", "weather"],
    ["eclipse", "stage one"],
    ["bug / hpack", "the failure i still think about"],
    ["still", "stop every moving thing"],
    ["↑↑↓↓←→←→ba", "a whole day in ten seconds"],
    ["?", "this list"]
  ];

  var toast = null;
  var toastTimer = 0;
  var sheet = null;
  var buffer = "";
  var arrows = [];
  var KONAMI = "uuddlrlrba";

  function sky() {
    return window.__portfolioSky;
  }

  function say(text) {
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
    }, 2400);
  }

  function setClock(moment, message) {
    var api = sky();
    if (!api || !api.setClock) return;
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
        '<p class="sky-sheet-foot">? or esc to close</p>';
      document.body.appendChild(sheet);
    }
    var open = force == null ? !sheet.hasAttribute("data-open") : force;
    if (open) sheet.setAttribute("data-open", "");
    else sheet.removeAttribute("data-open");
  }

  function highlightBug() {
    var bug = document.querySelector(".remembered-bug");
    if (!bug) return;
    say("the one i still think about");
    bug.scrollIntoView({ behavior: motionMedia.matches ? "auto" : "smooth", block: "center" });
    bug.setAttribute("data-flash", "");
    window.setTimeout(function () {
      bug.removeAttribute("data-flash");
    }, 2600);
  }

  function runTheDay() {
    var steps = [
      ["dawn", "dawn"], ["noon", "noon"], ["dusk", "dusk"], ["night", "night"]
    ];
    say("a whole day, ten seconds");
    steps.forEach(function (step, i) {
      window.setTimeout(function () {
        var api = sky();
        if (api && api.setClock) api.setClock(step[0]);
      }, 400 + i * 2400);
    });
    window.setTimeout(function () {
      var api = sky();
      if (api && api.setClock) api.setClock(null);
      say("back to the real hour");
    }, 400 + steps.length * 2400);
  }

  var WORDS = {
    dawn: function () { setClock("dawn", "dawn over vadodara"); },
    sunrise: function () { setClock("dawn", "dawn over vadodara"); },
    dusk: function () { setClock("dusk", "dusk over vadodara"); },
    sunset: function () { setClock("dusk", "dusk over vadodara"); },
    night: function () { setClock("night", "night over vadodara"); },
    noon: function () { setClock("noon", "noon over vadodara"); },
    day: function () { setClock("noon", "noon over vadodara"); },
    now: function () { setClock(null, "back to the real hour"); },
    reset: function () { setClock(null, "back to the real hour"); },

    moon: function () {
      var api = sky();
      if (!api || !api.setClock) return;
      api.setClock("moon");
      // The moon is below the horizon all night for much of the month, and an
      // empty sky with a "moon" toast just looks broken.
      say(api.moonUp && api.moonUp() ? "moonrise over vadodara" : "the moon is down tonight");
    },

    comet: function () {
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
      if (!isNight()) {
        say("stars want a dark sky. try 'night'");
        return;
      }
      effects.stars = !effects.stars;
      say(effects.stars ? "the sky over vadodara, right now" : "constellations off");
    },

    snow: function () {
      effects.snow = !effects.snow;
      say(effects.snow ? "snow" : "snow stopped");
    },

    eclipse: function () {
      if (isNight()) {
        say("nothing to eclipse at night. try 'noon'");
        return;
      }
      effects.eclipseStart = performance.now();
      say("look up");
    },

    still: function () {
      effects.frozen = !effects.frozen;
      say(effects.frozen ? "everything holds still" : "moving again");
    },

    bug: highlightBug,
    hpack: highlightBug
  };

  // Longest first: "snow" ends with "now", and matching shortest-first reset the
  // clock instead of starting the weather.
  var ORDER = Object.keys(WORDS).sort(function (a, b) { return b.length - a.length; });
  var LONGEST = ORDER[0].length;

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
      toggleSheet();
      return;
    }

    // Konami runs on its own buffer, since arrows never reach the word buffer.
    var arrow = { ArrowUp: "u", ArrowDown: "d", ArrowLeft: "l", ArrowRight: "r" }[event.key];
    if (arrow || event.key === "b" || event.key === "a") {
      arrows.push(arrow || event.key);
      if (arrows.length > KONAMI.length) arrows.shift();
      if (arrows.join("") === KONAMI) {
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
        WORDS[ORDER[i]]();
        buffer = "";
        return;
      }
    }
  });
})();
