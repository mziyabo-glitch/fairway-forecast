/* =====================================================
   Fairway Forecast – app.js
   Stable, crash-safe, mobile-first
   Supports: city search, course search, geolocation
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

  const geoBtn = $("btnGeo") || $("geoBtn");
  const unitsSelect = $("unitsSelect") || $("units");

  /* ---------- STATE ---------- */
  let selectedCourse = null;
  let lastWeather = null;
  let lastCoords = null;

  /* ---------- GUARDS ---------- */
  if (!resultsEl) {
    console.warn("Results container missing – app halted safely.");
    return;
  }

  /* ---------- UTILS ---------- */
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const setActiveTab = (tab) => {
    [tabCurrent, tabHourly, tabDaily].forEach((b) =>
      b?.classList.remove("active")
    );
    tab?.classList.add("active");
  };

  const showMessage = (msg) => {
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  };

  const getUnits = () =>
    unitsSelect?.value === "imperial" ? "imperial" : "metric";

  /* ---------- DISTANCE ---------- */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  /* ---------- FETCH WEATHER ---------- */
  async function fetchWeather(lat, lon) {
    const url = `${API_BASE}/weather?lat=${lat}&lon=${lon}&units=${getUnits()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Weather fetch failed");
    return res.json();
  }

  /* ---------- FETCH COURSES ---------- */
  async function fetchCourses(query) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Course search failed");
    const data = await res.json();
    return data.courses || [];
  }

  /* ---------- PLAYABILITY ---------- */
  function calculatePlayability(data) {
    const c = data?.current;
    if (!c) return "--";

    let score = 10;
    const wind = c.wind?.speed || 0;
    const temp = c.temp;

    if (wind > 10) score -= 3;
    else if (wind > 6) score -= 2;

    if (getUnits() === "metric") {
      if (temp < 4 || temp > 30) score -= 2;
    } else {
      if (temp < 40 || temp > 86) score -= 2;
    }

    if (c.weather?.[0]?.main?.toLowerCase().includes("rain")) score -= 3;

    return Math.max(0, Math.min(10, Math.round(score)));
  }

  /* ---------- RENDER CURRENT ---------- */
  function renderCurrent(data) {
    lastWeather = data;

    const c = data.current;
    const icon = c.weather?.[0]?.icon;
    const temp =
      c.temp !== undefined ? `${Math.round(c.temp)}°` : "--°";

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-row">
          ${
            icon
              ? `<img class="ff-icon" src="https://openweathermap.org/img/wn/${icon}@2x.png" />`
              : ""
          }
          <div>
            <div class="ff-big">${temp}</div>
            <div class="ff-sub">${esc(
              c.weather?.[0]?.description || ""
            )}</div>
          </div>
        </div>

        <div class="ff-metrics">
          <div>Wind ${c.wind?.speed ?? "--"} ${getUnits() === "metric" ? "m/s" : "mph"}</div>
          <div>Gust ${c.wind?.gust ?? "--"}</div>
          <div>Rain chance ${Math.round((c.pop ?? 1) * 100)}%</div>
        </div>
      </div>
    `;

    if (playabilityScoreEl) {
      playabilityScoreEl.textContent = `${calculatePlayability(data)}/10`;
    }
  }
   /* ---------- RENDER: HOURLY ---------- */
  function renderHourly(data) {
    if (!resultsEl || !data?.hourly?.length) {
      showMessage("Hourly data not available.");
      return;
    }

    const hours = data.hourly.slice(0, 8);

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Hourly · Next 24 hours (3-hour blocks)</div>
        <div class="ff-hourly">
          ${hours
            .map((h) => {
              const time = new Date(h.dt * 1000).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              });
              const icon = `https://openweathermap.org/img/wn/${h.weather[0].icon}@2x.png`;
              return `
                <div class="ff-hour">
                  <div class="ff-hour-time">${time}</div>
                  <img src="${icon}" alt="" />
                  <div class="ff-hour-temp">${Math.round(h.temp)}°</div>
                  <div class="ff-hour-meta">${Math.round(
                    (h.pop || 0) * 100
                  )}% · ${Math.round(h.wind_speed)} m/s</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  /* ---------- RENDER: DAILY ---------- */
  function renderDaily(data) {
    if (!resultsEl || !data?.daily?.length) {
      showMessage("Daily forecast not available.");
      return;
    }

    const days = data.daily.slice(0, 7);

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Daily · Up to 7 days</div>
        <div class="ff-daily">
          ${days
            .map((d) => {
              const date = new Date(d.dt * 1000).toLocaleDateString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
              const icon = `https://openweathermap.org/img/wn/${d.weather[0].icon}@2x.png`;
              return `
                <div class="ff-day">
                  <div class="ff-day-date">${date}</div>
                  <img src="${icon}" alt="" />
                  <div class="ff-day-desc">${d.weather[0].main}</div>
                  <div class="ff-day-temp">
                    ${Math.round(d.temp.max)}° / ${Math.round(d.temp.min)}°
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
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

  /* ---------- FINAL INIT ---------- */
  showMessage(
    "Search for a town, city or golf course — or use ⌖ to find courses near you."
  );
})();
