import { esc } from "../../../shared/utils.js";
import { ENTITLEMENT_TIERS, FEATURE_ACCESS, canAccess } from "../entitlements/entitlements.js";

const TIER_COPY = {
  anonymous: "On this device only",
  free: "Local free",
  premium_preview: "Premium preview",
  premium: "Premium",
};

export function renderAccountView({ tier = "premium_preview" } = {}) {
  const features = Object.keys(FEATURE_ACCESS);
  return `
    <div class="fw-view fw-view-account">
      <h1 class="fw-page-title">Account</h1>
      <p class="fw-muted">Anonymous play stays on this device. There is no checkout in this preview.</p>
      <p class="fw-account-tier">Current access: <strong>${esc(TIER_COPY[tier] || tier)}</strong></p>
      <div class="fw-tier-list" role="group" aria-label="Preview tier">
        ${ENTITLEMENT_TIERS.map(
          (item) => `
          <button type="button" class="fw-btn ${item === tier ? "fw-btn-primary" : "fw-btn-secondary"}" data-tier="${esc(item)}">
            ${esc(TIER_COPY[item])}
          </button>`
        ).join("")}
      </div>
      <ul class="fw-access-list">
        ${features
          .map((feature) => {
            const open = canAccess(feature, tier);
            return `<li><span>${esc(featureLabel(feature))}</span><span>${open ? "Included" : "Preview locked"}</span></li>`;
          })
          .join("")}
      </ul>
    </div>`;
}

function featureLabel(key) {
  const labels = {
    unlimitedSavedRounds: "Unlimited saved rounds",
    weatherAlerts: "Weather alerts",
    radar: "Radar foundation",
    extendedOutlook: "Extended outlook",
    society: "Society weather",
    advancedNotifications: "Advanced notifications",
  };
  return labels[key] || key;
}

export function wireAccountView(container, handlers = {}) {
  container?.querySelectorAll("[data-tier]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onTier?.(btn.getAttribute("data-tier")));
  });
}
