/* app.js — Fairway Forecast
   Mobile-first, no secrets, Cloudflare Worker + Supabase
*/

const CFG = window.APP_CONFIG;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

// ---------- state ----------
let currentLat = null;
let currentLon = null;

// ---------- WEATHER ----------
async function fetchWeather(lat, lon){
  const url = `${CFG.WEATHER_WORKER_BASE}?lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error("Weather fetch failed");
  return res.json();
}

function renderWeather(data){
  // LOCATION
  $("locationName").textContent =
    data.current.name || "Selected location";
  show($("locationCard"));

  // CONDITIONS SUMMARY
  const temp = Math.round(data.current.main.temp);
  const wind = data.current.wind.speed;
  const desc = data.current.weather[0].description;

  $("weatherSummary").textContent =
    `${temp}°C • ${desc} • Wind ${wind} m/s`;
  show($("weatherCard"));

  // SUNRISE / SUNSET
  const sunrise = new Date(data.current.sys.sunrise * 1000);
  const sunset  = new Date(data.current.sys.sunset * 1000);

  $("sunrise").textContent = `Sunrise: ${sunrise.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;
  $("sunset").textContent  = `Sunset: ${sunset.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}`;

  // PLAYABILITY
  const scoreRaw = computePlayability(data);
  const score = clamp(Math.round(scoreRaw), 0, 10);
  renderPlayability(score);

  // BEST TEE TIME
  renderBestTeeTime(data.forecast.list, sunrise, sunset);
}

// ---------- PLAYABILITY ----------
function computePlayability(data){
  let score = 10;

  const wind = data.current.wind.speed;      // m/s
  const temp = data.current.main.temp;       // °C
  const rain = data.forecast.list
    .slice(0, 4)
    .some(h => h.pop && h.pop > 0.3);

  if(wind > 8) score -= 3;
  else if(wind > 5) score -= 2;

  if(temp < 5 || temp > 30) score -= 2;

  if(rain) score -= 3;

  return score;
}

function renderPlayability(score){
  $("playabilityScore").textContent = `${score}/10`;

  let label = "Poor";
  if(score >= 8) label = "Excellent";
  else if(score >= 6) label = "Good";
  else if(score >= 4) label = "Marginal";

  $("playabilityLabel").textContent = label;
  show($("playabilityCard"));
}

// ---------- BEST TEE TIME ----------
function renderBestTeeTime(list, sunrise, sunset){
  let best = null;

  for(const slot of list){
    const t = new Date(slot.dt * 1000);
    if(t < sunrise || t > sunset) continue;

    const wind = slot.wind.speed;
    const rain = slot.pop || 0;

    if(wind < 6 && rain < 0.3){
      best = t;
      break;
    }
  }

  if(best){
    $("bestTeeTime").textContent =
      best.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    $("teeTimeCard").querySelector(".sun-times").style.display = "flex";
    $("teeTimeCard").querySelector("#bestTeeTime").style.opacity = "1";
    $("teeTimeCard").querySelector("#bestTeeTime").style.fontWeight = "700";
    $("teeTimeCard").querySelector("#bestTeeTime").style.fontSize = "18px";
    $("teeTimeCard").querySelector("#bestTeeTime").style.color = "white";
    $("teeTimeCard").querySelector("#bestTeeTime").style.textAlign = "left";
    $("teeTimeCard").querySelector("#bestTeeTime").style.marginTop = "4px";
    $("teeTimeCard").querySelector("#bestTeeTime").style.marginBottom = "2px";
    $("teeTimeCard").querySelector("#bestTeeTime").style.display = "block";
  } else {
    $("bestTeeTime").textContent =
      "No good tee time today — conditions poor during daylight hours.";
  }

  show($("teeTimeCard"));
}

// ---------- SEARCH (COURSES) ----------
async function searchCourses(q){
  const url =
    `${CFG.SUPABASE_URL}/rest/v1/${CFG.COURSES_TABLE}` +
    `?select=${CFG.COURSE_COLS.name},${CFG.COURSE_COLS.lat},${CFG.COURSE_COLS.lon}` +
    `&${CFG.COURSE_COLS.name}=ilike.*${encodeURIComponent(q)}*` +
    `&limit=${CFG.MAX_RESULTS}`;

  const res = await fetch(url, {
    headers: {
      apikey: CFG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`
    }
  });

  return res.json();
}

function renderSearchResults(list){
  const ul = $("searchResults");
  ul.innerHTML = "";

  list.forEach(item => {
    const li = document.createElement("li");
    li.textContent = item[CFG.COURSE_COLS.name];
    li.onclick = () => {
      currentLat = item[CFG.COURSE_COLS.lat];
      currentLon = item[CFG.COURSE_COLS.lon];
      ul.innerHTML = "";
      runForecast();
    };
    ul.appendChild(li);
  });
}

// ---------- RUN ----------
async function runForecast(){
  if(currentLat == null || currentLon == null) return;
  try{
    const data = await fetchWeather(currentLat, currentLon);
    renderWeather(data);
  }catch(e){
    console.error(e);
    alert("Weather failed to load");
  }
}

// ---------- UI EVENTS ----------
$("searchBtn").onclick = async () => {
  const q = $("searchInput").value.trim();
  if(!q) return;

  const results = await searchCourses(q);
  renderSearchResults(results);
};

$("playabilityInfoBtn").onclick = () => show($("playabilityInfo"));
$("playabilityCloseBtn").onclick = () => hide($("playabilityInfo"));