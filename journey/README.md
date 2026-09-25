# the long way up

A sixty second film, `out/the-long-way-up.mp4`. Where `reel/` climbs the stack,
this one tells the story: svit, the gate year, two free oracle boxes, the
interviews that did not happen, a frontend ticket that turned into firecracker
two days in, three years at excloud, the side projects, warpbuild, and the range
at the top.

It is printed in the same shop as the reel. `film.js` starts from `reel/reel.js`
(the dither, the buffers, the terrain and the layer scenes, which run again here
at speed as the excloud montage) and adds the story on top. The altimeter tape
counts years instead of metres. Nothing here is part of the Astro build.

```bash
python3 -m http.server              # from the repo root
open http://localhost:8000/journey/ # plays live, in sync with the score
```

## rendering

```bash
node journey/render.mjs --cues   # writes out/cues.json
python3 journey/score.py         # writes out/score.wav from the cues
node journey/render.mjs          # frames -> out/picture.mp4, then muxes the film
```

Same requirements as `reel/`: Playwright with Chromium, an ffmpeg with libx264
(`pip install imageio-ffmpeg`, or set `FFMPEG=`), numpy and scipy.

## the words

Every line is on screen, in this order.

| time | chapter | line |
|---|---|---|
| 0:00 | | the long way up |
| 0:03 | 2018 · svit, vasad | 2018. computer engineering at svit. / i ran web and design for the college fest. / then the college asked us to build their app. |
| 0:09 | 2022 · graduation | after college, one goal: build the things other people build on. |
| 0:12 | 2022 · gate | 2022. full-time gate prep, aiming for iisc. / three months in: cramming is not for me. / so i learned how things actually work. |
| 0:18 | 2022 · oracle free tier | a raspberry pi. linux internals. go. / two free oracle arm servers. i self-hosted everything. / even my own mail server. |
| 0:23 | 2023 · job hunt | i thought i was ready. / i couldn't even get interviews. / so i applied to everything. |
| 0:28 | 2023 · vaultci | 2023. a frontend opening at vaultci. / i did frontend for about two days. / arjun was building it on firecracker. / "want to give it a shot?" |
| 0:34 | | yes. |
| 0:35 | 2023–26 · excloud | three years, one public cloud, / from the hypervisor up. / arjun reviewed everything i built. / design for the scale you have. know where it breaks. |
| 0:43 | 2026 · handover | when i left, aug 2026: 4,000+ accounts, 380 active vms, 140 managed postgres clusters, 20+ internal services |
| 0:46 | always · side projects | 1 thing i love 2 do is overdo. |
| 0:49 | 2026 · warpbuild | now: the infrastructure behind warpbuild's ci runners. |
| 0:52 | now · vadodara | i build systems from the machine up. / lolwierd.com / still climbing. |

The story comes from the drafts in `src/content/writing` (`journey`,
`simple-design`, `mental-reset`, `kobo-shenanigans`) and the resume.
