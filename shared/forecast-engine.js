/** Forecast engine: tee times, scores, rain analysis, verdicts */

import {
  clamp,
  nowSec,
  windSpeedMph,
  fmtTimeCourse,
  scoreToStatus,
  scoreToVerdict,
  rainIntensityCategory,
  tempToCelsius,
  weatherIdToIcon,
} from "./utils.js";
import {
  courseLocalParts,
  courseDayStartSec,
  getTodayCourseYMD,
  getDayIndexInCourseTZ,
  courseDateFromDayOffset,
  courseDateKey,
  dateToCourseKey,
  formatDayLabelCourse,
  courseMinutesOfDay,
} from "./timezone.js";

export const ROUND_DURATIONS = {
  9: 2,
  18: 4,
};

const FALLBACK_DAYLIGHT = { startHour: 8, endHour: 17 };

const TEE_TIME_THRESHOLDS = {
  noChance: {
    totalPrecipMm: 4.0,
    precipProbAndRainMm: { prob: 80, mm: 1.5 },
    maxGust: 35,
  },
  risky: {
    totalPrecipMmMin: 1.5,
    totalPrecipMmMax: 4.0,
    precipProbMin: 50,
    precipProbMax: 79,
    maxGustMin: 25,
    maxGustMax: 34,
    avgWind: 18,
  },
};

const VERDICT_LABELS = {
  EXCELLENT: "Excellent — prime conditions",
  GOOD: "Good — solid golf weather",
  PLAYABLE: "Playable — manageable conditions",
  RISKY: "Risky — expect compromises",
  POOR: "Poor — tough round ahead",
  AVOID: "Avoid — not worth playing",
};

const VERDICT_ICONS = {
  EXCELLENT: "✅",
  GOOD: "✅",
  PLAYABLE: "🟢",
  RISKY: "⚠️",
  POOR: "⏳",
  AVOID: "⛔",
};

export function getRoundDurationHours(holes = 18) {
  return ROUND_DURATIONS[holes] ?? 4;
}

function getPlayability() {
  if (typeof globalThis !== "undefined" && globalThis.window?.FF_PLAYABILITY) {
    return globalThis.window.FF_PLAYABILITY;
  }
  if (typeof globalThis !== "undefined" && globalThis.FF_PLAYABILITY) {
    return globalThis.FF_PLAYABILITY;
  }
  return null;
}

export function getForecastDaysAvailable(norm) {
  const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
  if (!hourly.length) return 0;

  const tzOffset = norm?.timezoneOffset || 0;
  const days = new Set();
  for (const h of hourly) {
    if (typeof h?.dt === "number") {
      days.add(courseDateKey(h.dt, tzOffset));
    }
  }
  return Math.min(days.size, 5);
}

export function getDaylightWindowForDate(date, norm) {
  const tzOffset = norm?.timezoneOffset || 0;
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  const dayStart = courseDayStartSec(y, m, d, tzOffset);
  const dayKey = courseDateKey(dayStart, tzOffset);

  const daily = Array.isArray(norm?.daily) ? norm.daily : [];
  const match = daily.find((entry) => {
    if (typeof entry?.dt !== "number") return false;
    return courseDateKey(entry.dt, tzOffset) === dayKey;
  });

  if (typeof match?.sunrise === "number" && typeof match?.sunset === "number") {
    return { sunrise: match.sunrise, sunset: match.sunset };
  }

  const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
  const dayEnd = dayStart + 86400;
  const dayHours = hourly.filter((h) => h.dt >= dayStart && h.dt < dayEnd);
  if (dayHours.length) {
    const estimated = estimateDaylightFromHourly(dayHours, dayStart, tzOffset);
    if (estimated) return estimated;
  }

  const today = getTodayCourseYMD(tzOffset);
  const todayStart = courseDayStartSec(today.year, today.month, today.day, tzOffset);
  const dayOffset = Math.round((dayStart - todayStart) / 86400);
  const baseSunrise = norm?.sunrise;
  const baseSunset = norm?.sunset;

  if (typeof baseSunrise === "number" && typeof baseSunset === "number" && dayOffset === 0) {
    return { sunrise: baseSunrise, sunset: baseSunset };
  }

  if (typeof baseSunrise === "number" && typeof baseSunset === "number" && dayOffset > 0) {
    return {
      sunrise: baseSunrise + dayOffset * 86400,
      sunset: baseSunset + dayOffset * 86400,
    };
  }

  return {
    sunrise: dayStart + FALLBACK_DAYLIGHT.startHour * 3600,
    sunset: dayStart + FALLBACK_DAYLIGHT.endHour * 3600,
  };
}

