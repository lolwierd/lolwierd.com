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
  var hideTimer = 0;
  var lastPoint = null;
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
    box.onpointerenter = keep;

    // Flip it back over the pointer near the right or bottom edge rather than
    // letting it run off screen.
    var rect = box.getBoundingClientRect();
    if (rect.right > window.innerWidth - 12) {
      box.style.left = Math.round(x - rect.width - 32) + "px";
    }
    if (rect.bottom > window.innerHeight - 12) {
      box.style.top = Math.round(y - rect.height - 32) + "px";
    }
  }

  function hide() {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
    if (el) el.removeAttribute("data-visible");
    effects.hovered = null;
    current = null;
  }

  function keep() {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
  }

  // The "safe triangle": leaving a body toward the readout should not dismiss it,
  // because the whole point is to be able to reach the link inside. If the
  // pointer is travelling into the triangle between where it left and the
  // readout's near edge, it is on its way there -- give it time. Anywhere else
  // and it has moved on.
  function headingForReadout(x, y) {
    if (!el || !el.hasAttribute("data-visible") || !lastPoint) return false;
    var box = el.getBoundingClientRect();
    var dx = x - lastPoint.x;
    var dy = y - lastPoint.y;
    if (dx === 0 && dy === 0) return false;

    var toX = (box.left + box.right) / 2 - lastPoint.x;
    var toY = (box.top + box.bottom) / 2 - lastPoint.y;
    var lenA = Math.sqrt(dx * dx + dy * dy);
    var lenB = Math.sqrt(toX * toX + toY * toY);
    if (!lenB) return false;
    // Within about 55 degrees of straight at it.
    return (dx * toX + dy * toY) / (lenA * lenB) > 0.57;
  }

  function scheduleHide(x, y) {
    if (hideTimer) return;
    hideTimer = window.setTimeout(hide, headingForReadout(x, y) ? 600 : 130);
  }

  function insideReadout(x, y) {
    if (!el || !el.hasAttribute("data-visible")) return false;
    var box = el.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
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

    if (insideReadout(event.clientX, event.clientY)) {
      keep();
      return;
    }

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

    if (!kind) {
      scheduleHide(event.clientX, event.clientY);
      lastPoint = { x: event.clientX, y: event.clientY };
      return;
    }

    keep();
    lastPoint = { x: event.clientX, y: event.clientY };

    var key = kind === "figure" ? figure.id : kind;
    if (key === current) return;
    current = key;
    effects.hovered = kind === "figure" ? figure.id : null;
    show(kind, figure, event.clientX + 16, event.clientY + 16);
  }

  document.addEventListener("pointermove", onPoint, { passive: true });
  hero.addEventListener("pointerdown", onPoint, { passive: true });

  // Double-click a body and it does the thing that body is for: the sun moves
  // time, the moon moves the month.
  hero.addEventListener("dblclick", function (event) {
    var bodies = window.__skyBodies;
    if (!bodies) return;
    var x = event.clientX - bodies.left;
    var y = event.clientY - bodies.top;
    if (near(bodies.sun, x, y)) window.dispatchEvent(new Event("skyrunday"));
    else if (near(bodies.moon, x, y)) window.dispatchEvent(new Event("skyrunmonth"));
  });
  window.addEventListener("scroll", hide, { passive: true });

  if (el) el.addEventListener("pointerenter", keep);

  // Touch has no hover, so a tap outside both the sky and the readout dismisses.
  document.addEventListener("pointerdown", function (event) {
    if (el && el.contains(event.target)) return;
    if (!hero.contains(event.target)) hide();
  }, { passive: true });

  if (motionMedia.matches) HIT_PAD = 34;
})();
