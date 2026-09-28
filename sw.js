/* fairwayweather.com service worker — fairwayweather-shell-v7
 * Replaces the legacy cache-first worker. This version does not intercept
 * fetches, so the HTML shell is never served cache-first. Activate deletes
 * the old fairwayweather-* caches and takes control immediately.
 */

const SW_VERSION = 7;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("fairwayweather")).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "fw-sw-version") {
    event.ports[0]?.postMessage({ version: SW_VERSION });
  }
});

// No fetch handler on purpose. Navigations and assets always hit the network.
