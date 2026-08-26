// Two small affordances a reading page earns once it carries code and pictures:
// a copy control on every code block, and an image that opens to its own size.
// Both are added at runtime, so the markdown stays plain markdown and a reader
// without JS still gets a scrollable block and an inline image.

setupCode();
setupImages();
setupHeadings();

function setupCode() {
  var blocks = document.querySelectorAll(".post-body pre");

  Array.prototype.forEach.call(blocks, function (pre) {
    var wrap = document.createElement("div");
    wrap.className = "code-block";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy";
    button.textContent = "copy";
    wrap.appendChild(button);

    var reset = 0;

    button.addEventListener("click", function () {
      var code = pre.innerText.replace(/\n$/, "");

      copy(code).then(
        function () { say("copied"); },
        function () { say("failed"); }
      );

      function say(word) {
        button.textContent = word;
        button.setAttribute("data-said", "");
        window.clearTimeout(reset);
        reset = window.setTimeout(function () {
          button.textContent = "copy";
          button.removeAttribute("data-said");
        }, 1400);
      }
    });
  });
}

// navigator.clipboard is unavailable on insecure origins -- a phone hitting the
// dev server over the LAN, say -- and can also refuse when the write does not
// look like it came from a gesture. Either way the textarea path is tried before
// the reader is told it failed.
function copy(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).catch(function () {
      return selectAndCopy(text);
    });
  }

  return selectAndCopy(text);
}

function selectAndCopy(text) {
  return new Promise(function (resolve, reject) {
    var field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.top = "-1000px";
    document.body.appendChild(field);
    field.select();

    try {
      document.execCommand("copy") ? resolve() : reject();
    } catch (error) {
      reject(error);
    }

    document.body.removeChild(field);
  });
}

// A link to any section of the piece.
//
// No mark. Three of them were tried -- a hash, a section sign, an arrow -- and
// each one was a small piece of furniture hung beside a heading, announcing a
// feature nobody had asked about yet. The heading is already the name of the
// section, so the heading is the link: nothing is added to the page, nothing
// shows until the pointer is on it, and there is no glyph to get wrong.
//
// It is a plain anchor with no handler on it. The stylesheet already asks for
// smooth scrolling, so the browser travels to the section and puts the fragment
// in the address bar by itself.
function setupHeadings() {
  var headings = document.querySelectorAll(".post-body h2[id], .post-body h3[id]");

  Array.prototype.forEach.call(headings, function (heading) {
    var link = document.createElement("a");
    link.className = "heading-link";
    link.href = "#" + heading.id;

    // Move the heading's own contents inside the link rather than rebuilding
    // them from text, so any markup in the heading survives.
    while (heading.firstChild) link.appendChild(heading.firstChild);
    heading.appendChild(link);
  });
}

function setupImages() {
  var images = document.querySelectorAll(".post-body img");
  if (!images.length) return;

  var overlay = null;
  var full = null;
  var opener = null;

  Array.prototype.forEach.call(images, function (image) {
    image.addEventListener("click", function () {
      open(image);
    });
  });

  function open(image) {
    if (!overlay) build();
    opener = image;
    full.src = image.currentSrc || image.src;
    full.alt = image.alt || "";
    overlay.setAttribute("data-open", "");
    document.addEventListener("keydown", onKey);
    overlay.focus();
  }

  function close() {
    overlay.removeAttribute("data-open");
    document.removeEventListener("keydown", onKey);
    // Put focus back where the reader left it rather than at the top of the page.
    if (opener) opener.focus({ preventScroll: true });
  }

  function onKey(event) {
    if (event.key === "Escape") close();
  }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "image-view";
    overlay.tabIndex = -1;

    full = document.createElement("img");
    overlay.appendChild(full);

    // Anywhere closes it: the picture is the only thing in the layer, and a
    // dedicated close button would be the one piece of interface on the page.
    overlay.addEventListener("click", close);
    document.body.appendChild(overlay);
  }
}
