// Service worker: l'app funziona anche senza rete. I dati restano nel dispositivo (IndexedDB), qui ci sono solo i file dell'app.
const CACHE = "finanze-__VERSIONE__";
const FILE = __FILE__;
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x.startsWith("finanze-") && x !== CACHE).map((x) => caches.delete(x))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // Google, servizio, prezzi: sempre dalla rete
  if (e.request.mode === "navigate") {
    // la pagina: si prova la rete (per avere sempre l'ultima versione), altrimenti quella salvata
    e.respondWith(fetch(e.request).catch(() => caches.match("index.html", { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
