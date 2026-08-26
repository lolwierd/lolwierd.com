import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Posts are markdown files on disk, read at build time. No CMS, no database:
// the site is static and the writing is version-controlled alongside it.
const writing = defineCollection({
  loader: glob({ base: "./src/content/writing", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    // Shown under the title in the list and used as the meta description, so it
    // is a real sentence rather than a keyword line.
    summary: z.string(),
    date: z.coerce.date(),
    // Only set when a post is materially revised after publishing; the post
    // page says so rather than silently rewriting history.
    updated: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    // Drafts are written in the repo like everything else and are simply not
    // built. Nothing half-finished ships because a flag was forgotten.
    draft: z.boolean().default(false)
  })
});

export const collections = { writing };
