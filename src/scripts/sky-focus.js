// An ordinary reversible viewing mode, not browser fullscreen. The same scene
// keeps running while reading/navigation controls leave both view and tab order.
const hero = document.querySelector('.hero');
if (hero) {
  const root = document.documentElement;
  const content = [...hero.querySelectorAll('.topbar,.hero-copy')];
  const ground = document.querySelector('main');
  const enter = document.querySelector('[data-watch-sky]');
  const exit = document.createElement('button');
  exit.className='sky-return'; exit.textContent='back to the page · esc'; exit.hidden=true;
  document.body.appendChild(exit);
  let previousFocus;
  function setFocus(active) {
    if(root.hasAttribute('data-sky-focus')===active) return;
    if(active) {
      previousFocus=document.activeElement;
      window.scrollTo({top:0,behavior:'instant'});
      root.setAttribute('data-sky-focus','');
      content.forEach(n=>n.inert=true);
      if(ground) ground.inert=true;
      exit.hidden=false; exit.focus({preventScroll:true});
    } else {
      root.removeAttribute('data-sky-focus');
      content.forEach(n=>n.inert=false);
      if(ground) ground.inert=false;
      exit.hidden=true;
      (previousFocus && previousFocus!==document.body ? previousFocus : enter)?.focus({preventScroll:true});
      window.dispatchEvent(new Event('skywatchend'));
    }
    window.dispatchEvent(new Event('skyfocuschange'));
  }
  enter?.addEventListener('click',()=>setFocus(true));
  exit.addEventListener('click',()=>setFocus(false));
  window.addEventListener('skywatchstart',()=>setFocus(true));
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && root.hasAttribute('data-sky-focus'))setFocus(false);});
}
