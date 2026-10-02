import { isDevFeatureEnabled } from "../config/devFeatures.js";

/**
 * The rebuilt app powers both /dev and production.
 * Feature flags are deployment controls, never subscription entitlements.
 */
export function isAdvancedDev() {
  return true;
}

export function featureOn(key) {
  return isDevFeatureEnabled(key);
}
