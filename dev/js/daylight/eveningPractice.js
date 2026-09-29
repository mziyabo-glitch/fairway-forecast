/**
 * Evening practice planner for /dev/forecast.
 * Daylight math and window selection live here. Golf scores come from
 * shared/forecast-engine.js — this module does not reimplement them.
 */

import { computeGolfVerdict, getWindowData } from "../../../shared/forecast-engine.js";
import { courseDateKey } from "../../../shared/timezone.js";
import { fmtTimeCourse, nowSec } from "../../../shared/utils.js";

/** Planning uses the longer end so a round is not scheduled past last light. */
export const PRACTICE_DURATION_RANGES = {
  3: { min: 45, max: 60 },
  6: { min: 90, max: 105 },
  9: { min: 120, max: 140 },
};

export const PRACTICE_HOLES = [3, 6, 9];

/** Minutes before sunset treated as the end of playable light. An estimate. */
export const LAST_PLAYABLE_LEAD_MIN = 15;

const STEP_SEC = 15 * 60;
const TIGHT_SLACK_SEC = 30 * 60;

export function normalizePracticeHoles(holes) {
  const n = Number(holes);
  return PRACTICE_DURATION_RANGES[n] ? n : 9;
}

/**
 * Planning duration. Without paceMins, the range maximum is used so existing
 * evening-practice defaults stay put. A saved pace replaces that maximum.
 */
export function estimatedDurationMins(holes, paceMins) {
  const n = normalizePracticeHoles(holes);
  const fallback = PRACTICE_DURATION_RANGES[n].max;
  const custom = paceMins && Number(paceMins[n]);
  if (Number.isFinite(custom) && custom > 0) return custom;
  return fallback;
}

export function estimateLastPlayableLight(sunset, civilTwilightEnd, marginMins = LAST_PLAYABLE_LEAD_MIN) {
  if (!Number.isFinite(sunset)) return null;
  const margin = Number.isFinite(marginMins) ? marginMins : LAST_PLAYABLE_LEAD_MIN;
  const beforeSunset = sunset - margin * 60;
  if (!Number.isFinite(civilTwilightEnd)) return beforeSunset;
  // Civil twilight after sunset is not extra playing time.
  return Math.min(beforeSunset, civilTwilightEnd);
}

/** Copy of a daylight window with a different safety margin. Default margin is unchanged. */
export function withDaylightMargin(daylight, marginMins) {
  if (!daylight || !Number.isFinite(daylight.sunset)) return daylight;
  const lastPlayableLight = estimateLastPlayableLight(daylight.sunset, daylight.civilTwilightEnd, marginMins);
  if (lastPlayableLight === daylight.lastPlayableLight) return daylight;
  return { ...daylight, lastPlayableLight };
}

export function buildDaylightWindow({
  date,
  timezone = null,
  sunrise,
  sunset,
  civilTwilightEnd,
  source,
} = {}) {
  const window = {
    date: date || null,
    timezone: timezone || null,
    sunrise: Number.isFinite(sunrise) ? sunrise : null,
    sunset: Number.isFinite(sunset) ? sunset : null,
    lastPlayableLight: estimateLastPlayableLight(sunset, civilTwilightEnd),
    source: source || "estimate",
  };
  if (Number.isFinite(civilTwilightEnd)) window.civilTwilightEnd = civilTwilightEnd;
  return window;
}

function zoneParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** Unix seconds for a wall-clock time in an IANA zone. DST-safe. */
export function zonedLocalToUnix(year, month, day, hour, minute, timeZone) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired;
  for (let i = 0; i < 3; i++) {
    const parts = zoneParts(new Date(utc), timeZone);
    const got = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const diff = got - desired;
    if (diff === 0) break;
    utc -= diff;
  }
  return Math.floor(utc / 1000);
}

export function parseZonedTimestamp(value, timeZone) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value !== "string" || !value) return null;
  if (/[zZ]$/.test(value) || /[+-]\d{2}:\d{2}$/.test(value)) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match || typeof timeZone !== "string" || !timeZone.includes("/")) return null;
  return zonedLocalToUnix(+match[1], +match[2], +match[3], +match[4], +match[5], timeZone);
}

