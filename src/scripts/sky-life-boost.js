(function(){
  "use strict";
  var tm=matchMedia("(prefers-color-scheme: dark)"), mm=matchMedia("(prefers-reduced-motion: reduce)");
  var reduced=mm.matches, shown=!document.hidden, FIX=21437, FRAME=1000/24;
  var canvas,ctx,state,W,H,D,raf=0,last=0,tries=0;
  var skylineData=null,screenSkyline=null;
  var basin=[],veil=[],stars=[],repair=[];
  var B=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];

  function C(v,a,b){return v<a?a:v>b?b:v}
  function L(a,b,t){return a+(b-a)*t}
  function S(a,b,v){var t=C((v-a)/(b-a),0,1);return t*t*(3-2*t)}
  function h(n){n=Math.imul(n^(n>>>16),2246822507);n=Math.imul(n^(n>>>13),3266489909);return((n^(n>>>16))>>>0)/4294967296}
  function h2(a,b,q){return h(Math.imul(a|0,374761393)^Math.imul(b|0,668265263)^Math.imul(q|0,2246822519))}
  function n2(a,b,q){var X=Math.floor(a),Y=Math.floor(b),u=a-X,v=b-Y;u=u*u*(3-2*u);v=v*v*(3-2*v);var A=h2(X,Y,q),Bb=h2(X+1,Y,q),Cc=h2(X,Y+1,q),Dd=h2(X+1,Y+1,q);return L(L(A,Bb,u),L(Cc,Dd,u),v)}
  function fbm(a,b,q){var z=0,A=.58,F=1,N=0;for(var i=0;i<4;i++){z+=n2(a*F,b*F,q+i*97)*A;N+=A;F*=2.03;A*=.47}return z/N}
  function warped(a,b,t,q){var i=fbm(a-t*.18,b+t*.11,q);return fbm(a+i*.72+t*.20,b+i*.47-t*.14,q+181)}
  function bt(a,b){return B[((Math.floor(b)&3)<<2)+(Math.floor(a)&3)]/16}
  function theme(){return tm.matches?
    {dark:1,ink:"#e4dac8",paper:"#0b0e13",haze:"#151922",body:.24,rim:.13,veil:.07,star:.38}:
    {dark:0,ink:"#293039",paper:"#eee9df",haze:"#d8d0c3",body:.82,rim:.17,veil:.28,star:0}}
  function listen(m,fn){m.addEventListener?m.addEventListener("change",fn):m.addListener(fn)}
  function base(){return window.__portfolioSky&&window.__portfolioSky.state?window.__portfolioSky.state():null}
  function sampleSkyline(sourceX){
    if(!skylineData||!skylineData.y||!skylineData.y.length)return 0;
    var pos=C(sourceX/skylineData.step,0,skylineData.y.length-1),left=Math.floor(pos),right=Math.min(skylineData.y.length-1,left+1);
    return L(skylineData.y[left],skylineData.y[right],pos-left);
  }
  function sourceCrop(targetW,targetH,portrait){
    var plateW=skylineData.width,plateH=skylineData.height,sourceAspect=plateW/plateH,targetAspect=targetW/targetH,sx=0,sy=0,sw=plateW,sh=plateH,focus=portrait?.55:.52;
    if(targetAspect>sourceAspect){sh=sw/targetAspect;sy=C(plateH*.10,0,Math.max(0,plateH-sh));}
    else{sw=sh*targetAspect;sx=C(plateW*focus-sw/2,0,Math.max(0,plateW-sw));}
    return{sx:sx,sy:sy,sw:sw,sh:sh};
  }
  function buildScreenSkyline(){
    if(!skylineData)return null;
    var portrait=state.cssWidth<state.cssHeight,visible=Math.round(H*(portrait?.56:.52)),overscan=Math.round(H*(portrait?.18:.16)),drawH=visible+overscan,bandTop=H-visible,crop=sourceCrop(W,drawH,portrait),out=new Int32Array(W);
    for(var x=0;x<W;x++){var sx=crop.sx+((x+.5)/W)*crop.sw-.5,sy=sampleSkyline(sx);out[x]=C(Math.round(bandTop+((sy-crop.sy)/crop.sh)*drawH),0,H);}
    return out;
  }
  function ensure(){if(canvas)return;canvas=document.createElement("canvas");canvas.id="sky-life";canvas.setAttribute("aria-hidden","true");Object.assign(canvas.style,{position:"fixed",inset:"0",zIndex:"0",pointerEvents:"none",display:"block"});document.body.appendChild(canvas);ctx=canvas.getContext("2d",{alpha:true})}

  function seedLayer(out,cx,cy,span,tall,step,seed,density,kind){
    out.length=0;
    for(var y=cy-tall;y<=cy+tall*.52;y+=step)for(var x=cx-span*.5;x<=cx+span*.5;x+=step){
      if(x<0||x>=W||y<0||y>=H)continue;
      var u=(x-cx)/(span*.5),v=(y-cy)/tall,shape;
      if(kind===0){
        shape=Math.exp(-(u*u*2.0+v*v*3.5));
        shape+=.58*Math.exp(-((u+.46)*(u+.46)*4.3+(v+.02)*(v+.02)*5.3));
        shape+=.51*Math.exp(-((u-.40)*(u-.40)*4.8+(v+.08)*(v+.08)*5.9));
      }else{
        shape=Math.exp(-((u+.48)*(u+.48)*6.2));
        shape+=Math.exp(-((u-.39)*(u-.39)*6.8));
        shape+=.62*Math.exp(-(u*u*2.15));
        shape*=Math.exp(-(v*v*3.25));
      }
      shape=C(shape,0,1); if(shape<.045)continue;
      var ix=Math.floor(x/step),iy=Math.floor(y/step); if(h2(ix,iy,seed)>.055+shape*density)continue;
      out.push({x:x,y:y,q:shape,p:h2(ix,iy,seed+9)*15,b:bt(ix,iy)});
    }
  }

  function makeRepair(){
    repair.length=0;
    if(!screenSkyline)return;
    var limit=Math.floor(W*.14),step=Math.max(1,Math.round(D));
    for(var x=0;x<limit;x+=step){
      var edge=screenSkyline[Math.min(W-1,Math.round(x))],taper=1-S(.09,.14,x/W);
      for(var depth=2*D;depth<=11*D;depth+=step){
        var y=edge+depth;if(y<0||y>=H)continue;
        var band=(1-depth/(12*D))*taper;if(band<=0)continue;
        var ix=Math.floor(x/step),iy=Math.floor(y/step);
        if(h2(ix,iy,8301)>.18+band*.58)continue;
        repair.push({x:x,y:y,q:band,p:h2(ix,iy,8317)});
      }
    }
  }

  function make(){
    var a=theme(),range=Math.max(1,state.ridgeLow-state.ridgeTop),portrait=state.cssHeight>state.cssWidth;
    var cx=W*(portrait?.53:.57),cy=L(state.ridgeTop,state.ridgeLow,a.dark?.73:.79);
    seedLayer(basin,cx,cy,W*(a.dark?.60:.94),C(range*(a.dark?.92:1.56),78*D,270*D),Math.max(2,Math.round((a.dark?2.8:2.05)*D)),a.dark?7101:7201,a.dark?.34:.72,0);
    var vy=L(state.ridgeTop,state.ridgeLow,a.dark?.35:.40);
    seedLayer(veil,W*.52,vy,W*(a.dark?.84:.96),C(range*(a.dark?.42:.82),48*D,195*D),Math.max(2,Math.round((a.dark?3.0:2.35)*D)),a.dark?7301:7401,a.dark?.12:.47,1);
    makeRepair();
    stars.length=0;
    if(a.dark){var q=W*31+H*47+7501,count=portrait?14:24;for(var i=0;i<count;i++)stars.push({x:(.05+h(q++)*.90)*W,y:(.05+h(q++)*.65)*Math.max(state.ridgeTop,1),x2:(.05+h(q++)*.90)*W,y2:(.05+h(q++)*.65)*Math.max(state.ridgeTop,1),m:.24+h(q++)*.46,p:h(q++)*6.28,r:10000+h(q++)*26000,z:1100+h(q++)*2200,o:h(q++)*90000,R:52000+h(q++)*76000,w:i<7})}
  }

  function build(){
    var b=base(); if(!b){if(tries++<60)setTimeout(build,120);return}
    ensure();state=b;W=state.width;H=state.height;D=state.dpr;canvas.width=W;canvas.height=H;canvas.style.width=state.cssWidth+"px";canvas.style.height=state.cssHeight+"px";screenSkyline=buildScreenSkyline();make();draw(reduced?FIX:performance.now());if(raf)cancelAnimationFrame(raf);raf=0;last=0;if(!reduced&&shown)raf=requestAnimationFrame(tick)
  }

  function drawRepair(){
    var a=theme(); ctx.fillStyle=a.paper;
    for(var i=0;i<repair.length;i++){var d=repair[i];var alpha=(a.dark?.34:.58)*d.q*(.55+d.p*.45);if(alpha<.02)continue;ctx.globalAlpha=alpha;ctx.fillRect(Math.round(d.x),Math.round(d.y),1,1)}
  }

  function drawBasin(now){
    if(!basin.length)return;var a=theme(),t=now*(a.dark?.000018:.00024);
    var breathe=a.dark?.86+.14*Math.sin(now/26000*6.283+.8):.63+.37*Math.sin(now/18000*6.283+1.05);
    if(!a.dark){
      ctx.fillStyle=a.paper;
      for(var i=0;i<basin.length;i++){var d=basin[i],A=warped(d.x*.00125+d.p*.011,d.y*.00155,t*1.18,8101),Q=warped(d.x*.00185-d.p*.008,d.y*.00115+d.p*.006,t*.82,8129),den=d.q*(.10+A*.62+Q*.48)*breathe;if(den<d.b*.22)continue;var body=a.body*d.q*(.30+den*.70);ctx.globalAlpha=C(body,0,.88);ctx.fillRect(Math.round(d.x),Math.round(d.y),1,1)}
      ctx.fillStyle=a.haze;
      for(i=0;i<basin.length;i++){d=basin[i];A=warped(d.x*.00155+d.p*.015,d.y*.00175,t*.96,8201);Q=warped(d.x*.0021,d.y*.00120+d.p*.004,t*.66,8231);den=d.q*(.08+A*.58+Q*.44)*breathe;if(den<d.b*.34)continue;ctx.globalAlpha=C(.06+d.q*.12,0,.18);ctx.fillRect(Math.round(d.x),Math.round(d.y-2*D),1,1)}
    }
    ctx.fillStyle=a.ink;
    for(var j=0;j<basin.length;j++){var dot=basin[j],aa=warped(dot.x*.00145+dot.p*.012,dot.y*.0017,t*(a.dark?.82:1.05),a.dark?7601:7701),bb=warped(dot.x*.00195-dot.p*.010,dot.y*.0012+dot.p*.006,t*(a.dark?.52:.76),a.dark?7629:7733),density=dot.q*(.04+aa*.61+bb*.48)*breathe;if(density<dot.b*(a.dark?.54:.31))continue;var al=a.rim*(.12+density*.88);if(al<.004)continue;ctx.globalAlpha=C(al,0,a.dark?.19:.22);ctx.fillRect(Math.round(dot.x),Math.round(dot.y),1,1)}
  }

  function drawVeil(now){
    if(!veil.length)return;var a=theme(),t=now*(a.dark?.000012:.00017),breathe=a.dark?.93+.07*Math.sin(now/37000*6.283+.4):.60+.40*Math.sin(now/24000*6.283+1.7);
    if(!a.dark){ctx.fillStyle=a.paper;for(var i=0;i<veil.length;i++){var d=veil[i],A=warped(d.x*.00122+d.p*.017,d.y*.00148,t*1.1,8401),Q=warped(d.x*.00195-d.p*.009,d.y*.00108+d.p*.007,t*.74,8429),den=d.q*(.05+A*.61+Q*.50)*breathe;if(den<d.b*.30)continue;ctx.globalAlpha=C(a.veil*d.q*(.18+den*.82),0,.34);ctx.fillRect(Math.round(d.x),Math.round(d.y),1,1)}}
    ctx.fillStyle=a.ink;for(var k=0;k<veil.length;k++){var dot=veil[k],aa=warped(dot.x*.0013+dot.p*.018,dot.y*.00155,t*(a.dark?.55:.92),a.dark?7801:7901),bb=warped(dot.x*.0021-dot.p*.01,dot.y*.0011+dot.p*.008,t*(a.dark?.35:.70),a.dark?7827:7929),density=dot.q*(.03+aa*.62+bb*.52)*breathe;if(density<dot.b*(a.dark?.69:.34))continue;var al=(a.dark?.06:.10)*(.14+density*.86);if(al<.004)continue;ctx.globalAlpha=C(al,0,a.dark?.065:.13);ctx.fillRect(Math.round(dot.x),Math.round(dot.y),1,1)}
  }

  function drawStars(now){var a=theme();if(!a.dark)return;ctx.fillStyle=a.ink;for(var i=0;i<stars.length;i++){var z=stars[i],tw=.74+Math.sin(now/z.r*6.283+z.p)*.18+Math.sin(now/z.z*6.283+z.p*1.7)*.08,xx=z.x,yy=z.y,fade=1;if(z.w){var k=((now+z.o)%z.R)/z.R;if(k<.32)fade=S(.02,.07,k)*(1-S(.25,.32,k));else if(k<.47)fade=0;else if(k<.82){xx=z.x2;yy=z.y2;fade=S(.47,.55,k)*(1-S(.75,.82,k))}else fade=0}var al=a.star*z.m*tw*fade;if(al<.01)continue;ctx.globalAlpha=C(al,0,.62);ctx.fillRect(Math.round(xx),Math.round(yy),1,1)}}

  function draw(now){if(!ctx||!state)return;ctx.clearRect(0,0,W,H);drawRepair();drawStars(now);drawBasin(now);drawVeil(now);ctx.globalAlpha=1}
  function tick(now){if(!shown||reduced){raf=0;return}if(!last||now-last>=FRAME){last=now;draw(now)}raf=requestAnimationFrame(tick)}

  listen(tm,build);listen(mm,function(e){reduced=e.matches;build()});addEventListener("resize",function(){clearTimeout(build._t);build._t=setTimeout(build,110)},{passive:true});document.addEventListener("visibilitychange",function(){shown=!document.hidden;if(shown&&!reduced&&!raf)raf=requestAnimationFrame(tick)});
  window.__portfolioLife={build:build,step:function(now){draw(now==null?(reduced?FIX:performance.now()):now)},state:function(){return{ready:!!state,basin:basin.length,veil:veil.length,repair:repair.length,stars:stars.length,reduced:reduced}}};
  fetch("/assets/annapurna-skyline.json",{cache:"force-cache"}).then(function(r){if(!r.ok)throw new Error("skyline");return r.json()}).then(function(data){skylineData=data;build()}).catch(function(){build()});
})();
