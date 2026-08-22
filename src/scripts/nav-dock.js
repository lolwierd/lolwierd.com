const nav = document.querySelector("[data-nav-dock]");

if (nav) {
  const links = [...nav.querySelectorAll("a")];
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function resetLift() {
    nav.removeAttribute("data-nav-hover");
    links.forEach((link) => link.style.removeProperty("--dock-lift"));
  }

  nav.addEventListener("pointermove", (event) => {
    if (!finePointer.matches || reducedMotion.matches) return;
    nav.setAttribute("data-nav-hover", "");
    links.forEach((link) => {
      const rect = link.getBoundingClientRect();
      const distance = Math.abs(event.clientX - (rect.left + rect.width / 2));
      const influence = Math.max(0, 1 - distance / 90);
      link.style.setProperty("--dock-lift", `${(-influence * 2.5).toFixed(2)}px`);
    });
  });

  nav.addEventListener("pointerleave", resetLift);
  nav.addEventListener("focusout", (event) => {
    if (!nav.contains(event.relatedTarget)) resetLift();
  });

  const handleMotionChange = () => {
    if (reducedMotion.matches) resetLift();
  };

  if (reducedMotion.addEventListener) reducedMotion.addEventListener("change", handleMotionChange);
  else reducedMotion.addListener?.(handleMotionChange);
}
