// dev/config.js
// Development configuration - uses static OSM datasets

window.APP_CONFIG = {
  // --- Weather (use Cloudflare Worker so keys are not exposed) ---
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
