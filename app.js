/* app.js — Fairway Forecast (Option A: free OpenWeather endpoints only)
   Uses:
   - /data/2.5/weather   (current + sunrise/sunset)
   - /data/2.5/forecast  (5-day / 3-hour blocks -> hourly + daily grouping)
   GitHub Pages + WebView friendly.
*/

(() => {
  "use strict";

  // ---------------------------
  // CONFIG + CONSTANTS
  // ---------------------------
  const CFG = window.APP_CONFIG || {};
  const OW_KEY = (CFG.OPENWEATHER_KEY || "").trim();
  const DEFAULT_UNITS = "metric"; // metric/imperial
  const LS = {
    units: "ff_units",
    tab: "ff_tab",
    favs: "ff_favs",
    selection: "ff_selection",
  };

  // Supabase optional (courses)
  const SUPABASE_URL = (CFG.SUPABASE_URL || "").trim();
  const SUPABASE_ANON_KEY = (CFG.SUPABASE_ANON_KEY || "").trim();
  const COURSES_TABLE = (CFG.COURSES_TABLE || "uk_golf_courses").trim();
  const COURSES_COLS = CFG.COURSE_COLS || {
    name: "name",
    lat: "latitude",
    lon: "longitude",
    country: "country",
    website: "website",
  };

  // ---------------------------
  // DOM
  // ---------------------------
  const el = (id) => document.getElementById(id);

  const dom = {
    // controls
    txtSearch: el("txtSearch"),
    btnSearch: el("btnSearch"),
    btnGeo: el("btnGeo"),
    btnFav: el("btnFav"),
    ddlFavs: el("ddlFavs"),
    ddlUnits: el("ddlUnits"),
    suggestions: el("searchSuggestions"),
    coursesStatus: el("coursesStatus"),
    appStatus: el("appStatus"),

    // tabs/panels
    tabs: Array.from(document.querySelectorAll(".tab[data-tab]")),
    panels: Array.from(document.querySelectorAll(".panel[data-panel]")),
    forecastAnchor: el("forecast"),

    // hero text
    h1Title: el("h1Title"),
    subTitle: el("subTitle"),
    imgIcon: el("imgIcon"),
    currTemp: el("currTemp"),

    // playability hero
    playScoreWhole: el("playScoreWhole"),
    playBand: el("playBand"),
    playMeta: el("playMeta"),
    playHero: el("playHero"),
    btnPlayInfo: el("btnPlayInfo"),
    btnPlayClose: el("btnPlayClose"),
    playPopover: el("playPopover"),

    // metrics
    feelsLike: el("feelsLike"),
    humidity: el("humidity"),
    wind: el("wind"),
    windDir: el("windDir"),
    sunrise: el("sunrise"),
    sunset: el("sunset"),
    dayLength: el("dayLength"),

    // tee time
    teeSunrise: el("teeSunrise"),
    teeSunset: el("teeSunset"),
    bestTeeTime: el("bestTeeTime"),
    bestTeeScore: el("bestTeeScore"),
    teeMsg: el("teeMsg"),
    teeMain: el("teeMain"),

    // map + rain timeline
    rainMessage: el("rainMessage"),
    rainTimeline: el("rainTimeline"),
    map: el("map"),

    // hourly/daily
    ddlDay: el("ddlDay"),
    hourlyForecast: el("hourlyForecast"),
    dailyForecast: el("dailyForecast"),

    // toast
    toast: el("toast"),
  };

  // ---------------------------
  // STATE
  // ---------------------------
  const state = {
    units: loadJSON(LS.units, "C") === "F" ? "imperial" : "metric",
    activeTab: loadJSON(LS.tab, "current"),
    selection: loadJSON(LS.selection, null), // {type:'place'|'course', label, lat, lon, country?}
    favs: loadJSON(LS.favs, []), // [{id,label,lat,lon,type}]
    courses: [],
    map: null,
    marker: null,
    supabase: null,
  };

  // ---------------------------
  // INIT
  // ---------------------------
  init();

  async function init() {
    // Units
    dom.ddlUnits.value = state.units === "imperial" ? "F" : "C";
    dom.ddlUnits.addEventListener("change", () => {
      state.units = dom.ddlUnits.value === "F" ? "imperial" : "metric";
      saveJSON(LS.units, dom.ddlUnits.value);
      if (state.selection) refreshForecast(state.selection).catch(showErr);
    });

    // Tabs
    dom.tabs.forEach((b) =>
      b.addEventListener("click", () => setActiveTab(b.dataset.tab, true))
    );
    setActiveTab(state.activeTab, false);

    // Playability popover
    dom.btnPlayInfo?.addEventListener("click", () => togglePlayPopover(true));
    dom.btnPlayClose?.addEventListener("click", () => togglePlayPopover(false));
    document.addEventListener("click", (e) => {
      if (!dom.playPopover) return;
      if (dom.playPopover.classList.contains("is-hidden")) return;
      const within = dom.playPopover.contains(e.target) || dom.btnPlayInfo.contains(e.target);
      if (!within) togglePlayPopover(false);
    });

    // Search
    dom.btnSearch.addEventListener("click", () => runSearchFromInput());
    dom.txtSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") runSearchFromInput();
    });
    dom.txtSearch.addEventListener("input", () => updateSuggestions());

    // Geo
    dom.btnGeo.addEventListener("click", () => useMyLocation());

    // Favourites
    dom.btnFav.addEventListener("click", () => toggleFavourite());
    dom.ddlFavs.addEventListener("change", () => {
      const id = dom.ddlFavs.value;
      if (!id) return;
      const fav = state.favs.find((f) => f.id === id);
      if (fav) applySelection(fav, true);
    });
    renderFavs();

    // Supabase courses load (optional)
    await initSupabaseCourses();

    // Default selection
    if (!state.selection) {
      // sensible default for UK beta
      state.selection = { type: "place", label: "Swindon, GB", lat: 51.5558, lon: -1.7797, country: "GB" };
      saveJSON(LS.selection, state.selection);
    }
    await refreshForecast(state.selection);
  }

  // ---------------------------
  // TABS
  // ---------------------------
  function setActiveTab(tab, shouldScroll) {
    const valid = ["current", "hourly", "daily"];
    if (!valid.includes(tab)) tab = "current";
    state.activeTab = tab;
    saveJSON(LS.tab, tab);

    dom.tabs.forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });

    dom.panels.forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === tab);
    });

    if (shouldScroll && isMobile()) {
      // account for sticky header
      dom.forecastAnchor?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function isMobile() {
    return window.matchMedia("(max-width: 720px)").matches;
  }

  // ---------------------------
  // SEARCH + SUGGESTIONS
  // ---------------------------
  function runSearchFromInput() {
    const q = (dom.txtSearch.value || "").trim();
    if (!q) return;
    // Prefer: if user clicked a suggestion, it will have data-selection cached
    const picked = dom.suggestions?.querySelector(".suggestion.is-picked");
    if (picked && picked.dataset.sel) {
      try {
        const sel = JSON.parse(picked.dataset.sel);
        applySelection(sel, true);
        hideSuggestions();
        return;
      } catch {}
    }
    // Otherwise: try as place (geocode). If no geocode, try course name match.
    searchPlaceThenCourse(q).catch(showErr);
  }

  async function updateSuggestions() {
    const q = (dom.txtSearch.value || "").trim();
    if (q.length < 2) return hideSuggestions();

    // We show a MIX of: (1) local course matches (2) lightweight place guess (no external call yet)
    // Important: avoid “every search starts with course” — we interleave place hint at top.
    const items = [];

    // Place hint (non-committal) — always first
    items.push({
      kind: "hint",
      label: `Search place: "${q}"`,
      sel: null,
    });

    // Course matches
    const courseMatches = state.courses
      .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 8)
      .map((c) => ({
        kind: "course",
        label: `${c.name}${c.country ? ` (${c.country})` : ""}`,
        sel: { type: "course", label: c.name, lat: c.lat, lon: c.lon, country: c.country || "" },
      }));

    items.push(...courseMatches);

    renderSuggestions(items);
  }

  function renderSuggestions(items) {
    if (!dom.suggestions) return;
    dom.suggestions.innerHTML = "";
    items.forEach((it, idx) => {
      const d = document.createElement("div");
      d.className = "suggestion";
      d.setAttribute("role", "option");
      d.tabIndex = 0;

      if (it.kind === "hint") {
        d.classList.add("suggestion--hint");
        d.textContent = it.label;
        d.addEventListener("click", async () => {
          await searchPlaceThenCourse((dom.txtSearch.value || "").trim());
        });
      } else {
        d.textContent = it.label;
        d.dataset.sel = JSON.stringify(it.sel);
        d.addEventListener("click", () => {
          d.classList.add("is-picked");
          applySelection(it.sel, true);
          hideSuggestions();
        });
      }

      dom.suggestions.appendChild(d);
    });

    dom.suggestions.classList.remove("is-hidden");
  }

  function hideSuggestions() {
    dom.suggestions?.classList.add("is-hidden");
    if (dom.suggestions) dom.suggestions.innerHTML = "";
  }

  async function searchPlaceThenCourse(q) {
    // Try place via geocoding
    const geo = await geocode(q);
    if (geo) {
      applySelection({ type: "place", label: geo.label, lat: geo.lat, lon: geo.lon, country: geo.country }, true);
      hideSuggestions();
      return;
    }

    // Fallback: course exact-ish
    const hit = state.courses.find((c) => c.name.toLowerCase() === q.toLowerCase())
      || state.courses.find((c) => c.name.toLowerCase().includes(q.toLowerCase()));
    if (hit) {
      applySelection({ type: "course", label: hit.name, lat: hit.lat, lon: hit.lon, country: hit.country }, true);
      hideSuggestions();
      return;
    }

    showToast("No results. Try a city/town (e.g. Swindon) or a course name.");
  }

  // OpenWeather direct geocoding
  async function geocode(query) {
    if (!OW_KEY) throw new Error("Missing OPENWEATHER_KEY");
    const url =
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=1&appid=${encodeURIComponent(OW_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const arr = await res.json();
    if (!arr || !arr.length) return null;
    const g = arr[0];
    const label = [g.name, g.state, g.country].filter(Boolean).join(", ");
    return { label, lat: g.lat, lon: g.lon, country: g.country || "" };
  }

  async function useMyLocation() {
    if (!navigator.geolocation) {
      showToast("Geolocation not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        applySelection({ type: "place", label: "My location", lat, lon, country: "" }, true);
      },
      () => showToast("Could not access location. Check permissions."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // ---------------------------
  // SELECTION + FAVS
  // ---------------------------
  function applySelection(sel, shouldScroll) {
    state.selection = { ...sel };
    saveJSON(LS.selection, state.selection);

    // Update UI label
    dom.h1Title.textContent = sel.label || "—";
    dom.subTitle.textContent = sel.type === "course" ? (sel.country ? sel.country : "Golf course") : (sel.country || "—");

    // Update fav star state
    syncFavButton();

    refreshForecast(sel).catch(showErr);

    if (shouldScroll) setActiveTab(state.activeTab, true);
  }

  function selectionId(sel) {
    // stable-ish id; if you have real course IDs later, use them
    return `${sel.type}:${(sel.label || "").toLowerCase()}@${round2(sel.lat)}:${round2(sel.lon)}`;
  }

  function toggleFavourite() {
    if (!state.selection) return;
    const id = selectionId(state.selection);
    const exists = state.favs.some((f) => f.id === id);
    if (exists) {
      state.favs = state.favs.filter((f) => f.id !== id);
      showToast("Removed from favourites");
    } else {
      state.favs.unshift({
        id,
        type: state.selection.type,
        label: state.selection.label,
        lat: state.selection.lat,
        lon: state.selection.lon,
        country: state.selection.country || "",
      });
      showToast("Added to favourites");
    }
    saveJSON(LS.favs, state.favs);
    renderFavs();
    syncFavButton();
  }

  function syncFavButton() {
    if (!state.selection) return;
    const id = selectionId(state.selection);
    const on = state.favs.some((f) => f.id === id);
    dom.btnFav.textContent = on ? "★" : "☆";
    dom.btnFav.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function renderFavs() {
    dom.ddlFavs.innerHTML = `<option value="">Select a favourite…</option>`;
    for (const f of state.favs) {
      const o = document.createElement("option");
      o.value = f.id;
      o.textContent = f.label;
      dom.ddlFavs.appendChild(o);
    }
  }

  // ---------------------------
  // SUPABASE COURSES (OPTIONAL)
  // ---------------------------
  async function initSupabaseCourses() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
      dom.coursesStatus.textContent = "Courses: ready ✓";
      return;
    }
    try {
      state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      dom.coursesStatus.textContent = "Courses: loading…";
      const cols = [
        COURSES_COLS.name,
        COURSES_COLS.lat,
        COURSES_COLS.lon,
        COURSES_COLS.country,
        COURSES_COLS.website,
      ].filter(Boolean).join(",");

      // IMPORTANT for UK-wide table: don't pull everything at once if huge.
      // We fetch first 2500 rows; refine later with server-side search/RPC if needed.
      const { data, error } = await state.supabase
        .from(COURSES_TABLE)
        .select(cols)
        .order(COURSES_COLS.name, { ascending: true })
        .range(0, 2499);

      if (error) throw error;

      state.courses = (data || []).map((r) => ({
        name: r[COURSES_COLS.name],
        lat: Number(r[COURSES_COLS.lat]),
        lon: Number(r[COURSES_COLS.lon]),
        country: r[COURSES_COLS.country] || "",
        website: r[COURSES_COLS.website] || "",
      })).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.name);

      dom.coursesStatus.textContent = `Courses: ready ✓ (${state.courses.length.toLocaleString()} loaded)`;
    } catch (e) {
      dom.coursesStatus.textContent = "Courses: failed (check Supabase keys / RLS)";
      // not fatal
      console.warn(e);
    }
  }

  // ---------------------------
  // FORECAST (FREE ENDPOINTS ONLY)
  // ---------------------------
  async function refreshForecast(sel) {
    if (!OW_KEY) throw new Error("Missing OPENWEATHER_KEY");
    setStatus("");

    skeleton(true);

    const units = state.units; // metric/imperial
    const lat = sel.lat;
    const lon = sel.lon;

    // 1) Current (includes sunrise/sunset)
    const current = await fetchCurrent(lat, lon, units);

    // 2) Forecast 5-day / 3-hour
    const fc = await fetchForecast(lat, lon, units);

    // Render current
    renderCurrent(current, units);

    // Render hourly (3h blocks)
    renderHourly(fc, units);

    // Render daily (grouped from 3h blocks)
    renderDailyFrom3h(fc, units);

    // Playability + tee time derived from 3h blocks + sunrise/sunset
    const sunrise = current.sys?.sunrise ? current.sys.sunrise * 1000 : null;
    const sunset = current.sys?.sunset ? current.sys.sunset * 1000 : null;

    computeAndRenderPlayabilityAndTeeTime(fc, sunrise, sunset, units);

    // Map + rain timeline from forecast list
    renderMap(lat, lon);
    renderRainTimeline(fc);

    skeleton(false);
  }

  async function fetchCurrent(lat, lon, units) {
    const url =
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${units}` +
      `&appid=${encodeURIComponent(OW_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await safeText(res);
      throw new Error(`OpenWeather current error ${res.status}: ${txt}`);
    }
    return res.json();
  }

  async function fetchForecast(lat, lon, units) {
    const url =
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}` +
      `&appid=${encodeURIComponent(OW_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await safeText(res);
      throw new Error(`OpenWeather forecast error ${res.status}: ${txt}`);
    }
    return res.json();
  }

  // ---------------------------
  // RENDER: CURRENT
  // ---------------------------
  function renderCurrent(curr, units) {
    const temp = Math.round(curr.main?.temp ?? NaN);
    const feels = Math.round(curr.main?.feels_like ?? NaN);
    const hum = Math.round(curr.main?.humidity ?? NaN);
    const wind = curr.wind?.speed ?? NaN;
    const deg = curr.wind?.deg ?? null;

    dom.currTemp.textContent = Number.isFinite(temp) ? String(temp) : "--";
    dom.feelsLike.textContent = Number.isFinite(feels) ? String(feels) : "--";
    dom.humidity.textContent = Number.isFinite(hum) ? String(hum) : "--";

    dom.wind.textContent = Number.isFinite(wind)
      ? `${formatWind(wind, units)}`
      : "--";
    dom.windDir.textContent = deg == null ? "" : `(${deg}°)`;

    // icon
    const icon = curr.weather?.[0]?.icon;
    if (icon && dom.imgIcon) {
      dom.imgIcon.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
      dom.imgIcon.alt = curr.weather?.[0]?.description || "";
    }

    // sunrise/sunset
    const sr = curr.sys?.sunrise ? curr.sys.sunrise * 1000 : null;
    const ss = curr.sys?.sunset ? curr.sys.sunset * 1000 : null;

    const srTxt = sr ? fmtTime(sr) : "--";
    const ssTxt = ss ? fmtTime(ss) : "--";

    dom.sunrise.textContent = srTxt;
    dom.sunset.textContent = ssTxt;
    dom.teeSunrise.textContent = srTxt;
    dom.teeSunset.textContent = ssTxt;

    if (sr && ss) {
      const lenMs = ss - sr;
      dom.dayLength.textContent = `Day length: ${fmtDuration(lenMs)}`;
    } else {
      dom.dayLength.textContent = "Day length: —";
    }
  }

  // ---------------------------
  // RENDER: HOURLY (3h blocks)
  // ---------------------------
  function renderHourly(fc, units) {
    const list = (fc.list || []).slice();
    dom.hourlyForecast.innerHTML = "";
    dom.ddlDay.innerHTML = "";

    if (!list.length) {
      dom.hourlyForecast.innerHTML = `<div class="empty">No hourly data.</div>`;
      return;
    }

    const days = groupByDay(list);

    // day dropdown
    const dayKeys = Object.keys(days);
    dayKeys.forEach((k) => {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = k;
      dom.ddlDay.appendChild(o);
    });

    dom.ddlDay.addEventListener("change", () => {
      const key = dom.ddlDay.value;
      renderHourlyBlocks(days[key] || [], units);
    });

    // render first day by default
    dom.ddlDay.value = dayKeys[0];
    renderHourlyBlocks(days[dayKeys[0]], units);
  }

  function renderHourlyBlocks(blocks, units) {
    dom.hourlyForecast.innerHTML = "";
    if (!blocks.length) {
      dom.hourlyForecast.innerHTML = `<div class="empty">No hourly data for that day.</div>`;
      return;
    }

    blocks.forEach((b) => {
      const dt = b.dt * 1000;
      const t = Math.round(b.main?.temp ?? NaN);
      const pop = Math.round((b.pop ?? 0) * 100);
      const w = b.wind?.speed ?? NaN;
      const icon = b.weather?.[0]?.icon || "01d";

      const card = document.createElement("div");
      card.className = "hourCard";
      card.innerHTML = `
        <div class="hourTop">
          <div class="hourTime">${fmtTime(dt)}</div>
          <img class="wIcon" alt="" src="https://openweathermap.org/img/wn/${icon}.png" />
        </div>
        <div class="hourMid">
          <div class="hourTemp">${Number.isFinite(t) ? t : "--"}°</div>
        </div>
        <div class="hourBot">
          <div class="mini">Rain ${pop}%</div>
          <div class="mini">Wind ${Number.isFinite(w) ? formatWind(w, units) : "--"}</div>
        </div>
      `;
      dom.hourlyForecast.appendChild(card);
    });
  }

  // ---------------------------
  // RENDER: DAILY (derived from 3h blocks)
  // ---------------------------
  function renderDailyFrom3h(fc, units) {
    const list = (fc.list || []).slice();
    dom.dailyForecast.innerHTML = "";

    if (!list.length) {
      dom.dailyForecast.innerHTML = `<div class="empty">No daily data.</div>`;
      return;
    }

    const days = groupByDay(list);
    const keys = Object.keys(days).slice(0, 7); // "up to 7", but forecast provides up to ~5 days

    keys.forEach((k) => {
      const blocks = days[k];

      const temps = blocks.map((x) => x.main?.temp).filter(Number.isFinite);
      const max = temps.length ? Math.round(Math.max(...temps)) : "--";
      const min = temps.length ? Math.round(Math.min(...temps)) : "--";

      const popAvg = avg(blocks.map((x) => (x.pop ?? 0)));
      const popPct = Math.round(popAvg * 100);

      const windAvg = avg(blocks.map((x) => x.wind?.speed).filter(Number.isFinite));
      const windTxt = Number.isFinite(windAvg) ? formatWind(windAvg, units) : "--";

      // pick icon from midday-ish block
      const iconBlock = blocks[Math.floor(blocks.length / 2)];
      const icon = iconBlock?.weather?.[0]?.icon || "01d";

      const card = document.createElement("div");
      card.className = "dayCard";
      card.innerHTML = `
        <div class="dayLeft">
          <div class="dayName">${k}</div>
          <div class="dayMeta">Rain ${popPct}% • Wind ${windTxt}</div>
        </div>
        <div class="dayRight">
          <img class="wIcon" alt="" src="https://openweathermap.org/img/wn/${icon}.png" />
          <div class="dayTemps">
            <span class="hi">${max}°</span>
            <span class="lo">${min}°</span>
          </div>
        </div>
      `;
      dom.dailyForecast.appendChild(card);
    });
  }

  // ---------------------------
  // PLAYABILITY + BEST TEE TIME (DAYLIGHT ONLY)
  // ---------------------------
  function computeAndRenderPlayabilityAndTeeTime(fc, sunriseMs, sunsetMs, units) {
    const list = (fc.list || []).slice();
    if (!list.length) {
      setPlayability(null);
      setTeeTime(null, "No forecast data available.");
      return;
    }

    // Choose "today" blocks based on local date of first block
    const days = groupByDay(list);
    const todayKey = Object.keys(days)[0];
    const blocks = days[todayKey] || [];

    // Daylight filtering (strictly within)
    const daylightBlocks = blocks.filter((b) => {
      const t = b.dt * 1000;
      if (!sunriseMs || !sunsetMs) return true; // if missing, don't block
      return t > sunriseMs && t < sunsetMs; // STRICT
    });

    // If no daylight blocks (winter edge cases), handle gracefully
    if (sunriseMs && sunsetMs && !daylightBlocks.length) {
      setTeeTime(null, "No daylight slots found for today.");
    }

    // Compute playability for current-ish time (next block)
    const next = list[0];
    const playRaw = computePlayability(next, units);
    setPlayability(playRaw);

    // Best tee time among daylight blocks
    if (sunriseMs && sunsetMs) {
      dom.teeSunrise.textContent = fmtTime(sunriseMs);
      dom.teeSunset.textContent = fmtTime(sunsetMs);
    }

    const candidates = (sunriseMs && sunsetMs) ? daylightBlocks : blocks;
    if (!candidates.length) {
      setTeeTime(null, "No suitable tee time found.");
      return;
    }

    const scored = candidates
      .map((b) => ({ b, score: computePlayability(b, units) }))
      .filter((x) => Number.isFinite(x.score));

    if (!scored.length) {
      setTeeTime(null, "No suitable tee time found.");
      return;
    }

    // Pick highest score
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // If poor all day, show message
    const bestRounded = clamp0to10(Math.round(best.score));
    if (bestRounded <= 3) {
      setTeeTime(null, "No good tee time today — conditions poor throughout daylight hours.");
      return;
    }

    const bt = best.b.dt * 1000;
    dom.bestTeeTime.textContent = `${fmtTime(bt)}`;
    dom.bestTeeScore.textContent = `${bestRounded}/10`;
    dom.teeMsg.textContent = describeConditions(best.b, units);
    dom.teeMain.style.opacity = "1";
  }

  function computePlayability(block, units) {
    // Simple, explainable heuristic (0..10)
    // Inputs:
    // - wind: lower is better
    // - rain probability (pop): lower is better
    // - temperature comfort: closer to ~18C (or 64F) is better
    const pop = clamp01(block.pop ?? 0);
    const wind = Number(block.wind?.speed ?? 0);
    const temp = Number(block.main?.temp ?? NaN);

    // Wind penalty (tuned for golf)
    // metric m/s: 0-3 great, 4-7 ok, 8-12 tough, 13+ poor
    const windPenalty =
      units === "metric"
        ? piecewise(wind, [
            [0, 3, 0.0],
            [3, 7, 1.5],
            [7, 12, 3.5],
            [12, 100, 5.0],
          ])
        : // imperial mph equivalent-ish
          piecewise(wind, [
            [0, 7, 0.0],
            [7, 16, 1.5],
            [16, 27, 3.5],
            [27, 200, 5.0],
          ]);

    // Rain penalty (0..4)
    const rainPenalty = pop * 4.0;

    // Temp comfort penalty (0..3)
    const ideal = units === "metric" ? 18 : 64;
    const diff = Number.isFinite(temp) ? Math.abs(temp - ideal) : 10;
    const tempPenalty = Math.min(3, diff / (units === "metric" ? 6 : 10)); // gentle slope

    const raw = 10 - (windPenalty + rainPenalty + tempPenalty);
    return clamp0to10(raw);
  }

  function setPlayability(scoreRaw) {
    if (!Number.isFinite(scoreRaw)) {
      dom.playScoreWhole.textContent = "--";
      dom.playBand.textContent = "—";
      dom.playMeta.textContent = "—";
      dom.playHero?.classList.remove("is-excellent", "is-good", "is-marginal", "is-poor");
      return;
    }

    const rounded = clamp0to10(Math.round(scoreRaw));
    dom.playScoreWhole.textContent = String(rounded);

    const band = bandLabel(rounded);
    dom.playBand.textContent = band;

    dom.playHero?.classList.remove("is-excellent", "is-good", "is-marginal", "is-poor");
    dom.playHero?.classList.add(bandClass(rounded));

    dom.playMeta.textContent = "Based on wind, rain chance, and comfort.";
  }

  function setTeeTime(_, msg) {
    dom.bestTeeTime.textContent = "—";
    dom.bestTeeScore.textContent = "—";
    dom.teeMsg.textContent = msg || "—";
    dom.teeMain.style.opacity = "0.55";
  }

  function bandLabel(n) {
    if (n >= 8) return "Excellent";
    if (n >= 6) return "Good";
    if (n >= 4) return "Marginal";
    return "Poor";
  }

  function bandClass(n) {
    if (n >= 8) return "is-excellent";
    if (n >= 6) return "is-good";
    if (n >= 4) return "is-marginal";
    return "is-poor";
  }

  function describeConditions(b, units) {
    const pop = Math.round((b.pop ?? 0) * 100);
    const w = b.wind?.speed;
    const t = Math.round(b.main?.temp ?? NaN);
    const parts = [];
    if (Number.isFinite(t)) parts.push(`Temp ${t}°`);
    if (Number.isFinite(w)) parts.push(`Wind ${formatWind(w, units)}`);
    parts.push(`Rain ${pop}%`);
    return parts.join(" • ");
  }

  // ---------------------------
  // MAP + RAIN TIMELINE
  // ---------------------------
  function renderMap(lat, lon) {
    if (!dom.map) return;
    if (!window.L) return;

    if (!state.map) {
      state.map = window.L.map("map", {
        zoomControl: false,
        attributionControl: false,
      }).setView([lat, lon], 9);

      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(state.map);

      state.marker = window.L.marker([lat, lon]).addTo(state.map);
    } else {
      state.map.setView([lat, lon], 9);
      state.marker?.setLatLng([lat, lon]);
    }
  }

  function renderRainTimeline(fc) {
    const list = (fc.list || []).slice(0, 8); // next ~24h (3h blocks)
    dom.rainTimeline.innerHTML = "";

    if (!list.length) {
      dom.rainMessage.textContent = "No rain data.";
      return;
    }

    // message: when does rain start?
    const firstRain = list.find((b) => (b.pop ?? 0) >= 0.3);
    if (!firstRain) dom.rainMessage.textContent = "No rain expected soon";
    else {
      const mins = Math.max(0, Math.round((firstRain.dt * 1000 - Date.now()) / 60000));
      dom.rainMessage.textContent = `Rain risk in ~${mins} min`;
    }

    list.forEach((b) => {
      const dt = b.dt * 1000;
      const pop = Math.round((b.pop ?? 0) * 100);

      const item = document.createElement("div");
      item.className = "rainItem";
      item.innerHTML = `
        <div class="rainTime">${fmtTime(dt)}</div>
        <div class="rainBar"><div class="rainFill" style="width:${pop}%"></div></div>
        <div class="rainPct">${pop}%</div>
      `;
      dom.rainTimeline.appendChild(item);
    });
  }

  // ---------------------------
  // POPOVER
  // ---------------------------
  function togglePlayPopover(open) {
    if (!dom.playPopover) return;
    dom.playPopover.classList.toggle("is-hidden", !open);
    dom.playPopover.setAttribute("aria-hidden", open ? "false" : "true");
    dom.btnPlayInfo?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ---------------------------
  // SKELETONS / STATUS / TOAST
  // ---------------------------
  function skeleton(on) {
    document.body.classList.toggle("is-loading", on);
  }

  function setStatus(msg) {
    if (dom.appStatus) dom.appStatus.textContent = msg || "";
  }

  function showErr(err) {
    console.error(err);
    setStatus(String(err.message || err));
    showToast("Weather data failed. Check API key / network.");
    skeleton(false);
  }

  let toastT = null;
  function showToast(msg) {
    if (!dom.toast) return;
    dom.toast.textContent = msg;
    dom.toast.classList.remove("is-hidden");
    clearTimeout(toastT);
    toastT = setTimeout(() => dom.toast.classList.add("is-hidden"), 2500);
  }

  // ---------------------------
  // HELPERS
  // ---------------------------
  function loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function fmtTime(ms) {
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDuration(ms) {
    const m = Math.round(ms / 60000);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function clamp01(x) {
    return Math.max(0, Math.min(1, Number(x)));
  }

  function clamp0to10(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(10, n));
  }

  function avg(arr) {
    const a = arr.filter(Number.isFinite);
    if (!a.length) return NaN;
    return a.reduce((s, x) => s + x, 0) / a.length;
  }

  function groupByDay(list) {
    // label like "Wed" etc (local)
    const out = {};
    for (const b of list) {
      const dt = new Date(b.dt * 1000);
      const key = dt.toLocaleDateString([], { weekday: "long" });
      out[key] ||= [];
      out[key].push(b);
    }
    return out;
  }

  function formatWind(speed, units) {
    // OpenWeather returns m/s for metric, miles/hour for imperial in these endpoints
    if (units === "metric") return `${Math.round(speed)} m/s`;
    return `${Math.round(speed)} mph`;
  }

  function piecewise(x, bands) {
    // bands: [min,max,penalty]
    for (const [min, max, p] of bands) {
      if (x >= min && x < max) return p;
    }
    return bands[bands.length - 1][2];
  }

  async function safeText(res) {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }

  // ---------------------------
  // SERVICE WORKER REGISTER
  // ---------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }
})();
