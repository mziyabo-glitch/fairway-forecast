/** Course-local timezone and date helpers (forecast uses course TZ, not browser) */

import { nowSec } from "./utils.js";

/** Course-local Date parts from unix seconds + OpenWeather tz offset (seconds). */
export function courseLocalParts(unixSec, tzOffset = 0) {
  const d = new Date((unixSec + tzOffset) * 1000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
}

/** Midnight (00:00) on a course-local calendar day, as unix seconds. */
export function courseDayStartSec(year, month, day, tzOffset = 0) {
  return Math.floor(Date.UTC(year, month, day) / 1000) - tzOffset;
}

/** Course-local YMD for right now. */
export function getTodayCourseYMD(tzOffset = 0) {
  const p = courseLocalParts(nowSec(), tzOffset);
  return { year: p.year, month: p.month, day: p.day };
}

/** Day index (0 = today) for a Date object interpreted in course timezone. */
export function getDayIndexInCourseTZ(date, tzOffset = 0) {
  const today = getTodayCourseYMD(tzOffset);
  const target = {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
  };
  const todayStart = courseDayStartSec(today.year, today.month, today.day, tzOffset);
  const targetStart = courseDayStartSec(target.year, target.month, target.day, tzOffset);
  return Math.round((targetStart - todayStart) / 86400);
}

/** Build a Date at course-local midnight + day offset from today. */
export function courseDateFromDayOffset(dayOffset, tzOffset = 0) {
  const today = getTodayCourseYMD(tzOffset);
  const start = courseDayStartSec(today.year, today.month, today.day, tzOffset);
  const parts = courseLocalParts(start + dayOffset * 86400, tzOffset);
  return new Date(parts.year, parts.month, parts.day);
}

/** Minutes since midnight in course timezone. */
export function courseMinutesOfDay(unixSec, tzOffset = 0) {
  const p = courseLocalParts(unixSec, tzOffset);
  return p.hours * 60 + p.minutes;
}

/** Stable date key for course-local calendar day. */
export function courseDateKey(unixSec, tzOffset = 0) {
  const p = courseLocalParts(unixSec, tzOffset);
  return `${p.year}-${String(p.month + 1).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Date key from a browser Date aligned to course TZ day. */
export function dateToCourseKey(date, tzOffset = 0) {
  const start = courseDayStartSec(date.getFullYear(), date.getMonth(), date.getDate(), tzOffset);
  return courseDateKey(start, tzOffset);
}

export function formatDayLabelCourse(date, dayIndex) {
  if (dayIndex === 0) return "Today";
  if (dayIndex === 1) return "Tomorrow";
  const dayName = date.toLocaleDateString([], { weekday: "short" });
  return `${dayName} ${date.getDate()}`;
}
