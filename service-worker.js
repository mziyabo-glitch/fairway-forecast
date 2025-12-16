/* =========================================================
   Fairway Forecast — service-worker.js (basic offline shell)
   - Caches core files so the app "shell" loads offline
   - Does NOT cache API responses (weather changes fast)
   ========================================================= */

const CACHE_NAME = "fairway-forecast-shell-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // SPA/PWA navigation fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Cache-first for shell files; network for everything else
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
