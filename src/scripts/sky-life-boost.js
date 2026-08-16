(function () {
  "use strict";

  var themeMedia = matchMedia("(prefers-color-scheme: dark)");
  var motionMedia = matchMedia("(prefers-reduced-motion: reduce)");
  var reduced = motionMedia.matches;
  var shown = !document.hidden;
  var FIXED_TIME = 1733;
  var FRAME = 1000 / 30;
  var SKYLINE_SOURCE = "/assets/annapurna-skyline.json";
  var BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

  var canvas, ctx, state, width, height, dpr;
  var skylineData = null, ridge = null, weather = [];
  var raf = 0, last = 0, tries = 0;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
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
    var q=fbm(x+t*.31,y-t*.19,seed);
    return fbm(x+q*.8+t*.42,y+q*.5-t*.27,seed+177);
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

  function smoothLeftRidge(values) {
    var end=Math.floor(width*.20);
    var radius=Math.max(2,Math.round(2*dpr));
    var copy=new Int32Array(values);
    for(var x=0;x<end;x++){
      var sample=[];
      for(var k=-radius;k<=radius;k++) sample.push(copy[clamp(x+k,0,width-1)]);
      sample.sort(function(a,b){return a-b;});
      values[x]=sample[Math.floor(sample.length/2)];
    }
    var maxStep=Math.max(1,Math.round(1.5*dpr));
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
    smoothLeftRidge(ridge);
  }

  function seedWeather() {
    weather=[];
    if(!state||state.dark) return;
    var range=Math.max(1,state.ridgeLow-state.ridgeTop);
    var portrait=state.cssHeight>state.cssWidth;
    var cx=width*(portrait?.52:.55);
    var cy=lerp(state.ridgeTop,state.ridgeLow,.80);
    var span=width*.94;
    var tall=clamp(range*1.62,100*dpr,300*dpr);
    var step=Math.max(2,Math.round(1.55*dpr));
    var seed=9101;

    for(var y=cy-tall;y<=cy+tall*.50;y+=step){
      for(var x=cx-span*.5;x<=cx+span*.5;x+=step){
        if(x<0||x>=width||y<0||y>=height) continue;
        var u=(x-cx)/(span*.5), v=(y-cy)/tall;
        var shape=Math.exp(-(u*u*1.85+v*v*3.20));
        shape+=.62*Math.exp(-((u+.48)*(u+.48)*3.9+(v+.03)*(v+.03)*4.8));
        shape+=.56*Math.exp(-((u-.40)*(u-.40)*4.2+(v+.08)*(v+.08)*5.1));
        shape+=.28*Math.exp(-((u-.04)*(u-.04)*2.6+(v+.55)*(v+.55)*7.4));
        shape=clamp(shape,0,1);
        if(shape<.04) continue;
        var ix=Math.floor(x/step), iy=Math.floor(y/step);
        if(hash2(ix,iy,seed)>.08+shape*.78) continue;
        weather.push({
          x:x,y:y,shape:shape,
          phase:hash2(ix,iy,seed+13)*Math.PI*2,
          cut:threshold(ix,iy),
          grain:hash2(ix,iy,seed+31)
        });
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
    draw(reduced?FIXED_TIME:performance.now());
    if(raf) cancelAnimationFrame(raf);
    raf=0; last=0;
    if(!reduced&&shown) raf=requestAnimationFrame(tick);
  }

  function drawRidge() {
    if(!ridge) return;
    var ink=themeMedia.matches?"#e4dac8":"#293039";
    var end=Math.floor(width*.19);
    var core=Math.max(4,Math.round(4*dpr));
    var fill=Math.max(core+2,Math.round(15*dpr));
    ctx.fillStyle=ink;
    for(var x=0;x<end;x++){
      var y=ridge[x];
      if(y<=0||y>=height) continue;
      ctx.globalAlpha=.98;
      ctx.fillRect(x,y,1,core);
      for(var d=core;d<fill;d++){
        var fall=1-(d-core)/Math.max(1,fill-core);
        if(hash2(x,d,9921)>fall*.82) continue;
        ctx.globalAlpha=.78*fall;
        ctx.fillRect(x,y+d,1,1);
      }
    }
  }

  function drawWeather(now) {
    if(state.dark||!weather.length) return;
    var t=now*.00078;
    var paper="#eee9df", haze="#5f6872";
    var global=.76+.24*Math.sin(now/2400*Math.PI*2+.7);

    for(var i=0;i<weather.length;i++){
      var dot=weather[i];
      var a=warped(dot.x*.00155+dot.phase*.015,dot.y*.00175,t,9201);
      var b=warped(dot.x*.00220-dot.phase*.009,dot.y*.00120+dot.phase*.006,t*.73,9349);
      var pulse=.5+.5*Math.sin(now/1700*Math.PI*2+dot.phase*.72);
      var pulse2=.5+.5*Math.sin(now/2600*Math.PI*2+dot.phase*1.17);
      var density=dot.shape*(.02+a*.57+b*.43+(pulse-.5)*.60+(pulse2-.5)*.34)*global;
      if(density<dot.cut*.16) continue;

      var rise=(Math.sin(now/3200*Math.PI*2+dot.x*.008+dot.phase*.13)*4 + Math.sin(now/4700*Math.PI*2+dot.x*.003)*3)*dpr;
      var py=Math.round(dot.y-rise);
      if(py<0||py>=height) continue;

      ctx.fillStyle=paper;
      ctx.globalAlpha=clamp(.42+density*.52,0,.92);
      ctx.fillRect(Math.round(dot.x),py,1,1);

      if(dot.grain<.58&&density>.25){
        ctx.fillStyle=haze;
        ctx.globalAlpha=clamp(.045+density*.13,0,.19);
        ctx.fillRect(Math.round(dot.x),py,1,1);
      }
    }
  }

  function draw(now) {
    if(!ctx||!state) return;
    ctx.clearRect(0,0,width,height);
    drawRidge();
    drawWeather(now);
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
    state:function(){return{ready:!!state,weather:weather.length,repair:!!ridge,reduced:reduced};}
  };

  fetch(SKYLINE_SOURCE,{cache:"force-cache"})
    .then(function(r){if(!r.ok)throw new Error("skyline");return r.json();})
    .then(function(data){skylineData=data;build();})
    .catch(function(){build();});
})();
