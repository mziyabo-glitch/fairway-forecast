/**
 * Optional /dev request for recent rain when the forecast payload has none.
 * Failures leave past rain empty so the risk stays "unknown".
 * This does not call the production weather API.
 */

import { expectedDrying, extractPastRain, recentFreezing } from "./groundCondition.js";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

export async function fetchDevPastWeather(lat, lon, fetchImpl = globalThis.fetch) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Course location is missing.");
  }
  const url = new URL(OPEN_METEO);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("hourly", "precipitation,temperature_2m,wind_speed_10m");
  url.searchParams.set("past_days", "3");
  url.searchParams.set("forecast_days", "1");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "UTC");
  const res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res?.ok) throw new Error("Recent rain is unavailable.");
  return res.json();
}

export function parseOpenMeteoGround(payload) {
  const times = payload?.hourly?.time || [];
  const rain = payload?.hourly?.precipitation || [];
  const temps = payload?.hourly?.temperature_2m || [];
  const wind = payload?.hourly?.wind_speed_10m || [];
  const hourly = [];
  for (let i = 0; i < times.length; i++) {
    if (typeof times[i] !== "string") continue;
    const stamped = /[zZ]|[+-]\d{2}:\d{2}$/.test(times[i]) ? times[i] : `${times[i]}Z`;
    const ms = Date.parse(stamped);
    if (!Number.isFinite(ms)) continue;
    hourly.push({
      dt: Math.floor(ms / 1000),
      rain_mm: Number.isFinite(rain[i]) ? rain[i] : null,
      temp: Number.isFinite(temps[i]) ? temps[i] : null,
      wind_speed: Number.isFinite(wind[i]) ? wind[i] : null,
    });
  }
  return { hourly };
}

export async function loadDevGroundSignals(norm, {
  lat,
  lon,
  nowUnix = Math.floor(Date.now() / 1000),
  units = "metric",
  allowFetch = false,
  fetchImpl,
} = {}) {
  const pastRain = extractPastRain(norm, nowUnix);
  const freezing = recentFreezing(norm, nowUnix, units);
  const drying = expectedDrying(norm, nowUnix, units);
  if (pastRain || !allowFetch) {
    return { pastRain, freezing, drying, source: pastRain ? "payload" : "payload-missing" };
  }
  try {
    const raw = await fetchDevPastWeather(lat, lon, fetchImpl);
    const parsed = parseOpenMeteoGround(raw);
    return {
      pastRain: extractPastRain(parsed, nowUnix),
      freezing: freezing == null ? recentFreezing(parsed, nowUnix, "metric") : freezing,
      drying,
      source: "open-meteo",
    };
  } catch {
    return { pastRain: null, freezing, drying, source: "unavailable" };
  }
}
