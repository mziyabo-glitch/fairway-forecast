import { esc, tempUnit } from "../../../shared/utils.js";
import {
  PRACTICE_HOLES,
  formatCourseTime,
} from "../daylight/eveningPractice.js";

function clock(unix, daylight, tzOffset) {
  return formatCourseTime(unix, { timeZone: daylight?.timezone, tzOffset });
}

export function renderEveningPractice({
  unavailable = false,
  daylight = null,
  plan = null,
  hours = [],
  tzOffset = 0,
  units = "metric",
} = {}) {
  if (unavailable || !daylight) {
    return `
      <section class="fw-evening" aria-label="Evening practice">
        <h2 class="fw-section-title fw-section-title--subtle">Evening practice</h2>
        <p class="fw-evening-note">Sunrise and sunset are not available for this course yet.</p>
      </section>`;
  }

  const sunrise = clock(daylight.sunrise, daylight, tzOffset);
  const sunset = clock(daylight.sunset, daylight, tzOffset);
  const lastLight = clock(daylight.lastPlayableLight, daylight, tzOffset);
  const holes = plan?.holes ?? 9;
  const holeButtons = PRACTICE_HOLES.map((count) => {
    const pressed = count === holes;
    return `<button type="button" data-practice-holes="${count}" aria-pressed="${pressed ? "true" : "false"}">${count} holes</button>`;
  }).join("");

  const recommend =
    plan?.recommendedStart != null && plan?.recommendedEnd != null
      ? `<p class="fw-evening-recommend">Start ${esc(clock(plan.recommendedStart, daylight, tzOffset))} · finish ${esc(clock(plan.recommendedEnd, daylight, tzOffset))}${
          Number.isFinite(plan.golfScore) ? ` · conditions ${esc(String(plan.golfScore))}` : ""
        }</p>`
      : "";

  const tu = tempUnit(units);
  const hourChips = (hours || [])
    .map((hour) => {
      const temp = Number.isFinite(hour.temp) ? `${Math.round(hour.temp)}${tu}` : "—";
      const pop = Math.round((hour.pop || 0) * 100);
      const wet = pop >= 20 || (hour.rain_mm || 0) >= 0.2;
      return `<li class="fw-evening-hour"><time>${esc(clock(hour.dt, daylight, tzOffset))}</time><span>${esc(temp)}</span><span>${wet ? `${pop}% rain` : "Dry"}</span></li>`;
    })
    .join("");

  const estimateNote =
    daylight.source === "estimate"
      ? " Sunrise and sunset for this day are estimated from the latest weather times."
      : "";

  return `
    <section class="fw-evening" aria-label="Evening practice" data-daylight-status="${esc(plan?.daylightStatus || "")}">
      <h2 class="fw-section-title fw-section-title--subtle">Evening practice</h2>
      <div class="fw-evening-times">
        <p><span class="fw-evening-kicker">Sunrise</span> ${esc(sunrise)}</p>
        <p><span class="fw-evening-kicker">Sunset</span> ${esc(sunset)}</p>
        <p><span class="fw-evening-kicker">Last light</span> about ${esc(lastLight)}</p>
      </div>
      <p class="fw-evening-note">Last playable light is an estimate, a few minutes before sunset. Sunset is shown separately and does not mean it is safe to keep playing.${esc(estimateNote)}</p>
      <div class="fw-evening-holes" role="group" aria-label="Practice length">${holeButtons}</div>
      <p class="fw-evening-summary" aria-live="polite">${esc(plan?.summary || "")}</p>
      ${recommend}
      ${
        hourChips
          ? `<ul class="fw-evening-hours" aria-label="Evening hours">${hourChips}</ul>`
          : ""
      }
    </section>`;
}

export function wireEveningPractice(container, onHoles) {
  if (!container) return;
  container.querySelectorAll("[data-practice-holes]").forEach((button) => {
    button.addEventListener("click", () => {
      const holes = Number(button.getAttribute("data-practice-holes"));
      if (PRACTICE_HOLES.includes(holes)) onHoles?.(holes);
    });
  });
}
