import { isDevFeatureEnabled } from "../config/devFeatures.js";
import { isDevRoute } from "../router.js?v=20260930-2";

const MAX_BUFFER = 100;

export const DevAnalyticsEvents = {
  ALERT_VIEWED: "alert_viewed",
  ALERT_DISMISSED: "alert_dismissed",
  SOCIETY_SCORED: "society_scored",
  RADAR_PANEL_VIEWED: "radar_panel_viewed",
  OUTLOOK_VIEWED: "outlook_viewed",
  ENTITLEMENT_CHANGED: "entitlement_changed",
  SETTINGS_VIEWED: "settings_viewed",
  ACCOUNT_VIEWED: "account_viewed",
  SPONSORED_PLACEMENT_EVALUATED: "sponsored_placement_evaluated",
  ROUND_EDITED: "round_edited",
  EVENING_PRACTICE_VIEWED: "evening_practice_viewed",
  PRACTICE_HOLES_SELECTED: "practice_holes_selected",
};

let sessionId = null;

function buffer() {
  if (!globalThis.__fwDevAnalytics) globalThis.__fwDevAnalytics = [];
  return globalThis.__fwDevAnalytics;
}

function sanitizeProps(props = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(props)) {
    if (/lat|lon|coord|geolocation/i.test(key)) continue;
    if (value && typeof value === "object") continue;
    clean[key] = value;
  }
  return clean;
}

export function getDevSessionId() {
  if (!sessionId) {
    sessionId = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return sessionId;
}

export function resetDevAnalytics() {
  globalThis.__fwDevAnalytics = [];
  sessionId = null;
}

/**
 * In-memory /dev analytics. No network beacon.
 * In-memory analytics on /dev and production; never sends a beacon.
 */
export function trackDevEvent(event, props = {}) {
  if (!event) return null;
  if (!isDevFeatureEnabled("analytics")) return null;
  if (!isDevRoute()) return null;

  const payload = {
    event: String(event),
    routeNamespace: isDevRoute() ? "dev" : "production",
    sessionId: getDevSessionId(),
    props: sanitizeProps(props),
    t: Date.now(),
  };

  const events = buffer();
  events.push(payload);
  if (events.length > MAX_BUFFER) events.shift();

  if (typeof window !== "undefined" && typeof console !== "undefined" && console.debug) {
    console.debug("[fw-dev-analytics]", payload.event);
  }

  return payload;
}

export function getDevAnalyticsBuffer() {
  return buffer().slice();
}
