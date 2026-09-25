# the long way up

A two minute film, `out/the-long-way-up.mp4`, in one shot.

A dot walks and the ground appears under it. The ground is the skyline of the
range from the front page, mirrored, the way a plate is cut. The college years
are the first small rises, the gate year is flat, the job hunt is the valley,
and the long climb after "yes." is the three years at excloud, with the machine
he built filling the mountain under his feet from the bottom up. At the summit
the camera pulls back until the line he walked is the whole ridge, the plate
turns over, and a roller prints it the right way round, onto paper, as the
front page.

Rust is his and only his. Things that fail print as broken ink. Every date is
in the tag that walks with him, and the words sit next to him and do not move.

`film.js` starts from `reel/reel.js` (the dither, the buffers, the terrain and
the summit, which is the day end card here) and replaces the reel's scenes with
the walk. Nothing here is part of the Astro build.

```bash
python3 -m http.server              # from the repo root
open http://localhost:8000/ascent/  # plays live, in sync with the score
```

## rendering

```bash
node ascent/render.mjs --cues   # writes out/cues.json
python3 ascent/score.py         # writes out/score.wav from the cues
node ascent/render.mjs          # frames -> out/picture.mp4, then muxes the film
```

Same requirements as `reel/`: Playwright with Chromium, an ffmpeg with libx264
(`pip install imageio-ffmpeg`, or set `FFMPEG=`), numpy and scipy.

## the words

| time | tag | on screen |
|---|---|---|
| 0:03 | 2018 | the long way up / ayaan retiwala |
| 0:10 | 2019 · svit | in college, we built our college's app. |
| 0:16 | 2021 · svit | a flag: svit app · shipped. the friends stop there. |
| 0:20 | 2022 | after college, one goal: build the things other people build on. |
| 0:29 | 2022 · gate · day N | a year of gate prep. cramming didn't work, |
| 0:35 | | so i went under the hood instead. (registers, cache, memory, disk, network) |
| 0:40 | 2022 · oracle free tier | two free oracle servers. i self-hosted everything. |
| 0:47 | 2022 · job hunt · 0 replies | i thought i was ready. / i couldn't even get interviews. |
| 1:02 | 2023 · job hunt · 1 reply | "want to give it a shot?" arjun · vaultci |
| 1:07 | | yes. |
| 1:12 | 2023 · vaultci, later excloud | three years building a public cloud, from the hypervisor up. |
| 1:12 | | the stack under his feet: sdk · cli, kubernetes, network · dns, block storage, firecracker, metal |
| 1:21 | 2024 · excloud | crashed mid-provision / reconciled |
| 1:26 | 2025 · excloud | design for the scale you have. know where it breaks. |
| 1:31 | | 4,000+ accounts |
| 1:35 | 2026 · excloud | dbconsole, cbmanager, rig, tachyon, flickturn, lolwierd.com |
| 1:39 | 2026 · warpbuild | now: the infrastructure behind warpbuild's ci runners. |
| 1:49 | | 2018 · svit, 2023 · vaultci, 2026 · warpbuild |
| 1:52 | | i build systems from the machine up. the dot waits on the summit, then hops down and types lolwierd.com. still climbing. |

The story comes from the drafts in `src/content/writing` (`journey`,
`simple-design`, `mental-reset`, `kobo-shenanigans`) and the resume.
