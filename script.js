(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const els = {
    txtSearch: $("txtSearch"),
    btnSearch: $("btnSearch"),
    btnGeo: $("btnGeo"),
    ddlUnits: $("ddlUnits"),
    ddlCourses: $("ddlCourses"),
    txtCourseFilter: $("txtCourseFilter"),
    ddlFavs: $("ddlFavs"),
    btnFavToggle: $("btnFavToggle"),

    dvCityCountry: $("dvCityCountry"),
    dvCurrDate: $("dvCurrDate"),
    dvCurrTemp: $("dvCurrTemp"),
    pFeelsLike: $("pFeelsLike"),
    pHumidity: $("pHumidity"),
    pWind: $("pWind"),
    imgIcon: $("imgCurrentIcon"),

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

    appStatus: $("appStatus"),
    coursesStatus: $("coursesStatus"),
  };

  // ---------- Units ----------
  let units = "metric"; // "metric" or "imperial"

  function windUnit() {
    return units === "imperial" ? "mph" : "m/s";
  }

  // ---------- Icons ----------
  function icon(code) {
    return `https://openweathermap.org/img/wn/${code}@2x.png`;
  }

  // ---------- Basic date formatting ----------
  function fmtDate(d) {
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" });
  }

  // ---------- Playability (simple + robust) ----------
  function playability(it) {
    let score = 10;
    const reasons = [];

    const wind = Number(it?.wind?.speed ?? 0);
    const pop = Number(it?.pop ?? 0);
    const temp = Number(it?.main?.temp ?? 0);

    // Wind penalties (m/s or mph depending on API units)
    if (units === "metric") {
      if (wind > 14) { score -= 4.5; reasons.push("Very windy"); }
      else if (wind > 10) { score -= 3.0; reasons.push("Windy"); }
      else if (wind > 7) { score -= 1.8; reasons.push("Breezy"); }
      else reasons.push("Light wind");
    } else {
      // imperial mph thresholds roughly equivalent
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

    // Temperature comfort (rough)
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

    // Keep it readable
    const summary = [...new Set(reasons)].slice(0, 3).join(" • ");

    return { score, label, reason: summary || "—" };
  }

  // ---------- Best tee time today ----------
  function bestTeeTimeToday(todayItems) {
    if (!todayItems?.length) {
      els.bestTeeTime.textContent = "--";
      els.bestTeeScore.textContent = "--";
      els.bestTeeReason.textContent = "—";
      return;
    }

    let best = null;

    for (const it of todayItems) {
      const p = playability(it);
      if (!best || p.score > best.p.score) best = { it, p };
    }

    const start = best.it._dt;
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);

    const hh = (d) => String(d.getHours()).padStart(2, "0");
    els.bestTeeTime.textContent = `${hh(start)}:00 – ${hh(end)}:00`;
    els.bestTeeScore.textContent = `${best.p.score}/10 (${best.p.label})`;
    els.bestTeeReason.textContent = best.p.reason || "—";
  }

  // ---------- OpenWeather ----------
  async function geocodePlace(query) {
    const url = new URL("https://api.openweathermap.org/geo/1.0/direct");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "1");
    url.searchParams.set("appid", cfg.OPENWEATHER_API_KEY);

    const r = await fetch(url);
    if (!r.ok) throw new Error("Geocode failed");
    const data = await r.json();
    if (!data?.length) throw new Error("No results");
    return { name: data[0].name, country: data[0].country, lat: data[0].lat, lon: data[0].lon };
  }

  async function loadWeather(lat, lon, name, country) {
    try {
      els.appStatus.textContent = "Loading weather…";

      const url = new URL("https://api.openweathermap.org/data/2.5/forecast");
      url.searchParams.set("lat", lat);
      url.searchParams.set("lon", lon);
      url.searchParams.set("units", units);
      url.searchParams.set("appid", cfg.OPENWEATHER_API_KEY);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Forecast error: ${res.status}`);

      const data = await res.json();
      const first = data.list?.[0];
      if (!first) throw new Error("No forecast list");

      // Header
      els.dvCityCountry.textContent = `${name}${country ? `, ${country}` : ""}`;
      const firstDt = new Date(first.dt * 1000);
      els.dvCurrDate.textContent = fmtDate(firstDt);

      // Current
      els.dvCurrTemp.textContent = Math.round(first.main.temp);
      els.pFeelsLike.textContent = Math.round(first.main.feels_like);
      els.pHumidity.textContent = Math.round(first.main.humidity);

      const wind = first.wind?.speed;
      els.pWind.textContent = `${Math.round(wind)} ${windUnit()}`;

      els.imgIcon.src = icon(first.weather?.[0]?.icon || "01d");
      els.imgIcon.alt = first.weather?.[0]?.description || "";

      // Playability (current)
      const p = playability(first);
      els.playScore.textContent = `${p.score}/10 (${p.label})`;
      els.playText.textContent = p.reason;

      // Sunrise / Sunset / Day length (simple display)
      const sunrise = data.city?.sunrise;
      const sunset = data.city?.sunset;

      if (sunrise && sunset) {
        const sr = new Date(sunrise * 1000);
        const ss = new Date(sunset * 1000);

        els.pSunrise.textContent = sr.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        els.pSunset.textContent = ss.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        const lenSec = sunset - sunrise;
        const h = Math.floor(lenSec / 3600);
        const m = Math.floor((lenSec % 3600) / 60);
        els.pDayLength.textContent = `Day length: ${h}h ${String(m).padStart(2, "0")}m`;
      } else {
        els.pSunrise.textContent = "--";
        els.pSunset.textContent = "--";
        els.pDayLength.textContent = "Day length: --";
      }

      // Build day buckets (today for tee time)
      const byDay = {};
      for (const it of data.list) {
        const d = new Date(it.dt * 1000);
        const key = d.toISOString().slice(0, 10);
        if (!byDay[key]) byDay[key] = [];
        byDay[key].push({ ...it, _dt: d });
      }

      const todayKey = Object.keys(byDay)[0];
      bestTeeTimeToday(byDay[todayKey]);

      els.appStatus.textContent = "";
    } catch (err) {
      console.error(err);
      els.appStatus.textContent = "Weather failed to load (check API key / console).";
    }
  }

  // ---------- Supabase (FIXED) ----------
  // IMPORTANT: The CDN exposes window.supabase (NOT supabasejs)
  const supabaseClient =
    (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY)
      ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
      : null;

  async function loadCourses() {
    if (!supabaseClient) {
      els.ddlCourses.innerHTML = `<option value="">Courses (Supabase not ready)</option>`;
      els.coursesStatus.textContent = "Supabase not ready (check config.js + supabase CDN script).";
      return;
    }

    try {
      els.coursesStatus.textContent = "Loading courses…";
      els.ddlCourses.innerHTML = `<option value="">Courses (loading…)</option>`;

      const { data, error } = await supabaseClient
        .from("uk_golf_courses")
        .select("name,country,latitude,longitude")
        .order("name", { ascending: true });

      if (error) throw error;

      const courses = data || [];
      els.ddlCourses.innerHTML = `<option value="">Select course…</option>`;

      for (const c of courses) {
        const opt = document.createElement("option");
        opt.textContent = `${c.name} (${c.country})`;
        opt.dataset.lat = c.latitude;
        opt.dataset.lon = c.longitude;
        opt.dataset.name = c.name;
        opt.dataset.country = c.country;
        els.ddlCourses.appendChild(opt);
      }

      els.coursesStatus.textContent = `${courses.length} courses loaded ✅`;
    } catch (e) {
      console.error("Supabase courses error:", e);
      els.ddlCourses.innerHTML = `<option value="">Courses (error)</option>`;
      els.coursesStatus.textContent = `Courses error: ${e.message}`;
    }
  }

  // ---------- Events ----------
  els.ddlCourses.onchange = async (e) => {
    const opt = e.target.selectedOptions?.[0];
    if (!opt || !opt.dataset.lat) return;

    await loadWeather(
      Number(opt.dataset.lat),
      Number(opt.dataset.lon),
      opt.dataset.name,
      opt.dataset.country
    );
  };

  els.btnSearch.onclick = async () => {
    const q = (els.txtSearch.value || "").trim();
    if (!q) return;
    try {
      const g = await geocodePlace(q);
      await loadWeather(g.lat, g.lon, g.name, g.country);
    } catch (e) {
      console.error(e);
      els.appStatus.textContent = "Couldn’t find that place. Try “London, GB”.";
    }
  };

  els.btnGeo.onclick = () => {
    if (!navigator.geolocation) {
      els.appStatus.textContent = "Geolocation not supported.";
      return;
    }
    els.appStatus.textContent = "Getting your location…";
    navigator.geolocation.getCurrentPosition(
      (p) => loadWeather(p.coords.latitude, p.coords.longitude, "My location", ""),
      () => (els.appStatus.textContent = "Location blocked or unavailable.")
    );
  };

  els.ddlUnits.onchange = async () => {
    units = els.ddlUnits.value === "F" ? "imperial" : "metric";
    // refresh using current city text if possible (simple: reload London)
    // (Better later: store last lat/lon.)
    await loadWeather(51.5072, -0.1276, "London", "GB");
  };

  // ---------- Boot ----------
  (async function init() {
    // default UI
    els.ddlUnits.value = "C";
    units = "metric";

    await loadCourses();
    await loadWeather(51.5072, -0.1276, "London", "GB");
  })();
})();
