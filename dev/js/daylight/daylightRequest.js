/**
 * Dev-only daylight request. Production weather fetches are unchanged.
 * Open-Meteo is used when the forecast payload has no real per-day sunrise/sunset.
 */

import {
  mergeDaylightSeries,
  needsDevDaylightFetch,
  parseOpenMeteoDaylight,
  providerDaylightSeries,
} from "./eveningPractice.js";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

export async function fetchDevDaylight(lat, lon, fetchImpl = globalThis.fetch) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Course location is missing.");
  }
  const url = new URL(OPEN_METEO);
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("daily", "sunrise,sunset");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "10");
  const res = await fetchImpl(url.toString());
  if (!res?.ok) throw new Error("Daylight times are unavailable.");
  return res.json();
}

export async function loadDevDaylightSeries(norm, { lat, lon, fetchImpl } = {}) {
  const provider = providerDaylightSeries(norm);
  if (!needsDevDaylightFetch(norm)) return provider;
  try {
    const raw = await fetchDevDaylight(lat, lon, fetchImpl);
    return mergeDaylightSeries(provider, parseOpenMeteoDaylight(raw));
  } catch {
    return provider;
  }
}
