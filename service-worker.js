/* service-worker.js
   Basic offline "app shell" caching for Fairway Forecast.
   - Caches core files so the app loads offline (UI shell).
   - Does NOT cache live API responses by default (keeps data fresh, avoids stale forecasts).
*/

const CACHE_NAME = "fairway-forecast-shell-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  // icons (match your manifest paths)
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
];

// Install: cache shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
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

// Fetch strategy:
// - App shell files: cache-first
// - Everything else: network-first (so APIs stay fresh)
// - If offline and network fails: fall back to cached index.html for navigations
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests for caching
  const sameOrigin = url.origin === self.location.origin;

  // Navigation requests: network-first, fallback to cached shell
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match("./index.html");
      })
    );
    return;
  }

  // Cache-first for shell assets on same origin
  if (sameOrigin && APP_SHELL.some((p) => url.pathname.endsWith(p.replace("./", "/")))) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // Default: network-first, fallback to cache if available
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Optionally cache same-origin static assets (not API)
        if (sameOrigin && req.method === "GET" && isStaticAsset(url.pathname)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

function isStaticAsset(pathname) {
  return (
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".ico")
  );
}
