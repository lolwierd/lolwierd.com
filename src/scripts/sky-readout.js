import { effects, motionMedia } from "./sky-shared.js";

(function () {
  "use strict";

  // Point at the sun, the moon, or a constellation and the sky says what it is
  // and where it actually is right now.
  //
  // No icon in the masthead for this. That strip is pure microtype -- adding a
  // glyph would be the same mistake as the status dot that used to sit there --
  // and a badge announcing "there is a detail here" is worse than the detail
  // being found. The bodies are the affordance: they are the only things on the
  // page that move, so they are the only things anyone thinks to touch.

  var HIT_PAD = 26;
  var el = null;
  var current = null;
  var hero = document.querySelector(".hero");
  if (!hero) return;

  function node() {
    if (el) return el;
    el = document.createElement("div");
    el.className = "sky-readout";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
    return el;
  }

  function degrees(value) {
    return Math.round(value) + "°";
  }

  function compass(azimuth) {
    var names = ["n", "nne", "ne", "ene", "e", "ese", "se", "sse", "s", "ssw", "sw", "wsw", "w", "wnw", "nw", "nnw"];
    return names[Math.round(((azimuth % 360) + 360) % 360 / 22.5) % 16];
  }

  function vadodaraTime(date) {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata"
    }).format(date);
  }

  // suncalc reports the phase as a fraction of the cycle, which is precise and
  // says nothing. These are the words people use.
  function moonPhaseName(phase) {
    if (phase < 0.03 || phase > 0.97) return "new moon";
    if (phase < 0.22) return "waxing crescent";
    if (phase < 0.28) return "first quarter";
    if (phase < 0.47) return "waxing gibbous";
    if (phase < 0.53) return "full moon";
    if (phase < 0.72) return "waning gibbous";
    if (phase < 0.78) return "last quarter";
    return "waning crescent";
  }

  function state() {
    var api = window.__portfolioSky;
    return api && api.state ? api.state() : null;
  }

  function describe(kind, figure) {
    var s = state();
    if (!s || !s.celestial) return null;
    var when = window.__portfolioSky.clock ? window.__portfolioSky.clock() : new Date();

    if (kind === "sun") {
      var sun = s.celestial.sun;
      return {
        title: "the sun",
        facts: [
          degrees(sun.altitude) + " above the horizon",
          "bearing " + degrees(sun.azimuth) + " " + compass(sun.azimuth),
          vadodaraTime(when) + " in vadodara"
        ]
      };
    }

    if (kind === "moon") {
      var moon = s.celestial.moon;
      return {
        title: "the moon",
        facts: [
          moonPhaseName(moon.phase),
          Math.round(moon.fraction * 100) + "% lit",
          degrees(moon.altitude) + " up, bearing " + degrees(moon.azimuth) + " " + compass(moon.azimuth)
        ]
      };
    }

    return {
      title: figure.name,
      facts: [figure.gloss, "over vadodara at " + vadodaraTime(when)],
      ref: figure.ref
    };
  }

  function show(kind, figure, x, y) {
    var info = describe(kind, figure);
    if (!info) return;

    var box = node();
    var lines = info.facts.map(function (f) {
      return "<span>" + f + "</span>";
    }).join("");
    box.innerHTML =
      '<p class="sky-readout-title">' + info.title + "</p>" +
      '<p class="sky-readout-facts">' + lines + "</p>" +
      (info.ref
        ? '<a class="sky-readout-ref" href="' + info.ref + '" rel="noreferrer" target="_blank">what it is ↗</a>'
        : '<a class="sky-readout-ref" href="/colophon/">how this sky is made ↗</a>');

    box.style.left = Math.round(x) + "px";
    box.style.top = Math.round(y) + "px";
    box.setAttribute("data-visible", "");
  }

  function hide() {
    if (el) el.removeAttribute("data-visible");
    if (effects.hovered) {
      effects.hovered = null;
    }
    current = null;
  }

  function near(body, x, y) {
    if (!body) return false;
    var dx = x - body.x;
    var dy = y - body.y;
    var reach = body.r + HIT_PAD;
    return dx * dx + dy * dy < reach * reach;
  }

  // Nearest star of any figure, within reach. Proximity to the drawn points
  // rather than to a rectangle around them.
  var FIGURE_REACH = 42;

  function figureUnder(figures, x, y) {
    if (!figures) return null;
    var best = null;
    var bestDist = FIGURE_REACH * FIGURE_REACH;
    for (var i = 0; i < figures.length; i++) {
      var pts = figures[i].pts;
      for (var p = 0; p < pts.length; p += 2) {
        var dx = x - pts[p];
        var dy = y - pts[p + 1];
        var d = dx * dx + dy * dy;
        if (d < bestDist) {
          bestDist = d;
          best = figures[i];
        }
      }
    }
    return best;
  }

  function onPoint(event) {
    var bodies = window.__skyBodies;
    if (!bodies) return;

    var x = event.clientX - bodies.left;
    var y = event.clientY - bodies.top;

    var kind = null;
    var figure = null;
    if (near(bodies.sun, x, y)) kind = "sun";
    else if (near(bodies.moon, x, y)) kind = "moon";
    else {
      figure = figureUnder(bodies.figures, x, y);
      if (figure) kind = "figure";
    }

    var key = kind === "figure" ? figure.id : kind;
    if (key === current) return;
    current = key;

    effects.hovered = kind === "figure" ? figure.id : null;

    if (!kind) {
      hide();
      return;
    }
    show(kind, figure, event.clientX + 16, event.clientY + 16);
  }

  hero.addEventListener("pointermove", onPoint, { passive: true });
  hero.addEventListener("pointerdown", onPoint, { passive: true });
  hero.addEventListener("pointerleave", hide, { passive: true });
  window.addEventListener("scroll", hide, { passive: true });

  // Touch has no hover, so a tap anywhere else dismisses it.
  document.addEventListener("pointerdown", function (event) {
    if (!hero.contains(event.target)) hide();
  }, { passive: true });

  if (motionMedia.matches) HIT_PAD = 34;
})();
