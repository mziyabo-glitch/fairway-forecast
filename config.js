/* Legacy shell only. The premium document does not load this file.
   If Cloudflare is still serving the pre-premium index.html, leave that
   cached URL for one the edge has not stored. */
(function () {
  if (typeof document === "undefined" || typeof location === "undefined") return;
  if (document.documentElement.getAttribute("data-fw-shell") === "premium") return;
  var url;
  try {
    url = new URL(location.href);
  } catch (e) {
    return;
  }
  if (url.searchParams.has("fw_net")) return;
  url.searchParams.set("fw_net", "8");
  location.replace(url.href);
})();

// dev/config.js
// Development configuration - uses static OSM datasets

window.APP_CONFIG = {
  // --- Weather (rollback) ---
  // Directly call the upstream Worker (immediate fix if same-origin proxy isn't deployed on this host).
  WORKER_BASE_URL: "https://fairway-forecast-api.mziyabo.workers.dev",

  // --- DEV: Force local static datasets (NO Supabase, NO external course APIs) ---
  USE_LOCAL_DATASETS: true,

  // --- App defaults ---
  DEFAULT_UNITS: "metric", // "metric" (°C) or "imperial" (°F)

  // --- Feature flags ---
  FEATURE_ADVANCED_WIND: false,
  FEATURE_ROUND_PLANNER: false,

  // --- DEV: Static Dataset Search ---
  FEATURE_STATIC_DATASETS: true, // legacy flag (kept for compatibility)

  // Dataset paths (relative to /dev/)
  DATASET_BASE_PATH: "../data/courses",

  // Countries are populated from data/courses/index.json at runtime.
  // (Fallback list is intentionally minimal.)
  COUNTRIES: [
    { code: "gb", name: "United Kingdom", flag: "🇬🇧" },
    { code: "fr", name: "France", flag: "🇫🇷" },
    { code: "de", name: "Germany", flag: "🇩🇪" },
    { code: "es", name: "Spain", flag: "🇪🇸" },
    { code: "us", name: "United States", flag: "🇺🇸" },
    { code: "au", name: "Australia", flag: "🇦🇺" },
    { code: "za", name: "South Africa", flag: "🇿🇦" },
  ],

  // Default country (UK)
  DEFAULT_COUNTRY: "gb",
};
