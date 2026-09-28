import { esc } from "../../../shared/utils.js";

function buildTeeCarousel(teeTimes, selectedTeeTime) {
  if (!teeTimes?.length) {
    return `<p class="fw-muted fw-tee-empty">No tee times available for this day.</p>`;
  }

  const idx = teeTimes.findIndex((t) => t.value === selectedTeeTime);
  const center = idx >= 0 ? idx : 0;
  const start = Math.max(0, center - 1);
  const end = Math.min(teeTimes.length, start + 3);
  const window = teeTimes.slice(start, end);
  const canPrev = center > 0;
  const canNext = center < teeTimes.length - 1;

  return `
    <div class="fw-tee-carousel">
      <button type="button" class="fw-tee-nav" data-tee-nav="prev" aria-label="Earlier tee time" ${canPrev ? "" : "disabled"}>‹</button>
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
      <button type="button" class="fw-tee-nav" data-tee-nav="next" aria-label="Later tee time" ${canNext ? "" : "disabled"}>›</button>
    </div>
    <select id="fwTeeTimeSelect" class="fw-select fw-select--sr" aria-label="All tee times">
      ${teeTimes.map((t) => `<option value="${t.value}" ${t.value === selectedTeeTime ? "selected" : ""}>${esc(t.label)}</option>`).join("")}
    </select>`;
}

export function renderRoundSelector({ teeTimes, selectedTeeTime, holes }) {
  return `
    <section class="fw-round-selector" aria-label="Tee time and round length">
      <div class="fw-round-tee-block">${buildTeeCarousel(teeTimes, selectedTeeTime)}</div>
      <div class="fw-hole-toggle" role="group" aria-label="Round length">
        <button type="button" class="fw-hole-btn ${holes === 9 ? "is-active" : ""}" data-holes="9">9 holes</button>
        <button type="button" class="fw-hole-btn ${holes === 18 ? "is-active" : ""}" data-holes="18">18 holes</button>
      </div>
    </section>`;
}

export function wireRoundSelector(container, { onTeeTimeChange, onHolesChange }) {
  const teeTimes = [...(container?.querySelectorAll(".fw-tee-pill") || [])].map((btn) =>
    Number(btn.getAttribute("data-tee-time"))
  );

  const allOptions = [...(container?.querySelector("#fwTeeTimeSelect")?.options || [])].map((o) =>
    Number(o.value)
  );
  const list = allOptions.length ? allOptions : teeTimes;

  const current = () => {
    const active = container?.querySelector(".fw-tee-pill.is-active");
    return active ? Number(active.getAttribute("data-tee-time")) : list[0];
  };

  container?.querySelector('[data-tee-nav="prev"]')?.addEventListener("click", () => {
    const sel = current();
    const idx = list.indexOf(sel);
    if (idx > 0) onTeeTimeChange?.(list[idx - 1]);
  });

  container?.querySelector('[data-tee-nav="next"]')?.addEventListener("click", () => {
    const sel = current();
    const idx = list.indexOf(sel);
    if (idx >= 0 && idx < list.length - 1) onTeeTimeChange?.(list[idx + 1]);
  });

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
