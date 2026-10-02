/**
 * Wind Caddie weather loading, separate from the UI so loading can be tested.
 * Use our own same-origin Pages Function first (no cross-origin browser issue).
 * If it fails, retry the configured existing Worker. No third-party API keys
 * or unlicensed weather services.
 */
import { fetchWeather, normalizeWeather, getWeatherMeta } from "./weather-service.js";
import { mpsToMph } from "./wind-caddie.js";

export function selectWindReading(raw, { nowSec = Date.now() / 1000 } = {}) {
  const norm = normalizeWeather(raw);
  const valid = row => row && Number.isFinite(row.wind_speed) &&
    row.wind_speed >= 0 && Number.isFinite(row.wind_deg);
  const current = norm.current;
  // Prefer observed/current model wind. If missing, use the closest near-term
  // forecast, but NEVER silently use tomorrow's 3-hour forecast as live wind.
  let row = valid(current) ? current : null;
  let kind = "current";
  if (!row) {
    row = (norm.hourly || [])
      .filter(h => valid(h) && Number.isFinite(h.dt) && Math.abs(h.dt - nowSec) <= 4 * 3600)
      .sort((a, b) => Math.abs(a.dt - nowSec) - Math.abs(b.dt - nowSec))[0] || null;
    kind = "near-term forecast";
  }
  if (!row) return null;
  return {
    speed: mpsToMph(row.wind_speed),
    gust: Number.isFinite(row.wind_gust) ? mpsToMph(row.wind_gust) : null,
    deg: row.wind_deg,
    kind,
    validFor: Number.isFinite(row.dt) ? row.dt * 1000 : null,
  };
}

export async function loadWindEstimate(lat, lon, {
  workerUrl = "",
  fetcher = fetchWeather,
  clock = Date.now,
} = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw Error("Select a valid course or location.");
  const endpoints = ["", workerUrl].filter((endpoint, index, all) => index === 0 || (endpoint && !all.slice(0, index).includes(endpoint)));
  let lastError = null;
  let staleFallback = null;
  for (const endpoint of endpoints) {
    try {
      const raw = await fetcher(endpoint, lat, lon, "metric");
      const reading = selectWindReading(raw, { nowSec: clock() / 1000 });
      if (!reading) {
        lastError = new Error("The weather service returned no usable wind speed and direction.");
        continue;
      }
      const meta = getWeatherMeta(raw);
      const result = {
        ...reading,
        source: endpoint ? "FairwayWeather Worker" : "FairwayWeather",
        checkedAt: meta.fetchedAt || clock(),
        stale: Boolean(meta.stale || meta.offline),
      };
      if (!result.stale) return result;
      staleFallback ||= result;
    } catch (error) {
      lastError = error;
    }
  }
  if (staleFallback) return staleFallback;
  throw lastError || new Error("Wind unavailable. Check your connection and try again.");
}
