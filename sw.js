/* NEURON AI Service Worker – App-Shell offline, APIs immer live */
const CACHE = "neuron-v9";
const SHELL = ["./", "index.html", "styles.css", "app.js", "radar.js", "bg.js",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // API-Aufrufe (Anthropic, Proxys) nie anfassen
  e.respondWith(
    // no-cache: immer beim Server nachfragen, ob es eine neuere Version gibt –
    // so kommen Design-Updates zuverlässig an (Offline-Fallback bleibt erhalten)
    fetch(e.request, { cache: "no-cache" }).then((resp) => {
      if (resp.ok && e.request.method === "GET") {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
