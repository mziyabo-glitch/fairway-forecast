import { esc } from "../../../shared/utils.js";

export function renderAlertList(alerts = [], { compact = false } = {}) {
  if (!alerts?.length) {
    if (compact) return "";
    return `<p class="fw-muted">No weather changes on your saved rounds.</p>`;
  }
  return `
    <ul class="fw-alert-list ${compact ? "is-compact" : ""}" aria-label="Weather alerts">
      ${alerts
        .map(
          (alert) => `
        <li class="fw-alert">
          <div>
            <strong>${esc(alert.title)}</strong>
            <p>${esc(alert.detail)}</p>
          </div>
          <button type="button" class="fw-btn fw-btn-ghost" data-dismiss-alert="${esc(alert.fingerprint)}">Dismiss</button>
        </li>`
        )
        .join("")}
    </ul>`;
}

export function renderAlertsView({ alerts = [], lockedHtml = "" } = {}) {
  return `
    <div class="fw-view fw-view-alerts">
      <h1 class="fw-page-title">Alerts</h1>
      <p class="fw-muted">In-app only. Push delivery is off.</p>
      ${lockedHtml || renderAlertList(alerts)}
    </div>`;
}

export function wireAlerts(container, handlers = {}) {
  container?.querySelectorAll("[data-dismiss-alert]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onDismiss?.(btn.getAttribute("data-dismiss-alert")));
  });
}
