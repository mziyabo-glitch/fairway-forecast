(() => {
  "use strict";

  const API = "https://fairway-forecast-api.mziyabo.workers.dev";

  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const verdictIcon = $("verdictIcon");
  const verdictLabel = $("verdictLabel");
  const verdictReason = $("verdictReason");
  const verdictBestTime = $("verdictBestTime");

  const playabilityScore = $("playabilityScore");
  const unitsSelect = $("unitsSelect");

  let weather = null;
  let tab = "current";

  const tempUnit = () => (unitsSelect.value === "imperial" ? "°F" : "°C");
  const windUnit = () => (unitsSelect.value === "imperial" ? "mph" : "m/s");

  const iconUrl = (icon) =>
    icon ? `https://openweathermap.org/img/wn/${icon}@2x.png` : "";

  const time = (t) =>
    new Date(t * 1000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  async function api(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function search() {
    resultsEl.innerHTML = "Loading…";

    const courses = await api(
      `/courses?search=${encodeURIComponent(searchInput.value)}`
    );

    const c = courses.courses[0];
    if (!c) return;

    const w = await api(
      `/weather?lat=${c.lat}&lon=${c.lon}&units=${unitsSelect.value}`
    );

    weather = w;
    render();
  }

  function renderVerdict() {
    verdictIcon.textContent = "⛔";
    verdictLabel.textContent = "No-play recommended";
    verdictReason.textContent = "Limited daylight remaining";
    verdictBestTime.textContent = "—";
  }

  function renderCurrent() {
    const c = weather.current;
    const w = c.weather?.[0] || {};

    resultsEl.innerHTML = `
      <section class="ff-panel">
        <div style="display:flex;gap:16px;align-items:center">
          ${
            w.icon
              ? `<img src="${iconUrl(w.icon)}" width="64" height="64">`
              : ""
          }
          <div>
            <div style="font-size:34px;font-weight:700">
              ${Math.round(c.temp)}${tempUnit()}
            </div>
            <div>${w.description || w.main || ""}</div>
          </div>
        </div>

        <div class="ff-grid">
          <div>Wind <strong>${c.wind.speed} ${windUnit()}</strong></div>
          <div>Gust <strong>${c.wind.gust || "—"} ${windUnit()}</strong></div>
          <div>Rain <strong>${Math.round((c.pop || 0) * 100)}%</strong></div>
          <div>Sunrise <strong>${time(c.sunrise)}</strong></div>
          <div>Sunset <strong>${time(c.sunset)}</strong></div>
        </div>
      </section>
    `;
  }

  function renderHourly() {
    resultsEl.innerHTML = `
      <section class="ff-panel">
        <table class="ff-table">
          <thead>
            <tr><th>Time</th><th></th><th>Temp</th><th>Rain</th><th>Wind</th></tr>
          </thead>
          <tbody>
            ${weather.list.slice(0, 12).map(h => `
              <tr>
                <td>${time(h.dt)}</td>
                <td><img src="${iconUrl(h.weather?.[0]?.icon)}" width="28"></td>
                <td>${Math.round(h.main.temp)}${tempUnit()}</td>
                <td>${Math.round((h.pop || 0) * 100)}%</td>
                <td>${h.wind.speed} ${windUnit()}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    `;
  }

  function renderDaily() {
    const days = {};
    weather.list.forEach(h => {
      const d = new Date(h.dt * 1000).toDateString();
      days[d] ??= {
        dt: h.dt,
        min: h.main.temp_min,
        max: h.main.temp_max,
        pop: h.pop || 0,
        icon: h.weather?.[0]?.icon,
        main: h.weather?.[0]?.main
      };
      days[d].min = Math.min(days[d].min, h.main.temp_min);
      days[d].max = Math.max(days[d].max, h.main.temp_max);
      days[d].pop = Math.max(days[d].pop, h.pop || 0);
    });

    resultsEl.innerHTML = `
      <section class="ff-panel">
        <table class="ff-table">
          <thead>
            <tr><th>Day</th><th></th><th>High / Low</th><th>Rain</th><th></th></tr>
          </thead>
          <tbody>
            ${Object.values(days).slice(0, 7).map(d => `
              <tr>
                <td>${new Date(d.dt * 1000).toLocaleDateString(undefined,{weekday:"short"})}</td>
                <td><img src="${iconUrl(d.icon)}" width="32"></td>
                <td>${Math.round(d.max)} / ${Math.round(d.min)}${tempUnit()}</td>
                <td>${Math.round(d.pop * 100)}%</td>
                <td>${d.main}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>
    `;
  }

  function render() {
    renderVerdict();

    if (tab === "current") renderCurrent();
    if (tab === "hourly") renderHourly();
    if (tab === "daily") renderDaily();

    playabilityScore.textContent = "5/10";
  }

  searchBtn.onclick = search;
  tabCurrent.onclick = () => (tab = "current", render());
  tabHourly.onclick = () => (tab = "hourly", render());
  tabDaily.onclick = () => (tab = "daily", render());
})();
