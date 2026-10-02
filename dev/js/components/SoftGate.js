/** Fallback for a temporarily unavailable feature, never a paywall. */
import { esc } from "../../../shared/utils.js";

export function renderSoftGate({ title = "Temporarily unavailable", body = "This feature is not available right now." } = {}) {
  return `<section class="fw-soft-gate" aria-label="${esc(title)}">
    <h2 class="fw-section-title">${esc(title)}</h2>
    <p>${esc(body)}</p>
  </section>`;
}

export function wireSoftGate() {
  // No account/paywall actions.
}
