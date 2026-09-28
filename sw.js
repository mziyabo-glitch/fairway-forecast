/* fairwayweather.com service worker — fairwayweather-shell-v8
 *
 * The legacy worker (and Cloudflare in front of GitHub Pages) can keep
 * serving the pre-premium document. Browsers re-check this exact URL
 * because the old shell registered "/sw.js".
 *
 * This worker:
 * - installs and activates immediately (skipWaiting + clients.claim)
 * - deletes every Cache Storage entry
 * - answers navigations and the app-shell scripts from the network only
 * - never cache-firsts HTML or /app.js or /dev/js/app.js
 *
 * The fw_net query is only on the worker's fetch. Cloudflare ignores
 * Cache-Control: no-cache on "/" (max-age=1200 HIT of the old document)
 * but a new query string is a cache miss, so the origin document is used.
 */

const SW_VERSION = 8;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        reloadIfLegacy(client);
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "fw-sw-version") {
    event.ports?.[0]?.postMessage({ version: SW_VERSION });
  }
});

function isNavigation(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function isShellScript(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname === "/app.js" || url.pathname === "/dev/js/app.js";
}

function reloadIfLegacy(client) {
  if (!client || typeof client.navigate !== "function") return;
  let url;
  try {
    url = new URL(client.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/dev/")) return;
  if (url.searchParams.get("fw_shell") === String(SW_VERSION)) return;
  url.searchParams.set("fw_shell", String(SW_VERSION));
  client.navigate(url.href).catch(() => {});
}

async function fromNetwork(request) {
  const url = new URL(request.url);
  url.searchParams.set("fw_net", `${SW_VERSION}-${Date.now()}`);
  return fetch(url.href, {
    cache: "reload",
    credentials: "same-origin",
    redirect: "follow",
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!request || request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin === self.location.origin && url.pathname.endsWith("/sw.js")) return;

  if (isNavigation(request)) {
    event.respondWith(
      fromNetwork(request).catch(
        () =>
          new Response("Offline", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
      )
    );
    return;
  }

  if (!isShellScript(url)) return;

  if (url.pathname === "/app.js" && event.clientId) {
    event.waitUntil(
      self.clients.get(event.clientId).then((client) => {
        if (client) reloadIfLegacy(client);
      })
    );
  }

  event.respondWith(fromNetwork(request));
});
