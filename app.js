/* app.js — Fairway Forecast (GitHub Pages friendly)
   Option A FIX:
   - REMOVE OpenWeather One Call 3.0 (paid) usage completely
   - Use ONLY /data/2.5/weather + /data/2.5/forecast (free tier friendly)
   - Build "daily" (up to 5 days) by aggregating 3-hour blocks
   - Fix tabs (active state + localStorage + smooth scroll)
   - Fix favourites null/iterable bugs
   - Reduce console spam: fail once, show user message, stop cascading

   Requires: config.js setting window.APP_CONFIG:
   {
     OPENWEATHER_KEY: "...",
     SUPABASE_URL: "...",
     SUPABASE_ANON_KEY: "...",
     COURSES_TABLE: "uk_golf_courses",
     COURSE_COLS: { name:"name", lat:"latitude", lon:"longitude", country:"country", website:"website" }
   }
*/

(() => {
  'use strict';

  // ---------- Config ----------
  const CFG = (window.APP_CONFIG || {});
  const OPENWEATHER_KEY = CFG.OPENWEATHER_KEY || '';
  const SUPABASE_URL = CFG.SUPABASE_URL || '';
  const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY || '';
  const COURSES_TABLE = CFG.COURSES_TABLE || 'uk_golf_courses';
  const COURSE_COLS = CFG.COURSE_COLS || {
    name: 'name',
    lat: 'latitude',
    lon: 'longitude',
    country: 'country',
    website: 'website'
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);

  const el = {
    // controls
    txtSearch: $('txtSearch'),
    btnSearch: $('btnSearch'),
    btnGeo: $('btnGeo'),
    btnFav: $('btnFav'),
    ddlFavs: $('ddlFavs'),
    ddlUnits: $('ddlUnits'),
    coursesStatus: $('coursesStatus'),
    appStatus: $('appStatus'),
    suggestions: $('searchSuggestions'),

    // hero
    h1Title: $('h1Title'),
    subTitle: $('subTitle'),
    imgIcon: $('imgIcon'),
    currTemp: $('currTemp'),
    feelsLike: $('feelsLike'),
    humidity: $('humidity'),
    wind: $('wind'),
    windDir: $('windDir'),
    sunrise: $('sunrise'),
    sunset: $('sunset'),
    dayLength: $('dayLength'),

    // playability
    playScoreWhole: $('playScoreWhole'),
    playBand: $('playBand'),
    playMeta: $('playMeta'),
    playHero: $('playHero'),
    btnPlayInfo: $('btnPlayInfo'),
    btnPlayClose: $('btnPlayClose'),
    playPopover: $('playPopover'),

    // tee time
    teeSunrise: $('teeSunrise'),
    teeSunset: $('teeSunset'),
    bestTeeTime: $('bestTeeTime'),
    bestTeeScore: $('bestTeeScore'),
    teeMsg: $('teeMsg'),

    // panels
    forecast: $('forecast'),
    ddlDay: $('ddlDay'),
    hourlyForecast: $('hourlyForecast'),
    dailyForecast: $('dailyForecast'),

    // nowcast
    rainMessage: $('rainMessage'),
    rainTimeline: $('rainTimeline'),

    // toast
    toast: $('toast')
  };

  // tabs / panels
  const tabButtons = Array.from(document.querySelectorAll('.tab[data-tab]'));
  const panels = Array.from(document.querySelectorAll('.panel[data-panel]'));

  // ---------- State ----------
  const LS = {
    units: 'ff_units',
    favs: 'ff_favs',
    selection: 'ff_selection',
    tab: 'ff_tab'
  };

  const state = {
    units: 'C',
    courses: [], // [{id,label,lat,lon,country,website}]
    favs: [],    // [{id,label,lat,lon,type}]
    selection: null, // {type:'place'|'course', label, lat, lon, meta?}
    weather: {
      current: null,     // /weather
      forecast: null     // /forecast
    },
    map: {
      map: null,
      marker: null
    }
  };

  // ---------- Utils ----------
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = (n) => Math.round(Number(n) || 0);

  function safeJSONParse(raw, fallback) {
    try { return JSON.parse(raw); } catch { return fallback; }
  }

  function loadLS() {
    state.units = localStorage.getItem(LS.units) || 'C';
    state.favs = safeJSONParse(localStorage.getItem(LS.favs) || '[]', []);
    state.selection = safeJSONParse(localStorage.getItem(LS.selection) || 'null', null);
  }

  function saveLS() {
    localStorage.setItem(LS.units, state.units);
    localStorage.setItem(LS.favs, JSON.stringify(state.favs || []));
    localStorage.setItem(LS.selection, JSON.stringify(state.selection || null));
  }

  function showStatus(msg) {
    if (el.appStatus) el.appStatus.textContent = msg || '';
  }

  function showToast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.classList.remove('is-hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.toast.classList.add('is-hidden'), 2200);
  }

  function setPressedStar(isFav) {
    if (!el.btnFav) return;
    el.btnFav.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    el.btnFav.textContent = isFav ? '★' : '☆';
  }

  function formatTime(tsSec, tzOffsetSec) {
    // OpenWeather provides sunrise/sunset in UTC seconds, plus timezone offset seconds
    const d = new Date((tsSec + tzOffsetSec) * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatDayName(dateObj) {
    return dateObj.toLocaleDateString([], { weekday: 'long' });
  }

  function fmtTemp(t) {
    if (t === null || t === undefined || Number.isNaN(Number(t))) return '--';
    return Math.round(Number(t));
  }

  function windDirFromDeg(deg) {
    if (deg === null || deg === undefined || Number.isNaN(Number(deg))) return '';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(((Number(deg) % 360) / 45)) % 8;
    return dirs[idx];
  }

  function unitsToOW(units) {
    // OpenWeather expects "metric" or "imperial"
    return units === 'F' ? 'imperial' : 'metric';
  }

  // ---------- Map ----------
  function initMap() {
    if (!window.L || !document.getElementById('map')) return;
    if (state.map.map) return;

    state.map.map = L.map('map', { zoomControl: false }).setView([51.5, -0.1], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 18
    }).addTo(state.map.map);
  }

  function setMapMarker(lat, lon, label) {
    if (!state.map.map) return;
    const pos = [lat, lon];
    if (!state.map.marker) {
      state.map.marker = L.marker(pos).addTo(state.map.map);
    } else {
      state.map.marker.setLatLng(pos);
    }
    state.map.marker.bindPopup(label || '').openPopup();
    state.map.map.setView(pos, 10, { animate: false });
  }

  // ---------- Supabase courses ----------
  async function loadCoursesFromSupabase() {
    // If supabase not configured, skip silently (app still works with place search)
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase) {
      if (el.coursesStatus) el.coursesStatus.textContent = 'Courses: disabled (no Supabase config)';
      return;
    }

    const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Keep payload small: only columns we need
    const cols = [
      COURSE_COLS.name,
      COURSE_COLS.lat,
      COURSE_COLS.lon,
      COURSE_COLS.country,
      COURSE_COLS.website
    ].join(',');

    try {
      showStatus('Loading courses…');
      const { data, error } = await sb
        .from(COURSES_TABLE)
        .select(cols)
        .limit(50000); // your UK table might be big; this is client-side. You may later add server-side search.

      if (error) throw error;

      state.courses = (data || [])
        .map((r, idx) => {
          const name = r[COURSE_COLS.name];
          const lat = Number(r[COURSE_COLS.lat]);
          const lon = Number(r[COURSE_COLS.lon]);
          const country = r[COURSE_COLS.country] || '';
          const website = r[COURSE_COLS.website] || '';
          if (!name || Number.isNaN(lat) || Number.isNaN(lon)) return null;
          const label = country ? `${name} (${country})` : name;
          return { id: `${idx}:${name}`, label, name, lat, lon, country, website };
        })
        .filter(Boolean);

      if (el.coursesStatus) el.coursesStatus.textContent = `Courses: ready ✓ (${state.courses.length})`;
      showStatus('');
    } catch (e) {
      console.warn('Supabase courses load failed:', e);
      if (el.coursesStatus) el.coursesStatus.textContent = 'Courses: failed (check RLS / anon key)';
      showStatus('Courses unavailable');
    }
  }

  // ---------- Suggestions (place + course) ----------
  function hideSuggestions() {
    if (!el.suggestions) return;
    el.suggestions.classList.add('is-hidden');
    el.suggestions.innerHTML = '';
  }

  function showSuggestions(items) {
    if (!el.suggestions) return;
    if (!items || items.length === 0) return hideSuggestions();

    el.suggestions.classList.remove('is-hidden');
    el.suggestions.innerHTML = '';

    for (const it of items.slice(0, 10)) {
      const div = document.createElement('div');
      div.className = 'suggestion';
      div.setAttribute('role', 'option');
      div.textContent = it.label;
      div.addEventListener('click', () => {
        hideSuggestions();
        applySelection(it);
      });
      el.suggestions.appendChild(div);
    }
  }

  function buildSuggestions(q) {
    const query = (q || '').trim().toLowerCase();
    if (!query || query.length < 2) return [];

    const out = [];

    // Courses: match contains
    if (state.courses && state.courses.length) {
      const matches = state.courses
        .filter(c => c.label.toLowerCase().includes(query))
        .slice(0, 8)
        .map(c => ({
          type: 'course',
          label: c.label,
          lat: c.lat,
          lon: c.lon,
          meta: { website: c.website }
        }));
      out.push(...matches);
    }

    // Places: lightweight heuristic — allow user to type "Town, CC"
    // We'll resolve places only on Search via OpenWeather geocoding, not in suggestions.
    // But we can provide a "search place" entry so it doesn't always feel like courses.
    out.unshift({
      type: 'place',
      label: `Search place: "${q}"`,
      lat: null,
      lon: null,
      meta: { query: q }
    });

    return out;
  }

  // ---------- Selection ----------
  async function applySelection(sel) {
    // sel can be:
    // - course: {type, label, lat, lon}
    // - place quick action: {type:'place', meta:{query}}
    if (!sel) return;

    if (sel.type === 'place' && (sel.lat == null || sel.lon == null)) {
      // resolve place via geocoding using query string
      const q = sel.meta?.query || el.txtSearch.value;
      const resolved = await geocodePlace(q);
      if (!resolved) return;
      state.selection = resolved;
    } else {
      state.selection = {
        type: sel.type || 'course',
        label: sel.label,
        lat: Number(sel.lat),
        lon: Number(sel.lon),
        meta: sel.meta || {}
      };
    }

    saveLS();
    renderFavStar();
    await refreshWeatherAndRender();
  }

  function renderFavStar() {
    const sel = state.selection;
    if (!sel) return setPressedStar(false);

    const id = favIdForSelection(sel);
    const isFav = (state.favs || []).some(f => f.id === id);
    setPressedStar(isFav);
  }

  function favIdForSelection(sel) {
    const t = sel.type || 'place';
    const key = `${t}:${sel.label}:${sel.lat},${sel.lon}`;
    return key;
  }

  function renderFavDropdown() {
    const favs = Array.isArray(state.favs) ? state.favs : [];
    const ddl = el.ddlFavs;
    if (!ddl) return;

    ddl.innerHTML = '<option value="">Select a favourite…</option>';
    for (const f of favs) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      ddl.appendChild(opt);
    }
  }

  function addOrRemoveFavourite() {
    const sel = state.selection;
    if (!sel) return;

    const favs = Array.isArray(state.favs) ? state.favs : [];
    const id = favIdForSelection(sel);
    const idx = favs.findIndex(f => f.id === id);

    if (idx >= 0) {
      favs.splice(idx, 1);
      state.favs = favs;
      saveLS();
      renderFavDropdown();
      renderFavStar();
      showToast('Removed from favourites');
      return;
    }

    favs.unshift({
      id,
      type: sel.type,
      label: sel.label,
      lat: sel.lat,
      lon: sel.lon
    });
    state.favs = favs;
    saveLS();
    renderFavDropdown();
    renderFavStar();
    showToast('Added to favourites');
  }

  // ---------- OpenWeather: place geocoding ----------
  async function geocodePlace(query) {
    const q = (query || '').trim();
    if (!q) return null;

    if (!OPENWEATHER_KEY) {
      showStatus('Missing OPENWEATHER_KEY in config.js');
      showToast('OpenWeather key missing');
      return null;
    }

    // OpenWeather geocoding: direct
    const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${encodeURIComponent(OPENWEATHER_KEY)}`;

    try {
      showStatus('Searching place…');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Geocode failed: ${res.status}`);
      const data = await res.json();
      const top = (data && data[0]) ? data[0] : null;
      if (!top) {
        showStatus('');
        showToast('No place found');
        return null;
      }
      const label = [top.name, top.state, top.country].filter(Boolean).join(', ');
      showStatus('');
      return {
        type: 'place',
        label,
        lat: Number(top.lat),
        lon: Number(top.lon),
        meta: {}
      };
    } catch (e) {
      console.warn(e);
      showStatus('');
      showToast('Place search failed');
      return null;
    }
  }

  // ---------- OpenWeather: current + forecast (FREE) ----------
  async function fetchCurrent(lat, lon) {
    const units = unitsToOW(state.units);
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${units}&appid=${encodeURIComponent(OPENWEATHER_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Current weather error ${res.status}`);
    return res.json();
  }

  async function fetchForecast(lat, lon) {
    const units = unitsToOW(state.units);
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${encodeURIComponent(OPENWEATHER_KEY)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Forecast error ${res.status}`);
    return res.json();
  }

  async function refreshWeatherAndRender() {
    const sel = state.selection;
    if (!sel || sel.lat == null || sel.lon == null) return;

    if (!OPENWEATHER_KEY) {
      showStatus('Missing OPENWEATHER_KEY in config.js');
      showToast('OpenWeather key missing');
      return;
    }

    showStatus('Loading weather…');
    try {
      const [curr, fc] = await Promise.all([
        fetchCurrent(sel.lat, sel.lon),
        fetchForecast(sel.lat, sel.lon)
      ]);
      state.weather.current = curr;
      state.weather.forecast = fc;

      showStatus('');
      renderAll();
      initMap();
      setMapMarker(sel.lat, sel.lon, sel.label);

      // After fresh data, ensure active tab panel visible
      applyTab(getActiveTab(), { scroll: true });
    } catch (e) {
      console.error(e);
      showStatus('Weather unavailable (check API key / limits)');
      showToast('Weather error — see status');
      // Render minimal header still
      renderSelectionOnly();
    }
  }

  // ---------- Rendering ----------
  function renderSelectionOnly() {
    const sel = state.selection;
    if (!sel) return;
    el.h1Title.textContent = sel.label || '—';
    el.subTitle.textContent = sel.type === 'course' ? 'Golf course' : 'Location';
  }

  function renderAll() {
    const sel = state.selection;
    const curr = state.weather.current;
    const fc = state.weather.forecast;

    // Title
    el.h1Title.textContent = sel?.label || '—';
    el.subTitle.textContent = sel?.type === 'course' ? 'Golf course' : 'Location';

    if (!curr) return;

    // Icon + temp
    const icon = curr.weather?.[0]?.icon || '';
    if (icon && el.imgIcon) {
      el.imgIcon.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
    }
    el.currTemp.textContent = fmtTemp(curr.main?.temp);
    el.feelsLike.textContent = fmtTemp(curr.main?.feels_like);
    el.humidity.textContent = Math.round(curr.main?.humidity ?? 0);
    el.wind.textContent = `${Math.round(curr.wind?.speed ?? 0)} ${state.units === 'F' ? 'mph' : 'm/s'}`;
    el.windDir.textContent = windDirFromDeg(curr.wind?.deg);

    // Sunrise / Sunset
    const tz = curr.timezone ?? 0;
    const sunrise = curr.sys?.sunrise;
    const sunset = curr.sys?.sunset;

    if (sunrise && sunset) {
      const sr = formatTime(sunrise, tz);
      const ss = formatTime(sunset, tz);
      el.sunrise.textContent = sr;
      el.sunset.textContent = ss;
      el.teeSunrise.textContent = sr;
      el.teeSunset.textContent = ss;

      const dayLenMin = Math.round((sunset - sunrise) / 60);
      const h = Math.floor(dayLenMin / 60);
      const m = dayLenMin % 60;
      el.dayLength.textContent = `Day length: ${h}h ${m}m`;
    } else {
      el.sunrise.textContent = '--';
      el.sunset.textContent = '--';
      el.teeSunrise.textContent = '--';
      el.teeSunset.textContent = '--';
      el.dayLength.textContent = 'Day length: —';
    }

    // Forecast-derived sections
    if (fc && Array.isArray(fc.list)) {
      renderHourly(fc, curr);
      renderDaily(fc);
      renderRainTimeline(fc);
      renderBestTeeTime(fc, curr);
      renderPlayability(fc, curr);
    }
  }

  // ---------- Playability (0-10) ----------
  function playabilityBand(n) {
    if (n >= 8) return { label: 'Excellent', tone: 'good' };
    if (n >= 6) return { label: 'Good', tone: 'ok' };
    if (n >= 4) return { label: 'Marginal', tone: 'warn' };
    return { label: 'Poor', tone: 'bad' };
  }

  function setPlayabilityTone(tone) {
    if (!el.playHero) return;
    el.playHero.classList.remove('tone-good', 'tone-ok', 'tone-warn', 'tone-bad');
    el.playHero.classList.add(`tone-${tone}`);
  }

  function computePlayabilityScore(curr, fc) {
    // Simple golf-friendly scoring using:
    // - wind speed (lower better)
    // - rain probability (lower better)
    // - feels-like temp comfort (closer to ~18C/65F better)
    // - recent rain signal (via pop / rain presence)
    const unitsMetric = (state.units !== 'F');

    const wind = Number(curr.wind?.speed ?? 0);
    const feels = Number(curr.main?.feels_like ?? curr.main?.temp ?? 0);

    // Use next few forecast blocks for rain probability
    const next = fc.list.slice(0, 4);
    const popAvg = next.reduce((a, x) => a + (Number(x.pop ?? 0)), 0) / Math.max(1, next.length);

    // Wind penalty (metric m/s or imperial mph)
    // target: <=3 good, 6 moderate, 10 bad
    const windMps = unitsMetric ? wind : (wind * 0.44704); // mph to m/s
    const windPenalty = clamp((windMps - 2.5) / 1.5, 0, 5); // 0..5

    // Rain penalty (0..4)
    const rainPenalty = clamp(popAvg * 4.5, 0, 4.5);

    // Temp penalty: comfort around 18C (or 65F)
    const comfort = unitsMetric ? 18 : 65;
    const tempDelta = Math.abs(feels - comfort);
    const tempPenalty = clamp(tempDelta / (unitsMetric ? 8 : 14), 0, 3); // 0..3

    // Ground penalty: if pop high in next 12h, nudge down
    const groundPenalty = popAvg > 0.5 ? 1 : (popAvg > 0.25 ? 0.5 : 0);

    // Base 10 minus penalties
    const raw = 10 - (windPenalty + rainPenalty + tempPenalty + groundPenalty);
    return clamp(raw, 0, 10);
  }

  function renderPlayability(fc, curr) {
    const raw = computePlayabilityScore(curr, fc);
    const whole = clamp(round(raw), 0, 10);

    el.playScoreWhole.textContent = String(whole);

    const band = playabilityBand(whole);
    el.playBand.textContent = band.label;
    setPlayabilityTone(band.tone);

    // Helpful one-line meta
    const nextPop = Math.round(((fc.list?.[0]?.pop ?? 0) * 100));
    const windText = `${Math.round(curr.wind?.speed ?? 0)} ${state.units === 'F' ? 'mph' : 'm/s'}`;
    el.playMeta.textContent = `Wind ${windText} • Rain ${nextPop}% • Temp ${fmtTemp(curr.main?.temp)}°`;
  }

  // ---------- Best Tee Time (daylight-only) ----------
  function renderBestTeeTime(fc, curr) {
    const list = Array.isArray(fc.list) ? fc.list : [];
    const sunrise = curr.sys?.sunrise;
    const sunset = curr.sys?.sunset;
    const tz = curr.timezone ?? 0;

    if (!sunrise || !sunset || list.length === 0) {
      el.bestTeeTime.textContent = '—';
      el.bestTeeScore.textContent = '';
      el.teeMsg.textContent = 'No tee-time available.';
      return;
    }

    // Candidate slots strictly within daylight (UTC seconds)
    // fc.list dt is UTC seconds
    const daylight = list.filter(x => {
      const t = Number(x.dt);
      return t > sunrise && t < sunset;
    });

    if (daylight.length === 0) {
      el.bestTeeTime.textContent = '—';
      el.bestTeeScore.textContent = '';
      el.teeMsg.textContent = 'No daylight tee times available.';
      return;
    }

    // Score each slot (higher better): lower wind + lower pop
    const scored = daylight.map(x => {
      const pop = Number(x.pop ?? 0);
      const wind = Number(x.wind?.speed ?? 0);
      const temp = Number(x.main?.temp ?? 0);

      // normalized
      const windPenalty = clamp(wind / (state.units === 'F' ? 20 : 12), 0, 1);
      const rainPenalty = clamp(pop, 0, 1);
      const tempComfort = (state.units === 'F') ? 65 : 18;
      const tempPenalty = clamp(Math.abs(temp - tempComfort) / (state.units === 'F' ? 25 : 14), 0, 1);

      const score = 1.0 - (0.45 * windPenalty + 0.45 * rainPenalty + 0.10 * tempPenalty);
      return { x, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // If conditions poor throughout daylight, message
    const bestScore = best.score;
    if (bestScore < 0.35) {
      el.bestTeeTime.textContent = '—';
      el.bestTeeScore.textContent = '';
      el.teeMsg.textContent = 'No good tee time today — conditions poor throughout daylight hours.';
      return;
    }

    const timeLocal = formatTime(best.x.dt, tz);
    el.bestTeeTime.textContent = timeLocal;

    const popPct = Math.round((best.x.pop ?? 0) * 100);
    const windTxt = `${Math.round(best.x.wind?.speed ?? 0)} ${state.units === 'F' ? 'mph' : 'm/s'}`;
    el.bestTeeScore.textContent = `Rain ${popPct}% • Wind ${windTxt}`;
    el.teeMsg.textContent = 'Within daylight hours.';
  }

  // ---------- Hourly (3-hour blocks) ----------
  function renderHourly(fc, curr) {
    const list = Array.isArray(fc.list) ? fc.list : [];
    const tz = fc.city?.timezone ?? curr.timezone ?? 0;

    // Build day options from list
    const days = new Map(); // key YYYY-MM-DD => {label, items}
    for (const item of list) {
      const d = new Date((item.dt + tz) * 1000);
      const key = d.toISOString().slice(0, 10);
      if (!days.has(key)) days.set(key, { key, date: d, items: [] });
      days.get(key).items.push(item);
    }

    const dayArr = Array.from(days.values()).slice(0, 5);

    // Populate ddlDay
    if (el.ddlDay) {
      el.ddlDay.innerHTML = '';
      for (const d of dayArr) {
        const opt = document.createElement('option');
        opt.value = d.key;
        opt.textContent = `${formatDayName(d.date)} (${d.key})`;
        el.ddlDay.appendChild(opt);
      }
    }

    const selectedKey = el.ddlDay?.value || dayArr[0]?.key;
    const selectedDay = dayArr.find(d => d.key === selectedKey) || dayArr[0];

    // Render blocks
    el.hourlyForecast.innerHTML = '';
    if (!selectedDay) return;

    for (const item of selectedDay.items) {
      const d = new Date((item.dt + tz) * 1000);
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const icon = item.weather?.[0]?.icon || '';
      const temp = fmtTemp(item.main?.temp);
      const pop = Math.round((item.pop ?? 0) * 100);
      const wind = Math.round(item.wind?.speed ?? 0);

      const card = document.createElement('div');
      card.className = 'hourCard';
      card.innerHTML = `
        <div class="hourCard__t">${time}</div>
        <div class="hourCard__mid">
          ${icon ? `<img class="wxIcon" alt="" src="https://openweathermap.org/img/wn/${icon}.png" />` : ''}
          <div class="hourCard__temp">${temp}°</div>
        </div>
        <div class="hourCard__meta">
          <span>💧 ${pop}%</span>
          <span>🌬 ${wind} ${state.units === 'F' ? 'mph' : 'm/s'}</span>
        </div>
      `;
      el.hourlyForecast.appendChild(card);
    }
  }

  // Handle day dropdown change
  function onDayChange() {
    const fc = state.weather.forecast;
    const curr = state.weather.current;
    if (!fc || !curr) return;
    renderHourly(fc, curr);
  }

  // ---------- Daily (derived from 3h blocks; up to 5 days) ----------
  function renderDaily(fc) {
    const list = Array.isArray(fc.list) ? fc.list : [];
    const tz = fc.city?.timezone ?? 0;

    // Aggregate by local day
    const days = new Map(); // key => agg
    for (const item of list) {
      const d = new Date((item.dt + tz) * 1000);
      const key = d.toISOString().slice(0, 10);
      if (!days.has(key)) {
        days.set(key, {
          key,
          date: d,
          tMin: Infinity,
          tMax: -Infinity,
          popMax: 0,
          windAvgSum: 0,
          windAvgN: 0,
          icon: null
        });
      }
      const agg = days.get(key);
      const t = Number(item.main?.temp ?? NaN);
      if (!Number.isNaN(t)) {
        agg.tMin = Math.min(agg.tMin, t);
        agg.tMax = Math.max(agg.tMax, t);
      }
      agg.popMax = Math.max(agg.popMax, Number(item.pop ?? 0));
      const w = Number(item.wind?.speed ?? 0);
      agg.windAvgSum += w;
      agg.windAvgN += 1;

      // choose icon around midday if possible
      const hour = d.getHours();
      if (!agg.icon || (hour >= 11 && hour <= 14)) {
        agg.icon = item.weather?.[0]?.icon || agg.icon;
      }
    }

    const dayArr = Array.from(days.values()).slice(0, 5);

    el.dailyForecast.innerHTML = '';
    if (dayArr.length === 0) return;

    for (const d of dayArr) {
      const dayName = formatDayName(d.date);
      const hi = fmtTemp(d.tMax);
      const lo = fmtTemp(d.tMin);
      const pop = Math.round(d.popMax * 100);
      const wind = Math.round(d.windAvgSum / Math.max(1, d.windAvgN));

      const card = document.createElement('div');
      card.className = 'dayCard';
      card.innerHTML = `
        <div class="dayCard__left">
          <div class="dayCard__day">${dayName}</div>
          <div class="dayCard__meta">💧 ${pop}% • 🌬 ${wind} ${state.units === 'F' ? 'mph' : 'm/s'}</div>
        </div>
        <div class="dayCard__right">
          ${d.icon ? `<img class="wxIcon" alt="" src="https://openweathermap.org/img/wn/${d.icon}.png" />` : ''}
          <div class="dayCard__temps">
            <span class="hi">${hi}°</span>
            <span class="lo">${lo}°</span>
          </div>
        </div>
      `;
      el.dailyForecast.appendChild(card);
    }
  }

  // ---------- Rain timeline (simple next 8 blocks) ----------
  function renderRainTimeline(fc) {
    const list = Array.isArray(fc.list) ? fc.list : [];
    const tz = fc.city?.timezone ?? 0;

    const items = list.slice(0, 8);
    el.rainTimeline.innerHTML = '';

    if (items.length === 0) {
      el.rainMessage.textContent = '—';
      return;
    }

    // message: find first block with pop >= 30%
    const idx = items.findIndex(x => (Number(x.pop ?? 0) >= 0.3));
    if (idx === -1) {
      el.rainMessage.textContent = 'No rain expected soon';
    } else {
      const mins = idx * 180; // 3h blocks
      el.rainMessage.textContent = `Rain possible in ~${mins} minutes`;
    }

    for (const it of items) {
      const d = new Date((it.dt + tz) * 1000);
      const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const pop = Math.round((it.pop ?? 0) * 100);

      const block = document.createElement('div');
      block.className = 'rainBlock';
      block.innerHTML = `
        <div class="rainBlock__t">${time}</div>
        <div class="rainBlock__bar"><span style="width:${pop}%"></span></div>
        <div class="rainBlock__p">${pop}%</div>
      `;
      el.rainTimeline.appendChild(block);
    }
  }

  // ---------- Tabs ----------
  function getActiveTab() {
    return localStorage.getItem(LS.tab) || 'current';
  }

  function setActiveTab(tab) {
    localStorage.setItem(LS.tab, tab);
  }

  function applyTab(tab, opts = {}) {
    const t = tab || 'current';
    // buttons
    for (const b of tabButtons) {
      const is = b.dataset.tab === t;
      b.classList.toggle('is-active', is);
      b.setAttribute('aria-selected', is ? 'true' : 'false');
    }
    // panels
    for (const p of panels) {
      const is = p.dataset.panel === t;
      p.classList.toggle('is-active', is);
    }
    setActiveTab(t);

    if (opts.scroll) {
      // Smooth scroll to forecast section on mobile / small screens
      if (el.forecast) {
        el.forecast.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  // ---------- Playability popover ----------
  function openPlayInfo() {
    if (!el.playPopover) return;
    el.playPopover.classList.remove('is-hidden');
    el.playPopover.setAttribute('aria-hidden', 'false');
    el.btnPlayInfo?.setAttribute('aria-expanded', 'true');
  }
  function closePlayInfo() {
    if (!el.playPopover) return;
    el.playPopover.classList.add('is-hidden');
    el.playPopover.setAttribute('aria-hidden', 'true');
    el.btnPlayInfo?.setAttribute('aria-expanded', 'false');
  }

  // ---------- Events ----------
  function wireEvents() {
    // suggestions
    el.txtSearch?.addEventListener('input', () => {
      const q = el.txtSearch.value || '';
      if (q.trim().length < 2) return hideSuggestions();
      const items = buildSuggestions(q);
      showSuggestions(items);
    });

    el.txtSearch?.addEventListener('blur', () => {
      // slight delay so click can register
      setTimeout(hideSuggestions, 150);
    });

    el.btnSearch?.addEventListener('click', async () => {
      hideSuggestions();
      const q = el.txtSearch.value || '';
      // if exact course match begins with "Course ..." problem: we resolve by
      // letting user search place directly unless they click a course suggestion.
      // So Search button does PLACE geocode by default.
      const resolved = await geocodePlace(q);
      if (resolved) {
        state.selection = resolved;
        saveLS();
        renderFavStar();
        await refreshWeatherAndRender();
      }
    });

    el.btnGeo?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        showToast('Geolocation not supported');
        return;
      }
      showStatus('Getting location…');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        showStatus('');
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        state.selection = { type: 'place', label: 'My location', lat, lon, meta: {} };
        saveLS();
        renderFavStar();
        await refreshWeatherAndRender();
      }, (err) => {
        console.warn(err);
        showStatus('');
        showToast('Location denied');
      }, { enableHighAccuracy: false, timeout: 8000 });
    });

    el.ddlUnits?.addEventListener('change', async () => {
      state.units = el.ddlUnits.value;
      saveLS();
      await refreshWeatherAndRender();
    });

    el.btnFav?.addEventListener('click', () => addOrRemoveFavourite());

    el.ddlFavs?.addEventListener('change', async () => {
      const id = el.ddlFavs.value;
      if (!id) return;
      const fav = (Array.isArray(state.favs) ? state.favs : []).find(f => f.id === id);
      if (!fav) return;
      state.selection = { type: fav.type, label: fav.label, lat: fav.lat, lon: fav.lon, meta: {} };
      saveLS();
      renderFavStar();
      await refreshWeatherAndRender();
    });

    // Tabs
    for (const b of tabButtons) {
      b.addEventListener('click', () => applyTab(b.dataset.tab, { scroll: true }));
    }

    // Day selector
    el.ddlDay?.addEventListener('change', onDayChange);

    // play info
    el.btnPlayInfo?.addEventListener('click', () => {
      const isOpen = !el.playPopover.classList.contains('is-hidden');
      if (isOpen) closePlayInfo(); else openPlayInfo();
    });
    el.btnPlayClose?.addEventListener('click', closePlayInfo);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePlayInfo();
    });

    // click outside popover closes
    document.addEventListener('click', (e) => {
      if (!el.playPopover || el.playPopover.classList.contains('is-hidden')) return;
      const within = el.playPopover.contains(e.target) || el.btnPlayInfo.contains(e.target);
      if (!within) closePlayInfo();
    });
  }

  // ---------- Boot ----------
  async function init() {
    loadLS();

    // apply saved units to UI
    if (el.ddlUnits) el.ddlUnits.value = state.units;

    // render favourites
    renderFavDropdown();

    // wire
    wireEvents();

    // init map early (tile loads)
    initMap();

    // load courses async
    loadCoursesFromSupabase().then(() => {
      // courses loaded affects suggestion ordering only
    });

    // restore tab
    applyTab(getActiveTab(), { scroll: false });

    // restore selection
    if (state.selection) {
      el.txtSearch.value = state.selection.label || '';
      renderFavStar();
      await refreshWeatherAndRender();
      return;
    }

    // default selection: Swindon, GB (safe)
    const fallback = await geocodePlace('Swindon, GB');
    if (fallback) {
      state.selection = fallback;
      saveLS();
      renderFavStar();
      await refreshWeatherAndRender();
    }
  }

  // PWA service worker registration (safe on GitHub Pages)
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }
  });

  init();
})();