function estimateDaylightFromHourly(dayHours, dayStart, tzOffset) {
  let earliest = null;
  let latest = null;
  for (const h of dayHours) {
    const w0 = Array.isArray(h?.weather) ? h.weather[0] : null;
    const id = typeof w0?.id === "number" ? w0.id : 800;
    const hour = courseLocalParts(h.dt, tzOffset).hours;
    if (hour < 5 || hour > 22) continue;
    if (id >= 700 && id < 800) continue;
    if (earliest === null || h.dt < earliest) earliest = h.dt;
    if (latest === null || h.dt > latest) latest = h.dt;
  }
  if (earliest === null) return null;
  return {
    sunrise: Math.max(dayStart + 6 * 3600, earliest - 3600),
    sunset: Math.min(dayStart + 86400 - 3600, latest + 3 * 3600),
  };
}

export function getValidTeeTimesForDate(date, norm, windowHours, stepMinutes = 8) {
  const tzOffset = norm?.timezoneOffset || 0;
  const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
  const timestamps = hourly.map((h) => h?.dt).filter((dt) => typeof dt === "number");
  if (!timestamps.length) return [];

  const forecastMin = Math.min(...timestamps);
  const forecastMax = Math.max(...timestamps);
  const { sunrise, sunset } = getDaylightWindowForDate(date, norm);

  const playStart = sunrise + 30 * 60;
  const playEnd = sunset - windowHours * 3600;
  const now = nowSec();
  const options = [];
  const stepSeconds = stepMinutes * 60;

  for (let slot = playStart; slot <= playEnd; slot += stepSeconds) {
    if (slot < now) continue;
    if (slot < forecastMin || slot > forecastMax) continue;
    const roundEnd = slot + windowHours * 3600;
    if (roundEnd > sunset) continue;

    const p = courseLocalParts(slot, tzOffset);
    const hours = p.hours.toString().padStart(2, "0");
    const mins = p.minutes.toString().padStart(2, "0");

    options.push({ value: slot, label: `${hours}:${mins}` });
  }

  return options;
}

export function getAvailableDates(norm, windowHours) {
  const numDays = getForecastDaysAvailable(norm);
  if (!numDays) return [];

  const tzOffset = norm?.timezoneOffset || 0;
  const dates = [];

  for (let i = 0; i < numDays; i++) {
    const date = courseDateFromDayOffset(i, tzOffset);
    const dateKey = dateToCourseKey(date, tzOffset);
    const validTimes = getValidTeeTimesForDate(date, norm, windowHours);
    const dayLabel = formatDayLabelCourse(date, i);

    dates.push({
      date,
      dateKey,
      index: i,
      label: dayLabel,
      dayLabel,
      dateLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      hasValidTimes: validTimes.length > 0,
    });
  }

  return dates;
}

export function getWindowData(hourly, teeTimeUnix, windowHours) {
  const windowEnd = teeTimeUnix + windowHours * 3600;
  return (hourly || []).filter(
    (h) => typeof h?.dt === "number" && h.dt >= teeTimeUnix && h.dt < windowEnd
  );
}

function extractWindowMetrics(windowData, units = "metric") {
  const precipProbs = windowData
    .map((h) => (typeof h.pop === "number" ? Math.round(h.pop * 100) : null))
    .filter((v) => v !== null);
  const precipMms = windowData.map((h) => (typeof h.rain_mm === "number" ? h.rain_mm : 0));
  const windSpeeds = windowData
    .map((h) => windSpeedMph(h.wind_speed, units))
    .filter((v) => v !== null);
  const gustSpeeds = windowData
    .map((h) => windSpeedMph(h.wind_gust ?? h.gust, units))
    .filter((v) => v !== null);
  const temps = windowData.map((h) => h.temp).filter((v) => typeof v === "number");

  const avgWind = windSpeeds.length ? windSpeeds.reduce((s, v) => s + v, 0) / windSpeeds.length : 0;
  const maxGust = gustSpeeds.length ? Math.max(...gustSpeeds) : avgWind * 1.3;
  const effectiveWind = Math.max(avgWind, maxGust * 0.85);
  const maxPrecipProb = precipProbs.length ? Math.max(...precipProbs) : 0;
  const totalPrecipMm = precipMms.reduce((s, v) => s + v, 0);
  const avgTempC =
    temps.length
      ? temps.reduce((s, v) => s + (tempToCelsius(v, units) ?? 0), 0) / temps.length
      : null;
  const minTempC =
    temps.length
      ? Math.min(...temps.map((v) => tempToCelsius(v, units)).filter(Number.isFinite))
      : null;

  const toGroup = (id) => (typeof id === "number" ? Math.floor(id / 100) : null);
  let thunder = false;
  let snowIce = false;

  for (const h of windowData) {
    const w0 = Array.isArray(h?.weather) ? h.weather[0] : null;
    const id = typeof w0?.id === "number" ? w0.id : null;
    const g = toGroup(id);
    if (g === 2) thunder = true;
    if (g === 6 || id === 511) snowIce = true;
  }

  return {
    maxPrecipProb,
    totalPrecipMm,
    avgWind,
    maxGust,
    effectiveWind,
    avgTempC,
    minTempC,
    thunder,
    snowIce,
    precipMms,
    precipProbs,
  };
}

