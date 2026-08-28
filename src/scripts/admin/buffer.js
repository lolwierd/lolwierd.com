// The working buffer, kept in localStorage on a debounce.
//
// I will close the tab on a post at some point. Every access is wrapped:
// storage throws in a private window, when the quota is full, and when the
// browser is set to block site data, and none of those are worth losing a
// keystroke over -- the editor simply stops remembering and carries on.

const PREFIX = "lolwierd.editor.";
const DEBOUNCE_MS = 600;
const NEW = "__new";

let timer = 0;
let pending = null;

function key(name) {
  return `${PREFIX}${name || NEW}`;
}

export function readBuffer(name) {
  try {
    const raw = localStorage.getItem(key(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // A buffer written by an older shape of this editor would otherwise be
    // restored into the form and throw on the first field that moved.
    if (!parsed || typeof parsed !== "object") return null;
    const f = parsed.fields;
    const ok =
      f &&
      typeof f.title === "string" &&
      typeof f.summary === "string" &&
      typeof f.date === "string" &&
      Array.isArray(f.tags) &&
      typeof parsed.body === "string";
    return ok ? parsed : null;
  } catch {
    return null;
  }
}

export function writeBuffer(name, value) {
  pending = { name, value };
  clearTimeout(timer);
  timer = setTimeout(flushBuffer, DEBOUNCE_MS);
}

// Writes whatever the debounce is still holding, now. Called on the way out of
// the page: beforeunload does not fire reliably on mobile Safari, and 600ms of
// unwritten typing is exactly the 600ms worth losing.
export function flushBuffer() {
  clearTimeout(timer);
  if (!pending) return;
  const { name, value } = pending;
  pending = null;
  try {
    localStorage.setItem(key(name), JSON.stringify({ ...value, savedAt: Date.now() }));
  } catch {
    /* out of room or not allowed: the post is still on screen */
  }
}

export function clearBuffer(name) {
  clearTimeout(timer);
  pending = null;
  try {
    localStorage.removeItem(key(name));
  } catch {
    /* nothing to do about it */
  }
}

// Buffers for posts that do not exist. An earlier version of this file keyed the
// working buffer on the slug as it was being typed, so writing a title left one
// key per keystroke, each holding a whole copy of the post. This sweeps those.
export function pruneBuffers(knownSlugs) {
  const keep = new Set([...knownSlugs, NEW, "list"]);
  try {
    const stale = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const name = localStorage.key(i);
      if (name && name.startsWith(PREFIX) && !keep.has(name.slice(PREFIX.length))) {
        stale.push(name);
      }
    }
    for (const name of stale) localStorage.removeItem(name);
    return stale.length;
  } catch {
    return 0;
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
