import { calculateDayScore } from "../../../shared/forecast-engine.js";
import { scoreToVerdict } from "../../../shared/utils.js";
import {
  courseDateKey,
  courseDayStartSec,
  formatDayLabelCourse,
  getTodayCourseYMD,
} from "../../../shared/timezone.js";

function confidenceFor(hourlyCount) {
  if (hourlyCount >= 8) return "high";
  if (hourlyCount >= 3) return "medium";
  return "low";
}

/**
 * Days beyond the primary 5-day strip.
 * Scores come from calculateDayScore only when hourly data exists.
 * Missing days are omitted — scores are never invented.
 */
export function buildExtendedOutlook(
  norm,
  { units = "metric", countryCode = "gb", windowHours = 4, primaryDays = 5, maxDays = 10 } = {}
) {
  const tz = norm?.timezoneOffset || 0;
  const byDay = new Map();

  const touch = (unix, kind) => {
    if (typeof unix !== "number") return;
    const dateKey = courseDateKey(unix, tz);
    const row = byDay.get(dateKey) || { dateKey, hourlyCount: 0, hasDaily: false };
    if (kind === "hourly") row.hourlyCount += 1;
    if (kind === "daily") row.hasDaily = true;
    byDay.set(dateKey, row);
  };

  for (const hour of norm?.hourly || []) touch(hour?.dt, "hourly");
  for (const day of norm?.daily || []) touch(day?.dt, "daily");

  const today = getTodayCourseYMD(tz);
  const todayStart = courseDayStartSec(today.year, today.month, today.day, tz);
  const ordered = [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const extra = ordered.slice(primaryDays, maxDays);

  const days = extra.map((row) => {
    const [year, month, day] = row.dateKey.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const start = courseDayStartSec(year, month - 1, day, tz);
    const dayIndex = Math.round((start - todayStart) / 86400);
    const base = {
      dateKey: row.dateKey,
      dayLabel: formatDayLabelCourse(date, dayIndex),
      dateLabel: date.toLocaleDateString([], { month: "short", day: "numeric" }),
      confidence: confidenceFor(row.hourlyCount),
    };

    if (row.hourlyCount < 3) {
      return {
        ...base,
        score: null,
        verdict: null,
        scored: false,
        note: "Not enough hourly data to score this day.",
      };
    }

    const scored = calculateDayScore(norm, date, units, windowHours, countryCode);
    const score = Number.isFinite(scored?.bestScore) ? scored.bestScore : null;
    return {
      ...base,
      score,
      verdict: score == null ? null : scoreToVerdict(score),
      scored: score != null,
      note: null,
    };
  });

  const availableDays = ordered.length;
  return {
    availableDays,
    primaryDays,
    days,
    note: days.length
      ? null
      : `Hourly and daily data cover ${availableDays} day${availableDays === 1 ? "" : "s"}. No further days are scored.`,
  };
}