function windPenaltyMph(effectiveMph) {
  if (effectiveMph < 10) return { penalty: 0, text: null };
  if (effectiveMph < 15) return { penalty: 5, text: "Light breeze — minor club adjustment" };
  if (effectiveMph < 20) return { penalty: 12, text: "Noticeable wind — club selection matters" };
  if (effectiveMph < 25) return { penalty: 20, text: "Challenging wind throughout" };
  if (effectiveMph < 30) return { penalty: 35, text: "Difficult wind — expect big scores" };
  return { penalty: 50, text: "Severe wind — consider postponing" };
}

function rainPenalty(totalRainMm, maxPop, profile) {
  const heavyMin = profile?.rainHeavyMinMmHr ?? 5;
  if (totalRainMm >= 6) {
    return { penalty: 45, text: `Heavy rain (~${totalRainMm.toFixed(1)} mm)` };
  }
  if (totalRainMm >= 3) {
    return { penalty: 30, text: `Moderate rain (~${totalRainMm.toFixed(1)} mm)` };
  }
  if (totalRainMm >= 1) {
    return { penalty: 18, text: `Light rain (~${totalRainMm.toFixed(1)} mm) — waterproofs advised` };
  }
  if (totalRainMm >= 0.2) {
    return { penalty: 8, text: "Drizzle possible — grips may slip" };
  }
  if (maxPop >= 0.85) {
    return { penalty: 40, text: "Rain very likely throughout" };
  }
  if (maxPop >= 0.6) {
    return { penalty: 25, text: "Good chance of rain" };
  }
  if (maxPop >= 0.35) {
    return { penalty: 12, text: "Some rain risk" };
  }
  if (totalRainMm > heavyMin) {
    return { penalty: 45, text: "Heavy rain expected" };
  }
  return { penalty: 0, text: null };
}

function tempPenaltyC(tempC, profile) {
  if (!Number.isFinite(tempC)) return { penalty: 0, text: null };
  const coldWarn = profile?.coldWarnC ?? 10;
  const coldTough = profile?.coldToughC ?? 4;

  if (tempC <= -2 || tempC >= 35) {
    return { penalty: 28, text: `Extreme temperature (${Math.round(tempC)}°C)` };
  }
  if (tempC < coldTough || tempC >= 32) {
    return { penalty: 15, text: `Uncomfortable temperature (${Math.round(tempC)}°C)` };
  }
  if (tempC < coldWarn) {
    return { penalty: 8, text: "Chilly — bring layers and hand warmers" };
  }
  if (tempC >= 28) {
    return { penalty: 10, text: "Hot — stay hydrated" };
  }
  return { penalty: 0, text: null };
}

function hardStopScore(hardStop) {
  if (hardStop?.status === "AVOID") {
    if (/thunder|lightning/i.test(hardStop.label || "")) return 5;
    if (/snow|ice|freezing|wind chill/i.test(hardStop.label || "")) return 10;
    return 15;
  }
  return 20;
}

export function buildGolfHeroMessage(metrics, factors, windowData, teeTimeUnix, windowHours, tzOffset) {
  if (!windowData?.length) return "Select a tee time to see your golf forecast.";

  const { totalPrecipMm, effectiveWind, maxPrecipProb } = metrics;
  const dryUntil = findDryUntilHour(windowData, teeTimeUnix, tzOffset);
  const rainFrom = findRainStartHour(windowData, teeTimeUnix, windowHours, tzOffset);

  const parts = [];

  if (totalPrecipMm < 0.2 && maxPrecipProb < 35) {
    if (dryUntil) parts.push(`Dry until ${dryUntil}`);
    else parts.push("Dry throughout your round");
  } else if (totalPrecipMm >= 3) {
    parts.push("Rain likely for much of the round — waterproofs essential");
  } else if (rainFrom) {
    parts.push(`Rain from ${rainFrom} — plan for wet conditions on the back nine`);
  } else if (totalPrecipMm >= 0.5) {
    parts.push("Light rain at times — keep towels handy");
  } else if (maxPrecipProb >= 50) {
    parts.push(`${maxPrecipProb}% rain chance — stay flexible`);
  }

  if (effectiveWind >= 25) {
    parts.push("Strong wind will affect every shot");
  } else if (effectiveWind >= 15) {
    parts.push(parts.length ? "and breezy" : "Breezy but playable — club up into the wind");
  } else if (effectiveWind >= 10 && !parts.length) {
    parts.push("Light breeze — a fair test of ball-striking");
  }

  if (!parts.length) {
    const positive = factors.filter((f) => !f.impact || f.impact >= -8);
    if (positive.length === 0) return "Conditions are manageable — standard golf prep applies.";
    return "Calm and dry — a good window to go low.";
  }

  return parts.slice(0, 2).join(". ") + ".";
}

