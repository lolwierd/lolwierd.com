import { effects, motionMedia, isCoarse } from "./sky-shared.js";

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
  var offsetLeft = 0;
  var offsetTop = 0;
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

  function show(kind, figure, x, y, body) {
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

    var rect = box.getBoundingClientRect();
    var pad = 14;

    // Sit beside the body rather than on it. Covering the thing you are asking
    // about is the one place this must never land, so the body's own circle
    // decides the side and the pointer only breaks ties.
    if (body) {
      var bx = body.x + offsetLeft;
      var by = body.y + offsetTop;
      var gap = body.r + 22;
      var left = bx + gap;
      if (left + rect.width > window.innerWidth - pad) left = bx - gap - rect.width;
      if (left < pad) left = Math.min(window.innerWidth - rect.width - pad, bx + gap);
      var top = by - rect.height / 2;
      top = Math.max(pad, Math.min(window.innerHeight - rect.height - pad, top));
      box.style.left = Math.round(left) + "px";
      box.style.top = Math.round(top) + "px";
      return;
    }

    if (rect.right > window.innerWidth - pad) box.style.left = Math.round(x - rect.width - 32) + "px";
    if (rect.bottom > window.innerHeight - pad) box.style.top = Math.round(y - rect.height - 32) + "px";
  }

  function hide() {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
    if (el) el.removeAttribute("data-visible");
    effects.hovered = null;
    effects.bodyHover = null;
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
    // Within about 70 degrees of straight at it. The readout is anchored beside
    // the body rather than under the pointer, so the path to it is rarely a
    // straight line and the cone has to forgive a wandering hand.
    return (dx * toX + dy * toY) / (lenA * lenB) > 0.35;
  }

  function scheduleHide(x, y) {
    if (hideTimer) return;
    hideTimer = window.setTimeout(hide, headingForReadout(x, y) ? 700 : 220);
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
    if (document.documentElement.hasAttribute("data-sky-focus")) { hide(); return; }
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
    offsetLeft = bodies.left;
    offsetTop = bodies.top;

    // The bodies lift slightly under the pointer, so they read as things you can
    // touch rather than as painted scenery.
    effects.bodyHover = kind === "sun" || kind === "moon" ? kind : null;

    var key = kind === "figure" ? figure.id : kind;
    if (key === current) return;
    current = key;
    effects.hovered = kind === "figure" ? figure.id : null;
    show(kind, figure, event.clientX + 16, event.clientY + 16,
      kind === "sun" ? bodies.sun : kind === "moon" ? bodies.moon : null);
  }

  // Hover is a mouse idea. On touch there is no resting the pointer somewhere to
  // ask about it -- every move is a commitment -- so the readout stays out of the
  // way entirely and only the double tap survives.
  if (!isCoarse()) {
    document.addEventListener("pointermove", onPoint, { passive: true });
    hero.addEventListener("pointerdown", onPoint, { passive: true });
  }

  function bodyAt(clientX, clientY) {
    var bodies = window.__skyBodies;
    if (!bodies) return null;
    var x = clientX - bodies.left;
    var y = clientY - bodies.top;
    if (near(bodies.sun, x, y)) return "sun";
    if (near(bodies.moon, x, y)) return "moon";
    return null;
  }

  function activate(kind) {
    hide();
    window.dispatchEvent(new Event("skywatchstart"));
    if (kind === "sun") window.dispatchEvent(new Event("skyrunday"));
    else if (kind === "moon") window.dispatchEvent(new Event("skyrunmonth"));
  }

  hero.addEventListener("pointerdown", function (event) {
    var kind = bodyAt(event.clientX, event.clientY);
    if (kind) effects.bodyPulse = { kind: kind, start: performance.now() };
  }, { passive: true });

  // Double-click a body and it does the thing that body is for: the sun moves
  // time, the moon moves the month.
  //
  // A second click normally selects the word beneath it, and since the canvases
  // take no pointer events that word was whatever hero copy happened to sit
  // behind the sky. Suppressed on the bodies only, so selecting text anywhere
  // else still works.
  hero.addEventListener("mousedown", function (event) {
    if (event.detail > 1 && bodyAt(event.clientX, event.clientY)) event.preventDefault();
  });

  hero.addEventListener("dblclick", function (event) {
    var kind = bodyAt(event.clientX, event.clientY);
    if (!kind) return;
    event.preventDefault();
    var selection = window.getSelection();
    if (selection) selection.removeAllRanges();
    activate(kind);
  });

  // Touch never fires dblclick reliably, so recognise a double tap: two on the
  // same body, close together in time and place.
  var tapAt = 0;
  var tapKind = null;
  var tapX = 0;
  var tapY = 0;

  hero.addEventListener("pointerup", function (event) {
    if (event.pointerType === "mouse") return;
    var kind = bodyAt(event.clientX, event.clientY);
    if (!kind) {
      tapKind = null;
      return;
    }
    var now = performance.now();
    var close = Math.abs(event.clientX - tapX) < 40 && Math.abs(event.clientY - tapY) < 40;
    if (kind === tapKind && close && now - tapAt < 420) {
      tapKind = null;
      activate(kind);
      return;
    }
    tapAt = now;
    tapKind = kind;
    tapX = event.clientX;
    tapY = event.clientY;
  }, { passive: true });
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("skyfocuschange", hide);

  if (el) el.addEventListener("pointerenter", keep);

  // Touch has no hover, so a tap outside both the sky and the readout dismisses.
  document.addEventListener("pointerdown", function (event) {
    if (el && el.contains(event.target)) return;
    if (!hero.contains(event.target)) hide();
  }, { passive: true });

  if (motionMedia.matches) HIT_PAD = 34;
})();
