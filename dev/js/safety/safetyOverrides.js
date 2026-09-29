/**
 * Safety thresholds for /dev. A trigger changes the verdict label only.
 * The objective weather score is left untouched.
 */

import { getWindowData } from "../../../shared/forecast-engine.js";
import { tempToCelsius, windSpeedMph } from "../../../shared/utils.js";

export const SAFETY_LABEL = "Safety risk";

export const SAFETY_THRESHOLDS = {
  dangerousGustMph: 45,
  extremeHeatC: 35,
  extremeColdC: -5,
  denseFogVisibilityM: 200,
};

const ICE_CODES = new Set([511, 611, 612, 613]);
const FOG_CODE = 741;

function weatherId(hour) {
  const id = Array.isArray(hour?.weather) ? hour.weather[0]?.id : null;
  return typeof id === "number" ? id : null;
}

function rowsFrom({ windowData, hourly, teeTimeUnix, windowHours }) {
  if (Array.isArray(windowData)) return windowData;
  if (Array.isArray(hourly) && Number.isFinite(teeTimeUnix)) {
    return getWindowData(hourly, teeTimeUnix, windowHours);
  }
  return [];
}

function hasThunder(rows) {
  return rows.some((hour) => {
    if (hour?.lightning === true || hour?.thunderstorm === true) return true;
    const id = weatherId(hour);
    if (id != null && Math.floor(id / 100) === 2) return true;
    const main = Array.isArray(hour?.weather) ? hour.weather[0]?.main : "";
    return /thunder|lightning/i.test(String(main || ""));
  });
}

function hasIce(rows) {
  return rows.some((hour) => {
    if (hour?.ice === true || hour?.freezing === true) return true;
    const id = weatherId(hour);
    return id != null && ICE_CODES.has(id);
  });
}

function hasDenseFog(rows) {
  return rows.some((hour) => {
    if (hour?.denseFog === true) return true;
    const visibility = Number.isFinite(hour?.visibility)
      ? hour.visibility
      : Number.isFinite(hour?.visibility_m)
        ? hour.visibility_m
        : null;
    if (visibility != null && visibility <= SAFETY_THRESHOLDS.denseFogVisibilityM) return true;
    return weatherId(hour) === FOG_CODE;
  });
}

function gustMph(rows, metrics, units) {
  const values = [];
  if (Number.isFinite(metrics?.maxGust)) values.push(metrics.maxGust);
  for (const hour of rows) {
    const mph = windSpeedMph(hour?.wind_gust ?? hour?.gust, units);
    if (Number.isFinite(mph)) values.push(mph);
  }
  if (!values.length) return null;
  return Math.max(...values);
}

function tempExtremes(rows, metrics, units) {
  const temps = [];
  if (Number.isFinite(metrics?.avgTemp)) temps.push(metrics.avgTemp);
  if (Number.isFinite(metrics?.minTemp)) temps.push(metrics.minTemp);
  for (const hour of rows) {
    const c = tempToCelsius(hour?.temp, units);
    if (Number.isFinite(c)) temps.push(c);
  }
  if (!temps.length) return { min: null, max: null };
  return { min: Math.min(...temps), max: Math.max(...temps) };
}

export function evaluateSafetyOverrides({
  windowData,
  hourly,
  teeTimeUnix,
  windowHours = 4,
  metrics = {},
  units = "metric",
} = {}) {
  const rows = rowsFrom({ windowData, hourly, teeTimeUnix, windowHours });
  const reasons = [];

  if (hasThunder(rows) || metrics?.thunder === true || metrics?.lightning === true) {
    reasons.push("Thunderstorms or lightning are in this forecast.");
  }

  const gust = gustMph(rows, metrics, units);
  if (gust != null && gust >= SAFETY_THRESHOLDS.dangerousGustMph) {
    reasons.push("Gusts reach the dangerous-gust threshold.");
  }

  const temps = tempExtremes(rows, metrics, units);
  if (temps.max != null && temps.max >= SAFETY_THRESHOLDS.extremeHeatC) {
    reasons.push("Temperature reaches the extreme-heat threshold.");
  }
  if (temps.min != null && temps.min <= SAFETY_THRESHOLDS.extremeColdC) {
    reasons.push("Temperature reaches the extreme-cold threshold.");
  }
  if (hasIce(rows)) {
    reasons.push("Ice is in this forecast.");
  }
  if (hasDenseFog(rows)) {
    reasons.push("Visibility is critically poor.");
  }

  return {
    active: reasons.length > 0,
    label: reasons.length > 0 ? SAFETY_LABEL : null,
    reasons,
    summary: reasons[0] || "",
  };
}

/** Display model. Copies the weather score through and does not write it back. */
export function safetyVerdictDisplay(verdict, safety) {
  const weatherScore = Number.isFinite(verdict?.score) ? verdict.score : null;
  if (!safety?.active) {
    return {
      weatherScore,
      label: verdict?.label || "",
      safetyActive: false,
      summary: "",
    };
  }
  return {
    weatherScore,
    label: SAFETY_LABEL,
    safetyActive: true,
    summary: safety.summary || "",
  };
}
