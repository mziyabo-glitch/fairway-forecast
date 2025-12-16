/* =========================================================
   Fairway Forecast — JS
   Objectives implemented:
   1) Playability hero (rounded whole 0–10, clamp, bands)
   2) Solid popover open/close (i + X)
   3) Best tee time ONLY within daylight; poor-day message
   4) Unified search + favourites w/ toast confirmation
   5) Skeleton loading states
   ========================================================= */

const CFG = window.APP_CONFIG || {};
const OWM = CFG.OWM_API_KEY;
const SUPA_URL = CFG.SUPABASE_URL;
const SUPA_KEY = CFG.SUPABASE_ANON_KEY;
const COURSES_TABLE = CFG.COURSES_TABLE || "uk_golf_courses";

if (!OWM) console.warn("Missing OWM_API_KEY in config.js");
if (!SUPA_URL || !SUPA_KEY) console.warn("Missing Supabase config in config.js");

const $ = (id) => document.getElementById(id);

const els = {
  // status
  appStatus: $("appStatus"),
  coursesStatus: $("coursesStatus"),

  // nav
  navBtns: Array.from(document.querySelectorAll(".nav__btn")),

  // search
  txtSearch: $("txtSearch"),
  btnSearch: $("btnSearch"),
  btnGeo: $("btnGeo"),
  btnFav: $("btnFav"),
  ddlFavs: $("ddlFavs"),
  suggestions: $("searchSuggestions"),

  // hero
  h1Title: $("h1Title"),
  subTitle: $("subTitle"),
  imgIcon: $("imgIcon"),
  currTemp: $("currTemp"),

  // playability
  playHero: $("playHero"),
  playScoreWhole: $("playScoreWhole"),
  playBand: $("playBand"),
  playMeta: $("playMeta"),
  btnPlayInfo: $("btnPlayInfo"),
  btnPlayClose: $("btnPlayClose"),
  playPopover: $("playPopover"),

  // conditions
  feelsLike: $("feelsLike"),
  humidity: $("humidity"),
  wind: $("wind"),
  windDir: $("windDir"),
  sunrise: $("sunrise"),
  sunset: $("sunset"),
  dayLength: $("dayLength"),

  // tee time
  teeSunrise: $("teeSunrise"),
  teeSunset: $("teeSunset"),
  bestTeeTime: $("bestTeeTime"),
  bestTeeScore: $("bestTeeScore"),
  teeMsg: $("teeMsg"),

  // map + rain
  rainMessage: $("rainMessage"),
  rainTimeline: $("rainTimeline"),

  // daily/hourly
  cardDaily: $("cardDaily"),
  cardHourly: $("cardHourly"),
  dailyForecast: $("dailyForecast"),
  hourlyForecast: $("hourlyForecast"),
  ddlDay: $("ddlDay"),

  // chips
  quickChips: $("quickChips"),

  // toast
  toast: $("toast"),

  // cards (loading)
  cardHero: $("cardHero"),
  cardMap: $("cardMap"),
};

const supabaseClient = (window.supabase && SUPA_URL && SUPA_KEY)
  ? window.supabase.createClient(SUPA_URL, SUPA_KEY)
  : null;

let state = {
  units: "C",
  courses: [],
  currentSelection: null, // {type:'place'|'course', name, sub, lat, lon}
  favourites: [],
  map: null,
  mapMarker: null,
  forecast: null,     // /forecast
  currentWx: null,    // /weather (sunrise/sunset)
  dayIndex: 0,        // selected day for hourly
};

const FAV_KEY = "ff_favourites_v1";

/* ------------------------ Helpers ------------------------ */
function setStatus(msg) { els.appStatus.textContent = msg || ""; }

function showToast(msg) {
  if (!msg) return;
  els.toast.textContent = msg;
  els.toast.classList.remove("is-hidden");
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => els.toast.classList.add("is-hidden"), 1800);
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function toUnitsTemp(c) {
  if (state.units === "F") return (c * 9/5) + 32;
  return c;
}

