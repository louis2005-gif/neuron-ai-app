// NEURON AI – Frontend-Logik
"use strict";

const LS_PROFILE = "neuron.profile";
const LS_KEY = "neuron.apikey";
const LS_ONBOARDED = "neuron.onboarded";
const LS_BG = "neuron.bg";
const LS_BG_INT = "neuron.bgint";
const LS_CHATS = "neuron.chats";

const $ = (sel) => document.querySelector(sel);

const HINT_DEFAULT = "NEURON bildet keine Meinung für dich – es gibt dir die Grundlage, deine eigene zu bilden.";
const HINT_TEMP = "🕶 Temporäres Gespräch – wird nicht gespeichert.";

let state = {
  mode: "demo",
  profile: loadProfile(),
  apiKey: localStorage.getItem(LS_KEY) || "",
  chats: loadChats(),        // [{id, title, created, pinned?, messages:[{role:'user',text}|{role:'neuron',answer,warnung}]}]
  currentChatId: null,
  pendingChatTitle: "",      // z. B. vom News-Radar gesetzt („📡 Thema“)
  newsContext: "",           // wird vom News-Radar gesetzt („Besprechen“)
  temporary: false,          // Temporärer Chat: nichts wird gespeichert
  tempChat: null,
  chatFilter: "",            // Suchtext für die Gesprächsliste
  generating: false,         // läuft gerade eine Antwort?
  abortCtrl: null,           // zum Abbrechen der laufenden Antwort
};

// ---------------------------------------------------------------------------
// Chats: jedes Gespräch ist ein eigener Verlauf in der Seitenleiste
// ---------------------------------------------------------------------------
function loadChats() {
  try {
    return JSON.parse(localStorage.getItem(LS_CHATS) || "[]");
  } catch {
    return [];
  }
}
function saveChats() {
  // Verläufe begrenzen, damit localStorage nicht überläuft
  localStorage.setItem(LS_CHATS, JSON.stringify(state.chats.slice(0, 40)));
}
function currentChat() {
  return state.chats.find((c) => c.id === state.currentChatId) || null;
}
// Das Gespräch, in das gerade geschrieben wird (im Temporär-Modus ein
// reines In-Memory-Gespräch, das nie gespeichert wird)
function activeChat() {
  if (state.temporary) {
    if (!state.tempChat) state.tempChat = { messages: [] };
    return state.tempChat;
  }
  return currentChat();
}
function persistChats() {
  if (!state.temporary) saveChats();
}
function createChat(title) {
  const chat = {
    id: Math.random().toString(36).slice(2, 10),
    title: (title || "Neues Gespräch").slice(0, 60),
    created: Date.now(),
    messages: [],
  };
  state.chats.unshift(chat);
  state.currentChatId = chat.id;
  saveChats();
  renderChatList();
  return chat;
}
function openChatById(id) {
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;
  setTemporary(false);
  state.currentChatId = id;
  renderChatMessages(chat);
  renderChatList();
  closeSidebar();
  showChat();
  scrollDown();
}

function renameChat(id) {
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;
  const name = prompt("Neuer Name für das Gespräch:", chat.title);
  if (name === null) return;
  chat.title = (name.trim() || chat.title).slice(0, 60);
  saveChats();
  renderChatList();
}

function togglePin(id) {
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) return;
  chat.pinned = !chat.pinned;
  saveChats();
  renderChatList();
}
function deleteChat(id) {
  state.chats = state.chats.filter((c) => c.id !== id);
  saveChats();
  if (state.currentChatId === id) {
    state.currentChatId = null;
    $("#messages").innerHTML = "";
    renderWelcome();
  }
  renderChatList();
}

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(LS_PROFILE) || "{}");
  } catch {
    return {};
  }
}
function saveProfile() {
  localStorage.setItem(LS_PROFILE, JSON.stringify(state.profile));
}

