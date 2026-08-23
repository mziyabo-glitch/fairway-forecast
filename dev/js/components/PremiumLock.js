import { esc } from "../../../shared/utils.js";

export const PREMIUM_FEATURES = [
  {
    id: "radar",
    title: "Rain radar",
    blurb: "See approaching showers on a live radar overlay so you can decide whether to wait out a band or bring the round forward.",
  },
  {
    id: "alerts",
    title: "Round weather alerts",
    blurb: "Get told when your saved round’s rain risk or wind jumps — for example “Rain risk increased 20% → 65%”.",
  },
  {
    id: "outlook",
    title: "7-day golf outlook",
    blurb: "A full week of golf-scored windows so you can pick the best society or weekend day, not just the next five.",
  },
];

export function renderPremiumLocks(features = PREMIUM_FEATURES) {
  return `
    <section class="fw-premium" aria-label="Premium features">
      <h2 class="fw-section-title">Coming with Fairway Premium</h2>
      <div class="fw-premium-list">
        ${features
          .map(
            (f) => `
          <button type="button" class="fw-premium-lock" data-premium="${esc(f.id)}">
            <span class="fw-premium-lock-title">${esc(f.title)} <span class="fw-lock" aria-hidden="true">🔒</span></span>
            <span class="fw-premium-lock-hint">Tap for details</span>
          </button>`
          )
          .join("")}
      </div>
    </section>`;
}

export function renderPremiumSheet(feature) {
  const f = PREMIUM_FEATURES.find((x) => x.id === feature) || PREMIUM_FEATURES[0];
  return `
    <div class="fw-premium-sheet">
      <p class="fw-sheet-intro">${esc(f.blurb)}</p>
      <p class="fw-sheet-footnote">Fairway Premium is coming soon. No account or payment is required in this preview.</p>
    </div>`;
}

export function wirePremiumLocks(container, onOpen) {
  container?.querySelectorAll("[data-premium]").forEach((btn) => {
    btn.addEventListener("click", () => onOpen?.(btn.getAttribute("data-premium")));
  });
}
