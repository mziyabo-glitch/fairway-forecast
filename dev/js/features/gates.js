import { isDevFeatureEnabled } from "../config/devFeatures.js";
import { isDevRoute } from "../router.js?v=20260930-1";

/** Capabilities that already shipped on the premium shell, including production `/`. */
const EXISTING_ON_PRODUCTION = new Set([
  "savedRounds",
  "favouriteCourses",
  "nearbyCourses",
  "premiumShell",
]);

export function isAdvancedDev() {
  return isDevRoute();
}

/**
 * On /dev, flags control UI, network, and feature analytics.
 * On production routes the shared shell keeps its existing behaviour.
 */
export function featureOn(key) {
  if (!isDevRoute()) return EXISTING_ON_PRODUCTION.has(key);
  return isDevFeatureEnabled(key);
}
