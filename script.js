(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const els = {
    txtSearch: $("txtSearch"),
    btnSearch: $("btnSearch"),
    btnGeo: $("btnGeo"),
    ddlUnits: $("ddlUnits"),

    txtCourseFilter: $("txtCourseFilter"),
    ddlCourses: $("ddlCourses"),
    btnFavToggle: $("btnFavToggle"),
    ddlFavs: $("ddlFavs"),

    appStatus: $("appStatus"),
    coursesStatus: $("coursesStatus"),

    dvCityCountry: $("dvCityCountry"),
    dvCurrDate: $("dvCurrDate"),
    dvCurrTemp: $("dvCurrTemp"),
    pFeelsLike: $("pFeelsLike"),
    pHumidity: $("pHumidity"),
    pWind: $("pWind"),
    imgIcon: $("imgCurrentIcon"),
    windArrowCurrent: $("windArrowCurrent"),

    playScore: $("playScore"),
    playText: $("playText"),

    pSunrise: $("pSunrise"),
    pSunset: $("pSunset"),
    pDayLength: $("pDayLength"),

    bestTeeTime: $("bestTeeTime"),
    bestTeeScore: $("bestTeeScore"),
    bestTeeReason: $("bestTeeReason"),

    dailyForecast: $("dailyForecast"),
    hourlyHours: $("hourlyHours"),
    ddlDay: $("ddlDay"),

    quickChips: $("quickChips"),

    // Map + rain
    map: $("map"),
    rainMessage: $("rainMessage"),
    rainTimeline: $("rainTimeline"),
  };

  const safeText = (el, t) => { if (el) el.textContent = t; };

  let units = "metric";
  const tempSymbol = () => (units === "imperial" ? "°F" : "°C");
  const windUnit = () => (units === "imperial" ? "mph" : "m/s");

  let lastPlace = { name: "London", country: "GB", lat: 51.5072, lon: -0.1276 };
  let dayBuckets = [];
  let allCourses = [];

  // Supabase
  const supabaseClient =
    (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
      ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
      : null;

  // Map state
  let mapInstance = null;
  let mapMarker = null;

  const iconUrl = (code) => `https://openweathermap.org/img/wn/${code}@2x.png`;
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"short", day:"numeric" });
  const fmtDayShort = (d) => d.toLocaleDateString(undefined, { weekday:"short" });
  const fmtDayLabel = (d) => d.toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });
  const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });

  function setWindArrow(el, degFrom) {
    if (!el || typeof degFrom !== "number") return;
    const degTo = (degFrom + 180) % 360;
    el.style.transform = `rotate(${degTo}deg)`;
  }

  function playability(it) {
    let score = 10;
    const reasons = [];

    const wind = Number(it?.wind?.speed ?? 0);
    const pop = Number(it?.pop ?? 0);
    const temp = Number(it?.main?.temp ?? 0);

    // Wind thresholds
    if (units === "metric") {
      if (wind > 14) { score -= 4.5; reasons.push("Very windy"); }
      else if (wind > 10) { score -= 3.0; reasons.push("Windy"); }
      else if (wind > 7) { score -= 1.8; reasons.push("Breezy"); }
      else reasons.push("Light wind");
    } else {
      if (wind > 31) { score -= 4.5; reasons.push("Very windy"); }
      else if (wind > 22) { score -= 3.0; reasons.push("Windy"); }
      else if (wind > 16) { score -= 1.8; reasons.push("Breezy"); }
      else reasons.push("Light wind");
    }

    // Rain risk
    if (pop >= 0.7) { score -= 2.5; reasons.push("High rain risk"); }
    else if (pop >= 0.4) { score -= 1.5; reasons.push("Some rain risk"); }
    else if (pop >= 0.2) { score -= 0.6; reasons.push("Low rain risk"); }
    else reasons.push("Dry");

    // Temperature comfort
    if (units === "metric") {
      if (temp < 2) { score -= 2.0; reasons.push("Very cold"); }
      else if (temp < 8) { score -= 1.0; reasons.push("Chilly"); }
      else if (temp > 30) { score -= 2.0; reasons.push("Very hot"); }
      else if (temp > 25) { score -= 1.0; reasons.push("Warm"); }
      else reasons.push("Comfortable");
    } else {
      if (temp < 36) { score -= 2.0; reasons.push("Very cold"); }
      else if (temp < 46) { score -= 1.0; reasons.push("Chilly"); }
      else if (temp > 86) { score -= 2.0; reasons.push("Very hot"); }
      else if (temp > 77) { score -= 1.0; reasons.push("Warm"); }
      else reasons.push("Comfortable");
    }

    score = Math.max(0, Math.min(10, Math.round(score * 10) / 10));
    const label = score >= 8.5 ? "Excellent" : score >= 7 ? "Good" : score >= 5 ? "Fair" : "Poor";
    const summary = [...new Set(reasons)].slice(0, 3).join(" • ");
    return { score, label, reason: summary || "—" };
  }

  function pickMidday(items) {
    let best = items[0];
    let bestDist = Infinity;
    for (const it of items) {
      const h = it._dt.getHours();
      const dist = Math.abs(h - 12);
      if (dist < bestDist) { best = it; bestDist = dist; }
    }
    return best;
  }

  function buildDayBuckets(forecast) {
    const byDay = new Map();
    for (const it of (forecast.list || [])) {
      const d = new Date(it.dt * 1000);
      const key = d.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push({ ...it, _dt: d });
    }
    return Array.from(byDay.entries())
      .slice(0, 5)
      .map(([key, items]) => {
        items.sort((a, b) => a.dt - b.dt);
        return { key, label: fmtDayLabel(items[0]._dt), items };
      });
  }

  async function fetchForecast(lat, lon) {
    const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("units", units);
    url.searchParams.set("appid", cfg.OPENWEATHER_API_KEY);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Forecast failed: ${res.status}`);
    return res.json();
  }

  function initMapOnce() {
    if (!els.map) return;
    if (!window.L) return; // Leaflet not loaded yet
    if (mapInstance) return;

    mapInstance = L.map(els.map, {
      zoomControl: false,
      attributionControl: false,
    }).setView([lastPlace.lat, lastPlace.lon], 9);

    // Light OSM tiles (clean + readable)
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18
    }).addTo(mapInstance);

    mapMarker = L.marker([lastPlace.lat, lastPlace.lon]).addTo(mapInstance);
  }

  function updateMap(place) {
    initMapOnce();
    if (!mapInstance || !mapMarker) return;
    mapInstance.setView([place.lat, place.lon], 9, { animate: true });
    mapMarker.setLatLng([place.lat, place.lon]);
    mapMarker.bindPopup(`${place.name}${place.country ? `, ${place.country}` : ""}`).openPopup();
  }

  function renderRainTimeline(forecast) {
    const list = (forecast.list || []).slice(0, 8); // next 24h (3-hour blocks)
    if (!els.rainTimeline || !els.rainMessage) return;

    // Message: when does rain start (using pop + rain/snow)
    const now = Date.now();
    const isWet = (it) => {
      const main = (it.weather?.[0]?.main || "").toLowerCase();
      return main.includes("rain") || main.includes("drizzle") || main.includes("snow") || (it.pop ?? 0) >= 0.35;
    };

    const nextWet = list.find(isWet);
    if (nextWet) {
      const t = nextWet.dt * 1000;
      const mins = Math.max(0, Math.round((t - now) / 60000));
      safeText(els.rainMessage, mins <= 1 ? "Rain starting now" : `Rain starting in ${mins} minutes`);
    } else {
      safeText(els.rainMessage, "No rain expected soon");
    }

    // Timeline blocks
    els.rainTimeline.innerHTML = "";
    for (const it of list) {
      const t = new Date(it.dt * 1000);
      const pop = typeof it.pop === "number" ? Math.round(it.pop * 100) : 0;

      const tick = document.createElement("div");
      tick.className = "rainTick";
      tick.innerHTML = `
        <div class="rainTime">${fmtTime(t)}</div>
        <div class="rainBar"><div class="rainFill" style="width:${pop}%"></div></div>
        <div class="rainPct">${pop}%</div>
      `;
      els.rainTimeline.appendChild(tick);
    }
  }

  function renderCurrent(place, forecast) {
    const first = forecast.list?.[0];
    if (!first) return;

    safeText(els.dvCityCountry, `${place.name}${place.country ? `, ${place.country}` : ""}`);
    safeText(els.dvCurrDate, fmtDate(new Date(first.dt * 1000)));

    safeText(els.dvCurrTemp, Math.round(first.main?.temp ?? 0));
    safeText(els.pFeelsLike, Math.round(first.main?.feels_like ?? first.main?.temp ?? 0));
    safeText(els.pHumidity, Math.round(first.main?.humidity ?? 0));

    const wind = first.wind?.speed ?? 0;
    safeText(els.pWind, `${Math.round(wind)} ${windUnit()}`);
    setWindArrow(els.windArrowCurrent, first.wind?.deg);

    const ic = first.weather?.[0]?.icon || "01d";
    const desc = first.weather?.[0]?.description || "";
    if (els.imgIcon) {
      els.imgIcon.src = iconUrl(ic);
      els.imgIcon.alt = desc;
    }

    const p = playability(first);
    safeText(els.playScore, `${p.score}/10 (${p.label})`);
    safeText(els.playText, p.reason);

    const sunrise = forecast.city?.sunrise;
    const sunset = forecast.city?.sunset;

    if (sunrise && sunset) {
      const sr = new Date(sunrise * 1000);
      const ss = new Date(sunset * 1000);
      safeText(els.pSunrise, sr.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      safeText(els.pSunset, ss.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

      const lenSec = sunset - sunrise;
      const h = Math.floor(lenSec / 3600);
      const m = Math.floor((lenSec % 3600) / 60);
      safeText(els.pDayLength, `Day length: ${h}h ${pad2(m)}m`);
    } else {
      safeText(els.pSunrise, "--");
      safeText(els.pSunset, "--");
      safeText(els.pDayLength, "Day length: --");
    }
  }

  function populateDaySelect(buckets) {
    if (!els.ddlDay) return;
    els.ddlDay.innerHTML = "";
    buckets.forEach((b, i) => {
      const opt = document.createElement("option");
      opt.value = b.key;
      opt.textContent = b.label;
      if (i === 0) opt.selected = true;
      els.ddlDay.appendChild(opt);
    });

    els.ddlDay.onchange = () => {
      const key = els.ddlDay.value;
      const bucket = dayBuckets.find(x => x.key === key);
      if (bucket) renderHourly(bucket);
      showPanel("hourly");
      setActiveNav("hourly");
    };
  }

  function renderDaily(buckets) {
    if (!els.dailyForecast) return;
    els.dailyForecast.innerHTML = "";

    buckets.forEach((b) => {
      const midday = pickMidday(b.items);
      const p = playability(midday);

      const temps = b.items.map(x => x.main?.temp).filter(n => typeof n === "number");
      const min = temps.length ? Math.min(...temps) : null;
      const max = temps.length ? Math.max(...temps) : null;

      const ic = midday.weather?.[0]?.icon || b.items[0].weather?.[0]?.icon || "01d";
      const dayShort = fmtDayShort(b.items[0]._dt);

      const card = document.createElement("div");
      card.className = "dayCard";
      card.dataset.key = b.key;

      card.innerHTML = `
        <div class="dayTop">
          <div>${dayShort}</div>
          <div class="dayScore">${p.score}/10</div>
        </div>
        <div class="dayIcon"><img src="${iconUrl(ic)}" alt=""></div>
        <div class="dayTemps">
          <div>${max != null ? Math.round(max) : "--"}${tempSymbol()}</div>
          <div class="dayMin">${min != null ? Math.round(min) : "--"}${tempSymbol()}</div>
        </div>
        <div class="hourMeta">${p.label}</div>
      `;

      card.addEventListener("click", () => {
        if (els.ddlDay) els.ddlDay.value = b.key;
        renderHourly(b);
        showPanel("hourly");
        setActiveNav("hourly");
      });

      els.dailyForecast.appendChild(card);
    });
  }

  function renderHourly(bucket) {
    if (!els.hourlyHours) return;
    els.hourlyHours.innerHTML = "";

    const items = bucket.items.slice(0, 8);
    items.forEach((it) => {
      const ic = it.weather?.[0]?.icon || "01d";
      const temp = it.main?.temp;
      const pop = typeof it.pop === "number" ? Math.round(it.pop * 100) : null;
      const wind = it.wind?.speed;
      const deg = it.wind?.deg;

      const card = document.createElement("div");
      card.className = "hourCard";
      card.innerHTML = `
        <div class="hourTime">${fmtTime(it._dt)}</div>
        <div class="dayIcon"><img src="${iconUrl(ic)}" alt=""></div>
        <div class="hourTemp">${typeof temp === "number" ? Math.round(temp) : "--"}${tempSymbol()}</div>
        <div class="hourWind">
          <span>${typeof wind === "number" ? Math.round(wind) : "--"} ${windUnit()}</span>
          <span class="windArrow">➤</span>
        </div>
        <div class="hourMeta">${pop != null ? `Rain: ${pop}%` : ""}</div>
      `;

      const arrow = card.querySelector(".windArrow");
      setWindArrow(arrow, typeof deg === "number" ? deg : null);
      els.hourlyHours.appendChild(card);
    });
  }

  // Best tee time: NEVER outside daylight
  function renderBestTeeTimeToday(buckets, forecast) {
    const today = buckets[0];
    if (!today || !today.items.length) {
      safeText(els.bestTeeTime, "--");
      safeText(els.bestTeeScore, "--");
      safeText(els.bestTeeReason, "—");
      return;
    }

    const sunrise = forecast?.city?.sunrise;
    const sunset  = forecast?.city?.sunset;
    const BLOCK_SECONDS = 3 * 60 * 60;

    if (typeof sunrise !== "number" || typeof sunset !== "number") {
      let best = null;
      for (const it of today.items) {
        const p = playability(it);
        if (!best || p.score > best.p.score) best = { it, p, start: it.dt, end: it.dt + BLOCK_SECONDS };
      }
      const start = new Date(best.start * 1000);
      const end = new Date(best.end * 1000);
      safeText(els.bestTeeTime, `${pad2(start.getHours())}:00 – ${pad2(end.getHours())}:00`);
      safeText(els.bestTeeScore, `${best.p.score}/10 (${best.p.label})`);
      safeText(els.bestTeeReason, best.p.reason || "—");
      return;
    }

    let best = null;
    for (const it of today.items) {
      const blockStart = it.dt;
      const blockEnd = it.dt + BLOCK_SECONDS;

      const effStart = Math.max(blockStart, sunrise);
      const effEnd = Math.min(blockEnd, sunset);

      if (effEnd - effStart < 30 * 60) continue;

      const p = playability(it);
      if (!best || p.score > best.p.score) best = { it, p, effStart, effEnd };
    }

    if (!best) {
      safeText(els.bestTeeTime, "No daylight slot");
      safeText(els.bestTeeScore, "--");
      safeText(els.bestTeeReason, "Sunrise/sunset leave no playable window today.");
      return;
    }

    const start = new Date(best.effStart * 1000);
    const end = new Date(best.effEnd * 1000);

    safeText(els.bestTeeTime, `${pad2(start.getHours())}:${pad2(start.getMinutes())} – ${pad2(end.getHours())}:${pad2(end.getMinutes())}`);
    safeText(els.bestTeeScore, `${best.p.score}/10 (${best.p.label})`);
    safeText(els.bestTeeReason, best.p.reason || "—");
  }

  async function showForecastForPlace(place) {
    try {
      safeText(els.appStatus, "Loading weather…");
      const forecast = await fetchForecast(place.lat, place.lon);

      lastPlace = place;
      dayBuckets = buildDayBuckets(forecast);

      renderCurrent(place, forecast);
      renderBestTeeTimeToday(dayBuckets, forecast);

      populateDaySelect(dayBuckets);
      renderDaily(dayBuckets);
      if (dayBuckets[0]) renderHourly(dayBuckets[0]);

      // Map + rain
      updateMap(place);
      renderRainTimeline(forecast);

      // chips
      renderQuickChips([
        { name: "London", country:"GB", lat: 51.5072, lon: -0.1276 },
        { name: "Glasgow", country:"GB", lat: 55.8642, lon: -4.2518 },
        { name: "Cardiff", country:"GB", lat: 51.4816, lon: -3.1791 },
        { name: "Belfast", country:"GB", lat: 54.5973, lon: -5.9301 },
      ]);

      safeText(els.appStatus, "");
    } catch (e) {
      console.error(e);
      safeText(els.appStatus, "Weather failed to load (check console).");
    }
  }

  async function geocodePlace(query) {
    const url = new URL("https://api.openweathermap.org/geo/1.0/direct");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "1");
    url.searchParams.set("appid", cfg.OPENWEATHER_API_KEY);

    const res = await fetch(url);
    if (!res.ok) throw new Error("Geocoding failed");
    const data = await res.json();
    if (!data?.length) throw new Error("No results");
    const g = data[0];
    return { name: g.name, country: g.country, lat: g.lat, lon: g.lon };
  }

  // Panels
  function showPanel(panel) {
    document.querySelectorAll(".viewPanel").forEach(p => {
      const key = p.getAttribute("data-panel");
      p.classList.toggle("hidden", key !== panel && !(panel === "current" && key === "current"));
    });

    if (panel === "current") {
      document.querySelectorAll('.viewPanel[data-panel="current"]').forEach(p => p.classList.remove("hidden"));
      document.querySelectorAll('.viewPanel[data-panel="daily"], .viewPanel[data-panel="hourly"], .viewPanel[data-panel="courses"]').forEach(p => p.classList.add("hidden"));
    }

    // fix map sizing when switching back to current
    if (panel === "current" && mapInstance) {
      setTimeout(() => mapInstance.invalidateSize(true), 50);
    }
  }

  function setActiveNav(panel) {
    document.querySelectorAll(".navBtn").forEach(b => b.classList.remove("active"));
    const btn = document.querySelector(`.navBtn[data-view="${panel}"]`);
    if (btn) btn.classList.add("active");
  }

  document.querySelectorAll(".navBtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const panel = btn.getAttribute("data-view");
      setActiveNav(panel);
      showPanel(panel);
    });
  });

  // Chips
  async function chipTempFor(place) {
    try {
      const f = await fetchForecast(place.lat, place.lon);
      const t = Math.round(f.list?.[0]?.main?.temp ?? 0);
      return `${t}${tempSymbol()}`;
    } catch {
      return "--";
    }
  }

  async function renderQuickChips(places) {
    if (!els.quickChips) return;
    els.quickChips.innerHTML = "";

    for (const p of places) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `<span class="chipName">${p.name}</span> <span class="chipTemp">…</span>`;
      chip.addEventListener("click", () => showForecastForPlace(p));
      els.quickChips.appendChild(chip);

      chip.querySelector(".chipTemp").textContent = await chipTempFor(p);
    }
  }

  // Favourites
  const FAV_KEY = "ff_favs_v1";
  function favKeyOf(c) { return `${(c.name || "").toLowerCase()}|${(c.country || "").toLowerCase()}|${c.lat}|${c.lon}`; }
  function loadFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; } }
  function saveFavs(list) { localStorage.setItem(FAV_KEY, JSON.stringify(list)); }

  function renderFavs() {
    if (!els.ddlFavs) return;
    const favs = loadFavs();
    els.ddlFavs.innerHTML = favs.length ? `<option value="">Select a favourite…</option>` : `<option value="">No favourites yet</option>`;
    for (const f of favs) {
      const opt = document.createElement("option");
      opt.value = favKeyOf(f);
      opt.textContent = `${f.name} (${f.country})`;
      opt.dataset.name = f.name;
      opt.dataset.country = f.country;
      opt.dataset.lat = f.lat;
      opt.dataset.lon = f.lon;
      els.ddlFavs.appendChild(opt);
    }
  }

  function getSelectedCourse() {
    const opt = els.ddlCourses?.selectedOptions?.[0];
    if (!opt || !opt.dataset.lat) return null;
    return { name: opt.dataset.name, country: opt.dataset.country, lat: Number(opt.dataset.lat), lon: Number(opt.dataset.lon) };
  }

  function updateFavButton() {
    const course = getSelectedCourse();
    if (!els.btnFavToggle) return;

    if (!course) {
      els.btnFavToggle.disabled = true;
      els.btnFavToggle.textContent = "☆";
      els.btnFavToggle.title = "Select a course first";
      return;
    }

    els.btnFavToggle.disabled = false;
    const favs = loadFavs();
    const exists = favs.some(f => favKeyOf(f) === favKeyOf(course));
    els.btnFavToggle.textContent = exists ? "★" : "☆";
    els.btnFavToggle.title = exists ? "Remove favourite" : "Add favourite";
  }

  function toggleFavourite() {
    const course = getSelectedCourse();
    if (!course) return;

    let favs = loadFavs();
    const key = favKeyOf(course);

    const exists = favs.some(f => favKeyOf(f) === key);
    if (exists) {
      favs = favs.filter(f => favKeyOf(f) !== key);
      safeText(els.appStatus, "Removed favourite.");
    } else {
      favs.unshift(course);
      const seen = new Set();
      favs = favs.filter(f => { const k = favKeyOf(f); if (seen.has(k)) return false; seen.add(k); return true; });
      safeText(els.appStatus, "Added favourite.");
    }

    saveFavs(favs);
    renderFavs();
    updateFavButton();
  }

  // Courses
  function normalise(s) { return (s || "").toString().toLowerCase().trim().replace(/\s+/g, " "); }

  function fillCoursesDropdown(list) {
    if (!els.ddlCourses) return;
    els.ddlCourses.innerHTML = `<option value="">Select a course…</option>`;
    for (const c of list) {
      const opt = document.createElement("option");
      opt.textContent = `${c.name} (${c.country})`;
      opt.dataset.lat = c.latitude;
      opt.dataset.lon = c.longitude;
      opt.dataset.name = c.name;
      opt.dataset.country = c.country;
      els.ddlCourses.appendChild(opt);
    }
  }

  function applyCourseFilter() {
    const q = normalise(els.txtCourseFilter?.value || "");
    if (!q) {
      fillCoursesDropdown(allCourses.slice(0, 600));
      safeText(els.coursesStatus, `Courses loaded ✅ (${allCourses.length} total)`);
      updateFavButton();
      return;
    }
    const filtered = allCourses.filter(c => normalise(c.name).includes(q) || normalise(c.country).includes(q));
    fillCoursesDropdown(filtered.slice(0, 600));
    safeText(els.coursesStatus, `Matches: ${filtered.length} ✅`);
    updateFavButton();
  }

  async function loadCourses() {
    if (!supabaseClient) {
      safeText(els.coursesStatus, "Supabase not ready (check config.js + CDN).");
      if (els.ddlCourses) els.ddlCourses.innerHTML = `<option value="">Courses (Supabase not ready)</option>`;
      return;
    }

    try {
      safeText(els.coursesStatus, "Loading courses…");
      if (els.ddlCourses) els.ddlCourses.innerHTML = `<option value="">Courses (loading…)</option>`;

      const { data, error } = await supabaseClient
        .from("uk_golf_courses")
        .select("name,country,latitude,longitude")
        .order("name", { ascending: true });

      if (error) throw error;

      allCourses = data || [];
      applyCourseFilter();
    } catch (e) {
      console.error(e);
      safeText(els.coursesStatus, `Courses error: ${e.message}`);
      if (els.ddlCourses) els.ddlCourses.innerHTML = `<option value="">Courses (error)</option>`;
    }
  }

  // Events
  els.btnSearch?.addEventListener("click", async () => {
    const q = (els.txtSearch?.value || "").trim();
    if (!q) return;
    try {
      const place = await geocodePlace(q);
      await showForecastForPlace(place);
      showPanel("current");
      setActiveNav("current");
    } catch (e) {
      console.error(e);
      safeText(els.appStatus, "Couldn’t find that place. Try “Swindon, GB”.");
    }
  });

  els.btnGeo?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      safeText(els.appStatus, "Geolocation not supported.");
      return;
    }
    safeText(els.appStatus, "Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        showForecastForPlace({ name: "My location", country: "", lat: p.coords.latitude, lon: p.coords.longitude });
        showPanel("current");
        setActiveNav("current");
      },
      () => safeText(els.appStatus, "Location blocked or unavailable."),
      { timeout: 12000, maximumAge: 600000 }
    );
  });

  els.ddlUnits?.addEventListener("change", async () => {
    units = (els.ddlUnits.value === "F") ? "imperial" : "metric";
    await showForecastForPlace(lastPlace);
  });

  els.txtCourseFilter?.addEventListener("input", applyCourseFilter);

  els.ddlCourses?.addEventListener("change", async () => {
    updateFavButton();
    const c = getSelectedCourse();
    if (!c) return;
    await showForecastForPlace(c);
    showPanel("current");
    setActiveNav("current");
  });

  els.btnFavToggle?.addEventListener("click", toggleFavourite);

  els.ddlFavs?.addEventListener("change", async () => {
    const opt = els.ddlFavs.selectedOptions?.[0];
    if (!opt || !opt.dataset.lat) return;
    await showForecastForPlace({
      name: opt.dataset.name,
      country: opt.dataset.country,
      lat: Number(opt.dataset.lat),
      lon: Number(opt.dataset.lon),
    });
    showPanel("current");
    setActiveNav("current");
  });

  // Boot
  (async function init() {
    if (els.ddlUnits) {
      els.ddlUnits.value = "C";
      units = "metric";
    }

    renderFavs();
    updateFavButton();

    await loadCourses();
    await showForecastForPlace(lastPlace);

    // map sometimes loads after JS; retry init once shortly after
    setTimeout(() => {
      initMapOnce();
      if (mapInstance) mapInstance.invalidateSize(true);
    }, 400);

    showPanel("current");
    setActiveNav("current");
  })();
})();
