// NEURON AI – animierter Hintergrund: LEBENDES NEURONALES NETZ
// Graue und rot glühende Knoten strömen langsam durch ein weiches Vektorfeld
// über weißem Grund. Verbindungen entstehen und lösen sich nach Nähe –
// das Netz bildet sich permanent neu.
(function () {
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const RED = "229,64,47";       // Crimson (Markenfarbe)
  const RED_DEEP = "200,16,46";
  const GRAY = "58,63,71";       // Anthrazit-Grau für Knoten
  const LINE = "60,65,75";       // Linien-Grau

  let W = 0, H = 0, DPR = 1;
  let nodes = [];
  let raf = null, running = false, t = 0, intensity = 1;

  const media = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const prefersReduced = () => Boolean(media && media.matches);
  const rand = (a, b) => a + Math.random() * (b - a);

  function config() {
    const count = Math.max(26, Math.min(120, Math.round(((W * H) / 16000) * intensity)));
    return {
      count,
      speed: 0.3 * intensity,
      linkDist: Math.min(200, Math.max(110, Math.sqrt((W * H) / count) * 1.15)),
    };
  }

  // Weiches, langsam driftendes Vektorfeld (billiges Pseudo-Rauschen aus Sinus-Lagen)
  function fieldAngle(x, y, tt) {
    const v =
      Math.sin(x * 0.0014 + tt) +
      Math.cos(y * 0.0017 - tt * 0.7) +
      Math.sin((x + y) * 0.001 + tt * 0.45);
    return v * Math.PI;
  }

  function spawn(n, edge) {
    if (edge) {
      // Neue Knoten treiben vom Rand herein – das Netz „strömt“
      const side = (Math.random() * 4) | 0;
      if (side === 0) { n.x = -30; n.y = rand(0, H); }
      else if (side === 1) { n.x = W + 30; n.y = rand(0, H); }
      else if (side === 2) { n.x = rand(0, W); n.y = -30; }
      else { n.x = rand(0, W); n.y = H + 30; }
    } else {
      n.x = rand(0, W);
      n.y = rand(0, H);
    }
    n.red = Math.random() < 0.22;                    // ~jeder 5. Knoten glüht rot
    n.r = n.red ? rand(2.6, 4.6) : rand(1.4, 2.6);
    n.ph = rand(0, Math.PI * 2);                     // Puls-Phase
    n.drift = rand(0.5, 1.4);                        // individuelles Tempo
    return n;
  }

  function initNodes() {
    const c = config();
    nodes = [];
    for (let i = 0; i < c.count; i++) nodes.push(spawn({}, false));
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const de = document.documentElement;
    W = Math.max(canvas.clientWidth, de.clientWidth, window.innerWidth || 0, 320);
    H = Math.max(canvas.clientHeight, de.clientHeight, window.innerHeight || 0, 480);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    initNodes();
    if (running) draw();
  }

  function update() {
    const c = config();
    const tt = t * 0.0001;
    for (const n of nodes) {
      const a = fieldAngle(n.x, n.y, tt);
      n.x += Math.cos(a) * c.speed * n.drift;
      n.y += Math.sin(a) * c.speed * n.drift;
      if (n.x < -40 || n.x > W + 40 || n.y < -40 || n.y > H + 40) spawn(n, true);
    }
  }

  function draw() {
    const c = config();
    ctx.clearRect(0, 0, W, H);
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.0012);

    // Verbindungen: Nähe entscheidet – so lösen sie sich beim Strömen und bilden sich neu
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > c.linkDist) continue;
        const near = 1 - d / c.linkDist;             // 1 = ganz nah, 0 = an der Kante
        if (a.red || b.red) {
          ctx.strokeStyle = `rgba(${RED},${(0.06 + near * 0.3) * Math.min(1.2, intensity)})`;
          ctx.lineWidth = 0.7 + near * 1.1;
        } else {
          ctx.strokeStyle = `rgba(${LINE},${(0.04 + near * 0.16) * Math.min(1.2, intensity)})`;
          ctx.lineWidth = 0.5 + near * 0.5;
        }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Knoten: grau matt, rot mit weichem Puls-Glühen
    for (const n of nodes) {
      if (n.red) {
        const p = 0.6 + 0.4 * Math.sin(t * 0.0012 + n.ph);
        const R = n.r * (3.4 + p * 1.6);
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R);
        g.addColorStop(0, `rgba(${RED},${0.32 * p})`);
        g.addColorStop(1, `rgba(${RED},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${RED_DEEP},${0.75 + 0.25 * p})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (0.95 + 0.15 * p), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(${GRAY},0.75)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    void pulse;
  }

  function step() { update(); draw(); }

  function loop(ts) { t = ts || 0; step(); raf = requestAnimationFrame(loop); }

  function seedStatic() {
    // Bewegungsreduziert: ein ruhiges Standbild des Netzes
    for (let i = 0; i < 30; i++) update();
    draw();
  }

  function start() {
    if (running) return;
    running = true;
    if (prefersReduced()) { seedStatic(); return; }
    draw();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    ctx.clearRect(0, 0, W, H);
  }

  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => { resize(); }, 150);
  });
  if (media && media.addEventListener) {
    media.addEventListener("change", () => { if (running) { stop(); running = false; start(); } });
  }

  window.NeuronBG = {
    init(opts) { intensity = (opts && opts.intensity) || 1; resize(); },
    start, stop,
    setIntensity(v) { intensity = v; initNodes(); if (running && prefersReduced()) seedStatic(); },
    setEnabled(on) {
      canvas.style.display = on ? "block" : "none";
      if (on) start(); else stop();
    },
  };
})();
