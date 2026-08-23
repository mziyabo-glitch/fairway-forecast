/** Weather API, caching, and normalization */

import { courseDateKey, courseLocalParts, getTodayCourseYMD, courseDayStartSec } from "./timezone.js";

const WEATHER_CACHE_TTL_MS = 3 * 60 * 1000;
const memCache = new Map();
const SNAP_KEY = "fw_weather_snap_v1";
const MAX_SNAPS = 8;

function cacheGetFresh(key, ttlMs) {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.t > ttlMs) return null;
  return hit;
}

function cacheGetAny(key) {
  return memCache.get(key) || null;
}

function cacheSet(key, data) {
  memCache.set(key, { t: Date.now(), data });
}

function attachMeta(data, meta) {
  if (data && typeof data === "object") {
    data._fwMeta = meta;
  }
  return data;
}

function readSnaps() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(SNAP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSnap(key, data) {
  try {
    if (typeof localStorage === "undefined") return;
    const snaps = readSnaps();
    snaps[key] = { t: Date.now(), data };
    const keys = Object.keys(snaps);
    if (keys.length > MAX_SNAPS) {
      keys
        .sort((a, b) => (snaps[a].t || 0) - (snaps[b].t || 0))
        .slice(0, keys.length - MAX_SNAPS)
        .forEach((k) => delete snaps[k]);
    }
    localStorage.setItem(SNAP_KEY, JSON.stringify(snaps));
  } catch {
    /* ignore */
  }
}

function readSnap(key) {
  const snaps = readSnaps();
  return snaps[key] || null;
}

export function getWeatherMeta(raw) {
  return (
    raw?._fwMeta || {
      fromCache: false,
      stale: false,
      offline: false,
      fetchedAt: null,
    }
  );
}

export function formatForecastFreshness(meta, now = Date.now()) {
  if (!meta) return null;
  if (meta.offline || meta.stale) {
    if (Number.isFinite(meta.fetchedAt)) {
      const d = new Date(meta.fetchedAt);
      const hh = d.getHours().toString().padStart(2, "0");
      const mm = d.getMinutes().toString().padStart(2, "0");
      return `Last updated ${hh}:${mm}`;
    }
    return "Offline forecast";
  }
  if (meta.offline) return "Offline forecast";
  return null;
}

export async function apiGet(apiBase, path) {
  const url = `${apiBase}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    clearTimeout(timer);

    if (res.status === 429) {
      const err = new Error("Too many requests. Please wait a moment and try again.");
      err.status = 429;
      throw err;
    }

    if (!res.ok) {
      const err = new Error("Weather service is temporarily unavailable.");
      err.status = res.status;
      throw err;
    }

    return res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw err;
  }
}

export async function fetchWeather(apiBase, lat, lon, units = "metric") {
  const key = `${units}|${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
  const fresh = cacheGetFresh(key, WEATHER_CACHE_TTL_MS);
  if (fresh) {
    return attachMeta(fresh.data, {
      fromCache: true,
      stale: false,
      offline: false,
      fetchedAt: fresh.t,
    });
  }

  try {
    const data = await apiGet(
      apiBase,
      `/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=${units}`
    );
    cacheSet(key, data);
    writeSnap(key, data);
    return attachMeta(data, {
      fromCache: false,
      stale: false,
      offline: false,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    const staleMem = cacheGetAny(key);
    const snap = staleMem || readSnap(key);
    if (snap?.data) {
      return attachMeta(snap.data, {
        fromCache: true,
        stale: true,
        offline: true,
        fetchedAt: snap.t,
      });
    }
    throw err;
  }
}

export function normalizeWeather(raw) {
  const norm = {
    current: null,
    hourly: [],
    daily: [],
    sunrise: null,
    sunset: null,
    timezone: null,
    timezoneOffset: null,
  };
  if (!raw || typeof raw !== "object") return norm;

  norm.sunrise = raw?.current?.sunrise ?? raw?.city?.sunrise ?? null;
  norm.sunset = raw?.current?.sunset ?? raw?.city?.sunset ?? null;
  norm.timezone = raw?.city?.timezone ?? null;
  norm.timezoneOffset =
    typeof raw?.city?.timezone === "number" ? raw.city.timezone : null;

  if (raw?.current) {
    norm.current = normalizeHourlyLike(raw.current);
  } else if (Array.isArray(raw?.list) && raw.list.length) {
    norm.current = normalizeListItem(raw.list[0]);
    norm.sunrise = norm.sunrise ?? raw?.city?.sunrise ?? null;
    norm.sunset = norm.sunset ?? raw?.city?.sunset ?? null;
  }

  if (norm.timezoneOffset === null && typeof raw?.city?.timezone === "number") {
    norm.timezoneOffset = raw.city.timezone;
  }

  if (Array.isArray(raw?.list) && raw.list.length) {
    norm.hourly = raw.list.slice(0, 40).map(normalizeListItem);
  }

  if (Array.isArray(raw?.list) && raw.list.length) {
    norm.daily = deriveDaily(raw.list, norm.sunrise, norm.sunset, norm.timezoneOffset || 0);
  }

  return norm;
}

function normalizeHourlyLike(c) {
  return {
    dt: c.dt ?? null,
    temp: typeof c.temp === "number" ? c.temp : null,
    feels_like: typeof c.feels_like === "number" ? c.feels_like : null,
    humidity: typeof c.humidity === "number" ? c.humidity : null,
    wind_speed: typeof c?.wind?.speed === "number" ? c.wind.speed : null,
    wind_gust: typeof c?.wind?.gust === "number" ? c.wind.gust : null,
    wind_deg: typeof c?.wind?.deg === "number" ? c.wind.deg : null,
    pop: typeof c.pop === "number" ? c.pop : 0,
    rain_mm: extractRain(c.rain),
    weather: Array.isArray(c.weather) ? c.weather : [],
  };
}

function normalizeListItem(it) {
  return {
    dt: it.dt,
    temp: it?.main?.temp ?? null,
    feels_like: it?.main?.feels_like ?? null,
    pop: typeof it?.pop === "number" ? it.pop : 0,
    wind_speed: it?.wind?.speed ?? null,
    wind_gust: it?.wind?.gust ?? null,
    wind_deg: typeof it?.wind?.deg === "number" ? it.wind.deg : null,
    rain_mm: extractRain(it?.rain),
    weather: Array.isArray(it?.weather) ? it.weather : [],
  };
}

function extractRain(rain) {
  if (typeof rain?.["1h"] === "number") return rain["1h"];
  if (typeof rain?.["3h"] === "number") return rain["3h"];
  return null;
}

function deriveDaily(list, baseSunrise, baseSunset, tzOffset = 0) {
  const byDay = new Map();

  for (const it of list) {
    const dt = it.dt;
    if (!dt) continue;

    const dateKey = courseDateKey(dt, tzOffset);
    const tMin = it?.main?.temp_min;
    const tMax = it?.main?.temp_max;
    const pop = typeof it?.pop === "number" ? it.pop : null;
    const hour = courseLocalParts(dt, tzOffset).hours;
    const distToNoon = Math.abs(hour - 12);

    if (!byDay.has(dateKey)) {
      byDay.set(dateKey, {
        dt,
        min: typeof tMin === "number" ? tMin : null,
        max: typeof tMax === "number" ? tMax : null,
        pop: typeof pop === "number" ? pop : null,
        bestNoonDist: distToNoon,
        weather: Array.isArray(it?.weather) ? it.weather : [],
      });
    } else {
      const d = byDay.get(dateKey);
      if (typeof tMin === "number") d.min = d.min === null ? tMin : Math.min(d.min, tMin);
      if (typeof tMax === "number") d.max = d.max === null ? tMax : Math.max(d.max, tMax);
      if (typeof pop === "number") d.pop = d.pop === null ? pop : Math.max(d.pop, pop);
      if (distToNoon < d.bestNoonDist) {
        d.bestNoonDist = distToNoon;
        d.weather = Array.isArray(it?.weather) ? it.weather : d.weather;
      }
    }
  }

  const today = getTodayCourseYMD(tzOffset);
  const todayStart = courseDayStartSec(today.year, today.month, today.day, tzOffset);

  return Array.from(byDay.values())
    .sort((a, b) => (a.dt ?? 0) - (b.dt ?? 0))
    .slice(0, 7)
    .map(({ dt, min, max, pop, weather }) => {
      const dayOffset = Math.round((Math.floor(dt / 86400) * 86400 - todayStart) / 86400);
      let sunrise = null;
      let sunset = null;
      if (typeof baseSunrise === "number" && typeof baseSunset === "number") {
        sunrise = baseSunrise + Math.max(0, dayOffset) * 86400;
        sunset = baseSunset + Math.max(0, dayOffset) * 86400;
      }
      return { dt, min, max, pop, weather, sunrise, sunset };
    });
}

export async function geocodeCity(apiBase, query) {
  const q = (query || "").trim();
  if (!q) return null;

  const golfKeywords = /golf|club|course|gc|links|country club/i;
  if (golfKeywords.test(q)) return null;

  try {
    const data = await apiGet(apiBase, `/geocode?q=${encodeURIComponent(q)}&limit=1`);
    const locations = Array.isArray(data) ? data : data?.locations ?? [];
    if (!locations.length) return null;

    const loc = locations[0];
    const lat = typeof loc.lat === "number" ? loc.lat : null;
    const lon = typeof loc.lon === "number" ? loc.lon : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      name: loc.name || q,
      lat,
      lon,
      country: loc.country || "",
      state: loc.state || "",
      city: loc.name || q,
    };
  } catch {
    return null;
  }
}

export function clearWeatherCache() {
  memCache.clear();
}
