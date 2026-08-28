import { json, fail } from "../../../src/lib/http.js";
import {
  isValidSlug,
  keepUnchangedDates,
  readPost,
  serializePost,
  validatePost
} from "../../../src/lib/post-file.js";
import {
  GitHubError,
  repoConfig,
  readPostFile,
  writePostFile,
  deletePostFile,
  readRedirectsFile,
  writeRedirectsFile,
  coalesceRedirects
} from "../../../src/lib/github.js";

export const onRequestGet = async ({ env, params }) => {
  const slug = String(params.slug);
  if (!isValidSlug(slug)) return fail("that is not a slug", 400);

  try {
    const config = repoConfig(env);
    const found = await readPostFile(config, slug);
    if (!found) return fail("no post with that slug", 404);
    const post = readPost(slug, found.text);
    return json({ post: { ...post, sha: found.sha }, branch: config.branch });
  } catch (error) {
    return fail(error.message, error instanceof GitHubError ? error.status : 500);
  }
};

export const onRequestPut = async ({ env, params, request }) => {
  const slug = String(params.slug);
  if (!isValidSlug(slug)) return fail("that is not a slug: lowercase words joined by hyphens", 400);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return fail("could not read the request body", 400);
  }

  const fields = {
    title: payload.title,
    summary: payload.summary,
    date: payload.date,
    updated: payload.updated || "",
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    draft: payload.draft === true
  };

  const newSlug = typeof payload.newSlug === "string" ? payload.newSlug.trim() : "";
  const isRename = Boolean(newSlug && newSlug !== slug);
  if (isRename && !isValidSlug(newSlug)) return fail("that new slug is not valid: lowercase words joined by hyphens", 400);

  // The same validation the editor already ran, run again here. The editor is
  // the only client, but a check that only lives in the browser is not a check.
  const errors = validatePost(fields);
  if (errors.length) return fail(errors.join("; "), 422);

  try {
    const config = repoConfig(env);
    const existing = await readPostFile(config, slug);

    if (!payload.sha && existing) {
      return fail("a post with that slug already exists", 409);
    }
    if (payload.sha && existing && existing.sha !== payload.sha) {
      return fail("the file changed in the repo since this was opened", 409);
    }
    // Opened, then deleted in the repo underneath. Writing it back would say
    // "saved" while quietly recreating a post someone removed, and would drop
    // any frontmatter key this editor does not manage along the way.
    if (payload.sha && !existing) {
      return fail("that post is no longer in the repo -- it was deleted since this was opened", 409);
    }

    if (isRename) {
      const target = await readPostFile(config, newSlug);
      if (target) return fail("a post with that new slug already exists", 409);
    }

    // Any frontmatter key this editor does not manage is carried over from the
    // file as it stands, rather than trusted from the browser, so a save can
    // never invent one.
    const before = existing ? readPost(slug, existing.text) : null;
    const beforeDraft = before ? before.draft : false;
    const extra = before ? before.extra : [];
    const kept = keepUnchangedDates(fields, before);
    const text = serializePost(kept, payload.body ?? "", extra);

    if (isRename) {
      // Create new file first so a failure doesn't leave us with neither.
      const written = await writePostFile(config, newSlug, text, undefined, `rename: ${slug} → ${newSlug}: ${fields.title}`);
      // Only renames of published posts get history — drafts were never indexed.
      // Gate on the *before* draft, so a published post that is also being
      // set to draft in the same save still leaves a 301 for the old indexed URL.
      if (!beforeDraft) {
        try {
          const { text: redirText, sha: redirSha } = await readRedirectsFile(config);
          const next = coalesceRedirects(redirText, slug, newSlug);
          if (next !== redirText) {
            await writeRedirectsFile(config, next, redirSha, `redirect: /writing/${slug}/ → /writing/${newSlug}/`);
          }
        } catch (e) {
          // Redirect write failing shouldn't roll back the rename — the post moved fine.
          console.error("redirect write failed", e);
        }
      }
      // Now delete old file
      if (existing) {
        try {
          await deletePostFile(config, slug, existing.sha, `rename: ${slug} → ${newSlug}: ${fields.title}`);
        } catch (e) {
          // New file exists, old couldn't be removed — surface but don't 500 the rename.
          console.error("delete old slug failed", e);
        }
      }
      return json({
        slug: newSlug,
        sha: written.sha,
        commit: written.commit,
        created: !existing,
        renamed: true,
        oldSlug: slug,
        branch: config.branch,
        repo: config.repo
      });
    }

    const written = await writePostFile(
      config,
      slug,
      text,
      existing ? existing.sha : undefined,
      `${existing ? "edit" : "new post"}: ${fields.title}`
    );

    return json({
      slug,
      sha: written.sha,
      commit: written.commit,
      created: !existing,
      branch: config.branch,
      repo: config.repo
    });
  } catch (error) {
    return fail(error.message, error instanceof GitHubError ? error.status : 500);
  }
};
