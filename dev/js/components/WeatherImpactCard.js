import { esc } from "../../../shared/utils.js";

function displayTitle(type, title) {
  if (type === "temp") return "Feels like";
  return title;
}

function windSubline(card, metrics) {
  if (card.type !== "wind" || !metrics) return card.line;
  const gust = metrics.maxGust;
  if (gust != null && !String(card.line).toLowerCase().includes("gust")) {
    return `${card.line} · Gust ${gust} mph`;
  }
  return card.line;
}

export function renderWeatherImpactCards(cards, metrics = null) {
  if (!cards?.length) {
    return `<section class="fw-impact-panel fw-skeleton-block" aria-busy="true">
      <div class="fw-skeleton fw-skeleton-bars"></div>
    </section>`;
  }

  return `
    <section class="fw-impact-panel" aria-label="Weather impact">
      <div class="fw-impact-grid">
        ${cards
          .map((c) => {
            const line = windSubline(c, metrics);
            return `
          <div class="fw-impact-col fw-impact-${c.type}">
            <span class="fw-impact-title">${esc(displayTitle(c.type, c.title))}</span>
            <strong class="fw-impact-value">${esc(c.value)}</strong>
            <p class="fw-impact-line">${esc(line)}</p>
          </div>`;
          })
          .join("")}
      </div>
    </section>`;
}
