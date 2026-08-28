// Holding the site name goes to /admin.
//
// This is a convenience, not a security boundary. It keeps a link to the editor
// off every page for ordinary visitors, and that is all it does -- the gesture
// is in the page source, anyone can read it, and typing /admin works just as
// well. Cloudflare Access is what actually stops anyone: /admin and /api are
// behind it, and the Function verifies its assertion itself. Nothing here
// decides whether content is shown, because anything the browser decides, a
// visitor can decide differently.

const HOLD_MS = 950;

const target = document.querySelector(".site-name a") || document.querySelector(".site-name");
const host = document.querySelector(".site-name") || target?.parentElement;

let hint = null;
let tick = 0;
function ensureHint() {
  if (hint) return hint;
  hint = document.createElement("span");
  hint.className = "hold-hint";
  hint.textContent = "holding… 0.8s";
  hint.setAttribute("aria-hidden", "true");
  if (host) host.appendChild(hint);
  else document.body.appendChild(hint);
  return hint;
}
function showHint() {
  const h = ensureHint();
  // next frame so transition runs
  requestAnimationFrame(() => h.setAttribute("data-visible", ""));
}
function hideHint() {
  if (hint) hint.removeAttribute("data-visible");
  if (tick) window.clearInterval(tick);
  tick = 0;
}

if (target) {
  let timer = 0;
  let holding = false;
  let triggered = false;

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    timer = 0;
    if (tick) window.clearInterval(tick);
    tick = 0;
    target.removeAttribute("data-holding");
    hideHint();
  };

  const start = (event) => {
    // Only primary pointer, no modified click, and not while typing.
    if (event.button !== undefined && event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    triggered = false;
    holding = true;
    target.setAttribute("data-holding", "");
    const h = ensureHint();
    const started = Date.now();
    h.textContent = `holding… ${(HOLD_MS / 1000).toFixed(1)}s`;
    showHint();
    if (tick) window.clearInterval(tick);
    tick = window.setInterval(() => {
      const elapsed = Date.now() - started;
      const remaining = Math.max(0, HOLD_MS - elapsed);
      if (!hint) return;
      if (remaining > 0) hint.textContent = `holding… ${(remaining / 1000).toFixed(1)}s`;
    }, 80);
    timer = window.setTimeout(() => {
      triggered = true;
      holding = false;
      if (tick) window.clearInterval(tick);
      tick = 0;
      // send-off in the pill itself, then go
      if (hint) {
        hint.textContent = "time to work →";
        hint.setAttribute("data-visible", "");
      }
      try {
        const toast = document.createElement("p");
        toast.className = "sky-toast";
        toast.setAttribute("data-visible", "");
        toast.textContent = "editor → /admin";
        document.body.appendChild(toast);
        window.setTimeout(() => toast.remove(), 1100);
      } catch {}
      window.setTimeout(() => {
        clear();
        window.location.href = "/admin";
      }, 320);
    }, HOLD_MS);
  };

  const cancel = () => {
    if (!holding) return;
    holding = false;
    clear();
  };

  target.addEventListener("pointerdown", start);
  target.addEventListener("pointerup", cancel);
  target.addEventListener("pointerleave", cancel);
  target.addEventListener("pointercancel", cancel);
  target.addEventListener("lostpointercapture", cancel);

  // If the hold fired, swallow the click that would have gone to "/".
  target.addEventListener(
    "click",
    (event) => {
      if (triggered) {
        event.preventDefault();
        event.stopImmediatePropagation();
        triggered = false;
      }
    },
    true
  );

  // Keyboard alternative: holding Enter/Space on the focused name for the same duration.
  target.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.repeat) return;
    start(event);
  });
  target.addEventListener("keyup", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    cancel();
  });
}
