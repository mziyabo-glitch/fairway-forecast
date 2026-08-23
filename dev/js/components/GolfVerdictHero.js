import { esc } from "../../../shared/utils.js";

export function renderGolfVerdictHero({ score, status, label, message, verdict, decision }) {
  const statusKey = status?.key ?? verdict?.status?.key ?? "risky";
  const displayScore = Number.isFinite(score) ? score : verdict?.score ?? "—";
  const displayLabel = label || verdict?.label || status?.label || "—";
  const displayMessage = message || verdict?.message || decision?.message || "Select a tee time to see your verdict.";

  return `
    <section class="fw-verdict-hero fw-status-border-${statusKey} fw-fade-in" aria-label="Play verdict" id="fwVerdictHero">
      <div class="fw-verdict-hero-top">
        <div class="fw-verdict-score fw-status-text-${statusKey}">${esc(String(displayScore))}</div>
        <button type="button" class="fw-why-btn" id="fwWhyScore" aria-label="Why this score?">
          Why ${esc(String(displayScore))}?
        </button>
      </div>
      <div class="fw-verdict-label fw-status-text-${statusKey}">${esc(displayLabel)}</div>
      <p class="fw-verdict-message">${esc(displayMessage)}</p>
    </section>`;
}

export function wireGolfVerdictHero(container, onWhy) {
  container?.querySelector("#fwWhyScore")?.addEventListener("click", onWhy);
}

export function renderVerdictHeroSkeleton() {
  return `
    <section class="fw-verdict-hero fw-skeleton-hero" aria-busy="true">
      <div class="fw-skeleton fw-skeleton-score"></div>
      <div class="fw-skeleton fw-skeleton-line"></div>
      <div class="fw-skeleton fw-skeleton-line short"></div>
    </section>`;
}
