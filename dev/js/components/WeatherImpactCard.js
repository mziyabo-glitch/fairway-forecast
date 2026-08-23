import { esc } from "../../../shared/utils.js";

const ICONS = { rain: "droplets", wind: "wind", temp: "thermometer" };

export function renderWeatherImpactCards(cards) {
  if (!cards?.length) {
    return `<section class="fw-impact-cards fw-skeleton-block" aria-busy="true">
      ${[1, 2, 3].map(() => `<div class="fw-impact-card fw-skeleton"></div>`).join("")}
    </section>`;
  }

  return `
    <section class="fw-impact-cards" aria-label="Weather impact">
      ${cards
        .map(
          (c) => `
        <article class="fw-impact-card fw-impact-${c.type}">
          <div class="fw-impact-icon-wrap">
            <i data-lucide="${ICONS[c.type] || "cloud"}" aria-hidden="true"></i>
          </div>
          <div class="fw-impact-body">
            <span class="fw-impact-title">${esc(c.title)}</span>
            <strong class="fw-impact-value">${esc(c.value)}</strong>
            <p class="fw-impact-line">${esc(c.line)}</p>
          </div>
        </article>`
        )
        .join("")}
    </section>`;
}
