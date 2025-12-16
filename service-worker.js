/* =========================================================
   Fairway Forecast – Service Worker (App Shell Cache)
   ========================================================= */

const CACHE_NAME = "fairway-forecast-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
];

// Install: cache core files
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Navigations: offline fallback to index.html
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.open(CACHE_NAME).then((cache) => cache.match("./index.html"))
      )
    );
    return;
  }

  // Cache-first for shell assets
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
