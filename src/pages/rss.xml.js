import rss from "@astrojs/rss";
import { getPosts, SITE } from "../lib/writing.js";

// Summaries only. The posts lean on code blocks and the page's own typography,
// and a feed reader renders neither the way this site does -- so the feed says
// what a post is and links to it, rather than shipping a worse copy.
export async function GET() {
  const posts = await getPosts();

  return rss({
    title: "ayaan retiwala · writing",
    description: "Posts from lolwierd.com.",
    site: SITE,
    trailingSlash: true,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.summary,
      pubDate: post.data.date,
      categories: post.data.tags,
      link: `/writing/${post.id}/`
    })),
    customData: "<language>en</language>"
  });
}
