/** Forecast engine: tee times, scores, rain analysis, verdicts */

import {
  clamp,
  nowSec,
  windSpeedMph,
  fmtTimeCourse,
  formatDayLabel,
  scoreToStatus,
  rainIntensityCategory,
} from "./utils.js";

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

export function getRoundDurationHours(holes = 18) {
  return ROUND_DURATIONS[holes] ?? 4;
}

export function getForecastDaysAvailable(norm) {
  const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];
  if (!hourly.length) return 0;

  const days = new Set();
  for (const h of hourly) {
    if (typeof h?.dt === "number") {
      days.add(new Date(h.dt * 1000).toDateString());
    }
  }
  return Math.min(days.size, 5);
}

export function getDaylightWindowForDate(date, norm) {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  const targetDayStart = Math.floor(targetDate.getTime() / 1000);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = Math.floor(today.getTime() / 1000);
  const dayOffset = Math.round((targetDayStart - todayStart) / 86400);

  const baseSunrise = norm?.sunrise;
  const baseSunset = norm?.sunset;

  if (typeof baseSunrise === "number" && typeof baseSunset === "number") {
    return {
      sunrise: baseSunrise + dayOffset * 86400,
      sunset: baseSunset + dayOffset * 86400,
    };
  }

  return {
    sunrise: targetDayStart + FALLBACK_DAYLIGHT.startHour * 3600,
    sunset: targetDayStart + FALLBACK_DAYLIGHT.endHour * 3600,
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

    const courseDate = new Date((slot + tzOffset) * 1000);
    const hours = courseDate.getUTCHours().toString().padStart(2, "0");
    const mins = courseDate.getUTCMinutes().toString().padStart(2, "0");

    options.push({ value: slot, label: `${hours}:${mins}` });
  }

  return options;
}

