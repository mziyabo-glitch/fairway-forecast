(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  // DOM
  const txtSearch = $("txtSearch");
  const btnSearch = $("btnSearch");
  const btnGeo = $("btnGeo");
  const ddlUnits = $("ddlUnits");
  const txtCourseFilter = $("txtCourseFilter");
  const ddlCourses = $("ddlCourses");
  const ddlDay = $("ddlDay");

  const appStatus = $("appStatus");
  const coursesStatus = $("coursesStatus");

  const dvCityCountry = $("dvCityCountry");
  const dvCurrDate = $("dvCurrDate");
  const dvCurrTemp = $("dvCurrTemp");
  const pFeelsLike = $("pFeelsLike");
  const pHumidity = $("pHumidity");
  const pWind = $("pWind");
  const imgCurrentIcon = $("imgCurrentIcon");

  const playScoreEl = $("playScore");
  const playTextEl = $("playText");

  const dailyForecast = $("dailyForecast");
  const hourlyHours = $("hourlyHours");

  function setAppStatus(msg) { if (appStatus) appStatus.textContent = msg || ""; }
  function setCoursesStatus(msg) { if (coursesStatus) coursesStatus.textContent = msg || ""; }

  // Supabase
  const supabase =
    (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
      ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
      : null;

  // State
  let units = cfg.DEFAULT_UNITS || "metric";
  let lastPlace = null;
  let dayBuckets = [];
  let allCourses = [];

  // Helpers
  function iconUrl(code) { return `https://openweathermap.org/img/wn/${code}@2x.png`; }
  function windUnit() { return units === "imperial" ? "mph" : "m/s"; }

  function fmtDate(dt) {
    return dt.toLocaleDateString(undefined, { weekday:"long", year:"numeric", month:"short", day:"numeric" });
  }
  function fmtDayLabel(dt) {
    return dt.toLocaleDateString(undefined, { weekday:"long", month:"short", day:"numeric" });
  }
  function fmtDayShort(dt) {
    return dt.toLocaleDateString(undefined, { weekday:"short" });
  }
  function fmtTime(dt) {
    return dt.toLocaleTimeString(undefined, { hour:"2-digit", minute:"2-digit" });
  }

  // Conversions (score always done in metric under the hood)
  function fToC(f){ return (f - 32) * (5/9); }
  function mphToMs(mph){ return mph * 0.44704; }

  // ========= Playability =========
  function calcPlayability(item) {
    const temp = item?.main?.temp;
    const wind = item?.wind?.speed;
    const pop = typeof item?.pop === "number" ? item.pop : 0;
    const rainMm = typeof item?.rain?.["3h"] === "number" ? item.rain["3h"] : 0;

    const tempC = (typeof temp === "number") ? (units === "imperial" ? fToC(temp) : temp) : null;
    const windMs = (typeof wind === "number") ? (units === "imperial" ? mphToMs(wind) : wind) : null;

    let score = 10;
    const reasons = [];

    // Wind penalties
    if (windMs != null) {
      if (windMs > 14) { score -= 4.5; reasons.push("Very windy"); }
      else if (windMs > 10) { score -= 3.0; reasons.push("Windy"); }
      else if (windMs > 7) { score -= 1.8; reasons.push("Breezy"); }
      else reasons.push("Light wind");
    }

    // Rain risk + amount
    if (pop >= 0.7) { score -= 2.5; reasons.push("High rain risk"); }
    else if (pop >= 0.4) { score -= 1.5; reasons.push("Some rain risk"); }
    else if (pop >= 0.2) { score -= 0.6; reasons.push("Low rain risk"); }
    else reasons.push("Dry");

    if (rainMm >= 4) { score -= 2.0; reasons.push("Heavy showers"); }
    else if (rainMm >= 1) { score -= 1.0; reasons.push("Showers"); }
    else if (rainMm > 0) { score -= 0.4; reasons.push("Light drizzle"); }

    // Temperature comfort
    if (tempC != null) {
      if (tempC < 2) { score -= 2.0; reasons.push("Very cold"); }
      else if (tempC < 8) { score -= 1.0; reasons.push("Chilly"); }
      else if (tempC > 30) { score -= 2.0; reasons.push("Very hot"); }
      else if (tempC > 25) { score -= 1.0; reasons.push("Warm"); }
      else reasons.push("Comfortable");
    }

    score = Math.max(0, Math.min(10, score));
    const scoreRounded = Math.round(score * 10) / 10;

    let label = "OK";
    if (scoreRounded >= 8.5) label = "Excellent";
    else if (scoreRounded >= 7) label = "Good";
    else if (scoreRounded >= 5) label = "Fair";
    else label = "Poor";

    const priority = ["Very windy","Windy","High rain risk","Heavy showers","Showers","Very cold","Very hot","Breezy","Some rain risk","Chilly","Warm"];
    const picked = [];
    for (const p of priority) if (reasons.includes(p) && picked.length < 3) picked.push(p);
    for (const r of reasons) { if (picked.length >= 3) break; if (!picked.includes(r)) picked.push(r); }

    return { score: scoreRounded, label, summary: picked.join(" • ") };
  }

  function renderPlayability(item) {
    const { score, label, summary } = calcPlayability(item);
    if (playScoreEl) playScoreEl.textContent = `${score}/10 — ${label}`;
    if (playTextEl) playTextEl.textContent = summary || "—";
  }

  function pickMiddayItem(items) {
    // pick item closest to 12:00 UTC (simple + consistent)
    let best = items[0];
    let bestScore = Infinity;
    for (const it of items) {
      const h = it._dt.getUTCHours();
      const score = Math.abs(h - 12);
      if (score < bestScore) { best = it; bestScore = score; }
    }
    return best;
  }

  // ========= OpenWeather =========
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

  async function reverseGeocode(lat, lon) {
    const url = new URL("https://api.openweathermap.org/geo/1.0/reverse");
    url.searchParams.set("lat", lat);
    url.searchParams.set("lon", lon);
    url.searchParams.set("limit", "1");
    url.searchParams.set("appid", cfg.OPENWEATHER_API_KEY);

    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;

    const g = data[0];
    return { name: g.name || "My location", country: g.country || "", lat, lon };
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

  function buildDayBuckets(forecast) {
    const items = forecast.list || [];
    const byDay = new Map();

    for (const it of items) {
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

    const icon = first.weather?.[0]?.icon;
    const desc = first.weather?.[0]?.description || "";
    if (icon) { imgCurrentIcon.src = iconUrl(icon); imgCurrentIcon.alt = desc; }

    // current playability based on current forecast item
    renderPlayability(first);
  }

  function renderDaily(buckets) {
    dailyForecast.innerHTML = "";

    buckets.forEach((b) => {
      const midday = pickMiddayItem(b.items);
      const dailyScore = calcPlayability(midday);

      const temps = b.items.map(x => x.main?.temp).filter(n => typeof n === "number");
      const min = temps.length ? Math.min(...temps) : null;
      const max = temps.length ? Math.max(...temps) : null;

      const icon = midday.weather?.[0]?.icon || b.items[0].weather?.[0]?.icon || "";
      const dayShort = fmtDayShort(b.items[0]._dt);

      const card = document.createElement("div");
      card.className = "block dailyCard";
      card.innerHTML = `
        <div class="dailyTopRow">
          <div class="daily__dayname">${dayShort}</div>
          <div class="dailyScore">${dailyScore.score}/10</div>
        </div>
        ${icon ? `<img src="${iconUrl(icon)}" width="40" height="40" alt="">` : ``}
        <div class="daily__temps">
          <span class="daily__max">${max != null ? Math.round(max) : "--"}°</span>
          <span class="daily__min">${min != null ? Math.round(min) : "--"}°</span>
        </div>
        <div class="hourly__meta">${dailyScore.label}</div>
      `;

      dailyForecast.appendChild(card);
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

  function renderHourly(bucket) {
    hourlyHours.innerHTML = "";
    bucket.items.slice(0, 8).forEach((it) => {
      const icon = it.weather?.[0]?.icon || "";
      const temp = it.main?.temp;
      const pop = typeof it.pop === "number" ? Math.round(it.pop * 100) : null;

      const card = document.createElement("div");
      card.className = "hourlyCard";
      card.innerHTML = `
        <div class="hourly__time">${fmtTime(it._dt)}</div>
        ${icon ? `<img src="${iconUrl(icon)}" width="40" height="40" alt="">` : ``}
        <div class="hourly__temp">${typeof temp === "number" ? Math.round(temp) : "--"}°</div>
        <div class="hourly__meta">${pop != null ? `Rain: ${pop}%` : ""}</div>
      `;
      hourlyHours.appendChild(card);
    });

    // ALSO update main playability when you change day (use midday item for that day)
    const midday = pickMiddayItem(bucket.items);
    if (midday) renderPlayability(midday);
  }

  async function showForecastForPlace(place) {
    setAppStatus("Loading weather...");
    const forecast = await fetchForecast(place.lat, place.lon);

    lastPlace = place;
    dayBuckets = buildDayBuckets(forecast);

    populateDayDropdown(dayBuckets);
    renderCurrent(place, forecast);
    renderDaily(dayBuckets);
    if (dayBuckets[0]) renderHourly(dayBuckets[0]);

    setAppStatus("");
  }

  // ========= Courses =========
  function normalise(s) {
    return (s || "").toString().toLowerCase().trim().replace(/\s+/g, " ");
  }

  function fillCoursesDropdown(list) {
    ddlCourses.innerHTML = `<option value="">Select a course...</option>`;
    for (const c of list) {
      const opt = document.createElement("option");
      opt.textContent = `${c.name} (${c.country})`;
      opt.dataset.lat = c.latitude;
      opt.dataset.lon = c.longitude;
      opt.dataset.name = c.name;
      opt.dataset.country = c.country;
      ddlCourses.appendChild(opt);
    }
  }

  function applyCourseFilter() {
    const q = normalise(txtCourseFilter.value);
    if (!q) {
      fillCoursesDropdown(allCourses.slice(0, 500));
      setCoursesStatus(`Loaded ${allCourses.length} courses ✅ (showing first 500)`);
      return;
    }
    const filtered = allCourses.filter(c =>
      normalise(c.name).includes(q) || normalise(c.country).includes(q)
    );
    fillCoursesDropdown(filtered.slice(0, 500));
    setCoursesStatus(`Found ${filtered.length} matches ✅ (showing first 500)`);
  }

  async function loadCourses() {
    if (!supabase) {
      setCoursesStatus("Supabase not initialised. Check SUPABASE_URL + SUPABASE_ANON_KEY in config.js");
      ddlCourses.innerHTML = `<option value="">Courses (Supabase not ready)</option>`;
      return;
    }

    setCoursesStatus("Loading courses from Supabase…");
    ddlCourses.innerHTML = `<option value="">Courses (loading...)</option>`;

    const { data, error } = await supabase
      .from("uk_golf_courses")
      .select("name,country,latitude,longitude")
      .order("name", { ascending: true });

    if (error) {
      console.error("Supabase error:", error);
      ddlCourses.innerHTML = `<option value="">Courses (error)</option>`;
      setCoursesStatus(`Supabase error: ${error.message}`);
      return;
    }

    allCourses = data || [];
    if (allCourses.length === 0) {
      ddlCourses.innerHTML = `<option value="">No courses found</option>`;
      setCoursesStatus("No rows found in uk_golf_courses.");
      return;
    }

    applyCourseFilter();
  }

  // ========= Events =========
  btnSearch?.addEventListener("click", async () => {
    const q = (txtSearch?.value || "").trim();
    if (!q) return;

    try {
      const place = await geocodePlace(q);
      await showForecastForPlace(place);
    } catch (e) {
      console.error(e);
      setAppStatus("Couldn’t find that place. Try “London, GB” or “Dublin, IE”.");
    }
  });

  txtSearch?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnSearch?.click();
  });

  btnGeo?.addEventListener("click", async () => {
    if (!navigator.geolocation) {
      setAppStatus("Geolocation not supported in this browser.");
      return;
    }

    setAppStatus("Getting your location…");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;

          // Try to display a nice name
          const place = (await reverseGeocode(lat, lon)) || { name: "My location", country: "", lat, lon };
          await showForecastForPlace(place);
        } catch (e) {
          console.error(e);
          setAppStatus("Could not load weather for your location.");
        }
      },
      (err) => {
        console.error(err);
        if (err.code === 1) setAppStatus("Location permission denied.");
        else setAppStatus("Could not get your location.");
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }
    );
  });

  ddlUnits?.addEventListener("change", async () => {
    const v = ddlUnits.value;
    if (v === "F") units = "imperial";
    else if (v === "C") units = "metric";
    else return;

    if (lastPlace) await showForecastForPlace(lastPlace);
  });

  txtCourseFilter?.addEventListener("input", applyCourseFilter);
  txtCourseFilter?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (ddlCourses.options.length > 1) {
        ddlCourses.selectedIndex = 1;
        ddlCourses.dispatchEvent(new Event("change"));
      }
    }
  });

  ddlCourses?.addEventListener("change", async () => {
    const opt = ddlCourses.selectedOptions[0];
    if (!opt || !opt.dataset.lat) return;

    await showForecastForPlace({
      name: opt.dataset.name,
      country: opt.dataset.country,
      lat: Number(opt.dataset.lat),
      lon: Number(opt.dataset.lon),
    });
  });

  ddlDay?.addEventListener("change", () => {
    const key = ddlDay.value;
    const bucket = dayBuckets.find(b => b.key === key);
    if (bucket) renderHourly(bucket);
  });

  // Boot
  (async function init() {
    ddlUnits.value = units === "imperial" ? "F" : "C";

    await loadCourses();

    try {
      await showForecastForPlace({ name: "London", country: "GB", lat: 51.5072, lon: -0.1276 });
    } catch (e) {
      console.error(e);
      setAppStatus("Weather could not load (check OpenWeather key).");
    }
  })();
})();
