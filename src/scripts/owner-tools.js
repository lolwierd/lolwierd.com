// The two things that are only useful to the person who writes the posts: a way
// into the editor from a post, and the drafts listed alongside the published
// writing.
//
// Nothing here decides whether content is shown. Drafts are not built into any
// public page, so there is nothing on this page for a visitor to reveal -- the
// list is fetched from /api/posts, which is behind Cloudflare Access and
// verifies the assertion in the Function. The server decides; the browser only
// asks. That is the difference between this and a client-side "is this the
// owner" check, which would be worth nothing.
//
// The localStorage flag is set by /admin, and is only there so that a reader who
// has never opened the editor never makes the request at all. Forging it gets
// you a 403 and a page that looks exactly the same.

const FLAG = "lolwierd.editor";

function hasUsedEditor() {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

async function ownPosts() {
  const response = await fetch("/api/posts", {
    headers: { Accept: "application/json" },
    // An expired session answers with a redirect to the Access login. Following
    // it from here would be pointless; not being signed in is simply an answer.
    redirect: "manual"
  });
  if (!response.ok) return null;
  const body = await response.json();
  return Array.isArray(body.posts) ? body.posts : null;
}

function editLink(slug, text = "edit") {
  const link = document.createElement("a");
  link.className = "owner-edit";
  link.href = `/admin#${slug}`;
  link.textContent = text;
  return link;
}

// On a post: one word in the meta line, in the mono everything else there uses.
function addPostEdit(slug) {
  const meta = document.querySelector(".post-meta");
  if (!meta || meta.querySelector(".owner-edit")) return;
  meta.append(editLink(slug));
}

// On /writing/: the drafts, above the years, in the markup the published
// entries already use. They link to their preview page, since a draft has no
// public url -- that is the whole point of it being a draft.
function addDrafts(posts) {
  const entries = document.querySelector(".entries");
  if (!entries || entries.querySelector('[data-drafts]')) return;

  // The dev server builds drafts into this list already, and a future change to
  // what gets built should not produce two of everything either. Anything the
  // page is already showing is left alone.
  const shown = new Set(
    Array.from(entries.querySelectorAll('a[href^="/writing/"]')).map((link) =>
      link.getAttribute("href")
    )
  );

  const drafts = posts.filter((post) => post.draft && !shown.has(`/writing/${post.slug}/`));
  if (!drafts.length) return;

  const section = document.createElement("section");
  section.className = "entry-year";
  section.dataset.drafts = "true";
  section.setAttribute("aria-label", "Drafts");

  const mark = document.createElement("p");
  mark.className = "year-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "drafts";
  section.append(mark);

  for (const post of drafts) {
    const article = document.createElement("article");
    article.className = "entry";

    const slug = document.createElement("p");
    slug.className = "entry-slug";
    slug.textContent = post.date;
    if (post.tags && post.tags.length) slug.append(` · ${post.tags.join(" · ")}`);
    const draftMark = document.createElement("span");
    draftMark.className = "draft";
    draftMark.textContent = " · draft";
    slug.append(draftMark, " ", editLink(post.slug));

    const title = document.createElement("h2");
    title.className = "entry-title";
    const link = document.createElement("a");
    link.href = `/admin/preview/${post.slug}/`;
    link.textContent = post.title;
    title.append(link);

    const summary = document.createElement("p");
    summary.className = "entry-summary";
    summary.textContent = post.summary;

    article.append(slug, title, summary);
    section.append(article);
  }

  entries.prepend(section);
}

(async function () {
  if (!hasUsedEditor()) return;

  const post = document.querySelector("[data-post-slug]");
  const index = document.querySelector(".entries");
  if (!post && !index) return;

  let posts;
  try {
    posts = await ownPosts();
  } catch {
    // Offline, or not signed in. The page is already correct without this.
    return;
  }
  if (!posts) return;

  if (post) addPostEdit(post.dataset.postSlug);
  if (index) addDrafts(posts);
})();
