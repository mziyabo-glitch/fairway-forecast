(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  // DOM
  const els = {
    // search + controls
    txtSearch: $("txtSearch"),
    btnSearch: $("btnSearch"),
    btnGeo: $("btnGeo"),
    ddlUnits: $("ddlUnits"),

    // courses
    ddlCourses: $("ddlCourses"),
    txtCourseFilter: $("txtCourseFilter"),
    coursesStatus: $("coursesStatus"),

    // status
    appStatus: $("appStatus"),

    // current
    dvCityCountry: $("dvCityCountry"),
    dvCurrDate: $("dvCurrDate"),
    dvCurrTemp: $("dvCurrTemp"),
    pFeelsLike: $("pFeelsLike"),
    pHumidity: $("pHumidity"),
    pWind: $("pWind"),
    imgIcon: $("imgCurrentIcon"),

    // playability
    playScore: $("playScore"),
    playText: $("playText"),

    // sun
    pSunrise: $("pSunrise"),
    pSunset: $("pSunset"),
    pDayLength: $("pDayLength"),

    // tee time
    bestTeeTime: $("bestTeeTime"),
    bestTeeScore: $("bestTeeScore"),
    bestTeeReason: $("bestTeeReason"),

    // forecast areas
    dailyForecast: $("dailyForecast"),
    hourlyHours: $("hourlyHours"),
    ddlDay: $("ddlDay"),
  };

  // Safety: if any required element missing, avoid crashing
  function exists(el) { return el !== null && el !== undefined; }
  function setText(el, txt) { if (exists(el)) el.textContent = txt; }
  function setHTML(el, html) { if (exists(el)) el.innerHTML = html; }

  // Units
  let units = "metric"; // "metric" or "imperial"
  const unitTempSymbol = () => (units === "imperial" ? "°F" : "°C");
  const windUnit = () => (units === "imperial" ? "mph" : "m/s");

  // State
  let lastPlace = { name: "London", country: "GB", lat: 51.5072, lon: -0.1276 };
  let dayBuckets = []; // [{key,label,items:[...]}]
  let allCourses = [];

  // OpenWeather icon
  function iconUrl(code) {
    return `https://openweathermap.org/img/wn/${code}@2x.png`;
  }

  // Formatting
  function fmtDate(d) {
    return d.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "short", day: "numeric"
    });
  }
  function fmtDayShort(d) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  function fmtDayLabel(d) {
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }
  function fmtTime(d) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  function pad2(n) { return String(n).padStart(2, "0"); }

  // Playability (simple but useful)
  function playability(it) {
    let score = 10;
    const reasons = [];

    const wind = Number(it?.wind?.speed ?? 0);
    const pop = Number(it?.pop ?? 0);
    const temp = Number(it?.main?.temp ?? 0);

    // wind thresholds depend on units
    if (units === "metric") {
      if (wind > 14) { score -= 4.5; reasons.push("Very windy"); }
      else if (wind > 10) { score -= 3.0; reasons.push("Windy"); }
      else if (wind > 7) { score -= 1.8; reasons.push("Breezy"); }
      else reasons.push("Light wind");
    } else {
      // mph rough equivalents
      if (wind > 31) { score -= 4.5; reasons.push("Very windy"); }
      else if (wind > 22) { score -= 3.0; reasons.push("Windy"); }
      else if (wind > 16) { score -= 1.8; reasons.push("Breezy"); }
      else reasons.push("Light wind");
    }

    // rain risk from POP
    if (pop >= 0.7) { score -= 2.5; reasons.push("High rain risk"); }
    else if (pop >= 0.4) { score -= 1.5; reasons.push("Some rain risk"); }
    else if (pop >= 0.2) { score -= 0.6; reasons.push("Low rain risk"); }
    else reasons.push("Dry");

    // temperature comfort
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
    // choose item closest to 12:00 local time (we only have UTC-ish; good enough for now)
    let best = items[0];
    let bestDist = Infinity;
    for (const it of items) {
      const h = it._dt.getHours();
      const dist = Math.abs(h - 12);
      if (dist < bestDist) { best = it; bestDist = dist; }
    }
    return best;
  }

  // Build 5-day buckets from forecast list
  function buildDayBuckets(forecast) {
    const byDay = new Map();
    for (const it of (forecast.list || [])) {
      const d = new Date(it.dt * 1000);
      const key = d.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push({ ...it, _dt: d });
    }

    const buckets = Array.from(byDay.entries())
      .slice(0, 5)
      .map(([key, items]) => {
        items.sort((a, b) => a.dt - b.dt);
        return {
          key,
          label: fmtDayLabel(items[0]._dt),
          items,
        };
      });

    return buckets;
  }

  // Render current
  function renderCurrent(place, forecast) {
    const first = forecast.list?.[0];
    if (!first) return;

    setText(els.dvCityCountry, `${place.name}${place.country ? `, ${place.country}` : ""}`);
    setText(els.dvCurrDate, fmtDate(new Date(first.dt * 1000)));

    setText(els.dvCurrTemp, Math.round(first.main?.temp ?? 0));
    setText(els.pFeelsLike, Math.round(first.main?.feels_like ?? first.main?.temp ?? 0));
    setText(els.pHumidity, Math.round(first.main?.humidity ?? 0));

    const wind = first.wind?.speed;
    setText(els.pWind, `${Math.round(wind ?? 0)} ${windUnit()}`);

    const icon = first.weather?.[0]?.icon || "01d";
    const desc = first.weather?.[0]?.description || "";
    if (exists(els.imgIcon)) {
      els.imgIcon.src = iconUrl(icon);
      els.imgIcon.alt = desc;
    }

    const p = playability(first);
    setText(els.playScore, `${p.score}/10 (${p.label})`);
    setText(els.playText, p.reason);

    // sunrise/sunset/day length
    const sunrise = forecast.city?.sunrise;
    const sunset = forecast.city?.sunset;
    if (sunrise && sunset) {
      const sr = new Date(sunrise * 1000);
      const ss = new Date(sunset * 1000);
      setText(els.pSunrise, sr.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      setText(els.pSunset, ss.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));

      const lenSec = sunset - sunrise;
      const h = Math.floor(lenSec / 3600);
      const m = Math.floor((lenSec % 3600) / 60);
      setText(els.pDayLength, `Day length: ${h}h ${pad2(m)}m`);
    } else {
      setText(els.pSunrise, "--");
      setText(els.pSunset, "--");
      setText(els.pDayLength, "Day length: --");
    }
  }

  // Render daily cards
  function renderDaily(buckets) {
    if (!exists(els.dailyForecast)) return;
    els.dailyForecast.innerHTML = "";

    buckets.forEach((b) => {
      const midday = pickMidday(b.items);
      const p = playability(midday);

      const temps = b.items.map(x => x.main?.temp).filter(n => typeof n === "number");
      const min = temps.length ? Math.min(...temps) : null;
      const max = temps.length ? Math.max(...temps) : null;

      const icon = midday.weather?.[0]?.icon || b.items[0].weather?.[0]?.icon || "01d";
      const dayShort = fmtDayShort(b.items[0]._dt);

      const card = document.createElement("div");
      card.dataset.key = b.key;

      // uses your CSS for daily div cards
      card.innerHTML = `
        <div style="font-weight:900">${dayShort}</div>
        <img src="${iconUrl(icon)}" width="48" height="48" alt="">
        <div style="font-weight:900">${max != null ? Math.round(max) : "--"}${unitTempSymbol()}</div>
        <div style="color:#475569;font-weight:800">${min != null ? Math.round(min) : "--"}${unitTempSymbol()}</div>
        <div style="margin-top:6px;font-weight:900">${p.score}/10</div>
        <div style="font-size:12px;color:#475569;font-weight:700">${p.label}</div>
      `;

      // click daily -> switch hourly day
      card.style.cursor = "pointer";
      card.title = "Click to view hourly forecast";
      card.addEventListener("click", () => {
        if (exists(els.ddlDay)) els.ddlDay.value = b.key;
        renderHourly(b);
      });

      els.dailyForecast.appendChild(card);
    });
  }

  // Populate day dropdown
  function populateDaySelect(buckets) {
    if (!exists(els.ddlDay)) return;
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
    };
  }

  // Render hourly cards for a bucket (up to 24h = 8 items)
  function renderHourly(bucket) {
    if (!exists(els.hourlyHours)) return;
    els.hourlyHours.innerHTML = "";

    const items = bucket.items.slice(0, 8);
    items.forEach((it) => {
      const icon = it.weather?.[0]?.icon || "01d";
      const temp = it.main?.temp;
      const pop = typeof it.pop === "number" ? Math.round(it.pop * 100) : null;

      const div = document.createElement("div");
      div.innerHTML = `
        <div style="font-weight:900;color:#475569">${fmtTime(it._dt)}</div>
        <img src="${iconUrl(icon)}" width="42" height="42" alt="">
        <div style="font-weight:900">${typeof temp === "number" ? Math.round(temp) : "--"}${unitTempSymbol()}</div>
        <div style="font-size:12px;color:#475569;font-weight:700">${pop != null ? `Rain: ${pop}%` : ""}</div>
      `;
      els.hourlyHours.appendChild(div);
    });

    // update playability based on best item in that day (midday)
    const midday = pickMidday(bucket.items);
    if (midday) {
      const p = playability(midday);
      setText(els.playScore, `${p.score}/10 (${p.label})`);
      setText(els.playText, p.reason);
    }
  }

  // Best tee time = best 3h block today
  function renderBestTeeTimeToday(buckets) {
    const today = buckets[0];
    if (!today || !today.items.length) {
      setText(els.bestTeeTime, "--");
      setText(els.bestTeeScore, "--");
      setText(els.bestTeeReason, "—");
      return;
    }

    let best = null;
    for (const it of today.items) {
      const p = playability(it);
      if (!best || p.score > best.p.score) best = { it, p };
    }

    const start = best.it._dt;
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

    setText(els.bestTeeTime, `${pad2(start.getHours())}:00 – ${pad2(end.getHours())}:00`);
    setText(els.bestTeeScore, `${best.p.score}/10 (${best.p.label})`);
    setText(els.bestTeeReason, best.p.reason || "—");
  }

  // Fetch forecast
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

  // Main render pipeline
  async function showForecastForPlace(place) {
    try {
      setText(els.appStatus, "Loading weather…");
      const forecast = await fetchForecast(place.lat, place.lon);

      lastPlace = place;
      dayBuckets = buildDayBuckets(forecast);

      renderCurrent(place, forecast);
      renderBestTeeTimeToday(dayBuckets);

      populateDaySelect(dayBuckets);
      renderDaily(dayBuckets);

      if (dayBuckets[0]) renderHourly(dayBuckets[0]);

      setText(els.appStatus, "");
    } catch (e) {
      console.error(e);
      setText(els.appStatus, "Weather failed to load (check console).");
    }
  }

  // Geocode (text search)
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

  // -------------------- COURSES (Supabase) --------------------
  const supabaseClient =
    (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
      ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
      : null;

  function normalise(s) {
    return (s || "").toString().toLowerCase().trim().replace(/\s+/g, " ");
  }

  function fillCoursesDropdown(list) {
    if (!exists(els.ddlCourses)) return;

    els.ddlCourses.innerHTML = `<option value="">Select course…</option>`;
    list.forEach((c) => {
      const opt = document.createElement("option");
      opt.textContent = `${c.name} (${c.country})`;
      opt.dataset.lat = c.latitude;
      opt.dataset.lon = c.longitude;
      opt.dataset.name = c.name;
      opt.dataset.country = c.country;
      els.ddlCourses.appendChild(opt);
    });
  }

  function applyCourseFilter() {
    const q = normalise(els.txtCourseFilter?.value || "");
    if (!q) {
      fillCoursesDropdown(allCourses.slice(0, 500));
      setText(els.coursesStatus, `Loaded ${allCourses.length} courses ✅ (showing first 500)`);
      return;
    }

    const filtered = allCourses.filter(c => normalise(c.name).includes(q) || normalise(c.country).includes(q));
    fillCoursesDropdown(filtered.slice(0, 500));
    setText(els.coursesStatus, `Found ${filtered.length} matches ✅ (showing first 500)`);
  }

  async function loadCourses() {
    if (!supabaseClient) {
      setText(els.coursesStatus, "Supabase not ready (check config.js + supabase CDN).");
      if (exists(els.ddlCourses)) els.ddlCourses.innerHTML = `<option value="">Courses (Supabase not ready)</option>`;
      return;
    }

    try {
      setText(els.coursesStatus, "Loading courses…");
      if (exists(els.ddlCourses)) els.ddlCourses.innerHTML = `<option value="">Courses (loading…)</option>`;

      const { data, error } = await supabaseClient
        .from("uk_golf_courses")
        .select("name,country,latitude,longitude")
        .order("name", { ascending: true });

      if (error) throw error;

      allCourses = data || [];
      applyCourseFilter();
    } catch (e) {
      console.error("Supabase loadCourses error:", e);
      setText(els.coursesStatus, `Courses error: ${e.message}`);
      if (exists(els.ddlCourses)) els.ddlCourses.innerHTML = `<option value="">Courses (error)</option>`;
    }
  }

  // -------------------- Events --------------------
  if (exists(els.btnSearch)) {
    els.btnSearch.addEventListener("click", async () => {
      const q = (els.txtSearch?.value || "").trim();
      if (!q) return;
      try {
        const place = await geocodePlace(q);
        await showForecastForPlace(place);
      } catch (e) {
        console.error(e);
        setText(els.appStatus, "Couldn’t find that place. Try “London, GB”.");
      }
    });
  }

  if (exists(els.btnGeo)) {
    els.btnGeo.addEventListener("click", () => {
      if (!navigator.geolocation) {
        setText(els.appStatus, "Geolocation not supported.");
        return;
      }
      setText(els.appStatus, "Getting your location…");
      navigator.geolocation.getCurrentPosition(
        (p) => showForecastForPlace({
          name: "My location",
          country: "",
          lat: p.coords.latitude,
          lon: p.coords.longitude
        }),
        () => setText(els.appStatus, "Location blocked or unavailable."),
        { timeout: 12000, maximumAge: 600000 }
      );
    });
  }

  if (exists(els.ddlUnits)) {
    // your HTML uses C/F, map to metric/imperial
    els.ddlUnits.addEventListener("change", async () => {
      units = (els.ddlUnits.value === "F") ? "imperial" : "metric";
      await showForecastForPlace(lastPlace);
    });
  }

  if (exists(els.ddlCourses)) {
    els.ddlCourses.addEventListener("change", async (e) => {
      const opt = e.target.selectedOptions?.[0];
      if (!opt || !opt.dataset.lat) return;

      await showForecastForPlace({
        name: opt.dataset.name,
        country: opt.dataset.country,
        lat: Number(opt.dataset.lat),
        lon: Number(opt.dataset.lon),
      });
    });
  }

  if (exists(els.txtCourseFilter)) {
    els.txtCourseFilter.addEventListener("input", applyCourseFilter);
  }

  // -------------------- Boot --------------------
  (async function init() {
    // default units based on UI value
    if (exists(els.ddlUnits)) {
      els.ddlUnits.value = "C";
      units = "metric";
    }

    await loadCourses();
    await showForecastForPlace(lastPlace);
  })();
})();
