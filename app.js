/* app.js — Fairway Forecast (FREE OpenWeather endpoints only)
   - Uses /data/2.5/weather + /data/2.5/forecast (free tier)
   - Robust config validation + friendly errors
   - Supabase courses load (if configured) but app still works without it
*/

(() => {
  "use strict";

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (id) => document.getElementById(id);
  const el = {
    ddlUnits: $("ddlUnits"),
    txtSearch: $("txtSearch"),
    btnSearch: $("btnSearch"),
    btnGeo: $("btnGeo"),
    btnFav: $("btnFav"),
    ddlFavs: $("ddlFavs"),
    coursesStatus: $("coursesStatus"),
    appStatus: $("appStatus"),
    toast: $("toast"),

    // Header/current summary
    h1Title: $("h1Title"),
    subTitle: $("subTitle"),
    imgIcon: $("imgIcon"),
    currTemp: $("currTemp"),
    feelsLike: $("feelsLike"),
    humidity: $("humidity"),
    wind: $("wind"),
    windDir: $("windDir"),
    sunrise: $("sunrise"),
    sunset: $("sunset"),
    dayLength: $("dayLength"),

    // Playability
    playScoreWhole: $("playScoreWhole"),
    playBand: $("playBand"),
    playMeta: $("playMeta"),

    // Best tee time
    teeSunrise: $("teeSunrise"),
    teeSunset: $("teeSunset"),
    bestTeeTime: $("bestTeeTime"),
    bestTeeScore: $("bestTeeScore"),
    teeMsg: $("teeMsg"),

    // Panels
    rainMessage: $("rainMessage"),
    rainTimeline: $("rainTimeline"),
    hourlyForecast: $("hourlyForecast"),
    dailyForecast: $("dailyForecast"),
    ddlDay: $("ddlDay"),

    // Suggestions
    searchSuggestions: $("searchSuggestions"),
  };

  // -----------------------------
  // Config + state
  // -----------------------------
  const CFG = (window.APP_CONFIG || {});
  const state = {
    units: "metric",       // metric | imperial
    unitLabel: "C",        // C | F
    selection: null,       // { label, lat, lon, country, source }
    courses: [],           // loaded from Supabase
    favs: [],              // localStorage
    supabase: null,        // supabase client
  };

  const LS_KEYS = {
    favs: "ff_favs_v1",
    units: "ff_units_v1",
    selection: "ff_selection_v1",
  };

  // -----------------------------
  // Toast / status
  // -----------------------------
  function setStatus(msg, isError = false) {
    if (!el.appStatus) return;
    el.appStatus.textContent = msg || "";
    el.appStatus.style.opacity = msg ? "1" : "0.7";
    el.appStatus.style.color = isError ? "#ffd0d0" : "";
  }

  function showToast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.remove("is-hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.add("is-hidden"), 2600);
  }

  function niceErr(e) {
    if (!e) return "Unknown error";
    if (typeof e === "string") return e;
    return e.message || "Unknown error";
  }

  // -----------------------------
  // Validation (stop silent failures)
  // -----------------------------
  function requireConfig() {
    const missing = [];
    if (!CFG.OPENWEATHER_KEY) missing.push("OPENWEATHER_KEY");
    if (!CFG.SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!CFG.SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (!CFG.COURSES_TABLE) missing.push("COURSES_TABLE");

    if (missing.length) {
      setStatus(`Config missing: ${missing.join(", ")}`, true);
    }

    // Normalize Supabase URL (avoid DNS typos caused by double slashes etc)
    if (CFG.SUPABASE_URL) {
      CFG.SUPABASE_URL = String(CFG.SUPABASE_URL).trim().replace(/\/+$/, "");
    }
  }

  // -----------------------------
  // Units
  // -----------------------------
  function applyUnitsFromUI() {
    const v = el.ddlUnits?.value || "C";
    state.unitLabel = v;
    state.units = (v === "F") ? "imperial" : "metric";
    localStorage.setItem(LS_KEYS.units, v);
  }

  function loadUnitsFromLS() {
    const v = localStorage.getItem(LS_KEYS.units);
    if (v === "F" || v === "C") {
      state.unitLabel = v;
      state.units = (v === "F") ? "imperial" : "metric";
      if (el.ddlUnits) el.ddlUnits.value = v;
    }
  }

  // -----------------------------
  // OpenWeather FREE endpoints
  // -----------------------------
  const OW = {
    base: "https://api.openweathermap.org/data/2.5",
    iconUrl(code) {
      // use 2x icons for crispness
      return `https://openweathermap.org/img/wn/${code}@2x.png`;
    },
    async getCurrent(lat, lon, units) {
      const url =
        `${OW.base}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
        `&units=${encodeURIComponent(units)}&appid=${encodeURIComponent(CFG.OPENWEATHER_KEY)}`;
      return fetchJson(url, "OpenWeather current");
    },
    async getForecast(lat, lon, units) {
      const url =
        `${OW.base}/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
        `&units=${encodeURIComponent(units)}&appid=${encodeURIComponent(CFG.OPENWEATHER_KEY)}`;
      return fetchJson(url, "OpenWeather forecast");
    }
  };

  async function fetchJson(url, label) {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!res.ok) {
      // Special case: One Call subscription confusion (should never happen now)
      const msg = (data && (data.message || data.error)) ? (data.message || data.error) : text;
      throw new Error(`${label} error ${res.status}: ${msg || "Request failed"}`);
    }
    return data;
  }

  // -----------------------------
  // Render current weather
  // -----------------------------
  function fmtTime(unixSec, tzOffsetSec = 0) {
    if (!unixSec) return "--";
    const d = new Date((unixSec + tzOffsetSec) * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtTemp(t) {
    if (t === null || t === undefined || Number.isNaN(Number(t))) return "--";
    return Math.round(Number(t)).toString();
  }

  function windDirFromDeg(deg) {
    if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return "—";
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    const idx = Math.round((deg % 360) / 22.5) % 16;
    return dirs[idx];
  }

  function setSelectedHeader(sel) {
    el.h1Title.textContent = sel?.label || "—";
    el.subTitle.textContent = sel?.country ? `${sel.country}` : (sel?.source || "—");
  }

  function secondsToHhMm(sec) {
    if (!sec || sec <= 0) return "—";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h ${m}m`;
  }

  function calcPlayability({ temp, wind, pop, rainMm }) {
    // Simple, stable score out of 10 (whole numbers only)
    // temp comfort (metric or imperial handled outside by using actual temp)
    let score = 10;

    // Temperature penalty (golf comfort band)
    // metric: comfort ~ 10–24°C; imperial: ~50–75°F
    if (state.units === "metric") {
      if (temp < 4) score -= 3;
      else if (temp < 8) score -= 2;
      else if (temp < 10) score -= 1;
      if (temp > 28) score -= 1;
      if (temp > 33) score -= 2;
    } else {
      if (temp < 40) score -= 3;
      else if (temp < 46) score -= 2;
      else if (temp < 50) score -= 1;
      if (temp > 82) score -= 1;
      if (temp > 90) score -= 2;
    }

    // Wind penalty (m/s in metric; mph in imperial from API)
    // metric thresholds ~ 6, 10, 14 m/s; imperial ~ 14, 22, 31 mph
    if (state.units === "metric") {
      if (wind >= 14) score -= 4;
      else if (wind >= 10) score -= 3;
      else if (wind >= 6) score -= 2;
      else if (wind >= 4) score -= 1;
    } else {
      if (wind >= 31) score -= 4;
      else if (wind >= 22) score -= 3;
      else if (wind >= 14) score -= 2;
      else if (wind >= 10) score -= 1;
    }

    // Rain / POP penalty
    const popPct = pop ? Math.round(pop * 100) : 0;
    if (popPct >= 80) score -= 4;
    else if (popPct >= 60) score -= 3;
    else if (popPct >= 40) score -= 2;
    else if (popPct >= 20) score -= 1;

    // Actual rain volume hint (if available)
    if (rainMm >= 3) score -= 2;
    else if (rainMm >= 1) score -= 1;

    score = Math.max(0, Math.min(10, Math.round(score)));

    let band = "Good";
    if (score >= 9) band = "Excellent";
    else if (score >= 7) band = "Good";
    else if (score >= 5) band = "Fair";
    else if (score >= 3) band = "Poor";
    else band = "Very poor";

    return { score, band, popPct };
  }

  function renderCurrent(current, forecast) {
    if (!current) return;

    const w = current.weather?.[0];
    const icon = w?.icon;
    if (icon && el.imgIcon) {
      el.imgIcon.src = OW.iconUrl(icon);
      el.imgIcon.alt = w?.description || "";
    }

    el.currTemp.textContent = fmtTemp(current.main?.temp);
    el.feelsLike.textContent = fmtTemp(current.main?.feels_like);
    el.humidity.textContent = (current.main?.humidity ?? "--").toString();

    const windVal = current.wind?.speed;
    el.wind.textContent = (windVal ?? "--").toString();
    el.windDir.textContent = windDirFromDeg(current.wind?.deg);

    const tz = current.timezone || 0;
    el.sunrise.textContent = fmtTime(current.sys?.sunrise, tz);
    el.sunset.textContent = fmtTime(current.sys?.sunset, tz);
    el.teeSunrise.textContent = el.sunrise.textContent;
    el.teeSunset.textContent = el.sunset.textContent;

    const dayLen = (current.sys?.sunset && current.sys?.sunrise)
      ? (current.sys.sunset - current.sys.sunrise)
      : 0;
    el.dayLength.textContent = `Day length: ${secondsToHhMm(dayLen)}`;

    // Build a "now-ish" rain message from next forecast block (if available)
    const next = forecast?.list?.[0];
    const pop = next?.pop || 0;
    const rainMm = next?.rain?.["3h"] || 0;

    const play = calcPlayability({
      temp: Number(current.main?.temp),
      wind: Number(current.wind?.speed),
      pop,
      rainMm
    });

    el.playScoreWhole.textContent = String(play.score);
    el.playBand.textContent = play.band;
    el.playMeta.textContent =
      `Wind ${current.wind?.speed ?? "—"} • Rain chance ${play.popPct}% • Temp ${fmtTemp(current.main?.temp)}°${state.unitLabel}`;

    // Best tee time (simple: pick best score across daylight forecast blocks)
    renderBestTeeTime(current, forecast);
  }

  // -----------------------------
  // Forecast rendering
  // -----------------------------
  function renderHourly(forecast) {
    if (!el.hourlyForecast) return;
    el.hourlyForecast.innerHTML = "";

    if (!forecast?.list?.length) {
      el.hourlyForecast.textContent = "No forecast data available.";
      return;
    }

    // Group by date
    const groups = {};
    for (const item of forecast.list) {
      const dt = new Date(item.dt * 1000);
      const key = dt.toISOString().slice(0, 10);
      (groups[key] ||= []).push(item);
    }

    // Populate day dropdown
    if (el.ddlDay) {
      el.ddlDay.innerHTML = "";
      const keys = Object.keys(groups);
      for (const k of keys) {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = new Date(k + "T00:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
        el.ddlDay.appendChild(opt);
      }
      el.ddlDay.onchange = () => renderHourlyDay(groups[el.ddlDay.value] || []);
      renderHourlyDay(groups[keys[0]] || []);
    }
  }

  function renderHourlyDay(items) {
    el.hourlyForecast.innerHTML = "";
    for (const it of items) {
      const card = document.createElement("div");
      card.className = "hourCard";

      const dt = new Date(it.dt * 1000);
      const time = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      const pop = Math.round((it.pop || 0) * 100);
      const rainMm = it.rain?.["3h"] || 0;

      card.innerHTML = `
        <div class="hourCard__t">${time}</div>
        <div class="hourCard__temp">${Math.round(it.main?.temp ?? 0)}°</div>
        <div class="hourCard__meta">Rain ${pop}% • Wind ${it.wind?.speed ?? "—"}</div>
        <div class="hourCard__meta2">${rainMm ? `Rain ${rainMm}mm` : ""}</div>
      `;
      el.hourlyForecast.appendChild(card);
    }
  }

  function renderDaily(forecast) {
    if (!el.dailyForecast) return;
    el.dailyForecast.innerHTML = "";

    if (!forecast?.list?.length) {
      el.dailyForecast.textContent = "No daily data available.";
      return;
    }

    // Derive daily summary from 3-hour blocks
    const byDay = new Map();
    for (const it of forecast.list) {
      const d = new Date(it.dt * 1000);
      const key = d.toISOString().slice(0, 10);
      const cur = byDay.get(key) || {
        key,
        min: Infinity,
        max: -Infinity,
        maxPop: 0,
        windMax: 0,
        rainSum: 0,
        icon: null,
      };
      const t = Number(it.main?.temp);
      if (!Number.isNaN(t)) {
        cur.min = Math.min(cur.min, t);
        cur.max = Math.max(cur.max, t);
      }
      cur.maxPop = Math.max(cur.maxPop, it.pop || 0);
      cur.windMax = Math.max(cur.windMax, Number(it.wind?.speed || 0));
      cur.rainSum += Number(it.rain?.["3h"] || 0);
      // pick midday-ish icon
      const hour = d.getUTCHours();
      if (!cur.icon && (hour === 12 || hour === 15) && it.weather?.[0]?.icon) cur.icon = it.weather[0].icon;
      byDay.set(key, cur);
    }

    const days = Array.from(byDay.values()).slice(0, 5); // forecast gives ~5 days
    for (const day of days) {
      const row = document.createElement("div");
      row.className = "dayRow";
      const label = new Date(day.key + "T00:00:00").toLocaleDateString([], { weekday: "long" });
      const popPct = Math.round(day.maxPop * 100);

      row.innerHTML = `
        <div class="dayRow__left">
          <div class="dayRow__d">${label}</div>
          <div class="dayRow__s">Rain ${popPct}% • Wind max ${Math.round(day.windMax)}</div>
        </div>
        <div class="dayRow__right">
          <div class="dayRow__temps">${Math.round(day.max)}° / ${Math.round(day.min)}°</div>
        </div>
      `;
      el.dailyForecast.appendChild(row);
    }
  }

  function renderBestTeeTime(current, forecast) {
    if (!forecast?.list?.length) {
      el.bestTeeTime.textContent = "—";
      el.bestTeeScore.textContent = "—";
      el.teeMsg.textContent = "No forecast data to suggest a tee time.";
      return;
    }

    // Use today's daylight window (local-ish approximation using current.timezone)
    const tz = current.timezone || 0;
    const sunrise = (current.sys?.sunrise || 0) + tz;
    const sunset  = (current.sys?.sunset  || 0) + tz;

    let best = null;

    for (const it of forecast.list) {
      const localDt = it.dt + tz; // shift into local seconds
      if (localDt < sunrise || localDt > sunset) continue;

      const pop = it.pop || 0;
      const rainMm = it.rain?.["3h"] || 0;

      const play = calcPlayability({
        temp: Number(it.main?.temp),
        wind: Number(it.wind?.speed),
        pop,
        rainMm
      });

      if (!best || play.score > best.score) {
        best = {
          dt: it.dt,
          score: play.score,
          popPct: Math.round(pop * 100),
          wind: it.wind?.speed,
          temp: it.main?.temp
        };
      }
    }

    if (!best) {
      el.bestTeeTime.textContent = "—";
      el.bestTeeScore.textContent = "—";
      el.teeMsg.textContent = "No daylight forecast blocks available for today.";
      return;
    }

    const t = new Date(best.dt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    el.bestTeeTime.textContent = t;
    el.bestTeeScore.textContent = `${best.score}/10`;
    el.teeMsg.textContent = `Rain ${best.popPct}% • Wind ${best.wind} • Temp ${Math.round(best.temp)}°${state.unitLabel}`;
  }

  // -----------------------------
  // Selection + weather refresh
  // -----------------------------
  async function refreshWeather() {
    if (!state.selection) return;

    setSelectedHeader(state.selection);
    setStatus("Loading weather…");

    try {
      const { lat, lon } = state.selection;

      const current = await OW.getCurrent(lat, lon, state.units);
      const forecast = await OW.getForecast(lat, lon, state.units);

      renderCurrent(current, forecast);
      renderHourly(forecast);
      renderDaily(forecast);

      setStatus("Weather: ready ✓");
    } catch (e) {
      const msg = niceErr(e);
      setStatus(msg, true);
      showToast(msg);

      // common "wrong endpoint" message protection
      if (/one call/i.test(msg) || /3\.0\/onecall/i.test(msg)) {
        showToast("Your code is still calling One Call 3.0 somewhere. This app.js does not.");
      }
    }
  }

  function saveSelection() {
    localStorage.setItem(LS_KEYS.selection, JSON.stringify(state.selection || null));
  }

  function loadSelection() {
    try {
      const raw = localStorage.getItem(LS_KEYS.selection);
      if (!raw) return;
      const sel = JSON.parse(raw);
      if (sel && typeof sel.lat === "number" && typeof sel.lon === "number") {
        state.selection = sel;
        setSelectedHeader(sel);
      }
    } catch { /* ignore */ }
  }

  // -----------------------------
  // Supabase courses (optional)
  // -----------------------------
  async function initSupabase() {
    if (!window.supabase || !window.supabase.createClient) {
      el.coursesStatus.textContent = "Courses: supabase lib missing";
      return;
    }
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
      el.coursesStatus.textContent = "Courses: config missing";
      return;
    }

    try {
      state.supabase = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });
    } catch (e) {
      el.coursesStatus.textContent = "Courses: supabase init failed";
      setStatus(niceErr(e), true);
      return;
    }
  }

  async function loadCourses() {
    if (!state.supabase) {
      el.coursesStatus.textContent = "Courses: not configured";
      return;
    }

    el.coursesStatus.textContent = "Courses: loading…";
    try {
      const cols = CFG.COURSE_COLS || { name: "name", lat: "latitude", lon: "longitude", country: "country" };
      const selectCols = [cols.name, cols.lat, cols.lon, cols.country].join(",");

      const { data, error } = await state.supabase
        .from(CFG.COURSES_TABLE)
        .select(selectCols)
        .limit(5000);

      if (error) throw new Error(error.message);

      state.courses = (data || []).map((r) => ({
        label: r[cols.name],
        lat: Number(r[cols.lat]),
        lon: Number(r[cols.lon]),
        country: r[cols.country] || "",
        source: "course",
      })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));

      el.coursesStatus.textContent = `Courses: ready ✓ (${state.courses.length})`;
    } catch (e) {
      el.coursesStatus.textContent = "Courses: failed";
      setStatus(`Courses load failed: ${niceErr(e)}`, true);
    }
  }

  // -----------------------------
  // Simple place search (Nominatim)
  // -----------------------------
  async function searchPlaces(q) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=8&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" }});
    const data = await res.json();
    return (data || []).map(x => ({
      label: x.display_name,
      lat: Number(x.lat),
      lon: Number(x.lon),
      country: x.address?.country || "",
      source: "place",
    })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  }

  function showSuggestions(items) {
    if (!el.searchSuggestions) return;
    el.searchSuggestions.innerHTML = "";
    if (!items.length) {
      el.searchSuggestions.classList.add("is-hidden");
      return;
    }
    el.searchSuggestions.classList.remove("is-hidden");

    for (const it of items) {
      const d = document.createElement("div");
      d.className = "suggestion";
      d.setAttribute("role", "option");
      d.textContent = it.label;
      d.onclick = () => {
        el.searchSuggestions.classList.add("is-hidden");
        el.txtSearch.value = it.label;
        setSelection(it);
      };
      el.searchSuggestions.appendChild(d);
    }
  }

  function hideSuggestions() {
    if (!el.searchSuggestions) return;
    el.searchSuggestions.classList.add("is-hidden");
  }

  function setSelection(sel) {
    state.selection = {
      label: sel.label,
      lat: Number(sel.lat),
      lon: Number(sel.lon),
      country: sel.country || "",
      source: sel.source || "",
    };
    saveSelection();
    refreshWeather();
  }

  // -----------------------------
  // Favourites (basic)
  // -----------------------------
  function loadFavs() {
    try {
      state.favs = JSON.parse(localStorage.getItem(LS_KEYS.favs) || "[]") || [];
    } catch {
      state.favs = [];
    }
    renderFavDropdown();
  }

  function saveFavs() {
    localStorage.setItem(LS_KEYS.favs, JSON.stringify(state.favs));
    renderFavDropdown();
  }

  function renderFavDropdown() {
    if (!el.ddlFavs) return;
    el.ddlFavs.innerHTML = `<option value="">Select a favourite…</option>`;
    for (const f of state.favs) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.label;
      el.ddlFavs.appendChild(opt);
    }
  }

  function currentFavId() {
    if (!state.selection) return null;
    return `${state.selection.lat},${state.selection.lon}`;
  }

  function updateFavButton() {
    if (!el.btnFav) return;
    const id = currentFavId();
    const exists = id && state.favs.some(f => f.id === id);
    el.btnFav.textContent = exists ? "★" : "☆";
    el.btnFav.setAttribute("aria-pressed", exists ? "true" : "false");
  }

  function toggleFav() {
    if (!state.selection) {
      showToast("Pick a place or course first.");
      return;
    }
    const id = currentFavId();
    const exists = state.favs.some(f => f.id === id);
    if (exists) {
      state.favs = state.favs.filter(f => f.id !== id);
      showToast("Removed from favourites");
    } else {
      state.favs.push({ id, label: state.selection.label, lat: state.selection.lat, lon: state.selection.lon });
      showToast("Added to favourites");
    }
    saveFavs();
    updateFavButton();
  }

  // -----------------------------
  // Events
  // -----------------------------
  function wireEvents() {
    el.ddlUnits?.addEventListener("change", async () => {
      applyUnitsFromUI();
      await refreshWeather();
    });

    el.btnSearch?.addEventListener("click", async () => {
      hideSuggestions();
      const q = (el.txtSearch?.value || "").trim();
      if (!q) return;

      setStatus("Searching…");
      try {
        // Courses match first (local), then places
        const qlc = q.toLowerCase();
        const courseHits = state.courses
          .filter(c => (c.label || "").toLowerCase().includes(qlc))
          .slice(0, 8);

        if (courseHits.length) {
          showSuggestions(courseHits);
          setStatus(`Found ${courseHits.length} course match(es)`);
          return;
        }

        const places = await searchPlaces(q);
        showSuggestions(places);
        setStatus(`Found ${places.length} place match(es)`);
      } catch (e) {
        setStatus(niceErr(e), true);
        showToast(niceErr(e));
      }
    });

    el.txtSearch?.addEventListener("input", () => {
      // Don’t let suggestions dominate — only show after 2+ chars
      const q = (el.txtSearch.value || "").trim();
      if (q.length < 2) hideSuggestions();
    });

    document.addEventListener("click", (evt) => {
      if (!el.searchSuggestions) return;
      if (evt.target === el.txtSearch) return;
      if (el.searchSuggestions.contains(evt.target)) return;
      hideSuggestions();
    });

    el.btnGeo?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        showToast("Geolocation not supported on this browser.");
        return;
      }
      setStatus("Getting your location…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          setSelection({ label: "My location", lat, lon, country: "", source: "geo" });
          setStatus("Location: ready ✓");
        },
        (err) => {
          setStatus(err.message || "Location permission denied", true);
          showToast(err.message || "Location permission denied");
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });

    el.btnFav?.addEventListener("click", toggleFav);

    el.ddlFavs?.addEventListener("change", () => {
      const id = el.ddlFavs.value;
      const f = state.favs.find(x => x.id === id);
      if (f) setSelection({ label: f.label, lat: f.lat, lon: f.lon, source: "fav" });
    });
  }

  // -----------------------------
  // Tabs (simple)
  // -----------------------------
  function initTabs() {
    const tabs = document.querySelectorAll(".tab");
    const panels = document.querySelectorAll(".panel");
    tabs.forEach(t => {
      t.addEventListener("click", () => {
        tabs.forEach(x => x.classList.remove("is-active"));
        t.classList.add("is-active");

        const key = t.getAttribute("data-tab");
        panels.forEach(p => {
          const is = p.getAttribute("data-panel") === key;
          p.classList.toggle("is-active", is);
        });
      });
    });
  }

  // -----------------------------
  // Boot
  // -----------------------------
  async function boot() {
    requireConfig();
    loadUnitsFromLS();
    applyUnitsFromUI();
    loadFavs();
    loadSelection();

    wireEvents();
    initTabs();

    await initSupabase();
    await loadCourses();

    if (!state.selection) {
      setStatus("Ready. Search for a place or choose a favourite.");
    } else {
      updateFavButton();
      await refreshWeather();
    }
  }

  // Keep fav star in sync with selection updates
  const _oldSetSelection = setSelection;
  function setSelection(sel) {
    state.selection = {
      label: sel.label,
      lat: Number(sel.lat),
      lon: Number(sel.lon),
      country: sel.country || "",
      source: sel.source || "",
    };
    saveSelection();
    updateFavButton();
    refreshWeather();
  }

  window.addEventListener("load", boot);
})();

