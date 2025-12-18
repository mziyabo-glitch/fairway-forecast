/* =====================================================
   Fairway Forecast – app.js
   FINAL, STABLE, ICON-SAFE
   ===================================================== */

(() => {
  "use strict";

  /* ---------------- CONFIG ---------------- */
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";

  /* ---------------- DOM ---------------- */
  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const verdictCard = $("verdictCard");
  const verdictIcon = $("verdictIcon");
  const verdictLabel = $("verdictLabel");
  const verdictReason = $("verdictReason");
  const verdictBestTime = $("verdictBestTime");

  const unitsSelect = $("unitsSelect");

  /* ---------------- STATE ---------------- */
  let selectedCourse = null;
  let lastNorm = null;
  let activeTab = "current";

  /* ---------------- HELPERS ---------------- */
  const tempUnit = () => (unitsSelect.value === "imperial" ? "°F" : "°C");
  const windUnit = () => (unitsSelect.value === "imperial" ? "mph" : "m/s");

  const fmtTime = (ts) =>
    ts
      ? new Date(ts * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  const getIconUrl = (icon) =>
    icon ? `https://openweathermap.org/img/wn/${icon}@2x.png` : "";

  const setActiveTab = (tab) => {
    activeTab = tab;
    [tabCurrent, tabHourly, tabDaily].forEach((b) =>
      b.classList.remove("active")
    );
    if (tab === "current") tabCurrent.classList.add("active");
    if (tab === "hourly") tabHourly.classList.add("active");
    if (tab === "daily") tabDaily.classList.add("active");
    render();
  };

  /* ---------------- API ---------------- */
  async function apiGet(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchCourses(q) {
    const data = await apiGet(`/courses?search=${encodeURIComponent(q)}`);
    return data.courses || [];
  }

  async function fetchWeather(lat, lon) {
    return apiGet(
      `/weather?lat=${lat}&lon=${lon}&units=${unitsSelect.value}`
    );
  }

  /* ---------------- NORMALIZE ---------------- */
  function normalizeWeather(raw) {
    const first = raw.list?.[0];

    return {
      current: first
        ? {
            temp: first.main.temp,
            pop: first.pop,
            wind: first.wind,
            weather: first.weather,
            sunrise: raw.city.sunrise,
            sunset: raw.city.sunset,
          }
        : null,
      hourly: raw.list?.slice(0, 12) || [],
      daily: buildDaily(raw.list || []),
    };
  }

  function buildDaily(list) {
    const days = {};
    list.forEach((i) => {
      const d = new Date(i.dt * 1000).toDateString();
      days[d] ??= {
        dt: i.dt,
        min: i.main.temp_min,
        max: i.main.temp_max,
        pop: i.pop,
        icon: i.weather?.[0]?.icon,
        main: i.weather?.[0]?.main,
      };
      days[d].min = Math.min(days[d].min, i.main.temp_min);
      days[d].max = Math.max(days[d].max, i.main.temp_max);
      days[d].pop = Math.max(days[d].pop, i.pop || 0);
    });
    return Object.values(days).slice(0, 7);
  }

  /* ---------------- VERDICT ---------------- */
  function renderVerdict() {
    if (!lastNorm?.current) return;

    verdictIcon.textContent = "⛔";
    verdictLabel.textContent = "No-play recommended";
    verdictReason.textContent = "Limited daylight remaining";
    verdictBestTime.textContent = "—";
  }

  /* ---------------- RENDER ---------------- */
  function render() {
    if (!lastNorm) return;

    renderVerdict();

    if (activeTab === "current") renderCurrent();
    if (activeTab === "hourly") renderHourly();
    if (activeTab === "daily") renderDaily();

    const score = Math.max(
      0,
      10 -
        Math.round(
          (lastNorm.current.pop || 0) * 6 +
            (lastNorm.current.wind?.speed || 0) / 2
        )
    );
    playabilityScoreEl.textContent = `${score}/10`;
  }

  function renderCurrent() {
    const c = lastNorm.current;
    const w = c.weather?.[0] || {};
    const icon = getIconUrl(w.icon);

    resultsEl.innerHTML = `
      <section class="ff-panel">
        <h3>Your location</h3>

        <div style="display:flex;align-items:center;gap:12px">
          ${
            icon
              ? `<img src="${icon}" width="64" height="64" alt="${w.main}">`
              : ""
          }
          <div>
            <div style="font-size:32px;font-weight:700">
              ${Math.round(c.temp)}${tempUnit()}
            </div>
            <div>${w.description || w.main || ""}</div>
          </div>
        </div>

        <div class="ff-grid">
          <div>Wind <strong>${c.wind?.speed} ${windUnit()}</strong></div>
          <div>Gust <strong>${c.wind?.gust ?? "—"} ${windUnit()}</strong></div>
          <div>Rain <strong>${Math.round((c.pop || 0) * 100)}%</strong></div>
          <div>Sunrise <strong>${fmtTime(c.sunrise)}</strong></div>
          <div>Sunset <strong>${fmtTime(c.sunset)}</strong></div>
        </div>
      </section>
    `;
  }

  function renderHourly() {
    resultsEl.innerHTML = `
      <section class="ff-panel">
        <table class="ff-table">
          <thead>
            <tr>
              <th>Time</th><th></th><th>Temp</th><th>Rain</th><th>Wind</th>
            </tr>
          </thead>
          <tbody>
            ${lastNorm.hourly
              .map((h) => {
                const w = h.weather?.[0] || {};
                return `
                <tr>
                  <td>${fmtTime(h.dt)}</td>
                  <td><img src="${getIconUrl(
                    w.icon
                  )}" width="28"></td>
                  <td>${Math.round(h.main.temp)}${tempUnit()}</td>
                  <td>${Math.round((h.pop || 0) * 100)}%</td>
                  <td>${h.wind.speed} ${windUnit()}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </section>
    `;
  }

  function renderDaily() {
    resultsEl.innerHTML = `
      <section class="ff-panel">
        <table class="ff-table">
          <thead>
            <tr>
              <th>Day</th><th></th><th>High / Low</th><th>Rain</th><th>Summary</th>
            </tr>
          </thead>
          <tbody>
            ${lastNorm.daily
              .map((d) => `
              <tr>
                <td>${new Date(d.dt * 1000).toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}</td>
                <td><img src="${getIconUrl(d.icon)}" width="32"></td>
                <td>${Math.round(d.max)} / ${Math.round(d.min)}${tempUnit()}</td>
                <td>${Math.round((d.pop || 0) * 100)}%</td>
                <td>${d.main || ""}</td>
              </tr>
            `)
              .join("")}
          </tbody>
        </table>
      </section>
    `;
  }

  /* ---------------- EVENTS ---------------- */
  searchBtn.onclick = async () => {
    const q = searchInput.value.trim();
    if (!q) return;

    resultsEl.innerHTML = "Loading…";

    const courses = await fetchCourses(q);
    selectedCourse = courses[0];
    if (!selectedCourse) return;

    const weather = await fetchWeather(
      selectedCourse.lat,
      selectedCourse.lon
    );

    lastNorm = normalizeWeather(weather);
    render();
  };

  tabCurrent.onclick = () => setActiveTab("current");
  tabHourly.onclick = () => setActiveTab("hourly");
  tabDaily.onclick = () => setActiveTab("daily");

})();
