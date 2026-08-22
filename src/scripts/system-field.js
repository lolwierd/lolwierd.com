const field = document.querySelector("[data-system-field]");

if (field) {
  const stage = field.querySelector("[data-system-stage]");
  const canvas = field.querySelector("[data-system-canvas]");
  const nodes = [...field.querySelectorAll("[data-system-node]")];
  const detailLabel = field.querySelector("[data-system-detail-label]");
  const detailCopy = field.querySelector("[data-system-detail-copy]");
  const context = canvas?.getContext("2d");

  const details = {
    compute: "the control plane over QEMU/KVM, including rescue boot, attach/detach, resize, and recovery after failed transitions.",
    storage: "SPDK and NVMe-oF with the VFIO-user path into guests; a reconciler converged intent against live bdev, lvol, and RAID state.",
    kubernetes: "managed clusters end to end: bootstrap, OIDC/JWKS, Cilium, CoreDNS, CSI attach and failover, and a Karpenter provider.",
    networking: "an ARP/NDP proxy with BPF filtering, VLAN handling, rate limits, GARP, IPv6 DAD, and authoritative DNS with AXFR and IXFR.",
    identity: "the identity and account plane: IMDS tokens, Valkey-backed caching, IAM authorization, encrypted secrets, and S3-compatible storage.",
    reconciliation: "the recurring shape underneath it all: database intent, live infrastructure, and recovery paths that converge after partial failure."
  };

  const edges = [
    ["compute", "storage"],
    ["compute", "kubernetes"],
    ["compute", "networking"],
    ["storage", "kubernetes"],
    ["kubernetes", "reconciliation"],
    ["networking", "identity"],
    ["identity", "reconciliation"],
    ["storage", "reconciliation"]
  ];

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    active: "compute",
    visible: true,
    width: 0,
    height: 0,
    dpr: 1,
    positions: new Map(),
    frame: 0,
    raf: 0
  };

  const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

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

  function curveFor(start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;
    const bend = Math.min(34, length * 0.12) * (start.y < end.y ? 1 : -1);
    return {
      x: (start.x + end.x) / 2 + normalX * bend,
      y: (start.y + end.y) / 2 + normalY * bend
    };
  }

  function drawCurve(start, control, end) {
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo(control.x, control.y, end.x, end.y);
  }

  function pointOnCurve(start, control, end, amount) {
    const inverse = 1 - amount;
    return {
      x: inverse * inverse * start.x + 2 * inverse * amount * control.x + amount * amount * end.x,
      y: inverse * inverse * start.y + 2 * inverse * amount * control.y + amount * amount * end.y
    };
  }

  function drawGrid(ink) {
    context.beginPath();
    context.lineWidth = 1;
    context.strokeStyle = ink;
    context.globalAlpha = 0.045;
    for (let x = 0.5; x < state.width; x += 34) {
      context.moveTo(x, 0);
      context.lineTo(x, state.height);
    }
    for (let y = 0.5; y < state.height; y += 34) {
      context.moveTo(0, y);
      context.lineTo(state.width, y);
    }
    context.stroke();
    context.globalAlpha = 1;
  }

  function draw(frame) {
    if (!context || !state.width || !state.height) return;

    const ink = css("--canvas-ink", "#293039");
    const accent = css("--accent", "#9d4429");
    context.clearRect(0, 0, state.width, state.height);
    drawGrid(ink);

    for (const [fromKey, toKey] of edges) {
      const start = state.positions.get(fromKey);
      const end = state.positions.get(toKey);
      if (!start || !end) continue;

      const control = curveFor(start, end);
      const active = fromKey === state.active || toKey === state.active;
      context.beginPath();
      context.setLineDash(active ? [] : [2, 7]);
      context.lineWidth = active ? 1.25 : 0.8;
      context.strokeStyle = active ? accent : ink;
      context.globalAlpha = active ? 0.46 : 0.14;
      drawCurve(start, control, end);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = 1;

      if (active && !reducedMotion.matches) {
        const pulse = (frame * 0.00018 + fromKey.length * 0.07 + toKey.length * 0.03) % 1;
        const point = pointOnCurve(start, control, end, pulse);
        context.beginPath();
        context.fillStyle = accent;
        context.globalAlpha = 0.82;
        context.arc(point.x, point.y, 2, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
      }
    }

    for (const point of state.positions.values()) {
      context.beginPath();
      context.fillStyle = ink;
      context.globalAlpha = 0.45;
      context.arc(point.x, point.y, 1.4, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  function activate(key) {
    if (!details[key]) return;
    state.active = key;
    nodes.forEach((node) => node.setAttribute("aria-pressed", String(node.dataset.systemNode === key)));
    if (detailLabel) detailLabel.textContent = key;
    if (detailCopy) detailCopy.textContent = details[key];
    draw(state.frame);
  }

  function animate(now) {
    state.frame = now;
    if (!state.visible || document.visibilityState === "hidden") return;
    draw(now);
    state.raf = window.requestAnimationFrame(animate);
  }

  nodes.forEach((node) => {
    const key = node.dataset.systemNode;
    node.addEventListener("pointerenter", () => activate(key));
    node.addEventListener("focus", () => activate(key));
    node.addEventListener("click", () => activate(key));
  });

  const visibility = new IntersectionObserver(([entry]) => {
    state.visible = entry.isIntersecting;
    if (state.visible && !reducedMotion.matches && !state.raf) {
      state.raf = window.requestAnimationFrame(animate);
    }
  }, { threshold: 0.05 });
  visibility.observe(field);

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(stage);
  } else {
    window.addEventListener("resize", resize, { passive: true });
  }

  reducedMotion.addEventListener?.("change", () => {
    if (reducedMotion.matches) {
      window.cancelAnimationFrame(state.raf);
      state.raf = 0;
      draw(state.frame);
    } else if (state.visible && !state.raf) {
      state.raf = window.requestAnimationFrame(animate);
    }
  });

  resize();
  if (!reducedMotion.matches) state.raf = window.requestAnimationFrame(animate);
}
