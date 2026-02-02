/* fairwayweather.com service worker
 * Cache name: fairwayweather-v1
 * API cache name: fairwayweather-api-v1
 */

/* eslint-disable no-restricted-globals */

const STATIC_CACHE = "fairwayweather-v6";
const API_CACHE = "fairwayweather-api-v6";
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png",
];

const API_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

function isStaticAssetRequest(request) {
  if (request.method !== "GET") return false;
  // request.destination is best-effort; keep a path fallback too.
  const dest = request.destination;
  if (dest === "script" || dest === "style" || dest === "font" || dest === "image") return true;
  const url = new URL(request.url);
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/") || url.pathname.endsWith(".css") || url.pathname.endsWith(".js"))
  );
}

function isApiRequest(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);

  // Local function-style endpoints (if present on the host)
  if (url.origin === self.location.origin && (url.pathname.startsWith("/weather") || url.pathname.startsWith("/geocode"))) {
    return true;
  }

  // External API providers used by the app
  const host = url.hostname;
  return (
    host === "api.openweathermap.org" ||
    host.endsWith(".supabase.co") ||
    host.endsWith(".workers.dev") ||
    host.endsWith("workers.dev")
  );
}

function apiTimestampKey(urlString) {
  const url = new URL(urlString);
  url.searchParams.set("__sw_ts", "1");
  return url.toString();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    await cache.put(request, fresh.clone());
  }
  return fresh;
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  const tsKey = apiTimestampKey(request.url);

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      await cache.put(request, fresh.clone());
      await cache.put(tsKey, new Response(String(Date.now()), { headers: { "content-type": "text/plain" } }));
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (!cached) throw err;

    // Best-effort max-age check: if too old, still return when offline.
    try {
      const tsRes = await cache.match(tsKey);
      const tsText = tsRes ? await tsRes.text() : "";
      const ts = Number(tsText);
      if (Number.isFinite(ts) && Date.now() - ts > API_MAX_AGE_MS) {
        // Stale, but offline: returning cached is better than failing.
        return cached;
      }
    } catch {
      // Ignore timestamp parsing errors and return cached.
    }

    return cached;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Use cache:reload to avoid a stale HTTP cache interfering with precache.
      await cache.addAll(PRECACHE_URLS.map((u) => new Request(u, { cache: "reload" })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const allow = new Set([STATIC_CACHE, API_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !allow.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!request || request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigations: try network, fall back to cached app shell (/)
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Optionally update the app shell cache too.
          const cache = await caches.open(STATIC_CACHE);
          await cache.put("/", fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const cached = await cache.match("/");
          return cached || new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
        }
      })()
    );
    return;
  }

  // Same-origin static assets: cache-first
  if (url.origin === self.location.origin && isStaticAssetRequest(request)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // API calls: network-first (with cached fallback)
  if (isApiRequest(request)) {
    event.respondWith(
      networkFirstApi(request).catch(() => fetch(request)) // last-resort fallback
    );
    return;
  }
});

