import { createEditor } from "./markdown-view.js";
import { listPosts, getPost, savePost } from "./api.js";
import {
  readBuffer,
  writeBuffer,
  flushBuffer,
  clearBuffer,
  pruneBuffers,
  bufferedSlugs,
  readList,
  writeList
} from "./buffer.js";
import { slugify, isValidSlug, validatePost } from "../../lib/post-file.js";

const el = (id) => document.getElementById(id);

const dom = {
  list: el("post-list"),
  indexView: el("index-view"),
  writeView: el("write-view"),
  postsToggle: el("posts-toggle"),
  branch: el("branch-mark"),
  loadingView: el("loading-view"),
  toast: el("toast"),
  preview: el("preview-link"),
  newPost: el("new-post"),
  state: el("save-state"),
  restore: el("restore-draft"),
  save: el("save"),
  focus: el("focus-toggle"),
  form: el("frontmatter"),
  title: el("f-title"),
  slug: el("f-slug"),
  summary: el("f-summary"),
  date: el("f-date"),
  updated: el("f-updated"),
  addUpdated: el("add-updated"),
  removeUpdated: el("remove-updated"),
  renameSlug: el("rename-slug"),
  tags: el("f-tags"),
  draft: el("f-draft"),
  editor: el("editor")
};

let posts = [];
let current = blank();
let slugTouched = false;
let saving = false;
let pendingRestore = null;
let branch = "";
let repo = "";
let toastTimer = 0;
// Set while the editor's document is being replaced from the repo, so the
// change listener does not mistake loading a post for typing in it.
let applying = false;
let view;

function blank() {
  return {
    // What the working buffer is filed under. Fixed for the life of the post
    // being written: the slug follows the title while a post is new, and keying
    // the buffer on it wrote one localStorage entry per keystroke -- each a full
    // copy of the body -- under names nothing ever read back.
    bufferKey: "",
    slug: "",
    sha: null,
    fields: { title: "", summary: "", date: today(), updated: "", tags: [], draft: true },
    body: "",
    dirty: false,
    _saved: null
  };
}

function snapshot(post) {
  return JSON.stringify({ slug: post.slug, fields: post.fields, body: post.body });
}

function updateDirty() {
  if (!current._saved) {
    // new post: dirty if anything is non-empty
    const empty = !current.fields.title && !current.fields.summary && !current.body && !current.fields.tags.length;
    current.dirty = !empty;
  } else {
    current.dirty = snapshot(current) !== current._saved;
  }
  describeIdle();
  setTitle();
}

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* ---------------------------------------------------------------- save state */

// Four states and no fifth. A spinner that keeps spinning after a failed
// request is a lie, and the one thing this box has to tell me is whether the
// words are somewhere other than this tab.
//
// The word stays in the header; anything longer than a word -- the sha, the
// error, what was restored -- goes to the toast, so a commit landing never
// reflows the line above the writing.
function setState(kind, text, detail) {
  dom.state.dataset.kind = kind;
  dom.state.textContent = text;
  if (detail) toast(detail, kind);
  setTitle();
}

// A failure stays up until it is read or clicked away; everything else is news
// for a few seconds.
function toast(text, kind = "") {
  window.clearTimeout(toastTimer);
  dom.toast.textContent = text;
  dom.toast.dataset.kind = kind;
  dom.toast.setAttribute("data-visible", "");
  if (kind !== "failed") {
    toastTimer = window.setTimeout(() => dom.toast.removeAttribute("data-visible"), 6000);
  }
}

// The tab says what is open in it, the way any editor's does -- with a dot in
// front while there is something unsaved, so a row of tabs still tells me which
// one I walked away from.
function setTitle() {
  const showing = dom.indexView && !dom.indexView.hidden;
  const name = showing
    ? "posts"
    : current.fields.title || (current.sha ? current.slug : "new post");
  document.title = `${!showing && current.dirty ? "• " : ""}${name} · editor`;
}