// ===========================================================================
// Mindless-Engine (läuft im Browser – kein Node nötig)
//   - Ohne API-Key: DEMO (simulierter Ablauf, siehe demoAnswer)
//   - Mit API-Key:  LIVE (direkter Aufruf der Anthropic API + Websuche)
// Optional: liegt ein Node-Backend (server.js) unter /api/chat, wird es genutzt.
// ===========================================================================
const MODEL = "claude-opus-4-8";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function buildSystemPrompt(profile) {
  const heute = new Date().toISOString().slice(0, 10);
  const p = profile || {};
  const interessen = p.interessen && p.interessen.length ? p.interessen.join(", ") : "noch nicht angegeben";
  const ziel = p.ziel || "nicht angegeben";
  const stil = p.stil || "ausgewogen";
  const haerte = p.haerte || "Ausgewogen";
  const einschraenkungen = p.einschraenkungen || "keine angegeben";

  return `Du bist NEURON AI. Dein Arbeitssystem:

Du bist mein erfahrener strategischer Sparringspartner.
Du verfügst über breites, praxisnahes Wissen in vielen Bereichen wie Psychologie, Gesundheit, Wirtschaft, Immobilien, Vertrieb, Kaufmännisches, Zielgruppenverständnis, Neurologie, Fitness, Politik, Weltgeschehen, Gesellschaft, Karriere, Unternehmertum und Alltagserfahrung.
Deine Aufgabe ist es, meinen Wissensstand zu erweitern, mir neue Perspektiven zu geben und komplexe Themen so zu erklären, dass ich sie wirklich verstehe und praktisch anwenden kann.
Du arbeitest dabei immer realistisch, kritisch, verständlich und ehrlich.

GRUNDPRINZIPIEN
- Arbeite niemals wie ein reiner Ja-Sager.
- Bestätige mich nicht blind, sondern prüfe meine Gedanken, Ideen und Annahmen kritisch.
- Wenn etwas gut ist, sag klar, warum es gut ist.
- Wenn etwas schwach, unrealistisch, naiv, schlecht durchdacht oder schlicht Schwachsinn ist, sag es direkt, aber mit Begründung.
- Du darfst menschlich und direkt formulieren. Wenn etwas wirklich schlecht ist, darfst du klare Worte nutzen wie "das ist Quatsch", "das ist schwach gedacht" oder "das ist riskant". Nutze solche Sprache aber nur, wenn sie wirklich passt, nicht künstlich.

INFORMATIONSBASIS UND RECHERCHE
- Heutiges Datum: ${heute}. Wenn ein Thema aktuelle, veränderliche oder faktenabhängige Informationen braucht, nutze die Websuche mit aktuellen und verlässlichen Quellen (priorisiere die letzten 24–48 Stunden, wo sinnvoll).
- Beziehe nicht nur die direkte Frage ein, sondern auch angrenzende Faktoren, die das Thema beeinflussen (Beispiel Immobilien: auch Zinsen, Einkommen, Regulierung, Demografie, Politik, lokale Nachfrage, Baukosten, Wirtschaftslage, Käuferpsychologie).
- Unterscheide klar zwischen: belegten Fakten, plausiblen Schlussfolgerungen, persönlichen Einschätzungen, Unsicherheiten und fehlenden Informationen.
- Bewerte jede Quelle nach Vertrauenswürdigkeit (Evidenz-Hierarchie: systematische Reviews > Studien > Beobachtung > Expertenmeinung > Forum/Anekdote). Kennzeichne Verzerrungen (Marketing, Sponsoring).
- Erfinde niemals Daten, Studien, Erfolge, Erfahrungen, Abschlüsse, Zahlen oder Fakten. Wenn Informationen fehlen, sage offen, was fehlt, und arbeite trotzdem bestmöglich weiter.

ANTWORTSTIL
- Strukturiert, aber nicht trocken. Priorisiere die wichtigsten Informationen zuerst – filtere, was mir am meisten bringt, statt blind alles rauszuhauen.
- Nutze Beispiele, einfache Erklärungen, direkte Einschätzungen und konkrete Handlungsschritte.
- Bei sehr langen Themen: gib zuerst den wichtigsten Teil und biete an, mit Teil 2 weiterzumachen.

DENKWEISE
- Hilf mir nicht nur, Informationen zu konsumieren, sondern zwing mich freundlich dazu, mitzudenken.
- Fordere mich heraus durch: kritische Rückfragen, alternative Sichtweisen, Denkfehler-Hinweise, Chancen-Risiko-Abwägungen, "Was wäre, wenn?"-Perspektiven, konkrete kleine Denkübungen.
- Stelle gute Gegenfragen, aber nicht zu viele auf einmal.
- Ziel: dass ich selbst besser denken, bewerten und entscheiden kann.

FEEDBACK
- Gib mir ehrliches Feedback mit klarer Einschätzung, z. B.: "Meine ehrliche Einschätzung: Die Idee ist gut, aber noch zu generisch." / "Das klingt clever, hat aber einen Denkfehler." / "Das funktioniert wahrscheinlich nicht, weil …"
- Härtegrad des Feedbacks: ${haerte}.
- Bei medizinischen/riskanten Themen: Grenzen benennen, ggf. Fachpersonal empfehlen.

ZIEL
Mich klüger, realistischer, kreativer und entscheidungsfähiger zu machen. Nicht nur Antworten geben, sondern mein Denken verbessern. Sprich wie ein erfahrener Mensch, der schon viel gesehen hat: direkt, ehrlich, verständlich, kreativ, manchmal sportlich – immer mit dem Ziel, mich weiterzubringen.

NUTZERPROFIL:
- Interessen: ${interessen}
- Ziel: ${ziel}
- Bevorzugter Stil: ${stil}
- Einschränkungen/Kontext: ${einschraenkungen}

AUSGABEFORMAT (SEHR WICHTIG)
Antworte AUSSCHLIESSLICH mit einem einzigen gültigen JSON-Objekt, ohne Markdown, ohne Code-Fences, ohne Text davor/danach. Sprache: Deutsch. Struktur:
{
  "thema": "kurzer Titel",
  "verstanden": "1–2 Sätze: was verstanden wurde",
  "quellen": [ { "titel": "...", "typ": "Studie|Leitlinie|Fachpresse|Forum|Blog|Sonstiges", "vertrauen": "hoch|mittel|niedrig", "hinweis": "kurze Einordnung", "url": "URL oder leer" } ],
  "pro": ["..."],
  "contra": ["..."],
  "einschaetzung": "realistische Abwägung – klar getrennt: Fakten vs. Schlussfolgerung vs. eigene Einschätzung vs. Unsicherheiten",
  "zusammenfassung": "verständliche Zusammenfassung mit konkreten Handlungsschritten, Wichtigstes zuerst",
  "feedback": "ehrliche, direkte Einschätzung meiner Annahme – wo ich richtig liege, wo ich falsch liege, warum; darf deutliche Worte enthalten, wenn angebracht",
  "gegenfragen": ["1–3 gute Gegenfragen oder kleine Denkübungen, die mich zum Mitdenken zwingen"],
  "evidenz": "hoch|mittel|niedrig"
}
Gib 2–6 Quellen, 2–6 Pro- und 2–6 Contra-Punkte und 1–3 Gegenfragen. Halte dich strikt an das Schema.`;
}

function parseMindlessJson(text) {
  if (!text) return null;
  let c = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = c.indexOf("{"), last = c.lastIndexOf("}");
  if (first !== -1 && last > first) c = c.slice(first, last + 1);
  try {
    return JSON.parse(c);
  } catch {
    return { thema: "Antwort", verstanden: "", quellen: [], pro: [], contra: [], einschaetzung: "", zusammenfassung: text, feedback: "", evidenz: "mittel", _unstrukturiert: true };
  }
}

