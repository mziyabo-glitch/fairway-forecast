/* service-worker.js
   Basic offline “app shell” cache for GitHub Pages / PWA.
   Keeps the UI available offline (last cached version).
*/

const CACHE_NAME = "fairway-forecast-shell-v1";

// Add ONLY static files that exist in your repo root (and icons folder)
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Install: cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : null))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - For same-origin requests: cache-first (fast UI), then network fallback
// - For cross-origin (OpenWeather/Leaflet tiles): network-only (avoid CORS/cache issues)
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== "GET") return;

  // Cross-origin: just go to network
  if (url.origin !== self.location.origin) return;

  // Same-origin: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // Cache successful same-origin responses
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => {
          // If offline and requesting a page, fall back to index
          if (req.mode === "navigate") return caches.match("./index.html");
          return cached;
        });
    })
  );
});
