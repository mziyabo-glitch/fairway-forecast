/* =====================================================
   Fairway Forecast – app.js (PRODUCTION BUILD)

   This version uses static OSM-based course datasets
   for GitHub Pages deployment.

   Data © OpenStreetMap contributors (ODbL)
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const APP = window.APP_CONFIG || {};
  // Allow empty-string to mean "same-origin" (e.g. call `/weather` on this domain)
  const API_BASE =
    typeof APP.WORKER_BASE_URL === "string" ? APP.WORKER_BASE_URL : "https://fairway-forecast-api.mziyabo.workers.dev";
  const MAX_RESULTS = 12;

  const COURSE_CACHE_TTL_MS = 10 * 60 * 1000;
  const WEATHER_CACHE_TTL_MS = 3 * 60 * 1000;

  /* ---------- STATIC DATASET CONFIG ---------- */
  // Static datasets only (no Supabase / no external course APIs).
  const USE_LOCAL_DATASETS = APP.USE_LOCAL_DATASETS !== false;
  const USE_STATIC_DATASETS = USE_LOCAL_DATASETS && APP.FEATURE_STATIC_DATASETS !== false;
  const DATASET_BASE_PATH = APP.DATASET_BASE_PATH || "data/courses";
  let COUNTRIES = APP.COUNTRIES || [
    { code: "gb", name: "United Kingdom", flag: "🇬🇧" },
    { code: "us", name: "United States", flag: "🇺🇸" },
    { code: "au", name: "Australia", flag: "🇦🇺" },
    { code: "za", name: "South Africa", flag: "🇿🇦" },
    { code: "fr", name: "France", flag: "🇫🇷" },
    { code: "se", name: "Sweden", flag: "🇸🇪" },
    { code: "de", name: "Germany", flag: "🇩🇪" },
  ];
  const DEFAULT_COUNTRY = APP.DEFAULT_COUNTRY || "gb";

  // Dataset cache
  const datasetCache = new Map();
  let currentCountry = localStorage.getItem("ff_country") || DEFAULT_COUNTRY;
  let currentState = localStorage.getItem("ff_state") || "";
  let currentFuse = null; // Fuse.js instance for current dataset
  let usStates = []; // US states index
  let currentDocs = []; // current dataset as objects (for nearby search)
  let coursesIndex = null; // data/courses/index.json cache

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const locationSlot = $("locationSlot") || resultsEl;
  const forecastSlot = $("forecastSlot") || resultsEl;
  const searchResultsSlot = $("searchResultsSlot") || null;
  const playabilityScoreEl = $("playabilityScore");
  const challengeRating = $("challengeRating");
  const challengeReason = $("challengeReason");
  
  // Country/State selectors (dev only)
  const countrySelect = $("countrySelect");
  const stateSelect = $("stateSelect");
  const stateSelectRow = $("stateSelectRow");
  // DEV NOTE: Course-request UI is intentionally disabled in DEV.

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const geoBtn = $("btnGeo") || $("geoBtn");
  const unitsSelect = $("unitsSelect") || $("units");

  // Round Selection Tool controls (DEV)
  const roundPreset18 = $("roundPreset18");
  const roundPreset9 = $("roundPreset9");
  const roundPresetSociety = $("roundPresetSociety");
  const societyControls = $("societyControls");
  const societyGroups = $("societyGroups");
  const teeSheetSlot = $("teeSheetSlot");

  const verdictCard = $("verdictCard");
  const verdictIcon = $("verdictIcon");
  const verdictLabel = $("verdictLabel");
  const verdictReason = $("verdictReason");
  const verdictBestTime = $("verdictBestTime");
  const verdictQuickStats = $("verdictQuickStats");
  const localTimeEl = $("localTime");
  const gmtTimeEl = $("gmtTime");

  const infoModal = $("infoModal");
  const infoModalTitle = $("infoModalTitle");
  const infoModalBody = $("infoModalBody");
  const infoModalClose = $("infoModalClose");

  // Course difficulty elements
  const courseDifficultySection = $("courseDifficultySection");
  const difficultyBadge = $("difficultyBadge");
  const slopeValue = $("slopeValue");
  const ratingValue = $("ratingValue");
  const parValue = $("parValue");

  if (!resultsEl) {
    console.warn("Missing #results. App halted safely.");
    return;
  }

  /* ---------- STATE ---------- */
  let selectedCourse = null;
  let lastNorm = null;
  let activeTab = "current";
  let nearbyCourses = [];
  let courseDirection = ""; // N, NE, E, SE, S, SW, W, NW or ""
  let lastWeatherUpdate = null;

  /* ---------- SAFE HTML ---------- */
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const units = () => (unitsSelect?.value === "imperial" ? "imperial" : "metric");
  const tempUnit = () => (units() === "imperial" ? "°F" : "°C");
  const windUnit = () => (units() === "imperial" ? "mph" : "m/s");
  
  // Round numbers for display
  function roundNum(n, decimals = 0) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    return decimals === 0 ? Math.round(n) : Number(n.toFixed(decimals));
  }
  
  // Convert wind speed to mph for golf impact calculations
  function windSpeedMph(windSpeed) {
    if (typeof windSpeed !== "number" || !Number.isFinite(windSpeed)) return null;
    return units() === "imperial" ? windSpeed : windSpeed * 2.237; // m/s to mph
  }
  
  // Calculate wind impact relative to course direction
  function calculateWindImpact(windDeg, courseDir) {
    if (!windDeg || !courseDir) return null;
    
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const windDir = windDirection(windDeg);
    if (!windDir) return null;
    
    const windIdx = dirs.indexOf(windDir);
    const courseIdx = dirs.indexOf(courseDir);
    
    if (windIdx === -1 || courseIdx === -1) return null;
    
    // Calculate angle difference (0-180 degrees)
    let diff = Math.abs(windIdx - courseIdx);
    if (diff > 8) diff = 16 - diff;
    
    // 0-2: Into wind, 3-5: Cross wind, 6-8: Helping wind
    if (diff <= 2) return "Into";
    if (diff <= 5) return "Cross";
    return "Helping";
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  // Calculate distance between two coordinates using Haversine formula (returns km)
  function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
      return null;
    }
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function iso2ToFlagEmoji(code) {
    const c = String(code || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return "";
    const A = 0x1f1e6;
    const cc = c.charCodeAt(0) - 65;
    const dd = c.charCodeAt(1) - 65;
    return String.fromCodePoint(A + cc, A + dd);
  }

  async function loadCoursesIndex() {
    if (coursesIndex) return coursesIndex;
    const url = `${DATASET_BASE_PATH}/index.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== "object") return null;
      coursesIndex = data;
      return coursesIndex;
    } catch {
      return null;
    }
  }

  async function maybeHydrateCountriesFromIndex() {
    if (!USE_LOCAL_DATASETS) return;
    const idx = await loadCoursesIndex();
    const list = Array.isArray(idx?.countries) ? idx.countries : null;
    if (!list) return;

    const mapped = [];
    for (const c of list) {
      const code = String(c?.code || "").toUpperCase();
      const name = String(c?.name || "").trim();
      if (!code || !name) continue;
      if (code === "US") {
        mapped.push({ code: "us", name, flag: iso2ToFlagEmoji("US") });
      } else {
        mapped.push({ code: code.toLowerCase(), name, flag: iso2ToFlagEmoji(code) });
      }
    }

    if (mapped.length > 0) COUNTRIES = mapped;
  }

  function pct(pop) {
    return typeof pop === "number" ? `${Math.round(pop * 100)}%` : "";
  }

  function setRoundMode(mode) {
    roundMode = mode;
    if (mode === "9") roundDurationHours = 2;
    else roundDurationHours = 4; // 18 + society default

    // UI state
    const setActive = (btn, active) => {
      if (!btn) return;
      btn.classList.toggle("active", active);
    };
    setActive(roundPreset18, mode === "18");
    setActive(roundPreset9, mode === "9");
    setActive(roundPresetSociety, mode === "society");

    if (societyControls) societyControls.style.display = mode === "society" ? "block" : "none";

    // Update duration subtitle
    const durationSubtitle = $("durationSubtitle");
    if (durationSubtitle) {
      if (mode === "9") {
        durationSubtitle.textContent = "9-hole round (~2 hours)";
      } else if (mode === "society") {
        durationSubtitle.textContent = "Society tee sheet selected";
      } else {
        durationSubtitle.textContent = "18-hole round (~4 hours)";
      }
    }

    // Re-render tee strip and tee sheet if available
    if (lastNorm) {
      renderTeeTimeStrip(lastNorm);
      // Also update weather timeline and pro-tip (if functions are available)
      if (typeof renderWeatherTimeline === "function") renderWeatherTimeline(lastNorm);
      if (typeof renderProTip === "function") renderProTip(lastNorm);
    }
  }

  function renderTeeSheet(norm) {
    if (!teeSheetSlot) return;
    if (roundMode !== "society" || !selectedTeeTime || !norm) {
      teeSheetSlot.style.display = "none";
      teeSheetSlot.innerHTML = "";
      return;
    }

    const groups = Math.max(2, Math.min(60, Number(societyGroups?.value || 12)));
    const tzOff = norm?.timezoneOffset || null;

    const slots = [];
    for (let i = 0; i < groups; i++) {
      const t = selectedTeeTime + (i * 8 * 60);
      slots.push(t);
    }

    const chips = slots
      .slice(0, 48) // keep rendering light on mobile
      .map((t, idx) => `<div class="ff-tee-sheet-slot">${idx + 1}. ${esc(fmtTimeCourse(t, tzOff))}</div>`)
      .join("");

    const more = slots.length > 48 ? `<div class="ff-hint" style="margin-top:8px;">Showing first 48 tee times.</div>` : "";

    teeSheetSlot.innerHTML = `
      <div class="ff-tee-sheet-title">Society tee sheet · ${groups} groups · 8‑min spacing</div>
      <div class="ff-tee-sheet-grid">${chips}</div>
      ${more}
    `;
    teeSheetSlot.style.display = "block";
  }

  // Format time at course location (using course timezone offset)
  // tsSeconds: Unix timestamp in seconds
  // tzOffset: Course timezone offset in seconds (from weather API)
  function fmtTimeCourse(tsSeconds, tzOffset = null) {
    if (!tsSeconds) return "";
    
    if (tzOffset !== null && typeof tzOffset === "number") {
      // Convert to course local time
      const courseDate = new Date((tsSeconds + tzOffset) * 1000);
      const h = courseDate.getUTCHours().toString().padStart(2, '0');
      const m = courseDate.getUTCMinutes().toString().padStart(2, '0');
      return `${h}:${m}`;
    }
    
    // Fallback to device local time
    const date = new Date(tsSeconds * 1000);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  /**
   * Format tee time label in premium format: "Today · 14:19", "Tomorrow · 09:10", "Sun 4 · 10:45"
   * @param {number} tsSeconds - Unix timestamp in seconds
   * @param {number} tzOffset - Timezone offset in seconds
   * @returns {string} Formatted label
   */
  function formatTeeLabel(tsSeconds, tzOffset = null) {
    if (!tsSeconds) return "—";
    
    const now = new Date();
    const teeDate = new Date(tsSeconds * 1000);
    
    // Get time in course local timezone
    const time = fmtTimeCourse(tsSeconds, tzOffset);
    
    // Determine day label
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const teeDay = new Date(teeDate);
    teeDay.setHours(0, 0, 0, 0);
    
    let dayLabel;
    if (teeDay.getTime() === today.getTime()) {
      dayLabel = "Today";
    } else if (teeDay.getTime() === tomorrow.getTime()) {
      dayLabel = "Tomorrow";
    } else {
      const dayName = teeDate.toLocaleDateString([], { weekday: "short" });
      const dayNum = teeDate.getDate();
      dayLabel = `${dayName} ${dayNum}`;
    }
    
    return `${dayLabel} · ${time}`;
  }
  
  // Legacy fmtTime - uses device local time (for backward compatibility)
  function fmtTime(tsSeconds, showGMT = false) {
    if (!tsSeconds) return "";
    const date = new Date(tsSeconds * 1000);
    const localTime = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (showGMT) {
      const gmtTime = date.toUTCString().match(/\d{2}:\d{2}/)?.[0] || "";
      return `${localTime} (GMT ${gmtTime})`;
    }
    return localTime;
  }
  
  // Get both course local time and device time
  function getCourseAndDeviceTime(tsSeconds, timezoneOffset = null) {
    if (!tsSeconds) return { course: "", device: "" };
    
    const date = new Date(tsSeconds * 1000);
    
    // Device local time
    const device = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    
    // Course local time (using timezone offset)
    let course = "";
    if (timezoneOffset !== null && typeof timezoneOffset === "number") {
      const courseDate = new Date((tsSeconds + timezoneOffset) * 1000);
      const h = courseDate.getUTCHours().toString().padStart(2, '0');
      const m = courseDate.getUTCMinutes().toString().padStart(2, '0');
      course = `${h}:${m}`;
    } else {
      course = device; // Fallback to device time
    }
    
    return { course, device };
  }

  function fmtDay(tsSeconds) {
    if (!tsSeconds) return "";
    return new Date(tsSeconds * 1000).toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function setActiveTab(next) {
    activeTab = next;
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    if (next === "current" && tabCurrent) tabCurrent.classList.add("active");
    if (next === "hourly" && tabHourly) tabHourly.classList.add("active");
    if (next === "daily" && tabDaily) tabDaily.classList.add("active");
    renderAll();
    
    // Smooth scroll to forecast section
    const forecastSection = $("results") || forecastSlot;
    if (forecastSection) {
      setTimeout(() => {
        forecastSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }

  function setBtnLoading(isLoading, label = "Search") {
    if (!searchBtn) {
      console.warn("[UI] Search button not found");
      return;
    }
    try {
      searchBtn.dataset._label ??= searchBtn.textContent || label;
      searchBtn.disabled = !!isLoading;
      searchBtn.textContent = isLoading ? "Searching…" : searchBtn.dataset._label;
      console.log(`[UI] Search button: ${isLoading ? "disabled" : "enabled"}`);
    } catch (err) {
      console.error("[UI] Failed to update search button:", err);
      // Force enable button on error
      searchBtn.disabled = false;
      searchBtn.textContent = label;
    }
  }

  function showMessage(msg) {
    // Only show messages in forecast slot, never in search results slot
    if (forecastSlot) {
      forecastSlot.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
    } else if (resultsEl && !searchResultsSlot) {
      // Only use resultsEl if searchResultsSlot doesn't exist
      resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
    }
  }

  function showError(msg, extra = "") {
    const hint = extra ? `<div class="ff-sub muted" style="margin-top:8px">${esc(extra)}</div>` : "";
    const html = `<div class="ff-card">
      <div class="ff-big">⚠️</div>
      <div>${esc(msg)}</div>${hint}
    </div>`;

    console.log(`[UI] Showing error: ${msg}`);

    // Show error in search results slot if it exists (for search errors), otherwise forecast slot
    if (searchResultsSlot) {
      searchResultsSlot.classList.remove("ff-hidden");
      searchResultsSlot.innerHTML = html;
    } else if (forecastSlot) {
      forecastSlot.innerHTML = html;
    } else if (resultsEl) {
      resultsEl.innerHTML = html;
    }
  }

  function renderStarRating(rating, maxRating = 5) {
    if (typeof rating !== "number" || !Number.isFinite(rating)) return "";
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = maxRating - fullStars - (hasHalfStar ? 1 : 0);
    
    let stars = "";
    for (let i = 0; i < fullStars; i++) stars += "⭐";
    if (hasHalfStar) stars += "½";
    for (let i = 0; i < emptyStars; i++) stars += "☆";
    
    return `<span class="ff-rating-stars" title="${rating.toFixed(1)} out of ${maxRating}">${stars}</span>`;
  }

  function iconHtml(weatherArr, size = 2) {
    const main = Array.isArray(weatherArr) ? weatherArr?.[0]?.main : "";
    const desc = Array.isArray(weatherArr) ? weatherArr?.[0]?.description : "";

    // High-contrast emoji-based icons so they never look washed out
    const key = (main || desc || "").toLowerCase();
    let emoji = "🌤️";
    if (key.includes("rain") || key.includes("drizzle")) emoji = "🌧️";
    else if (key.includes("storm") || key.includes("thunder")) emoji = "⛈️";
    else if (key.includes("snow")) emoji = "❄️";
    else if (key.includes("cloud")) emoji = "☁️";
    else if (key.includes("fog") || key.includes("mist") || key.includes("haze")) emoji = "🌫️";
    else if (key.includes("clear")) emoji = "☀️";

    const sizeClass = size >= 4 ? "ff-wicon--xl" : size <= 1 ? "ff-wicon--sm" : "ff-wicon--lg";

    return `<div class="ff-wicon ${sizeClass}" aria-label="${esc(desc || main || "Weather")}">${emoji}</div>`;
  }

  /* ---------- WIND DIRECTION HELPERS ---------- */
  function windDirection(deg) {
    if (typeof deg !== "number" || !Number.isFinite(deg)) return null;
    const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const idx = Math.round(deg / 22.5) % 16;
    return dirs[idx];
  }

  function windCompassHtml(deg, speed) {
    if (typeof deg !== "number" || !Number.isFinite(deg)) return "";
    const dir = windDirection(deg);
    const rotation = deg;
    return `<div class="ff-wind-compass" title="Wind from ${dir}">
      <svg width="32" height="32" viewBox="0 0 32 32" class="ff-compass-bg">
        <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.2"/>
        <line x1="16" y1="16" x2="16" y2="6" stroke="currentColor" stroke-width="2" opacity="0.3"/>
        <text x="16" y="10" text-anchor="middle" font-size="8" fill="currentColor" opacity="0.6">N</text>
      </svg>
      <svg width="32" height="32" viewBox="0 0 32 32" class="ff-compass-arrow" style="transform: rotate(${rotation}deg);">
        <line x1="16" y1="16" x2="16" y2="8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        <polygon points="16,8 14,12 18,12" fill="currentColor"/>
      </svg>
    </div>`;
  }

  /* ---------- MINI CHART HELPERS ---------- */
  function miniBarChart(values, maxValue, color = "var(--brand)") {
    if (!Array.isArray(values) || values.length === 0) return "";
    const max = Math.max(...values.filter(v => typeof v === "number"), 1);
    const bars = values.map((v, i) => {
      const height = typeof v === "number" ? Math.max((v / max) * 100, 5) : 5;
      return `<div class="ff-mini-bar" style="height:${height}%; background:${color};" title="${v}"></div>`;
    }).join("");
    return `<div class="ff-mini-chart">${bars}</div>`;
  }

  /* ---------- LOCAL STORAGE (FAVOURITES) ---------- */
  const LS_FAVS = "ff_favourites_v1";

  function loadFavs() {
    try {
      const raw = localStorage.getItem(LS_FAVS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveFavs(list) {
    try {
      localStorage.setItem(LS_FAVS, JSON.stringify(list));
    } catch {}
  }

  function favKey(course) {
    const id = course?.id ? String(course.id) : "";
    const lat = Number(course?.lat);
    const lon = Number(course?.lon);
    if (id) return `id:${id}`;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return `ll:${lat.toFixed(5)},${lon.toFixed(5)}`;
    return `name:${(course?.name || "").toLowerCase()}`;
  }

  function isFavourited(course) {
    const favs = loadFavs();
    const key = favKey(course);
    return favs.some((f) => f?.key === key);
  }

  function toggleFavourite(course) {
    if (!course) return;
    const favs = loadFavs();
    const key = favKey(course);
    const idx = favs.findIndex((f) => f?.key === key);

    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.unshift({
        key,
        id: course.id ?? null,
        name: course.name ?? "",
        city: course.city ?? "",
        state: course.state ?? "",
        country: course.country ?? "",
        lat: course.lat ?? null,
        lon: course.lon ?? null,
        addedAt: Date.now(),
      });
      if (favs.length > 24) favs.length = 24;
    }

    saveFavs(favs);
    renderAll();
  }

  /* ---------- IN-MEMORY CACHE ---------- */
  const memCache = {
    courses: new Map(),
    weather: new Map(),
  };

  function cacheGet(map, key, ttlMs) {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttlMs) {
      map.delete(key);
      return null;
    }
    return hit.data;
  }

  function cacheSet(map, key, data) {
    map.set(key, { t: Date.now(), data });
  }

  /* ---------- STATIC DATASET FUNCTIONS ---------- */

  /**
   * Load a dataset JSON file
   * @param {string} path - Path relative to DATASET_BASE_PATH
   * @returns {Promise<Array>} Array of courses [name, lat, lon, region]
   */
  async function loadDataset(path) {
    const fullPath = `${DATASET_BASE_PATH}/${path}`;
    
    // Check cache first
    if (datasetCache.has(fullPath)) {
      console.log(`📂 [Dataset] Using cached: ${path}`);
      return datasetCache.get(fullPath);
    }

    console.log(`📂 [Dataset] Loading: ${fullPath}`);
    
    try {
      const res = await fetch(fullPath);
      if (!res.ok) {
        console.warn(`📂 [Dataset] Failed to load ${path}: ${res.status}`);
        return [];
      }
      
      const data = await res.json();
      
      // Cache the result
      datasetCache.set(fullPath, data);
      console.log(`📂 [Dataset] Loaded ${data.length} courses from ${path}`);
      
      return data;
    } catch (err) {
      console.error(`📂 [Dataset] Error loading ${path}:`, err);
      return [];
    }
  }

  /**
   * Load the US states index
   * @returns {Promise<Array>} Array of state objects { code, name, count }
   */
  async function loadUSStatesIndex() {
    if (usStates.length > 0) return usStates;
    
    try {
      const data = await loadDataset("us_index.json");
      // New schema: { updated, states: [...], total }
      if (data && typeof data === "object" && Array.isArray(data.states)) {
        usStates = data.states;
      } else {
        // Backward compat: older schema was an array
        usStates = Array.isArray(data) ? data : [];
      }
      return usStates;
    } catch (err) {
      console.warn(`📂 [Dataset] Failed to load US states index`);
      return [];
    }
  }

  /**
   * Load courses for the current country/state selection
   * @returns {Promise<Array>} Array of courses [name, lat, lon, region]
   */
  async function loadCurrentDataset() {
    let courses = [];
    
    if (currentCountry === "us") {
      // Load specific US state
      if (currentState) {
        courses = await loadDataset(`us/${currentState}.json`);
      }
    } else {
      // Load country dataset
      courses = await loadDataset(`${currentCountry}.json`);
    }
    
    return courses;
  }

  /**
   * Initialize Fuse.js for the current dataset
   * @param {Array} courses - Array of courses [name, lat, lon, region]
   */
  function initFuseSearch(courses) {
    if (!window.Fuse) {
      console.warn("⚠️ Fuse.js not loaded - search will be basic");
      currentFuse = null;
      return;
    }
    
    // Transform to objects for Fuse
    const docs = courses.map((c, idx) => ({
      idx,
      name: c[0] || "",
      lat: c[1],
      lon: c[2],
      region: c[3] || ""
    }));
    currentDocs = docs;
    
    currentFuse = new Fuse(docs, {
      keys: ["name"],
      threshold: 0.35, // Fuzzy matching tolerance
      distance: 200,
      minMatchCharLength: 2,
      includeScore: true,
      shouldSort: true,
    });
    
    console.log(`🔍 [Fuse] Initialized with ${docs.length} courses`);
  }

  /**
   * Search courses using Fuse.js
   * @param {string} query - Search query
   * @param {number} limit - Max results
   * @returns {Array} Array of matching courses as normalized objects
   */
  function searchCoursesStatic(query, limit = MAX_RESULTS) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];
    
    if (!currentFuse) {
      console.warn("⚠️ Fuse not initialized");
      return [];
    }
    
    const results = currentFuse.search(q, { limit });
    
    return results.map(r => ({
      id: `static-${r.item.idx}`,
      name: r.item.name,
      lat: r.item.lat,
      lon: r.item.lon,
      country: currentCountry.toUpperCase(),
      state: r.item.region,
      city: r.item.region,
      source: "osm",
      score: r.score
    }));
  }

  /**
   * Initialize country/state selectors
   */
  async function initCountryStateSelectors() {
    if (!countrySelect) return;
    
    // Prefer the dynamic catalog if available (data/courses/index.json)
    await maybeHydrateCountriesFromIndex();

    // Populate country dropdown
    countrySelect.innerHTML = COUNTRIES.map(c => 
      `<option value="${c.code}" ${c.code === currentCountry ? "selected" : ""}>${c.flag} ${c.name}</option>`
    ).join("");
    
    // Country change handler
    countrySelect.addEventListener("change", async (e) => {
      currentCountry = e.target.value;
      currentState = "";
      localStorage.setItem("ff_country", currentCountry);
      localStorage.setItem("ff_state", "");
      
      // Show/hide state selector for US
      if (currentCountry === "us") {
        await populateUSStates();
        setStateSelectorVisible(true);
      } else {
        setStateSelectorVisible(false);
        await refreshDataset();
      }
      
    });
    
    // State change handler
    if (stateSelect) {
      stateSelect.addEventListener("change", async (e) => {
        currentState = e.target.value;
        localStorage.setItem("ff_state", currentState);
        
        if (currentState) {
          await refreshDataset();
        }
      });
    }
    
    // Initial setup
    if (currentCountry === "us") {
      populateUSStates().then(() => {
        setStateSelectorVisible(true);
        if (currentState) {
          stateSelect.value = currentState;
          refreshDataset();
        }
      });
    } else {
      setStateSelectorVisible(false);
      refreshDataset();
    }
    
  }

  /**
   * Populate US states dropdown
   */
  async function populateUSStates() {
    if (!stateSelect) return;
    
    stateSelect.innerHTML = '<option value="">Select a state...</option>';
    
    const states = await loadUSStatesIndex();
    
    for (const state of states) {
      const opt = document.createElement("option");
      opt.value = state.code;
      opt.textContent = `${state.name} (${state.count} courses)`;
      if (state.code === currentState) opt.selected = true;
      stateSelect.appendChild(opt);
    }
  }

  /**
   * Refresh the current dataset and reinitialize Fuse
   */
  async function refreshDataset() {
    // Show loading state
    if (searchInput) {
      searchInput.placeholder = "Loading courses...";
      searchInput.disabled = true;
    }
    if (searchBtn) searchBtn.disabled = true;
    
    try {
      if (searchResultsSlot) {
        searchResultsSlot.classList.remove("ff-hidden");
        searchResultsSlot.innerHTML = `<div class="ff-card"><div class="ff-inline-status"><span class="ff-spinner" aria-hidden="true"></span>Loading courses…</div></div>`;
      }
      const courses = await loadCurrentDataset();
      initFuseSearch(courses);
      
      // Update placeholder
      const countryName = COUNTRIES.find(c => c.code === currentCountry)?.name || currentCountry.toUpperCase();
      const regionName = currentCountry === "us" && currentState 
        ? usStates.find(s => s.code === currentState)?.name || currentState
        : countryName;
      
      if (searchInput) {
        searchInput.placeholder = `Search ${courses.length.toLocaleString()} courses in ${regionName}...`;
        searchInput.disabled = false;
      }
      if (searchBtn) searchBtn.disabled = false;
      clearSearchResults();
      
    } catch (err) {
      console.error("Failed to load dataset:", err);
      if (searchInput) {
        searchInput.placeholder = "Failed to load courses";
        searchInput.disabled = false;
      }
      if (searchBtn) searchBtn.disabled = false;
    }
  }

  function setStateSelectorVisible(visible) {
    // Update both the old stateSelectRow and new inline stateSelectWrap
    if (stateSelectRow) {
      stateSelectRow.style.display = visible ? "block" : "none";
    }
    const stateSelectWrap = $("stateSelectWrap");
    if (stateSelectWrap) {
      stateSelectWrap.style.display = visible ? "block" : "none";
    }
    if (stateSelect && !visible) {
      stateSelect.value = "";
      stateSelect.innerHTML = '<option value="">All states</option>';
    }
  }

  /* ---------- API ---------- */
  async function apiGet(path) {
    const url = `${API_BASE}${path}`;

    // hard timeout so it NEVER hangs forever
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);

    try {
      const res = await fetch(url, { method: "GET", signal: ctrl.signal });

      // Handle rate limiting first
      if (res.status === 429) {
        const err = new Error("HTTP 429 Too Many Requests - Rate limit exceeded");
        err.status = 429;
        err.name = "RateLimitError";
        clearTimeout(t);
        throw err;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`HTTP ${res.status} ${res.statusText}${text ? `: ${text.substring(0, 100)}` : ""}`.trim());
        err.status = res.status;
        err.name = res.status >= 500 ? "ServerError" : "ClientError";
        console.error(`[API] Request failed: ${url}`, err);
        clearTimeout(t);
        throw err;
      }

      const data = await res.json();
      clearTimeout(t);
      return data;
    } catch (err) {
      clearTimeout(t);
      if (err.name === "AbortError") {
        err.name = "TimeoutError";
        err.message = "Request timed out after 15 seconds";
      }
      throw err;
    }
  }

  // Supabase is intentionally not used in DEV.

  /* ---------- GEOCODING (City/Town lookup) ---------- */
  async function geocodeCity(query) {
    const q = (query || "").trim();
    if (!q) return null;

    // Check if query looks like a city (no golf keywords)
    const golfKeywords = /golf|club|course|gc|links|country club/i;
    if (golfKeywords.test(q)) return null; // Likely a course name, not a city

    try {
      console.log(`🌍 [Geocode] Looking up city: "${q}"`);
      // Worker returns array directly (OpenWeather format)
      const data = await apiGet(`/geocode?q=${encodeURIComponent(q)}&limit=1`);
      
      // Handle both array response (from worker) and wrapped response (fallback)
      const locations = Array.isArray(data) ? data : (Array.isArray(data?.locations) ? data.locations : []);
      
      if (locations.length > 0) {
        const loc = locations[0];
        const lat = typeof loc.lat === "number" ? loc.lat : null;
        const lon = typeof loc.lon === "number" ? loc.lon : null;
        const name = loc.name || loc.local_names?.en || q;
        const country = loc.country || "";
        const state = loc.state || "";

        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          console.log(`✅ [Geocode] Found: ${name} (${lat}, ${lon})`);
          return { name, lat, lon, country, state, city: name };
        }
      }
      console.log(`⚠️ [Geocode] No location found`);
      return null;
    } catch (err) {
      console.warn("⚠️ [Geocode] Failed", err);
      return null;
    }
  }

  async function fetchCourses(query) {
    const q = (query || "").trim();
    if (!q) {
      console.warn(`[Search] Empty query provided`);
      return [];
    }

    // DEV local datasets only: never call Supabase or external golf-course APIs.
    if (!USE_STATIC_DATASETS) return [];

    if (!currentFuse) {
      // Dataset might not be loaded yet (e.g. user typed immediately after switching)
      await refreshDataset();
    }

    console.log(`🔍 [Static] Searching for: "${q}"`);
    const results = searchCoursesStatic(q);
    console.log(`📊 [Static] Found ${results.length} course(s)`);
    return results;
  }

  async function fetchNearbyCourses(lat, lon, radiusKm = 10, maxResults = 5) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

    if (!USE_STATIC_DATASETS || currentDocs.length === 0) return [];

    const nearby = [];
    const currentCourseId = selectedCourse?.id;

    for (const d of currentDocs) {
      const dLat = Number(d.lat);
      const dLon = Number(d.lon);
      if (!Number.isFinite(dLat) || !Number.isFinite(dLon)) continue;

      const distance = calculateDistance(lat, lon, dLat, dLon);
      if (distance === null || distance > radiusKm) continue;

      const id = `static-${d.idx}`;
      if (currentCourseId && id === currentCourseId) continue;

      nearby.push({
        id,
        name: d.name,
        lat: dLat,
        lon: dLon,
        country: currentCountry.toUpperCase(),
        state: d.region,
        city: d.region,
        source: "osm",
        distance,
      });
    }

    nearby.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    return nearby.slice(0, maxResults);
  }

  async function fetchWeather(lat, lon) {
    const u = units();
    const key = `${u}|${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
    const cached = cacheGet(memCache.weather, key, WEATHER_CACHE_TTL_MS);
    if (cached) return cached;

    const data = await apiGet(`/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${u}`);
    cacheSet(memCache.weather, key, data);
    return data;
  }

  /* ---------- NORMALIZE WEATHER ---------- */
  function normalizeWeather(raw) {
    const norm = { current: null, hourly: [], daily: [], sunrise: null, sunset: null, timezone: null, timezoneOffset: null };
    if (!raw || typeof raw !== "object") return norm;

    norm.sunrise = raw?.current?.sunrise ?? raw?.city?.sunrise ?? null;
    norm.sunset = raw?.current?.sunset ?? raw?.city?.sunset ?? null;
    norm.timezone = raw?.city?.timezone ?? null;
    norm.timezoneOffset = typeof raw?.city?.timezone === "number" ? raw.city.timezone : null;

    // current
    if (raw?.current) {
      const c = raw.current;
      norm.current = {
        dt: c.dt ?? null,
        temp: typeof c.temp === "number" ? c.temp : null,
        feels_like: typeof c.feels_like === "number" ? c.feels_like : null,
        humidity: typeof c.humidity === "number" ? c.humidity : null,
        wind_speed: typeof c?.wind?.speed === "number" ? c.wind.speed : null,
        wind_gust: typeof c?.wind?.gust === "number" ? c.wind.gust : null,
        wind_deg: typeof c?.wind?.deg === "number" ? c.wind.deg : typeof c?.wind_deg === "number" ? c.wind_deg : null,
        pop: typeof c.pop === "number" ? c.pop : 0,
        rain_mm:
          typeof c?.rain?.["1h"] === "number"
            ? c.rain["1h"]
            : typeof c?.rain?.["3h"] === "number"
            ? c.rain["3h"]
            : null,
        weather: Array.isArray(c.weather) ? c.weather : [],
      };
    } else if (Array.isArray(raw?.list) && raw.list.length) {
      const first = raw.list[0];
      norm.current = {
        dt: first.dt ?? null,
        temp: typeof first?.main?.temp === "number" ? first.main.temp : null,
        feels_like: typeof first?.main?.feels_like === "number" ? first.main.feels_like : null,
        humidity: typeof first?.main?.humidity === "number" ? first.main.humidity : null,
        wind_speed: typeof first?.wind?.speed === "number" ? first.wind.speed : null,
        wind_gust: typeof first?.wind?.gust === "number" ? first.wind.gust : null,
        wind_deg: typeof first?.wind?.deg === "number" ? first.wind.deg : null,
        pop: typeof first?.pop === "number" ? first.pop : 0,
        rain_mm:
          typeof first?.rain?.["1h"] === "number"
            ? first.rain["1h"]
            : typeof first?.rain?.["3h"] === "number"
            ? first.rain["3h"]
            : null,
        weather: Array.isArray(first?.weather) ? first.weather : [],
      };
      norm.sunrise = norm.sunrise ?? raw?.city?.sunrise ?? null;
      norm.sunset = norm.sunset ?? raw?.city?.sunset ?? null;
      norm.timezoneOffset = norm.timezoneOffset ?? (typeof raw?.city?.timezone === "number" ? raw.city.timezone : null);
    }
    
    // Ensure timezoneOffset is set from city data
    if (norm.timezoneOffset === null && typeof raw?.city?.timezone === "number") {
      norm.timezoneOffset = raw.city.timezone;
    }

    // hourly from forecast list
    if (Array.isArray(raw?.list) && raw.list.length) {
      norm.hourly = raw.list.slice(0, 16).map((it) => ({
        dt: it.dt,
        temp: it?.main?.temp ?? null,
        pop: typeof it?.pop === "number" ? it.pop : 0,
        wind_speed: it?.wind?.speed ?? null,
        wind_deg: typeof it?.wind?.deg === "number" ? it.wind.deg : null,
        rain_mm:
          typeof it?.rain?.["1h"] === "number"
            ? it.rain["1h"]
            : typeof it?.rain?.["3h"] === "number"
            ? it.rain["3h"]
            : null,
        weather: Array.isArray(it?.weather) ? it.weather : [],
      }));
    }

    // daily derived from list grouped by day, pick icon nearest noon
    if (Array.isArray(raw?.list) && raw.list.length) {
      const byDay = new Map();

      for (const it of raw.list) {
        const dt = it.dt;
        if (!dt) continue;

        const dateKey = new Date(dt * 1000).toLocaleDateString();
        const tMin = it?.main?.temp_min;
        const tMax = it?.main?.temp_max;
        const pop = typeof it?.pop === "number" ? it.pop : null;

        const hour = new Date(dt * 1000).getHours();
        const distToNoon = Math.abs(hour - 12);

        if (!byDay.has(dateKey)) {
          byDay.set(dateKey, {
            dt,
            min: typeof tMin === "number" ? tMin : null,
            max: typeof tMax === "number" ? tMax : null,
            popMax: typeof pop === "number" ? pop : null,
            bestNoonDist: distToNoon,
            bestWeather: Array.isArray(it?.weather) ? it.weather : [],
          });
        } else {
          const d = byDay.get(dateKey);
          if (typeof tMin === "number") d.min = d.min === null ? tMin : Math.min(d.min, tMin);
          if (typeof tMax === "number") d.max = d.max === null ? tMax : Math.max(d.max, tMax);
          if (typeof pop === "number") d.popMax = d.popMax === null ? pop : Math.max(d.popMax, pop);

          if (distToNoon < d.bestNoonDist) {
            d.bestNoonDist = distToNoon;
            d.bestWeather = Array.isArray(it?.weather) ? it.weather : d.bestWeather;
          }
        }
      }

      norm.daily = Array.from(byDay.values())
        .sort((a, b) => (a.dt ?? 0) - (b.dt ?? 0))
        .slice(0, 7)
        .map((d) => ({
          dt: d.dt,
          min: d.min,
          max: d.max,
          pop: d.popMax,
          weather: Array.isArray(d.bestWeather) ? d.bestWeather : [],
        }));
    }

    return norm;
  }

  /* ---------- COURSE DIFFICULTY ---------- */
  // Calculate course difficulty from slope and rating
  // Slope: 55-155 (113 is standard), Rating: typically 67-77
  function calculateCourseDifficulty(course) {
    if (!course) return null;
    
    const slope = typeof course.slope === "number" ? course.slope : null;
    const rating = typeof course.rating === "number" ? course.rating : null;
    const par = typeof course.par === "number" ? course.par : 72;
    
    if (slope === null && rating === null) return null;
    
    let difficultyScore = 50; // Base score (medium)
    
    // Slope contribution (0-50 points)
    // 55 = easiest (0 points), 155 = hardest (50 points), 113 = standard (29 points)
    if (slope !== null) {
      const slopeNormalized = clamp((slope - 55) / 100, 0, 1);
      difficultyScore = slopeNormalized * 50;
    }
    
    // Rating contribution (0-50 points)
    // Rating above par increases difficulty
    if (rating !== null) {
      const ratingDiff = rating - par;
      // Typical range: -2 to +5 over par
      const ratingNormalized = clamp((ratingDiff + 2) / 7, 0, 1);
      if (slope !== null) {
        // Average with slope
        difficultyScore = (difficultyScore + ratingNormalized * 50) / 2;
      } else {
        difficultyScore = ratingNormalized * 50;
      }
    }
    
    // Scale to 1-5 difficulty rating
    const difficultyRating = 1 + (difficultyScore / 50) * 4;
    
    return {
      score: clamp(Math.round(difficultyRating * 10) / 10, 1, 5),
      slope,
      rating,
      par,
      label: getDifficultyLabel(difficultyRating)
    };
  }
  
  function getDifficultyLabel(score) {
    if (score <= 1.5) return { text: "Beginner", emoji: "🟢", class: "easy" };
    if (score <= 2.5) return { text: "Easy", emoji: "🟢", class: "easy" };
    if (score <= 3.0) return { text: "Moderate", emoji: "🟡", class: "moderate" };
    if (score <= 3.5) return { text: "Challenging", emoji: "🟠", class: "challenging" };
    if (score <= 4.2) return { text: "Difficult", emoji: "🔴", class: "difficult" };
    return { text: "Championship", emoji: "⚫", class: "championship" };
  }
  
  function renderCourseDifficulty(course) {
    if (!courseDifficultySection) return;
    
    const difficulty = calculateCourseDifficulty(course);
    
    if (!difficulty) {
      courseDifficultySection.style.display = "none";
      return;
    }
    
    courseDifficultySection.style.display = "block";
    courseDifficultySection.classList.add("ff-fade-in");
    
    if (difficultyBadge) {
      difficultyBadge.textContent = `${difficulty.label.emoji} ${difficulty.label.text}`;
      difficultyBadge.className = `ff-difficulty-badge ff-difficulty--${difficulty.label.class}`;
    }
    
    if (slopeValue) {
      slopeValue.textContent = difficulty.slope !== null ? difficulty.slope : "—";
    }
    
    if (ratingValue) {
      ratingValue.textContent = difficulty.rating !== null ? difficulty.rating.toFixed(1) : "—";
    }
    
    if (parValue) {
      parValue.textContent = difficulty.par !== null ? difficulty.par : "—";
    }
  }

  /* ---------- PLAYING CONDITIONS (Weather-based) ---------- */
  function calculatePlayingConditions(norm) {
    const c = norm?.current;
    if (!c) return { score: "--", factors: {} };

    let score = 10;
    const w = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const t = typeof c.temp === "number" ? c.temp : null;
    const pop = typeof c.pop === "number" ? c.pop : 0;
    const rainMm = typeof c.rain_mm === "number" ? c.rain_mm : 0;
    
    // Track weather factors for labeling
    const factors = {
      freezing: false,
      heavyRain: false,
      strongWind: false,
      hotTemp: false,
      coldTemp: false,
      rainy: false
    };

    // Wind impact (in m/s for metric, mph for imperial)
    const windMph = windSpeedMph(w) || 0;
    if (windMph > 25) { score -= 4; factors.strongWind = true; }
    else if (windMph > 18) { score -= 3; factors.strongWind = true; }
    else if (windMph > 12) { score -= 2; }
    else if (windMph > 8) { score -= 1; }

    // Rain amount impact (mm) - CRITICAL FACTOR
    if (rainMm > 5) { score -= 4; factors.heavyRain = true; }
    else if (rainMm > 3) { score -= 3; factors.rainy = true; }
    else if (rainMm > 1) { score -= 2; factors.rainy = true; }
    else if (rainMm > 0.5) { score -= 1; }

    // Rain probability impact (secondary to actual rain)
    if (pop >= 0.8 && !factors.heavyRain) { score -= 2; factors.rainy = true; }
    else if (pop >= 0.6 && !factors.rainy) { score -= 1; factors.rainy = true; }

    // Temperature comfort - FREEZING IS CRITICAL
    if (t !== null) {
      if (units() === "metric") {
        // Below 0°C = freezing = tough conditions
        if (t < 0) { score -= 5; factors.freezing = true; }
        else if (t < 5) { score -= 2; factors.coldTemp = true; }
        else if (t < 10) { score -= 1; factors.coldTemp = true; }
        // Hot weather
        if (t > 35) { score -= 3; factors.hotTemp = true; }
        else if (t > 30) { score -= 2; factors.hotTemp = true; }
        else if (t > 28) { score -= 1; }
      } else {
        // Below 32°F = freezing = tough conditions
        if (t < 32) { score -= 5; factors.freezing = true; }
        else if (t < 41) { score -= 2; factors.coldTemp = true; }
        else if (t < 50) { score -= 1; factors.coldTemp = true; }
        // Hot weather
        if (t > 95) { score -= 3; factors.hotTemp = true; }
        else if (t > 86) { score -= 2; factors.hotTemp = true; }
        else if (t > 82) { score -= 1; }
      }
    }

    return { 
      score: clamp(Math.round(score), 0, 10),
      factors,
      temp: t,
      rainMm,
      windMph
    };
  }
  
  // Keep old function name for compatibility - returns just the score
  function calculatePlayability(norm) {
    const result = calculatePlayingConditions(norm);
    return typeof result === "object" ? result.score : result;
  }

  function bestTimeToday(norm) {
    const sunrise = norm?.sunrise;
    const sunset = norm?.sunset;
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (!sunrise || !sunset || hourly.length === 0) return null;

    const start = sunrise + 3600;
    const end = sunset - 3600;
    const candidates = hourly.filter((h) => typeof h.dt === "number" && h.dt >= start && h.dt <= end);
    if (candidates.length === 0) return null;

    const pops = candidates.map((h) => (typeof h.pop === "number" ? h.pop : null)).filter((x) => typeof x === "number");
    if (pops.length) {
      const minPop = Math.min(...pops);
      const avgPop = pops.reduce((a, b) => a + b, 0) / pops.length;
      if (minPop >= 0.8 || avgPop >= 0.85) return null;
    }

    function slotScore(h) {
      const pop = typeof h.pop === "number" ? h.pop : 0.35;
      const wind = typeof h.wind_speed === "number" ? h.wind_speed : 5;
      const temp = typeof h.temp === "number" ? h.temp : null;

      const target = units() === "imperial" ? 65 : 18;
      const tempPenalty = temp === null ? 2 : Math.abs(temp - target) / 6;
      return pop * 12 + wind * 0.9 + tempPenalty;
    }

    let best = candidates[0];
    let bestScore = slotScore(best);

    for (const c of candidates.slice(1)) {
      const s = slotScore(c);
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  function bestTimeForDay(norm, dayDt) {
    if (!dayDt || !norm) return null;
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (hourly.length === 0) return null;

    // Get the date for the selected day (start of day in seconds)
    const dayStart = new Date(dayDt * 1000);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartSec = Math.floor(dayStart.getTime() / 1000);
    const dayEndSec = dayStartSec + 86400; // 24 hours later

    // Filter hourly data for this specific day
    const dayHourly = hourly.filter((h) => {
      const hDt = h?.dt;
      return typeof hDt === "number" && hDt >= dayStartSec && hDt < dayEndSec;
    });

    if (dayHourly.length === 0) return null;

    // Estimate sunrise/sunset for this day (simplified: use 6am-8pm as daylight hours)
    // In a real app, you'd calculate actual sunrise/sunset for that day
    const estimatedSunrise = dayStartSec + (6 * 3600); // 6 AM
    const estimatedSunset = dayStartSec + (20 * 3600); // 8 PM

    const start = estimatedSunrise + 3600; // 7 AM
    const end = estimatedSunset - 3600; // 7 PM
    const candidates = dayHourly.filter((h) => typeof h.dt === "number" && h.dt >= start && h.dt <= end);
    if (candidates.length === 0) return null;

    const pops = candidates.map((h) => (typeof h.pop === "number" ? h.pop : null)).filter((x) => typeof x === "number");
    if (pops.length) {
      const minPop = Math.min(...pops);
      const avgPop = pops.reduce((a, b) => a + b, 0) / pops.length;
      if (minPop >= 0.8 || avgPop >= 0.85) return null;
    }

    function slotScore(h) {
      const pop = typeof h.pop === "number" ? h.pop : 0.35;
      const wind = typeof h.wind_speed === "number" ? h.wind_speed : 5;
      const temp = typeof h.temp === "number" ? h.temp : null;

      const target = units() === "imperial" ? 65 : 18;
      const tempPenalty = temp === null ? 2 : Math.abs(temp - target) / 6;
      return pop * 12 + wind * 0.9 + tempPenalty;
    }

    let best = candidates[0];
    let bestScore = slotScore(best);

    for (const c of candidates.slice(1)) {
      const s = slotScore(c);
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  function calculateVerdictForDay(norm, dayDt, dayData) {
    if (!norm || !dayDt || !dayData) {
      return { status: "NO", label: "No-play recommended", reason: "Weather data unavailable", best: null, isNighttime: false };
    }

    const best = bestTimeForDay(norm, dayDt);
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    
    // Get hourly data for this day
    const dayStart = new Date(dayDt * 1000);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartSec = Math.floor(dayStart.getTime() / 1000);
    const dayEndSec = dayStartSec + 86400;
    const dayHourly = hourly.filter((h) => {
      const hDt = h?.dt;
      return typeof hDt === "number" && hDt >= dayStartSec && hDt < dayEndSec;
    });

    // Calculate average conditions for the day
    const windSpeeds = dayHourly.map(h => typeof h.wind_speed === "number" ? h.wind_speed : 0).filter(v => v > 0);
    const pops = dayHourly.map(h => typeof h.pop === "number" ? h.pop : 0).filter(v => v >= 0);
    const temps = dayHourly.map(h => typeof h.temp === "number" ? h.temp : null).filter(t => t !== null);

    const avgWind = windSpeeds.length > 0 ? windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length : 0;
    const maxPop = pops.length > 0 ? Math.max(...pops) : (typeof dayData.pop === "number" ? dayData.pop : 0.25);
    const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : (typeof dayData.max === "number" ? dayData.max : null);

    let score = 100;

    if (units() === "metric") {
      if (avgWind > 12) score -= 45;
      else if (avgWind > 9) score -= 30;
      else if (avgWind > 6) score -= 18;
    } else {
      if (avgWind > 27) score -= 45;
      else if (avgWind > 20) score -= 30;
      else if (avgWind > 14) score -= 18;
    }

    if (maxPop >= 0.85) score -= 50;
    else if (maxPop >= 0.6) score -= 35;
    else if (maxPop >= 0.35) score -= 20;

    if (avgTemp !== null) {
      if (units() === "metric") {
        if (avgTemp < 3 || avgTemp > 30) score -= 25;
        else if (avgTemp < 7 || avgTemp > 27) score -= 12;
      } else {
        if (avgTemp < 38 || avgTemp > 86) score -= 25;
        else if (avgTemp < 45 || avgTemp > 82) score -= 12;
      }
    }

    if (!best) score -= 18;

    score = clamp(Math.round(score), 0, 100);

    if (score >= 72) return { status: "PLAY", label: "Play", reason: "Good overall conditions", best };
    if (score >= 48) return { status: "MAYBE", label: "Playable (tough)", reason: "Manageable, but expect challenges", best };
    return { status: "NO", label: "No-play recommended", reason: best ? "Poor overall conditions" : "Rain likely throughout daylight", best };
  }

  /* =========================================================
     TEE-TIME DECISION STRIP
     Computes PLAY / RISKY / NO CHANCE for a selected tee time
     Supports date + time selection with daylight enforcement
     ========================================================= */

  // Round duration in hours (3-hour round)
  let roundDurationHours = 4; // default: 18 holes (~4h)
  let roundMode = "18"; // "18" | "9" | "society"

  // Fallback daylight window (08:00 - 17:00) if sunrise/sunset unavailable
  const FALLBACK_DAYLIGHT = { startHour: 8, endHour: 17 };

  // Thresholds (easy to tweak)
  const TEE_TIME_THRESHOLDS = {
    // NO CHANCE thresholds
    noChance: {
      totalPrecipMm: 4.0,
      precipProbAndRainMm: { prob: 80, mm: 1.5 },
      maxGust: 35, // mph
    },
    // RISKY thresholds
    risky: {
      totalPrecipMmMin: 1.5,
      totalPrecipMmMax: 4.0,
      precipProbMin: 50,
      precipProbMax: 79,
      maxGustMin: 25,
      maxGustMax: 34,
      avgWind: 18, // mph
    }
  };

  /**
   * Get the number of distinct forecast days available
   * @param {Object} norm - Normalized weather data
   * @returns {number} Number of days with forecast data (max 7)
   */
  function getForecastDaysAvailable(norm) {
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (hourly.length === 0) return 0;

    const timestamps = hourly.map(h => h?.dt).filter(dt => typeof dt === "number");
    if (timestamps.length === 0) return 0;

    const minDt = Math.min(...timestamps);
    const maxDt = Math.max(...timestamps);
    
    // Calculate distinct days
    const days = new Set();
    for (const dt of timestamps) {
      const date = new Date(dt * 1000);
      days.add(date.toDateString());
    }
    
    return Math.min(days.size, 7);
  }

  /**
   * Get daylight window for a specific date
   * Uses sunrise/sunset if available, otherwise fallback to 08:00-17:00
   * @param {Date} date - The date to get daylight for
   * @param {Object} norm - Normalized weather data with sunrise/sunset
   * @returns {Object} { sunrise: unixSeconds, sunset: unixSeconds }
   */
  function getDaylightWindowForDate(date, norm) {
    const tzOffset = norm?.timezoneOffset || 0;
    const baseSunrise = norm?.sunrise;
    const baseSunset = norm?.sunset;
    
    // Get start of the target date
    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);
    const targetDayStart = Math.floor(targetDate.getTime() / 1000);
    
    // Get start of the base date (sunrise/sunset day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = Math.floor(today.getTime() / 1000);
    
    // Calculate day offset from today
    const dayOffset = Math.round((targetDayStart - todayStart) / 86400);
    
    let sunrise, sunset;
    
    if (typeof baseSunrise === "number" && typeof baseSunset === "number") {
      // Estimate sunrise/sunset for future days (shift by day offset)
      sunrise = baseSunrise + (dayOffset * 86400);
      sunset = baseSunset + (dayOffset * 86400);
    } else {
      // Fallback: use 08:00-17:00 local time
      sunrise = targetDayStart + (FALLBACK_DAYLIGHT.startHour * 3600);
      sunset = targetDayStart + (FALLBACK_DAYLIGHT.endHour * 3600);
    }
    
    return { sunrise, sunset };
  }

  /**
   * Get valid tee times for a specific date (daylight only, 3h round must fit)
   * @param {Date} date - The date to generate times for
   * @param {Object} norm - Normalized weather data
   * @param {number} stepMinutes - Step size in minutes (30 or 60)
   * @returns {Array} Array of { value: unixSeconds, label: "HH:MM" }
   */
  function getValidTeeTimesForDate(date, norm, stepMinutes = 8) {
    const tzOffset = norm?.timezoneOffset || 0;
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    
    // Get forecast time range
    const timestamps = hourly.map(h => h?.dt).filter(dt => typeof dt === "number");
    if (timestamps.length === 0) return [];
    
    const forecastMin = Math.min(...timestamps);
    const forecastMax = Math.max(...timestamps);
    
    // Get daylight window
    const { sunrise, sunset } = getDaylightWindowForDate(date, norm);
    
    // Valid tee time range:
    // - Start: sunrise + 30min (allow early birds)
    // - End: sunset - roundDurationHours (round must finish before sunset)
    const playStart = sunrise + (30 * 60); // 30 min after sunrise
    const playEnd = sunset - (roundDurationHours * 3600);
    
    const now = nowSec();
    const options = [];
    const stepSeconds = stepMinutes * 60;
    
    for (let slot = playStart; slot <= playEnd; slot += stepSeconds) {
      // Skip if in the past
      if (slot < now) continue;
      
      // Skip if outside forecast range
      if (slot < forecastMin || slot > forecastMax) continue;
      
      // Verify the full round is within daylight
      const roundEnd = slot + (roundDurationHours * 3600);
      if (roundEnd > sunset) continue;
      
      // Format time in course local timezone
      const courseDate = new Date((slot + tzOffset) * 1000);
      const hours = courseDate.getUTCHours().toString().padStart(2, '0');
      const mins = courseDate.getUTCMinutes().toString().padStart(2, '0');
      
      options.push({
        value: slot,
        label: `${hours}:${mins}`
      });
    }
    
    return options;
  }

  /**
   * Get available dates for tee time selection
   * @param {Object} norm - Normalized weather data
   * @returns {Array} Array of { date: Date, label: "Today"/"Tomorrow"/"Sat 6", hasValidTimes: boolean }
   */
  function getAvailableDates(norm) {
    const numDays = getForecastDaysAvailable(norm);
    if (numDays === 0) return [];
    
    const dates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < numDays; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      
      // Check if this date has any valid tee times
      const validTimes = getValidTeeTimesForDate(date, norm);
      
      // Generate label
      let label;
      if (i === 0) {
        label = "Today";
      } else if (i === 1) {
        label = "Tomorrow";
      } else {
        const dayName = date.toLocaleDateString([], { weekday: "short" });
        const dayNum = date.getDate();
        label = `${dayName} ${dayNum}`;
      }
      
      dates.push({
        date,
        dateKey: date.toDateString(),
        label,
        dayLabel: i === 0 ? "Today" : i === 1 ? "Tmrw" : date.toLocaleDateString([], { weekday: "short" }),
        dateLabel: date.getDate().toString(),
        hasValidTimes: validTimes.length > 0
      });
    }
    
    return dates;
  }

  /**
   * Calculate tee-time decision for a 3-hour round window
   * @param {Array} hourlyForecast - Array of hourly forecast data
   * @param {number} teeTimeUnix - Unix timestamp (seconds) of tee time
   * @param {number} windowHours - Duration of round in hours (default 3)
   * @returns {Object} Decision result with status, metrics, reasons, and summary
   */
  function computeTeeTimeDecision(hourlyForecast, teeTimeUnix, windowHours = roundDurationHours) {
    const WINDOW_HOURS = windowHours;
    const windowEnd = teeTimeUnix + (WINDOW_HOURS * 3600);

    // Filter hourly data within the tee time window
    const windowData = (hourlyForecast || []).filter(h => {
      const dt = h?.dt;
      return typeof dt === "number" && dt >= teeTimeUnix && dt < windowEnd;
    });

    // Default result if no data
    if (windowData.length === 0) {
      return {
        status: "UNKNOWN",
        statusLabel: "No Data",
        icon: "❓",
        metrics: {
          maxPrecipProb: null,
          totalPrecipMm: null,
          avgWind: null,
          maxGust: null,
          avgTemp: null,
          feelsLike: null
        },
        reasons: [],
        summary: "No forecast data available for this time window."
      };
    }

    // Calculate metrics from window data
    const precipProbs = windowData
      .map(h => typeof h.pop === "number" ? Math.round(h.pop * 100) : null)
      .filter(v => v !== null);
    const precipMms = windowData
      .map(h => typeof h.rain_mm === "number" ? h.rain_mm : 0);
    const windSpeeds = windowData
      .map(h => {
        if (typeof h.wind_speed !== "number") return null;
        // Convert to mph if in m/s
        return units() === "metric" ? h.wind_speed * 2.237 : h.wind_speed;
      })
      .filter(v => v !== null);
    const gustSpeeds = windowData
      .map(h => {
        // Try wind_gust first, then check for gust in wind object
        const gust = h?.wind_gust ?? h?.gust;
        if (typeof gust !== "number") return null;
        return units() === "metric" ? gust * 2.237 : gust;
      })
      .filter(v => v !== null);
    const temps = windowData
      .map(h => typeof h.temp === "number" ? h.temp : null)
      .filter(v => v !== null);
    const feelsLikes = windowData
      .map(h => typeof h.feels_like === "number" ? h.feels_like : null)
      .filter(v => v !== null);

    // Compute aggregates
    const maxPrecipProb = precipProbs.length > 0 ? Math.max(...precipProbs) : 0;
    const totalPrecipMm = precipMms.reduce((sum, v) => sum + v, 0);
    const avgWind = windSpeeds.length > 0
      ? windSpeeds.reduce((sum, v) => sum + v, 0) / windSpeeds.length
      : 0;
    const maxGust = gustSpeeds.length > 0 ? Math.max(...gustSpeeds) : avgWind * 1.3; // Estimate gusts if not available
    const avgTemp = temps.length > 0
      ? temps.reduce((sum, v) => sum + v, 0) / temps.length
      : null;
    const avgFeelsLike = feelsLikes.length > 0
      ? feelsLikes.reduce((sum, v) => sum + v, 0) / feelsLikes.length
      : avgTemp;
    const minTemp = temps.length > 0 ? Math.min(...temps) : null;

    const metrics = {
      maxPrecipProb: Math.round(maxPrecipProb),
      totalPrecipMm: Math.round(totalPrecipMm * 10) / 10,
      avgWind: Math.round(avgWind),
      maxGust: Math.round(maxGust),
      avgTemp: avgTemp !== null ? Math.round(avgTemp) : null,
      feelsLike: avgFeelsLike !== null ? Math.round(avgFeelsLike) : null
    };

    const toGroup = (id) => (typeof id === "number" ? Math.floor(id / 100) : null);

    // Decision logic
    const T = TEE_TIME_THRESHOLDS;
    const reasons = [];
    let status = "PLAY"; // PLAY | RISKY | DELAY | AVOID

    // Extra signals for golf-readable verdicts
    const signals = (() => {
      let thunder = false;
      let snowIce = false;
      for (const h of windowData) {
        const w0 = Array.isArray(h?.weather) ? h.weather[0] : null;
        const id = typeof w0?.id === "number" ? w0.id : null;
        const g = toGroup(id);
        if (g === 2) thunder = true; // 2xx thunderstorm
        // Snow/ice/freezing precip (hard-stop)
        if (g === 6) snowIce = true; // 6xx snow
        if (id === 511) snowIce = true; // freezing rain
        if (id === 611 || id === 612 || id === 613 || id === 615 || id === 616) snowIce = true; // sleet / mixed
        const main = typeof w0?.main === "string" ? w0.main.toLowerCase() : "";
        const desc = typeof w0?.description === "string" ? w0.description.toLowerCase() : "";
        if (main.includes("snow") || main.includes("sleet") || desc.includes("freezing")) snowIce = true;
      }
      const rainRateMmHr = WINDOW_HOURS > 0 ? (totalPrecipMm / WINDOW_HOURS) : 0;
      const gustDelta = (Number.isFinite(maxGust) && Number.isFinite(avgWind)) ? (maxGust - avgWind) : null;
      return {
        thunder,
        snowIce,
        rainRateMmHr,
        gustDelta,
      };
    })();

    // --- HARD STOPS (override everything) ---
    const P = window.FF_PLAYABILITY || null;
    const countryCode = (typeof currentCountry === "string" && currentCountry) ? currentCountry : (APP.DEFAULT_COUNTRY || "");
    const windChillC = P?.computeWindChillC
      ? P.computeWindChillC(minTemp !== null ? minTemp : avgTemp, avgWind)
      : null;
    const profileForStops = P?.getCountryProfile ? P.getCountryProfile(countryCode) : null;
    const hardStop = P?.applyHardStops
      ? P.applyHardStops({
          airTempC: minTemp !== null ? minTemp : avgTemp,
          windMph: avgWind,
          windChillC,
          thunder: signals.thunder,
          snowIce: signals.snowIce,
          profile: profileForStops,
        })
      : null;
    if (hardStop) {
      const statusMap = {
        PLAY: { label: "PLAY", icon: "✅" },
        RISKY: { label: "RISKY", icon: "⚠️" },
        DELAY: { label: "DELAY", icon: "⏳" },
        AVOID: { label: "AVOID", icon: "⛔" },
        UNKNOWN: { label: "—", icon: "❓" }
      };
      const display = statusMap[hardStop.status] || statusMap.UNKNOWN;
      return {
        status: hardStop.status,
        statusLabel: display.label,
        icon: display.icon,
        metrics: { ...metrics, windChillC: windChillC !== null ? Math.round(windChillC) : null },
        reasons: [...(hardStop.reasons || []), ...reasons],
        label: hardStop.label,
        message: hardStop.message,
        countryCode,
      };
    }

    // Check NO CHANCE conditions
    if (totalPrecipMm >= T.noChance.totalPrecipMm) {
      status = "DELAY";
      reasons.push(`Heavy rain expected (~${metrics.totalPrecipMm}mm)`);
    } else if (maxPrecipProb >= T.noChance.precipProbAndRainMm.prob && 
               totalPrecipMm >= T.noChance.precipProbAndRainMm.mm) {
      status = "DELAY";
      reasons.push(`Rain very likely (${metrics.maxPrecipProb}%) with ~${metrics.totalPrecipMm}mm expected`);
    } else if (maxGust >= T.noChance.maxGust) {
      status = "AVOID";
      reasons.push(`Dangerous gusts (up to ${metrics.maxGust}mph)`);
    }

    // Thunder/snow/ice are handled above as hard-stops.

    // Check RISKY conditions (if not already AVOID/DELAY)
    if (status === "PLAY") {
      if (totalPrecipMm >= T.risky.totalPrecipMmMin && totalPrecipMm < T.risky.totalPrecipMmMax) {
        status = "RISKY";
        reasons.push(`~${metrics.totalPrecipMm}mm rain expected`);
      }
      if (maxPrecipProb >= T.risky.precipProbMin && maxPrecipProb <= T.risky.precipProbMax) {
        status = "RISKY";
        if (!reasons.some(r => r.includes("rain"))) {
          reasons.push(`Rain chance ${metrics.maxPrecipProb}%`);
        }
      }
      if (maxGust >= T.risky.maxGustMin && maxGust <= T.risky.maxGustMax) {
        status = "RISKY";
        reasons.push(`Gusty winds (up to ${metrics.maxGust}mph)`);
      }
      if (avgWind >= T.risky.avgWind) {
        status = "RISKY";
        if (!reasons.some(r => r.includes("wind") || r.includes("gust"))) {
          reasons.push(`Strong sustained wind (~${metrics.avgWind}mph)`);
        }
      }
    }

    // Country-aware tuning (soft thresholds)
    const profile = profileForStops || (P?.getCountryProfile ? P.getCountryProfile(countryCode) : null);
    const isUKIE = profile?.region === "uk";
    const coldWarnC = profile?.coldWarnC ?? 10;
    const coldToughC = profile?.coldToughC ?? 4;
    const rainDrizzleMax = profile?.rainDrizzleMaxMmHr ?? 0.5;
    const rainLightMax = profile?.rainLightMaxMmHr ?? 2.0;
    const rainModerateMax = profile?.rainModerateMaxMmHr ?? 6.0;
    const rainHeavyMin = profile?.rainHeavyMinMmHr ?? 6.0;
    const windBreezyMph = profile?.windBreezyMph ?? 12;
    const windWindyMph = profile?.windWindyMph ?? 21;
    const windVeryWindyMph = profile?.windVeryWindyMph ?? 30;
    const riskWindChillMinC = profile?.riskWindChillMinC ?? -2;
    const riskWindChillMaxC = profile?.riskWindChillMaxC ?? 0;
    const coldBreezyTempMinC = profile?.coldBreezyTempMinC ?? -2;
    const coldBreezyTempMaxC = profile?.coldBreezyTempMaxC ?? 4;
    const coldBreezyWindMph = profile?.coldBreezyWindMph ?? 12;
    const wetWindPenaltyRainMmHr = profile?.wetWindPenaltyRainMmHr ?? 0.6;
    const wetWindPenaltyWindMph = profile?.wetWindPenaltyWindMph ?? 15;

    const rank = (s) => (s === "PLAY" ? 0 : s === "RISKY" ? 1 : s === "DELAY" ? 2 : s === "AVOID" ? 3 : 0);
    const setAtLeast = (minStatus, why) => {
      if (rank(status) < rank(minStatus)) status = minStatus;
      if (why) reasons.push(why);
    };
    const worsenOneStep = (why) => {
      const next = status === "PLAY" ? "RISKY" : status === "RISKY" ? "DELAY" : status === "DELAY" ? "AVOID" : "AVOID";
      if (next !== status) status = next;
      if (why) reasons.push(why);
    };

    // Descriptive label + short golfer message (tasteful emoji)
    const isColdTough = avgTemp !== null && avgTemp <= coldToughC;
    const isColdWarn = avgTemp !== null && avgTemp <= coldWarnC;

    const rainRate = signals.rainRateMmHr;
    const isDrizzle = rainRate >= 0.1 && rainRate <= rainDrizzleMax;
    const isLightRain = rainRate >= 0.6 && rainRate <= rainLightMax;
    const isModerateRain = rainRate > rainLightMax && rainRate <= rainModerateMax;
    const isHeavyRain = rainRate > rainHeavyMin || totalPrecipMm >= 8.0 || maxPrecipProb >= 80;

    const isVeryWindy = avgWind >= windVeryWindyMph || maxGust >= (windVeryWindyMph + 5);
    const isWindy = avgWind >= windWindyMph || maxGust >= (windWindyMph + 7) || (signals.gustDelta !== null && signals.gustDelta >= 12);
    const isBreezy = avgWind >= windBreezyMph || maxGust >= (windBreezyMph + 6);

    // UK/EU: wind chill risk band (NOT a hard-stop)
    const inRiskWindChillBand = (windChillC !== null) && windChillC > (profile?.hardStopWindChillC ?? -2) && windChillC >= riskWindChillMinC && windChillC <= riskWindChillMaxC;
    if (inRiskWindChillBand) {
      setAtLeast("RISKY", `Cold wind chill (~${Math.round(windChillC)}°C)`);
    }

    // UK/EU: cold + breezy winter-golfer condition
    const coldBreezy =
      (avgTemp !== null && avgTemp >= coldBreezyTempMinC && avgTemp <= coldBreezyTempMaxC && avgWind >= coldBreezyWindMph) ||
      (windChillC !== null && windChillC >= riskWindChillMinC && windChillC <= riskWindChillMaxC && avgWind >= coldBreezyWindMph);
    if (coldBreezy) {
      setAtLeast("RISKY", "Cold & breezy window");
    }

    // UK/EU rain sensitivity: apply rate-based status floors
    if (isHeavyRain) {
      setAtLeast(avgWind >= wetWindPenaltyWindMph ? "AVOID" : "DELAY", "Heavy rain rate in window");
    } else if (isModerateRain) {
      setAtLeast("DELAY", "Steady rain in window");
    } else if (isLightRain) {
      setAtLeast("RISKY", "Light rain in window");
    }

    // Wet + windy combined penalty (worsen one step)
    const wetAndWindy = rainRate >= wetWindPenaltyRainMmHr && avgWind >= wetWindPenaltyWindMph;
    if (wetAndWindy) {
      worsenOneStep("Wet + windy combo");
    }

    let label = "";
    let message = "";

    if (status === "PLAY") {
      label = "PLAY — It’s playable";
      message = "Solid window. Go play.";
      if (isDrizzle) {
        label = "PLAY — Drizzle 🌦️ (annoying)";
        message = "Playable, but damp. A light waterproof helps.";
      }
      if (isColdTough) {
        label = "PLAY — Cold 🥶 (tough)";
        message = "Reduced carry and numb hands—layer up.";
      } else if (isColdWarn) {
        label = "PLAY — Chilly 🧥";
        message = "Bring layers. Expect shorter carry.";
      }
    } else if (status === "RISKY") {
      label = "RISKY — Mixed conditions";
      message = "Playable, but expect compromises.";
      if (isUKIE && coldBreezy) {
        label = "RISKY — Cold & breezy 🥶💨 (tough)";
        message = "Playable for winter golfers, but expect numb hands and reduced carry.";
      } else if (wetAndWindy) {
        label = "DELAY — Wet & windy 🌧️💨 (miserable)";
        message = "Playable only if you’re committed. Consider moving the tee time.";
      } else if (isLightRain) {
        label = "RISKY — Light rain 🌧️ (waterproofs)";
        message = "Waterproofs recommended. Expect a wet round.";
      } else if (isModerateRain) {
        label = "DELAY — Steady rain 🌧️";
        message = "Likely stop-start. Consider moving the tee time.";
      } else if (isVeryWindy || isWindy) {
        label = "RISKY — Windy 💨 (hard scoring)";
        message = "Big club changes. Hard to score well.";
      } else if (isColdTough || inRiskWindChillBand) {
        label = "RISKY — Cold 🥶 (tough)";
        message = "Playable, but uncomfortable—hands go numb fast.";
      } else if (isDrizzle) {
        label = "RISKY — Drizzle 🌦️";
        message = "Playable, but annoying. Bring a light shell.";
      }
    } else if (status === "DELAY") {
      label = "DELAY — Heavy rain ⛈️";
      message = "Wait it out if you can.";
      if (wetAndWindy) {
        label = "DELAY — Wet & windy 🌧️💨 (miserable)";
        message = "This is the kind of weather people quit in. Consider rescheduling.";
      } else if (isModerateRain) {
        label = "DELAY — Steady rain 🌧️";
        message = "Likely stop-start. Consider moving the tee time.";
      } else if (isHeavyRain) {
        label = "DELAY — Heavy rain ⛈️";
        message = "Wait it out if you can.";
      }
    } else { // AVOID
      label = "AVOID — Poor conditions";
      message = "Not worth it today.";
      if (isHeavyRain) {
        label = "AVOID — Heavy rain ⛈️";
        message = "Course likely unplayable.";
      } else if (isVeryWindy) {
        label = "AVOID — Wind 💨";
        message = "Too gusty to enjoy.";
      }
    }

    // Map status to display values
    const statusMap = {
      PLAY: { label: "PLAY", icon: "✅" },
      RISKY: { label: "RISKY", icon: "⚠️" },
      DELAY: { label: "DELAY", icon: "⏳" },
      AVOID: { label: "AVOID", icon: "⛔" },
      UNKNOWN: { label: "—", icon: "❓" }
    };
    const display = statusMap[status] || statusMap.UNKNOWN;

    return {
      status,
      statusLabel: display.label,
      icon: display.icon,
      metrics,
      reasons,
      label,
      message,
      countryCode,
    };
  }

  // Alias for backward compatibility
  function calculateTeeTimeDecision(hourlyForecast, teeTimeUnix, timezoneOffset = 0) {
    return computeTeeTimeDecision(hourlyForecast, teeTimeUnix, roundDurationHours);
  }

  // State for tee time strip
  let selectedTeeTime = null;
  let selectedTeeDate = null; // Date object

  /**
   * Render date chips for date selection
   * @param {Object} norm - Normalized weather data
   */
  function renderDateChips(norm) {
    const container = $("teeDateChips");
    if (!container) return;

    const availableDates = getAvailableDates(norm);
    
    if (availableDates.length === 0) {
      container.innerHTML = "";
      return;
    }

    // Set default selected date if not set or invalid
    if (!selectedTeeDate || !availableDates.some(d => d.dateKey === selectedTeeDate.toDateString())) {
      // Find first date with valid tee times
      const firstValid = availableDates.find(d => d.hasValidTimes);
      selectedTeeDate = firstValid ? firstValid.date : availableDates[0].date;
    }

    const chipsHtml = availableDates.map(d => {
      const isSelected = d.dateKey === selectedTeeDate?.toDateString();
      const isDisabled = !d.hasValidTimes;
      
      return `<button type="button" 
        class="ff-tee-date-chip ${isSelected ? 'active' : ''} ${isDisabled ? 'disabled' : ''}"
        data-date="${d.dateKey}"
        ${isDisabled ? 'disabled' : ''}
        aria-pressed="${isSelected}"
        aria-label="${d.label}${isDisabled ? ' (no available times)' : ''}">
        <span class="ff-tee-date-chip-day">${esc(d.dayLabel)}</span>
        <span class="ff-tee-date-chip-date">${esc(d.dateLabel)}</span>
      </button>`;
    }).join("");

    container.innerHTML = chipsHtml;

    // Wire up date chip clicks
    container.querySelectorAll(".ff-tee-date-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const dateKey = chip.getAttribute("data-date");
        const dateInfo = availableDates.find(d => d.dateKey === dateKey);
        if (dateInfo && dateInfo.hasValidTimes) {
          selectedTeeDate = dateInfo.date;
          renderTeeTimeStrip(norm);
        }
      });
    });
  }

  /**
   * Find the nearest valid tee time when switching dates
   * @param {Array} options - Available tee time options
   * @param {number} preferredTime - Previously selected time (unix seconds)
   * @returns {number|null} Best matching time or first available
   */
  function findNearestValidTime(options, preferredTime) {
    if (options.length === 0) return null;
    if (!preferredTime) return options[0]?.value || null;

    // Extract hour:minute from preferred time
    const prefDate = new Date(preferredTime * 1000);
    const prefMinutes = prefDate.getHours() * 60 + prefDate.getMinutes();

    let closest = options[0];
    let closestDiff = Infinity;

    for (const opt of options) {
      const optDate = new Date(opt.value * 1000);
      const optMinutes = optDate.getHours() * 60 + optDate.getMinutes();
      const diff = Math.abs(optMinutes - prefMinutes);
      
      if (diff < closestDiff) {
        closestDiff = diff;
        closest = opt;
      }
    }

    return closest?.value || options[0]?.value || null;
  }

  /**
   * Render the Tee-Time Decision Strip
   * @param {Object} norm - Normalized weather data
   */
  function renderTeeTimeStrip(norm) {
    const section = $("teeTimeStripSection");
    const statusEl = $("teeTimeStatus");
    const iconEl = $("teeTimeIcon");
    const labelEl = $("teeTimeLabel");
    const selectEl = $("teeTimeSelect");
    const summaryEl = $("teeTimeSummary");
    const rainMetric = $("teeMetricRain");
    const windMetric = $("teeMetricWind");
    const tempMetric = $("teeMetricTemp");
    const gustMetric = $("teeMetricGust");

    if (!section) return;

    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    
    // Hide if no hourly data
    if (hourly.length === 0) {
      section.style.display = "none";
      return;
    }

    // Get available dates
    const availableDates = getAvailableDates(norm);
    if (availableDates.length === 0 || !availableDates.some(d => d.hasValidTimes)) {
      section.style.display = "none";
      return;
    }

    // Show the section
    section.style.display = "block";

    // Render date chips
    renderDateChips(norm);

    // Ensure selected date is valid
    if (!selectedTeeDate || !availableDates.some(d => d.dateKey === selectedTeeDate.toDateString() && d.hasValidTimes)) {
      const firstValid = availableDates.find(d => d.hasValidTimes);
      selectedTeeDate = firstValid ? firstValid.date : null;
    }

    if (!selectedTeeDate) {
      section.style.display = "none";
      return;
    }

    // Get valid tee times for selected date
    const timeOptions = getValidTeeTimesForDate(selectedTeeDate, norm);
    
    if (timeOptions.length === 0) {
      if (selectEl) selectEl.innerHTML = '<option value="">No times available</option>';
      return;
    }

    // Update time selector
    if (selectEl) {
      const currentOptions = Array.from(selectEl.options).map(o => o.value).join(",");
      const newOptions = timeOptions.map(o => o.value).join(",");
      
      if (currentOptions !== newOptions) {
        selectEl.innerHTML = timeOptions.map(opt => 
          `<option value="${opt.value}">${esc(opt.label)}</option>`
        ).join("");
        
        // Find nearest valid time if current selection is invalid
        if (selectedTeeTime && timeOptions.some(o => o.value === selectedTeeTime)) {
          selectEl.value = selectedTeeTime;
        } else {
          selectedTeeTime = findNearestValidTime(timeOptions, selectedTeeTime);
          selectEl.value = selectedTeeTime;
        }
      }
    }

    // Ensure selected time is valid
    if (!selectedTeeTime || !timeOptions.some(o => o.value === selectedTeeTime)) {
      selectedTeeTime = timeOptions[0]?.value || null;
      if (selectEl) selectEl.value = selectedTeeTime;
    }

    if (!selectedTeeTime) return;

    // Calculate decision for selected tee time (3-hour window)
    const decision = computeTeeTimeDecision(hourly, selectedTeeTime, roundDurationHours);

    // Update status pill
    if (statusEl) {
      statusEl.classList.remove(
        "ff-tee-strip-status--play",
        "ff-tee-strip-status--risky", 
        "ff-tee-strip-status--no-chance"
      );
      
      if (decision.status === "PLAY") {
        statusEl.classList.add("ff-tee-strip-status--play");
      } else if (decision.status === "RISKY") {
        statusEl.classList.add("ff-tee-strip-status--risky");
      } else if (decision.status === "DELAY") {
        statusEl.classList.add("ff-tee-strip-status--risky");
      } else if (decision.status === "AVOID") {
        statusEl.classList.add("ff-tee-strip-status--no-chance");
      }

      // Add pulse animation on change
      statusEl.classList.add("ff-tee-status-updated");
      setTimeout(() => statusEl.classList.remove("ff-tee-status-updated"), 400);
    }

    if (iconEl) iconEl.textContent = decision.icon;
    // Show full label (e.g., "DELAY — Heavy rain") in status, message in desc
    if (labelEl) labelEl.textContent = decision.label || decision.statusLabel;

    // Update selected tee time display
    const selectedLabelEl = $("teeSelectedLabel");
    if (selectedLabelEl) {
      if (selectedTeeTime) {
        const tzOffset = norm?.timezoneOffset || 0;
        selectedLabelEl.textContent = formatTeeLabel(selectedTeeTime, tzOffset);
      } else {
        selectedLabelEl.textContent = "Select a tee time";
      }
    }

    // Update metrics
    if (rainMetric) {
      rainMetric.textContent = decision.metrics.maxPrecipProb !== null 
        ? `${decision.metrics.maxPrecipProb}%` 
        : "—";
      const rainParent = rainMetric.closest(".ff-tee-metric");
      if (rainParent) {
        rainParent.classList.remove("ff-tee-metric--warning", "ff-tee-metric--danger");
        if (decision.metrics.maxPrecipProb >= 80) {
          rainParent.classList.add("ff-tee-metric--danger");
        } else if (decision.metrics.maxPrecipProb >= 50) {
          rainParent.classList.add("ff-tee-metric--warning");
        }
      }
    }

    if (windMetric) {
      windMetric.textContent = decision.metrics.avgWind !== null 
        ? `${decision.metrics.avgWind} mph` 
        : "—";
      const windParent = windMetric.closest(".ff-tee-metric");
      if (windParent) {
        windParent.classList.remove("ff-tee-metric--warning", "ff-tee-metric--danger");
        if (decision.metrics.avgWind >= 25) {
          windParent.classList.add("ff-tee-metric--danger");
        } else if (decision.metrics.avgWind >= 18) {
          windParent.classList.add("ff-tee-metric--warning");
        }
      }
    }

    if (tempMetric) {
      tempMetric.textContent = decision.metrics.avgTemp !== null 
        ? `${decision.metrics.avgTemp}${tempUnit()}` 
        : "—";
    }

    if (gustMetric) {
      gustMetric.textContent = decision.metrics.maxGust !== null 
        ? `${decision.metrics.maxGust} mph` 
        : "—";
      const gustParent = gustMetric.closest(".ff-tee-metric");
      if (gustParent) {
        gustParent.classList.remove("ff-tee-metric--warning", "ff-tee-metric--danger");
        if (decision.metrics.maxGust >= 35) {
          gustParent.classList.add("ff-tee-metric--danger");
        } else if (decision.metrics.maxGust >= 25) {
          gustParent.classList.add("ff-tee-metric--warning");
        }
      }
    }

    // Update summary - show message only (label is shown in status)
    if (summaryEl) {
      summaryEl.textContent = decision.message || "Select a tee time to see conditions.";
    }

    // Society tee sheet (optional)
    renderTeeSheet(norm);
  }

  // Wire up tee time selector
  function wireTeeTimeSelector() {
    const selectEl = $("teeTimeSelect");
    if (!selectEl) return;

    selectEl.addEventListener("change", () => {
      selectedTeeTime = Number(selectEl.value);
      if (lastNorm) {
        renderTeeTimeStrip(lastNorm);
      }
    });
  }

  /**
   * Show the "Applied from Round Planner" confirmation message with auto-fade
   */
  function showAppliedConfirmation() {
    const msgEl = $("teeAppliedMsg");
    if (!msgEl) return;
    
    // Reset animation by removing and re-adding element
    msgEl.style.display = "none";
    msgEl.offsetHeight; // Force reflow
    msgEl.style.display = "block";
    
    // Hide after animation completes (1.5s)
    setTimeout(() => {
      msgEl.style.display = "none";
    }, 1500);
  }

  /**
   * Apply recommended time from Round Planner to Tee-Time Decision Strip
   * @param {number} recommendedTime - Unix timestamp in seconds
   */
  function applyRecommendedTime(recommendedTime) {
    if (!recommendedTime || !lastNorm) return;
    
    // Find which date this time belongs to
    const availableDates = getAvailableDates(lastNorm);
    const targetDate = new Date(recommendedTime * 1000);
    targetDate.setHours(0, 0, 0, 0);
    const targetDateKey = targetDate.toDateString();
    
    // Set the selected date
    const dateInfo = availableDates.find(d => d.dateKey === targetDateKey);
    if (dateInfo) {
      selectedTeeDate = dateInfo.date;
    }
    
    // Set the selected time
    selectedTeeTime = recommendedTime;
    
    // Re-render the strip
    renderTeeTimeStrip(lastNorm);
    
    // Re-render the planner to update Apply button state
    renderVerdictCard(lastNorm);
    
    // Show confirmation
    showAppliedConfirmation();
    
    // Scroll to strip
    const stripSection = $("teeTimeStripSection");
    if (stripSection) {
      stripSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  /**
   * Wire up the Apply button in the Round Planner
   */
  function wireApplyPlannerButton() {
    const applyBtn = $("applyPlannerBtn");
    if (!applyBtn) return;
    
    applyBtn.addEventListener("click", () => {
      const recommendedTime = Number(applyBtn.dataset.recommendedTime);
      if (recommendedTime) {
        applyRecommendedTime(recommendedTime);
      }
    });
  }

  /**
   * Wire up the Premium button (placeholder for future checkout)
   */
  function wirePremiumButton() {
    const premiumBtn = $("getPremiumBtn");
    if (!premiumBtn) return;
    
    premiumBtn.addEventListener("click", () => {
      // Placeholder - future premium checkout
      openInfoModal(
        "Premium Coming Soon",
        "Premium features including Round Planner and Advanced Wind Impact are coming soon. Stay tuned!"
      );
    });
  }

  function calculateVerdict(norm) {
    if (!norm?.current) return { status: "NO", label: "No-play recommended", reason: "Weather data unavailable", best: null, isNighttime: false };

    const sunrise = norm.sunrise;
    const sunset = norm.sunset;
    const now = nowSec();
    const isNighttime = sunrise && sunset && now > sunset;
    
    if (isNighttime) {
      // Return tomorrow's verdict instead
      const daily = Array.isArray(norm?.daily) ? norm.daily : [];
      const tomorrow = daily.length > 0 ? daily[0] : null;
      if (tomorrow) {
        const tomorrowVerdict = calculateVerdictForDay(norm, tomorrow.dt, tomorrow);
        return { ...tomorrowVerdict, isNighttime: true, isTomorrow: true };
      }
      return { status: "NO", label: "Night time", reason: "Night time at course", best: null, isNighttime: true, isTomorrow: false };
    }
    
    if (sunrise && sunset && now > sunset - 3600) {
      return { status: "NO", label: "No-play recommended", reason: "Limited daylight remaining", best: null, isNighttime: false };
    }

    const best = bestTimeToday(norm);
    const c = norm.current;

    const wind = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const popNow = typeof c.pop === "number" ? c.pop : null;
    const temp = typeof c.temp === "number" ? c.temp : null;

    let score = 100;

    if (units() === "metric") {
      if (wind > 12) score -= 45;
      else if (wind > 9) score -= 30;
      else if (wind > 6) score -= 18;
    } else {
      if (wind > 27) score -= 45;
      else if (wind > 20) score -= 30;
      else if (wind > 14) score -= 18;
    }

    const pop = popNow ?? (typeof best?.pop === "number" ? best.pop : 0.25);
    if (pop >= 0.85) score -= 50;
    else if (pop >= 0.6) score -= 35;
    else if (pop >= 0.35) score -= 20;

    if (temp !== null) {
      if (units() === "metric") {
        if (temp < 3 || temp > 30) score -= 25;
        else if (temp < 7 || temp > 27) score -= 12;
      } else {
        if (temp < 38 || temp > 86) score -= 25;
        else if (temp < 45 || temp > 82) score -= 12;
      }
    }

    if (!best) score -= 18;

    score = clamp(Math.round(score), 0, 100);

    if (score >= 72) return { status: "PLAY", label: "Play", reason: "Good overall conditions", best, isNighttime: false };
    if (score >= 48) return { status: "MAYBE", label: "Playable (tough)", reason: "Manageable, but expect challenges", best, isNighttime: false };
    return { status: "NO", label: "No-play recommended", reason: best ? "Poor overall conditions" : "Rain likely throughout daylight", best, isNighttime: false };
  }

  // Update time display on verdict card
  function updateTimeDisplay(norm) {
    if (!localTimeEl || !gmtTimeEl) return;
    
    // Get timezone offset from weather data (in seconds) - use timezoneOffset (camelCase)
    const tzOffset = norm?.timezoneOffset || 0;
    
    const now = new Date();
    
    // Course local time = UTC + course timezone offset
    const utcSeconds = Math.floor(now.getTime() / 1000);
    const courseSeconds = utcSeconds + tzOffset;
    const courseDate = new Date(courseSeconds * 1000);
    const courseHours = courseDate.getUTCHours().toString().padStart(2, '0');
    const courseMins = courseDate.getUTCMinutes().toString().padStart(2, '0');
    
    // Device local time (user's location)
    const deviceHours = now.getHours().toString().padStart(2, '0');
    const deviceMins = now.getMinutes().toString().padStart(2, '0');
    
    localTimeEl.textContent = `🕐 ${courseHours}:${courseMins} course`;
    gmtTimeEl.textContent = `${deviceHours}:${deviceMins} you`;
  }
  
  // Start time update interval
  let timeUpdateInterval = null;
  function startTimeUpdates(norm) {
    // Clear existing interval
    if (timeUpdateInterval) clearInterval(timeUpdateInterval);
    
    // Update immediately
    updateTimeDisplay(norm);
    
    // Update every minute
    timeUpdateInterval = setInterval(() => updateTimeDisplay(norm), 60000);
  }

  function renderVerdictCard(norm) {
    if (!verdictCard || !verdictLabel || !verdictReason || !verdictIcon || !verdictBestTime) return;
    
    // Start time updates
    startTimeUpdates(norm);

    const v = norm ? calculateVerdict(norm) : { status: "NEUTRAL", label: "—", reason: "—", best: null, isNighttime: false };
    const c = norm?.current;
    const isNighttime = v.isNighttime || false;
    const isTomorrow = v.isTomorrow || false;
    
    // Get tomorrow's data if nighttime
    let tomorrowData = null;
    if (isNighttime) {
      const daily = Array.isArray(norm?.daily) ? norm.daily : [];
      const tomorrow = daily.length > 0 ? daily[0] : null;
      if (tomorrow) {
        const tomorrowBest = bestTimeForDay(norm, tomorrow.dt);
        const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
        const dayStart = new Date(tomorrow.dt * 1000);
        dayStart.setHours(0, 0, 0, 0);
        const dayStartSec = Math.floor(dayStart.getTime() / 1000);
        const dayEndSec = dayStartSec + 86400;
        const dayHourly = hourly.filter((h) => {
          const hDt = h?.dt;
          return typeof hDt === "number" && hDt >= dayStartSec && hDt < dayEndSec;
        });
        
        const temps = dayHourly.map(h => typeof h.temp === "number" ? h.temp : null).filter(t => t !== null);
        const winds = dayHourly.map(h => typeof h.wind_speed === "number" ? h.wind_speed : null).filter(w => w !== null);
        const pops = dayHourly.map(h => typeof h.pop === "number" ? h.pop : 0);
        
        const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : (typeof tomorrow.max === "number" ? tomorrow.max : null);
        const maxWind = winds.length > 0 ? Math.max(...winds) : null;
        const maxPop = pops.length > 0 ? Math.max(...pops) : (typeof tomorrow.pop === "number" ? tomorrow.pop : 0);
        
        tomorrowData = {
          temp: avgTemp,
          wind: maxWind,
          pop: maxPop,
          best: tomorrowBest,
          weather: tomorrow.weather || []
        };
      }
    }

    verdictCard.classList.remove("ff-verdict--play", "ff-verdict--maybe", "ff-verdict--no", "ff-verdict--neutral", "ff-verdict--nighttime");

    if (isNighttime) {
      verdictCard.classList.add("ff-verdict--nighttime");
      verdictIcon.textContent = "🌙";
    } else if (v.status === "PLAY") {
      verdictCard.classList.add("ff-verdict--play");
      verdictIcon.textContent = "✅";
    } else if (v.status === "MAYBE") {
      verdictCard.classList.add("ff-verdict--maybe");
      verdictIcon.textContent = "⚠️";
    } else if (v.status === "NO") {
      verdictCard.classList.add("ff-verdict--no");
      verdictIcon.textContent = "⛔";
    } else {
      verdictCard.classList.add("ff-verdict--neutral");
      verdictIcon.textContent = "—";
    }

    // Label: Show "Best window:" prefix for Round Planner clarity
    let labelText = "";
    if (isNighttime) {
      labelText = "Night time";
    } else {
      labelText = v.label || "—";
    }
    
    // Add "Best window:" prefix to distinguish from user's selected tee time
    const labelPrefix = isNighttime ? "" : '<span class="ff-verdict-label-prefix">Best window</span>';
    verdictLabel.innerHTML = `${labelPrefix}${labelText} <span class="ff-info-icon" title="Click for more info">ℹ️</span>`;
    
    // Reason: Show tomorrow's forecast info when nighttime
    if (isNighttime && tomorrowData) {
      const tomorrowParts = [];
      if (tomorrowData.temp !== null) {
        tomorrowParts.push(`${roundNum(tomorrowData.temp)}${tempUnit()}`);
      }
      if (tomorrowData.wind !== null) {
        const windMph = windSpeedMph(tomorrowData.wind);
        tomorrowParts.push(`Wind ${roundNum(windMph)} mph`);
      }
      if (tomorrowData.pop !== null) {
        tomorrowParts.push(`Rain ${Math.round(tomorrowData.pop * 100)}%`);
      }
      const tomorrowSummary = tomorrowParts.length > 0 ? tomorrowParts.join(" • ") : "Forecast available";
      verdictReason.textContent = `Tomorrow: ${tomorrowSummary}`;
    } else {
      verdictReason.textContent = v.reason || "—";
    }
    
    // Best time: Show tomorrow's best time if nighttime (in course local time)
    const tzOffset = norm?.timezoneOffset || null;
    let recommendedBestTime = null;
    
    if (isNighttime && tomorrowData?.best && typeof tomorrowData.best.dt === "number") {
      verdictBestTime.textContent = fmtTimeCourse(tomorrowData.best.dt, tzOffset);
      recommendedBestTime = tomorrowData.best.dt;
    } else if (v.best && typeof v.best.dt === "number") {
      verdictBestTime.textContent = fmtTimeCourse(v.best.dt, tzOffset);
      recommendedBestTime = v.best.dt;
    } else {
      verdictBestTime.textContent = "—";
      recommendedBestTime = null;
    }
    
    // Show/hide Apply button based on whether we have a recommended time (only if Round Planner enabled)
    const applyBtn = $("applyPlannerBtn");
    const roundPlannerEnabled = APP.FEATURE_ROUND_PLANNER === true;
    if (applyBtn) {
      if (roundPlannerEnabled && recommendedBestTime && selectedTeeTime !== recommendedBestTime) {
        applyBtn.style.display = "block";
        applyBtn.dataset.recommendedTime = recommendedBestTime;
      } else {
        applyBtn.style.display = "none";
      }
    }

    // Quick stats: Show tomorrow's stats when nighttime
    if (verdictQuickStats) {
      if (isNighttime && tomorrowData) {
        const windMph = tomorrowData.wind !== null ? windSpeedMph(tomorrowData.wind) : null;
        const windText = windMph !== null ? `${roundNum(windMph)} mph` : "—";
        const rainText = tomorrowData.pop !== null ? `${Math.round(tomorrowData.pop * 100)}%` : "—";
        const tempText = tomorrowData.temp !== null ? `${roundNum(tomorrowData.temp)}${tempUnit()}` : "—";

        verdictQuickStats.innerHTML = `
          <div class="ff-quick-stat">
            <span class="ff-quick-label">Tomorrow</span>
            <strong style="font-size:12px;color:var(--muted);">Forecast</strong>
          </div>
          <div class="ff-quick-stat">
            <span class="ff-quick-label">Temp</span>
            <strong>${esc(tempText)}</strong>
          </div>
          <div class="ff-quick-stat">
            <span class="ff-quick-label">Wind</span>
            <strong>${esc(windText)}</strong>
          </div>
          <div class="ff-quick-stat">
            <span class="ff-quick-label">Rain</span>
            <strong>${esc(rainText)}</strong>
          </div>
        `;
      } else if (c) {
        const wind = typeof c.wind_speed === "number" ? c.wind_speed : 0;
        const pop = typeof c.pop === "number" ? c.pop : 0;
        const temp = typeof c.temp === "number" ? c.temp : null;

        const windText = wind > 0 ? `${roundNum(wind, 1)} ${windUnit()}` : "Calm";
        const rainText = `${Math.round(pop * 100)}%`;
        const tempText = temp !== null ? `${roundNum(temp)}${tempUnit()}` : "—";

        verdictQuickStats.innerHTML = `
          <div class="ff-quick-stat">
            <span class="ff-quick-label">Wind</span>
            <strong>${esc(windText)}</strong>
          </div>
          <div class="ff-quick-stat">
            <span class="ff-quick-label">Rain</span>
            <strong>${esc(rainText)}</strong>
          </div>
          <div class="ff-quick-stat">
            <span class="ff-quick-label">Temp</span>
            <strong>${esc(tempText)}</strong>
          </div>
        `;
      } else {
        verdictQuickStats.innerHTML = "";
      }
    }
  }

  // Calculate combined challenge rating (course difficulty + weather)
  function calculateChallengeRating(course, norm) {
    const weatherResult = norm ? calculatePlayingConditions(norm) : null;
    const weatherScore = weatherResult && typeof weatherResult === "object" ? weatherResult.score : weatherResult;
    const weatherFactors = weatherResult && typeof weatherResult === "object" ? weatherResult.factors : {};
    const difficulty = calculateCourseDifficulty(course);
    
    // Weather contribution (0-5 scale, inverted: good weather = low challenge)
    let weatherChallenge = 2.5; // Default moderate
    if (weatherScore !== null && typeof weatherScore === "number") {
      // 10 = easy (1), 0 = hard (5)
      weatherChallenge = 1 + ((10 - weatherScore) / 10) * 4;
    }
    
    // Course contribution (1-5 scale from difficulty)
    let courseChallenge = 3; // Default moderate
    if (difficulty && typeof difficulty.score === "number") {
      courseChallenge = difficulty.score;
    }
    
    // Combined score (weighted average: weather 60%, course 40%)
    const combined = (weatherChallenge * 0.6) + (courseChallenge * 0.4);
    
    return {
      score: clamp(Math.round(combined * 10) / 10, 1, 5),
      weatherScore,
      weatherFactors,
      courseScore: difficulty?.score || null,
      label: getChallengeLabel(combined, weatherScore, difficulty?.score, weatherFactors)
    };
  }
  
  function getChallengeLabel(score, weatherScore, courseScore, weatherFactors = {}) {
    // Determine primary factor for the reason
    const reasonParts = [];
    
    // Weather factors - be specific about conditions
    if (weatherFactors.freezing) {
      reasonParts.push("Freezing temps");
    } else if (weatherFactors.coldTemp) {
      reasonParts.push("Cold conditions");
    } else if (weatherFactors.hotTemp) {
      reasonParts.push("Hot conditions");
    }
    
    if (weatherFactors.heavyRain) {
      reasonParts.push("Heavy rain");
    } else if (weatherFactors.rainy) {
      reasonParts.push("Wet conditions");
    }
    
    if (weatherFactors.strongWind) {
      reasonParts.push("Strong wind");
    }
    
    // If no specific weather issues, describe overall weather
    if (reasonParts.length === 0 && weatherScore !== null) {
      if (weatherScore >= 8) reasonParts.push("Ideal weather");
      else if (weatherScore >= 6) reasonParts.push("Good weather");
      else if (weatherScore >= 4) reasonParts.push("Fair weather");
    }
    
    // Course factor
    if (courseScore !== null) {
      if (courseScore >= 4.5) reasonParts.push("Championship course");
      else if (courseScore >= 4) reasonParts.push("Demanding course");
      else if (courseScore >= 3) reasonParts.push("Moderate course");
      else reasonParts.push("Forgiving course");
    }
    
    const reason = reasonParts.join(" • ") || "Good day for golf";
    
    // Color-coded dots: Green (easy), Amber (medium), Red (hard)
    // Severe weather conditions force tough rating regardless of score
    if (weatherFactors.freezing || weatherFactors.heavyRain) {
      return { text: "Tough", dot: "🔴", class: "hard", reason };
    }
    
    if (score <= 2.2) return { text: "Easy", dot: "🟢", class: "easy", reason };
    if (score <= 3.0) return { text: "Moderate", dot: "🟡", class: "moderate", reason };
    if (score <= 3.8) return { text: "Challenging", dot: "🟠", class: "challenging", reason };
    return { text: "Tough", dot: "🔴", class: "hard", reason };
  }
  
  function renderPlayability(norm) {
    // Render combined playability index (course + weather)
    const challenge = calculateChallengeRating(selectedCourse, norm);
    
    console.log("[Playability] Rendering:", { 
      hasChallenge: !!challenge, 
      label: challenge?.label,
      challengeRatingEl: !!challengeRating 
    });
    
    if (challengeRating) {
      // Always show something - even on initial load
      if (challenge && challenge.label && challenge.label.dot && challenge.label.text) {
        const newText = `${challenge.label.dot} ${challenge.label.text}`;
        console.log("[Playability] Setting text:", newText);
        challengeRating.textContent = newText;
        challengeRating.className = `ff-challenge-badge ff-challenge--${challenge.label.class}`;
      } else {
        console.log("[Playability] Using default");
        challengeRating.textContent = "🟡 Moderate";
        challengeRating.className = "ff-challenge-badge ff-challenge--moderate";
      }
    } else {
      console.warn("[Playability] challengeRating element not found!");
    }
    
    if (challengeReason) {
      if (challenge && challenge.label && challenge.label.reason) {
        challengeReason.textContent = challenge.label.reason;
      } else {
        challengeReason.textContent = "Search for a course to see conditions";
      }
    }
    
    // Render course difficulty (slope/rating based) - separate section
    renderCourseDifficulty(selectedCourse);
  }

  /* ---------- EXPLAINER MODAL ---------- */
  function openInfoModal(title, body, isHtml = false) {
    if (!infoModal || !infoModalTitle || !infoModalBody) {
      console.warn("Modal elements not found");
      return;
    }
    infoModalTitle.textContent = title;
    if (isHtml) {
      infoModalBody.innerHTML = body;
    } else {
      infoModalBody.textContent = body;
    }
    infoModal.removeAttribute("hidden");
    infoModal.style.display = "flex"; // Ensure it shows
    console.log("📋 [Modal] Opened:", title);
  }

  function closeInfoModal() {
    if (!infoModal) return;
    infoModal.setAttribute("hidden", "");
    infoModal.style.display = "none";
    console.log("📋 [Modal] Closed");
  }

  /* ---------- RENDER ---------- */
  function renderHeaderBlock() {
    const favs = loadFavs();
    const starOn = selectedCourse ? isFavourited(selectedCourse) : false;

    const name = selectedCourse?.name ? esc(selectedCourse.name) : "Your location";
    const line2 = [selectedCourse?.city, selectedCourse?.state, selectedCourse?.country].filter(Boolean).join(", ");
    
    // Build course details
    const courseDetails = [];
    if (selectedCourse?.holes) courseDetails.push(`${selectedCourse.holes} holes`);
    if (selectedCourse?.par) courseDetails.push(`Par ${selectedCourse.par}`);
    if (selectedCourse?.yardage) courseDetails.push(`${selectedCourse.yardage.toLocaleString()} yds`);
    if (selectedCourse?.type) courseDetails.push(selectedCourse.type);
    const detailsLine = courseDetails.length > 0 ? courseDetails.join(" · ") : "";
    
    // Check if there's more info to show
    const hasMoreInfo = selectedCourse && (
      selectedCourse.address || 
      selectedCourse.phone || 
      selectedCourse.website || 
      selectedCourse.description ||
      selectedCourse.amenities?.length > 0
    );

    const favStrip =
      favs.length === 0
        ? ""
        : `<div class="ff-favs">
            <div class="ff-favs-title">Favourites</div>
            <div class="ff-favs-list">
              ${favs
                .slice(0, 12)
                .map((f) => {
                  const ll = `${f.lat},${f.lon}`;
                  const title = [f.name, f.city, f.state, f.country].filter(Boolean).join(", ");
                  return `<button type="button" class="ff-fav-pill" data-ll="${esc(
                    ll
                  )}" data-fav-key="${esc(f.key)}" title="${esc(title)}">★ ${esc(f.name || "Favourite")}</button>`;
                })
                .join("")}
            </div>
          </div>`;

    // Course logo/image
    const courseLogo = selectedCourse?.logo ? `<img src="${esc(selectedCourse.logo)}" alt="${name}" class="ff-course-logo" loading="lazy" />` : "";
    const hasImages = selectedCourse?.images && Array.isArray(selectedCourse.images) && selectedCourse.images.length > 0;
    
    // Course rating
    const rating = selectedCourse?.review_rating || selectedCourse?.rating;
    const reviewCount = selectedCourse?.review_count;
    const ratingHtml = rating ? `<div class="ff-course-rating">${renderStarRating(rating)}${reviewCount ? `<span class="ff-rating-count">(${reviewCount})</span>` : ""}</div>` : "";
    
    // Quick actions
    const quickActions = [];
    if (selectedCourse?.phone) {
      quickActions.push(`<a href="tel:${esc(selectedCourse.phone)}" class="ff-action-btn" aria-label="Call ${name}" title="Call">📞</a>`);
    }
    if (selectedCourse?.website) {
      const websiteUrl = selectedCourse.website.startsWith('http') ? selectedCourse.website : `https://${selectedCourse.website}`;
      quickActions.push(`<a href="${esc(websiteUrl)}" target="_blank" rel="noopener" class="ff-action-btn" aria-label="Visit website" title="Website">🌐</a>`);
    }
    if (selectedCourse?.booking_url) {
      const bookingUrl = selectedCourse.booking_url.startsWith('http') ? selectedCourse.booking_url : `https://${selectedCourse.booking_url}`;
      quickActions.push(`<a href="${esc(bookingUrl)}" target="_blank" rel="noopener" class="ff-action-btn" aria-label="Book tee time" title="Book">📅</a>`);
    }
    const quickActionsHtml = quickActions.length > 0 ? `<div class="ff-quick-actions">${quickActions.join("")}</div>` : "";

    return `<div class="ff-card ff-course-header">
      <div class="ff-course-header-main">
        <div class="ff-course-header-left">
          ${courseLogo}
          <div>
            <div class="ff-course-title">${name}</div>
            ${ratingHtml}
            ${line2 ? `<div class="ff-sub">${esc(line2)}</div>` : ""}
            ${detailsLine ? `<div class="ff-course-details">${esc(detailsLine)}</div>` : ""}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${
            hasMoreInfo
              ? `<button type="button" class="ff-btn ff-btn-ghost" id="courseInfoBtn" title="View course details">ℹ️</button>`
              : ""
          }
          ${
            selectedCourse
              ? `<button type="button" class="ff-btn ff-btn-ghost ff-star" id="favBtn" title="Favourite">${starOn ? "★" : "☆"}</button>`
              : ""
          }
        </div>
      </div>
      ${quickActionsHtml}
      ${favStrip}
    </div>`;
  }

  function renderRoundPlayability(norm) {
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (hourly.length === 0) return "";
    
    // Get sunrise/sunset for daylight-only windows
    const sunrise = norm?.sunrise;
    const sunset = norm?.sunset;
    const tzOffset = norm?.timezoneOffset || 0;
    const now = nowSec();
    const isNighttime = sunrise && sunset && now > sunset;
    
    // Calculate daylight hours in COURSE local time
    // Convert sunrise/sunset to course local time to get correct hours
    const getCourseHour = (ts) => {
      if (!ts) return null;
      const courseDate = new Date((ts + tzOffset) * 1000);
      return courseDate.getUTCHours();
    };
    
    const sunriseHour = getCourseHour(sunrise) ?? 6;
    const sunsetHour = getCourseHour(sunset) ?? 19;
    
    // Define windows based on actual daylight (sunrise to sunset only)
    const dayLength = sunsetHour - sunriseHour;
    const thirdOfDay = Math.floor(dayLength / 3);
    
    const windows = [
      { name: "Morning", start: sunriseHour, end: sunriseHour + thirdOfDay },
      { name: "Midday", start: sunriseHour + thirdOfDay, end: sunriseHour + (thirdOfDay * 2) },
      { name: "Late", start: sunriseHour + (thirdOfDay * 2), end: sunsetHour }
    ];
    
    const windowsData = windows.map(win => {
      const windowHours = hourly.filter(h => {
        if (!h?.dt) return false;
        
        // Get hour in COURSE local time
        const courseHour = getCourseHour(h.dt);
        if (courseHour === null) return false;
        
        // Check if this hour is for today or tomorrow (in course local time)
        const nowCourseDate = new Date((now + tzOffset) * 1000);
        const hCourseDate = new Date((h.dt + tzOffset) * 1000);
        
        const nowDay = nowCourseDate.getUTCDate();
        const hDay = hCourseDate.getUTCDate();
        
        // If night time, filter for tomorrow's hours
        if (isNighttime) {
          if (hDay !== nowDay + 1) return false;
        } else {
          // Normal daytime - use today's hours
          if (hDay !== nowDay) return false;
        }
        
        // Only include daylight hours
        return courseHour >= win.start && courseHour < win.end;
      });
      
      if (windowHours.length === 0) return null;
      
      const temps = windowHours.map(h => h.temp).filter(t => typeof t === "number");
      const winds = windowHours.map(h => windSpeedMph(h.wind_speed)).filter(w => w !== null);
      const pops = windowHours.map(h => typeof h.pop === "number" ? h.pop : 0);
      const rainMms = windowHours.map(h => typeof h.rain_mm === "number" ? h.rain_mm : 0);
      
      const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
      const maxWind = winds.length > 0 ? Math.max(...winds) : null;
      const maxPop = pops.length > 0 ? Math.max(...pops) : null;
      const totalRain = rainMms.reduce((a, b) => a + b, 0);
      
      // Determine status
      let status = "Playable ✅";
      let statusClass = "ff-round-playable";
      const reasons = [];
      
      if (maxWind !== null) {
        if (maxWind > 22) {
          status = "Poor ❌";
          statusClass = "ff-round-poor";
          reasons.push(`Wind ${roundNum(maxWind)} mph`);
        } else if (maxWind > 15) {
          status = "Marginal ⚠️";
          statusClass = "ff-round-marginal";
          reasons.push(`Wind ${roundNum(maxWind)} mph`);
        }
      }
      
      if (maxPop !== null) {
        if (maxPop >= 0.7 || totalRain > 5) {
          status = "Poor ❌";
          statusClass = "ff-round-poor";
          reasons.push(`Rain risk ${Math.round(maxPop * 100)}%`);
        } else if (maxPop >= 0.4 || totalRain > 2) {
          if (status === "Playable ✅") {
            status = "Marginal ⚠️";
            statusClass = "ff-round-marginal";
          }
          reasons.push(`Rain risk ${Math.round(maxPop * 100)}%`);
        }
      }
      
      const reasonText = reasons.length > 0 ? reasons.join(" • ") : "Good conditions";
      
      return {
        name: win.name,
        timeRange: `${win.start.toString().padStart(2, '0')}:00–${win.end.toString().padStart(2, '0')}:00`,
        status,
        statusClass,
        reasonText,
        avgTemp: avgTemp ? roundNum(avgTemp) : null,
        maxWind: maxWind ? roundNum(maxWind) : null,
        maxPop: maxPop ? Math.round(maxPop * 100) : null
      };
    }).filter(w => w !== null);
    
    if (windowsData.length === 0) return "";
    
    const tomorrowLabel = isNighttime ? " (Tomorrow)" : "";
    
    const windowsHtml = windowsData.map(w => `
      <div class="ff-round-window ${w.statusClass}">
        <div class="ff-round-window-header">
          <div class="ff-round-window-name">${esc(w.name)}${tomorrowLabel ? `<span class="ff-tomorrow-label-small">${esc(tomorrowLabel)}</span>` : ""}</div>
          <div class="ff-round-window-time">${esc(w.timeRange)}</div>
        </div>
        <div class="ff-round-window-status">${esc(w.status)}</div>
        <div class="ff-round-window-reason">${esc(w.reasonText)}</div>
        <div class="ff-round-window-details">
          ${w.avgTemp !== null ? `<span>${w.avgTemp}${tempUnit()}</span>` : ""}
          ${w.maxWind !== null ? `<span>Wind ${w.maxWind} mph</span>` : ""}
          ${w.maxPop !== null ? `<span>Rain ${w.maxPop}%</span>` : ""}
        </div>
      </div>
    `).join("");
    
    return `<div class="ff-round-playability-grid">${windowsHtml}</div>`;
  }

  function renderCurrent(norm) {
    if (!norm) return `<div class="ff-card muted">No current weather available.</div>`;
    
    // Check if it's nighttime and show tomorrow's forecast
    const sunrise = norm.sunrise;
    const sunset = norm.sunset;
    const now = nowSec();
    const isNighttime = sunrise && sunset && now > sunset;
    
    let c = norm.current;
    let isTomorrow = false;
    let tomorrowLabel = "";
    
    if (isNighttime) {
      const daily = Array.isArray(norm?.daily) ? norm.daily : [];
      const tomorrow = daily.length > 0 ? daily[0] : null;
      if (tomorrow) {
        // Use tomorrow's data for display
        c = {
          dt: tomorrow.dt,
          temp: tomorrow.max,
          feels_like: tomorrow.max,
          weather: tomorrow.weather || [],
          pop: tomorrow.pop || 0,
          wind_speed: null, // Daily doesn't have wind, will show from hourly
          wind_deg: null,
        };
        isTomorrow = true;
        tomorrowLabel = " (Tomorrow)";
      }
    }
    
    if (!c) return `<div class="ff-card muted">No current weather available.</div>`;

    const t = typeof c.temp === "number" ? `${roundNum(c.temp)}${tempUnit()}` : "—";
    const feelsLike = typeof c.feels_like === "number" ? `${roundNum(c.feels_like)}${tempUnit()}` : null;
    const desc = c?.weather?.[0]?.description || c?.weather?.[0]?.main || "—";
    const ico = iconHtml(c.weather, 2);
    
    // Get current time display (course local and device time)
    const currentTime = getCourseAndDeviceTime(c.dt || now, norm.timezoneOffset);
    const timeDisplay = currentTime.course && currentTime.device ? `${currentTime.course} course · ${currentTime.device} you` : "";

    const windSpeed = typeof c.wind_speed === "number" ? c.wind_speed : null;
    const windSpeedRounded = windSpeed ? roundNum(windSpeed, 1) : null;
    const wind = windSpeedRounded !== null ? `${windSpeedRounded} ${windUnit()}` : "";
    const windDir = c.wind_deg;
    const windDirText = windDir ? windDirection(windDir) : "";
    const windCompass = windDir && windSpeed ? windCompassHtml(windDir, windSpeed) : "";
    
    // Calculate wind impact if course direction is set
    const windImpact = courseDirection && windDir ? calculateWindImpact(windDir, courseDirection) : null;
    const impactTag = windImpact ? `<span class="ff-wind-impact ff-wind-impact--${windImpact.toLowerCase()}">${esc(windImpact)}</span>` : "";
    
    const windDisplay = wind ? `<div class="ff-wind-display">${windCompass}<div class="ff-wind-text"><strong>${esc(wind)}</strong>${windDirText ? `<span class="ff-wind-dir"> from ${esc(windDirText)}</span>` : ""}${impactTag}</div></div>` : "";

    const gust = typeof c.wind_gust === "number" ? `${roundNum(c.wind_gust, 1)} ${windUnit()}` : "";
    const humidity = typeof c.humidity === "number" ? `${Math.round(c.humidity)}%` : "";
    const popValue = typeof c.pop === "number" ? c.pop : 0;
    const rainProb = pct(popValue);
    const rainMm = typeof c.rain_mm === "number" && c.rain_mm > 0 ? `${roundNum(c.rain_mm, 1)} mm` : "";
    const rain = [rainProb, rainMm].filter(Boolean).join(" · ");

    // Get sunrise/sunset times (for tomorrow if nighttime)
    let sunriseTime = "";
    let sunsetTime = "";
    const tzOff = norm?.timezoneOffset || null;
    if (isNighttime && isTomorrow) {
      // Use tomorrow's sunrise/sunset - estimate or use next day's data
      const daily = Array.isArray(norm?.daily) ? norm.daily : [];
      const tomorrow = daily.length > 0 ? daily[0] : null;
      // Note: Daily data might not have sunrise/sunset, so we'll show current day's for reference
      sunriseTime = norm.sunrise ? fmtTimeCourse(norm.sunrise, tzOff) : "";
      sunsetTime = norm.sunset ? fmtTimeCourse(norm.sunset, tzOff) : "";
    } else {
      sunriseTime = norm.sunrise ? fmtTimeCourse(norm.sunrise, tzOff) : "";
      sunsetTime = norm.sunset ? fmtTimeCourse(norm.sunset, tzOff) : "";
    }

    const best = isNighttime ? null : bestTimeToday(norm);
    const bestText = best?.dt ? fmtTimeCourse(best.dt, tzOff) : "";

    const stats = [
      timeDisplay ? `<div class="ff-stat"><span>Time</span><strong>${esc(timeDisplay)}</strong></div>` : "",
      windDisplay || (wind ? `<div class="ff-stat"><span>Wind</span><strong>${esc(wind)}</strong></div>` : ""),
      gust ? `<div class="ff-stat"><span>Gust</span><strong>${esc(gust)}</strong></div>` : "",
      humidity ? `<div class="ff-stat"><span>Humidity</span><strong>${esc(humidity)}</strong></div>` : "",
      rain ? `<div class="ff-stat"><span>Rain</span><strong>${esc(rain)}</strong></div>` : "",
      sunriseTime ? `<div class="ff-stat"><span>Sunrise</span><strong>${esc(sunriseTime)}</strong></div>` : "",
      sunsetTime ? `<div class="ff-stat"><span>Sunset</span><strong>${esc(sunsetTime)}</strong></div>` : "",
      bestText ? `<div class="ff-stat"><span>Best time</span><strong>${esc(bestText)}</strong></div>` : "",
    ].filter(Boolean).join("");

    const nighttimeBadge = isNighttime ? `<div class="ff-nighttime-badge">🌙 Night time — Showing tomorrow's forecast</div>` : "";

    return `<div class="ff-card ff-current">
      ${nighttimeBadge}
      <div class="ff-current-top">
        <div class="ff-current-left">
          <div class="ff-current-temp">${esc(t)}${feelsLike ? `<span class="ff-feels-like">Feels like ${esc(feelsLike)}</span>` : ""}${isTomorrow ? `<span class="ff-tomorrow-label">${esc(tomorrowLabel)}</span>` : ""}</div>
          <div class="ff-current-desc">${esc(desc)}</div>
        </div>
        <div class="ff-current-icon">${ico || ""}</div>
      </div>
      <div class="ff-stats-grid">${stats || `<div class="muted">No extra details.</div>`}</div>
    </div>`;
  }

  function renderHourly(norm) {
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (!hourly.length) return `<div class="ff-card muted">No hourly data available.</div>`;

    const best = bestTimeToday(norm);
    const bestDt = best?.dt || null;
    const tzOff = norm?.timezoneOffset || null;

    // Prepare data for mini charts
    const windValues = hourly.map(h => typeof h.wind_speed === "number" ? h.wind_speed : 0);
    const rainValues = hourly.map(h => typeof h.rain_mm === "number" ? h.rain_mm : 0);

    const cards = hourly.slice(0, 16).map((h) => {
      const time = h?.dt ? fmtTimeCourse(h.dt, tzOff) : "";
      const t = typeof h.temp === "number" ? `${Math.round(h.temp)}${tempUnit()}` : "";
      const popValue = typeof h.pop === "number" ? h.pop : 0;
      const rainProb = pct(popValue);
      const rainMm = `${(typeof h.rain_mm === "number" ? h.rain_mm : 0).toFixed(2)} mm`;
      const rain = [rainProb, rainMm].filter(Boolean).join(" · ");
      const windSpeedRounded = typeof h.wind_speed === "number" ? roundNum(h.wind_speed, 1) : null;
      const wind = windSpeedRounded !== null ? `${windSpeedRounded} ${windUnit()}` : "";
      const windDir = h.wind_deg;
      const windDirText = windDir ? windDirection(windDir) : "";
      const windImpact = courseDirection && windDir ? calculateWindImpact(windDir, courseDirection) : null;
      const impactTag = windImpact ? `<span class="ff-wind-impact-small ff-wind-impact--${windImpact.toLowerCase()}">${esc(windImpact)}</span>` : "";
      const ico = iconHtml(h.weather, 1);
      const isBest = h?.dt === bestDt;

      return `<div class="ff-hourly-card ${isBest ? "ff-hourly-best" : ""}" ${isBest ? 'data-best="true" title="Best tee time"' : ""}>
        <div class="ff-hourly-time">${esc(time)}</div>
        <div class="ff-hourly-icon">${ico || ""}</div>
        <div class="ff-hourly-temp">${esc(t)}</div>
        <div class="ff-hourly-rain">${esc(rainProb || "0%")}</div>
        <div class="ff-hourly-wind">${wind ? `${esc(wind)}${windDirText ? ` ${esc(windDirText)}` : ""}` : "—"}${impactTag}</div>
      </div>`;
    }).join("");

    return `<div class="ff-card">
      <div class="ff-card-title">Hourly Forecast</div>
      <div class="ff-hourly-scroll">
        ${cards}
      </div>
      <div class="ff-hourly-charts">
        <div class="ff-chart-group">
          <div class="ff-chart-label">Wind ${windUnit()}</div>
          ${miniBarChart(windValues, Math.max(...windValues), "var(--brand)")}
        </div>
        <div class="ff-chart-group">
          <div class="ff-chart-label">Rain mm</div>
          ${miniBarChart(rainValues, Math.max(...rainValues, 1), "rgba(15,118,110,0.6)")}
        </div>
      </div>
    </div>`;
  }

  function renderDaily(norm) {
    const daily = Array.isArray(norm?.daily) ? norm.daily : [];
    if (!daily.length) return `<div class="ff-card muted">No daily data available.</div>`;
    
    // Show up to 7 days if data exists
    const daysToShow = Math.min(daily.length, 7);

    const rows = daily.slice(0, daysToShow).map((d, idx) => {
      const day = d?.dt ? fmtDay(d.dt) : "";
      const hi = typeof d.max === "number" ? Math.round(d.max) : null;
      const lo = typeof d.min === "number" ? Math.round(d.min) : null;
      const hiLo = hi !== null && lo !== null ? `${hi}${tempUnit()} / ${lo}${tempUnit()}` : "";
      const rain = typeof d.pop === "number" ? pct(d.pop) : "";
      const summary = d?.weather?.[0]?.main || d?.weather?.[0]?.description || "";
      const ico = iconHtml(d.weather, 2);
      const dayDt = d?.dt || null;

      return `<tr class="ff-daily-row" data-day-dt="${dayDt || ""}" data-day-idx="${idx}" style="cursor:pointer;" title="Click for play prediction">
        <td class="ff-td-day">${esc(day)} <span class="ff-info-icon" title="Click for prediction">ℹ️</span></td>
        <td class="ff-td-icon">${ico || ""}</td>
        <td>${esc(hiLo)}</td>
        <td>${esc(rain)}</td>
        <td>${esc(summary)}</td>
      </tr>`;
    }).join("");

    return `<div class="ff-card">
      <div class="ff-card-title">Daily${daysToShow === 7 ? " · up to 7 days" : ` · ${daysToShow} day${daysToShow !== 1 ? "s" : ""}`}</div>
      <div class="ff-table-wrap">
        <table class="ff-table">
          <thead>
            <tr><th>Day</th><th></th><th>High/Low</th><th>Rain</th><th>Summary</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  function showCourseDetails(course) {
    if (!course) return;
    
    const c = normalizeCourse(course);
    const details = [];
    
    // Course images gallery
    if (Array.isArray(c.images) && c.images.length > 0) {
      const imagesHtml = c.images.slice(0, 6).map((img, idx) => 
        `<img src="${esc(img)}" alt="${esc(c.name)} - Image ${idx + 1}" class="ff-course-image" loading="lazy" onclick="window.open('${esc(img)}', '_blank')" />`
      ).join("");
      details.push(`<div class="ff-course-images-gallery">${imagesHtml}</div>`);
    } else if (c.logo) {
      details.push(`<div class="ff-course-images-gallery"><img src="${esc(c.logo)}" alt="${esc(c.name)} logo" class="ff-course-image" loading="lazy" /></div>`);
    }
    
    // Rating and reviews
    const rating = c.review_rating || c.rating;
    if (rating) {
      const ratingDisplay = renderStarRating(rating);
      const reviewInfo = [];
      if (c.review_count) reviewInfo.push(`${c.review_count} review${c.review_count !== 1 ? 's' : ''}`);
      details.push(`<div class="ff-course-detail-row"><strong>Rating:</strong> ${ratingDisplay} ${rating.toFixed(1)}/5${reviewInfo.length > 0 ? ` · ${reviewInfo.join(', ')}` : ''}</div>`);
    }
    
    // Basic info
    if (c.club_name && c.club_name !== c.name) {
      details.push(`<div class="ff-course-detail-row"><strong>Club:</strong> ${esc(c.club_name)}</div>`);
    }
    if (c.address) {
      details.push(`<div class="ff-course-detail-row"><strong>Address:</strong> ${esc(c.address)}</div>`);
    }
    if (c.postal_code) {
      details.push(`<div class="ff-course-detail-row"><strong>Postal Code:</strong> ${esc(c.postal_code)}</div>`);
    }
    
    // Contact
    if (c.phone) {
      details.push(`<div class="ff-course-detail-row"><strong>Phone:</strong> <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div>`);
    }
    if (c.email) {
      details.push(`<div class="ff-course-detail-row"><strong>Email:</strong> <a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>`);
    }
    if (c.website) {
      const websiteUrl = c.website.startsWith('http') ? c.website : `https://${c.website}`;
      details.push(`<div class="ff-course-detail-row"><strong>Website:</strong> <a href="${esc(websiteUrl)}" target="_blank" rel="noopener">${esc(c.website)}</a></div>`);
    }
    
    // Course specs
    const specs = [];
    if (c.holes) specs.push(`${c.holes} holes`);
    if (c.par) specs.push(`Par ${c.par}`);
    if (c.yardage) specs.push(`${c.yardage.toLocaleString()} yards`);
    if (c.rating) specs.push(`Rating ${c.rating}`);
    if (c.slope) specs.push(`Slope ${c.slope}`);
    if (specs.length > 0) {
      details.push(`<div class="ff-course-detail-row"><strong>Course Specs:</strong> ${esc(specs.join(" · "))}</div>`);
    }
    
    if (c.type) {
      details.push(`<div class="ff-course-detail-row"><strong>Type:</strong> ${esc(c.type)}</div>`);
    }
    if (c.style) {
      details.push(`<div class="ff-course-detail-row"><strong>Style:</strong> ${esc(c.style)}</div>`);
    }
    if (c.designer) {
      details.push(`<div class="ff-course-detail-row"><strong>Designer:</strong> ${esc(c.designer)}</div>`);
    }
    if (c.year_opened) {
      details.push(`<div class="ff-course-detail-row"><strong>Year Opened:</strong> ${c.year_opened}</div>`);
    }
    
    // Description
    if (c.description) {
      details.push(`<div class="ff-course-detail-row" style="margin-top:12px;"><div style="margin-top:8px;">${esc(c.description)}</div></div>`);
    }
    
    // Amenities
    if (Array.isArray(c.amenities) && c.amenities.length > 0) {
      details.push(`<div class="ff-course-detail-row" style="margin-top:12px;"><strong>Amenities:</strong> ${esc(c.amenities.join(", "))}</div>`);
    }
    
    // Booking
    if (c.booking_url) {
      const bookingUrl = c.booking_url.startsWith('http') ? c.booking_url : `https://${c.booking_url}`;
      details.push(`<div class="ff-course-detail-row" style="margin-top:12px;"><a href="${esc(bookingUrl)}" target="_blank" rel="noopener" class="ff-btn ff-btn-primary" style="display:inline-block;margin-top:8px;">Book Tee Time</a></div>`);
    }
    
    // Share button
    if (navigator.share && selectedCourse) {
      details.push(`<div class="ff-course-detail-row" style="margin-top:12px;"><button type="button" class="ff-btn ff-btn-ghost" id="shareCourseBtn" style="width:100%;">📤 Share Course & Weather</button></div>`);
    }
    
    if (details.length === 0) {
      openInfoModal(c.name || "Course Details", "No additional information available for this course.");
      return;
    }
    
    openInfoModal(c.name || "Course Details", details.join(""), true);
  }

  function wireHeaderButtons() {
    const host = locationSlot || resultsEl;
    const favBtn = $("favBtn");
    favBtn?.addEventListener("click", () => toggleFavourite(selectedCourse));
    
    const courseInfoBtn = $("courseInfoBtn");
    courseInfoBtn?.addEventListener("click", () => showCourseDetails(selectedCourse));
    
    // Wire up share button if it exists
    const shareCourseBtn = $("shareCourseBtn");
    shareCourseBtn?.addEventListener("click", async () => {
      if (!navigator.share || !selectedCourse) return;
      const c = normalizeCourse(selectedCourse);
      const weather = lastNorm?.current;
      const temp = weather?.temp ? `${Math.round(weather.temp)}${tempUnit()}` : "";
      const condition = weather?.weather?.[0]?.description || "checking weather";
      const playability = calculatePlayability(lastNorm);
      
      try {
        await navigator.share({
          title: `${c.name} - Golf Weather Forecast`,
          text: `🏌️ Playing at ${c.name} today!\n🌤️ Weather: ${temp}, ${condition}\n✅ Playability: ${playability}/10\n📍 ${[c.city, c.state, c.country].filter(Boolean).join(", ")}`,
          url: window.location.href
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    });

    const favs = loadFavs();

    host
      ?.querySelectorAll("[data-ll]")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const favKeyAttr = btn.getAttribute("data-fav-key") || null;
          const ll = btn.getAttribute("data-ll") || "";
          const [latStr, lonStr] = ll.split(",");
          const lat = Number(latStr);
          const lon = Number(lonStr);

          let next = null;
          if (favKeyAttr) {
            const fromStore = favs.find((f) => f.key === favKeyAttr);
            if (fromStore) {
              next = {
                id: fromStore.id ?? null,
                name: fromStore.name ?? "",
                city: fromStore.city ?? "",
                state: fromStore.state ?? "",
                country: fromStore.country ?? "",
                lat: fromStore.lat ?? null,
                lon: fromStore.lon ?? null,
              };
            }
          }

          if (!next) {
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
            next = {
              id: null,
              name: btn.textContent.replace(/^★\s*/, ""),
              city: "",
              state: "",
              country: "",
              lat,
              lon,
            };
          }

          selectedCourse = next;
          loadWeatherForSelected();
        });
      });
  }

  function renderNearbyCourses() {
    if (!Array.isArray(nearbyCourses) || nearbyCourses.length === 0) return "";
    
    const items = nearbyCourses.map((course, idx) => {
      const c = normalizeCourse(course);
      const distance = typeof course.distance === "number" ? course.distance.toFixed(1) : "";
      const line2 = [c.city, c.state, c.country].filter(Boolean).join(", ");
      const rating = c.review_rating || c.rating;
      const ratingHtml = rating ? renderStarRating(rating) : "";
      
      return `<button class="ff-nearby-course" type="button" data-course-idx="${idx}" data-course-lat="${c.lat || ''}" data-course-lon="${c.lon || ''}">
        <div class="ff-nearby-course-main">
          <div class="ff-nearby-course-name">${esc(c.name)}</div>
          ${ratingHtml ? `<div class="ff-nearby-course-rating">${ratingHtml}</div>` : ""}
          <div class="ff-nearby-course-location">${esc(line2)}</div>
        </div>
        <div class="ff-nearby-course-distance">${distance} km</div>
      </button>`;
    }).join("");

    return `<div class="ff-card">
      <div class="ff-card-title">Nearby Courses</div>
      <div class="ff-nearby-courses-list">${items}</div>
    </div>`;
  }

  function renderAll() {
    const header = renderHeaderBlock();

    let body = "";
    if (!lastNorm) {
      body = `<div class="ff-card muted">Search a place or course to see the forecast.</div>`;
    } else if (activeTab === "current") {
      body = renderCurrent(lastNorm);
    } else if (activeTab === "hourly") {
      body = renderHourly(lastNorm);
    } else {
      body = renderDaily(lastNorm);
    }
    
    // Render round-based playability
    const roundPlayabilityHtml = lastNorm ? renderRoundPlayability(lastNorm) : "";
    const roundPlayabilityCard = $("roundPlayabilityCard");
    const roundPlayabilitySection = $("roundPlayabilitySection");
    if (roundPlayabilityCard && roundPlayabilityHtml) {
      roundPlayabilityCard.innerHTML = roundPlayabilityHtml;
      if (roundPlayabilitySection) roundPlayabilitySection.style.display = "block";
    } else if (roundPlayabilitySection) {
      roundPlayabilitySection.style.display = "none";
    }
    
    // Show/hide advanced section (only when course selected AND feature flag enabled)
    const advancedSection = $("advancedSection");
    const advancedWindEnabled = APP.FEATURE_ADVANCED_WIND === true;
    if (advancedSection && selectedCourse && advancedWindEnabled) {
      advancedSection.style.display = "block";
    } else if (advancedSection) {
      advancedSection.style.display = "none";
    }
    
    // Show/hide Round Planner section (only when feature flag enabled)
    const roundPlannerSection = $("roundPlannerSection");
    const roundPlannerEnabled = APP.FEATURE_ROUND_PLANNER === true;
    if (roundPlannerSection) {
      roundPlannerSection.style.display = roundPlannerEnabled ? "block" : "none";
    }
    
    // Show/hide Premium teaser (when premium features are disabled and course is selected)
    const premiumTeaserSection = $("premiumTeaserSection");
    const showPremiumTeaser = selectedCourse && (!roundPlannerEnabled || !advancedWindEnabled);
    if (premiumTeaserSection) {
      premiumTeaserSection.style.display = showPremiumTeaser ? "block" : "none";
    }
    
    // Update last updated timestamp
    const lastUpdatedEl = $("lastUpdated");
    if (lastUpdatedEl && lastWeatherUpdate) {
      const updateTime = new Date(lastWeatherUpdate);
      const localTime = updateTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      lastUpdatedEl.textContent = `Last updated: ${localTime}`;
      lastUpdatedEl.style.display = "block";
    } else if (lastUpdatedEl) {
      lastUpdatedEl.style.display = "none";
    }
    
    // Add nearby courses section if we have a selected course
    const nearbySection = selectedCourse && Number.isFinite(selectedCourse.lat) && Number.isFinite(selectedCourse.lon) 
      ? renderNearbyCourses() 
      : "";

    if (locationSlot) locationSlot.innerHTML = header;
    if (forecastSlot) {
      forecastSlot.innerHTML = body + (nearbySection ? `<div style="margin-top:var(--gap);">${nearbySection}</div>` : "");
    } else if (resultsEl && !locationSlot) {
      // fallback for legacy markup
      resultsEl.innerHTML = `${header}${body}${nearbySection ? `<div style="margin-top:var(--gap);">${nearbySection}</div>` : ""}`;
    }

    wireHeaderButtons();
    wireDailyRows();
    wireNearbyCourses();
    
    // Render Tee-Time Decision Strip
    if (lastNorm) {
      renderTeeTimeStrip(lastNorm);
    }
  }
  
  function wireNearbyCourses() {
    const host = forecastSlot || resultsEl;
    if (!host) return;
    
    host.querySelectorAll(".ff-nearby-course").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.getAttribute("data-course-idx"));
        const course = nearbyCourses[idx];
        if (!course) return;
        
        const c = normalizeCourse(course);
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) {
          showError("That course is missing coordinates.", "Try another course.");
          return;
        }
        
        selectedCourse = c;
        nearbyCourses = []; // Clear nearby courses when switching
        await loadWeatherForSelected();
        // Fetch new nearby courses after loading weather
        if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
          nearbyCourses = await fetchNearbyCourses(c.lat, c.lon);
          renderAll();
        }
      });
    });
  }

  function wireDailyRows() {
    const host = forecastSlot || resultsEl;
    if (!host) return;

    host.querySelectorAll(".ff-daily-row").forEach((row) => {
      row.addEventListener("click", () => {
        const dayDtStr = row.getAttribute("data-day-dt");
        const dayIdxStr = row.getAttribute("data-day-idx");
        
        if (!dayDtStr || !lastNorm) return;
        
        const dayDt = Number(dayDtStr);
        const dayIdx = Number(dayIdxStr);
        
        if (!Number.isFinite(dayDt) || !Number.isFinite(dayIdx)) return;
        
        const daily = Array.isArray(lastNorm?.daily) ? lastNorm.daily : [];
        const dayData = daily[dayIdx];
        
        if (!dayData) return;
        
        const verdict = calculateVerdictForDay(lastNorm, dayDt, dayData);
        const dayName = dayData?.dt ? fmtDay(dayData.dt) : "Selected day";
        const tzOff = lastNorm?.timezoneOffset || null;
        const bestTime = verdict.best && typeof verdict.best.dt === "number" ? fmtTimeCourse(verdict.best.dt, tzOff) : "—";
        
        // Show prediction in modal
        const verdictIcon = verdict.status === "PLAY" ? "✅" : verdict.status === "MAYBE" ? "⚠️" : "⛔";
        const verdictLabel = verdict.label || "No prediction";
        const body = `${verdictIcon} ${verdictLabel}\n\n${verdict.reason}\n\nBest tee time: ${bestTime}\n\nThis prediction considers wind strength, rain probability, temperature comfort, and daylight hours for ${dayName}.`;
        
        openInfoModal(`${dayName} - Play Prediction`, body);
      });
    });
  }

  /* ---------- SEARCH ---------- */
  function normalizeCourse(raw) {
    return {
      // Basic identification
      id: raw?.id ?? null,
      name: raw?.name || raw?.course_name || raw?.club_name || "Course",
      club_name: raw?.club_name || "",
      course_name: raw?.course_name || "",
      
      // Location
      city: raw?.city || "",
      state: raw?.state || "",
      country: raw?.country || "",
      lat: typeof raw?.lat === "number" ? raw.lat : null,
      lon: typeof raw?.lon === "number" ? raw.lon : null,
      address: raw?.address || "",
      postal_code: raw?.postal_code || "",
      
      // Contact information
      phone: raw?.phone || "",
      website: raw?.website || "",
      email: raw?.email || "",
      
      // Course details
      par: typeof raw?.par === "number" ? raw.par : null,
      yardage: typeof raw?.yardage === "number" ? raw.yardage : null,
      rating: typeof raw?.rating === "number" ? raw.rating : null,
      slope: typeof raw?.slope === "number" ? raw.slope : null,
      holes: typeof raw?.holes === "number" ? raw.holes : null,
      type: raw?.type || "",
      description: raw?.description || "",
      style: raw?.style || "",
      designer: raw?.designer || "",
      year_opened: typeof raw?.year_opened === "number" ? raw.year_opened : null,
      
      // Media
      images: Array.isArray(raw?.images) ? raw.images : [],
      logo: raw?.logo || "",
      
      // Amenities & features
      amenities: Array.isArray(raw?.amenities) ? raw.amenities : [],
      facilities: raw?.facilities || "",
      
      // Additional info
      green_fees: raw?.green_fees || null,
      booking_url: raw?.booking_url || "",
      reviews: raw?.reviews || null,
      review_rating: typeof raw?.review_rating === "number" ? raw.review_rating : null,
      review_count: typeof raw?.review_count === "number" ? raw.review_count : null,
    };
  }

  function clearSearchResults() {
    if (searchResultsSlot) {
      console.log("[Search] Clearing search results");
      searchResultsSlot.innerHTML = "";
      // Hide when empty - use class-based approach for reliability
      searchResultsSlot.classList.add("ff-hidden");
      searchResultsSlot.style.display = "";  // Reset inline style, let CSS handle it
    }
  }

  function renderSearchResults(list) {
    // Ensure list is an array
    if (!Array.isArray(list)) {
      console.error("[Search] ❌ renderSearchResults called with non-array:", list);
      list = [];
    }
    
    console.log(`[Search] renderSearchResults called with`, list.length, "items");
    
    const header = renderHeaderBlock();

    if (locationSlot) {
      locationSlot.innerHTML = header;
    }

    // Always use searchResultsSlot if it exists, otherwise fallback
    const resultsHost = searchResultsSlot || forecastSlot || resultsEl;
    
    if (!resultsHost) {
      console.error("[Search] ❌ No host element found for search results");
      console.error("   searchResultsSlot:", searchResultsSlot);
      console.error("   forecastSlot:", forecastSlot);
      console.error("   resultsEl:", resultsEl);
      return;
    }
    
    console.log(`[Search] ✅ Rendering ${list.length} result(s) to`, resultsHost.id || "host element");
    
    // Ensure searchResultsSlot is visible when we have results
    if (searchResultsSlot && list.length > 0) {
      searchResultsSlot.classList.remove("ff-hidden");
      searchResultsSlot.style.display = "";  // Reset inline styles
      searchResultsSlot.style.visibility = "";
    }

    if (!Array.isArray(list) || list.length === 0) {
      if (resultsHost) resultsHost.innerHTML = `<div class="ff-card muted">No matches found. Try adding “golf / club / gc”.</div>`;
      wireHeaderButtons();
      if (searchResultsSlot) {
        searchResultsSlot.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    const items = list.slice(0, MAX_RESULTS).map((raw, idx) => {
      const c = normalizeCourse(raw);
      const line2 = [c.city, c.state, c.country].filter(Boolean).join(", ");
      const disabled = !(Number.isFinite(c.lat) && Number.isFinite(c.lon));
      
      // Build course details line
      const details = [];
      if (c.holes) details.push(`${c.holes} holes`);
      if (c.par) details.push(`Par ${c.par}`);
      if (c.yardage) details.push(`${c.yardage.toLocaleString()} yds`);
      if (c.type) details.push(c.type);
      const detailsLine = details.length > 0 ? details.join(" · ") : "";
      
      return `<button class="ff-result" type="button" data-i="${idx}" ${disabled ? "disabled" : ""}>
        <div class="ff-result-main">
          <div class="ff-result-title">${esc(c.name)}</div>
          <div class="ff-result-sub">${esc(line2)}</div>
          ${detailsLine ? `<div class="ff-result-details">${esc(detailsLine)}</div>` : ""}
        </div>
      </button>`;
    }).join("");

    const resultsHtml = `<div class="ff-card">
      <div class="ff-card-title">Select a result</div>
      <div class="ff-result-list">${items}</div>
    </div>`;

    console.log(`[Search] Setting innerHTML on`, resultsHost.id || "host");
    console.log(`[Search] Results HTML length:`, resultsHtml.length);
    
    // Set the HTML
    resultsHost.innerHTML = resultsHtml;
    
    // ALWAYS force visibility for searchResultsSlot when we have results
    if (resultsHost === searchResultsSlot) {
      resultsHost.classList.remove("ff-hidden");
      resultsHost.style.display = "";  // Reset inline styles, let CSS handle it
      resultsHost.style.visibility = "";
      resultsHost.style.opacity = "";
      console.log(`[Search] ✅ Forced searchResultsSlot to be visible`);
    }
    
    console.log(`[Search] innerHTML set, actual length:`, resultsHost.innerHTML.length);
    
    // Verify it was set correctly - use setTimeout to check after DOM updates
    setTimeout(() => {
      const verify = resultsHost.querySelector(".ff-result-list");
      const buttons = resultsHost.querySelectorAll(".ff-result[data-i]");
      const computed = window.getComputedStyle(resultsHost);
      
      console.log(`[Search] Verification:`);
      console.log(`  - Result list found:`, !!verify);
      console.log(`  - Buttons found:`, buttons.length);
      console.log(`  - Display:`, computed.display);
      console.log(`  - Visibility:`, computed.visibility);
      console.log(`  - Opacity:`, computed.opacity);
      
      if (!verify) {
        console.error("[Search] ❌ Result list not found!");
        console.error("[Search] Actual HTML:", resultsHost.innerHTML.substring(0, 500));
      } else {
        console.log(`[Search] ✅ Successfully rendered ${verify.children.length} results`);
      }
    }, 10);

    // IMPORTANT: bind clicks AFTER inserting the DOM
    const resultButtons = resultsHost.querySelectorAll(".ff-result[data-i]");
    console.log(`[Search] Found ${resultButtons.length} result buttons to bind`);
    
    if (resultButtons.length === 0) {
      console.warn(`[Search] ⚠️ No buttons found! HTML:`, resultsHost.innerHTML.substring(0, 200));
    }
    
    resultButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-i"));
        if (!Number.isFinite(i) || i < 0 || i >= list.length) {
          console.error("[Search] Invalid result index:", i);
          showError("Invalid selection.", "Please try again.");
          return;
        }
        const c = normalizeCourse(list[i]);
        console.log(`[Search] Selected course: ${c.name} at ${c.lat}, ${c.lon}`);
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) {
          showError("That result is missing coordinates.", "Try another result.");
          return;
        }
        selectedCourse = c;
        clearSearchResults();
        loadWeatherForSelected();
      });
    });

    wireHeaderButtons();

    if (searchResultsSlot) {
      searchResultsSlot.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function doSearch() {
    console.log("[Search] doSearch called");
    
    if (!searchInput) {
      console.error("[Search] Search input element not found");
      return;
    }
    
    const q = (searchInput.value || "").trim();
    console.log(`[Search] Starting search for: "${q}"`);
    
    if (!q) {
      if (searchResultsSlot) {
        searchResultsSlot.classList.remove("ff-hidden");
        searchResultsSlot.innerHTML = `<div class="ff-card muted">Type a town/city or golf course name.</div>`;
      } else {
        showMessage("Type a town/city or golf course name.");
      }
      return;
    }

    // Show loading state immediately
    setBtnLoading(true);
    
    // Show loading in search results slot
    if (searchResultsSlot) {
      searchResultsSlot.classList.remove("ff-hidden");
      searchResultsSlot.innerHTML = `<div class="ff-card"><div class="ff-inline-status"><span class="ff-spinner" aria-hidden="true"></span>Searching…</div></div>`;
    } else if (forecastSlot) {
      forecastSlot.innerHTML = `<div class="ff-card"><div class="ff-inline-status"><span class="ff-spinner" aria-hidden="true"></span>Searching…</div></div>`;
    }

    try {
      let list = await fetchCourses(q);
      console.log(`[Search] fetchCourses returned:`, list);
      
      // Ensure list is an array
      if (!Array.isArray(list)) {
        console.error("[Search] fetchCourses returned non-array:", list);
        list = [];
      }
      
      // If no courses found, try geocoding as a city/town
      if (list.length === 0) {
        console.log(`🌍 [City Search] No courses found, trying city geocoding...`);
        try {
          const cityLoc = await geocodeCity(q);
          if (cityLoc) {
            // Create a "location" result that user can select
            list = [{
              id: null,
              name: cityLoc.name,
              city: cityLoc.city || cityLoc.name,
              state: cityLoc.state || "",
              country: cityLoc.country || "",
              lat: cityLoc.lat,
              lon: cityLoc.lon,
            }];
            console.log(`✅ [City Search] Found city location: ${cityLoc.name}`);
          }
        } catch (geoErr) {
          console.warn("[City Search] Geocoding failed:", geoErr);
        }
      }

      console.log(`[Search] About to render ${list.length} result(s)`);
      if (list.length > 0) {
        console.log(`[Search] First result:`, list[0]);
        renderSearchResults(list);
      } else if (searchResultsSlot) {
        searchResultsSlot.classList.remove("ff-hidden");
        searchResultsSlot.innerHTML = `<div class="ff-card muted">No courses found. Try a different name.</div>`;
      } else {
        showMessage("No courses found. Try a different name.");
      }
    } catch (err) {
      console.error("❌ [Search] Error in doSearch:", err);
      console.error("   Error details:", {
        message: err?.message,
        status: err?.status,
        name: err?.name,
        stack: err?.stack
      });
      
      let errorMsg = "Search failed.";
      let errorHint = err?.message || "Unknown error";
      
      if (err?.name === "AbortError" || err?.name === "TimeoutError") {
        errorMsg = "Search timed out.";
        errorHint = "The request took too long. Try again in a moment.";
      } else if (err?.status === 429 || err?.name === "RateLimitError") {
        errorMsg = "Rate limited ⏱️";
        errorHint = "Too many requests. Please wait 30-60 seconds before searching again.";
      } else if (err?.status >= 500) {
        errorMsg = "Server error";
        errorHint = "The API server is having issues. Try again in a few minutes.";
      } else if (err?.status >= 400) {
        errorMsg = `Request error (${err.status})`;
        errorHint = err?.message || "Check your search query and try again.";
      } else {
        errorMsg = "Search failed";
        errorHint = err?.message || "Please check your connection and try again.";
      }
      
      // Show error in search results slot
      showError(errorMsg, errorHint);
    } finally {
      // ALWAYS re-enable the search button
      setBtnLoading(false);
      console.log("[Search] Search complete, button re-enabled");
    }
  }

  /* ---------- WEATHER LOAD ---------- */
  async function loadWeatherForSelected() {
    if (!selectedCourse || !Number.isFinite(Number(selectedCourse.lat)) || !Number.isFinite(Number(selectedCourse.lon))) {
      showMessage("Select a location first.");
      return;
    }

    showMessage("Loading forecast…");
    nearbyCourses = []; // Clear nearby courses

    try {
      console.log("[Weather] Fetching for:", selectedCourse.lat, selectedCourse.lon);
      const raw = await fetchWeather(selectedCourse.lat, selectedCourse.lon);
      console.log("[Weather] Raw data received:", raw?.ok, raw?.current ? "has current" : "no current");
      
      lastNorm = normalizeWeather(raw);
      console.log("[Weather] Normalized:", lastNorm?.current ? "has current" : "no current");
      lastWeatherUpdate = Date.now();

      try {
        renderVerdictCard(lastNorm);
        renderPlayability(lastNorm);
        renderTeeTimeStrip(lastNorm);
        clearSearchResults();
        renderAll();

        // Update dashboard components
        updateBreadcrumb();
        showDashboardSections(true);
        renderWeatherTimeline(lastNorm);
        renderProTip(lastNorm);

        // Re-init Lucide icons
        if (typeof lucide !== "undefined") {
          lucide.createIcons();
        }

        console.log("[Weather] Render complete");
      } catch (renderErr) {
        console.error("[Weather] Render error:", renderErr);
        throw renderErr;
      }
      
      // Fetch nearby courses in background
      if (Number.isFinite(selectedCourse.lat) && Number.isFinite(selectedCourse.lon)) {
        nearbyCourses = await fetchNearbyCourses(selectedCourse.lat, selectedCourse.lon);
        renderAll();
      }
    } catch (err) {
      console.error("[Weather] Error:", err?.name, err?.message, err);
      if (err?.name === "AbortError" || err?.name === "TimeoutError") {
        showError("Weather request timed out.", "Try again.");
      } else if (err?.status === 429) {
        showError("Weather provider rate limited.", "Wait a moment and try again.");
      } else {
        showError("Weather fetch failed.", err?.message || "Unknown error");
      }
    }
  }

  /* ---------- GEOLOCATION ---------- */
  function setGeoLoading(isLoading) {
    if (geoBtn) {
      if (isLoading) {
        geoBtn.classList.add("loading");
        geoBtn.setAttribute("aria-busy", "true");
      } else {
        geoBtn.classList.remove("loading");
        geoBtn.removeAttribute("aria-busy");
      }
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      showError("Geolocation not supported on this device.");
      return;
    }

    setGeoLoading(true);
    showMessage("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          const lat = pos?.coords?.latitude;
          const lon = pos?.coords?.longitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Invalid coordinates");

          selectedCourse = { id: null, name: "Your location", city: "", state: "", country: "", lat, lon };
          loadWeatherForSelected();
        } catch (e) {
          showError("Could not use your location.", e?.message || "Unknown error");
        } finally {
          setGeoLoading(false);
        }
      },
      (err) => {
        setGeoLoading(false);
        showError("Location permission denied.", err?.message || "Allow location and try again.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  /* ---------- EVENTS ---------- */
  tabCurrent?.addEventListener("click", () => setActiveTab("current"));
  tabHourly?.addEventListener("click", () => setActiveTab("hourly"));
  tabDaily?.addEventListener("click", () => setActiveTab("daily"));

  // Safety timeout to prevent stuck loading state
  let searchSafetyTimer = null;
  
  searchBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("[Search] Search button clicked");
    
    // Clear any existing safety timer
    if (searchSafetyTimer) clearTimeout(searchSafetyTimer);
    
    // Set a safety timeout - if search takes more than 20 seconds, force enable button
    searchSafetyTimer = setTimeout(() => {
      console.warn("[Search] Safety timeout triggered - forcing button re-enable");
      setBtnLoading(false);
      if (searchResultsSlot) {
        searchResultsSlot.classList.remove("ff-hidden");
        searchResultsSlot.innerHTML = `<div class="ff-card muted">Search took too long. Please try again.</div>`;
      }
    }, 20000);
    
    doSearch().finally(() => {
      if (searchSafetyTimer) clearTimeout(searchSafetyTimer);
    });
  });

  // lightweight typeahead: update suggestions and inline list while typing
  let typeaheadTimer = null;
  function handleTypeahead() {
    if (!searchInput) return;
    const q = searchInput.value.trim();

    if (!q || q.length < 3) {
      clearSearchResults();
      return;
    }

    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(async () => {
      try {
        console.log("[Typeahead] Searching for:", q);
        if (searchResultsSlot) {
          searchResultsSlot.classList.remove("ff-hidden");
          searchResultsSlot.innerHTML = `<div class="ff-card"><div class="ff-inline-status"><span class="ff-spinner" aria-hidden="true"></span>Searching…</div></div>`;
        }
        const list = await fetchCourses(q);
        console.log("[Typeahead] Got results:", list?.length || 0);
        if (Array.isArray(list) && list.length > 0) {
          renderSearchResults(list);
        } else {
          if (searchResultsSlot) {
            searchResultsSlot.classList.remove("ff-hidden");
            searchResultsSlot.innerHTML = `<div class="ff-card muted">No courses found. Try a different name.</div>`;
          } else {
            clearSearchResults();
          }
        }
      } catch (err) {
        console.error("[Typeahead] Error:", err);
        // Don't show error for typeahead, just log it
      }
    }, 200);
  }

  searchInput?.addEventListener("input", handleTypeahead);

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
  });

  // Round presets
  roundPreset18?.addEventListener("click", () => setRoundMode("18"));
  roundPreset9?.addEventListener("click", () => setRoundMode("9"));
  roundPresetSociety?.addEventListener("click", () => setRoundMode("society"));
  societyGroups?.addEventListener("input", () => {
    if (lastNorm) renderTeeTimeStrip(lastNorm);
  });

  // DEV intentionally avoids any external golf-course APIs.

  geoBtn?.addEventListener("click", useMyLocation);

  // Change course button - reset to search mode
  const changeCourseBtn = $("changeCourseBtn");
  changeCourseBtn?.addEventListener("click", () => {
    // Reset selected course
    selectedCourse = null;
    lastNorm = null;

    // Hide dashboard sections
    showDashboardSections(false);

    // Clear search input
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }

    // Clear results and verdict
    clearSearchResults();
    if (verdictCard) verdictCard.style.display = "none";
    if (resultsEl) resultsEl.innerHTML = "";

    // Re-init icons
    if (typeof lucide !== "undefined") lucide.createIcons();
  });

  unitsSelect?.addEventListener("change", () => {
    if (!selectedCourse) return;
    loadWeatherForSelected();
  });
  
  // Advanced toggle
  const advancedToggle = $("advancedToggle");
  const advancedOptions = $("advancedOptions");
  const advancedArrow = $("advancedArrow");
  advancedToggle?.addEventListener("click", () => {
    const isHidden = advancedOptions?.style.display === "none";
    if (advancedOptions) advancedOptions.style.display = isHidden ? "block" : "none";
    if (advancedArrow) advancedArrow.textContent = isHidden ? "▲" : "▼";
  });
  
  // Course direction selector
  const courseDirectionSelect = $("courseDirectionSelect");
  courseDirectionSelect?.addEventListener("change", (e) => {
    courseDirection = e.target.value || "";
    renderAll(); // Re-render to update wind impact tags
  });

  verdictCard?.addEventListener("click", () => {
    openInfoModal(
      "Decision & playability explained",
      "The decision (Play / Playable (tough) / No-play) and the playability score use the same ingredients: wind strength, rain chance and mm, temperature comfort and remaining daylight. 9–10 means ideal conditions, 6–8 is playable with some compromises, and 0–5 suggests most golfers will find it poor. The suggested best tee time is picked from today’s daylight hours where rain and wind are lowest and temperature is closest to a comfortable target."
    );
  });

  // Playability Index info button
  const playabilityInfoBtn = $("playabilityInfoBtn");
  playabilityInfoBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    openInfoModal(
      "Playability Index",
      `<div style="line-height:1.6;">
        <p><strong>How it's calculated:</strong></p>
        <p>Combines weather conditions (60%) and course difficulty (40%).</p>
        <p style="margin-top:12px;"><strong>Weather factors:</strong></p>
        <p>• <strong>Freezing (below 0°C/32°F)</strong> – Tough conditions</p>
        <p>• <strong>Heavy rain (5mm+)</strong> – Tough conditions</p>
        <p>• Wind speed, rain chance, temperature comfort</p>
        <p style="margin-top:12px;"><strong>Course factors:</strong></p>
        <p>• Slope rating (difficulty of course)</p>
        <p>• Course rating vs par</p>
        <p style="margin-top:14px;"><strong>Rating:</strong></p>
        <p>🟢 Easy – Great conditions, forgiving course</p>
        <p>🟡 Moderate – Some challenges expected</p>
        <p>🟠 Challenging – Needs focus and skill</p>
        <p>🔴 Tough – Harsh weather or demanding course</p>
      </div>`,
      true
    );
  });

  infoModalClose?.addEventListener("click", closeInfoModal);
  infoModal?.addEventListener("click", (e) => {
    if (e.target === infoModal) closeInfoModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeInfoModal();
  });

  /* =========================================================
     REFACTORED DASHBOARD UI (At-a-Glance)
     ========================================================= */

  // DOM elements for new dashboard
  const courseSelectorToggle = $("courseSelectorToggle");
  const courseSelectorPanel = $("courseSelectorPanel");
  const breadcrumbCountry = $("breadcrumbCountry");
  const breadcrumbCourse = $("breadcrumbCourse");
  const durationSection = $("durationSection");
  const weatherTimelineSection = $("weatherTimelineSection");
  const weatherTimelineTable = $("weatherTimelineTable");
  const weatherTimelineBody = $("weatherTimelineBody");
  const proTipCallout = $("proTipCallout");
  const proTipText = $("proTipText");
  const verdictCardNew = $("verdictCardNew");
  const timelineSubtitle = $("timelineSubtitle");
  const metricsTimeLabel = $("metricsTimeLabel");
  const durationSubtitle = $("durationSubtitle");

  // Toggle course selector panel
  courseSelectorToggle?.addEventListener("click", () => {
    const isExpanded = courseSelectorToggle.getAttribute("aria-expanded") === "true";
    courseSelectorToggle.setAttribute("aria-expanded", !isExpanded);
    if (courseSelectorPanel) {
      courseSelectorPanel.style.display = isExpanded ? "none" : "block";
    }
  });

  // Update breadcrumb when country/course changes
  function updateBreadcrumb() {
    // Update country text
    if (breadcrumbCountry) {
      const countryObj = COUNTRIES.find(c => c.code === currentCountry);
      const countryName = countryObj?.name || "Select Location";
      breadcrumbCountry.textContent = countryName;
    }

    // Update course text
    if (breadcrumbCourse) {
      if (selectedCourse) {
        breadcrumbCourse.textContent = selectedCourse.name || "Course Selected";
      } else {
        breadcrumbCourse.textContent = "Choose Course";
      }
    }
  }

  // Show dashboard sections when course is selected
  function showDashboardSections(show = true) {
    if (durationSection) {
      durationSection.style.display = show ? "block" : "none";
    }
    if (weatherTimelineSection) {
      weatherTimelineSection.style.display = show ? "block" : "none";
    }

    // Collapse course selector when course selected
    if (show && courseSelectorToggle && courseSelectorPanel) {
      courseSelectorToggle.setAttribute("aria-expanded", "false");
      courseSelectorPanel.style.display = "none";
    }

    // Show/hide selected course display and search input
    const selectedCourseDisplay = $("selectedCourseDisplay");
    const searchInputWrap = searchInput?.closest(".ff-search-bar");

    if (show && selectedCourse) {
      // Show selected course info
      if (selectedCourseDisplay) {
        selectedCourseDisplay.style.display = "flex";
        const nameEl = $("selectedCourseName");
        const locEl = $("selectedCourseLocation");
        if (nameEl) nameEl.textContent = selectedCourse.name || "Selected Course";
        if (locEl) {
          const parts = [selectedCourse.city, selectedCourse.state, selectedCourse.country].filter(Boolean);
          locEl.textContent = parts.join(", ") || "";
        }
      }
      // Hide search input when course selected
      if (searchInputWrap) {
        searchInputWrap.style.display = "none";
      }
    } else {
      // Hide selected course info, show search
      if (selectedCourseDisplay) {
        selectedCourseDisplay.style.display = "none";
      }
      if (searchInputWrap) {
        searchInputWrap.style.display = "";
      }
    }
  }

  /**
   * Render Weather Timeline table with hourly data
   * @param {Object} norm - Normalized weather data
   */
  function renderWeatherTimeline(norm) {
    if (!weatherTimelineBody || !norm) return;

    const hourly = Array.isArray(norm.hourly) ? norm.hourly : [];
    const tzOffset = norm?.timezoneOffset || 0;

    // Get the window based on selected tee time and round duration
    if (!selectedTeeTime) {
      weatherTimelineBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);">Select a tee time to see weather timeline</td></tr>`;
      return;
    }

    const windowHours = roundDurationHours;
    const windowEnd = selectedTeeTime + (windowHours * 3600);

    // Filter hourly data within the window (1-hour increments)
    const windowData = hourly.filter(h => {
      const dt = h?.dt;
      return typeof dt === "number" && dt >= selectedTeeTime && dt < windowEnd;
    });

    if (windowData.length === 0) {
      weatherTimelineBody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);">No forecast data for this window</td></tr>`;
      return;
    }

    // Get Lucide icon name based on weather
    function getWeatherIcon(weather) {
      const main = (weather?.[0]?.main || "").toLowerCase();
      const desc = (weather?.[0]?.description || "").toLowerCase();

      if (main.includes("rain") || main.includes("drizzle")) return "cloud-rain";
      if (main.includes("storm") || main.includes("thunder")) return "cloud-lightning";
      if (main.includes("snow")) return "cloud-snow";
      if (main.includes("cloud")) return "cloud";
      if (main.includes("fog") || main.includes("mist")) return "cloud-fog";
      return "sun";
    }

    // Build header row dynamically
    const headerRow = `
      <tr>
        <th>Time</th>
        <th>Sky</th>
        <th>Temp</th>
        <th>Wind</th>
        <th>Gusts</th>
        <th>Rain</th>
      </tr>
    `;

    // Update table header
    const thead = weatherTimelineTable?.querySelector("thead");
    if (thead) {
      thead.innerHTML = headerRow;
    }

    // Build body rows
    const rows = windowData.map((h, idx) => {
      const time = fmtTimeCourse(h.dt, tzOffset);
      const icon = getWeatherIcon(h.weather);
      const temp = typeof h.temp === "number" ? `${roundNum(h.temp)}${tempUnit()}` : "—";
      const wind = typeof h.wind_speed === "number" ? `${roundNum(h.wind_speed, 1)}` : "—";
      const gust = typeof (h.wind_gust ?? h.gust) === "number" ? `${roundNum(h.wind_gust ?? h.gust, 1)}` : "—";
      const rain = typeof h.pop === "number" ? `${Math.round(h.pop * 100)}%` : "—";

      // Calculate estimated hole based on position in round
      const holesPerHour = roundMode === "9" ? 4.5 : 4.5; // ~4.5 holes per hour
      const estimatedHole = Math.round((idx + 0.5) * holesPerHour);

      return `
        <tr data-hour="${idx}">
          <td>${esc(time)}</td>
          <td><div class="ff-timeline-icon"><i data-lucide="${icon}"></i></div></td>
          <td>${esc(temp)}</td>
          <td>${esc(wind)}</td>
          <td>${esc(gust)}</td>
          <td>${esc(rain)}</td>
        </tr>
      `;
    }).join("");

    weatherTimelineBody.innerHTML = rows;

    // Re-initialize Lucide icons in timeline
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }

    // Update timeline subtitle
    if (timelineSubtitle) {
      const startTime = fmtTimeCourse(selectedTeeTime, tzOffset);
      const endTime = fmtTimeCourse(windowEnd, tzOffset);
      timelineSubtitle.textContent = `${roundMode === "9" ? "9 holes" : "18 holes"} · ${startTime} → Finish approx. ${endTime}`;
    }

    // Update metrics time label
    if (metricsTimeLabel) {
      metricsTimeLabel.textContent = `(Current selection: ${fmtTimeCourse(selectedTeeTime, tzOffset)})`;
    }
  }

  /**
   * Generate Pro-Tip based on weather timeline analysis
   * @param {Object} norm - Normalized weather data
   * @returns {Object|null} Pro-tip data or null if no tip needed
   */
  function generateProTip(norm) {
    if (!selectedTeeTime || !norm) return null;

    const hourly = Array.isArray(norm.hourly) ? norm.hourly : [];
    const tzOffset = norm?.timezoneOffset || 0;
    const windowHours = roundDurationHours;
    const windowEnd = selectedTeeTime + (windowHours * 3600);

    // Get hourly data within the window
    const windowData = hourly.filter(h => {
      const dt = h?.dt;
      return typeof dt === "number" && dt >= selectedTeeTime && dt < windowEnd;
    });

    if (windowData.length < 2) return null;

    const holesPerHour = roundMode === "9" ? 4.5 : 4.5;

    // Check for wind increase > 5mph
    let maxWindIncrease = 0;
    let windIncreaseHour = -1;
    for (let i = 1; i < windowData.length; i++) {
      const prevWind = windowData[i - 1]?.wind_speed || 0;
      const currWind = windowData[i]?.wind_speed || 0;
      // Convert to mph if metric
      const prevMph = units() === "metric" ? prevWind * 2.237 : prevWind;
      const currMph = units() === "metric" ? currWind * 2.237 : currWind;
      const increase = currMph - prevMph;

      if (increase > maxWindIncrease) {
        maxWindIncrease = increase;
        windIncreaseHour = i;
      }
    }

    // Check for rain probability crossing 30%
    let rainCrossingHour = -1;
    for (let i = 0; i < windowData.length; i++) {
      const pop = windowData[i]?.pop || 0;
      const prevPop = i > 0 ? (windowData[i - 1]?.pop || 0) : 0;

      // Check if rain crosses 30% threshold
      if (pop >= 0.3 && prevPop < 0.3 && i > 0) {
        rainCrossingHour = i;
        break;
      }
    }

    // Generate tip message
    let tip = null;

    if (maxWindIncrease > 5 && windIncreaseHour > 0) {
      const estimatedHole = Math.round(windIncreaseHour * holesPerHour);
      const backNine = roundMode === "18" && estimatedHole > 9;
      tip = {
        type: "wind",
        message: `Wind picks up around ${backNine ? "the back 9" : `hole ${estimatedHole}`}. Consider club up for approach shots.`
      };
    }

    if (rainCrossingHour > 0) {
      const estimatedHole = Math.round(rainCrossingHour * holesPerHour);
      const backNine = roundMode === "18" && estimatedHole > 9;
      const message = `Playable start, but rain expected around ${backNine ? "the back 9" : `hole ${estimatedHole}`}. Pack waterproofs.`;

      // Rain tip takes priority if both conditions exist
      tip = {
        type: "rain",
        message
      };
    }

    // Check for deteriorating conditions overall
    if (!tip && windowData.length >= 2) {
      const firstHour = windowData[0];
      const lastHour = windowData[windowData.length - 1];

      const firstPop = firstHour?.pop || 0;
      const lastPop = lastHour?.pop || 0;
      const firstWind = firstHour?.wind_speed || 0;
      const lastWind = lastHour?.wind_speed || 0;

      // Convert to mph
      const firstWindMph = units() === "metric" ? firstWind * 2.237 : firstWind;
      const lastWindMph = units() === "metric" ? lastWind * 2.237 : lastWind;

      if (lastPop > firstPop + 0.2 || lastWindMph > firstWindMph + 8) {
        tip = {
          type: "deteriorating",
          message: `Conditions may deteriorate later in the round. Your ${roundMode === "9" ? "front 9" : "back 9"} looks breezy.`
        };
      }
    }

    return tip;
  }

  /**
   * Render Pro-Tip callout
   * @param {Object} norm - Normalized weather data
   */
  function renderProTip(norm) {
    if (!proTipCallout || !proTipText) return;

    const tip = generateProTip(norm);

    if (tip) {
      proTipText.textContent = tip.message;
      proTipCallout.style.display = "block";
    } else {
      proTipCallout.style.display = "none";
    }
  }

  /**
   * Update verdict card styling based on status
   * UK-tuned: PLAY (green), CAUTION/RISKY (amber), DELAY (orange), AVOID/UNSAFE (red)
   * @param {string} status - PLAY, RISKY, DELAY, AVOID, UNSAFE
   */
  function updateVerdictCardStyle(status) {
    if (!verdictCardNew) return;

    // Remove all status classes (both naming conventions for compatibility)
    verdictCardNew.classList.remove(
      "ff-verdict-card--play", "ff-verdict-card--caution", "ff-verdict-card--delay", "ff-verdict-card--avoid", "ff-verdict-card--unsafe",
      "play", "caution", "delay", "avoid", "unsafe"
    );

    // Map status to appropriate styling class
    // PLAY = green, RISKY = amber, DELAY = orange/red, AVOID/UNSAFE = deep red
    let statusClass = "play";
    let iconName = "check-circle";

    if (status === "PLAY") {
      statusClass = "play";
      iconName = "check-circle";
    } else if (status === "RISKY" || status === "CAUTION") {
      statusClass = "caution";
      iconName = "alert-triangle";
    } else if (status === "DELAY") {
      // DELAY is more severe than CAUTION - use orange/red
      statusClass = "delay";
      iconName = "pause-circle";
    } else if (status === "AVOID") {
      statusClass = "avoid";
      iconName = "x-circle";
    } else if (status === "UNSAFE") {
      statusClass = "unsafe";
      iconName = "ban";
    } else {
      // Unknown status - default to caution (never green for unknown)
      statusClass = "caution";
      iconName = "help-circle";
    }

    // Add both class formats for compatibility
    verdictCardNew.classList.add(`ff-verdict-card--${statusClass}`, statusClass);

    // Update Lucide icon with transition
    const lucideIcon = verdictCardNew?.querySelector(".ff-verdict-icon");
    if (lucideIcon && typeof lucide !== "undefined") {
      lucideIcon.setAttribute("data-lucide", iconName);
      lucide.createIcons();
    }
  }

  /**
   * Update the metrics grid with warning/danger styling
   * @param {Object} decision - Decision object from computeTeeTimeDecision
   */
  function updateMetricsWarnings(decision) {
    const metricsGrid = $("teeTimeMetrics");
    if (!metricsGrid || !decision?.metrics) return;

    const cards = metricsGrid.querySelectorAll(".ff-metric-card");
    cards.forEach(card => {
      card.classList.remove("ff-metric-card--warning", "ff-metric-card--danger");
    });

    const { maxPrecipProb, avgWind, maxGust } = decision.metrics;

    // Rain warnings
    const rainCard = Array.from(cards).find(c => c.querySelector("#teeMetricRain"));
    if (rainCard) {
      if (maxPrecipProb >= 60) {
        rainCard.classList.add("ff-metric-card--danger");
      } else if (maxPrecipProb >= 30) {
        rainCard.classList.add("ff-metric-card--warning");
      }
    }

    // Wind warnings
    const windCard = Array.from(cards).find(c => c.querySelector("#teeMetricWind"));
    if (windCard) {
      if (avgWind >= 25) {
        windCard.classList.add("ff-metric-card--danger");
      } else if (avgWind >= 15) {
        windCard.classList.add("ff-metric-card--warning");
      }
    }

    // Gust warnings
    const gustCard = Array.from(cards).find(c => c.querySelector("#teeMetricGust"));
    if (gustCard) {
      if (maxGust >= 35) {
        gustCard.classList.add("ff-metric-card--danger");
      } else if (maxGust >= 25) {
        gustCard.classList.add("ff-metric-card--warning");
      }
    }
  }

  // Hook into existing renderTeeTimeStrip to also update dashboard
  const originalRenderTeeTimeStrip = renderTeeTimeStrip;
  renderTeeTimeStrip = function(norm) {
    // Call original
    originalRenderTeeTimeStrip(norm);

    // Update dashboard components
    renderWeatherTimeline(norm);
    renderProTip(norm);

    // Update verdict card style based on current decision
    if (selectedTeeTime && norm) {
      const hourly = Array.isArray(norm.hourly) ? norm.hourly : [];
      const decision = computeTeeTimeDecision(hourly, selectedTeeTime, roundDurationHours);
      updateVerdictCardStyle(decision.status);
      updateMetricsWarnings(decision);
    }

    // Initialize Lucide icons
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    }
  };

  // Update breadcrumb when country changes
  countrySelect?.addEventListener("change", () => {
    setTimeout(updateBreadcrumb, 100);
  });

  // Initialize Lucide icons on page load
  function initLucideIcons() {
    if (typeof lucide !== "undefined") {
      lucide.createIcons();
    } else {
      // Retry after a short delay if lucide isn't loaded yet
      setTimeout(() => {
        if (typeof lucide !== "undefined") {
          lucide.createIcons();
        }
      }, 500);
    }
  }

  /* ---------- INIT ---------- */
  try {
    console.log("🚀 [Init] Starting Fairway Forecast...");
    console.log(`📂 [Init] Using static datasets: ${USE_STATIC_DATASETS}`);
    
    // Default round mode presets
    setRoundMode("18");

    renderVerdictCard(null);
    renderPlayability(null);
    wireTeeTimeSelector();
    wireApplyPlannerButton();
    wirePremiumButton();
    
    // Initialize country/state selectors (DEV)
    if (USE_STATIC_DATASETS) {
      void initCountryStateSelectors();
    }
    
    renderAll();
    console.log("✅ [Init] Fairway Forecast ready!");

    // Initialize Lucide icons
    initLucideIcons();

    // Initialize breadcrumb
    updateBreadcrumb();

    // Show ready state in UI
    if (searchInput && !USE_STATIC_DATASETS) {
      searchInput.placeholder = 'e.g. Swindon, GB or "golf club"';
    }
    if (searchBtn) {
      searchBtn.disabled = false;
      searchBtn.textContent = "Search";
    }

    // Optional sanity tests (opt-in)
    // Run with: ?playabilityTest=1
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("playabilityTest") === "1" && window.FF_PLAYABILITY?.runSanityTests) {
        const decideForTest = ({ countryCode, tempC, windMph, rainMmHr, weatherId }) => {
          const prev = currentCountry;
          currentCountry = String(countryCode || prev || "").toLowerCase();
          const now = Math.floor(Date.now() / 1000);
          const hours = 4;
          const windSpeed = units() === "metric" ? (windMph / 2.237) : windMph;
          const windGust = units() === "metric" ? ((windMph + 1) / 2.237) : (windMph + 1);
          const hourly = Array.from({ length: hours }, (_, i) => ({
            dt: now + i * 3600,
            pop: 0,
            rain_mm: typeof rainMmHr === "number" ? rainMmHr : 0,
            wind_speed: windSpeed,
            wind_gust: windGust,
            temp: tempC,
            feels_like: tempC,
            weather: [{ id: weatherId ?? 800, main: "Clear", description: "clear sky" }],
          }));
          const out = computeTeeTimeDecision(hourly, now, hours);
          currentCountry = prev;
          return out;
        };
        window.FF_PLAYABILITY.runSanityTests(decideForTest);
      }
    } catch (e) {
      console.warn("[Playability] Sanity tests failed to run:", e);
    }
  } catch (err) {
    console.error("❌ [Init] Failed to initialize app:", err);
    // Try to show error to user
    if (resultsEl) {
      resultsEl.innerHTML = `<div class="ff-card" style="color:#C0362C;"><strong>App failed to load</strong><br>Please refresh the page. If the problem persists, clear your browser cache.</div>`;
    }
  }
})();
