/* app.js — Fairway Forecast (static, GitHub Pages friendly)
   - Null-safe DOM access (prevents "Cannot set properties of null")
   - Supabase courses dropdown + favourites
   - Tabs: Current / Hourly / Daily
   - Units toggle metric/imperial
   - Weather: supports 7-day if API provides daily[]
   - App-ready config: reads keys from window.APP_CONFIG (config.js)
*/

"use strict";

/* =========================
   CONFIG (from config.js)
   =========================
   Create / update config.js (in same folder as index.html):

   window.APP_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "your_anon_key",
     OPENWEATHER_KEY: "your_openweather_key"
   };
*/

const APP = window.APP_CONFIG || {};

// 1) Supabase project URL + anon key (Settings → API)
const SUPABASE_URL = APP.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = APP.SUPABASE_ANON_KEY || "";

// 2) Supabase table + columns (match your table exactly)
const COURSES_TABLE = "uk_golf_courses"; // <-- set to your real table (you said this worked)
const COL_NAME = "name";
const COL_LAT = "latitude";
const COL_LON = "longitude";
const COL_COUNTRY = "country";
const COL_WEBSITE = "website"; // optional column; if missing, it will just be blank

// 3) OpenWeather API key
const OPENWEATHER_KEY = APP.OPENWEATHER_KEY || "";

/* =========================
   STORAGE KEYS
   ========================= */

const LS = {
  units: "ff_units",
  favs: "ff_favs",
  selection: "ff_selection",
  activeTab: "ff_active_tab",
};

/* =========================
   DOM HELPERS (NULL SAFE)
   ========================= */

const $ = (id) => document.getElementById(id);

const el = {
  txtSearch: $("txtSearch"),
  btnSearch: $("btnSearch"),
  ddlUnits: $("ddlUnits"),
  ddlFavs: $("ddlFavs"),
  tabCurrent: $("tabCurrent"),
  tabHourly: $("tabHourly"),
  tabDaily: $("tabDaily"),
  status: $("status"),
  results: $("results"),
};

function setStatus(msg) {
  if (!el.status) return;
  el.status.textContent = msg || "";
}

function showToast(msg) {
  setStatus(msg);
  if (msg) setTimeout(() => setStatus(""), 2500);
}

function safeSetValue(element, value) {
  if (!element) return;
  element.value = value;
}

/* =========================
   STATE
   ========================= */

const state = {
  units: "metric", // metric|imperial
  courses: [],
  favs: [],
  selection: null, // { type:"course", label, lat, lon, website? } OR { type:"place", label, lat, lon }
  activeTab: "current", // current|hourly|daily
  weather: null,
};

/* =========================
   INIT: LOAD LOCAL STORAGE
   ========================= */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function loadStateFromStorage() {
  const units = localStorage.getItem(LS.units);
  if (units === "metric" || units === "imperial") state.units = units;

  const favs = loadJSON(LS.favs, []);
  if (Array.isArray(favs)) state.favs = favs;

  const sel = loadJSON(LS.selection, null);
  if (sel && typeof sel === "object") state.selection = sel;

  const tab = localStorage.getItem(LS.activeTab);
  if (tab === "current" || tab === "hourly" || tab === "daily") state.activeTab = tab;
}

function persistUnits() {
  try {
    localStorage.setItem(LS.units, state.units);
  } catch {}
}

function persistSelection() {
  saveJSON(LS.selection, state.selection);
}

function persistFavs() {
  saveJSON(LS.favs, state.favs);
}

function persistTab() {
  try {
    localStorage.setItem(LS.activeTab, state.activeTab);
  } catch {}
}

/* =========================
   SUPABASE: FETCH COURSES
   ========================= */