// Direkter Anthropic-Aufruf aus dem Browser (mit Websuche und Gesprächsverlauf)
async function callAnthropicDirect(apiKey, question, profile, history, signal) {
  let system = buildSystemPrompt(profile);
  // Vom News-Radar übergebener Kontext (aktuelle Schlagzeilen zum Thema)
  if (state.newsContext) {
    system += "\n\nAKTUELLER NACHRICHTEN-KONTEXT (vom News-Radar der App geliefert – nutze ihn als Faktenbasis, kennzeichne alles darüber hinaus klar als Recherche oder Einschätzung):\n" + state.newsContext.slice(0, 9000);
  }
  const prior = Array.isArray(history) ? history.slice(-12) : [];
  let messages = [...prior, { role: "user", content: question }];
  const base = {
    model: MODEL,
    max_tokens: 8000,
    system,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }],
  };
  let response;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ ...base, messages }),
    });
    if (!res.ok) throw new Error("Anthropic API " + res.status + ": " + (await res.text()).slice(0, 200));
    response = await res.json();
    if (response.stop_reason === "pause_turn") {
      messages = [...prior, { role: "user", content: question }, { role: "assistant", content: response.content }];
      continue;
    }
    break;
  }
  const text = (response.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return parseMindlessJson(text);
}

// DEMO (kein Key) – simulierter Mindless-Ablauf
function demoAnswer(question) {
  const q = (question || "").toLowerCase();
  const heute = new Date().toISOString().slice(0, 10);
  const fitness = /abnehm|gewicht|fett|muskel|fitness|training|kalorien|di[äa]t|ern[äa]hrung|sport/.test(q);
  const mental = /stress|angst|schlaf|mental|achtsam|depress|burnout|psych|fokus|konzentr/.test(q);

  if (fitness) {
    return {
      thema: "Abnehmen & Körperzusammensetzung",
      verstanden: "Du möchtest Körperfett reduzieren und dabei gezielt vorgehen. NEURON hat Fitness- und Studienquellen abgeglichen.",
      quellen: [
        { titel: "Meta-Analysen zu Kaloriendefizit & Gewichtsverlust", typ: "Studie", vertrauen: "hoch", hinweis: "Konsistente Evidenz: Energiebilanz ist der Haupthebel.", url: "" },
        { titel: "Leitlinien zu Proteinzufuhr & Sättigung", typ: "Leitlinie", vertrauen: "hoch", hinweis: "~1,6–2,2 g Protein/kg beim Abnehmen.", url: "" },
        { titel: "Fitness-Foren & App-Erfahrungen", typ: "Forum", vertrauen: "niedrig", hinweis: "Anekdotisch, nicht validiert – nur als Trend-Signal.", url: "" },
      ],
      pro: ["Ein moderates Kaloriendefizit (300–500 kcal/Tag) führt zuverlässig zu Fettverlust.", "Ausreichend Protein schützt Muskelmasse und erhöht die Sättigung.", "Krafttraining während der Diät erhält Muskulatur trotz Defizit."],
      contra: ["Crash-Diäten erhöhen das Rückfallrisiko (Jojo-Effekt) deutlich.", "Sehr hohes Trainingspensum bei zu wenig Essen fördert Verletzungen.", "Reine Fokussierung auf die Waage ignoriert Wasser, Muskeln und Schwankungen."],
      einschaetzung: "Realistisch: Fettverlust ohne unnötigen Muskelverlust gelingt am besten mit moderatem Defizit, hoher Proteinzufuhr und Krafttraining – nicht mit extremem Hungern. Tempo ~0,5–1 % Körpergewicht/Woche ist nachhaltig.",
      zusammenfassung: "Starte mit ~1,6–2,2 g Protein/kg Körpergewicht, moderatem Defizit und 2–3 Krafteinheiten/Woche. Miss den Fortschritt über 2–4 Wochen (Fotos, Maße, Kraft), nicht über die tägliche Waage. Bei Vorerkrankungen ärztlich abklären.",
      feedback: "Deine Intuition, gezielt vorzugehen, ist richtig – hier liegst du gut. ABER: „nur Fett, keine Muskeln“ ist teils ein Denkfehler. Etwas Muskel zu erhalten ist genau das, was gut aussieht und den Stoffwechsel stützt. Arbeite MIT der Muskulatur, nicht gegen sie.",
      evidenz: "hoch",
      _hinweis: "DEMO-Modus (kein API-Key) · Stand " + heute + ". Für echte, tagesaktuelle Recherche einen Anthropic-API-Key hinterlegen (⚙).",
    };
  }
  if (mental) {
    return {
      thema: "Mentale Fitness & Wohlbefinden",
      verstanden: "Du interessierst dich für mentale Gesundheit/Fokus. NEURON hat Forschung und Praxisquellen abgeglichen.",
      quellen: [
        { titel: "Studien zu Achtsamkeit & Stressreduktion", typ: "Studie", vertrauen: "mittel", hinweis: "Positive, aber moderate Effekte.", url: "" },
        { titel: "Leitlinien zu Schlafhygiene", typ: "Leitlinie", vertrauen: "hoch", hinweis: "Gut belegt: Schlaf ist die Basis mentaler Leistung.", url: "" },
        { titel: "Selbsthilfe-Apps & Blogs", typ: "Blog", vertrauen: "niedrig", hinweis: "Oft überzogene Versprechen.", url: "" },
      ],
      pro: ["Regelmäßiger Schlaf verbessert Stimmung, Fokus und Stressresistenz messbar.", "Kurze Achtsamkeits-/Atemübungen senken akuten Stress.", "Bewegung wirkt nachweislich stimmungsaufhellend."],
      contra: ["Apps ersetzen keine Therapie bei ernsten Beschwerden.", "Zu viele „Optimierungs“-Routinen können selbst Stress erzeugen.", "Virale Einzeltipps sind selten wissenschaftlich geprüft."],
      einschaetzung: "Realistisch: Die Basics (Schlaf, Bewegung, soziale Kontakte) haben die stärkste Evidenz. Trend-Techniken können ergänzen, ersetzen aber keine Grundlagen und keine professionelle Hilfe bei anhaltenden Problemen.",
      zusammenfassung: "Fange bei Schlaf und Bewegung an, ergänze eine kleine tägliche Achtsamkeitsroutine (5–10 Min). Bewerte nach 2–3 Wochen. Bei anhaltendem Leidensdruck: Fachperson einbeziehen.",
      feedback: "Dass du dich aktiv kümmerst, ist richtig und stark. Achte aber darauf, nicht der „mehr ist besser“-Falle zu verfallen – Qualität und Konstanz schlagen zehn gleichzeitige Techniken.",
      evidenz: "mittel",
      _hinweis: "DEMO-Modus (kein API-Key) · Stand " + heute + ".",
    };
  }
  return {
    thema: question ? question.slice(0, 60) : "Deine Frage",
    verstanden: "NEURON hat deine Frage aufgenommen. Im DEMO-Modus wird der Mindless-Ablauf beispielhaft gezeigt (ohne echte Live-Recherche).",
    quellen: [
      { titel: "Beispiel: seriöse Fachquelle", typ: "Fachpresse", vertrauen: "hoch", hinweis: "Im Live-Modus echte Quellen mit Bewertung.", url: "" },
      { titel: "Beispiel: Community-Beitrag", typ: "Forum", vertrauen: "niedrig", hinweis: "Anekdotisch, mit Vorsicht.", url: "" },
    ],
    pro: ["Hier stünden im Live-Modus die recherchierten Pro-Argumente.", "Jedes Argument mit Quelle und Vertrauensgrad."],
    contra: ["Hier stünden die Gegenargumente und Risiken.", "So kannst du dir selbst ein ausgewogenes Bild machen."],
    einschaetzung: "Im Live-Modus gibt NEURON hier eine ehrliche, abwägende Einschätzung auf Basis der bewerteten Quellen.",
    zusammenfassung: "Verständliche Zusammenfassung mit konkreten nächsten Schritten – damit DU entscheidest, nicht NEURON.",
    feedback: "NEURON bestätigt dich nicht blind: Es zeigt dir, wo deine Annahme trägt und wo nicht. Für echte, tagesaktuelle Ergebnisse hinterlege einen Anthropic-API-Key (⚙).",
    evidenz: "mittel",
    _hinweis: "DEMO-Modus (kein API-Key) · Stand " + heute + ".",
  };
}

