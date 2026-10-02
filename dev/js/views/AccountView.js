/** Legacy account URL remains usable without showing tiers or paywall. */
import { esc } from "../../../shared/utils.js";

const INCLUDED = [
  "Unlimited saved rounds",
  "In-app round weather change alerts",
  "Extended outlook when forecast data is available",
  "Evening practice planner",
  "Society tee-time weather",
  "Golfer preferences, confidence, ground and safety insights",
];

export function renderAccountView() {
  return `
    <div class="fw-view fw-view-account">
      <h1 class="fw-page-title">FairwayWeather is free</h1>
      <p>All available golf-planning tools are included. No account or payment is required.</p>
      <ul class="fw-access-list">
        ${INCLUDED.map(feature => `<li><span>${esc(feature)}</span><span>Included</span></li>`).join("")}
      </ul>
      <p class="fw-muted">Saved courses, preferences and rounds remain on this device.</p>
      <p class="fw-muted">Radar is currently an illustrative preview, not live radar. Weather alerts appear inside the app when forecasts are checked; push and email delivery are not yet available.</p>
    </div>`;
}

export function wireAccountView() {
  // Tier selection was removed.
}
