import { computeGolfVerdict, getWindowData } from "../../../shared/forecast-engine.js?v=20261005-round-flow";
import { courseDayStartSec } from "../../../shared/timezone.js";
import { fmtTimeCourse } from "../../../shared/utils.js";

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function pickExtreme(slots, direction) {
  const scored = slots.filter((slot) => slot.score != null);
  if (!scored.length) return null;
  return scored.reduce((chosen, slot) => {
    if (direction === "max") return slot.score > chosen.score ? slot : chosen;
    return slot.score < chosen.score ? slot : chosen;
  });
}

/**
 * Score society groups by calling the existing forecast engine.
 * Slots with no hourly window stay unscored.
 */
export function generateSocietySlots({
  norm,
  dateKey,
  firstTee,
  intervalMinutes = 10,
  groups = 4,
  playersPerGroup = 4,
  windowHours = 4,
  units = "metric",
  countryCode = "gb",
} = {}) {
  const parsedDate = parseDateKey(dateKey);
  const clock = parseClock(firstTee);
  if (!parsedDate || !clock) {
    return { slots: [], best: null, riskiest: null, error: "Enter a date and first tee time." };
  }

  const groupCount = clampInt(groups, 1, 24, 4);
  const interval = clampInt(intervalMinutes, 5, 60, 10);
  const players = clampInt(playersPerGroup, 1, 8, 4);
  const tz = norm?.timezoneOffset || 0;
  const dayStart = courseDayStartSec(parsedDate.y, parsedDate.m - 1, parsedDate.d, tz);
  const firstUnix = dayStart + clock.h * 3600 + clock.m * 60;
  const hourly = Array.isArray(norm?.hourly) ? norm.hourly : [];

  const slots = [];
  for (let i = 0; i < groupCount; i++) {
    const teeTime = firstUnix + i * interval * 60;
    const windowData = getWindowData(hourly, teeTime, windowHours);
    if (!windowData.length) {
      slots.push({
        group: i + 1,
        teeTime,
        timeLabel: fmtTimeCourse(teeTime, tz),
        players,
        score: null,
        verdict: null,
        label: null,
        rainProbability: null,
        wind: null,
        scored: false,
      });
      continue;
    }

    const verdict = computeGolfVerdict(windowData, hourly, teeTime, windowHours, units, countryCode, tz);
    slots.push({
      group: i + 1,
      teeTime,
      timeLabel: fmtTimeCourse(teeTime, tz),
      players,
      score: verdict.score,
      verdict: verdict.verdict,
      label: verdict.label,
      rainProbability: verdict.metrics?.maxPrecipProb ?? null,
      wind: verdict.metrics?.avgWind ?? null,
      scored: Number.isFinite(verdict.score),
    });
  }

  return {
    slots,
    best: pickExtreme(slots, "max"),
    riskiest: pickExtreme(slots, "min"),
    dateKey,
    intervalMinutes: interval,
    groups: groupCount,
    playersPerGroup: players,
    error: null,
  };
}
