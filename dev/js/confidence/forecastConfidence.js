/**
 * Separate forecast confidence. One weather provider exists, so agreement is not available.
 * Rain-timing comparison uses the saved round snapshot shape (rainStartUnix, checkedAt).
 */

import { getWindowData } from "../../../shared/forecast-engine.js?v=20261005-round-flow";

export const CONFIDENCE_RULES = {
  leadMediumHours: 24,
  leadLowHours: 72,
  aroundOneHourMinSec: 45 * 60,
  aroundOneHourMaxSec: 90 * 60,
};

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function typicalStepSec(hourly) {
  const dts = (hourly || [])
    .map((hour) => hour?.dt)
    .filter((dt) => Number.isFinite(dt))
    .sort((a, b) => a - b);
  if (dts.length < 2) return 3600;
  const deltas = [];
  for (let i = 1; i < dts.length; i++) {
    const delta = dts[i] - dts[i - 1];
    if (delta >= 30 * 60 && delta <= 6 * 3600) deltas.push(delta);
  }
  if (!deltas.length) return 3600;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)];
}

function hourMissingCoreField(hour) {
  if (!hour || typeof hour !== "object") return true;
  if (!Number.isFinite(hour.temp)) return true;
  if (typeof hour.pop !== "number") return true;
  if (!Number.isFinite(hour.wind_speed)) return true;
  const id = Array.isArray(hour.weather) ? hour.weather[0]?.id : null;
  return typeof id !== "number";
}

/**
 * Compare two saved snapshots. A missing side means there is no second snapshot.
 * Equal rain starts are "no change", not an invented shift.
 */
export function compareRainSnapshots(original, latest) {
  if (!original || !latest) return { available: false, changed: false, deltaSec: null };
  const a = finiteOrNull(original.rainStartUnix);
  const b = finiteOrNull(latest.rainStartUnix);
  if (a == null && b == null) return { available: true, changed: false, deltaSec: 0 };
  if (a == null || b == null) return { available: true, changed: true, deltaSec: null };
  const deltaSec = Math.abs(a - b);
  return {
    available: true,
    changed: deltaSec >= CONFIDENCE_RULES.aroundOneHourMinSec,
    deltaSec,
  };
}

function summaryFor(level, rainPhrase, reasons) {
  if (rainPhrase === "around-one-hour") {
    return "Medium confidence — rain timing may move by around one hour.";
  }
  if (level === "high") return "High confidence — hourly data for this tee time looks complete.";
  const detail = reasons[0] || "some of the forecast detail is thin";
  const label = level === "low" ? "Low" : "Medium";
  return `${label} confidence — ${detail}.`;
}

export function assessForecastConfidence({
  nowUnix,
  teeTimeUnix,
  windowHours = 4,
  hourly = [],
  originalSnapshot = null,
  latestSnapshot = null,
} = {}) {
  const reasons = [];
  let severity = 0;

  const leadSec =
    Number.isFinite(teeTimeUnix) && Number.isFinite(nowUnix) ? teeTimeUnix - nowUnix : null;
  if (leadSec == null) {
    severity += 2;
    reasons.push("the tee time is missing");
  } else {
    const leadHours = leadSec / 3600;
    if (leadHours > CONFIDENCE_RULES.leadLowHours) {
      severity += 2;
      reasons.push("the tee time is more than three days away");
    } else if (leadHours > CONFIDENCE_RULES.leadMediumHours) {
      severity += 1;
      reasons.push("the tee time is more than a day away");
    }
  }

  const windowData = Number.isFinite(teeTimeUnix) ? getWindowData(hourly, teeTimeUnix, windowHours) : [];
  const step = typicalStepSec(hourly);
  const expected = Math.max(1, Math.round((windowHours * 3600) / step));
  if (!windowData.length) {
    severity += 2;
    reasons.push("hourly data does not cover this tee time");
  } else if (windowData.length / expected < 0.5) {
    severity += 2;
    reasons.push("hourly data for this window is incomplete");
  } else if (windowData.length < expected) {
    severity += 1;
    reasons.push("some hours in this window are missing");
  }

  if (windowData.length) {
    const missing = windowData.filter(hourMissingCoreField).length / windowData.length;
    if (missing >= 0.5) {
      severity += 2;
      reasons.push("weather fields are missing for much of this window");
    } else if (missing > 0) {
      severity += 1;
      reasons.push("a weather field is missing in this window");
    }
  }

  const rain = compareRainSnapshots(originalSnapshot, latestSnapshot);
  let rainPhrase = null;
  if (rain.available && rain.changed) {
    if (
      rain.deltaSec != null &&
      rain.deltaSec >= CONFIDENCE_RULES.aroundOneHourMinSec &&
      rain.deltaSec <= CONFIDENCE_RULES.aroundOneHourMaxSec
    ) {
      severity = Math.max(severity, 1);
      rainPhrase = "around-one-hour";
      reasons.push("rain timing may move by around one hour");
    } else if (rain.deltaSec != null && rain.deltaSec > CONFIDENCE_RULES.aroundOneHourMaxSec) {
      severity = Math.max(severity, 2);
      reasons.push("rain timing has moved by more than an hour between saved checks");
    } else {
      severity = Math.max(severity, 1);
      reasons.push("rain timing differs between saved checks");
    }
  }

  let level = "high";
  if (severity >= 2) level = "low";
  else if (severity === 1) level = "medium";
  if (rainPhrase === "around-one-hour" && level === "low") {
    /* a one-hour shift is medium unless other gaps already make it low */
  }

  return {
    level,
    summary: summaryFor(level, rainPhrase && level === "medium" ? rainPhrase : null, reasons),
    providerAgreement: "not available",
    reasons,
    rainTimingCompared: rain.available,
  };
}

