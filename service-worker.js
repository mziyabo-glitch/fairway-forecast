/* Fairway Forecast – basic service worker
   Purpose:
   - Cache the app shell so it loads fast
   - Avoid breaking GitHub Pages / WebView
   - No aggressive offline weather caching
*/

const CACHE_NAME = 'fairway-forecast-v1';

const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json'
];

// Install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never cache API calls (weather / Supabase)
  if (
    request.url.includes('openweathermap') ||
    request.url.includes('supabase')
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request);
    })
  );
});
