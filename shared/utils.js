/** Shared utilities for Fairway Weather rebuild */

export function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return n;
  return Math.max(lo, Math.min(hi, n));
}

export function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function roundNum(n, dp = 0) {
  if (!Number.isFinite(n)) return "—";
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
}

export function windSpeedMph(windSpeed, units = "metric") {
  if (!Number.isFinite(windSpeed)) return null;
  return units === "metric" ? windSpeed * 2.237 : windSpeed;
}

export function tempUnit(units = "metric") {
  return units === "metric" ? "°C" : "°F";
}

export function fmtTimeCourse(unixSec, tzOffset = 0) {
  if (!Number.isFinite(unixSec)) return "—";
  const d = new Date((unixSec + tzOffset) * 1000);
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function formatDayLabel(date, index) {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const dayName = date.toLocaleDateString([], { weekday: "short" });
  return `${dayName} ${date.getDate()}`;
}

export function scoreToStatus(score) {
  if (score >= 85) return { key: "excellent", label: "Excellent" };
  if (score >= 72) return { key: "good", label: "Good" };
  if (score >= 48) return { key: "risky", label: "Risky" };
  if (score >= 25) return { key: "poor", label: "Poor" };
  return { key: "avoid", label: "Avoid" };
}

export function rainIntensityCategory(mmHr) {
  if (!Number.isFinite(mmHr) || mmHr < 0.1) return { key: "dry", label: "Dry" };
  if (mmHr <= 0.5) return { key: "drizzle", label: "Drizzle" };
  if (mmHr <= 2.0) return { key: "light", label: "Light rain" };
  if (mmHr <= 6.0) return { key: "moderate", label: "Moderate rain" };
  return { key: "heavy", label: "Heavy rain" };
}

export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
