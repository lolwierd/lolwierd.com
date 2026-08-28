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
  return { repo, token, branch: env.GITHUB_BRANCH || "main" };
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

export async function listPostFiles(config) {
  const entries = await call(
    config,
    `/repos/${config.repo}/contents/${WRITING_DIR}?ref=${encodeURIComponent(config.branch)}`
  );
  if (!entries) return [];
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
  return { sha: result.content.sha, commit: result.commit.sha };
}
