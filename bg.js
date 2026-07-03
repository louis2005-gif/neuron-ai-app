// NEURON AI – animierter Hintergrund: NEURONALER STROM
// Ein dichtes Netz aus grauen, rot und blau glühenden Knoten fließt als
// zusammenhängender Strom durchs Bild. Verbindungen pulsieren, entstehen
// und lösen sich nach Nähe – das Netz bildet sich permanent neu.
(function () {
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const RED = "255,74,56";       // Crimson-Glühen (Markenfarbe)
  const RED_DEEP = "229,44,32";
  const VIOLET = "168,85,247";   // tiefes Lila – die Brücke zwischen Rot und Blau
  const VIOLET_DEEP = "124,44,214";
  const BLUE = "82,140,255";     // elektrisches Akzent-Blau
  const BLUE_DEEP = "56,108,224";
  const GRAY = "190,196,208";    // helle Knoten auf Schwarz
  const LINE = "200,206,218";    // feine helle Linien
  const NODE_COL = { red: RED, violet: VIOLET, blue: BLUE };
  const NODE_DEEP = { red: RED_DEEP, violet: VIOLET_DEEP, blue: BLUE_DEEP };

  let W = 0, H = 0, DPR = 1;
  let nodes = [];
  let raf = null, running = false, t = 0, intensity = 1;
  // Denk-Modus: das Netz selbst ist die Ladeanzeige – es pulsiert stärker
  // und eine Energiewelle lädt es von links nach rechts auf.
  // energy gleitet weich zwischen Ruhe (0) und Denken (1): kein Reset,
  // kein Sprung – eine einzige durchgehende Animation.
  let thinking = false, charge = 0, energy = 0, clock = 0, lastTs = 0;

  const media = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const prefersReduced = () => Boolean(media && media.matches);
  const rand = (a, b) => a + Math.random() * (b - a);

  function config() {
    const count = Math.max(70, Math.min(230, Math.round(((W * H) / 6200) * intensity)));
    return {
      count,
      linkDist: Math.min(190, Math.max(120, Math.sqrt((W * H) / count) * 1.55)),
    };
  }

  // Mittellinie des Flusses: eine FESTE Welle durchs Bild – der Fluss
  // bleibt an seiner Stelle, nur die Knoten atmen darin
  function riverY(x) {
    const u = x / Math.max(W, 1); // 0 = linker Rand, 1 = rechter Rand
    return H * (0.5
      + 0.30 * Math.sin(u * 2.6 - 1.3)
      + 0.10 * Math.sin(u * 6.5 + 1.0));
  }

  function paint(n) {
    const r = Math.random();
    n.kind = r < 0.14 ? "red" : r < 0.24 ? "violet" : r < 0.33 ? "blue" : "gray";
    n.r = n.kind === "gray" ? rand(1.3, 2.4) : rand(2.2, 4.2);
    n.ph = rand(0, Math.PI * 2);
    n.ph2 = rand(0, Math.PI * 2);
    // Lage quer zum Fluss: zur Mitte hin verdichtet → enge Cluster im Kern,
    // lockere Ausläufer am Rand (wie im Referenzbild)
    n.off = (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
    n.amp = rand(3, 9); // Größe der langsamen Eigenbewegung um den Ankerpunkt
  }

  function spawn(n) {
    paint(n);
    // Fester Ankerpunkt im Flussbett – hier bleibt der Knoten dauerhaft
    n.ax = rand(-30, W + 30);
    n.ay = riverY(n.ax) + n.off * H * 0.17;
    n.x = n.ax;
    n.y = n.ay;
    return n;
  }

  function initNodes() {
    const c = config();
    nodes = [];
    for (let i = 0; i < c.count; i++) nodes.push(spawn({}));
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
    // Der Fluss bleibt an seiner Stelle. Jeder Knoten atmet ganz langsam um
    // seinen Ankerpunkt; die Phase wandert entlang des Flusses, sodass eine
    // sanfte Welle hindurchläuft – es fließt, ohne zu wandern.
    // Das Tempo steckt in der weich beschleunigten Uhr (clock), nicht in
    // einem harten Faktor – dadurch gibt es nie einen Sprung.
    for (const n of nodes) {
      n.x = n.ax + Math.sin(t * 0.00042 + n.ph) * n.amp;
      n.y = n.ay + Math.sin(t * 0.00052 + n.ph2 + n.ax * 0.006) * n.amp * 0.9;
    }
    if (energy > 0.02) charge = (charge + 0.005) % 1.2;   // Ladewelle wandert
    else charge = 0;                                       // unsichtbar zurücksetzen
  }

  // Wie stark ein Punkt gerade auflädt (0 = ruhig). Während des Denkens
  // trägt das GANZE Netz eine konstante Grundladung – nur eine heiße
  // Lichtfront wandert in Schleife hindurch. Sie verlässt das Bild rechts
  // weich und kommt links weich wieder herein: kein Abfall, kein Reset.
  function boostFor(x) {
    if (energy < 0.02) return 0;
    const frontX = charge * (W + 260) - 130;
    const bump = Math.exp(-Math.pow((x - frontX) / 150, 2)) * 1.1;
    return (0.35 + bump) * energy;
  }

  function linkColor(a, b, alpha) {
    const k = a.kind, l = b.kind;
    // Rot trifft Blau → die Verbindung glüht violett (Lila lebt ZWISCHEN den Farben)
    if ((k === "red" && l === "blue") || (k === "blue" && l === "red")) return `rgba(${VIOLET},${alpha})`;
    if (k === "violet" || l === "violet") return `rgba(${VIOLET},${alpha})`;
    if (k === "red" || l === "red") return `rgba(${RED},${alpha})`;
    if (k === "blue" || l === "blue") return `rgba(${BLUE},${alpha})`;
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
        const pulse = 0.65 + 0.35 * Math.sin(t * 0.0022 + a.ph + b.ph);
        const colored = a.kind !== "gray" || b.kind !== "gray";
        const boost = (boostFor(a.x) + boostFor(b.x)) / 2;
        // Farbige Verbindungen glühen kräftig, graue bleiben hauchfein
        const alpha = Math.min(0.85, ((colored ? 0.1 : 0.04) + near * (colored ? 0.4 : 0.14)) * pulse * Math.min(1.2, intensity) * (1 + boost * 1.6));
        ctx.strokeStyle = linkColor(a, b, alpha);
        ctx.lineWidth = (colored ? 0.7 : 0.5) + near * (colored ? 1.2 : 0.6) + boost * 0.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Knoten: grau dezent; rot und blau als glühende Lichtquellen (Bloom
    // durch additives Mischen – wie Licht auf schwarzem Lack)
    for (const n of nodes) {
      const boost = boostFor(n.x);
      if (n.kind === "gray") {
        ctx.fillStyle = `rgba(${GRAY},${Math.min(0.95, 0.5 + boost * 0.35)})`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * (1 + boost * 0.25), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const col = NODE_COL[n.kind];
      const deep = NODE_DEEP[n.kind];
      const p = 0.6 + 0.4 * Math.sin(t * 0.0015 + n.ph);
      const R = n.r * (3.8 + p * 2.2) * (1 + boost * 0.45);
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R);
      g.addColorStop(0, `rgba(${col},${Math.min(0.8, 0.4 * p * (1 + boost))})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(n.x, n.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(${deep},${0.8 + 0.2 * p})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (0.95 + 0.15 * p), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function step() { update(); draw(); }

  function loop(ts) {
    ts = ts || 0;
    const dt = Math.min(50, lastTs ? ts - lastTs : 16);
    lastTs = ts;
    // Energie gleitet weich zum Zielzustand; die Uhr läuft beim Denken
    // schneller – kontinuierlich, ohne Phasensprung. Das Abklingen ist
    // bewusst deutlich langsamer als das Aufladen (sanftes Ausatmen).
    energy += ((thinking ? 1 : 0) - energy) * (thinking ? 0.05 : 0.012);
    clock += dt * (1 + energy * 1.1);
    t = clock;
    step();
    raf = requestAnimationFrame(loop);
  }

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
    // Denk-Modus an/aus: Netz pulsiert stärker + Ladewelle von links nach
    // rechts. Kein hartes Zurücksetzen – energy blendet weich aus.
    think(on) { thinking = Boolean(on); },
  };
})();
