// config.js
window.APP_CONFIG = {
  OWM_API_KEY: "YOUR_OPENWEATHER_KEY",
  SUPABASE_URL: "https://YOURPROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",
  // Your Supabase table:
  COURSES_TABLE: "uk_golf_courses", // <-- change if yours differs
  // Columns expected in the table:
  COURSE_COLS: { name: "name", lat: "latitude", lon: "longitude", country: "country" },
};
