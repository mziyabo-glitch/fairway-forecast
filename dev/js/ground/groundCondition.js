/**
 * Separate ground-condition risk. Inferred only, and only from data that is already present.
 * Copy never states the ground as fact.
 */

import { tempToCelsius } from "../../../shared/utils.js";

export const GROUND_COPY = {
  unknown: "We don't know the ground condition. Recent rain is not in this forecast.",
  caution: "Soft ground or restrictions are possible.",
  low: "Recent rain in the data looks light. That does not confirm the ground is dry.",
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function extractPastRain(payload, nowUnix) {
  if (!payload || typeof payload !== "object") return null;
  const block = payload.pastRain || payload.recentRain || payload.rainHistory || null;
  if (block && typeof block === "object") {
    const h24 = num(block.h24 ?? block.hours24 ?? block.mm24);
    const h48 = num(block.h48 ?? block.hours48 ?? block.mm48);
    const h72 = num(block.h72 ?? block.hours72 ?? block.mm72);
    if (h24 != null || h48 != null || h72 != null) {
      const day = h24 ?? 0;
      return {
        h24: day,
        h48: h48 ?? day,
        h72: h72 ?? h48 ?? day,
        source: "payload",
      };
    }
  }

  const now = Number.isFinite(nowUnix) ? nowUnix : Math.floor(Date.now() / 1000);
  const past = (Array.isArray(payload.hourly) ? payload.hourly : []).filter(
    (hour) => Number.isFinite(hour?.dt) && hour.dt <= now && Number.isFinite(hour.rain_mm)
  );
  if (!past.length) return null;
  const sumSince = (seconds) =>
    Math.round(past.filter((hour) => hour.dt > now - seconds).reduce((sum, hour) => sum + hour.rain_mm, 0) * 10) / 10;
  return {
    h24: sumSince(24 * 3600),
    h48: sumSince(48 * 3600),
    h72: sumSince(72 * 3600),
    source: "hourly",
  };
}

/** true, false, or null when no recent temperature exists. */
export function recentFreezing(payload, nowUnix, units = "metric") {
  if (!payload || typeof payload !== "object") return null;
  const now = Number.isFinite(nowUnix) ? nowUnix : Math.floor(Date.now() / 1000);
  const temps = [];
  const current = payload.current;
  if (current && Number.isFinite(current.temp)) {
    const dt = Number.isFinite(current.dt) ? current.dt : now;
    if (dt <= now + 3600) temps.push(tempToCelsius(current.temp, units));
  }
  for (const hour of payload.hourly || []) {
    if (!Number.isFinite(hour?.dt) || !Number.isFinite(hour?.temp)) continue;
    if (hour.dt <= now && hour.dt >= now - 72 * 3600) temps.push(tempToCelsius(hour.temp, units));
  }
  const usable = temps.filter((temp) => Number.isFinite(temp));
  if (!usable.length) return null;
  return usable.some((temp) => temp <= 0);
}

/**
 * true when upcoming wind, temperature, and a dry window are all present.
 * null when those fields are missing. false when the data shows more rain or little drying.
 */
export function expectedDrying(payload, nowUnix, units = "metric") {
  if (!payload || typeof payload !== "object") return null;
  const now = Number.isFinite(nowUnix) ? nowUnix : Math.floor(Date.now() / 1000);
  const future = (payload.hourly || []).filter(
    (hour) => Number.isFinite(hour?.dt) && hour.dt > now && hour.dt <= now + 24 * 3600
  );
  if (!future.length) return null;
  const hasRain = future.some((hour) => Number.isFinite(hour.rain_mm) || typeof hour.pop === "number");
  const hasWind = future.some((hour) => Number.isFinite(hour.wind_speed));
  const hasTemp = future.some((hour) => Number.isFinite(hour.temp));
  if (!hasRain || !hasWind || !hasTemp) return null;

  const moreRain = future.some((hour) => (hour.rain_mm || 0) >= 0.2 || (hour.pop || 0) >= 0.4);
  if (moreRain) return false;

  const winds = future.map((hour) => hour.wind_speed).filter((value) => Number.isFinite(value));
  const temps = future
    .map((hour) => tempToCelsius(hour.temp, units))
    .filter((value) => Number.isFinite(value));
  const avgWind = winds.reduce((sum, value) => sum + value, 0) / winds.length;
  const avgTemp = temps.reduce((sum, value) => sum + value, 0) / temps.length;
  const breezy = units === "imperial" ? avgWind >= 7 : avgWind >= 3;
  return breezy && avgTemp >= 8;
}

function courseTraits(course) {
  if (!course || typeof course !== "object") return {};
  const traits = {};
  if (typeof course.drainage === "string" && course.drainage) traits.drainage = course.drainage;
  if (typeof course.exposure === "string" && course.exposure) traits.exposure = course.exposure;
  const elevation = Number(course.elevation);
  if (Number.isFinite(elevation)) traits.elevation = elevation;
  return traits;
}

export function assessGroundConditionRisk({ pastRain = null, freezing = null, drying = null, course = null } = {}) {
  const hasRain =
    pastRain &&
    [pastRain.h24, pastRain.h48, pastRain.h72].some((value) => Number.isFinite(Number(value)));
  if (!hasRain && freezing !== true) {
    return { level: "unknown", summary: GROUND_COPY.unknown, factors: [] };
  }

  let points = 0;
  const factors = [];
  if (hasRain) {
    const h24 = Number(pastRain.h24) || 0;
    const h48 = Number.isFinite(Number(pastRain.h48)) ? Number(pastRain.h48) : h24;
    const h72 = Number.isFinite(Number(pastRain.h72)) ? Number(pastRain.h72) : h48;
    if (h24 >= 12 || h48 >= 25 || h72 >= 40) {
      points += 3;
      factors.push("recent rain in the data is heavy");
    } else if (h24 >= 4 || h48 >= 10 || h72 >= 18) {
      points += 2;
      factors.push("recent rain in the data is moderate");
    } else if (h24 >= 1 || h48 >= 2 || h72 >= 3) {
      points += 1;
      factors.push("some recent rain is in the data");
    }
  }
  if (freezing === true) {
    points += 2;
    factors.push("recent temperatures reached freezing");
  }
  if (drying === true && points > 0) {
    points -= 1;
    factors.push("later wind and temperature may help drying");
  }

  const traits = courseTraits(course);
  if (traits.drainage === "poor") {
    points += 1;
    factors.push("the course record lists poor drainage");
  } else if (traits.drainage === "free" && points > 0) {
    points -= 1;
    factors.push("the course record lists free drainage");
  }
  if (traits.exposure === "sheltered" && points > 0) {
    points += 1;
    factors.push("the course record lists a sheltered exposure");
  }
  if (Number.isFinite(traits.elevation) && traits.elevation >= 250 && freezing === true) {
    points += 1;
    factors.push("the course record lists a higher elevation");
  }

  points = Math.max(0, points);
  let level = "low";
  if (points >= 3) level = "high";
  else if (points >= 1) level = "medium";

  return {
    level,
    summary: level === "low" ? GROUND_COPY.low : GROUND_COPY.caution,
    factors,
  };
}
