/* =====================================================
   Fairway Forecast – app.js (LATEST)
   Stable, crash-safe, mobile-first
   Search: city/course → pick result → current/hourly/daily
   Weather: supports worker schema + derives hourly/daily from list[]
   Extras:
   - Verdict card (PLAY / PLAYABLE / NO-PLAY) front-and-centre
   - Best tee time (daylight only) + “no recommendation” when rain likely all day
   - Suggestions while typing (debounced + cached + 429-aware)
   - Favourites (localStorage) + favourites strip
   - Search results render under the search bar (#searchResults)
   - Removes “— / --” placeholder tiles (hides missing-data tiles)
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const MAX_RESULTS = 12;

  // Suggestions throttling (helps avoid 429 from upstream)
  const SUGGEST_MIN_CHARS = 3;
  const SUGGEST_DEBOUNCE_MS = 550;
  const SUGGEST_COOLDOWN_MS = 1800;

  // Cache (memory) – reduces upstream hits
  const COURSE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 mins
  const WEATHER_CACHE_TTL_MS = 3 * 60 * 1000; // 3 mins

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const searchResultsEl = $("searchResults"); // ✅ under search bar
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const geoBtn = $("btnGeo") || $("geoBtn"); // optional
  const unitsSelect = $("unitsSelect") || $("units"); // optional
  const suggestionsEl = $("searchSuggestions"); // optional datalist

  // Verdict card (in your HTML)
  const verdictCard = $("verdictCard");
  const verdictIcon = $("verdictIcon");
  const verdictLabel = $("verdictLabel");
  const verdictReason = $("verdictReason");
  const verdictBestTime = $("verdictBestTime");

  if (!resultsEl) {
    console.warn("Missing #results – app halted safely.");
    return;
  }

  /* ---------- STATE ---------- */
  let selectedCourse = null; // { name, city, state, country, lat, lon, id }
  let lastRawWeather = null; // raw worker response
  let lastNorm = null; // normalized { current, hourly, daily, sunrise, sunset }
  let activeTab = "current";
  let initialized = false;

  // suggestions cooldown for rate limits
  let suggestCooldownUntil = 0;
  let suggestTimer = null;

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
    renderFavsStrip();
    renderVerdictCard(lastNorm);
    // refresh tab content (so star button updates)
    renderActiveTab();
  }

  /* ---------- HELPERS ---------- */
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const units = () => (unitsSelect?.value === "imperial" ? "imperial" : "metric");
  const windUnit = () => (units() === "imperial" ? "mph" : "m/s");
  const tempUnit = () => (units() === "imperial" ? "°F" : "°C");

  function setActiveTab(next) {
    activeTab = next;
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    if (next === "current") tabCurrent?.classList.add("active");
    if (next === "hourly") tabHourly?.classList.add("active");
    if (next === "daily") tabDaily?.classList.add("active");
  }

  // Main results only
  function showMessage(msg) {
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  }

  function showError(msg, extra = "") {
    const hint = extra ? `<div class="ff-sub muted" style="margin-top:8px">${esc(extra)}</div>` : "";
    resultsEl.innerHTML = `<div class="ff-card"><div class="ff-big">⚠️</div><div>${esc(msg)}</div>${hint}</div>`;
  }

  // Search results area (under search bar)
  function showSearchMessage(msg) {
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  }

  function clearSearchResults() {
    if (!searchResultsEl) return;
    searchResultsEl.innerHTML = "";
  }

  function fmtTime(tsSeconds) {
    if (!tsSeconds) return "--:--";
    return new Date(tsSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDay(tsSeconds) {
    return new Date(tsSeconds * 1000).toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function iconUrl(code) {
    if (!code) return "";
    return `https://openweathermap.org/img/wn/${code}@2x.png`;
  }

  /* ---------- SIMPLE IN-MEMORY CACHE ---------- */
  const memCache = {
    courses: new Map(), // key -> { t, data }
    weather: new Map(), // key -> { t, data }
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
    const res = await fetch(url, { method: "GET" });

    if (res.status === 429) {
      const text = await res.text().catch(() => "");
      const err = new Error("HTTP 429 Too Many Requests");
      err.status = 429;
      err.body = text;
      throw err;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status} ${res.statusText} ${text}`.trim());
      err.status = res.status;
      throw err;
    }

    return res.json();
  }

  async function fetchCourses(query) {
    const q = (query || "").trim();
    const cacheKey = `${q.toLowerCase()}`;
    const cached = cacheGet(memCache.courses, cacheKey, COURSE_CACHE_TTL_MS);
    if (cached) return cached;

    const enc = encodeURIComponent(q);
    const data = await apiGet(`/courses?search=${enc}`);
    const list = Array.isArray(data?.courses) ? data.courses : [];
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

  /* ---------- NORMALIZE WEATHER SHAPES ---------- */
  function normalizeWeather(raw) {
    const norm = { current: null, hourly: [], daily: [], sunrise: null, sunset: null };
    if (!raw || typeof raw !== "object") return norm;

    norm.sunrise =
      raw?.current?.sunrise ??
      raw?.city?.sunrise ??
      raw?.weather?.sys?.sunrise ??
      raw?.current?.sys?.sunrise ??
      null;

    norm.sunset =
      raw?.current?.sunset ??
      raw?.city?.sunset ??
      raw?.weather?.sys?.sunset ??
      raw?.current?.sys?.sunset ??
      null;

    if (raw?.current && typeof raw.current === "object") {
      const c = raw.current;

      const temp =
        (typeof c.temp === "number" ? c.temp : null) ??
        (typeof c?.main?.temp === "number" ? c.main.temp : null) ??
        (typeof raw?.weather?.main?.temp === "number" ? raw.weather.main.temp : null) ??
        null;

      const weatherArr =
        Array.isArray(c.weather) ? c.weather : Array.isArray(raw?.weather?.weather) ? raw.weather.weather : [];

      norm.current = {
        dt: c.dt ?? raw?.dt ?? null,
        temp,
        feels_like:
          (typeof c.feels_like === "number" ? c.feels_like : null) ??
          (typeof c?.main?.feels_like === "number" ? c.main.feels_like : null) ??
          null,
        humidity:
          (typeof c.humidity === "number" ? c.humidity : null) ??
          (typeof c?.main?.humidity === "number" ? c.main.humidity : null) ??
          null,
        wind_speed:
          (typeof c?.wind?.speed === "number" ? c.wind.speed : null) ??
          (typeof c?.wind_speed === "number" ? c.wind_speed : null) ??
          (typeof raw?.weather?.wind?.speed === "number" ? raw.weather.wind.speed : null) ??
          null,
        wind_gust:
          (typeof c?.wind?.gust === "number" ? c.wind.gust : null) ??
          (typeof c?.wind_gust === "number" ? c.wind_gust : null) ??
          null,
        pop: typeof c.pop === "number" ? c.pop : null,
        weather: weatherArr,
      };
    }

    if (!norm.current && Array.isArray(raw?.list) && raw.list.length) {
      const first = raw.list[0];
      norm.current = {
        dt: first.dt ?? null,
        temp: typeof first?.main?.temp === "number" ? first.main.temp : null,
        feels_like: typeof first?.main?.feels_like === "number" ? first.main.feels_like : null,
        humidity: typeof first?.main?.humidity === "number" ? first.main.humidity : null,
        wind_speed: typeof first?.wind?.speed === "number" ? first.wind.speed : null,
        wind_gust: typeof first?.wind?.gust === "number" ? first.wind.gust : null,
        pop: typeof first?.pop === "number" ? first.pop : null,
        weather: Array.isArray(first?.weather) ? first.weather : [],
      };
    }

    if (Array.isArray(raw?.hourly) && raw.hourly.length) {
      norm.hourly = raw.hourly.map((h) => ({
        dt: h.dt,
        temp: h.temp ?? h?.main?.temp ?? null,
        pop: typeof h.pop === "number" ? h.pop : null,
        wind_speed: h.wind_speed ?? h?.wind?.speed ?? null,
        weather: Array.isArray(h.weather) ? h.weather : [],
      }));
    } else if (Array.isArray(raw?.list) && raw.list.length) {
      norm.hourly = raw.list.slice(0, 24).map((it) => ({
        dt: it.dt,
        temp: it?.main?.temp ?? null,
        pop: typeof it?.pop === "number" ? it.pop : null,
        wind_speed: it?.wind?.speed ?? null,
        weather: Array.isArray(it?.weather) ? it.weather : [],
      }));
    }

    if (Array.isArray(raw?.daily) && raw.daily.length) {
      norm.daily = raw.daily.map((d) => ({
        dt: d.dt,
        min: d?.temp?.min ?? d?.min ?? null,
        max: d?.temp?.max ?? d?.max ?? null,
        pop: typeof d.pop === "number" ? d.pop : null,
        weather: Array.isArray(d.weather) ? d.weather : [],
        icon: d?.weather?.[0]?.icon ?? d?.icon ?? null,
      }));
    } else if (Array.isArray(raw?.list) && raw.list.length) {
      // derive 7-day-ish from 5-day list by grouping by day
      const byDay = new Map();

      for (const it of raw.list) {
        const dt = it.dt;
        if (!dt) continue;

        const key = new Date(dt * 1000).toLocaleDateString();
        const tMin = it?.main?.temp_min;
        const tMax = it?.main?.temp_max;
        const pop = typeof it?.pop === "number" ? it.pop : null;

        if (!byDay.has(key)) {
          byDay.set(key, {
            dt,
            min: typeof tMin === "number" ? tMin : null,
            max: typeof tMax === "number" ? tMax : null,
            popMax: typeof pop === "number" ? pop : null,
            icon: it?.weather?.[0]?.icon ?? null,
            weatherMain: it?.weather?.[0]?.main ?? "",
            middayIcon: null,
            middayDt: null,
          });
        } else {
          const d = byDay.get(key);
          if (typeof tMin === "number") d.min = d.min === null ? tMin : Math.min(d.min, tMin);
          if (typeof tMax === "number") d.max = d.max === null ? tMax : Math.max(d.max, tMax);
          if (typeof pop === "number") d.popMax = d.popMax === null ? pop : Math.max(d.popMax, pop);

          const hour = new Date(dt * 1000).getHours();
          if (hour >= 11 && hour <= 14) {
            d.middayIcon = it?.weather?.[0]?.icon ?? d.middayIcon;
            d.middayDt = dt;
            d.weatherMain = it?.weather?.[0]?.main ?? d.weatherMain;
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
          icon: d.middayIcon || d.icon,
          weather: d.weatherMain ? [{ main: d.weatherMain, icon: d.middayIcon || d.icon }] : [],
        }));
    }

    return norm;
  }

  /* ---------- PLAYABILITY ---------- */
  function calculatePlayability(norm) {
    const c = norm?.current;
    if (!c) return "--";

    let score = 10;

    const w = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const temp = typeof c.temp === "number" ? c.temp : null;
    const pop = typeof c.pop === "number" ? c.pop : 0;

    // wind
    if (units() === "metric") {
      if (w > 12) score -= 4;
      else if (w > 9) score -= 3;
      else if (w > 6) score -= 2;
      else if (w > 4) score -= 1;
    } else {
      if (w > 27) score -= 4;
      else if (w > 20) score -= 3;
      else if (w > 14) score -= 2;
      else if (w > 9) score -= 1;
    }

    // rain probability
    if (pop >= 0.7) score -= 3;
    else if (pop >= 0.4) score -= 2;
    else if (pop >= 0.2) score -= 1;

    // temp comfort
    if (temp !== null) {
      if (units() === "metric") {
        if (temp < 4) score -= 2;
        else if (temp < 8) score -= 1;
        if (temp > 30) score -= 2;
      } else {
        if (temp < 40) score -= 2;
        else if (temp < 46) score -= 1;
        if (temp > 86) score -= 2;
      }
    }

    return clamp(Math.round(score), 0, 10);
  }

  /* ---------- BEST TEE TIME (DAYLIGHT ONLY + RAIN GUARD) ---------- */
  function bestTimeToday(norm) {
    const sunrise = norm?.sunrise;
    const sunset = norm?.sunset;
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (!sunrise || !sunset || hourly.length === 0) return null;

    const start = sunrise + 3600; // +1h after sunrise
    const end = sunset - 3600; // -1h before sunset
    const candidates = hourly.filter((h) => typeof h.dt === "number" && h.dt >= start && h.dt <= end);
    if (candidates.length === 0) return null;

    // If it’s basically raining all day, do NOT recommend a tee time
    const pops = candidates
      .map((h) => (typeof h.pop === "number" ? h.pop : null))
      .filter((x) => typeof x === "number");

    if (pops.length) {
      const minPop = Math.min(...pops);
      const avgPop = pops.reduce((a, b) => a + b, 0) / pops.length;

      // Strong guardrails (fixes “100% rain but still recommends 12:00”)
      if (minPop >= 0.8 || avgPop >= 0.85) return null;
    }

    function slotScore(h) {
      const pop = typeof h.pop === "number" ? h.pop : 0.35;
      const wind = typeof h.wind_speed === "number" ? h.wind_speed : 5;
      const temp = typeof h.temp === "number" ? h.temp : null;

      const target = units() === "imperial" ? 65 : 18;
      const tempPenalty = temp === null ? 2 : Math.abs(temp - target) / 6;

      // lower is better
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

  /* ---------- VERDICT (PLAY / PLAYABLE / NO-PLAY) ---------- */
  function calculateVerdict(norm) {
    if (!norm?.current) {
      return {
        status: "NO",
        label: "No-play recommended",
        reason: "Weather data unavailable",
        best: null,
      };
    }

    const c = norm.current;
    const wind = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const popNow = typeof c.pop === "number" ? c.pop : null;
    const temp = typeof c.temp === "number" ? c.temp : null;

    const sunrise = norm.sunrise;
    const sunset = norm.sunset;
    const now = nowSec();

    // Daylight guard
    if (sunrise && sunset && now > sunset - 3600) {
      return {
        status: "NO",
        label: "No-play recommended",
        reason: "Limited daylight remaining",
        best: null,
      };
    }

    const best = bestTimeToday(norm);

    // Scoring (0–100)
    let score = 100;

    // Wind penalties
    if (units() === "metric") {
      if (wind > 12) score -= 45;
      else if (wind > 9) score -= 30;
      else if (wind > 6) score -= 18;
    } else {
      if (wind > 27) score -= 45;
      else if (wind > 20) score -= 30;
      else if (wind > 14) score -= 18;
    }

    // Rain penalties (use current pop if present)
    const pop = popNow ?? (typeof best?.pop === "number" ? best.pop : 0.25);
    if (pop >= 0.85) score -= 50;
    else if (pop >= 0.6) score -= 35;
    else if (pop >= 0.35) score -= 20;

    // Temp comfort
    if (temp !== null) {
      if (units() === "metric") {
        if (temp < 3 || temp > 30) score -= 25;
        else if (temp < 7 || temp > 27) score -= 12;
      } else {
        if (temp < 38 || temp > 86) score -= 25;
        else if (temp < 45 || temp > 82) score -= 12;
      }
    }

    // If no best time (rain likely all day), push verdict toward NO
    if (!best) score -= 18;

    score = clamp(Math.round(score), 0, 100);

    if (score >= 72) {
      return { status: "PLAY", label: "Play", reason: "Good overall conditions", best };
    }
    if (score >= 48) {
      return { status: "MAYBE", label: "Playable (tough)", reason: "Manageable, but expect challenges", best };
    }
    return {
      status: "NO",
      label: "No-play recommended",
      reason: best ? "Poor overall conditions" : "Rain likely throughout daylight",
      best,
    };
  }

  function renderVerdictCard(norm) {
    if (!verdictCard || !verdictLabel || !verdictReason || !verdictIcon || !verdictBestTime) return;

    const v = calculateVerdict(norm);

    verdictCard.classList.remove("ff-verdict--play", "ff-verdict--maybe", "ff-verdict--no");

    if (v.status === "PLAY") {
      verdictCard.classList.add("ff-verdict--play");
      verdictIcon.textContent = "✅";
    } else if (v.status === "MAYBE") {
      verdictCard.classList.add("ff-verdict--maybe");
      verdictIcon.textContent = "⚠️";
    } else {
      verdictCard.classList.add("ff-verdict--no");
      verdictIcon.textContent = "⛔";
    }

    verdictLabel.textContent = v.label;
    verdictReason.textContent = v.reason;

    // Best tee time text
    if (v.best && typeof v.best.dt === "number") {
      const t = typeof v.best.temp === "number" ? `${Math.round(v.best.temp)}${tempUnit()}` : "--";
      verdictBestTime.textContent = `${fmtTime(v.best.dt)} (${t})`;
    } else {
      verdictBestTime.textContent = "—";
    }
  }

  /* ---------- SEARCH RESULTS (under search bar) ---------- */
  function renderSearchResults(list) {
    if (!searchResultsEl) return;

    if (!Array.isArray(list) || list.length === 0) {
      searchResultsEl.innerHTML = `
        <div class="ff-card muted">No results. Try a broader search (e.g. “Swindon” or “golf club swindon”).</div>
      `;
      return;
    }

    const items = list.slice(0, MAX_RESULTS);

    searchResultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Select a result</div>
        <div class="ff-results-list">
          ${items
            .map((c) => {
              const name = c?.name || c?.club_name || c?.course_name || "Course";
              const city = c?.city || "";
              const state = c?.state || "";
              const country = c?.country || "";
              const id = c?.id ?? "";
              const lat = c?.lat ?? c?.latitude ?? "";
              const lon = c?.lon ?? c?.lng ?? c?.longitude ?? "";
              const line2 = [city, state, country].filter(Boolean).join(", ");

              return `
                <button
                  type="button"
                  class="ff-result"
                  data-id="${esc(id)}"
                  data-name="${esc(name)}"
                  data-city="${esc(city)}"
                  data-state="${esc(state)}"
                  data-country="${esc(country)}"
                  data-lat="${esc(lat)}"
                  data-lon="${esc(lon)}"
                >
                  <div class="ff-result-title">${esc(name)}</div>
                  ${line2 ? `<div class="ff-sub muted">${esc(line2)}</div>` : ""}
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function bindSearchResultClicks() {
    if (!searchResultsEl) return;

    searchResultsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".ff-result");
      if (!btn) return;

      const ds = btn.dataset || {};
      loadCourseFromDataset(ds);
    });
  }

  function loadCourseFromDataset(ds) {
    const lat = Number(ds.lat);
    const lon = Number(ds.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showError("This result has no coordinates.", "Try another result.");
      return;
    }

    selectedCourse = {
      id: ds.id ? String(ds.id) : null,
      name: ds.name || "Selected location",
      city: ds.city || "",
      state: ds.state || "",
      country: ds.country || "",
      lat,
      lon,
    };

    clearSearchResults();
    setActiveTab("current");
    runWeatherForSelected();
  }

  /* ---------- FAVOURITES STRIP ---------- */
  function renderFavsStrip() {
    const favs = loadFavs();
    if (!favs.length) return "";

    return `
      <div class="ff-card">
        <div class="ff-sub muted" style="margin-bottom:10px">Favourites</div>
        <div class="ff-results-list">
          ${favs
            .slice(0, 8)
            .map((f) => {
              const line2 = [f.city, f.state, f.country].filter(Boolean).join(", ");
              const lat = f.lat ?? "";
              const lon = f.lon ?? "";
              return `
                <button type="button" class="ff-result ff-fav" data-id="${esc(f.id ?? "")}"
                  data-name="${esc(f.name ?? "")}"
                  data-city="${esc(f.city ?? "")}"
                  data-state="${esc(f.state ?? "")}"
                  data-country="${esc(f.country ?? "")}"
                  data-lat="${esc(lat)}"
                  data-lon="${esc(lon)}">
                  <div class="ff-result-title">★ ${esc(f.name ?? "")}</div>
                  ${line2 ? `<div class="ff-sub muted">${esc(line2)}</div>` : ""}
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function bindFavClicks() {
    resultsEl.addEventListener("click", (e) => {
      const favBtn = e.target.closest(".ff-fav");
      if (!favBtn) return;
      loadCourseFromDataset(favBtn.dataset);
    });
  }

  /* ---------- RENDER: HEADER + CURRENT/HOURLY/DAILY ---------- */
  function renderHeaderCard() {
    const name = selectedCourse?.name || "Your location";
    const line2 = [selectedCourse?.city, selectedCourse?.state, selectedCourse?.country].filter(Boolean).join(", ");
    const fav = selectedCourse ? isFavourited(selectedCourse) : false;

    const star = selectedCourse
      ? `<button type="button" class="ff-btn" id="favBtn" title="Favourite" style="width:44px;padding:0;border-radius:16px">
           ${fav ? "★" : "☆"}
         </button>`
      : "";

    return `
      <div class="ff-card">
        <div class="ff-row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div class="ff-big" style="font-size:1.25rem">${esc(name)}</div>
            ${line2 ? `<div class="ff-sub muted">${esc(line2)}</div>` : ""}
          </div>
          ${star}
        </div>
      </div>
    `;
  }

  function bindHeaderActions() {
    const favBtn = $("favBtn");
    if (favBtn && selectedCourse) {
      favBtn.addEventListener("click", () => toggleFavourite(selectedCourse));
    }
  }

  function renderCurrent(norm) {
    const c = norm?.current;
    if (!c) {
      resultsEl.innerHTML = `${renderFavsStrip()}${renderHeaderCard()}
        <div class="ff-card muted">Search for a town/city or course name, then pick a result.</div>`;
      bindHeaderActions();
      return;
    }

    const main = c.weather?.[0]?.main || "";
    const desc = c.weather?.[0]?.description || main || "—";
    const icon = c.weather?.[0]?.icon ? iconUrl(c.weather[0].icon) : "";

    const temp = typeof c.temp === "number" ? `${Math.round(c.temp)}${tempUnit()}` : null;
    const wind = typeof c.wind_speed === "number" ? `${c.wind_speed.toFixed(1)} ${windUnit()}` : null;
    const gust = typeof c.wind_gust === "number" ? `${c.wind_gust.toFixed(1)} ${windUnit()}` : null;
    const pop = typeof c.pop === "number" ? `${Math.round(c.pop * 100)}%` : null;

    const sr = norm.sunrise ? fmtTime(norm.sunrise) : null;
    const ss = norm.sunset ? fmtTime(norm.sunset) : null;

    const best = bestTimeToday(norm);
    const bestText = best
      ? `${fmtTime(best.dt)} · ${
          typeof best.temp === "number" ? `${Math.round(best.temp)}${tempUnit()}` : "--"
        } · ${typeof best.pop === "number" ? `${Math.round(best.pop * 100)}% rain` : "--"} · ${
          typeof best.wind_speed === "number" ? best.wind_speed.toFixed(1) : "--"
        } ${windUnit()}`
      : null;

    // ✅ Hide missing-data tiles (removes dashes)
    const tiles = [
      wind ? `<div>Wind ${esc(wind)}</div>` : "",
      gust ? `<div>Gust ${esc(gust)}</div>` : "",
      pop ? `<div>Rain chance ${esc(pop)}</div>` : "",
      sr ? `<div>Sunrise ${esc(sr)}</div>` : "",
      ss ? `<div>Sunset ${esc(ss)}</div>` : "",
      bestText ? `<div>Best time ${esc(bestText)}</div>` : "",
    ].filter(Boolean);

    const playScore = calculatePlayability(norm);
    if (playabilityScoreEl) playabilityScoreEl.textContent = `${playScore}/10`;

    resultsEl.innerHTML = `
      ${renderFavsStrip()}
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-row" style="align-items:center">
          ${icon ? `<img class="ff-icon" src="${esc(icon)}" alt="" />` : ""}
          <div>
            <div class="ff-big">${temp ?? "—"}</div>
            <div class="ff-sub muted">${esc(desc)}</div>
          </div>
        </div>

        ${tiles.length ? `<div class="ff-metrics" style="margin-top:12px">${tiles.join("")}</div>` : ""}
      </div>
    `;

    bindHeaderActions();
  }

  function renderHourly(norm) {
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (!hourly.length) {
      resultsEl.innerHTML = `${renderFavsStrip()}${renderHeaderCard()}<div class="ff-card muted">No hourly data.</div>`;
      bindHeaderActions();
      return;
    }

    resultsEl.innerHTML = `
      ${renderFavsStrip()}
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-sub muted">Next hours</div>
        <div class="ff-hourly">
          ${hourly.slice(0, 16).map((h) => {
            const t = typeof h.temp === "number" ? `${Math.round(h.temp)}${tempUnit()}` : "";
            const p = typeof h.pop === "number" ? `${Math.round(h.pop * 100)}%` : "";
            const w = typeof h.wind_speed === "number" ? `${h.wind_speed.toFixed(1)} ${windUnit()}` : "";
            const ic = h.weather?.[0]?.icon ? iconUrl(h.weather[0].icon) : "";
            const main = h.weather?.[0]?.main || "";
            return `
              <div class="ff-hour">
                <div style="font-weight:800">${esc(fmtTime(h.dt))}</div>
                ${ic ? `<img src="${esc(ic)}" alt="" />` : ""}
                ${main ? `<div class="ff-sub muted">${esc(main)}</div>` : ""}
                ${t ? `<div>${esc(t)}</div>` : ""}
                ${p ? `<div class="ff-sub muted">Rain ${esc(p)}</div>` : ""}
                ${w ? `<div class="ff-sub muted">Wind ${esc(w)}</div>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
    bindHeaderActions();
  }

  function renderDaily(norm) {
    const daily = Array.isArray(norm?.daily) ? norm.daily : [];
    if (!daily.length) {
      resultsEl.innerHTML = `${renderFavsStrip()}${renderHeaderCard()}<div class="ff-card muted">No daily data.</div>`;
      bindHeaderActions();
      return;
    }

    resultsEl.innerHTML = `
      ${renderFavsStrip()}
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-sub muted">Daily · Up to 7 days</div>
        <div class="ff-daily">
          ${daily.slice(0, 7).map((d) => {
            const ic = d.icon ? iconUrl(d.icon) : (d.weather?.[0]?.icon ? iconUrl(d.weather[0].icon) : "");
            const main = d.weather?.[0]?.main || "";
            const pop = typeof d.pop === "number" ? `${Math.round(d.pop * 100)}%` : "";
            const min = typeof d.min === "number" ? Math.round(d.min) : null;
            const max = typeof d.max === "number" ? Math.round(d.max) : null;
            const temp = (min !== null && max !== null) ? `${min}° / ${max}°` : (max !== null ? `${max}°` : "");
            return `
              <div class="ff-day">
                ${ic ? `<img src="${esc(ic)}" alt="" />` : `<div style="width:42px;height:42px"></div>`}
                <div>
                  <div style="font-weight:800">${esc(fmtDay(d.dt))}</div>
                  <div class="ff-sub muted">${esc(main || (pop ? `Rain ${pop}` : ""))}</div>
                </div>
                <div style="text-align:right">
                  ${temp ? `<div class="ff-day-temp">${esc(temp)}</div>` : ""}
                  ${pop ? `<div class="ff-sub muted">Rain ${esc(pop)}</div>` : ""}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
    bindHeaderActions();
  }

  function renderActiveTab() {
    if (!lastNorm) {
      resultsEl.innerHTML = `${renderFavsStrip()}<div class="ff-card muted">Search for a town/city or course name, then pick a result.</div>`;
      return;
    }
    if (activeTab === "hourly") renderHourly(lastNorm);
    else if (activeTab === "daily") renderDaily(lastNorm);
    else renderCurrent(lastNorm);
  }

  /* ---------- MAIN FLOW ---------- */
  async function runSearch() {
    const q = (searchInput?.value || "").trim();
    clearSearchResults();

    if (!q) {
      showSearchMessage("Type a town/city or golf course name.");
      return;
    }

    showSearchMessage("Searching…");

    try {
      const list = await fetchCourses(q);
      renderSearchResults(list);
    } catch (err) {
      if (err?.status === 429) {
        suggestCooldownUntil = Date.now() + SUGGEST_COOLDOWN_MS;
        showSearchMessage("Too many requests. Please wait a moment and try again.");
        return;
      }
      showSearchMessage("Search failed. Please try again.");
      console.error(err);
    }
  }

  async function runWeatherForSelected() {
    if (!selectedCourse) {
      showMessage("Pick a result first.");
      return;
    }

    showMessage("Loading weather…");

    try {
      const raw = await fetchWeather(selectedCourse.lat, selectedCourse.lon);
      lastRawWeather = raw;
      lastNorm = normalizeWeather(raw);

      renderVerdictCard(lastNorm);
      renderActiveTab();
    } catch (err) {
      if (err?.status === 429) {
        showError("Too many requests. Try again in a moment.");
        return;
      }
      showError("Weather failed to load.", "Try another result or try again.");
      console.error(err);
    }
  }

  /* ---------- SUGGESTIONS (datalist) ---------- */
  function updateDatalistFromCourses(list) {
    if (!suggestionsEl) return;
    const items = Array.isArray(list) ? list.slice(0, 10) : [];
    suggestionsEl.innerHTML = items
      .map((c) => {
        const name = c?.name || c?.course_name || c?.club_name || "";
        if (!name) return "";
        return `<option value="${esc(name)}"></option>`;
      })
      .join("");
  }

  function scheduleSuggestions() {
    if (!searchInput) return;
    const q = (searchInput.value || "").trim();
    if (q.length < SUGGEST_MIN_CHARS) return;

    if (Date.now() < suggestCooldownUntil) return;

    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      try {
        const list = await fetchCourses(q);
        updateDatalistFromCourses(list);
      } catch (err) {
        if (err?.status === 429) {
          suggestCooldownUntil = Date.now() + SUGGEST_COOLDOWN_MS;
        }
      }
    }, SUGGEST_DEBOUNCE_MS);
  }

  /* ---------- GEOLOCATION ---------- */
  function useGeolocation() {
    if (!navigator.geolocation) {
      showSearchMessage("Geolocation not supported on this device.");
      return;
    }

    showSearchMessage("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos?.coords?.latitude;
        const lon = pos?.coords?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          showSearchMessage("Could not read location. Try again.");
          return;
        }

        selectedCourse = {
          id: null,
          name: "Your location",
          city: "",
          state: "",
          country: "",
          lat,
          lon,
        };

        clearSearchResults();
        setActiveTab("current");
        await runWeatherForSelected();
      },
      () => {
        showSearchMessage("Location permission denied.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  /* ---------- EVENTS ---------- */
  function bindEvents() {
    searchBtn?.addEventListener("click", runSearch);

    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearch();
    });

    searchInput?.addEventListener("input", () => {
      scheduleSuggestions();
      // Keep UI tidy: if user starts typing, clear old results
      if ((searchInput.value || "").trim().length < 2) clearSearchResults();
    });

    tabCurrent?.addEventListener("click", () => {
      setActiveTab("current");
      renderActiveTab();
    });
    tabHourly?.addEventListener("click", () => {
      setActiveTab("hourly");
      renderActiveTab();
    });
    tabDaily?.addEventListener("click", () => {
      setActiveTab("daily");
      renderActiveTab();
    });

    unitsSelect?.addEventListener("change", async () => {
      // When units change, refetch weather for the selected course
      if (selectedCourse) {
        await runWeatherForSelected();
      }
    });

    geoBtn?.addEventListener("click", useGeolocation);

    bindSearchResultClicks();
    bindFavClicks();
  }

  function init() {
    if (initialized) return;
    initialized = true;

    // Default tab
    setActiveTab("current");

    // Initial UI
    resultsEl.innerHTML = `${renderFavsStrip()}<div class="ff-card muted">Search for a town/city or course name, then pick a result.</div>`;
    clearSearchResults();

    bindEvents();
  }

  init();
})();
