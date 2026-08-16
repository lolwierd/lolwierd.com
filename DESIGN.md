# portfolio design

## the feeling

this should not read as a portfolio template with scenery added to it.

the first viewport is a place: sky, weather, a mountain range, a small amount of writing. the scene should feel alive enough to hold attention without turning into an effects demo. nothing on the page explains that intention. there is no copy about craft, calm, mountains, dithering, or "experience." the effect only works if the page simply behaves that way.

the work underneath is closer to a field notebook than a résumé. exact technical details are welcome, but lists of technologies and claims of competence are not the point. a few specific things should make the rest believable.

## composition

desktop and mobile are different crops of the same place.

on desktop, the writing stays compact in the upper-left and the range carries the lower half of the frame. empty sky is part of the composition, but it is no longer inert: the atmosphere gives it time and depth.

on mobile, the text gets its own breathing room above the ridge. it must not become a desktop layout squeezed into a narrow column. navigation remains small, the headline stays compact, and the mountain still arrives as a range rather than a wallpaper crop.

below the hero, the scenery ends cleanly. content sits on an opaque reading ground with thin rules, quiet labels, and generous vertical rhythm. no cards.

## image

the mountain is rendered from the real annapurna photograph in `public/assets/annapurna-circuit.jpg`.

the photograph supplies the terrain geometry and every luminance value used by the dither. `public/assets/annapurna-skyline.json` is a small ridge trace derived directly from that same photograph. keeping the photo-derived ridge explicitly avoids trying to rediscover the rock/sky boundary from jpeg colours on every device, which was fragile around bright snow.

at runtime the ridge trace is mapped through the current desktop or mobile crop, the photographed terrain luminance is transformed separately for light and dark themes, and atkinson error diffusion runs at canvas resolution. the output is one ink colour with alpha, so the page background is the paper between dots.

the skyline stays faithful to the photograph and deliberately crisp. the terrain itself never moves.

## the living boundary

the ridge should look decisive at a glance and alive only when watched.

a very thin band outside the photographed skyline uses a slowly evolving fbm/noise field underneath a fixed ordered-dither threshold pattern. the base mountain never fades or translates. instead, a sparse set of individual pixels just outside the edge can appear, disappear, or lift by roughly a pixel as the field changes.

this is not blur, glow, feathering, or an animated mountain silhouette.

## motion

motion belongs to the air, not the mountain. it should be noticeable when someone stays with the first viewport, but it must never become a looping effect pasted over the photograph.

### dark

- the sky stays mostly empty, with an irregular set of stars rather than a decorative star pattern.
- stars breathe and shimmer independently; a small subset fully fades out and returns at another seat.
- a second faint mist field gives the valley a little more depth without competing with the sky.
- comets remain rare, randomized at minute-scale intervals, quick, and constrained above the ridge.
- an occasional dim satellite can cross slowly enough to be missed entirely.

### light

- there are no daytime stars.
- daylight is weather-led: a broad lower cloud system occupies the basin and a thinner upper veil reaches across the shoulders of the range.
- neither layer slides across the page. their seats stay anchored to the mountain composition while two interacting warped-noise fields continually reform which dither pixels are visible.
- the lower cloud and upper veil breathe on different roughly 20–30 second cycles, with a small position-dependent daylight modulation so the change feels like cloud cover affecting the air rather than a global opacity pulse.
- the change is intentionally legible within several seconds. the range can feel different after ten seconds while its photographed geometry remains fixed.

`prefers-reduced-motion` freezes the same composition at a stable phase.

## voice

lowercase is part of the voice, not a gimmick.

copy should be plain and specific. avoid résumé verbs stacked into bullets. avoid abstract claims such as "building resilient systems at scale." show one failure mode, one strange bug, one concrete implementation detail instead.

project links should not turn every row into an interface. project names are plain text; github is available once, quietly, after the list and in the footer.

## palette

light mode is warm paper, charcoal ink, and a single rust accent.

dark mode is near-black, bone ink, and the same rust made slightly brighter.

the themes are composed separately. mountain tone mapping and weather have theme-specific density/alpha; dark gets the active sky, light gets the heavier weather. neither is an inversion of the other.
