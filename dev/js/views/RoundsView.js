import { esc, fmtTimeCourse } from "../../../shared/utils.js";

function roundCard(round, { past = false } = {}) {
  const course = round.course || {};
  const snap = round.lastKnownForecast || {};
  const time = Number.isFinite(round.teeTime) ? fmtTimeCourse(round.teeTime, 0) : "—";
  const holes = round.holes === 9 ? "9 holes" : "18 holes";
  return `
    <li class="fw-round-card">
      <div class="fw-round-card-body">
        <strong>${esc(course.name || "Course")}</strong>
        <p class="fw-round-card-meta">${esc(round.date || "")} · ${esc(time)} · ${esc(holes)}</p>
        ${
          snap.verdict
            ? `<p class="fw-round-card-verdict">${esc(snap.verdict)}${snap.score != null ? ` · ${esc(String(snap.score))}` : ""}</p>`
            : ""
        }
        ${snap.message ? `<p class="fw-round-card-msg">${esc(snap.message)}</p>` : ""}
        <p class="fw-muted fw-round-refresh-note">Weather refreshes when you open the forecast.</p>
      </div>
      <div class="fw-round-card-actions">
        <button type="button" class="fw-btn fw-btn-primary" data-open-round="${esc(round.id)}">View forecast</button>
        ${
          past
            ? `<button type="button" class="fw-btn fw-btn-ghost" data-play-again="${esc(round.id)}">Play again</button>`
            : ""
        }
        <button type="button" class="fw-btn fw-btn-ghost fw-btn-danger" data-delete-round="${esc(round.id)}">Delete</button>
      </div>
    </li>`;
}

export function renderRoundsView({ upcoming = [], past = [] } = {}) {
  const empty = !upcoming.length && !past.length;
  return `
    <div class="fw-view fw-view-rounds">
      <h1 class="fw-page-title">Rounds</h1>
      ${
        empty
          ? `
        <div class="fw-stub-card">
          <i data-lucide="flag"></i>
          <h2>No saved rounds yet</h2>
          <p>Save a tee time from Forecast to keep a plan. Weather is always recalculated when you open it.</p>
        </div>`
          : ""
      }
      ${
        upcoming.length
          ? `
        <section class="fw-rounds-upcoming" aria-label="Upcoming rounds">
          <h2 class="fw-section-title">Upcoming</h2>
          <ul class="fw-round-list">${upcoming.map((r) => roundCard(r)).join("")}</ul>
        </section>`
          : ""
      }
      ${
        past.length
          ? `
        <section class="fw-rounds-past" aria-label="Past rounds">
          <h2 class="fw-section-title">Past</h2>
          <ul class="fw-round-list">${past.map((r) => roundCard(r, { past: true })).join("")}</ul>
        </section>`
          : ""
      }
    </div>`;
}

export function wireRoundsView(container, handlers) {
  container?.querySelectorAll("[data-open-round]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onOpen?.(btn.getAttribute("data-open-round")));
  });
  container?.querySelectorAll("[data-delete-round]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onDelete?.(btn.getAttribute("data-delete-round")));
  });
  container?.querySelectorAll("[data-play-again]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onPlayAgain?.(btn.getAttribute("data-play-again")));
  });
}
