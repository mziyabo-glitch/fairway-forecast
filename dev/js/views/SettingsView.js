import { esc } from "../../../shared/utils.js";
import { devFeatures } from "../config/devFeatures.js";

export function renderSettingsView({ notificationMode = "in_app_only" } = {}) {
  const flags = Object.entries(devFeatures)
    .map(([key, value]) => `<li><span>${esc(key)}</span><span>${value ? "On" : "Off"}</span></li>`)
    .join("");
  return `
    <div class="fw-view fw-view-settings">
      <h1 class="fw-page-title">Settings</h1>
      <section class="fw-settings-block" aria-label="Affiliate disclosure">
        <h2 class="fw-section-title">Affiliate disclosure</h2>
        <p>FairwayWeather may later show one sponsored golf card below the forecast verdict, rain timeline, and tee selector. Sponsored cards are off in this preview, so nothing is rendered. If a partner link is enabled later, it will use <span class="fw-code">rel="sponsored noopener"</span>.</p>
        <p class="fw-muted">Advertising slots are off. This preview does not load an ad script or iframe.</p>
      </section>
      <section class="fw-settings-block" aria-label="Notifications">
        <h2 class="fw-section-title">Notifications</h2>
        <p>Delivery mode: ${esc(notificationMode)}. Push and email are not sent.</p>
      </section>
      <section class="fw-settings-block" aria-label="Offline">
        <h2 class="fw-section-title">On this device</h2>
        <p>Saved courses and rounds stay in local storage. Live weather is not cached. If you are offline, open a saved course or round after the app shell has loaded.</p>
      </section>
      <section class="fw-settings-block" aria-label="Feature flags">
        <h2 class="fw-section-title">Preview flags</h2>
        <ul class="fw-flag-list">${flags}</ul>
      </section>
    </div>`;
}
