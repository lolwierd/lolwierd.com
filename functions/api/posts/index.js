import { json, fail } from "../../../src/lib/http.js";
import { readPost } from "../../../src/lib/post-file.js";
import { GitHubError, repoConfig, listPostFiles, readPostFile } from "../../../src/lib/github.js";

// The left rail. Frontmatter only -- the bodies are fetched one at a time when
// I open a post, so the list stays cheap as the archive grows.
export const onRequestGet = async ({ env }) => {
  try {
    const config = repoConfig(env);
    const files = await listPostFiles(config);

    const posts = await Promise.all(
      files.map(async (file) => {
        const slug = file.name.replace(/\.md$/, "");
        const found = await readPostFile(config, slug);
        if (!found) return null;
        const post = readPost(slug, found.text);
        return {
          slug,
          title: post.title || slug,
          summary: post.summary,
          date: post.date,
          updated: post.updated,
          tags: post.tags,
          draft: post.draft,
          sha: found.sha
        };
      })
    );

    const listed = posts.filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    // The editor prints this. Which branch a save lands on should never be
    // something I have to infer from the url I happen to be on.
    return json({ posts: listed, branch: config.branch });
  } catch (error) {
    return fail(error.message, error instanceof GitHubError ? error.status : 500);
  }
};
