/* =====================================================
   Fairway Forecast – app.js (FULL, hardened)
   Fixes:
   - Search stuck on "Loading..."
   - Search results not clickable / not rendering
   - Weather icons not showing (uses OpenWeather icon CDN)
   - Safe DOM checks + crash-safe rendering
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const APP = window.APP_CONFIG || {};
  const API_BASE = APP.WORKER_BASE_URL || "https://fairway-forecast-api.mziyabo.workers.dev";
  const SUPABASE_URL = APP.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = APP.SUPABASE_ANON_KEY || "";
  const COURSES_TABLE = APP.COURSES_TABLE || "uk_golf_courses";
  const COURSE_COLS = APP.COURSE_COLS || { name: "name", lat: "latitude", lon: "longitude", country: "country" };
  const MAX_RESULTS = 12;

  const COURSE_CACHE_TTL_MS = 10 * 60 * 1000;
  const WEATHER_CACHE_TTL_MS = 3 * 60 * 1000;

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const locationSlot = $("locationSlot") || resultsEl;
  const forecastSlot = $("forecastSlot") || resultsEl;
  const searchResultsSlot = $("searchResultsSlot") || null;
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const geoBtn = $("btnGeo") || $("geoBtn");
  const unitsSelect = $("unitsSelect") || $("units");

  const verdictCard = $("verdictCard");
  const verdictIcon = $("verdictIcon");
  const verdictLabel = $("verdictLabel");
  const verdictReason = $("verdictReason");
  const verdictBestTime = $("verdictBestTime");
  const verdictQuickStats = $("verdictQuickStats");

  const infoModal = $("infoModal");
  const infoModalTitle = $("infoModalTitle");
  const infoModalBody = $("infoModalBody");
  const infoModalClose = $("infoModalClose");

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

  function pct(pop) {
    return typeof pop === "number" ? `${Math.round(pop * 100)}%` : "";
  }

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
  
  function getLocalAndGMTTime(tsSeconds, timezoneOffset = null) {
    if (!tsSeconds) return { local: "", gmt: "" };
    const date = new Date(tsSeconds * 1000);
    
    // GMT time
    const gmt = date.toUTCString().match(/\d{2}:\d{2}/)?.[0] || "";
    
    // Local time at course location (if timezone offset available)
    let local = "";
    if (timezoneOffset !== null && typeof timezoneOffset === "number") {
      const courseDate = new Date((tsSeconds + timezoneOffset) * 1000);
      local = courseDate.toUTCString().match(/\d{2}:\d{2}/)?.[0] || "";
    } else {
      // Fallback to browser local time
      local = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    
    return { local, gmt };
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
    if (!searchBtn) return;
    searchBtn.dataset._label ??= searchBtn.textContent || label;
    searchBtn.disabled = !!isLoading;
    searchBtn.textContent = isLoading ? "Loading…" : searchBtn.dataset._label;
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

    // Show error in search results slot if it exists (for search errors), otherwise forecast slot
    if (searchResultsSlot) {
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

  async function fetchCoursesSupabase(query) {
    const q = (query || "").trim();
    if (!q || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.log("🔍 [Supabase] Skipped - missing query or config");
      return [];
    }

    const table = COURSES_TABLE;
    const cols = COURSE_COLS;

    console.log(`🔍 [Supabase] Searching for: "${q}"`);

    // Simple ilike on name for now; schema only has name/lat/lon/country
    const pattern = `*${q.replace(/[%*]/g, "").trim()}*`;
    const searchParam = encodeURIComponent(`name.ilike.${pattern}`);

    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?select=*&${searchParam}`;

    try {
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      });
      if (!res.ok) {
        console.warn("🔍 [Supabase] Search failed", res.status, await res.text().catch(() => ""));
        return [];
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || !rows.length) {
        console.log(`🔍 [Supabase] No results found`);
        return [];
      }

      console.log(`✅ [Supabase] Found ${rows.length} course(s)`);

      // Map Supabase columns into the shape normalizeCourse expects
      return rows.map((row) => ({
        id: row.id ?? null,
        name: row[cols.name] ?? row.name ?? "Course",
        lat: typeof row[cols.lat] === "number" ? row[cols.lat] : null,
        lon: typeof row[cols.lon] === "number" ? row[cols.lon] : null,
        country: row[cols.country] ?? row.country ?? "",
        city: "",
        state: "",
      }));
    } catch (err) {
      console.warn("🔍 [Supabase] Search error", err);
      return [];
    }
  }

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

    const cacheKey = q.toLowerCase();
    const cached = cacheGet(memCache.courses, cacheKey, COURSE_CACHE_TTL_MS);
    if (cached) {
      console.log(`🔍 [Cache] Found cached results for: "${q}"`);
      return cached;
    }

    console.log(`🔍 [Search] Starting search for: "${q}"`);

    const enc = encodeURIComponent(q);

    let list = [];
    let source = "unknown";
    let apiError = null;
    
    try {
      console.log(`🌐 [GolfAPI] Calling primary API: /courses?search=${enc}`);
      const data = await apiGet(`/courses?search=${enc}`);
      console.log(`📦 [GolfAPI] Response received:`, data);
      list = Array.isArray(data?.courses) ? data.courses : [];
      source = "GolfAPI";
      if (list.length > 0) {
        console.log(`✅ [GolfAPI] Found ${list.length} course(s)`);
      } else {
        console.log(`⚠️ [GolfAPI] No results found`);
      }
    } catch (err) {
      apiError = err;
      console.error("❌ [GolfAPI] Primary API failed:", err);
      console.error("   Error details:", {
        message: err?.message,
        status: err?.status,
        name: err?.name
      });
      
      // If rate limited, don't try fallback - just throw
      if (err?.status === 429 || err?.name === "RateLimitError") {
        console.warn("   ⚠️ Rate limit detected (429) - not trying fallback");
        throw err;
      }
      
      list = [];
      source = "GolfAPI (failed)";
    }

    // Fallback to Supabase when no primary matches (only if not rate limited)
    if ((!Array.isArray(list) || list.length === 0) && (!apiError || apiError?.status !== 429)) {
      console.log(`🔄 [Fallback] Trying Supabase...`);
      try {
        const supa = await fetchCoursesSupabase(q);
        if (supa.length > 0) {
          list = supa;
          source = "Supabase";
          console.log(`✅ [Fallback] Using ${supa.length} result(s) from Supabase`);
        } else {
          console.log(`❌ [Fallback] Supabase also returned no results`);
        }
      } catch (fallbackErr) {
        console.error("❌ [Fallback] Supabase also failed:", fallbackErr);
      }
    }

    console.log(`📊 [Search] Final result: ${list.length} course(s) from ${source}`);

    // Cache successful results (even if empty, but not errors)
    if (source !== "unknown" && (!apiError || apiError?.status !== 429)) {
      cacheSet(memCache.courses, cacheKey, list);
    }

    return list;
  }

  async function fetchNearbyCourses(lat, lon, radiusKm = 10, maxResults = 5) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    
    try {
      // Search for courses in the area - use city name or broad search
      // We'll search for "golf" in the area and filter by distance
      const searchTerms = ["golf", "golf course", "golf club"];
      const allCourses = [];
      
      for (const term of searchTerms) {
        try {
          const data = await apiGet(`/courses?search=${encodeURIComponent(term)}`);
          const courses = Array.isArray(data?.courses) ? data.courses : [];
          allCourses.push(...courses);
        } catch (err) {
          console.warn(`[Nearby] Search failed for "${term}"`, err);
        }
      }
      
      // Filter by distance and remove duplicates
      const nearby = [];
      const seenIds = new Set();
      const currentCourseId = selectedCourse?.id;
      
      for (const course of allCourses) {
        const courseLat = course?.lat || course?.location?.latitude;
        const courseLon = course?.lon || course?.location?.longitude;
        const courseId = course?.id;
        
        // Skip if no coordinates or already seen or is current course
        if (!Number.isFinite(courseLat) || !Number.isFinite(courseLon)) continue;
        if (courseId && (seenIds.has(courseId) || courseId === currentCourseId)) continue;
        
        const distance = calculateDistance(lat, lon, courseLat, courseLon);
        if (distance !== null && distance <= radiusKm) {
          seenIds.add(courseId);
          nearby.push({
            ...course,
            distance: distance
          });
        }
      }
      
      // Sort by distance and limit results
      nearby.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
      return nearby.slice(0, maxResults);
    } catch (err) {
      console.warn("[Nearby] Failed to fetch nearby courses", err);
      return [];
    }
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

  /* ---------- PLAYABILITY + VERDICT ---------- */
  function calculatePlayability(norm) {
    const c = norm?.current;
    if (!c) return "--";

    let score = 10;
    const w = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const t = typeof c.temp === "number" ? c.temp : null;
    const pop = typeof c.pop === "number" ? c.pop : 0;

    if (w > 10) score -= 3;
    else if (w > 6) score -= 2;
    else if (w > 4) score -= 1;

    if (pop >= 0.7) score -= 3;
    else if (pop >= 0.4) score -= 2;
    else if (pop >= 0.2) score -= 1;

    if (t !== null) {
      if (units() === "metric") {
        if (t < 4) score -= 2;
        else if (t < 8) score -= 1;
        if (t > 30) score -= 2;
      } else {
        if (t < 40) score -= 2;
        else if (t < 46) score -= 1;
        if (t > 86) score -= 2;
      }
    }

    return clamp(Math.round(score), 0, 10);
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
      return { status: "NO", label: "Nighttime", reason: "Nighttime at course", best: null, isNighttime: true, isTomorrow: false };
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

  function renderVerdictCard(norm) {
    if (!verdictCard || !verdictLabel || !verdictReason || !verdictIcon || !verdictBestTime) return;

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

    // Label: Show "Nighttime" clearly when it's nighttime
    let labelText = "";
    if (isNighttime) {
      labelText = "Nighttime";
    } else {
      labelText = v.label || "—";
    }
    
    verdictLabel.innerHTML = `${labelText} <span class="ff-info-icon" title="Click for more info">ℹ️</span>`;
    
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
    
    // Best time: Show tomorrow's best time if nighttime
    if (isNighttime && tomorrowData?.best && typeof tomorrowData.best.dt === "number") {
      verdictBestTime.textContent = fmtTime(tomorrowData.best.dt);
    } else if (v.best && typeof v.best.dt === "number") {
      verdictBestTime.textContent = fmtTime(v.best.dt);
    } else {
      verdictBestTime.textContent = "—";
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

  function renderPlayability(norm) {
    if (!playabilityScoreEl) return;
    const p = norm ? calculatePlayability(norm) : "--";
    playabilityScoreEl.textContent = `${p}/10`;
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
    if (selectedCourse?.lat && selectedCourse?.lon) {
      quickActions.push(`<a href="https://maps.google.com/?q=${selectedCourse.lat},${selectedCourse.lon}" target="_blank" class="ff-action-btn" aria-label="Get directions" title="Directions">🗺️</a>`);
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
    
    // Check if it's nighttime - if so, show tomorrow's windows
    const sunrise = norm?.sunrise;
    const sunset = norm?.sunset;
    const now = nowSec();
    const isNighttime = sunrise && sunset && now > sunset;
    
    const windows = [
      { name: "Morning", start: 6, end: 11 },
      { name: "Midday", start: 11, end: 15 },
      { name: "Late", start: 15, end: 19 }
    ];
    
    const windowsData = windows.map(win => {
      const windowHours = hourly.filter(h => {
        if (!h?.dt) return false;
        const hourDate = new Date(h.dt * 1000);
        const hour = hourDate.getHours();
        const dayStart = new Date(now * 1000);
        dayStart.setHours(0, 0, 0, 0);
        const hDayStart = new Date(hourDate);
        hDayStart.setHours(0, 0, 0, 0);
        
        // If nighttime, filter for tomorrow's hours
        if (isNighttime) {
          const tomorrowStart = new Date(dayStart);
          tomorrowStart.setDate(tomorrowStart.getDate() + 1);
          if (hDayStart.getTime() !== tomorrowStart.getTime()) return false;
        } else {
          // Normal daytime - use today's hours
          if (hDayStart.getTime() !== dayStart.getTime()) return false;
        }
        
        return hour >= win.start && hour < win.end;
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
    
    // Get current time display (GMT and local at course)
    const currentTime = getLocalAndGMTTime(c.dt || now, norm.timezoneOffset);
    const timeDisplay = currentTime.local && currentTime.gmt ? `Local ${currentTime.local} / GMT ${currentTime.gmt}` : "";

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
    if (isNighttime && isTomorrow) {
      // Use tomorrow's sunrise/sunset - estimate or use next day's data
      const daily = Array.isArray(norm?.daily) ? norm.daily : [];
      const tomorrow = daily.length > 0 ? daily[0] : null;
      // Note: Daily data might not have sunrise/sunset, so we'll show current day's for reference
      sunriseTime = norm.sunrise ? fmtTime(norm.sunrise) : "";
      sunsetTime = norm.sunset ? fmtTime(norm.sunset) : "";
    } else {
      sunriseTime = norm.sunrise ? fmtTime(norm.sunrise) : "";
      sunsetTime = norm.sunset ? fmtTime(norm.sunset) : "";
    }

    const best = isNighttime ? null : bestTimeToday(norm);
    const bestText = best?.dt ? fmtTime(best.dt) : "";

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

    const nighttimeBadge = isNighttime ? `<div class="ff-nighttime-badge">🌙 Nighttime — Showing tomorrow's forecast</div>` : "";

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

    // Prepare data for mini charts
    const windValues = hourly.map(h => typeof h.wind_speed === "number" ? h.wind_speed : 0);
    const rainValues = hourly.map(h => typeof h.rain_mm === "number" ? h.rain_mm : 0);

    const cards = hourly.slice(0, 16).map((h) => {
      const time = h?.dt ? fmtTime(h.dt) : "";
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
    
    // Show/hide course direction selector
    const courseDirectionSection = $("courseDirectionSection");
    if (courseDirectionSection && selectedCourse) {
      courseDirectionSection.style.display = "block";
    } else if (courseDirectionSection) {
      courseDirectionSection.style.display = "none";
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
        const bestTime = verdict.best && typeof verdict.best.dt === "number" ? fmtTime(verdict.best.dt) : "—";
        
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
      // Make sure it's visible
      searchResultsSlot.style.display = "";
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
    
    // Ensure searchResultsSlot is visible
    if (searchResultsSlot) {
      searchResultsSlot.style.display = "";
      console.log("[Search] searchResultsSlot display:", window.getComputedStyle(searchResultsSlot).display);
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
    console.log(`[Search] HTML to set (first 300 chars):`, resultsHtml.substring(0, 300));
    
    // Set the HTML
    resultsHost.innerHTML = resultsHtml;
    
    // Force display if it's searchResultsSlot (CSS hides it by default until it has content)
    if (resultsHost === searchResultsSlot) {
      // The :has(*) selector should show it, but ensure it's visible
      const computed = window.getComputedStyle(resultsHost);
      if (computed.display === "none") {
        console.warn("[Search] searchResultsSlot is hidden, forcing display");
        resultsHost.style.display = "block";
      }
    }
    
    console.log(`[Search] innerHTML set, content length:`, resultsHost.innerHTML.length);
    
    // Verify it was set correctly
    const verify = resultsHost.querySelector(".ff-result-list");
    if (!verify) {
      console.error("[Search] ❌ Result list not found after setting innerHTML!");
      console.error("[Search] Actual HTML:", resultsHost.innerHTML.substring(0, 500));
    } else {
      console.log(`[Search] ✅ Result list found with ${verify.children.length} children`);
    }

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
    if (!searchInput) {
      console.error("[Search] Search input element not found");
      return;
    }
    
    const q = (searchInput.value || "").trim();
    console.log(`[Search] Starting search for: "${q}"`);
    
    if (!q) {
      if (searchResultsSlot) {
        searchResultsSlot.innerHTML = `<div class="ff-card muted">Type a town/city or golf course name.</div>`;
      } else {
        showMessage("Type a town/city or golf course name.");
      }
      return;
    }

    clearSearchResults();
    setBtnLoading(true);
    
    // Show loading in search results slot
    if (searchResultsSlot) {
      searchResultsSlot.innerHTML = `<div class="ff-card muted">Loading…</div>`;
    } else if (forecastSlot) {
      forecastSlot.innerHTML = `<div class="ff-card muted">Loading…</div>`;
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
      }
      renderSearchResults(list);
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
      if (searchResultsSlot) {
        showError(errorMsg, errorHint);
      } else {
        showError(errorMsg, errorHint);
      }
    } finally {
      setBtnLoading(false);
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
      const raw = await fetchWeather(selectedCourse.lat, selectedCourse.lon);
      lastNorm = normalizeWeather(raw);
      lastWeatherUpdate = Date.now(); // Track when weather was last updated

      renderVerdictCard(lastNorm);
      renderPlayability(lastNorm);
      clearSearchResults(); // Clear search results before rendering
      renderAll();
      
      // Fetch nearby courses in background
      if (Number.isFinite(selectedCourse.lat) && Number.isFinite(selectedCourse.lon)) {
        nearbyCourses = await fetchNearbyCourses(selectedCourse.lat, selectedCourse.lon);
        renderAll(); // Re-render to show nearby courses
      }
    } catch (err) {
      console.error("Weather error:", err);
      if (err?.name === "AbortError") {
        showError("Weather request timed out.", "Try again.");
      } else if (err?.status === 429) {
        showError("Weather provider rate limited.", "Wait a moment and try again.");
      } else {
        showError("Weather fetch failed.", err?.message || "Unknown error");
      }
    }
  }

  /* ---------- GEOLOCATION ---------- */
  function useMyLocation() {
    if (!navigator.geolocation) {
      showError("Geolocation not supported on this device.");
      return;
    }

    setBtnLoading(true);
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
          setBtnLoading(false);
        }
      },
      (err) => {
        setBtnLoading(false);
        showError("Location permission denied.", err?.message || "Allow location and try again.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  /* ---------- EVENTS ---------- */
  tabCurrent?.addEventListener("click", () => setActiveTab("current"));
  tabHourly?.addEventListener("click", () => setActiveTab("hourly"));
  tabDaily?.addEventListener("click", () => setActiveTab("daily"));

  searchBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("[Search] Search button clicked");
    doSearch();
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
        const list = await fetchCourses(q);
        console.log("[Typeahead] Got results:", list?.length || 0);
        if (Array.isArray(list) && list.length > 0) {
          renderSearchResults(list);
        } else {
          clearSearchResults();
        }
      } catch (err) {
        console.error("[Typeahead] Error:", err);
        // Don't show error for typeahead, just log it
      }
    }, 300);
  }

  searchInput?.addEventListener("input", handleTypeahead);

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
  });

  // Expose diagnostic function for debugging
  window.testSearchAPI = async function(query = "golf") {
    console.log("🔧 [Test] Testing search API with query:", query);
    try {
      const enc = encodeURIComponent(query);
      const url = `${API_BASE}/courses?search=${enc}`;
      console.log("🔧 [Test] Calling:", url);
      const res = await fetch(url);
      console.log("🔧 [Test] Response status:", res.status);
      console.log("🔧 [Test] Response headers:", Object.fromEntries(res.headers.entries()));
      const text = await res.text();
      console.log("🔧 [Test] Response body:", text);
      try {
        const json = JSON.parse(text);
        console.log("🔧 [Test] Parsed JSON:", json);
      } catch (e) {
        console.warn("🔧 [Test] Not valid JSON");
      }
      return { status: res.status, text, ok: res.ok };
    } catch (err) {
      console.error("🔧 [Test] Error:", err);
      return { error: err.message };
    }
  };

  geoBtn?.addEventListener("click", useMyLocation);

  unitsSelect?.addEventListener("change", () => {
    if (!selectedCourse) return;
    loadWeatherForSelected();
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

  playabilityScoreEl?.addEventListener("click", () => {
    openInfoModal(
      "Decision & playability explained",
      "The decision (Play / Playable (tough) / No-play) and the playability score use the same ingredients: wind strength, rain chance and mm, temperature comfort and remaining daylight. 9–10 means ideal conditions, 6–8 is playable with some compromises, and 0–5 suggests most golfers will find it poor. The suggested best tee time is picked from today’s daylight hours where rain and wind are lowest and temperature is closest to a comfortable target."
    );
  });

  infoModalClose?.addEventListener("click", closeInfoModal);
  infoModal?.addEventListener("click", (e) => {
    if (e.target === infoModal) closeInfoModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeInfoModal();
  });

  /* ---------- INIT ---------- */
  renderVerdictCard(null);
  renderPlayability(null);
  renderAll();
})();