function fmtTemp(valC) {
  const v = toUnitsTemp(valC);
  return Math.round(v);
}

function fmtTimeLocal(dtSeconds, tzOffsetSeconds) {
  // OpenWeather dt is UTC; apply tz offset for local
  const d = new Date((dtSeconds + tzOffsetSeconds) * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateLocal(dtSeconds, tzOffsetSeconds) {
  const d = new Date((dtSeconds + tzOffsetSeconds) * 1000);
  return d.toLocaleDateString([], { weekday:"long", year:"numeric", month:"short", day:"numeric" });
}

function dayKeyLocal(dtSeconds, tzOffsetSeconds) {
  const d = new Date((dtSeconds + tzOffsetSeconds) * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const da = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${da}`;
}

function windDirText(deg) {
  if (deg == null || Number.isNaN(deg)) return "—";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  const idx = Math.round(deg / 22.5) % 16;
  return `${dirs[idx]} (${Math.round(deg)}°)`;
}

/* ---------------- Playability (0–10) ----------------
   Score components:
   - wind speed (m/s) penalty
   - rain probability (pop) penalty
   - temperature comfort penalty
   - ground conditions penalty (recent rain volume)
------------------------------------------------------ */
function computePlayabilitySlot(slot) {
  const wind = slot.wind?.speed ?? 0;          // m/s
  const pop = slot.pop ?? 0;                   // 0..1
  const temp = slot.main?.temp ?? 12;          // °C (metric fetch)
  const rain1h = slot.rain?.["3h"] ?? slot.rain?.["1h"] ?? 0;

  // Start from 10, subtract penalties
  let score = 10;

  // Wind: gentle <=4 m/s good, >10 m/s rough
  if (wind > 4) score -= (wind - 4) * 0.45;

  // Rain probability
  score -= pop * 6.0; // pop=1 => -6

  // Temp comfort band ~ 12–22C ideal for golf
  // penalize outside
  if (temp < 10) score -= (10 - temp) * 0.25;
  if (temp > 26) score -= (temp - 26) * 0.20;

  // Ground conditions proxy: recent rain in last 3h
  // heavier rain => softer/wetter
  score -= clamp(rain1h, 0, 6) * 0.35;

  return clamp(score, 0, 10);
}

function scoreBandLabel(whole) {
  if (whole >= 8) return "Excellent";
  if (whole >= 6) return "Good";
  if (whole >= 4) return "Marginal";
  return "Poor";
}

function scoreBandClass(whole) {
  if (whole >= 8) return "play--excellent";
  if (whole >= 6) return "play--good";
  if (whole >= 4) return "play--marginal";
  return "play--poor";
}

/* Objective: round + clamp + display like 8/10 */
function setPlayabilityHero(scoreDecimal, contextText) {
  const whole = clamp(Math.round(scoreDecimal), 0, 10);
  const label = scoreBandLabel(whole);

  els.playScoreWhole.textContent = String(whole);
  els.playBand.textContent = label;
  els.playMeta.textContent = contextText || "—";

  // apply subtle band styling
  els.playHero.classList.remove("play--excellent","play--good","play--marginal","play--poor");
  els.playHero.classList.add(scoreBandClass(whole));
}

/* ---------------- Best Tee Time (daylight only) ---------------- */
function computeBestTeeTimeToday(forecastList, tzOffset, sunriseUtc, sunsetUtc) {
  // sunrise/sunset are UTC seconds from /weather; we must compare using UTC time
  // but display in local via tzOffset.
  const todayKey = dayKeyLocal(forecastList[0].dt, tzOffset);

  const slotsToday = forecastList.filter(s => dayKeyLocal(s.dt, tzOffset) === todayKey);

  // strictly within daylight: dt > sunrise AND dt < sunset
  const daylightSlots = slotsToday.filter(s => s.dt > sunriseUtc && s.dt < sunsetUtc);

  if (!daylightSlots.length) {
    return { ok:false, reason:"No daylight forecast slots found for today." };
  }

  let best = null;
  for (const s of daylightSlots) {
    const sc = computePlayabilitySlot(s);
    if (!best || sc > best.score) best = { slot:s, score:sc };
  }

  const bestWhole = clamp(Math.round(best.score), 0, 10);

  // If conditions poor throughout daylight
  const maxWhole = bestWhole;
  const isPoorAllDay = maxWhole <= 3;

  return {
    ok: !isPoorAllDay,
    best,
    bestWhole,
    isPoorAllDay,
  };
}

/* ---------------- OWM API ---------------- */
async function owmGeocode(query) {
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=5&appid=${encodeURIComponent(OWM)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding failed");
  return await res.json();
}

async function owmForecast(lat, lon) {
  const units = "metric"; // always metric in API; we convert to F in UI
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${encodeURIComponent(OWM)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast fetch failed");
  return await res.json();
}

async function owmCurrent(lat, lon) {
  const units = "metric";
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${units}&appid=${encodeURIComponent(OWM)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Current weather fetch failed");
  return await res.json();
}

function owmIconUrl(icon) {
  // Use clear 2x icons
  return icon ? `https://openweathermap.org/img/wn/${icon}@2x.png` : "";
}

/* ---------------- Supabase Courses ---------------- */
async function loadCourses() {
  if (!supabaseClient) {
    els.coursesStatus.textContent = "Courses: Supabase not configured";
    return [];
  }

  els.coursesStatus.textContent = "Courses: loading…";

  // Expect columns: name, latitude, longitude, country
  const { data, error } = await supabaseClient
    .from(COURSES_TABLE)
    .select("name, latitude, longitude, country")
    .order("name", { ascending: true });

  if (error) {
    els.coursesStatus.textContent = `Courses: error`;
    console.error(error);
    return [];
  }

  els.coursesStatus.textContent = `Courses: ${data.length} loaded`;
  return data.map(r => ({
    type: "course",
    name: r.name,
    sub: r.country ? `${r.country}` : "",
    lat: Number(r.latitude),
    lon: Number(r.longitude),
  }));
}

/* ---------------- UI: Skeleton loading ---------------- */
function setLoading(isLoading) {
  const cards = [els.cardHero, els.cardMap, els.cardDaily, els.cardHourly].filter(Boolean);
  for (const c of cards) {
    if (!c) continue;
    c.classList.toggle("loading", !!isLoading);
  }
}

/* ---------------- UI: Views ---------------- */
function setView(view) {
  // toggle nav
  els.navBtns.forEach(b => b.classList.toggle("is-active", b.dataset.view === view));

  // panels
  const daily = els.cardDaily;
  const hourly = els.cardHourly;

  if (daily) daily.classList.toggle("is-hidden", view !== "daily");
  if (hourly) hourly.classList.toggle("is-hidden", view !== "hourly");

  // hero/map always visible for simplicity/clarity
}

/* ---------------- Suggestions (place OR course) ---------------- */
let suggData = []; // current suggestion objects
function hideSuggestions() {
  els.suggestions.classList.add("is-hidden");
  els.suggestions.innerHTML = "";
  suggData = [];
}
function showSuggestions(items) {
  suggData = items;
  if (!items.length) return hideSuggestions();

  els.suggestions.innerHTML = items.map((it, idx) => {
    const tag = it.type === "course" ? "Course" : "Place";
    const sub = it.sub ? `<div class="sugg__sub">${escapeHtml(it.sub)}</div>` : "";
    return `
      <div class="sugg" role="option" data-idx="${idx}">
        <div>
          <div class="sugg__main">${escapeHtml(it.name)}</div>
          ${sub}
        </div>
        <div class="sugg__tag">${tag}</div>
      </div>
    `;
  }).join("");

  els.suggestions.classList.remove("is-hidden");
}

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ---------------- Favourites ---------------- */
function loadFavs() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    state.favourites = raw ? JSON.parse(raw) : [];
  } catch {
    state.favourites = [];
  }
  renderFavs();
}
function saveFavs() {
  localStorage.setItem(FAV_KEY, JSON.stringify(state.favourites));
  renderFavs();
}
function favKey(sel) {
  if (!sel) return "";
  return `${sel.type}|${sel.name}|${sel.lat.toFixed(4)}|${sel.lon.toFixed(4)}`;
}
function isFaved(sel) {
  const k = favKey(sel);
  return state.favourites.some(f => f.key === k);
}
function toggleFav() {
  const sel = state.currentSelection;
  if (!sel) return;

  const k = favKey(sel);
  const idx = state.favourites.findIndex(f => f.key === k);

  if (idx >= 0) {
    state.favourites.splice(idx, 1);
    showToast("Removed from favourites");
  } else {
    state.favourites.unshift({
      key: k,
      type: sel.type,
      name: sel.name,
      sub: sel.sub || "",
      lat: sel.lat,
      lon: sel.lon
    });
    showToast("Added to favourites");
  }
  saveFavs();
  syncFavIcon();
}
function renderFavs() {
  const ddl = els.ddlFavs;
  ddl.innerHTML = `<option value="">Select a favourite…</option>` + state.favourites.map((f, i) => {
    const label = f.sub ? `${f.name} (${f.sub})` : f.name;
    return `<option value="${i}">${escapeHtml(label)}</option>`;
  }).join("");
}
function syncFavIcon() {
  const on = isFaved(state.currentSelection);
  els.btnFav.classList.toggle("is-on", on);
  els.btnFav.textContent = on ? "★" : "☆";
  els.btnFav.setAttribute("aria-pressed", on ? "true" : "false");
}

/* ---------------- Popover (solid + close) ---------------- */
function openPlayPopover() {
  els.playPopover.classList.remove("is-hidden");
  els.btnPlayInfo.setAttribute("aria-expanded","true");
  els.playPopover.setAttribute("aria-hidden","false");
}
function closePlayPopover() {
  els.playPopover.classList.add("is-hidden");
  els.btnPlayInfo.setAttribute("aria-expanded","false");
  els.playPopover.setAttribute("aria-hidden","true");
}

/* ---------------- Map ---------------- */
function ensureMap(lat, lon) {
  if (!window.L) return;

  if (!state.map) {
    state.map = L.map("map", { zoomControl:false, attributionControl:false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18
    }).addTo(state.map);
  }

  const pos = [lat, lon];
  state.map.setView(pos, 9);

  if (!state.mapMarker) {
    state.mapMarker = L.marker(pos).addTo(state.map);
  } else {
    state.mapMarker.setLatLng(pos);
  }
}

/* ---------------- Render: Current + Daily + Hourly + Rain ---------------- */
function renderAll() {
  const fc = state.forecast;
  const cw = state.currentWx;

  if (!fc || !cw) return;

  const tz = fc.city.timezone || 0;
  const first = fc.list[0];

  // H1: Location/Course (Objective: clear hierarchy)
  els.h1Title.textContent = state.currentSelection?.name || `${fc.city.name}`;
  els.subTitle.textContent = `${fmtDateLocal(first.dt, tz)} • ${state.currentSelection?.sub || fc.city.country || ""}`.trim();

  // current temp + icon
  els.currTemp.textContent = String(fmtTemp(first.main.temp));
  els.imgIcon.src = owmIconUrl(first.weather?.[0]?.icon);
  els.imgIcon.alt = first.weather?.[0]?.description || "";

  // conditions
  els.feelsLike.textContent = String(fmtTemp(first.main.feels_like));
  els.humidity.textContent = String(Math.round(first.main.humidity));
  els.wind.textContent = `${Math.round(first.wind.speed)} m/s`;
  els.windDir.textContent = windDirText(first.wind.deg);

  // sunrise/sunset from /weather (UTC seconds)
  const sunriseUtc = cw.sys.sunrise;
  const sunsetUtc = cw.sys.sunset;
  els.sunrise.textContent = fmtTimeLocal(sunriseUtc, tz);
  els.sunset.textContent = fmtTimeLocal(sunsetUtc, tz);
  els.teeSunrise.textContent = fmtTimeLocal(sunriseUtc, tz);
  els.teeSunset.textContent = fmtTimeLocal(sunsetUtc, tz);

  const dayLenSec = Math.max(0, sunsetUtc - sunriseUtc);
  const hrs = Math.floor(dayLenSec / 3600);
  const mins = Math.floor((dayLenSec % 3600) / 60);
  els.dayLength.textContent = `Day length: ${hrs}h ${mins}m`;

  // Playability hero based on "best slot today within daylight" OR first slot if none
  const bestToday = computeBestTeeTimeToday(fc.list, tz, sunriseUtc, sunsetUtc);

  // Use best-daylight slot score for hero (golf-specific)
  // If no daylight slots, fall back to first slot score.
  let heroScore = computePlayabilitySlot(first);
  let heroMeta = "Based on wind, rain chance, temperature and ground conditions.";
  if (bestToday.best) {
    heroScore = bestToday.best.score;
    heroMeta = `Optimised for daylight tee times today.`;
  }
  setPlayabilityHero(heroScore, heroMeta);

  // Best tee time (Objective: NEVER before sunrise / after sunset)
  if (!bestToday.ok) {
    if (bestToday.isPoorAllDay) {
      els.bestTeeTime.textContent = "—";
      els.bestTeeScore.textContent = "—";
      els.teeMsg.textContent = "No good tee time today — conditions poor throughout daylight hours.";
    } else {
      els.bestTeeTime.textContent = "—";
      els.bestTeeScore.textContent = "—";
      els.teeMsg.textContent = bestToday.reason || "No suitable tee time available within daylight hours.";
    }
  } else {
    const s = bestToday.best.slot;
    const t = fmtTimeLocal(s.dt, tz);
    const whole = bestToday.bestWhole;
    const label = scoreBandLabel(whole);

    els.bestTeeTime.textContent = t;
    els.bestTeeScore.textContent = `${whole}/10 • ${label}`;
    els.teeMsg.textContent = buildSlotReason(s, whole);
  }

  // Rain timeline + message
  renderRainTimeline(fc, tz);

  // Daily + Hourly
  renderDaily(fc, tz, sunriseUtc, sunsetUtc);
  renderHourly(fc, tz, state.dayIndex);

  // Map
  const sel = state.currentSelection;
  if (sel) ensureMap(sel.lat, sel.lon);

  // Favourite icon sync
  syncFavIcon();
}

function buildSlotReason(slot, whole) {
  const wind = Math.round(slot.wind?.speed ?? 0);
  const pop = Math.round((slot.pop ?? 0) * 100);
  const temp = fmtTemp(slot.main?.temp ?? 0);

  const windTxt = wind <= 4 ? "Light wind" : wind <= 8 ? "Breezy" : "Windy";
  const rainTxt = pop <= 20 ? "Low rain risk" : pop <= 50 ? "Moderate rain risk" : "High rain risk";
  const tempTxt = temp < 8 ? "Cold" : temp <= 22 ? "Comfortable" : "Warm";

  return `${windTxt} • ${rainTxt} • ${tempTxt}`;
}

function renderRainTimeline(fc, tz) {
  const list = fc.list.slice(0, 8); // next 24h (3h blocks)
  els.rainTimeline.innerHTML = "";

  // message: find first meaningful rain risk
  const idx = list.findIndex(s => (s.pop ?? 0) >= 0.35);
  if (idx === -1) {
    els.rainMessage.textContent = "No rain expected soon";
  } else {
    const minutes = idx * 180;
    els.rainMessage.textContent = `Rain risk rising in ~${minutes} minutes`;
  }

  for (const s of list) {
    const t = fmtTimeLocal(s.dt, tz);
    const pop = Math.round((s.pop ?? 0) * 100);
    const w = clamp(pop, 0, 100);

    const el = document.createElement("div");
    el.className = "tick";
    el.innerHTML = `
      <div class="tick__t">${t}</div>
      <div class="bar"><div class="bar__fill" style="width:${w}%"></div></div>
      <div class="tick__p">${pop}%</div>
    `;
    els.rainTimeline.appendChild(el);
  }
}

function renderDaily(fc, tz, sunriseUtc, sunsetUtc) {
  // Group by local day
  const byDay = new Map();
  for (const s of fc.list) {
    const k = dayKeyLocal(s.dt, tz);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }

  const days = Array.from(byDay.entries()).slice(0, 5);

  els.dailyForecast.innerHTML = "";
  els.ddlDay.innerHTML = "";

  days.forEach(([k, slots], idx) => {
    // simple min/max
    const temps = slots.map(x => x.main.temp);
    const min = Math.min(...temps);
    const max = Math.max(...temps);

    // day label
    const d = new Date((slots[0].dt + tz) * 1000);
    const dayName = d.toLocaleDateString([], { weekday:"short" });

    // day playability: best daylight slot if today else best slot
    let bestScore = 0;
    if (idx === 0 && sunriseUtc && sunsetUtc) {
      const daylight = slots.filter(s => s.dt > sunriseUtc && s.dt < sunsetUtc);
      if (daylight.length) bestScore = Math.max(...daylight.map(computePlayabilitySlot));
      else bestScore = Math.max(...slots.map(computePlayabilitySlot));
    } else {
      bestScore = Math.max(...slots.map(computePlayabilitySlot));
    }

    const whole = clamp(Math.round(bestScore), 0, 10);

    // icon
    const icon = slots[Math.floor(slots.length/2)]?.weather?.[0]?.icon || slots[0]?.weather?.[0]?.icon;

    // card
    const card = document.createElement("div");
    card.className = "day";
    card.dataset.dayIndex = String(idx);
    card.innerHTML = `
      <div class="day__top">
        <div>${dayName}</div>
        <div class="day__score">${whole}/10</div>
      </div>
      <div class="day__icon"><img alt="" src="${owmIconUrl(icon)}"></div>
      <div class="day__temps">
        <div>${fmtTemp(max)}°</div>
        <div class="day__min">${fmtTemp(min)}°</div>
      </div>
    `;
    card.addEventListener("click", () => {
      state.dayIndex = idx;
      els.ddlDay.value = String(idx);
      setView("hourly");
      renderHourly(fc, tz, idx);
    });
    els.dailyForecast.appendChild(card);

    // dropdown day selector
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${d.toLocaleDateString([], { weekday:"long", month:"short", day:"numeric" })}`;
    els.ddlDay.appendChild(opt);
  });

  els.ddlDay.value = String(state.dayIndex);
}

function renderHourly(fc, tz, dayIndex) {
  const byDay = new Map();
  for (const s of fc.list) {
    const k = dayKeyLocal(s.dt, tz);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const days = Array.from(byDay.values());
  const slots = days[dayIndex] || days[0] || [];

  els.hourlyForecast.innerHTML = "";
  for (const s of slots.slice(0, 8)) {
    const t = fmtTimeLocal(s.dt, tz);
    const temp = fmtTemp(s.main.temp);
    const pop = Math.round((s.pop ?? 0) * 100);
    const wind = Math.round(s.wind?.speed ?? 0);

    const el = document.createElement("div");
    el.className = "hr";
    el.innerHTML = `
      <div class="hr__t">${t}</div>
      <div class="hr__temp">${temp}°</div>
      <div class="hr__meta">${pop}% rain • ${wind} m/s</div>
    `;
    els.hourlyForecast.appendChild(el);
  }
}

/* ---------------- Search execution ---------------- */
async function applySelection(sel) {
  state.currentSelection = sel;
  syncFavIcon();
  setStatus("");
  hideSuggestions();
  closePlayPopover();

  // loading state
  setLoading(true);

  try {
    // fetch both forecast + current (for sunrise/sunset)
    const [forecast, currentWx] = await Promise.all([
      owmForecast(sel.lat, sel.lon),
      owmCurrent(sel.lat, sel.lon),
    ]);

    state.forecast = forecast;
    state.currentWx = currentWx;

    // render
    renderAll();
  } catch (e) {
    console.error(e);
    setStatus("Could not load weather for that selection.");
  } finally {
    setLoading(false);
  }
}

/* ---------------- Unified suggestions pipeline ---------------- */
let typeTimer = null;
async function onType() {
  const q = els.txtSearch.value.trim();
  if (q.length < 2) return hideSuggestions();

  // Local course matches (fast)
  const courses = state.courses
    .filter(c => c.name.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 6);

  // If query looks like a course, show those first; also include 1–2 places async
  const sugg = [...courses];

  showSuggestions(sugg);

  // Also fetch place suggestions (async, lightweight)
  try {
    const places = await owmGeocode(q);
    const placeItems = (places || []).slice(0, 4).map(p => ({
      type: "place",
      name: `${p.name}${p.state ? ", " + p.state : ""}`,
      sub: `${p.country}`,
      lat: p.lat,
      lon: p.lon
    }));

    // merge without duplicates
    const merged = [
      ...courses,
      ...placeItems.filter(p => !courses.some(c => c.name.toLowerCase() === p.name.toLowerCase()))
    ].slice(0, 8);

    showSuggestions(merged);
  } catch {
    // ignore place lookup failures; courses still work
  }
}

/* ---------------- Search submit ---------------- */
async function submitSearch() {
  const q = els.txtSearch.value.trim();
  if (!q) return;

  // If user selected from suggestions, we store it in a temp attribute
  const pickIdx = els.txtSearch.dataset.pickIdx;
  if (pickIdx != null && pickIdx !== "") {
    const sel = suggData[Number(pickIdx)];
    if (sel) return applySelection(sel);
  }

  // If matches a course strongly, pick first match
  const course = state.courses.find(c => c.name.toLowerCase() === q.toLowerCase())
    || state.courses.find(c => c.name.toLowerCase().includes(q.toLowerCase()));

  if (course) {
    return applySelection(course);
  }

  // Otherwise treat as place
  try {
    setLoading(true);
    const places = await owmGeocode(q);
    if (!places?.length) {
      setStatus("No matching place found. Try adding country code (e.g. Swindon, GB).");
      return;
    }
    const p = places[0];
    const sel = {
      type: "place",
      name: `${p.name}${p.state ? ", " + p.state : ""}`,
      sub: p.country,
      lat: p.lat,
      lon: p.lon
    };
    await applySelection(sel);
  } catch (e) {
    console.error(e);
    setStatus("Search failed. Please try again.");
  } finally {
    setLoading(false);
  }
}

/* ---------------- Geolocation ---------------- */
function useGeolocation() {
  if (!navigator.geolocation) {
    showToast("Geolocation not supported");
    return;
  }
  setStatus("Getting your location…");
  navigator.geolocation.getCurrentPosition(async (pos) => {
    setStatus("");
    const sel = {
      type: "place",
      name: "My location",
      sub: "",
      lat: pos.coords.latitude,
      lon: pos.coords.longitude
    };
    await applySelection(sel);
  }, () => {
    setStatus("Could not access location (permission denied).");
  }, { enableHighAccuracy:false, timeout:8000 });
}

/* ---------------- Quick chips ---------------- */
function renderQuickChips() {
  const items = [
    { name:"London", sub:"GB", lat:51.5072, lon:-0.1276 },
    { name:"Glasgow", sub:"GB", lat:55.8642, lon:-4.2518 },
    { name:"Cardiff", sub:"GB", lat:51.4816, lon:-3.1791 },
    { name:"Belfast", sub:"GB", lat:54.5973, lon:-5.9301 },
  ];

  els.quickChips.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.innerHTML = `<span>${it.name}</span> <span class="chip__t"></span>`;
    b.addEventListener("click", async () => {
      await applySelection({ type:"place", name: it.name, sub: it.sub, lat: it.lat, lon: it.lon });
    });
    els.quickChips.appendChild(b);
  }
}

/* ---------------- Events ---------------- */
function wireEvents() {
  // nav
  els.navBtns.forEach(btn => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  // units
  $("ddlUnits").addEventListener("change", (e) => {
    state.units = e.target.value || "C";
    // re-render with new units
    if (state.forecast && state.currentWx) renderAll();
  });

  // search typing (debounced)
  els.txtSearch.addEventListener("input", () => {
    window.clearTimeout(typeTimer);
    els.txtSearch.dataset.pickIdx = "";
    typeTimer = window.setTimeout(onType, 160);
  });

  // suggestion click
  els.suggestions.addEventListener("click", async (e) => {
    const item = e.target.closest(".sugg");
    if (!item) return;
    const idx = Number(item.dataset.idx);
    const sel = suggData[idx];
    if (!sel) return;

    els.txtSearch.value = sel.name;
    els.txtSearch.dataset.pickIdx = String(idx);
    hideSuggestions();
    await applySelection(sel);
  });

  // close suggestions on outside click
  document.addEventListener("click", (e) => {
    if (!els.suggestions.contains(e.target) && e.target !== els.txtSearch) hideSuggestions();
  });

  // search button + enter
  els.btnSearch.addEventListener("click", submitSearch);
  els.txtSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitSearch();
  });

  // geo
  els.btnGeo.addEventListener("click", useGeolocation);

  // favourites
  els.btnFav.addEventListener("click", toggleFav);
  els.ddlFavs.addEventListener("change", async (e) => {
    const idx = Number(e.target.value);
    if (Number.isNaN(idx)) return;
    const f = state.favourites[idx];
    if (!f) return;
    els.txtSearch.value = f.name;
    await applySelection({ type:f.type, name:f.name, sub:f.sub, lat:f.lat, lon:f.lon });
  });

  // playability popover (clear open/close affordance)
  els.btnPlayInfo.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !els.playPopover.classList.contains("is-hidden");
    if (isOpen) closePlayPopover();
    else openPlayPopover();
  });
  els.btnPlayClose.addEventListener("click", closePlayPopover);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePlayPopover(); });
  document.addEventListener("click", (e) => {
    if (!els.playPopover.contains(e.target) && e.target !== els.btnPlayInfo) closePlayPopover();
  });

  // hourly day dropdown
  els.ddlDay.addEventListener("change", (e) => {
    state.dayIndex = Number(e.target.value) || 0;
    if (state.forecast) renderHourly(state.forecast, state.forecast.city.timezone || 0, state.dayIndex);
  });
}

/* ---------------- Init ---------------- */
async function init() {
  renderQuickChips();
  loadFavs();
  wireEvents();

  // load courses
  state.courses = await loadCourses();

  // default: use Swindon-ish (or first favourite if exists)
  const firstFav = state.favourites[0];
  if (firstFav) {
    await applySelection(firstFav);
  } else {
    await applySelection({ type:"place", name:"London", sub:"GB", lat:51.5072, lon:-0.1276 });
  }
}

init();
