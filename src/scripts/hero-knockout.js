import { onFrame, motionMedia } from "./sky-shared.js";

(function () {
  "use strict";

  // The sky runs behind the hero copy at full density, and that is right for the
  // weather: clouds and corona are sparse dither and the words read through them.
  // It is not right for the two solid things up there. The moon is a bone disc and
  // the night ink is bone, so when it rises through the paragraph the words under
  // it are not dim, they are gone. The rust sun does the same to charcoal by day.
  //
  // Moving the body would turn the sky into a chart that lies, and clearing the sky
  // around the copy was tried and looked pasted on. Print already has the answer:
  // where type crosses a solid, the type is knocked out of it with a hairline of
  // paper. Only the parts of the copy a disc actually touches get it, and on open
  // sky the hairline is the colour of the sky, so it shows only where it works.

  var canvas = document.getElementById("sky");
  var copy = document.querySelector(".hero-copy");
  if (!canvas || !copy) return;

  var parts = copy.querySelectorAll("h1, p, .hero-action");
  var range = document.createRange();
  // The sun's corona and the moon's rim pixels reach a little past the disc.
  var REACH = 6;
  var INTERVAL = 250;
  var last = -Infinity;

  function touches(body, origin, rect) {
    if (!body) return false;
    var cx = origin.left + body.x;
    var cy = origin.top + body.y;
    var dx = Math.max(rect.left - cx, 0, cx - rect.right);
    var dy = Math.max(rect.top - cy, 0, cy - rect.bottom);
    var r = body.r + REACH;
    return dx * dx + dy * dy < r * r;
  }

  function check() {
    var bodies = window.__skyBodies;
    if (!bodies) return;
    // Measured now rather than taken from the last publish: the stage can carry a
    // parallax transform, and the copy and the canvas scroll together anyway.
    var origin = canvas.getBoundingClientRect();
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      range.selectNodeContents(part);
      // One rect per line fragment, so a disc beside a short last line does not
      // count as touching it.
      var lines = range.getClientRects();
      var hit = false;
      for (var j = 0; j < lines.length && !hit; j++) {
        hit = touches(bodies.sun, origin, lines[j]) || touches(bodies.moon, origin, lines[j]);
      }
      part.toggleAttribute("data-knockout", hit);
    }
  }

  onFrame(function (now) {
    if (now - last < INTERVAL) return;
    last = now;
    check();
  });

  // The frame loop never starts under reduced motion, and the sky still lays
  // itself out, steps its clock and moves the bodies on its half-minute timer.
  // twilight-sky repaints 180ms after a layout, so look once it has.
  function checkSoon() {
    window.clearTimeout(checkSoon.timer);
    checkSoon.timer = window.setTimeout(check, 260);
  }
  window.addEventListener("skylayout", checkSoon);
  window.addEventListener("skyclockstep", checkSoon);
  window.addEventListener("resize", checkSoon, { passive: true });
  window.setInterval(function () {
    if (motionMedia.matches && !document.hidden) check();
  }, 2000);
})();
