import { json, fail } from "../../../src/lib/http.js";
import { readPost } from "../../../src/lib/post-file.js";
import {
  GitHubError,
  repoConfig,
  listPostsFast,
  listPostFiles,
  readPostFile
} from "../../../src/lib/github.js";

// The left rail's worth of facts: frontmatter only. Bodies are fetched when a
// post is opened, so the list stays cheap as the archive grows.
export const onRequestGet = async ({ env }) => {
  try {
    const config = repoConfig(env);

    // One GraphQL call for the whole folder, falling back to the Contents API
    // (one call for the directory, then one per file) if that is unavailable.
    let files = await listPostsFast(config);
    if (!files) {
      const entries = await listPostFiles(config);
      files = (
        await Promise.all(
          entries.map(async (entry) => {
            const slug = entry.name.replace(/\.md$/, "");
            const found = await readPostFile(config, slug);
            return found ? { slug, text: found.text, sha: found.sha } : null;
          })
        )
      ).filter(Boolean);
    }

    const listed = files
      .map((file) => {
        const post = readPost(file.slug, file.text);
        return {
          slug: file.slug,
          title: post.title || file.slug,
          summary: post.summary,
          date: post.date,
          updated: post.updated,
          tags: post.tags,
          draft: post.draft,
          sha: file.sha
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    // The editor prints these. Which branch a save lands on should never be
    // something to infer from the url.
    return json({ posts: listed, branch: config.branch, repo: config.repo });
  } catch (error) {
    return fail(error.message, error instanceof GitHubError ? error.status : 500);
  }
};
