// config.js
// Loaded BEFORE app.js (see index.html)
//
// Production config (promoted from /dev):
// - Static OSM datasets (no Supabase / no external course APIs)
// - Weather via Cloudflare Worker

window.APP_CONFIG = {
  // --- Weather (compat) ---
  // Keep this file for cached HTML references after rollback.
  WORKER_BASE_URL: "https://fairway-forecast-api.mziyabo.workers.dev",

  // --- Static datasets (OSM) ---
  USE_LOCAL_DATASETS: true,
  FEATURE_STATIC_DATASETS: true, // legacy flag (kept for compatibility)
  DATASET_BASE_PATH: "data/courses",

  // --- App defaults ---
  DEFAULT_UNITS: "metric", // "metric" (°C) or "imperial" (°F)

  // --- Feature flags ---
  FEATURE_ADVANCED_WIND: false,
  FEATURE_ROUND_PLANNER: false,

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

  DEFAULT_COUNTRY: "gb",
};

