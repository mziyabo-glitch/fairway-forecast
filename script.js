(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const els = {
    ddlUnits: $("ddlUnits"),
    ddlFavs: $("ddlFavs"),
    btnGeo: $("btnGeo"),
    btnFavToggle: $("btnFavToggle"),

    txtUnifiedSearch: $("txtUnifiedSearch"),
    btnUnifiedSearch: $("btnUnifiedSearch"),
    searchSuggestions: $("searchSuggestions"),

    appStatus: $("appStatus"),
    coursesStatus: $("coursesStatus"),

    dvCityCountry: $("dvCityCountry"),
    dvCurrDate: $("dvCurrDate"),
    dvCurrTemp: $("dvCurrTemp"),
    pFeelsLike: $("pFeelsLike"),
    pHumidity: $("pHumidity"),
    pWind: $("pWind"),
    pWindDir: $("pWindDir"),
    imgIcon: $("imgCurrentIcon"),
    windArrowCurrent: $("windArrowCurrent"),

    playCardCurrent: $("playCardCurrent"),
    playScore: $("playScore"),
    playText: $("playText"),

    pSunrise: $("pSunrise"),
    pSunset: $("pSunset"),
    pDayLength: $("pDayLength"),

    bestTeeTime: $("bestTeeTime"),
    bestTeeScore: $("bestTeeScore"),
    bestTeeReason: $("bestTeeReason"),
    bestTeeBadge: $("bestTeeBadge"),

    dailyForecast: $("dailyForecast"),
    hourlyHours: $("hourlyHours"),
    ddlDay: $("ddlDay"),

    quickChips: $("quickChips"),

    map: $("map"),
    rainMessage: $("rainMessage"),
    rainTimeline: $("rainTimeline"),
  };

  const safeText = (el, t) => { if (el) el.textContent = t; };

  let units = "metric";
  const tempSymbol = () => (units === "imperial" ? "°F" : "°C");
  const windUnit = () => (units === "imperial" ? "mph" : "m/s");

  // track what the last selection is (for favourite button)
  let lastSelected = { type: "location", name: "London", country: "GB", lat: 51.5072, lon: -0.1276 };

  let dayBuckets = [];
  let allCourses = [];

  const supabaseClient =
    (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
      ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
      : null;

  let mapInstance = null;
  let mapMarker = null;

  const iconUrl = (code) => `https://openweathermap.org/img/wn/${code}@2x.png`;
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"short", day:"numeric" });
  const fmtDayShort = (d) => d.toLocaleDateString(undefined, { weekday:"short" });
  const fmtDayLabel = (d) => d.toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });
  const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });

  function normalise(s) {
    return (s || "").toString().toLowerCase().trim().replace(/\s+/g, " ");
  }

  function degToCompass(deg) {
    if (typeof deg !== "number") return "—";
    const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    const ix = Math.round(deg / 22.5) % 16;
    return dirs[ix];
  }

  function setWindArrow(el, degFrom) {
    if (!el || typeof degFrom !== "number") return;
    // API gives wind FROM; arrow points TO
    const degTo = (degFrom + 180) % 360;
    el.style.transform = `rotate(${degTo}deg)`;
  }

  function playability(it) {
    let score = 10;
    const reasons = [];

    const wind = Number(it?.wind?.speed ?? 0);
    const pop = Number(it?.pop ?? 0);
    const temp = Number(it?.main?.temp ?? 0);

    // Wind thresholds (rough golf comfort)
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

    // Rain probability
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

  function playClass(score) {
    if (score >= 8.5) return "play-excellent";
    if (score >= 7) return "play-good";
    if (score >= 5) return "play-fair";
    return "play-poor";
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
    return { type: "location", name: g.name, country: g.country, lat: g.lat, lon: g.lon };
  }

  // Map
  function initMapOnce() {
    if (!els.map) return;
    if (!window.L) return;
    if (mapInstance) return;

    mapInstance = L.map(els.map, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      dragging: true,
      tap: true
    }).setView([lastSelected.lat, lastSelected.lon], 9);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18
    }).addTo(mapInstance);

    mapMarker = L.marker([lastSelected.lat, lastSelected.lon]).addTo(mapInstance);
  }

  function updateMap(place) {
    initMapOnce();
    if (!mapInstance || !mapMarker) return;
    mapInstance.setView([place.lat, place.lon], 9, { animate: true });
    mapMarker.setLatLng([place.lat, place.lon]);
    mapMarker.bindPopup(`${place.name}${place.country ? `, ${place.country}` : ""}`);
  }

  // Rain timeline animation
  function renderRainTimeline(forecast) {
    const list = (forecast.list || []).slice(0, 8);
    if (!els.rainTimeline || !els.rainMessage) return;

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

    els.rainTimeline.innerHTML = "";
    for (const it of list) {
      const t = new Date(it.dt * 1000);
      const pop = typeof it.pop === "number" ? Math.round(it.pop * 100) : 0;

      const tick = document.createElement("div");
      tick.className = "rainTick";
      tick.innerHTML = `
        <div class="rainTime">${fmtTime(t)}</div>
        <div class="rainBar">
          <div class="rainFill" style="--w:${pop}%;"></div>
        </div>
        <div class="rainPct">${pop}%</div>
      `;
      els.rainTimeline.appendChild(tick);
    }
  }

  // Render current, daily, hourly
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
    safeText(els.pWindDir, `Dir: ${degToCompass(first.wind?.deg)} (${Math.round(first.wind?.deg ?? 0)}°)`);

    const ic = first.weather?.[0]?.icon || "01d";
    const desc = first.weather?.[0]?.description || "";
    if (els.imgIcon) {
      els.imgIcon.src = iconUrl(ic);
      els.imgIcon.alt = desc;
    }

    const p = playability(first);
    safeText(els.playScore, `${p.score}/10 (${p.label})`);
    safeText(els.playText, p.reason);

    if (els.playCardCurrent) {
      els.playCardCurrent.classList.remove("play-excellent","play-good","play-fair","play-poor");
      els.playCardCurrent.classList.add(playClass(p.score));
    }

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

      const wind = midday.wind?.speed ?? null;
      const deg = midday.wind?.deg ?? null;

      const card = document.createElement("div");
      card.className = `dayCard ${playClass(p.score)}`;
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
        <div class="dayWindRow">
          <span>${wind != null ? Math.round(wind) : "--"} ${windUnit()}</span>
          <span class="windArrow">➤</span>
          <span>${degToCompass(deg)}</span>
        </div>
        <div class="metricSub" style="text-align:center;">${p.label}</div>
      `;

      const arrow = card.querySelector(".windArrow");
      setWindArrow(arrow, deg);

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

      const p = playability(it);

      const card = document.createElement("div");
      card.className = `hourCard ${playClass(p.score)}`;
      card.innerHTML = `
        <div class="hourTime">${fmtTime(it._dt)}</div>
        <div class="dayIcon"><img src="${iconUrl(ic)}" alt=""></div>
        <div class="hourTemp">${typeof temp === "number" ? Math.round(temp) : "--"}${tempSymbol()}</div>
        <div class="hourWind">
          <span>${typeof wind === "number" ? Math.round(wind) : "--"} ${windUnit()}</span>
          <span class="windArrow">➤</span>
          <span>${degToCompass(deg)}</span>
        </div>
        <div class="metricSub">${pop != null ? `Rain: ${pop}%` : ""}</div>
      `;

      const arrow = card.querySelector(".windArrow");
      setWindArrow(arrow, typeof deg === "number" ? deg : null);

      els.hourlyHours.appendChild(card);
    });
  }

  // Best tee time: never outside sunrise/sunset (clamped)
  function renderBestTeeTimeToday(buckets, forecast) {
    const today = buckets[0];
    if (!today || !today.items.length) {
      safeText(els.bestTeeTime, "--");
      safeText(els.bestTeeScore, "--");
      safeText(els.bestTeeReason, "—");
      safeText(els.bestTeeBadge, "—");
      return;
    }

    const sunrise = forecast?.city?.sunrise;
    const sunset  = forecast?.city?.sunset;
    const BLOCK_SECONDS = 3 * 60 * 60;

    let best = null;

    for (const it of today.items) {
      const blockStart = it.dt;
      const blockEnd = it.dt + BLOCK_SECONDS;

      if (typeof sunrise === "number" && typeof sunset === "number") {
        const effStart = Math.max(blockStart, sunrise);
        const effEnd = Math.min(blockEnd, sunset);

        if (effEnd - effStart < 30 * 60) continue; // need at least 30 minutes daylight
        const p = playability(it);

        if (!best || p.score > best.p.score) best = { p, effStart, effEnd };
      } else {
        const p = playability(it);
        if (!best || p.score > best.p.score) best = { p, effStart: blockStart, effEnd: blockEnd };
      }
    }

    if (!best) {
      safeText(els.bestTeeTime, "No daylight slot");
      safeText(els.bestTeeScore, "--");
      safeText(els.bestTeeBadge, "—");
      safeText(els.bestTeeReason, "Sunrise/sunset leave no playable window today.");
      return;
    }

    const start = new Date(best.effStart * 1000);
    const end = new Date(best.effEnd * 1000);

    safeText(els.bestTeeTime, `${pad2(start.getHours())}:${pad2(start.getMinutes())} – ${pad2(end.getHours())}:${pad2(end.getMinutes())}`);
    safeText(els.bestTeeScore, `${best.p.score}/10 (${best.p.label})`);
    safeText(els.bestTeeBadge, best.p.label);
    safeText(els.bestTeeReason, best.p.reason || "—");

    if (els.bestTeeBadge) {
      els.bestTeeBadge.classList.remove("play-excellent","play-good","play-fair","play-poor");
      els.bestTeeBadge.classList.add(playClass(best.p.score));
    }
  }

  async function showForecastForPlace(place) {
    try {
      safeText(els.appStatus, "Loading weather…");
      const forecast = await fetchForecast(place.lat, place.lon);

      lastSelected = place;
      updateFavButton();

      dayBuckets = buildDayBuckets(forecast);

      renderCurrent(place, forecast);
      renderBestTeeTimeToday(dayBuckets, forecast);

      populateDaySelect(dayBuckets);
      renderDaily(dayBuckets);
      if (dayBuckets[0]) renderHourly(dayBuckets[0]);

      updateMap(place);
      renderRainTimeline(forecast);

      safeText(els.appStatus, "");
    } catch (e) {
      console.error(e);
      safeText(els.appStatus, "Weather failed to load (check console).");
    }
  }

  // Panels (sidebar)
  function showPanel(panel) {
    document.querySelectorAll(".viewPanel").forEach(p => {
      const key = p.getAttribute("data-panel");
      p.classList.toggle("hidden", key !== panel && !(panel === "current" && key === "current"));
    });

    if (panel === "current") {
      document.querySelectorAll('.viewPanel[data-panel="current"]').forEach(p => p.classList.remove("hidden"));
      document.querySelectorAll('.viewPanel[data-panel="daily"], .viewPanel[data-panel="hourly"], .viewPanel[data-panel="courses"]').forEach(p => p.classList.add("hidden"));
    }

    if (panel === "current" && mapInstance) {
      setTimeout(() => mapInstance.invalidateSize(true), 60);
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

  // Quick chips
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

  // Favourites (localStorage)
  const FAV_KEY = "ff_favs_v2";
  function favKeyOf(x) { return `${x.type}|${normalise(x.name)}|${normalise(x.country||"")}|${x.lat}|${x.lon}`; }
  function loadFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; } }
  function saveFavs(list) { localStorage.setItem(FAV_KEY, JSON.stringify(list)); }

  function renderFavs() {
    if (!els.ddlFavs) return;
    const favs = loadFavs();
    els.ddlFavs.innerHTML = favs.length ? `<option value="">Select a favourite…</option>` : `<option value="">No favourites yet</option>`;
    for (const f of favs) {
      const opt = document.createElement("option");
      opt.value = favKeyOf(f);
      opt.textContent = `${f.name}${f.country ? ` (${f.country})` : ""}`;
      opt.dataset.type = f.type;
      opt.dataset.name = f.name;
      opt.dataset.country = f.country || "";
      opt.dataset.lat = f.lat;
      opt.dataset.lon = f.lon;
      els.ddlFavs.appendChild(opt);
    }
  }

  function updateFavButton() {
    if (!els.btnFavToggle) return;
    const favs = loadFavs();
    const exists = favs.some(f => favKeyOf(f) === favKeyOf(lastSelected));
    els.btnFavToggle.textContent = exists ? "★" : "☆";
    els.btnFavToggle.title = exists ? "Remove favourite" : "Add favourite";
  }

  function toggleFavourite() {
    let favs = loadFavs();
    const key = favKeyOf(lastSelected);
    const exists = favs.some(f => favKeyOf(f) === key);

    if (exists) {
      favs = favs.filter(f => favKeyOf(f) !== key);
      safeText(els.appStatus, "Removed favourite.");
    } else {
      favs.unshift(lastSelected);
      const seen = new Set();
      favs = favs.filter(f => { const k = favKeyOf(f); if (seen.has(k)) return false; seen.add(k); return true; });
      safeText(els.appStatus, "Added favourite.");
    }

    saveFavs(favs);
    renderFavs();
    updateFavButton();
  }

  // Courses load (Supabase)
  async function loadCourses() {
    if (!supabaseClient) {
      safeText(els.coursesStatus, "Supabase not ready (check config.js).");
      return;
    }
    try {
      safeText(els.coursesStatus, "Loading courses…");

      const { data, error } = await supabaseClient
        .from("uk_golf_courses")
        .select("name,country,latitude,longitude")
        .order("name", { ascending: true });

      if (error) throw error;

      allCourses = data || [];
      safeText(els.coursesStatus, `Courses loaded ✅ (${allCourses.length} total)`);
    } catch (e) {
      console.error(e);
      safeText(els.coursesStatus, `Courses error: ${e.message}`);
    }
  }

  // Suggestions dropdown (courses + a “Search location…” row)
  let suggTimer = null;

  function hideSuggestions() {
    if (!els.searchSuggestions) return;
    els.searchSuggestions.classList.add("hidden");
    els.searchSuggestions.innerHTML = "";
  }

  function showSuggestions(items) {
    if (!els.searchSuggestions) return;
    if (!items.length) {
      hideSuggestions();
      return;
    }
    els.searchSuggestions.classList.remove("hidden");
    els.searchSuggestions.innerHTML = "";
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "suggItem";
      row.innerHTML = `
        <div>
          <div class="suggMain">${item.title}</div>
          <div class="suggSub">${item.sub || ""}</div>
        </div>
        <div class="suggTag ${item.tagClass}">${item.tag}</div>
      `;
      row.addEventListener("click", item.onClick);
      els.searchSuggestions.appendChild(row);
    }
  }

  function courseMatches(q, limit = 6) {
    const nq = normalise(q);
    if (!nq) return [];
    const matches = allCourses
      .filter(c => normalise(c.name).includes(nq) || normalise(c.country).includes(nq))
      .slice(0, limit)
      .map(c => ({
        type: "course",
        name: c.name,
        country: c.country,
        lat: Number(c.latitude),
        lon: Number(c.longitude)
      }));
    return matches;
  }

  function buildSuggestions(q) {
    const list = [];

    // course suggestions first
    const courses = courseMatches(q, 6);
    for (const c of courses) {
      list.push({
        title: c.name,
        sub: c.country || "",
        tag: "Course",
        tagClass: "course",
        onClick: async () => {
          hideSuggestions();
          els.txtUnifiedSearch.value = c.name;
          await showForecastForPlace({ ...c, type: "course" });
          showPanel("current");
          setActiveNav("current");
        }
      });
    }

    // location option always available
    list.push({
      title: `Search location: "${q}"`,
      sub: "OpenWeather location search",
      tag: "Location",
      tagClass: "location",
      onClick: async () => {
        hideSuggestions();
        try {
          const place = await geocodePlace(q);
          els.txtUnifiedSearch.value = `${place.name}${place.country ? ", " + place.country : ""}`;
          await showForecastForPlace(place);
          showPanel("current");
          setActiveNav("current");
        } catch {
          safeText(els.appStatus, "Couldn’t find that location. Try adding country (e.g. Swindon, GB).");
        }
      }
    });

    return list;
  }

  // Unified search action
  async function doUnifiedSearch() {
    const q = (els.txtUnifiedSearch?.value || "").trim();
    if (!q) return;

    // If course match exists, use best match first
    const matches = courseMatches(q, 1);
    if (matches.length) {
      const c = matches[0];
      await showForecastForPlace({ ...c, type: "course" });
      showPanel("current");
      setActiveNav("current");
      return;
    }

    // Else geocode
    try {
      const place = await geocodePlace(q);
      await showForecastForPlace(place);
      showPanel("current");
      setActiveNav("current");
    } catch {
      safeText(els.appStatus, "No match found. Try a course name or a location like “Swindon, GB”.");
    }
  }

  // Geolocation button
  function useGeolocation() {
    if (!navigator.geolocation) {
      safeText(els.appStatus, "Geolocation not supported.");
      return;
    }
    safeText(els.appStatus, "Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        showForecastForPlace({
          type: "location",
          name: "My location",
          country: "",
          lat: p.coords.latitude,
          lon: p.coords.longitude
        });
        showPanel("current");
        setActiveNav("current");
      },
      () => safeText(els.appStatus, "Location blocked or unavailable."),
      { timeout: 12000, maximumAge: 600000 }
    );
  }

  // Units
  function onUnitsChange() {
    units = (els.ddlUnits.value === "F") ? "imperial" : "metric";
    showForecastForPlace(lastSelected);
  }

  // Favourites dropdown action
  async function onFavPick() {
    const opt = els.ddlFavs.selectedOptions?.[0];
    if (!opt || !opt.dataset.lat) return;
    const place = {
      type: opt.dataset.type,
      name: opt.dataset.name,
      country: opt.dataset.country,
      lat: Number(opt.dataset.lat),
      lon: Number(opt.dataset.lon),
    };
    await showForecastForPlace(place);
    showPanel("current");
    setActiveNav("current");
  }

  // Events
  els.btnUnifiedSearch?.addEventListener("click", doUnifiedSearch);
  els.txtUnifiedSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doUnifiedSearch();
  });

  els.txtUnifiedSearch?.addEventListener("input", () => {
    clearTimeout(suggTimer);
    const q = (els.txtUnifiedSearch.value || "").trim();
    if (!q) { hideSuggestions(); return; }

    suggTimer = setTimeout(() => {
      const items = buildSuggestions(q);
      showSuggestions(items);
    }, 120);
  });

  document.addEventListener("click", (e) => {
    if (!els.searchSuggestions) return;
    const inside = els.searchSuggestions.contains(e.target) || els.txtUnifiedSearch.contains(e.target);
    if (!inside) hideSuggestions();
  });

  els.btnGeo?.addEventListener("click", useGeolocation);
  els.ddlUnits?.addEventListener("change", onUnitsChange);
  els.btnFavToggle?.addEventListener("click", toggleFavourite);
  els.ddlFavs?.addEventListener("change", onFavPick);

  // Boot
  async function init() {
    // units default
    if (els.ddlUnits) {
      els.ddlUnits.value = "C";
      units = "metric";
    }

    renderFavs();
    updateFavButton();

    await renderQuickChips([
      { type:"location", name: "London", country:"GB", lat: 51.5072, lon: -0.1276 },
      { type:"location", name: "Glasgow", country:"GB", lat: 55.8642, lon: -4.2518 },
      { type:"location", name: "Cardiff", country:"GB", lat: 51.4816, lon: -3.1791 },
      { type:"location", name: "Belfast", country:"GB", lat: 54.5973, lon: -5.9301 },
    ]);

    await loadCourses();
    await showForecastForPlace(lastSelected);

    setTimeout(() => {
      initMapOnce();
      if (mapInstance) mapInstance.invalidateSize(true);
    }, 400);

    showPanel("current");
    setActiveNav("current");
  }

  init();
})();
