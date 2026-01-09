/* Premium PWA install banner for fairwayweather.com
 *
 * - Uses beforeinstallprompt (Chromium) to show an in-app banner instead of the default prompt UI.
 * - iOS Safari: shows an A2HS tip card (Share → Add to Home Screen).
 * - Hide if already installed (standalone display mode / navigator.standalone).
 * - "Not now" cooldown: 14 days (localStorage timestamp).
 */

(function () {
  "use strict";

  var COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
  var DISMISS_KEY = "fw_pwa_install_dismissed_at";
  var deferredPrompt = null;
  var bannerEl = null;

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch (_) {}
    return window.navigator.standalone === true; // iOS
  }

  function isIos() {
    var ua = window.navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (ua.indexOf("Mac") !== -1 && "ontouchend" in document);
  }

  function isSafari() {
    var ua = window.navigator.userAgent || "";
    return /Safari/.test(ua) && !/Chrome|CriOS|Edg|OPR|FxiOS/.test(ua);
  }

  function shouldShowByCooldown() {
    try {
      var ts = Number(localStorage.getItem(DISMISS_KEY) || "0");
      if (ts && Date.now() - ts < COOLDOWN_MS) return false;
    } catch (_) {}
    return true;
  }

  function setDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (_) {}
  }

  function setBannerVisible(visible) {
    if (!bannerEl) return;
    if (visible) {
      bannerEl.hidden = false;
      document.body.classList.add("fw-pwa-banner-visible");
    } else {
      bannerEl.hidden = true;
      document.body.classList.remove("fw-pwa-banner-visible");
    }
  }

  function dismissBanner() {
    setDismissed();
    setBannerVisible(false);
    deferredPrompt = null;
  }

  function ensureStyles() {
    if (document.getElementById("fw-pwa-banner-styles")) return;
    var style = document.createElement("style");
    style.id = "fw-pwa-banner-styles";
    style.textContent =
      ".fw-pwa-banner{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 14px;border-radius:16px;background:linear-gradient(180deg,rgba(11,31,42,.96),rgba(11,31,42,.9));color:rgba(255,255,255,.95);box-shadow:0 16px 40px rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);max-width:760px;margin:0 auto}" +
      ".fw-pwa-banner[hidden]{display:none!important}" +
      ".fw-pwa-left{display:flex;align-items:center;gap:12px;min-width:0}" +
      ".fw-pwa-icon{width:44px;height:44px;border-radius:12px;flex:0 0 auto;box-shadow:0 8px 18px rgba(0,0,0,.25);background:rgba(255,255,255,.06);object-fit:cover}" +
      ".fw-pwa-title{font-weight:900;letter-spacing:.2px;font-size:13px;line-height:1.15;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".fw-pwa-sub{font-size:12px;line-height:1.25;opacity:.9;margin-top:3px;max-width:520px}" +
      ".fw-pwa-right{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}" +
      ".fw-pwa-btn{appearance:none;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:10px 12px;font-weight:800;font-size:12px;cursor:pointer}" +
      ".fw-pwa-btn-primary{background:#1F6F78;color:white;border-color:rgba(255,255,255,.14)}" +
      ".fw-pwa-btn-primary:hover{filter:brightness(1.05)}" +
      ".fw-pwa-btn-secondary{background:rgba(255,255,255,.08);color:rgba(255,255,255,.92)}" +
      ".fw-pwa-btn-secondary:hover{background:rgba(255,255,255,.12)}" +
      ".fw-pwa-banner--tip{padding:12px 12px}" +
      ".fw-pwa-banner--tip .fw-pwa-icon{width:38px;height:38px;border-radius:11px}" +
      ".fw-pwa-banner--tip .fw-pwa-right{gap:10px}" +
      ".fw-pwa-banner--tip .fw-pwa-btn-primary{display:none}" +
      "body.fw-pwa-banner-visible{padding-bottom:96px}" +
      "@media (max-width:420px){.fw-pwa-banner{align-items:flex-start}.fw-pwa-right{width:100%;justify-content:flex-start}}";
    document.head.appendChild(style);
  }

  function whenBodyReady(fn) {
    if (document.body) {
      fn();
      return;
    }
    window.addEventListener(
      "DOMContentLoaded",
      function () {
        fn();
      },
      { once: true }
    );
  }

  function buildBanner() {
    ensureStyles();
    if (bannerEl) return bannerEl;
    if (!document.body) return null;

    var el = document.createElement("div");
    el.id = "fwPwaInstallBanner";
    el.className = "fw-pwa-banner";
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Install Fairway Weather");

    el.innerHTML =
      '<div class="fw-pwa-left">' +
      '  <img class="fw-pwa-icon" src="/icons/icon-192.png" alt="Fairway Weather" />' +
      '  <div class="fw-pwa-text" style="min-width:0">' +
      '    <div class="fw-pwa-title">Install Fairway Weather</div>' +
      '    <div class="fw-pwa-sub">Fast access, offline support, and a home-screen icon.</div>' +
      "  </div>" +
      "</div>" +
      '<div class="fw-pwa-right">' +
      '  <button type="button" class="fw-pwa-btn fw-pwa-btn-primary" id="fwPwaInstallBtn">Install</button>' +
      '  <button type="button" class="fw-pwa-btn fw-pwa-btn-secondary" id="fwPwaDismissBtn">Not now</button>' +
      "</div>";

    document.body.appendChild(el);
    bannerEl = el;

    var dismissBtn = document.getElementById("fwPwaDismissBtn");
    if (dismissBtn) dismissBtn.addEventListener("click", dismissBanner);

    var installBtn = document.getElementById("fwPwaInstallBtn");
    if (installBtn) {
      installBtn.addEventListener("click", function () {
        if (!deferredPrompt) return;
        try {
          deferredPrompt.prompt();
          deferredPrompt.userChoice
            .then(function () {
              deferredPrompt = null;
              setBannerVisible(false);
            })
            .catch(function () {
              deferredPrompt = null;
              setBannerVisible(false);
            });
        } catch (_) {
          deferredPrompt = null;
          setBannerVisible(false);
        }
      });
    }

    return el;
  }

  function showPremiumInstallBanner() {
    if (isStandalone()) return;
    if (!shouldShowByCooldown()) return;
    whenBodyReady(function () {
      var el = buildBanner();
      if (!el) return;
      el.classList.remove("fw-pwa-banner--tip");
      setBannerVisible(true);
    });
  }

  function showIosTipCard() {
    if (isStandalone()) return;
    if (!shouldShowByCooldown()) return;
    whenBodyReady(function () {
      var el = buildBanner();
      if (!el) return;
      el.classList.add("fw-pwa-banner--tip");
      // Replace subtitle for iOS guidance and hide primary button via CSS.
      var sub = el.querySelector(".fw-pwa-sub");
      if (sub) sub.textContent = "On iPhone: Share → Add to Home Screen";
      setBannerVisible(true);
    });
  }

  // Chromium: store the event and show our banner instead
  window.addEventListener("beforeinstallprompt", function (e) {
    try {
      e.preventDefault();
    } catch (_) {}
    deferredPrompt = e;
    showPremiumInstallBanner();
  });

  // Hide when installed
  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    setBannerVisible(false);
  });

  // iOS Safari: beforeinstallprompt won't fire
  window.addEventListener("load", function () {
    if (!isIos() || !isSafari()) return;
    if (deferredPrompt) return;
    showIosTipCard();
  });
})();

