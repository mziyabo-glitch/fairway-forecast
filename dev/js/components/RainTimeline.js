import { esc } from "../../../shared/utils.js";

export function renderRainTimeline(rainAnalysis) {
  if (!rainAnalysis?.hours?.length) {
    return `
      <section class="fw-rain-timeline" aria-label="Rain during your round">
        <h2 class="fw-section-title">Rain During Your Round</h2>
        <p class="fw-muted">Select a tee time to see hourly rain during your round.</p>
      </section>`;
  }

  const maxMm = Math.max(...rainAnalysis.hours.map((h) => h.mm), 0.1);

  return `
    <section class="fw-rain-timeline" aria-label="Rain during your round">
      <h2 class="fw-section-title">Rain During Your Round</h2>
      <div class="fw-rain-summary">
        <div class="fw-rain-stat">
          <span class="fw-rain-stat-label">Expected rainfall</span>
          <strong>${esc(String(rainAnalysis.totalMm))} mm</strong>
        </div>
        <div class="fw-rain-stat">
          <span class="fw-rain-stat-label">Wettest period</span>
          <strong>${esc(rainAnalysis.wettestPeriod || "None")}</strong>
        </div>
      </div>
      <p class="fw-rain-desc">${esc(rainAnalysis.description)}</p>
      <div class="fw-rain-bars" role="img" aria-label="Hourly rain intensity during round">
        ${rainAnalysis.hours
          .map((h) => {
            const pct = Math.max(8, (h.mm / maxMm) * 100);
            return `
              <div class="fw-rain-bar-col" title="${esc(h.time)}: ${esc(h.intensity.label)}">
                <div class="fw-rain-bar fw-rain-${h.intensity.key}" style="height:${pct}%"></div>
                <span class="fw-rain-bar-time">${esc(h.time)}</span>
              </div>`;
          })
          .join("")}
      </div>
      <div class="fw-rain-legend">
        <span><i class="fw-legend-dot fw-rain-dry"></i>Dry</span>
        <span><i class="fw-legend-dot fw-rain-drizzle"></i>Drizzle</span>
        <span><i class="fw-legend-dot fw-rain-light"></i>Light</span>
        <span><i class="fw-legend-dot fw-rain-moderate"></i>Moderate</span>
        <span><i class="fw-legend-dot fw-rain-heavy"></i>Heavy</span>
      </div>
    </section>`;
}

export function renderRainTimelineSkeleton() {
  return `
    <section class="fw-rain-timeline fw-skeleton-block" aria-busy="true">
      <div class="fw-skeleton fw-skeleton-title"></div>
      <div class="fw-skeleton fw-skeleton-bars"></div>
    </section>`;
}
