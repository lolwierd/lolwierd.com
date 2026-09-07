// Cloud identity survives every frame. Only an offscreen cloud is replaced.
// Positions are viewport fractions, so resizing doesn't restart the weather.
//
// What actually stands over this range, and how each form behaves:
//
//   cirrus      rides the jet stream -- the highest thing up there and the
//               fastest, thin and fibrous.
//   cumulus     builds off the warm valley through the afternoon, so it is
//               lower, slower, lumpier, and there is far more of it by day.
//   lenticular  the one everybody photographs over these peaks. It forms in the
//               standing wave downwind of the ridge and holds station in a gale,
//               so it barely travels and its edges are glassy rather than
//               ragged. A true one does not move at all; this one crawls,
//               because a field that recycles offscreen has to eventually.
//   bank        the sheet that lies at pass height. This is the one that reaches
//               the range: over the Annapurna sanctuary the ordinary sight is a
//               deck sitting in the valley with the summits standing clear of
//               it, so the bank is allowed below the skyline and the others are
//               not. Its edges stay soft -- it is a sheet, not a lens.
//
// Not modelled, and both for the same kind of reason.
//
// The summit banner streams off one particular peak and stays pinned to it.
// Nothing in a field of drifting viewport fractions can be honest about a cloud
// that belongs to a mountain rather than to the sky.
//
// Overcast is the other one, and it is not for want of realism: eight oktas is
// the commonest sky there is, and over this range in monsoon season it is most
// days. It was built and then taken out again. An overcast sky is the one sky
// with nothing in it, and the subject here is a mountain, so a weather state
// whose entire content is that you cannot see the mountain makes the page worse
// every minute it is up. True is not the only bar.
//
// band is where the form sits as a fraction of hero height, rx/ry its half-width
// and half-height, speed viewport widths per second, smooth runs 0 for a ragged
// convective edge to 1 for the lens, fibre is how much the body breaks into
// separate strands along its length, weight is how solid the form prints, and
// settles says whether this form is allowed below the skyline.
//
// fibre is what stops a long form being a lozenge. Cirrus is ice crystals
// falling through wind shear, so it arrives as streaks with sky between them,
// never as one smooth continuous band -- which is exactly what a thin ellipse
// stretched across half the frame looks like without it. A lens has none: an
// unbroken outline is the whole reason it reads as a lens.
//
// Only the low two settle, and that is the honest division: cirrus is eight
// kilometres up and can no more lie on a slope than the moon can. The bank sits
// at pass height, which is why it is the one that fills them.
// Sheets are wider than the discrete forms, because that is the difference
// between them: cirrus and stratus are one layer laid over the sky, while a
// cumulus is a single body of air and a lenticular is one wave standing over one
// ridge. Wide, though, not endless. Stretched past the width of the frame a
// sheet stops reading as cloud and starts reading as a rule drawn across the
// picture, which is what nearly a hundred to one gets you. Nothing here spans the
// whole frame.
const FORMS = {
  cirrus:     { band: [0.06, 0.17], rx: [0.20, 0.42], ry: [0.014, 0.028], speed: [0.020, 0.034], smooth: 0.35, fibre: 1,    weight: 0.85, settles: false },
  cumulus:    { band: [0.15, 0.33], rx: [0.09, 0.20], ry: [0.035, 0.070], speed: [0.008, 0.016], smooth: 0,    fibre: 0,    weight: 1,    settles: false },
  lenticular: { band: [0.27, 0.42], rx: [0.07, 0.14], ry: [0.021, 0.035], speed: [0.002, 0.005], smooth: 1,    fibre: 0,    weight: 1,    settles: true },
  bank:       { band: [0.42, 0.62], rx: [0.20, 0.40], ry: [0.018, 0.040], speed: [0.006, 0.013], smooth: 0.18, fibre: 0.45, weight: 0.9,  settles: true }
};

export function createCloudField(random = Math.random) {
  let serial = 0;

  function between(range) {
    return range[0] + random() * (range[1] - range[0]);
  }

  // Convection needs the sun, so the daytime sky is mostly cumulus and the night
  // one mostly high cloud. The lens is uncommon at any hour and does not care.
  function pickForm(daylight) {
    const roll = random();
    if (roll < 0.14) return 'lenticular';
    if (roll < 0.44 + daylight * 0.26) return 'cumulus';
    return random() < 0.55 ? 'cirrus' : 'bank';
  }

  function spawn(x, daylight = 1) {
    const kind = pickForm(daylight);
    const form = FORMS[kind];
    const rx = between(form.rx);
    return { id: serial++, x: x ?? -rx - 0.08, rx, y: between(form.band),
      ry: between(form.ry), speed: between(form.speed),
      seed: random() * 100, kind, smooth: form.smooth, fibre: form.fibre,
      weight: form.weight, settles: form.settles };
  }

  const clouds = Array.from({length:5}, (_, i) => spawn(-0.25 + i * 0.32));
  return {
    clouds,
    advance(seconds, daylight) {
      for (let i = 0; i < clouds.length; i++) {
        const cloud = clouds[i];
        cloud.x += seconds * cloud.speed;
        if (cloud.x - cloud.rx > 1.04) clouds[i] = spawn(undefined, daylight);
      }
    }
  };
}
