// config.js
// Loaded BEFORE app.js (see index.html)

window.APP_CONFIG = {
  // --- Weather (use Cloudflare Worker so keys are not exposed) ---
  // Your worker base URL (NO trailing slash)
  // Example from your screenshots:
  WORKER_BASE_URL: "https://fairway-forecast-api.mziyabo.workers.dev",

  // --- Supabase (anon key is OK to be public; service_role is NOT) ---
  // IMPORTANT: your earlier URL had a typo and caused ERR_NAME_NOT_RESOLVED / NXDOMAIN.
  // Correct project ref: bdxgjkhfdrqrcetvdnvw
  SUPABASE_URL: "https://bdxgjkhfdrqrcetvdnvw.supabase.co",

  // Paste your *anon* key here (NOT service_role).
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkeGdqa2hmZHJxcmNldnRkbnZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MzQ3ODQsImV4cCI6MjA4MTExMDc4NH0.MAGy3DXobwiGQTgznEnLRtLYdrB6bS48MsYpLqjRdgs",

  // --- Courses table/columns ---
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
  // Advanced wind features (gale detection, etc.) - hide until complete
  FEATURE_ADVANCED_WIND: false,
};
