(function () {
  "use strict";

  var themeMedia = matchMedia("(prefers-color-scheme: dark)");
  var motionMedia = matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = motionMedia.matches;
  var shown = !document.hidden;
  var FIXED_TIME = 1337;
  var FRAME = 1000 / 30;
  var SKYLINE_SOURCE = "/assets/annapurna-skyline.json";
  var BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

  var canvas, ctx, state, width, height, dpr;
  var skylineData = null, ridge = null, weather = [], wisps = [];
  var raf = 0, last = 0, tries = 0;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a,b,v){ var t=clamp((v-a)/(b-a),0,1); return t*t*(3-2*t); }
  function hash(n) {
    n = Math.imul(n ^ (n >>> 16), 2246822507);
    n = Math.imul(n ^ (n >>> 13), 3266489909);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function hash2(a, b, seed) {
    return hash(Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed | 0, 2246822519));
  }
  function threshold(x, y) {
    return BAYER[((Math.floor(y) & 3) << 2) + (Math.floor(x) & 3)] / 16;
  }
  function noise(x, y, seed) {
    var ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
    var ux=fx*fx*(3-2*fx), uy=fy*fy*(3-2*fy);
    var a=hash2(ix,iy,seed), b=hash2(ix+1,iy,seed), c=hash2(ix,iy+1,seed), d=hash2(ix+1,iy+1,seed);
    return lerp(lerp(a,b,ux),lerp(c,d,ux),uy);
  }
  function fbm(x,y,seed) {
    var value=0, amp=.58, freq=1, norm=0;
    for(var i=0;i<4;i++){ value+=noise(x*freq,y*freq,seed+i*83)*amp; norm+=amp; amp*=.48; freq*=2.03; }
    return value/norm;
  }
  function warped(x,y,t,seed) {
    var q=fbm(x+t*.24,y-t*.16,seed);
    return fbm(x+q*.78+t*.34,y+q*.46-t*.23,seed+177);
  }
  function baseState() {
    return window.__portfolioSky && window.__portfolioSky.state ? window.__portfolioSky.state() : null;
  }
  function ensureCanvas() {
    if(canvas) return;
    canvas=document.createElement("canvas");
    canvas.id="sky-life";
    canvas.setAttribute("aria-hidden","true");
    Object.assign(canvas.style,{position:"fixed",inset:"0",zIndex:"0",pointerEvents:"none",display:"block"});
    document.body.appendChild(canvas);
    ctx=canvas.getContext("2d",{alpha:true});
  }
  function listen(media,fn){ media.addEventListener?media.addEventListener("change",fn):media.addListener(fn); }

  function sampleSourceSkyline(sourceX) {
    var p=clamp(sourceX/skylineData.step,0,skylineData.y.length-1);
    var a=Math.floor(p), b=Math.min(skylineData.y.length-1,a+1);
    return lerp(skylineData.y[a],skylineData.y[b],p-a);
  }

  function cleanLeftRidge(values) {
    var end=Math.floor(width*.185);
    var copy=new Int32Array(values);
    var radius=Math.max(1,Math.round(1.2*dpr));
    for(var x=0;x<end;x++){
      var lo=clamp(x-radius,0,width-1), hi=clamp(x+radius,0,width-1);
      var a=copy[lo], b=copy[x], c=copy[hi];
      var median=a+b+c-Math.min(a,b,c)-Math.max(a,b,c);
      if(Math.abs(b-median)>Math.max(2,Math.round(1.5*dpr))) values[x]=median;
    }
    var maxStep=Math.max(2,Math.round(2.4*dpr));
    for(x=1;x<end;x++) values[x]=clamp(values[x],values[x-1]-maxStep,values[x-1]+maxStep);
    for(x=end-2;x>=0;x--) values[x]=clamp(values[x],values[x+1]-maxStep,values[x+1]+maxStep);
  }

  function buildRidge() {
    ridge=null;
    if(!skylineData||!state) return;
    var plateW=skylineData.width||3000, plateH=skylineData.height||2000;
    var portrait=state.cssWidth<state.cssHeight;
    var visibleBandH=Math.round(height*(portrait?.56:.52));
    var overscan=Math.round(height*(portrait?.18:.16));
    var drawH=visibleBandH+overscan, bandTop=height-visibleBandH;
    var targetAspect=width/drawH, sourceAspect=plateW/plateH;
    var sx=0, sy=0, sw=plateW, sh=plateH, focus=portrait?.55:.52;
    if(targetAspect>sourceAspect){ sh=sw/targetAspect; sy=clamp(plateH*.10,0,Math.max(0,plateH-sh)); }
    else { sw=sh*targetAspect; sx=clamp(plateW*focus-sw/2,0,Math.max(0,plateW-sw)); }
    ridge=new Int32Array(width);
    for(var x=0;x<width;x++){
      var sourceX=sx+((x+.5)/width)*sw-.5;
      var sourceY=sampleSourceSkyline(sourceX);
      ridge[x]=clamp(Math.round(bandTop+((sourceY-sy)/sh)*drawH),0,height);
    }
    cleanLeftRidge(ridge);
  }

  function seedWeather() {
    weather=[];
    if(!state||state.dark) return;
    var range=Math.max(1,state.ridgeLow-state.ridgeTop);
    var portrait=state.cssHeight>state.cssWidth;
    var cx=width*(portrait?.51:.55);
    var cy=lerp(state.ridgeTop,state.ridgeLow,.78);
    var span=width*(portrait?.92:.96);
    var tall=clamp(range*1.55,105*dpr,285*dpr);
    var step=Math.max(2,Math.round(1.65*dpr));
    var seed=9101;
    for(var y=cy-tall;y<=cy+tall*.54;y+=step){
      for(var x=cx-span*.5;x<=cx+span*.5;x+=step){
        if(x<0||x>=width||y<0||y>=height) continue;
        var u=(x-cx)/(span*.5), v=(y-cy)/tall;
        var shape=.92*Math.exp(-(u*u*1.72+v*v*3.0));
        shape+=.70*Math.exp(-((u+.48)*(u+.48)*3.55+(v+.02)*(v+.02)*4.25));
        shape+=.64*Math.exp(-((u-.41)*(u-.41)*3.80+(v+.08)*(v+.08)*4.65));
        shape+=.35*Math.exp(-((u-.04)*(u-.04)*2.45+(v+.53)*(v+.53)*6.30));
        shape=clamp(shape,0,1);
        if(shape<.035) continue;
        var ix=Math.floor(x/step), iy=Math.floor(y/step);
        if(hash2(ix,iy,seed)>.10+shape*.76) continue;
        weather.push({x:x,y:y,shape:shape,phase:hash2(ix,iy,seed+13)*Math.PI*2,cut:threshold(ix,iy),grain:hash2(ix,iy,seed+31),lobe:hash2(Math.floor(x/(120*dpr)),Math.floor(y/(90*dpr)),seed+47)*Math.PI*2});
      }
    }
  }

  function seedWisps() {
    wisps=[];
    if(!state||state.dark) return;
    var range=Math.max(1,state.ridgeLow-state.ridgeTop);
    var banks=[
      {cx:.43,cy:.63,span:.30,tall:.28,phase:.4,seed:10101},
      {cx:.59,cy:.72,span:.37,tall:.31,phase:2.0,seed:10201},
      {cx:.53,cy:.51,span:.25,tall:.21,phase:4.1,seed:10301}
    ];
    var step=Math.max(2,Math.round(1.45*dpr));
    for(var bi=0;bi<banks.length;bi++){
      var bank=banks[bi];
      var cx=width*bank.cx;
      var cy=lerp(state.ridgeTop,state.ridgeLow,bank.cy);
      var span=width*bank.span;
      var tall=clamp(range*bank.tall,38*dpr,105*dpr);
      for(var y=cy-tall;y<=cy+tall;y+=step){
        for(var x=cx-span*.5;x<=cx+span*.5;x+=step){
          if(x<0||x>=width||y<0||y>=height) continue;
          var u=(x-cx)/(span*.5),v=(y-cy)/tall;
          var shape=Math.exp(-(u*u*2.4+v*v*3.5));
          shape+=.44*Math.exp(-((u+.45)*(u+.45)*6.4+(v+.02)*(v+.02)*5.4));
          shape+=.39*Math.exp(-((u-.38)*(u-.38)*7.0+(v-.05)*(v-.05)*5.9));
          shape=clamp(shape,0,1);
          if(shape<.075) continue;
          var ix=Math.floor(x/step),iy=Math.floor(y/step);
          if(hash2(ix,iy,bank.seed)>.12+shape*.82) continue;
          wisps.push({bank:bi,x:x,y:y,shape:shape,cut:threshold(ix,iy),grain:hash2(ix,iy,bank.seed+17)});
        }
      }
    }
  }

  function build() {
    var next=baseState();
    if(!next||!skylineData){ if(tries++<80)setTimeout(build,80); return; }
    ensureCanvas();
    state=next; width=state.width; height=state.height; dpr=state.dpr;
    canvas.width=width; canvas.height=height;
    canvas.style.width=state.cssWidth+"px";
    canvas.style.height=state.cssHeight+"px";
    buildRidge();
    seedWeather();
    seedWisps();
    draw(reduced?FIXED_TIME:performance.now());
    if(raf) cancelAnimationFrame(raf);
    raf=0; last=0;
    if(!reduced&&shown) raf=requestAnimationFrame(tick);
  }

  function drawRidge() {
    if(!ridge) return;
    var dark=themeMedia.matches;
    var ink=dark?"#e4dac8":"#293039";
    var paper=dark?"#0b0e13":"#eee9df";
    var end=Math.floor(width*.185);
    var fadeStart=Math.floor(width*.145);
    var eraseUp=Math.max(2,Math.round(2*dpr));
    var eraseDown=Math.max(6,Math.round(7*dpr));
    var transition=Math.max(7,Math.round(9*dpr));
    for(var x=0;x<end;x++){
      var y=ridge[x];
      if(y<=0||y>=height) continue;
      var xf=x<=fadeStart?1:1-smooth(fadeStart,end,x);
      ctx.fillStyle=paper;
      ctx.globalAlpha=.99*xf;
      ctx.fillRect(x,Math.max(0,y-eraseUp),1,eraseUp+eraseDown);
      ctx.fillStyle=ink;
      ctx.globalAlpha=.94*xf;
      ctx.fillRect(x,y,1,1);
      for(var d=1;d<transition;d++){
        var density=clamp(.14+d/transition*.80,0,1);
        if(hash2(x,d,9921)>density) continue;
        ctx.globalAlpha=(.18+d/transition*.62)*xf;
        ctx.fillRect(x,y+d,1,1);
      }
    }
  }

  function drawWeather(now) {
    if(state.dark||!weather.length) return;
    var paper="#eee9df", haze="#69737b";
    var t=now*.00082;
    var breath=.82+.18*Math.sin(now/3600*Math.PI*2+.55);
    for(var i=0;i<weather.length;i++){
      var dot=weather[i];
      var a=warped(dot.x*.00142+dot.phase*.010,dot.y*.00162,t,9201);
      var b=warped(dot.x*.00210-dot.phase*.007,dot.y*.00118+dot.phase*.004,t*.69,9349);
      var regional=.5+.5*Math.sin(now/3800*Math.PI*2+dot.x/(145*dpr)+dot.lobe);
      var density=dot.shape*(.10+a*.46+b*.30+regional*.28)*breath;
      if(density<dot.cut*.52+.065) continue;
      ctx.fillStyle=paper;
      ctx.globalAlpha=clamp(.40+density*.36,0,.78);
      ctx.fillRect(Math.round(dot.x),Math.round(dot.y),Math.max(1,Math.round(1.2*dpr)),1);
      if(dot.grain<.58&&density>.30){
        ctx.fillStyle=haze;
        ctx.globalAlpha=clamp(.05+(density-.30)*.16,0,.17);
        ctx.fillRect(Math.round(dot.x),Math.round(dot.y),1,1);
      }
    }
  }

  function drawWisps(now) {
    if(state.dark||!wisps.length) return;
    var paper="#eee9df", haze="#4f5964";
    var phases=[.4,2.0,4.1];
    for(var i=0;i<wisps.length;i++){
      var dot=wisps[i], phase=phases[dot.bank];
      var ox=(Math.sin(now/3300*Math.PI*2+phase)*7 + Math.sin(now/5100*Math.PI*2+phase*.7)*3)*dpr;
      var oy=(Math.sin(now/2300*Math.PI*2+phase*1.2)*7 + Math.sin(now/3900*Math.PI*2+phase)*3)*dpr;
      var swell=.76+.24*Math.sin(now/2100*Math.PI*2+phase);
      var field=fbm(dot.x*.0022+now*.00023,dot.y*.0020-now*.00015,11001+dot.bank*101);
      var density=dot.shape*(.24+field*.76)*swell;
      if(density<dot.cut*.26+.04) continue;
      var px=Math.round(dot.x+ox),py=Math.round(dot.y+oy);
      if(px<0||px>=width||py<0||py>=height) continue;
      ctx.fillStyle=paper;
      ctx.globalAlpha=clamp(.60+density*.34,0,.94);
      ctx.fillRect(px,py,Math.max(1,Math.round(1.5*dpr)),1);
      if(dot.grain<.78){
        ctx.fillStyle=haze;
        ctx.globalAlpha=clamp(.11+density*.24,0,.34);
        ctx.fillRect(px,py,1,1);
      }
    }
  }

  function draw(now) {
    if(!ctx||!state) return;
    ctx.clearRect(0,0,width,height);
    drawRidge();
    drawWeather(now);
    drawWisps(now);
    ctx.globalAlpha=1;
  }
  function tick(now){
    if(!shown||reduced){raf=0;return;}
    if(!last||now-last>=FRAME){last=now;draw(now);}
    raf=requestAnimationFrame(tick);
  }

  listen(themeMedia,build);
  listen(motionMedia,function(e){reduced=e.matches;build();});
  addEventListener("resize",function(){clearTimeout(build._timer);build._timer=setTimeout(build,90);},{passive:true});
  document.addEventListener("visibilitychange",function(){shown=!document.hidden;if(shown&&!reduced&&!raf)raf=requestAnimationFrame(tick);});

  window.__portfolioLife={
    build:build,
    step:function(now){draw(now==null?(reduced?FIXED_TIME:performance.now()):now);},
    state:function(){return{ready:!!state,weather:weather.length,wisps:wisps.length,repair:!!ridge,reduced:reduced};}
  };

  fetch(SKYLINE_SOURCE,{cache:"force-cache"})
    .then(function(r){if(!r.ok)throw new Error("skyline");return r.json();})
    .then(function(data){skylineData=data;build();})
    .catch(function(){build();});
})();
