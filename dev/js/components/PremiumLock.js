/** Only Caddies is premium. Checkout is not connected yet. */
export const PREMIUM_FEATURES = ["caddies"];

export function renderPremiumLocks() {
  return "";
}

export function renderPremiumSheet() {
  return `<p class="fw-sheet-intro">Caddies is our premium feature, coming soon.</p>
    <p>Shot Caddie helps you choose a club using your target distance, club carries, and forecast wind and rain. Wind Caddie helps you understand wind relative to your target.</p>
    <p>Premium subscriptions are not available to purchase yet.</p>
    <p class="fw-muted">Course forecasts, round verdicts, tee-time recommendations, saved rounds, alerts and society planning remain free.</p>`;
}

export function renderCaddiesGate({ forecastPath = "" } = {}) {
  return `<section class="fw-caddies-gate" aria-labelledby="fwCaddiesTitle">
    <span class="fw-premium-badge">Premium · Coming soon</span>
    <h1 class="fw-page-title" id="fwCaddiesTitle">Caddies</h1>
    <p>Choose your club and understand the wind on your shot with Shot Caddie and Wind Caddie.</p>
    <ul><li>Club recommendations from your target distance and saved carries</li>
      <li>Forecast wind relative to your target direction</li></ul>
    <p>Premium subscriptions are not available to purchase yet.</p>
    <p class="fw-muted">All weather forecasts and round-planning tools are free.</p>
    ${forecastPath
      ? `<a class="fw-btn fw-btn-primary" href="${forecastPath}">Back to free forecast</a>`
      : `<button type="button" class="fw-btn fw-btn-primary" data-caddies-forecast>Back to free forecast</button>`}
  </section>`;
}

export function wirePremiumLocks(container, onPremium) {
  container?.querySelectorAll("[data-premium]").forEach(button => {
    button.addEventListener("click", () => onPremium?.("caddies"));
  });
}