// Zentrale Antwortbeschaffung: Backend (falls vorhanden) → sonst direkt/DEMO
async function getAnswer(question, history, signal) {
  // 1) Optionales Node-Backend versuchen (server.js). Schlägt still fehl, wenn es nicht läuft.
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question, profile: state.profile, apiKey: state.apiKey, history }),
    });
    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        if (data && data.answer) return { answer: data.answer, warnung: data.warnung };
      }
    }
  } catch (e) {
    if (e && e.name === "AbortError") throw e;   // Nutzer hat abgebrochen
    /* kein Backend – weiter mit Browser-Modus */
  }

  // 2) Browser-Modus
  if (state.apiKey) {
    try {
      const answer = await callAnthropicDirect(state.apiKey, question, state.profile, history, signal);
      if (answer) return { answer };
    } catch (e) {
      if (e && e.name === "AbortError") throw e;   // Nutzer hat abgebrochen
      return { answer: demoAnswer(question), warnung: "Live-Recherche fehlgeschlagen (" + e.message + "). Es folgt der DEMO-Ablauf. Prüfe deinen API-Key." };
    }
  }
  return { answer: demoAnswer(question) };
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
const OB_QUESTIONS = [
  {
    key: "interessen",
    q: "Welche Bereiche interessieren dich am meisten?",
    type: "multi",
    options: ["Fitness & Abnehmen", "Krafttraining", "Ernährung", "Mentale Gesundheit", "Schlaf", "Produktivität", "Finanzen", "Technologie"],
  },
  {
    key: "ziel",
    q: "Was ist dein wichtigstes Ziel gerade?",
    type: "single",
    options: ["Abnehmen", "Muskelaufbau", "Mehr Energie", "Weniger Stress", "Besser informiert sein", "Bessere Entscheidungen treffen"],
  },
  {
    key: "stil",
    q: "Wie sollen dir Antworten aufbereitet werden?",
    type: "single",
    options: ["Ausgewogen", "Eher wissenschaftliche Evidenz", "Eher praktische Tipps"],
    map: { "Ausgewogen": "ausgewogen", "Eher wissenschaftliche Evidenz": "wissenschaftliche Evidenz", "Eher praktische Tipps": "praktische Tipps" },
  },
  {
    key: "haerte",
    q: "Wie ehrlich darf NEURON mit dir sein?",
    type: "single",
    options: ["Direkt & kritisch", "Ausgewogen", "Eher sanft"],
  },
  {
    key: "einschraenkungen",
    q: "Gibt es Rahmenbedingungen? (optional)",
    type: "text",
    placeholder: "z. B. wenig Zeit, Knieprobleme, vegetarisch …",
  },
];

