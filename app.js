/* =====================================================
   Fairway Forecast – app.js
   Robust bindings (Search never breaks), autocomplete,
   Geo locate + 20 mile radius, Current/Hourly/Daily tabs
   Cloudflare Worker endpoints:
     GET /courses?search=...
     GET /weather?lat=...&lon=...&units=metric|imperial
   ===================================================== */

(() => {
  "use strict";

  const API_BASE = "https://fairway-forecast-api.mziyabo.workers.dev";
  const RADIUS_MILES = 20;
  const SUGGEST_LIMIT = 8;

  /* ---------- DOM helpers ---------- */
  const $id = (id) => document.getElementById(id);
  const $qs = (sel, root = document) => root.querySelector(sel);
  const $qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Find first that exists
  function pick(...els) {
    return els.find(Boolean) || null;
  }

  // Try multiple IDs + fallbacks so minor HTML changes don’t break JS.
  function resolveDom() {
    const resultsEl =
      pick($id("results"), $qs(".ff-results"), $qs("[data-results]"));

    const playabilityScoreEl =
      pick($id("playabilityScore"), $qs("[data-playability]"));

    // Search input
    const searchInput = pick(
      $id("searchInput"),
      $id("q"),
      $id("search"),
      $qs('input[type="search"]'),
      $qs('input[placeholder*="Search"]'),
      $qs('input[placeholder*="course"]')
    );

    // Search button
    const searchBtn = pick(
      $id("searchBtn"),
      $id("btnSearch"),
      $qs('button[type="submit"]'),
      $qsa("button").find((b) => (b.textContent || "").trim().toLowerCase() === "search")
    );

    // Optional geo button (⌖)
    const geoBtn = pick(
      $id("btnGeo"),
      $id("geoBtn"),
      $qs('button[aria-label*="location"]'),
      $qsa("button").find((b) => (b.textContent || "").includes("⌖") || (b.textContent || "").includes("⨁") || (b.textContent || "").includes("◎") || (b.textContent || "").includes("📍"))
    );

    // Units select
    const unitsSelect = pick(
      $id("unitsSelect"),
      $id("units"),
      $id("unitSelect"),
      $qs("select")
    );

    // Tabs
    const tabCurrent = pick($id("tabCurrent"), $qsa("button").find((b) => /current/i.test(b.textContent || "")));
    const tabHourly = pick($id("tabHourly"), $qsa("button").find((b) => /hourly/i.test(b.textContent || "")));
    const tabDaily = pick($id("tabDaily"), $qsa("button").find((b) => /daily/i.test(b.textContent || "")));

    // Form (if present)
    const form = pick(
      $qs("form"),
      searchInput?.closest("form")
    );

    // Controls card (for suggestions positioning)
    const controlsCard = pick(
      searchInput?.closest(".ff-card"),
      $qs(".ff-controls"),
      searchInput?.parentElement
    );

    return {
      resultsEl,
      playabilityScoreEl,
      searchInput,
      searchBtn,
      geoBtn,
      unitsSelect,
      tabCurrent,
      tabHourly,
      tabDaily,
      form,
      controlsCard,
    };
  }

  const dom = resolveDom();

  if (!dom.resultsEl || !dom.searchInput) {
    console.warn("Missing core DOM nodes (results/searchInput). App running in reduced mode.");
  }

  /* ---------- State ---------- */
  let selectedCourse = null;
  let lastWeather = null;
  let lastUserPos = null; // {lat, lon}
  let lastCourses = [];
  let suggestEl = null;
  let suggestTimer = null;

  /* ---------- Utils ---------- */
  const esc = (s) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function getUnits() {
    const v = (dom.unitsSelect?.value || "metric").toLowerCase();
    return v.includes("imperial") ? "imperial" : "metric";
  }

  function setActiveTab(tab) {
    [dom.tabCurrent, dom.tabHourly, dom.tabDaily].forEach((b) => b?.classList.remove("active"));
    tab?.classList.add("active");
  }

  function showMessage(msg) {
    if (!dom.resultsEl) return;
    dom.resultsEl.innerHTML = `<div class="ff-card muted">${esc(msg)}</div>`;
  }

  function milesToKm(mi) { return mi * 1.609344; }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function formatTimeFromUnix(unix, tzOffsetSeconds) {
    if (!unix) return "—";
    const ms = (unix + (tzOffsetSeconds || 0)) * 1000;
    const d = new Date(ms);
    // Use UTC methods because we applied tz offset manually
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function inDaylight(unix, sunrise, sunset) {
    return sunrise && sunset && unix >= sunrise && unix <= sunset;
  }

  function bestTeeTimeFromForecast(weather) {
    // Choose best time during daylight from next 24h forecast:
    // Prefer lowest PoP, then lower wind, then moderate temp.
    const sunrise = weather?.current?.sunrise;
    const sunset = weather?.current?.sunset;
    const tz = weather?.current?.timezone_offset ?? weather?.timezone_offset ?? 0;

    const list = Array.isArray(weather?.forecast?.list) ? weather.forecast.list
               : Array.isArray(weather?.hourly) ? weather.hourly
               : [];

    if (!list.length || !sunrise || !sunset) return null;

    const scored = list
      .map((x) => {
        const dt = x.dt;
        if (!inDaylight(dt, sunrise, sunset)) return null;

        const pop = Number(x.pop ?? x.rain?.["3h"] ?? 0); // pop 0..1 typical
        const wind = Number(x.wind?.speed ?? x.wind_speed ?? 0);
        const temp = Number(x.main?.temp ?? x.temp ?? 0);

        // score: lower is better
        const popScore = pop * 100;
        const windScore = wind * 4;
        const tempPenalty = (getUnits() === "metric")
          ? (temp < 6 ? (6 - temp) * 2 : temp > 28 ? (temp - 28) * 2 : 0)
          : (temp < 45 ? (45 - temp) * 1.5 : temp > 82 ? (temp - 82) * 1.5 : 0);

        const score = popScore + windScore + tempPenalty;
        return { dt, score };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score);

    if (!scored.length) return null;

    return {
      dt: scored[0].dt,
      label: formatTimeFromUnix(scored[0].dt, tz),
    };
  }

  /* ---------- API ---------- */
  async function fetchJson(url) {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.error || data?.message || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  async function fetchCourses(search) {
    const url = `${API_BASE}/courses?search=${encodeURIComponent(search)}`;
    const data = await fetchJson(url);
    return Array.isArray(data?.courses) ? data.courses : [];
  }

  async function fetchWeather(lat, lon) {
    const units = getUnits();
    const url = `${API_BASE}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${encodeURIComponent(units)}`;
    return await fetchJson(url);
  }

  /* ---------- Rendering ---------- */
  function courseTitle(course) {
    const name = course?.club_name || course?.name || course?.course_name || "Course";
    const city = course?.city || "";
    return `${name}${city ? ` — ${city}` : ""}`;
  }

  function renderHeader(course) {
    if (!dom.resultsEl || !course) return;
    const name = esc(courseTitle(course));
    const region = esc([course?.city, course?.state, course?.country].filter(Boolean).join(", "));
    dom.resultsEl.insertAdjacentHTML("afterbegin", `
      <div class="ff-card">
        <div class="ff-course-name">${name}</div>
        <div class="ff-course-sub">${region}</div>
      </div>
    `);
  }

  function renderCurrent(weather, course) {
    if (!dom.resultsEl) return;

    const c = weather?.current || {};
    const tz = c.timezone_offset ?? weather?.timezone_offset ?? 0;

    const icon = c.weather?.[0]?.icon
      ? `https://openweathermap.org/img/wn/${c.weather[0].icon}@2x.png`
      : "";

    const desc = esc(c.weather?.[0]?.description || "—");
    const temp = (c.temp ?? c.main?.temp);
    const t = temp != null ? Math.round(Number(temp)) : "--";

    const wind = Number(c.wind?.speed ?? c.wind_speed ?? 0);
    const gust = Number(c.wind?.gust ?? c.wind_gust ?? 0);

    // Rain chance: if your worker returns forecast list with pop, take nearest
    let popPct = null;
    const list = Array.isArray(weather?.forecast?.list) ? weather.forecast.list : [];
    if (list.length) {
      popPct = Math.round(Number(list[0]?.pop ?? 0) * 100);
    } else if (c.pop != null) {
      popPct = Math.round(Number(c.pop) * 100);
    }

    const sunrise = formatTimeFromUnix(c.sunrise, tz);
    const sunset = formatTimeFromUnix(c.sunset, tz);

    const best = bestTeeTimeFromForecast(weather);
    const bestLabel = best ? best.label : "—";

    dom.resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-row">
          ${icon ? `<img class="ff-icon" alt="" src="${icon}" />` : ""}
          <div>
            <div class="ff-big">${t}°</div>
            <div class="ff-sub">${desc}</div>
          </div>
        </div>

        <div class="ff-course-list" style="margin-top:14px">
          <div class="ff-course" style="cursor:default">
            <div class="ff-course-name">Wind</div>
            <div class="ff-course-sub">${wind.toFixed(1)} ${getUnits()==="imperial" ? "mph" : "m/s"} ${gust ? `• Gust ${gust.toFixed(1)}` : ""}</div>
          </div>

          <div class="ff-course" style="cursor:default">
            <div class="ff-course-name">Rain chance</div>
            <div class="ff-course-sub">${popPct == null ? "—" : `${popPct}%`}</div>
          </div>

          <div class="ff-course" style="cursor:default">
            <div class="ff-course-name">Sun</div>
            <div class="ff-course-sub">Sunrise ${sunrise} • Sunset ${sunset} • Best tee time ${bestLabel}</div>
          </div>
        </div>
      </div>
    `;

    // Re-insert course header above current card (nice context)
    if (course) renderHeader(course);

    // Playability
    const score = calculatePlayability(weather);
    if (dom.playabilityScoreEl) dom.playabilityScoreEl.textContent = `${score}/10`;
  }

  function renderHourly(weather, course) {
    if (!dom.resultsEl) return;

    const tz = weather?.current?.timezone_offset ?? weather?.timezone_offset ?? 0;
    const list = Array.isArray(weather?.forecast?.list) ? weather.forecast.list : [];

    if (!list.length) {
      dom.resultsEl.innerHTML = `<div class="ff-card muted">Hourly data not available.</div>`;
      if (course) renderHeader(course);
      return;
    }

    const items = list.slice(0, 8).map((x) => {
      const dt = formatTimeFromUnix(x.dt, tz);
      const icon = x.weather?.[0]?.icon
        ? `https://openweathermap.org/img/wn/${x.weather[0].icon}@2x.png`
        : "";
      const temp = Math.round(Number(x.main?.temp ?? x.temp ?? 0));
      const pop = Math.round(Number(x.pop ?? 0) * 100);
      const wind = Number(x.wind?.speed ?? 0);

      return `
        <div class="ff-course" style="min-width:150px; text-align:center; cursor:default">
          <div class="ff-course-name">${dt}</div>
          ${icon ? `<img alt="" src="${icon}" style="width:56px;height:56px;margin:10px auto 6px;opacity:.95" />` : ""}
          <div style="font-weight:900;font-size:22px">${temp}°</div>
          <div class="ff-course-sub">${pop}% • ${wind.toFixed(1)} ${getUnits()==="imperial" ? "mph" : "m/s"}</div>
        </div>
      `;
    }).join("");

    dom.resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-course-name">Hourly</div>
        <div class="ff-course-sub">Next 24 hours (3-hour blocks)</div>
        <div style="display:flex; gap:12px; overflow:auto; padding-top:12px">
          ${items}
        </div>
      </div>
    `;
    if (course) renderHeader(course);
  }

  function renderDaily(weather, course) {
    if (!dom.resultsEl) return;

    // Build daily from 3-hour forecast: pick min/max temp + highest pop per day (up to 7)
    const tz = weather?.current?.timezone_offset ?? weather?.timezone_offset ?? 0;
    const list = Array.isArray(weather?.forecast?.list) ? weather.forecast.list : [];
    if (!list.length) {
      dom.resultsEl.innerHTML = `<div class="ff-card muted">Daily data not available.</div>`;
      if (course) renderHeader(course);
      return;
    }

    const days = new Map();

    for (const x of list) {
      const localMs = (x.dt + tz) * 1000;
      const d = new Date(localMs);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;

      const temp = Number(x.main?.temp ?? x.temp ?? 0);
      const pop = Number(x.pop ?? 0);
      const icon = x.weather?.[0]?.icon || null;
      const main = x.weather?.[0]?.main || "";

      if (!days.has(key)) {
        days.set(key, {
          key,
          date: new Date(localMs),
          min: temp,
          max: temp,
          pop,
          icon,
          main
        });
      } else {
        const o = days.get(key);
        o.min = Math.min(o.min, temp);
        o.max = Math.max(o.max, temp);
        o.pop = Math.max(o.pop, pop);
        // keep an icon from the worst pop period
        if (pop >= o.pop && icon) o.icon = icon;
        if (pop >= o.pop && main) o.main = main;
      }
    }

    const arr = Array.from(days.values()).slice(0, 7);

    const cards = arr.map((d) => {
      const wd = d.date.toLocaleDateString(undefined, { weekday:"short", day:"2-digit", month:"short" });
      const pop = Math.round(d.pop * 100);
      const icon = d.icon ? `https://openweathermap.org/img/wn/${d.icon}@2x.png` : "";
      const hi = Math.round(d.max);
      const lo = Math.round(d.min);

      return `
        <div class="ff-course" style="cursor:default; display:flex; align-items:center; justify-content:space-between; gap:12px">
          <div>
            <div class="ff-course-name">${esc(wd)}</div>
            <div class="ff-course-sub">${esc(d.main || "—")} • ${pop}%</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px">
            ${icon ? `<img alt="" src="${icon}" style="width:56px;height:56px;opacity:.95" />` : ""}
            <div style="font-weight:900; white-space:nowrap">${hi}° ${lo}°</div>
          </div>
        </div>
      `;
    }).join("");

    dom.resultsEl.innerHTML = `
      <div class="ff-card">
        <div class="ff-course-name">Daily</div>
        <div class="ff-course-sub">Up to 7 days (derived from forecast)</div>
        <div class="ff-course-list" style="margin-top:12px">
          ${cards}
        </div>
      </div>
    `;
    if (course) renderHeader(course);
  }

  function calculatePlayability(weather) {
    const c = weather?.current;
    if (!c) return "--";

    let score = 10;

    const wind = Number(c.wind?.speed ?? c.wind_speed ?? 0);
    const temp = Number(c.temp ?? c.main?.temp ?? 10);
    const main = String(c.weather?.[0]?.main || "").toLowerCase();

    const list = Array.isArray(weather?.forecast?.list) ? weather.forecast.list : [];
    const pop = list.length ? Number(list[0]?.pop ?? 0) : Number(c.pop ?? 0);

    if (wind > 10) score -= 3;
    else if (wind > 7) score -= 2;
    else if (wind > 5) score -= 1;

    if (getUnits() === "metric") {
      if (temp < 4 || temp > 30) score -= 2;
      else if (temp < 7 || temp > 27) score -= 1;
    } else {
      if (temp < 40 || temp > 86) score -= 2;
      else if (temp < 45 || temp > 82) score -= 1;
    }

    const rainish = main.includes("rain") || main.includes("drizzle") || main.includes("thunder");
    if (rainish) score -= 2;

    if (pop >= 0.6) score -= 2;
    else if (pop >= 0.35) score -= 1;

    return Math.max(0, Math.min(10, Math.round(score)));
  }

  /* ---------- Suggestions (autocomplete) ---------- */
  function ensureSuggest() {
    if (suggestEl) return suggestEl;

    // attach inside controls card if possible, else body
    suggestEl = document.createElement("div");
    suggestEl.className = "ff-suggest";
    suggestEl.style.display = "none";
    (dom.controlsCard || document.body).appendChild(suggestEl);

    // click outside to close
    document.addEventListener("click", (e) => {
      if (!suggestEl) return;
      if (e.target === dom.searchInput) return;
      if (suggestEl.contains(e.target)) return;
      hideSuggest();
    });

    return suggestEl;
  }

  function hideSuggest() {
    if (!suggestEl) return;
    suggestEl.style.display = "none";
    suggestEl.innerHTML = "";
  }

  function showSuggest(courses) {
    const el = ensureSuggest();
    if (!courses.length) {
      hideSuggest();
      return;
    }

    el.innerHTML = courses.slice(0, SUGGEST_LIMIT).map((c, i) => {
      const name = esc(c.name || c.club_name || c.course_name || "Course");
      const sub = esc([c.city, c.state, c.country].filter(Boolean).join(", "));
      return `
        <button class="ff-suggest-item" type="button" data-idx="${i}">
          <div>
            <div class="ff-suggest-name">${name}</div>
            <div class="ff-suggest-sub">${sub}</div>
          </div>
        </button>
      `;
    }).join("");

    el.style.display = "block";

    $qsa("[data-idx]", el).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.getAttribute("data-idx"));
        const course = courses[idx];
        hideSuggest();
        if (!course) return;
        await selectCourse(course);
      });
    });
  }

  async function refreshSuggestions() {
    const q = dom.searchInput?.value?.trim() || "";
    if (q.length < 3) {
      hideSuggest();
      return;
    }

    try {
      const courses = await fetchCourses(q);
      lastCourses = courses;
      showSuggest(courses);
    } catch {
      hideSuggest();
    }
  }

  /* ---------- Core actions ---------- */
  async function selectCourse(course) {
    selectedCourse = course;

    const lat = Number(course.lat ?? course.latitude ?? course.location?.lat ?? course.location?.latitude);
    const lon = Number(course.lon ?? course.lng ?? course.longitude ?? course.location?.lon ?? course.location?.longitude);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showMessage("This result has no coordinates. Try another.");
      return;
    }

    showMessage("Loading forecast…");

    try {
      const w = await fetchWeather(lat, lon);
      lastWeather = w;

      // Default to Current tab
      setActiveTab(dom.tabCurrent);
      renderCurrent(w, course);
    } catch (err) {
      console.error(err);
      showMessage(`Weather failed: ${err.message}`);
    }
  }

  async function doSearch() {
    const q = dom.searchInput?.value?.trim() || "";
    if (!q) {
      showMessage("Type a city or golf club to search.");
      return;
    }

    hideSuggest();
    showMessage("Searching courses…");

    try {
      const courses = await fetchCourses(q);
      lastCourses = courses;

      if (!courses.length) {
        showMessage("No courses found. Try a different search.");
        return;
      }

      // If they typed a city, they’ll still see course results. Pick top result for quick forecast:
      await selectCourse(courses[0]);
    } catch (err) {
      console.error(err);
      showMessage(`Search failed: ${err.message}`);
    }
  }

  async function doNearMe() {
    if (!("geolocation" in navigator)) {
      showMessage("Geolocation isn’t available on this device/browser.");
      return;
    }

  