/** Format a unix instant in an IANA zone. Falls back to a fixed offset. */
export function formatCourseTime(unixSec, { timeZone, tzOffset = 0 } = {}) {
  if (!Number.isFinite(unixSec)) return "—";
  if (typeof timeZone === "string" && timeZone.includes("/")) {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .format(new Date(unixSec * 1000))
        .replace(/[\u202f\u00a0]/g, "");
    } catch {
      /* invalid zone */
    }
  }
  return fmtTimeCourse(unixSec, tzOffset);
}

export function formatDateKey(dateKey, timeZone) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(dateKey || "");
  const utc = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], 12, 0, 0));
  const zone = typeof timeZone === "string" && timeZone.includes("/") ? timeZone : "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: zone,
    }).format(utc);
  } catch {
    return dateKey;
  }
}

export function courseTodayKey(unix, timeZone, tzOffset = 0) {
  if (!Number.isFinite(unix)) return null;
  if (typeof timeZone === "string" && timeZone.includes("/")) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(unix * 1000));
    } catch {
      /* fall through */
    }
  }
  return courseDateKey(unix, tzOffset);
}

function dateKeyToEpochDay(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Math.floor(Date.UTC(+match[1], +match[2] - 1, +match[3]) / 86400000);
}

function ianaTimezone(value) {
  return typeof value === "string" && value.includes("/") ? value : null;
}

function isSyntheticShift(sunrise, baseSunrise) {
  if (!Number.isFinite(sunrise) || !Number.isFinite(baseSunrise)) return false;
  const delta = sunrise - baseSunrise;
  return delta !== 0 && Math.abs(delta % 86400) < 2;
}

function explicitDailySun(norm, dateKey, tzOffset, baseSunrise) {
  const daily = Array.isArray(norm?.daily) ? norm.daily : [];
  for (const day of daily) {
    const key = Number.isFinite(day?.dt)
      ? courseDateKey(day.dt, tzOffset)
      : typeof day?.date === "string"
        ? day.date
        : null;
    if (key !== dateKey) continue;
    if (!Number.isFinite(day?.sunrise) || !Number.isFinite(day?.sunset)) continue;
    if (isSyntheticShift(day.sunrise, baseSunrise)) continue;
    return day;
  }
  return null;
}

/**
 * Sunrise/sunset already on the normalized forecast.
 * Only the provider's own pair is trusted. Later days copied by adding 86400s
 * are marked estimate so a dev daylight fetch can replace them.
 */
export function providerDaylightSeries(norm) {
  if (!norm || typeof norm !== "object") return [];
  const tzOffset = Number.isFinite(norm.timezoneOffset) ? norm.timezoneOffset : 0;
  const baseSunrise = Number.isFinite(norm.sunrise) ? norm.sunrise : null;
  const baseSunset = Number.isFinite(norm.sunset) ? norm.sunset : null;
  const zone = ianaTimezone(norm.timezone);
  const keys = new Set();

  if (baseSunrise != null) keys.add(courseDateKey(baseSunrise, tzOffset));
  for (const day of norm.daily || []) {
    if (Number.isFinite(day?.dt)) keys.add(courseDateKey(day.dt, tzOffset));
    else if (typeof day?.date === "string") keys.add(day.date);
  }
  for (const hour of norm.hourly || []) {
    if (Number.isFinite(hour?.dt)) keys.add(courseDateKey(hour.dt, tzOffset));
  }
  if (!keys.size || baseSunrise == null || baseSunset == null) return [];

  const baseKey = courseDateKey(baseSunrise, tzOffset);
  const baseEpoch = dateKeyToEpochDay(baseKey);

  return [...keys]
    .filter((key) => dateKeyToEpochDay(key) != null)
    .sort()
    .map((dateKey) => {
      const explicit = explicitDailySun(norm, dateKey, tzOffset, baseSunrise);
      if (explicit) {
        return buildDaylightWindow({
          date: dateKey,
          timezone: zone,
          sunrise: explicit.sunrise,
          sunset: explicit.sunset,
          civilTwilightEnd: explicit.civilTwilightEnd,
          source: "provider",
        });
      }
      const deltaDays = dateKeyToEpochDay(dateKey) - baseEpoch;
      return buildDaylightWindow({
        date: dateKey,
        timezone: zone,
        sunrise: baseSunrise + deltaDays * 86400,
        sunset: baseSunset + deltaDays * 86400,
        source: deltaDays === 0 ? "provider" : "estimate",
      });
    });
}

