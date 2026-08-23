import { esc, fmtTimeCourse } from "../../../shared/utils.js";

export function renderRoundSelector({ teeTimes, selectedTeeTime, holes, windowHours, tzOffset, teeTimeUnix }) {
  const options = (teeTimes || [])
    .map(
      (t) =>
        `<option value="${t.value}" ${t.value === selectedTeeTime ? "selected" : ""}>${esc(t.label)}</option>`
    )
    .join("");

  let windowLabel = "Select tee time";
  if (teeTimeUnix && windowHours) {
    const end = teeTimeUnix + windowHours * 3600;
    windowLabel = `${fmtTimeCourse(teeTimeUnix, tzOffset)} → ${fmtTimeCourse(end, tzOffset)}`;
  }

  return `
    <section class="fw-round-selector" aria-label="Round planner">
      <div class="fw-round-selector-header">
        <h2 class="fw-section-title">Round Planner</h2>
        <div class="fw-hole-toggle" role="group" aria-label="Round length">
          <button type="button" class="fw-hole-btn ${holes === 18 ? "is-active" : ""}" data-holes="18">18 holes</button>
          <button type="button" class="fw-hole-btn ${holes === 9 ? "is-active" : ""}" data-holes="9">9 holes</button>
        </div>
      </div>
      <div class="fw-round-row">
        <label class="fw-field-label" for="fwTeeTimeSelect">Tee time</label>
        <select id="fwTeeTimeSelect" class="fw-select" ${!teeTimes?.length ? "disabled" : ""}>
          ${teeTimes?.length ? options : `<option value="">No times available</option>`}
        </select>
      </div>
      <div class="fw-round-window">
        <span class="fw-round-window-label">Round window</span>
        <strong class="fw-round-window-value">${esc(windowLabel)}</strong>
        <span class="fw-round-window-sub">~${windowHours}h · ${holes} holes</span>
      </div>
    </section>`;
}

export function wireRoundSelector(container, { onTeeTimeChange, onHolesChange }) {
  container?.querySelector("#fwTeeTimeSelect")?.addEventListener("change", (e) => {
    const val = Number(e.target.value);
    if (Number.isFinite(val)) onTeeTimeChange?.(val);
  });

  container?.querySelectorAll(".fw-hole-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const holes = Number(btn.getAttribute("data-holes"));
      if (holes === 9 || holes === 18) onHolesChange?.(holes);
    });
  });
}