async function fetchCoursesFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase config missing. Set SUPABASE_URL and SUPABASE_ANON_KEY in config.js");
  }

  // Ask for website too, but if your table doesn't have it, Supabase returns an error.
  // To be robust, we try with website, and if it fails, retry without it.
  const selectCols = [COL_NAME, COL_LAT, COL_LON, COL_COUNTRY, COL_WEBSITE];

  const buildUrl = (cols) =>
    `${SUPABASE_URL}/rest/v1/${encodeURIComponent(COURSES_TABLE)}` +
    `?select=${encodeURIComponent(cols.join(","))}` +
    `&order=${encodeURIComponent(COL_NAME)}.asc`;

  async function fetchWithCols(cols) {
    const res = await fetch(buildUrl(cols), {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase error ${res.status}: ${text || res.statusText}`);
    }
    return res.json();
  }

  let rows;
  try {
    rows = await fetchWithCols(selectCols);
  } catch (e) {
    // Retry without website column (common)
    rows = await fetchWithCols([COL_NAME, COL_LAT, COL_LON, COL_COUNTRY]);
  }

  return (rows || [])
    .map((r) => ({
      name: r[COL_NAME],
      lat: Number(r[COL_LAT]),
      lon: Number(r[COL_LON]),
      country: r[COL_COUNTRY] || "",
      website: r[COL_WEBSITE] || "",
    }))
    .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}

function renderFavs() {
  if (!el.ddlFavs) return;

  el.ddlFavs.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select a favourite…";
  el.ddlFavs.appendChild(opt0);

  for (const f of state.favs) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = f.label;
    el.ddlFavs.appendChild(opt);
  }
}

function addFavouriteFromSelection() {
  if (!state.selection) return;

  const id = `${state.selection.lat},${state.selection.lon}`;
  const label = state.selection.label;

  if (state.favs.some((f) => f.id === id)) {
    showToast("Already in favourites");
    return;
  }

  state.favs.push({
    id,
    label,
    lat: state.selection.lat,
    lon: state.selection.lon,
    website: state.selection.website || "",
  });

  persistFavs();
  renderFavs();
  showToast("Added to favourites");
}

function selectFavourite(id) {
  const fav = state.favs.find((f) => f.id === id);
  if (!fav) return;

  state.selection = { type: "course", label: fav.label, lat: fav.lat, lon: fav.lon, website: fav.website || "" };
  persistSelection();
  refreshForecast();
}

/* =========================
   SEARCH (COURSE LOOKUP)
   ========================= */

function findCourseByQuery(q) {
  if (!q) return null;
  const query = q.trim().toLowerCase();
  if (!query) return null;

  let best = state.courses.find((c) => c.name.toLowerCase() === query);
  if (best) return best;

  best = state.courses.find((c) => c.name.toLowerCase().startsWith(query));
  if (best) return best;

  best = state.courses.find((c) => c.name.toLowerCase().includes(query));
  return best || null;
}

/* =========================
   WEATHER (OPENWEATHER)
   ========================= */

function unitsLabel() {
  return state.units === "imperial" ? "°F" : "°C";
}

function windLabel() {
  return state.units === "imperial" ? "mph" : "m/s";
}

async function fetchWeather(lat, lon) {
  if (!OPENWEATHER_KEY) {
    throw new Error("OpenWeather key missing. Set OPENWEATHER_KEY in config.js");
  }

  // IMPORTANT:
  // One Call 3.0 requires a plan for some accounts.
  // If you are currently using the free 2.5/forecast endpoint, swap this endpoint back.
  const endpoint =
    `https://api.openweathermap.org/data/3.0/onecall` +
    `?lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}` +
    `&units=${encodeURIComponent(state.units)}` +
    `&appid=${encodeURIComponent(OPENWEATHER_KEY)}`;

  const res = await fetch(endpoint);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenWeather error ${res.status}: ${text || res.statusText}`);
  }
  return await res.json();
}

/* =========================
   UI: TABS
   ========================= */

function setActiveTab(tab) {
  state.activeTab = tab;
  persistTab();

  const on = (btn, isOn) => {
    if (!btn) return;
    btn.classList.toggle("active", !!isOn);
    btn.setAttribute("aria-selected", isOn ? "true" : "false");
  };

  on(el.tabCurrent, tab === "current");
  on(el.tabHourly, tab === "hourly");
  on(el.tabDaily, tab === "daily");

  renderResults();
  scrollToResultsOnMobile();
}

function scrollToResultsOnMobile() {
  if (!el.results) return;
  if (window.innerWidth > 768) return;
  el.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* =========================
   RENDERING
   ========================= */

function fmtTemp(t) {
  if (t === null || t === undefined || !Number.isFinite(Number(t))) return "—";
  return `${Math.round(Number(t))}${unitsLabel()}`;
}

function fmtWind(w) {
  if (w === null || w === undefined || !Number.isFinite(Number(w))) return "—";
  return `${Math.round(Number(w))} ${windLabel()}`;
}

function fmtDate(ts, opts) {
  try {
    return new Date(ts * 1000).toLocaleString(undefined, opts);
  } catch {
    return "";
  }
}

function renderResults() {
  if (!el.results) return;

  if (!state.selection) {
    el.results.innerHTML = `<div class="card">Search for a course to see the forecast.</div>`;
    return;
  }

  if (!state.weather) {
    el.results.innerHTML = `<div class="card">Loading forecast…</div>`;
    return;
  }

  const label = state.selection.label || "Selected location";
  const w = state.weather;

  const header = `
    <section class="card">
      <div class="card-title">
        <strong>${escapeHtml(label)}</strong>
        ${state.selection.website ? ` · <a href="${escapeAttr(state.selection.website)}" target="_blank" rel="noopener">Website</a>` : ""}
      </div>
      <div class="card-subtitle">${state.units === "imperial" ? "Imperial" : "Metric"}</div>
    </section>
  `;

  let body = "";
  if (state.activeTab === "current") body = renderCurrent(w);
  if (state.activeTab === "hourly") body = renderHourly(w);
  if (state.activeTab === "daily") body = renderDaily(w);

  el.results.innerHTML = header + body;
}

function renderCurrent(w) {
  const c = w.current;
  if (!c) return `<section class="card">No current data available.</section>`;

  const desc = (c.weather && c.weather[0] && c.weather[0].description) ? c.weather[0].description : "";
  return `
    <section class="card">
      <div><strong>Now</strong> · ${escapeHtml(desc)}</div>
      <div>Temp: <strong>${fmtTemp(c.temp)}</strong></div>
      <div>Feels like: ${fmtTemp(c.feels_like)}</div>
      <div>Wind: ${fmtWind(c.wind_speed)}</div>
      <div>Humidity: ${c.humidity ?? "—"}%</div>
    </section>
  `;
}

function renderHourly(w) {
  const h = w.hourly;
  if (!Array.isArray(h) || !h.length) return `<section class="card">No hourly data available.</section>`;

  const rows = h.slice(0, 24).map((x) => {
    const t = fmtDate(x.dt, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    const desc = (x.weather && x.weather[0] && x.weather[0].main) ? x.weather[0].main : "";
    return `
      <div class="row">
        <div class="row-left">${escapeHtml(t)}</div>
        <div class="row-mid">${escapeHtml(desc)}</div>
        <div class="row-right"><strong>${fmtTemp(x.temp)}</strong></div>
      </div>
    `;
  }).join("");

  return `<section class="card"><div class="card-title"><strong>Next 24 hours</strong></div>${rows}</section>`;
}

function renderDaily(w) {
  const d = w.daily;
  if (!Array.isArray(d) || !d.length) {
    return `<section class="card">No daily data available (your OpenWeather endpoint may not provide daily[]).</section>`;
  }

  const rows = d.slice(0, 7).map((x) => {
    const day = fmtDate(x.dt, { weekday: "long" });
    const min = x.temp?.min;
    const max = x.temp?.max;
    const desc = (x.weather && x.weather[0] && x.weather[0].main) ? x.weather[0].main : "";
    const rain = (x.pop != null) ? `${Math.round(x.pop * 100)}% rain` : "";
    return `
      <div class="row">
        <div class="row-left">${escapeHtml(day)}</div>
        <div class="row-mid">${escapeHtml(desc)} ${rain ? "· " + escapeHtml(rain) : ""}</div>
        <div class="row-right"><strong>${fmtTemp(max)}</strong> / ${fmtTemp(min)}</div>
      </div>
    `;
  }).join("");

  return `<section class="card"><div class="card-title"><strong>7-Day</strong></div>${rows}</section>`;
}

/* =========================
   ACTIONS
   ========================= */

async function refreshForecast() {
  if (!state.selection) return;
  const { lat, lon } = state.selection;

  try {
    setStatus("Loading forecast…");
    state.weather = await fetchWeather(lat, lon);
    setStatus("");
    renderResults();
    scrollToResultsOnMobile();
  } catch (e) {
    console.error(e);
    setStatus("");
    if (el.results) {
      el.results.innerHTML = `<section class="card">Error loading forecast: ${escapeHtml(String(e.message || e))}</section>`;
    }
  }
}

async function loadCourses() {
  try {
    setStatus("Loading courses…");
    state.courses = await fetchCoursesFromSupabase();
    setStatus(`Courses: ${state.courses.length.toLocaleString()} loaded`);
    setTimeout(() => setStatus(""), 1200);
  } catch (e) {
    console.error(e);
    setStatus("");
    if (el.results) {
      el.results.innerHTML = `<section class="card">Error loading courses: ${escapeHtml(String(e.message || e))}</section>`;
    }
  }
}

/* =========================
   EVENTS / BINDINGS
   ========================= */

function bindEvents() {
  // Units
  safeSetValue(el.ddlUnits, state.units);
  if (el.ddlUnits) {
    el.ddlUnits.addEventListener("change", async () => {
      const v = el.ddlUnits.value;
      state.units = (v === "imperial") ? "imperial" : "metric";
      persistUnits();
      showToast(`Units set to ${state.units}`);
      if (state.selection) await refreshForecast();
    });
  }

  // Search button
  if (el.btnSearch) {
    el.btnSearch.addEventListener("click", () => {
      const q = el.txtSearch ? el.txtSearch.value : "";
      if (!q) return showToast("Type a course name first");
      const match = findCourseByQuery(q);
      if (!match) return showToast("No matching course found");

      state.selection = {
        type: "course",
        label: match.name,
        lat: match.lat,
        lon: match.lon,
        website: match.website || "",
      };
      persistSelection();
      refreshForecast();
    });
  }

  // Enter key in search
  if (el.txtSearch) {
    el.txtSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.btnSearch && el.btnSearch.click();
      }
    });
  }

  // Favourites dropdown
  if (el.ddlFavs) {
    el.ddlFavs.addEventListener("change", () => {
      const id = el.ddlFavs.value;
      if (!id) return;
      selectFavourite(id);
      el.ddlFavs.value = "";
    });
  }

  // Tabs
  if (el.tabCurrent) el.tabCurrent.addEventListener("click", () => setActiveTab("current"));
  if (el.tabHourly) el.tabHourly.addEventListener("click", () => setActiveTab("hourly"));
  if (el.tabDaily) el.tabDaily.addEventListener("click", () => setActiveTab("daily"));

  // Quick: add favourite via double click on results (optional)
  if (el.results) {
    el.results.addEventListener("dblclick", () => addFavouriteFromSelection());
  }
}

/* =========================
   SECURITY HELPERS
   ========================= */

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  return String(s ?? "").replaceAll('"', "%22");
}

/* =========================
   BOOTSTRAP
   ========================= */

async function init() {
  loadStateFromStorage();
  setActiveTab(state.activeTab);
  renderFavs();
  bindEvents();

  // Validate config early (friendly)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) showToast("Supabase keys missing (check config.js)");
  if (!OPENWEATHER_KEY) showToast("OpenWeather key missing (check config.js)");

  await loadCourses();

  // Restore previous selection OR pick a default
  if (state.selection) {
    renderResults();
    await refreshForecast();
  } else {
    state.selection = { type: "place", label: "London, GB", lat: 51.5074, lon: -0.1278 };
    persistSelection();
    renderResults();
    await refreshForecast();
  }
}

init().catch((e) => {
  console.error(e);
  setStatus("");
  if (el.results) el.results.innerHTML = `<section class="card">App error: ${escapeHtml(String(e.message || e))}</section>`;
});
