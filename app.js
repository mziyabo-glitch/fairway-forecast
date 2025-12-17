/* app.js
   Fairway Forecast (static)
   - Supabase courses via REST
   - Weather via Cloudflare Worker (secure)
*/

(() => {
  "use strict";

  // ---------- helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const round0 = (n) => (Number.isFinite(n) ? Math.round(n) : null);

  function safeJsonParse(str, fallback) {
    try {
      const v = JSON.parse(str);
      return v ?? fallback;
    } catch {
      return fallback;
    }
  }

  function setText(el, text) {
    if (!el) return;
    el.textContent = text;
  }

  function setHTML(el, html) {
    if (!el) return;
    el.innerHTML = html;
  }

  function scrollToEl(el) {
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- config ----------
  const CFG = window.APP_CONFIG || {};
  const SUPABASE_URL = (CFG.SUPABASE_URL || "").replace(/\/+$/, "");
  const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY || "";
  const COURSES_TABLE = CFG.COURSES_TABLE || "uk_golf_courses";
  const COLS = CFG.COURSE_COLS || { name: "name", lat: "latitude", lon: "longitude", country: "country" };

  const WORKER_BASE_URL = (CFG.WORKER_BASE_URL || "").replace(/\/+$/, "");
  const DEFAULT_UNITS = CFG.DEFAULT_UNITS || "metric";

  // ---------- state ----------
  const state = {
    units: DEFAULT_UNITS,
    courses: [],
    filtered: [],
    selected: null, // {type:'place'|'course', name, lat, lon, country?}
    favs: [],
    activeTab: "daily",
    lastWeather: null,
  };

  // ---------- storage ----------
  const LS_FAVS = "ff_favs_v1";
  const LS_UNITS = "ff_units_v1";

  function loadPrefs() {
    state.favs = safeJsonParse(localStorage.getItem(LS_FAVS), []);
    if (!Array.isArray(state.favs)) state.favs = [];
    const u = localStorage.getItem(LS_UNITS);
    if (u === "metric" || u === "imperial") state.units = u;
  }

  function saveFavs() {
    localStorage.setItem(LS_FAVS, JSON.stringify(state.favs));
  }

  function saveUnits() {
    localStorage.setItem(LS_UNITS, state.units);
  }

  // ---------- element mapping (tolerant) ----------
  // Supports either IDs or common classnames; if not found, it just skips.
  const els = {
    skipLink: $("#skip-to-forecast") || $('a[href*="forecast"]'),
    units: $("#units") || $("#unitSelect") || $('select[name="units"]'),
    query: $("#query") || $("#searchInput") || $('input[type="search"]') || $('input[placeholder*="Swindon"]'),
    searchBtn: $("#searchBtn") || $("#search") || $('button[type="submit"]') || $("button"),
    geoBtn: $("#geoBtn") || $("#btnGeo") || $('button[aria-label*="location"]'),
    favBtn: $("#favBtn") || $("#btnFav") || $('button[aria-label*="favourite"]'),
    favSelect: $("#favSelect") || $("#favourites") || $('select[name="favourites"]'),
    coursesStatus: $("#coursesStatus") || $("#courses-status") || $("#coursesText") || $("small"),
    results: $("#results") || $("#searchResults") || $("#suggestions"),
    selectedTitle: $("#selectedTitle") || $("#selected") || $("#selectedPlace") || $("h2"),
    // Tabs
    tabCurrent: $("#tabCurrent") || $("#btnCurrent") || $('button[data-tab="current"]'),
    tabHourly: $("#tabHourly") || $("#btnHourly") || $('button[data-tab="hourly"]'),
    tabDaily: $("#tabDaily") || $("#btnDaily") || $('button[data-tab="daily"]'),
    // Panels
    panelCurrent: $("#panelCurrent") || $("#current") || $("#currentPanel"),
    panelHourly: $("#panelHourly") || $("#hourly") || $("#hourlyPanel"),
    panelDaily: $("#panelDaily") || $("#daily") || $("#dailyPanel"),
    // Forecast anchor / wrapper
    forecastWrap: $("#forecast") || $("#forecastWrap") || $("#forecastSection") || document.body,
    // Playability
    playScore: $("#playScore") || $("#playabilityScore"),
    playWhy: $("#playWhy") || $("#playabilityWhy"),
  };

  // ---------- Supabase REST ----------
  async function supabaseFetch(pathWithQuery) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Supabase config missing");
    }
    const url = `${SUPABASE_URL}${pathWithQuery}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Supabase error ${res.status}: ${txt || res.statusText}`);
    }
    return res.json();
  }

  async function loadCourses() {
    if (!els.coursesStatus) return; // if no status element, still load silently
    setText(els.coursesStatus, "Courses: loading...");
    try {
      const select = encodeURIComponent(`${COLS.name},${COLS.lat},${COLS.lon},${COLS.country}`);
      const data = await supabaseFetch(`/rest/v1/${COURSES_TABLE}?select=${select}&limit=20000`);
      state.courses = Array.isArray(data) ? data : [];
      setText(els.coursesStatus, `Courses: ready ✓ (${state.courses.length})`);
    } catch (e) {
      console.error("Courses load failed", e);
      setText(els.coursesStatus, `Courses: load failed`);
    }
    renderFavSelect();
  }

  // ---------- Weather via worker ----------
  async function fetchWeather(lat, lon) {
    if (!WORKER_BASE_URL) throw new Error("WORKER_BASE_URL missing in config.js");
    const u = new URL(`${WORKER_BASE_URL}/weather`);
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lon", String(lon));
    u.searchParams.set("units", state.units);

    const res = await fetch(u.toString(), { headers: { "Content-Type": "application/json" } });
    const bodyText = await res.text();
    let data = null;
    try { data = JSON.parse(bodyText); } catch { /* ignore */ }

    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || bodyText || res.statusText;
      throw new Error(`Weather error ${res.status}: ${msg}`);
    }
    if (!data) throw new Error("Weather response not JSON");
    return data;
  }

  // ---------- interpretation ----------
  function normaliseWeatherResponse(data) {
    // Supports either:
    //  A) { current: <OW /weather>, forecast: <OW /forecast> }
    //  B) <OW /forecast> (has .list)
    //  C) { current: ..., list: [...] }
    const current = data.current || data.weather || data.current_weather || null;
    const forecast = data.forecast || (data.list ? data : null) || null;
    return { current, forecast };
  }

  function iconUrl(icon) {
    if (!icon) return "";
    return `https://openweathermap.org/img/wn/${icon}@2x.png`;
  }

  function fmtTemp(t) {
    const n = round0(t);
    if (n === null) return "–";
    return state.units === "imperial" ? `${n}°F` : `${n}°C`;
  }

  function fmtWind(ms) {
    if (!Number.isFinite(ms)) return "–";
    // OpenWeather returns m/s (metric) and mph (imperial) when units=imperial.
    const unit = state.units === "imperial" ? "mph" : "m/s";
    return `${ms.toFixed(1)} ${unit}`;
  }

  // Daily buckets from 3-hour list (up to 7 days)
  function buildDailyFrom3h(list) {
    if (!Array.isArray(list)) return [];
    const byDay = new Map();

    for (const it of list) {
      const dt = (it.dt ? it.dt * 1000 : Date.parse(it.dt_txt)) || null;
      if (!dt) continue;
      const d = new Date(dt);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      const entry = byDay.get(key) || { key, items: [] };
      entry.items.push(it);
      byDay.set(key, entry);
    }

    const days = Array.from(byDay.values())
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .slice(0, 7);

    return days.map((d) => {
      // pick midday item if possible
      const midday = d.items.reduce((best, it) => {
        const dt = (it.dt ? it.dt * 1000 : Date.parse(it.dt_txt)) || 0;
        const h = new Date(dt).getUTCHours();
        const score = Math.abs(h - 12); // closer to 12 is better
        const bestDt = (best.dt ? best.dt * 1000 : Date.parse(best.dt_txt)) || 0;
        const bestH = new Date(bestDt).getUTCHours();
        const bestScore = Math.abs(bestH - 12);
        return score < bestScore ? it : best;
      }, d.items[0]);

      const temps = d.items.map((it) => it.main && it.main.temp).filter(Number.isFinite);
      const pops = d.items.map((it) => it.pop).filter(Number.isFinite);

      const tmin = temps.length ? Math.min(...temps) : null;
      const tmax = temps.length ? Math.max(...temps) : null;
      const popMax = pops.length ? Math.max(...pops) : 0;

      const w = (midday.weather && midday.weather[0]) || {};
      return {
        dateKey: d.key,
        icon: w.icon,
        main: w.main,
        desc: w.description,
        tmin,
        tmax,
        pop: popMax,
        wind: midday.wind && midday.wind.speed,
      };
    });
  }

  function buildHourly(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 24).map((it) => {
      const dt = (it.dt ? it.dt * 1000 : Date.parse(it.dt_txt)) || null;
      const d = dt ? new Date(dt) : null;
      const label = d ? `${String(d.getUTCHours()).padStart(2, "0")}:00` : "–";
      const w = (it.weather && it.weather[0]) || {};
      return {
        label,
        icon: w.icon,
        desc: w.description,
        temp: it.main && it.main.temp,
        pop: Number.isFinite(it.pop) ? it.pop : 0,
        wind: it.wind && it.wind.speed,
      };
    });
  }

  // ---------- playability ----------
  function computePlayability(current, daily0) {
    // Simple 0–10 score based on wind + rain chance + temperature comfort
    // (This is intentionally conservative and easy to tweak.)
    let score = 10;

    const wind = Number.isFinite(current?.wind?.speed) ? current.wind.speed : (Number.isFinite(daily0?.wind) ? daily0.wind : null);
    const pop = Number.isFinite(daily0?.pop) ? daily0.pop : null;
    const temp = Number.isFinite(current?.main?.temp) ? current.main.temp : null;

    // Wind penalty
    if (wind !== null) score -= clamp(wind / (state.units === "imperial" ? 6 : 4), 0, 4); // heavier wind = lower

    // Rain penalty
    if (pop !== null) score -= clamp(pop * 5, 0, 5);

    // Temp comfort penalty (very cold/hot)
    if (temp !== null) {
      const cold = state.units === "imperial" ? 45 : 7;
      const hot = state.units === "imperial" ? 86 : 30;
      if (temp < cold) score -= clamp((cold - temp) / 6, 0, 3);
      if (temp > hot) score -= clamp((temp - hot) / 6, 0, 3);
    }

    score = clamp(score, 0, 10);
    return Math.round(score);
  }

  // ---------- render ----------
  function renderFavSelect() {
    if (!els.favSelect) return;
    const favs = Array.isArray(state.favs) ? state.favs : [];
    els.favSelect.innerHTML = "";

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select a favourite…";
    els.favSelect.appendChild(opt0);

    for (const f of favs) {
      if (!f || !f.name || !Number.isFinite(f.lat) || !Number.isFinite(f.lon)) continue;
      const opt = document.createElement("option");
      opt.value = `${f.lat},${f.lon}`;
      opt.textContent = f.name;
      els.favSelect.appendChild(opt);
    }
  }

  function renderSelected() {
    if (!els.selectedTitle) return;
    if (!state.selected) {
      setText(els.selectedTitle, "Selected");
      return;
    }
    setText(els.selectedTitle, state.selected.name || "Selected");
  }

  function renderCurrent(current) {
    if (!els.panelCurrent) return;
    if (!current || !current.weather || !current.weather[0]) {
      setHTML(els.panelCurrent, `<div class="muted">No current data.</div>`);
      return;
    }
    const w = current.weather[0];
    const t = current.main?.temp;
    const feels = current.main?.feels_like;
    const wind = current.wind?.speed;
    const hum = current.main?.humidity;

    setHTML(
      els.panelCurrent,
      `
      <div class="ff-card">
        <div class="ff-row">
          <img alt="" class="ff-icon" src="${iconUrl(w.icon)}" />
          <div>
            <div class="ff-big">${fmtTemp(t)}</div>
            <div class="ff-sub">${w.description || w.main || ""}</div>
          </div>
        </div>
        <div class="ff-grid">
          <div><strong>Feels</strong><br>${fmtTemp(feels)}</div>
          <div><strong>Wind</strong><br>${fmtWind(wind)}</div>
          <div><strong>Humidity</strong><br>${Number.isFinite(hum) ? hum + "%" : "–"}</div>
        </div>
      </div>
      `
    );
  }

  function renderHourly(hours) {
    if (!els.panelHourly) return;
    if (!hours.length) {
      setHTML(els.panelHourly, `<div class="muted">No hourly data.</div>`);
      return;
    }
    setHTML(
      els.panelHourly,
      `
      <div class="ff-card">
        <div class="ff-list">
          ${hours
            .map(
              (h) => `
              <div class="ff-item">
                <div class="ff-time">${h.label}</div>
                <img alt="" class="ff-icon-sm" src="${iconUrl(h.icon)}" />
                <div class="ff-temp">${fmtTemp(h.temp)}</div>
                <div class="ff-meta">${Math.round((h.pop || 0) * 100)}% rain • ${fmtWind(h.wind)}</div>
              </div>
            `
            )
            .join("")}
        </div>
      </div>
      `
    );
  }

  function renderDaily(days) {
    if (!els.panelDaily) return;
    if (!days.length) {
      setHTML(els.panelDaily, `<div class="muted">No daily data.</div>`);
      return;
    }
    setHTML(
      els.panelDaily,
      `
      <div class="ff-card">
        <div class="ff-list">
          ${days
            .map((d) => {
              const date = new Date(d.dateKey + "T00:00:00Z");
              const label = date.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" });
              return `
                <div class="ff-item">
                  <div class="ff-time">${label}</div>
                  <img alt="" class="ff-icon-sm" src="${iconUrl(d.icon)}" />
                  <div class="ff-temp">${fmtTemp(d.tmax)} <span class="muted">/ ${fmtTemp(d.tmin)}</span></div>
                  <div class="ff-meta">${Math.round((d.pop || 0) * 100)}% rain • ${fmtWind(d.wind)}</div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
      `
    );
  }

  function applyTab(tab) {
    state.activeTab = tab;

    // show/hide if panels exist
    const show = (el, on) => { if (el) el.style.display = on ? "" : "none"; };

    show(els.panelCurrent, tab === "current");
    show(els.panelHourly, tab === "hourly");
    show(els.panelDaily, tab === "daily");

    scrollToEl(els.forecastWrap);
  }

  function renderPlayability(current, daily0) {
    const score = computePlayability(current, daily0);

    if (els.playScore) setText(els.playScore, `${score}/10`);
    if (els.playWhy) {
      setHTML(
        els.playWhy,
        `
        <ul>
          <li><strong>Wind:</strong> stronger gusts reduce control and comfort.</li>
          <li><strong>Rain probability:</strong> higher chance = higher disruption.</li>
          <li><strong>Temperature comfort:</strong> very cold/very hot reduces enjoyment.</li>
        </ul>
        `
      );
    }
  }

  // ---------- search ----------
  function findCourseByName(q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return null;
    // exact-ish match first
    const exact = state.courses.find((c) => String(c[COLS.name] || "").toLowerCase() === needle);
    if (exact) return exact;
    // contains match
    return state.courses.find((c) => String(c[COLS.name] || "").toLowerCase().includes(needle)) || null;
  }

  async function geocodePlace(q) {
    // very lightweight geocode via OpenStreetMap Nominatim (no key)
    // If it fails, we simply return null.
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", q);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data[0]) return null;
    return {
      name: data[0].display_name,
      lat: Number(data[0].lat),
      lon: Number(data[0].lon),
    };
  }

  async function runSearch(q) {
    const query = (q || "").trim();
    if (!query) return;

    // heuristic: if query includes golf/club/gc -> prefer course match
    const courseFirst = /golf|club|gc/i.test(query);

    let selection = null;

    if (courseFirst) {
      const c = findCourseByName(query);
      if (c) {
        selection = {
          type: "course",
          name: c[COLS.name],
          lat: Number(c[COLS.lat]),
          lon: Number(c[COLS.lon]),
          country: c[COLS.country],
        };
      }
    }

    if (!selection) {
      // try place geocode
      const p = await geocodePlace(query).catch(() => null);
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        selection = { type: "place", name: p.name, lat: p.lat, lon: p.lon };
      } else {
        // fallback to course match
        const c = findCourseByName(query);
        if (c) {
          selection = {
            type: "course",
            name: c[COLS.name],
            lat: Number(c[COLS.lat]),
            lon: Number(c[COLS.lon]),
            country: c[COLS.country],
          };
        }
      }
    }

    if (!selection) {
      console.warn("No results for", query);
      return;
    }

    state.selected = selection;
    renderSelected();

    // fetch weather and render
    try {
      const raw = await fetchWeather(selection.lat, selection.lon);
      const { current, forecast } = normaliseWeatherResponse(raw);
      state.lastWeather = { current, forecast };

      const list = forecast?.list || [];
      const hourly = buildHourly(list);
      const daily = buildDailyFrom3h(list);

      renderCurrent(current);
      renderHourly(hourly);
      renderDaily(daily);

      renderPlayability(current, daily[0] || null);

      // default tab
      applyTab(state.activeTab || "daily");
    } catch (e) {
      console.error(e);
      // render error in whichever panel exists
      const msg = String(e.message || e);
      const html = `<div class="ff-card"><strong>Weather error</strong><div class="muted">${msg}</div></div>`;
      if (els.panelDaily) setHTML(els.panelDaily, html);
      if (els.panelHourly) setHTML(els.panelHourly, html);
      if (els.panelCurrent) setHTML(els.panelCurrent, html);
      applyTab(state.activeTab || "daily");
    }
  }

  // ---------- favourites ----------
  function isFav(selection) {
    if (!selection) return false;
    return state.favs.some((f) => f && f.name === selection.name && f.lat === selection.lat && f.lon === selection.lon);
  }

  function toggleFav() {
    const s = state.selected;
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return;

    if (!Array.isArray(state.favs)) state.favs = [];

    if (isFav(s)) {
      state.favs = state.favs.filter((f) => !(f && f.name === s.name && f.lat === s.lat && f.lon === s.lon));
    } else {
      state.favs.unshift({ name: s.name, lat: s.lat, lon: s.lon });
      state.favs = state.favs.slice(0, 50);
    }
    saveFavs();
    renderFavSelect();
  }

  // ---------- init ----------
  function bindUI() {
    // units
    if (els.units) {
      try { els.units.value = state.units === "imperial" ? "imperial" : "metric"; } catch {}
      els.units.addEventListener("change", () => {
        const v = els.units.value;
        state.units = v === "imperial" ? "imperial" : "metric";
        saveUnits();
        // re-render if we already have a selection
        if (state.selected) runSearch(state.selected.name);
      });
    }

    // search
    const doSearch = () => runSearch(els.query ? els.query.value : "").catch(console.error);

    if (els.searchBtn) {
      el
