import { esc } from "../../../shared/utils.js";

const CONFIDENCE_LABEL = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export function renderExtendedOutlook(outlook) {
  if (!outlook) return "";
  const days = outlook.days || [];
  return `
    <section class="fw-outlook" aria-label="Extended outlook">
      <h2 class="fw-section-title">Extended outlook</h2>
      <p class="fw-muted">Days after the five-day strip. Scores use the same forecast, and only when hourly data exists.</p>
      ${
        outlook.note
          ? `<p class="fw-outlook-note">${esc(outlook.note)}</p>`
          : `<ul class="fw-outlook-list">
        ${days
          .map((day) => {
            const score = day.scored && day.score != null ? String(day.score) : "—";
            return `
            <li class="fw-outlook-day">
              <div>
                <strong>${esc(day.dayLabel || day.dateKey)}</strong>
                <span class="fw-muted">${esc(day.dateLabel || "")}</span>
              </div>
              <div class="fw-outlook-score">
                <span>${esc(score)}</span>
                ${day.verdict ? `<span class="fw-muted">${esc(day.verdict)}</span>` : ""}
              </div>
              <p class="fw-outlook-confidence">${esc(CONFIDENCE_LABEL[day.confidence] || "Low confidence")}</p>
              ${day.note ? `<p class="fw-muted">${esc(day.note)}</p>` : ""}
            </li>`;
          })
          .join("")}
      </ul>`
      }
    </section>`;
}
