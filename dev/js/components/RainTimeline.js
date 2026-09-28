import { esc } from "../../../shared/utils.js";

function intensityWord(key) {
  const map = {
    dry: "Dry",
    drizzle: "Drizzle",
    light: "Light",
    moderate: "Moderate",
    heavy: "Heavy",
  };
  return map[key] || "Dry";
}

export function renderRainTimeline(rainAnalysis) {
  if (!rainAnalysis?.hours?.length) {
    return `
      <section class="fw-rain-timeline" aria-label="Rain during your round">
        <h2 class="fw-section-title fw-section-title--subtle">Rain during your round</h2>
        <p class="fw-muted">Select a tee time to see hourly rain during your round.</p>
      </section>`;
  }

  const summaryLine =
    rainAnalysis.description ||
    (rainAnalysis.wettestPeriod && rainAnalysis.wettestPeriod !== "None"
      ? `Rain mainly ${rainAnalysis.wettestPeriod.toLowerCase()}`
      : "Dry for most of your round.");

  return `
    <section class="fw-rain-timeline" aria-label="Rain during your round">
      <h2 class="fw-section-title fw-section-title--subtle">Rain during your round</h2>
      <div class="fw-rain-row" role="img" aria-label="Hourly rain during round">
        ${rainAnalysis.hours
          .map((h) => {
            const pop = h.probability ?? 0;
            const label = h.intensity?.label || intensityWord(h.intensity?.key);
            return `
              <div class="fw-rain-cell">
                <span class="fw-rain-cell-time">${esc(h.time)}</span>
                <span class="fw-rain-cell-icon" aria-hidden="true">${h.weatherIcon || "☁️"}</span>
                <span class="fw-rain-cell-pop">${pop > 0 ? `${pop}%` : "—"}</span>
                <span class="fw-rain-cell-intensity fw-rain-tone-${h.intensity?.key || "dry"}">${esc(label)}</span>
              </div>`;
          })
          .join("")}
      </div>
      <div class="fw-rain-foot">
        <strong>${esc(String(rainAnalysis.totalMm))} mm expected</strong>
        <span class="fw-rain-foot-sub">${esc(summaryLine)}</span>
      </div>
    </section>`;
}

export function renderRainTimelineSkeleton() {
  return `
    <section class="fw-rain-timeline fw-skeleton-block" aria-busy="true">
      <div class="fw-skeleton fw-skeleton-title"></div>
      <div class="fw-skeleton fw-skeleton-rain-row"></div>
    </section>`;
}
