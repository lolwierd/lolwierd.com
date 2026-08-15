# portfolio design

## the idea

the page is a quiet engineering landscape: a single mountain range holds the first viewport, while the writing is set like a field notebook below it. the image has enough visual authority to make the opening memorable, and the content earns the rest of the page through facts, systems, and measured scope.

the distinctive detail is the boundary. the mountain is made from one continuous-tone plate, then dithered once at the device-pixel resolution of the browser. the skyline is treated as a hard handoff between sky and land, so the range reads as a range before the eye starts exploring its rock and snow structure.

## choices

- the hero is left-aligned and oversized because the work is infrastructural but the person is still the subject. a centered résumé column would make the page feel like a document before it feels like a person.
- the serif display face gives the opening a slower reading rhythm. monospace is reserved for labels, dates, and measured values because those are data rather than voice.
- rust is the only accent. it marks links and the section index, so color points to something a reader can verify or follow.
- the lower page is a rule-based ledger rather than a collection of cards. every row has one job and the empty space is part of the hierarchy.
- the light theme is a warm paper with charcoal land. the dark theme is a near-black field with bone ink. the mountain tone curve and ink are chosen separately for each, because inverting a one-bit picture destroys its hierarchy.

## motion

the mountain never moves. stars (64 in dark mode, 44 in light) use fixed positions with a layered twinkle: a slow primary oscillation, a faster secondary shimmer, and occasional flare spikes that briefly brighten individual stars. each star also has a slow visibility cycle — it dims slightly for ~20% of a 10-30 second period and returns — so the visible count is always changing. a few stars relocate through long fades. a dithered veil sits in the deepest basin and lets a slow density field move through fixed dot seats; it breathes, drifts, and fades into the ridge instead of forming a second horizon. comets streak across the sky every 25-90 seconds with a bright head and trailing tail, disappearing before the skyline. a supernova occasionally flares — a star flashes bright, then an expanding ring of dithered dots spreads outward and fades over 4-7 seconds. a satellite drifts slowly across the sky every 40-160 seconds, a single dim dot that's easy to miss. reduced motion keeps the same composition at a fixed phase.

## rejected

- the prototype's broad procedural cloud bank was cut. at one-bit density it read as a detached strip of digital noise instead of weather. the retained cloud is narrower, basin-bound, and kept below the empty sky.
- a milky way band was cut because it turned the empty sky into decoration. the retained star field is sparse enough that the sky still reads as sky, with twinkling and occasional flares providing life without filling the void.
- glass panels were cut because the page needs a calm reading ground, not a stack of translucent UI objects.
- the first unsplash photograph was replaced because its cloud bank made the rock/sky boundary ambiguous after reduction. the chosen image has a readable skyline, several distinct peaks, and a central valley, so the range survives the dither at a glance.
