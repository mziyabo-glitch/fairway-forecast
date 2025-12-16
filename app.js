/* app.js
   Fairway Forecast — mobile-first tabs, 7-day-ish daily, app-ready structure
   - Expects config.js to set window.APP_CONFIG = { OWM_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY }
   - Uses OpenWeather 5-day / 3-hour forecast endpoint:
     https://api.openweathermap.org/data/2.5/forecast?lat={lat}&lon={lon}&units=metric&appid={API_KEY}

   NOTE about your console screenshot:
   - 401 (Unauthorized) from api.openweathermap... means your API key is missing/incorrect in config.js
   - ERR_NAME_NOT_RESOLVED to "yourproject.supabase..." means you still have an old URL somewhere.
*/

(() => {
  "use strict";

  // -----------------------------
  // Config + safe guards
  // -----------------------------
  const CFG = window.APP_CONFIG || {};
  const OWM_API_KEY = CFG.OWM_API_KEY || "";
  const SUPABASE_URL = CFG.SUPABASE_URL || "";
  const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY || "";

  const HAS_OWM = !!OWM_API_KEY;
  const HAS_SB = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

  // -----------------------------
  // DOM
  // -----------------------------
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

    // hero
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

    // playability
    playHero: $("playHero"),
    playScoreWhole: $("playScoreWhole"),
    playBand: $("playBand"),
    playMeta: $("playMeta"),
    btnPlayInfo: $("btnPlayInfo"),
    btnPlayClose: $("btnPlayClose"),
    playPopover: $("playPopover"),

    // tee time
    teeSunrise: $("teeSunrise"),
    teeSunset: $("teeSunset"),
    bestTeeTime: $("bestTeeTime"),
    bestTeeScore: $("bestTeeScore"),
    teeMsg: $("teeMsg"),

    // forecast
    rainMessage: $("rainMessage"),
    rainTimeline: $("rainTimeline"),
    ddlDay: $("ddlDay"),
    hourlyForecast: $("hourlyForecast"),
    dailyForecast: $("dailyForecast"),

    // map
    map: $("map"),

    // toast
    toast: $("toast"),
  };

  const forecastAnchor = document.getElementById("forecast");

  // Tabs
  const tabButtons = Array.from(document.querySelectorAll(".tab[data-tab]"));
  const panels = Array.from(document.querySelectorAll(".panel[data-panel]"));

  // -----------------------------
  // State
  // -----------------------------
  const LS = {
    lastTab: "ff:lastTab",
    favs: "ff:favs",
    lastSelection: "ff:lastSelection", // {type:'place'|'course', label, lat, lon}
    units: "ff:units",
  };

  const state = {
    units: (localStorage.getItem(LS.units) || "C"),
    courses: [],
    favs: loadFavs(),
    selection: loadSelection(), // current selected (place/course)
    forecast: null, // last OWM forecast response
    map: null,
    marker: null,
  };

  // -----------------------------
  // Utilities
  // -----------------------------
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function roundWholeScore(n0to10) { return clamp(Math.round(n0to10), 0, 10); }

  function bandFromWholeScore(w) {
    if (w >= 8) return { key: "excellent", label: "Excellent", color: "var(--good)" };
    if (w >= 6) return { key: "good", label: "Good", color: "var(--ok)" };
    if (w >= 4) return { key: "marginal", label: "Marginal", color: "var(--amber)" };
    return { key: "poor", label: "Poor", color: "var(--poor)" };
  }

  function degToCompass(deg) {
    if (deg === null || deg === undefined || Number.isNaN(deg)) return "—";
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    const ix = Math.round(((deg % 360) / 22.5)) % 16;
    return dirs[ix];
  }

  function fmtTempC(t) { return Math.round(t); }
  function cToF(c) { return (c * 9/5) + 32; }

  function fmtTempByUnits(tempC) {
    if (state.units === "F") return Math.round(cToF(tempC));
    return Math.round(tempC);
  }

  function fmtDate(tsSec, tzOffsetSec) {
    const d = new Date((tsSec + tzOffsetSec) * 1000);
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" });
  }

  function fmtTime(tsSec, tzOffsetSec) {
    const d = new Date((tsSec + tzOffsetSec) * 1000);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function fmtHHMMFromLocalDate(d) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove("is-hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.add("is-hidden"), 1800);
  }

  function setStatus(msg) { el.appStatus.textContent = msg || ""; }

  function setStar(on) {
    el.btnFav.classList.toggle("is-on", !!on);
    el.btnFav.textContent = on ? "★" : "☆";
    el.btnFav.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function isSameSelection(a, b) {
    if (!a || !b) return false;
    return a.type === b.type && a.lat === b.lat && a.lon === b.lon && a.label === b.label;
  }

  function loadFavs() {
    try { return JSON.parse(localStorage.getItem(LS.favs) || "[]"); }
    catch { return []; }
  }

  function saveFavs() {
    localStorage.setItem(LS.favs, JSON.stringify(state.favs));
    renderFavs();
  }

  function loadSelection() {
    try { return JSON.parse(localStorage.getItem(LS.lastSelection) || "null"); }
    catch { return null; }
  }

  function saveSelection() {
    localStorage.setItem(LS.lastSelection, JSON.stringify(state.selection));
  }

  // -----------------------------
  // Tabs logic (persist + scroll)
  // -----------------------------
  function activateTab(tabName, doScroll = true) {
    tabButtons.forEach(btn => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    panels.forEach(p => p.classList.toggle("is-active", p.dataset.panel === tabName));

    localStorage.setItem(LS.lastTab, tabName);

    // Smooth scroll to forecast on mobile (and still helpful on desktop)
    if (doScroll && forecastAnchor) {
      forecastAnchor.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab, true));
  });

  // -----------------------------
  // Popover (solid, no bleed)
  // -----------------------------
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

  el.btnPlayInfo?.addEventListener("click", () => {
    const isOpen = !el.playPopover.classList.contains("is-hidden");
    isOpen ? closePopover() : openPopover();
  });
  el.btnPlayClose?.addEventListener("click", closePopover);
  document.addEventListener("click", (e) => {
    // close popover if clicking outside
    if (!el.playPopover || el.playPopover.classList.contains("is-hidden")) return;
    const within = el.playHero.contains(e.target);
    if (!within) closePopover();
  });

  // -----------------------------
  // Suggestions (place OR course)
  // -----------------------------
  function hideSuggestions() { el.suggestions.classList.add("is-hidden"); el.suggestions.innerHTML = ""; }
  function showSuggestions(items) {
    if (!items.length) return hideSuggestions();
    el.suggestions.innerHTML = items.map((it, idx) => `
      <div class="suggestion" role="option" data-idx="${idx}" tabindex="0">
        <div style="min-width:18px" aria-hidden="true">${it.type === "course" ? "⛳" : "📍"}</div>
        <div style="min-width:0">
          <div class="suggestion__title">${escapeHtml(it.label)}</div>
          <div class="suggestion__meta">${escapeHtml(it.meta || "")}</div>
        </div>
      </div>
    `).join("");
    el.suggestions.classList.remove("is-hidden");

    Array.from(el.suggestions.querySelectorAll(".suggestion")).forEach(node => {
      node.addEventListener("click", () => {
        const it = items[Number(node.dataset.idx)];
        applySelection(it);
        hideSuggestions();
      });
      node.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          node.click();
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[m]));
  }

  function buildSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const list = [];

    // Courses (local supabase)
    for (const c of state.courses) {
      const label = `${c.name}`;
      const hay = `${c.name} ${c.country || ""}`.toLowerCase();
      if (hay.includes(q)) {
        list.push({
          type: "course",
          label: c.name,
          meta: c.country ? `${c.country}` : "Golf course",
          lat: Number(c.latitude),
          lon: Number(c.longitude),
        });
      }
      if (list.length >= 8) break;
    }

    // Places are handled by geocoding on Search click to avoid API spam.
    // But we can add a "search place" suggestion:
    list.unshift({
      type: "place",
      label: `Search place: "${query.trim()}"`,
      meta: "Use OpenWeather place lookup",
      query: query.trim(),
    });

    return list.slice(0, 10);
  }

  el.txtSearch?.addEventListener("input", () => {
    const q = el.txtSearch.value || "";
    const items = buildSuggestions(q);
    showSuggestions(items);
  });
  el.txtSearch?.addEventListener("blur", () => {
    // allow click selection first
    setTimeout(hideSuggestions, 120);
  });

  // -----------------------------
  // Favourites
  // -----------------------------
  function renderFavs() {
    const opts = [`<option value="">Select a favourite…</option>`];
    state.favs.forEach((f, i) => {
      opts.push(`<option value="${i}">${escapeHtml(f.label)}</option>`);
    });
    el.ddlFavs.innerHTML = opts.join("");

    // update star
    const isFav = state.favs.some(f => isSameSelection(f, state.selection));
    setStar(isFav);
  }

  el.btnFav?.addEventListener("click", () => {
    if (!state.selection) return showToast("Search and select a place/course first");
    const idx = state.favs.findIndex(f => isSameSelection(f, state.selection));
    if (idx >= 0) {
      state.favs.splice(idx, 1);
      saveFavs();
      setStar(false);
      showToast("Removed from favourites");
    } else {
      state.favs.unshift({ ...state.selection });
      saveFavs();
      setStar(true);
      showToast("Added to favourites");
    }
  });

  el.ddlFavs?.addEventListener("change", () => {
    const ix = Number(el.ddlFavs.value);
    if (!Number.isFinite(ix) || ix < 0) return;
    const fav = state.favs[ix];
    if (!fav) return;
    applySelection(fav);
  });

  // -----------------------------
  // Search handling (place OR course)
  // -----------------------------
  el.btnSearch?.addEventListener("click", async () => {
    closePopover();
    const q = (el.txtSearch.value || "").trim();
    if (!q) return;

    // If user typed exactly a course name we have, pick it
    const course = state.courses.find(c => c.name.toLowerCase() === q.toLowerCase());
    if (course) {
      applySelection({
        type: "course",
        label: course.name,
        meta: course.country || "",
        lat: Number(course.latitude),
        lon: Number(course.longitude),
      });
      return;
    }

    // Otherwise treat as place query using OWM geocoding
    try {
      setStatus("Searching place…");
      const place = await geocodePlace(q);
      if (!place) {
        setStatus("");
        showToast("No place found");
        return;
      }
      applySelection({
        type: "place",
        label: `${place.name}${place.state ? ", " + place.state : ""}, ${place.country}`,
        meta: "Place",
        lat: place.lat,
        lon: place.lon,
        placeName: place.name,
        country: place.country,
      });
    } catch (e) {
      console.error(e);
      showToast("Place search failed");
    } finally {
      setStatus("");
    }
  });

  el.btnGeo?.addEventListener("click", () => {
    closePopover();
    if (!navigator.geolocation) return showToast("Geolocation not supported");

    setStatus("Getting location…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      setStatus("");
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      // Reverse geocode (optional; falls back to coordinates label)
      let label = "My location";
      try {
        const rev = await reverseGeocode(lat, lon);
        if (rev?.name) label = `${rev.name}${rev.state ? ", " + rev.state : ""}, ${rev.country || ""}`.trim();
      } catch { /* ignore */ }

      applySelection({ type: "place", label, meta: "GPS", lat, lon });
      showToast("Using your location");
    }, (err) => {
      console.warn(err);
      setStatus("");
      showToast("Couldn’t get location");
    }, { enableHighAccuracy: true, timeout: 9000 });
  });

  // Apply selection (course or place)
  async function applySelection(sel) {
    // If suggestion is "Search place: .."
    if (sel.type === "place" && sel.query && !("lat" in sel)) {
      el.txtSearch.value = sel.query;
      el.btnSearch.click();
      return;
    }

    state.selection = {
      type: sel.type,
      label: sel.label,
      lat: Number(sel.lat),
      lon: Number(sel.lon),
    };
    saveSelection();
    renderFavs();

    // Update top hero title immediately
    el.h1Title.textContent = sel.label || "—";
    el.subTitle.textContent = sel.type === "course" ? "Golf course" : "Location";
    el.txtSearch.value = sel.label || "";

    // Fetch forecast
    await refreshForecast();
  }

  // -----------------------------
  // Supabase courses
  // -----------------------------
  let supabase = null;

  async function loadCourses() {
    if (!HAS_SB) {
      el.coursesStatus.textContent = "Courses: config missing";
      return;
    }
    try {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error(e);
      el.coursesStatus.textContent = "Courses: Supabase init failed";
      return;
    }

    try {
      // IMPORTANT: your table columns are name, latitude, longitude, country
      // and table name appears as public.uk_golf_courses from your screenshot.
      const { data, error } = await supabase
        .from("uk_golf_courses")
        .select("name, latitude, longitude, country")
        .order("name", { ascending: true });

      if (error) throw error;
      state.courses = Array.isArray(data) ? data : [];
      el.coursesStatus.textContent = `Courses: ${state.courses.length} loaded`;
    } catch (e) {
      console.error(e);
      el.coursesStatus.textContent = "Courses: error loading";
      showToast("Courses failed to load");
    }
  }

  // -----------------------------
  // OpenWeather fetch + parsing
  // -----------------------------
  async function refreshForecast() {
    if (!state.selection) return;
    if (!HAS_OWM) {
      showToast("OpenWeather API key missing (check config.js)");
      return;
    }

    // Skeletons
    renderSkeletons();

    try {
      const units = (state.units === "F") ? "imperial" : "metric";
      const url =
        `https://api.openweathermap.org/data/2.5/forecast?lat=${encodeURIComponent(state.selection.lat)}&lon=${encodeURIComponent(state.selection.lon)}&units=${units}&appid=${encodeURIComponent(OWM_API_KEY)}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`OWM forecast failed: ${res.status}`);
      const json = await res.json();
      state.forecast = json;

      renderAllFromForecast(json);
      activateTab(localStorage.getItem(LS.lastTab) || "current", false);
    } catch (e) {
      console.error(e);
      showToast("Forecast fetch failed (check API key)");
      setStatus("");
      // Clear skeletons to avoid stuck UI
      el.hourlyForecast.innerHTML = "";
      el.dailyForecast.innerHTML = "";
      el.rainTimeline.innerHTML = "";
    }
  }

  function renderSkeletons() {
    // small skeleton blocks (no overlap; fast)
    el.hourlyForecast.innerHTML = `
      <div class="skeleton" style="height:76px"></div>
      <div class="skeleton" style="height:76px"></div>
      <div class="skeleton" style="height:76px"></div>
    `;
    el.dailyForecast.innerHTML = `
      <div class="skeleton" style="height:76px"></div>
      <div class="skeleton" style="height:76px"></div>
      <div class="skeleton" style="height:76px"></div>
    `;
    el.rainTimeline.innerHTML = `
      <div class="skeleton" style="height:72px; min-width:92px"></div>
      <div class="skeleton" style="height:72px; min-width:92px"></div>
      <div class="skeleton" style="height:72px; min-width:92px"></div>
    `;
  }

  function renderAllFromForecast(json) {
    const city = json.city || {};
    const tz = city.timezone || 0;

    // Title/subtitle
    if (state.selection?.type === "place") {
      const label = state.selection.label || `${city.name || "—"}, ${city.country || ""}`.trim();
      el.h1Title.textContent = label;
      el.subTitle.textContent = fmtDate(Math.floor(Date.now()/1000), 0);
    } else {
      el.h1Title.textContent = state.selection.label || "—";
      el.subTitle.textContent = `${city.country || ""} • ${fmtDate(Math.floor(Date.now()/1000), 0)}`.trim();
    }

    // Current-ish = first item
    const first = (json.list && json.list[0]) ? json.list[0] : null;
    if (first) {
      const t = first.main?.temp ?? null;
      const feels = first.main?.feels_like ?? null;
      const hum = first.main?.humidity ?? null;
      const ws = first.wind?.speed ?? null;
      const wd = first.wind?.deg ?? null;

      el.currTemp.textContent = (t === null ? "--" : Math.round(t));
      el.feelsLike.textContent = (feels === null ? "--" : Math.round(feels));
      el.humidity.textContent = (hum === null ? "--" : Math.round(hum));
      el.wind.textContent = (ws === null ? "--" : `${Math.round(ws)} ${state.units === "F" ? "mph" : "m/s"}`);
      el.windDir.textContent = wd == null ? "—" : `${degToCompass(wd)} (${Math.round(wd)}°)`;

      const icon = first.weather?.[0]?.icon;
      if (icon) {
        el.imgIcon.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
        el.imgIcon.alt = first.weather?.[0]?.description || "";
      } else {
        el.imgIcon.removeAttribute("src");
        el.imgIcon.alt = "";
      }
    }

    // Sunrise/sunset
    if (city.sunrise && city.sunset) {
      el.sunrise.textContent = fmtTime(city.sunrise, tz);
      el.sunset.textContent = fmtTime(city.sunset, tz);
      el.teeSunrise.textContent = fmtTime(city.sunrise, tz);
      el.teeSunset.textContent = fmtTime(city.sunset, tz);

      const daySec = (city.sunset - city.sunrise);
      const h = Math.floor(daySec / 3600);
      const m = Math.round((daySec % 3600) / 60);
      el.dayLength.textContent = `Day length: ${h}h ${m}m`;
    } else {
      el.sunrise.textContent = "--";
      el.sunset.textContent = "--";
      el.teeSunrise.textContent = "--";
      el.teeSunset.textContent = "--";
      el.dayLength.textContent = "Day length: —";
    }

    // Hourly (by selected day)
    const dayGroups = groupByLocalDay(json.list || [], tz);
    renderDayDropdown(dayGroups);
    renderHourly(dayGroups, getSelectedDayKey(dayGroups));

    // Daily (up to 7 days from available list)
    renderDaily(dayGroups);

    // Rain timeline (next 8 blocks)
    renderRainTimeline(json.list || []);

    // Map
    initOrUpdateMap(state.selection.lat, state.selection.lon);

    // Playability + tee time
    const play = computePlayabilityFromForecast(json, tz);
    renderPlayability(play);

    const best = computeBestTeeTime(json, tz);
    renderBestTee(best);
  }

  // -----------------------------
  // Grouping / rendering
  // -----------------------------
  function groupByLocalDay(list, tzOffsetSec) {
    const groups = new Map(); // key -> items
    for (const item of list) {
      const dtLocal = new Date((item.dt + tzOffsetSec) * 1000);
      const key = dtLocal.toISOString().slice(0,10); // YYYY-MM-DD (local-shifted)
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    // Preserve insertion order
    return Array.from(groups.entries()).map(([key, items]) => ({ key, items }));
  }

  function renderDayDropdown(dayGroups) {
    el.ddlDay.innerHTML = "";
    dayGroups.forEach((g, idx) => {
      const d = new Date(g.items[0].dt * 1000);
      const label = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
      const opt = document.createElement("option");
      opt.value = g.key;
      opt.textContent = label;
      el.ddlDay.appendChild(opt);
      if (idx === 0) opt.selected = true;
    });

    el.ddlDay.onchange = () => {
      const tz = state.forecast?.city?.timezone || 0;
      const groups = groupByLocalDay(state.forecast?.list || [], tz);
      renderHourly(groups, el.ddlDay.value);
      // when user changes day, ensure hourly tab is visible and scrolls
      activateTab("hourly", true);
    };
  }

  function getSelectedDayKey(dayGroups) {
    if (!dayGroups.length) return "";
    // If dropdown has a value, prefer it
    const v = el.ddlDay.value;
    if (v && dayGroups.some(g => g.key === v)) return v;
    return dayGroups[0].key;
  }

  function renderHourly(dayGroups, dayKey) {
    const g = dayGroups.find(x => x.key === dayKey) || dayGroups[0];
    if (!g) { el.hourlyForecast.innerHTML = ""; return; }

    const tz = state.forecast?.city?.timezone || 0;
    const cards = g.items.map(it => {
      const dtLocal = new Date((it.dt + tz) * 1000);
      const time = fmtHHMMFromLocalDate(dtLocal);
      const icon = it.weather?.[0]?.icon;
      const t = it.main?.temp;
      const pop = it.pop ?? 0;
      const wind = it.wind?.speed ?? null;
      const wd = it.wind?.deg ?? null;
      const windTxt = wind == null ? "—" : `${Math.round(wind)} ${state.units === "F" ? "mph" : "m/s"} ${degToCompass(wd)}`;

      return `
        <div class="fcCard">
          <div class="fcLeft">
            <div class="fcTitle">${escapeHtml(time)}</div>
            <div class="fcMeta">
              <span>Rain: ${Math.round(pop * 100)}%</span>
              <span>Wind: ${escapeHtml(windTxt)}</span>
            </div>
          </div>
          <div class="fcRight">
            ${icon ? `<img class="fcIcon" alt="" src="https://openweathermap.org/img/wn/${icon}@2x.png">` : ""}
            <div class="fcTemp">${t == null ? "--" : Math.round(t)}°</div>
          </div>
        </div>
      `;
    }).join("");

    el.hourlyForecast.innerHTML = cards;
  }

  // Daily: we only have 5-day/3-hour from this endpoint.
  // We'll create up to 7 "day cards" from the days present (usually 5-6 depending on timezone).
  function renderDaily(dayGroups) {
    if (!dayGroups.length) { el.dailyForecast.innerHTML = ""; return; }

    const tz = state.forecast?.city?.timezone || 0;
    const maxDays = 7;
    const days = dayGroups.slice(0, maxDays);

    const html = days.map((g) => {
      const items = g.items;

      // pick icon near midday if possible
      let mid = items[Math.floor(items.length / 2)];
      const icon = mid?.weather?.[0]?.icon;

      // high/low
      let hi = -Infinity, lo = Infinity;
      let popMax = 0;
      let windMax = 0;
      for (const it of items) {
        const t = it.main?.temp;
        if (typeof t === "number") { hi = Math.max(hi, t); lo = Math.min(lo, t); }
        popMax = Math.max(popMax, (it.pop ?? 0));
        windMax = Math.max(windMax, (it.wind?.speed ?? 0));
      }

      const dayName = new Date((items[0].dt + tz) * 1000)
        .toLocaleDateString(undefined, { weekday: "short" });

      return `
        <div class="fcCard">
          <div class="fcLeft">
            <div class="fcTitle">${escapeHtml(dayName)}</div>
            <div class="fcMeta">
              <span>Rain: ${Math.round(popMax * 100)}%</span>
              <span>Wind: ${Math.round(windMax)} ${state.units === "F" ? "mph" : "m/s"}</span>
            </div>
          </div>
          <div class="fcRight">
            ${icon ? `<img class="fcIcon" alt="" src="https://openweathermap.org/img/wn/${icon}@2x.png">` : ""}
            <div class="fcTemp">
              ${Number.isFinite(hi) ? Math.round(hi) : "--"}° / ${Number.isFinite(lo) ? Math.round(lo) : "--"}°
              <small>Hi / Lo</small>
            </div>
          </div>
        </div>
      `;
    }).join("");

    el.dailyForecast.innerHTML = html;
  }

  function renderRainTimeline(list) {
    const tz = state.forecast?.city?.timezone || 0;
    const next = list.slice(0, 8);
    if (!next.length) { el.rainTimeline.innerHTML = ""; return; }

    // Rain message: first time rain probability goes above 40%
    let minutes = null;
    const nowDt = next[0].dt;
    for (const it of list.slice(0, 16)) {
      const pop = it.pop ?? 0;
      if (pop >= 0.4) {
        minutes = Math.max(0, Math.round((it.dt - nowDt) / 60));
        break;
      }
    }
    el.rainMessage.textContent = minutes == null ? "No rain expected soon" : `Rain likely in ~${minutes} min`;

    el.rainTimeline.innerHTML = next.map(it => {
      const dtLocal = new Date((it.dt + tz) * 1000);
      const time = fmtHHMMFromLocalDate(dtLocal);
      const pct = Math.round((it.pop ?? 0) * 100);
      const fill = clamp(pct, 0, 100);
      return `
        <div class="tlCard">
          <div class="tlTime">${escapeHtml(time)}</div>
          <div class="tlBar"><div class="tlFill" style="width:${fill}%"></div></div>
          <div class="tlPct">${fill}%</div>
        </div>
      `;
    }).join("");
  }

  // -----------------------------
  // Playability calculation (simple + golf-friendly)
  // -----------------------------
  function computePlayabilityFromForecast(json, tz) {
    const list = json.list || [];
    const first = list[0];
    if (!first) return { score0to10: 0, whole: 0, band: bandFromWholeScore(0), meta: "—" };

    // Inputs
    const wind = first.wind?.speed ?? 0;
    const pop = first.pop ?? 0;
    const temp = first.main?.temp ?? 10;

    // Score components (tuned for "golf feel", not scientific)
    // Start at 10 and subtract penalties
    let score = 10;

    // Wind penalty (m/s metric; mph imperial comes already from API units; but we treat as "wind units")
    // In imperial, wind is mph; in metric it's m/s. We'll normalize roughly:
    const windMetric = (state.units === "F") ? (wind * 0.44704) : wind; // mph -> m/s
    score -= clamp((windMetric - 3) * 0.6, 0, 4.0); // gentle >3m/s starts to hurt

    // Rain probability penalty
    score -= clamp(pop * 5.0, 0, 5.0);

    // Temperature comfort (assume metric in C; for imperial API temp is F so normalize)
    const tempC = (state.units === "F") ? ((temp - 32) * 5/9) : temp;
    // ideal around 16–22C; penalize outside
    const diff = Math.abs(tempC - 19);
    score -= clamp((diff - 3) * 0.25, 0, 2.2);

    // Ground conditions proxy: if there is rain in next 6h, nudge down slightly
    const soonRain = list.slice(0, 3).some(it => (it.pop ?? 0) >= 0.5);
    if (soonRain) score -= 0.6;

    score = clamp(score, 0, 10);
    const whole = roundWholeScore(score);
    const band = bandFromWholeScore(whole);

    const metaBits = [];
    metaBits.push(windMetric >= 8 ? "Windy" : windMetric >= 5 ? "Breezy" : "Light wind");
    metaBits.push(pop >= 0.6 ? "High rain risk" : pop >= 0.3 ? "Some rain risk" : "Low rain risk");
    metaBits.push(tempC <= 4 ? "Cold" : tempC >= 26 ? "Warm" : "Comfortable");

    return { score0to10: score, whole, band, meta: metaBits.join(" • ") };
  }

  function renderPlayability(play) {
    el.playScoreWhole.textContent = String(play.whole);
    el.playBand.textContent = play.band.label;
    el.playMeta.textContent = play.meta;

    el.playHero.classList.remove("is-excellent","is-good","is-marginal","is-poor");
    el.playHero.classList.add(`is-${play.band.key}`);
  }

  // -----------------------------
  // Best tee time logic (STRICT daylight)
  // Must never suggest before sunrise or after sunset.
  // Chosen from 3-hour blocks within daylight (strictly within sunrise..sunset).
  // -----------------------------
  function computeBestTeeTime(json, tz) {
    const city = json.city || {};
    const sunrise = city.sunrise;
    const sunset = city.sunset;
    const list = json.list || [];
    if (!sunrise || !sunset || !list.length) {
      return { ok: false, message: "No daylight data available for tee-time guidance." };
    }

    // Consider today's blocks only (local day of sunrise)
    const dayKey = new Date((sunrise + tz) * 1000).toISOString().slice(0,10);
    const todays = list.filter(it => {
      const key = new Date((it.dt + tz) * 1000).toISOString().slice(0,10);
      return key === dayKey;
    });

    // Strict daylight: start >= sunrise AND end <= sunset
    // We'll assume each 3h block covers dt..dt+3h.
    const candidates = [];
    for (const it of todays) {
      const start = it.dt;
      const end = it.dt + 3*3600;

      if (start < sunrise) continue;
      if (end > sunset) continue;

      // Score this slot (reuse similar logic)
      const wind = it.wind?.speed ?? 0;
      const pop = it.pop ?? 0;
      const temp = it.main?.temp ?? 10;

      // normalize wind to m/s for scoring
      const windMetric = (state.units === "F") ? (wind * 0.44704) : wind;
      const tempC = (state.units === "F") ? ((temp - 32) * 5/9) : temp;

      let score = 10;
      score -= clamp((windMetric - 3) * 0.6, 0, 4.0);
      score -= clamp(pop * 5.0, 0, 5.0);

      const diff = Math.abs(tempC - 19);
      score -= clamp((diff - 3) * 0.25, 0, 2.2);

      score = clamp(score, 0, 10);

      candidates.push({ it, score });
    }

    if (!candidates.length) {
      return {
        ok: false,
        sunrise,
        sunset,
        message: "No good tee time today — no full daylight slot found.",
      };
    }

    candidates.sort((a,b) => b.score - a.score);
    const best = candidates[0];

    const whole = roundWholeScore(best.score);
    const band = bandFromWholeScore(whole);

    // If truly poor all day (within daylight), show a “poor throughout daylight” message.
    const bestWhole = whole;
    const maxWhole = bestWhole;
    if (maxWhole <= 3) {
      return {
        ok: false,
        sunrise,
        sunset,
        message: "No good tee time today — conditions poor throughout daylight hours.",
      };
    }

    return { ok: true, sunrise, sunset, best, whole, band };
  }

  function renderBestTee(best) {
    const tz = state.forecast?.city?.timezone || 0;
    if (best.sunrise && best.sunset) {
      el.teeSunrise.textContent = fmtTime(best.sunrise, tz);
      el.teeSunset.textContent = fmtTime(best.sunset, tz);
    }

    if (!best.ok) {
      el.bestTeeTime.textContent = "—";
      el.bestTeeScore.textContent = "—";
      el.teeMsg.textContent = best.message || "—";
      return;
    }

    const it = best.best.it;
    const startLocal = new Date((it.dt + tz) * 1000);
    const endLocal = new Date((it.dt + 3*3600 + tz) * 1000);
    const timeStr = `${fmtHHMMFromLocalDate(startLocal)} – ${fmtHHMMFromLocalDate(endLocal)}`;

    el.bestTeeTime.textContent = timeStr;
    el.bestTeeScore.textContent = `${best.whole}/10 (${best.band.label})`;

    // Message: short golf-focused hint
    const pop = Math.round((it.pop ?? 0) * 100);
    const wind = Math.round(it.wind?.speed ?? 0);
    el.teeMsg.textContent = `Rain ${pop}% • Wind ${wind}${state.units === "F" ? " mph" : " m/s"} • Within daylight`;
  }

  // -----------------------------
  // Map
  // -----------------------------
  function initOrUpdateMap(lat, lon) {
    if (!window.L || !el.map) return;

    if (!state.map) {
      state.map = L.map(el.map, { zoomControl: false, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(state.map);
      state.marker = L.marker([lat, lon]).addTo(state.map);
      state.map.setView([lat, lon], 10);
    } else {
      state.marker.setLatLng([lat, lon]);
      state.map.setView([lat, lon], 10, { animate: false });
    }
  }

  // -----------------------------
  // Geocoding via OpenWeather endpoints
  // -----------------------------
  async function geocodePlace(q) {
    // https://openweathermap.org/api/geocoding-api
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${encodeURIComponent(OWM_API_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Geocode failed: ${res.status}`);
    const arr = await res.json();
    return arr && arr[0] ? arr[0] : null;
  }

  async function reverseGeocode(lat, lon) {
    const url = `https://api.openweathermap.org/geo/1.0/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&limit=1&appid=${encodeURIComponent(OWM_API_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Reverse geocode failed: ${res.status}`);
    const arr = await res.json();
    return arr && arr[0] ? arr[0] : null;
  }

  // -----------------------------
  // Units
  // -----------------------------
  el.ddlUnits.value = state.units;
  el.ddlUnits.addEventListener("change", async () => {
    state.units = el.ddlUnits.value;
    localStorage.setItem(LS.units, state.units);
    showToast(`Units set to °${state.units}`);
    await refreshForecast();
  });

  // -----------------------------
  // PWA SW registration
  // -----------------------------
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("./service-worker.js");
    } catch (e) {
      console.warn("SW registration failed", e);
    }
  }

  // -----------------------------
  // Init
  // -----------------------------
  async function init() {
    // Tabs: restore last
    const lastTab = localStorage.getItem(LS.lastTab) || "current";
    activateTab(lastTab, false);

    // Config warnings
    if (!HAS_OWM) setStatus("Config: missing OpenWeather key");
    if (!HAS_SB) el.coursesStatus.textContent = "Courses: config missing";

    // Load courses + favourites
    renderFavs();
    await loadCourses();

    // Restore selection or pick a default
    if (state.selection) {
      setStatus("Loading last selection…");
      await refreshForecast();
      setStatus("");
    } else {
      // default: London coords (you can change)
      state.selection = { type: "place", label: "London, GB", lat: 51.5072, lon: -0.1276 };
      saveSelection();
      renderFavs();
      await refreshForecast();
    }

    // Register SW
    await registerSW();
  }

  // Kick off
  init().catch(console.error);
})();
