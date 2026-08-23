import { esc, fmtTimeCourse, scoreToVerdict } from "../../../shared/utils.js";
import { renderFavouriteStar, wireFavouriteStars } from "../components/FavouriteStar.js";
import { renderPremiumLocks, wirePremiumLocks } from "../components/PremiumLock.js";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function renderFavCard(card) {
  const course = card.course;
  const s = card.summary;
  if (!s) {
    return `
      <li>
        <button type="button" class="fw-fav-card" data-course-id="${esc(course.id)}">
          <div class="fw-fav-card-top">
            <strong>${esc(course.name)}</strong>
            ${renderFavouriteStar(true, { courseId: course.id, compact: true })}
          </div>
          <span class="fw-muted">${card.loading ? "Loading weather…" : "Weather unavailable"}</span>
        </button>
      </li>`;
  }

  return `
    <li>
      <button type="button" class="fw-fav-card fw-status-border-${esc(s.status?.key || "playable")}" data-course-id="${esc(course.id)}">
        <div class="fw-fav-card-top">
          <strong>${esc(course.name)}</strong>
          ${renderFavouriteStar(true, { courseId: course.id, compact: true })}
        </div>
        <p class="fw-fav-card-line">
          <span aria-hidden="true">${esc(s.icon || "🌤️")}</span>
          ${s.temp != null ? `${esc(String(s.temp))}°` : ""}
          · <strong class="fw-status-text-${esc(s.status?.key || "playable")}">${esc(s.verdict || "PLAYABLE")}</strong>
          ${s.score != null ? ` ${esc(String(s.score))}` : ""}
        </p>
        <p class="fw-fav-card-meta">
          ${s.bestTeeTime ? `Best: ${esc(s.bestTeeTime)}` : ""}
          ${s.hint ? ` · ${esc(s.hint)}` : ""}
        </p>
      </button>
    </li>`;
}

export function renderHomeView(state = {}) {
  const {
    course,
    weatherLoading,
    verdict,
    selectedTeeTime,
    tzOffset = 0,
    bestDay,
    favouriteCards = [],
    holes = 18,
    isFavourite = false,
    freshness = null,
    weatherIcon = "🌤️",
  } = state;

  const teeLabel =
    selectedTeeTime && tzOffset != null ? fmtTimeCourse(selectedTeeTime, tzOffset) : null;

  if (!course) {
    return `
      <div class="fw-view fw-view-home fw-home-empty">
        <div class="fw-home-hero">
          <h1 class="fw-home-title">Plan a better round</h1>
          <p class="fw-home-tagline">Know the rain, wind, and best tee time before you leave the house.</p>
        </div>
        <div class="fw-home-cards">
          <button type="button" class="fw-home-card" data-goto="courses">
            <i data-lucide="search"></i>
            <span>Search courses</span>
          </button>
          <button type="button" class="fw-home-card" data-action="nearby">
            <span aria-hidden="true">📍</span>
            <span>Find courses near me</span>
          </button>
        </div>
        <ul class="fw-home-benefits">
          <li>Don’t get caught in the rain mid-round</li>
          <li>See when the wind will pick up</li>
          <li>Pick the best tee time, not just today’s weather</li>
        </ul>
      </div>`;
  }

  const statusKey = verdict?.status?.key || "risky";
  const verdictWord = verdict?.verdict || scoreToVerdict(verdict?.score) || "";

  return `
    <div class="fw-view fw-view-home">
      <div class="fw-home-greeting">
        <h1 class="fw-home-title">${esc(greeting())}</h1>
      </div>

      <section class="fw-home-course-card" aria-label="Your course">
        <div class="fw-home-course-head">
          <div>
            <strong class="fw-home-course-name">${esc(course.name)}</strong>
          </div>
          ${renderFavouriteStar(isFavourite, { courseId: course.id })}
        </div>
        ${freshness ? `<p class="fw-freshness">${esc(freshness)}</p>` : ""}
        ${
          weatherLoading
            ? `<div class="fw-home-verdict fw-skeleton-block"><div class="fw-skeleton fw-skeleton-line"></div></div>`
            : verdict
              ? `
          <div class="fw-home-verdict fw-status-border-${statusKey}">
            <div class="fw-home-verdict-main">
              <span class="fw-home-emoji" aria-hidden="true">${weatherIcon}</span>
              <span class="fw-home-verdict-word fw-status-text-${statusKey}">${esc(verdictWord)}</span>
              <span class="fw-home-score fw-status-text-${statusKey}">${esc(String(verdict.score))}</span>
            </div>
            <p class="fw-home-tee-line">${teeLabel ? `${esc(teeLabel)}` : "—"} · ${holes} holes</p>
            <p class="fw-home-message">${esc(verdict.message)}</p>
          </div>`
              : `<p class="fw-muted">Select Forecast to load conditions.</p>`
        }
        <button type="button" class="fw-btn fw-btn-primary fw-home-cta" data-action="forecast">View forecast</button>
      </section>

      ${
        bestDay
          ? `
        <section class="fw-home-best-week" aria-label="Best golf this week">
          <h2 class="fw-section-title">Best golf this week</h2>
          <p class="fw-home-best-line">
            ${esc(bestDay.dayLabel || "This week")}
            ${bestDay.bestTeeTime ? ` · ${esc(bestDay.bestTeeTime)}` : ""}
            ${bestDay.score != null ? ` · ${esc(String(bestDay.score))}` : ""}
            ${bestDay.verdict ? ` · ${esc(bestDay.verdict)}` : ""}
          </p>
        </section>`
          : ""
      }

      <section class="fw-home-favs" aria-label="Favourite courses">
        <h2 class="fw-section-title">Favourite courses</h2>
        ${
          favouriteCards.length
            ? `<ul class="fw-fav-list">${favouriteCards.map(renderFavCard).join("")}</ul>`
            : `<p class="fw-muted">Star a course from search or the forecast to see where you should play.</p>`
        }
      </section>

      ${renderPremiumLocks()}
    </div>`;
}

export function wireHomeView(container, handlers) {
  container?.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => handlers.onNavigate?.(el.getAttribute("data-goto")));
  });

  container?.querySelector("[data-action='forecast']")?.addEventListener("click", () => {
    handlers.onGoForecast?.();
  });

  container?.querySelector("[data-action='nearby']")?.addEventListener("click", () => {
    handlers.onNearby?.();
  });

  container?.querySelectorAll("[data-course-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (e.target.closest("[data-fav-toggle]")) return;
      handlers.onSelectCourse?.(btn.getAttribute("data-course-id"));
    });
  });

  wireFavouriteStars(container, (id) => handlers.onToggleFavourite?.(id));
  wirePremiumLocks(container, (id) => handlers.onPremium?.(id));
}
