/* =====================================================
   Fairway Forecast – app.js
   Syntax-safe, crash-safe, mobile-first
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const MAX_RESULTS = 12;

  const SUGGEST_MIN_CHARS = 3;
  const SUGGEST_DEBOUNCE_MS = 550;
  const SUGGEST_COOLDOWN_MS = 1800;

  const COURSE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 mins
  const WEATHER_CACHE_TTL_MS = 3 * 60 * 1000; // 3 mins

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
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
  let selectedCourse = null; // { id, name, city, state, country, lat, lon }
  let lastRawWeather = null;
  let lastNorm = null;
  let activeTab = "current";

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

    if (idx >= 0) favs.splice(idx, 1);
    else {
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

  function showMessage(msg) {
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  }

  function showError(msg, extra = "") {
    const hint = extra ? `<div class="ff-sub muted" style="margin-top:8px">${esc(extra)}</div>` : "";
    resultsEl.innerHTML = `<div class="ff-card"><div class="ff-big">⚠️</div><div>${esc(msg)}</div>${hint}</div>`;
  }

  function fmtTime(tsSeconds) {
    if (!tsSeconds) return "";
    return new Date(tsSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDay(tsSeconds) {
    return new Date(tsSeconds * 1000).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  /* ---------- SIMPLE IN-MEMORY CACHE ---------- */
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
    const cacheKey = q.toLowerCase();
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

  /* ---------- NORMALIZE WEATHER ---------- */
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
      norm.hourly = raw.list.slice(0, 16).map((it) => ({
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
      }));
    } else if (Array.isArray(raw?.list) && raw.list.length) {
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
            weatherMain: it?.weather?.[0]?.main ?? "",
          });
        } else {
          const d = byDay.get(key);
          if (typeof tMin === "number") d.min = d.min === null ? tMin : Math.min(d.min, tMin);
          if (typeof tMax === "number") d.max = d.max === null ? tMax : Math.max(d.max, tMax);
          if (typeof pop === "number") d.popMax = d.popMax === null ? pop : Math.max(d.popMax, pop);
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
          weather: d.weatherMain ? [{ main: d.weatherMain }] : [],
        }));
    }

    return norm;
  }

  /* ---------- BEST TEE TIME ---------- */
  function bestTimeToday(norm) {
    const sunrise = norm?.sunrise;
    const sunset = norm?.sunset;
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (!sunrise || !sunset || hourly.length === 0) return null;

    const start = sunrise + 3600;
    const end = sunset - 3600;

    const candidates = hourly.filter((h) => typeof h.dt === "number" && h.dt >= start && h.dt <= end);
    if (!candidates.length) return null;

    const pops = candidates
      .map((h) => (typeof h.pop === "number" ? h.pop : null))
      .filter((x) => typeof x === "number");

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

  /* ---------- PLAYABILITY + VERDICT ---------- */
  function calculatePlayability(norm) {
    const c = norm?.current;
    if (!c) return "--";

    let score = 10;

    const w = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const temp = typeof c.temp === "number" ? c.temp : null;
    const pop = typeof c.pop === "number" ? c.pop : 0;

    if (w > 10) score -= 3;
    else if (w > 6) score -= 2;
    else if (w > 4) score -= 1;

    if (pop >= 0.7) score -= 3;
    else if (pop >= 0.4) score -= 2;
    else if (pop >= 0.2) score -= 1;

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

  function calculateVerdict(norm) {
    if (!norm?.current) {
      return { status: "NO", label: "No-play recommended", reason: "Weather data unavailable", best: null };
    }

    const c = norm.current;
    const wind = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const popNow = typeof c.pop === "number" ? c.pop : null;
    const temp = typeof c.temp === "number" ? c.temp : null;

    const sunrise = norm.sunrise;
    const sunset = norm.sunset;
    const now = nowSec();

    if (sunrise && sunset && now > sunset - 3600) {
      return { status: "NO", label: "No-play recommended", reason: "Limited daylight remaining", best: null };
    }

    const best = bestTimeToday(norm);

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

    if (v.best && typeof v.best.dt === "number") {
      const t = typeof v.best.temp === "number" ? `${Math.round(v.best.temp)}${tempUnit()}` : "";
      verdictBestTime.textContent = `${fmtTime(v.best.dt)}${t ? ` (${t})` : ""}`;
    } else {
      verdictBestTime.textContent = "";
    }
  }

  /* ---------- RENDER ---------- */
  function renderFavsStrip() {
    const favs = loadFavs();
    if (!favs.length) return "";

    const items = favs.slice(0, 6).map((f, i) => {
      const line2 = [f.city, f.state, f.country].filter(Boolean).join(", ");
      return `
        <button class="ff-fav" type="button" data-i="${i}">
          <div class="ff-fav-name">★ ${esc(f.name || "Favourite")}</div>
          <div class="ff-fav-sub">${esc(line2)}</div>
        </button>
      `;
    }).join("");

    return `
      <div class="ff-card">
        <div class="ff-card-title">Favourites</div>
        <div class="ff-fav-list">${items}</div>
      </div>
    `;
  }

  function attachFavHandlers(root) {
    const favs = loadFavs();
    root.querySelectorAll(".ff-fav").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.getAttribute("data-i"));
        const f = favs[idx];
        if (!f) return;
        await selectCourse({
          id: f.id,
          name: f.name,
          city: f.city,
          state: f.state,
          country: f.country,
          lat: f.lat,
          lon: f.lon,
        });
      });
    });
  }

  function renderHeaderCard() {
    if (!selectedCourse) return "";

    const name = selectedCourse.name || "Selected location";
    const line2 = [selectedCourse.city, selectedCourse.state, selectedCourse.country].filter(Boolean).join(", ");
    const fav = isFavourited(selectedCourse);

    return `
      <div class="ff-card ff-course">
        <div class="ff-course-row">
          <div class="ff-course-text">
            <div class="ff-course-name">${esc(name)}</div>
            <div class="ff-course-sub">${esc(line2)}</div>
          </div>
          <button class="ff-btn" type="button" id="favBtn" title="Favourite">
            ${fav ? "★" : "☆"}
          </button>
        </div>
      </div>
    `;
  }

  function attachHeaderHandlers(root) {
    const favBtn = root.querySelector("#favBtn");
    if (favBtn) favBtn.addEventListener("click", () => toggleFavourite(selectedCourse));
  }

  function renderCurrentCard(norm) {
    if (!norm?.current) return `<div class="ff-card muted">No weather loaded yet.</div>`;

    const c = norm.current;
    const wMain = c.weather?.[0]?.description || c.weather?.[0]?.main || "";
    const temp = typeof c.temp === "number" ? `${Math.round(c.temp)}${tempUnit()}` : "";
    const wind = typeof c.wind_speed === "number" ? `${c.wind_speed.toFixed(1)} ${windUnit()}` : "";
    const gust = typeof c.wind_gust === "number" ? `${c.wind_gust.toFixed(1)} ${windUnit()}` : "";
    const popPct = typeof c.pop === "number" ? `${Math.round(c.pop * 100)}%` : "";

    const best = bestTimeToday(norm);
    const bestLine = best
      ? `${fmtTime(best.dt)} · ${typeof best.temp === "number" ? `${Math.round(best.temp)}${tempUnit()}` : ""} · ${
          typeof best.pop === "number" ? `${Math.round(best.pop * 100)}% rain` : ""
        } · ${typeof best.wind_speed === "number" ? `${best.wind_speed.toFixed(1)} ${windUnit()}` : ""}`
      : "";

    const sunrise = norm.sunrise ? fmtTime(norm.sunrise) : "";
    const sunset = norm.sunset ? fmtTime(norm.sunset) : "";

    return `
      <div class="ff-card ff-current">
        <div class="ff-current-top">
          <div class="ff-temp">${esc(temp)}</div>
          <div class="ff-desc">${esc(wMain)}</div>
        </div>

        <div class="ff-grid">
          <div class="ff-pill"><strong>Wind</strong> ${esc(wind)}</div>
          <div class="ff-pill"><strong>Gust</strong> ${esc(gust)}</div>
          <div class="ff-pill"><strong>Rain chance</strong> ${esc(popPct)}</div>
          <div class="ff-pill"><strong>Sunrise</strong> ${esc(sunrise)}</div>
          <div class="ff-pill"><strong>Sunset</strong> ${esc(sunset)}</div>
          <div class="ff-pill"><strong>Best time</strong> ${esc(bestLine)}</div>
        </div>
      </div>
    `;
  }

  function renderHourlyCard(norm) {
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (!hourly.length) return `<div class="ff-card muted">No hourly data available.</div>`;

    const rows = hourly.slice(0, 16).map((h) => {
      const t = typeof h.temp === "number" ? `${Math.round(h.temp)}${tempUnit()}` : "";
      const pop = typeof h.pop === "number" ? `${Math.round(h.pop * 100)}%` : "";
      const wind = typeof h.wind_speed === "number" ? `${h.wind_speed.toFixed(1)} ${windUnit()}` : "";
      const label = fmtTime(h.dt);
      return `
        <div class="ff-row">
          <div class="ff-row-a">${esc(label)}</div>
          <div class="ff-row-b">${esc(t)}</div>
          <div class="ff-row-c">${esc(pop)}</div>
          <div class="ff-row-d">${esc(wind)}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="ff-card">
        <div class="ff-card-title">Hourly</div>
        <div class="ff-table">
          <div class="ff-row ff-head">
            <div class="ff-row-a">Time</div>
            <div class="ff-row-b">Temp</div>
            <div class="ff-row-c">Rain</div>
            <div class="ff-row-d">Wind</div>
          </div>
          ${rows}
        </div>
      </div>
    `;
  }

  function renderDailyCard(norm) {
    const daily = Array.isArray(norm?.daily) ? norm.daily : [];
    if (!daily.length) return `<div class="ff-card muted">No daily data available.</div>`;

    const rows = daily.slice(0, 7).map((d) => {
      const hi = typeof d.max === "number" ? Math.round(d.max) : "";
      const lo = typeof d.min === "number" ? Math.round(d.min) : "";
      const pop = typeof d.pop === "number" ? `${Math.round(d.pop * 100)}%` : "";
      const label = fmtDay(d.dt);
      const main = d.weather?.[0]?.main || "";
      return `
        <div class="ff-row">
          <div class="ff-row-a">${esc(label)}</div>
          <div class="ff-row-b">${esc(`${hi}${hi !== "" ? tempUnit() : ""} / ${lo}${lo !== "" ? tempUnit() : ""}`)}</div>
          <div class="ff-row-c">${esc(pop)}</div>
          <div class="ff-row-d">${esc(main)}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="ff-card">
        <div class="ff-card-title">Daily · up to 7 days</div>
        <div class="ff-table">
          <div class="ff-row ff-head">
            <div class="ff-row-a">Day</div>
            <div class="ff-row-b">High/Low</div>
            <div class="ff-row-c">Rain</div>
            <div class="ff-row-d">Summary</div>
          </div>
          ${rows}
        </div>
      </div>
    `;
  }

  function renderCoursePicker(courses, queryLabel = "") {
    const items = courses.slice(0, MAX_RESULTS).map((c, idx) => {
      const name = c.name || c.course_name || c.club_name || "Course";
      const line2 = [c.city, c.state, c.country].filter(Boolean).join(", ");
      return `
        <button class="ff-pick" type="button" data-idx="${idx}">
          <div class="ff-pick-name">${esc(name)}</div>
          <div class="ff-pick-sub">${esc(line2)}</div>
        </button>
      `;
    }).join("");

    const title = queryLabel ? `Select a result for “${esc(queryLabel)}”` : "Select a result";

    return `
      <div class="ff-card">
        <div class="ff-card-title">${title}</div>
        <div class="ff-pick-list">${items}</div>
      </div>
    `;
  }

  function attachPickerHandlers(root, courses) {
    root.querySelectorAll(".ff-pick").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.getAttribute("data-idx"));
        const picked = courses[idx];
        await selectCourse(picked);
      });
    });
  }

  async function runSearch() {
    const q = (searchInput?.value || "").trim();
    if (!q) return;

    showMessage("Searching…");

    try {
      const courses = await fetchCourses(q);

      if (!courses.length) {
        showMessage("No courses found. Try adding “golf” or a nearby town.");
        return;
      }

      if (courses.length === 1) {
        await selectCourse(courses[0]);
        return;
      }

      const html = `${renderFavsStrip()}${renderCoursePicker(courses, q)}`;
      resultsEl.innerHTML = html;

      attachFavHandlers(resultsEl);
      attachPickerHandlers(resultsEl, courses);
    } catch (err) {
      if (err?.status === 429) {
        showError("Rate limit hit. Please wait a moment and try again.");
        return;
      }
      showError("Search failed.", err?.message || "");
    }
  }

  async function selectCourse(course) {
    if (!course) return;

    const lat = Number(course.lat);
    const lon = Number(course.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showError("This result has no coordinates.", "Try a different result.");
      return;
    }

    selectedCourse = {
      id: course.id ?? null,
      name: course.name || course.course_name || course.club_name || "Course",
      city: course.city || "",
      state: course.state || "",
      country: course.country || "",
      lat,
      lon,
    };

    try {
      showMessage("Loading weather…");
      lastRawWeather = await fetchWeather(selectedCourse.lat, selectedCourse.lon);
      lastNorm = normalizeWeather(lastRawWeather);

      const ps = calculatePlayability(lastNorm);
      if (playabilityScoreEl) playabilityScoreEl.textContent = `${ps}/10`;

      renderAll();
    } catch (err) {
      if (err?.status === 429) {
        showError("Weather rate limit hit. Try again in a moment.");
        return;
      }
      showError("Weather load failed.", err?.message || "");
    }
  }

  let suggestTimer = null;
  let suggestCooldownUntil = 0;

  async function updateSuggestions() {
    if (!suggestionsEl || !searchInput) return;

    const q = (searchInput.value || "").trim();
    if (q.length < SUGGEST_MIN_CHARS) {
      suggestionsEl.innerHTML = "";
      return;
    }

    if (Date.now() < suggestCooldownUntil) return;

    try {
      const courses = await fetchCourses(q);
      const names = courses
        .slice(0, 10)
        .map((c) => c.name || c.course_name || c.club_name)
        .filter(Boolean);

      suggestionsEl.innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");
    } catch (err) {
      if (err?.status === 429) suggestCooldownUntil = Date.now() + SUGGEST_COOLDOWN_MS;
      suggestionsEl.innerHTML = "";
    }
  }

  function onTypeSuggest() {
    if (!suggestionsEl) return;
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(updateSuggestions, SUGGEST_DEBOUNCE_MS);
  }

  async function useGeolocation() {
    if (!navigator.geolocation) {
      showError("Geolocation not supported on this device.");
      return;
    }

    showMessage("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await selectCourse({
          id: null,
          name: "Your location",
          city: "",
          state: "",
          country: "",
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      () => showError("Location permission denied."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function renderAll() {
    const favsHtml = renderFavsStrip();
    const headerHtml = renderHeaderCard();

    let tabHtml = "";
    if (lastNorm) {
      if (activeTab === "current") tabHtml = renderCurrentCard(lastNorm);
      else if (activeTab === "hourly") tabHtml = renderHourlyCard(lastNorm);
      else tabHtml = renderDailyCard(lastNorm);
    } else {
      tabHtml = `<div class="ff-card muted">Search and select a result to load weather.</div>`;
    }

    resultsEl.innerHTML = `${favsHtml}${headerHtml}${tabHtml}`;

    attachFavHandlers(resultsEl);
    attachHeaderHandlers(resultsEl);

    renderVerdictCard(lastNorm);
  }

  /* ---------- EVENTS ---------- */
  tabCurrent?.addEventListener("click", () => {
    setActiveTab("current");
    renderAll();
  });

  tabHourly?.addEventListener("click", () => {
    setActiveTab("hourly");
    renderAll();
  });

  tabDaily?.addEventListener("click", () => {
    setActiveTab("daily");
    renderAll();
  });

  searchBtn?.addEventListener("click", runSearch);

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  searchInput?.addEventListener("input", onTypeSuggest);

  unitsSelect?.addEventListener("change", async () => {
    if (selectedCourse) await selectCourse(selectedCourse);
    else renderAll();
  });

  geoBtn?.addEventListener("click", useGeolocation);

  /* ---------- INIT ---------- */
  setActiveTab("current");
  renderAll();
})();
