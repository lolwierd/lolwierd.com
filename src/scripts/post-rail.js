// The running head, and how far through the piece you are.
//
// Nothing while the real title is on screen. Once it has scrolled past, the
// title returns small at the top of the page, followed by the section you are
// actually in, and the hairline under it inks in as you read. No panel, no
// blur, no shadow, and no back link duplicating the masthead that is there.

var rail = document.querySelector("[data-post-rail]");
var title = document.querySelector(".post-header h1");
var article = document.querySelector(".post-body");
var section = document.querySelector("[data-rail-section]");

// How far down the window a heading has to be before it counts as the one you
// are reading: just under the head itself.
var LINE = 64;
var OUT_MS = 150;

var trigger = 0;
var start = 0;
var span = 1;
var marks = [];
var current = null;
var swapTimer = 0;

if (rail && title && article) {
  measure();
  update();

  // No rAF throttle: the handler is a comparison, a short scan and at most one
  // attribute write, and scrollY is already current during a scroll event, so
  // there is nothing here worth deferring a frame for.
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", function () {
    measure();
    update();
  });

  // Remeasure once the webfont has swapped in: every offset on the page moves
  // with it, including the point at which the title leaves the viewport.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      measure();
      update();
    });
  }
}

function measure() {
  var head = title.getBoundingClientRect();
  var body = article.getBoundingClientRect();

  // The bottom of the title in document coordinates: the head appears exactly
  // when the words it repeats are no longer on screen.
  trigger = head.bottom + window.scrollY;

  // Progress is measured across the prose itself, not the document, so the
  // range at the foot of the page is not counted as something left to read.
  start = body.top + window.scrollY;
  span = Math.max(1, body.height - window.innerHeight * 0.6);

  marks = [];
  var headings = article.querySelectorAll("h2");
  for (var i = 0; i < headings.length; i += 1) {
    marks.push({
      top: headings[i].getBoundingClientRect().top + window.scrollY,
      text: headings[i].textContent.trim()
    });
  }
}

function update() {
  var y = window.scrollY;

  if (y > trigger) rail.setAttribute("data-visible", "");
  else rail.removeAttribute("data-visible");

  rail.style.setProperty("--rail-progress", clamp((y - start) / span).toFixed(4));

  if (!section) return;

  // The last heading that has passed the line is the one you are under.
  var found = null;
  for (var i = 0; i < marks.length; i += 1) {
    if (marks[i].top - LINE > y) break;
    found = marks[i].text;
  }

  setSection(found);
}

// Out, then in: the old heading lifts away, and only once it is gone does the
// new one come up into its place. Doing both at once cross-fades two different
// words on top of each other, which at this size is just mud.
function setSection(text) {
  if (text === current) return;
  current = text;

  window.clearTimeout(swapTimer);

  if (!section.textContent) {
    // Nothing there yet, so there is nothing to take away first.
    enter(text);
    return;
  }

  section.setAttribute("data-state", "out");
  swapTimer = window.setTimeout(function () {
    enter(text);
  }, OUT_MS);
}

function enter(text) {
  section.textContent = text || "";

  if (!text) {
    section.removeAttribute("data-state");
    return;
  }

  section.setAttribute("data-state", "ready");
  // Read a layout value so the browser keeps "ready" as a real starting frame
  // rather than collapsing both writes into one and skipping the transition.
  void section.offsetWidth;
  section.setAttribute("data-state", "in");
}

function clamp(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
