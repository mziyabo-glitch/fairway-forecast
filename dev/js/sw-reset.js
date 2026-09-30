/* Drop a service worker that predates the advanced /dev shell.
   A controlling /dev worker that does not report version 5 is unregistered once,
   then the page reloads from the network. */
(function () {
  if (!("serviceWorker" in navigator)) return;
  var KEY = "fw-sw-brand-v5";
  if (sessionStorage.getItem(KEY) === "ok") return;
  var controller = navigator.serviceWorker.controller;
  if (!controller) {
    sessionStorage.setItem(KEY, "ok");
    return;
  }
  navigator.serviceWorker.getRegistration("/dev/").then(function (reg) {
    var scopePath = "";
    try {
      scopePath = reg ? new URL(reg.scope).pathname : "";
    } catch (e) {
      scopePath = "";
    }
    // A production worker at scope "/" also matches /dev/. Leave that registration alone.
    if (!reg || !/\/dev\/$/i.test(scopePath)) {
      sessionStorage.setItem(KEY, "ok");
      return;
    }
    var settled = false;
    function fresh() {
      if (settled) return;
      settled = true;
      sessionStorage.setItem(KEY, "ok");
    }
    function stale() {
      if (settled) return;
      settled = true;
      if (sessionStorage.getItem(KEY) === "1") {
        sessionStorage.setItem(KEY, "ok");
        return;
      }
      sessionStorage.setItem(KEY, "1");
      reg.unregister().finally(function () {
        location.reload();
      });
    }
    var channel = new MessageChannel();
    channel.port1.onmessage = function (event) {
      if (event.data && event.data.version === 5) fresh();
      else stale();
    };
    try {
      controller.postMessage({ type: "fw-sw-version" }, [channel.port2]);
    } catch (e) {
      stale();
      return;
    }
    setTimeout(function () {
      if (!settled) stale();
    }, 800);
  }).catch(function () {});
})();