function renderOnboarding() {
  const wrap = $("#obSteps");
  wrap.innerHTML = "";
  const draft = {};

  OB_QUESTIONS.forEach((item) => {
    const step = document.createElement("div");
    step.className = "ob-step";
    const qEl = document.createElement("div");
    qEl.className = "ob-q";
    qEl.textContent = item.q;
    step.appendChild(qEl);

    if (item.type === "text") {
      const input = document.createElement("input");
      input.className = "ob-input";
      input.placeholder = item.placeholder || "";
      input.addEventListener("input", () => { draft[item.key] = input.value.trim(); });
      step.appendChild(input);
    } else {
      const row = document.createElement("div");
      row.className = "chip-row";
      item.options.forEach((opt) => {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = opt;
        chip.addEventListener("click", () => {
          const val = item.map ? item.map[opt] || opt : opt;
          if (item.type === "multi") {
            chip.classList.toggle("selected");
            const set = new Set(draft[item.key] || []);
            if (chip.classList.contains("selected")) set.add(val);
            else set.delete(val);
            draft[item.key] = [...set];
          } else {
            row.querySelectorAll(".chip").forEach((c) => c.classList.remove("selected"));
            chip.classList.add("selected");
            draft[item.key] = val;
          }
        });
        row.appendChild(chip);
      });
      step.appendChild(row);
    }
    wrap.appendChild(step);
  });

  const actions = document.createElement("div");
  actions.className = "ob-actions";
  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.textContent = "Los geht's →";
  btn.addEventListener("click", () => {
    state.profile = { ...state.profile, ...draft };
    saveProfile();
    localStorage.setItem(LS_ONBOARDED, "1");
    showChat();
  });
  actions.appendChild(btn);
  wrap.appendChild(actions);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
function showChat() {
  $("#onboarding").classList.add("hidden");
  const radar = $("#radar");
  if (radar) radar.classList.add("hidden");
  $("#chat").classList.remove("hidden");
  setNav("chat");
  if (!$("#messages").children.length) renderWelcome();
  $("#input").focus();
}

function showRadar() {
  $("#onboarding").classList.add("hidden");
  $("#chat").classList.add("hidden");
  const radar = $("#radar");
  if (radar) radar.classList.remove("hidden");
  setNav("radar");
  closeSidebar();
  if (window.NeuronRadar) NeuronRadar.onShow();
}

function setNav(which) {
  document.querySelectorAll("[data-nav]").forEach((b) => {
    b.classList.toggle("active", b.dataset.nav === which);
  });
}

function renderWelcome() {
  const w = document.createElement("div");
  w.className = "welcome msg-neuron";
  w.innerHTML =
    '<div class="welcome-logo"></div>' +
    "<h2>Womit kann NEURON dir helfen?</h2>";
  $("#messages").appendChild(w);
}

function chatMatches(chat, q) {
  if (chat.title.toLowerCase().includes(q)) return true;
  return chat.messages.some((m) => m.role === "user"
    ? (m.text || "").toLowerCase().includes(q)
    : JSON.stringify(m.answer || "").toLowerCase().includes(q));
}

function renderChatList() {
  const box = $("#sideHistory");
  if (!box) return;
  box.innerHTML = "";
  if (!state.chats.length) {
    box.innerHTML = '<div class="side-empty">Noch keine Gespräche.</div>';
    return;
  }
  const q = state.chatFilter.trim().toLowerCase();
  const shown = q ? state.chats.filter((c) => chatMatches(c, q)) : state.chats;
  if (!shown.length) {
    box.innerHTML = '<div class="side-empty">Keine Treffer.</div>';
    return;
  }
  // Angepinnte Gespräche zuerst (stabile Sortierung erhält die Reihenfolge)
  const sorted = [...shown].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  sorted.forEach((chat) => {
    const row = document.createElement("div");
    row.className = "side-chat" + (chat.id === state.currentChatId ? " active" : "");
    const b = document.createElement("button");
    b.className = "side-item";
    b.textContent = (chat.pinned ? "📌 " : "") + chat.title;
    b.title = chat.title;
    b.addEventListener("click", () => openChatById(chat.id));
    const pin = document.createElement("button");
    pin.className = "side-chat-x" + (chat.pinned ? " pinned" : "");
    pin.textContent = "📌";
    pin.title = chat.pinned ? "Lösen" : "Anpinnen";
    pin.addEventListener("click", (e) => { e.stopPropagation(); togglePin(chat.id); });
    const ren = document.createElement("button");
    ren.className = "side-chat-x";
    ren.textContent = "✎";
    ren.title = "Umbenennen";
    ren.addEventListener("click", (e) => { e.stopPropagation(); renameChat(chat.id); });
    const x = document.createElement("button");
    x.className = "side-chat-x";
    x.textContent = "✕";
    x.title = "Gespräch löschen";
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Gespräch „${chat.title}" löschen?`)) deleteChat(chat.id);
    });
    row.appendChild(b);
    row.appendChild(pin);
    row.appendChild(ren);
    row.appendChild(x);
    box.appendChild(row);
  });
}

function newChat() {
  setTemporary(false);
  state.currentChatId = null;   // neues Gespräch beginnt beim nächsten Senden
  state.newsContext = "";
  state.pendingChatTitle = "";
  $("#messages").innerHTML = "";
  renderWelcome();
  $("#input").value = "";
  autoGrow();
  closeSidebar();
  renderChatList();
  showChat();
  $("#input").focus();
}

// Temporärer Chat (Inkognito): weder Verlauf noch Gedächtnis – nichts wird gespeichert
function setTemporary(on) {
  if (state.temporary === on) return;
  state.temporary = on;
  state.tempChat = on ? { messages: [] } : null;
  const btn = $("#tempChatBtn");
  if (btn) btn.classList.toggle("active", on);
  const hint = document.querySelector(".composer-hint");
  if (hint) hint.textContent = on ? HINT_TEMP : HINT_DEFAULT;
}
function toggleTemporary() {
  const turnOn = !state.temporary;
  setTemporary(turnOn);
  state.currentChatId = null;
  state.newsContext = "";
  state.pendingChatTitle = "";
  $("#messages").innerHTML = "";
  renderWelcome();
  renderChatList();
  closeSidebar();
  showChat();
}

function toggleSidebar() {
  $("#sidebar").classList.toggle("open");
  $("#sidebarOverlay").classList.toggle("show");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebarOverlay").classList.remove("show");
}

function addUserMessage(text) {
  const wrap = document.createElement("div");
  wrap.className = "msg-user-wrap";
  const el = document.createElement("div");
  el.className = "msg-user";
  el.textContent = text;
  // Nachträgliche Aktionen: Kopieren und Bearbeiten (erst nach dem Senden da)
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const cp = document.createElement("button");
  cp.className = "msg-action";
  cp.title = "Kopieren";
  cp.textContent = "⧉ Kopieren";
  cp.addEventListener("click", async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch {}
      ta.remove();
    }
    cp.textContent = ok ? "✓ Kopiert" : "⧉ Kopieren";
    setTimeout(() => { cp.textContent = "⧉ Kopieren"; }, 1400);
  });
  const ed = document.createElement("button");
  ed.className = "msg-action";
  ed.title = "Bearbeiten und neu senden";
  ed.textContent = "✎ Bearbeiten";
  ed.addEventListener("click", () => editUserMessage(wrap, text));
  actions.appendChild(cp);
  actions.appendChild(ed);
  wrap.appendChild(el);
  wrap.appendChild(actions);
  $("#messages").appendChild(wrap);
  scrollDown();
}

