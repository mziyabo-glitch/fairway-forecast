/** Legacy compatibility: the old locked preview has been retired.
 * Features are available through Forecast, Rounds, Alerts and Society.
 */
export const PREMIUM_FEATURES = [];

export function renderPremiumLocks() {
  return "";
}

export function renderPremiumSheet() {
  return '<p>FairwayWeather tools are included free. Live radar and outbound notifications are not yet connected.</p>';
}

export function wirePremiumLocks() {
  // No premium lock controls are rendered.
}
