/* =====================================================
   Fairway Forecast – app.js
   Stable, crash-safe, mobile-first
   Supports: course search + city fallback + optional geolocation
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

  const suggestions = $("searchSuggestions");

  /* ---------- STABILITY: init once ---------- */
  if (window.__FF_INIT__) return;
  window.__FF_INIT__ = true;

  /* ---------- GUARDS ---------- */
  if (!resultsEl) {
    console.warn("Results container missing – app halted safely.");
    return;
  }

  /* ---------- STATE ---------- */
  let selectedPlace = null; // { name, subtitle, lat, lon, type }
  let lastRaw = null;
  let lastNorm = null;
  let activeTab = "current";

  /* ---------- UTILS ---------- */
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");

  const getUnits = () => (unitsSelect?.value === "imperial" ? "imperial" : "metric");

  const unitWind = () => (getUnits() === "imperial" ? "mph" : "m/s");

  const setActiveTab = (tabBtn, tabName) => {
    activeTab = tabName;
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    tabBtn?.classList.add("active");
  };

  const showMessage = (msg) => {
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  };

  const fmtTime = (unixSec) => {
    if (!unixSec) return "--:--";
    return new Date(unixSec * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

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

  /* ---------- API: courses ---------- */
  async function fetchCourses(query) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Course search failed (${res.status})`);
    const data = await res.json();
    return data?.courses || [];
  }

  /* ---------- API: weather ---------- */
  async function fetchWeatherByCoords(lat, lon) {
    const url = `${API_BASE}/weather?lat=${lat}&lon=${lon}&units=${getUnits()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather fetch failed (${res.status})`);
    return res.json();
  }

  // Optional: city search fallback if your worker supports it.
  async function fetchWeatherByQuery(q) {
    const url = `${API_BASE}/weather?q=${encodeURIComponent(q)}&units=${getUnits()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`City weather fetch failed (${res.status})`);
    return res.json();
  }

  /* ---------- NORMALIZATION ---------- */
  function pickNumber(...vals) {
    for (const v of vals) {
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
  }

  function normalizeWeather(raw) {
    // We want: { current, hourly[], daily[], meta:{sunrise,sunset} }
    const out = {
      current: {},
      hourly: [],
      daily: [],
      meta: { sunrise: null, sunset: null },
      source: raw,
    };

    const forecastList = raw?.forecast?.list || raw?.list || null;

    // sunrise/sunset can live in multiple shapes
    out.meta.sunrise =
      raw?.current?.sunrise ??
      raw?.weather?.sys?.sunrise ??
      raw?.city?.sunrise ??
      null;

    out.meta.sunset =
      raw?.current?.sunset ??
      raw?.weather?.sys?.sunset ??
      raw?.city?.sunset ??
      null;

    // --- CURRENT ---
    // Support:
    // raw.current.temp
    // raw.current.main.temp
    // raw.weather.main.temp
    // fallback forecastList[0].main.temp
    const curTemp = pickNumber(
      raw?.current?.temp,
      raw?.current?.main?.temp,
      raw?.weather?.main?.temp,
      forecastList?.[0]?.main?.temp
    );

    const curWeatherArr =
      raw?.current?.weather ||
      raw?.weather?.weather ||
      forecastList?.[0]?.weather ||
      [];

    const curWindSpeed = pickNumber(
      raw?.current?.wind?.speed,
      raw?.current?.wind_speed,
      raw?.weather?.wind?.speed,
      forecastList?.[0]?.wind?.speed
    );

    const curWindGust = pickNumber(
      raw?.current?.wind?.gust,
      raw?.current?.wind_gust,
      raw?.weather?.wind?.gust,
      forecastList?.[0]?.wind?.gust
    );

    const curPop = pickNumber(
      raw?.current?.pop,
      raw?.weather?.pop,
      forecastList?.[0]?.pop
    );

    out.current = {
      temp: curTemp,
      weather: curWeatherArr,
      wind_speed: curWindSpeed,
      wind_gust: curWindGust,
      pop: curPop,
    };

    // --- HOURLY ---
    if (Array.isArray(raw?.hourly) && raw.hourly.length) {
      out.hourly = raw.hourly;
    } else if (forecastList && Array.isArray(forecastList) && forecastList.length) {
      // Derive: next 24 hours (8 x 3-hour blocks)
      out.hourly = forecastList.slice(0, 8).map((it) => ({
        dt: it.dt,
        temp: it?.main?.temp,
        weather: it?.weather || [],
        wind_speed: it?.wind?.speed,
        pop: it?.pop,
      }));
    }

    // --- DAILY ---
    if (Array.isArray(raw?.daily) && raw.daily.length) {
      out.daily = raw.daily;
    } else if (forecastList && Array.isArray(forecastList) && forecastList.length) {
      // Group forecast blocks by local date
      const byDay = new Map();

      for (const it of forecastList) {
        const dt = it?.dt;
        if (!dt) continue;
        const d = new Date(dt * 1000);
        const key = d.toDateString();

        const temp = pickNumber(it?.main?.temp, it?.main?.temp_max, it?.main?.temp_min);
        const tMin = pickNumber(it?.main?.temp_min, temp);
        const tMax = pickNumber(it?.main?.temp_max, temp);
        const pop = pickNumber(it?.pop, 0);
        const hour = d.getHours();

        if (!byDay.has(key)) {
          byDay.set(key, {
            dt,
            min: tMin ?? 999,
            max: tMax ?? -999,
            popMax: pop ?? 0,
            icon: it?.weather?.[0]?.icon || null,
            main: it?.weather?.[0]?.main || "",
            // try to capture a midday icon if possible
            middayIcon: null,
            middayMain: "",
          });
        }

        const day = byDay.get(key);
        if (typeof tMin === "number") day.min = Math.min(day.min, tMin);
        if (typeof tMax === "number") day.max = Math.max(day.max, tMax);
        if (typeof pop === "number") day.popMax = Math.max(day.popMax, pop);

        if (hour >= 11 && hour <= 14 && it?.weather?.[0]?.icon) {
          day.middayIcon = it.weather[0].icon;
          day.middayMain = it.weather[0].main || "";
        }
      }

      out.daily = Array.from(byDay.values())
        .slice(0, 7)
        .map((d) => ({
          dt: d.dt,
          temp: { min: d.min, max: d.max },
          weather: [
            {
              icon: d.middayIcon || d.icon || "01d",
              main: d.middayMain || d.main || "",
            },
          ],
          pop: d.popMax,
        }));
    }

    return out;
  }

  /* ---------- PLAYABILITY ---------- */
  function calculatePlayability(norm) {
    const c = norm?.current;
    if (!c) return "--";

    let score = 10;
    const wind = pickNumber(c.wind_speed, 0) || 0;
    const temp = pickNumber(c.temp, null);

    if (wind > (getUnits() === "imperial" ? 22 : 10)) score -= 3;
    else if (wind > (getUnits() === "imperial" ? 13 : 6)) score -= 2;

    if (typeof temp === "number") {
      if (getUnits() === "metric") {
        if (temp < 4 || temp > 30) score -= 2;
      } else {
        if (temp < 40 || temp > 86) score -= 2;
      }
    }

    const main = c.weather?.[0]?.main?.toLowerCase?.() || "";
    const desc = c.weather?.[0]?.description?.toLowerCase?.() || "";
    if (main.includes("rain") || desc.includes("rain")) score -= 3;

    return clamp(Math.round(score), 0, 10);
  }

  /* ---------- BEST TIME TODAY (daylight only) ---------- */
  function bestTimeToday(norm) {
    const sunrise = norm?.meta?.sunrise;
    const sunset = norm?.meta?.sunset;
    const hourly = norm?.hourly || [];

    if (!sunrise || !sunset || !hourly.length) return null;

    const start = sunrise + 3600; // +1h
    const end = sunset - 3600; // -1h

    const candidates = hourly
      .filter((h) => typeof h?.dt === "number" && h.dt >= start && h.dt <= end)
      .map((h) => {
        const pop = pickNumber(h.pop, 0) || 0;
        const wind = pickNumber(h.wind_speed, 0) || 0;
        const temp = pickNumber(h.temp, null);
        // scoring: lower pop, lower wind, comfy temp
        const comfyCenter = getUnits() === "imperial" ? 68 : 20;
        const tempPenalty = typeof temp === "number" ? Math.abs(temp - comfyCenter) : 10;
        const score = pop * 100 + wind * 5 + tempPenalty; // smaller is better
        return { h, score };
      });

    if (!candidates.length) return null;

    candidates.sort((a, b) => a.score - b.score);
    return candidates[0].h;
  }

  /* ---------- RENDER HELPERS ---------- */
  function renderHeaderCard() {
    if (!selectedPlace) return "";

    return `
      <div class="ff-card">
        <div class="ff-sub">${esc(selectedPlace.name)}</div>
        <div class="muted">${esc(selectedPlace.subtitle || "")}</div>
      </div>
    `;
  }

  function renderCurrent(norm) {
    const c = norm?.current || {};
    const icon = c.weather?.[0]?.icon;
    const tempNum = pickNumber(c.temp, null);
    const temp = typeof tempNum === "number" ? `${Math.round(tempNum)}°` : "--°";

    const desc = c.weather?.[0]?.description || c.weather?.[0]?.main || "";

    const wind = pickNumber(c.wind_speed, null);
    const gust = pickNumber(c.wind_gust, null);
    const pop = pickNumber(c.pop, null);

    const sunrise = fmtTime(norm?.meta?.sunrise);
    const sunset = fmtTime(norm?.meta?.sunset);

    const best = bestTimeToday(norm);
    const bestLine = best
      ? `${fmtTime(best.dt)} · ${Math.round(best.temp ?? 0)}° · ${Math.round((best.pop || 0) * 100)}% rain · ${Math.round(best.wind_speed || 0)} ${unitWind()}`
      : null;

    resultsEl.innerHTML = `
      ${renderHeaderCard()}

      <div class="ff-card">
        <div class="ff-row">
          ${
            icon
              ? `<img class="ff-icon" alt="" src="https://openweathermap.org/img/wn/${icon}@2x.png" />`
              : ""
          }
          <div>
            <div class="ff-big">${esc(temp)}</div>
            <div class="ff-sub">${esc(desc)}</div>
          </div>
        </div>

        <div class="ff-metrics">
          <div>Wind ${wind ?? "--"} ${unitWind()}</div>
          <div>Gust ${gust ?? "--"} ${unitWind()}</div>
          <div>Rain chance ${pop == null ? "--" : Math.round(pop * 100)}%</div>
        </div>

        <div class="ff-metrics" style="margin-top:10px">
          <div>Sunrise ${sunrise}</div>
          <div>Sunset ${sunset}</div>
          <div>${bestLine ? `Best time ${esc(bestLine)}` : "Best time: --"}</div>
        </div>
      </div>
    `;

    if (playabilityScoreEl) {
      playabilityScoreEl.textContent = `${calculatePlayability(norm)}/10`;
    }
  }

  function renderHourly(norm) {
    const list = norm?.hourly || [];
    if (!list.length) {
      showMessage("Hourly data not available.");
      return;
    }

    resultsEl.innerHTML = `
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-sub">Hourly</div>
        <div class="muted">Next 24 hours (3-hour blocks)</div>
        <div class="ff-hourly">
          ${list
            .slice(0, 8)
            .map((h) => {
              const time = fmtTime(h.dt);
              const icon = h?.weather?.[0]?.icon
                ? `https://openweathermap.org/img/wn/${h.weather[0].icon}@2x.png`
                : "";
              const pop = Math.round((pickNumber(h.pop, 0) || 0) * 100);
              const wind = Math.round(pickNumber(h.wind_speed, 0) || 0);
              const t = pickNumber(h.temp, null);
              return `
                <div class="ff-hour">
                  <div class="ff-hour-time">${esc(time)}</div>
                  ${icon ? `<img alt="" src="${icon}">` : ""}
                  <div class="ff-hour-temp">${t == null ? "--" : Math.round(t)}°</div>
                  <div class="ff-hour-meta">${pop}% · ${wind} ${unitWind()}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderDaily(norm) {
    const list = norm?.daily || [];
    if (!list.length) {
      showMessage("Daily forecast not available.");
      return;
    }

    resultsEl.innerHTML = `
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-sub">Daily</div>
        <div class="muted">Up to 7 days</div>
        <div class="ff-daily">
          ${list
            .slice(0, 7)
            .map((d) => {
              const date = new Date(d.dt * 1000).toLocaleDateString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
              const icon = d?.weather?.[0]?.icon
                ? `https://openweathermap.org/img/wn/${d.weather[0].icon}@2x.png`
                : "";
              const main = d?.weather?.[0]?.main || "";
              const max = pickNumber(d?.temp?.max, d?.max, null);
              const min = pickNumber(d?.temp?.min, d?.min, null);
              const pop = Math.round((pickNumber(d.pop, 0) || 0) * 100);

              return `
                <div class="ff-day">
                  <div class="ff-day-date">${esc(date)}</div>
                  ${icon ? `<img alt="" src="${icon}">` : ""}
                  <div class="ff-day-desc">${esc(main)} · ${pop}%</div>
                  <div class="ff-day-temp">
                    ${max == null ? "--" : Math.round(max)}° ${min == null ? "" : `${Math.round(min)}°`}
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderActiveTab() {
    if (!lastNorm) return;
    if (activeTab === "hourly") renderHourly(lastNorm);
    else if (activeTab === "daily") renderDaily(lastNorm);
    else renderCurrent(lastNorm);
  }

  /* ---------- SEARCH UI ---------- */
  function renderCourseResults(courses) {
    if (!Array.isArray(courses) || !courses.length) {
      showMessage('No courses found. Try a city (e.g. "Swindon") or include "golf / club / gc".');
      return;
    }

    // Update datalist suggestions (top 10)
    if (suggestions) {
      suggestions.innerHTML = courses
        .slice(0, 10)
        .map((c) => `<option value="${esc(c.name || c.course_name || "")}"></option>`)
        .join("");
    }

    resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub">Results</div>
        <div class="muted">Tap a course to load forecast</div>
      </div>

      <div class="ff-card">
        <div class="ff-results-list">
          ${courses
            .slice(0, 25)
            .map((c, idx) => {
              const name = c.name || c.course_name || c.club_name || "Course";
              const city = c.city || "";
              const region = c.state || c.county || "";
              const country = c.country || "";
              const subtitle = [city, region, country].filter(Boolean).join(", ");
              const lat = c.lat;
              const lon = c.lon;
              return `
                <button class="ff-result" type="button"
                  data-idx="${idx}"
                  data-lat="${esc(lat)}"
                  data-lon="${esc(lon)}"
                  data-name="${esc(name)}"
                  data-subtitle="${esc(subtitle)}">
                  <div class="ff-result-title">${esc(name)}</div>
                  <div class="ff-result-sub muted">${esc(subtitle)}</div>
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    // Click handler (delegated)
    resultsEl.querySelectorAll(".ff-result").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const lat = Number(btn.dataset.lat);
        const lon = Number(btn.dataset.lon);
        const name = btn.dataset.name || "Selected course";
        const subtitle = btn.dataset.subtitle || "";

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          showMessage("This course is missing coordinates.");
          return;
        }

        selectedPlace = { name, subtitle, lat, lon, type: "course" };
        await loadWeatherForSelected();
      });
    });
  }

  async function loadWeatherForSelected() {
    if (!selectedPlace) return;
    try {
      showMessage("Loading forecast…");
      const raw = await fetchWeatherByCoords(selectedPlace.lat, selectedPlace.lon);
      lastRaw = raw;
      lastNorm = normalizeWeather(raw);
      renderActiveTab();
    } catch (e) {
      console.error(e);
      showMessage("Weather unavailable for this location. Try another result.");
    }
  }

  async function runSearch() {
    const q = (searchInput?.value || "").trim();
    if (!q) {
      showMessage("Type a town/city or golf course name.");
      return;
    }

    // Always keep search working: try course search first (most reliable),
    // then city weather fallback if supported by worker.
    try {
      showMessage("Searching…");
      const courses = await fetchCourses(q);
      if (courses.length) {
        renderCourseResults(courses);
        return;
      }
    } catch (e) {
      console.error(e);
      // Continue to fallback below
    }

    // City fallback (only if your worker supports /weather?q=)
    try {
      showMessage("Looking up city…");
      selectedPlace = { name: q, subtitle: "", lat: null, lon: null, type: "city" };
      const raw = await fetchWeatherByQuery(q);
      lastRaw = raw;
      lastNorm = normalizeWeather(raw);

      // If worker provides coords inside raw.current.coord or raw.coord, keep them
      const lat = pickNumber(raw?.current?.coord?.lat, raw?.coord?.lat, null);
      const lon = pickNumber(raw?.current?.coord?.lon, raw?.coord?.lon, null);
      if (typeof lat === "number" && typeof lon === "number") {
        selectedPlace.lat = lat;
        selectedPlace.lon = lon;
      }

      renderActiveTab();
    } catch (e) {
      console.error(e);
      showMessage('No results. Try a golf course name (or include "golf / club / gc").');
    }
  }

  /* ---------- OPTIONAL: GEOLOCATION (graceful) ---------- */
  async function runGeo() {
    if (!navigator.geolocation) {
      showMessage("Geolocation not supported. Please search manually.");
      return;
    }

    showMessage("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos?.coords?.latitude;
        const lon = pos?.coords?.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          showMessage("Could not read your location. Please search manually.");
          return;
        }

        // Best-effort: load weather for your exact location (always useful),
        // and keep manual course search available.
        selectedPlace = { name: "Your location", subtitle: `Within ${NEAR_ME_RADIUS_MILES} miles`, lat, lon, type: "geo" };

        try {
          const raw = await fetchWeatherByCoords(lat, lon);
          lastRaw = raw;
          lastNorm = normalizeWeather(raw);
          renderActiveTab();
          // We DO NOT attempt “courses near me” unless your API supports it, to avoid breaking search.
        } catch (e) {
          console.error(e);
          showMessage("Location weather unavailable. Please search manually.");
        }
      },
      (err) => {
        console.error(err);
        showMessage("Location permission denied. Please search manually.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  /* ---------- EVENTS (attached once) ---------- */
  searchBtn?.addEventListener("click", runSearch);

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  geoBtn?.addEventListener("click", runGeo);

  unitsSelect?.addEventListener("change", async () => {
    // If we have coords, re-fetch in new units for correctness.
    if (selectedPlace?.lat != null && selectedPlace?.lon != null) {
      await loadWeatherForSelected();
    } else if (lastRaw) {
      // fallback: just re-render
      lastNorm = normalizeWeather(lastRaw);
      renderActiveTab();
    }
  });

  tabCurrent?.addEventListener("click", () => {
    setActiveTab(tabCurrent, "current");
    if (lastNorm) renderCurrent(lastNorm);
    else showMessage("Search for a town, city or golf course — or use ⌖ to use your location.");
  });

  tabHourly?.addEventListener("click", () => {
    setActiveTab(tabHourly, "hourly");
    if (lastNorm) renderHourly(lastNorm);
    else showMessage("Search first to view hourly forecast.");
  });

  tabDaily?.addEventListener("click", () => {
    setActiveTab(tabDaily, "daily");
    if (lastNorm) renderDaily(lastNorm);
    else showMessage("Search first to view daily forecast.");
  });

  /* ---------- INITIAL ---------- */
  showMessage("Search for a town/city or golf course — then tap a result to load weather.");
})();
