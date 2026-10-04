/** Production-safe Shot Caddie counters. In-memory plus local storage. No network. */
import { track as trackAnalytics } from "./analytics.js";

export const SHOT_COUNT_KEY = "fw_shot_caddie_counts_v1";
export const SHOT_SEEN_KEY = "fw_shot_caddie_seen_v1";

export const ShotCaddieEvents = {
  OPENED: "shot_caddie_opened",
  DISTANCE_ENTERED: "shot_caddie_distance_entered",
  RECOMMENDATION_GENERATED: "shot_caddie_recommendation_generated",
  REPEAT_USE: "shot_caddie_repeat_use",
};

function memoryCounts() {
  if (!globalThis.__fwShotCaddieCounts) globalThis.__fwShotCaddieCounts = {};
  return globalThis.__fwShotCaddieCounts;
}

function defaultStore() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch {
    /* private mode */
  }
  return null;
}

function readCounts(store) {
  try {
    const raw = store?.getItem?.(SHOT_COUNT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function shotCaddieCounts(store = defaultStore()) {
  return { ...memoryCounts(), ...readCounts(store) };
}

export function trackShotCaddieEvent(event, props = {}, { track = trackAnalytics, also = null, store = defaultStore() } = {}) {
  if (!event) return null;
  try {
    track?.(event, props);
  } catch {
    /* analytics must not break the shot */
  }
  try {
    also?.(event, props);
  } catch {
    /* dev wrapper is optional */
  }

  const mem = memoryCounts();
  mem[event] = (Number(mem[event]) || 0) + 1;
  try {
    if (store?.getItem && store?.setItem) {
      const counts = readCounts(store);
      counts[event] = (Number(counts[event]) || 0) + 1;
      store.setItem(SHOT_COUNT_KEY, JSON.stringify(counts));
    }
  } catch {
    /* storage full or blocked */
  }
  return mem[event];
}

export function noteShotCaddieOpened(options = {}) {
  const store = options.store === undefined ? defaultStore() : options.store;
  trackShotCaddieEvent(ShotCaddieEvents.OPENED, {}, { ...options, store });
  let seen = false;
  try {
    seen = store?.getItem?.(SHOT_SEEN_KEY) === "1";
  } catch {
    seen = false;
  }
  if (seen) trackShotCaddieEvent(ShotCaddieEvents.REPEAT_USE, {}, { ...options, store });
  try {
    store?.setItem?.(SHOT_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}