function describeIdle() {
  if (current.dirty) setState("unsaved", "unsaved");
  else if (current.sha) setState("saved", "saved");
  else setState("empty", "nothing written yet");
}

/* --------------------------------------------------------------------- rail */

function renderList() {
  const buffered = new Set(bufferedSlugs());
  dom.list.textContent = "";

  for (const post of posts) {
    const item = document.createElement("li");
    item.className = "index-entry";
    if (post.slug === current.slug) item.dataset.current = "true";

    const meta = document.createElement("p");
    meta.className = "index-meta";
    meta.textContent = post.date;
    if (post.tags.length) meta.append(` · ${post.tags.join(" · ")}`);
    if (post.draft) {
      const draft = document.createElement("span");
      draft.className = "draft";
      draft.textContent = " · draft";
      meta.append(draft);
    }
    if (buffered.has(post.slug)) meta.append(" · local edit");
    if (post.slug === current.slug) meta.append(" · open");

    const title = document.createElement("h2");
    title.className = "index-title";
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.slug = post.slug;
    button.textContent = post.title;
    button.addEventListener("click", () => open(post.slug));
    title.append(button);

    const summary = document.createElement("p");
    summary.className = "index-summary";
    summary.textContent = post.summary;

    item.append(meta, title, summary);
    dom.list.append(item);
  }

  if (!posts.length) {
    const empty = document.createElement("li");
    empty.className = "index-empty";
    empty.textContent = "nothing here yet. `new` starts one.";
    dom.list.append(empty);
  }
}

// Three things this column can be showing, and exactly one at a time.
function setView(name) {
  dom.indexView.hidden = name !== "index";
  dom.writeView.hidden = name !== "write";
  dom.loadingView.hidden = name !== "loading";
  dom.postsToggle.setAttribute("aria-pressed", name === "index" ? "true" : "false");
  setTitle();
}

// The list is a place you go to and come back from, so it takes the column
// rather than sitting permanently beside the writing.
function showIndex(on) {
  setView(on ? "index" : "write");
  if (on) {
    // Clear the hash so a reload while on the list stays on the list.
    // open() sets #slug, startNew() already clears, but toggling via the
    // posts button left #slug in the URL, so reload re-opened the post.
    if (location.hash) history.replaceState(null, "", location.pathname);
    renderList();
  }
  // With the list open and nothing loaded there is no save state to report, and
  // "nothing written yet" next to a page of posts is just wrong.
  if (on && !current.sha && !current.dirty) setState("empty", "");
}

function indexOpen() {
  return !dom.indexView.hidden;
}

function setBranch(name, repository) {
  branch = name || "";
  repo = repository || repo;
  dom.branch.textContent = branch;
  if (repo && branch) {
    dom.branch.href = `https://github.com/${repo}/tree/${encodeURIComponent(branch)}`;
    dom.branch.title = `${repo} · ${branch}`;
  } else {
    // Locally there is no branch to open, only the files in front of me.
    dom.branch.removeAttribute("href");
    dom.branch.removeAttribute("title");
  }
}

async function refreshList() {
  try {
    const listed = await listPosts();
    posts = listed.posts;
    setBranch(listed.branch, listed.repo);
    writeList(listed);
    // Now that the real list is known, drop buffers for posts that do not
    // exist -- including the per-keystroke ones an earlier version left.
    pruneBuffers(posts.map((post) => post.slug));
    renderList();
  } catch (error) {
    setState("failed", "failed", `could not read the list: ${error.message}`);
  }
}

/* ------------------------------------------------------------------- fields */

// The summary is one sentence that occasionally runs to two lines. A textarea
// that grows to its content keeps the header the height of what is in it.
function autosize(field) {
  const apply = () => {
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  };
  apply();
  // Measured again on the next frame: the first pass can land before the
  // stylesheet or the serif has arrived, and a wrapped-to-nothing textarea
  // measures as tall as the sentence is long.
  requestAnimationFrame(apply);
}

