# portfolio design

## the feeling

this should not read as a portfolio template with scenery added to it.

the first viewport is a letterpress alpine morning or night: sky, weather, a mountain range, and a small amount of writing. the scene should feel alive enough to hold attention without turning into an effects demo. nothing on the page explains that intention. there is no copy about craft, calm, mountains, dithering, or "experience." the effect only works if the page simply behaves that way.

the work underneath is closer to a field notebook than a résumé. exact technical details are welcome, but lists of technologies and claims of competence are not the point. a few specific things should make the rest believable.

## composition

desktop and mobile are different crops of the same place.

on desktop, the writing stays compact in the upper-left and the range rises into the lower half without becoming a wall. the highest ridge begins below the copy. empty sky is part of the composition, but it is no longer inert: the atmosphere gives it time and depth.

on mobile, the text gets its own breathing room above the ridge without leaving a vacant middle. it must not become a desktop layout squeezed into a narrow column. navigation remains small, the headline stays compact, and the mountain still arrives as a range rather than a wallpaper crop.

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

the celestial layer uses the fixed coordinates of vadodara, india. `suncalc` resolves the current sun and moon altitude, azimuth, sunrise and sunset, lunar illumination, waxing direction, and bright-limb angle. the browser refreshes that projection once a minute. it never asks for the visitor's location and does not call a weather service.

### dark

- the sky is visibly populated, with an irregular field rather than a decorative star pattern. portrait gets roughly one hundred stars and desktop gets roughly one hundred and seventy, leaving calm gaps around the writing.
- stars twinkle on short, mismatched cycles; brighter ones occasionally resolve into a tiny cross-shaped glint. a small subset fully fades out and returns at another seat.
- a group of anchor stars keeps a visible floor while fainter stars breathe more freely. the sky should look inhabited immediately, not only after staring at it.
- when the moon is above vadodara's horizon, a dithered moon is projected into the sky. its illuminated fraction, waxing or waning side, and terminator angle come from the current lunar phase. sparse rim pixels twinkle independently: each vibrates by less than a pixel, eases a few pixels outward, and dims at its furthest point on a long private cycle. there is no shared pulse or solid halo. if the moon is below the horizon, the honest result is no moon.
- a second faint mist field gives the valley a little more depth without competing with the sky.
- the first comet arrives between 4.5 and 7.5 seconds; later ones return at irregular tens-of-seconds intervals. they stay quick and constrained above the ridge.
- dim satellites cross often enough that a person lingering in the hero is likely to catch one, while remaining easy to miss in a quick visit.

### light

- there are no daytime stars.
- the empty paper has a fixed, extremely sparse dither texture so it reads as material rather than unfinished space.
- when the sun is above vadodara's horizon, its progress between local sunrise and sunset controls its horizontal position and its calculated altitude controls its height. its ordered-dither edge and stippled corona use the same print language as the mountain; there is no glow or gradient.
- the sun's heat lives in independently moving edge pixels. each pixel has its own long cycle, tiny tangential vibration, and short radial range. they continuously but asynchronously ease away from the disc and dim, so the edge blazes without bursts, rays, or a synchronized breathing halo.
- there is no horizontal cirrus strip. a bounded cloud field exposed its rectangular sampling region and looked like a line of interface noise, so it was removed.
- daylight is weather-led through systems that leave the terrain geometry fixed.
- **thermal shimmer** lives exclusively along the ridge edge: a thin band of sparse individual pixels just above the skyline that appear, disappear, and occasionally lift by ~1px as a warped noise field slowly evolves. the effect reads as high-altitude wind blowing snow off the summit or thermal convection shimmering at the rock/sky boundary. it uses the same ink colour and bayer-threshold gating as the terrain, so it looks native rather than applied.
- a deterministic summit gust arrives within the first few seconds, pushing the highest loose pixels rightward as visible spindrift. later gusts repeat quietly.
- **diurnal shadow breathing** lives in the valley and couloir areas of the terrain: translucent paper-coloured dots that modulate which terrain pixels are partially lightened. two interacting warped-noise fields at different scales and speeds (roughly 25 to 40 second cycles) create the impression that the sun angle is imperceptibly shifting. the mountain "feels different" after ten seconds while its geometry stays fixed. the dots are 1px, sparse, and capped at low alpha so they lighten rather than erase.
- neither effect translates across the page. both reform in place through noise field evolution.

`prefers-reduced-motion` freezes the same composition at a stable phase.

live weather is deliberately excluded. a remote weather feed would make the hero dependent on a third party and surrender the composition to noisy, coarse conditions such as a generic `cloudy` status. the existing solar heat, spindrift, and shadow systems provide atmosphere without pretending to be a forecast.

## voice

lowercase is part of the voice, not a gimmick.

copy should be plain and specific. avoid résumé verbs stacked into bullets. avoid abstract claims such as "building resilient systems at scale." show one failure mode, one strange bug, one concrete implementation detail instead.

project links should not turn every row into an interface. project names are plain text; github is available once, quietly, after the list and in the footer.

## palette

light mode is warm paper, charcoal ink, and a single rust accent.

dark mode is near-black, bone ink, and the same rust made slightly brighter.

the themes are composed separately. mountain tone mapping and weather have theme-specific density/alpha; dark gets the active sky, light gets the heavier weather. neither is an inversion of the other.

## September editorial revision

The daytime scene now uses a cool upper sky, warm horizon and an irregular,
static dithered cloud bank to balance the copy. The desktop hero is shorter.
Solar timing and lunar phase remain calculated, but screen placement is composed
for legibility: the sun occupies the right of the desktop scene and celestial
bodies yield to the writing. This is an illustration driven by a real clock,
not a sky chart. These choices supersede exact screen-position constraints above.

Three work examples lead; the remaining seven are preserved in native details.
The handover figures precede the examples. CBManager has a real screenshot from
its repository, and contact ends with a readable email address. Mobile labels
use whole-pixel font sizes and roomier tap targets.
