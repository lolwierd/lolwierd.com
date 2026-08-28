// The storage layer: git, reached over HTTP.
//
// Every save is a commit on the default branch and Pages rebuilds from it, so a
// post is still a markdown file with a history and nothing here is the source of
// truth. That is the property the whole editor exists to keep.

import { WRITING_DIR, postPath } from "./post-file.js";

const API = "https://api.github.com";

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value).replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function repoConfig(env) {
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_TOKEN;
  if (!repo || !token) throw new GitHubError("server is missing GITHUB_REPO or GITHUB_TOKEN", 500);

  // A deployment edits the branch it was built from. Pages sets CF_PAGES_BRANCH
  // on every deployment, so the editor on a preview URL reads and writes that
  // preview's branch rather than quietly committing to main from a page that is
  // not main. GITHUB_BRANCH overrides it where that is wanted -- production sets
  // it to main explicitly -- and "main" is the fallback if neither exists.
  const branch = env.GITHUB_BRANCH || env.CF_PAGES_BRANCH || "main";
  return { repo, token, branch };
}

async function call(config, path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub rejects requests without one, and a named agent makes the calls
      // legible in the token's audit log.
      "User-Agent": "lolwierd.com-editor",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    // Pass GitHub's own words through. A save that failed because the file moved
    // under me should say that, not "something went wrong".
    let detail = `${response.status}`;
    try {
      const body = await response.json();
      if (body && body.message) detail = body.message;
    } catch {
      /* keep the status */
    }
    throw new GitHubError(detail, response.status === 409 || response.status === 422 ? 409 : 502);
  }
  return response.json();
}

// One request for the whole folder: names, blob shas and text together.
//
// The Contents API can only do this as one call for the directory and then one
// per file, and those N calls are the editor's slowest moment -- every one of
// them is a round trip from a Cloudflare worker to GitHub before the list can
// be drawn. GraphQL answers the same question once. If it is unavailable for
// any reason the REST path below still works, so this is a shortcut and not a
// dependency.
const TREE_QUERY = `query ($owner: String!, $name: String!, $expr: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expr) {
      ... on Tree {
        entries {
          name
          oid
          type
          object { ... on Blob { text isTruncated } }
        }
      }
    }
  }
}`;

export async function listPostsFast(config) {
  const [owner, name] = config.repo.split("/");
  if (!owner || !name) return null;

  let body;
  try {
    const response = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "User-Agent": "lolwierd.com-editor"
      },
      body: JSON.stringify({
        query: TREE_QUERY,
        variables: { owner, name, expr: `${config.branch}:${WRITING_DIR}` }
      })
    });
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }

  if (!body || body.errors) return null;
  const tree = body.data && body.data.repository && body.data.repository.object;
  if (!tree || !Array.isArray(tree.entries)) return null;

  const files = [];
  for (const entry of tree.entries) {
    if (entry.type !== "blob" || !entry.name.endsWith(".md")) continue;
    // A truncated blob is a file too big for one response. Fall back rather
    // than list a post from half its frontmatter.
    if (!entry.object || typeof entry.object.text !== "string" || entry.object.isTruncated) return null;
    files.push({ slug: entry.name.replace(/\.md$/, ""), text: entry.object.text, sha: entry.oid });
  }
  return files;
}

export async function listPostFiles(config) {
  const entries = await call(
    config,
    `/repos/${config.repo}/contents/${WRITING_DIR}?ref=${encodeURIComponent(config.branch)}`
  );
  // A directory answers with an array. Anything else -- a file at that path, an
  // unexpected shape -- is not something to call .filter on.
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => entry.type === "file" && entry.name.endsWith(".md"));
}

// One request per post. At this size that is a handful of parallel calls and it
// keeps the code to the plain Contents API; if the archive ever gets big enough
// for that to hurt, the fix is one GraphQL query for the whole tree.
export async function readPostFile(config, slug) {
  const file = await call(
    config,
    `/repos/${config.repo}/contents/${postPath(slug)}?ref=${encodeURIComponent(config.branch)}`
  );
  if (!file || !file.content) return null;
  return { text: decodeBase64Utf8(file.content), sha: file.sha };
}

export async function writePostFile(config, slug, text, sha, message) {
  const body = {
    message,
    content: encodeUtf8Base64(text),
    branch: config.branch,
    ...(sha ? { sha } : {})
  };
  const result = await call(config, `/repos/${config.repo}/contents/${postPath(slug)}`, {
    method: "PUT",
    body: JSON.stringify(body)
  });
  // call() reads 404 as "not there", which is right for the two read paths and
  // wrong here: GitHub answers a write with a dead or wrong-scoped token with
  // 404, not 401, so an expired PAT arrived as "cannot read properties of null".
  if (!result || !result.content || !result.commit) {
    throw new GitHubError("github refused the write -- check GITHUB_TOKEN and GITHUB_REPO", 502);
  }
  return { sha: result.content.sha, commit: result.commit.sha };
}
