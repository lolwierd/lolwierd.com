import { createCloudField } from './sky-cloud-field.js';
import { smoothstep, lerp, bayerThreshold, hash2, motionMedia, effects, terrainExposure } from './sky-shared.js';

// Advect a density field through a fixed print grid. Clouds travel and reform;
// the dither itself never slides like a transparent image across the page.
// Cached bitmaps, refreshed at 12fps by the existing sky scheduler.
//
// Two bitmaps, because cloud does not stop at the skyline. Over this range the
// ordinary sight is a deck lying in the passes with the summits standing clear
// of it, and a sky that ends in a clean line along the ridge is the one thing
// that reads as a sticker. So the low forms are allowed across -- and anything
// in front of the mountain has to print bright, because ink on shadowed rock is
// not merely invisible, it is backwards. Cells are sorted into a sky plate and a
// land plate as they are laid down, which is also what replaced the clip path
// this used to build a thousand line segments for on every frame.
let skyPlate, skyBrush, landPlate, landBrush;
let lastFrame = 0, lastBuild = -Infinity, elapsed = 0, signature = '';
// Two CSS pixels, not three. The terrain dithers at one, and a cloud lying on
// the ridge is read directly against that grain: at three the cloud was visibly
// built of bigger bricks than the mountain it was sitting on.
const CELL = 2;

// An ordered dither is a lattice, and a lattice at roughly half density is a
// checkerboard. Daylight hides it -- pale cloud on a pale sky has nowhere near
// the contrast to show the grid -- but at night every lit cell is a bright cell
// on near-black and the pattern is the first thing you see.
//
// The fix is a nudge, not a replacement. Ordered dithering is what makes a
// smooth density field read as one body rather than as grain; swapping in a
// per-cell hash outright scatters the cells at random and the cloud comes out
// as static. So the hash gets a small share of the threshold -- enough to bend
// the straight rows out of true, not enough to stop the ordering doing its job.
// It is keyed to the plate, not to the cloud, so the texture still stays put
// while the weather moves over it.
const LATTICE = 0.88;
function threshold(x, y) {
  return bayerThreshold(x, y) * LATTICE + hash2(x, y, 9173) * (1 - LATTICE);
}
// How much cloud survives directly over a line of type. Low enough that the
// stipple behind small text stays quiet, high enough that the silhouette holds.
const INK_FLOOR = 0.32;
// The mountain is the photograph and the photograph is the point. Cloud lying
// against it is thinned so the ridge still reads through the deck.
const LAND_DENSITY = 0.58;
const field = createCloudField();

