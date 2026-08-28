# lolwierd.com

astro, static output, deployed to cloudflare pages. the writing lives in
`src/content/writing/*.md` and is version-controlled next to the site that
renders it. `DESIGN.md` is the reference for how the public pages should look
and sound.

```bash
npm install
npm run dev
```

---

# the editor

`/admin` is a private writing surface for this repo. it is behind cloudflare
access, it commits markdown back to `src/content/writing` through the github
contents api, and pages rebuilds from that commit. there is no database and no
cms: a post is a file with a history, which is the property worth keeping.

the cost of that is honest and known — a save takes about a minute to reach the
live site. the editor decorates the markdown in place so there is never a reason
to wait on a deploy to see what you wrote.

## the way in

triple-click the word **writing** in the site navigation. that is a convenience,
not a boundary: the gesture is in the page source and typing `/admin` works just
as well. cloudflare access is the thing that actually stops anybody, and the
pages function verifies its assertion itself.

## what you have to set up in dashboards

none of this lives in the repo, so it has to be written down.

### 1. a github fine-grained personal access token

github → settings → developer settings → personal access tokens → fine-grained
tokens → generate new token.

- **resource owner**: your account
- **repository access**: only select repositories → `lolwierd/lolwierd.com`
- **permissions**: repository permissions → **contents: read and write**. nothing
  else. no metadata beyond the read-only one github adds for you, no actions, no
  workflows.
- **expiration**: pick a date you will actually notice. a save failing with
  "bad credentials" is the reminder.

copy the token. it is shown once.

### 2. a cloudflare access application

cloudflare dashboard → zero trust → access → applications → add an application →
**self-hosted**. free tier covers this.

- **application name**: `lolwierd editor`
- **session duration**: 24 hours is comfortable
- **public hostname**: add two —
  - `lolwierd.com` path `admin*`
  - `lolwierd.com` path `api/*`
- **identity providers**: google. add it under settings → authentication first if
  it is not there yet; google's own oauth client id and secret go in that screen.
- **policy**: one policy, action **allow**, rule: `emails` → `aretiwala@gmail.com`.
  no other policy. no bypass policy, no service-token policy.

after it saves, open the application → **overview**, and copy the
**application audience (aud) tag**. it is a long hex string and the function
checks it on every request.

you also need the **team domain**, which is under zero trust → settings →
custom pages / team domain, and looks like `yourteam.cloudflareaccess.com`.

> preview deployments are the reason the function verifies the token itself.
> access policies are attached to hostnames, and `*.pages.dev` is not the
> hostname you protected. a request that reaches the worker without a valid
> assertion for **this** application gets a 403 from the function regardless.

### 3. pages environment variables

cloudflare dashboard → workers & pages → your pages project → settings →
environment variables → production. add all five, and use **encrypt** on the
token:

| name | value | notes |
| --- | --- | --- |
| `GITHUB_TOKEN` | the fine-grained pat | **encrypted**. never sent to the browser. |
| `GITHUB_REPO` | `lolwierd/lolwierd.com` | owner/repo |
| `GITHUB_BRANCH` | `main` | the branch pages builds |
| `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com` | no scheme |
| `CF_ACCESS_AUD` | the application audience tag | from the access application |

`ADMIN_EMAIL` is optional. set it to `aretiwala@gmail.com` and the function also
checks the email claim, so the allowed list exists somewhere you can read it in
the repo as well as in the dashboard. leaving it unset means "trust the access
policy", which is a real answer, not a weaker one.

redeploy after adding them: pages functions read the environment at deploy time.

### 4. nothing else

no kv namespace, no d1, no r2, no build command change. `functions/` is picked up
automatically by pages and deployed alongside the static build.

## how it fits together

```
/admin (static page, editor js)
   │  fetch
   ▼
/api/posts, /api/posts/<slug>          ← cloudflare access guards the edge
   │                                     functions/api/_middleware.js verifies
   │                                     the Cf-Access-Jwt-Assertion itself
   ▼
github contents api  →  commit on main  →  pages build  →  live in ~1 minute
```