export function parseOpenMeteoDaylight(payload) {
  const timeZone = ianaTimezone(payload?.timezone);
  const daily = payload?.daily;
  if (!timeZone || !daily) return [];
  const dates = daily.time || [];
  const sunrises = daily.sunrise || [];
  const sunsets = daily.sunset || [];
  const twilights = daily.civil_twilight_end || [];
  const windows = [];
  for (let i = 0; i < dates.length; i++) {
    const sunrise = parseZonedTimestamp(sunrises[i], timeZone);
    const sunset = parseZonedTimestamp(sunsets[i], timeZone);
    if (!dates[i] || !Number.isFinite(sunrise) || !Number.isFinite(sunset)) continue;
    const civil = parseZonedTimestamp(twilights[i], timeZone);
    windows.push(
      buildDaylightWindow({
        date: dates[i],
        timezone: timeZone,
        sunrise,
        sunset,
        civilTwilightEnd: civil,
        source: "open-meteo",
      })
    );
  }
  return windows;
}

export function needsDevDaylightFetch(norm) {
  const series = providerDaylightSeries(norm);
  if (!series.length) return true;
  return series.some((day) => day.source === "estimate");
}

export function mergeDaylightSeries(providerSeries = [], meteoSeries = []) {
  const byDate = new Map();
  let zone = null;
  for (const day of meteoSeries) {
    if (day?.timezone) zone = day.timezone;
    if (day?.date) byDate.set(day.date, day);
  }
  for (const day of providerSeries) {
    if (!day?.date) continue;
    if (day.source === "provider") {
      const existing = byDate.get(day.date);
      byDate.set(day.date, {
        ...day,
        timezone: day.timezone || existing?.timezone || zone,
      });
    } else if (!byDate.has(day.date)) {
      byDate.set(day.date, { ...day, timezone: day.timezone || zone });
    }
  }
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function ceilToStep(unix, step) {
  const n = Math.floor(unix);
  const rem = ((n % step) + step) % step;
  if (rem === 0) return n;
  return n + (step - rem);
}

function practiceFloor(daylight, now, tzOffset) {
  const today = courseTodayKey(now, daylight?.timezone, tzOffset) === daylight?.date;
  if (today) return now;
  return Number.isFinite(daylight?.sunrise) ? daylight.sunrise : now;
}

export function findNextSuitableEvening({ holes, upcoming = [], now, tzOffset = 0, paceMins } = {}) {
  const durationSec = estimatedDurationMins(holes, paceMins) * 60;
  const ordered = [...upcoming].filter((day) => day?.date).sort((a, b) => a.date.localeCompare(b.date));
  for (const day of ordered) {
    if (!Number.isFinite(day.lastPlayableLight)) continue;
    const floor = practiceFloor(day, now, tzOffset);
    const earliest = ceilToStep(Math.max(floor, Number.isFinite(day.sunrise) ? day.sunrise : floor), STEP_SEC);
    const latest = day.lastPlayableLight - durationSec;
    if (earliest <= latest) return day;
  }
  return null;
}

function insufficientSummary(holes, next) {
  const label = `${holes} holes`;
  let text = `Too late for ${label}. There isn't enough light left to finish before last playable light.`;
  if (next?.date) {
    text += ` Next evening with enough light: ${formatDateKey(next.date, next.timezone)}.`;
  }
  return text;
}

/**
 * Best remaining start that finishes by last playable light.
 * @returns {object} PracticePlan
 */
export function buildPracticePlan({
  holes,
  daylight,
  upcoming = [],
  hourly = [],
  now = nowSec(),
  units = "metric",
  countryCode = "gb",
  tzOffset = 0,
  paceMins,
  daylightSafetyMarginMins,
} = {}) {
  const practiceHoles = normalizePracticeHoles(holes);
  const durationMins = estimatedDurationMins(practiceHoles, paceMins);
  const durationSec = durationMins * 60;
  const marginActive = Number.isFinite(daylightSafetyMarginMins);
  const playDaylight = marginActive ? withDaylightMargin(daylight, daylightSafetyMarginMins) : daylight;
  const playUpcoming = marginActive
    ? (upcoming || []).map((day) => withDaylightMargin(day, daylightSafetyMarginMins))
    : upcoming;
  const last = playDaylight?.lastPlayableLight;
  const sunrise = playDaylight?.sunrise;
  const floor = practiceFloor(playDaylight, now, tzOffset);
  const earliestRaw = Math.max(floor, Number.isFinite(sunrise) ? sunrise : floor);
  const earliestStart = ceilToStep(earliestRaw, STEP_SEC);
  const latestSafeStart = Number.isFinite(last) ? last - durationSec : null;

  const plan = {
    holes: practiceHoles,
    estimatedDurationMins: durationMins,
    earliestStart,
    latestSafeStart,
    recommendedStart: null,
    recommendedEnd: null,
    daylightStatus: "insufficient",
    golfScore: null,
    summary: "",
  };

  const nextEvening = () =>
    findNextSuitableEvening({
      holes: practiceHoles,
      upcoming: (playUpcoming || []).filter((day) => day?.date && day.date !== playDaylight?.date),
      now,
      tzOffset,
      paceMins,
    });

  if (!Number.isFinite(latestSafeStart) || earliestStart > latestSafeStart) {
    plan.summary = insufficientSummary(practiceHoles, nextEvening());
    return plan;
  }

  const windowHours = durationMins / 60;
  let best = null;
  for (let start = earliestStart; start <= latestSafeStart; start += STEP_SEC) {
    const end = start + durationSec;
    if (end > last) continue;
    const windowData = getWindowData(hourly, start, windowHours);
    const verdict = computeGolfVerdict(
      windowData,
      hourly,
      start,
      windowHours,
      units,
      countryCode,
      tzOffset
    );
    const score = Number.isFinite(verdict?.score) ? verdict.score : 0;
    if (!best || score > best.score || (score === best.score && start < best.start)) {
      best = { start, end, score, verdict };
    }
  }

  if (!best) {
    plan.summary = insufficientSummary(practiceHoles, nextEvening());
    return plan;
  }

  const slack = latestSafeStart - earliestStart;
  const range = PRACTICE_DURATION_RANGES[practiceHoles];
  const paceValue = paceMins && Number(paceMins[practiceHoles]);
  const customPace = Number.isFinite(paceValue) && paceValue > 0 && paceValue !== range.max;
  plan.recommendedStart = best.start;
  plan.recommendedEnd = best.end;
  plan.daylightStatus = slack < TIGHT_SLACK_SEC ? "tight" : "enough";
  plan.golfScore = best.score;
  const statusLine =
    plan.daylightStatus === "tight"
      ? "Tight — this practice only just finishes before last light."
      : "Enough light to finish before last light.";
  const weather = best.verdict?.message || "";
  const durationLine = customPace
    ? `${practiceHoles} holes, about ${durationMins} minutes.`
    : `${practiceHoles} holes, about ${range.min}–${range.max} minutes.`;
  plan.summary = [
    statusLine,
    durationLine,
    weather,
  ]
    .filter(Boolean)
    .join(" ");
  return plan;
}

export function eveningFocusFrom({
  now,
  teeTimeUnix,
  lastPlayableLight,
  sunrise,
  dateIsToday = false,
} = {}) {
  let from = dateIsToday ? now : Number.isFinite(sunrise) ? sunrise : now;
  if (Number.isFinite(teeTimeUnix) && Number.isFinite(lastPlayableLight)) {
    const lower = dateIsToday ? now : Number.isFinite(sunrise) ? sunrise : teeTimeUnix;
    if (teeTimeUnix >= lower - 60 && teeTimeUnix <= lastPlayableLight) {
      from = Math.max(from, teeTimeUnix);
    }
  }
  if (!Number.isFinite(from)) return now;
  if (Number.isFinite(lastPlayableLight) && from > lastPlayableLight) return lastPlayableLight;
  return from;
}

/** Hourly rows from the evening anchor through last playable light. Capped so the page stays short. */
export function focusEveningHours(hourly, fromUnix, lastPlayableLight) {
  if (!Number.isFinite(fromUnix) || !Number.isFinite(lastPlayableLight)) return [];
  const rows = (hourly || []).filter((hour) => {
    if (!Number.isFinite(hour?.dt)) return false;
    return hour.dt + 3 * 3600 > fromUnix && hour.dt <= lastPlayableLight;
  });
  return rows.slice(-8);
}
