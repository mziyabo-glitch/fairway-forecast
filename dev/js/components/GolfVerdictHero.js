import { esc } from "../../../shared/utils.js";
import { renderLoadingMark } from "./BrandMark.js";

export function renderGolfVerdictHero({
  score,
  status,
  label,
  message,
  verdict,
  decision,
  weatherIcon = "🌤️",
  scoreCaption = "",
  safetyActive = false,
}) {
  const statusKey = safetyActive ? "avoid" : status?.key ?? verdict?.status?.key ?? "risky";
  const displayScore = Number.isFinite(score) ? score : verdict?.score ?? "—";
  const displayLabel = safetyActive ? "Safety risk" : label || verdict?.label || status?.label || "—";
  const displayMessage =
    message || verdict?.message || decision?.message || "Select a tee time to see your verdict.";

  return `
    <section class="fw-verdict-hero fw-fade-in${safetyActive ? " fw-verdict-hero--safety" : ""}" aria-label="${safetyActive ? "Play verdict, safety risk" : "Play verdict"}" id="fwVerdictHero">
      <button type="button" class="fw-verdict-hero-hit" id="fwWhyScore" aria-label="Why this score? Open score explanation">
        <span class="fw-verdict-icon" aria-hidden="true">${weatherIcon}</span>
        <span class="fw-verdict-label fw-status-text-${statusKey}">${esc(displayLabel)}</span>
        <div class="fw-verdict-score-row">
          <span class="fw-verdict-score" data-score="${esc(String(displayScore))}">${esc(String(displayScore))}</span>
          <span class="fw-verdict-score-denom">/ 100</span>
        </div>
        ${scoreCaption ? `<p class="fw-verdict-score-caption">${esc(scoreCaption)}</p>` : ""}
        <p class="fw-verdict-message">${esc(displayMessage)}</p>
        <span class="fw-verdict-why-link">Why this score?</span>
      </button>
    </section>`;
}

export function wireGolfVerdictHero(container, onWhy) {
  container?.querySelector("#fwWhyScore")?.addEventListener("click", onWhy);
}

export function renderVerdictHeroSkeleton() {
  return `
    <section class="fw-verdict-hero fw-verdict-hero--skeleton" aria-busy="true">
      ${renderLoadingMark(32)}
      <div class="fw-skeleton fw-skeleton-line"></div>
      <div class="fw-skeleton fw-skeleton-score"></div>
      <div class="fw-skeleton fw-skeleton-line short"></div>
    </section>`;
}
