import { esc } from "../../../shared/utils.js";

function courseOptions(courses, selectedId) {
  if (!courses.length) return `<option value="">Choose a course first</option>`;
  return courses
    .map(
      (course) =>
        `<option value="${esc(course.id)}" ${course.id === selectedId ? "selected" : ""}>${esc(course.name)}</option>`
    )
    .join("");
}

function slotCard(slot, { bestId, riskId } = {}) {
  const tags = [];
  if (bestId != null && slot.teeTime === bestId) tags.push("Best");
  if (riskId != null && slot.teeTime === riskId && slot.teeTime !== bestId) tags.push("Riskiest");
  const score = slot.scored && slot.score != null ? String(slot.score) : "—";
  return `
    <li class="fw-society-slot">
      <div class="fw-society-slot-top">
        <strong>Group ${esc(String(slot.group))} · ${esc(slot.timeLabel)}</strong>
        ${tags.length ? `<span class="fw-society-tag">${esc(tags.join(" · "))}</span>` : ""}
      </div>
      <p class="fw-society-slot-score">${esc(score)}${slot.verdict ? ` · ${esc(slot.verdict)}` : ""}</p>
      <p class="fw-muted">${esc(String(slot.players))} players${
        slot.rainProbability != null ? ` · Rain ${esc(String(slot.rainProbability))}%` : ""
      }${slot.wind != null ? ` · Wind ${esc(String(slot.wind))} mph` : ""}</p>
      ${slot.scored ? "" : `<p class="fw-muted">No hourly data for this slot.</p>`}
    </li>`;
}

export function renderSocietyView({
  courses = [],
  form = {},
  result = null,
  error = null,
  loading = false,
  lockedHtml = "",
} = {}) {
  if (lockedHtml) {
    return `
      <div class="fw-view fw-view-society">
        <h1 class="fw-page-title">Society</h1>
        ${lockedHtml}
      </div>`;
  }

  const bestId = result?.best?.teeTime;
  const riskId = result?.riskiest?.teeTime;
  return `
    <div class="fw-view fw-view-society">
      <h1 class="fw-page-title">Society</h1>
      <p class="fw-muted">Score each group with the same forecast used on the course page.</p>
      <form id="fwSocietyForm" class="fw-form">
        <label class="fw-field">
          <span>Course</span>
          <select name="courseId" class="fw-select">${courseOptions(courses, form.courseId)}</select>
        </label>
        <label class="fw-field">
          <span>Date</span>
          <input name="date" class="fw-search-input" type="date" value="${esc(form.date || "")}" required />
        </label>
        <label class="fw-field">
          <span>First tee</span>
          <input name="firstTee" class="fw-search-input" type="time" value="${esc(form.firstTee || "08:00")}" required />
        </label>
        <div class="fw-form-row">
          <label class="fw-field">
            <span>Interval (min)</span>
            <input name="interval" class="fw-search-input" type="number" min="5" max="60" value="${esc(String(form.interval ?? 10))}" />
          </label>
          <label class="fw-field">
            <span>Groups</span>
            <input name="groups" class="fw-search-input" type="number" min="1" max="24" value="${esc(String(form.groups ?? 8))}" />
          </label>
          <label class="fw-field">
            <span>Players</span>
            <input name="players" class="fw-search-input" type="number" min="1" max="8" value="${esc(String(form.players ?? 4))}" />
          </label>
        </div>
        <button type="submit" class="fw-btn fw-btn-primary">${loading ? "Scoring…" : "Score tee times"}</button>
      </form>
      ${error ? `<p class="fw-error" role="alert">${esc(error)}</p>` : ""}
      ${
        result
          ? `
        <section class="fw-society-results" aria-label="Society slots">
          ${
            result.best
              ? `<p class="fw-society-summary">Best ${esc(result.best.timeLabel)} · ${esc(String(result.best.score))}${
                  result.riskiest && result.riskiest.teeTime !== result.best.teeTime
                    ? ` · Riskiest ${esc(result.riskiest.timeLabel)} · ${esc(String(result.riskiest.score))}`
                    : ""
                }</p>`
              : `<p class="fw-muted">No slots could be scored from the hourly forecast.</p>`
          }
          <ul class="fw-society-list">
            ${result.slots.map((slot) => slotCard(slot, { bestId, riskId })).join("")}
          </ul>
        </section>`
          : ""
      }
    </div>`;
}

export function wireSocietyView(container, handlers = {}) {
  container?.querySelector("#fwSocietyForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    handlers.onScore?.({
      courseId: String(data.get("courseId") || ""),
      date: String(data.get("date") || ""),
      firstTee: String(data.get("firstTee") || ""),
      interval: Number(data.get("interval")),
      groups: Number(data.get("groups")),
      players: Number(data.get("players")),
    });
  });
}
