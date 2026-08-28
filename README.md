# lolwierd.com

Ayaan Retiwala's site. Astro, static output, deployed to Cloudflare Pages.

```bash
npm install
npm run dev
```

Read `DESIGN.md` before changing anything visual. Most of what looks arbitrary
in here was decided on purpose, and that file says why.

## where things are

The writing is markdown in `src/content/writing`. `src/content.config.ts` is the
schema: a title, a summary, a date, an optional updated date, tags, and a draft
flag. Nothing else. Posts are files with a history rather than rows in a
database, and everything else here is arranged to keep them that way.

`src/pages/index.astro` is the front page and carries the scene. The sky, the
weather and the Annapurna ridge are drawn on a canvas by the scripts in
`src/scripts`, each of which explains itself at the top of the file.
`src/pages/writing` is the reading side, and it deliberately has none of that:
those pages exist to be read.

`src/styles/global.css` holds the palette, the two faces and the measurements a
page of prose uses. `writing.css` sets a post from those. Keeping the numbers in
one place is why a post and anything else that sets prose stay in step.

## light and dark

Neither follows the visitor's operating system. `suncalc` resolves the sun and
moon over Vadodara, and the page is dark when it is dark there. An inline script
in `BaseLayout.astro` sets `data-sky` before the first paint; every stylesheet
reads that attribute. Without JavaScript the attribute never appears and the CSS
falls back to `prefers-color-scheme`.

## drafts

A post with `draft: true` is not built in production. It shows on the dev server
so it can be read in place, and it stays out of `/writing/`, the sitemap and the
feed until the flag comes off.

## deploying

Push to `main`. Cloudflare Pages builds the site and serves `dist`.