function findDryUntilHour(windowData, teeTimeUnix, tzOffset) {
  for (const h of windowData) {
    const mm = typeof h.rain_mm === "number" ? h.rain_mm : 0;
    const pop = typeof h.pop === "number" ? h.pop : 0;
    if (mm >= 0.2 || pop >= 0.5) {
      if (h.dt === teeTimeUnix) return null;
      const prev = windowData.find((x) => x.dt < h.dt);
      if (prev) return fmtTimeCourse(prev.dt + 3600, tzOffset);
      return fmtTimeCourse(h.dt, tzOffset);
    }
  }
  return fmtTimeCourse(windowData[windowData.length - 1].dt, tzOffset);
}

function findRainStartHour(windowData, teeTimeUnix, windowHours, tzOffset) {
  const holeDurationMin = (windowHours * 60) / 18;
  for (let i = 0; i < windowData.length; i++) {
    const h = windowData[i];
    const mm = typeof h.rain_mm === "number" ? h.rain_mm : 0;
    const pop = typeof h.pop === "number" ? h.pop : 0;
    if (mm >= 0.5 || pop >= 0.65) {
      const elapsedMin = ((h.dt - teeTimeUnix) / 60);
      const hole = Math.max(1, Math.min(18, Math.ceil(elapsedMin / holeDurationMin)));
      if (hole <= 3) return fmtTimeCourse(h.dt, tzOffset);
      const suffix = hole === 11 || hole === 12 || hole === 13 ? "th" : ["th", "st", "nd", "rd"][hole % 10 > 3 ? 0 : hole % 10] || "th";
      return `the ${hole}${suffix} hole`;
    }
  }
  return null;
}

/**
 * Authoritative golf verdict — single source for score, status, and messaging.
 * Returns { score, status, verdict, message, factors, metrics, reasons, label, icon, hardStop }
 */
