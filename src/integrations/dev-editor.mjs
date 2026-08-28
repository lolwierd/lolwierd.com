import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WRITING_DIR,
  isValidSlug,
  keepUnchangedDates,
  readPost,
  serializePost,
  validatePost
} from "../lib/post-file.js";

// Local writing goes straight to the file on disk.
//
// The deployed editor commits through GitHub and waits a minute for Pages to
// rebuild. Locally there is no reason to pay for that -- or to keep a token on
// my laptop -- so the same API answers from the filesystem and the dev server's
// own watcher reloads the page. This exists only in `astro dev`: the hook it
// hangs off never runs during a build, and nothing in it is bundled.
export default function devEditor() {
  let projectRoot = process.cwd();

  return {
    name: "dev-editor",
    hooks: {
      "astro:config:done": ({ config }) => {
        projectRoot = fileURLToPath(config.root);
      },
      "astro:server:setup": ({ server, logger }) => {
        const dir = path.resolve(projectRoot, WRITING_DIR);

        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, "http://localhost");
          if (!url.pathname.startsWith("/api/posts")) return next();

          const send = (status, data) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(data));
          };

          try {
            const rest = url.pathname.slice("/api/posts".length).replace(/^\//, "");

            if (!rest && req.method === "GET") {
              const names = (await fs.readdir(dir)).filter((name) => name.endsWith(".md"));
              const posts = await Promise.all(
                names.map(async (name) => {
                  const slug = name.replace(/\.md$/, "");
                  const file = path.join(dir, name);
                  const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
                  const post = readPost(slug, text);
                  return {
                    slug,
                    title: post.title || slug,
                    summary: post.summary,
                    date: post.date,
                    updated: post.updated,
                    tags: post.tags,
                    draft: post.draft,
                    sha: version(stat)
                  };
                })
              );
              posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
              return send(200, { posts, branch: "your working tree" });
            }

            const slug = decodeURIComponent(rest);
            if (!isValidSlug(slug)) return send(400, { error: "that is not a slug" });
            const file = path.join(dir, `${slug}.md`);

            if (req.method === "GET") {
              const stat = await fs.stat(file).catch(() => null);
              if (!stat) return send(404, { error: "no post with that slug" });
              const text = await fs.readFile(file, "utf8");
              return send(200, {
                post: { ...readPost(slug, text), sha: version(stat) },
                branch: "your working tree"
              });
            }

            if (req.method === "PUT") {
              const payload = JSON.parse(await readBody(req));
              const fields = {
                title: payload.title,
                summary: payload.summary,
                date: payload.date,
                updated: payload.updated || "",
                tags: Array.isArray(payload.tags) ? payload.tags : [],
                draft: payload.draft === true
              };
              const errors = validatePost(fields);
              if (errors.length) return send(422, { error: errors.join("; ") });

              const stat = await fs.stat(file).catch(() => null);
              if (!payload.sha && stat) return send(409, { error: "a post with that slug already exists" });
              if (payload.sha && stat && version(stat) !== payload.sha) {
                return send(409, { error: "the file changed on disk since this was opened" });
              }

              const before = stat ? readPost(slug, await fs.readFile(file, "utf8")) : null;
              const extra = before ? before.extra : [];
              const kept = keepUnchangedDates(fields, before);
              await fs.writeFile(file, serializePost(kept, payload.body ?? "", extra), "utf8");
              const after = await fs.stat(file);
              return send(200, {
                slug,
                sha: version(after),
                commit: null,
                created: !stat,
                branch: "your working tree"
              });
            }

            return send(405, { error: `${req.method} is not something this endpoint does` });
          } catch (error) {
            logger.error(`dev editor: ${error.message}`);
            return send(500, { error: error.message });
          }
        });

        logger.info("dev editor: /admin writes straight to src/content/writing");
      }
    }
  };
}

// Stands in for the GitHub blob sha: enough to notice the file moved under the
// editor, which is all the sha is used for.
function version(stat) {
  return `mtime:${Math.floor(stat.mtimeMs)}:${stat.size}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error("that post is implausibly large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
