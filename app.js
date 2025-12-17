/* =====================================================
   Fairway Forecast – app.js
   - Uses Cloudflare Worker:
       GET /courses?search=
       GET /weather?lat=&lon=&units=
   - Mobile-first rendering: Current / Hourly / Daily
   ===================================================== */

(() => {
  "use strict";

  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const MILES_TO_KM = 1.609344;
  const NEAR_ME_RADIUS_MI = 10;
  const NEAR_ME_RADIUS_KM = NEAR_ME_RADIUS_MI * MILES_TO_KM;

  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const geoBtn = $("btnGeo") || $("geoBtn");
  const unitsSelect = $("unitsSelect") || $("units") || $("unitSelect");

  let selectedCourse = null;
  let lastWeather = null;
  let activeView = "current";
  let suggestTimer = null;
  let suggestionBox = null;

  /* ---------- helpers ---------- */
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
    const raw = (unitsSelect?.value || "metric").toLowerCase();
    return raw.includes("imper") ? "imperial" : "metric";
  }

  function unitLabels() {
    const u = getUnits();
    return {
      temp: u === "imperial" ? "°F" : "°C",
      speed: u === "imperial" ? "mph" : "m/s",
      dist: u === "imperial" ? "mi" : "km",
    };
  }

  function setActiveTab(tab) {
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    tab?.classList.add("active");
  }

  function fmtTime(tsSeconds, tzOffsetSeconds) {
    const ms = (tsSeconds + (tzOffsetSeconds || 0)) * 1000;
    const d = new Date(ms);
    // We built an offset-adjusted "UTC time", so use UTC getters:
    const hh = d.getUTCHours().toString().padStart(2, "0");
    const mm = d.getUTCMinutes().toString().padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function fmtDay(tsSeconds, tzOffsetSeconds) {
    const ms = (tsSeconds + (tzOffsetSeconds || 0)) * 1000;
    const d = new Date(ms);
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return days[d.getUTCDay()];
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ---------- API ---------- */
  async function fetchJson(url) {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
    }
    return data;
  }

  async function fetchCourses(search) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(search)}`;
    const data = await fetchJson(url);
    return Array.isArray(data?.courses) ? data.courses : [];
  }

  async function fetchWeather(lat, lon) {
    const units = getUnits();
    const url = `${API_BASE}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${encodeURIComponent(units)}`;
    return await fetchJson(url);
  }

  /* ---------- playability ---------- */
  function calculatePlayability(data) {
    const c = data?.current;
    if (!c) return "--";
    let score = 10;

    const wind = Number(c.wind?.speed ?? 0);
    const temp = Number(c.temp ?? 10);
    const popNow = Number((c.pop ?? c.rain?.["1h"] ?? 0)); // sometimes not present in current

    const wMain = (c.weather?.[0]?.main || "").toLowerCase();
    const rainish =
      wMain.includes("rain") || wMain.includes("drizzle") || wMain.includes("thunderstorm");

    if (wind > 10) score -= 3;
    else if (wind > 7) score -= 2;
    else if (wind > 5) score -= 1;

    if (getUnits() === "metric") {
      if (temp < 4 || temp > 30) score -= 2;
      else if (temp < 7 || temp > 27) score -= 1;
    } else {
      if (temp < 40 || temp > 86) score -= 2;
      else if (temp < 45 || temp > 82) score -= 1;
    }

    if (rainish) score -= 2;
    if (popNow >= 0.5) score -= 1;

    return clamp(Math.round(score), 0, 10);
  }

  /* ---------- render: header + current/hourly/daily ---------- */
  function renderShell(title, subtitle) {
    // One container, we swap the inner view
    return `
      <div class="ff-card">
        <div class="ff-title">${esc(title || "Forecast")}</div>
        ${subtitle ? `<div class="ff-sub muted">${esc(subtitle)}</div>` : ""}
        <div class="ff-divider"></div>
        <div id="ffView"></div>
      </div>
    `;
  }

  function renderCurrentView(data) {
    const c = data.current || {};
    const tz = data.timezone_offset || 0;
    const labels = unitLabels();

    const icon = c.weather?.[0]?.icon
      ? `https://openweathermap.org/img/wn/${c.weather[0].icon}@2x.png`
      : "";

    const temp = (c.temp != null) ? Math.round(c.temp) : null;
    const feels = (c.feels_like != null) ? Math.round(c.feels_like) : null;
    const desc = c.weather?.[0]?.description || "—";
    const wind = (c.wind?.speed != null) ? c.wind.speed : null;
    const humidity = (c.humidity != null) ? c.humidity : null;

    // Rain probability: OpenWeather OneCall has pop in hourly/daily; for current it's often absent.
    const pop = data.hourly?.[0]?.pop;
    const rainPct = (typeof pop === "number") ? Math.round(pop * 100) : null;

    return `
      <div class="ff-row">
        ${icon ? `<img class="ff-icon" alt="" src="${icon}">` : ""}
        <div class="ff-stack">
          <div class="ff-big">${temp != null ? `${temp}${labels.temp}` : "—"}</div>
          <div class="ff-sub">${esc(desc)}</div>
          <div class="ff-sub muted">Updated ${esc(fmtTime(c.dt || (Date.now()/1000), tz))}</div>
        </div>
      </div>

      <div class="ff-metrics">
        <div class="ff-metric">
          <div class="ff-metric-k">Feels like</div>
          <div class="ff-metric-v">${feels != null ? `${feels}${labels.temp}` : "—"}</div>
        </div>
        <div class="ff-metric">
          <div class="ff-metric-k">Wind</div>
          <div class="ff-metric-v">${wind != null ? `${Number(wind).toFixed(1)} ${labels.speed}` : "—"}</div>
        </div>
        <div class="ff-metric">
          <div class="ff-metric-k">Rain</div>
          <div class="ff-metric-v">${rainPct != null ? `${rainPct}%` : "—"}</div>
        </div>
        <div class="ff-metric">
          <div class="ff-metric-k">Humidity</div>
          <div class="ff-metric-v">${humidity != null ? `${humidity}%` : "—"}</div>
        </div>
      </div>
    `;
  }

  function renderHourlyView(data) {
    const tz = data.timezone_offset || 0;
    const labels = unitLabels();
    const hours = Array.isArray(data.hourly) ? data.hourly.slice(0, 12) : [];

    if (!hours.length) {
      return `<div class="muted">Hourly data not available.</div>`;
    }

    const cards = hours.map((h) => {
      const t = fmtTime(h.dt, tz);
      const temp = (h.temp != null) ? Math.round(h.temp) : "—";
      const pop = (typeof h.pop === "number") ? Math.round(h.pop * 100) : 0;
      const icon = h.weather?.[0]?.icon
        ? `https://openweathermap.org/img/wn/${h.weather[0].icon}.png`
        : "";
      return `
        <div class="ff-hour">
          <div class="ff-hour-t">${esc(t)}</div>
          ${icon ? `<img class="ff-hour-i" alt="" src="${icon}">` : ""}
          <div class="ff-hour-temp">${temp}${labels.temp}</div>
          <div class="ff-hour-pop">${pop}%</div>
        </div>
      `;
    });

    return `
      <div class="ff-sub muted">Next 12 hours</div>
      <div class="ff-hourly-strip">
        ${cards.join("")}
      </div>
    `;
  }

  function renderDailyView(data) {
    const tz = data.timezone_offset || 0;
    const labels = unitLabels();
    const days = Array.isArray(data.daily) ? data.daily.slice(0, 7) : [];

    if (!days.length) {
      return `<div class="muted">Daily data not available.</div>`;
    }

    const rows = days.map((d) => {
      const day = fmtDay(d.dt, tz);
      const icon = d.weather?.[0]?.icon
        ? `https://openweathermap.org/img/wn/${d.weather[0].icon}.png`
        : "";
      const max = (d.temp?.max != null) ? Math.round(d.temp.max) : "—";
      const min = (d.temp?.min != null) ? Math.round(d.temp.min) : "—";
      const pop = (typeof d.pop === "number") ? Math.round(d.pop * 100) : 0;

      return `
        <div class="ff-day">
          <div class="ff-day-l">
            <div class="ff-day-name">${esc(day)}</div>
            <div class="ff-day-sub muted">${pop}% rain</div>
          </div>
          ${icon ? `<img class="ff-day-i" alt="" src="${icon}">` : ""}
          <div class="ff-day-r">
            <span class="ff-day-max">${max}${labels.temp}</span>
            <span class="ff-day-min muted">${min}${labels.temp}</span>
          </div>
        </div>
      `;
    });

    return `
      <div class="ff-sub muted">Next 7 days</div>
      <div class="ff-daily-list">
        ${rows.join("")}
      </div>
    `;
  }

  function renderWeather(view) {
    if (!resultsEl || !lastWeather) return;

    const title =
      selectedCourse?.name ||
      selectedCourse?.course_name ||
      selectedCourse?.club_name ||
      lastWeather?.current?.name ||
      "Forecast";

    const subtitleParts = [];
    const city = selectedCourse?.city || "";
    const country = selectedCourse?.country || selectedCourse?.location?.country || "";
    if (city) subtitleParts.push(city);
    if (country) subtitleParts.push(country);

    resultsEl.innerHTML = renderShell(title, subtitleParts.join(", "));
    const viewEl = $("ffView");
    if (!viewEl) return;

    if (view === "hourly") viewEl.innerHTML = renderHourlyView(lastWeather);
    else if (view === "daily") viewEl.innerHTML = renderDailyView(lastWeather);
    else viewEl.innerHTML = renderCurrentView(lastWeather);

    const score = calculatePlayability(lastWeather);
    if (playabilityScoreEl) playabilityScoreEl.textContent = `${score}/10`;
  }

  /* ---------- render: course results (tap to select) ---------- */
  function renderCourseResults(courses, opts = {}) {
    if (!resultsEl) return;

    if (!courses.length) {
      resultsEl.innerHTML = `<div class="ff-card muted">No courses found. Try a different search.</div>`;
      return;
    }

    const title = opts.title || "Select a course";
    const subtitle = opts.subtitle || "Tap a result to view forecast";

    const items = courses.slice(0, 25).map((c, idx) => {
      const name = esc(c.name || c.course_name || c.club_name || "Unknown");
      const city = esc(c.city || "");
      const country = esc(c.country || c.location?.country || "");
      const sub = [city, country].filter(Boolean).join(", ");

      const distTxt =
        typeof c._distanceKm === "number"
          ? `${(c._distanceKm / MILES_TO_KM).toFixed(1)} mi`
          : "";

      return `
        <button class="ff-course" type="button" data-idx="${idx}">
          <div class="ff-course-name">${name}</div>
          <div class="ff-course-sub">${esc(sub || "—")}</div>
          ${distTxt ? `<div class="ff-course-dist">${esc(distTxt)}</div>` : ""}
        </button>
      `;
    });

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-title">${esc(title)}</div>
        <div class="ff-sub muted">${esc(subtitle)}</div>
        <div class="ff-divider"></div>
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

  async function selectCourse(course) {
    selectedCourse = course;

    const lat = Number(course.lat ?? course.latitude ?? course.location?.lat);
    const lon = Number(course.lon ?? course.lng ?? course.longitude ?? course.location?.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showMessage("This course has no coordinates. Try a different result.");
      return;
    }

    showMessage("Loading forecast…");

    try {
      lastWeather = await fetchWeather(lat, lon);
      activeView = "current";
      setActiveTab(tabCurrent);
      renderWeather("current");
    } catch (err) {
      console.error(err);
      showMessage(`Weather unavailable: ${err.message}`);
    }
  }

  /* ---------- search + suggestions ---------- */
  function ensureSuggestionBox() {
    if (suggestionBox) return suggestionBox;
    if (!searchInput) return null;

    suggestionBox = document.createElement("div");
    suggestionBox.className = "ff-suggest";
    suggestionBox.style.display = "none";

    // insert after the input
    searchInput.parentElement?.appendChild(suggestionBox);

    // close when clicking elsewhere
    document.addEventListener("click", (e) => {
      if (!suggestionBox) return;
      if (e.target === searchInput) return;
      if (suggestionBox.contains(e.target)) return;
      suggestionBox.style.display = "none";
    });

    return suggestionBox;
  }

  async function showSuggestions(q) {
    const box = ensureSuggestionBox();
    if (!box) return;

    if (!q || q.length < 2) {
      box.style.display = "none";
      box.innerHTML = "";
      return;
    }

    try {
      const courses = await fetchCourses(q);
      const top = courses.slice(0, 6);

      if (!top.length) {
        box.style.display = "none";
        box.innerHTML = "";
        return;
      }

      box.innerHTML = top
        .map((c) => {
          const name = esc(c.name || c.course_name || c.club_name || "Unknown");
          const city = esc(c.city || "");
          const country = esc(c.country || "");
          const sub = [city, country].filter(Boolean).join(", ");
          return `<button type="button" class="ff-suggest-item" data-payload='${esc(JSON.stringify(c))}'>
              <div class="ff-suggest-name">${name}</div>
              <div class="ff-suggest-sub">${esc(sub)}</div>
            </button>`;
        })
        .join("");

      box.style.display = "block";

      box.querySelectorAll(".ff-suggest-item").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const payload = btn.getAttribute("data-payload");
          if (!payload) return;
          let course;
          try { course = JSON.parse(payload); } catch { course = null; }
          box.style.display = "none";
          if (!course) return;
          if (searchInput) searchInput.value = course.name || course.course_name || "";
          await selectCourse(course);
        });
      });
    } catch (e) {
      // ignore suggestion failures
      box.style.display = "none";
      box.innerHTML = "";
    }
  }

  async function handleSearch() {
    const q = searchInput?.value?.trim() || "";
    if (!q) {
      showMessage("Type a town or course name to search.");
      return;
    }
    showMessage("Searching courses…");
    try {
      const courses = await fetchCourses(q);
      renderCourseResults(courses);
    } catch (err) {
      console.error(err);
      showMessage(`Course search failed: ${err.message}`);
    }
  }

  /* ---------- near me: 10 mile radius ---------- */
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

        showMessage("Finding courses near you…");

        try {
          // Use weather reverse-ish to get a nearby place name (cheap + already allowed)
          const w = await fetchWeather(lat, lon);
          const city = w?.current?.name || "";
          const country = w?.current?.sys?.country || "";

          // Fallback query
          const query = city ? `${city}${country ? ` ${country}` : ""}` : "golf";

          const courses = await fetchCourses(query);

          const within = courses
            .map((c) => {
              const cLat = Number(c.lat ?? c.location?.latitude ?? c.location?.lat);
              const cLon = Number(c.lon ?? c.location?.longitude ?? c.location?.lon);
              if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return null;
              const dKm = haversineKm(lat, lon, cLat, cLon);
              return { ...c, _distanceKm: dKm };
            })
            .filter(Boolean)
            .filter((c) => c._distanceKm <= NEAR_ME_RADIUS_KM)
            .sort((a, b) => a._distanceKm - b._distanceKm);

          renderCourseResults(within, {
            title: `Courses within ${NEAR_ME_RADIUS_MI} miles`,
            subtitle: within.length
              ? "Nearest first — tap one to view forecast"
              : "None found in radius — try searching by name",
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

  /* ---------- tabs ---------- */
  function hookTabs() {
    tabCurrent?.addEventListener("click", () => {
      if (!lastWeather) return;
      activeView = "current";
      setActiveTab(tabCurrent);
      renderWeather("current");
    });

    tabHourly?.addEventListener("click", () => {
      if (!lastWeather) return;
      activeView = "hourly";
      setActiveTab(tabHourly);
      renderWeather("hourly");
    });

    tabDaily?.addEventListener("click", () => {
      if (!lastWeather) return;
      activeView = "daily";
      setActiveTab(tabDaily);
      renderWeather("daily");
    });
  }

  /* ---------- events ---------- */
  searchBtn?.addEventListener("click", handleSearch);
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });

  // suggestions while typing
  searchInput?.addEventListener("input", () => {
    const q = searchInput.value.trim();
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => showSuggestions(q), 220);
  });

  geoBtn?.addEventListener("click", handleCoursesNearMe);

  unitsSelect?.addEventListener("change", async () => {
    // If we already have a selected course, refetch and rerender current active tab
    if (!selectedCourse) return;
    await selectCourse(selectedCourse);
    renderWeather(activeView);
  });

  /* ---------- init ---------- */
  hookTabs();

  if (!searchInput || !searchBtn || !resultsEl) {
    console.warn("Missing expected DOM elements. App will run in reduced mode.");
  }

  showMessage("Search for a town or golf course — or tap ⌖ for courses near you.");
})();
