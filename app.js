/* app.js — Fairway Forecast (GitHub Pages friendly)
   Fixes:
   - state.favs not iterable (localStorage safety)
   - OpenWeather One Call 3.0 401 (uses FREE /weather + /forecast)
   - Tabs: Current/Hourly/Daily show correct panels + smooth scroll + persistence
*/

(() => {
  "use strict";

  // ---------- CONFIG ----------
  const CFG = (window.APP_CONFIG || {});
  const OPENWEATHER_KEY = (CFG.OPENWEATHER_KEY || "").trim();

  // If you had OneCall in the old code, stop using it.
  const OW_BASE = "https://api.openweathermap.org/data/2.5";
  const OW_ICON = (icon) => `https://openweathermap.org/img/wn/${icon}@2x.png`;

  // Supabase (optional for course search)
  const SUPABASE_URL = (CFG.SUPABASE_URL || "").trim();
  const SUPABASE_ANON_KEY = (CFG.SUPABASE_ANON_KEY || "").trim();
  const COURSES_TABLE = (CFG.COURSES_TABLE || "uk_golf_courses").trim();
  const COURSE_COLS = CFG.COURSE_COLS || { name: "name", lat: "latitude", lon: "longitude", country: "country", website: "website" };

  const LS_KEY = "ff_state_v1";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);

  const els = {
    txtSearch: $("txtSearch"),
    btnSearch: $("btnSearch"),
    btnGeo: $("btnGeo"),
    btnFav: $("btnFav"),
    ddlFavs: $("ddlFavs"),
    ddlUnits: $("ddlUnits"),

    suggestions: $("searchSuggestions"),
    coursesStatus: $("coursesStatus"),
    appStatus: $("appStatus"),

    h1Title: $("h1Title"),
    subTitle: $("subTitle"),
    imgIcon: $("imgIcon"),
    currTemp: $("currTemp"),

    playScoreWhole: $("playScoreWhole"),
    playBand: $("playBand"),
    playMeta: $("playMeta"),

    btnPlayInfo: $("btnPlayInfo"),
    btnPlayClose: $("btnPlayClose"),
    playPopover: $("playPopover"),

    feelsLike: $("feelsLike"),
    humidity: $("humidity"),
    wind: $("wind"),
    windDir: $("windDir"),
    sunrise: $("sunrise"),
    sunset: $("sunset"),
    dayLength: $("dayLength"),

    teeSunrise: $("teeSunrise"),
    teeSunset: $("teeSunset"),
    bestTeeTime: $("bestTeeTime"),
    bestTeeScore: $("bestTeeScore"),
    teeMsg: $("teeMsg"),

    rainMessage: $("rainMessage"),
    rainTimeline: $("rainTimeline"),

    ddlDay: $("ddlDay"),
    hourlyForecast: $("hourlyForecast"),
    dailyForecast: $("dailyForecast"),

    toast: $("toast"),
  };

  const forecastAnchor = document.getElementById("forecast");
  const tabButtons = Array.from(document.querySelectorAll(".tab[data-tab]"));
  const panels = Array.from(document.querySelectorAll(".panel[data-panel]"));

  // ---------- STATE ----------
  const state = {
    units: "C",
    tab: "current",
    selection: null, // { type:'place'|'course', label, lat, lon, extra? }
    favs: [],        // [{ id, label, lat, lon, type }]
    coursesLoaded: false,
    courses: [],     // optional cache
  };

  function safeParseJSON(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function loadState() {
    const saved = safeParseJSON(localStorage.getItem(LS_KEY), {});
    state.units = (saved.units === "F") ? "F" : "C";
    state.tab = (["current", "hourly", "daily"].includes(saved.tab)) ? saved.tab : "current";
    state.selection = saved.selection || null;

    // ✅ HARDEN favs (fix for "not iterable")
    const favs = saved.favs;
    state.favs = Array.isArray(favs) ? favs.filter(Boolean) : [];

    // Update UI controls
    if (els.ddlUnits) els.ddlUnits.value = state.units;
  }

  function saveState() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      units: state.units,
      tab: state.tab,
      selection: state.selection,
      favs: state.favs,
    }));
  }

  // ---------- UI HELPERS ----------
  function showStatus(msg) {
    if (els.appStatus) els.appStatus.textContent = msg || "";
  }

  function showToast(msg) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.remove("is-hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => els.toast.classList.add("is-hidden"), 2200);
  }

  function fmtTemp(t) {
    if (t == null || Number.isNaN(t)) return "--";
    return String(Math.round(t));
  }

  function mpsToMph(mps) { return mps * 2.236936; }

  function fmtWind(mps) {
    if (mps == null || Number.isNaN(mps)) return "--";
    if (state.units === "F") return `${Math.round(mpsToMph(mps))} mph`;
    return `${Math.round(mps)} m/s`;
  }

  function toLocalTime(tsSeconds, tzOffsetSeconds) {
    // OpenWeather returns timestamps in UTC; timezone offset = seconds from UTC for location
    const ms = (tsSeconds + tzOffsetSeconds) * 1000;
    return new Date(ms);
  }

  function fmtHHMM(d) {
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function dayName(d) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }

  // ---------- PLAYABILITY ----------
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function computePlayability({ pop, windMps, tempC }) {
    // Simple, golf-friendly heuristic (0..10)
    // pop = 0..1, wind m/s, tempC
    // Higher pop/wind reduce score. Comfortable temp increases.
    let score = 10;

    // Rain probability weight
    score -= (pop ?? 0) * 5.5;

    // Wind weight
    const w = windMps ?? 0;
    score -= clamp((w - 2) * 0.7, 0, 4.5);

    // Temp comfort (rough)
    const t = tempC ?? 10;
    const comfort = 1 - clamp(Math.abs(t - 16) / 18, 0, 1); // peaks around 16C
    score -= (1 - comfort) * 2.5;

    score = clamp(score, 0, 10);
    const whole = clamp(Math.round(score), 0, 10);

    let band = "Poor";
    if (whole >= 8) band = "Excellent";
    else if (whole >= 6) band = "Good";
    else if (whole >= 4) band = "Marginal";

    return { score, whole, band };
  }

  function renderPlayability(whole, band, metaText = "") {
    if (els.playScoreWhole) els.playScoreWhole.textContent = String(whole);
    if (els.playBand) els.playBand.textContent = band;
    if (els.playMeta) els.playMeta.textContent = metaText;
    // Optional: set data-band for CSS coloring
    const hero = document.getElementById("playHero");
    if (hero) hero.dataset.band = band.toLowerCase();
  }

  // ---------- TABS ----------
  function setTab(tab, { scroll = false } = {}) {
    state.tab = tab;
    saveState();

    tabButtons.forEach((b) => {
      const active = b.dataset.tab === tab;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });

    panels.forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === tab);
    });

    if (scroll && forecastAnchor) {
      // Ensure sticky header doesn't hide it
      forecastAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ---------- FAVOURITES ----------
  function favIdFromSelection(sel) {
    return `${sel.type}:${sel.lat.toFixed(5)},${sel.lon.toFixed(5)}:${sel.label}`;
  }

  function isFavCurrent() {
    const sel = state.selection;
    if (!sel) return false;
    const id = favIdFromSelection(sel);
    return state.favs.some(f => f.id === id);
  }

  function renderFavButton() {
    if (!els.btnFav) return;
    const on = isFavCurrent();
    els.btnFav.textContent = on ? "★" : "☆";
    els.btnFav.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function renderFavDropdown() {
    if (!els.ddlFavs) return;
    els.ddlFavs.innerHTML = `<option value="">Select a favourite…</option>`;
    for (const f of state.favs) {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.label;
      els.ddlFavs.appendChild(opt);
    }
  }

  function toggleFavourite() {
    const sel = state.selection;
    if (!sel) return showToast("Search/select a location first.");
    const id = favIdFromSelection(sel);

    const idx = state.favs.findIndex(f => f.id === id);
    if (idx >= 0) {
      state.favs.splice(idx, 1);
      showToast("Removed from favourites");
    } else {
      state.favs.push({ id, label: sel.label, lat: sel.lat, lon: sel.lon, type: sel.type });
      showToast("Added to favourites");
    }
    saveState();
    renderFavButton();
    renderFavDropdown();
  }

  // ---------- SEARCH (Place + Course suggestions) ----------
  let sb;
  function initSupabase() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) return null;
    try {
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch {
      return null;
    }
  }

  async function suggestCourses(q) {
    if (!sb) return [];
    if (!q || q.length < 2) return [];

    const cols = `${COURSE_COLS.name},${COURSE_COLS.lat},${COURSE_COLS.lon},${COURSE_COLS.country}`;
    const { data, error } = await sb
      .from(COURSES_TABLE)
      .select(cols)
      .ilike(COURSE_COLS.name, `%${q}%`)
      .limit(8);

    if (error || !Array.isArray(data)) return [];
    return data.map(r => ({
      type: "course",
      label: `${r[COURSE_COLS.name]} (${r[COURSE_COLS.country] || ""})`.trim(),
      lat: Number(r[COURSE_COLS.lat]),
      lon: Number(r[COURSE_COLS.lon]),
    })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  }

  async function suggestPlaces(q) {
    // OpenWeather direct geocoding (free)
    if (!OPENWEATHER_KEY) return [];
    if (!q || q.length < 2) return [];
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=5&appid=${encodeURIComponent(OPENWEATHER_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(p => ({
      type: "place",
      label: `${p.name}${p.state ? ", " + p.state : ""}, ${p.country}`,
      lat: Number(p.lat),
      lon: Number(p.lon),
    })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  }

  function openSuggestions(items) {
    if (!els.suggestions) return;
    els.suggestions.innerHTML = "";
    if (!items.length) {
      els.suggestions.classList.add("is-hidden");
      return;
    }

    for (const it of items) {
      const div = document.createElement("div");
      div.className = "suggestion";
      div.setAttribute("role", "option");
      div.textContent = it.label;
      div.addEventListener("click", () => {
        els.suggestions.classList.add("is-hidden");
        els.txtSearch.value = it.label;
        applySelection(it);
      });
      els.suggestions.appendChild(div);
    }
    els.suggestions.classList.remove("is-hidden");
  }

  let suggestTimer;
  async function handleSuggest() {
    const q = (els.txtSearch?.value || "").trim();
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      const [courses, places] = await Promise.all([
        suggestCourses(q),
        suggestPlaces(q),
      ]);

      // Mix results: places first if user types like “Swindon, GB”
      const merged = [...places, ...courses].slice(0, 10);
      openSuggestions(merged);
    }, 180);
  }

  // ---------- WEATHER FETCH ----------
  function unitsToOW() { return state.units === "F" ? "imperial" : "metric"; }

  async function fetchCurrent(lat, lon) {
    if (!OPENWEATHER_KEY) throw new Error("Missing OPENWEATHER_KEY");
    const url = `${OW_BASE}/weather?lat=${lat}&lon=${lon}&appid=${encodeURIComponent(OPENWEATHER_KEY)}&units=${unitsToOW()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenWeather current error ${res.status}`);
    return res.json();
  }

  async function fetchForecast(lat, lon) {
    if (!OPENWEATHER_KEY) throw new Error("Missing OPENWEATHER_KEY");
    const url = `${OW_BASE}/forecast?lat=${lat}&lon=${lon}&appid=${encodeURIComponent(OPENWEATHER_KEY)}&units=${unitsToOW()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenWeather forecast error ${res.status}`);
    return res.json();
  }

  // ---------- RENDER ----------
  function renderCurrent(current) {
    const name = current?.name || "Selected location";
    const country = current?.sys?.country ? `, ${current.sys.country}` : "";
    els.h1Title.textContent = name;
    els.subTitle.textContent = `${name}${country}`.trim();

    const icon = current?.weather?.[0]?.icon;
    if (els.imgIcon) {
      if (icon) {
        els.imgIcon.src = OW_ICON(icon);
        els.imgIcon.alt = current?.weather?.[0]?.description || "";
      } else {
        els.imgIcon.removeAttribute("src");
        els.imgIcon.alt = "";
      }
    }

    els.currTemp.textContent = fmtTemp(current?.main?.temp);
    els.feelsLike.textContent = fmtTemp(current?.main?.feels_like);
    els.humidity.textContent = String(Math.round(current?.main?.humidity ?? 0));

    els.wind.textContent = fmtWind(current?.wind?.speed);
    els.windDir.textContent = current?.wind?.deg != null ? `${Math.round(current.wind.deg)}°` : "—";

    // Sunrise/Sunset
    const tz = current?.timezone ?? 0;
    if (current?.sys?.sunrise && current?.sys?.sunset) {
      const sr = toLocalTime(current.sys.sunrise, tz);
      const ss = toLocalTime(current.sys.sunset, tz);
      const srTxt = fmtHHMM(sr);
      const ssTxt = fmtHHMM(ss);

      els.sunrise.textContent = srTxt;
      els.sunset.textContent = ssTxt;

      els.teeSunrise.textContent = srTxt;
      els.teeSunset.textContent = ssTxt;

      const lenMs = (ss.getTime() - sr.getTime());
      const hrs = Math.floor(lenMs / 3600000);
      const mins = Math.round((lenMs % 3600000) / 60000);
      els.dayLength.textContent = `Day length: ${hrs}h ${mins}m`;
    } else {
      els.sunrise.textContent = "--";
      els.sunset.textContent = "--";
      els.dayLength.textContent = "Day length: —";
      els.teeSunrise.textContent = "--";
      els.teeSunset.textContent = "--";
    }
  }

  function renderHourly(list, tzOffset) {
    // list = 3-hour blocks
    els.hourlyForecast.innerHTML = "";
    if (!Array.isArray(list) || !list.length) {
      els.hourlyForecast.innerHTML = `<div class="empty">No hourly data available.</div>`;
      return;
    }

    for (const it of list) {
      const d = toLocalTime(it.dt, tzOffset);
      const time = fmtHHMM(d);
      const icon = it?.weather?.[0]?.icon;
      const temp = fmtTemp(it?.main?.temp);
      const pop = Math.round((it?.pop ?? 0) * 100);
      const wind = fmtWind(it?.wind?.speed);

      const card = document.createElement("div");
      card.className = "hCard";
      card.innerHTML = `
        <div class="hTime">${time}</div>
        <img class="hIcon" alt="" src="${icon ? OW_ICON(icon) : ""}" />
        <div class="hTemp">${temp}°</div>
        <div class="hMeta">Rain ${pop}% • Wind ${wind}</div>
      `;
      els.hourlyForecast.appendChild(card);
    }
  }

  function groupForecastByDay(forecast) {
    // forecast.list items are 3-hour blocks; group by local date
    const tz = forecast?.city?.timezone ?? 0;
    const buckets = new Map();

    for (const it of (forecast.list || [])) {
      const d = toLocalTime(it.dt, tz);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`; // based on adjusted UTC fields
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(it);
    }
    return { tz, days: Array.from(buckets.values()) };
  }

  function renderDailyFromForecast(forecast) {
    els.dailyForecast.innerHTML = "";
    if (!forecast?.list?.length) {
      els.dailyForecast.innerHTML = `<div class="empty">No daily data available.</div>`;
      return;
    }

    const { tz, days } = groupForecastByDay(forecast);

    // Show up to 7 if exists (OpenWeather /forecast typically gives ~5 days)
    const showDays = days.slice(0, 7);

    for (const dayItems of showDays) {
      // Compute high/low, max pop, avg wind
      let hi = -Infinity, lo = Infinity, maxPop = 0, windSum = 0, windN = 0;
      const mid = dayItems[Math.floor(dayItems.length / 2)];
      const icon = mid?.weather?.[0]?.icon;

      for (const it of dayItems) {
        const t = it?.main?.temp;
        if (typeof t === "number") {
          hi = Math.max(hi, t);
          lo = Math.min(lo, t);
        }
        maxPop = Math.max(maxPop, it?.pop ?? 0);
        if (typeof it?.wind?.speed === "number") { windSum += it.wind.speed; windN++; }
      }

      const d = toLocalTime(mid.dt, tz);
      const name = dayName(d);
      const popPct = Math.round(maxPop * 100);
      const windAvg = windN ? (windSum / windN) : null;

      const card = document.createElement("div");
      card.className = "dCard";
      card.innerHTML = `
        <div class="dDay">${name}</div>
        <img class="dIcon" alt="" src="${icon ? OW_ICON(icon) : ""}" />
        <div class="dTemps">
          <span class="dHi">${fmtTemp(hi)}°</span>
          <span class="dLo">${fmtTemp(lo)}°</span>
        </div>
        <div class="dMeta">Rain ${popPct}% • Wind ${fmtWind(windAvg)}</div>
      `;
      els.dailyForecast.appendChild(card);
    }
  }

  function renderRainTimeline(forecast) {
    // Use next 8 blocks (~24h) pop bars
    els.rainTimeline.innerHTML = "";
    const tz = forecast?.city?.timezone ?? 0;
    const list = (forecast?.list || []).slice(0, 8);
    if (!list.length) {
      els.rainTimeline.innerHTML = `<div class="empty">No rain timeline available.</div>`;
      els.rainMessage.textContent = "—";
      return;
    }

    // message: next rain start
    const nextRain = list.find(x => (x.pop ?? 0) > 0.2);
    els.rainMessage.textContent = nextRain
      ? `Rain possible within ${Math.max(0, Math.round((nextRain.dt - list[0].dt) / 60))} mins`
      : "No rain expected soon";

    for (const it of list) {
      const d = toLocalTime(it.dt, tz);
      const time = fmtHHMM(d);
      const popPct = Math.round((it.pop ?? 0) * 100);

      const item = document.createElement("div");
      item.className = "tItem";
      item.innerHTML = `
        <div class="tTime">${time}</div>
        <div class="tBar"><div class="tFill" style="width:${popPct}%"></div></div>
        <div class="tPct">${popPct}%</div>
      `;
      els.rainTimeline.appendChild(item);
    }
  }

  function computeBestTeeTime(current, forecast) {
    // Use forecast blocks and pick best within daylight only.
    const tz = current?.timezone ?? 0;
    const sr = current?.sys?.sunrise;
    const ss = current?.sys?.sunset;

    if (!sr || !ss) {
      els.bestTeeTime.textContent = "—";
      els.bestTeeScore.textContent = "—";
      els.teeMsg.textContent = "Sunrise/sunset unavailable for tee-time logic.";
      return;
    }

    const daylight = (forecast?.list || []).filter(it => it.dt > sr && it.dt < ss);
    if (!daylight.length) {
      els.bestTeeTime.textContent = "—";
      els.bestTeeScore.textContent = "—";
      els.teeMsg.textContent = "No forecast slots within daylight hours.";
      return;
    }

    // Score each slot using playability heuristic
    let best = null;
    for (const it of daylight) {
      const pop = it?.pop ?? 0;
      const wind = it?.wind?.speed ?? 0;
      // Convert temp to C for playability formula if user is in F
      const temp = it?.main?.temp ?? 10;
      const tempC = (state.units === "F") ? ((temp - 32) * 5 / 9) : temp;

      const p = computePlayability({ pop, windMps: wind, tempC });
      if (!best || p.score > best.p.score) best = { it, p };
    }

    // If conditions are poor all day
    if (best.p.whole <= 3) {
      els.bestTeeTime.textContent = "—";
      els.bestTeeScore.textContent = "";
      els.teeMsg.textContent = "No good tee time today — conditions poor throughout daylight hours.";
      return;
    }

    const d = toLocalTime(best.it.dt, tz);
    const time = fmtHHMM(d);

    els.bestTeeTime.textContent = time;
    els.bestTeeScore.textContent = `${best.p.whole}/10 • ${best.p.band}`;
    els.teeMsg.textContent = "Chosen from daylight-only forecast slots.";
  }

  async function renderAllForSelection(sel) {
    state.selection = sel;
    saveState();
    renderFavButton();

    // Show skeleton-ish placeholders
    showStatus("Loading weather…");
    renderPlayability(0, "—", "Loading…");

    try {
      const [current, forecast] = await Promise.all([
        fetchCurrent(sel.lat, sel.lon),
        fetchForecast(sel.lat, sel.lon),
      ]);

      renderCurrent(current);

      // Playability based on "current" + next forecast pop if available
      const next = forecast?.list?.[0];
      const pop = next?.pop ?? 0;
      const wind = current?.wind?.speed ?? 0;

      // Convert current temp to C for playability internal logic
      const temp = current?.main?.temp ?? 10;
      const tempC = (state.units === "F") ? ((temp - 32) * 5 / 9) : temp;

      const p = computePlayability({ pop, windMps: wind, tempC });
      renderPlayability(p.whole, p.band, `Wind ${fmtWind(wind)} • Rain ${Math.round(pop * 100)}% • Temp ${fmtTemp(temp)}°`);

      // Tee time
      computeBestTeeTime(current, forecast);

      // Forecast renders
      renderRainTimeline(forecast);
      renderDailyFromForecast(forecast);

      // Hourly day selector
      populateDayDropdown(forecast);

      showStatus("");
    } catch (e) {
      console.error(e);
      showStatus(String(e.message || e));

      // friendly error in UI
      els.rainMessage.textContent = "Weather unavailable";
      els.rainTimeline.innerHTML = `<div class="empty">Check your OpenWeather key/plan.</div>`;
      els.hourlyForecast.innerHTML = `<div class="empty">Check your OpenWeather key/plan.</div>`;
      els.dailyForecast.innerHTML = `<div class="empty">Check your OpenWeather key/plan.</div>`;
      els.teeMsg.textContent = "Unable to compute tee time (weather fetch failed).";
    }
  }

  function populateDayDropdown(forecast) {
    if (!els.ddlDay) return;
    els.ddlDay.innerHTML = "";

    const { tz, days } = groupForecastByDay(forecast);
    const keyed = [];

    for (const dayItems of days) {
      const mid = dayItems[Math.floor(dayItems.length / 2)];
      const d = toLocalTime(mid.dt, tz);
      keyed.push({ key: mid.dt, label: d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }), items: dayItems });
    }

    keyed.slice(0, 7).forEach((d, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = d.label;
      els.ddlDay.appendChild(opt);
    });

    // store for change handler
    els.ddlDay._days = keyed;

    // render first day hourly
    if (keyed.length) renderHourly(keyed[0].items, forecast?.city?.timezone ?? 0);
  }

  // ---------- SELECTION ----------
  function applySelection(sel) {
    // Store label based on selection type
    state.selection = {
      type: sel.type,
      label: sel.label,
      lat: sel.lat,
      lon: sel.lon,
    };
    renderFavButton();
    renderFavDropdown();
    renderAllForSelection(state.selection);

    // After a search selection, jump user to Current panel on mobile
    setTab("current", { scroll: true });
  }

  async function doSearch() {
    const q = (els.txtSearch?.value || "").trim();
    if (!q) return showToast("Type a location or course.");

    // If user typed something and didn’t click a suggestion,
    // we try places first (more likely), then courses.
    showToast("Searching…");

    const places = await suggestPlaces(q);
    if (places.length) return applySelection(places[0]);

    const courses = await suggestCourses(q);
    if (courses.length) return applySelection(courses[0]);

    showToast("No results found.");
  }

  // ---------- GEO ----------
  function useMyLocation() {
    if (!navigator.geolocation) return showToast("Geolocation not supported.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applySelection({
          type: "place",
          label: "My location",
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      () => showToast("Could not get location."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // ---------- INIT ----------
  async function initCoursesStatus() {
    sb = initSupabase();
    if (!els.coursesStatus) return;

    if (!sb) {
      els.coursesStatus.textContent = "Courses: disabled";
      return;
    }

    els.coursesStatus.textContent = "Courses: ready ✓";
  }

  function wireEvents() {
    els.ddlUnits?.addEventListener("change", () => {
      state.units = (els.ddlUnits.value === "F") ? "F" : "C";
      saveState();
      if (state.selection) renderAllForSelection(state.selection);
    });

    els.btnSearch?.addEventListener("click", doSearch);

    els.txtSearch?.addEventListener("input", handleSuggest);
    els.txtSearch?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        els.suggestions?.classList.add("is-hidden");
        doSearch();
      }
    });

    document.addEventListener("click", (e) => {
      // close suggestions if click outside
      if (!els.suggestions) return;
      if (!els.suggestions.contains(e.target) && e.target !== els.txtSearch) {
        els.suggestions.classList.add("is-hidden");
      }
    });

    els.btnGeo?.addEventListener("click", useMyLocation);
    els.btnFav?.addEventListener("click", toggleFavourite);

    els.ddlFavs?.addEventListener("change", () => {
      const id = els.ddlFavs.value;
      if (!id) return;
      const f = state.favs.find(x => x.id === id);
      if (f) {
        applySelection({ type: f.type, label: f.label, lat: f.lat, lon: f.lon });
      }
    });

    // Popover
    els.btnPlayInfo?.addEventListener("click", () => {
      const open = !els.playPopover.classList.contains("is-hidden");
      if (open) closePlayPopover();
      else openPlayPopover();
    });
    els.btnPlayClose?.addEventListener("click", closePlayPopover);

    function openPlayPopover() {
      els.playPopover.classList.remove("is-hidden");
      els.playPopover.setAttribute("aria-hidden", "false");
      els.btnPlayInfo.setAttribute("aria-expanded", "true");
    }
    function closePlayPopover() {
      els.playPopover.classList.add("is-hidden");
      els.playPopover.setAttribute("aria-hidden", "true");
      els.btnPlayInfo.setAttribute("aria-expanded", "false");
    }

    // Tabs
    tabButtons.forEach((b) => {
      b.addEventListener("click", () => setTab(b.dataset.tab, { scroll: true }));
    });

    // Hourly day dropdown
    els.ddlDay?.addEventListener("change", () => {
      const idx = Number(els.ddlDay.value);
      const days = els.ddlDay._days || [];
      const pick = days[idx];
      if (pick) {
        // tz is already applied in renderer via forecast city timezone when available
        renderHourly(pick.items, (state._lastTz ?? 0));
      }
    });
  }

  function bootstrap() {
    loadState();
    renderFavDropdown();
    renderFavButton();

    // init tabs from saved
    setTab(state.tab, { scroll: false });

    // init courses
    initCoursesStatus();

    // restore selection if any
    if (state.selection && Number.isFinite(state.selection.lat) && Number.isFinite(state.selection.lon)) {
      renderAllForSelection(state.selection);
    } else {
      showStatus(OPENWEATHER_KEY ? "" : "Missing OPENWEATHER_KEY in config.js");
    }

    // register service worker (safe on GitHub Pages)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }

  wireEvents();
  bootstrap();
})();
