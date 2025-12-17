/* =====================================================
   Fairway Forecast – app.js
   Worker: /courses + /weather (OpenWeather + GolfCourseAPI)
   Mobile-first, crash-safe, GitHub Pages compatible
   ===================================================== */

(() => {
  "use strict";

  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const NEAR_ME_RADIUS_MILES = 10;

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

  const suggestionsEl = $("suggestions");

  let selectedCourse = null;
  let lastWeather = null;
  let lastCourses = [];
  let lastUserPos = null;

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function showMessage(msg) {
    if (!resultsEl) return;
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  }

  function setActiveTab(tab) {
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    tab?.classList.add("active");
  }

  function getUnits() {
    const v = (unitsSelect?.value || "metric").toLowerCase();
    return v === "imperial" ? "imperial" : "metric";
  }

  function unitTempSymbol() {
    return getUnits() === "imperial" ? "°F" : "°C";
  }

  function unitWindSymbol() {
    return getUnits() === "imperial" ? "mph" : "m/s";
  }

  function kmFromMiles(mi) {
    return mi * 1.609344;
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

  async function fetchCourses(search) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(search)}`;
    const res = await fetch(url);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) throw new Error(data?.error || data?.message || `Course search failed (${res.status})`);
    return Array.isArray(data?.courses) ? data.courses : [];
  }

  async function fetchWeather(lat, lon) {
    const units = getUnits();
    const url =
      `${API_BASE}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${encodeURIComponent(units)}`;

    const res = await fetch(url);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) throw new Error(data?.error || data?.message || `Weather failed (${res.status})`);
    return data;
  }

  function calculatePlayability(data) {
    const c = data?.current;
    if (!c) return "--";

    let score = 10;

    const wind = Number(c.wind?.speed ?? 0);
    const temp = Number(c.temp ?? 10);

    const list = getForecastList(data);
    const pop = Number(c.pop ?? list?.[0]?.pop ?? 0);

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
    if (pop >= 0.6) score -= 2;
    else if (pop >= 0.35) score -= 1;

    return Math.max(0, Math.min(10, Math.round(score)));
  }

  function getForecastList(data) {
    const list = data?.forecast?.list || data?.list || [];
    return Array.isArray(list) ? list : [];
  }

  function fmtTime(dtSeconds) {
    const d = new Date(dtSeconds * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDay(dtSeconds) {
    const d = new Date(dtSeconds * 1000);
    return d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" });
  }

  function weatherIcon(icon) {
    return icon ? `https://openweathermap.org/img/wn/${icon}@2x.png` : "";
  }

  function renderCourseHeader(course) {
    const name = esc(course?.name || course?.course_name || course?.club_name || "Selected course");
    const city = esc(course?.city || "");
    const state = esc(course?.state || "");
    const country = esc(course?.country || "");
    const line = [city, state, country].filter(Boolean).join(", ");

    return `
      <div class="ff-card">
        <div class="ff-title">${name}</div>
        ${line ? `<div class="ff-sub muted">${line}</div>` : ""}
      </div>
    `;
  }

  function renderCurrent(data) {
    if (!resultsEl) return;
    const c = data?.current || {};

    const icon = weatherIcon(c.weather?.[0]?.icon);
    const desc = esc(c.weather?.[0]?.description || "—");
    const temp = c.temp != null ? Math.round(c.temp) : "--";
    const feels = c.feels_like != null ? Math.round(c.feels_like) : null;

    const wind = c.wind?.speed != null ? Number(c.wind.speed) : null;
    const gust = c.wind?.gust != null ? Number(c.wind.gust) : null;
    const humidity = c.humidity != null ? Number(c.humidity) : null;

    const list = getForecastList(data);
    const pop = Number(c.pop ?? list?.[0]?.pop ?? 0);
    const popPct = Number.isFinite(pop) ? Math.round(pop * 100) : null;

    const header = selectedCourse ? renderCourseHeader(selectedCourse) : "";

    resultsEl.innerHTML = `
      ${header}
      <div class="ff-card">
        <div class="ff-row">
          ${icon ? `<img class="ff-icon" alt="" src="${icon}" />` : ""}
          <div style="min-width:0">
            <div class="ff-big">${temp}${unitTempSymbol()}</div>
            <div class="ff-sub">${desc}</div>
            ${feels != null ? `<div class="ff-sub muted">Feels like ${feels}${unitTempSymbol()}</div>` : ""}
          </div>
        </div>

        <div class="ff-metrics">
          ${wind != null ? `<div class="ff-metric"><span>Wind</span><b>${wind.toFixed(1)} ${unitWindSymbol()}</b></div>` : ""}
          ${gust != null ? `<div class="ff-metric"><span>Gust</span><b>${gust.toFixed(1)} ${unitWindSymbol()}</b></div>` : ""}
          ${humidity != null ? `<div class="ff-metric"><span>Humidity</span><b>${humidity}%</b></div>` : ""}
          ${popPct != null ? `<div class="ff-metric"><span>Rain chance</span><b>${popPct}%</b></div>` : ""}
        </div>
      </div>
    `;

    const score = calculatePlayability(data);
    if (playabilityScoreEl) playabilityScoreEl.textContent = `${score}/10`;
  }

  function renderHourly(data) {
    if (!resultsEl) return;

    const list = getForecastList(data);
    const header = selectedCourse ? renderCourseHeader(selectedCourse) : "";

    if (!list.length) {
      resultsEl.innerHTML = `${header}<div class="ff-card muted">Hourly data not available.</div>`;
      return;
    }

    const next = list.slice(0, 8);
    const cards = next
      .map((h) => {
        const t = fmtTime(h.dt);
        const temp = h.main?.temp != null ? Math.round(h.main.temp) : "--";
        const icon = weatherIcon(h.weather?.[0]?.icon);
        const pop = h.pop != null ? Math.round(Number(h.pop) * 100) : null;
        const wind = h.wind?.speed != null ? Number(h.wind.speed).toFixed(1) : null;

        return `
          <div class="ff-hour">
            <div class="ff-hour-top">
              <div class="ff-hour-time">${esc(t)}</div>
              ${icon ? `<img class="ff-hour-ico" alt="" src="${icon}" />` : ""}
            </div>
            <div class="ff-hour-temp">${temp}${unitTempSymbol()}</div>
            <div class="ff-hour-sub">
              ${pop != null ? `<span>${pop}%</span>` : `<span>&nbsp;</span>`}
              ${wind != null ? `<span>${wind} ${unitWindSymbol()}</span>` : `<span>&nbsp;</span>`}
            </div>
          </div>
        `;
      })
      .join("");

    resultsEl.innerHTML = `
      ${header}
      <div class="ff-card">
        <div class="ff-title">Hourly</div>
        <div class="ff-sub muted">Next 24 hours (3-hour blocks)</div>
        <div class="ff-hourly-strip">${cards}</div>
      </div>
    `;
  }

  function renderDaily(data) {
    if (!resultsEl) return;

    const list = getForecastList(data);
    const header = selectedCourse ? renderCourseHeader(selectedCourse) : "";

    if (!list.length) {
      resultsEl.innerHTML = `${header}<div class="ff-card muted">Daily data not available.</div>`;
      return;
    }

    const byDay = new Map();
    for (const item of list) {
      const d = new Date(item.dt * 1000);
      const key = d.toLocaleDateString([], { year: "numeric", month: "2-digit", day: "2-digit" });
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(item);
    }

    const days = Array.from(byDay.values()).slice(0, 7);

    const rows = days
      .map((items) => {
        const pick = items.reduce((best, cur) => {
          const hour = new Date(cur.dt * 1000).getHours();
          const score = Math.abs(13 - hour);
          const bestScore = best ? Math.abs(13 - new Date(best.dt * 1000).getHours()) : 999;
          return score < bestScore ? cur : best;
        }, null);

        const temps = items.map((x) => Number(x.main?.temp)).filter(Number.isFinite);
        const min = temps.length ? Math.round(Math.min(...temps)) : "--";
        const max = temps.length ? Math.round(Math.max(...temps)) : "--";

        const pops = items.map((x) => Number(x.pop)).filter(Number.isFinite);
        const pop = pops.length ? Math.round(Math.max(...pops) * 100) : null;

        const icon = weatherIcon(pick?.weather?.[0]?.icon);
        const desc = esc(pick?.weather?.[0]?.main || pick?.weather?.[0]?.description || "—");
        const dayLabel = fmtDay(items[0].dt);

        return `
          <div class="ff-day">
            <div class="ff-day-left">
              <div class="ff-day-name">${esc(dayLabel)}</div>
              <div class="ff-day-sub muted">${desc}${pop != null ? ` · ${pop}%` : ""}</div>
            </div>
            <div class="ff-day-right">
              ${icon ? `<img class="ff-day-ico" alt="" src="${icon}" />` : ""}
              <div class="ff-day-temps">
                <span class="hi">${max}${unitTempSymbol()}</span>
                <span class="lo">${min}${unitTempSymbol()}</span>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    resultsEl.innerHTML = `
      ${header}
      <div class="ff-card">
        <div class="ff-title">Daily</div>
        <div class="ff-sub muted">Up to 7 days (derived from forecast)</div>
        <div class="ff-daily-list">${rows}</div>
      </div>
    `;
  }

  function renderCourseResults(courses, opts = {}) {
    if (!resultsEl) return;

    const title = opts.title || "Select a course";
    const subtitle = opts.subtitle || "";

    if (!courses.length) {
      resultsEl.innerHTML = `<div class="ff-card muted">No courses found. Try a different search.</div>`;
      return;
    }

    lastCourses = courses.slice(0, 30);

    const items = lastCourses.map((c, idx) => {
      const name = esc(c.name || c.course_name || c.club_name || "Unknown");
      const country = esc(c.country || "");
      const city = esc(c.city || "");
      const sub = [city, country].filter(Boolean).join(", ");
      const dist =
        typeof c._distanceKm === "number"
          ? `${(c._distanceKm / 1.609344).toFixed(1)} mi`
          : "";

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
        const course = lastCourses[i];
        if (!course) return;
        await selectCourse(course);
      });
    });
  }

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
      const data = await fetchWeather(lat, lon);
      lastWeather = data;
      setActiveTab(tabCurrent);
      renderCurrent(data);
    } catch (err) {
      console.error(err);
      showMessage(`Weather unavailable: ${err.message}`);
    }
  }

  let suggestTimer = null;

  function hideSuggestions() {
    if (!suggestionsEl) return;
    suggestionsEl.style.display = "none";
    suggestionsEl.innerHTML = "";
  }

  function showSuggestions(items) {
    if (!suggestionsEl) return;
    if (!items.length) return hideSuggestions();

    const html = items
      .slice(0, 8)
      .map((c, idx) => {
        const name = esc(c.name || c.course_name || c.club_name || "Unknown");
        const city = esc(c.city || "");
        const country = esc(c.country || "");
        const sub = [city, country].filter(Boolean).join(", ");
        return `
          <button type="button" class="ff-suggest-item" data-sidx="${idx}">
            <div class="ff-suggest-name">${name}</div>
            <div class="ff-suggest-sub">${esc(sub)}</div>
          </button>
        `;
      })
      .join("");

    suggestionsEl.innerHTML = html;
    suggestionsEl.style.display = "block";

    suggestionsEl.querySelectorAll("[data-sidx]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = Number(btn.getAttribute("data-sidx"));
        const course = items[i];
        hideSuggestions();
        if (!course) return;
        if (searchInput) searchInput.value = course.name || course.course_name || "";
        await selectCourse(course);
      });
    });
  }

  async function handleTypeahead() {
    const q = searchInput?.value?.trim() || "";
    if (q.length < 3) return hideSuggestions();

    try {
      const courses = await fetchCourses(q);
      showSuggestions(courses);
    } catch {
      hideSuggestions();
    }
  }

  async function handleSearch() {
    hideSuggestions();

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
          showMessage("Finding nearby area…");
          const w = await fetchWeather(lat, lon);
          const city = w?.current?.name || "";
          const country = w?.current?.sys?.country || "";

          if (!city) {
            showMessage("Couldn’t detect your nearest town. Please type a course name.");
            return;
          }

          showMessage(`Searching courses near you…`);
          const courses = await fetchCourses(`${city}${country ? ` ${country}` : ""}`);

          const radiusKm = kmFromMiles(NEAR_ME_RADIUS_MILES);

          const within = courses
            .map((c) => {
              const cLat = Number(c.lat ?? c.location?.lat ?? c.location?.latitude);
              const cLon = Number(c.lon ?? c.location?.lon ?? c.location?.longitude);
              if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return null;
              const dKm = haversineKm(lat, lon, cLat, cLon);
              if (dKm > radiusKm) return null;
              return { ...c, _distanceKm: dKm };
            })
            .filter(Boolean)
            .sort((a, b) => a._distanceKm - b._distanceKm);

          if (!within.length) {
            showMessage(`No courses found within ${NEAR_ME_RADIUS_MILES} miles. Try a manual search.`);
            return;
          }

          renderCourseResults(within, {
            title: `Courses within ${NEAR_ME_RADIUS_MILES} miles`,
            subtitle: `Near ${city}${country ? `, ${country}` : ""}`,
          });
        } catch (err) {
          console.error(err);
          showMessage("Could not load nearby courses. Try searching by name instead.");
        }
      },
      () => showMessage("Location permission denied. You can still search by course name."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  // Tabs
  tabCurrent?.addEventListener("click", () => {
    if (!lastWeather) return;
    setActiveTab(tabCurrent);
    renderCurrent(lastWeather);
  });

  tabHourly?.addEventListener("click", () => {
    if (!lastWeather) return;
    setActiveTab(tabHourly);
    renderHourly(lastWeather);
  });

  tabDaily?.addEventListener("click", () => {
    if (!lastWeather) return;
    setActiveTab(tabDaily);
    renderDaily(lastWeather);
  });

  /* ---------- IMPORTANT: STOP FORM SUBMIT RELOAD ---------- */
  const formEl =
    searchBtn?.closest("form") ||
    searchInput?.closest("form") ||
    document.querySelector("form");

  formEl?.addEventListener("submit", (e) => {
    e.preventDefault();
    handleSearch();
  });

  // Button + Enter (also prevent default)
  searchBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    handleSearch();
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
    if (e.key === "Escape") hideSuggestions();
  });

  searchInput?.addEventListener("input", () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(handleTypeahead, 250);
  });

  document.addEventListener("click", (e) => {
    if (!suggestionsEl || !searchInput) return;
    const t = e.target;
    if (t === searchInput || suggestionsEl.contains(t)) return;
    hideSuggestions();
  });

  geoBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    handleCoursesNearMe();
  });

  unitsSelect?.addEventListener("change", async () => {
    if (!selectedCourse) return;
    await selectCourse(selectedCourse);
  });

  // Init
  if (!searchInput || !searchBtn || !resultsEl) {
    console.warn("Some expected DOM elements are missing. App will run in reduced mode.");
  }

  showMessage("Search for a town or golf course — or tap ⌖ for courses near you.");
})();

