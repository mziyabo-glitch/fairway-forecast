import { esc } from "../../../shared/utils.js";

export function renderDayForecastStrip(days, selectedDateKey, dayScores = {}) {
  if (!days?.length) {
    return `<div class="fw-day-strip fw-skeleton-strip" aria-busy="true">${Array.from({ length: 5 }).map(() => `<div class="fw-day-chip fw-skeleton"></div>`).join("")}</div>`;
  }

  return `
    <section class="fw-day-strip-wrap" aria-label="Five-day golf forecast">
      <div class="fw-day-strip" role="tablist" aria-label="Select forecast day">
        ${days
          .map((d) => {
            const ds = dayScores[d.dateKey] || {};
            const score = ds.score ?? "—";
            const statusKey = ds.status?.key ?? "risky";
            const isActive = d.dateKey === selectedDateKey;
            const disabled = !d.hasValidTimes;
            const icon = ds.weatherIcon || "☁️";
            const bestHint = ds.bestTeeTime ? `<span class="fw-day-best">Best ${esc(ds.bestTeeTime)}</span>` : "";
            return `
              <button type="button" role="tab" aria-selected="${isActive}"
                class="fw-day-chip ${isActive ? "is-active" : ""} ${disabled ? "is-disabled" : ""}"
                data-date-key="${esc(d.dateKey)}" ${disabled ? "disabled" : ""}
                aria-label="${esc(d.dayLabel)} score ${score}">
                <span class="fw-day-chip-icon" aria-hidden="true">${icon}</span>
                <span class="fw-day-chip-label">${esc(d.dayLabel)}</span>
                <span class="fw-day-chip-date">${esc(d.dateLabel)}</span>
                <span class="fw-day-chip-score fw-status-${statusKey}">${esc(String(score))}</span>
                ${bestHint}
              </button>`;
          })
          .join("")}
      </div>
    </section>`;
}

export function wireDayForecastStrip(container, onSelect) {
  const strip = container?.querySelector(".fw-day-strip");
  if (!strip) return;

  let startX = 0;
  strip.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0].clientX;
    },
    { passive: true }
  );

  container.querySelectorAll(".fw-day-chip:not(.is-disabled)").forEach((chip) => {
    chip.addEventListener("click", () => {
      const key = chip.getAttribute("data-date-key");
      if (key) onSelect(key);
    });
  });
}
