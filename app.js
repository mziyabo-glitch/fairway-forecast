/* =====================================================
   Fairway Forecast – app.js
   Stable, crash-safe, mobile-first
   Supports: course search, (optional) near-me, tabs
   Works with Worker payload: { current, forecast:{list:[]}, ... }
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const NEAR_ME_RADIUS_MILES = 20;
  const MILES_TO_KM = 1.60934;

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  // Optional (safe if missing)
  const geoBtn = $("btnGeo") || $("geoBtn");
  const unitsSelect = $("unitsSelect") || $("units") || $("unitSelect");

  /* ---------- STATE ---------- */
  let selectedCourse = null;
  let lastWeatherRaw = null;     // raw worker payload
  let lastView = "current";      // "current" | "hourly" | "daily"
  let lastUserPos = null;        // {lat, lon}

  /* ---------- GUARDS ---------- */
  if (!resultsEl) {
    console.warn("Missing #results element. App halted safely.");
    return;
  }

  /* ---------- UTILS ---------- */
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const showMessage = (msg) => {
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  };

  const getUnits = () => (unitsSelect?.value === "imperial" ? "imperial" : "metric");

  const unitTemp = () => (getUnits() === "imperial" ? "°F" : "°C");
  const unitWind = () => (getUnits() === "imperial" ? "mph" : "m/s");

  const setActiveTab = (tab) => {
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    tab?.classList.add("active");
  };

  function fmtTime(ts, tzOffsetSeconds = 0) {
    // ts in seconds (UTC), tzOffsetSeconds in seconds
    const d = new Date((ts + tzOffsetSeconds) * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDay(ts, tzOffsetSeconds = 0) {
    const d = new Date((ts + tzOffsetSeconds) * 1000);
    return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  }

  /* ---------- DISTANCE ---------- */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  /* ---------- FETCH ---------- */
  async function fetchCourses(query) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Course search failed");
    return Array.isArray(data?.courses) ? data.courses : [];
  }

  async function fetchWeather(lat, lon) {
    const url = `${API_BASE}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(
      lon
    )}&units=${encodeURIComponent(getUnits())}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Weather fetch failed");
    return data;
  }

  /* ---------- NORMALIZE WEATHER ---------- */
  function normalizeWeather(raw) {
    const tz = Number(raw?.timezone_offset ?? 0);

    const c = raw?.current || {};
    const main = c.main || {};
    const wind = c.wind || {};
    const wx0 = Array.isArray(c.weather) ? c.weather[0] : null;

    const current = {
      tz,
      name: c?.name || raw?.name || "",
      country: c?.sys?.country || "",
      sunrise: c?.sys?.sunrise ?? null,
      sunset: c?.sys?.sunset ?? null,
      temp: main?.temp ?? c?.temp ?? null,
      desc: wx0?.description || wx0?.main || "",
      icon: wx0?.icon || "",
      windSpeed: wind?.speed ?? null,
      windGust: wind?.gust ?? null,
      pop: c?.pop ?? null, // may be absent on "current"
    };

    // Worker provides forecast.list (3-hour blocks)
    const list = raw?.forecast?.list;
    const hourly = Array.isArray(raw?.hourly) ? raw.hourly : Array.isArray(list) ? list : [];

    // Derive daily from forecast.list if needed
    let daily = Array.isArray(raw?.daily) ? raw.daily : [];
    if (!daily.length && hourly.length) {
      const byDay = new Map();
      for (const h of hourly) {
        const dt = Number(h.dt);
        if (!Number.isFinite(dt)) continue;
        const key = new Date((dt + tz) * 1000).toISOString().slice(0, 10); // YYYY-MM-DD in tz-adjusted space

        const hMain = h.main || {};
        const hWx0 = Array.isArray(h.weather) ? h.weather[0] : null;

        const rec = byDay.get(key) || {
          dt,
          min: Infinity,
          max: -Infinity,
          pops: [],
          wxMain: hWx0?.main || "",
          wxIcon: hWx0?.icon || "",
        };

        const t = hMain?.temp ?? h.temp;
        if (Number.isFinite(t)) {
          rec.min = Math.min(rec.min, t);
          rec.max = Math.max(rec.max, t);
        }

        const pop = Number(h.pop);
        if (Number.isFinite(pop)) rec.pops.push(pop);

        // keep first icon/main for the day
        if (!rec.wxIcon && hWx0?.icon) rec.wxIcon = hWx0.icon;
        if (!rec.wxMain && hWx0?.main) rec.wxMain = hWx0.main;

        byDay.set(key, rec);
      }

      daily = Array.from(byDay.values())
        .sort((a, b) => a.dt - b.dt)
        .slice(0, 7)
        .map((d) => ({
          dt: d.dt,
          temp: { min: Number.isFinite(d.min) ? d.min : null, max: Number.isFinite(d.max) ? d.max : null },
          pop: d.pops.length ? d.pops.reduce((x, y) => x + y, 0) / d.pops.length : null,
          weather: [{ main: d.wxMain || "—", icon: d.wxIcon || "" }],
        }));
    }

    return { current, hourly, daily };
  }

  /* ---------- PLAYABILITY ---------- */
  function scoreSlot({ temp, wind, pop, isRainy }) {
    // Returns 0..10
    let score = 10;

    const w = Number(wind ?? 0);
    if (w > 10) score -= 3;
    else if (w > 7) score -= 2;
    else if (w > 5) score -= 1;

    const t = Number(temp);
    if (Number.isFinite(t)) {
      if (getUnits() === "metric") {
        if (t < 4 || t > 30) score -= 2;
        else if (t < 7 || t > 27) score -= 1;
      } else {
        if (t < 40 || t > 86) score -= 2;
        else if (t < 45 || t > 82) score -= 1;
      }
    }

    const p = Number(pop);
    if (Number.isFinite(p)) {
      if (p >= 0.7) score -= 3;
      else if (p >= 0.4) score -= 2;
      else if (p >= 0.2) score -= 1;
    }

    if (isRainy) score -= 2;

    return Math.max(0, Math.min(10, Math.round(score)));
  }

  function calculatePlayability(raw) {
    const n = normalizeWeather(raw);
    const c = n.current;
    const isRainy = (c.desc || "").toLowerCase().includes("rain");
    return scoreSlot({ temp: c.temp, wind: c.windSpeed, pop: c.pop, isRainy });
  }

  /* ---------- BEST TIME ---------- */
  function findBestTime(raw) {
    const n = normalizeWeather(raw);
    const tz = n.current.tz;

    const sunrise = n.current.sunrise;
    const sunset = n.current.sunset;
    if (!sunrise || !sunset) return null;

    // Use forecast list for best-time candidates
    const candidates = n.hourly
      .map((h) => {
        const dt = Number(h.dt);
        const hMain = h.main || {};
        const hWx0 = Array.isArray(h.weather) ? h.weather[0] : null;

        const temp = hMain.temp ?? h.temp ?? null;
        const wind = h.wind?.speed ?? h.wind_speed ?? null;
        const pop = h.pop ?? null;
        const isRainy = (hWx0?.main || "").toLowerCase().includes("rain");

        return {
          dt,
          temp,
          wind,
          pop,
          icon: hWx0?.icon || "",
          main: hWx0?.main || "",
          score: scoreSlot({ temp, wind, pop, isRainy }),
        };
      })
      .filter((x) => Number.isFinite(x.dt))
      .filter((x) => x.dt >= sunrise && x.dt <= sunset); // daylight-only

    if (!candidates.length) return null;

    // Highest score; tie-breaker lower pop, lower wind
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ap = Number.isFinite(a.pop) ? a.pop : 1;
      const bp = Number.isFinite(b.pop) ? b.pop : 1;
      if (ap !== bp) return ap - bp;
      const aw = Number.isFinite(a.wind) ? a.wind : 999;
      const bw = Number.isFinite(b.wind) ? b.wind : 999;
      return aw - bw;
    });

    const best = candidates[0];
    return {
      time: fmtTime(best.dt, tz),
      score: best.score,
      main: best.main,
      icon: best.icon,
    };
  }

  /* ---------- RENDER: COURSE LIST ---------- */
  function renderCourseResults(courses, opts = {}) {
    const title = opts.title || "Select a course";
    const subtitle = opts.subtitle || "";

    if (!courses.length) {
      resultsEl.innerHTML = `<div class="ff-card muted">No courses found. Try a different search.</div>`;
      return;
    }

    const items = courses.slice(0, 20).map((c, idx) => {
      const name = esc(c.name || c.course_name || c.club_name || "Unknown");
      const city = esc(c.city || "");
      const country = esc(c.country || "");
      const sub = [city, country].filter(Boolean).join(", ");
      const dist = typeof c._distanceKm === "number" ? `${c._distanceKm.toFixed(1)} km` : "";

      return `
        <button class="ff-course" type="button" data-idx="${idx}">
          <div class="ff-course-name">${name}</div>
          <div class="ff-course-sub">${esc(sub || "Tap to view forecast")}</div>
          ${dist ? `<div class="ff-course-dist">${esc(dist)}</div>` : ""}
        </button>
      `;
    });

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">${esc(title)}</div>
        ${subtitle ? `<div class="ff-sub muted">${esc(subtitle)}</div>` : ""}
        <div class="ff-course-list">${items.join("")}</div>
      </div>
    `;

    resultsEl.querySelectorAll("[data-idx]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.getAttribute("data-idx"));
        const course = courses[i];
        if (!course) return;
        await selectCourse(course);
      });
    });
  }

  /* ---------- RENDER: CURRENT ---------- */
  function renderCurrent(raw) {
    lastWeatherRaw = raw;
    lastView = "current";

    const n = normalizeWeather(raw);
    const c = n.current;

    const tempStr =
      c.temp == null ? `--${unitTemp()}` : `${Math.round(c.temp)}${unitTemp()}`;

    const iconUrl = c.icon
      ? `https://openweathermap.org/img/wn/${c.icon}@2x.png`
      : "";

    const sunriseStr = c.sunrise ? fmtTime(c.sunrise, c.tz) : "—";
    const sunsetStr = c.sunset ? fmtTime(c.sunset, c.tz) : "—";

    const best = findBestTime(raw);
    const bestHtml = best
      ? `<div class="ff-metric"><span>Best time</span><b>${esc(best.time)} · ${best.score}/10</b></div>`
      : `<div class="ff-metric"><span>Best time</span><b>—</b></div>`;

    const windSpeed =
      c.windSpeed == null ? "—" : `${Math.round(c.windSpeed * 10) / 10} ${unitWind()}`;
    const gust =
      c.windGust == null ? "—" : `${Math.round(c.windGust * 10) / 10} ${unitWind()}`;

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-course-head">
          <div class="ff-course-title">${esc(selectedCourse?.name || selectedCourse?.course_name || selectedCourse?.club_name || "")}</div>
          <div class="ff-course-sub muted">${esc([selectedCourse?.city, selectedCourse?.country].filter(Boolean).join(", "))}</div>
        </div>

        <div class="ff-row">
          ${iconUrl ? `<img class="ff-icon" alt="" src="${iconUrl}" />` : ""}
          <div>
            <div class="ff-big">${tempStr}</div>
            <div class="ff-sub">${esc(c.desc || "—")}</div>
          </div>
        </div>

        <div class="ff-metrics">
          <div class="ff-metric"><span>Wind</span><b>${esc(windSpeed)}</b></div>
          <div class="ff-metric"><span>Gust</span><b>${esc(gust)}</b></div>
          <div class="ff-metric"><span>Sunrise</span><b>${esc(sunriseStr)}</b></div>
          <div class="ff-metric"><span>Sunset</span><b>${esc(sunsetStr)}</b></div>
          ${bestHtml}
        </div>
      </div>
    `;

    if (playabilityScoreEl) {
      playabilityScoreEl.textContent = `${calculatePlayability(raw)}/10`;
    }
  }

  /* ---------- RENDER: HOURLY ---------- */
  function renderHourly(raw) {
    lastWeatherRaw = raw;
    lastView = "hourly";

    const n = normalizeWeather(raw);
    const tz = n.current.tz;

    if (!n.hourly.length) {
      showMessage("Hourly forecast not available.");
      return;
    }

    // Next 24 hours in 3-hour blocks => 8 slots
    const slots = n.hourly.slice(0, 8).map((h) => {
      const dt = Number(h.dt);
      const time = Number.isFinite(dt) ? fmtTime(dt, tz) : "—";
      const hMain = h.main || {};
      const wx0 = Array.isArray(h.weather) ? h.weather[0] : null;

      const temp = hMain.temp ?? h.temp ?? null;
      const tempStr = temp == null ? `--${unitTemp()}` : `${Math.round(temp)}${unitTemp()}`;

      const pop = Number(h.pop);
      const popStr = Number.isFinite(pop) ? `${Math.round(pop * 100)}%` : "—";

      const wind = h.wind?.speed ?? h.wind_speed ?? null;
      const windStr = wind == null ? "—" : `${Math.round(wind * 10) / 10} ${unitWind()}`;

      const icon = wx0?.icon ? `https://openweathermap.org/img/wn/${wx0.icon}@2x.png` : "";

      return { time, tempStr, popStr, windStr, icon };
    });

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Hourly · Next 24 hours (3-hour blocks)</div>
        <div class="ff-hourly">
          ${slots
            .map(
              (s) => `
              <div class="ff-hour">
                <div class="ff-hour-time">${esc(s.time)}</div>
                ${s.icon ? `<img src="${s.icon}" alt="" />` : ""}
                <div class="ff-hour-temp">${esc(s.tempStr)}</div>
                <div class="ff-hour-meta">${esc(s.popStr)} · ${esc(s.windStr)}</div>
              </div>
            `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  /* ---------- RENDER: DAILY ---------- */
  function renderDaily(raw) {
    lastWeatherRaw = raw;
    lastView = "daily";

    const n = normalizeWeather(raw);
    const tz = n.current.tz;

    if (!n.daily.length) {
      showMessage("Daily forecast not available.");
      return;
    }

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Daily · Up to 7 days (derived from forecast)</div>
        <div class="ff-daily">
          ${n.daily
            .slice(0, 7)
            .map((d) => {
              const date = fmtDay(d.dt, tz);
              const wx0 = Array.isArray(d.weather) ? d.weather[0] : null;
              const icon = wx0?.icon ? `https://openweathermap.org/img/wn/${wx0.icon}@2x.png` : "";
              const main = wx0?.main || "—";

              const max = d?.temp?.max;
              const min = d?.temp?.min;
              const tStr =
                max == null || min == null
                  ? `--${unitTemp()} / --${unitTemp()}`
                  : `${Math.round(max)}${unitTemp()} ${Math.round(min)}${unitTemp()}`;

              const pop = Number(d.pop);
              const popStr = Number.isFinite(pop) ? `${Math.round(pop * 100)}%` : "—";

              return `
                <div class="ff-day">
                  <div class="ff-day-date">${esc(date)}</div>
                  ${icon ? `<img src="${icon}" alt="" />` : ""}
                  <div class="ff-day-desc">${esc(main)} · ${esc(popStr)}</div>
                  <div class="ff-day-temp">${esc(tStr)}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  /* ---------- SELECT COURSE ---------- */
  async function selectCourse(course) {
    selectedCourse = course;

    const lat = Number(course.lat ?? course.latitude ?? course.location?.lat ?? course.location?.latitude);
    const lon = Number(course.lon ?? course.lng ?? course.longitude ?? course.location?.lon ?? course.location?.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showMessage("This course has no coordinates. Try a different result.");
      return;
    }

    showMessage("Loading weather…");
    try {
      const raw = await fetchWeather(lat, lon);
      setActiveTab(tabCurrent);
      renderCurrent(raw);
    } catch (err) {
      console.error(err);
      showMessage(`Weather unavailable: ${err.message || "Error"}`);
    }
  }

  /* ---------- SEARCH ---------- */
  async function handleSearch() {
    const q = (searchInput?.value || "").trim();
    if (!q) {
      showMessage("Type a town/city or course name to search.");
      return;
    }

    showMessage("Searching courses…");
    try {
      const courses = await fetchCourses(q);
      renderCourseResults(courses, { title: "Search results" });
    } catch (err) {
      console.error(err);
      showMessage(`Search failed: ${err.message || "Error"}`);
    }
  }

  /* ---------- NEAR ME (OPTIONAL) ---------- */
  async function handleNearMe() {
    if (!("geolocation" in navigator)) {
      showMessage("Geolocation isn’t available on this device/browser.");
      return;
    }

    showMessage("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        lastUserPos = { lat, lon };

        // We need a query string to pull nearby courses from your courses API,
        // so we use weather to get the nearest city name (provided by your worker).
        try {
          showMessage("Finding nearby area…");
          const raw = await fetchWeather(lat, lon);
          const city = raw?.current?.name || raw?.name || "";
          const country = raw?.current?.sys?.country || "";

          if (!city) {
            showMessage("Couldn’t detect your nearest town. Try searching by course name.");
            return;
          }

          showMessage(`Searching courses near ${city}…`);
          const courses = await fetchCourses(`${city}${country ? ` ${country}` : ""}`);

          const radiusKm = NEAR_ME_RADIUS_MILES * MILES_TO_KM;

          const filtered = courses
            .map((c) => {
              const cLat = Number(c.lat ?? c.location?.latitude ?? c.location?.lat);
              const cLon = Number(c.lon ?? c.location?.longitude ?? c.location?.lon);
              if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return null;
              const dKm = haversineKm(lat, lon, cLat, cLon);
              return { ...c, _distanceKm: dKm };
            })
            .filter(Boolean)
            .filter((c) => c._distanceKm <= radiusKm)
            .sort((a, b) => a._distanceKm - b._distanceKm);

          renderCourseResults(filtered, {
            title: `Courses within ${NEAR_ME_RADIUS_MILES} miles`,
            subtitle: `Near ${city}${country ? `, ${country}` : ""}`,
          });
        } catch (err) {
          console.error(err);
          showMessage("Could not load nearby courses. Try searching by name instead.");
        }
      },
      (err) => {
        console.error(err);
        showMessage("Location permission denied. You can still search by course name.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  /* ---------- TAB EVENTS ---------- */
  tabCurrent?.addEventListener("click", () => {
    if (!lastWeatherRaw) return;
    setActiveTab(tabCurrent);
    renderCurrent(lastWeatherRaw);
  });

  tabHourly?.addEventListener("click", () => {
    if (!lastWeatherRaw) return;
    setActiveTab(tabHourly);
    renderHourly(lastWeatherRaw);
  });

  tabDaily?.addEventListener("click", () => {
    if (!lastWeatherRaw) return;
    setActiveTab(tabDaily);
    renderDaily(lastWeatherRaw);
  });

  /* ---------- SEARCH EVENTS (THIS FIXES YOUR ISSUE) ---------- */
  searchBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    handleSearch();
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  });

  /* ---------- GEO BUTTON (OPTIONAL) ---------- */
  geoBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    handleNearMe();
  });

  /* ---------- UNITS CHANGE ---------- */
  unitsSelect?.addEventListener("change", async () => {
    // If a course is selected, re-fetch weather for that course when units change
    if (!selectedCourse) return;
    await selectCourse(selectedCourse);

    // Restore last tab after refetch
    if (lastView === "hourly") {
      setActiveTab(tabHourly);
      renderHourly(lastWeatherRaw);
    } else if (lastView === "daily") {
      setActiveTab(tabDaily);
      renderDaily(lastWeatherRaw);
    } else {
      setActiveTab(tabCurrent);
      renderCurrent(lastWeatherRaw);
    }
  });

  /* ---------- INIT ---------- */
  showMessage("Search for a town/city or golf course — or use ⌖ to find courses near you.");
})();
