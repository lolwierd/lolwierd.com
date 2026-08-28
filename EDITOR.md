# the editor

`/admin` is a private writing surface for this repo. It commits markdown back to
`src/content/writing` through the GitHub Contents API, and Pages rebuilds from
that commit. No database and no CMS: a post stays a file with a history, and
that is the whole reason for the arrangement.

It costs about a minute for a save to reach the live site. The editor renders
its own page so that you are not waiting on a deploy to see what you wrote.

## the way in

Press and hold the site name — “ayaan retiwala” in the top-left — for about three quarters of a second. A small “holding…” pill appears while you hold, then it goes to `/admin`. That is a convenience, not a boundary. The gesture is in the page source and typing `/admin` works just as well. Cloudflare Access is the thing that stops anybody, and the Pages Function verifies its assertion itself. On a keyboard, focus the name and hold Enter or Space.

## what has to be set up by hand

None of this lives in the repo, so it is written down here.

### a GitHub fine-grained token

GitHub, then Settings, Developer settings, Personal access tokens, Fine-grained
tokens, Generate new token.

Set the resource owner to your account and the repository access to only
`lolwierd/lolwierd.com`. Under repository permissions give it Contents: read and
write, and nothing else. Pick an expiry you will actually notice; a save failing
with "bad credentials" is the reminder. Copy the token when it is shown, because
it is shown once.

### a Cloudflare Access application

Zero Trust, then Access, Applications, Add an application, Self-hosted. The free
tier covers this.

Name it whatever you like and give it a session duration you can live with. Add
two public hostnames on the same application: `lolwierd.com` with path `admin*`,
and `lolwierd.com` with path `api/*`. If you want the editor to work on preview
deployments as well, add `lolwierd-com.pages.dev` and the wildcard
`*.lolwierd-com.pages.dev`, because every deployment gets its own subdomain.
They must be on the same application, or the audience tag will not match the one
the Function checks.

Add Google as the identity provider under Settings, Authentication. Then write
one policy: action Allow, rule `emails` equals your address. No second policy, no
bypass, no service token.

When it saves, open the application overview and copy the Application Audience
tag. It is a long hex string. The team domain is under Zero Trust, Settings, and
looks like `yourteam.cloudflareaccess.com`.

Preview deployments are the reason the Function verifies the token itself.
Access policies attach to hostnames, and a request that reaches the Worker
without a valid assertion for this application gets a 403 whatever hostname it
arrived on.

### Pages environment variables

Workers and Pages, your project, Settings, Environment variables. Add these to
production, and encrypt the token:

| name | value |
| --- | --- |
| `GITHUB_TOKEN` | the fine-grained token, encrypted |
| `GITHUB_REPO` | `lolwierd/lolwierd.com` |
| `GITHUB_BRANCH` | `main` |
| `CF_ACCESS_TEAM_DOMAIN` | `yourteam.cloudflareaccess.com`, no scheme |
| `CF_ACCESS_AUD` | the application audience tag |
| `ADMIN_EMAIL` | your address. optional, and worth setting |

Add the same to the preview environment except `GITHUB_BRANCH`. Leave that one
unset there and the Function falls back to `CF_PAGES_BRANCH`, which Pages sets
per deployment, so the editor on a preview URL reads and writes that preview's
own branch instead of quietly committing to main from a page that is not main.
The branch it will write to is printed in the editor's top line and linked to
that branch on GitHub.

`ADMIN_EMAIL` makes the Function check the email claim as well as the signature
and the audience. Leaving it unset means trusting the Access policy alone, which
is a defensible way to run it. Setting it puts the allowed address somewhere you
can read it in the repo.

Redeploy after changing any of these. Pages binds environment variables at
deploy time, so an existing deployment will not pick them up.

Nothing else: no KV namespace, no D1, no R2, no change to the build command.
Pages picks up `functions/` on its own.

## how it fits together

```
/admin  (static page, editor javascript)
   |  fetch
   v
/api/posts, /api/posts/<slug>        <- Access guards the edge, and
   |                                    functions/api/_middleware.js verifies
   |                                    the Cf-Access-Jwt-Assertion itself
   v
GitHub Contents API -> commit -> Pages build -> live in about a minute
```

`src/lib/post-file.js` is the only thing that knows what a post file looks like.
The browser, the dev endpoint and the Function all import it, so the validation
the editor runs before a save is the validation the build would apply after one.

`src/lib/access.js` verifies the Access JWT: the signature against the team's
public keys, then `aud`, `iss` and `exp`. It is tested against expired tokens,
tokens for another application, tokens signed by another key, tokens naming no
key, tokens claiming `alg: none`, and tampered payloads.

