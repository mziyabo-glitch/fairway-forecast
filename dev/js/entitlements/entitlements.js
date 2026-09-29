import { isDevFeatureEnabled } from "../config/devFeatures.js";
import { createJsonStore } from "../storage/jsonStore.js";

export const ENTITLEMENT_TIERS = ["anonymous", "free", "premium_preview", "premium"];

export const FREE_SAVED_ROUND_LIMIT = 2;

/** Soft-gated features. Anonymous and free stay local; no checkout. */
export const FEATURE_ACCESS = {
  unlimitedSavedRounds: ["premium_preview", "premium"],
  weatherAlerts: ["premium_preview", "premium"],
  radar: ["premium_preview", "premium"],
  extendedOutlook: ["premium_preview", "premium"],
  society: ["premium_preview", "premium"],
  advancedNotifications: ["premium_preview", "premium"],
};

const store = createJsonStore("fw_dev_entitlement_tier");

export function canAccess(featureKey, tier = "anonymous") {
  const allowed = FEATURE_ACCESS[featureKey];
  if (!allowed) return false;
  return allowed.includes(tier);
}

export function defaultEntitlementTier() {
  return isDevFeatureEnabled("premiumShell") ? "premium_preview" : "anonymous";
}

export function getEntitlementTier() {
  const saved = store.read();
  const tier = typeof saved === "string" ? saved : saved?.tier;
  if (ENTITLEMENT_TIERS.includes(tier)) return tier;
  return defaultEntitlementTier();
}

export function setEntitlementTier(tier) {
  if (!ENTITLEMENT_TIERS.includes(tier)) return getEntitlementTier();
  store.write({ tier });
  return tier;
}

export function resetEntitlementTier() {
  store.clear();
}
