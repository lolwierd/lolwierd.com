// The same two endpoints in both worlds. In `astro dev` they are served by the
// dev-only integration and write to disk; in production they are Pages Functions
// and write a commit. The editor does not care which, which is the point.

async function request(url, init) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...(init && init.body ? { "Content-Type": "application/json" } : {}) }
    });
  } catch (error) {
    // Locally this almost always means the dev server is not running any more,
    // which is worth saying rather than making me read a stack trace.
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    throw new Error(
      local
        ? "no answer from the dev server -- is `npm run dev` still running?"
        : `no answer from the server (${error.message})`
    );
  }

  // Cloudflare Access answers an expired session with its login page, not JSON.
  // Saying so is more use than "unexpected token < in JSON".
  if (response.status === 302 || response.status === 401 || response.status === 403) {
    throw new Error("the Access session is over -- reload the page and sign in again");
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`the server sent something that was not JSON (${response.status})`);
  }

  if (!response.ok) throw new Error((data && data.error) || `request failed (${response.status})`);
  return data;
}

export function listPosts() {
  return request("/api/posts").then((data) => ({
    posts: data.posts || [],
    branch: data.branch || "",
    repo: data.repo || ""
  }));
}

export function getPost(slug) {
  return request(`/api/posts/${encodeURIComponent(slug)}`).then((data) => data.post);
}

export function savePost(slug, payload) {
  return request(`/api/posts/${encodeURIComponent(slug)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}
