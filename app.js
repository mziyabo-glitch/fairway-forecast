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
  const suggestionsEl = $("searchSuggestions"); // optional datalist

  const verdictCard = $("verdictCard");
  const verdictIcon = $("verdictIcon");
  const verdictLabel = $("verdictLabel");
  const verdictReason = $("verdictReason");
  const verdictBestTime = $("verdictBestTime");

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

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function pct(pop) {
    return typeof pop === "number" ? `${Math.round(pop * 100)}%` : "";
  }

  function fmtTime(tsSeconds) {
    if (!tsSeconds) return "";
    return new Date(tsSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
    if (next === "current") tabCurrent?.classList.add("active");
    if (next === "hourly") tabHourly?.classList.add("active");
    if (next === "daily") tabDaily?.classList.add("active");
    renderAll();
  }

  function setBtnLoading(isLoading, label = "Search") {
    if (!searchBtn) return;
    searchBtn.dataset._label ??= searchBtn.textContent || label;
    searchBtn.disabled = !!isLoading;
    searchBtn.textContent = isLoading ? "Loading…" : searchBtn.dataset._label;
  }

  function showMessage(msg) {
    if (forecastSlot) {
      forecastSlot.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
    } else if (resultsEl) {
      resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
    }
  }

  function showError(msg, extra = "") {
    const hint = extra ? `<div class="ff-sub muted" style="margin-top:8px">${esc(extra)}</div>` : "";
    const html = `<div class="ff-card">
      <div class="ff-big">⚠️</div>
      <div>${esc(msg)}</div>${hint}
    </div>`;

    if (forecastSlot) {
      forecastSlot.innerHTML = html;
    } else if (resultsEl) {
      resultsEl.innerHTML = html;
    }
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

      if (res.status === 429) {
        const err = new Error("HTTP 429 Too Many Requests");
        err.status = 429;
        throw err;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`HTTP ${res.status} ${res.statusText} ${text}`.trim());
        err.status = res.status;
        throw err;
      }

      return await res.json();
    } finally {
      clearTimeout(t);
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

  async function fetchCourses(query) {
    const q = (query || "").trim();
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
    try {
      console.log(`🌐 [GolfAPI] Calling primary API...`);
      const data = await apiGet(`/courses?search=${enc}`);
      list = Array.isArray(data?.courses) ? data.courses : [];
      source = "GolfAPI";
      if (list.length > 0) {
        console.log(`✅ [GolfAPI] Found ${list.length} course(s)`);
      } else {
        console.log(`⚠️ [GolfAPI] No results found`);
      }
    } catch (err) {
      console.warn("⚠️ [GolfAPI] Primary API failed, will try Supabase fallback", err);
      list = [];
      source = "GolfAPI (failed)";
    }

    // Fallback to Supabase when no primary matches
    if (!Array.isArray(list) || list.length === 0) {
      console.log(`🔄 [Fallback] Trying Supabase...`);
      const supa = await fetchCoursesSupabase(q);
      if (supa.length > 0) {
        list = supa;
        source = "Supabase";
        console.log(`✅ [Fallback] Using ${supa.length} result(s) from Supabase`);
      } else {
        console.log(`❌ [Fallback] Supabase also returned no results`);
      }
    }

    console.log(`📊 [Search] Final result: ${list.length} course(s) from ${source}`);
    cacheSet(memCache.courses, cacheKey, list);
    return list;
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
    const norm = { current: null, hourly: [], daily: [], sunrise: null, sunset: null };
    if (!raw || typeof raw !== "object") return norm;

    norm.sunrise = raw?.current?.sunrise ?? raw?.city?.sunrise ?? null;
    norm.sunset = raw?.current?.sunset ?? raw?.city?.sunset ?? null;

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
    }

    // hourly from forecast list
    if (Array.isArray(raw?.list) && raw.list.length) {
      norm.hourly = raw.list.slice(0, 16).map((it) => ({
        dt: it.dt,
        temp: it?.main?.temp ?? null,
        pop: typeof it?.pop === "number" ? it.pop : 0,
        wind_speed: it?.wind?.speed ?? null,
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

  function calculateVerdict(norm) {
    if (!norm?.current) return { status: "NO", label: "No-play recommended", reason: "Weather data unavailable", best: null };

    const sunrise = norm.sunrise;
    const sunset = norm.sunset;
    const now = nowSec();
    if (sunrise && sunset && now > sunset - 3600) {
      return { status: "NO", label: "No-play recommended", reason: "Limited daylight remaining", best: null };
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

    if (score >= 72) return { status: "PLAY", label: "Play", reason: "Good overall conditions", best };
    if (score >= 48) return { status: "MAYBE", label: "Playable (tough)", reason: "Manageable, but expect challenges", best };
    return { status: "NO", label: "No-play recommended", reason: best ? "Poor overall conditions" : "Rain likely throughout daylight", best };
  }

  function renderVerdictCard(norm) {
    if (!verdictCard || !verdictLabel || !verdictReason || !verdictIcon || !verdictBestTime) return;

    const v = norm ? calculateVerdict(norm) : { status: "NEUTRAL", label: "—", reason: "—", best: null };

    verdictCard.classList.remove("ff-verdict--play", "ff-verdict--maybe", "ff-verdict--no", "ff-verdict--neutral");

    if (v.status === "PLAY") {
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

    verdictLabel.textContent = v.label || "—";
    verdictReason.textContent = v.reason || "—";
    verdictBestTime.textContent =
      v.best && typeof v.best.dt === "number" ? fmtTime(v.best.dt) : "—";
  }

  function renderPlayability(norm) {
    if (!playabilityScoreEl) return;
    const p = norm ? calculatePlayability(norm) : "--";
    playabilityScoreEl.textContent = `${p}/10`;
  }

  /* ---------- EXPLAINER MODAL ---------- */
  function openInfoModal(title, body) {
    if (!infoModal || !infoModalTitle || !infoModalBody) return;
    infoModalTitle.textContent = title;
    infoModalBody.textContent = body;
    infoModal.hidden = false;
  }

  function closeInfoModal() {
    if (!infoModal) return;
    infoModal.hidden = true;
  }

  /* ---------- RENDER ---------- */
  function renderHeaderBlock() {
    const favs = loadFavs();
    const starOn = selectedCourse ? isFavourited(selectedCourse) : false;

    const name = selectedCourse?.name ? esc(selectedCourse.name) : "Your location";
    const line2 = [selectedCourse?.city, selectedCourse?.state, selectedCourse?.country].filter(Boolean).join(", ");

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

    return `<div class="ff-card ff-course-header">
      <div class="ff-course-header-main">
        <div>
          <div class="ff-course-title">${name}</div>
          ${line2 ? `<div class="ff-sub">${esc(line2)}</div>` : ""}
        </div>
        ${
          selectedCourse
            ? `<button type="button" class="ff-btn ff-btn-ghost ff-star" id="favBtn" title="Favourite">${starOn ? "★" : "☆"}</button>`
            : ""
        }
      </div>
      ${favStrip}
    </div>`;
  }

  function renderCurrent(norm) {
    const c = norm?.current;
    if (!c) return `<div class="ff-card muted">No current weather available.</div>`;

    const t = typeof c.temp === "number" ? `${Math.round(c.temp)}${tempUnit()}` : "—";
    const desc = c?.weather?.[0]?.description || c?.weather?.[0]?.main || "—";
    const ico = iconHtml(c.weather, 2);

    const wind = typeof c.wind_speed === "number" ? `${c.wind_speed.toFixed(1)} ${windUnit()}` : "";
    const gust = typeof c.wind_gust === "number" ? `${c.wind_gust.toFixed(1)} ${windUnit()}` : "";
    const popValue = typeof c.pop === "number" ? c.pop : 0;
    const rainProb = pct(popValue);
    const rainMm = `${(typeof c.rain_mm === "number" ? c.rain_mm : 0).toFixed(2)} mm`;
    const rain = [rainProb, rainMm].filter(Boolean).join(" · ");

    const sunrise = norm.sunrise ? fmtTime(norm.sunrise) : "";
    const sunset = norm.sunset ? fmtTime(norm.sunset) : "";

    const best = bestTimeToday(norm);
    const bestText = best?.dt ? fmtTime(best.dt) : "";

    const stats = [
      wind ? `<div class="ff-stat"><span>Wind</span><strong>${esc(wind)}</strong></div>` : "",
      gust ? `<div class="ff-stat"><span>Gust</span><strong>${esc(gust)}</strong></div>` : "",
      rain ? `<div class="ff-stat"><span>Rain</span><strong>${esc(rain)}</strong></div>` : "",
      sunrise ? `<div class="ff-stat"><span>Sunrise</span><strong>${esc(sunrise)}</strong></div>` : "",
      sunset ? `<div class="ff-stat"><span>Sunset</span><strong>${esc(sunset)}</strong></div>` : "",
      bestText ? `<div class="ff-stat"><span>Best time</span><strong>${esc(bestText)}</strong></div>` : "",
    ].filter(Boolean).join("");

    return `<div class="ff-card ff-current">
      <div class="ff-current-top">
        <div class="ff-current-left">
          <div class="ff-current-temp">${esc(t)}</div>
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

    const rows = hourly.slice(0, 16).map((h) => {
      const time = h?.dt ? fmtTime(h.dt) : "";
      const t = typeof h.temp === "number" ? `${Math.round(h.temp)}${tempUnit()}` : "";
      const popValue = typeof h.pop === "number" ? h.pop : 0;
      const rainProb = pct(popValue);
      const rainMm = `${(typeof h.rain_mm === "number" ? h.rain_mm : 0).toFixed(2)} mm`;
      const rain = [rainProb, rainMm].filter(Boolean).join(" · ");
      const wind = typeof h.wind_speed === "number" ? `${h.wind_speed.toFixed(1)} ${windUnit()}` : "";
      const ico = iconHtml(h.weather, 2);

      return `<tr>
        <td class="ff-td-time">${esc(time)}</td>
        <td class="ff-td-icon">${ico || ""}</td>
        <td>${esc(t)}</td>
        <td>${esc(rain)}</td>
        <td>${esc(wind)}</td>
      </tr>`;
    }).join("");

    return `<div class="ff-card">
      <div class="ff-card-title">Hourly</div>
      <div class="ff-table-wrap">
        <table class="ff-table">
          <thead>
            <tr><th>Time</th><th></th><th>Temp</th><th>Rain</th><th>Wind</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  function renderDaily(norm) {
    const daily = Array.isArray(norm?.daily) ? norm.daily : [];
    if (!daily.length) return `<div class="ff-card muted">No daily data available.</div>`;

    const rows = daily.slice(0, 7).map((d) => {
      const day = d?.dt ? fmtDay(d.dt) : "";
      const hi = typeof d.max === "number" ? Math.round(d.max) : null;
      const lo = typeof d.min === "number" ? Math.round(d.min) : null;
      const hiLo = hi !== null && lo !== null ? `${hi}${tempUnit()} / ${lo}${tempUnit()}` : "";
      const rain = typeof d.pop === "number" ? pct(d.pop) : "";
      const summary = d?.weather?.[0]?.main || d?.weather?.[0]?.description || "";
      const ico = iconHtml(d.weather, 2);

      return `<tr>
        <td class="ff-td-day">${esc(day)}</td>
        <td class="ff-td-icon">${ico || ""}</td>
        <td>${esc(hiLo)}</td>
        <td>${esc(rain)}</td>
        <td>${esc(summary)}</td>
      </tr>`;
    }).join("");

    return `<div class="ff-card">
      <div class="ff-card-title">Daily · up to 7 days</div>
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

  function wireHeaderButtons() {
    const host = locationSlot || resultsEl;
    const favBtn = $("favBtn");
    favBtn?.addEventListener("click", () => toggleFavourite(selectedCourse));

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

    if (locationSlot) locationSlot.innerHTML = header;
    if (forecastSlot) {
      forecastSlot.innerHTML = body;
    } else if (resultsEl && !locationSlot) {
      // fallback for legacy markup
      resultsEl.innerHTML = `${header}${body}`;
    }

    wireHeaderButtons();
  }

  /* ---------- SEARCH ---------- */
  function normalizeCourse(raw) {
    return {
      id: raw?.id ?? null,
      name: raw?.name || raw?.course_name || raw?.club_name || "Course",
      city: raw?.city || "",
      state: raw?.state || "",
      country: raw?.country || "",
      lat: typeof raw?.lat === "number" ? raw.lat : null,
      lon: typeof raw?.lon === "number" ? raw.lon : null,
    };
  }

  function clearSearchResults() {
    if (searchResultsSlot) {
      searchResultsSlot.innerHTML = "";
    }
  }

  function renderSearchResults(list) {
    const header = renderHeaderBlock();

    if (locationSlot) {
      locationSlot.innerHTML = header;
    }

    const host = searchResultsSlot || forecastSlot || resultsEl;

    if (!Array.isArray(list) || list.length === 0) {
      if (host) host.innerHTML = `<div class="ff-card muted">No matches found. Try adding “golf / club / gc”.</div>`;
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
      return `<button class="ff-result" type="button" data-i="${idx}" ${disabled ? "disabled" : ""}>
        <div class="ff-result-main">
          <div class="ff-result-title">${esc(c.name)}</div>
          <div class="ff-result-sub">${esc(line2)}</div>
        </div>
      </button>`;
    }).join("");

    if (host) {
      host.innerHTML = `<div class="ff-card">
        <div class="ff-card-title">Select a result</div>
        <div class="ff-result-list">${items}</div>
      </div>`;
    }

    // IMPORTANT: bind clicks AFTER inserting the DOM
    host
      ?.querySelectorAll(".ff-result[data-i]")
      .forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.getAttribute("data-i"));
        const c = normalizeCourse(list[i]);
        if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) {
          showError("That result is missing coordinates.", "Try another result.");
          return;
        }
        selectedCourse = c;
        loadWeatherForSelected();
      });
      });

    wireHeaderButtons();

    if (searchResultsSlot) {
      searchResultsSlot.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  async function doSearch() {
    const q = (searchInput?.value || "").trim();
    if (!q) {
      showMessage("Type a town/city or golf course name.");
      return;
    }

    clearSearchResults();
    setBtnLoading(true);
    showMessage("Loading…");

    try {
      const list = await fetchCourses(q);
      renderSearchResults(list);

      // optional suggestions list
      if (suggestionsEl) {
        suggestionsEl.innerHTML = list.slice(0, 12).map((raw) => {
          const c = normalizeCourse(raw);
          const line2 = [c.city, c.state, c.country].filter(Boolean).join(", ");
          return `<option value="${esc(line2 ? `${c.name} — ${line2}` : c.name)}"></option>`;
        }).join("");
      }
    } catch (err) {
      console.error("Search error:", err);
      if (err?.name === "AbortError") {
        showError("Search timed out.", "Try again (your API may be slow right now).");
      } else if (err?.status === 429) {
        showError("Rate limited (too many requests).", "Wait ~30 seconds and try again.");
      } else {
        showError("Search failed.", err?.message || "Unknown error");
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

    try {
      const raw = await fetchWeather(selectedCourse.lat, selectedCourse.lon);
      lastNorm = normalizeWeather(raw);

      renderVerdictCard(lastNorm);
      renderPlayability(lastNorm);
      renderAll();
      clearSearchResults();
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

  searchBtn?.addEventListener("click", doSearch);

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
        const list = await fetchCourses(q);
        // reuse existing renderer so keyboard + button behave the same
        renderSearchResults(list);

        if (suggestionsEl) {
          suggestionsEl.innerHTML = list
            .slice(0, 12)
            .map((raw) => {
              const c = normalizeCourse(raw);
              const line2 = [c.city, c.state, c.country].filter(Boolean).join(", ");
              return `<option value="${esc(line2 ? `${c.name} — ${line2}` : c.name)}"></option>`;
            })
            .join("");
        }
      } catch (err) {
        console.error("Typeahead error:", err);
      }
    }, 250);
  }

  searchInput?.addEventListener("input", handleTypeahead);

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
  });

  geoBtn?.addEventListener("click", useMyLocation);

  unitsSelect?.addEventListener("change", () => {
    if (!selectedCourse) return;
    loadWeatherForSelected();
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