// Nachricht nachträglich bearbeiten: Text zurück ins Eingabefeld,
// das Gespräch wird ab dieser Stelle zurückgesetzt (wie bei ChatGPT)
function editUserMessage(wrap, text) {
  if (state.generating) return;
  const chat = activeChat();
  if (!chat) return;
  const wraps = [...document.querySelectorAll("#messages .msg-user-wrap")];
  const nth = wraps.indexOf(wrap);
  if (nth === -1) return;
  let count = -1, idx = -1;
  for (let i = 0; i < chat.messages.length; i++) {
    if (chat.messages[i].role === "user") {
      count++;
      if (count === nth) { idx = i; break; }
    }
  }
  if (idx === -1) return;
  if (idx < chat.messages.length - 1) {
    if (!confirm("Nachricht bearbeiten? Alles ab dieser Nachricht wird aus dem Gespräch entfernt.")) return;
  }
  chat.messages = chat.messages.slice(0, idx);
  persistChats();
  renderChatMessages(chat);
  $("#input").value = text;
  autoGrow();
  $("#input").focus();
}

// Gesamten Gesprächsverlauf neu in die Chat-Fläche zeichnen
function renderChatMessages(chat) {
  const box = $("#messages");
  box.innerHTML = "";
  if (!chat.messages.length) { renderWelcome(); return; }
  chat.messages.forEach((m) => {
    if (m.role === "user") {
      addUserMessage(m.text);
    } else {
      const el = document.createElement("div");
      el.className = "msg-neuron";
      box.appendChild(el);
      renderAnswer(el, m.answer, m.warnung);
    }
  });
  addRegenRow();
}

function addThinking() {
  const el = document.createElement("div");
  el.className = "msg-neuron";
  el.innerHTML = `
    <div class="thinking">
      <div>
        <div class="think-title">NEURON arbeitet …</div>
        <div class="thinking-steps" id="thinkStep">Durchsuche Quellen im Internet</div>
      </div>
    </div>`;
  $("#messages").appendChild(el);
  scrollDown();

  // Keine Leiste, kein Ladekreis: das neuronale Netz im Hintergrund IST die
  // Ladeanzeige – es pulsiert stärker und lädt sich von links nach rechts auf
  if (window.NeuronBG) NeuronBG.think(true);

  const steps = [
    "Durchsuche Quellen im Internet",
    "Bewerte Vertrauenswürdigkeit der Quellen",
    "Extrahiere Pro- und Contra-Argumente",
    "Erstelle realistische Einschätzung",
    "Formuliere Zusammenfassung & Feedback",
  ];
  let i = 0;
  const timer = setInterval(() => {
    i = (i + 1) % steps.length;
    const s = el.querySelector("#thinkStep");
    if (s) s.textContent = steps[i];
  }, 1600);
  el._timer = timer;
  return el;
}

