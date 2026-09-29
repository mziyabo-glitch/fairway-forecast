import { esc, fmtTimeCourse, scoreToVerdict } from "../../../shared/utils.js";
import { renderAlertList } from "./AlertsView.js";

function formatChecked(ms) {
  if (!Number.isFinite(Number(ms))) return "";
  const d = new Date(Number(ms));
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function liveOrMeta(round, summaries) {
  const live = summaries instanceof Map ? summaries.get(round.id) : summaries?.[round.id];
  const snap = round.lastKnownForecast || {};
  const score = live?.score ?? snap.score;
  const verdict = live?.verdict || (Number.isFinite(score) ? scoreToVerdict(score) : "");
  const rain = live?.rainProbability ?? snap.rainProbability;
  const message = live?.message || "";
  const freshness = live?.freshness || null;
  return { score, verdict, rain, message, freshness, live: Boolean(live) };
}

function historyLine(pair) {
  if (!pair?.original && !pair?.latest) return "";
  const original = pair.original?.score;
  const latest = pair.latest?.score;
  const checked = formatChecked(pair.latest?.checkedAt);
  const scores =
    original != null || latest != null
      ? `Saved ${original == null ? "—" : original} · Latest ${latest == null ? "—" : latest}`
      : "";
  const when = checked ? `Last forecast check ${checked}` : "";
  if (!scores && !when) return "";
  return `<p class="fw-round-compare">${esc([scores, when].filter(Boolean).join(" · "))}</p>`;
}

function editForm(round) {
  const time = Number.isFinite(round.teeTime) ? fmtTimeCourse(round.teeTime, 0) : "08:00";
  return `
    <form class="fw-form fw-round-edit" data-edit-form="${esc(round.id)}">
      <label class="fw-field">
        <span>Date</span>
        <input class="fw-search-input" type="date" name="date" value="${esc(round.date || "")}" />
      </label>
      <label class="fw-field">
        <span>Tee time</span>
        <input class="fw-search-input" type="time" name="tee" value="${esc(time)}" />
      </label>
      <label class="fw-field">
        <span>Holes</span>
        <select class="fw-select" name="holes">
          <option value="18" ${round.holes === 9 ? "" : "selected"}>18 holes</option>
          <option value="9" ${round.holes === 9 ? "selected" : ""}>9 holes</option>
        </select>
      </label>
      <div class="fw-round-card-actions">
        <button type="submit" class="fw-btn fw-btn-primary">Save changes</button>
        <button type="button" class="fw-btn fw-btn-ghost" data-cancel-edit="${esc(round.id)}">Cancel</button>
      </div>
    </form>`;
}

function roundCard(round, { past = false, summaries, history, editing = false, showExtended = false } = {}) {
  const course = round.course || {};
  const info = liveOrMeta(round, summaries);
  const time = Number.isFinite(round.teeTime) ? fmtTimeCourse(round.teeTime, 0) : "—";
  const holes = round.holes === 9 ? "9 holes" : "18 holes";
  return `
    <li class="fw-round-card">
      <div class="fw-round-card-body">
        <strong>${esc(course.name || "Course")}</strong>
        <p class="fw-round-card-meta">${esc(round.date || "")} · ${esc(time)} · ${esc(holes)}</p>
        ${
          info.verdict || info.score != null
            ? `<p class="fw-round-card-verdict">${esc(info.verdict || "")}${info.score != null ? ` · ${esc(String(info.score))}` : ""}</p>`
            : ""
        }
        ${info.rain != null ? `<p class="fw-round-card-msg">Rain ${esc(String(info.rain))}%</p>` : ""}
        ${info.message ? `<p class="fw-round-card-msg">${esc(info.message)}</p>` : ""}
        ${info.freshness ? `<p class="fw-freshness">${esc(info.freshness)}</p>` : ""}
        ${showExtended ? historyLine(history) : ""}
        <p class="fw-muted fw-round-refresh-note">${
          past
            ? "Past round — weather is historical context only."
            : info.live
              ? "Latest weather for this tee window."
              : "Opening the forecast always recalculates with latest weather."
        }</p>
        ${editing ? editForm(round) : ""}
      </div>
      <div class="fw-round-card-actions">
        <button type="button" class="fw-btn fw-btn-primary" data-open-round="${esc(round.id)}">View forecast</button>
        ${
          past
            ? `<button type="button" class="fw-btn fw-btn-ghost" data-play-again="${esc(round.id)}">Play again</button>`
            : ""
        }
        ${
          showExtended && !past
            ? `<button type="button" class="fw-btn fw-btn-ghost" data-edit-round="${esc(round.id)}">Edit</button>`
            : ""
        }
        <button type="button" class="fw-btn fw-btn-ghost fw-btn-danger" data-delete-round="${esc(round.id)}">Delete</button>
      </div>
    </li>`;
}

export function renderRoundsView({
  upcoming = [],
  past = [],
  summaries,
  loading = false,
  alerts = [],
  alertHtml = "",
  historyByRound = {},
  editingId = null,
  showExtended = false,
  disabled = false,
} = {}) {
  if (disabled) {
    return `
      <div class="fw-view fw-view-rounds">
        <h1 class="fw-page-title">Rounds</h1>
        <p class="fw-muted">Saved rounds are turned off in this preview.</p>
      </div>`;
  }

  const empty = !upcoming.length && !past.length;
  const card = (round, pastRound) =>
    roundCard(round, {
      past: pastRound,
      summaries,
      history: historyByRound[round.id],
      editing: editingId === round.id,
      showExtended,
    });

  return `
    <div class="fw-view fw-view-rounds">
      <h1 class="fw-page-title">Rounds</h1>
      ${alertHtml}
      ${alerts.length && !alertHtml ? renderAlertList(alerts, { compact: true }) : ""}
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
      ${loading && upcoming.length ? `<p class="fw-muted">Refreshing latest weather…</p>` : ""}
      ${
        upcoming.length
          ? `
        <section class="fw-rounds-upcoming" aria-label="Upcoming rounds">
          <h2 class="fw-section-title">Upcoming</h2>
          <ul class="fw-round-list">${upcoming.map((r) => card(r, false)).join("")}</ul>
        </section>`
          : ""
      }
      ${
        past.length
          ? `
        <section class="fw-rounds-past" aria-label="Past rounds">
          <h2 class="fw-section-title">Past</h2>
          <ul class="fw-round-list">${past.map((r) => card(r, true)).join("")}</ul>
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
  container?.querySelectorAll("[data-edit-round]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onEdit?.(btn.getAttribute("data-edit-round")));
  });
  container?.querySelectorAll("[data-cancel-edit]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onCancelEdit?.());
  });
  container?.querySelectorAll("[data-edit-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      handlers.onSaveEdit?.(form.getAttribute("data-edit-form"), {
        date: String(data.get("date") || ""),
        tee: String(data.get("tee") || ""),
        holes: Number(data.get("holes")),
      });
    });
  });
  container?.querySelectorAll("[data-dismiss-alert]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onDismissAlert?.(btn.getAttribute("data-dismiss-alert")));
  });
}
