/* =====================================================
   Fairway Forecast – app.js
   Cloudflare Worker: /courses + /weather
   Crash-safe, mobile-first, GitHub Pages compatible
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";

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

  // Optional "use my location" button (recommended id)
  const geoBtn = $("btnGeo") || $("geoBtn");

  // Optional units selector
  const unitsSelect = $("unitsSelect") || $("units") || $("unitSelect");

  /* ---------- STATE ---------- */
  let selectedCourse = null;
  let lastWeather = null;
  let lastUserPos = null; // { lat, lon }

  /* ---------- UTIL ---------- */
  function setActiveTab(tab) {
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    tab?.classList.add("active");
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

  /* ---------- DISTANCE (for “near me”) ---------- */
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

  /* ---------- FETCH: COURSES ---------- */
  async function fetchCourses(search) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(search)}`;
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      const msg = data?.error || data?.message || `Course search failed (${res.status})`;
      throw new Error(msg);
    }

    return Array.isArray(data?.courses) ? data.courses : [];
  }

  /* ---------- FETCH: WEATHER ---------- */
  async function fetchWeather(lat, lon) {
    const units = getUnits();
    const url = `${API_BASE}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${encodeURIComponent(units)}`;

    const res = await fetch(url, { method: "GET" });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

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

    const wind = Number(c.wind?.speed ?? 0);
    const temp = Number(c.temp ?? 10);

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
      // imperial °F comfort
      if (temp < 40 || temp > 86) score -= 2;
      else if (temp < 45 || temp > 82) score -= 1;
    }

    if (rainish) score -= 3;

    // Whole number 0..10
    const whole = Math.max(0, Math.min(10, Math.round(score)));
    return whole;
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
      const dist = typeof c._distanceKm === "number" ? `${c._distanceKm.toFixed(1)} km` : "";
      const sub = [city, country].filter(Boolean).join(", ");
      const right = [dist].filter(Boolean).join("");

      return `
        <button class="ff-course" type="button" data-idx="${idx}">
          <div class="ff-course-name">${name}</div>
          <div class="ff-course-sub">${esc(sub || "Tap to view forecast")}</div>
          ${right ? `<div class="ff-course-dist">${esc(right)}</div>` : ""}
        </button>
      `;
    });

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">${esc(title)}</div>
        ${subtitle ? `<div class="ff-sub muted">${esc(subtitle)}</div>` : ""}
        <div class="ff-course-list">
          ${items.join("")}
        </div>
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
  function renderCurrent(data) {
    if (!resultsEl) return;

    const c = data.current || {};
    const icon = c.weather?.[0]?.icon
      ? `https://openweathermap.org/img/wn/${c.weather[0].icon}@2x.png`
      : "";

    const desc = esc(c.weather?.[0]?.description || "—");
    const temp = c.temp != null ? Math.round(c.temp) : "--";

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-row">
          ${icon ? `<img class="ff-icon" alt="" src="${icon}" />` : ""}
          <div>
            <div class="ff-big">${temp}°</div>
            <div class="ff-sub">${desc}</div>
          </div>
        </div>
      </div>
    `;

    const score = calculatePlayability(data);
    if (playabilityScoreEl) playabilityScoreEl.textContent = `${score}/10`;
  }

  /* ---------- SELECT COURSE ---------- */
  async function selectCourse(course) {
    selectedCourse = course;

    const lat = Number(course.lat ?? course.latitude ?? course.location?.lat);
    const lon = Number(course.lon ?? course.lng ?? course.longitude ?? course.location?.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showMessage("This course has no coordinates. Try a different result.");
      return;
    }

    showMessage("Loading weather…");

    try {
      const data = await fetchWeather(lat, lon);
      lastWeather = data;
      setActiveTab(tabCurrent);
      renderCurrent(data);
    } catch (err) {
      console.error(err);
      showMessage(`Weather unavailable: ${err.message}`);
    }
  }

  /* ---------- SEARCH (TEXT) ---------- */
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

  /* ---------- COURSES NEAR ME ---------- */
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
          // 1) Use Worker weather to derive nearest city name (no extra APIs needed)
          showMessage("Finding nearby town…");
          const w = await fetchWeather(lat, lon);
          const city = w?.current?.name || "";
          const country = w?.current?.sys?.country || "";

          // If OpenWeather didn’t return a name, just prompt user to type
          if (!city) {
            showMessage("Couldn’t detect your nearest town. Please type a course name.");
            return;
          }

          // 2) Search courses by that city name (then sort by distance)
          showMessage(`Searching courses near ${city}…`);
          const courses = await fetchCourses(`${city}${country ? ` ${country}` : ""}`);

          const withDistance = courses
            .map((c) => {
              const cLat = Number(c.lat ?? c.location?.latitude);
              const cLon = Number(c.lon ?? c.location?.longitude);
              if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return null;
              const d = haversineKm(lat, lon, cLat, cLon);
              return { ...c, _distanceKm: d };
            })
            .filter(Boolean)
            .sort((a, b) => a._distanceKm - b._distanceKm);

          renderCourseResults(withDistance, {
            title: "Courses near you",
            subtitle: `Nearest to ${city}${country ? `, ${country}` : ""}`,
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

  /* ---------- TABS (safe) ---------- */
  function hookTabs() {
    tabCurrent?.addEventListener("click", () => {
      if (!lastWeather) return;
      setActiveTab(tabCurrent);
      renderCurrent(lastWeather);
    });

    tabHourly?.addEventListener("click", () => {
      if (!lastWeather) return;
      setActiveTab(tabHourly);
      // Hourly rendering can be added when your hourly container exists
      showMessage("Hourly view coming next (UI hook needed).");
    });

    tabDaily?.addEventListener("click", () => {
      if (!lastWeather) return;
      setActiveTab(tabDaily);
      // Daily rendering can be added when your daily container exists
      showMessage("Daily view coming next (UI hook needed).");
    });
  }

  /* ---------- EVENTS ---------- */
  searchBtn?.addEventListener("click", handleSearch);
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });

  geoBtn?.addEventListener("click", handleCoursesNearMe);

  unitsSelect?.addEventListener("change", async () => {
    // Re-fetch weather for selected course if units change
    if (!selectedCourse) return;
    await selectCourse(selectedCourse);
  });

  /* ---------- INIT ---------- */
  hookTabs();

  // Never halt the app if some DOM is missing — just warn.
  if (!searchInput || !searchBtn || !resultsEl) {
    console.warn("Some expected DOM elements are missing. App will run in reduced mode.");
  }

  showMessage("Search for a town or golf course — or tap ⌖ for courses near you.");
})();
