import { getPosts, SITE } from "../lib/writing.js";

// Generated rather than kept by hand in public/: a static sitemap goes stale the
// first time a post is published and nobody remembers to edit it.
export async function GET() {
  const posts = await getPosts();

  const urls = [
    { loc: "/", priority: "1.0" },
    { loc: "/writing/", priority: "0.7" },
    { loc: "/colophon/", priority: "0.3" },
    ...posts.map((post) => ({
      loc: `/writing/${post.id}/`,
      priority: "0.6",
      lastmod: (post.data.updated ?? post.data.date).toISOString().slice(0, 10)
    }))
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) =>
      `  <url><loc>${SITE}${url.loc}</loc>${
        url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ""
      }<priority>${url.priority}</priority></url>`
  )
  .join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
}
