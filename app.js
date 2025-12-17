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

  function unitTemp() {
    return getUnits() === "imperial" ? "°F" : "°C";
  }

  function unitWind() {
    return getUnits() === "imperial" ? "mph" : "m/s";
  }

  function toLocalTimeHHMM(unixSeconds) {
    if (!Number.isFinite(unixSeconds)) return "—";
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function toLocalDayLabel(unixSeconds) {
    if (!Number.isFinite(unixSeconds)) return "";
    const d = new Date(unixSeconds * 1000);
    return d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
  }

  /* ---------- DISTANCE (for “near me”) ---------- */
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function kmToMiles(km) {
    return km * 0.621371;
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
    const url = `${API_BASE}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${encodeURIComponent(
      units
    )}`;

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

  /* ---------- WEATHER SHAPE HELPERS (current can be OneCall OR Current Weather) ---------- */
  function getCurrentNode(data) {
    return data?.current || data?.now || null;
  }

  function getCurrentMain(data) {
    const c = getCurrentNode(data);
    // OneCall: c.temp ; CurrentWeather: c.main.temp
    return c?.main || null;
  }

  function getCurrentTemp(data) {
    const c = getCurrentNode(data);
    const main = getCurrentMain(data);
    const t = c?.temp ?? main?.temp;
    return Number.isFinite(Number(t)) ? Number(t) : null;
  }

  function getCurrentFeels(data) {
    const c = getCurrentNode(data);
    const main = getCurrentMain(data);
    const t = c?.feels_like ?? main?.feels_like;
    return Number.isFinite(Number(t)) ? Number(t) : null;
  }

  function getCurrentWind(data) {
    const c = getCurrentNode(data);
    const w = c?.wind || c?.wind_speed != null ? c : null;

    // OneCall: wind_speed; CurrentWeather: wind.speed
    const s = c?.wind?.speed ?? c?.wind_speed ?? c?.windSpeed ?? c?.wind?.spd ?? c?.wind_speed;
    return Number.isFinite(Number(s)) ? Number(s) : null;
  }

  function getCurrentGust(data) {
    const c = getCurrentNode(data);
    // OneCall: wind_gust; CurrentWeather: wind.gust
    const g = c?.wind?.gust ?? c?.wind_gust ?? c?.gust;
    return Number.isFinite(Number(g)) ? Number(g) : null;
  }

  function getCurrentHumidity(data) {
    const c = getCurrentNode(data);
    const main = getCurrentMain(data);
    const h = c?.humidity ?? main?.humidity;
    return Number.isFinite(Number(h)) ? Number(h) : null;
  }

  function getCurrentPop(data) {
    // sometimes worker may attach pop to current; if not, we’ll use forecast slot for “best tee time”
    const c = getCurrentNode(data);
    const p = c?.pop ?? c?.rain_chance ?? c?.rainChance;
    return Number.isFinite(Number(p)) ? Number(p) : null;
  }

  function getCurrentWeatherArr(data) {
    const c = getCurrentNode(data);
    return Array.isArray(c?.weather) ? c.weather : [];
  }

  function getCurrentIcon(data) {
    const w0 = getCurrentWeatherArr(data)?.[0];
    return w0?.icon ? String(w0.icon) : null;
  }

  function getCurrentDesc(data) {
    const w0 = getCurrentWeatherArr(data)?.[0];
    return String(w0?.description || w0?.main || "—");
  }

  function getSunriseSunset(data) {
    const c = getCurrentNode(data);
    // OneCall: sunrise/sunset at root current; CurrentWeather: sys.sunrise/sys.sunset
    const sunrise = c?.sunrise ?? c?.sys?.sunrise ?? data?.sys?.sunrise;
    const sunset = c?.sunset ?? c?.sys?.sunset ?? data?.sys?.sunset;
    return {
      sunrise: Number.isFinite(Number(sunrise)) ? Number(sunrise) : null,
      sunset: Number.isFinite(Number(sunset)) ? Number(sunset) : null,
    };
  }

  function getForecastList(data) {
    // Worker screenshot showed { current: {...}, forecast: { list: [...] } }
    const list = data?.forecast?.list ?? data?.list ?? data?.forecast ?? null;
    return Array.isArray(list) ? list : [];
  }

  /* ---------- PLAYABILITY ---------- */
  function calculatePlayability(data) {
    const cNode = getCurrentNode(data);
    if (!cNode) return "--";

    let score = 10;

    const wind = Number(getCurrentWind(data) ?? 0);
    const temp = Number(getCurrentTemp(data) ?? 10);

    const wMain = (getCurrentWeatherArr(data)?.[0]?.main || "").toLowerCase();
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

    if (rainish) score -= 3;

    const whole = Math.max(0, Math.min(10, Math.round(score)));
    return whole;
  }

  /* ---------- BEST TEE TIME (daytime only) ---------- */
  function computeBestTeeTime(data) {
    const list = getForecastList(data);
    if (!list.length) return null;

    const { sunrise, sunset } = getSunriseSunset(data);

    // If sunrise/sunset missing, still try daytime-ish (08:00–18:00 local) fallback
    const hasSun = Number.isFinite(sunrise) && Number.isFinite(sunset);

    const units = getUnits();
    const tempComfort = (t) => {
      if (!Number.isFinite(t)) return 0;
      if (units === "imperial") {
        if (t >= 55 && t <= 72) return 2;
        if (t >= 46 && t <= 75) return 1;
        return 0;
      }
      if (t >= 12 && t <= 20) return 2;
      if (t >= 8 && t <= 24) return 1;
      return 0;
    };

    const isDaySlot = (dt) => {
      if (!Number.isFinite(dt)) return false;
      const t = dt * 1000;
      if (hasSun) return t >= sunrise * 1000 && t <= sunset * 1000;
      const d = new Date(t);
      const h = d.getHours();
      return h >= 8 && h <= 18;
    };

    // Score: lower pop, lower wind, comfy temp, prefer earlier in day slightly
    function slotScore(slot) {
      const dt = Number(slot?.dt);
      const main = slot?.main || {};
      const wind = slot?.wind || {};
      const pop = Number.isFinite(Number(slot?.pop)) ? Number(slot.pop) : 0;

      const temp = Number.isFinite(Number(main?.temp)) ? Number(main.temp) : NaN;
      const w = Number.isFinite(Number(wind?.speed)) ? Number(wind.speed) : 0;

      let score = 0;

      // Rain chance is big
      score += (1 - Math.min(1, Math.max(0, pop))) * 5;

      // Wind
      if (units === "imperial") {
        // mph: <10 great, <15 ok
        if (w < 10) score += 3;
        else if (w < 15) score += 2;
        else if (w < 20) score += 1;
      } else {
        // m/s: <5 great, <7 ok
        if (w < 5) score += 3;
        else if (w < 7) score += 2;
        else if (w < 10) score += 1;
      }

      // Temp comfort
      score += tempComfort(temp);

      // Slight preference for “midday-ish”
      if (Number.isFinite(dt)) {
        const h = new Date(dt * 1000).getHours();
        if (h >= 11 && h <= 15) score += 0.5;
      }

      return score;
    }

    // Prefer today if possible, else earliest day with daytime slots
    const now = Date.now();
    const slotsDaytime = list
      .filter((s) => Number.isFinite(Number(s?.dt)))
      .filter((s) => s.dt * 1000 >= now - 30 * 60 * 1000) // allow last 30 mins
      .filter((s) => isDaySlot(Number(s.dt)));

    if (!slotsDaytime.length) return null;

    // pick max score; tie-break earlier
    let best = slotsDaytime[0];
    let bestScore = slotScore(best);

    for (const s of slotsDaytime.slice(1)) {
      const sc = slotScore(s);
      if (sc > bestScore + 1e-9) {
        best = s;
        bestScore = sc;
      } else if (Math.abs(sc - bestScore) < 1e-9 && s.dt < best.dt) {
        best = s;
      }
    }

    const dt = Number(best.dt);
    const main = best.main || {};
    const wind = best.wind || {};
    const weather0 = Array.isArray(best.weather) ? best.weather[0] : null;

    return {
      dt,
      time: new Date(dt * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      day: toLocalDayLabel(dt),
      temp: Number.isFinite(Number(main.temp)) ? Number(main.temp) : null,
      pop: Number.isFinite(Number(best.pop)) ? Number(best.pop) : 0,
      wind: Number.isFinite(Number(wind.speed)) ? Number(wind.speed) : null,
      icon: weather0?.icon ? String(weather0.icon) : null,
      desc: String(weather0?.description || weather0?.main || ""),
    };
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
      const dist = typeof c._distanceMiles === "number" ? `${c._distanceMiles.toFixed(1)} mi` : "";
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

  /* ---------- RENDER: CURRENT / HOURLY / DAILY ---------- */
  function renderHeader(course) {
    if (!course) return "";
    const name = esc(course.name || course.course_name || course.club_name || "Selected course");
    const city = esc(course.city || "");
    const state = esc(course.state || "");
    const country = esc(course.country || "");
    const addr = [city, state, country].filter(Boolean).join(", ");

    return `
      <div class="ff-card">
        <div class="ff-sub muted">${name}</div>
        ${addr ? `<div class="ff-sub">${addr}</div>` : ""}
      </div>
    `;
  }

  function renderCurrent(data) {
    if (!resultsEl) return;

    const temp = getCurrentTemp(data);
    const feels = getCurrentFeels(data);
    const wind = getCurrentWind(data);
    const gust = getCurrentGust(data);
    const hum = getCurrentHumidity(data);
    const desc = esc(getCurrentDesc(data));
    const iconId = getCurrentIcon(data);

    const { sunrise, sunset } = getSunriseSunset(data);
    const sunriseStr = sunrise ? toLocalTimeHHMM(sunrise) : "—";
    const sunsetStr = sunset ? toLocalTimeHHMM(sunset) : "—";

    const icon = iconId ? `https://openweathermap.org/img/wn/${iconId}@2x.png` : "";
    const tempStr = temp == null ? `--${unitTemp()}` : `${Math.round(temp)}${unitTemp()}`;
    const feelsStr = feels == null ? "" : `${Math.round(feels)}${unitTemp()}`;

    const best = computeBestTeeTime(data);
    const bestHtml = best
      ? `
        <div class="ff-card">
          <div class="ff-sub muted">Best time to play</div>
          <div class="ff-row" style="align-items:center; gap:12px;">
            ${
              best.icon
                ? `<img class="ff-icon" alt="" src="https://openweathermap.org/img/wn/${esc(best.icon)}@2x.png" style="width:44px; height:44px;" />`
                : ""
            }
            <div>
              <div class="ff-big" style="font-size:20px; line-height:1.2;">${esc(best.day)} · ${esc(best.time)}</div>
              <div class="ff-sub">
                ${best.temp == null ? "--" : Math.round(best.temp)}
                ${unitTemp()} · ${Math.round(best.pop * 100)}% rain · ${best.wind == null ? "--" : best.wind.toFixed(1)} ${unitWind()}
              </div>
            </div>
          </div>
        </div>
      `
      : "";

    resultsEl.innerHTML = `
      ${renderHeader(selectedCourse)}
      <div class="ff-card">
        <div class="ff-row" style="align-items:center;">
          ${icon ? `<img class="ff-icon" alt="" src="${icon}" />` : ""}
          <div>
            <div class="ff-big">${tempStr}</div>
            <div class="ff-sub">${desc}${feelsStr ? ` · feels like ${esc(feelsStr)}` : ""}</div>
          </div>
        </div>

        <div class="ff-metrics" style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <div class="ff-pill">Wind ${wind == null ? "--" : wind.toFixed(1)} ${unitWind()}</div>
          <div class="ff-pill">Gust ${gust == null ? "--" : gust.toFixed(1)} ${unitWind()}</div>
          <div class="ff-pill">Humidity ${hum == null ? "--" : Math.round(hum)}%</div>
        </div>

        <div class="ff-metrics" style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
          <div class="ff-pill">Sunrise ${esc(sunriseStr)}</div>
          <div class="ff-pill">Sunset ${esc(sunsetStr)}</div>
        </div>
      </div>

      ${bestHtml}
    `;

    const score = calculatePlayability(data);
    if (playabilityScoreEl) playabilityScoreEl.textContent = `${score}/10`;
  }

  function renderHourly(data) {
    if (!resultsEl) return;

    const list = getForecastList(data);
    if (!list.length) {
      resultsEl.innerHTML = `${renderHeader(selectedCourse)}<div class="ff-card muted">Hourly data not available.</div>`;
      return;
    }

    // Next 24h of 3-hour blocks => 8 items
    const now = Date.now();
    const next = list
      .filter((x) => Number.isFinite(Number(x?.dt)))
      .filter((x) => x.dt * 1000 >= now - 30 * 60 * 1000)
      .slice(0, 8);

    const cards = next.map((x) => {
      const t = new Date(x.dt * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      const temp = Number.isFinite(Number(x?.main?.temp)) ? Math.round(Number(x.main.temp)) : "--";
      const pop = Number.isFinite(Number(x?.pop)) ? Math.round(Number(x.pop) * 100) : 0;
      const wind = Number.isFinite(Number(x?.wind?.speed)) ? Number(x.wind.speed).toFixed(1) : "--";
      const icon = Array.isArray(x.weather) && x.weather[0]?.icon ? x.weather[0].icon : null;

      return `
        <div class="ff-hour">
          <div class="ff-hour-time">${esc(t)}</div>
          ${
            icon
              ? `<img class="ff-hour-icon" alt="" src="https://openweathermap.org/img/wn/${esc(icon)}@2x.png" />`
              : `<div class="ff-hour-icon"></div>`
          }
          <div class="ff-hour-temp">${esc(temp)}${unitTemp()}</div>
          <div class="ff-hour-sub">${esc(pop)}%</div>
          <div class="ff-hour-sub">${esc(wind)} ${unitWind()}</div>
        </div>
      `;
    });

    resultsEl.innerHTML = `
      ${renderHeader(selectedCourse)}
      <div class="ff-card">
        <div class="ff-sub muted">Hourly</div>
        <div class="ff-sub muted">Next 24 hours (3-hour blocks)</div>
        <div class="ff-hourly-scroll">
          ${cards.join("")}
        </div>
      </div>
    `;
  }

  function renderDaily(data) {
    if (!resultsEl) return;

    const list = getForecastList(data);
    if (!list.length) {
      resultsEl.innerHTML = `${renderHeader(selectedCourse)}<div class="ff-card muted">Daily data not available.</div>`;
      return;
    }

    // Derive up to 7 days from 3-hour forecast: min/max + max pop + representative icon (most frequent)
    const byDay = new Map(); // key yyyy-mm-dd

    for (const x of list) {
      const dt = Number(x?.dt);
      if (!Number.isFinite(dt)) continue;
      const d = new Date(dt * 1000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      const temp = Number.isFinite(Number(x?.main?.temp)) ? Number(x.main.temp) : null;
      const pop = Number.isFinite(Number(x?.pop)) ? Number(x.pop) : 0;
      const icon = Array.isArray(x.weather) && x.weather[0]?.icon ? x.weather[0].icon : null;
      const main = Array.isArray(x.weather) && x.weather[0]?.main ? String(x.weather[0].main) : "";

      const cur = byDay.get(key) || {
        key,
        dt,
        tMin: temp ?? Infinity,
     
