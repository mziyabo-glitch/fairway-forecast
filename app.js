/* =====================================================
   Fairway Forecast – app.js
   Cloudflare Worker: /courses + /weather
   Typeahead suggestions + Hourly + Daily + Near-me radius
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const NEAR_ME_RADIUS_MILES = 10;

  /* ---------- DOM HELPERS ---------- */
  const $ = (id) => document.getElementById(id);

  /* ---------- ELEMENTS (optional = crash-safe) ---------- */
  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const geoBtn = $("btnGeo") || $("geoBtn");
  const unitsSelect = $("unitsSelect") || $("units") || $("unitSelect");

  /* ---------- STATE ---------- */
  let selectedCourse = null;
  let lastWeather = null;
  let lastUserPos = null; // { lat, lon }
  let activeTab = "current";

  // suggestions
  let suggestWrap = null;
  let suggestItems = [];
  let suggestIndex = -1;
  let suggestAbort = null;
  let suggestTimer = null;

  /* ---------- UTIL ---------- */
  function setActiveTab(tabName) {
    activeTab = tabName;
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    if (tabName === "current") tabCurrent?.classList.add("active");
    if (tabName === "hourly") tabHourly?.classList.add("active");
    if (tabName === "daily") tabDaily?.classList.add("active");
  }

  function esc(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showMessage(msg) {
    if (!resultsEl) return;
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  }

  function getUnits() {
    const u = (unitsSelect?.value || "metric").toLowerCase();
    return u === "imperial" ? "imperial" : "metric";
  }

  function mphFromMs(ms) {
    return ms * 2.236936;
  }

  function milesFromKm(km) {
    return km * 0.621371;
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function toLocalTimeLabel(dtSeconds, tzOffsetSeconds = 0) {
    // dtSeconds is UTC seconds. Apply offset for location.
    const d = new Date((dtSeconds + tzOffsetSeconds) * 1000);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    return `${hh}:00`;
  }

  function toLocalDayKey(dtSeconds, tzOffsetSeconds = 0) {
    const d = new Date((dtSeconds + tzOffsetSeconds) * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function toPrettyDay(dtSeconds, tzOffsetSeconds = 0) {
    const d = new Date((dtSeconds + tzOffsetSeconds) * 1000);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  }

  /* ---------- FETCH: COURSES ---------- */
  async function fetchCourses(search) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(search)}`;
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = data?.error || data?.message || `Course search failed (${res.status})`;
      throw new Error(msg);
    }

    return Array.isArray(data?.courses) ? data.courses : [];
  }

  /* ---------- FETCH: WEATHER ---------- */
  async function fetchWeather(lat, lon) {
    const units = getUnits();
    const url =
      `${API_BASE}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${encodeURIComponent(units)}`;

    const res = await fetch(url, { method: "GET" });
    const text = await res.text();

    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = data?.error || data?.message || `Weather failed (${res.status})`;
      throw new Error(msg);
    }

    return data;
  }

  /* ---------- PLAYABILITY ---------- */
  function calculatePlayability(data) {
    const c = data?.current;
    if (!c) return "--";

    let score = 10;

    const windMs = Number(c.wind?.speed ?? 0);
    const temp = Number(c.temp ?? 10);

    const wMain = (c.weather?.[0]?.main || "").toLowerCase();
    const rainish = wMain.includes("rain") || wMain.includes("drizzle") || wMain.includes("thunder");

    // wind penalties
    if (windMs > 10) score -= 3;
    else if (windMs > 7) score -= 2;
    else if (windMs > 5) score -= 1;

    // temp comfort
    if (getUnits() === "metric") {
      if (temp < 4 || temp > 30) score -= 2;
      else if (temp < 7 || temp > 27) score -= 1;
    } else {
      if (temp < 40 || temp > 86) score -= 2;
      else if (temp < 45 || temp > 82) score -= 1;
    }

    if (rainish) score -= 3;

    return Math.max(0, Math.min(10, Math.round(score)));
  }

  /* ---------- NORMALIZE COURSE COORDS ---------- */
  function getCourseLatLon(course) {
    const lat = Number(
      course?.lat ??
      course?.latitude ??
      course?.location?.lat ??
      course?.location?.latitude
    );
    const lon = Number(
      course?.lon ??
      course?.lng ??
      course?.longitude ??
      course?.location?.lon ??
      course?.location?.longitude
    );
    return { lat, lon };
  }

  /* ---------- RENDER: CURRENT ---------- */
  function renderCurrent(data) {
    if (!resultsEl) return;

    const c = data?.current || {};
    const tz = Number(data?.timezone_offset ?? 0);

    const icon = c.weather?.[0]?.icon
      ? `https://openweathermap.org/img/wn/${c.weather[0].icon}@2x.png`
      : "";

    const desc = esc(c.weather?.[0]?.description || "—");
    const temp = c.temp != null ? Math.round(c.temp) : "--";
    const name = esc(c.name || selectedCourse?.name || selectedCourse?.course_name || selectedCourse?.club_name || "");
    const country = esc(c.sys?.country || selectedCourse?.country || "");

    const windMs = Number(c.wind?.speed ?? 0);
    const wind = getUnits() === "imperial" ? `${Math.round(mphFromMs(windMs))} mph` : `${Math.round(windMs)} m/s`;
    const feels = c.feels_like != null ? Math.round(c.feels_like) : null;

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-row" style="align-items:center;">
          ${icon ? `<img class="ff-icon" alt="" src="${icon}" />` : ""}
          <div>
            <div class="ff-big">${temp}°</div>
            <div class="ff-sub">${desc}</div>
            ${name ? `<div class="ff-sub muted">${name}${country ? `, ${country}` : ""}</div>` : ""}
          </div>
        </div>

        <div class="ff-metrics">
          ${feels != null ? `<div class="ff-metric"><span class="k">Feels</span><span class="v">${feels}°</span></div>` : ""}
          <div class="ff-metric"><span class="k">Wind</span><span class="v">${esc(wind)}</span></div>
          ${c.humidity != null ? `<div class="ff-metric"><span class="k">Humidity</span><span class="v">${esc(c.humidity)}%</span></div>` : ""}
        </div>
      </div>
    `;

    const score = calculatePlayability(data);
    if (playabilityScoreEl) playabilityScoreEl.textContent = `${score}/10`;
  }

  /* ---------- RENDER: HOURLY ---------- */
  function renderHourly(data) {
    if (!resultsEl) return;

    // Worker may return:
    // - data.forecast.list[] (3-hour steps)
    // - or data.hourly[] (onecall)
    const tz = Number(data?.timezone_offset ?? 0);

    const list =
      Array.isArray(data?.hourly) ? data.hourly :
      Array.isArray(data?.forecast?.list) ? data.forecast.list :
      [];

    if (!list.length) {
      resultsEl.innerHTML = `<div class="ff-card muted">No hourly data available for this location.</div>`;
      return;
    }

    const take = list.slice(0, 12); // ~ next 12 periods (good mobile length)

    const cards = take.map((h) => {
      const dt = Number(h.dt ?? 0);
      const label = dt ? toLocalTimeLabel(dt, tz) : esc(h.dt_txt || "");
      const main = h.main || {};
      const temp = main.temp != null ? Math.round(main.temp) : (h.temp != null ? Math.round(h.temp) : "--");
      const iconCode = h.weather?.[0]?.icon || "";
      const icon = iconCode ? `https://openweathermap.org/img/wn/${iconCode}.png` : "";
      const pop = h.pop != null ? Math.round(Number(h.pop) * 100) : null;
      const windMs = Number(h.wind?.speed ?? h.wind_speed ?? 0);
      const wind = getUnits() === "imperial" ? `${Math.round(mphFromMs(windMs))}mph` : `${Math.round(windMs)}m/s`;

      return `
        <div class="ff-hour">
          <div class="t">${esc(label)}</div>
          ${icon ? `<img class="i" alt="" src="${icon}">` : `<div class="i"></div>`}
          <div class="temp">${temp}°</div>
          <div class="meta">
            ${pop != null ? `<span>💧 ${pop}%</span>` : ``}
            <span>🌬️ ${esc(wind)}</span>
          </div>
        </div>
      `;
    }).join("");

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Next hours</div>
        <div class="ff-hourly-grid">
          ${cards}
        </div>
      </div>
    `;
  }

  /* ---------- RENDER: DAILY (UP TO 7 DAYS) ---------- */
  function renderDaily(data) {
    if (!resultsEl) return;

    const tz = Number(data?.timezone_offset ?? 0);

    // Prefer true daily if available
    if (Array.isArray(data?.daily) && data.daily.length) {
      const days = data.daily.slice(0, 7).map((d) => {
        const dayLabel = toPrettyDay(d.dt, tz);
        const min = d.temp?.min != null ? Math.round(d.temp.min) : "--";
        const max = d.temp?.max != null ? Math.round(d.temp.max) : "--";
        const iconCode = d.weather?.[0]?.icon || "";
        const icon = iconCode ? `https://openweathermap.org/img/wn/${iconCode}.png` : "";
        const pop = d.pop != null ? Math.round(Number(d.pop) * 100) : null;
        const windMs = Number(d.wind_speed ?? 0);
        const wind = getUnits() === "imperial" ? `${Math.round(mphFromMs(windMs))} mph` : `${Math.round(windMs)} m/s`;

        return `
          <div class="ff-day">
            <div class="d">${esc(dayLabel)}</div>
            ${icon ? `<img class="i" alt="" src="${icon}">` : `<div class="i"></div>`}
            <div class="temps"><span class="hi">${max}°</span><span class="lo">${min}°</span></div>
            <div class="meta">
              ${pop != null ? `<span>💧 ${pop}%</span>` : ``}
              <span>🌬️ ${esc(wind)}</span>
            </div>
          </div>
        `;
      }).join("");

      resultsEl.innerHTML = `
        <div class="ff-card">
          <div class="ff-sub muted">Next 7 days</div>
          <div class="ff-daily-list">${days}</div>
        </div>
      `;
      return;
    }

    // Otherwise aggregate forecast.list (3-hour steps)
    const list = Array.isArray(data?.forecast?.list) ? data.forecast.list : [];
    if (!list.length) {
      resultsEl.innerHTML = `<div class="ff-card muted">No daily data available for this location.</div>`;
      return;
    }

    const byDay = new Map();

    for (const h of list) {
      const dt = Number(h.dt ?? 0);
      if (!dt) continue;
      const key = toLocalDayKey(dt, tz);
      if (!byDay.has(key)) {
        byDay.set(key, {
          key,
          dt,
          min: Infinity,
          max: -Infinity,
          popMax: 0,
          windMaxMs: 0,
          icon: null,
          iconCount: {},
        });
      }
      const d = byDay.get(key);
      const temp = Number(h?.main?.temp ?? NaN);
      if (Number.isFinite(temp)) {
        d.min = Math.min(d.min, temp);
        d.max = Math.max(d.max, temp);
      }
      const pop = h.pop != null ? Number(h.pop) : 0;
      if (Number.isFinite(pop)) d.popMax = Math.max(d.popMax, pop);

      const windMs = Number(h.wind?.speed ?? 0);
      if (Number.isFinite(windMs)) d.windMaxMs = Math.max(d.windMaxMs, windMs);

      const icon = h.weather?.[0]?.icon;
      if (icon) {
        d.iconCount[icon] = (d.iconCount[icon] || 0) + 1;
      }
    }

    const days = Array.from(byDay.values())
      .sort((a, b) => a.dt - b.dt)
      .slice(0, 7)
      .map((d) => {
        // pick most frequent icon
        let bestIcon = null, bestCount = -1;
        for (const k in d.iconCount) {
          if (d.iconCount[k] > bestCount) { bestCount = d.iconCount[k]; bestIcon = k; }
        }
        const icon = bestIcon ? `https://openweathermap.org/img/wn/${bestIcon}.png` : "";
        const label = toPrettyDay(d.dt, tz);

        const min = d.min !== Infinity ? Math.round(d.min) : "--";
        const max = d.max !== -Infinity ? Math.round(d.max) : "--";
        const pop = Math.round(d.popMax * 100);
        const wind = getUnits() === "imperial"
          ? `${Math.round(mphFromMs(d.windMaxMs))} mph`
          : `${Math.round(d.windMaxMs)} m/s`;

        return `
          <div class="ff-day">
            <div class="d">${esc(label)}</div>
            ${icon ? `<img class="i" alt="" src="${icon}">` : `<div class="i"></div>`}
            <div class="temps"><span class="hi">${max}°</span><span class="lo">${min}°</span></div>
            <div class="meta">
              <span>💧 ${pop}%</span>
              <span>🌬️ ${esc(wind)}</span>
            </div>
          </div>
        `;
      }).join("");

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Next 7 days</div>
        <div class="ff-daily-list">${days}</div>
      </div>
    `;
  }

  /* ---------- COURSE PICK + WEATHER LOAD ---------- */
  async function selectCourse(course) {
    selectedCourse = course;

    const { lat, lon } = getCourseLatLon(course);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showMessage("This course has no coordinates. Try a different result.");
      return;
    }

    showMessage("Loading forecast…");

    try {
      const data = await fetchWeather(lat, lon);
      lastWeather = data;

      // render current by default
      setActiveTab("current");
      renderCurrent(data);
    } catch (err) {
      console.error(err);
      showMessage(`Weather unavailable: ${err.message}`);
    }
  }

  /* ---------- RENDER: COURSE LIST ---------- */
  function renderCourseResults(courses, opts = {}) {
    if (!resultsEl) return;

    const title = opts.title || "Select a course";
    const subtitle = opts.subtitle || "";

    if (!courses.length) {
      resultsEl.innerHTML = `<div class="ff-card muted">No courses found. Try a different search.</div>`;
      return;
    }

    const items = courses.slice(0, 20).map((c, idx) => {
      const name = esc(c.name || c.course_name || c.club_name || "Unknown");
      const country = esc(c.country || "");
      const city = esc(c.city || "");
      const dist = typeof c._distanceMi === "number" ? `${c._distanceMi.toFixed(1)} mi` : "";
      const sub = [city, country].filter(Boolean).join(", ");
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
        closeSuggestions();
        await selectCourse(course);
      });
    });
  }

  /* ---------- SEARCH (BUTTON/ENTER) ---------- */
  async function handleSearch() {
    const q = searchInput?.value?.trim() || "";
    if (!q) {
      showMessage("Type a town or course name to search.");
      return;
    }

    closeSuggestions();
    showMessage("Searching courses…");

    try {
      const courses = await fetchCourses(q);
      renderCourseResults(courses);
    } catch (err) {
      console.error(err);
      showMessage(`Course search failed: ${err.message}`);
    }
  }

  /* ---------- NEAR ME (10 MILE RADIUS) ---------- */
  async function handleCoursesNearMe() {
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

        try {
          // Use weather to get nearest city
          showMessage("Finding nearby area…");
          const w = await fetchWeather(lat, lon);
          const city = w?.current?.name || "";
          const country = w?.current?.sys?.country || "";

          if (!city) {
            showMessage("Couldn’t detect your nearest town. Please type a course name.");
            return;
          }

          showMessage(`Searching courses within ${NEAR_ME_RADIUS_MILES} miles…`);
          const courses = await fetchCourses(`${city}${country ? ` ${country}` : ""}`);

          const withDistance = courses
            .map((c) => {
              const coords = getCourseLatLon(c);
              if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return null;
              const km = haversineKm(lat, lon, coords.lat, coords.lon);
              const mi = milesFromKm(km);
              return { ...c, _distanceMi: mi };
            })
            .filter(Boolean)
            .filter((c) => c._distanceMi <= NEAR_ME_RADIUS_MILES)
            .sort((a, b) => a._distanceMi - b._distanceMi);

          if (!withDistance.length) {
            showMessage(`No courses found within ${NEAR_ME_RADIUS_MILES} miles. Try searching a nearby town/course name.`);
            return;
          }

          renderCourseResults(withDistance, {
            title: `Courses near you`,
            subtitle: `Within ${NEAR_ME_RADIUS_MILES} miles of ${city}${country ? `, ${country}` : ""}`,
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

  /* ---------- SUGGESTIONS UI (TYPEAHEAD) ---------- */
  function ensureSuggestUI() {
    if (!searchInput) return;
    if (suggestWrap) return;

    suggestWrap = document.createElement("div");
    suggestWrap.className = "ff-suggest";
    suggestWrap.style.display = "none";

    // insert directly after the input
    searchInput.insertAdjacentElement("afterend", suggestWrap);

    // click outside closes
    document.addEventListener("click", (e) => {
      if (!suggestWrap) return;
      if (e.target === searchInput) return;
      if (suggestWrap.contains(e.target)) return;
      closeSuggestions();
    });
  }

  function openSuggestions(items) {
    ensureSuggestUI();
    if (!sugg

