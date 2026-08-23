/* Fairway Weather /dev/ service worker
 * Caches the rebuild app shell. Never treats stale weather as current.
 */

const STATIC_CACHE = "fairway-dev-static-v1";
const DATA_CACHE = "fairway-dev-data-v1";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./config.js",
  "./css/tokens.css",
  "./css/app.css",
  "./js/app.js",
  "./js/router.js",
  "../playability.js",
  "../icons/icon-192.png",
  "../icons/icon-512.png",
  "../icons/favicon.ico",
  "../data/courses/index.json",
  "../data/courses/gb.json",
];

function isWeatherRequest(url) {
  return (
    url.pathname.includes("/weather") ||
    url.hostname.includes("workers.dev") && url.pathname.includes("weather") ||
    url.hostname === "api.openweathermap.org"
  );
}

function isCourseData(url) {
  return url.origin === self.location.origin && url.pathname.includes("/data/courses/");
}

function isDevStatic(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  return (
    p.startsWith("/dev/") ||
    p.startsWith("/shared/") ||
    p.startsWith("/icons/") ||
    p.endsWith(".css") ||
    p.endsWith(".js") ||
    p.endsWith(".webmanifest")
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) await cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(
        PRECACHE_URLS.map(async (u) => {
          try {
            const req = new Request(new URL(u, self.location.href), { cache: "reload" });
            const res = await fetch(req);
            if (res.ok) await cache.put(req, res);
          } catch {
            /* skip missing optional assets */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const allow = new Set([STATIC_CACHE, DATA_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("fairway-dev-") && !allow.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!request || request.method !== "GET") return;

  const url = new URL(request.url);

  if (isWeatherRequest(url)) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: "offline", offline: true }), {
            status: 503,
            headers: { "content-type": "application/json", "x-fw-offline": "1" },
          })
      )
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          return (
            (await cache.match("./index.html")) ||
            (await cache.match("./")) ||
            new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })
          );
        }
      })()
    );
    return;
  }

  if (isCourseData(url)) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }

  if (isDevStatic(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});