- `functions/api/posts/index.js` lists posts, `[slug].js` reads and writes one.
- `src/lib/post-file.js` is the only thing that knows the file format, and the
  browser, the dev endpoint and the function all import it, so the validation in
  the editor is the same validation the build applies.
- `src/pages/admin/preview/[...slug].astro` builds every post, drafts included,
  as a private page under `/admin/`.
- `src/lib/access.js` verifies the access jwt: signature against the team's
  public keys, `aud`, `iss`, `exp`. tested against expired, cross-application,
  wrong-key, `alg: none` and tampered tokens.

## drafts

a post with `draft: true` is not built into `/writing/`, the sitemap or the
feed — that has not changed. it *is* built to `/admin/preview/<slug>/`, which
sits inside the path the access application already covers and is marked
noindex by the page, the middleware and `_headers`. so a draft can be read on a
phone in the real type, with the real code highlighting, without being
published. `preview ↗` in the editor's top line opens it.

that page is the last build, not the buffer: instant locally, and about a minute
behind a save in production. published posts get one too, which is the way to
see a revision before it is live.

## local development

`npm run dev` and open `/admin`. `src/integrations/dev-editor.mjs` answers the
same two endpoints from disk, so local edits are instant, need no token and
never touch github. it hangs off `astro:server:setup` and so does not exist in a
build.

`draft: true` posts are visible on the dev server and are not built in
production, which is the behaviour `src/lib/writing.js` already had.

## keys

| | |
| --- | --- |
| `⌘S` | save — commits, or writes to disk locally |
| `⌘K` | wrap the selection in a link |
| `⌘⇧F` | focus mode |
| `esc` | leave focus mode, or close the post list |

## what it deliberately does not do

- **no image or file uploads.** out of scope. put images in `public/assets/` and
  reference them from the markdown as you always have. half an upload flow —
  one that can add a file but not replace, rename or delete one — would be worse
  than none.
- **no delete.** removing a post is `git rm`, which is the right amount of
  friction for the one action that is not undoable from the editor.
- **no rename.** the slug is fixed once a post exists, because a live url is a
  promise. move the file in git if you mean it.
- **no editor javascript on public pages.** the codemirror bundle is imported by
  `/admin` only; astro scopes it to that page. the one script the public pages
  gained is the ~1kb nav gesture.
- **no time of day on dates.** the form is date-only, so a post whose
  frontmatter carried a `2022-09-12T08:58:00` keeps the date and loses the time
  the first time it is saved from the editor.

## decisions worth knowing

- **the frontmatter form looks like the post header**, not like a settings
  panel: title, summary, then one mono line of date, tags, slug and the draft
  toggle. it is the same three elements in the same order as `/writing/<slug>`,
  and it costs three lines instead of a screenful.
- **no sidebar.** the post list is a view you go to (`posts`) and come back
  from, printed in the same shape `/writing/` uses — mono line, serif title,
  summary. a permanent rail beside the writing is furniture that never earns its
  width, and the editor is one column because the page it writes for is one
  column.
- **live preview, no preview pane.** the line the caret is on shows its
  markdown; every other line shows the result. it is still one document of
  markdown — nothing is parsed into a second rendered view, so nothing can drift
  out of sync with the file. the markers are simply not painted where you are
  not editing.
- **the editor follows your os theme.** the public pages follow the sun over
  vadodara; this is a tool, opened at whatever hour, and giving it a night mode
  because it is dark in gujarat would be a costume.
- **conflicts are detected, not merged.** every save carries the blob sha it was
  opened at. if the file moved on in the repo the save is refused with that in
  words, and your text stays in the buffer.
- **the post list reads every file.** one contents call per post. at this size
  that is a few parallel requests; if the archive gets big enough for it to
  hurt, the fix is a single graphql query for the tree, not a cache.
