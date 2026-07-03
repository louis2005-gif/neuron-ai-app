# NEURON – Ideen-Speicher (vom Nutzer gewünscht, noch nicht gebaut)

## Nächste große Ausbaustufe: Visuelle Antworten & Bild-Design
- **Grafiken/Diagramme in den Antworten:** Pro- und Contra-Aussagen visuell
  veranschaulichen (z. B. Balken-/Waage-Diagramm für Pro vs. Contra,
  Evidenz-Anzeige als Skala, Quellen-Vertrauen als Chart).
- **Bilder im Design:** Die App soll insgesamt bildreicher werden
  (illustrative Elemente, ggf. Themen-Bilder im News-Radar).
- Allgemein: weiterer Feinschliff am Design – dem Nutzer gefallen
  "per se immer noch ein paar Sachen nicht" (Details noch zu erfragen).

## Offen aus früheren Gesprächen
- Nutzer will ein **eigenes Arbeitssystem** (System-Prompt) für die KI
  schreiben und liefern – dann 1:1 in `buildSystemPrompt()` (app.js)
  einbauen. Ton/Modell/Anweisungen-Einstellungen bewusst NICHT bauen.

## Technische Notizen für die nächste Session
- Deploy: Push auf `main` → GitHub Actions → Pages. Erste Versuche werden
  von GitHub gelegentlich mit „Deployment failed, try again later"
  abgewiesen → einfach erneut ausführen (ggf. nach 30–40 Min Wartezeit).
- Service Worker: bei jeder Änderung `CACHE`-Version in `sw.js` hochzählen.
- App-URL: https://louis2005-gif.github.io/neuron-ai-app/
