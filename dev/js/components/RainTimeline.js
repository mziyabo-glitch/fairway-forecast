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

function rainLevel(key, pop) {
  const map = { dry: 0.08, drizzle: 0.25, light: 0.45, moderate: 0.7, heavy: 1 };
  if (map[key] != null) return map[key];
  return Math.min(1, (pop || 0) / 100);
}

export function renderRainTimeline(rainAnalysis) {
  if (!rainAnalysis?.hours?.length) {
    return `
      <section class="fw-rain-timeline" aria-label="Rain during your round">
        <h2 class="fw-section-title fw-section-title--category">Rain during your round</h2>
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
      <h2 class="fw-section-title fw-section-title--category">Rain during your round</h2>
      <div class="fw-rain-row" role="img" aria-label="Hourly rain during round">
        ${rainAnalysis.hours
          .map((h) => {
            const pop = h.probability ?? 0;
            const key = h.intensity?.key || "dry";
            const label = h.intensity?.label || intensityWord(key);
            const level = rainLevel(key, pop);
            return `
              <div class="fw-rain-cell">
                <span class="fw-rain-cell-time">${esc(h.time)}</span>
                <span class="fw-rain-cell-icon" aria-hidden="true">${h.weatherIcon || "☁️"}</span>
                <span class="fw-rain-cell-pop">${pop > 0 ? `${pop}%` : "—"}</span>
                <span class="fw-rain-cell-bar" aria-hidden="true"><i class="fw-rain-fill fw-rain-tone-${key}" style="--rain-fill:${level}"></i></span>
                <span class="fw-rain-cell-intensity fw-rain-tone-${key}">${esc(label)}</span>
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