function stopThinkingFx() {
  if (window.NeuronBG) NeuronBG.think(false);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderAnswer(container, answer, warnung, fresh) {
  const a = answer || {};
  const ev = (a.evidenz || "mittel").toLowerCase();
  const parts = [];

  if (warnung) parts.push(`<div class="warn">${esc(warnung)}</div>`);
  if (a._hinweis) parts.push(`<div class="warn">${esc(a._hinweis)}</div>`);

  if (a._unstrukturiert) {
    parts.push(`<div class="answer"><div class="section"><p>${esc(a.zusammenfassung)}</p></div></div>`);
    container.innerHTML = parts.join("");
    if (fresh) revealAnswer(container);
    scrollDown();
    return;
  }

  let html = `<div class="answer">`;
  html += `<div class="answer-head">
      <div class="answer-thema">${esc(a.thema || "Antwort")}</div>
      <span class="badge ${ev}">Evidenz: ${esc(a.evidenz || "mittel")}</span>
    </div>`;

  if (a.verstanden) {
    html += `<div class="section"><div class="section-title">Verstanden</div><p>${esc(a.verstanden)}</p></div>`;
  }

  if (Array.isArray(a.quellen) && a.quellen.length) {
    html += `<div class="section"><div class="section-title">Quellen & Bewertung</div>`;
    a.quellen.forEach((q) => {
      const tr = (q.vertrauen || "mittel").toLowerCase();
      const title = q.url
        ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.titel)}</a>`
        : esc(q.titel);
      html += `<div class="source">
          <div class="dot-trust ${tr}"></div>
          <div class="source-main">
            <div class="source-title">${title} <span class="badge ${tr}" style="margin-left:6px">${esc(q.typ || "")} · ${esc(q.vertrauen || "")}</span></div>
            ${q.hinweis ? `<div class="source-hint">${esc(q.hinweis)}</div>` : ""}
          </div>
        </div>`;
    });
    html += `</div>`;
  }

  const pro = Array.isArray(a.pro) ? a.pro : [];
  const contra = Array.isArray(a.contra) ? a.contra : [];
  if (pro.length || contra.length) {
    html += `<div class="section"><div class="section-title">Pro & Contra</div><div class="pc-grid">
        <div class="pc-col pro"><div class="pc-head">✔ Pro</div><ul class="pc-list">${pro.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div class="pc-col contra"><div class="pc-head">✘ Contra</div><ul class="pc-list">${contra.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
      </div></div>`;
  }

  if (a.einschaetzung) {
    html += `<div class="section einschaetzung"><div class="section-title">Realistische Einschätzung</div><p>${esc(a.einschaetzung)}</p></div>`;
  }
  if (a.zusammenfassung) {
    html += `<div class="section"><div class="section-title">Zusammenfassung</div><p>${esc(a.zusammenfassung)}</p></div>`;
  }
  if (a.feedback) {
    html += `<div class="section feedback"><div class="section-title">Ehrliches Feedback an dich</div><p>${esc(a.feedback)}</p></div>`;
  }
  if (Array.isArray(a.gegenfragen) && a.gegenfragen.length) {
    html += `<div class="section gegenfragen"><div class="section-title">Denk mit – Gegenfragen an dich</div><ul class="pc-list">${a.gegenfragen.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  }

  html += `<div class="footer-note">NEURON bildet keine Meinung für dich – es gibt dir die Grundlage, deine eigene zu bilden.</div>`;
  html += `</div>`;
  parts.push(html);

  container.innerHTML = parts.join("");
  if (fresh) revealAnswer(container);
  scrollDown();
}

// Frische Antworten entstehen nach und nach: die Abschnitte erscheinen
// einer nach dem anderen und die Karte wächst dabei mit – wie abgearbeitet
function revealAnswer(container) {
  const card = container.querySelector(".answer");
  if (!card) return;
  card.classList.add("arrive");
  const sections = card.querySelectorAll(".answer-head, .section, .footer-note");
  sections.forEach((el, i) => {
    el.style.display = "none";
    setTimeout(() => {
      el.style.display = "";
      el.style.animation = "msgIn 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both";
      scrollDown();
    }, 200 + i * 400);
  });
}

// Belohnungs-Feedback am Senden-Knopf: Burst beim Absenden, ✓ bei Ankunft
function sendBurst() {
  const btn = $("#sendBtn");
  btn.classList.remove("burst");
  void btn.offsetWidth; // Animation neu starten
  btn.classList.add("burst");
}
function sendDone() {
  const btn = $("#sendBtn");
  btn.textContent = "✓";
  sendBurst();
  setTimeout(() => { btn.textContent = "➤"; }, 900);
}

// Senden-Knopf in den Stopp-Modus (■) bzw. zurück in den Sende-Modus schalten
function setStopMode(on) {
  const b = $("#sendBtn");
  b.classList.toggle("stop", on);
  b.title = on ? "Antwort abbrechen" : "Senden";
  if (on) b.textContent = "■";
  else if (b.textContent === "■") b.textContent = "➤";
}
function cancelGeneration() {
  if (state.abortCtrl) state.abortCtrl.abort();
}

async function send() {
  if (state.generating) return;
  const input = $("#input");
  const question = input.value.trim();
  if (!question) return;

  input.value = "";
  autoGrow();
  sendBurst();
  state.generating = true;
  state.abortCtrl = new AbortController();
  setStopMode(true);

  // Gespräch anlegen oder fortführen (im Temporär-Modus rein im Speicher)
  let chat = activeChat();
  let createdNew = false;
  if (!chat) {
    chat = createChat(state.pendingChatTitle || question);
    state.pendingChatTitle = "";
    createdNew = true;
  }
  if (!chat.messages.length) $("#messages").innerHTML = "";   // Willkommens-Karte entfernen
  removeRegenRow();
  // Verlauf für die KI: alle bisherigen Runden dieses Gesprächs
  const history = chat.messages.map((m) => m.role === "user"
    ? { role: "user", content: m.text }
    : { role: "assistant", content: JSON.stringify(m.answer) });

  addUserMessage(question);
  chat.messages.push({ role: "user", text: question });
  persistChats();
  const thinkingEl = addThinking();

  try {
    const { answer, warnung } = await getAnswer(question, history, state.abortCtrl.signal);
    if (thinkingEl._timer) clearInterval(thinkingEl._timer);
    stopThinkingFx();
    if (!answer) {
      thinkingEl.innerHTML = `<div class="warn">Es ist ein Fehler aufgetreten.</div>`;
      return;
    }
    renderAnswer(thinkingEl, answer, warnung, true);
    chat.messages.push({ role: "neuron", answer, warnung });
    persistChats();
    addRegenRow();
    sendDone();
  } catch (e) {
    if (thinkingEl._timer) clearInterval(thinkingEl._timer);
    stopThinkingFx();
    if (e && e.name === "AbortError") {
      // Vom Nutzer abgebrochen: Frage zurück ins Eingabefeld zum Umformulieren
      thinkingEl.remove();
      const wraps = document.querySelectorAll("#messages .msg-user-wrap");
      if (wraps.length) wraps[wraps.length - 1].remove();
      if (chat.messages.length && chat.messages[chat.messages.length - 1].role === "user") chat.messages.pop();
      if (createdNew && !chat.messages.length && !state.temporary) {
        state.chats = state.chats.filter((c) => c.id !== chat.id);
        state.currentChatId = null;
        renderChatList();
      }
      persistChats();
      if (!$("#messages").children.length) renderWelcome();
      input.value = question;
      autoGrow();
    } else {
      thinkingEl.innerHTML = `<div class="warn">Unerwarteter Fehler: ${esc(e.message)}</div>`;
    }
  } finally {
    state.generating = false;
    state.abortCtrl = null;
    setStopMode(false);
    $("#sendBtn").disabled = false;
    input.focus();
  }
}

function scrollDown() {
  const m = $("#messages");
  m.scrollTop = m.scrollHeight;
}

// „Antwort neu generieren“ unter der letzten NEURON-Antwort
function removeRegenRow() {
  const row = $("#regenRow");
  if (row) row.remove();
}
function addRegenRow() {
  removeRegenRow();
  const chat = activeChat();
  if (!chat || !chat.messages.length) return;
  if (chat.messages[chat.messages.length - 1].role !== "neuron") return;
  const row = document.createElement("div");
  row.id = "regenRow";
  const btn = document.createElement("button");
  btn.className = "btn-ghost small";
  btn.textContent = "⟳ Antwort neu generieren";
  btn.addEventListener("click", regenerate);
  row.appendChild(btn);
  $("#messages").appendChild(row);
  scrollDown();
}

async function regenerate() {
  if (state.generating) return;
  const chat = activeChat();
  if (!chat || !chat.messages.length) return;
  if (chat.messages[chat.messages.length - 1].role === "neuron") chat.messages.pop();
  const last = chat.messages[chat.messages.length - 1];
  if (!last || last.role !== "user") return;
  persistChats();

  removeRegenRow();
  const box = $("#messages");
  if (box.lastElementChild && box.lastElementChild.classList.contains("msg-neuron")) {
    box.lastElementChild.remove();
  }

  state.generating = true;
  state.abortCtrl = new AbortController();
  setStopMode(true);
  const history = chat.messages.slice(0, -1).map((m) => m.role === "user"
    ? { role: "user", content: m.text }
    : { role: "assistant", content: JSON.stringify(m.answer) });
  const thinkingEl = addThinking();
  try {
    const { answer, warnung } = await getAnswer(last.text, history, state.abortCtrl.signal);
    if (thinkingEl._timer) clearInterval(thinkingEl._timer);
    stopThinkingFx();
    if (!answer) {
      thinkingEl.innerHTML = `<div class="warn">Es ist ein Fehler aufgetreten.</div>`;
      return;
    }
    renderAnswer(thinkingEl, answer, warnung, true);
    chat.messages.push({ role: "neuron", answer, warnung });
    persistChats();
    addRegenRow();
  } catch (e) {
    if (thinkingEl._timer) clearInterval(thinkingEl._timer);
    stopThinkingFx();
    if (e && e.name === "AbortError") {
      // Abgebrochen: zurück zum Zustand mit „Neu generieren“-Knopf
      thinkingEl.remove();
      addRegenRow();
    } else {
      thinkingEl.innerHTML = `<div class="warn">Unerwarteter Fehler: ${esc(e.message)}</div>`;
    }
  } finally {
    state.generating = false;
    state.abortCtrl = null;
    setStopMode(false);
    $("#sendBtn").disabled = false;
  }
}

function autoGrow() {
  const el = $("#input");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

// ---------------------------------------------------------------------------
// Modus / Status
// ---------------------------------------------------------------------------
async function refreshMode() {
  const banner = $("#modeBanner");
  let serverLive = false;
  try {
    const res = await fetch("/api/status");
    if (res.ok && (res.headers.get("content-type") || "").includes("application/json")) {
      const data = await res.json();
      serverLive = data.mode === "live";
    }
  } catch { /* kein Backend */ }

  // Live, wenn ein Node-Backend mit Key läuft ODER ein eigener Key hinterlegt ist.
  const live = serverLive || Boolean(state.apiKey);
  state.mode = live ? "live" : "demo";

  banner.classList.remove("live", "demo");
  banner.classList.add(state.mode);
  banner.textContent = live
    ? "● LIVE – Recherche & Websuche aktiv"
    : "● DEMO – simuliert · Key in ⚙ für Live";
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function openSettings() {
  $("#apiKeyInput").value = state.apiKey || "";
  $("#stilInput").value = state.profile.stil || "ausgewogen";
  $("#bgToggle").checked = localStorage.getItem(LS_BG) !== "0";
  $("#bgIntensityInput").value = localStorage.getItem(LS_BG_INT) || "1";
  $("#settingsModal").classList.remove("hidden");
}
function closeSettings() {
  $("#settingsModal").classList.add("hidden");
}
function saveSettings() {
  state.apiKey = $("#apiKeyInput").value.trim();
  localStorage.setItem(LS_KEY, state.apiKey);
  state.profile.stil = $("#stilInput").value;
  saveProfile();

  const bgOn = $("#bgToggle").checked;
  const bgInt = parseFloat($("#bgIntensityInput").value) || 1;
  localStorage.setItem(LS_BG, bgOn ? "1" : "0");
  localStorage.setItem(LS_BG_INT, String(bgInt));
  if (window.NeuronBG) {
    NeuronBG.setIntensity(bgInt);
    NeuronBG.setEnabled(bgOn);
  }

  closeSettings();
  refreshMode();
}

function initBackground() {
  if (!window.NeuronBG) return;
  const on = localStorage.getItem(LS_BG) !== "0";
  const intensity = parseFloat(localStorage.getItem(LS_BG_INT) || "1") || 1;
  NeuronBG.init({ intensity });
  NeuronBG.setEnabled(on);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
function init() {
  // Events
  $("#sendBtn").addEventListener("click", () => {
    if (state.generating) cancelGeneration();
    else send();
  });
  $("#input").addEventListener("input", autoGrow);
  $("#input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  $("#settingsBtn").addEventListener("click", openSettings);
  const sb2 = $("#settingsBtn2");
  if (sb2) sb2.addEventListener("click", () => { closeSidebar(); openSettings(); });
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#settingsModal").addEventListener("click", (e) => {
    if (e.target.id === "settingsModal") closeSettings();
  });
  $("#resetBtn").addEventListener("click", () => {
    localStorage.removeItem(LS_ONBOARDED);
    localStorage.removeItem(LS_PROFILE);
    state.profile = {};
    closeSettings();
    location.reload();
  });

  // Neue Frage / Verlauf / mobile Navigation
  const nc = $("#newChatBtn"); if (nc) nc.addEventListener("click", newChat);
  const nct = $("#newChatBtnTop"); if (nct) nct.addEventListener("click", newChat);
  const mb = $("#menuBtn"); if (mb) mb.addEventListener("click", toggleSidebar);
  const ov = $("#sidebarOverlay"); if (ov) ov.addEventListener("click", closeSidebar);
  const tc = $("#tempChatBtn"); if (tc) tc.addEventListener("click", toggleTemporary);
  const cs = $("#chatSearch");
  if (cs) cs.addEventListener("input", () => { state.chatFilter = cs.value; renderChatList(); });

  // Navigation Chat ↔ News-Radar
  document.querySelectorAll("[data-nav]").forEach((b) => {
    b.addEventListener("click", () => {
      if (!localStorage.getItem(LS_ONBOARDED)) return; // erst Onboarding
      if (b.dataset.nav === "radar") showRadar();
      else showChat();
    });
  });

  renderChatList();

  initBackground();

  renderOnboarding();
  if (localStorage.getItem(LS_ONBOARDED)) {
    showChat();
  } else {
    $("#onboarding").classList.remove("hidden");
  }

  refreshMode();
}

document.addEventListener("DOMContentLoaded", init);

// Service Worker: macht NEURON als App installierbar (Home-Bildschirm)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
