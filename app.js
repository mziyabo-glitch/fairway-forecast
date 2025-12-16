/* =========================================================
   Fairway Forecast – App Logic (Mobile-first, PWA-safe)
   Adds: Supabase course search (uk_golf_courses) + suggestions
   ========================================================= */

(() => {
  "use strict";

  /* -----------------------------
     Config
  ----------------------------- */
  const CFG = window.APP_CONFIG || {};
  const OWM_KEY = CFG.OWM_API_KEY;
  const SB_URL = CFG.SUPABASE_URL;
  const SB_KEY = CFG.SUPABASE_ANON_KEY;

  if (!OWM_KEY || !SB_URL || !SB_KEY) {
    console.error("Missing APP_CONFIG keys (OWM_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY).");
  }

  // Supabase UMD client
  const sb = window.supabase.createClient(SB_URL, SB_KEY);

  /* -----------------------------
     DOM helpers
  ----------------------------- */
  const $ = (id) => document.getElementById(id);
  const qs = (sel, ctx = document) => ctx.querySelector(sel);
  const qsa = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const toast = (msg) => {
    const el = $("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("is-hidden");
    setTimeout(() => el.classList.add("is-hidden"), 2200);
  };

  /* -----------------------------
     State
  ----------------------------- */
  let state = {
    lat: null,
    lon: null,
    label: "",
    units: localStorage.getItem("ff_units") || "C",
    activeTab: localStorage.getItem("ff_tab") || "current",
    forecast: null,
    suggestions: [],
    courseCache: new Map() // term -> results
  };

  /* -----------------------------
     Init
  ----------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    initUnits();
    initTabs();
    initPlayabilityPopover();
    initSearch();
    initFavourites();
    restoreTab();
    registerSW();

    // quick sanity ping to show courses are reachable (optional)
    warmupCourses();
  });

  async function warmupCourses() {
    const el = $("coursesStatus");
    if (!el) return;
    el.textContent = "Courses: checking…";
    try {
      const { data, error } = await sb
        .from("uk_golf_courses")
        .select("name", { count: "exact", head: true });

      if (error) throw error;
      el.textContent = "Courses: ready ✓";
    } catch (e) {
      console.error("Supabase courses check failed:", e);
      el.textContent = "Courses: error (check RLS/table name)";
    }
  }

  /* -----------------------------
     Units
  ----------------------------- */
  function initUnits() {
    const ddl = $("ddlUnits");
    if (!ddl) return;

    ddl.value = state.units;
    ddl.addEventListener("change", () => {
      state.units = ddl.value;
      localStorage.setItem("ff_units", state.units);
      if (state.lat && state.lon) loadWeather();
    });
  }

  /* -----------------------------
     Tabs
  ----------------------------- */
  function initTabs() {
    qsa(".tab").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.tab, true));
    });
  }

  function activateTab(tab, scroll) {
    state.activeTab = tab;
    localStorage.setItem("ff_tab", tab);

    qsa(".tab").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.tab === tab);
      b.setAttribute("aria-selected", b.dataset.tab === tab ? "true" : "false");
    });

    qsa(".panel").forEach((p) => {
      p.classList.toggle("is-active", p.dataset.panel === tab);
    });

    if (scroll) {
      const forecast = $("forecast");
      if (forecast) forecast.scrollIntoView({ behavior: "smooth" });
    }
  }

  function restoreTab() {
    activateTab(state.activeTab, false);
  }

  /* -----------------------------
     Search (Unified: place OR course)
  ----------------------------- */
  function initSearch() {
    const input = $("txtSearch");
    const btn = $("btnSearch");
    const btnGeo = $("btnGeo");
    const sugg = $("searchSuggestions");

    if (!input || !btn || !sugg) return;

    btn.addEventListener("click", doUnifiedSearch);
    btnGeo?.addEventListener("click", geoLocate);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doUnifiedSearch();
      }
      if (e.key === "Escape") hideSuggestions();
    });

    // Live suggestions (courses + places)
    input.addEventListener(
      "input",
      debounce(async () => {
        const term = input.value.trim();
        if (term.length < 2) {
          hideSuggestions();
          return;
        }
        const [courseResults, placeResults] = await Promise.all([
          searchCourses(term),
          searchPlaces(term, 5)
        ]);

        const items = [];

        courseResults.forEach((c) => {
          items.push({
            type: "course",
            label: `${c.name}${c.country ? " (" + c.country + ")" : ""}`,
            name: c.name,
            country: c.country || "",
            lat: Number(c.latitude),
            lon: Number(c.longitude)
          });
        });

        placeResults.forEach((p) => {
          items.push({
            type: "place",
            label: `${p.name}${p.state ? ", " + p.state : ""}${p.country ? ", " + p.country : ""}`,
            name: p.name,
            country: p.country || "",
            lat: p.lat,
            lon: p.lon
          });
        });

        state.suggestions = items.slice(0, 10);
        renderSuggestions(state.suggestions);
      }, 250)
    );

    // Click outside to close
    document.addEventListener("click", (e) => {
      const isInside =
        e.target === input ||
        e.target === sugg ||
        (e.target && sugg.contains(e.target));
      if (!isInside) hideSuggestions();
    });
  }

  async function doUnifiedSearch() {
    const input = $("txtSearch");
    if (!input) return;

    const term = input.value.trim();
    if (!term) return;

    // If user already picked a suggestion, prefer that
    // Otherwise: try course first (fast), then fallback to place geocode
    const topCourse = (await searchCourses(term)).find(
      (c) => (c.name || "").toLowerCase() === term.toLowerCase()
    );

    if (topCourse) {
      selectCourse({
        name: topCourse.name,
        country: topCourse.country || "",
        lat: Number(topCourse.latitude),
        lon: Number(topCourse.longitude)
      });
      return;
    }

    // Fallback to place search
    const places = await searchPlaces(term, 1);
    if (!places[0]) {
      toast("No course or place found");
      return;
    }

    selectPlace(places[0]);
  }

  async function searchCourses(term) {
    const key = term.toLowerCase();
    if (state.courseCache.has(key)) return state.courseCache.get(key);

    try {
      const { data, error } = await sb
        .from("uk_golf_courses")
        .select("name, latitude, longitude, country")
        .ilike("name", `%${term}%`)
        .limit(10);

      if (error) throw error;

      const results = (data || []).filter(
        (r) => r.latitude !== null && r.longitude !== null
      );

      state.courseCache.set(key, results);
      return results;
    } catch (e) {
      console.error("Supabase course search error:", e);
      return [];
    }
  }

  async function searchPlaces(term, limit = 5) {
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(
      term
    )}&limit=${limit}&appid=${OWM_KEY}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error("Place search failed:", e);
      return [];
    }
  }

  function renderSuggestions(items) {
    const box = $("searchSuggestions");
    if (!box) return;

    if (!items.length) {
      hideSuggestions();
      return;
    }

    box.innerHTML = "";
    box.classList.remove("is-hidden");

    items.forEach((it, idx) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "suggestionRow";
      row.setAttribute("role", "option");
      row.dataset.idx = String(idx);

      row.innerHTML = `
        <span class="tag">${it.type === "course" ? "Course" : "Place"}</span>
        <span class="text">${escapeHtml(it.label)}</span>
      `;

      row.addEventListener("click", () => {
        if (it.type === "course") selectCourse(it);
        else selectPlace(it);
        hideSuggestions();
      });

      box.appendChild(row);
    });
  }

  function hideSuggestions() {
    const box = $("searchSuggestions");
    if (!box) return;
    box.classList.add("is-hidden");
    box.innerHTML = "";
    state.suggestions = [];
  }

  function selectCourse(course) {
    state.lat = course.lat;
    state.lon = course.lon;
    state.label = course.country ? `${course.name} (${course.country})` : course.name;

    $("h1Title").textContent = course.name;
    $("subTitle").textContent = course.country ? course.country : "Golf course";

    markFavButton();
    loadWeather();
    activateTab("current", true);
  }

  function selectPlace(place) {
    state.lat = place.lat;
    state.lon = place.lon;
    state.label = `${place.name}${place.country ? ", " + place.country : ""}`;

    $("h1Title").textContent = state.label;
    $("subTitle").textContent = "Current conditions";

    markFavButton();
    loadWeather();
    activateTab("current", true);
  }

  function geoLocate() {
    if (!navigator.geolocation) {
      toast("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.lat = pos.coords.latitude;
        state.lon = pos.coords.longitude;
        state.label = "My location";
        $("h1Title").textContent = state.label;
        $("subTitle").textContent = "Current conditions";
        markFavButton();
        loadWeather();
        activateTab("current", true);
      },
      () => toast("Location access denied")
    );
  }

  /* -----------------------------
     Weather
  ----------------------------- */
  async function loadWeather() {
    const units = state.units === "C" ? "metric" : "imperial";
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${state.lat}&lon=${state.lon}&units=${units}&appid=${OWM_KEY}`;

    const appStatus = $("appStatus");
    if (appStatus) appStatus.textContent = "Loading weather…";

    try {
      const res = await fetch(url);
      const json = await res.json();

      if (!json.list) {
        toast("Weather unavailable");
        if (appStatus) appStatus.textContent = "Weather error";
        return;
      }

      state.forecast = json;
      renderCurrent(json);
      renderHourly(json);
      renderDaily(json);
      calcBestTeeTime(json);

      if (appStatus) appStatus.textContent = "";
    } catch (e) {
      console.error("Forecast fetch failed:", e);
      toast("Weather failed");
      if (appStatus) appStatus.textContent = "Weather error";
    }
  }

  /* -----------------------------
     Rendering
  ----------------------------- */
  function renderCurrent(data) {
    const cur = data.list[0];

    $("currTemp").textContent = clampRound(cur.main.temp);
    $("feelsLike").textContent = clampRound(cur.main.feels_like);
    $("humidity").textContent = cur.main.humidity;

    const windVal = Math.round(cur.wind.speed);
    $("wind").textContent = `${windVal} ${state.units === "C" ? "m/s" : "mph"}`;
    $("windDir").textContent = degToCompass(cur.wind.deg);

    const icon = cur.weather?.[0]?.icon;
    if (icon) $("imgIcon").src = `https://openweathermap.org/img/wn/${icon}@2x.png`;

    const sunrise = data.city.sunrise * 1000;
    const sunset = data.city.sunset * 1000;

    $("sunrise").textContent = fmtTime(sunrise);
    $("sunset").textContent = fmtTime(sunset);

    $("teeSunrise").textContent = fmtTime(sunrise);
    $("teeSunset").textContent = fmtTime(sunset);

    calcPlayability(cur);
  }

  function renderHourly(data) {
    const wrap = $("hourlyForecast");
    if (!wrap) return;
    wrap.innerHTML = "";

    // Show next 24h = 8 blocks (3-hour)
    data.list.slice(0, 8).forEach((h) => {
      const el = document.createElement("div");
      el.className = "fcCard";
      el.innerHTML = `
        <div>
          <div class="fcTitle">${fmtTime(h.dt * 1000)}</div>
          <div class="fcMeta">💧 ${Math.round((h.pop || 0) * 100)}% • 🌬 ${Math.round(h.wind.speed)}</div>
        </div>
        <div class="fcTemp">${clampRound(h.main.temp)}°</div>
      `;
      wrap.appendChild(el);
    });
  }

  function renderDaily(data) {
    const wrap = $("dailyForecast");
    if (!wrap) return;
    wrap.innerHTML = "";

    // Build daily buckets from 3-hour data (up to 7 days max available)
    const byDay = {};
    data.list.forEach((item) => {
      const d = new Date(item.dt * 1000).toDateString();
      byDay[d] = byDay[d] || [];
      byDay[d].push(item);
    });

    const days = Object.keys(byDay).slice(0, 7);
    days.forEach((dayKey) => {
      const arr = byDay[dayKey];

      const hi = Math.max(...arr.map((x) => x.main.temp));
      const lo = Math.min(...arr.map((x) => x.main.temp));
      const pop = Math.max(...arr.map((x) => x.pop || 0));
      const wind = Math.max(...arr.map((x) => x.wind.speed));

      const el = document.createElement("div");
      el.className = "fcCard";
      el.innerHTML = `
        <div>
          <div class="fcTitle">${new Date(dayKey).toLocaleDateString(undefined, { weekday: "long" })}</div>
          <div class="fcMeta">💧 ${Math.round(pop * 100)}% • 🌬 ${Math.round(wind)}</div>
        </div>
        <div class="fcTemp">
          ${clampRound(hi)}° <small>${clampRound(lo)}°</small>
        </div>
      `;
      wrap.appendChild(el);
    });
  }

  /* -----------------------------
     Playability (whole 0..10 with labels)
  ----------------------------- */
  function calcPlayability(cur) {
    // simple heuristic score (keep lightweight)
    let score = 10;
    score -= Math.min(cur.wind.speed, 12) * 0.35;      // wind penalty
    score -= (cur.pop || 0) * 5;                       // rain probability penalty
    score -= Math.abs(cur.main.temp - 18) * 0.10;      // comfort penalty

    score = clampScore(score);

    const hero = $("playHero");
    hero.classList.remove("is-excellent", "is-good", "is-marginal", "is-poor");

    const band = score >= 8 ? "Excellent"
      : score >= 6 ? "Good"
      : score >= 4 ? "Marginal"
      : "Poor";

    const cls = score >= 8 ? "is-excellent"
      : score >= 6 ? "is-good"
      : score >= 4 ? "is-marginal"
      : "is-poor";

    hero.classList.add(cls);
    $("playScoreWhole").textContent = score;
    $("playBand").textContent = band;

    const rainPct = Math.round((cur.pop || 0) * 100);
    $("playMeta").textContent = `Wind ${Math.round(cur.wind.speed)} • Rain ${rainPct}% • Temp ${clampRound(cur.main.temp)}°`;
  }

  function clampScore(x) {
    return Math.max(0, Math.min(10, Math.round(x)));
  }

  function clampRound(x) {
    return Math.round(x);
  }

  /* -----------------------------
     Tee Time (STRICT daylight-only)
  ----------------------------- */
  function calcBestTeeTime(data) {
    const sunrise = data.city.sunrise * 1000;
    const sunset = data.city.sunset * 1000;

    // Only slots strictly between sunrise and sunset
    const slots = data.list.filter((h) => {
      const t = h.dt * 1000;
      return t > sunrise && t < sunset;
    });

    if (!slots.length) {
      $("bestTeeTime").textContent = "—";
      $("bestTeeScore").textContent = "";
      $("teeMsg").textContent = "No good tee time today — no daylight forecast slots.";
      return;
    }

    // Score each slot (lower penalty = better)
    const ranked = slots.map((h) => {
      let s = 10;
      s -= Math.min(h.wind.speed, 12) * 0.35;
      s -= (h.pop || 0) * 5;
      s -= Math.abs(h.main.temp - 18) * 0.10;
      const score = clampScore(s);
      return { h, score };
    }).sort((a, b) => b.score - a.score);

    const best = ranked[0];

    // If all daylight is poor (0-3), show message
    if (best.score <= 3) {
      $("bestTeeTime").textContent = "—";
      $("bestTeeScore").textContent = "";
      $("teeMsg").textContent = "No good tee time today — conditions poor throughout daylight hours.";
      return;
    }

    $("bestTeeTime").textContent = fmtTime(best.h.dt * 1000);
    $("bestTeeScore").textContent = `${best.score}/10`;
    const rainPct = Math.round((best.h.pop || 0) * 100);
    $("teeMsg").textContent = `Best daylight slot • Rain ${rainPct}% • Wind ${Math.round(best.h.wind.speed)}`;
  }

  /* -----------------------------
     Favourites (localStorage)
  ----------------------------- */
  function initFavourites() {
    $("btnFav")?.addEventListener("click", toggleFavourite);
    $("ddlFavs")?.addEventListener("change", onPickFavourite);
    loadFavourites();
    markFavButton();
  }

  function getFavs() {
    return JSON.parse(localStorage.getItem("ff_favs") || "{}");
  }

  function saveFavs(f) {
    localStorage.setItem("ff_favs", JSON.stringify(f));
  }

  function makeFavKey() {
    // stable key per selection
    if (!state.label || state.lat == null || state.lon == null) return null;
    return `${state.label}||${state.lat.toFixed(4)},${state.lon.toFixed(4)}`;
  }

  function toggleFavourite() {
    const key = makeFavKey();
    if (!key) {
      toast("Search first");
      return;
    }

    const favs = getFavs();
    if (favs[key]) {
      delete favs[key];
      toast("Removed favourite");
    } else {
      favs[key] = {
        label: state.label,
        lat: state.lat,
        lon: state.lon
      };
      toast("Saved favourite");
    }
    saveFavs(favs);
    loadFavourites();
    markFavButton();
  }

  function loadFavourites() {
    const ddl = $("ddlFavs");
    if (!ddl) return;

    ddl.innerHTML = `<option value="">Select a favourite…</option>`;
    const favs = getFavs();

    Object.keys(favs).forEach((k) => {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = favs[k].label;
      ddl.appendChild(o);
    });
  }

  function onPickFavourite(e) {
    const key = e.target.value;
    if (!key) return;
    const favs = getFavs();
    const f = favs[key];
    if (!f) return;

    state.lat = f.lat;
    state.lon = f.lon;
    state.label = f.label;

    $("h1Title").textContent = state.label;
    $("subTitle").textContent = "Favourite";

    markFavButton();
    loadWeather();
    activateTab("current", true);
  }

  function markFavButton() {
    const btn = $("btnFav");
    if (!btn) return;
    const key = makeFavKey();
    const favs = getFavs();
    const on = key && !!favs[key];
    btn.classList.toggle("is-on", on);
    btn.textContent = on ? "★" : "☆";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /* -----------------------------
     Playability popover
  ----------------------------- */
  function initPlayabilityPopover() {
    const open = $("btnPlayInfo");
    const close = $("btnPlayClose");
    const pop = $("playPopover");
    if (!open || !close || !pop) return;

    open.onclick = () => {
      pop.classList.remove("is-hidden");
      open.setAttribute("aria-expanded", "true");
    };
    close.onclick = () => {
      pop.classList.add("is-hidden");
      open.setAttribute("aria-expanded", "false");
    };
  }

  /* -----------------------------
     Helpers
  ----------------------------- */
  function fmtTime(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function degToCompass(d) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(d / 45) % 8];
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* -----------------------------
     Service Worker
  ----------------------------- */
  function registerSW() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    }
  }
})();
