/* =====================================================
   Fairway Forecast – app.js
   Stable, crash-safe, mobile-first
   Supports: course search, geolocation (near me), tabs
   Works with:
     - OneCall-like: { current, hourly, daily }
     - Forecast-like: { current, forecast: { list: [...] } } OR { forecast: { list } }
   ===================================================== */

(() => {
  "use strict";

  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const NEAR_ME_RADIUS_MILES = 20;

  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const geoBtn = $("btnGeo") || $("geoBtn");
  const unitsSelect = $("unitsSelect") || $("units");

  let selectedCourse = null;
  let lastWeather = null;
  let lastUserPos = null;

  if (!resultsEl) {
    console.warn("Results container missing – app halted safely.");
    return;
  }

  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const setActiveTab = (tab) => {
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    tab?.classList.add("active");
  };

  const showMessage = (msg) => {
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  };

  const getUnits = () => (unitsSelect?.value === "imperial" ? "imperial" : "metric");
  const speedUnit = () => (getUnits() === "imperial" ? "mph" : "m/s");

  /* ---------- DISTANCE ---------- */
  function haversineMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.7613;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ---------- FETCH ---------- */
  async function fetchWeather(lat, lon) {
    const url = `${API_BASE}/weather?lat=${lat}&lon=${lon}&units=${getUnits()}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Weather fetch failed");
    return data;
  }

  async function fetchCourses(query) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Course search failed");
    return Array.isArray(data?.courses) ? data.courses : [];
  }

  /* ---------- NORMALIZE FORECAST LIST ---------- */
  function getForecastList(data) {
    // Supports shapes:
    // data.forecast.list
    // data.list
    // data.forecast (already a list)
    const list =
      data?.forecast?.list ||
      data?.list ||
      (Array.isArray(data?.forecast) ? data.forecast : null);

    return Array.isArray(list) ? list : [];
  }

  /* ---------- PLAYABILITY ---------- */
  function calculatePlayability(data) {
    const c = data?.current;
    if (!c) return "--";

    let score = 10;
    const wind = Number(c.wind?.speed ?? c.wind_speed ?? 0);
    const temp = Number(c.temp ?? c.main?.temp ?? 10);
    const main = String(c.weather?.[0]?.main || "").toLowerCase();

    if (wind > 10) score -= 3;
    else if (wind > 6) score -= 2;

    if (getUnits() === "metric") {
      if (temp < 4 || temp > 30) score -= 2;
    } else {
      if (temp < 40 || temp > 86) score -= 2;
    }

    if (main.includes("rain") || main.includes("drizzle") || main.includes("thunder")) score -= 3;

    return Math.max(0, Math.min(10, Math.round(score)));
  }

  /* ---------- RENDER CURRENT ---------- */
  function renderCurrent(data) {
    lastWeather = data;

    const c = data?.current || {};
    const icon = c.weather?.[0]?.icon;
    const tempNum = c.temp ?? c.main?.temp;
    const temp = Number.isFinite(Number(tempNum)) ? `${Math.round(Number(tempNum))}°` : "--°";

    // rain chance: prefer forecast pop if available
    const list = getForecastList(data);
    const pop = Number(list?.[0]?.pop ?? c.pop ?? 0);
    const rainChance = `${Math.round(pop * 100)}%`;

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-row">
          ${
            icon
              ? `<img class="ff-icon" alt="" src="https://openweathermap.org/img/wn/${icon}@2x.png" />`
              : ""
          }
          <div>
            <div class="ff-big">${temp}</div>
            <div class="ff-sub">${esc(c.weather?.[0]?.description || "")}</div>
          </div>
        </div>

        <div class="ff-metrics">
          <div>Wind ${c.wind?.speed ?? c.wind_speed ?? "--"} ${speedUnit()}</div>
          <div>Gust ${c.wind?.gust ?? c.wind_gust ?? "--"}</div>
          <div>Rain chance ${rainChance}</div>
        </div>
      </div>
    `;

    if (playabilityScoreEl) {
      playabilityScoreEl.textContent = `${calculatePlayability(data)}/10`;
    }
  }

  /* ---------- RENDER HOURLY ---------- */
  function renderHourly(data) {
    // Prefer OneCall hourly; fallback to forecast.list (3h blocks)
    const oneCall = Array.isArray(data?.hourly) ? data.hourly : null;
    const list = getForecastList(data);

    const hours = oneCall ? oneCall.slice(0, 8) : list.slice(0, 8);
    if (!hours.length) {
      showMessage("Hourly data not available.");
      return;
    }

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Hourly · Next ${hours.length} blocks</div>
        <div class="ff-hourly">
          ${hours
            .map((h) => {
              const dt = h.dt;
              const time = dt
                ? new Date(dt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "—";

              const w = h.weather?.[0] || {};
              const icon = w.icon
                ? `https://openweathermap.org/img/wn/${w.icon}@2x.png`
                : "";

              const t = Number(h.temp ?? h.main?.temp);
              const pop = Number(h.pop ?? 0);
              const wind = Number(h.wind_speed ?? h.wind?.speed ?? h.wind?.speed ?? 0);

              return `
                <div class="ff-hour">
                  <div class="ff-hour-time">${esc(time)}</div>
                  ${icon ? `<img src="${icon}" alt="" />` : ""}
                  <div class="ff-hour-temp">${Number.isFinite(t) ? Math.round(t) : "--"}°</div>
                  <div class="ff-hour-meta">${Math.round(pop * 100)}% · ${Math.round(wind)} ${speedUnit()}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  /* ---------- RENDER DAILY ---------- */
  function renderDaily(data) {
    // Prefer OneCall daily; fallback: derive 7 “days” from forecast list
    const oneCall = Array.isArray(data?.daily) ? data.daily : null;
    const list = getForecastList(data);

    if (oneCall && oneCall.length) {
      const days = oneCall.slice(0, 7);
      resultsEl.innerHTML = `
        <div class="ff-card">
          <div class="ff-sub muted">Daily · Up to ${days.length} days</div>
          <div class="ff-daily">
            ${days
              .map((d) => {
                const date = new Date(d.dt * 1000).toLocaleDateString([], {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                });
                const icon = d.weather?.[0]?.icon
                  ? `https://openweathermap.org/img/wn/${d.weather[0].icon}@2x.png`
                  : "";
                return `
                  <div class="ff-day">
                    <div class="ff-day-date">${esc(date)}</div>
                    ${icon ? `<img src="${icon}" alt="" />` : ""}
                    <div class="ff-day-desc">${esc(d.weather?.[0]?.main || "")}</div>
                    <div class="ff-day-temp">${Math.round(d.temp.max)}° / ${Math.round(d.temp.min)}°</div>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
      return;
    }

    if (!list.length) {
      showMessage("Daily forecast not available.");
      return;
    }

    // Derive up to 7 days from 3-hour forecast list
    const byDay = new Map();
    for (const item of list) {
      const dt = item.dt;
      if (!dt) continue;
      const d = new Date(dt * 1000);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

      const temp = Number(item.main?.temp);
      const pop = Number(item.pop ?? 0);
      const icon = item.weather?.[0]?.icon || "";
      const main = item.weather?.[0]?.main || "";

      if (!byDay.has(key)) {
        byDay.set(key, { dt, min: temp, max: temp, pop, icon, main });
      } else {
        const o = byDay.get(key);
        o.min = Math.min(o.min, temp);
        o.max = Math.max(o.max, temp);
        o.pop = Math.max(o.pop, pop);
        if (icon) o.icon = icon;
        if (main) o.main = main;
      }
    }

    const days = Array.from(byDay.values()).slice(0, 7);

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Daily · Up to ${days.length} days</div>
        <div class="ff-daily">
          ${days
            .map((d) => {
              const date = new Date(d.dt * 1000).toLocaleDateString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
              const icon = d.icon ? `https://openweathermap.org/img/wn/${d.icon}@2x.png` : "";
              return `
                <div class="ff-day">
                  <div class="ff-day-date">${esc(date)}</div>
                  ${icon ? `<img src="${icon}" alt="" />` : ""}
                  <div class="ff-day-desc">${esc(d.main)}</div>
                  <div class="ff-day-temp">${Math.round(d.max)}° / ${Math.round(d.min)}°</div>
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
      showMessage("This course has no coordinates. Try another.");
      return;
    }

    lastCoords = { lat, lon };
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

  /* ---------- SEARCH HANDLER ---------- */
  async function handleSearch() {
    const q = searchInput?.value?.trim() || "";
    if (!q) {
      showMessage("Type a town/city or course name.");
      return;
    }

    showMessage("Searching courses…");

    try {
      const courses = await fetchCourses(q);
      if (!courses.length) {
        showMessage("No courses found. Try a different search.");
        return;
      }

      // Show list to pick from (top 20)
      resultsEl.innerHTML = `
        <div class="ff-card">
          <div class="ff-sub muted">Select a course</div>
          <div class="ff-course-list">
            ${courses.slice(0, 20).map((c, i) => {
              const name = c.name || c.course_name || c.club_name || "Unknown";
              const sub = [c.city, c.state, c.country].filter(Boolean).join(", ");
              return `
                <button class="ff-course" type="button" data-i="${i}">
                  <div class="ff-course-name">${esc(name)}</div>
                  <div class="ff-course-sub">${esc(sub || "Tap to view forecast")}</div>
                </button>
              `;
            }).join("")}
          </div>
        </div>
      `;

      resultsEl.querySelectorAll("[data-i]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.getAttribute("data-i"));
          selectCourse(courses[i]);
        });
      });

    } catch (err) {
      console.error(err);
      showMessage(`Search failed: ${err.message}`);
    }
  }

  /* ---------- NEAR ME HANDLER ---------- */
  async function handleNearMe() {
    if (!("geolocation" in navigator)) {
      showMessage("Geolocation not available on this device.");
      return;
    }

    showMessage("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        lastUserPos = { lat, lon };

        showMessage("Searching nearby courses…");

        try {
          // Use a broad query to get a pool, then filter by distance
          // (Worker doesn’t support radius natively)
          const pool = await fetchCourses("golf");
          const nearby = pool
            .map((c) => {
              const cLat = Number(c.lat ?? c.location?.latitude);
              const cLon = Number(c.lon ?? c.location?.longitude);
              if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) return null;
              const mi = haversineMiles(lat, lon, cLat, cLon);
              return { ...c, _mi: mi };
            })
            .filter(Boolean)
            .filter((c) => c._mi <= NEAR_ME_RADIUS_MILES)
            .sort((a, b) => a._mi - b._mi)
            .slice(0, 20);

          if (!nearby.length) {
            showMessage(`No courses found within ${NEAR_ME_RADIUS_MILES} miles.`);
            return;
          }

          resultsEl.innerHTML = `
            <div class="ff-card">
              <div class="ff-sub muted">Courses within ${NEAR_ME_RADIUS_MILES} miles</div>
              <div class="ff-course-list">
                ${nearby.map((c, i) => {
                  const name = c.name || c.course_name || c.club_name || "Unknown";
                  const sub = [c.city, c.state, c.country].filter(Boolean).join(", ");
                  return `
                    <button class="ff-course" type="button" data-n="${i}">
                      <div class="ff-course-name">${esc(name)}</div>
                      <div class="ff-course-sub">${esc(sub)}</div>
                      <div class="ff-course-dist">${c._mi.toFixed(1)} mi</div>
                    </button>
                  `;
                }).join("")}
              </div>
            </div>
          `;

          resultsEl.querySelectorAll("[data-n]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const i = Number(btn.getAttribute("data-n"));
              selectCourse(nearby[i]);
            });
          });

        } catch (err) {
          console.error(err);
          showMessage("Could not load nearby courses. Try searching by name.");
        }
      },
      () => showMessage("Location permission denied."),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  /* ---------- TAB HANDLERS ---------- */
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

  /* ---------- WIRE UP SEARCH + GEO + UNITS ---------- */
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

  geoBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    handleNearMe();
  });

  unitsSelect?.addEventListener("change", async () => {
    if (!lastCoords) return;
    try {
      const data = await fetchWeather(lastCoords.lat, lastCoords.lon);
      lastWeather = data;
      // re-render current tab view
      if (tabHourly?.classList.contains("active")) renderHourly(data);
      else if (tabDaily?.classList.contains("active")) renderDaily(data);
      else renderCurrent(data);
    } catch {
      showMessage("Could not refresh units — try again.");
    }
  });

  /* ---------- INIT ---------- */
  showMessage("Search for a town, city or golf course — or use ⌖ to find courses near you.");
})();
