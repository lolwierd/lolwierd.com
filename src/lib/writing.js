import { getCollection } from "astro:content";

export const SITE = "https://lolwierd.com";

// Drafts stay visible while the dev server is running and never leave the repo
// in a build, so a half-written post can be read in place without a flag that
// has to be remembered on the way out.
export async function getPosts() {
  const posts = await getCollection("writing", ({ data }) =>
    import.meta.env.PROD ? !data.draft : true
  );
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

// Lowercase throughout, like the rest of the voice. Fixed to UTC so a post
// published late in the evening in Vadodara does not build with yesterday's
// date on a machine in another timezone.
const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec"
];

export function formatDate(date) {
  return `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

// Counted from the markdown source, so it is an estimate of the prose and not
// of the rendered page. 220 words a minute, floored at one.
export function readingTime(body = "") {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

export function postUrl(post) {
  return `/writing/${post.id}/`;
}
