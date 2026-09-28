import { esc, fmtTimeCourse } from "../../../shared/utils.js";

function buildTeePills(teeTimes, selectedTeeTime) {
  if (!teeTimes?.length) {
    return `<p class="fw-muted fw-tee-empty">No tee times available for this day.</p>`;
  }

  const idx = teeTimes.findIndex((t) => t.value === selectedTeeTime);
  const center = idx >= 0 ? idx : 0;
  const start = Math.max(0, center - 1);
  const end = Math.min(teeTimes.length, start + 3);
  const window = teeTimes.slice(start, end);

  return `
    <div class="fw-tee-pills" role="group" aria-label="Tee time">
      ${window
        .map((t) => {
          const isSel = t.value === selectedTeeTime;
          return `
            <button type="button"
              class="fw-tee-pill ${isSel ? "is-active" : ""}"
              data-tee-time="${t.value}"
              aria-pressed="${isSel ? "true" : "false"}">
              ${esc(t.label)}
            </button>`;
        })
        .join("")}
    </div>
    <select id="fwTeeTimeSelect" class="fw-select fw-select--sr" aria-label="All tee times" ${!teeTimes?.length ? "disabled" : ""}>
      ${teeTimes.map((t) => `<option value="${t.value}" ${t.value === selectedTeeTime ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
    </select>`;
}

export function renderRoundSelector({ teeTimes, selectedTeeTime, holes, windowHours, tzOffset, teeTimeUnix }) {
  const pillsHtml = buildTeePills(teeTimes, selectedTeeTime);

  return `
    <section class="fw-round-selector" aria-label="Tee time and round length">
      <div class="fw-round-tee-block">
        ${pillsHtml}
      </div>
      <div class="fw-hole-toggle" role="group" aria-label="Round length">
        <button type="button" class="fw-hole-btn ${holes === 9 ? "is-active" : ""}" data-holes="9">9 holes</button>
        <button type="button" class="fw-hole-btn ${holes === 18 ? "is-active" : ""}" data-holes="18">18 holes</button>
      </div>
      ${
        teeTimeUnix && windowHours
          ? `<p class="fw-round-meta fw-muted" aria-hidden="true">
              ~${windowHours}h round from ${esc(fmtTimeCourse(teeTimeUnix, tzOffset))}
            </p>`
          : ""
      }
    </section>`;
}

export function wireRoundSelector(container, { onTeeTimeChange, onHolesChange }) {
  container?.querySelectorAll(".fw-tee-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = Number(btn.getAttribute("data-tee-time"));
      if (Number.isFinite(val)) onTeeTimeChange?.(val);
    });
  });

  container?.querySelector("#fwTeeTimeSelect")?.addEventListener("change", (e) => {
    const val = Number(e.target.value);
    if (Number.isFinite(val)) onTeeTimeChange?.(val);
  });

  container?.querySelectorAll(".fw-hole-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const h = Number(btn.getAttribute("data-holes"));
      if (h === 9 || h === 18) onHolesChange?.(h);
    });
  });
}