export function computeGolfVerdict(
  windowData,
  hourlyForecast,
  teeTimeUnix,
  windowHours,
  units = "metric",
  countryCode = "gb",
  tzOffset = 0
) {
  if (!windowData?.length) {
    return {
      score: 0,
      status: scoreToStatus(0),
      verdict: "AVOID",
      message: "No forecast data available for this time window.",
      factors: [],
      metrics: {},
      reasons: [],
      label: "No Data",
      icon: "❓",
      hardStop: false,
      countryCode,
    };
  }

  const raw = extractWindowMetrics(windowData, units);
  const metrics = {
    maxPrecipProb: Math.round(raw.maxPrecipProb),
    totalPrecipMm: Math.round(raw.totalPrecipMm * 10) / 10,
    avgWind: Math.round(raw.avgWind),
    maxGust: Math.round(raw.maxGust),
    effectiveWind: Math.round(raw.effectiveWind),
    avgTemp: raw.avgTempC !== null ? Math.round(raw.avgTempC) : null,
    minTemp: raw.minTempC !== null ? Math.round(raw.minTempC) : null,
  };

  const P = getPlayability();
  const profile = P?.getCountryProfile ? P.getCountryProfile(countryCode) : null;
  const windChillC = P?.computeWindChillC
    ? P.computeWindChillC(raw.minTempC ?? raw.avgTempC, raw.avgWind)
    : null;

  if (windChillC !== null) metrics.windChillC = Math.round(windChillC);

  const hardStop = P?.applyHardStops
    ? P.applyHardStops({
        airTempC: raw.minTempC ?? raw.avgTempC,
        windMph: raw.avgWind,
        windChillC,
        thunder: raw.thunder,
        snowIce: raw.snowIce,
        profile,
      })
    : null;

  if (hardStop) {
    const score = hardStopScore(hardStop);
    const verdict = scoreToVerdict(score);
    return {
      score,
      status: scoreToStatus(score),
      verdict,
      message: hardStop.message,
      factors: (hardStop.reasons || []).map((r) => ({ key: "hardStop", text: r, impact: score - 100 })),
      metrics,
      reasons: hardStop.reasons || [],
      label: hardStop.label,
      icon: hardStop.status === "AVOID" ? "⛔" : "⚠️",
      hardStop: true,
      countryCode,
      rainRateMmHr: windowHours > 0 ? raw.totalPrecipMm / windowHours : 0,
    };
  }

  let score = 100;
  const factors = [];
  const maxPop = Math.max(...windowData.map((h) => (typeof h.pop === "number" ? h.pop : 0)));

  const wind = windPenaltyMph(raw.effectiveWind);
  if (wind.penalty) {
    score -= wind.penalty;
    factors.push({ key: "wind", text: wind.text, impact: -wind.penalty });
  }

  const rain = rainPenalty(raw.totalPrecipMm, maxPop, profile);
  if (rain.penalty) {
    score -= rain.penalty;
    factors.push({ key: "rain", text: rain.text, impact: -rain.penalty });
  }

  const temp = tempPenaltyC(raw.minTempC ?? raw.avgTempC, profile);
  if (temp.penalty) {
    score -= temp.penalty;
    factors.push({ key: "temp", text: temp.text, impact: -temp.penalty });
  }

  const rainRateMmHr = windowHours > 0 ? raw.totalPrecipMm / windowHours : 0;
  const T = TEE_TIME_THRESHOLDS;
  const reasons = [];

  if (raw.totalPrecipMm >= T.noChance.totalPrecipMm) {
    score = Math.min(score, 25);
    reasons.push(`Heavy rain expected (~${metrics.totalPrecipMm}mm)`);
  } else if (
    raw.maxPrecipProb >= T.noChance.precipProbAndRainMm.prob &&
    raw.totalPrecipMm >= T.noChance.precipProbAndRainMm.mm
  ) {
    score = Math.min(score, 28);
    reasons.push(`Rain very likely (${metrics.maxPrecipProb}%)`);
  } else if (raw.maxGust >= T.noChance.maxGust) {
    score = Math.min(score, 12);
    reasons.push(`Dangerous gusts (up to ${metrics.maxGust} mph)`);
  }

  const rainModerateMax = profile?.rainModerateMaxMmHr ?? 5.0;
  const rainHeavyMin = profile?.rainHeavyMinMmHr ?? 5.0;
  const windWindyMph = profile?.windWindyMph ?? 21;

  if (rainRateMmHr > rainHeavyMin) score = Math.min(score, 15);
  else if (rainRateMmHr > rainModerateMax) score = Math.min(score, 35);
  else if (rainRateMmHr > 2) score = Math.min(score, 55);

  if (raw.effectiveWind >= windWindyMph) score = Math.min(score, 58);

  score = clamp(Math.round(score), 0, 100);
  const verdict = scoreToVerdict(score);
  const message = buildGolfHeroMessage(
    { ...metrics, effectiveWind: raw.effectiveWind, maxPrecipProb: raw.maxPrecipProb },
    factors,
    windowData,
    teeTimeUnix,
    windowHours,
    tzOffset
  );

  return {
    score,
    status: scoreToStatus(score),
    verdict,
    message,
    factors,
    metrics,
    reasons,
    label: VERDICT_LABELS[verdict] || verdict,
    icon: VERDICT_ICONS[verdict] || "❓",
    hardStop: false,
    countryCode,
    rainRateMmHr,
    avgWind: raw.avgWind,
    totalRain: raw.totalPrecipMm,
    avgTemp: raw.avgTempC,
    maxPop,
  };
}

/** @deprecated Use computeGolfVerdict */
export function computeTeeTimeDecision(hourlyForecast, teeTimeUnix, windowHours, units = "metric", countryCode = "gb") {
  const windowData = getWindowData(hourlyForecast, teeTimeUnix, windowHours);
  const v = computeGolfVerdict(windowData, hourlyForecast, teeTimeUnix, windowHours, units, countryCode);
  const legacyStatus =
    v.hardStop || v.verdict === "AVOID"
      ? "AVOID"
      : v.verdict === "POOR"
        ? "DELAY"
        : v.verdict === "RISKY"
          ? "RISKY"
          : "PLAY";
  return {
    status: legacyStatus,
    statusLabel: legacyStatus,
    icon: v.icon,
    metrics: v.metrics,
    reasons: [...v.reasons, ...v.factors.map((f) => f.text)],
    label: v.label,
    message: v.message,
    countryCode,
    rainRateMmHr: v.rainRateMmHr,
  };
}

