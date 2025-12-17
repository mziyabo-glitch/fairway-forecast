// config.js — Fairway Forecast (public config only)
// IMPORTANT:
// - OpenWeather key must NOT be in this file.
// - Weather requests go via your Cloudflare Worker (secure).

window.APP_CONFIG = {
  // ✅ Your Cloudflare Worker base URL (NO trailing slash)
  WEATHER_WORKER_BASE: "https://fairway-forecast-api.mziyabo.workers.dev",

  // ✅ Supabase (anon key is public by design; security comes from RLS policies)
  SUPABASE_URL: "https://bdxgjkhfdrqrcevtdnvw.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkeGdqa2hmZHJxcmNldnRkbnZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1MzQ3ODQsImV4cCI6MjA4MTExMDc4NH0.MAGy3DXobwiGQTgznEnLRtLYdrB6bS48MsYpLqjRdgs",

  // ✅ Your courses table name in Supabase
  COURSES_TABLE: "uk_golf_courses",

  // ✅ Column mapping (adjust ONLY if your columns differ)
  COURSE_COLS: {
    name: "name",
    lat: "latitude",
    lon: "longitude",
    // optional fields (safe if missing)
    county: "county",
    country: "country"
  },

  // Search behaviour
  MAX_RESULTS: 12
};