function fillForm() {
  dom.title.value = current.fields.title;
  dom.slug.value = current.slug;
  dom.summary.value = current.fields.summary;
  dom.date.value = current.fields.date;
  dom.updated.value = current.fields.updated;
  dom.tags.value = current.fields.tags.join(", ");
  dom.draft.checked = current.fields.draft;
  showUpdated(Boolean(current.fields.updated));
  const isExisting = Boolean(current.sha);
  dom.slug.disabled = isExisting;
  dom.renameSlug.hidden = !isExisting;
  dom.slug.placeholder = isExisting ? `${current.slug} — use rename to change` : "slug";
  autosize(dom.summary);
  // Only once the post exists in the repo: there is nothing built to look at
  // before the first save.
  dom.preview.hidden = !current.sha;
  dom.preview.href = `/admin/preview/${current.slug}/`;
}

function showUpdated(on) {
  dom.updated.hidden = !on;
  dom.addUpdated.hidden = on;
  dom.removeUpdated.hidden = !on;
}

function readForm() {
  current.fields = {
    title: dom.title.value.trim(),
    summary: dom.summary.value.trim(),
    date: dom.date.value,
    updated: dom.updated.value,
    tags: dom.tags.value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    draft: dom.draft.checked
  };
  // slug is disabled for existing posts unless rename is active — read it whenever enabled
  if (!dom.slug.disabled) current.slug = dom.slug.value.trim();
}

function touch() {
  updateDirty();
  writeBuffer(current.bufferKey, {
    slug: current.slug,
    sha: current.sha,
    fields: current.fields,
    body: current.body
  });
}

/* ------------------------------------------------------------- opening posts */

function setDoc(text) {
  applying = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  applying = false;
}

async function open(slug) {
  if (!(await leaveCurrent())) return;

  setState("loading", "opening…");
  setView("loading");
  pendingRestore = null;
  dom.restore.hidden = true;
  try {
    const post = await getPost(slug);
    current = {
      bufferKey: post.slug,
      slug: post.slug,
      sha: post.sha,
      fields: {
        title: post.title,
        summary: post.summary,
        date: post.date,
        updated: post.updated,
        tags: post.tags,
        draft: post.draft
      },
      body: post.body.replace(/^\n+/, ""),
      dirty: false,
      _saved: null
    };
    current._saved = snapshot(current);

    const buffer = readBuffer(current.bufferKey);
    const differs =
      buffer &&
      (buffer.body !== current.body || JSON.stringify(buffer.fields) !== JSON.stringify(current.fields));

    if (differs && buffer.sha === current.sha) {
      // The buffer was written against exactly this version of the file, so it
      // is simply newer. Take it.
      current.fields = buffer.fields;
      current.body = buffer.body;
      current.dirty = true;
      setView("write");
      fillForm();
      setDoc(current.body);
      setState("unsaved", "unsaved", `restored what was open here ${when(buffer.savedAt)}`);
      renderList();
      location.hash = slug;
      return;
    }

    if (differs) {
      // The file moved on in the repo since this buffer was written. The repo
      // wins by default; taking the older draft is a decision, so it is a button.
      pendingRestore = buffer;
      dom.restore.hidden = false;
      dom.restore.title = `written here ${when(buffer.savedAt)}`;
      toast(`there is a local draft from ${when(buffer.savedAt)}, written against an older version`);
    } else {
      clearBuffer(current.bufferKey);
    }

    setView("write");
    fillForm();
    setDoc(current.body);
    describeIdle();
    renderList();
    location.hash = slug;
  } catch (error) {
    // Back to the list rather than stranding me on the shape of a post that
    // never arrived.
    setView("index");
    setState("failed", "failed", error.message);
  }
}

