# portfolio design

## the feeling

this should not read as a portfolio template with scenery added to it.

the first viewport is a place: quiet sky, a mountain range, a small amount of writing. the page should feel calm enough that a visitor notices their own pace changing. nothing on the page explains that intention. there is no copy about craft, calm, mountains, dithering, or "experience." the effect only works if the page simply behaves that way.

the work underneath is closer to a field notebook than a résumé. exact technical details are welcome, but lists of technologies and claims of competence are not the point. a few specific things should make the rest believable.

## composition

desktop and mobile are different crops of the same place.

on desktop, the writing stays compact in the upper-left and the range carries the lower half of the frame. empty sky is deliberate negative space between them, not leftover viewport. the headline is intentionally smaller than a modern portfolio hero; it should be readable before it is impressive.

on mobile, the text gets its own breathing room above the ridge. it must not become a desktop layout squeezed into a narrow column. navigation remains small, the headline stays compact, and the mountain still arrives as a range rather than a wallpaper crop.

below the hero, the scenery ends cleanly. content sits on an opaque reading ground with thin rules, quiet labels, and generous vertical rhythm. no cards.

## image

the mountain is rendered from the annapurna photograph in `public/assets/annapurna-circuit.jpg`.

the photograph is never shown directly. the browser finds the rock/sky handoff per rendered column, transforms terrain luminance separately for light and dark themes, and runs atkinson error diffusion at canvas resolution. the output is one ink color with alpha, so the page background is the paper between dots.

the terrain is still. always.

## motion

motion belongs to weather and sky, and should take longer to notice than to miss.

- a sparse star field changes brightness slowly. stars are points, not sparkles.
- a few stars can disappear and return elsewhere, but only through long fades.
- fog sits inside the valley and breathes through fixed dither seats. the dots do not crawl; density changes around them.
- a comet is rare: the first one may not happen for minutes. it crosses quickly, stays above the ridge, and is easy to miss.
- there is no supernova, satellite, parallax, cursor effect, or decorative animation.
- `prefers-reduced-motion` freezes the same composition at a stable phase.

the page itself gets one short settling motion on load. after that, content stays put.

## voice

lowercase is part of the voice, not a gimmick.

copy should be plain and specific. avoid résumé verbs stacked into bullets. avoid abstract claims such as "building resilient systems at scale." show one failure mode, one strange bug, one concrete implementation detail instead.

project links should not turn every row into an interface. project names are plain text; github is available once, quietly, after the list and in the footer.

## palette

light mode is warm paper, charcoal ink, and a single rust accent.

dark mode is near-black, bone ink, and the same rust made slightly brighter.

the themes are composed separately. the mountain tone mapping, stars, and fog all have theme-specific density/alpha rather than being inverted.
