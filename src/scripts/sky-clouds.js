import { smoothstep, lerp, bayerThreshold, motionMedia, effects } from './sky-shared.js';

// Advect a density field through a fixed print grid. Clouds travel and reform;
// the dither itself never slides like a transparent image across the page.
// One small cached bitmap, refreshed at 8fps by the existing sky scheduler.
let plate, brush, lastFrame = 0, lastBuild = -Infinity, elapsed = 0, signature = '';
const CELL = 3;

export function paintClouds(ctx, state, now, inkRoom) {
  const still = motionMedia.matches || effects.frozen;
  if (lastFrame && !still) elapsed += Math.min(100, now - lastFrame) / 1000;
  lastFrame = now;
  const sun = state.celestial.sun;
  const night = 1 - smoothstep(-12, -3, sun.altitude);
  const low = (1 - smoothstep(8, 32, sun.altitude)) * (1 - night);
  const high = 1 - night - low;
  const morning = sun.azimuth < 180;
  const w = Math.ceil(state.cssWidth / CELL), h = Math.ceil(state.cssHeight * 0.72 / CELL);
  const key = [w,h,Math.round(sun.altitude),morning,document.documentElement.hasAttribute('data-sky-focus')].join(':');
  if (!plate) { plate = document.createElement('canvas'); brush = plate.getContext('2d'); }
  if (key !== signature || (!still && now-lastBuild >= 125)) {
    signature = key; lastBuild = now;
    if (plate.width !== w || plate.height !== h) { plate.width=w; plate.height=h; }
    brush.clearRect(0,0,w,h);
    // High midday puffs, low morning banks, long sunset ribbons, sparse night veils.
    const light = morning ? [244,237,216] : [230,173,144];
    const rgb = [0,1,2].map(i => Math.round([247,244,228][i]*high + light[i]*low + [48,60,72][i]*night));
    brush.fillStyle = `rgb(${rgb.join(',')})`;
    const portrait = state.portrait;
    const baseY = portrait ? 0.48 : lerp(0.19, 0.34, low);
    const banks = [
      {x:0.72, y:baseY, rx:0.25+0.08*low, ry:0.045+0.035*high, speed:1.8, seed:0},
      {x:1.02, y:baseY+0.105, rx:0.29, ry:0.035+0.023*high, speed:2.8, seed:2},
      {x:0.43, y:baseY-0.06, rx:0.18+0.08*low, ry:0.025+0.03*high, speed:1.1, seed:5}
    ];
    for (const bank of banks) {
      // The wrap happens fully offscreen; a returning bank cannot pop into view.
      const centre = ((bank.x + elapsed*bank.speed/state.cssWidth + 0.5) % 2) - 0.5;
      const startX=Math.max(0,Math.floor((centre-bank.rx)*w));
      const endX=Math.min(w,Math.ceil((centre+bank.rx)*w));
      const centreY=bank.y*state.cssHeight/CELL, ry=bank.ry*state.cssHeight/CELL;
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