function startNew() {
  if (!current.dirty || confirm("this post has unsaved changes. start a new one anyway?")) {
    showIndex(false);
    current = blank();
    slugTouched = false;
    pendingRestore = null;
    dom.restore.hidden = true;
    fillForm();
    setDoc("");

    const buffer = readBuffer("");  // the new-post buffer, under its fixed name
    if (buffer && (buffer.body || buffer.fields.title)) {
      current.fields = buffer.fields;
      current.body = buffer.body;
      current.slug = buffer.slug || "";
      slugTouched = Boolean(buffer.slug);
      fillForm();
      setDoc(current.body);
      current.dirty = true;
      setState("unsaved", "unsaved", `restored an unsaved new post from ${when(buffer.savedAt)}`);
    } else {
      describeIdle();
    }

    history.replaceState(null, "", location.pathname);
    renderList();
    dom.title.focus();
  }
}

async function leaveCurrent() {
  if (!current.dirty) return true;
  return confirm("this post has unsaved changes. leave it?");
}

function when(timestamp) {
  if (!timestamp) return "earlier";
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 90) return "a moment ago";
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

/* -------------------------------------------------------------------- saving */

async function save() {
  if (saving) return;
  readForm();

  if (!current.slug) current.slug = slugify(current.fields.title);
  if (!isValidSlug(current.slug)) {
    setState("failed", "failed", "the slug has to be lowercase words joined by hyphens");
    return;
  }

  const originalSlug = current._saved ? JSON.parse(current._saved).slug : "";
  const isRename = Boolean(originalSlug && current.slug !== originalSlug);
  const urlSlug = isRename ? originalSlug : current.slug;

  // The same rules content.config.ts applies at build time. Catching them here
  // is the difference between a typo and a red deploy.
  const errors = validatePost(current.fields);
  if (errors.length) {
    setState("failed", "failed", errors.join(" · "));
    return;
  }

  saving = true;
  dom.save.disabled = true;
  setState("committing", "committing…");

  try {
    const result = await savePost(urlSlug, {
      ...current.fields,
      body: current.body,
      sha: current.sha,
      ...(isRename ? { newSlug: current.slug } : {})
    });
    current.sha = result.sha;
    current.dirty = false;
    current._saved = snapshot(current);
    clearBuffer(current.bufferKey);
    // A new post was buffered under the new-post name; from here it is filed
    // under the slug it was saved as.
    clearBuffer("");
    current.bufferKey = current.slug;
    dom.restore.hidden = true;
    pendingRestore = null;
    fillForm();

    if (result.branch) setBranch(result.branch, result.repo);

    setState(
      "saved",
      "saved",
      result.commit
        ? // Only main publishes. Saying "live in about a minute" from a preview
          // deployment writing to its own branch would be a lie.
          `committed ${result.commit.slice(0, 7)} to ${branch}${
            branch === "main" ? " · live in about a minute" : ""
          }`
        : "written to src/content/writing"
    );
    location.hash = current.slug;
    await refreshList();
  } catch (error) {
    // The buffer is deliberately left alone: a failed save is exactly when the
    // local copy matters.
    setState("failed", "failed", error.message);
  } finally {
    saving = false;
    dom.save.disabled = false;
  }
}

/* --------------------------------------------------------------------- setup */

function setFocusMode(on) {
  // The frontmatter is about to be display:none. If the caret is in one of its
  // fields, hiding it drops focus to the body and the next keystroke goes
  // nowhere -- so the caret moves to the prose first, which is where focus mode
  // wants it anyway.
  if (on && dom.form.contains(document.activeElement) && view) view.focus();
  document.documentElement.dataset.focusMode = on ? "true" : "false";
  dom.focus.setAttribute("aria-pressed", on ? "true" : "false");
}

