/* =====================================================
   Fairway Forecast – app.js
   Crash-safe, mobile-first, GitHub Pages compatible
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";

  /* ---------- DOM HELPERS ---------- */
  const $ = (id) => document.getElementById(id);

  /* ---------- ELEMENTS ---------- */
  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  /* ---------- SAFE GUARDS ---------- */
  if (!searchInput || !searchBtn || !resultsEl) {
    console.warn("Essential DOM elements missing — app halted safely.");
    return;
  }

  /* ---------- UTIL ---------- */
  function setActiveTab(tab) {
    [tabCurrent, tabHourly, tabDaily].forEach((b) =>
      b?.classList.remove("active")
    );
    tab?.classList.add("active");
  }

  function showMessage(msg) {
    resultsEl.innerHTML = `<div class="ff-card muted">${msg}</div>`;
  }

  /* ---------- FETCH WEATHER ---------- */
  async function fetchWeather(lat, lon) {
    try {
      const res = await fetch(
        `${API_BASE}/weather?lat=${lat}&lon=${lon}`
      );
      if (!res.ok) throw new Error("API error");
      return await res.json();
    } catch (err) {
      console.error(err);
      showMessage("Weather unavailable. Try again later.");
      return null;
    }
  }

  /* ---------- PLAYABILITY ---------- */
  function calculatePlayability(data) {
    if (!data?.current) return "--";

    let score = 10;

    const wind = data.current.wind?.speed ?? 0;
    const temp = data.current.temp ?? 10;
    const rain = data.current.weather?.[0]?.main === "Rain";

    if (wind > 10) score -= 3;
    else if (wind > 6) score -= 2;

    if (temp < 4 || temp > 30) score -= 2;

    if (rain) score -= 3;

    return Math.max(1, Math.round(score));
  }

  /* ---------- RENDER ---------- */
  function renderCurrent(data) {
    const c = data.current;
    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-row">
          <img class="ff-icon" src="https://openweathermap.org/img/wn/${c.weather[0].icon}@2x.png" />
          <div>
            <div class="ff-big">${Math.round(c.temp)}°</div>
            <div class="ff-sub">${c.weather[0].description}</div>
          </div>
        </div>
      </div>
    `;

    const score = calculatePlayability(data);
    if (playabilityScoreEl) playabilityScoreEl.textContent = `${score}/10`;
  }

  /* ---------- SEARCH ---------- */
  async function handleSearch() {
    const q = searchInput.value.trim();
    if (!q) return;

    showMessage("Loading weather…");

    // TEMP: London fallback for now
    const lat = 51.5;
    const lon = -0.1;

    const data = await fetchWeather(lat, lon);
    if (!data) return;

    setActiveTab(tabCurrent);
    renderCurrent(data);
  }

  /* ---------- EVENTS ---------- */
  searchBtn.addEventListener("click", handleSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });

  /* ---------- INIT ---------- */
  showMessage("Search for a town or golf course to begin.");
})();
