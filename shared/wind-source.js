/**
 * Wind Caddie weather loading, separate from the UI so loading can be tested.
 * Use our own same-origin Pages Function first (no cross-origin browser issue).
 * If it fails, retry the configured existing Worker. No third-party API keys
 * or unlicensed weather services.
 */
import { apiGet, fetchWeather, normalizeWeather, getWeatherMeta } from "./weather-service.js";
import { mpsToMph } from "./wind-caddie.js";

/** Only report rain when upstream supplied precipitation; missing is unknown, not dry. */
export function readRainForWind(raw, reading) {
 const current = raw?.current || {};
 const fromCurrent = reading?.kind === "current";
 const forecast = !fromCurrent && Array.isArray(raw?.list)
   ? raw.list.find(h=>Number.isFinite(reading?.validFor) && h.dt*1000===reading.validFor) || null
   : null;
 // Use nearby forecast precipitation if the current feed has no rain fields.
 // Never mislabel a missing current rain field as dry.
 const rawSource=fromCurrent?current:forecast;
 const hasSignal=row=>row&&(Number.isFinite(row.rain_1h)||Number.isFinite(row.rain?.["1h"])||
   Number.isFinite(row.rain?.["3h"])||Number.isFinite(row.rain_3h)||Number.isFinite(row.pop));
 let source=rawSource;
 let period=fromCurrent?"current":"near-term forecast";
 if(fromCurrent && !hasSignal(source) && Array.isArray(raw?.list)){
   const time=Number.isFinite(reading.validFor)?reading.validFor/1000:Date.now()/1000;
   source=raw.list.filter(h=>Number.isFinite(h.dt)&&Math.abs(h.dt-time)<=2*3600&&hasSignal(h))
     .sort((a,b)=>Math.abs(a.dt-time)-Math.abs(b.dt-time))[0]||null;
   period="near-term forecast";
 }
 if(!source) return {known:false,mmPerHour:null,probability:null};
 const mm = source.rain_1h ?? source.rain?.["1h"] ??
   (Number.isFinite(source.rain?.["3h"]) ? source.rain["3h"]/3 : (Number.isFinite(source.rain_3h) ? source.rain_3h/3 : null));
 const popRaw = source.pop;
 const probability=Number.isFinite(popRaw) && popRaw>=0 && popRaw<=100
   ? (popRaw>1?popRaw/100:popRaw) : null;
 if(!Number.isFinite(mm) && probability==null) return {known:false,mmPerHour:null,probability:null};
 return {known:true,mmPerHour:Number.isFinite(mm)?Math.max(0,mm):null,probability,period};
}
export function selectWindReading(raw, { nowSec = Date.now() / 1000 } = {}) {
  const norm = normalizeWeather(raw);
  const valid = row => row && Number.isFinite(row.wind_speed) &&
    row.wind_speed >= 0 && (Number.isFinite(row.wind_deg) || row.wind_speed === 0);
  const current = norm.current;
  // Prefer observed/current model wind. If missing, use the closest near-term
  // forecast, but NEVER silently use tomorrow's 3-hour forecast as live wind.
  let row = raw?.current && valid(current) && (!Number.isFinite(current.dt) || Math.abs(current.dt - nowSec) <= 4 * 3600) ? current : null;
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
    deg: Number.isFinite(row.wind_deg) ? row.wind_deg : 0,
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
  let firstResponseHadMissingWind = false;
  for (const endpoint of endpoints) {
    try {
      const raw = firstResponseHadMissingWind && endpoint && fetcher === fetchWeather
        ? await apiGet(endpoint, `/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&units=metric`)
        : await fetcher(endpoint, lat, lon, "metric");
      const reading = selectWindReading(raw, { nowSec: clock() / 1000 });
      if (!reading) {
        firstResponseHadMissingWind = true;
        lastError = new Error("The weather service returned no usable wind speed and direction.");
        continue;
      }
      const meta = getWeatherMeta(raw);
      const result = {
        ...reading,
        rain: readRainForWind(raw, reading),
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
