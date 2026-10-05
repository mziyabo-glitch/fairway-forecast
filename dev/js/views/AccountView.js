/** Planning stays free. Caddies has a separate premium launch. */
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
      <h1 class="fw-page-title">Free golf planning</h1>
      <p>Weather forecasts and round-planning tools are free. No account or payment is required for these tools.</p>
      <ul class="fw-access-list">
        ${INCLUDED.map(feature => `<li><span>${esc(feature)}</span><span>Included</span></li>`).join("")}
      </ul>
      <h2 class="fw-section-title">Caddies · Premium coming soon</h2>
      <p>Only Shot Caddie and Wind Caddie are premium. Subscriptions are not available to purchase yet.</p>
      <p class="fw-muted">Saved courses, preferences and rounds remain on this device.</p>
      <p class="fw-muted">Radar is currently an illustrative preview, not live radar. Weather alerts appear inside the app when forecasts are checked; push and email delivery are not yet available.</p>
    </div>`;
}

export function wireAccountView() {
  // Tier selection was removed.
}