export function paintClouds(ctx, state, now, inkRoom) {
  const still = motionMedia.matches || effects.frozen;
  const dt = lastFrame && !still ? Math.min(250, now - lastFrame) / 1000 : 0;
  elapsed += dt;
  lastFrame = now;
  const sun = state.celestial.sun;
  const night = 1 - smoothstep(-12, -3, sun.altitude);
  const low = (1 - smoothstep(8, 32, sun.altitude)) * (1 - night);
  const high = 1 - night - low;
  const morning = sun.azimuth < 180;
  field.advance(dt, high);
  const w = Math.ceil(state.cssWidth / CELL), h = Math.ceil(state.cssHeight / CELL);
  const scale = CELL * state.dpr;
  const key = [w,h,Math.round(sun.altitude),morning,document.documentElement.hasAttribute('data-sky-focus')].join(':');
  if (!skyPlate) {
    skyPlate = document.createElement('canvas'); skyBrush = skyPlate.getContext('2d');
    landPlate = document.createElement('canvas'); landBrush = landPlate.getContext('2d');
  }
  if (key !== signature || (!still && now-lastBuild >= 83)) {
    signature = key; lastBuild = now;
    if (skyPlate.width !== w || skyPlate.height !== h) {
      skyPlate.width = landPlate.width = w;
      skyPlate.height = landPlate.height = h;
    }
    skyBrush.clearRect(0,0,w,h);
    landBrush.clearRect(0,0,w,h);
    // High midday puffs, low morning banks, long sunset ribbons, sparse night veils.
    const light = morning ? [244,237,216] : [230,173,144];
    const rgb = [0,1,2].map(i => Math.round([247,244,228][i]*high + light[i]*low + [48,60,72][i]*night));
    skyBrush.fillStyle = `rgb(${rgb.join(',')})`;
    // Paper by day, moonlit snow after dark -- the tone the terrain ramp already
    // prints its lit tier in, so a deck lying on the range belongs to the same
    // plate as the snow it is lying on.
    const landInk = [0,1,2].map(i => Math.round(lerp([238,233,223][i], [198,210,219][i], night)));
    landBrush.fillStyle = `rgb(${landInk.join(',')})`;
    const portrait = state.portrait;
    for (const bank of field.clouds) {
      const centre = bank.x;
      const startX=Math.max(0,Math.floor((centre-bank.rx)*w));
      const endX=Math.min(w,Math.ceil((centre+bank.rx)*w));
      const centreY=(portrait ? 0.35 + bank.y * 0.5 : bank.y + low * 0.10)*state.cssHeight/CELL;
      const ry=bank.ry*(bank.kind === "cumulus" ? 0.65 + high * 0.65 : 1)*state.cssHeight/CELL;
      // A lens is smooth or it is not a lens: the wave that holds it up also
      // planes its edges flat, so the convective wobble is damped out of it and
      // its interior fills to a plateau instead of turning over in folds.
      const smooth = bank.smooth || 0;
      const fibre = bank.fibre || 0;
      // How solid this form prints. An overcast layer covers the frame, so it
      // has to be a veil the scene shows through rather than a wall painted
      // over it; cirrus is thin because cirrus is ice.
      const weight = bank.weight == null ? 1 : bank.weight;
      const wobble = 1 - smooth * 0.88;
      const base = 1 - smooth * 0.38;
      for (let x=startX;x<endX;x++) {
        const nx=(x/w-centre)/bank.rx;
        // The wobble is written in cloud-relative units, so a sheet three times
        // the width of a puff gets the same few undulations stretched across the
        // whole frame and comes out glassy. Scaling the frequency by width keeps
        // the texture put in screen space, but only up to a point: past about
        // twice, a frame-wide sheet is carrying so many folds that the density
        // swing between them starts reading as vertical banding rather than as
        // cloud. Take the benefit and stop.
        const grain = Math.min(2.2, bank.rx / 0.18);
        // Two slow waves beaten against each other and clipped at zero, so the
        // body thins and parts along its length instead of running as one
        // unbroken band. Computed per column: it is a property of where you are
        // across the cloud, not of the cell.
        const strands = fibre
          ? 1 - fibre + fibre * Math.max(0, 0.34 + 1.15
              * Math.sin(nx * 6.1 + bank.seed)
              * Math.cos(nx * 2.7 + bank.seed * 0.6))
          : 1;
        const ruffle = (Math.sin(nx*8*grain+elapsed*0.09+bank.seed)*0.19 + Math.sin(nx*19*grain-elapsed*0.055)*0.10) * wobble;
        const startY=Math.max(0,Math.floor(centreY-ry*(1.3+ruffle)));
        const endY=Math.min(h,Math.ceil(centreY+ry*(1.3-ruffle)));
        // The ridge height under this column decides which plate its cells go
        // to, so the boundary follows the silhouette instead of a clip path.
        // A column with no terrain in it reads 0, which would put the whole sky
        // on the land plate; there is nothing to lie on there, so it is all sky.
        const ridge = state.skyline[Math.min(state.width-1, Math.max(0, Math.round(x*scale)))] || Infinity;
        for (let y=startY;y<endY;y++) {
          const onLand = y*scale >= ridge;
          if (onLand && !bank.settles) continue;
          // A lens has a domed top and a flat base -- the wave crest shapes the
          // upper surface and the condensation level cuts the lower one off
          // straight. Compressing the half below centre is the whole read.
          const drop=(y-centreY)/ry+ruffle;
          const ny=drop > 0 ? drop / base : drop;
          const fill=Math.max(0,1-nx*nx-ny*ny);
          if (!fill) continue;
          // Enough of a plateau to look solid rather than dithered away, not so
          // much that the taper to the tips disappears and it reads as a slab.
          const edge=smooth ? Math.min(1, fill*(1+smooth*0.45)) : fill;
          const folds = lerp(0.65 + 0.2*Math.sin(nx*13+ny*4+elapsed*0.07+bank.seed), 0.8, smooth);
          // Thin over the writing, never erase. Zeroing the density cut a hole
          // the exact shape of the clearance, so a cloud crossing the hero came
          // out amputated; holding a floor under it means the same cloud simply
          // goes thin as it passes and thickens again on the far side.
          const room = INK_FLOOR + (1-INK_FLOOR)*inkRoom(x*scale,y*scale,state);
          const density=edge*folds*strands*(0.86-0.34*night)*room*weight*(onLand ? LAND_DENSITY : 1);
          if (density > threshold(x,y)) (onLand ? landBrush : skyBrush).fillRect(x,y,1,1);
        }
      }
    }
  }
  ctx.save();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(skyPlate,0,0,w*scale,h*scale);
  // The deck is lit by whatever is lighting the range: full sun by day, and
  // after dark the same moonlight curve the terrain and the valley fog use, so
  // the three of them agree about how bright the night is.
  ctx.globalAlpha = lerp(1, terrainExposure(state.celestial), night);
  ctx.drawImage(landPlate,0,0,w*scale,h*scale);
  ctx.restore();
}

export function invalidateClouds() { signature=''; }
