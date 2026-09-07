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
// Not modelled: the summit banner, which streams off one particular peak and
// stays pinned to it. Nothing in a field of drifting viewport fractions can be
// honest about a cloud that belongs to a mountain rather than to the sky.
//
// band is where the form sits as a fraction of hero height, rx/ry its half-width
// and half-height, speed viewport widths per second, smooth runs 0 for a ragged
// convective edge to 1 for the lens, and settles says whether this form is
// allowed below the skyline.
//
// Only the low two settle, and that is the honest division: cirrus is eight
// kilometres up and can no more lie on a slope than the moon can. The bank sits
// at pass height, which is why it is the one that fills them.
// The sheets run off both edges of the frame and the discrete forms do not,
// which is the difference between them: cirrus and stratus are one layer laid
// over the whole sky, while a cumulus is a single body of air and a lenticular
// is one wave standing over one ridge. Half-width sheets read as islands and
// left the sky looking sparse.
const FORMS = {
  cirrus:     { band: [0.06, 0.17], rx: [0.34, 0.72], ry: [0.008, 0.018], speed: [0.020, 0.034], smooth: 0.35, settles: false },
  cumulus:    { band: [0.15, 0.33], rx: [0.09, 0.20], ry: [0.035, 0.070], speed: [0.008, 0.016], smooth: 0,    settles: false },
  lenticular: { band: [0.27, 0.42], rx: [0.07, 0.14], ry: [0.021, 0.035], speed: [0.002, 0.005], smooth: 1,    settles: true },
  bank:       { band: [0.42, 0.62], rx: [0.30, 0.62], ry: [0.016, 0.036], speed: [0.006, 0.013], smooth: 0.18, settles: true }
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
      seed: random() * 100, kind, smooth: form.smooth, settles: form.settles };
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
