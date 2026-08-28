import { json, fail } from "../../../src/lib/http.js";
import { isValidSlug, readPost, serializePost, validatePost } from "../../../src/lib/post-file.js";
import { GitHubError, repoConfig, readPostFile, writePostFile } from "../../../src/lib/github.js";

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

    // Any frontmatter key this editor does not manage is carried over from the
    // file as it stands, rather than trusted from the browser, so a save can
    // never invent one.
    const extra = existing ? readPost(slug, existing.text).extra : [];
    const text = serializePost(fields, payload.body ?? "", extra);

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
      branch: config.branch
    });
  } catch (error) {
    return fail(error.message, error instanceof GitHubError ? error.status : 500);
  }
};
