import { esc } from "../../../shared/utils.js";

function row(label, value) {
  return `<p class="fw-dim-row"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></p>`;
}

function courseStatusBlock(status) {
  if (!status) return "";
  const kind = status.kind === "official" ? "Official" : status.kind === "community" ? "Community" : "Unknown";
  const link = status.url
    ? `<a class="fw-dim-link" href="${esc(status.url)}" target="_blank" rel="noopener noreferrer">Official status page</a>`
    : "";
  return `
    <div class="fw-dim-status">
      ${row("Course status", kind)}
      <p class="fw-dim-note">${esc(status.officialSummary)}</p>
      <p class="fw-dim-note">${esc(status.communitySummary)}</p>
      ${link}
    </div>`;
}

export function renderForecastDimensions(model = {}) {
  const parts = [];
  if (model.personalFit && Number.isFinite(model.weatherScore)) {
    parts.push(row("Weather", model.weatherScore));
    parts.push(row("Personal fit", model.personalFit.score));
    if (model.personalFit.note) parts.push(`<p class="fw-dim-note">${esc(model.personalFit.note)}</p>`);
  }
  if (model.safety?.active) {
    parts.push(
      `<p class="fw-dim-safety" role="status">Safety risk. ${esc(model.safety.summary)} The weather score is unchanged.</p>`
    );
  }
  if (model.confidence?.summary) {
    parts.push(`<p class="fw-dim-note">${esc(model.confidence.summary)}</p>`);
  }
  if (model.ground?.summary) {
    parts.push(`<p class="fw-dim-note"><span class="fw-dim-kicker">Ground</span> ${esc(model.ground.summary)}</p>`);
  }
  if (model.courseStatus) parts.push(courseStatusBlock(model.courseStatus));
  if (!parts.length) return "";
  return `<section class="fw-dimensions" aria-label="Forecast detail">${parts.join("")}</section>`;
}