`src/lib/github.js` reads the whole writing folder in one GraphQL query, with
the Contents API as a fallback if that is unavailable. The Contents API needs one
call per post, and those calls were the editor's slowest moment.

## drafts

A draft is not built into `/writing/`, the sitemap or the feed. It is built to
`/admin/preview/<slug>/`, which sits inside the path the Access application
already covers and is marked noindex by the page, the middleware and `_headers`.
So a draft can be read on a phone, in the type it will actually have, without
being published. The `preview` link in the editor's top line opens it.

That page is the last build rather than the current buffer: instant locally, and
about a minute behind a save in production. Published posts get one too, which is
how you look at a revision before it goes live.

`/writing/` also lists the drafts above the years, but only for a request Access
lets through to `/api/posts`. Drafts are not built into any public page, so there
is nothing on that page for a visitor to reveal. The server decides what comes
back and the browser only asks. An `edit` link sits in the meta line of every
post and every entry; it ships in the markup and is revealed before the first
paint by a flag in localStorage, so it costs no request. The flag gates nothing.
The link points at `/admin`, and Access decides whether that page opens.

## writing locally

`npm run dev`, then open `/admin`. `src/integrations/dev-editor.mjs` answers the
same two endpoints from disk, so local edits are instant, need no token and never
touch GitHub. It hangs off `astro:server:setup` and therefore does not exist in a
build.

That endpoint has no authentication, which is right for `astro dev` on localhost
and wrong the moment you run `astro dev --host`. That publishes an
unauthenticated write-to-disk endpoint on the local network. Do not.

## keys

| | |
| --- | --- |
| `⌘S` | save. commits, or writes to disk locally |
| `⌘K` | wrap the selection in a link |
| `⌘⇧F` | focus mode |
| `esc` | leave focus mode, or close the post list |
| `tab` | indents in the editor rather than moving on. `esc` first to leave |

## what it does not do

No image or file uploads. Put images in `public/assets` and reference them from
the markdown the way you always have. Half an upload flow, one that can add a
file but not replace, rename or delete one, would be worse than none.

No delete. Removing a post is `git rm`, which is the right amount of friction for
the one action the editor cannot undo.

No rename. The slug is fixed once a post exists, because something may already
link to it. Move the file in git if you mean it.

No editor JavaScript on public pages. Astro scopes a page's script to that page,
and the CodeMirror bundle is imported by `/admin` alone. The only thing the
public pages gained is the navigation gesture, which is about a kilobyte.

## why it works the way it does

The editor is one column and the post list is a place you go to rather than a
rail beside the writing. A permanent list of three posts is furniture that never
earns its width.

The frontmatter is edited as the post's own header: the title, the summary, then
one mono line of date, tags, slug and the draft toggle. Same three things in the
same order as `/writing/<slug>`, so editing a post looks like reading one.

The line the caret is on shows its markdown and every other line shows the
result. It is still one document of markdown, so nothing can drift out of sync
with the file. Inline marks reveal with the element rather than the line, because
a paragraph written as one long source line would otherwise drop six lines of
prose back to source when the caret landed anywhere in it.

Code in a fence is highlighted in Shiki's colours. The post pages run
vitesse-light and vitesse-dark through Shiki at build time; the editor is
highlighting live source and cannot run Shiki, so the token values were read out
of a built post's HTML and written into `admin.css` as light and dark pairs. Go
and JSON load on demand, being the only languages these posts fence.

`--measure` and the other prose tokens live in `global.css` and are read by the
post page and the editor alike, so what is written and what is read cannot drift
apart. The editor is still styled source text rather than rendered HTML. A link
is a coloured span and not an `<a>`, but every measurement behind it is the same
one.

The header never reflows. The save state is one word: unsaved, committing, saved
or failed. The commit sha, the error and the restore notice go to a toast, the
same element the sky's cheat codes use. A commit landing must not move the line
above the writing.

Conflicts are detected and never merged. Every save carries the blob sha it was
opened at, and a file that moved on in the repo is refused in words with your
text still in the buffer.

A date the form did not change is written back exactly as the file had it, so a
post carrying `2022-09-12T08:58:00` keeps its time through a save that was about
the prose.

## the browser holds a copy

The working buffer goes to localStorage on a debounce, and it is flushed when the
tab is hidden as well as on unload, because `beforeunload` does not fire reliably
when a phone backgrounds a tab. Every access is wrapped: storage throws in a
private window, when the quota is full, and when the browser is set to block site
data. None of those are worth losing a keystroke over, so the editor stops
remembering and carries on.

The post list is cached there too, and drawn before the request for the real one
is sent. At worst it is one save out of date for a moment, which is a better
thing to look at than a skeleton.
