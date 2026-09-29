/** /dev feature flags. Disabled features render no UI, make no extra network calls, and emit no feature analytics. */

export const devFeatures = {
  savedRounds: true,
  weatherAlerts: true,
  favouriteCourses: true,
  nearbyCourses: true,
  premiumShell: true,
  radarFoundation: true,
  extendedOutlook: true,
  societyWeather: true,
  monetisationHooks: true,
  analytics: true,
  pwaReadiness: true,
  adsenseSlot: false,
  affiliateCards: false,
};

export function isDevFeatureEnabled(key) {
  return devFeatures[key] === true;
}
