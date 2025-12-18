/* =====================================================
   Fairway Forecast – app.js
   Stable, crash-safe, mobile-first
   Search: city/course → pick result → current/hourly/daily
   Weather: supports multiple response shapes + derives from list[]
   Extras:
   - Verdict card (PLAY / PLAYABLE / NO-PLAY) front-and-centre
   - Best tee time with “no recommendation” when rain likely all day
   - Suggestions while typing (debounced + cached + 429-aware)
   - Favourites (localStorage)
   ===================================================== */

(() => {
  "use strict";

  /* ---------- CONFIG ---------- */
  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const MAX_RESULTS = 12;

  // Suggestions throttling (helps avoid 429 from upstream)
  const SUGGEST_MIN_CHARS = 3;
  const SUGGEST_DEBOUNCE_MS = 550;
  const SUGGEST_COOLDOWN_MS = 1800;

  // Cache (memory) – reduces upstream hits
  const COURSE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 mins
  const WEATHER_CACHE_TTL_MS = 3 * 60 * 1000; // 3 mins

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  const searchInput = $("searchInput");
  const searchBtn = $("searchBtn");
  const resultsEl = $("results");
  const playabilityScoreEl = $("playabilityScore");

  const tabCurrent = $("tabCurrent");
  const tabHourly = $("tabHourly");
  const tabDaily = $("tabDaily");

  const geoBtn = $("btnGeo") || $("geoBtn"); // optional
  const unitsSelect = $("unitsSelect") || $("units"); // optional
  const suggestionsEl = $("searchSuggestions"); // optional datalist

  // Verdict card (in your HTML)
  const verdictCard = $("verdictCard");
  const verdictIcon = $("verdictIcon");
  const verdictLabel = $("verdictLabel");
  const verdictReason = $("verdictReason");
  const verdictBestTime = $("verdictBestTime");

  if (!resultsEl) {
    console.warn("Missing #results – app halted safely.");
    return;
  }

  /* ---------- STATE ---------- */
  let selectedCourse = null; // { name, city, state, country, lat, lon, id }
  let lastRawWeather = null; // raw worker response
  let lastNorm = null; // normalized { current, hourly, daily, sunrise, sunset }
  let activeTab = "current";
  let initialized = false;

  /* ---------- LOCAL STORAGE (FAVOURITES) ---------- */
  const LS_FAVS = "ff_favourites_v1";

  function loadFavs() {
    try {
      const raw = localStorage.getItem(LS_FAVS);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveFavs(list) {
    try {
      localStorage.setItem(LS_FAVS, JSON.stringify(list));
    } catch {}
  }

  function favKey(course) {
    // Prefer stable id if provided, else lat/lon rounded
    const id = course?.id ? String(course.id) : "";
    const lat = Number(course?.lat);
    const lon = Number(course?.lon);
    if (id) return `id:${id}`;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return `ll:${lat.toFixed(5)},${lon.toFixed(5)}`;
    return `name:${(course?.name || "").toLowerCase()}`;
  }

  function isFavourited(course) {
    const favs = loadFavs();
    const key = favKey(course);
    return favs.some((f) => f?.key === key);
  }

  function toggleFavourite(course) {
    if (!course) return;
    const favs = loadFavs();
    const key = favKey(course);
    const idx = favs.findIndex((f) => f?.key === key);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.unshift({
        key,
        id: course.id ?? null,
        name: course.name ?? "",
        city: course.city ?? "",
        state: course.state ?? "",
        country: course.country ?? "",
        lat: course.lat ?? null,
        lon: course.lon ?? null,
        addedAt: Date.now(),
      });
      // Keep tidy
      if (favs.length > 24) favs.length = 24;
    }
    saveFavs(favs);
    renderFavsStrip(); // refresh UI
    renderVerdictCard(lastNorm); // keep star state consistent
  }

  /* ---------- HELPERS ---------- */
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  const units = () => (unitsSelect?.value === "imperial" ? "imperial" : "metric");
  const windUnit = () => (units() === "imperial" ? "mph" : "m/s");
  const tempUnit = () => (units() === "imperial" ? "°F" : "°C");

  function setActiveTab(next) {
    activeTab = next;
    [tabCurrent, tabHourly, tabDaily].forEach((b) => b?.classList.remove("active"));
    if (next === "current") tabCurrent?.classList.add("active");
    if (next === "hourly") tabHourly?.classList.add("active");
    if (next === "daily") tabDaily?.classList.add("active");
  }

  function showMessage(msg) {
    resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  }

  function showError(msg, extra = "") {
    const hint = extra ? `<div class="ff-sub muted" style="margin-top:8px">${esc(extra)}</div>` : "";
    resultsEl.innerHTML = `<div class="ff-card"><div class="ff-big">⚠️</div><div>${esc(
      msg
    )}</div>${hint}</div>`;
  }

  function fmtTime(tsSeconds) {
    if (!tsSeconds) return "--:--";
    return new Date(tsSeconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDay(tsSeconds) {
    return new Date(tsSeconds * 1000).toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  /* ---------- SIMPLE IN-MEMORY CACHE ---------- */
  const memCache = {
    courses: new Map(), // key -> { t, data }
    weather: new Map(), // key -> { t, data }
  };

  function cacheGet(map, key, ttlMs) {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > ttlMs) {
      map.delete(key);
      return null;
    }
    return hit.data;
  }

  function cacheSet(map, key, data) {
    map.set(key, { t: Date.now(), data });
  }

  /* ---------- API ---------- */
  async function apiGet(path) {
    const url = `${API_BASE}${path}`;
    const res = await fetch(url, { method: "GET" });

    // Handle rate-limit gracefully
    if (res.status === 429) {
      const text = await res.text().catch(() => "");
      const err = new Error("HTTP 429 Too Many Requests");
      err.status = 429;
      err.body = text;
      throw err;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`HTTP ${res.status} ${res.statusText} ${text}`.trim());
      err.status = res.status;
      throw err;
    }

    return res.json();
  }

  async function fetchCourses(query) {
    const q = (query || "").trim();
    const cacheKey = `${units()}|${q.toLowerCase()}`;
    const cached = cacheGet(memCache.courses, cacheKey, COURSE_CACHE_TTL_MS);
    if (cached) return cached;

    const enc = encodeURIComponent(q);
    const data = await apiGet(`/courses?search=${enc}`);
    const list = Array.isArray(data?.courses) ? data.courses : [];
    cacheSet(memCache.courses, cacheKey, list);
    return list;
  }

  async function fetchWeather(lat, lon) {
    const u = units();
    const key = `${u}|${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
    const cached = cacheGet(memCache.weather, key, WEATHER_CACHE_TTL_MS);
    if (cached) return cached;

    const data = await apiGet(`/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${u}`);
    cacheSet(memCache.weather, key, data);
    return data;
  }

  /* ---------- NORMALIZE WEATHER SHAPES ---------- */
  function normalizeWeather(raw) {
    const norm = { current: null, hourly: [], daily: [], sunrise: null, sunset: null };
    if (!raw || typeof raw !== "object") return norm;

    norm.sunrise =
      raw?.current?.sunrise ??
      raw?.city?.sunrise ??
      raw?.weather?.sys?.sunrise ??
      raw?.current?.sys?.sunrise ??
      null;

    norm.sunset =
      raw?.current?.sunset ??
      raw?.city?.sunset ??
      raw?.weather?.sys?.sunset ??
      raw?.current?.sys?.sunset ??
      null;

    if (raw?.current && typeof raw.current === "object") {
      const c = raw.current;

      const temp =
        (typeof c.temp === "number" ? c.temp : null) ??
        (typeof c?.main?.temp === "number" ? c.main.temp : null) ??
        (typeof raw?.weather?.main?.temp === "number" ? raw.weather.main.temp : null) ??
        null;

      const weatherArr =
        Array.isArray(c.weather) ? c.weather : Array.isArray(raw?.weather?.weather) ? raw.weather.weather : [];

      norm.current = {
        dt: c.dt ?? raw?.dt ?? null,
        temp,
        feels_like:
          (typeof c.feels_like === "number" ? c.feels_like : null) ??
          (typeof c?.main?.feels_like === "number" ? c.main.feels_like : null) ??
          null,
        humidity:
          (typeof c.humidity === "number" ? c.humidity : null) ??
          (typeof c?.main?.humidity === "number" ? c.main.humidity : null) ??
          null,
        wind_speed:
          (typeof c?.wind?.speed === "number" ? c.wind.speed : null) ??
          (typeof c?.wind_speed === "number" ? c.wind_speed : null) ??
          (typeof raw?.weather?.wind?.speed === "number" ? raw.weather.wind.speed : null) ??
          null,
        wind_gust:
          (typeof c?.wind?.gust === "number" ? c.wind.gust : null) ??
          (typeof c?.wind_gust === "number" ? c.wind_gust : null) ??
          null,
        pop: typeof c.pop === "number" ? c.pop : null,
        weather: weatherArr,
      };
    }

    if (!norm.current && Array.isArray(raw?.list) && raw.list.length) {
      const first = raw.list[0];
      norm.current = {
        dt: first.dt ?? null,
        temp: typeof first?.main?.temp === "number" ? first.main.temp : null,
        feels_like: typeof first?.main?.feels_like === "number" ? first.main.feels_like : null,
        humidity: typeof first?.main?.humidity === "number" ? first.main.humidity : null,
        wind_speed: typeof first?.wind?.speed === "number" ? first.wind.speed : null,
        wind_gust: typeof first?.wind?.gust === "number" ? first.wind.gust : null,
        pop: typeof first?.pop === "number" ? first.pop : null,
        weather: Array.isArray(first?.weather) ? first.weather : [],
      };
    }

    if (Array.isArray(raw?.hourly) && raw.hourly.length) {
      norm.hourly = raw.hourly.map((h) => ({
        dt: h.dt,
        temp: h.temp ?? h?.main?.temp ?? null,
        pop: typeof h.pop === "number" ? h.pop : null,
        wind_speed: h.wind_speed ?? h?.wind?.speed ?? null,
        weather: Array.isArray(h.weather) ? h.weather : [],
      }));
    } else if (Array.isArray(raw?.list) && raw.list.length) {
      norm.hourly = raw.list.slice(0, 16).map((it) => ({
        dt: it.dt,
        temp: it?.main?.temp ?? null,
        pop: typeof it?.pop === "number" ? it.pop : null,
        wind_speed: it?.wind?.speed ?? null,
        weather: Array.isArray(it?.weather) ? it.weather : [],
      }));
    }

    if (Array.isArray(raw?.daily) && raw.daily.length) {
      norm.daily = raw.daily.map((d) => ({
        dt: d.dt,
        min: d?.temp?.min ?? d?.min ?? null,
        max: d?.temp?.max ?? d?.max ?? null,
        pop: typeof d.pop === "number" ? d.pop : null,
        weather: Array.isArray(d.weather) ? d.weather : [],
        icon: d?.weather?.[0]?.icon ?? d?.icon ?? null,
      }));
    } else if (Array.isArray(raw?.list) && raw.list.length) {
      const byDay = new Map();

      for (const it of raw.list) {
        const dt = it.dt;
        if (!dt) continue;

        const key = new Date(dt * 1000).toLocaleDateString();
        const tMin = it?.main?.temp_min;
        const tMax = it?.main?.temp_max;
        const pop = typeof it?.pop === "number" ? it.pop : null;

        if (!byDay.has(key)) {
          byDay.set(key, {
            dt,
            min: typeof tMin === "number" ? tMin : null,
            max: typeof tMax === "number" ? tMax : null,
            popMax: typeof pop === "number" ? pop : null,
            icon: it?.weather?.[0]?.icon ?? null,
            weatherMain: it?.weather?.[0]?.main ?? "",
            middayIcon: null,
            middayDt: null,
          });
        } else {
          const d = byDay.get(key);
          if (typeof tMin === "number") d.min = d.min === null ? tMin : Math.min(d.min, tMin);
          if (typeof tMax === "number") d.max = d.max === null ? tMax : Math.max(d.max, tMax);
          if (typeof pop === "number") d.popMax = d.popMax === null ? pop : Math.max(d.popMax, pop);

          const hour = new Date(dt * 1000).getHours();
          if (hour >= 11 && hour <= 14) {
            d.middayIcon = it?.weather?.[0]?.icon ?? d.middayIcon;
            d.middayDt = dt;
            d.weatherMain = it?.weather?.[0]?.main ?? d.weatherMain;
          }
        }
      }

      norm.daily = Array.from(byDay.values())
        .sort((a, b) => (a.dt ?? 0) - (b.dt ?? 0))
        .slice(0, 7)
        .map((d) => ({
          dt: d.dt,
          min: d.min,
          max: d.max,
          pop: d.popMax,
          icon: d.middayIcon || d.icon,
          weather: d.weatherMain ? [{ main: d.weatherMain, icon: d.middayIcon || d.icon }] : [],
        }));
    }

    return norm;
  }

  /* ---------- PLAYABILITY ---------- */
  function calculatePlayability(norm) {
    const c = norm?.current;
    if (!c) return "--";

    let score = 10;

    const w = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const temp = typeof c.temp === "number" ? c.temp : null;
    const pop = typeof c.pop === "number" ? c.pop : 0;

    if (w > 10) score -= 3;
    else if (w > 6) score -= 2;
    else if (w > 4) score -= 1;

    if (pop >= 0.7) score -= 3;
    else if (pop >= 0.4) score -= 2;
    else if (pop >= 0.2) score -= 1;

    if (temp !== null) {
      if (units() === "metric") {
        if (temp < 4) score -= 2;
        else if (temp < 8) score -= 1;
        if (temp > 30) score -= 2;
      } else {
        if (temp < 40) score -= 2;
        else if (temp < 46) score -= 1;
        if (temp > 86) score -= 2;
      }
    }

    return clamp(Math.round(score), 0, 10);
  }

  /* ---------- BEST TEE TIME (DAYLIGHT ONLY + RAIN GUARD) ---------- */
  function bestTimeToday(norm) {
    const sunrise = norm?.sunrise;
    const sunset = norm?.sunset;
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (!sunrise || !sunset || hourly.length === 0) return null;

    const start = sunrise + 3600; // +1h after sunrise
    const end = sunset - 3600; // -1h before sunset
    const candidates = hourly.filter((h) => typeof h.dt === "number" && h.dt >= start && h.dt <= end);
    if (candidates.length === 0) return null;

    // If it’s basically raining all day, do NOT recommend a tee time
    const pops = candidates
      .map((h) => (typeof h.pop === "number" ? h.pop : null))
      .filter((x) => typeof x === "number");
    if (pops.length) {
      const minPop = Math.min(...pops);
      const avgPop = pops.reduce((a, b) => a + b, 0) / pops.length;

      // Strong guardrails (fixes “100% rain but still recommends 12:00”)
      if (minPop >= 0.80 || avgPop >= 0.85) return null;
    }

    function slotScore(h) {
      const pop = typeof h.pop === "number" ? h.pop : 0.35;
      const wind = typeof h.wind_speed === "number" ? h.wind_speed : 5;
      const temp = typeof h.temp === "number" ? h.temp : null;

      const target = units() === "imperial" ? 65 : 18;
      const tempPenalty = temp === null ? 2 : Math.abs(temp - target) / 6;

      // lower is better
      return pop * 12 + wind * 0.9 + tempPenalty;
    }

    let best = candidates[0];
    let bestScore = slotScore(best);

    for (const c of candidates.slice(1)) {
      const s = slotScore(c);
      if (s < bestScore) {
        bestScore = s;
        best = c;
      }
    }

    return best;
  }

  /* ---------- VERDICT (PLAY / PLAYABLE / NO-PLAY) ---------- */
  function calculateVerdict(norm) {
    if (!norm?.current) {
      return {
        status: "NO",
        label: "No-play recommended",
        reason: "Weather data unavailable",
        best: null,
      };
    }

    const c = norm.current;
    const wind = typeof c.wind_speed === "number" ? c.wind_speed : 0;
    const popNow = typeof c.pop === "number" ? c.pop : null;
    const temp = typeof c.temp === "number" ? c.temp : null;

    const sunrise = norm.sunrise;
    const sunset = norm.sunset;
    const now = nowSec();

    // Daylight guard
    if (!sunrise || !sunset) {
      // still allow verdict, but lower confidence
    } else if (now > sunset - 3600) {
      return {
        status: "NO",
        label: "No-play recommended",
        reason: "Limited daylight remaining",
        best: null,
      };
    }

    const best = bestTimeToday(norm);

    // Scoring (0–100)
    let score = 100;

    // Wind penalties (metric m/s or imperial mph: we still treat value as “wind speed”)
    // If imperial, values are mph from OpenWeather. That’s fine; thresholds differ.
    if (units() === "metric") {
      if (wind > 12) score -= 45;
      else if (wind > 9) score -= 30;
      else if (wind > 6) score -= 18;
    } else {
      if (wind > 27) score -= 45;
      else if (wind > 20) score -= 30;
      else if (wind > 14) score -= 18;
    }

    // Rain penalties (use current pop if present)
    const pop = popNow ?? (typeof best?.pop === "number" ? best.pop : 0.25);
    if (pop >= 0.85) score -= 50;
    else if (pop >= 0.60) score -= 35;
    else if (pop >= 0.35) score -= 20;

    // Temp comfort
    if (temp !== null) {
      if (units() === "metric") {
        if (temp < 3 || temp > 30) score -= 25;
        else if (temp < 7 || temp > 27) score -= 12;
      } else {
        if (temp < 38 || temp > 86) score -= 25;
        else if (temp < 45 || temp > 82) score -= 12;
      }
    }

    // If no best time (rain likely all day), push verdict toward NO
    if (!best) score -= 18;

    score = clamp(Math.round(score), 0, 100);

    if (score >= 72) {
      return { status: "PLAY", label: "Play", reason: "Good overall conditions", best };
    }
    if (score >= 48) {
      return { status: "MAYBE", label: "Playable (tough)", reason: "Manageable, but expect challenges", best };
    }
    return { status: "NO", label: "No-play recommended", reason: best ? "Poor overall conditions" : "Rain likely throughout daylight", best };
  }

  function renderVerdictCard(norm) {
    if (!verdictCard || !verdictLabel || !verdictReason || !verdictIcon || !verdictBestTime) return;

    const v = calculateVerdict(norm);

    verdictCard.classList.remove("ff-verdict--play", "ff-verdict--maybe", "ff-verdict--no");

    if (v.status === "PLAY") {
      verdictCard.classList.add("ff-verdict--play");
      verdictIcon.textContent = "✅";
    } else if (v.status === "MAYBE") {
      verdictCard.classList.add("ff-verdict--maybe");
      verdictIcon.textContent = "⚠️";
    } else {
      verdictCard.classList.add("ff-verdict--no");
      verdictIcon.textContent = "⛔";
    }

    verdictLabel.textContent = v.label;
    verdictReason.textContent = v.reason;

    // Best tee time text
    if (v.best && typeof v.best.dt === "number") {
      const t = typeof v.best.temp === "number" ? `${Math.round(v.best.temp)}${tempUnit()}` : "--";
      verdictBestTime.textContent = `${fmtTime(v.best.dt)} (${t})`;
    } else {
      verdictBestTime.textContent = "—";
    }
  }

  /* ---------- RENDER ---------- */
  function renderHeaderCard() {
    const name = selectedCourse?.name || "Selected location";
    const line2 = [selectedCourse?.city, selectedCourse?.state, selectedCourse?.country].filter(Boolean).join(", ");
    const fav = selectedCourse ? isFavourited(selectedCourse) : false;

    // star button included inside the header card
    const starBtn = selectedCourse
      ? `<button type="button" class="ff-btn" id="favBtn" title="Favourite" style="width:44px;padding:0">${fav ? "★" : "☆"}</button>`
      : "";

    return `
      <div class="ff-card">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div>
            <div class="ff-big" style="font-size:1.2rem; line-height:1.2">${esc(name)}</div>
            ${line2 ? `<div class="ff-sub muted">${esc(line2)}</div>` : ""}
          </div>
          ${starBtn}
        </div>
      </div>
    `;
  }

  function renderFavsStrip() {
    const favs = loadFavs();
    const containerId = "ffFavsStrip";
    let el = document.getElementById(containerId);

    if (!el) {
      el = document.createElement("div");
      el.id = containerId;
      el.style.display = "flex";
      el.style.flexDirection = "column";
      el.style.gap = "10px";
      // Put it at top of results area
      resultsEl.prepend(el);
    }

    if (!favs.length) {
      el.innerHTML = "";
      return;
    }

    const items = favs.slice(0, 8);
    el.innerHTML = `
      <div class="ff-card">
        <div class="ff-sub muted">Favourites</div>
        <div class="ff-results-list" style="margin-top:10px">
          ${items
            .map((f) => {
              const line2 = [f.city, f.state, f.country].filter(Boolean).join(", ");
              const lat = f.lat;
              const lon = f.lon;
              return `
                <button type="button" class="ff-result ff-fav" data-name="${esc(f.name)}" data-city="${esc(
                f.city
              )}" data-state="${esc(f.state)}" data-country="${esc(f.country)}" data-lat="${esc(lat)}" data-lon="${esc(
                lon
              )}" data-id="${esc(f.id ?? "")}">
                  <div class="ff-result-title">★ ${esc(f.name)}</div>
                  ${line2 ? `<div class="ff-sub muted">${esc(line2)}</div>` : ""}
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderCurrent(norm) {
    const c = norm?.current;
    if (!c) {
      showMessage("Current weather not available.");
      renderVerdictCard(null);
      return;
    }

    const icon = c?.weather?.[0]?.icon;
    const desc = c?.weather?.[0]?.description || c?.weather?.[0]?.main || "";
    const t = typeof c.temp === "number" ? Math.round(c.temp) : null;

    const windVal = typeof c.wind_speed === "number" ? c.wind_speed.toFixed(1) : "--";
    const gustVal = typeof c.wind_gust === "number" ? c.wind_gust.toFixed(1) : "--";
    const popVal = typeof c.pop === "number" ? Math.round(c.pop * 100) : "--";

    const sr = norm.sunrise ? fmtTime(norm.sunrise) : "--:--";
    const ss = norm.sunset ? fmtTime(norm.sunset) : "--:--";

    const best = bestTimeToday(norm);
    const bestText = best
      ? `${fmtTime(best.dt)} · ${Math.round(best.temp)}${tempUnit()} · ${Math.round(
          (best.pop ?? 0) * 100
        )}% rain · ${typeof best.wind_speed === "number" ? best.wind_speed.toFixed(1) : "--"} ${windUnit()}`
      : "—";

    // Build results (verdict is separate card in DOM)
    resultsEl.innerHTML = `
      ${renderHeaderCard()}

      <div class="ff-card">
        <div class="ff-row">
          ${
            icon
              ? `<img class="ff-icon" src="https://openweathermap.org/img/wn/${esc(icon)}@2x.png" alt="" />`
              : ""
          }
          <div>
            <div class="ff-big">${t === null ? "--" : t}${tempUnit()}</div>
            <div class="ff-sub">${esc(desc)}</div>
          </div>
        </div>

        <div class="ff-metrics">
          <div>Wind ${esc(windVal)} ${esc(windUnit())}</div>
          <div>Gust ${esc(gustVal)} ${esc(windUnit())}</div>
          <div>Rain chance ${esc(popVal)}%</div>
          <div>—</div>
        </div>

        <div class="ff-metrics" style="margin-top:10px">
          <div>Sunrise ${esc(sr)}</div>
          <div>Sunset ${esc(ss)}</div>
          <div>Best time ${esc(bestText)}</div>
          <div>—</div>
        </div>
      </div>
    `;

    // Wire star button
    const favBtn = document.getElementById("favBtn");
    favBtn?.addEventListener("click", () => {
      toggleFavourite(selectedCourse);
      // update star immediately
      favBtn.textContent = isFavourited(selectedCourse) ? "★" : "☆";
    });

    // Update playability
    if (playabilityScoreEl) {
      const p = calculatePlayability(norm);
      playabilityScoreEl.textContent = `${p}/10`;
    }

    // Update Verdict card (front & centre)
    renderVerdictCard(norm);

    // Ensure favourites strip stays if present
    renderFavsStrip();
  }

  function renderHourly(norm) {
    const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
    if (hourly.length === 0) {
      showMessage("Hourly data not available.");
      renderVerdictCard(norm);
      return;
    }

    const hours = hourly.slice(0, 8);
    resultsEl.innerHTML = `
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-sub muted">Hourly · Next 24 hours (3-hour blocks)</div>
        <div class="ff-hourly">
          ${hours
            .map((h) => {
              const time = typeof h.dt === "number" ? fmtTime(h.dt) : "--:--";
              const icon = h?.weather?.[0]?.icon;
              const pop = typeof h.pop === "number" ? Math.round(h.pop * 100) : 0;
              const wind = typeof h.wind_speed === "number" ? h.wind_speed.toFixed(1) : "--";
              const temp = typeof h.temp === "number" ? Math.round(h.temp) : "--";
              return `
                <div class="ff-hour">
                  <div class="ff-hour-time">${esc(time)}</div>
                  ${
                    icon
                      ? `<img src="https://openweathermap.org/img/wn/${esc(icon)}@2x.png" alt="" />`
                      : ""
                  }
                  <div class="ff-hour-temp">${esc(temp)}${esc(tempUnit())}</div>
                  <div class="ff-hour-meta">${esc(pop)}% · ${esc(wind)} ${esc(windUnit())}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    const favBtn = document.getElementById("favBtn");
    favBtn?.addEventListener("click", () => {
      toggleFavourite(selectedCourse);
      favBtn.textContent = isFavourited(selectedCourse) ? "★" : "☆";
    });

    renderVerdictCard(norm);
    renderFavsStrip();
  }

  function renderDaily(norm) {
    const daily = Array.isArray(norm?.daily) ? norm.daily : [];
    if (daily.length === 0) {
      showMessage("Daily forecast not available.");
      renderVerdictCard(norm);
      return;
    }

    const days = daily.slice(0, 7);
    resultsEl.innerHTML = `
      ${renderHeaderCard()}
      <div class="ff-card">
        <div class="ff-sub muted">Daily · Up to 7 days</div>
        <div class="ff-daily">
          ${days
            .map((d) => {
              const date = typeof d.dt === "number" ? fmtDay(d.dt) : "--";
              const icon = d?.weather?.[0]?.icon || d?.icon;
              const main = d?.weather?.[0]?.main || "";
              const max = typeof d.max === "number" ? Math.round(d.max) : "--";
              const min = typeof d.min === "number" ? Math.round(d.min) : "--";
              const pop = typeof d.pop === "number" ? Math.round(d.pop * 100) : null;

              return `
                <div class="ff-day">
                  <div>
                    <div class="ff-day-date">${esc(date)}</div>
                    <div class="ff-day-desc">${esc(main)}${pop === null ? "" : ` · ${esc(pop)}%`}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:10px">
                    ${
                      icon
                        ? `<img src="https://openweathermap.org/img/wn/${esc(icon)}@2x.png" alt="" />`
                        : ""
                    }
                    <div class="ff-day-temp">${esc(max)}${esc(tempUnit())} ${esc(min)}${esc(tempUnit())}</div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    const favBtn = document.getElementById("favBtn");
    favBtn?.addEventListener("click", () => {
      toggleFavourite(selectedCourse);
      favBtn.textContent = isFavourited(selectedCourse) ? "★" : "☆";
    });

    renderVerdictCard(norm);
    renderFavsStrip();
  }

  function renderActiveTab() {
    if (!lastNorm) return;
    if (activeTab === "current") renderCurrent(lastNorm);
    else if (activeTab === "hourly") renderHourly(lastNorm);
    else renderDaily(lastNorm);
  }

  /* ---------- SEARCH UI ---------- */
  function renderSearchResults(list) {
    // keep favourites visible above
    resultsEl.innerHTML = "";
    renderFavsStrip();

    if (!Array.isArray(list) || list.length === 0) {
      resultsEl.innerHTML += `<div class="ff-card muted">No courses found. Try a broader search (e.g. “Swindon” or “golf club swindon”).</div>`;
      return;
    }

    const items = list.slice(0, MAX_RESULTS);

    resultsEl.innerHTML += `
      <div class="ff-card">
        <div class="ff-sub muted">Select a result</div>
        <div class="ff-results-list">
          ${items
            .map((c) => {
              const name = c?.name || c?.club_name || c?.course_name || "Course";
              const city = c?.city || "";
              const state = c?.state || "";
              const country = c?.country || "";
              const id = c?.id ?? "";
              const lat = c?.lat ?? c?.latitude ?? "";
              const lon = c?.lon ?? c?.lng ?? c?.longitude ?? "";
              const line2 = [city, state, country].filter(Boolean).join(", ");

              return `
                <button
                  type="button"
                  class="ff-result"
                  data-id="${esc(id)}"
                  data-name="${esc(name)}"
                  data-city="${esc(city)}"
                  data-state="${esc(state)}"
                  data-country="${esc(country)}"
                  data-lat="${esc(lat)}"
                  data-lon="${esc(lon)}"
                >
                  <div class="ff-result-title">${esc(name)}</div>
                  ${line2 ? `<div class="ff-sub muted">${esc(line2)}</div>` : ""}
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  async function runSearch() {
    const q = (searchInput?.value || "").trim();
    if (!q) {
      showMessage("Type a town/city or a course name, then Search.");
      return;
    }

    selectedCourse = null;
    lastRawWeather = null;
    lastNorm = null;
    if (playabilityScoreEl) playabilityScoreEl.textContent = "--/10";
    if (verdictLabel) verdictLabel.textContent = "—";
    if (verdictReason) verdictReason.textContent = "—";
    if (verdictBestTime) verdictBestTime.textContent = "—";
    verdictCard?.classList.remove("ff-verdict--play", "ff-verdict--maybe", "ff-verdict--no");

    showMessage("Searching…");

    try {
      const courses = await fetchCourses(q);
      renderSearchResults(courses);
    } catch (err) {
      console.error(err);

      if (err?.status === 429) {
        showError("Too many searches too quickly.", "Pause a second and try again.");
        return;
      }

      const hint =
        String(err?.message || "").includes("Failed to fetch")
          ? "If you see a CORS error in DevTools, your Worker must add Access-Control-Allow-Origin for your GitHub Pages domain."
          : "";

      showError("Search failed.", hint);
    }
  }

  async function loadCourseFromDataset(ds) {
    const lat = parseFloat(ds.lat);
    const lon = parseFloat(ds.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showError("This course is missing coordinates.", "Try a different result.");
      return;
    }

    selectedCourse = {
      id: ds.id || null,
      name: ds.name || "Course",
      city: ds.city || "",
      state: ds.state || "",
      country: ds.country || "",
      lat,
      lon,
    };

    if (searchInput) searchInput.value = selectedCourse.name;

    showMessage("Loading weather…");

    try {
      lastRawWeather = await fetchWeather(lat, lon);
      lastNorm = normalizeWeather(lastRawWeather);

      setActiveTab("current");
      renderActiveTab();
    } catch (err) {
      console.error(err);

      if (err?.status === 429) {
        showError("Weather is being requested too quickly.", "Wait a moment and try again.");
        return;
      }

      const hint =
        String(err?.message || "").includes("Failed to fetch")
          ? "If you see a CORS error in DevTools, your Worker must add Access-Control-Allow-Origin for your GitHub Pages domain."
          : "";

      showError("Weather failed to load for this location.", hint);
    }
  }

  /* ---------- SUGGESTIONS (DATALIST) ---------- */
  let suggestTimer = null;
  let lastSuggestAt = 0;
  let lastSuggestQ = "";

  function wireSuggestions() {
    if (!suggestionsEl || !searchInput) return;

    searchInput.addEventListener("input", () => {
      const q = (searchInput.value || "").trim();
      if (q.length < SUGGEST_MIN_CHARS) {
        suggestionsEl.innerHTML = "";
        return;
      }

      if (suggestTimer) window.clearTimeout(suggestTimer);

      suggestTimer = window.setTimeout(async () => {
        // simple cooldown to reduce 429
        const now = Date.now();
        if (now - lastSuggestAt < SUGGEST_COOLDOWN_MS && q.toLowerCase() !== lastSuggestQ.toLowerCase()) {
          return;
        }

        lastSuggestAt = now;
        lastSuggestQ = q;

        try {
          const courses = await fetchCourses(q);
          const top = courses.slice(0, 8);
          suggestionsEl.innerHTML = top
            .map((c) => {
              const name = c?.name || c?.club_name || c?.course_name || "";
              return name ? `<option value="${esc(name)}"></option>` : "";
            })
            .join("");
        } catch (err) {
          // suggestions are non-critical; fail silently
          if (err?.status === 429) {
            // keep last suggestions; do nothing
            return;
          }
        }
      }, SUGGEST_DEBOUNCE_MS);
    });
  }

  /* ---------- GEOLOCATION (OPTIONAL) ---------- */
  async function runGeolocation() {
    if (!navigator.geolocation) {
      showError("Geolocation not supported.", "Use manual search instead.");
      return;
    }

    showMessage("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos?.coords?.latitude;
        const lon = pos?.coords?.longitude;

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          showError("Could not read your location.", "Use manual search instead.");
          return;
        }

        selectedCourse = { name: "Your location", city: "", state: "", country: "", lat, lon };

        try {
          lastRawWeather = await fetchWeather(lat, lon);
          lastNorm = normalizeWeather(lastRawWeather);
          setActiveTab("current");
          renderActiveTab();
        } catch (err) {
          console.error(err);
          showError("Weather failed to load for your location.");
        }
      },
      () => {
        showError("Location permission denied.", "Use manual search instead.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 }
    );
  }

  /* ---------- EVENTS (ATTACH ONCE) ---------- */
  function init() {
    if (initialized) return;
    initialized = true;

    searchBtn?.addEventListener("click", runSearch);

    searchInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
    });

    // Results click (event delegation) – handles normal results + favourites
    resultsEl.addEventListener("click", (e) => {
      const btn = e.target?.closest?.(".ff-result");
      if (!btn) return;
      loadCourseFromDataset(btn.dataset);
    });

    tabCurrent?.addEventListener("click", () => {
      if (!lastNorm) return;
      setActiveTab("current");
      renderActiveTab();
    });

    tabHourly?.addEventListener("click", () => {
      if (!lastNorm) return;
      setActiveTab("hourly");
      renderActiveTab();
    });

    tabDaily?.addEventListener("click", () => {
      if (!lastNorm) return;
      setActiveTab("daily");
      renderActiveTab();
    });

    unitsSelect?.addEventListener("change", async () => {
      if (!selectedCourse?.lat || !selectedCourse?.lon) return;
      showMessage("Updating units…");
      try {
        lastRawWeather = await fetchWeather(selectedCourse.lat, selectedCourse.lon);
        lastNorm = normalizeWeather(lastRawWeather);
        renderActiveTab();
      } catch (err) {
        console.error(err);
        showError("Could not update units.");
      }
    });

    geoBtn?.addEventListener("click", runGeolocation);

    wireSuggestions();

    // On first load show favourites (if any) + tip
    resultsEl.innerHTML = "";
    renderFavsStrip();
    resultsEl.innerHTML += `<div class="ff-card muted">Search for a town/city or course name, then pick a result. (Tip: try “golf club swindon”)</div>`;

    // Set verdict card to neutral
    if (verdictLabel) verdictLabel.textContent = "—";
    if (verdictReason) verdictReason.textContent = "—";
    if (verdictBestTime) verdictBestTime.textContent = "—";
  }

  init();
})();