/** @deprecated Use computeGolfVerdict */
export function calculateRoundScore(windowData, units = "metric", countryCode = "gb") {
  if (!windowData?.length) {
    return { score: 0, factors: [], status: scoreToStatus(0) };
  }
  const teeTimeUnix = windowData[0].dt;
  const windowHours = windowData.length;
  const v = computeGolfVerdict(windowData, windowData, teeTimeUnix, windowHours, units, countryCode);
  return {
    score: v.score,
    factors: v.factors,
    status: v.status,
    avgWind: v.avgWind,
    totalRain: v.totalRain,
    avgTemp: v.avgTemp,
    maxPop: v.maxPop,
  };
}

export function calculateDayScore(norm, date, units = "metric", windowHours = 4, countryCode = "gb") {
  const times = getValidTeeTimesForDate(date, norm, windowHours);
  if (!times.length) {
    const tzOffset = norm?.timezoneOffset || 0;
    const y = date.getFullYear();
    const dayStart = courseDayStartSec(y, date.getMonth(), date.getDate(), tzOffset);
    const dayEnd = dayStart + 86400;
    const dayHourly = (norm?.hourly || []).filter(
      (h) => typeof h?.dt === "number" && h.dt >= dayStart && h.dt < dayEnd
    );
    if (!dayHourly.length) return { score: 0, status: scoreToStatus(0), weatherIcon: "☁️" };
    const slice = dayHourly.slice(0, Math.ceil(windowHours));
    const v = computeGolfVerdict(slice, norm?.hourly, slice[0]?.dt, windowHours, units, countryCode);
    return {
      score: v.score,
      bestScore: v.score,
      representativeScore: v.score,
      status: v.status,
      weatherIcon: pickRepresentativeIcon(slice),
      bestTeeTime: null,
      bestTeeTimeUnix: null,
    };
  }

  let bestScore = -1;
  let bestTeeTime = null;
  let bestWindow = null;
  let totalScore = 0;

  for (const t of times) {
    const windowData = getWindowData(norm.hourly, t.value, windowHours);
    const v = computeGolfVerdict(windowData, norm.hourly, t.value, windowHours, units, countryCode);
    totalScore += v.score;
    if (v.score > bestScore) {
      bestScore = v.score;
      bestTeeTime = t;
      bestWindow = windowData;
    }
  }

  const representativeScore = Math.round(totalScore / times.length);
  return {
    score: bestScore,
    bestScore,
    representativeScore,
    bestTeeTime: bestTeeTime?.label ?? null,
    bestTeeTimeUnix: bestTeeTime?.value ?? null,
    status: scoreToStatus(bestScore),
    weatherIcon: pickRepresentativeIcon(bestWindow || []),
  };
}

function pickRepresentativeIcon(windowData) {
  if (!windowData?.length) return "☁️";
  const mid = windowData[Math.floor(windowData.length / 2)];
  const w0 = Array.isArray(mid?.weather) ? mid.weather[0] : null;
  return weatherIdToIcon(w0?.id);
}

function computeWettestPeriod(hours) {
  const wet = hours.filter((h) => h.rainfallMm >= 0.1);
  if (!wet.length) return null;

  const segments = [];
  let seg = [wet[0]];
  for (let i = 1; i < wet.length; i++) {
    if (wet[i].dt - wet[i - 1].dt <= 3600) seg.push(wet[i]);
    else {
      segments.push(seg);
      seg = [wet[i]];
    }
  }
  segments.push(seg);

  let best = segments[0];
  let bestPeak = 0;
  for (const s of segments) {
    const peak = Math.max(...s.map((h) => h.rainfallMm));
    const total = s.reduce((a, h) => a + h.rainfallMm, 0);
    const score = peak * 2 + total;
    if (score > bestPeak) {
      bestPeak = score;
      best = s;
    }
  }

  return `${best[0].time} – ${best[best.length - 1].time}`;
}

