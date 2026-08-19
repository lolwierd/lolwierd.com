import { onFrame, motionMedia, isCoarse } from "./sky-shared.js";

(function () {
  "use strict";

  var hero = document.querySelector(".hero");
  if (!hero) return;

  var root = document.documentElement;
  var last = null;

  function measure() {
    var rect = hero.getBoundingClientRect();
    return {
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
      dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100
    };
  }

  function apply(next) {
    last = next;
    root.style.setProperty("--hero-scene-height", next.height + "px");
  }

  apply(measure());

  // Mobile Safari changes window.innerHeight while its browser chrome collapses and
  // expands during scroll. The sky renderer used to treat those UI-only changes as
  // real layout resizes, rebuilding the photo crop and making the mountain jump.
  // The hero uses svh, so its box stays stable through those changes. Only let a
  // resize reach the renderers when the actual hero geometry (or DPR) changed.
  window.addEventListener("resize", function (event) {
    var next = measure();
    var layoutChanged =
      !last ||
      Math.abs(next.width - last.width) > 1 ||
      Math.abs(next.height - last.height) > 1 ||
      Math.abs(next.dpr - last.dpr) > 0.01;

    if (!layoutChanged) {
      event.stopImmediatePropagation();
      return;
    }

    apply(next);
  }, { capture: true, passive: true });

  // Parallax: the scene is absolutely positioned at the top of the document, so
  // without help it scrolls away at 1:1 with the text. Translating it down by a
  // fraction of the scroll makes it lag behind and read as distance. Capped so
  // the ridge never climbs into the reading section, and transform-only so it
  // costs a composite rather than a layout.
  var DRIFT = 0.26;
  var scrolled = 0;
  var applied = -1;

  window.addEventListener("scroll", function () {
    scrolled = window.scrollY || window.pageYOffset || 0;
  }, { passive: true });

  var stage = null;

  // No parallax on touch. iOS composites a full-screen promoted layer badly
  // while its own scroll is in flight, and a scene that simply stays put reads
  // perfectly well on a phone.
  onFrame(function () {
    if (motionMedia.matches || isCoarse()) return;
    if (!stage) {
      stage = document.getElementById("sky-stage");
      if (!stage) return;
    }
    var limit = (last ? last.height : window.innerHeight) * 0.42;
    var shift = Math.round(Math.min(scrolled * DRIFT, limit));
    if (shift === applied) return;
    applied = shift;
    // Straight onto the element. Setting a custom property on :root made every
    // scroll frame invalidate style for the whole document.
    stage.style.transform = "translate3d(0," + shift + "px,0)";
  }, true);
})();
