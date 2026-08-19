import { isNight } from "./sky-shared.js";

(function () {
  "use strict";

  // Type a word anywhere on the page and the sky answers. Nothing here is
  // required to read the site; it exists because a page whose whole subject is
  // one sky over one town should let you go and look at the other hours of it.

  var WORDS = {
    dawn: { clock: "dawn", says: "dawn over vadodara" },
    sunrise: { clock: "dawn", says: "dawn over vadodara" },
    dusk: { clock: "dusk", says: "dusk over vadodara" },
    sunset: { clock: "dusk", says: "dusk over vadodara" },
    night: { clock: "night", says: "night over vadodara" },
    moon: { clock: "night", says: "night over vadodara" },
    noon: { clock: "noon", says: "noon over vadodara" },
    day: { clock: "noon", says: "noon over vadodara" },
    now: { clock: null, says: "back to the real hour" },
    reset: { clock: null, says: "back to the real hour" },
    comet: { comet: true }
  };

  var LONGEST = 8;
  var buffer = "";
  var toast = null;
  var toastTimer = 0;

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
    }, 2200);
  }

  function run(word) {
    var action = WORDS[word];
    var sky = window.__portfolioSky;

    if (action.comet) {
      // Only meaningful once there is a night sky to cross.
      if (!isNight()) {
        say("comets need a dark sky. try 'night'");
        return;
      }
      if (window.__nightSkyTune && window.__nightSkyTune.cometNow) {
        window.__nightSkyTune.cometNow();
        say("watch the sky");
      }
      return;
    }

    if (!sky || !sky.setClock) return;
    sky.setClock(action.clock);
    say(action.says);
  }

  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    var target = event.target;
    var tag = target && target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (target && target.isContentEditable)) return;

    if (event.key.length !== 1 || !/[a-z]/i.test(event.key)) return;

    buffer = (buffer + event.key.toLowerCase()).slice(-LONGEST);

    for (var word in WORDS) {
      if (buffer.endsWith(word)) {
        run(word);
        buffer = "";
        return;
      }
    }
  });
})();
