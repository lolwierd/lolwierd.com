// Cloud identity survives every frame. Only an offscreen cloud is replaced.
// Positions are viewport fractions, so resizing doesn't restart the weather.
export function createCloudField(random = Math.random) {
  let serial = 0;
  function spawn(x, daylight = 1) {
    const kind = random() < 0.25 + daylight * 0.40 ? 'cumulus' : random() < 0.55 ? 'cirrus' : 'bank';
    const rx = 0.10 + random() * (kind === 'cirrus' ? 0.19 : 0.13);
    return { id: serial++, x: x ?? -rx - 0.08, rx, y: 0.12 + random() * 0.30,
      ry: kind === 'cumulus' ? 0.035 + random() * 0.035 : 0.012 + random() * 0.022,
      speed: 0.012 + random() * 0.012, seed: random() * 100, kind };
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
