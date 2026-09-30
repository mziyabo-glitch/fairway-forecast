/* Fairway Weather /dev/ service worker
 * Caches the rebuild app shell. Never treats stale weather as current.
 */

const SW_VERSION = 5;
const STATIC_CACHE = "fairway-dev-static-v5";
const DATA_CACHE = "fairway-dev-data-v2";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./config.js",
  "./css/tokens.css",
  "./css/app.css",
  "./css/premium.css",
  "./js/app.js",
  "./js/sw-reset.js",
  "./js/router.js",
  "./js/config/devFeatures.js",
  "./js/analytics/analytics.js",
  "../playability.js",
  "./assets/brand/fairwayweather-mark.svg",
  "./assets/brand/favicon.svg",
  "./assets/brand/favicon-32.png",
  "./assets/brand/icon-192.png",
  "./assets/brand/icon-512.png",
  "./assets/brand/icon-192-maskable.png",
  "./assets/brand/icon-512-maskable.png",
  "./assets/brand/icon-1024.png",
  "../data/courses/index.json",
  "../data/courses/gb.json",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
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

function isFontRequest(url) {
  return (
    url.hostname === "fonts.googleapis.com" ||
    url.hostname === "fonts.gstatic.com" ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".woff")
  );
}

function isDevStatic(url) {
  if (isFontRequest(url)) return true;
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "fw-sw-version") {
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!request || request.method !== "GET") return;

  const url = new URL(request.url);
  // Never answer the update check from cache, or a worker installed before
  // the brand mark shipped will keep serving that old app.js forever.
  if (url.pathname.endsWith("/sw.js")) return;

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
          const cached =
            (await cache.match("./index.html")) ||
            (await cache.match("./")) ||
            null;
          if (cached) return cached;
          return new Response(
            `<!DOCTYPE html><html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FairwayWeather offline</title><body style="font-family:system-ui;padding:24px;background:#f4f7f2;color:#13211B"><h1>You're offline</h1><p>Saved courses and rounds stored on this device are still available once the app shell has loaded. Live weather is not cached.</p><p><a href="/dev/">Open FairwayWeather</a></p></body></html>`,
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
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
    event.respondWith(networkFirst(request, STATIC_CACHE));
  }
});
