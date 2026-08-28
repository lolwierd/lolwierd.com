// The working buffer, kept in localStorage on a debounce.
//
// I will close the tab on a post at some point. Every access is wrapped:
// storage throws in a private window, when the quota is full, and when the
// browser is set to block site data, and none of those are worth losing a
// keystroke over -- the editor simply stops remembering and carries on.

const PREFIX = "lolwierd.editor.";
const DEBOUNCE_MS = 600;

let timer = 0;

function key(slug) {
  return `${PREFIX}${slug || "__new"}`;
}

export function readBuffer(slug) {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBuffer(slug, value) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(key(slug), JSON.stringify({ ...value, savedAt: Date.now() }));
    } catch {
      /* out of room or not allowed: the post is still on screen */
    }
  }, DEBOUNCE_MS);
}

export function clearBuffer(slug) {
  clearTimeout(timer);
  try {
    localStorage.removeItem(key(slug));
  } catch {
    /* nothing to do about it */
  }
}

// The last list this browser saw. /admin draws it immediately and replaces it
// when the real one lands, so opening the editor is not a blank wait on a round
// trip to GitHub. It is a cache of what to draw, never of what to save: every
// save still carries the sha the API gave it.
const LIST_KEY = `${PREFIX}list`;

export function readList() {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.posts) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeList(value) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(value));
  } catch {
    /* the editor simply starts empty next time */
  }
}

// Every buffer the browser is still holding, so the rail can mark the posts
// with unsaved work on another device or after a crash.
export function bufferedSlugs() {
  const slugs = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i);
      if (name && name.startsWith(PREFIX) && name !== LIST_KEY) {
        slugs.push(name.slice(PREFIX.length));
      }
    }
  } catch {
    /* no storage, no list */
  }
  return slugs;
}
