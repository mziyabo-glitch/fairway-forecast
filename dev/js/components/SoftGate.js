import { esc } from "../../../shared/utils.js";

export function renderSoftGate({ title, body, action = "account" } = {}) {
  return `
    <section class="fw-soft-gate" aria-label="${esc(title || "Premium preview")}">
      <h2 class="fw-section-title">${esc(title || "Premium preview")}</h2>
      <p>${esc(body || "This part of the preview is available on Premium preview.")}</p>
      <p class="fw-muted">No checkout. Your courses and rounds stay on this device.</p>
      <button type="button" class="fw-btn fw-btn-secondary" data-soft-gate="${esc(action)}">View account</button>
    </section>`;
}

export function wireSoftGate(container, onAccount) {
  container?.querySelectorAll("[data-soft-gate]").forEach((btn) => {
    btn.addEventListener("click", () => onAccount?.());
  });
}
