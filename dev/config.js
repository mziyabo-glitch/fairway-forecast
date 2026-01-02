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

  // Supported countries with their labels
  COUNTRIES: [
    // Required expanded coverage (DEV)
    { code: "gb", name: "United Kingdom", flag: "🇬🇧" },
    { code: "ie", name: "Ireland", flag: "🇮🇪" },
    { code: "us", name: "United States", flag: "🇺🇸" },
    { code: "ca", name: "Canada", flag: "🇨🇦" },
    { code: "au", name: "Australia", flag: "🇦🇺" },
    { code: "nz", name: "New Zealand", flag: "🇳🇿" },
    { code: "za", name: "South Africa", flag: "🇿🇦" },
    { code: "zw", name: "Zimbabwe", flag: "🇿🇼" },

    { code: "fr", name: "France", flag: "🇫🇷" },
    { code: "de", name: "Germany", flag: "🇩🇪" },
    { code: "es", name: "Spain", flag: "🇪🇸" },
    { code: "pt", name: "Portugal", flag: "🇵🇹" },
    { code: "nl", name: "Netherlands", flag: "🇳🇱" },

    { code: "se", name: "Sweden", flag: "🇸🇪" },
    { code: "dk", name: "Denmark", flag: "🇩🇰" },
    { code: "no", name: "Norway", flag: "🇳🇴" },
    { code: "fi", name: "Finland", flag: "🇫🇮" },

    { code: "it", name: "Italy", flag: "🇮🇹" },
    { code: "ch", name: "Switzerland", flag: "🇨🇭" },
    { code: "at", name: "Austria", flag: "🇦🇹" },

    { code: "ae", name: "UAE", flag: "🇦🇪" },
    { code: "ma", name: "Morocco", flag: "🇲🇦" },
    { code: "tr", name: "Turkey", flag: "🇹🇷" },

    { code: "jp", name: "Japan", flag: "🇯🇵" },
    { code: "kr", name: "South Korea", flag: "🇰🇷" },

    { code: "mx", name: "Mexico", flag: "🇲🇽" },
    { code: "be", name: "Belgium", flag: "🇧🇪" },
    { code: "cz", name: "Czechia", flag: "🇨🇿" },
    { code: "pl", name: "Poland", flag: "🇵🇱" },
    { code: "gr", name: "Greece", flag: "🇬🇷" },

    { code: "th", name: "Thailand", flag: "🇹🇭" },
    { code: "my", name: "Malaysia", flag: "🇲🇾" },
    { code: "sg", name: "Singapore", flag: "🇸🇬" },
    { code: "in", name: "India", flag: "🇮🇳" },
    { code: "cn", name: "China", flag: "🇨🇳" },
  ],

  // Default country (UK)
  DEFAULT_COUNTRY: "gb",
};
