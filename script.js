/* script.js — Fairway Forecast (IDs match your latest HTML) */

(() => {
  "use strict";

  // -----------------------------
  // Config + Safety
  // -----------------------------
  const CFG = window.APP_CONFIG || {};
  const OWM_KEY = CFG.OWM_API_KEY;
  const SB_URL = CFG.SUPABASE_URL;
  const SB_KEY = CFG.SUPABASE_ANON_KEY;

  const TABLE = CFG.COURSES_TABLE || "uk_golf_courses";
  const COLS = CFG.COURSE_COLS || { name: "name", lat: "latitude", lon: "longitude", country: "country" };

  if (!OWM_KEY) console.warn("Missing OWM_API_KEY in config.js");
  if (!SB_URL || !SB_KEY) console.warn("Missing Supabase credentials in config.js");

  // -----------------------------
  // DOM helpers
  // -----------------------------
  const $ = (id) => document.getElementById(id);
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = v ?? "—"; };
  const show = (el) => el && el.classList.remove("is-hidden");
  const hide = (el) => el && el.classList.add("is-hidden");

  const appStatus = $("appStatus");
  const coursesStatus = $("coursesStatus");

  function status(msg) { if (appStatus) appStatus.textContent = msg || ""; }
  function courseStatus(msg) { if (coursesStatus) coursesStatus.textContent = msg || ""; }

  // -----------------------------
  // Toast
  // -----------------------------
  const toastEl = $("toast");
  let toastTimer = null;

  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove("is-hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("is-hidden"), 2200);
  }

  // -----------------------------
  // Favourites (localStorage)
  // -----------------------------
  const FAV_KEY = "ff_favourites_v1";

  function loadFavs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); }
    catch { return []; }
  }
  function saveFavs(list) {
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
  }
  function favId(item) {
    // stable ID for places/courses
    if (item.type === "course") return `course:${item.courseId || item.name}`;
    return `place:${item.lat.toFixed(4)},${item.lon.toFixed(4)}`;
  }

  function refreshFavDropdown() {
    const ddl = $("ddlFavs");
    if (!ddl) return;

    const favs = loadFavs();
    ddl.innerHTML = `<option value="">Select a favourite…</option>`;

    favs.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f._id;
      opt.textContent = f.label;
      ddl.appendChild(opt);
    });
  }

  function setFavStar(isFav) {
    const btn = $("btnFav");
    if (!btn) return;
    btn.setAttribute("aria-pressed", isFav ? "true" : "false");
    btn.textContent = isFav ? "★" : "☆";
  }

  // -----------------------------
  // Supabase client
  // -----------------------------
  let supabase = null;
  function initSupabase() {
    try {
      // UMD exposes global `supabase`
      if (window.supabase && window.supabase.createClient) {
        supabase = window.supabase.createClient(SB_URL, SB_KEY);
      }
    } catch (e) {
      console.error("Supabase init error:", e);
    }
  }

  // -----------------------------
  // State
  // -----------------------------
  let coursesCache = [];
  let lastSelection = null; // {type:'place'|'course', label, lat, lon, ...}
  let map = null;
  let mapMarker = null;

  // -----------------------------
  // Utilities
  // -----------------------------
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const pad2 = (n) => String(n).padStart(2, "0");

  function formatTime(tsSeconds, tzOffsetSeconds) {
    // tsSeconds: unix UTC seconds; tzOffsetSeconds: seconds from UTC
    const ms = (tsSeconds + tzOffsetSeconds) * 1000;
    const d = new Date(ms);
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }

  function formatDate(tsSeconds, tzOffsetSeconds) {
    const ms = (tsSeconds + tzOffsetSeconds) * 1000;
    const d = new Date(ms);
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  // -----------------------------
  // OpenWeather calls
  // -----------------------------
  async function fetchForecast(lat, lon, units) {
    const u = units === "F" ? "imperial" : "metric";
    const url =
      `https://api.openweathermap.org/data/2.5/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${u}&appid=${encodeURIComponent(OWM_KEY)}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OWM forecast failed: ${res.status}`);
    return res.json();
  }

  async function fetchCurrentByName(q) {
    // Use geocoding API for place name
    const url =
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=5&appid=${encodeURIComponent(OWM_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geo failed: ${res.status}`);
    return res.json();
  }

  // -----------------------------
  // Courses load
  // -----------------------------
  async function loadCourses() {
    courseStatus("Courses: loading…");
    if (!supabase) {
      courseStatus("Courses: Supabase not ready");
      return;
    }

    const { data, error } = await supabase
      .from(TABLE)
      .select(`${COLS.name},${COLS.lat},${COLS.lon},${COLS.country}`)
      .limit(2000);

    if (error) {
      console.error(error);
      courseStatus(`Courses: error (${error.message})`);
      return;
    }

    coursesCache = (data || []).map((c) => ({
      type: "course",
      name: c[COLS.name],
      country: c[COLS.country],
      lat: Number(c[COLS.lat]),
      lon: Number(c[COLS.lon]),
      label: `${c[COLS.name]} (${c[COLS.country] || "—"})`,
      courseId: c[COLS.name], // you can replace with an id column later
    })).filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.name);

    courseStatus(`Courses: loaded (${coursesCache.length})`);
  }

  // -----------------------------
  // Suggestions (place OR course)
  // -----------------------------
  const suggBox = $("searchSuggestions");
  const searchInput = $("txtSearch");

  function clearSuggestions() {
    if (!suggBox) return;
    suggBox.innerHTML = "";
    hide(suggBox);
  }

  function renderSuggestions(items) {
    if (!suggBox) return;
    suggBox.innerHTML = "";

    items.slice(0, 8).forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "suggItem";
      row.setAttribute("role", "option");
      row.tabIndex = 0;

      const left = document.createElement("div");
      const main = document.createElement("div");
      main.className = "suggMain";
      main.textContent = it.label;

      const sub = document.createElement("div");
      sub.className = "suggSub";
      sub.textContent = it.type === "course" ? "Course" : "Place";

      left.appendChild(main);
      left.appendChild(sub);

      const tag = document.createElement("div");
      tag.className = `suggTag ${it.type}`;
      tag.textContent = it.type === "course" ? "Course" : "Place";

      row.appendChild(left);
      row.appendChild(tag);

      row.addEventListener("click", () => selectSuggestion(it));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") selectSuggestion(it);
      });

      suggBox.appendChild(row);
    });

    if (items.length) show(suggBox);
    else clearSuggestions();
  }

  async function buildSuggestions(q) {
    q = (q || "").trim();
    if (q.length < 2) return clearSuggestions();

    // Courses filter (fast)
    const courseMatches = coursesCache
      .filter(c => c.label.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 5);

    // Places: cheap local inference (no API yet) — we will fetch on Search click
    // But we can show "Search place: {q}" as a suggestion
    const placeStub = [{
      type: "placeQuery",
      label: `Search place: "${q}"`,
      query: q
    }];

    renderSuggestions([...courseMatches, ...placeStub]);
  }

  async function selectSuggestion(it) {
    clearSuggestions();

    if (it.type === "course") {
      lastSelection = it;
      if (searchInput) searchInput.value = it.name;
      await runForecast(it.lat, it.lon, it.label);
      refreshFavStarState();
      return;
    }

    // Place query stub → resolve via geocoding
    if (it.type === "placeQuery") {
      if (searchInput) searchInput.value = it.query;
      await doPlaceSearch(it.query);
      refreshFavStarState();
    }
  }

  // -----------------------------
  // Playability (whole number + bands)
  // -----------------------------
  function computePlayability({ popPct, windMS, feelsC, recentRainLike }) {
    // simple, stable scoring (0..10). You can refine later.
    let score = 10;

    // Rain probability (0..100) hurts
    score -= (popPct / 100) * 4.0; // up to -4

    // Wind hurts
    score -= clamp(windMS, 0, 18) / 18 * 3.0; // up to -3

    // Temperature comfort: target ~12–22C
    const t = feelsC;
    if (t < 6) score -= clamp((6 - t) / 10, 0, 1) * 2.0;
    if (t > 26) score -= clamp((t - 26) / 10, 0, 1) * 2.0;

    // Ground conditions proxy
    if (recentRainLike) score -= 0.8;

    score = clamp(score, 0, 10);

    // whole number rules
    const whole = clamp(Math.round(score), 0, 10);

    let band = "Poor";
    if (whole >= 8) band = "Excellent";
    else if (whole >= 6) band = "Good";
    else if (whole >= 4) band = "Marginal";

    // class for subtle colour reinforcement
    let bandClass = "play-poor";
    if (whole >= 8) bandClass = "play-excellent";
    else if (whole >= 6) bandClass = "play-good";
    else if (whole >= 4) bandClass = "play-fair";

    return { whole, band, bandClass, raw: score };
  }

  function applyPlayabilityUI(result, metaText) {
    setText("playScoreWhole", `${result.whole}`);
    setText("playBand", result.band);
    setText("playMeta", metaText || "—");

    const playHero = $("playHero");
    if (playHero) {
      playHero.classList.remove("play-excellent","play-good","play-fair","play-poor");
      playHero.classList.add(result.bandClass);
    }
  }

  // -----------------------------
  // Best tee time strictly in daylight
  // -----------------------------
  function computeBestTeeTime(list, tzOff, sunriseUTC, sunsetUTC) {
    // list items are 3-hour blocks with dt (UTC seconds)
    // We only allow blocks strictly within daylight window:
    // blockStart >= sunrise AND blockEnd <= sunset
    const sunrise = sunriseUTC;
    const sunset = sunsetUTC;

    const candidates = [];

    for (const it of list) {
      const start = it.dt;           // UTC seconds
      const end = it.dt + 3 * 3600;  // 3 hour block
      if (!(start >= sunrise && end <= sunset)) continue; // daylight-only

      const popPct = Math.round((it.pop || 0) * 100);
      const windMS = it.wind?.speed ?? 0;
      const feels = it.main?.feels_like ?? it.main?.temp ?? 0;

      const p = computePlayability({
        popPct,
        windMS,
        feelsC: feels,
        recentRainLike: false,
      });

      candidates.push({ it, p });
    }

    if (!candidates.length) {
      return { ok: false, message: "No daylight slots found today." };
    }

    // pick highest whole score, tie-break: lowest rain then lowest wind
    candidates.sort((a, b) => {
      if (b.p.whole !== a.p.whole) return b.p.whole - a.p.whole;
      const ap = Math.round((a.it.pop || 0) * 100);
      const bp = Math.round((b.it.pop || 0) * 100);
      if (ap !== bp) return ap - bp;
      const aw = a.it.wind?.speed ?? 0;
      const bw = b.it.wind?.speed ?? 0;
      return aw - bw;
    });

    const best = candidates[0];

    // If the best is still poor (<=3), show “no good tee time”
    if (best.p.whole <= 3) {
      return {
        ok: false,
        message: "No good tee time today — conditions poor throughout daylight hours.",
        bestWhole: best.p.whole
      };
    }

    const startLabel = formatTime(best.it.dt, tzOff);
    const endLabel = formatTime(best.it.dt + 3 * 3600, tzOff);

    return {
      ok: true,
      time: `${startLabel} – ${endLabel}`,
      score: `${best.p.whole}/10 (${best.p.band})`,
      message: buildReason(best.it, best.p),
    };
  }

  function buildReason(it, p) {
    const popPct = Math.round((it.pop || 0) * 100);
    const wind = it.wind?.speed ?? 0;
    const bits = [];
    bits.push(popPct >= 60 ? "High rain risk" : popPct >= 30 ? "Some rain risk" : "Low rain risk");
    bits.push(wind >= 10 ? "Windy" : wind >= 6 ? "Breezy" : "Light wind");
    bits.push(p.band);
    return bits.join(" • ");
  }

  // -----------------------------
  // UI Rendering
  // -----------------------------
  function setSkeleton(on) {
    // Minimal: just status text
    status(on ? "Loading forecast…" : "");
  }

  function setHeroTitles(label, sub) {
    setText("h1Title", label || "—");
    setText("subTitle", sub || "—");
  }

  function setCurrentTop(forecast, tzOff) {
    // use first item as "current-ish"
    const first = forecast.list?.[0];
    if (!first) return;

    // temp + icon
    setText("currTemp", Math.round(first.main?.temp ?? 0));

    const icon = first.weather?.[0]?.icon;
    const img = $("imgIcon");
    if (img && icon) {
      img.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
      img.alt = first.weather?.[0]?.description || "";
    }

    // conditions
    setText("feelsLike", Math.round(first.main?.feels_like ?? first.main?.temp ?? 0));
    setText("humidity", Math.round(first.main?.humidity ?? 0));

    const windMS = first.wind?.speed ?? 0;
    setText("wind", `${Math.round(windMS)} m/s`);
    setText("windDir", windDirection(first.wind?.deg));

    // sunrise/sunset from city
    const sunrise = forecast.city?.sunrise;
    const sunset = forecast.city?.sunset;
    if (sunrise && sunset) {
      setText("sunrise", formatTime(sunrise, tzOff));
      setText("sunset", formatTime(sunset, tzOff));
      setText("teeSunrise", formatTime(sunrise, tzOff));
      setText("teeSunset", formatTime(sunset, tzOff));

      const dayLenSec = sunset - sunrise;
      const h = Math.floor(dayLenSec / 3600);
      const m = Math.floor((dayLenSec % 3600) / 60);
      setText("dayLength", `Day length: ${h}h ${m}m`);
    }
  }

  function windDirection(deg) {
    if (deg === null || deg === undefined || Number.isNaN(deg)) return "—";
    const dirs = ["N","NE","E","SE","S","SW","W","NW"];
    const idx = Math.round((deg % 360) / 45) % 8;
    return `${dirs[idx]} (${Math.round(deg)}°)`;
  }

  function renderDaily(forecast, tzOff) {
    const wrap = $("dailyForecast");
    if (!wrap) return;
    wrap.innerHTML = "";

    // group by date (local)
    const byDay = new Map();
    for (const it of forecast.list || []) {
      const ms = (it.dt + tzOff) * 1000;
      const d = new Date(ms);
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(it);
    }

    const days = Array.from(byDay.entries()).slice(0, 5);

    days.forEach(([key, items], idx) => {
      const temps = items.map(i => i.main?.temp).filter(Number.isFinite);
      const min = Math.round(Math.min(...temps));
      const max = Math.round(Math.max(...temps));

      // midday-ish item for icon and playability estimate
      const mid = items[Math.floor(items.length / 2)] || items[0];
      const icon = mid.weather?.[0]?.icon;

      const popPct = Math.round((mid.pop || 0) * 100);
      const windMS = mid.wind?.speed ?? 0;
      const feels = mid.main?.feels_like ?? mid.main?.temp ?? 0;

      const p = computePlayability({ popPct, windMS, feelsC: feels, recentRainLike: false });

      const ms = (mid.dt + tzOff) * 1000;
      const d = new Date(ms);
      const label = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()];

      const card = document.createElement("div");
      card.className = "dayCard";
      card.addEventListener("click", () => {
        // switch to hourly panel and set dropdown day
        showPanel("hourly");
        selectDayInDropdown(idx);
      });

      card.innerHTML = `
        <div class="dayTop">
          <div>${label}</div>
          <div class="dayScore">${p.whole}/10</div>
        </div>
        <div class="dayIcon">${icon ? `<img alt="" src="https://openweathermap.org/img/wn/${icon}@2x.png" />` : ""}</div>
        <div class="dayTemps"><span>${max}°</span><span class="dayMin">${min}°</span></div>
        <div class="dayWindRow">${p.band}</div>
      `;

      wrap.appendChild(card);
    });
  }

  function buildDayDropdown(forecast, tzOff) {
    const ddl = $("ddlDay");
    if (!ddl) return;

    // unique dates
    const unique = [];
    const seen = new Set();

    for (const it of forecast.list || []) {
      const ms = (it.dt + tzOff) * 1000;
      const d = new Date(ms);
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ key, dt: it.dt, label: formatDate(it.dt, tzOff) });
      if (unique.length >= 5) break;
    }

    ddl.innerHTML = "";
    unique.forEach((d, idx) => {
      const opt = document.createElement("option");
      opt.value = d.key;
      opt.textContent = d.label;
      ddl.appendChild(opt);
    });

    ddl.onchange = () => renderHourlyForDay(forecast, tzOff, ddl.value);
    if (unique[0]) renderHourlyForDay(forecast, tzOff, unique[0].key);
  }

  function selectDayInDropdown(index) {
    const ddl = $("ddlDay");
    if (!ddl) return;
    const opt = ddl.options[index];
    if (opt) {
      ddl.value = opt.value;
      ddl.dispatchEvent(new Event("change"));
    }
  }

  function renderHourlyForDay(forecast, tzOff, dayKey) {
    const wrap = $("hourlyForecast");
    if (!wrap) return;
    wrap.innerHTML = "";

    const items = (forecast.list || []).filter((it) => {
      const ms = (it.dt + tzOff) * 1000;
      const d = new Date(ms);
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
      return key === dayKey;
    });

    items.slice(0, 8).forEach((it) => {
      const t = formatTime(it.dt, tzOff);
      const temp = Math.round(it.main?.temp ?? 0);
      const popPct = Math.round((it.pop || 0) * 100);
      const windMS = it.wind?.speed ?? 0;

      const card = document.createElement("div");
      card.className = "hourCard";
      card.innerHTML = `
        <div class="hourTime">${t}</div>
        <div class="hourTemp">${temp}°</div>
        <div class="hourWind">${Math.round(windMS)} m/s • ${popPct}%</div>
      `;
      wrap.appendChild(card);
    });
  }

  // -----------------------------
  // Map + Rain timeline
  // -----------------------------
  function ensureMap(lat, lon) {
    const mapEl = $("map");
    if (!mapEl) return;

    // Leaflet might not be ready yet (still loading)
    if (!window.L) return;

    if (!map) {
      map = L.map(mapEl, { zoomControl: false }).setView([lat, lon], 9);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "",
      }).addTo(map);
    } else {
      map.setView([lat, lon], 9);
    }

    if (!mapMarker) {
      mapMarker = L.marker([lat, lon]).addTo(map);
    } else {
      mapMarker.setLatLng([lat, lon]);
    }
  }

  function renderRainTimeline(forecast, tzOff) {
    const wrap = $("rainTimeline");
    if (!wrap) return;
    wrap.innerHTML = "";

    const items = (forecast.list || []).slice(0, 8);

    items.forEach((it) => {
      const time = formatTime(it.dt, tzOff);
      const popPct = Math.round((it.pop || 0) * 100);

      const tick = document.createElement("div");
      tick.className = "rainTick";
      tick.innerHTML = `
        <div class="rainTime">${time}</div>
        <div class="rainBar"><div class="rainFill" style="--w:${popPct}%"></div></div>
        <div class="rainPct">${popPct}%</div>
      `;
      wrap.appendChild(tick);
    });

    // message
    const soon = items.find(it => (it.pop || 0) >= 0.3);
    if (!soon) setText("rainMessage", "No rain expected soon");
    else {
      const mins = Math.max(0, Math.round(((soon.dt - (forecast.list?.[0]?.dt || soon.dt)) / 60)));
      setText("rainMessage", `Rain possible in ~${mins} min`);
    }
  }

  // -----------------------------
  // Unified search handlers
  // -----------------------------
  async function doPlaceSearch(q) {
    setSkeleton(true);
    try {
      const results = await fetchCurrentByName(q);
      if (!results.length) {
        status("No place found.");
        toast("No place found");
        return;
      }

      const r = results[0];
      const label = `${r.name}${r.state ? ", " + r.state : ""}, ${r.country || ""}`.trim();

      lastSelection = {
        type: "place",
        label,
        lat: Number(r.lat),
        lon: Number(r.lon),
      };

      await runForecast(lastSelection.lat, lastSelection.lon, label);
    } catch (e) {
      console.error(e);
      status("Search failed.");
      toast("Search failed");
    } finally {
      setSkeleton(false);
    }
  }

  async function doCourseSearchByName(name) {
    const match = coursesCache.find(c => c.name.toLowerCase() === name.toLowerCase())
      || coursesCache.find(c => c.label.toLowerCase().includes(name.toLowerCase()));
    if (!match) {
      toast("Course not found in database");
      return;
    }
    lastSelection = match;
    await runForecast(match.lat, match.lon, match.label);
    refreshFavStarState();
  }

  async function unifiedSearch() {
    const q = (searchInput?.value || "").trim();
    if (!q) return;

    // prefer course exact match if available
    const exactCourse = coursesCache.find(c => c.name.toLowerCase() === q.toLowerCase());
    if (exactCourse) return doCourseSearchByName(exactCourse.name);

    // else treat as place search
    return doPlaceSearch(q);
  }

  // -----------------------------
  // Favourites toggle / apply
  // -----------------------------
  function refreshFavStarState() {
    if (!lastSelection) return setFavStar(false);

    const id = favId(lastSelection);
    const favs = loadFavs();
    setFavStar(favs.some(f => f._id === id));
  }

  function toggleFavourite() {
    if (!lastSelection) {
      toast("Search a place or course first");
      return;
    }

    const id = favId(lastSelection);
    const favs = loadFavs();
    const idx = favs.findIndex(f => f._id === id);

    if (idx >= 0) {
      favs.splice(idx, 1);
      saveFavs(favs);
      setFavStar(false);
      toast("Removed from favourites");
    } else {
      favs.unshift({
        _id: id,
        type: lastSelection.type,
        label: lastSelection.label,
        lat: lastSelection.lat,
        lon: lastSelection.lon
      });
      saveFavs(favs);
      setFavStar(true);
      toast("Added to favourites");
    }
    refreshFavDropdown();
  }

  async function applyFavouriteById(id) {
    const favs = loadFavs();
    const f = favs.find(x => x._id === id);
    if (!f) return;

    lastSelection = { type: f.type, label: f.label, lat: f.lat, lon: f.lon };
    if (searchInput) searchInput.value = f.label;

    await runForecast(f.lat, f.lon, f.label);
    refreshFavStarState();
  }

  // -----------------------------
  // Panels (nav)
  // -----------------------------
  function showPanel(view) {
    // Only show/hide daily/hourly cards (hero + map always visible)
    const daily = $("cardDaily");
    const hourly = $("cardHourly");

    if (daily && hourly) {
      if (view === "daily") { daily.classList.remove("is-hidden"); hourly.classList.add("is-hidden"); }
      else if (view === "hourly") { hourly.classList.remove("is-hidden"); daily.classList.add("is-hidden"); }
      else { daily.classList.add("is-hidden"); hourly.classList.add("is-hidden"); }
    }

    // nav active
    document.querySelectorAll(".nav__btn").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.view === view);
    });
  }

  // -----------------------------
  // Playability popover
  // -----------------------------
  function initPopover() {
    const btnInfo = $("btnPlayInfo");
    const pop = $("playPopover");
    const btnClose = $("btnPlayClose");

    if (!btnInfo || !pop || !btnClose) return;

    const open = () => {
      pop.classList.remove("is-hidden");
      pop.setAttribute("aria-hidden", "false");
      btnInfo.setAttribute("aria-expanded", "true");
    };
    const close = () => {
      pop.classList.add("is-hidden");
      pop.setAttribute("aria-hidden", "true");
      btnInfo.setAttribute("aria-expanded", "false");
    };

    btnInfo.addEventListener("click", (e) => {
      e.stopPropagation();
      pop.classList.contains("is-hidden") ? open() : close();
    });
    btnClose.addEventListener("click", (e) => {
      e.stopPropagation();
      close();
    });
    document.addEventListener("click", (e) => {
      if (!pop.contains(e.target) && e.target !== btnInfo) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  // -----------------------------
  // Main render flow
  // -----------------------------
  async function runForecast(lat, lon, label) {
    if (!OWM_KEY) {
      status("Missing OpenWeather key in config.js");
      return;
    }

    setSkeleton(true);

    const units = $("ddlUnits")?.value || "C";
    try {
      const forecast = await fetchForecast(lat, lon, units);
      const tzOff = forecast.city?.timezone ?? 0; // seconds

      // Titles
      setHeroTitles(label, formatDate(forecast.list?.[0]?.dt || Math.floor(Date.now()/1000), tzOff));

      // Current
      setCurrentTop(forecast, tzOff);

      // Playability based on first block
      const first = forecast.list?.[0];
      if (first) {
        const popPct = Math.round((first.pop || 0) * 100);
        const windMS = first.wind?.speed ?? 0;

        // For playability we want Celsius logic. If user chose F, convert feels to C for scoring.
        let feels = first.main?.feels_like ?? first.main?.temp ?? 0;
        let feelsC = units === "F" ? (feels - 32) * (5/9) : feels;

        const p = computePlayability({
          popPct,
          windMS,
          feelsC,
          recentRainLike: false,
        });

        applyPlayabilityUI(p, buildReason(first, p));
      }

      // Map + rain
      ensureMap(lat, lon);
      renderRainTimeline(forecast, tzOff);

      // Daily + Hourly
      renderDaily(forecast, tzOff);
      buildDayDropdown(forecast, tzOff);

      // Best tee time (today only)
      const sunriseUTC = forecast.city?.sunrise;
      const sunsetUTC = forecast.city?.sunset;

      if (sunriseUTC && sunsetUTC) {
        const todayKey = (() => {
          const ms = ((forecast.list?.[0]?.dt || sunriseUTC) + tzOff) * 1000;
          const d = new Date(ms);
          return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
        })();

        const todays = (forecast.list || []).filter((it) => {
          const ms = (it.dt + tzOff) * 1000;
          const d = new Date(ms);
          const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
          return key === todayKey;
        });

        const best = computeBestTeeTime(todays, tzOff, sunriseUTC, sunsetUTC);

        if (!best.ok) {
          setText("bestTeeTime", "—");
          setText("bestTeeScore", "—");
          setText("teeMsg", best.message || "—");
        } else {
          setText("bestTeeTime", best.time);
          setText("bestTeeScore", best.score);
          setText("teeMsg", best.message);
        }
      } else {
        setText("teeMsg", "Sunrise/sunset unavailable for this location.");
      }

      status("");
    } catch (e) {
      console.error(e);
      status("Forecast failed. Check API key and console.");
      toast("Forecast failed");
    } finally {
      setSkeleton(false);
    }
  }

  // -----------------------------
  // Init
  // -----------------------------
  async function init() {
    initSupabase();
    initPopover();
    refreshFavDropdown();

    // Load courses
    if (SB_URL && SB_KEY && supabase) {
      await loadCourses();
    } else {
      courseStatus("Courses: Supabase not configured");
    }

    // Search events
    $("btnSearch")?.addEventListener("click", unifiedSearch);
    searchInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") unifiedSearch(); });
    searchInput?.addEventListener("input", () => buildSuggestions(searchInput.value));
    searchInput?.addEventListener("blur", () => setTimeout(clearSuggestions, 120));

    // Geo
    $("btnGeo")?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        toast("Geolocation not supported");
        return;
      }
      setSkeleton(true);
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        lastSelection = { type: "place", label: "My location", lat, lon };
        if (searchInput) searchInput.value = "My location";
        await runForecast(lat, lon, "My location");
        refreshFavStarState();
        setSkeleton(false);
      }, (err) => {
        console.error(err);
        toast("Geolocation denied");
        setSkeleton(false);
      }, { enableHighAccuracy: false, timeout: 8000 });
    });

    // Favourites
    $("btnFav")?.addEventListener("click", toggleFavourite);
    $("ddlFavs")?.addEventListener("change", (e) => {
      const id = e.target.value;
      if (id) applyFavouriteById(id);
    });

    // Units change rerun
    $("ddlUnits")?.addEventListener("change", () => {
      if (lastSelection) runForecast(lastSelection.lat, lastSelection.lon, lastSelection.label);
    });

    // Nav
    document.querySelectorAll(".nav__btn").forEach(btn => {
      btn.addEventListener("click", () => showPanel(btn.dataset.view));
    });

    // Default start: try Swindon
    if (!lastSelection) {
      await doPlaceSearch("Swindon, GB");
      refreshFavStarState();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
