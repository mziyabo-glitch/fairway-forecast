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

export function scoreToVerdict(score) {
  if (score >= 90) return "EXCELLENT";
  if (score >= 80) return "GOOD";
  if (score >= 65) return "PLAYABLE";
  if (score >= 50) return "RISKY";
  if (score >= 30) return "POOR";
  return "AVOID";
}

export function scoreToStatus(score) {
  const verdict = scoreToVerdict(score);
  const map = {
    EXCELLENT: { key: "excellent", label: "Excellent" },
    GOOD: { key: "good", label: "Good" },
    PLAYABLE: { key: "playable", label: "Playable" },
    RISKY: { key: "risky", label: "Risky" },
    POOR: { key: "poor", label: "Poor" },
    AVOID: { key: "avoid", label: "Avoid" },
  };
  return map[verdict];
}

export function rainIntensityCategory(mmHr) {
  if (!Number.isFinite(mmHr) || mmHr < 0.1) return { key: "dry", label: "Dry" };
  if (mmHr <= 0.5) return { key: "drizzle", label: "Drizzle" };
  if (mmHr <= 2.0) return { key: "light", label: "Light rain" };
  if (mmHr <= 5.0) return { key: "moderate", label: "Moderate rain" };
  return { key: "heavy", label: "Heavy rain" };
}

/** Normalize display-unit temperature to °C for scoring. */
export function tempToCelsius(temp, units = "metric") {
  if (!Number.isFinite(temp)) return null;
  return units === "metric" ? temp : ((temp - 32) * 5) / 9;
}

export function weatherIdToIcon(weatherId) {
  if (typeof weatherId !== "number") return "☁️";
  const g = Math.floor(weatherId / 100);
  if (weatherId === 800) return "☀️";
  if (weatherId === 801) return "🌤️";
  if (g === 8) return "☁️";
  if (g === 2) return "⛈️";
  if (g === 3 || g === 5) return "🌧️";
  if (g === 6) return "🌨️";
  if (weatherId === 741) return "💨";
  if (g === 7) return "🌫️";
  return "🌦️";
}

export function windDegToCardinal(deg) {
  if (!Number.isFinite(deg)) return "—";
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
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
