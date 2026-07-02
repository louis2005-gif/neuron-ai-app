// NEURON AI – animierter Hintergrund: STRÖMUNGSFELD
// Feine Partikel strömen wie Wind/Wasser durch ein weiches Vektorfeld und
// ziehen leuchtende Spuren. Über einer langsam ziehenden Weinrot-Aurora.
// Farben aus Mindless.pptx: Anthrazit #1C1E22, Crimson #E5402F/#C8102E/#F4604D, Weinrot #7A1A2A/#5E000C.
(function () {
  const canvas = document.getElementById("bgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const STREAK_COLORS = ["229,64,47", "200,16,46", "244,96,77", "122,26,42"]; // rgb
  const GLOW = ["#C8102E", "#7A1A2A", "#5E000C"];
  const TRAIL = 12; // Länge der Spur (Anzahl gespeicherter Punkte)

  let W = 0, H = 0, DPR = 1;
  let parts = [], blobs = [];
  let raf = null, running = false, t = 0, intensity = 1;

  const media = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const prefersReduced = () => Boolean(media && media.matches);
  const rand = (a, b) => a + Math.random() * (b - a);
  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  function config() {
    return {
      count: Math.max(20, Math.min(240, Math.round(((W * H) / 13000) * intensity))),
      speed: 1.05 * intensity,
      maxAge: 240,
    };
  }

  // Weiches, langsam driftendes Vektorfeld (billiges Pseudo-Rauschen aus Sinus-Lagen)
  function fieldAngle(x, y, tt) {
    const v =
      Math.sin(x * 0.0016 + tt) +
      Math.cos(y * 0.0019 - tt * 0.7) +
      Math.sin((x + y) * 0.0011 + tt * 0.45);
    return v * Math.PI;
  }

  function spawn(p) {
    p.x = rand(0, W);
    p.y = rand(0, H);
    p.age = rand(0, config().maxAge);
    p.hist = [];
    p.col = STREAK_COLORS[(Math.random() * STREAK_COLORS.length) | 0];
    return p;
  }

  function initParts() {
    const c = config();
    parts = [];
    for (let i = 0; i < c.count; i++) parts.push(spawn({}));
    blobs = [
      { x: 0.24, y: 0.28, s: 0.55, col: GLOW[0], ph: 0 },
      { x: 0.78, y: 0.72, s: 0.62, col: GLOW[1], ph: 2.1 },
      { x: 0.62, y: 0.16, s: 0.42, col: GLOW[2], ph: 4.3 },
    ];
    // Spuren vorbefüllen, damit schon das erste Bild „strömt“ (unabhängig von rAF-Timing)
    for (let i = 0; i < TRAIL + 4; i++) update();
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const de = document.documentElement;
    W = Math.max(canvas.clientWidth, de.clientWidth, window.innerWidth || 0, 320);
    H = Math.max(canvas.clientHeight, de.clientHeight, window.innerHeight || 0, 480);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    initParts();
    if (running) { if (prefersReduced()) seedStatic(); else draw(); }
  }

  function update() {
    const c = config();
    const tt = t * 0.00012;
    for (const p of parts) {
      const a = fieldAngle(p.x, p.y, tt);
      p.x += Math.cos(a) * c.speed;
      p.y += Math.sin(a) * c.speed;
      p.hist.push(p.x, p.y);
      if (p.hist.length > TRAIL * 2) p.hist.splice(0, 2);
      p.age += 1;
      if (p.age > c.maxAge || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
        spawn(p);
      }
    }
  }

  function drawBlobs() {
    ctx.globalCompositeOperation = "lighter";
    for (const b of blobs) {
      const cx = (b.x + 0.13 * Math.sin(t * 0.00028 + b.ph)) * W;
      const cy = (b.y + 0.11 * Math.cos(t * 0.00024 + b.ph)) * H;
      const R = Math.max(W, H) * b.s;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, hexA(b.col, 0.18 * Math.min(1.2, intensity)));
      g.addColorStop(1, hexA(b.col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawBlobs();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const p of parts) {
      const h = p.hist;
      const segs = h.length / 2 - 1;
      if (segs < 1) continue;
      for (let i = 0; i < segs; i++) {
        const a = ((i + 1) / segs) * 0.5 * Math.min(1.2, intensity); // Kopf hell, Schwanz verblasst
        ctx.strokeStyle = `rgba(${p.col},${a})`;
        ctx.lineWidth = 0.6 + (i / segs) * 1.3;
        ctx.beginPath();
        ctx.moveTo(h[i * 2], h[i * 2 + 1]);
        ctx.lineTo(h[i * 2 + 2], h[i * 2 + 3]);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function step() { update(); draw(); }

  function loop(ts) { t = ts || 0; step(); raf = requestAnimationFrame(loop); }

  function seedStatic() {
    // Statisches, aber „strömendes“ Einzelbild: Spuren erst aufbauen, dann einmal zeichnen.
    for (let i = 0; i < TRAIL + 6; i++) update();
    draw();
  }

  function start() {
    if (running) return;
    running = true;
    if (prefersReduced()) { seedStatic(); return; }
    draw();                          // sofort ein Bild zeichnen (unabhängig von rAF)
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
    setIntensity(v) { intensity = v; initParts(); if (running && prefersReduced()) seedStatic(); },
    setEnabled(on) {
      canvas.style.display = on ? "block" : "none";
      if (on) start(); else stop();
    },
  };
})();
