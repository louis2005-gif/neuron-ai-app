// NEURON AI – animierter Hintergrund: NEURONALER STROM
// Ein dichtes Netz aus grauen, rot und blau glühenden Knoten fließt als
// zusammenhängender Strom durchs Bild. Verbindungen pulsieren, entstehen
// und lösen sich nach Nähe – das Netz bildet sich permanent neu.
(function () {
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const RED = "229,64,47";       // Crimson (Markenfarbe)
  const RED_DEEP = "200,16,46";
  const BLUE = "47,111,229";     // Akzent-Blau
  const BLUE_DEEP = "29,78,178";
  const GRAY = "58,63,71";       // Anthrazit-Grau für Knoten
  const LINE = "60,65,75";       // Linien-Grau

  let W = 0, H = 0, DPR = 1;
  let nodes = [];
  let raf = null, running = false, t = 0, intensity = 1;

  const media = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const prefersReduced = () => Boolean(media && media.matches);
  const rand = (a, b) => a + Math.random() * (b - a);

  function config() {
    const count = Math.max(70, Math.min(230, Math.round(((W * H) / 6200) * intensity)));
    return {
      count,
      flow: 0.5 * intensity,       // Strömungsgeschwindigkeit des Flusses (nach rechts)
      linkDist: Math.min(190, Math.max(120, Math.sqrt((W * H) / count) * 1.55)),
    };
  }

  // Mittellinie des Flusses: eine sich langsam verschiebende Welle,
  // die sich von links nach rechts durchs ganze Bild zieht
  function riverY(x, tt) {
    return H * (0.5
      + 0.27 * Math.sin(x * 0.0035 + tt * 1.6)
      + 0.12 * Math.sin(x * 0.0011 - tt * 1.1));
  }

  function paint(n) {
    const r = Math.random();
    n.kind = r < 0.16 ? "red" : r < 0.26 ? "blue" : "gray";
    n.r = n.kind === "gray" ? rand(1.3, 2.4) : rand(2.2, 4.2);
    n.ph = rand(0, Math.PI * 2);
    n.drift = rand(0.55, 1.5);
    // Lage quer zum Fluss: zur Mitte hin verdichtet → enge Cluster im Kern,
    // lockere Ausläufer am Rand (wie im Referenzbild)
    n.off = (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
    n.wob = rand(2, 7); // individuelles Auf-und-ab im Strom
  }

  function spawn(n, fromLeft) {
    n.x = fromLeft ? rand(-80, -10) : rand(0, W);
    paint(n);
    n.y = riverY(n.x, t * 0.00012) + n.off * H * 0.17;
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
    const tt = t * 0.00012;
    const band = H * 0.17;         // halbe Breite des Flussbetts
    for (const n of nodes) {
      // Alles strömt nach rechts; die Höhe folgt der wandernden Flusslinie
      n.x += c.flow * n.drift;
      const wobble = Math.sin(t * 0.0011 + n.ph) * n.wob;
      n.y = riverY(n.x, tt) + n.off * band + wobble;
      if (n.x > W + 40) spawn(n, true);
    }
  }

  function linkColor(a, b, alpha) {
    if (a.kind === "red" || b.kind === "red") return `rgba(${RED},${alpha})`;
    if (a.kind === "blue" || b.kind === "blue") return `rgba(${BLUE},${alpha})`;
    return `rgba(${LINE},${alpha * 0.7})`;
  }

  function draw() {
    const c = config();
    ctx.clearRect(0, 0, W, H);

    // Verbindungen: Nähe entscheidet; die Helligkeit pulsiert wie Nervensignale
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > c.linkDist) continue;
        const near = 1 - d / c.linkDist;             // 1 = ganz nah, 0 = an der Kante
        const pulse = 0.65 + 0.35 * Math.sin(t * 0.0021 + a.ph + b.ph);
        const alpha = (0.08 + near * 0.42) * pulse * Math.min(1.2, intensity);
        const colored = a.kind !== "gray" || b.kind !== "gray";
        ctx.strokeStyle = linkColor(a, b, alpha);
        ctx.lineWidth = (colored ? 0.7 : 0.5) + near * (colored ? 1.2 : 0.7);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Knoten: grau matt; rot und blau mit weichem Puls-Glühen
    for (const n of nodes) {
      if (n.kind === "gray") {
        ctx.fillStyle = `rgba(${GRAY},0.72)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const col = n.kind === "red" ? RED : BLUE;
      const deep = n.kind === "red" ? RED_DEEP : BLUE_DEEP;
      const p = 0.6 + 0.4 * Math.sin(t * 0.0014 + n.ph);
      const R = n.r * (3.2 + p * 1.8);
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R);
      g.addColorStop(0, `rgba(${col},${0.34 * p})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${deep},${0.75 + 0.25 * p})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (0.95 + 0.15 * p), 0, Math.PI * 2);
      ctx.fill();
    }
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
