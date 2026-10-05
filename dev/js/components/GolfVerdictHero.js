import { esc } from "../../../shared/utils.js";
import { renderLoadingMark } from "./BrandMark.js";

const WEATHER_CUES = {
  "☀️": { icon: "sun", text: "Selected window: clear" },
  "🌤️": { icon: "cloud-sun", text: "Selected window: partly cloudy" },
  "☁️": { icon: "cloud", text: "Selected window: cloudy" },
  "⛈️": { icon: "cloud-lightning", text: "Main consideration: thunderstorms" },
  "🌧️": { icon: "cloud-rain", text: "Main consideration: rain" },
  "🌨️": { icon: "snowflake", text: "Main consideration: wintry weather" },
  "🌫️": { icon: "cloud-fog", text: "Main consideration: visibility" },
};

export function getVerdictCue({ verdict, weatherIcon, safetyActive = false }) {
  if (safetyActive || verdict?.hardStop) {
    return { icon: "triangle-alert", text: "Safety conditions need attention" };
  }

  const primaryFactor = (verdict?.factors || [])
    .filter((factor) => Number.isFinite(factor?.impact) && factor.impact < 0)
    .sort((a, b) => a.impact - b.impact)[0];

  if (primaryFactor?.key === "wind") return { icon: "wind", text: "Main consideration: wind" };
  if (primaryFactor?.key === "rain") return { icon: "cloud-rain", text: "Main consideration: rain" };
  if (primaryFactor?.key === "temp") {
    const cold = Number.isFinite(verdict?.metrics?.avgTemp) && verdict.metrics.avgTemp <= 8;
    return {
      icon: cold ? "thermometer-snowflake" : "thermometer-sun",
      text: cold ? "Main consideration: low temperature" : "Main consideration: heat",
    };
  }

  return WEATHER_CUES[weatherIcon] || { icon: "cloud-sun", text: "Selected window: settled" };
}

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
  roundSummary = "",
}) {
  const statusKey = safetyActive ? "avoid" : status?.key ?? verdict?.status?.key ?? "risky";
  const displayScore = Number.isFinite(score) ? score : verdict?.score ?? "—";
  const displayLabel = safetyActive ? "Safety risk" : label || verdict?.label || status?.label || "—";
  const displayMessage =
    message || verdict?.message || decision?.message || "Select a tee time to see your verdict.";
  const cue = getVerdictCue({ verdict, weatherIcon, safetyActive });

  return `
    <section class="fw-verdict-hero fw-fade-in${safetyActive ? " fw-verdict-hero--safety" : ""}" aria-label="${safetyActive ? "Play verdict, safety risk" : "Play verdict"}" id="fwVerdictHero">
      <p class="fw-round-verdict-title">Your round verdict</p>
      ${roundSummary ? `<p class="fw-round-summary">${esc(roundSummary)}</p>` : ""}
      <button type="button" class="fw-verdict-hero-hit" id="fwWhyScore" aria-label="Why this score? Open score explanation">
        <span class="fw-verdict-cue">
          <i data-lucide="${cue.icon}" aria-hidden="true"></i>
          <span>${esc(cue.text)}</span>
        </span>
        <span class="fw-verdict-label fw-status-text-${statusKey}">${esc(displayLabel)}</span>
        <div class="fw-verdict-score-row">
          <span class="fw-verdict-score" data-score="${esc(String(displayScore))}">${esc(String(displayScore))}</span>
          <span class="fw-verdict-score-denom">/ 100</span>
        </div>
        ${scoreCaption ? `<p class="fw-verdict-score-caption">${esc(scoreCaption)}</p>` : ""}
        <p class="fw-verdict-message">${esc(displayMessage)}</p>
        <span class="fw-verdict-why-link">Why this score?</span>
      </button>
      <p class="fw-score-guide-inline">Higher is better · 65+ playable · 50–64 risky · below 50 poor or avoid</p>
    </section>`;
}

export function wireGolfVerdictHero(container, onWhy) {
  container?.querySelector("#fwWhyScore")?.addEventListener("click", onWhy);
}

export function renderVerdictHeroSkeleton() {
  return `
    <section class="fw-verdict-hero fw-verdict-hero--skeleton" aria-busy="true" aria-label="Loading round forecast">
      <p class="fw-muted" role="status">Loading weather for your round…</p>
      ${renderLoadingMark(32)}
      <div class="fw-skeleton fw-skeleton-line"></div>
      <div class="fw-skeleton fw-skeleton-score"></div>
      <div class="fw-skeleton fw-skeleton-line short"></div>
    </section>`;
}
