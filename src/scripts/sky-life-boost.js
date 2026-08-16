(function () {
  "use strict";

  var themeMedia = matchMedia("(prefers-color-scheme: dark)");
  var motionMedia = matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = motionMedia.matches;
  var visible = !document.hidden;
  var FIXED_TIME = 21437;
  var FRAME = 1000 / 24;
  var BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

  var canvas, ctx, state, width, height, dpr;
  var raf = 0, last = 0, tries = 0;
  var basin = [], veil = [], stars = [];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function hash(n) {
    n = Math.imul(n ^ (n >>> 16), 2246822507);
    n = Math.imul(n ^ (n >>> 13), 3266489909);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function hash2(a, b, seed) {
    return hash(Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed | 0, 2246822519));
  }
  function noise(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }
  function fbm(x, y, seed) {
    var value = 0, amp = .58, freq = 1, norm = 0;
    for (var i = 0; i < 4; i++) {
      value += noise(x * freq, y * freq, seed + i * 97) * amp;
      norm += amp; freq *= 2.03; amp *= .47;
    }
    return value / norm;
  }
  function warped(x, y, time, seed) {
    var inner = fbm(x - time * .18, y + time * .11, seed);
    return fbm(x + inner * .72 + time * .20, y + inner * .47 - time * .14, seed + 181);
  }
  function threshold(x, y) {
    return BAYER[((Math.floor(y) & 3) << 2) + (Math.floor(x) & 3)] / 16;
  }
  function theme() {
    return themeMedia.matches
      ? { dark: true, ink: "#e4dac8", basinAlpha: .17, veilAlpha: .055, starAlpha: .34 }
      : { dark: false, ink: "#293039", basinAlpha: .35, veilAlpha: .21, starAlpha: 0 };
  }
  function listen(media, fn) {
    media.addEventListener ? media.addEventListener("change", fn) : media.addListener(fn);
  }
  function baseState() {
    return window.__portfolioSky && window.__portfolioSky.state ? window.__portfolioSky.state() : null;
  }
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement("canvas");
    canvas.id = "sky-life";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "fixed", inset: "0", zIndex: "0", pointerEvents: "none", display: "block"
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext("2d", { alpha: true });
  }

  function seedLayer(out, cx, cy, span, tall, step, seed, density, kind) {
    out.length = 0;
    for (var y = cy - tall; y <= cy + tall * .46; y += step) {
      for (var x = cx - span * .5; x <= cx + span * .5; x += step) {
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        var u = (x - cx) / (span * .5), v = (y - cy) / tall;
        var shape;
        if (kind === 0) {
          shape = Math.exp(-(u*u*2.15 + v*v*3.8));
          shape += .52 * Math.exp(-((u+.46)*(u+.46)*4.6 + (v+.03)*(v+.03)*5.8));
          shape += .46 * Math.exp(-((u-.40)*(u-.40)*5.0 + (v+.08)*(v+.08)*6.4));
        } else {
          shape = Math.exp(-((u+.48)*(u+.48)*6.8));
          shape += Math.exp(-((u-.40)*(u-.40)*7.3));
          shape += .55 * Math.exp(-(u*u*2.35));
          shape *= Math.exp(-(v*v*3.7));
        }
        shape = clamp(shape, 0, 1);
        if (shape < .055) continue;
        var ix = Math.floor(x / step), iy = Math.floor(y / step);
        if (hash2(ix, iy, seed) > .05 + shape * density) continue;
        out.push({ x:x, y:y, shape:shape, phase:hash2(ix, iy, seed + 9) * 14, cut:threshold(ix, iy) });
      }
    }
  }

  function make() {
    var active = theme();
    var range = Math.max(1, state.ridgeLow - state.ridgeTop);
    var portrait = state.cssHeight > state.cssWidth;
    var cx = width * (portrait ? .52 : .55);
    var cy = lerp(state.ridgeTop, state.ridgeLow, active.dark ? .72 : .80);
    seedLayer(
      basin, cx, cy,
      width * (active.dark ? .58 : .91),
      clamp(range * (active.dark ? .84 : 1.48), 70*dpr, 260*dpr),
      Math.max(2, Math.round((active.dark ? 3.0 : 2.25) * dpr)),
      active.dark ? 7101 : 7201,
      active.dark ? .29 : .61,
      0
    );

    var veilY = lerp(state.ridgeTop, state.ridgeLow, active.dark ? .34 : .39);
    seedLayer(
      veil, width*.5, veilY,
      width * (active.dark ? .82 : .92),
      clamp(range * (active.dark ? .38 : .76), 44*dpr, 185*dpr),
      Math.max(2, Math.round((active.dark ? 3.2 : 2.55) * dpr)),
      active.dark ? 7301 : 7401,
      active.dark ? .10 : .38,
      1
    );

    stars.length = 0;
    if (active.dark) {
      var q = width * 31 + height * 47 + 7501;
      var count = portrait ? 12 : 20;
      for (var i = 0; i < count; i++) {
        stars.push({
          x:(.05+hash(q++)*.90)*width,
          y:(.05+hash(q++)*.65)*Math.max(state.ridgeTop,1),
          x2:(.05+hash(q++)*.90)*width,
          y2:(.05+hash(q++)*.65)*Math.max(state.ridgeTop,1),
          mag:.22+hash(q++)*.42,
          phase:hash(q++)*Math.PI*2,
          period:13000+hash(q++)*32000,
          shimmer:1200+hash(q++)*2600,
          offset:hash(q++)*100000,
          swap:65000+hash(q++)*90000,
          wander:i<5
        });
      }
    }
  }

  function build() {
    var next = baseState();
    if (!next) {
      if (tries++ < 50) setTimeout(build, 120);
      return;
    }
    ensureCanvas();
    state = next; width = state.width; height = state.height; dpr = state.dpr;
    canvas.width = width; canvas.height = height;
    canvas.style.width = state.cssWidth + "px";
    canvas.style.height = state.cssHeight + "px";
    make();
    draw(reduced ? FIXED_TIME : performance.now());
    if (raf) cancelAnimationFrame(raf);
    raf = 0; last = 0;
    if (!reduced && visible) raf = requestAnimationFrame(tick);
  }

  function drawBasin(now) {
    var active = theme();
    if (!basin.length) return;
    var t = now * (active.dark ? .000011 : .000085);
    var breathe = active.dark
      ? .88 + .12 * Math.sin(now / 31000 * Math.PI * 2 + .8)
      : .68 + .32 * Math.sin(now / 22000 * Math.PI * 2 + 1.1);
    ctx.fillStyle = active.ink;
    for (var i = 0; i < basin.length; i++) {
      var dot = basin[i];
      var a = warped(dot.x*.00145 + dot.phase*.012, dot.y*.0017, t*(active.dark?.82:1.18), active.dark?7601:7701);
      var b = warped(dot.x*.00195 - dot.phase*.010, dot.y*.0012 + dot.phase*.006, t*(active.dark?.52:.86), active.dark?7629:7733);
      var localDay = active.dark ? 1 : .78 + .22 * Math.sin(now/28000*Math.PI*2 + dot.x/width*1.8 + dot.phase*.03);
      var density = dot.shape * (.04 + a*.61 + b*.48) * breathe * localDay;
      if (density < dot.cut * (active.dark ? .55 : .36)) continue;
      var alpha = active.basinAlpha * (.15 + density*.85);
      if (alpha < .005) continue;
      ctx.globalAlpha = clamp(alpha, 0, active.dark ? .21 : .47);
      ctx.fillRect(Math.round(dot.x), Math.round(dot.y), 1, 1);
    }
  }

  function drawVeil(now) {
    var active = theme();
    if (!veil.length) return;
    var t = now * (active.dark ? .000009 : .000070);
    var breathe = active.dark
      ? .93 + .07*Math.sin(now/41000*Math.PI*2 + .4)
      : .65 + .35*Math.sin(now/27000*Math.PI*2 + 1.8);
    ctx.fillStyle = active.ink;
    for (var i = 0; i < veil.length; i++) {
      var dot = veil[i];
      var a = warped(dot.x*.0013 + dot.phase*.018, dot.y*.00155, t*(active.dark?.55:1.02), active.dark?7801:7901);
      var b = warped(dot.x*.0021 - dot.phase*.01, dot.y*.0011 + dot.phase*.008, t*(active.dark?.35:.82), active.dark?7827:7929);
      var density = dot.shape * (.03 + a*.62 + b*.52) * breathe;
      if (density < dot.cut * (active.dark ? .70 : .36)) continue;
      var alpha = active.veilAlpha * (.14 + density*.86);
      if (alpha < .004) continue;
      ctx.globalAlpha = clamp(alpha, 0, active.dark ? .065 : .26);
      ctx.fillRect(Math.round(dot.x), Math.round(dot.y), 1, 1);
    }
  }

  function drawStars(now) {
    var active = theme();
    if (!active.dark) return;
    ctx.fillStyle = active.ink;
    for (var i = 0; i < stars.length; i++) {
      var star = stars[i];
      var twinkle = .74 + Math.sin(now/star.period*Math.PI*2+star.phase)*.18 + Math.sin(now/star.shimmer*Math.PI*2+star.phase*1.7)*.07;
      var sx=star.x, sy=star.y, fade=1;
      if (star.wander) {
        var cycle=((now+star.offset)%star.swap)/star.swap;
        if(cycle<.34) fade=smooth(.02,.08,cycle)*(1-smooth(.28,.34,cycle));
        else if(cycle<.54) fade=0;
        else if(cycle<.88){sx=star.x2;sy=star.y2;fade=smooth(.54,.62,cycle)*(1-smooth(.82,.88,cycle));}
        else fade=0;
      }
      var alpha=active.starAlpha*star.mag*twinkle*fade;
      if(alpha<.01) continue;
      ctx.globalAlpha=clamp(alpha,0,.55);
      ctx.fillRect(Math.round(sx),Math.round(sy),1,1);
    }
  }

  function draw(now) {
    if (!ctx || !state) return;
    ctx.clearRect(0,0,width,height);
    drawStars(now);
    drawBasin(now);
    drawVeil(now);
    ctx.globalAlpha=1;
  }
  function tick(now) {
    if(!visible||reduced){raf=0;return;}
    if(!last||now-last>=FRAME){last=now;draw(now);}
    raf=requestAnimationFrame(tick);
  }

  listen(themeMedia, build);
  listen(motionMedia, function(e){reduced=e.matches;build();});
  addEventListener("resize", function(){clearTimeout(build._timer);build._timer=setTimeout(build,100);},{passive:true});
  document.addEventListener("visibilitychange",function(){visible=!document.hidden;if(visible&&!reduced&&!raf)raf=requestAnimationFrame(tick);});

  window.__portfolioLife={
    build:build,
    step:function(now){draw(now==null?(reduced?FIXED_TIME:performance.now()):now);},
    state:function(){return{ready:!!state,basin:basin.length,veil:veil.length,stars:stars.length,reduced:reduced};}
  };
  build();
})();
