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

the photograph is never shown directly. the browser finds the rock/sky handoff per rendered column, transforms terrain luminance separately for light and dark themes, and runs atkinson error diffusion at canvas resolution. the output is one ink color with alpha, so the page background is the paper between dots.

the skyline is deliberately crisp. only tiny jpeg spikes are removed; broad smoothing is not allowed to round the peaks. terrain pixels remain full-strength right up to the detected skyline.

the terrain is still. always.

## the living boundary

the ridge should look decisive at a glance and alive when watched.

a razor-thin band outside the skyline uses the same useful idea as React Bits' Dither: a slowly evolving fbm/noise field runs underneath a fixed 8x8 ordered-dither threshold pattern. the base mountain never fades or moves. instead, a small number of pixels just outside the hard edge appear, disappear, and lift by a pixel or two as the field changes.

this is not blur, glow, feathering, or an animated mountain silhouette. the mountain/sky handoff stays hard in every frame.

## motion

this page is closer to a very quiet film than a still photograph. randomness should be asynchronous and non-repeating enough that the scene does not reveal a loop.

### dark

night is sky-led.

- a broad, irregular star field fills the usable sky rather than placing a few evenly spaced points.
- stars have independent primary twinkle, slower breathing, and small high-frequency shimmer. a minority occasionally flare for a moment.
- several stars disappear completely and reappear at another seat through long fades.
- valley cloud remains, but it is lower-density and secondary to the sky.
- comets happen occasionally, at randomized minute-scale intervals, cross quickly, and stay above the ridge.

### light

day is weather-led.

- there are no decorative daytime stars.
- a much larger cloud system occupies the basin and reaches across much of the range.
- the cloud does not slide across the page like a sprite. its footprint stays tied to the valley while the internal dither density swells, ebbs, rolls, and reforms.
- an upper veil can reach across shoulders of the mountain, so portions of the range disappear and return as the weather breathes.

both cloud systems use moving warped-noise density under fixed dither seats, so movement reads as changing weather rather than translated geometry.

`prefers-reduced-motion` freezes the same composition at a stable phase.

## voice

lowercase is part of the voice, not a gimmick.

copy should be plain and specific. avoid résumé verbs stacked into bullets. avoid abstract claims such as "building resilient systems at scale." show one failure mode, one strange bug, one concrete implementation detail instead.

project links should not turn every row into an interface. project names are plain text; github is available once, quietly, after the list and in the footer.

## palette

light mode is warm paper, charcoal ink, and a single rust accent.

dark mode is near-black, bone ink, and the same rust made slightly brighter.

the themes are composed separately. mountain tone mapping and weather have theme-specific density/alpha; dark gets the active sky, light gets the heavier weather. neither is an inversion of the other.
