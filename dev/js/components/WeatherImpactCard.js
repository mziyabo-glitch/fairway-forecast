import { esc } from "../../../shared/utils.js";

const ICONS = { rain: "droplets", wind: "wind", temp: "thermometer-sun" };

function displayTitle(type, title) {
  if (type === "temp") return "Feels like";
  return title;
}

function windSubline(card, metrics) {
  if (card.type !== "wind" || !metrics) return card.line;
  const gust = metrics.maxGust;
  if (gust != null && !String(card.line).includes("gust")) {
    return `${card.line} · Gusts ${gust} mph`;
  }
  return card.line;
}

export function renderWeatherImpactCards(cards, metrics = null) {
  if (!cards?.length) {
    return `<section class="fw-impact-cards fw-skeleton-block" aria-busy="true">
      ${[1, 2, 3].map(() => `<div class="fw-impact-card fw-skeleton"></div>`).join("")}
    </section>`;
  }

  return `
    <section class="fw-impact-cards" aria-label="Weather impact">
      ${cards
        .map((c) => {
          const line = windSubline(c, metrics);
          return `
        <article class="fw-impact-card fw-impact-${c.type}">
          <span class="fw-impact-title">${esc(displayTitle(c.type, c.title))}</span>
          <strong class="fw-impact-value">${esc(c.value)}</strong>
          <p class="fw-impact-line">${esc(line)}</p>
        </article>`;
        })
        .join("")}
    </section>`;
}
