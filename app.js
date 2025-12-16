/* =========================================================
   Fairway Forecast — app.js (mobile-first, GitHub Pages friendly)
   - Tabs: Current / Hourly / Daily (persist + scroll)
   - Search suggestions: grouped (Places vs Courses), capped height (CSS), no screen takeover
   - Supabase: course lookup via ilike query (does NOT download entire UK table)
   - OpenWeather: geocoding + One Call (daily up to 7 days if available)
   - Playability: rounded whole number (0..10) + bands + colour hook classes
   - Best tee time: strictly within daylight (after sunrise, before sunset)
   - Favourites: localStorage + star button + dropdown
   ========================================================= */

(() => {
  "use strict";

  // ---------------------------
  // CONFIG (from config.js)
  // ---------------------------
  const CFG = window.APP_CONFIG || {};
  const OPENWEATHER_KEY = CFG.OPENWEATHER_KEY || "";
  const SUPABASE_URL = CFG.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY || "";
  const COURSES_TABLE = CFG.COURSES_TABLE || "uk_golf_courses";

  // Column names (must match your Supabase table)
  const COL_NAME = (CFG.COLS && CFG.COLS.name) || "name";
  const COL_LAT = (CFG.COLS && CFG.COLS.lat) || "latitude";
  const COL_LON = (CFG.COLS && CFG.COLS.lon) || "longitude";
  const COL_COUNTRY = (CFG.COLS && CFG.COLS.country) || "country";
  const COL_WEBSITE = (CFG.COLS && CFG.COLS.website) || "website";

  // ---------------------------
  // DOM
  // ---------------------------
  const $ = (id) => document.getElementById(id);

  const el = {
    // controls
    txtSearch: $("txtSearch"),
    btnSearch: $("btnSearch"),
    btnGeo: $("btnGeo"),
    btnFav: $("btnFav"),
    ddlFavs: $("ddlFavs"),
    ddlUnits: $("ddlUnits"),
    suggestions: $("searchSuggestions"),
    coursesStatus: $("coursesStatus"),
    appStatus: $("appStatus"),

    // tabs/panels
    tabs: Array.from(document.querySelectorAll(".tab")),
    panels: Array.from(document.querySelectorAll(".panel")),
    forecastAnchor: $("forecast"),

    // hero
    h1Title: $("h1Title"),
    subTitle: $("subTitle"),
    imgIcon: $("imgIcon"),
    currTemp: $("currTemp"),

    // playability
    playHero: $("playHero"),
    playScoreWhole: $("playScoreWhole"),
    playBand: $("playBand"),
    playMeta: $("playMeta"),
    btnPlayInfo: $("btnPlayInfo"),
    btnPlayClose: $("btnPlayClose"),
    playPopover: $("playPopover"),

    // metrics
    feelsLike: $("feelsLike"),
    humidity: $("humidity"),
    wind: $("wind"),
    windDir: $("windDir"),
    sunrise: $("sunrise"),
    sunset: $("sunset"),
    dayLength: $("dayLength"),

    // tee time
    teeSunrise: $("teeSunrise"),
    teeSunset: $("teeSunset"),
    bestTeeTime: $("bestTeeTime"),
    bestTeeScore: $("bestTeeScore"),
    teeMsg: $("teeMsg"),

    // nowcast
    rainMessage: $("rainMessage"),
    rainTimeline: $("rainTimeline"),
    map: $("map"),

    // hourly/daily
    ddlDay: $("ddlDay"),
    hourlyForecast: $("hourlyForecast"),
    dailyForecast: $("dailyForecast"),

    // toast
    toast: $("toast"),
  };

  // ---------------------------
  // STATE
  // ---------------------------
  const LS = {
    favs: "ff_favs_v1",
    tab: "ff_tab_v1",
    units: "ff_units_v1",
    lastSelection: "ff_last_selection_v1",
  };

  const state = {
    units: loadLS(LS.units, "C"),
    activeTab: loadLS(LS.tab, "current"),
    favs: loadLS(LS.favs, []),
    selection: loadLS(LS.lastSelection, null), // {type, label, lat, lon, extra?}
    weather: null, // last fetched onecall payload
    geo: null, // last geocode place payload
    supabase: null,
    map: null,
    mapMarker: null,
    debounceT: null,
  };

  // ---------------------------
  // INIT
  // ---------------------------
  init();

  async function init() {
    // Units default
    el.ddlUnits.value = state.units;
    el.ddlUnits.addEventListener("change", () => {
      state.units = el.ddlUnits.value;
      saveLS(LS.units, state.units);
      if (state.weather) renderAll(); // re-render temps
    });

    // Tabs
    setupTabs();

    // Playability popover
    setupPopover();

    // Favs
    renderFavDropdown();
    el.btnFav.addEventListener("click", toggleFavourite);
    el.ddlFavs.addEventListener("change", onSelectFavourite);

    // Search
    el.btnSearch.addEventListener("click", () => performSearchFromInput());
    el.txtSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") performSearchFromInput();
    });
    el.txtSearch.addEventListener("input", onSearchInput);

    // Close suggestions when clicking elsewhere
    document.addEventListener("click", (e) => {
      const within =
        el.suggestions.contains(e.target) ||
        el.txtSearch.contains(e.target);
      if (!within) hideSuggestions();
    });

    // Geo
    el.btnGeo.addEventListener("click", useMyLocation);

    // Supabase client (optional, but needed for courses)
    tryInitSupabase();

    // Map init
    initMap();

    // Service worker (basic PWA shell)
    tryRegisterSW();

    // sanity status
    setStatus();

    // Load initial selection
    if (state.selection && isFinite(state.selection.lat) && isFinite(state.selection.lon)) {
      await applySelection(state.selection, { silentScroll: true });
    } else {
      // default
      await applySelection(
        { type: "place", label: "Swindon, GB", lat: 51.556, lon: -1.781 },
        { silentScroll: true }
      );
    }
  }

  function setStatus(msg = "") {
    const parts = [];
    if (!OPENWEATHER_KEY) parts.push("OpenWeather key missing");
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) parts.push("Supabase config missing");
    el.appStatus.textContent = msg || (parts.length ? parts.join(" • ") : "");
  }

  // ---------------------------
  // TABS
  // ---------------------------
  function setupTabs() {
    // apply saved
    activateTab(state.activeTab, { scroll: false });

    el.tabs.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-tab");
        activateTab(tab, { scroll: true });
      });
    });
  }

  function activateTab(tab, { scroll }) {
    state.activeTab = tab;
    saveLS(LS.tab, tab);

    // button state
    el.tabs.forEach((b) => {
      const is = b.getAttribute("data-tab") === tab;
      b.classList.toggle("is-active", is);
      b.setAttribute("aria-selected", String(is));
    });

    // panel state
    el.panels.forEach((p) => {
      const is = p.getAttribute("data-panel") === tab;
      p.classList.toggle("is-active", is);
    });

    // smooth scroll on mobile so user sees output immediately
    if (scroll) {
      const isMobile = window.matchMedia("(max-width: 859px)").matches;
      if (isMobile && el.forecastAnchor) {
        el.forecastAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  // ---------------------------
  // POPOVER
  // ---------------------------
  function setupPopover() {
    if (!el.btnPlayInfo || !el.playPopover) return;

    el.btnPlayInfo.addEventListener("click", () => {
      const open = !el.playPopover.classList.contains("is-hidden");
      if (open) closePopover();
      else openPopover();
    });

    el.btnPlayClose?.addEventListener("click", closePopover);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePopover();
    });
  }

  function openPopover() {
    el.playPopover.classList.remove("is-hidden");
    el.playPopover.setAttribute("aria-hidden", "false");
    el.btnPlayInfo.setAttribute("aria-expanded", "true");
  }

  function closePopover() {
    el.playPopover.classList.add("is-hidden");
    el.playPopover.setAttribute("aria-hidden", "true");
    el.btnPlayInfo.setAttribute("aria-expanded", "false");
  }

  // ---------------------------
  // SUPABASE
  // ---------------------------
  function tryInitSupabase() {
    try {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
        el.coursesStatus.textContent = "Courses: (Supabase not configured)";
        return;
      }
      state.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      el.coursesStatus.textContent = "Courses: ready ✓";
    } catch (e) {
      el.coursesStatus.textContent = "Courses: error";
      console.error(e);
    }
  }

  async function searchCourses(term, limit = 8) {
    if (!state.supabase) return [];
    const q = (term || "").trim();
    if (q.length < 2) return [];

    // IMPORTANT: Uses ilike on the server (doesn't fetch entire UK dataset)
    const { data, error } = await state.supabase
      .from(COURSES_TABLE)
      .select(`${COL_NAME},${COL_LAT},${COL_LON},${COL_COUNTRY},${COL_WEBSITE}`)
      .ilike(COL_NAME, `%${q}%`)
      .limit(limit);

    if (error) {
      console.warn("Supabase search error:", error.message);
      return [];
    }

    return (data || []).map((r) => ({
      type: "course",
      label: `${r[COL_NAME]}${r[COL_COUNTRY] ? ` (${r[COL_COUNTRY]})` : ""}`,
      name: r[COL_NAME],
      lat: Number(r[COL_LAT]),
      lon: Number(r[COL_LON]),
      country: r[COL_COUNTRY] || "",
      website: r[COL_WEBSITE] || "",
    })).filter(x => isFinite(x.lat) && isFinite(x.lon));
  }

  // ---------------------------
  // OPENWEATHER
  // ---------------------------
  async function geocodePlaces(term, limit = 6) {
    const q = (term || "").trim();
    if (!OPENWEATHER_KEY || q.length < 2) return [];

    const url =
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=${limit}&appid=${encodeURIComponent(OPENWEATHER_KEY)}`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn("Geocode failed:", res.status);
      return [];
    }
    const arr = await res.json();
    return (arr || []).map((p) => ({
      type: "place",
      label: `${p.name}${p.state ? `, ${p.state}` : ""}, ${p.country}`,
      lat: Number(p.lat),
      lon: Number(p.lon),
      country: p.country || "",
      state: p.state || "",
      name: p.name || "",
    })).filter(x => isFinite(x.lat) && isFinite(x.lon));
  }

  async function fetchOneCall(lat, lon) {
    if (!OPENWEATHER_KEY) throw new Error("Missing OPENWEATHER_KEY");

    // One Call 3.0 (daily + hourly). If your key doesn't include One Call, you'll get 401.
    const url =
      `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,alerts&appid=${encodeURIComponent(OPENWEATHER_KEY)}&units=metric`;

    const res = await fetch(url);
    if (!res.ok) {
      const txt = await safeText(res);
      throw new Error(`OpenWeather error ${res.status}: ${txt}`);
    }
    return res.json();
  }

  // ---------------------------
  // SEARCH + SUGGESTIONS (Grouped: Places first)
  // ---------------------------
  async function onSearchInput() {
    clearTimeout(state.debounceT);
    const term = el.txtSearch.value;

    state.debounceT = setTimeout(async () => {
      const q = (term || "").trim();
      if (q.length < 2) {
        hideSuggestions();
        return;
      }

      // Places FIRST (fix: previously it felt like every search started with courses)
      const [places, courses] = await Promise.all([
        geocodePlaces(q, 6),
        searchCourses(q, 6),
      ]);

      renderSuggestions({ places, courses });
    }, 180);
  }

  function renderSuggestions({ places, courses }) {
    const hasAny = (places && places.length) || (courses && courses.length);
    if (!hasAny) {
      hideSuggestions();
      return;
    }

    el.suggestions.innerHTML = "";

    if (places && places.length) {
      el.suggestions.appendChild(makeGroup("Places", "📍", places));
    }
    if (courses && courses.length) {
      el.suggestions.appendChild(makeGroup("Courses", "⛳", courses));
    }

    el.suggestions.classList.remove("is-hidden");
  }

  function makeGroup(title, icon, items) {
    const wrap = document.createElement("div");
    wrap.className = "suggestGroup";

    const h = document.createElement("div");
    h.className = "suggestGroup__title";
    h.textContent = title;
    wrap.appendChild(h);

    items.forEach((it) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggestItem";
      btn.setAttribute("role", "option");

      btn.innerHTML = `
        <div class="suggestItem__icon" aria-hidden="true">${icon}</div>
        <div>
          <div class="suggestItem__main">${escapeHtml(it.label)}</div>
          <span class="suggestItem__sub">${title === "Courses" ? "Golf course" : "Location"}</span>
        </div>
      `;

      btn.addEventListener("click", async () => {
        hideSuggestions();
        el.txtSearch.value = it.label;
        await applySelection(it);
      });

      wrap.appendChild(btn);
    });

    return wrap;
  }

  function hideSuggestions() {
    el.suggestions.classList.add("is-hidden");
    el.suggestions.innerHTML = "";
  }

  async function performSearchFromInput() {
    const q = (el.txtSearch.value || "").trim();
    if (!q) return;

    hideSuggestions();

    // Prefer place search first (more intuitive for casual users)
    const places = await geocodePlaces(q, 1);
    if (places.length) {
      await applySelection(places[0]);
      return;
    }

    // fallback to course search
    const courses = await searchCourses(q, 1);
    if (courses.length) {
      await applySelection(courses[0]);
      return;
    }

    showToast("No results found. Try a city or full course name.");
  }

  // ---------------------------
  // FAVOURITES
  // ---------------------------
  function isFav(sel) {
    if (!sel) return false;
    const id = favId(sel);
    return state.favs.some((f) => f.id === id);
  }

  function favId(sel) {
    return `${sel.type}:${round5(sel.lat)}:${round5(sel.lon)}:${(sel.name || sel.label || "").slice(0, 48)}`;
  }

  function toggleFavourite() {
    if (!state.selection) return;

    const id = favId(state.selection);
    const idx = state.favs.findIndex((f) => f.id === id);

    if (idx >= 0) {
      state.favs.splice(idx, 1);
      saveLS(LS.favs, state.favs);
      renderFavDropdown();
      setFavStar(false);
      showToast("Removed from favourites");
      return;
    }

    const item = {
      id,
      type: state.selection.type,
      label: state.selection.label,
      name: state.selection.name || "",
      lat: state.selection.lat,
      lon: state.selection.lon,
      country: state.selection.country || "",
      website: state.selection.website || "",
    };

    state.favs.unshift(item);
    saveLS(LS.favs, state.favs);
    renderFavDropdown();
    setFavStar(true);
    showToast("Added to favourites");
  }

  function setFavStar(on) {
    el.btnFav.textContent = on ? "★" : "☆";
    el.btnFav.setAttribute("aria-pressed", String(on));
  }

  function renderFavDropdown() {
    const prev = el.ddlFavs.value;
    el.ddlFavs.innerHTML = `<option value="">Select a favourite…</option>`;

    state.favs.forEach((f) => {
      const opt = document.createElement("option");
      opt.value = f.id;
      opt.textContent = f.label;
      el.ddlFavs.appendChild(opt);
    });

    // restore if possible
    if (prev) el.ddlFavs.value = prev;
  }

  async function onSelectFavourite() {
    const id = el.ddlFavs.value;
    if (!id) return;

    const f = state.favs.find((x) => x.id === id);
    if (!f) return;

    await applySelection({
      type: f.type,
      label: f.label,
      name: f.name,
      lat: f.lat,
      lon: f.lon,
      country: f.country,
      website: f.website,
    });
  }

  // ---------------------------
  // APPLY SELECTION + FETCH
  // ---------------------------
  async function applySelection(sel, opts = {}) {
    if (!sel || !isFinite(sel.lat) || !isFinite(sel.lon)) return;

    state.selection = {
      type: sel.type,
      label: sel.label,
      name: sel.name || sel.label,
      lat: Number(sel.lat),
      lon: Number(sel.lon),
      country: sel.country || "",
      website: sel.website || "",
    };
    saveLS(LS.lastSelection, state.selection);

    setFavStar(isFav(state.selection));

    // Update title immediately
    el.h1Title.textContent = state.selection.name || state.selection.label || "—";
    el.subTitle.textContent = (state.selection.type === "course")
      ? (state.selection.country ? state.selection.country : "Golf course")
      : (state.selection.label || "Location");

    // Loading placeholders (simple)
    setLoading(true);

    try {
      const data = await fetchOneCall(state.selection.lat, state.selection.lon);
      state.weather = data;

      renderAll();
      setLoading(false);

      // ensure map updates on Current tab too
      updateMap(state.selection.lat, state.selection.lon);

      // optional scroll
      if (!opts.silentScroll) {
        const isMobile = window.matchMedia("(max-width: 859px)").matches;
        if (isMobile && el.forecastAnchor) {
          el.forecastAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
      setStatus(String(err.message || err));
      showToast("Weather fetch failed (check API key / OneCall access).");
    }
  }

  function setLoading(on) {
    // Minimal "skeleton": blank key fields; you can expand later.
    if (on) {
      el.currTemp.textContent = "--";
      el.playScoreWhole.textContent = "--";
      el.playBand.textContent = "—";
      el.playMeta.textContent = "Loading…";
      el.rainMessage.textContent = "Loading…";
      el.hourlyForecast.innerHTML = "";
      el.dailyForecast.innerHTML = "";
      el.rainTimeline.innerHTML = "";
    }
  }

  // ---------------------------
  // RENDER
  // ---------------------------
  function renderAll() {
    if (!state.weather) return;

    const w = state.weather;
    const units = state.units;

    // Current
    const current = w.current || {};
    const tempC = current.temp;
    const feelsC = current.feels_like;
    const hum = current.humidity;
    const windMs = current.wind_speed;
    const windDeg = current.wind_deg;

    // Icon
    const icon = current.weather && current.weather[0] && current.weather[0].icon;
    if (icon) {
      el.imgIcon.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
      el.imgIcon.alt = (current.weather[0].description || "Weather").trim();
    }

    // Temps: OpenWeather fetched in metric; convert for display if needed
    const tempDisp = units === "F" ? cToF(tempC) : tempC;
    const feelsDisp = units === "F" ? cToF(feelsC) : feelsC;

    el.currTemp.textContent = safeInt(tempDisp);
    el.feelsLike.textContent = safeInt(feelsDisp);
    el.humidity.textContent = safeInt(hum);

    // Wind
    el.wind.textContent = `${safeInt(windMs)} m/s`;
    el.windDir.textContent = windDirText(windDeg);

    // Sunrise/Sunset (seconds)
    const sunrise = w.current?.sunrise;
    const sunset = w.current?.sunset;
    el.sunrise.textContent = sunrise ? fmtTime(sunrise) : "--";
    el.sunset.textContent = sunset ? fmtTime(sunset) : "--";
    el.teeSunrise.textContent = sunrise ? fmtTime(sunrise) : "--";
    el.teeSunset.textContent = sunset ? fmtTime(sunset) : "--";

    if (sunrise && sunset) {
      el.dayLength.textContent = `Day length: ${fmtDuration(sunset - sunrise)}`;
    } else {
      el.dayLength.textContent = "Day length: —";
    }

    // Playability (hero)
    const popNow = guessPopNow(w); // 0..1
    const score = computePlayability({
      windMs,
      pop: popNow,
      tempC,
      feelsC,
      humidity: hum,
    });
    const whole = clampInt(Math.round(score), 0, 10);

    const band = bandFor(whole);
    el.playScoreWhole.textContent = String(whole);
    el.playBand.textContent = band.label;
    el.playMeta.textContent = `Wind ${safeInt(windMs)} m/s • Rain ${safeInt(popNow * 100)}% • Temp ${safeInt(tempDisp)}°${units}`;

    // apply colour class hooks
    el.playHero.classList.remove("band-excellent", "band-good", "band-marginal", "band-poor");
    el.playHero.classList.add(band.cls);

    // Tee time (daylight only)
    renderBestTeeTime(w);

    // Nowcast timeline (next ~8 blocks)
    renderRainTimeline(w);

    // Hourly (3-hour blocks)
    renderHourly(w);

    // Daily (up to 7)
    renderDaily(w);

    // status clear
    setStatus("");
  }

  // ---------------------------
  // BEST TEE TIME (STRICT DAYLIGHT)
  // ---------------------------
  function renderBestTeeTime(w) {
    const sunrise = w.current?.sunrise;
    const sunset = w.current?.sunset;

    if (!sunrise || !sunset || !Array.isArray(w.hourly)) {
      el.bestTeeTime.textContent = "—";
      el.bestTeeScore.textContent = "—";
      el.teeMsg.textContent = "Daylight or hourly data unavailable.";
      return;
    }

    // Build 3-hour slots from hourly list (in seconds)
    const hourly = w.hourly.slice(0, 24); // today-ish
    const slots = [];
    for (let i = 0; i < hourly.length; i += 3) {
      const h = hourly[i];
      const start = h.dt;
      const end = start + 3 * 3600;

      // STRICT daylight: entirely within sunrise..sunset
      const within = (start >= sunrise) && (end <= sunset);
      if (!within) continue;

      // score this slot
      const slotScore = computePlayability({
        windMs: h.wind_speed,
        pop: h.pop || 0,
        tempC: h.temp,
        feelsC: h.feels_like,
        humidity: h.humidity,
      });

      slots.push({
        start,
        end,
        score: slotScore,
        pop: h.pop || 0,
        wind: h.wind_speed,
        tempC: h.temp,
      });
    }

    if (!slots.length) {
      el.bestTeeTime.textContent = "—";
      el.bestTeeScore.textContent = "—";
      el.teeMsg.textContent = "No good tee time today — no full daylight slots available.";
      return;
    }

    // Pick best within daylight
    slots.sort((a, b) => b.score - a.score);
    const best = slots[0];

    const whole = clampInt(Math.round(best.score), 0, 10);
    const label = bandFor(whole).label;

    el.bestTeeTime.textContent = `${fmtTime(best.start)} – ${fmtTime(best.end)}`;
    el.bestTeeScore.textContent = `${whole}/10 (${label})`;
    el.teeMsg.textContent = (whole <= 3)
      ? "No good tee time today — conditions poor throughout daylight hours."
      : `Best daylight window based on wind/rain/comfort.`;
  }

  // ---------------------------
  // RAIN TIMELINE (simple nowcast-style blocks)
  // ---------------------------
  function renderRainTimeline(w) {
    const hourly = Array.isArray(w.hourly) ? w.hourly : [];
    const blocks = hourly.slice(0, 8); // next 8 hours

    // message
    const nextRain = blocks.find((h) => (h.pop || 0) >= 0.3);
    if (nextRain) {
      const mins = Math.max(0, Math.round((nextRain.dt * 1000 - Date.now()) / 60000));
      el.rainMessage.textContent = mins ? `Rain possible in ~${mins} min` : "Rain possible soon";
    } else {
      el.rainMessage.textContent = "No rain expected soon";
    }

    el.rainTimeline.innerHTML = "";
    blocks.forEach((h) => {
      const pop = clamp(h.pop || 0, 0, 1);
      const card = document.createElement("div");
      card.className = "timeCard";
      card.innerHTML = `
        <div class="timeCard__t">${fmtTime(h.dt)}</div>
        <div class="timeCard__p">${Math.round(pop * 100)}%</div>
        <div class="timeBar"><span style="width:${Math.round(pop * 100)}%"></span></div>
      `;
      el.rainTimeline.appendChild(card);
    });
  }

  // ---------------------------
  // HOURLY (3-hour blocks + day selector)
  // ---------------------------
  function renderHourly(w) {
    if (!Array.isArray(w.hourly)) return;

    // Build day list from hourly dt
    const byDay = groupHourlyByDay(w.hourly);

    // Fill ddlDay (preserve selection if possible)
    const prev = el.ddlDay.value;
    el.ddlDay.innerHTML = "";
    Object.keys(byDay).forEach((dayKey) => {
      const opt = document.createElement("option");
      opt.value = dayKey;
      opt.textContent = dayKey;
      el.ddlDay.appendChild(opt);
    });

    const firstKey = Object.keys(byDay)[0] || "";
    el.ddlDay.value = prev && byDay[prev] ? prev : firstKey;

    el.ddlDay.onchange = () => {
      drawHourlyList(byDay[el.ddlDay.value] || []);
    };

    drawHourlyList(byDay[el.ddlDay.value] || []);
  }

  function drawHourlyList(list) {
    const units = state.units;
    el.hourlyForecast.innerHTML = "";

    // show 3-hour blocks only
    for (let i = 0; i < list.length; i += 3) {
      const h = list[i];
      if (!h) continue;

      const icon = h.weather && h.weather[0] && h.weather[0].icon;
      const pop = clamp(h.pop || 0, 0, 1);

      const tempDisp = units === "F" ? cToF(h.temp) : h.temp;

      const row = document.createElement("div");
      row.className = "hourCard";
      row.innerHTML = `
        <div class="hourLeft">
          ${icon ? `<img class="hourIcon" alt="" src="https://openweathermap.org/img/wn/${icon}@2x.png" />` : ""}
          <div style="min-width:0">
            <div class="hourWhen">${fmtTime(h.dt)}</div>
            <div class="hourMeta">Rain ${Math.round(pop * 100)}% • Wind ${safeInt(h.wind_speed)} m/s</div>
          </div>
        </div>
        <div class="dayTemps">
          ${safeInt(tempDisp)}°${units}
          <small>Feels ${safeInt(units === "F" ? cToF(h.feels_like) : h.feels_like)}°</small>
        </div>
      `;
      el.hourlyForecast.appendChild(row);
    }
  }

  // ---------------------------
  // DAILY (up to 7 days if available)
  // ---------------------------
  function renderDaily(w) {
    const units = state.units;
    const daily = Array.isArray(w.daily) ? w.daily.slice(0, 7) : [];

    el.dailyForecast.innerHTML = "";
    if (!daily.length) {
      el.dailyForecast.innerHTML = `<div class="meta">Daily data not available for this location/API plan.</div>`;
      return;
    }

    daily.forEach((d) => {
      const dayName = fmtDay(d.dt);
      const icon = d.weather && d.weather[0] && d.weather[0].icon;
      const pop = clamp(d.pop || 0, 0, 1);
      const wind = d.wind_speed;

      const hiC = d.temp?.max ?? d.temp?.day ?? null;
      const loC = d.temp?.min ?? null;

      const hi = hiC == null ? "--" : safeInt(units === "F" ? cToF(hiC) : hiC);
      const lo = loC == null ? "--" : safeInt(units === "F" ? cToF(loC) : loC);

      const card = document.createElement("div");
      card.className = "dayCard";
      card.innerHTML = `
        <div class="dayMain">
          <div class="dayName">${dayName}</div>
          <div class="dayLine">
            <span>Rain ${Math.round(pop * 100)}%</span>
            <span>Wind ${safeInt(wind)} m/s</span>
          </div>
        </div>
        <div class="dayRight">
          ${icon ? `<img class="dayIcon" alt="" src="https://openweathermap.org/img/wn/${icon}@2x.png" />` : ""}
          <div class="dayTemps">
            ${hi}° / ${lo}°${units}
            <small>High / Low</small>
          </div>
        </div>
      `;
      el.dailyForecast.appendChild(card);
    });
  }

  // ---------------------------
  // MAP (Leaflet)
  // ---------------------------
  function initMap() {
    if (!el.map || !window.L) return;
    // Create with a safe default; updated on selection
    state.map = L.map(el.map, { zoomControl: true }).setView([51.556, -1.781], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(state.map);
    state.mapMarker = L.marker([51.556, -1.781]).addTo(state.map);
  }

  function updateMap(lat, lon) {
    if (!state.map) return;
    state.map.setView([lat, lon], 10, { animate: false });
    if (state.mapMarker) state.mapMarker.setLatLng([lat, lon]);
  }

  // ---------------------------
  // GEOLOCATION
  // ---------------------------
  async function useMyLocation() {
    if (!navigator.geolocation) {
      showToast("Geolocation not supported on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        await applySelection({ type: "place", label: "My location", name: "My location", lat, lon });
      },
      () => showToast("Location permission denied."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  // ---------------------------
  // PLAYABILITY (0..10)
  // ---------------------------
  function computePlayability({ windMs, pop, tempC, feelsC, humidity }) {
    // Simple, golf-friendly heuristic:
    // Start at 10, subtract penalties.
    // - wind penalty (stronger is worse)
    // - rain probability penalty
    // - comfort penalty based on feels-like
    // - humidity small penalty (optional)
    let s = 10;

    // wind: 0..12+ m/s
    const w = clamp(windMs || 0, 0, 20);
    s -= (w * 0.35); // 12 m/s => ~4.2 off

    // rain pop: 0..1
    const r = clamp(pop || 0, 0, 1);
    s -= (r * 5.2); // 100% => -5.2

    // comfort: ideal ~18C (golf comfortable). penalize distance.
    const f = (feelsC != null) ? feelsC : tempC;
    if (isFinite(f)) {
      const dist = Math.abs(f - 18);
      s -= clamp(dist * 0.12, 0, 3.2); // 10C away => -1.2
    }

    // humidity small penalty
    const h = clamp(humidity || 0, 0, 100);
    if (h >= 92) s -= 0.6;
    else if (h >= 85) s -= 0.3;

    return clamp(s, 0, 10);
  }

  function bandFor(whole) {
    if (whole >= 8) return { label: "Excellent", cls: "band-excellent" };
    if (whole >= 6) return { label: "Good", cls: "band-good" };
    if (whole >= 4) return { label: "Marginal", cls: "band-marginal" };
    return { label: "Poor", cls: "band-poor" };
  }

  // ---------------------------
  // HELPERS
  // ---------------------------
  function loadLS(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function saveLS(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  }

  function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }
  function clampInt(x, a, b) {
    const n = Number.isFinite(x) ? x : a;
    return Math.max(a, Math.min(b, n));
  }
  function safeInt(x) {
    if (!isFinite(x)) return "--";
    return String(Math.round(x));
  }
  function cToF(c) {
    return (c * 9) / 5 + 32;
  }
  function fmtTime(unixSec) {
    const d = new Date(unixSec * 1000);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDay(unixSec) {
    const d = new Date(unixSec * 1000);
    return d.toLocaleDateString([], { weekday: "long" });
  }
  function fmtDuration(sec) {
    const m = Math.floor(sec / 60);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }
  function windDirText(deg) {
    if (!isFinite(deg)) return "—";
    const dirs = ["N","NE","E","SE","S","SW","W","NW"];
    const idx = Math.round(((deg % 360) / 45)) % 8;
    return dirs[idx];
  }
  function groupHourlyByDay(hourly) {
    const out = {};
    (hourly || []).forEach((h) => {
      const d = new Date(h.dt * 1000);
      const key = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
      out[key] = out[key] || [];
      out[key].push(h);
    });
    return out;
  }
  function guessPopNow(w) {
    // Use the closest upcoming hourly pop as "now"
    const h0 = Array.isArray(w.hourly) ? w.hourly[0] : null;
    return h0 && isFinite(h0.pop) ? clamp(h0.pop, 0, 1) : 0;
  }
  function round5(n) {
    return Math.round(Number(n) * 1e5) / 1e5;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[c]));
  }
  async function safeText(res) {
    try { return await res.text(); } catch { return ""; }
  }

  // ---------------------------
  // TOAST
  // ---------------------------
  function showToast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.remove("is-hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.add("is-hidden"), 2200);
  }

  // ---------------------------
  // SERVICE WORKER
  // ---------------------------
  function tryRegisterSW() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }
})();
