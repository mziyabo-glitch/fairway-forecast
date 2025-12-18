/* =====================================================
   Fairway Forecast – app.js
   Stable, crash-safe, mobile-first
   Search: city/course → pick result → current/hourly/daily
   Weather: supports multiple response shapes + derives from list[]
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  // Use your Worker (must send CORS headers for your GitHub Pages domain)
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const MAX_RESULTS = 12;

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
    resultsEl.innerHTML = `<div class="ff-card"><div class="ff-big">⚠️</div><div>${esc(
      msg
    )}</div>${hint}</div>`;
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

  /* ---------- API ---------- */
  async function apiGet(path) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text}`.trim());
    }
    return res.json();
  }

  async function fetchCourses(query) {
    const q = encodeURIComponent(query);
    const data = await apiGet(`/courses?search=${q}`);
    return Array.isArray(data?.courses) ? data.courses : [];
  }

  async function fetchWeather(lat, lon) {
    const u = units();
    const data = await apiGet(`/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${u}`);
    return data;
  }

  /* ---------- NORMALIZE WEATHER SHAPES ---------- */
  function normalizeWeather(raw) {
    // target: { current, hourly[], daily[], sunrise, sunset }
    const norm = { current: null, hourly: [], daily: [], sunrise: null, sunset: null };

    if (!raw || typeof raw !== "object") return norm;

    // Sunrise/sunset can come from multiple places
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

    // CURRENT (handle several schemas)
    // 1) Worker may provide current.temp directly (preferred)
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

    // 2) Fallback: forecast list[0] as "current"
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

    // HOURLY (prefer raw.hourly)
    if (Array.isArray(raw?.hourly) && raw.hourly.length) {
      norm.hourly = raw.hourly.map((h) => ({
        dt: h.dt,
        temp: h.temp ?? h?.main?.temp ?? null,
        pop: typeof h.pop === "number" ? h.pop : null,
        wind_speed: h.wind_speed ?? h?.wind?.speed ?? null,
        weather: Array.isArray(h.weather) ? h.weather : [],
      }));
    } else if (Array.isArray(raw?.list) && raw.list.length) {
      // derive next 24h = 8 x 3-hour blocks
      norm.hourly = raw.list.slice(0, 8).map((it) => ({
        dt: it.dt,
        temp: it?.main?.temp ?? null,
        pop: typeof it?.pop === "number" ? it.pop : null,
        wind_speed: it?.wind?.speed ?? null,
        weather: Array.isArray(it?.weather) ? it.weather : [],
      }));
    }

    // DAILY (prefer raw.daily)
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
      // derive daily from list[] grouping by local date
      const byDay = new Map();

      for (const it of raw.list) {
        const dt = it.dt;
        if (!dt) continue;
        const key = new Date(dt * 1000).toLocaleDateString(); // local date grouping
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
            // try to replace icon around midday
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

      const derived = Array.from(byDay.values())
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

      norm.daily = derived;
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

    // wind penalty
    if (w > 10) score -= 3;
    else if (w > 6) score -= 2;
    else if (w > 4) score -= 1;

    // rain penalty
    if (pop >= 0.7) score -= 3;
    else if (pop >= 0.4) score -= 2;
    else if (pop >= 0.2) score -= 1;

    // temperature comfort penalty
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

  /* ---------- BEST TIME (DAYLIGHT ONLY) ---------- */
  function bestTimeToday(norm) {
    const sunrise = norm?.sunrise;
    const sunset = norm?.sunset;
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];

    if (!sunrise || !sunset || hourly.length === 0) return null;

    const start = sunrise + 3600; // +1h
    const end = sunset - 3600; // -1h
    const candidates = hourly.filter((h) => typeof h.dt === "number" && h.dt >= start && h.dt <= end);

    if (candidates.length === 0) return null;

    function scoreSlot(h) {
      // lower is better
      const pop = typeof h.pop === "number" ? h.pop : 0.3;
      const wind = typeof h.wind_speed === "number" ? h.wind_speed : 5;
      const temp = typeof h.temp === "number" ? h.temp : null;

      // target temp: ~18C or ~65F
      const target = units() === "imperial" ? 65 : 18;
      const tempPenalty = temp === null ? 2 : Math.abs(temp - target) / 6; // gentle

      return pop * 10 + wind * 0.8 + tempPenalty;
    }

    let best = candidates[0];
    let bestScore = scoreSlot(best);

    for (const c of candidates.slice(1)) {
      const s = scoreSlot(c);
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }

    return best;
  }

  /* ---------- RENDER ---------- */
  function renderHeaderCard() {
    const name = selectedCourse?.name || "Selected location";
    const line2 = [selectedCourse?.city, selectedCourse?.state, selectedCourse?.country].filter(Boolean).join(", ");

    return `
      <div class="ff-card">
        <div class="ff-big" style="font-size:1.2rem; line-height:1.2">${esc(name)}</div>
        ${line2 ? `<div class="ff-sub muted">${esc(line2)}</div>` : ""}
      </div>
    `;
  }

  function renderCurrent(norm) {
    const c = norm?.current;
    if (!c) {
      showMessage("Current weather not available.");
      return;
    }

    const icon = c?.weather?.[0]?.icon;
    const desc = c?.weather?.[0]?.description || c?.weather?.[0]?.main || "";
    const t = typeof c.temp === "number" ? Math.round(c.temp) : null;

    const windVal = typeof c.wind_speed === "number" ? c.wind_speed.toFixed(1) : "--";
    const gustVal = typeof c.wind_gust === "number" ? c.wind_gust.toFixed(1) : "--";
    const popVal = typeof c.pop === "number" ? Math.round(c.pop * 100) : "--";

    const sr = norm.sunrise ? fmtTime(norm.sunrise) : "--:--";
    const ss = norm.sunset ? fmtTime(norm.sunset) : "--:--";

    const best = bestTimeToday(norm);
    const bestText = best
      ? `${fmtTime(best.dt)} · ${Math.round(best.temp)}${tempUnit()} · ${Math.round(
          (best.pop ?? 0) * 100
        )}% rain · ${typeof best.wind_speed === "number" ? best.wind_speed.toFixed(1) : "--"} ${windUnit()}`
      : "—";

    resultsEl.innerHTML = `
      ${renderHeaderCard()}

      <div class="ff-card">
        <div class="ff-row">
          ${
            icon
              ? `<img class="ff-icon" src="https://openweathermap.org/img/wn/${esc(icon)}@2x.png" alt="" />`
              : ""
          }
          <div>
            <div class="ff-big">${t === null ? "--" : t}${tempUnit()}</div>
            <div class="ff-sub">${esc(desc)}</div>
          </div>
        </div>

        <div class="ff-metrics">
          <div>Wind ${esc(windVal)} ${esc(windUnit())}</div>
          <div>Gust ${esc(gustVal)} ${esc(windUnit())}</div>
          <div>Rain chance ${esc(popVal)}%</div>
        </div>

        <div class="ff-metrics" style="margin-top:10px">
          <div>Sunrise ${esc(sr)}</div>
          <div>Sunset ${esc(ss)}</div>
          <div>Best time ${esc(bestText)}</div>
        </div>
      </div>
    `;

    if (playabilityScoreEl) {
      const p = calculatePlayability(norm);
      playabilityScoreEl.textContent = `${p}/10`;
    }
  }

  function renderHourly(norm) {
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (hourly.length === 0) {
      showMessage("Hourly data not available.");
      return;
    }

    const hours = hourly.slice(0, 8);
    resultsEl.innerHTML = `
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-sub muted">Hourly · Next 24 hours (3-hour blocks)</div>
        <div class="ff-hourly">
          ${hours
            .map((h) => {
              const time = typeof h.dt === "number" ? fmtTime(h.dt) : "--:--";
              const icon = h?.weather?.[0]?.icon;
              const pop = typeof h.pop === "number" ? Math.round(h.pop * 100) : 0;
              const wind = typeof h.wind_speed === "number" ? h.wind_speed.toFixed(1) : "--";
              const temp = typeof h.temp === "number" ? Math.round(h.temp) : "--";
              return `
                <div class="ff-hour">
                  <div class="ff-hour-time">${esc(time)}</div>
                  ${
                    icon
                      ? `<img src="https://openweathermap.org/img/wn/${esc(icon)}@2x.png" alt="" />`
                      : ""
                  }
                  <div class="ff-hour-temp">${esc(temp)}${esc(tempUnit())}</div>
                  <div class="ff-hour-meta">${esc(pop)}% · ${esc(wind)} ${esc(windUnit())}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderDaily(norm) {
    const daily = Array.isArray(norm?.daily) ? norm.daily : [];
    if (daily.length === 0) {
      showMessage("Daily forecast not available.");
      return;
    }

    const days = daily.slice(0, 7);
    resultsEl.innerHTML = `
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-sub muted">Daily · Up to 7 days</div>
        <div class="ff-daily">
          ${days
            .map((d) => {
              const date = typeof d.dt === "number" ? fmtDay(d.dt) : "--";
              const icon = d?.weather?.[0]?.icon || d?.icon;
              const main = d?.weather?.[0]?.main || "";
              const max = typeof d.max === "number" ? Math.round(d.max) : "--";
              const min = typeof d.min === "number" ? Math.round(d.min) : "--";
              const pop = typeof d.pop === "number" ? Math.round(d.pop * 100) : null;

              return `
                <div class="ff-day">
                  <div class="ff-day-date">${esc(date)}</div>
                  ${
                    icon
                      ? `<img src="https://openweathermap.org/img/wn/${esc(icon)}@2x.png" alt="" />`
                      : ""
                  }
                  <div class="ff-day-desc">${esc(main)}${pop === null ? "" : ` · ${esc(pop)}%`}</div>
                  <div class="ff-day-temp">${esc(max)}${esc(tempUnit())} ${esc(min)}${esc(tempUnit())}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderActiveTab() {
    if (!lastNorm) return;
    if (activeTab === "current") renderCurrent(lastNorm);
    else if (activeTab === "hourly") renderHourly(lastNorm);
    else renderDaily(lastNorm);
  }

  /* ---------- SEARCH UI ---------- */
  function renderSearchResults(list) {
    if (!Array.isArray(list) || list.length === 0) {
      showMessage("No courses found. Try a broader search (e.g. “Swindon” or “golf club swindon”).");
      return;
    }

    const items = list.slice(0, MAX_RESULTS);

    resultsEl.innerHTML = `
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

  async function runSearch() {
    const q = (searchInput?.value || "").trim();
    if (!q) {
      showMessage("Type a town/city or a course name, then Search.");
      return;
    }

    // reset state so tabs don’t show stale data
    selectedCourse = null;
    lastRawWeather = null;
    lastNorm = null;
    if (playabilityScoreEl) playabilityScoreEl.textContent = "--/10";

    showMessage("Searching…");

    try {
      const courses = await fetchCourses(q);
      renderSearchResults(courses);
    } catch (err) {
      console.error(err);

      // Most common real-world failure: CORS misconfig on Worker
      const hint =
        String(err?.message || "").includes("Failed to fetch")
          ? "If you see a CORS error in DevTools, your Worker must add Access-Control-Allow-Origin for your GitHub Pages domain."
          : "";

      showError("Search failed.", hint);
    }
  }

  async function loadCourseFromDataset(ds) {
    const lat = parseFloat(ds.lat);
    const lon = parseFloat(ds.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showError("This course is missing coordinates.", "Try a different result.");
      return;
    }

    selectedCourse = {
      id: ds.id || null,
      name: ds.name || "Course",
      city: ds.city || "",
      state: ds.state || "",
      country: ds.country || "",
      lat,
      lon,
    };

    // put selection into input (nice UX)
    if (searchInput) searchInput.value = selectedCourse.name;

    showMessage("Loading weather…");

    try {
      lastRawWeather = await fetchWeather(lat, lon);
      lastNorm = normalizeWeather(lastRawWeather);

      // ensure tabs start at Current
      setActiveTab("current");
      renderActiveTab();
    } catch (err) {
      console.error(err);

      const hint =
        String(err?.message || "").includes("Failed to fetch")
          ? "If you see a CORS error in DevTools, your Worker must add Access-Control-Allow-Origin for your GitHub Pages domain."
          : "";

      showError("Weather failed to load for this location.", hint);
    }
  }

  /* ---------- SUGGESTIONS (DATALIST) ---------- */
  let suggestTimer = null;
  function wireSuggestions() {
    if (!suggestionsEl || !searchInput) return;

    searchInput.addEventListener("input", () => {
      const q = (searchInput.value || "").trim();
      if (q.length < 2) {
        suggestionsEl.innerHTML = "";
        return;
      }
      if (suggestTimer) window.clearTimeout(suggestTimer);
      suggestTimer = window.setTimeout(async () => {
        try {
          const courses = await fetchCourses(q);
          const top = courses.slice(0, 8);
          suggestionsEl.innerHTML = top
            .map((c) => {
              const name = c?.name || c?.club_name || c?.course_name || "";
              return name ? `<option value="${esc(name)}"></option>` : "";
            })
            .join("");
        } catch {
          // suggestions are non-critical; fail silently
        }
      }, 250);
    });
  }

  /* ---------- GEOLOCATION (OPTIONAL) ---------- */
  async function runGeolocation() {
    if (!navigator.geolocation) {
      showError("Geolocation not supported.", "Use manual search instead.");
      return;
    }

    showMessage("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos?.coords?.latitude;
        const lon = pos?.coords?.longitude;

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          showError("Could not read your location.", "Use manual search instead.");
          return;
        }

        // Minimal/safe: just load weather for your coords (no “near me courses” complexity)
        selectedCourse = { name: "Your location", city: "", state: "", country: "", lat, lon };

        try {
          lastRawWeather = await fetchWeather(lat, lon);
          lastNorm = normalizeWeather(lastRawWeather);
          setActiveTab("current");
          renderActiveTab();
        } catch (err) {
          console.error(err);
          showError("Weather failed to load for your location.");
        }
      },
      () => {
        showError("Location permission denied.", "Use manual search instead.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
    );
  }

  /* ---------- EVENTS (ATTACH ONCE) ---------- */
  function init() {
    if (initialized) return;
    initialized = true;

    // Search click
    searchBtn?.addEventListener("click", runSearch);

    // Enter key
    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
    });

    // Results click (event delegation)
    resultsEl.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".ff-result");
      if (!btn) return;
      loadCourseFromDataset(btn.dataset);
    });

    // Tabs
    tabCurrent?.addEventListener("click", () => {
      if (!lastNorm) return;
      setActiveTab("current");
      renderActiveTab();
    });

    tabHourly?.addEventListener("click", () => {
      if (!lastNorm) return;
      setActiveTab("hourly");
      renderActiveTab();
    });

    tabDaily?.addEventListener("click", () => {
      if (!lastNorm) return;
      setActiveTab("daily");
      renderActiveTab();
    });

    // Units change should re-fetch (most accurate)
    unitsSelect?.addEventListener("change", async () => {
      if (!selectedCourse?.lat || !selectedCourse?.lon) return;
      showMessage("Updating units…");
      try {
        lastRawWeather = await fetchWeather(selectedCourse.lat, selectedCourse.lon);
        lastNorm = normalizeWeather(lastRawWeather);
        renderActiveTab();
      } catch (err) {
        console.error(err);
        showError("Could not update units.");
      }
    });

    // Optional geo button
    geoBtn?.addEventListener("click", runGeolocation);

    wireSuggestions();

    showMessage('Search for a town/city or course name, then pick a result. (Tip: try “golf club swindon”)');
  }

  // init immediately (script is loaded at end of body)
  init();
function calculateVerdict(weather) {
  if (!weather?.current) {
    return {
      status: "NO-PLAY",
      label: "No-play recommended",
      reason: "Weather data unavailable"
    };
  }

  let score = 100;

  const wind = weather.current.wind?.speed ?? 0;
  const temp = weather.current.temp;
  const pop = weather.hourly?.[0]?.pop ?? 0;
  const sunrise = weather.current.sunrise;
  const sunset = weather.current.sunset;
  const now = Math.floor(Date.now() / 1000);

  // Hard daylight rule
  if (!sunrise || !sunset || now > sunset - 3600) {
    return {
      status: "NO-PLAY",
      label: "No-play recommended",
      reason: "Limited daylight today"
    };
  }

  if (wind > 12) score -= 40;
  else if (wind > 8) score -= 25;
  else if (wind > 5) score -= 15;

  if (pop > 0.7) score -= 40;
  else if (pop > 0.4) score -= 25;
  else if (pop > 0.2) score -= 15;

  if (temp < 4 || temp > 30) score -= 25;
  else if (temp < 8 || temp > 27) score -= 15;

  if (score >= 70) return { status: "PLAY", label: "Play", reason: "Good conditions for golf" };
  if (score >= 45) return { status: "PLAYABLE", label: "Playable (tough)", reason: "Conditions are manageable but challenging" };

  return { status: "NO-PLAY", label: "No-play recommended", reason: "Poor overall conditions" };
}   
})();

