const nav = document.querySelector("[data-nav-dock]");

if (nav) {
  const links = [...nav.querySelectorAll("[data-nav-target]")];
  const sections = links
    .map((link) => document.getElementById(link.dataset.navTarget))
    .filter(Boolean);
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function setCurrent(id) {
    links.forEach((link) => {
      if (link.dataset.navTarget === id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (visible[0]) setCurrent(visible[0].target.id);
  }, { rootMargin: "-18% 0px -62% 0px", threshold: [0.1, 0.35, 0.7] });

  sections.forEach((section) => sectionObserver.observe(section));

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
