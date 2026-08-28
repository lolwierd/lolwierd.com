// Triple-clicking "writing" in the nav goes to /admin.
//
// This is a convenience, not a security boundary. It keeps a link to the editor
// off every page for ordinary visitors, and that is all it does -- the gesture
// is in the page source, anyone can read it, and typing /admin works just as
// well. Cloudflare Access is what actually stops anyone: /admin and /api are
// behind it, and the Function verifies its assertion itself. Nothing here
// decides whether content is shown, because anything the browser decides, a
// visitor can decide differently.
//
// Counting survives the navigation the first click causes: the count lives in
// sessionStorage, and the second and third clicks are swallowed so the page
// reloads once rather than three times.

const KEY = "writing-nav-clicks";
const WINDOW_MS = 900;

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(value) {
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* no session storage: the gesture stops working, the link still works */
  }
}

for (const link of document.querySelectorAll('a[href="/writing/"]')) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    const now = Date.now();
    const previous = read();
    const count = previous && now - previous.at < WINDOW_MS ? previous.count + 1 : 1;

    if (count >= 3) {
      event.preventDefault();
      write(null);
      window.location.href = "/admin";
      return;
    }

    // The first click navigates as it always did. Only once a second click has
    // arrived inside the window does the link stop behaving like a link.
    if (count >= 2) event.preventDefault();
    write({ count, at: now });
  });
}
