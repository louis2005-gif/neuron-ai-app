// NEURON AI – News-Radar-Modul
// Themen wie in der Wetter-App: Nachrichten sammeln, auswerten, visualisieren
// und mit dem NEURON-Sparringspartner besprechen.
"use strict";

const NeuronRadar = (() => {
  const LS_TOPICS = "neuron.radar.topics";

  const rstate = {
    topics: loadTopics(),          // {id, label, query, emoji} – label = Eingabe, query = Suchwörter
    data: {},                      // id -> {articles, errors, fetched_at, loading}
    ai: {},                        // id -> {text, model, loading, error}
    activeId: null,
    range: "7d",
    lastRefresh: null,
    started: false,
  };

  const RSUGGESTIONS = [
    { query: "Ukraine", emoji: "🇺🇦" },
    { query: "Künstliche Intelligenz", emoji: "🤖" },
    { query: "Börse", emoji: "📈" },
    { query: "Bundesliga", emoji: "⚽" },
    { query: "Klimawandel", emoji: "🌍" },
    { query: "US-Politik", emoji: "🇺🇸" },
    { query: "Nahost", emoji: "🕊️" },
    { query: "Energiepreise", emoji: "⚡" },
    { query: "Immobilien", emoji: "🏠" },
  ];
  const REMOJIS = ["📰", "🌍", "🤖", "📈", "⚽", "🏛️", "⚡", "🏠", "🎬", "🧬", "🚗", "✈️"];

  function loadTopics() {
    try { return JSON.parse(localStorage.getItem(LS_TOPICS) || "[]"); }
    catch { return []; }
  }
  function saveTopics() {
    localStorage.setItem(LS_TOPICS, JSON.stringify(rstate.topics));
  }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // Anzeigename eines Themas (ältere gespeicherte Themen haben kein label)
  function topicName(topic) { return topic.label || topic.query; }

  // Aus einer ganzen Frage/Hypothese die Suchwörter für die News-Suche ableiten;
  // kurze Schlagwort-Eingaben bleiben unverändert.
  const META_WORDS = new Set("hypothese these annahme vermutung behauptung frage fragestellung stimmt eigentlich wirklich vielleicht könnte könnten würde würden sollte sollten".split(" "));
  function deriveQuery(text) {
    const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}\-']*/gu) || [];
    if (words.length <= 3 && !/[?!.]/.test(text)) return text.trim();
    const picked = [];
    for (const w of words) {
      const lc = w.toLowerCase();
      if (lc.length < 3 || STOP.has(lc) || META_WORDS.has(lc)) continue;
      if (!picked.some((p) => p.toLowerCase() === lc)) picked.push(w);
      if (picked.length >= 5) break;
    }
    return picked.length ? picked.join(" ") : text.trim();
  }

  function relTime(ts) {
    if (!ts) return "";
    const diff = Date.now() / 1000 - ts;
    if (diff < 90) return "gerade eben";
    if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
    if (diff < 86400) return `vor ${Math.round(diff / 3600)} Std.`;
    const d = Math.round(diff / 86400);
    return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
  }

  // ---------------------------------------------------------------------------
  // Nachrichten laden: mehrere CORS-Proxys GLEICHZEITIG, erste gültige Antwort
  // gewinnt; rss2json als Rettungsanker (liefert immer, aber nur 10 Meldungen).
  // ---------------------------------------------------------------------------
  function parseRssXml(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    return [...doc.querySelectorAll("item")].map((it) => {
      const srcEl = it.querySelector("source");
      const source = srcEl ? srcEl.textContent.trim() : "";
      let title = (it.querySelector("title") ? it.querySelector("title").textContent : "").trim();
      if (source && title.endsWith("- " + source)) {
        title = title.slice(0, -("- " + source).length).replace(/[\s\-–|]+$/, "");
      }
      const link = (it.querySelector("link") ? it.querySelector("link").textContent : "").trim();
      const pub = (it.querySelector("pubDate") ? it.querySelector("pubDate").textContent : "").trim();
      const ts = pub ? Date.parse(pub) / 1000 : NaN;
      return { title, link, source, ts: isNaN(ts) ? null : ts };
    });
  }

  function fromRss2json(data) {
    if (data.status !== "ok" || !Array.isArray(data.items)) return null;
    return data.items.map((it) => {
      let title = (it.title || "").trim();
      let source = "";
      const m = title.match(/\s+-\s+([^-]{2,40})$/);
      if (m) { source = m[1].trim(); title = title.slice(0, m.index); }
      const ts = it.pubDate ? Date.parse(it.pubDate.replace(" ", "T") + "Z") / 1000 : NaN;
      return { title, link: (it.link || "").trim(), source, ts: isNaN(ts) ? null : ts };
    });
  }

  function fetchFeed(targetUrl) {
    const enc = encodeURIComponent(targetUrl);
    const attempts = [
      { u: "https://api.allorigins.win/raw?url=" + enc, kind: "raw" },
      { u: "https://api.allorigins.win/get?url=" + enc, kind: "wrapped" },
      { u: "https://api.codetabs.com/v1/proxy/?quest=" + enc, kind: "raw" },
      { u: "https://corsproxy.io/?url=" + enc, kind: "raw" },
      { u: "https://thingproxy.freeboard.io/fetch/" + targetUrl, kind: "raw" },
      { u: "https://api.rss2json.com/v1/api.json?rss_url=" + enc, kind: "rss2json" },
    ];
    return new Promise((resolve, reject) => {
      let pending = attempts.length, fallback = null, settled = false;
      const errors = [];
      const finish = () => {
        if (settled) return;
        settled = true;
        if (fallback !== null) resolve(fallback);
        else reject(errors[0] || new Error("Kein Proxy erreichbar"));
      };
      attempts.forEach(async (a) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        try {
          const resp = await fetch(a.u, { signal: ctrl.signal });
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const text = await resp.text();
          if (a.kind === "rss2json") {
            const arts = fromRss2json(JSON.parse(text));
            if (arts) fallback = arts;               // auch leer = gültiges Ergebnis
            else throw new Error("rss2json ungültig");
          } else {
            let xml = text;
            if (a.kind === "wrapped") { try { xml = JSON.parse(text).contents || ""; } catch (e) {} }
            if (!xml) throw new Error("leere Antwort");
            if (xml.indexOf("<item") === -1) {
              // Gültiger Feed ohne Treffer ist KEIN Fehler – nur ein leeres Ergebnis
              if (xml.indexOf("<rss") !== -1 || xml.indexOf("<channel") !== -1 || xml.indexOf("<feed") !== -1) {
                if (fallback === null) fallback = [];
                return;
              }
              throw new Error("ungültige Antwort");
            }
            const arts = parseRssXml(xml);
            if (!settled) { settled = true; resolve(arts); }
          }
        } catch (e) {
          errors.push(e.name === "AbortError" ? new Error("Zeitüberschreitung") : e);
        } finally {
          clearTimeout(timer);
          if (--pending === 0) finish();
        }
      });
    });
  }

  function normTitle(t) {
    // Unicode-fähig: auch arabische, chinesische, russische … Titel behalten
    // ihre Zeichen und werden korrekt dedupliziert statt verworfen
    return t.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, "").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();
  }

  // Weltweite Abdeckung: 12 Sprachräume, Meldungen bleiben im Original
  const LOCALES = [
    ["de", "DE", "DE:de"],           // Deutsch
    ["en-US", "US", "US:en"],        // Englisch
    ["fr", "FR", "FR:fr"],           // Französisch
    ["es", "ES", "ES:es"],           // Spanisch
    ["pt-BR", "BR", "BR:pt-419"],    // Portugiesisch
    ["it", "IT", "IT:it"],           // Italienisch
    ["tr", "TR", "TR:tr"],           // Türkisch
    ["ar", "EG", "EG:ar"],           // Arabisch
    ["ru", "RU", "RU:ru"],           // Russisch
    ["zh-CN", "CN", "CN:zh-Hans"],   // Chinesisch
    ["ja", "JP", "JP:ja"],           // Japanisch
    ["hi", "IN", "IN:hi"],           // Hindi
  ];

  async function collectTopic(query) {
    // Zwei Zeitfenster pro Sprachraum: das Neueste (7 Tage) und die
    // letzten 10 Jahre – zusammen ergibt das Tiefe UND Aktualität
    const past = new Date();
    past.setFullYear(past.getFullYear() - 10);
    const ranges = [" when:7d", " after:" + past.toISOString().slice(0, 10)];
    const errors = [], all = [];
    let okCount = 0;
    await Promise.all(LOCALES.flatMap(([hl, gl, ceid]) => ranges.map(async (range) => {
      const q = encodeURIComponent(query + range);
      const url = `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
      try { all.push(...await fetchFeed(url)); okCount++; }
      catch (e) { errors.push(`Google News (${hl}${range}): ${e.message}`); }
    })));
    all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    const seen = new Set(), unique = [];
    for (const a of all) {
      const k = normTitle(a.title);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      unique.push(a);
    }
    // Nur wenn WIRKLICH nichts geladen werden konnte, ist es ein Fehler –
    // einzelne fehlgeschlagene Fenster/Proxys sind normal
    return { articles: unique, errors: okCount > 0 ? [] : errors };
  }

  // ---------------------------------------------------------------------------
  // Statistik & Textanalyse
  // ---------------------------------------------------------------------------
  function computeStats(articles) {
    const now = Date.now() / 1000;
    const withTs = articles.filter((a) => a.ts);
    const last24 = withTs.filter((a) => a.ts > now - 86400).length;
    const prev24 = withTs.filter((a) => a.ts <= now - 86400 && a.ts > now - 172800).length;
    const week = withTs.filter((a) => a.ts > now - 7 * 86400).length;
    const sources = new Set(articles.map((a) => a.source).filter(Boolean)).size;
    let trend = null;
    if (prev24 > 0) trend = Math.round(((last24 - prev24) / prev24) * 100);
    else if (last24 > 0) trend = Infinity;

    const perDay = new Array(7).fill(0);
    const dayLabels = [];
    const wd = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      dayLabels.push(i === 0 ? "Heute" : wd[d.getDay()]);
    }
    withTs.forEach((a) => {
      const idx = 6 - Math.floor((now - a.ts) / 86400);
      if (idx >= 0 && idx <= 6) perDay[idx]++;
    });

    const per3h = new Array(16).fill(0);
    const hourLabels = new Array(16).fill("");
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) hourLabels[i] = new Date(Date.now() - (15 - i) * 3 * 3600000).getHours() + " Uhr";
    }
    withTs.forEach((a) => {
      const idx = 15 - Math.floor((now - a.ts) / (3 * 3600));
      if (idx >= 0 && idx <= 15) per3h[idx]++;
    });

    return { last24, prev24, week, sources, trend, perDay, dayLabels, per3h, hourLabels };
  }

  const STOP = new Set(("der die das den dem des ein eine einen einem einer eines und oder aber doch denn als wie für mit von aus bei nach vor über unter gegen ohne um an auf in im am zum zur ist sind war waren wird werden wurde wurden hat haben hatte hatten kann können soll sollen will wollen muss müssen mehr sehr auch noch nur schon jetzt heute neue neuer neues neuen nicht kein keine sich ihr ihre sein seine wegen beim vom zwischen wieder immer viele alle allen diese dieser dieses so was wer wo warum wann bis seit durch trotz laut dass weil wenn "
    + "the a an and or but for with from by at on in of to is are was were be been will would has have had can could shall should must may might more most also not no it its this that these those as about after before over under new news says said say what who where why when how their they them our your his her").split(" "));

  function analyze(query, articles) {
    const qWords = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
    const counts = new Map(), display = new Map(), perArticle = [];
    articles.forEach((a) => {
      const words = new Set();
      (a.title.match(/[\p{L}\p{N}][\p{L}\p{N}\-']*/gu) || []).forEach((w) => {
        const lc = w.toLowerCase();
        if (lc.length < 4 || STOP.has(lc) || qWords.has(lc) || /^\d+$/.test(lc)) return;
        words.add(lc);
        if (!display.has(lc) || /^[A-ZÄÖÜ]/.test(w)) display.set(lc, w);
      });
      perArticle.push(words);
      words.forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
    });
    const keywords = [...counts.entries()].filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([w, c]) => ({ word: display.get(w), key: w, count: c }));

    const clusters = [], covered = new Set();
    for (const kw of keywords) {
      const members = [];
      perArticle.forEach((words, i) => { if (words.has(kw.key)) members.push(i); });
      const fresh = members.filter((i) => !covered.has(i));
      if (fresh.length < 2 || clusters.length >= 4) continue;
      members.forEach((i) => covered.add(i));
      clusters.push({ label: kw.word, count: members.length });
    }

    const srcCounts = new Map();
    articles.forEach((a) => { if (a.source) srcCounts.set(a.source, (srcCounts.get(a.source) || 0) + 1); });
    const sources = [...srcCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([name, count]) => ({ name, count }));

    return { keywords, clusters, sources };
  }

  function autoSummary(query, stats, analysis, total) {
    const parts = [];
    parts.push(`Zum Thema „${query}" sind ${total} Meldungen aus ${stats.sources} Quellen weltweit erfasst (Zeitraum bis zu 10 Jahre) – davon ${stats.week} aus den letzten 7 Tagen und ${stats.last24} aus den letzten 24 Stunden.`);
    if (stats.trend === Infinity) parts.push("Das Thema ist neu in der Berichterstattung aufgetaucht.");
    else if (stats.trend !== null && stats.trend > 15) parts.push(`Das Nachrichtenaufkommen steigt deutlich (+${stats.trend}% gegenüber dem Vortag).`);
    else if (stats.trend !== null && stats.trend < -15) parts.push(`Das Nachrichtenaufkommen geht zurück (${stats.trend}% gegenüber dem Vortag).`);
    else if (stats.trend !== null) parts.push(`Das Nachrichtenaufkommen ist stabil (${stats.trend >= 0 ? "+" : ""}${stats.trend}%).`);
    const peak = stats.perDay.indexOf(Math.max(...stats.perDay));
    if (stats.perDay[peak] > 0) parts.push(`Der berichtsstärkste Tag war ${stats.dayLabels[peak]} mit ${stats.perDay[peak]} Meldungen.`);
    if (analysis.sources.length) {
      const s0 = analysis.sources[0];
      const share = total ? Math.round((s0.count / total) * 100) : 0;
      parts.push(`Am aktivsten berichtete ${s0.name} mit ${s0.count} Meldungen (${share}%).`);
    }
    if (analysis.keywords.length) {
      parts.push(`Häufigste Schlagwörter: ${analysis.keywords.slice(0, 5).map((k) => `${k.word} (${k.count}×)`).join(", ")}.`);
    }
    return parts.join(" ");
  }

  // ---------------------------------------------------------------------------
  // SVG-Charts
  // ---------------------------------------------------------------------------
  function sparkline(values) {
    const w = 220, h = 36, max = Math.max(...values, 1);
    const step = w / (values.length - 1);
    const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 8)).toFixed(1)}`);
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:36px">
      <polygon points="0,${h} ${pts.join(" ")} ${w},${h}" fill="rgba(229,64,47,0.14)"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="rgba(200,16,46,0.85)" stroke-width="2"/>
    </svg>`;
  }

  function hbar(items, color) {
    if (!items.length) return `<div class="radar-nodata">Zu wenig Daten</div>`;
    const w = 300, rowH = 26, h = items.length * rowH;
    const max = Math.max(...items.map((i) => i.value), 1);
    let rows = "";
    items.forEach((item, i) => {
      const y = i * rowH;
      const bw = Math.max((item.value / max) * (w - 105), 3);
      const label = item.label.length > 14 ? item.label.slice(0, 13) + "…" : item.label;
      rows += `<text x="0" y="${y + 15}" font-size="11.5" fill="#4a4d55">${esc(label)}</text>`;
      rows += `<rect x="100" y="${y + 5}" width="${bw.toFixed(1)}" height="13" rx="4" fill="${color}" opacity="${0.45 + 0.55 * (item.value / max)}"/>`;
      rows += `<text x="${(100 + bw + 6).toFixed(1)}" y="${y + 15}" font-size="11" fill="#7d828c">${item.value}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}">${rows}</svg>`;
  }

  function volumeChart(values, labels) {
    const w = 800, h = 240, padB = 28, padT = 16;
    const max = Math.max(...values, 1);
    const slot = (w - 16) / values.length;
    const barW = Math.min(slot * 0.62, 70);
    let bars = "";
    values.forEach((v, i) => {
      const bh = (v / max) * (h - padB - padT - 18);
      const x = 8 + i * slot + (slot - barW) / 2;
      const y = h - padB - bh;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(bh, 2).toFixed(1)}" rx="6" fill="#e5402f" opacity="${0.5 + 0.5 * (v / max)}"/>`;
      if (v > 0) bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="13" fill="#4a4d55">${v}</text>`;
      if (labels[i]) bars += `<text x="${(8 + i * slot + slot / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="12" fill="#7d828c">${labels[i]}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}">${bars}</svg>`;
  }

  // ---------------------------------------------------------------------------
  // Ausführliche KI-Auswertung (nutzt den NEURON-API-Key)
  // ---------------------------------------------------------------------------
  function buildReportPrompt(query, articles) {
    const now = Date.now() / 1000;
    const stats = computeStats(articles);
    const an = analyze(query, articles);
    const trendTxt = stats.trend === Infinity ? "neu aufgetaucht"
      : stats.trend == null ? "keine Vergleichsdaten"
      : `${stats.trend > 0 ? "+" : ""}${stats.trend}% gegenüber dem Vortag`;
    const peak = stats.perDay.indexOf(Math.max(...stats.perDay));

    const kennzahlen =
      `KENNZAHLEN (berechnet – nutze diese Zahlen im Bericht):\n` +
      `- Meldungen gesamt geladen (Zeitraum bis zu 10 Jahre): ${articles.length}\n` +
      `- Meldungen der letzten 7 Tage: ${stats.week}, im Schnitt ${(stats.week / 7).toFixed(1)}/Tag\n` +
      `- Letzte 24 Std.: ${stats.last24} Meldungen (Trend: ${trendTxt})\n` +
      `- Quellen: ${stats.sources}\n` +
      `- Aktivster Tag: ${stats.dayLabels[peak]} mit ${stats.perDay[peak]} Meldungen\n` +
      `- Meist berichtende Quellen: ${an.sources.map((s) => `${s.name} (${s.count})`).join(", ") || "–"}\n` +
      `- Häufigste Schlagwörter: ${an.keywords.map((k) => `${k.word} (${k.count}x)`).join(", ") || "–"}\n`;

    const lines = articles.slice(0, 150).map((a) => {
      const ageH = a.ts ? Math.floor((now - a.ts) / 3600) : null;
      const age = ageH == null ? "" : (ageH < 48 ? `vor ${ageH} Std.` : `vor ${Math.floor(ageH / 24)} Tagen`);
      return `- ${a.title} (${a.source}, ${age})`;
    });

    return `Du bist ein erfahrener Nachrichten-Analyst. Erstelle eine AUSFÜHRLICHE, faktenreiche Auswertung zum Thema "${query}" auf Deutsch – gründlich und quantitativ. Berücksichtige sowohl die NEUESTEN Erkenntnisse als auch die Entwicklung über die letzten Jahre.\n\n`
      + kennzahlen
      + `\nSCHLAGZEILEN (neueste zuerst; Zeitraum bis zu 10 Jahre; weltweite Medien in 12 Sprachen – Titel können in Originalsprache sein, werte sie inhaltlich korrekt aus und zitiere sie im Original):\n\n`
      + lines.join("\n")
      + `\n\nSchreibe eine detaillierte Auswertung mit GENAU diesen Abschnitten, jeweils mit Überschriftszeile (endend auf Doppelpunkt) gefolgt von Text bzw. Stichpunkten (mit "- "):\n\n`
      + `Überblick:\n(4-6 Sätze Gesamtlage mit konkreten Zahlen aus den Kennzahlen.)\n\n`
      + `Das Wichtigste:\n(4-5 prägnante Stichpunkte.)\n\n`
      + `Wichtigste Entwicklungen:\n(5-8 Stichpunkte, je mit kurzer Erklärung und Quelle in Klammern.)\n\n`
      + `Zahlen & Fakten:\n(10-15 Stichpunkte mit konkreten, überprüfbaren Fakten – Zahlen, Beträge, Daten, Orte, Namen, je mit Quelle in Klammern.)\n\n`
      + `Quellenlage & Perspektiven:\n(3-5 Stichpunkte: Wer berichtet wie viel, Fokus, Unterschiede DE vs. international.)\n\n`
      + `Widersprüche & offene Fragen:\n(2-5 Stichpunkte; falls keine: "- Keine offensichtlichen Widersprüche in den Schlagzeilen.")\n\n`
      + `Einordnung & Ausblick:\n(3-4 Sätze eigene, klar gekennzeichnete Einschätzung.)\n\n`
      + `Stütze Fakten nur auf Schlagzeilen und Kennzahlen, erfinde nichts. Beginne direkt mit "Überblick:".`;
  }

  async function runAiReport(topic) {
    if (!state.apiKey) {
      openSettings();
      return;
    }
    const entry = rstate.data[topic.id];
    const articles = (entry && entry.articles) || [];
    if (!articles.length) {
      rstate.ai[topic.id] = { error: "Keine Meldungen vorhanden – erst aktualisieren." };
      renderAiBox(topic);
      return;
    }
    rstate.ai[topic.id] = { loading: true };
    renderAiBox(topic);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": state.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 4096,
          messages: [{ role: "user", content: buildReportPrompt(topicName(topic), articles) }],
        }),
      });
      if (!resp.ok) {
        let msg = "HTTP " + resp.status;
        try { msg = (await resp.json()).error.message || msg; } catch (e) {}
        throw new Error(msg);
      }
      const data = await resp.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      if (!text) throw new Error("Leere Antwort");
      rstate.ai[topic.id] = { text, model: data.model || "Claude" };
    } catch (e) {
      rstate.ai[topic.id] = { error: e.message };
    }
    if (rstate.activeId === topic.id) renderAiBox(topic);
  }

  function formatReport(text) {
    let html = "", list = [];
    const flush = () => {
      if (list.length) { html += "<ul>" + list.map((l) => `<li>${esc(l)}</li>`).join("") + "</ul>"; list = []; }
    };
    text.split("\n").forEach((line) => {
      const t = line.trim().replace(/\*+/g, "");
      if (!t) return;
      if (t.startsWith("- ") || t.startsWith("• ")) list.push(t.slice(2));
      else if (t.length < 45 && t.endsWith(":")) { flush(); html += `<div class="radar-ai-h">${esc(t.slice(0, -1))}</div>`; }
      else { flush(); html += `<p>${esc(t)}</p>`; }
    });
    flush();
    return html;
  }

  function renderAiBox(topic) {
    const box = document.querySelector("#radarAiBox");
    const btn = document.querySelector("#radarAiBtn");
    const entry = rstate.ai[topic.id];
    btn.disabled = !!(entry && entry.loading);
    if (!entry) { box.classList.add("hidden"); btn.textContent = "✨ Ausführliche KI-Auswertung"; return; }
    box.classList.remove("hidden");
    if (entry.loading) {
      btn.textContent = "Auswertung läuft …";
      box.innerHTML = "<p>NEURON liest alle Schlagzeilen und erstellt die ausführliche Auswertung mit Zahlen, Fakten und Einordnung – einen Moment …</p>";
    } else if (entry.error) {
      btn.textContent = "✨ Erneut versuchen";
      box.innerHTML = `<p class="radar-err">⚠ ${esc(entry.error)}</p>`;
    } else {
      btn.textContent = "✨ Neu erstellen";
      box.innerHTML = formatReport(entry.text)
        + `<div class="radar-ai-meta">Erstellt von ${esc(entry.model)} aus ${((rstate.data[topic.id] || {}).articles || []).length} Meldungen (weltweit, bis zu 10 Jahre)</div>`;
    }
  }

  // ---------------------------------------------------------------------------
  // Daten laden & Rendering
  // ---------------------------------------------------------------------------
  async function fetchTopic(topic, force) {
    const entry = rstate.data[topic.id];
    if (entry && entry.loading) return;
    if (!force && entry && Date.now() / 1000 - entry.fetched_at < 600) return;
    rstate.data[topic.id] = { ...(entry || {}), loading: true };
    renderGrid();
    try {
      const res = await collectTopic(topic.query);
      rstate.data[topic.id] = { articles: res.articles, errors: res.errors, fetched_at: Date.now() / 1000, loading: false };
    } catch (e) {
      rstate.data[topic.id] = { ...(entry || { articles: [] }), errors: ["Laden fehlgeschlagen: " + e.message], fetched_at: Date.now() / 1000, loading: false };
    }
    rstate.lastRefresh = Date.now();
    renderGrid();
    renderUpdated();
    if (rstate.activeId === topic.id) renderDetail();
  }

  function refreshAll(force) {
    return Promise.all(rstate.topics.map((t) => fetchTopic(t, force)));
  }

  function renderUpdated() {
    document.querySelector("#radarUpdated").textContent = rstate.lastRefresh
      ? "Aktualisiert " + relTime(rstate.lastRefresh / 1000) : "Noch nicht aktualisiert";
  }

  function renderGrid() {
    const grid = document.querySelector("#radarGrid");
    const empty = document.querySelector("#radarEmpty");
    empty.classList.toggle("hidden", rstate.topics.length > 0);
    grid.innerHTML = "";
    rstate.topics.forEach((topic) => {
      const card = document.createElement("div");
      card.className = "radar-tile";
      const entry = rstate.data[topic.id];
      let body;
      if (!entry || (entry.loading && !entry.articles)) {
        body = `<div class="radar-tile-load">Lade Nachrichten …</div>`;
      } else if (!entry.articles || !entry.articles.length) {
        body = `<div class="radar-tile-load">${entry.errors && entry.errors.length ? "Fehler beim Laden" : "Keine Meldungen"}</div>`;
      } else {
        const s = computeStats(entry.articles);
        const trend = s.trend === Infinity ? `<span class="rt-up">▲ neu</span>`
          : s.trend === null ? ""
          : s.trend > 5 ? `<span class="rt-up">▲ +${s.trend}%</span>`
          : s.trend < -5 ? `<span class="rt-down">▼ ${s.trend}%</span>`
          : `<span class="rt-flat">≈ ${s.trend >= 0 ? "+" : ""}${s.trend}%</span>`;
        body = `
          <div class="radar-tile-count"><span class="countup" data-n="${s.last24}">${s.last24}</span> ${trend}</div>
          <div class="radar-tile-label">Meldungen in 24 Std.</div>
          ${sparkline(s.perDay)}
          <div class="radar-tile-headline">${esc(entry.articles[0].title)}</div>`;
      }
      card.innerHTML = `
        <div class="radar-tile-top">
          <span>${topic.emoji} <b>${esc(topicName(topic))}</b></span>
          <button class="radar-tile-x" title="Entfernen">✕</button>
        </div>${body}`;
      card.addEventListener("click", () => openDetail(topic.id));
      card.querySelector(".radar-tile-x").addEventListener("click", (e) => {
        e.stopPropagation();
        removeTopic(topic.id);
      });
      grid.appendChild(card);
    });
    runCountUps(grid);
  }

  function addTopic(input, emoji) {
    const label = (input || "").trim();
    if (!label) return;
    if (rstate.topics.some((t) => topicName(t).toLowerCase() === label.toLowerCase())) return;
    const topic = { id: uid(), label, query: deriveQuery(label), emoji: emoji || REMOJIS[rstate.topics.length % REMOJIS.length] };
    rstate.topics.push(topic);
    saveTopics();
    renderGrid();
    fetchTopic(topic, true);
  }

  function removeTopic(id) {
    rstate.topics = rstate.topics.filter((t) => t.id !== id);
    delete rstate.data[id];
    delete rstate.ai[id];
    saveTopics();
    if (rstate.activeId === id) showHome();
    renderGrid();
  }

  function showHome() {
    rstate.activeId = null;
    document.querySelector("#radarHome").classList.remove("hidden");
    document.querySelector("#radarDetail").classList.add("hidden");
    document.querySelector("#radarSources").classList.add("hidden");
    document.querySelector("#radarAddBtn").classList.remove("hidden");
  }

  function openDetail(id) {
    rstate.activeId = id;
    rstate.range = "7d";
    document.querySelector("#radarHome").classList.add("hidden");
    document.querySelector("#radarSources").classList.add("hidden");
    document.querySelector("#radarDetail").classList.remove("hidden");
    document.querySelector("#radarAddBtn").classList.add("hidden");
    renderDetail();
    document.querySelector(".radar-scroll").scrollTop = 0;
  }

  function renderDetail() {
    const topic = rstate.topics.find((t) => t.id === rstate.activeId);
    if (!topic) return;
    const entry = rstate.data[topic.id] || { articles: [], errors: [] };
    const articles = entry.articles || [];
    const s = computeStats(articles);
    const an = analyze(topic.query, articles);

    document.querySelector("#radarDetailName").textContent = `${topic.emoji} ${topicName(topic)}`;
    const trendTxt = s.trend === Infinity ? "▲ neu" : s.trend === null ? "–" : `${s.trend > 0 ? "▲ +" : s.trend < 0 ? "▼ " : "≈ "}${s.trend}%`;
    document.querySelector("#radarStats").innerHTML = `
      <div class="radar-stat"><b class="countup" data-n="${s.last24}">${s.last24}</b><span>Meldungen · 24 Std.</span></div>
      <div class="radar-stat"><b class="countup" data-n="${s.week}">${s.week}</b><span>Meldungen · 7 Tage</span></div>
      <div class="radar-stat"><b>${trendTxt}</b><span>Trend vs. Vortag</span></div>
      <div class="radar-stat"><b class="countup" data-n="${s.sources}">${s.sources}</b><span>Quellen</span></div>`;
    runCountUps(document.querySelector("#radarStats"));

    document.querySelector("#radarAutoSummary").textContent = articles.length
      ? autoSummary(topicName(topic), s, an, articles.length)
      : (entry.loading ? "Lade Nachrichten …" : "Noch keine Daten.");

    document.querySelector("#radarKeywords").innerHTML = hbar(an.keywords.map((k) => ({ label: k.word, value: k.count })), "#e5402f");
    document.querySelector("#radarClusters").innerHTML = hbar(an.clusters.map((c) => ({ label: c.label, value: c.count })), "#e08a3c");
    document.querySelector("#radarSourcesChart").innerHTML = hbar(an.sources.map((x) => ({ label: x.name, value: x.count })), "#7a5cff");
    renderAiBox(topic);

    document.querySelectorAll(".radar-range button").forEach((b) => {
      b.classList.toggle("active", b.dataset.range === rstate.range);
    });
    document.querySelector("#radarChart").innerHTML = articles.length
      ? (rstate.range === "7d" ? volumeChart(s.perDay, s.dayLabels) : volumeChart(s.per3h, s.hourLabels))
      : `<div class="radar-nodata">Keine Daten</div>`;

    const errNote = (entry.errors && entry.errors.length)
      ? `<li class="radar-err">⚠ ${esc(entry.errors.join(" · "))}</li>` : "";
    document.querySelector("#radarArticles").innerHTML = errNote + articles.slice(0, 50).map((a) => `
      <li>
        <a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a>
        <div class="radar-art-meta">${esc(a.source || "Unbekannte Quelle")} · ${relTime(a.ts)}</div>
      </li>`).join("");
    document.querySelector("#radarListTitle").textContent =
      `Neueste Meldungen (${Math.min(articles.length, 50)} von ${articles.length})`;
  }

  // Quellenverzeichnis
  function openSources() {
    document.querySelector("#radarHome").classList.add("hidden");
    document.querySelector("#radarDetail").classList.add("hidden");
    document.querySelector("#radarSources").classList.remove("hidden");
    document.querySelector("#radarAddBtn").classList.add("hidden");
    const bySource = new Map();
    let total = 0;
    rstate.topics.forEach((topic) => {
      ((rstate.data[topic.id] || {}).articles || []).forEach((a) => {
        const name = a.source || "Unbekannte Quelle";
        if (!bySource.has(name)) bySource.set(name, []);
        bySource.get(name).push({ ...a, topic: topicName(topic) });
        total++;
      });
    });
    document.querySelector("#radarSourcesSummary").textContent =
      total ? `${bySource.size} Quellen · ${total} Meldungen deiner Themen` : "Noch keine Meldungen geladen.";
    const groups = [...bySource.entries()].sort((a, b) => b[1].length - a[1].length);
    document.querySelector("#radarSourcesContent").innerHTML = groups.map(([name, arts]) => {
      arts.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const items = arts.slice(0, 12).map((a) => `
        <li><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.title)}</a>
        <div class="radar-art-meta">${esc(a.topic)} · ${relTime(a.ts)}</div></li>`).join("");
      const more = arts.length > 12 ? `<li class="radar-more">… und ${arts.length - 12} weitere</li>` : "";
      return `<details class="radar-src"><summary><span>${esc(name)}</span><span class="radar-src-n">${arts.length}</span></summary>
        <ul class="radar-articles">${items}${more}</ul></details>`;
    }).join("");
    document.querySelector(".radar-scroll").scrollTop = 0;
  }

  // Mit NEURON besprechen: eigenes Gespräch pro Thema, mit Schlagzeilen-Kontext
  function discuss(topic) {
    const name = topicName(topic);
    const entry = rstate.data[topic.id];
    const articles = (entry && entry.articles) || [];
    const lines = articles.slice(0, 30).map((a) => `- ${a.title} (${a.source || "?"}, ${relTime(a.ts)})`);
    newChat();   // startet ein neues, eigenes Gespräch (erscheint in der Seitenleiste)
    state.pendingChatTitle = `📡 ${name}`;
    state.newsContext = `Thema: ${name}\nSchlagzeilen (weltweit, neueste zuerst, teils in Originalsprache):\n${lines.join("\n")}`;
    closeSidebar();
    showChat();
    $("#input").value = `Lass uns die aktuelle Nachrichtenlage zum Thema "${name}" besprechen: Was sind die wichtigsten Entwicklungen, wie ordnest du sie ein – und wo sollte ich kritisch sein?`;
    autoGrow();
    send();
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // Zahlen ticken sichtbar hoch (Dopamin-Detail wie bei Fintech-Apps)
  function runCountUps(root) {
    if (!root) return;
    root.querySelectorAll(".countup").forEach((el) => {
      const target = parseInt(el.dataset.n, 10) || 0;
      if (target <= 0) return;
      const dur = 700, start = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = String(Math.round(target * e));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------------------------------------------------------------------------
  // Dialog & Events
  // ---------------------------------------------------------------------------
  function renderSuggestionChips() {
    ["#radarSuggestions", "#radarModalSuggestions"].forEach((sel) => {
      const box = document.querySelector(sel);
      if (!box) return;
      box.innerHTML = "";
      RSUGGESTIONS.filter((s) => !rstate.topics.some((t) => t.query === s.query)).forEach((s) => {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = `${s.emoji} ${s.query}`;
        chip.addEventListener("click", () => {
          addTopic(s.query, s.emoji);
          closeAddModal();
          renderSuggestionChips();
        });
        box.appendChild(chip);
      });
    });
  }

  function openAddModal() {
    document.querySelector("#radarTopicInput").value = "";
    renderSuggestionChips();
    document.querySelector("#radarAddModal").classList.remove("hidden");
    document.querySelector("#radarTopicInput").focus();
  }
  function closeAddModal() {
    document.querySelector("#radarAddModal").classList.add("hidden");
  }

  function bindEvents() {
    document.querySelector("#radarAddBtn").addEventListener("click", openAddModal);
    document.querySelector("#radarAddCancel").addEventListener("click", closeAddModal);
    document.querySelector("#radarAddOk").addEventListener("click", () => {
      addTopic(document.querySelector("#radarTopicInput").value);
      closeAddModal();
      renderSuggestionChips();
    });
    document.querySelector("#radarTopicInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTopic(e.target.value);
        closeAddModal();
        renderSuggestionChips();
      }
    });
    document.querySelector("#radarAddModal").addEventListener("click", (e) => {
      if (e.target.id === "radarAddModal") closeAddModal();
    });
    document.querySelector("#radarRefreshBtn").addEventListener("click", () => refreshAll(true));
    document.querySelector("#radarBackBtn").addEventListener("click", showHome);
    document.querySelector("#radarSourcesBtn").addEventListener("click", openSources);
    document.querySelector("#radarSourcesBackBtn").addEventListener("click", showHome);
    document.querySelector("#radarDeleteBtn").addEventListener("click", () => {
      const topic = rstate.topics.find((t) => t.id === rstate.activeId);
      if (topic && confirm(`Thema „${topicName(topic)}" wirklich entfernen?`)) removeTopic(topic.id);
    });
    document.querySelector("#radarAiBtn").addEventListener("click", () => {
      const topic = rstate.topics.find((t) => t.id === rstate.activeId);
      if (topic) runAiReport(topic);
    });
    document.querySelector("#radarDiscussBtn").addEventListener("click", () => {
      const topic = rstate.topics.find((t) => t.id === rstate.activeId);
      if (topic) discuss(topic);
    });
    document.querySelectorAll(".radar-range button").forEach((b) => {
      b.addEventListener("click", () => { rstate.range = b.dataset.range; renderDetail(); });
    });
    setInterval(renderUpdated, 30000);
    setInterval(() => refreshAll(true), 20 * 60000);   // alle 20 Minuten (weltweite Suche = mehr Anfragen)
  }

  // Wird beim Öffnen des Radar-Tabs aufgerufen
  function onShow() {
    if (!rstate.started) {
      rstate.started = true;
      bindEvents();
      renderSuggestionChips();
      renderGrid();
      renderUpdated();
      refreshAll(false);
    }
  }

  return { onShow };
})();

// Explizit global machen (const landet nicht automatisch auf window)
window.NeuronRadar = NeuronRadar;
