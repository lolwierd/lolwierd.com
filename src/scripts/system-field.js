const field = document.querySelector("[data-system-field]");

if (field) {
  const stage = field.querySelector("[data-system-stage]");
  const canvas = field.querySelector("[data-system-canvas]");
  const nodes = [...field.querySelectorAll("[data-system-node]")];
  const detailLabel = field.querySelector("[data-system-detail-label]");
  const detailCopy = field.querySelector("[data-system-detail-copy]");
  const context = canvas?.getContext("2d");

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

  const edges = [
    ["request", "control"],
    ["control", "compute"],
    ["control", "storage"],
    ["control", "kubernetes"],
    ["control", "networking"],
    ["control", "identity"],
    ["reconciliation", "control"]
  ];

  const primaryEdges = {
    request: "request:control",
    control: "request:control",
    compute: "control:compute",
    storage: "control:storage",
    kubernetes: "control:kubernetes",
    networking: "control:networking",
    identity: "control:identity",
    reconciliation: "reconciliation:control"
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    selected: "control",
    active: "control",
    visible: true,
    width: 0,
    height: 0,
    dpr: 1,
    positions: new Map(),
    frame: 0,
    raf: 0
  };

  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const edgeKey = (from, to) => `${from}:${to}`;

  function positionNodes() {
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    state.positions = new Map(nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return [node.dataset.systemNode, {
        x: rect.left - stageRect.left + rect.width / 2,
        y: rect.top - stageRect.top + rect.height / 2
      }];
    }));
  }

  function resize() {
    if (!stage || !canvas || !context) return;
    const rect = stage.getBoundingClientRect();
    state.width = rect.width;
    state.height = rect.height;
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * state.dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * state.dpr));
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    positionNodes();
    draw(state.frame);
  }

  function drawArrow(end, start, color, alpha) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = 4;
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - Math.cos(angle - Math.PI / 6) * size,
      end.y - Math.sin(angle - Math.PI / 6) * size
    );
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - Math.cos(angle + Math.PI / 6) * size,
      end.y - Math.sin(angle + Math.PI / 6) * size
    );
    context.strokeStyle = color;
    context.globalAlpha = alpha;
    context.stroke();
    context.globalAlpha = 1;
  }

  function pointOnLine(start, end, amount) {
    return {
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount
    };
  }

  function draw(frame) {
    if (!context || !state.width || !state.height) return;

    const ink = css("--canvas-ink", "#293039");
    const accent = css("--accent", "#9d4429");
    const activeKey = primaryEdges[state.active];
    context.clearRect(0, 0, state.width, state.height);
    context.lineCap = "square";
    context.lineWidth = 1;

    for (const [fromKey, toKey] of edges) {
      const start = state.positions.get(fromKey);
      const end = state.positions.get(toKey);
      if (!start || !end) continue;

      const key = edgeKey(fromKey, toKey);
      const primary = key === activeKey;
      const connected = fromKey === state.active || toKey === state.active;
      context.beginPath();
      context.setLineDash(primary ? [] : connected ? [1, 5] : [2, 8]);
      context.lineWidth = primary ? 1.4 : connected ? 1 : 0.75;
      context.strokeStyle = primary ? accent : ink;
      context.globalAlpha = primary ? 0.68 : connected ? 0.24 : 0.1;
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.setLineDash([]);

      if (primary) {
        drawArrow(end, start, accent, 0.68);
      }

      if (primary && !reducedMotion.matches) {
        const pulse = (frame * 0.00011) % 1;
        const point = pointOnLine(start, end, pulse);
        context.beginPath();
        context.fillStyle = accent;
        context.globalAlpha = 0.78;
        context.arc(point.x, point.y, 1.8, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      }
    }

    context.setLineDash([]);
    context.globalAlpha = 1;
  }

  function updateDetail(key) {
    if (detailLabel) detailLabel.textContent = key;
    if (detailCopy) detailCopy.textContent = details[key];
  }

  function markActive(key) {
    state.active = key;
    nodes.forEach((node) => {
      if (node.dataset.systemNode === key) node.setAttribute("data-system-active", "");
      else node.removeAttribute("data-system-active");
    });
    updateDetail(key);
    draw(state.frame);
  }

  function select(key) {
    if (!details[key]) return;
    state.selected = key;
    nodes.forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.systemNode === key)));
    markActive(key);
  }

  function resetPreview() {
    markActive(state.selected);
  }

  function stopAnimation() {
    if (!state.raf) return;
    window.cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function animate(now) {
    state.raf = 0;
    state.frame = now;
    if (!state.visible || document.visibilityState === "hidden" || reducedMotion.matches) return;
    draw(now);
    state.raf = window.requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (reducedMotion.matches || !state.visible || state.raf) return;
    state.raf = window.requestAnimationFrame(animate);
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

  const visibility = new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting;
    if (state.visible) startAnimation();
    else stopAnimation();
  }, { threshold: 0.05 });
  visibility.observe(field);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopAnimation();
    else startAnimation();
  });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(stage);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }

  const handleMotionChange = () => {
    if (reducedMotion.matches) stopAnimation();
    else startAnimation();
    draw(state.frame);
  };

  if (reducedMotion.addEventListener) reducedMotion.addEventListener("change", handleMotionChange);
  else reducedMotion.addListener?.(handleMotionChange);

  markActive(state.selected);
  resize();
  startAnimation();
}
