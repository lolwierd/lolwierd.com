import { createCloudField } from './sky-cloud-field.js';
import { smoothstep, lerp, bayerThreshold, motionMedia, effects } from './sky-shared.js';

// Advect a density field through a fixed print grid. Clouds travel and reform;
// the dither itself never slides like a transparent image across the page.
// One small cached bitmap, refreshed at 12fps by the existing sky scheduler.
let plate, brush, lastFrame = 0, lastBuild = -Infinity, elapsed = 0, signature = '';
const CELL = 3;
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
  const w = Math.ceil(state.cssWidth / CELL), h = Math.ceil(state.cssHeight * 0.72 / CELL);
  const key = [w,h,Math.round(sun.altitude),morning,document.documentElement.hasAttribute('data-sky-focus')].join(':');
  if (!plate) { plate = document.createElement('canvas'); brush = plate.getContext('2d'); }
  if (key !== signature || (!still && now-lastBuild >= 83)) {
    signature = key; lastBuild = now;
    if (plate.width !== w || plate.height !== h) { plate.width=w; plate.height=h; }
    brush.clearRect(0,0,w,h);
    // High midday puffs, low morning banks, long sunset ribbons, sparse night veils.
    const light = morning ? [244,237,216] : [230,173,144];
    const rgb = [0,1,2].map(i => Math.round([247,244,228][i]*high + light[i]*low + [48,60,72][i]*night));
    brush.fillStyle = `rgb(${rgb.join(',')})`;
    const portrait = state.portrait;
    for (const bank of field.clouds) {
      const centre = bank.x;
      const startX=Math.max(0,Math.floor((centre-bank.rx)*w));
      const endX=Math.min(w,Math.ceil((centre+bank.rx)*w));
      const centreY=(portrait ? 0.35 + bank.y * 0.5 : bank.y + low * 0.10)*state.cssHeight/CELL;
      const ry=bank.ry*(bank.kind === "cumulus" ? 0.65 + high * 0.65 : 1)*state.cssHeight/CELL;
      for (let x=startX;x<endX;x++) {
        const nx=(x/w-centre)/bank.rx;
        const ruffle = Math.sin(nx*8+elapsed*0.09+bank.seed)*0.19 + Math.sin(nx*19-elapsed*0.055)*0.10;
        const startY=Math.max(0,Math.floor(centreY-ry*(1.3+ruffle)));
        const endY=Math.min(h,Math.ceil(centreY+ry*(1.3-ruffle)));
        for (let y=startY;y<endY;y++) {
          const ny=(y-centreY)/ry+ruffle;
          const edge=Math.max(0,1-nx*nx-ny*ny);
          if (!edge) continue;
          const folds = 0.65 + 0.2*Math.sin(nx*13+ny*4+elapsed*0.07+bank.seed);
          const density=edge*folds*(0.86-0.34*night)*inkRoom(x*CELL*state.dpr,y*CELL*state.dpr,state);
          if (density > bayerThreshold(x,y)) brush.fillRect(x,y,1,1);
        }
      }
    }
  }
  ctx.save();
  ctx.beginPath(); ctx.moveTo(0,0);ctx.lineTo(state.width,0);
  for(let x=state.width-1;x>=0;x-=Math.max(1,Math.round(state.dpr*3))) ctx.lineTo(x,state.skyline[x]);
  ctx.lineTo(0,state.skyline[0]);ctx.closePath();ctx.clip();
  ctx.imageSmoothingEnabled=false;
  ctx.drawImage(plate,0,0,plate.width*CELL*state.dpr,plate.height*CELL*state.dpr);
  ctx.restore();
}

export function invalidateClouds() { signature=''; }
