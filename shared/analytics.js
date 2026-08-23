/** Lightweight /dev/ analytics. No lat/lon or other sensitive location data. */

const SENSITIVE_KEY = /^(lat|lon|latitude|longitude|coords|coord|position|accuracy|geolocation)$/i;
const SENSITIVE_VAL = /lat|lon|coord|geolocation/i;

const MAX_BUFFER = 80;

function sanitizeProps(props = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(props)) {
    if (SENSITIVE_KEY.test(key) || SENSITIVE_VAL.test(key)) continue;
    if (value && typeof value === "object") continue;
    clean[key] = value;
  }
  return clean;
}

export function track(event, props = {}) {
  if (!event) return;
  const payload = {
    event: String(event),
    props: sanitizeProps(props),
    t: Date.now(),
  };

  if (typeof window !== "undefined") {
    window.__fwEvents = window.__fwEvents || [];
    window.__fwEvents.push(payload);
    if (window.__fwEvents.length > MAX_BUFFER) window.__fwEvents.shift();
    window.dispatchEvent(new CustomEvent("fw:analytics", { detail: payload }));
  }
}

export const AnalyticsEvents = {
  HOME_VIEWED: "home_viewed",
  COURSE_SEARCH: "course_search",
  COURSE_SELECTED: "course_selected",
  NEARBY_COURSES_USED: "nearby_courses_used",
  COURSE_FAVOURITED: "course_favourited",
  COURSE_UNFAVOURITED: "course_unfavourited",
  FORECAST_VIEWED: "forecast_viewed",
  FORECAST_DAY_CHANGED: "forecast_day_changed",
  TEE_TIME_CHANGED: "tee_time_changed",
  HOLES_CHANGED: "holes_changed",
  BETTER_TEE_TIME_USED: "better_tee_time_used",
  WHY_SCORE_OPENED: "why_score_opened",
  ROUND_SAVED: "round_saved",
  ROUND_OPENED: "round_opened",
  ROUND_DELETED: "round_deleted",
  HOURLY_EXPANDED: "hourly_expanded",
};
