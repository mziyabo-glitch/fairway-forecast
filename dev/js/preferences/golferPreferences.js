/**
 * Golfer preferences for /dev. Stored locally. Failures return defaults and never throw.
 * personalFitScore is separate from the objective weather score in computeGolfVerdict.
 */

import { clamp } from "../../../shared/utils.js";
import { createJsonStore } from "../storage/jsonStore.js";

const store = createJsonStore("fw_dev_golfer_prefs_v1");

export const GOLFER_PREFERENCE_DEFAULTS = {
  rainTolerance: "light",
  windTolerance: "medium",
  minComfortC: 8,
  maxComfortC: 26,
  transport: "walking",
  playStyle: "casual",
  daylightSafetyMarginMins: 15,
  paceMins: { 3: 60, 6: 105, 9: 140, 18: 240 },
};

const RAIN = new Set(["avoid", "light", "any"]);
const WIND = new Set(["low", "medium", "high"]);
const TRANSPORT = new Set(["walking", "buggy"]);
const STYLE = new Set(["practice", "casual", "competition", "society"]);

const RAIN_LIMITS = {
  avoid: { pop: 15, mm: 0.1 },
  light: { pop: 45, mm: 1.2 },
  any: { pop: 75, mm: 4 },
};

const WIND_LIMITS = {
  low: { wind: 8, gust: 16 },
  medium: { wind: 16, gust: 28 },
  high: { wind: 25, gust: 38 },
};

const STYLE_WEIGHT = {
  practice: 0.8,
  casual: 1,
  competition: 1.25,
  society: 1.1,
};

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeGolferPreferences(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const defaults = GOLFER_PREFERENCE_DEFAULTS;
  let minComfortC = finiteOr(src.minComfortC, defaults.minComfortC);
  let maxComfortC = finiteOr(src.maxComfortC, defaults.maxComfortC);
  if (minComfortC > maxComfortC) {
    const swap = minComfortC;
    minComfortC = maxComfortC;
    maxComfortC = swap;
  }

  const paceSrc = src.paceMins && typeof src.paceMins === "object" ? src.paceMins : {};
  const paceMins = {};
  for (const holes of [3, 6, 9, 18]) {
    const fallback = defaults.paceMins[holes];
    const n = Number(paceSrc[holes]);
    paceMins[holes] = Number.isFinite(n) && n > 0 ? Math.round(clamp(n, 20, 360)) : fallback;
  }

  const margin = finiteOr(src.daylightSafetyMarginMins, defaults.daylightSafetyMarginMins);

  return {
    rainTolerance: RAIN.has(src.rainTolerance) ? src.rainTolerance : defaults.rainTolerance,
    windTolerance: WIND.has(src.windTolerance) ? src.windTolerance : defaults.windTolerance,
    minComfortC: Math.round(clamp(minComfortC, -20, 45)),
    maxComfortC: Math.round(clamp(maxComfortC, -20, 45)),
    transport: TRANSPORT.has(src.transport) ? src.transport : defaults.transport,
    playStyle: STYLE.has(src.playStyle) ? src.playStyle : defaults.playStyle,
    daylightSafetyMarginMins: Math.round(clamp(margin, 0, 90)),
    paceMins,
  };
}

export function loadGolferPreferences() {
  try {
    return normalizeGolferPreferences(store.read());
  } catch {
    return normalizeGolferPreferences(null);
  }
}

export function saveGolferPreferences(partial) {
  try {
    const current = loadGolferPreferences();
    const next = normalizeGolferPreferences({
      ...current,
      ...(partial && typeof partial === "object" ? partial : {}),
      paceMins: {
        ...current.paceMins,
        ...(partial?.paceMins || {}),
      },
    });
    return store.write(next) ? next : false;
  } catch {
    return normalizeGolferPreferences(null);
  }
}

/**
 * 0–100 fit against saved preferences. Does not read or write the weather score.
 * `metrics` is the object already returned by computeGolfVerdict.
 */
export function computePersonalFit({ metrics = {}, preferences } = {}) {
  const prefs = normalizeGolferPreferences(preferences);
  const notes = [];
  let penalty = 0;

  const pop = finiteOr(metrics?.maxPrecipProb, 0);
  const mm = finiteOr(metrics?.totalPrecipMm, 0);
  const wind = finiteOr(metrics?.avgWind, 0);
  const gust = finiteOr(metrics?.maxGust, 0);
  const temp = Number.isFinite(Number(metrics?.avgTemp)) ? Number(metrics.avgTemp) : null;

  const rain = RAIN_LIMITS[prefs.rainTolerance];
  const popOver = Math.max(0, pop - rain.pop);
  const mmOver = Math.max(0, mm - rain.mm);
  if (popOver > 0 || mmOver > 0) {
    penalty += Math.min(50, Math.round(popOver * 0.5 + mmOver * 8));
    notes.push("More rain than you prefer");
  }

  const windLim = WIND_LIMITS[prefs.windTolerance];
  const windOver = Math.max(0, wind - windLim.wind);
  const gustOver = Math.max(0, gust - windLim.gust);
  if (windOver > 0 || gustOver > 0) {
    penalty += Math.min(40, Math.round(windOver * 2 + gustOver));
    notes.push("Windier than you prefer");
  }

  if (temp != null && temp < prefs.minComfortC) {
    penalty += Math.min(30, Math.round((prefs.minComfortC - temp) * 3));
    notes.push("Cooler than your comfort range");
  } else if (temp != null && temp > prefs.maxComfortC) {
    penalty += Math.min(30, Math.round((temp - prefs.maxComfortC) * 3));
    notes.push("Warmer than your comfort range");
  }

  if (prefs.transport === "walking" && (windOver > 0 || mmOver > 0)) {
    penalty += 5;
    notes.push("Walking will feel this more");
  }
  if (prefs.transport === "buggy" && mm >= 2) {
    penalty += 4;
    notes.push("Wet conditions can restrict buggies");
  }

  penalty = Math.round(penalty * STYLE_WEIGHT[prefs.playStyle]);
  return {
    score: clamp(100 - penalty, 0, 100),
    notes,
    note: notes[0] || "",
  };
}
