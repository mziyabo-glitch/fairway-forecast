// dev/config.js
// Development configuration - uses static OSM datasets

window.APP_CONFIG = {
  // --- Weather (use Cloudflare Worker so keys are not exposed) ---
  WORKER_BASE_URL: "https://fairway-forecast-api.mziyabo.workers.dev",

  // --- Supabase (disabled in dev - using static datasets) ---
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // --- Courses table/columns (not used in dev) ---
  COURSES_TABLE: "uk_golf_courses",
  COURSE_COLS: {
    name: "name",
    lat: "latitude",
    lon: "longitude",
    country: "country",
  },

  // --- App defaults ---
  DEFAULT_UNITS: "metric", // "metric" (°C) or "imperial" (°F)

  // --- Feature flags ---
  FEATURE_ADVANCED_WIND: false,
  FEATURE_ROUND_PLANNER: false,

  // --- DEV: Static Dataset Search ---
  FEATURE_STATIC_DATASETS: true, // Enable static OSM-based course search

  // Dataset paths (relative to /dev/)
  DATASET_BASE_PATH: "../data/courses",

  // Supported countries with their labels
  COUNTRIES: [
    { code: "gb", name: "United Kingdom", flag: "🇬🇧" },
    { code: "us", name: "United States", flag: "🇺🇸" },
    { code: "au", name: "Australia", flag: "🇦🇺" },
    { code: "za", name: "South Africa", flag: "🇿🇦" },
    { code: "fr", name: "France", flag: "🇫🇷" },
    { code: "se", name: "Sweden", flag: "🇸🇪" },
    { code: "de", name: "Germany", flag: "🇩🇪" },
  ],

  // Default country (UK)
  DEFAULT_COUNTRY: "gb",
};
