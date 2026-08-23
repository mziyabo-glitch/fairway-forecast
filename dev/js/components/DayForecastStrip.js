import { esc } from "../../../shared/utils.js";

export function renderDayForecastStrip(days, selectedDateKey, dayScores = {}) {
  if (!days?.length) {
    return `<div class="fw-day-strip fw-skeleton-strip">${Array.from({ length: 5 }).map(() => `<div class="fw-day-chip fw-skeleton"></div>`).join("")}</div>`;
  }

  return `
    <section class="fw-day-strip-wrap" aria-label="Five-day golf forecast">
      <div class="fw-day-strip" role="tablist">
        ${days
          .map((d) => {
            const score = dayScores[d.dateKey]?.score ?? "—";
            const statusKey = dayScores[d.dateKey]?.status?.key ?? "risky";
            const isActive = d.dateKey === selectedDateKey;
            const disabled = !d.hasValidTimes;
            return `
              <button type="button" role="tab" aria-selected="${isActive}"
                class="fw-day-chip ${isActive ? "is-active" : ""} ${disabled ? "is-disabled" : ""}"
                data-date-key="${esc(d.dateKey)}" ${disabled ? "disabled" : ""}>
                <span class="fw-day-chip-label">${esc(d.dayLabel)}</span>
                <span class="fw-day-chip-date">${esc(d.dateLabel)}</span>
                <span class="fw-day-chip-score fw-status-${statusKey}">${esc(String(score))}</span>
              </button>`;
          })
          .join("")}
      </div>
    </section>`;
}

export function wireDayForecastStrip(container, onSelect) {
  container?.querySelectorAll(".fw-day-chip:not(.is-disabled)").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.getAttribute("data-date-key");
      if (key) onSelect(key);
    });
  });
}