export function getAvailableDates(norm, windowHours) {
  const numDays = getForecastDaysAvailable(norm);
  if (!numDays) return [];

  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < numDays; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const validTimes = getValidTeeTimesForDate(date, norm, windowHours);
    const dayLabel = formatDayLabel(date, i);

    dates.push({
      date,
      dateKey: date.toDateString(),
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

export function computeTeeTimeDecision(hourlyForecast, teeTimeUnix, windowHours, units = "metric", countryCode = "gb") {
  const windowData = getWindowData(hourlyForecast, teeTimeUnix, windowHours);

  if (!windowData.length) {
    return {
      status: "UNKNOWN",
      statusLabel: "No Data",
      icon: "❓",
      metrics: {},
      reasons: [],
      label: "No forecast data",
      message: "No forecast data available for this time window.",
      countryCode,
    };
  }

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

  const maxPrecipProb = precipProbs.length ? Math.max(...precipProbs) : 0;
  const totalPrecipMm = precipMms.reduce((s, v) => s + v, 0);
  const avgWind = windSpeeds.length ? windSpeeds.reduce((s, v) => s + v, 0) / windSpeeds.length : 0;
  const maxGust = gustSpeeds.length ? Math.max(...gustSpeeds) : avgWind * 1.3;
  const avgTemp = temps.length ? temps.reduce((s, v) => s + v, 0) / temps.length : null;
  const minTemp = temps.length ? Math.min(...temps) : null;

  const metrics = {
    maxPrecipProb: Math.round(maxPrecipProb),
    totalPrecipMm: Math.round(totalPrecipMm * 10) / 10,
    avgWind: Math.round(avgWind),
    maxGust: Math.round(maxGust),
    avgTemp: avgTemp !== null ? Math.round(avgTemp) : null,
    minTemp: minTemp !== null ? Math.round(minTemp) : null,
  };

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

  const rainRateMmHr = windowHours > 0 ? totalPrecipMm / windowHours : 0;
  const P = window.FF_PLAYABILITY || null;
  const windChillC = P?.computeWindChillC
    ? P.computeWindChillC(minTemp ?? avgTemp, avgWind)
    : null;
  const profile = P?.getCountryProfile ? P.getCountryProfile(countryCode) : null;

  const hardStop = P?.applyHardStops
    ? P.applyHardStops({
        airTempC: minTemp ?? avgTemp,
        windMph: avgWind,
        windChillC,
        thunder,
        snowIce,
        profile,
      })
    : null;

  if (hardStop) {
    return {
      status: hardStop.status,
      statusLabel: hardStop.status,
      icon: hardStop.status === "AVOID" ? "⛔" : "⚠️",
      metrics: { ...metrics, windChillC: windChillC !== null ? Math.round(windChillC) : null },
      reasons: hardStop.reasons || [],
      label: hardStop.label,
      message: hardStop.message,
      countryCode,
    };
  }

  const T = TEE_TIME_THRESHOLDS;
  const reasons = [];
  let status = "PLAY";

  if (totalPrecipMm >= T.noChance.totalPrecipMm) {
    status = "DELAY";
    reasons.push(`Heavy rain expected (~${metrics.totalPrecipMm}mm)`);
  } else if (
    maxPrecipProb >= T.noChance.precipProbAndRainMm.prob &&
    totalPrecipMm >= T.noChance.precipProbAndRainMm.mm
  ) {
    status = "DELAY";
    reasons.push(`Rain very likely (${metrics.maxPrecipProb}%)`);
  } else if (maxGust >= T.noChance.maxGust) {
    status = "AVOID";
    reasons.push(`Dangerous gusts (up to ${metrics.maxGust} mph)`);
  }

  if (status === "PLAY") {
    if (totalPrecipMm >= T.risky.totalPrecipMmMin && totalPrecipMm < T.risky.totalPrecipMmMax) {
      status = "RISKY";
      reasons.push(`~${metrics.totalPrecipMm}mm rain expected`);
    }
    if (maxPrecipProb >= T.risky.precipProbMin && maxPrecipProb <= T.risky.precipProbMax) {
      status = "RISKY";
      reasons.push(`Rain chance ${metrics.maxPrecipProb}%`);
    }
    if (maxGust >= T.risky.maxGustMin && maxGust <= T.risky.maxGustMax) {
      status = "RISKY";
      reasons.push(`Gusty winds (up to ${metrics.maxGust} mph)`);
    }
    if (avgWind >= T.risky.avgWind) {
      status = "RISKY";
      reasons.push(`Strong wind (~${metrics.avgWind} mph)`);
    }
  }

  const rainModerateMax = profile?.rainModerateMaxMmHr ?? 6.0;
  const rainHeavyMin = profile?.rainHeavyMinMmHr ?? 6.0;
  const windWindyMph = profile?.windWindyMph ?? 21;

  if (rainRateMmHr > rainHeavyMin) status = "AVOID";
  else if (rainRateMmHr > rainModerateMax) status = status === "PLAY" ? "DELAY" : status;
  else if (rainRateMmHr > 2) status = status === "PLAY" ? "RISKY" : status;

  if (avgWind >= windWindyMph && status === "PLAY") status = "RISKY";

  const iconMap = { PLAY: "✅", RISKY: "⚠️", DELAY: "⏳", AVOID: "⛔", UNKNOWN: "❓" };
  const labelMap = {
    PLAY: "PLAY — It's playable",
    RISKY: "RISKY — Mixed conditions",
    DELAY: "DELAY — Poor conditions",
    AVOID: "AVOID — Don't play",
    UNKNOWN: "Unknown",
  };
  const messageMap = {
    PLAY: "Solid window. Go play.",
    RISKY: "Playable, but expect compromises.",
    DELAY: "Consider waiting or rescheduling.",
    AVOID: "Not worth it in these conditions.",
    UNKNOWN: "Select a tee time to see conditions.",
  };

  return {
    status,
    statusLabel: status,
    icon: iconMap[status] || "❓",
    metrics,
    reasons,
    label: labelMap[status] || status,
    message: messageMap[status] || "",
    countryCode,
    rainRateMmHr,
  };
}

export function calculateRoundScore(windowData, units = "metric") {
  if (!windowData?.length) {
    return { score: 0, factors: [], status: scoreToStatus(0) };
  }

  let score = 100;
  const factors = [];

  const windSpeeds = windowData.map((h) => windSpeedMph(h.wind_speed, units)).filter(Number.isFinite);
  const pops = windowData.map((h) => (typeof h.pop === "number" ? h.pop : 0));
  const rainMms = windowData.map((h) => (typeof h.rain_mm === "number" ? h.rain_mm : 0));
  const temps = windowData.map((h) => h.temp).filter((t) => typeof t === "number");

  const avgWind = windSpeeds.length ? windSpeeds.reduce((a, b) => a + b, 0) / windSpeeds.length : 0;
  const maxPop = pops.length ? Math.max(...pops) : 0;
  const totalRain = rainMms.reduce((a, b) => a + b, 0);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;

  if (units === "metric") {
    if (avgWind > 12) { score -= 45; factors.push({ key: "wind", text: "Very windy throughout your round", impact: -45 }); }
    else if (avgWind > 9) { score -= 30; factors.push({ key: "wind", text: "Breezy — club selection matters", impact: -30 }); }
    else if (avgWind > 6) { score -= 18; factors.push({ key: "wind", text: "Moderate breeze", impact: -18 }); }
  } else {
    if (avgWind > 27) { score -= 45; factors.push({ key: "wind", text: "Very windy throughout your round", impact: -45 }); }
    else if (avgWind > 20) { score -= 30; factors.push({ key: "wind", text: "Breezy — club selection matters", impact: -30 }); }
    else if (avgWind > 14) { score -= 18; factors.push({ key: "wind", text: "Moderate breeze", impact: -18 }); }
  }

  if (totalRain >= 4) {
    score -= 40;
    factors.push({ key: "rain", text: `Heavy rain expected (~${totalRain.toFixed(1)}mm)`, impact: -40 });
  } else if (totalRain >= 1.5) {
    score -= 25;
    factors.push({ key: "rain", text: `Rain during your round (~${totalRain.toFixed(1)}mm)`, impact: -25 });
  } else if (totalRain >= 0.5) {
    score -= 12;
    factors.push({ key: "rain", text: "Light rain possible — waterproofs advised", impact: -12 });
  } else if (maxPop >= 0.85) {
    score -= 50;
    factors.push({ key: "rain", text: "Rain very likely throughout", impact: -50 });
  } else if (maxPop >= 0.6) {
    score -= 35;
    factors.push({ key: "rain", text: "Good chance of rain", impact: -35 });
  } else if (maxPop >= 0.35) {
    score -= 20;
    factors.push({ key: "rain", text: "Some rain risk", impact: -20 });
  }

  if (avgTemp !== null) {
    if (units === "metric") {
      if (avgTemp < 3 || avgTemp > 30) {
        score -= 25;
        factors.push({ key: "temp", text: `Extreme temperature (${Math.round(avgTemp)}°C)`, impact: -25 });
      } else if (avgTemp < 7 || avgTemp > 27) {
        score -= 12;
        factors.push({ key: "temp", text: `Uncomfortable temperature (${Math.round(avgTemp)}°C)`, impact: -12 });
      } else if (avgTemp < 10) {
        score -= 6;
        factors.push({ key: "temp", text: "Chilly — bring layers", impact: -6 });
      }
    } else {
      if (avgTemp < 38 || avgTemp > 86) {
        score -= 25;
        factors.push({ key: "temp", text: `Extreme temperature (${Math.round(avgTemp)}°F)`, impact: -25 });
      } else if (avgTemp < 45 || avgTemp > 82) {
        score -= 12;
        factors.push({ key: "temp", text: "Uncomfortable temperature", impact: -12 });
      }
    }
  }

  score = clamp(Math.round(score), 0, 100);
  return { score, factors, status: scoreToStatus(score), avgWind, totalRain, avgTemp, maxPop };
}

export function calculateDayScore(norm, date, units = "metric", windowHours = 4) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartSec = Math.floor(dayStart.getTime() / 1000);
  const dayEndSec = dayStartSec + 86400;

  const dayHourly = (norm?.hourly || []).filter(
    (h) => typeof h?.dt === "number" && h.dt >= dayStartSec && h.dt < dayEndSec
  );

  if (!dayHourly.length) return { score: 0, status: scoreToStatus(0) };

  const times = getValidTeeTimesForDate(date, norm, windowHours);
  if (!times.length) return calculateRoundScore(dayHourly.slice(0, Math.ceil(windowHours)), units);

  const midTime = times[Math.floor(times.length / 2)]?.value;
  if (!midTime) return calculateRoundScore(dayHourly.slice(0, Math.ceil(windowHours)), units);

  const windowData = getWindowData(norm.hourly, midTime, windowHours);
  return calculateRoundScore(windowData, units);
}

export function analyzeRainDuringRound(hourly, teeTimeUnix, windowHours, tzOffset = 0) {
  const windowData = getWindowData(hourly, teeTimeUnix, windowHours);
  if (!windowData.length) {
    return { hours: [], totalMm: 0, wettestPeriod: null, description: "No rain data", peakIntensity: null };
  }

  let totalMm = 0;
  let peakMm = 0;
  let peakHour = null;
  const hours = [];

  for (const h of windowData) {
    const mm = typeof h.rain_mm === "number" ? h.rain_mm : 0;
    totalMm += mm;
    const intensity = rainIntensityCategory(mm);
    hours.push({
      dt: h.dt,
      time: fmtTimeCourse(h.dt, tzOffset),
      mm,
      intensity,
    });
    if (mm > peakMm) {
      peakMm = mm;
      peakHour = h.dt;
    }
  }

  const wetHours = hours.filter((h) => h.mm >= 0.1);
  let wettestPeriod = null;
  if (wetHours.length) {
    wettestPeriod = `${wetHours[0].time} – ${wetHours[wetHours.length - 1].time}`;
  }

  let description = "Dry throughout your round";
  const peakIntensity = rainIntensityCategory(peakMm);
  if (totalMm >= 4) description = "Heavy rain expected — consider rescheduling";
  else if (totalMm >= 1.5) description = "Steady rain likely during your round";
  else if (totalMm >= 0.5) description = "Light rain at times — waterproofs recommended";
  else if (totalMm >= 0.1) description = "Possible drizzle — mostly playable";

  return {
    hours,
    totalMm: Math.round(totalMm * 10) / 10,
    wettestPeriod,
    description,
    peakIntensity,
    peakHour,
  };
}

export function getImpactCards(decision, scoreResult, units = "metric") {
  const m = decision?.metrics || {};
  const tu = units === "metric" ? "°C" : "°F";
  const windUnit = " mph";

  let rainLine = "Dry window expected";
  if (m.totalPrecipMm >= 4) rainLine = "Heavy rain — likely unplayable";
  else if (m.totalPrecipMm >= 1.5) rainLine = "Rain during round — pack waterproofs";
  else if (m.totalPrecipMm >= 0.5) rainLine = "Light rain possible";
  else if (m.maxPrecipProb >= 60) rainLine = `${m.maxPrecipProb}% chance of rain`;

  let windLine = "Calm conditions";
  if (m.maxGust >= 35) windLine = `Dangerous gusts up to ${m.maxGust}${windUnit}`;
  else if (m.avgWind >= 21) windLine = `Very windy (~${m.avgWind}${windUnit} avg)`;
  else if (m.avgWind >= 12) windLine = `Breezy (~${m.avgWind}${windUnit} avg)`;

  let tempLine = "Comfortable temperature";
  if (m.avgTemp !== null) {
    if (units === "metric") {
      if (m.avgTemp <= 3) tempLine = `Very cold (${m.avgTemp}${tu}) — layer up`;
      else if (m.avgTemp <= 8) tempLine = `Chilly (${m.avgTemp}${tu}) — bring layers`;
      else if (m.avgTemp >= 30) tempLine = `Hot (${m.avgTemp}${tu}) — stay hydrated`;
      else tempLine = `Around ${m.avgTemp}${tu} during your round`;
    } else {
      tempLine = `Around ${m.avgTemp}${tu} during your round`;
    }
  }

  return [
    { type: "rain", title: "Rain", value: m.totalPrecipMm != null ? `${m.totalPrecipMm} mm` : "—", line: rainLine },
    { type: "wind", title: "Wind", value: m.avgWind != null ? `${m.avgWind}${windUnit}` : "—", line: windLine },
    { type: "temp", title: "Temperature", value: m.avgTemp != null ? `${m.avgTemp}${tu}` : "—", line: tempLine },
  ];
}

export function findBetterTeeTime(norm, selectedDate, currentTeeTime, windowHours, units, countryCode, minImprovement = 12) {
  const times = getValidTeeTimesForDate(selectedDate, norm, windowHours);
  if (times.length < 2) return null;

  const currentWindow = getWindowData(norm.hourly, currentTeeTime, windowHours);
  const currentScore = calculateRoundScore(currentWindow, units).score;

  let best = null;
  let bestScore = currentScore;

  for (const t of times) {
    if (t.value === currentTeeTime) continue;
    const windowData = getWindowData(norm.hourly, t.value, windowHours);
    const { score } = calculateRoundScore(windowData, units);
    const decision = computeTeeTimeDecision(norm.hourly, t.value, windowHours, units, countryCode);
    if (decision.status === "AVOID") continue;
    if (score > bestScore) {
      bestScore = score;
      best = { teeTime: t.value, label: t.label, score, improvement: score - currentScore, decision };
    }
  }

  if (!best || best.improvement < minImprovement) return null;
  return best;
}

export function findNearestValidTime(options, preferredTime) {
  if (!options.length) return null;
  if (!preferredTime) return options[0]?.value ?? null;

  const prefDate = new Date(preferredTime * 1000);
  const prefMinutes = prefDate.getHours() * 60 + prefDate.getMinutes();
  let closest = options[0];
  let closestDiff = Infinity;

  for (const opt of options) {
    const optDate = new Date(opt.value * 1000);
    const optMinutes = optDate.getHours() * 60 + optDate.getMinutes();
    const diff = Math.abs(optMinutes - prefMinutes);
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

  const now = nowSec();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = date.toDateString() === today.toDateString();

  if (isToday) {
    const future = options.find((o) => o.value >= now);
    return future?.value ?? options[0].value;
  }

  return options[Math.floor(options.length / 3)]?.value ?? options[0].value;
}
