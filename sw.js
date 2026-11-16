// Service worker: la app abre rápido y funciona para ver datos cacheados; los datos siempre van a Supabase.
const CACHE = "cuadre-v1";
const SHELL = ["./", "./index.html", "./js/app.js", "./js/parser.js", "./js/config.js", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Red primero (siempre la versión más nueva); si no hay internet, lo guardado.
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
