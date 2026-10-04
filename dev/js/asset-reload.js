/* One-time reload when fw-asset-version changes so clients drop stale /dev/js modules. */
(function () {
  var meta = document.querySelector('meta[name="fw-asset-version"]');
  if (!meta) return;
  var version = meta.getAttribute("content") || "";
  if (!version) return;
  var STORE = "fw-asset-version";
  var RELOAD = "fw-asset-reload";
  try {
    if (localStorage.getItem(STORE) === version) return;
    if (sessionStorage.getItem(RELOAD) === version) {
      localStorage.setItem(STORE, version);
      return;
    }
    sessionStorage.setItem(RELOAD, version);
  } catch (e) {
    return;
  }
  var clear = window.caches
    ? caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (key) { return caches.delete(key); }));
      })
    : Promise.resolve();
  clear.catch(function () {}).finally(function () {
    try {
      localStorage.setItem(STORE, version);
    } catch (e) {
      /* ignore */
    }
    location.reload();
  });
})();
