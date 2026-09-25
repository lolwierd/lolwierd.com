# reel

A thirty second showreel, `out/reel.mp4`, made from the same things the site is
made of: the Annapurna photograph, the skyline trace, the 8×8 bayer matrix,
Departure Mono and the rust accent. It climbs the stack a layer at a time
(metal, compute, storage, network, kubernetes, tooling, people) with an
altimeter counting up the right edge, and ends on the range at sunrise, which
is the front page.

Nothing here is part of the Astro build.

```bash
python3 -m http.server           # from the repo root
open http://localhost:8000/reel/ # plays live, in sync with the score
```

## rendering

```bash
node reel/render.mjs --cues   # writes out/cues.json
python3 reel/score.py         # writes out/score.wav from the cues
node reel/render.mjs          # frames -> out/picture.mp4, then muxes out/reel.mp4
```

`reel.js` draws a frame as a pure function of time, so the browser and the
renderer produce the same picture, and the renderer can step it at exactly 60fps.
`cues()` exports every event the picture draws (each core booting, each of the
379 VM splits, each block the reconciler fixes) with its time, and `score.py`
places a sound on that sample. The score is synthesised in numpy, with nothing
sampled.

Needs Playwright with Chromium, and an ffmpeg with libx264 (`pip install
imageio-ffmpeg` provides one; `FFMPEG=` overrides it), plus numpy and scipy for the
score.

Newsreader is under the SIL Open Font License, in `assets/`.
