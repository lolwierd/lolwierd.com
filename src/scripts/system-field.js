const field = document.querySelector("[data-system-field]");

if (field) {
  const stage = field.querySelector("[data-system-stage]");
  const routeSvg = field.querySelector("[data-system-routes]");
  const routes = [...field.querySelectorAll("[data-system-route]")];
  const nodes = [...field.querySelectorAll("[data-system-node]")];
  const detailLabel = field.querySelector("[data-system-detail-label]");
  const detailCopy = field.querySelector("[data-system-detail-copy]");

  const details = {
    request: "the console, SDK, CLI, and Terraform provider turn one customer intent into the same API contract.",
    control: "the shared Go layer handled auth, typed errors, OpenAPI generation, telemetry, and orchestration across the services.",
    compute: "the QEMU/KVM lifecycle: rescue boot, attach/detach, resize, subnet operations, host setup, and recovery after failure.",
    storage: "SPDK and NVMe-oF with the VFIO-user path into guests; intent converged against live bdev, lvol, and RAID state.",
    kubernetes: "managed clusters end to end: bootstrap, OIDC/JWKS, Cilium, CoreDNS, CSI attach and failover, and Karpenter.",
    networking: "an ARP/NDP proxy with BPF filtering, VLAN handling, rate limits, GARP, IPv6 DAD, and authoritative DNS.",
    identity: "the identity and account plane: IMDS tokens, Valkey-backed caching, IAM authorization, encrypted secrets, and S3.",
    reconciliation: "the failure path underneath it all: compare desired intent with live infrastructure, retry safely, and recover partial transitions."
  };

  const state = {
    selected: "control",
    active: "control"
  };

  function relativeRect(node, stageRect) {
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left - stageRect.left,
      centerY: rect.top - stageRect.top + rect.height / 2
    };
  }

  function renderRoutes() {
    if (!stage || !routeSvg || !routes.length || !nodes.length) return;

    const stageRect = stage.getBoundingClientRect();
    const positions = new Map(nodes.map((node) => [
      node.dataset.systemNode,
      relativeRect(node, stageRect)
    ]));
    const points = [...positions.values()];
    if (!points.length) return;

    const spineX = Math.max(5, Math.min(...points.map((point) => point.left)) - 9);
    const yValues = points.map((point) => point.centerY);

    routeSvg.setAttribute("viewBox", `0 0 ${stageRect.width} ${stageRect.height}`);

    const spine = routes.find((route) => route.dataset.systemRoute === "spine");
    spine?.setAttribute("d", `M ${spineX} ${Math.min(...yValues)} V ${Math.max(...yValues)}`);

    routes.forEach((route) => {
      const key = route.dataset.systemRoute;
      if (key === "spine") return;

      const point = positions.get(key);
      if (!point) return;

      const targetX = Math.max(spineX + 4, point.left - 4);
      route.setAttribute("d", `M ${spineX} ${point.centerY} H ${targetX}`);
    });
  }

  function updateRouteState() {
    routes.forEach((route) => {
      route.classList.toggle("system-field__route--active", route.dataset.systemRoute === state.active);
    });
  }

  function updateDetail(key) {
    if (detailLabel) detailLabel.textContent = key;
    if (detailCopy) detailCopy.textContent = details[key];
  }

  function markActive(key) {
    state.active = key;
    nodes.forEach((node) => {
      node.toggleAttribute("data-system-active", node.dataset.systemNode === key);
    });
    updateDetail(key);
    updateRouteState();
  }

  function select(key) {
    if (!details[key]) return;
    state.selected = key;
    nodes.forEach((node) => {
      node.setAttribute("aria-pressed", String(node.dataset.systemNode === key));
    });
    markActive(key);
  }

  function resetPreview() {
    markActive(state.selected);
  }

  nodes.forEach((node) => {
    const key = node.dataset.systemNode;
    node.addEventListener("pointerenter", () => markActive(key));
    node.addEventListener("pointerleave", () => {
      if (!node.matches(":focus")) resetPreview();
    });
    node.addEventListener("focus", () => select(key));
    node.addEventListener("click", () => select(key));
  });

  field.addEventListener("pointerleave", resetPreview);
  field.addEventListener("focusout", (event) => {
    if (!field.contains(event.relatedTarget)) resetPreview();
  });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(renderRoutes).observe(stage);
  } else {
    window.addEventListener("resize", renderRoutes, { passive: true });
  }

  markActive(state.selected);
  renderRoutes();
}