export function analyzeRainDuringRound(hourly, teeTimeUnix, windowHours, tzOffset = 0) {
  const windowData = getWindowData(hourly, teeTimeUnix, windowHours);
  if (!windowData.length) {
    return {
      hours: [],
      totalMm: 0,
      wettestPeriod: null,
      description: "No rain data",
      peakIntensity: null,
      peakHour: null,
      peakRainfallMm: 0,
    };
  }

  let totalMm = 0;
  let peakMm = 0;
  let peakHour = null;
  const hours = [];

  for (const h of windowData) {
    const rainfallMm = typeof h.rain_mm === "number" ? h.rain_mm : 0;
    const probability = typeof h.pop === "number" ? Math.round(h.pop * 100) : 0;
    totalMm += rainfallMm;
    const intensity = rainIntensityCategory(rainfallMm);
    const w0 = Array.isArray(h?.weather) ? h.weather[0] : null;
    hours.push({
      dt: h.dt,
      time: fmtTimeCourse(h.dt, tzOffset),
      probability,
      rainfallMm,
      mm: rainfallMm,
      intensity,
      weatherIcon: weatherIdToIcon(w0?.id),
    });
    if (rainfallMm > peakMm) {
      peakMm = rainfallMm;
      peakHour = h.dt;
    }
  }

  const wettestPeriod = computeWettestPeriod(hours);
  const peakIntensity = rainIntensityCategory(peakMm);

  let description = "Dry throughout your round";
  if (totalMm >= 6) description = "Heavy rain expected — consider rescheduling";
  else if (totalMm >= 3) description = "Steady rain likely during your round";
  else if (totalMm >= 1) description = "Light rain at times — waterproofs recommended";
  else if (totalMm >= 0.2) description = "Possible drizzle — mostly playable";
  else if (hours.some((h) => h.probability >= 60 && h.rainfallMm < 0.1)) {
    description = "Dry now but rain possible — watch the radar";
  }

  return {
    hours,
    totalMm: Math.round(totalMm * 10) / 10,
    wettestPeriod,
    description,
    peakIntensity,
    peakHour,
    peakRainfallMm: peakMm,
  };
}

export function getImpactCards(verdict, units = "metric") {
  const m = verdict?.metrics || {};
  const tu = units === "metric" ? "°C" : "°F";
  const windUnit = " mph";
  const displayTemp =
    units === "metric"
      ? m.avgTemp
      : m.avgTemp != null
        ? Math.round((m.avgTemp * 9) / 5 + 32)
        : null;

  let rainLine = "Dry window expected";
  if (m.totalPrecipMm >= 4) rainLine = "Heavy rain — likely unplayable";
  else if (m.totalPrecipMm >= 1.5) rainLine = "Rain during round — pack waterproofs";
  else if (m.totalPrecipMm >= 0.5) rainLine = "Light rain possible";
  else if (m.maxPrecipProb >= 60) rainLine = `${m.maxPrecipProb}% chance of rain`;

  let windLine = "Calm conditions";
  if (m.maxGust >= 35) windLine = `Dangerous gusts up to ${m.maxGust}${windUnit}`;
  else if (m.effectiveWind >= 25) windLine = `Very windy (~${m.avgWind}${windUnit} avg, gusts ${m.maxGust})`;
  else if (m.effectiveWind >= 15) windLine = `Breezy (~${m.avgWind}${windUnit} avg)`;

  let tempLine = "Comfortable temperature";
  if (displayTemp !== null) {
    if (m.avgTemp <= 3) tempLine = `Very cold (${displayTemp}${tu}) — layer up`;
    else if (m.avgTemp <= 8) tempLine = `Chilly (${displayTemp}${tu}) — bring layers`;
    else if (m.avgTemp >= 30) tempLine = `Hot (${displayTemp}${tu}) — stay hydrated`;
    else tempLine = `Around ${displayTemp}${tu} during your round`;
  }

  return [
    { type: "rain", title: "Rain", value: m.totalPrecipMm != null ? `${m.totalPrecipMm} mm` : "—", line: rainLine },
    { type: "wind", title: "Wind", value: m.avgWind != null ? `${m.avgWind}${windUnit}` : "—", line: windLine },
    { type: "temp", title: "Temperature", value: displayTemp != null ? `${displayTemp}${tu}` : "—", line: tempLine },
  ];
}

function compareTeeTimeReasons(currentV, bestV) {
  const bullets = [];
  const cm = currentV.metrics;
  const bm = bestV.metrics;

  if (bm.totalPrecipMm < cm.totalPrecipMm - 0.3) bullets.push("Drier");
  if (bm.effectiveWind < cm.effectiveWind - 2) bullets.push("Gusts lower");
  if (bm.maxPrecipProb < cm.maxPrecipProb - 15) bullets.push("Less rain risk");
  if (bm.avgTemp > cm.avgTemp + 2) bullets.push("Warmer");
  if (bm.avgTemp < cm.avgTemp - 2) bullets.push("Cooler");
  if (!bullets.length) bullets.push("Better overall conditions");
  return bullets;
}

