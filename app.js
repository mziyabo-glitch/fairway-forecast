/* app.js — Fairway Forecast (FREE PLAN SAFE) */

const CFG = window.APP_CONFIG;

// ----------------------------
// Basic state (SAFE DEFAULTS)
// ----------------------------
const state = {
  location: null,
  weather: null,
  forecast: [],
  courses: [],
  favs: []
};

// ----------------------------
// Helpers
// ----------------------------
function qs(id) {
  return document.getElementById(id);
}

function showStatus(msg) {
  const el = qs("appStatus");
  if (el) el.textContent = msg;
}

// ----------------------------
// Supabase (courses)
// ----------------------------
let supabase = null;

function initSupabase() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
    console.warn("Supabase not configured");
    return;
  }

  supabase = window.supabase.createClient(
    CFG.SUPABASE_URL,
    CFG.SUPABASE_ANON_KEY
  );
}

async function loadCourses() {
  if (!supabase) return;

  const status = qs("coursesStatus");
  status.textContent = "Courses: loading…";

  try {
    const { data, error } = await supabase
      .from(CFG.COURSES_TABLE)
      .select("*")
      .limit(2000);

    if (error) throw error;

    state.courses = data || [];
    status.textContent = `Courses: ${state.courses.length} ✓`;
  } catch (err) {
    console.error("Courses load failed", err);
    status.textContent = "Courses: error";
  }
}

// ----------------------------
// Weather (FREE endpoints)
// ----------------------------
async function fetchCurrentWeather(lat, lon) {
  const url =
    `https://api.openweathermap.org/data/2.5/weather` +
    `?lat=${lat}&lon=${lon}&units=metric&appid=${CFG.OPENWEATHER_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather fetch failed");
  return res.json();
}

async function fetchForecast(lat, lon) {
  const url =
    `https://api.openweathermap.org/data/2.5/forecast` +
    `?lat=${lat}&lon=${lon}&units=metric&appid=${CFG.OPENWEATHER_KEY}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast fetch failed");
  return res.json();
}

// ----------------------------
// Render
// ----------------------------
function renderCurrent() {
  if (!state.weather) return;

  qs("currTemp").textContent = Math.round(state.weather.main.temp);
  qs("feelsLike").textContent = Math.round(state.weather.main.feels_like);
  qs("humidity").textContent = state.weather.main.humidity;
  qs("wind").textContent = Math.round(state.weather.wind.speed);

  qs("h1Title").textContent = state.location.name;
  qs("subTitle").textContent = state.location.country || "";

  const icon = state.weather.weather[0].icon;
  qs("imgIcon").src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
}

function renderHourly() {
  const wrap = qs("hourlyForecast");
  wrap.innerHTML = "";

  state.forecast.slice(0, 8).forEach(h => {
    const div = document.createElement("div");
    div.className = "hourBlock";
    div.textContent =
      `${new Date(h.dt * 1000).getHours()}:00 — ${Math.round(h.main.temp)}°C`;
    wrap.appendChild(div);
  });
}

// ----------------------------
// Search
// ----------------------------
async function searchLocation(query) {
  showStatus("Searching…");

  const url =
    `https://api.openweathermap.org/geo/1.0/direct` +
    `?q=${encodeURIComponent(query)}&limit=1&appid=${CFG.OPENWEATHER_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.length) {
    showStatus("Location not found");
    return;
  }

  const loc = data[0];
  state.location = {
    name: loc.name,
    country: loc.country,
    lat: loc.lat,
    lon: loc.lon
  };

  await loadWeatherForLocation();
}

async function loadWeatherForLocation() {
  try {
    showStatus("Loading weather…");

    state.weather = await fetchCurrentWeather(
      state.location.lat,
      state.location.lon
    );

    const fc = await fetchForecast(
      state.location.lat,
      state.location.lon
    );

    state.forecast = fc.list || [];

    renderCurrent();
    renderHourly();

    showStatus("Ready ✓");
  } catch (err) {
    console.error(err);
    showStatus("Weather error");
  }
}

// ----------------------------
// Init
// ----------------------------
document.addEventListener("DOMContentLoaded", () => {
  initSupabase();
  loadCourses();

  qs("btnSearch").addEventListener("click", () => {
    const q = qs("txtSearch").value.trim();
    if (q) searchLocation(q);
  });
});
