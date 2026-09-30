/* One-time cleanup for the retired production service worker. */

const SW_VERSION = 9;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "fw-sw-version") {
    event.ports?.[0]?.postMessage({ version: SW_VERSION });
  }
});