export function findBetterTeeTime(
  norm,
  selectedDate,
  currentTeeTime,
  windowHours,
  units,
  countryCode,
  minImprovement = 11
) {
  const times = getValidTeeTimesForDate(selectedDate, norm, windowHours);
  if (times.length < 2) return null;

  const currentWindow = getWindowData(norm.hourly, currentTeeTime, windowHours);
  const currentV = computeGolfVerdict(
    currentWindow,
    norm.hourly,
    currentTeeTime,
    windowHours,
    units,
    countryCode
  );

  let best = null;
  let bestScore = currentV.score;

  for (const t of times) {
    if (t.value === currentTeeTime) continue;
    const windowData = getWindowData(norm.hourly, t.value, windowHours);
    const v = computeGolfVerdict(windowData, norm.hourly, t.value, windowHours, units, countryCode);
    if (v.hardStop || v.verdict === "AVOID") continue;
    if (v.score > bestScore) {
      bestScore = v.score;
      best = {
        teeTime: t.value,
        label: t.label,
        score: v.score,
        improvement: v.score - currentV.score,
        verdict: v,
        reasons: compareTeeTimeReasons(currentV, v),
      };
    }
  }

  if (!best || best.improvement < minImprovement) return null;
  return best;
}

export function findNearestValidTime(options, preferredTime, tzOffset = 0) {
  if (!options.length) return null;
  if (!preferredTime) return options[0]?.value ?? null;

  const prefMin = courseMinutesOfDay(preferredTime, tzOffset);
  let closest = options[0];
  let closestDiff = Infinity;

  for (const opt of options) {
    const optMin = courseMinutesOfDay(opt.value, tzOffset);
    let diff = Math.abs(optMin - prefMin);
    if (diff > 720) diff = 1440 - diff;
    if (diff < closestDiff) {
      closestDiff = diff;
      closest = opt;
    }
  }

  return closest?.value ?? options[0]?.value ?? null;
}

export function getDefaultTeeTime(date, norm, windowHours) {
  const options = getValidTeeTimesForDate(date, norm, windowHours);
  if (!options.length) return null;

  const tzOffset = norm?.timezoneOffset || 0;
  const now = nowSec();
  const todayKey = courseDateKey(now, tzOffset);
  const dateKey = dateToCourseKey(date, tzOffset);
  const isToday = dateKey === todayKey;

  if (isToday) {
    const future = options.find((o) => o.value >= now);
    return future?.value ?? options[0].value;
  }

  const targetMin = 9 * 60 + 30;
  let best = options[0];
  let bestDiff = Infinity;
  for (const o of options) {
    const diff = Math.abs(courseMinutesOfDay(o.value, tzOffset) - targetMin);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = o;
    }
  }
  return best.value;
}

export function getBestDayThisWeek(dayScores, days) {
  if (!days?.length) return null;
  let best = null;
  for (const d of days) {
    const ds = dayScores[d.dateKey];
    if (!ds || !d.hasValidTimes) continue;
    if (!best || ds.bestScore > best.score) {
      best = {
        dateKey: d.dateKey,
        dayLabel: d.dayLabel,
        score: ds.bestScore,
        bestTeeTime: ds.bestTeeTime,
        verdict: scoreToVerdict(ds.bestScore),
        status: ds.status || scoreToStatus(ds.bestScore),
      };
    }
  }
  return best;
}

/** Compact “where should I play?” card for Home favourites — one fetch per course. */
export function summarizeCoursePlayability(norm, units = "metric", countryCode = "gb") {
  const windowHours = 4;
  const dates = getAvailableDates(norm, windowHours);
  const day = dates.find((d) => d.hasValidTimes) || dates[0];
  if (!day) return null;

  const ds = calculateDayScore(norm, day.date, units, windowHours, countryCode);
  const current = norm?.current;
  const icon = ds.weatherIcon || weatherIdToIcon(current?.weather?.[0]?.id);
  const temp = Number.isFinite(current?.temp)
    ? Math.round(current.temp)
    : Number.isFinite(ds.score)
      ? null
      : null;

  let hint = "Dry for most of the day";
  const hourly = norm?.hourly || [];
  if (ds.bestTeeTimeUnix) {
    const rain = analyzeRainDuringRound(hourly, ds.bestTeeTimeUnix, windowHours, norm?.timezoneOffset || 0);
    if (rain?.description && /rain|wet|shower/i.test(rain.description)) {
      hint = rain.wettestPeriod ? `Rain after ${rain.hours?.[0]?.time || rain.wettestPeriod}` : rain.description;
    } else if (rain?.hours?.length) {
      const firstWet = rain.hours.find((h) => h.rainfallMm >= 0.3 || h.probability >= 55);
      hint = firstWet ? `Rain after ${firstWet.time}` : "Dry for most of the day";
    }
  }

  return {
    icon,
    temp,
    score: ds.bestScore ?? ds.score,
    verdict: scoreToVerdict(ds.bestScore ?? ds.score),
    status: ds.status || scoreToStatus(ds.bestScore ?? ds.score),
    bestTeeTime: ds.bestTeeTime,
    hint,
    dayLabel: day.dayLabel,
  };
}
