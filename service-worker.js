/* service-worker.js
   Fairway Forecast - GitHub Pages friendly SW
   - Prevents install failing when a single asset 404s (e.g., missing icons)
   - Cache-first for static assets, network-first for HTML
*/

const VERSION = "v1.0.0";
const CACHE_NAME = `fairway-forecast-${VERSION}`;

// ✅ IMPORTANT: GitHub Pages project base path
// If your app URL is https://<user>.github.io/fairway-forecast/
// then BASE_PATH must be "/fairway-forecast"
const BASE_PATH = "/fairway-forecast";

// Assets to pre-cache (keep this list small + reliable)
const PRECACHE_URLS = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`,
  `${BASE_PATH}/manifest.json`,
  `${BASE_PATH}/service-worker.js`,
  // Add your core bundle files here if you know them for sure:
  // `${BASE_PATH}/app.js`,
  // `${BASE_PATH}/styles.css`,

  // Optional icons — if missing, install will still succeed due to safeAddAll()
  `${BASE_PATH}/icons/icon-192.png`,
  `${BASE_PATH}/icons/icon-512.png`,
];

// --- helpers ---

async function safeAddAll(cache, urls) {
  // Add assets one-by-one so a single 404 doesn't fail the whole install
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        await cache.put(url, res);
      } catch (err) {
        // Don’t break install if an optional asset is missing
        // (This is the fix for your icon-192.png causing addAll() to fail)
        console.warn("[SW] Precaching failed (skipping):", url, err);
      }
    })
  );
}

function isHTMLRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html")
  );
}

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

// --- lifecycle ---

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await safeAddAll(cache, PRECACHE_URLS);
      // Activate new SW ASAP
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Clean up old caches
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("fairway-forecast-") && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// --- fetch strategy ---

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests
  if (request.method !== "GET" || !isSameOrigin(request)) return;

  // Network-first for HTML navigations (so you get updates)
  if (isHTMLRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        } catch (err) {
          const cached = await caches.match(request);
          return (
            cached ||
            caches.match(`${BASE_PATH}/index.html`) ||
            new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } })
          );
        }
      })()
    );
    return;
  }

  // Cache-first for static assets (fast)
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // Cache successful responses
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        // If offline and not cached
        return new Response("", { status: 504 });
      }
    })()
  );
});
