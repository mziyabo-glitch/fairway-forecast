/**
 * Compatibility API for legacy locally stored tiers.
 * Every implemented feature is included for all visitors; no paywall or
 * saved-round limit. The old tier is intentionally ignored.
 */
import { createJsonStore } from "../storage/jsonStore.js";

export const ENTITLEMENT_TIERS = ["free"];
export const FREE_SAVED_ROUND_LIMIT = Number.POSITIVE_INFINITY;
export const FEATURE_ACCESS = Object.freeze({
  unlimitedSavedRounds: true,
  weatherAlerts: true,
  radar: true,
  extendedOutlook: true,
  eveningPractice: true,
  society: true,
  advancedNotifications: true,
});

const legacyTierStore = createJsonStore("fw_dev_entitlement_tier");

export function canAccess(featureKey) {
  return Object.hasOwn(FEATURE_ACCESS, featureKey) && FEATURE_ACCESS[featureKey] === true;
}

export function defaultEntitlementTier() {
  return "free";
}

export function getEntitlementTier() {
  return "free";
}

/** Kept for older callers; users cannot be downgraded via stored tiers. */
export function setEntitlementTier() {
  legacyTierStore.clear();
  return "free";
}

export function resetEntitlementTier() {
  legacyTierStore.clear();
}