function boot() {
  // Tells the public pages it is worth asking /api/posts who is looking. It
  // gates nothing -- see scripts/owner-tools.js.
  try {
    localStorage.setItem("lolwierd.editor", "1");
  } catch {
    /* the pages simply will not ask */
  }

  view = createEditor({
    parent: dom.editor,
    doc: "",
    onChange: (text) => {
      if (applying) return;
      current.body = text;
      touch();
    },
    onSave: save,
    onEscape: () => {
      setFocusMode(false);
      view.contentDOM.blur();
    }
  });

  for (const field of [dom.title, dom.summary, dom.date, dom.updated, dom.tags, dom.draft, dom.slug]) {
    field.addEventListener("input", () => {
      if (field === dom.slug) slugTouched = true;
      // While the post is new and I have not touched the slug myself, it follows
      // the title. The moment I edit it, it stops moving.
      if (field === dom.title && !current.sha && !slugTouched) {
        dom.slug.value = slugify(dom.title.value);
      }
      if (field === dom.summary) autosize(field);
      readForm();
      touch();
    });
  }

  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    save();
  });
  dom.save.addEventListener("click", save);
  dom.toast.addEventListener("click", () => dom.toast.removeAttribute("data-visible"));
  dom.addUpdated.addEventListener("click", () => {
    showUpdated(true);
    dom.updated.value = today();
    readForm();
    touch();
    dom.updated.focus();
  });

  dom.removeUpdated.addEventListener("click", () => {
    dom.updated.value = "";
    showUpdated(false);
    readForm();
    touch();
    dom.addUpdated.focus();
  });

  dom.renameSlug.addEventListener("click", () => {
    dom.slug.disabled = false;
    dom.slug.focus();
    dom.slug.select();
    dom.renameSlug.hidden = true;
    toast("changing slug will 301 old → new", "saved");
  });

  // And off again. Clearing the field is the way out: without this, adding an
  // updated date by accident could only be undone in git.
  dom.updated.addEventListener("change", () => {
    if (!dom.updated.value) {
      showUpdated(false);
      readForm();
      touch();
    }
  });
  dom.newPost.addEventListener("click", startNew);
  dom.postsToggle.addEventListener("click", () => {
    if (indexOpen()) showIndex(false);
    else refreshList().then(() => showIndex(true));
  });
  dom.focus.addEventListener("click", () => {
    setFocusMode(document.documentElement.dataset.focusMode !== "true");
    if (document.documentElement.dataset.focusMode === "true") view.focus();
  });

  dom.restore.addEventListener("click", () => {
    if (!pendingRestore) return;
    current.fields = pendingRestore.fields;
    current.body = pendingRestore.body;
    current.dirty = true;
    fillForm();
    setDoc(current.body);
    dom.restore.hidden = true;
    pendingRestore = null;
    setState("unsaved", "unsaved", "restored the local draft");
  });

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save();
    } else if (mod && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFocusMode(document.documentElement.dataset.focusMode !== "true");
    } else if (event.key === "Escape") {
      setFocusMode(false);
      if (indexOpen()) showIndex(false);
    }
  });

  window.addEventListener("beforeunload", (event) => {
    flushBuffer();
    if (!current.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  // beforeunload does not fire reliably when a phone backgrounds a tab, and it
  // is the phone this editor exists for.
  window.addEventListener("pagehide", flushBuffer);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushBuffer();
  });

  window.addEventListener("resize", () => autosize(dom.summary));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => autosize(dom.summary)).catch(() => {});
  }

  fillForm();
  describeIdle();

  const wanted = location.hash.replace(/^#/, "");
  if (wanted && isValidSlug(wanted)) setView("loading");

  // What this browser saw last time, drawn before the request is even sent. The
  // fetch below replaces it a moment later; until then the list is at worst one
  // save out of date, which is a better thing to look at than a skeleton.
  const remembered = readList();
  if (remembered) {
    posts = remembered.posts;
    setBranch(remembered.branch, remembered.repo);
    if (!wanted) renderList();
  }

  refreshList().then(() => {
    if (wanted && isValidSlug(wanted)) open(wanted);
    else showIndex(true);
  });
}

boot();
