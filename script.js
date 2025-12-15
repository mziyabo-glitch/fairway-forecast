// script.js  (GitHub Pages + Supabase + OpenWeather 2.5/forecast)
// Works with Supabase table: public.uk_golf_courses (name, latitude, longitude, country)

(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  // DOM
  const txtSearch = $("txtSearch");
  const btnSearch = $("btnSearch");
  const ddlUnits = $("ddlUnits");
  const ddlCourses = $("ddlCourses");
  const ddlDay = $("ddlDay");
  const statusEl = $("appStatus");

  const dvCityCountry = $("dvCityCountry");
  const dvCurrDate = $("dvCurrDate");
  const dvCurrTemp = $("dvCurrTemp");
  const pFeelsLike = $("pFeelsLike");
  const pHumidity = $("pHumidity");
  const pWind = $("pWind");
  const pPrecipitation = $("pPrecipitation");
  const imgCurrentIcon = $("imgCurrentIcon");

  // Status
  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  // Quick config check
  function configOk() {
    if (!cfg.SUPABASE_URL) return "Missing SUPABASE_URL in config.js";
    if (!cfg.SUPABASE_ANON_KEY) return "Missing SUPABASE_ANON_KEY in config.js";
    if (!cfg.OPENWEATHER_API_KEY) return "Missing OPENWEATHER_API_KEY in config.js";
    return "";
  }
  const cfgProblem = configOk();
  if (cfgProblem) {
    setStatus(cfgProblem);
    console.error(cfgProblem, cfg);
  }

  // Supabase
  const supabase = (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  // State
  let units = cfg.DEFAULT_UNITS || "metric"; // metric|imperial
  let lastPlace = null;
  let dayBuckets = [];

  // Helpers
  function iconUrl(code) {
    return `https://openweathermap.org/img/wn/${code}@2x.png`;
  }
  function windUnit() {
    return units === "imperial" ? "mph" : "m/s";
  }
  function precipUnit() {
    return units === "imperial" ? "in" : "mm";
  }
  function mmToIn(mm) {
    return mm / 25.4;
  }
  function fmtDate(dt) {
    return dt.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  function fmtDayLabel(dt) {
    return dt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }
  function fmtDayShort(dt) {
    return dt.toLocaleDateString(undefined, { weekday: "short" });
  }
  function fmtTime(dt) {
    return dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  // ===== OpenWeather =====

  // For search box (city search)
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

  // Your required endpoint
  async function fetchForecast(lat, lon) {
    const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("units", units);
    url.searchParams.set("appid", cfg.OPENWEATHER_API_KEY);

    const res = await fetch(url);
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      throw new Error(`Forecast failed: ${res.status} ${msg}`);
    }
    return res.json();
  }

  // Group 3-hour items into up to 5 day buckets
  function buildDayBuckets(forecast) {
    const items = forecast.list || [];
    const byDay = new Map();

    for (const it of items) {
      // Parse dt_txt; treat as UTC-ish for grouping (good enough)
      const dt = it.dt_txt ? new Date(it.dt_txt.replace(" ", "T") + "Z") : new Date(it.dt * 1000);
      const key = dt.toISOString().slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push({ ...it, _dt: dt });
    }

    return Array.from(byDay.entries())
      .slice(0, 5)
      .map(([key, arr]) => {
        arr.sort((a, b) => a.dt - b.dt);
        return { key, label: fmtDayLabel(arr[0]._dt), items: arr };
      });
  }

  function pickDailyIcon(items) {
    // pick item closest to 12:00 for daily icon
    let best = items[0];
    let bestScore = Infinity;
    for (const it of items) {
      const h = it._dt.getUTCHours();
      const score = Math.abs(h - 12);
      if (score < bestScore) { best = it; bestScore = score; }
    }
    return best.weather?.[0]?.icon || items[0].weather?.[0]?.icon || "";
  }

  function renderCurrent(place, forecast) {
    const first = forecast.list?.[0];
    if (!first) return;

    const cityName = forecast.city?.name || place.name || "—";
    const country = forecast.city?.country || place.country || "";
    dvCityCountry.textContent = `${cityName}${country ? `, ${country}` : ""}`;

    const dt = first.dt_txt ? new Date(first.dt_txt.replace(" ", "T") + "Z") : new Date(first.dt * 1000);
    dvCurrDate.textContent = fmtDate(dt);

    dvCurrTemp.textContent = Math.round(first.main?.temp ?? 0);
    pFeelsLike.textContent = Math.round(first.main?.feels_like ?? first.main?.temp ?? 0);
    pHumidity.textContent = Math.round(first.main?.humidity ?? 0);

    const wind = first.wind?.speed;
    pWind.textContent = (typeof wind === "number") ? `${Math.round(wind)} ${windUnit()}` : "—";

    const rain = first.rain?.["3h"] ?? 0;
    const snow = first.snow?.["3h"] ?? 0;
    const mm = (typeof rain === "number" ? rain : 0) + (typeof snow === "number" ? snow : 0);
    const val = units === "imperial" ? mmToIn(mm) : mm;
    pPrecipitation.textContent = `${val.toFixed(1)} ${precipUnit()}`;

    const icon = first.weather?.[0]?.icon;
    const desc = first.weather?.[0]?.description || "";
    if (icon) {
      imgCurrentIcon.src = iconUrl(icon);
      imgCurrentIcon.alt = desc;
    }
  }

  function renderDailyFromBuckets(buckets) {
    // Clear 7 boxes
    for (let i = 1; i <= 7; i++) {
      const host = $(`dvForecastDay${i}`);
      if (host) host.innerHTML = "";
    }

    // Fill up to 5 days (API gives ~5)
    buckets.slice(0, 5).forEach((b, idx) => {
      const host = $(`dvForecastDay${idx + 1}`);
      if (!host) return;

      const temps = b.items.map(x => x.main?.temp).filter(n => typeof n === "number");
      const min = temps.length ? Math.min(...temps) : null;
      const max = temps.length ? Math.max(...temps) : null;

      const icon = pickDailyIcon(b.items);
      const dayShort = fmtDayShort(b.items[0]._dt);

      host.innerHTML = `
        <div class="daily__dayname">${dayShort}</div>
        ${icon ? `<img class="daily__icon" src="${iconUrl(icon)}" alt="" width="40" height="40">` : ``}
        <div class="daily__temps">
          <span class="daily__max">${max != null ? Math.round(max) : "--"}°</span>
          <span class="daily__min">${min != null ? Math.round(min) : "--"}°</span>
        </div>
      `;
    });
  }

  function populateDayDropdown(buckets) {
    ddlDay.innerHTML = "";
    buckets.forEach((b, i) => {
      const opt = document.createElement("option");
      opt.value = b.key;
      opt.textContent = b.label;
      if (i === 0) opt.selected = true;
      ddlDay.appendChild(opt);
    });
  }

  function renderHourlyForBucket(bucket) {
    // Clear 24 boxes
    for (let i = 1; i <= 24; i++) {
      const host = $(`dvForecastHour${i}`);
      if (host) host.innerHTML = "";
    }

    // 3-hour steps => up to 8 slots/day
    const items = bucket.items.slice(0, 8);
    items.forEach((it, idx) => {
      const host = $(`dvForecastHour${idx + 1}`);
      if (!host) return;

      const dt = it._dt;
      const icon = it.weather?.[0]?.icon || "";
      const temp = it.main?.temp;
      const pop = typeof it.pop === "number" ? Math.round(it.pop * 100) : null;

      host.innerHTML = `
        <div class="hourly__time">${fmtTime(dt)}</div>
        ${icon ? `<img class="hourly__icon" src="${iconUrl(icon)}" alt="" width="40" height="40">` : ``}
        <div class="hourly__temp">${typeof temp === "number" ? Math.round(temp) : "--"}°</div>
        <div class="hourly__meta">${pop != null ? `Rain: ${pop}%` : ""}</div>
      `;
    });
  }

  async function showForecastForPlace(place) {
    setStatus("Loading weather...");
    const forecast = await fetchForecast(place.lat, place.lon);

    lastPlace = place;
    dayBuckets = buildDayBuckets(forecast);

    populateDayDropdown(dayBuckets);
    renderCurrent(place, forecast);
    renderDailyFromBuckets(dayBuckets);

    const bucket = dayBuckets[0];
    if (bucket) renderHourlyForBucket(bucket);

    setStatus("");
  }

  // expose for debugging (optional)
  window.showForecastForPlace = showForecastForPlace;

  // ===== Supabase courses =====
  async function loadCourses() {
    if (!ddlCourses) return;

    if (!supabase) {
      ddlCourses.innerHTML = `<option value="">Courses (Supabase not ready)</option>`;
      setStatus("Supabase not ready (check config.js / CDN).");
      return;
    }

    setStatus("Loading courses...");
    ddlCourses.innerHTML = `<option value="">Courses (loading...)</option>`;

    const { data, error } = await supabase
      .from("uk_golf_courses")
      .select("name,country,latitude,longitude")
      .order("name", { ascending: true });

    if (error) {
      console.error("Supabase error:", error);
      ddlCourses.innerHTML = `<option value="">Courses (error)</option>`;
      setStatus(`Supabase error: ${error.message}`);
      return;
    }

    if (!data || data.length === 0) {
      ddlCourses.innerHTML = `<option value="">No courses found</option>`;
      setStatus("No courses found in uk_golf_courses.");
      return;
    }

    ddlCourses.innerHTML = `<option value="">Select a course...</option>`;

    data.forEach(c => {
      const opt = document.createElement("option");
      opt.textContent = `${c.name} (${c.country})`;
      opt.dataset.lat = c.latitude;
      opt.dataset.lon = c.longitude;
      opt.dataset.name = c.name;
      opt.dataset.country = c.country;
      ddlCourses.appendChild(opt);
    });

    setStatus("");
  }

  // ===== Events =====
  btnSearch?.addEventListener("click", async () => {
    const q = (txtSearch?.value || "").trim();
    if (!q) return;

    try {
      const place = await geocodePlace(q);
      await showForecastForPlace(place);
    } catch (e) {
      console.error(e);
      setStatus("Couldn’t find that place. Try “Swindon, UK”.");
    }
  });

  txtSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnSearch?.click();
  });

  ddlUnits?.addEventListener("change", async () => {
    const v = ddlUnits.value;
    if (v === "F") units = "imperial";
    else if (v === "C") units = "metric";
    else return;

    if (lastPlace) {
      try { await showForecastForPlace(lastPlace); } catch (e) { console.error(e); }
    }
  });

  ddlCourses?.addEventListener("change", async () => {
    const opt = ddlCourses.selectedOptions[0];
    if (!opt || !opt.dataset.lat) return;

    const place = {
      name: opt.dataset.name,
      country: opt.dataset.country,
      lat: Number(opt.dataset.lat),
      lon: Number(opt.dataset.lon),
    };

    try {
      await showForecastForPlace(place);
    } catch (e) {
      console.error(e);
      setStatus("Weather failed for that course (check lat/lon).");
    }
  });

  ddlDay?.addEventListener("change", () => {
    const key = ddlDay.value;
    const bucket = dayBuckets.find(b => b.key === key);
    if (bucket) renderHourlyForBucket(bucket);
  });

  // ===== Boot =====
  (async function init() {
    ddlUnits.value = units === "imperial" ? "F" : "C";

    await loadCourses();

    // Default weather view
    try {
      await showForecastForPlace({ name: "Berlin", country: "DE", lat: 52.52, lon: 13.405 });
    } catch (e) {
      console.error(e);
      setStatus("Weather could not load (check OpenWeather key).");
    }
  })();
})();
