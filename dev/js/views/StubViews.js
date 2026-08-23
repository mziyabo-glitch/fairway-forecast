import { esc, fmtTimeCourse } from "../../../shared/utils.js";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function renderHomeView(state = {}) {
  const {
    course,
    weatherLoading,
    verdict,
    selectedTeeTime,
    tzOffset = 0,
    bestDay,
    recentCourses = [],
    holes = 18,
  } = state;

  const teeLabel =
    selectedTeeTime && tzOffset != null
      ? fmtTimeCourse(selectedTeeTime, tzOffset)
      : null;

  return `
    <div class="fw-view fw-view-home">
      <div class="fw-home-greeting">
        <h1 class="fw-home-title">${esc(greeting())}</h1>
        <p class="fw-home-tagline">Know before you tee.</p>
      </div>

      ${
        course
          ? `
        <section class="fw-home-course-card" aria-label="Your course">
          <div class="fw-home-course-head">
            <i data-lucide="map-pin" aria-hidden="true"></i>
            <div>
              <strong>${esc(course.name)}</strong>
              <span class="fw-home-course-meta">${esc([course.city, course.state].filter(Boolean).join(", "))}</span>
            </div>
          </div>
          ${
            weatherLoading
              ? `<div class="fw-home-verdict fw-skeleton-block"><div class="fw-skeleton fw-skeleton-line"></div></div>`
              : verdict
                ? `
            <div class="fw-home-verdict fw-status-border-${verdict.status?.key || "risky"}">
              <span class="fw-home-score fw-status-text-${verdict.status?.key || "risky"}">${esc(String(verdict.score))}</span>
              <div>
                <strong>${esc(verdict.label)}</strong>
                <p>${esc(verdict.message)}</p>
                ${teeLabel ? `<span class="fw-home-tee">${holes} holes · ${esc(teeLabel)} tee</span>` : ""}
              </div>
            </div>`
                : `<p class="fw-muted">Select Forecast to load conditions.</p>`
          }
          ${
            bestDay
              ? `<p class="fw-home-best">Best golf this week: <strong>${esc(bestDay.dayLabel)}</strong>${bestDay.bestTeeTime ? ` · Best ${esc(bestDay.bestTeeTime)}` : ""} (${bestDay.score})</p>`
              : ""
          }
          <button type="button" class="fw-btn fw-btn-primary fw-home-cta" data-action="forecast">View forecast</button>
        </section>`
          : `
        <div class="fw-home-cards">
          <button type="button" class="fw-home-card" data-goto="courses">
            <i data-lucide="search"></i>
            <span>Find a course</span>
          </button>
          <button type="button" class="fw-home-card" data-goto="courses">
            <i data-lucide="map-pin"></i>
            <span>Use my location</span>
          </button>
        </div>`
      }

      ${
        recentCourses.length
          ? `
        <section class="fw-home-recent" aria-label="Recent courses">
          <h2 class="fw-section-title">Recent courses</h2>
          <ul class="fw-home-recent-list">
            ${recentCourses
              .map(
                (c) => `
              <li>
                <button type="button" class="fw-home-recent-btn" data-course-id="${esc(c.id)}">
                  <span>${esc(c.name)}</span>
                  <span class="fw-home-course-meta">${esc(c.city || "")}</span>
                </button>
              </li>`
              )
              .join("")}
          </ul>
        </section>`
          : ""
      }

      <section class="fw-home-fav-placeholder" aria-label="Favourites placeholder">
        <h2 class="fw-section-title">Favourites</h2>
        <p class="fw-muted">Pin courses here in a future update — search above to get started.</p>
      </section>
    </div>`;
}

export function wireHomeView(container, handlers) {
  container?.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => handlers.onNavigate?.(el.getAttribute("data-goto")));
  });

  container?.querySelector("[data-action='forecast']")?.addEventListener("click", () => {
    handlers.onGoForecast?.();
  });

  container?.querySelectorAll("[data-course-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onSelectCourse?.(btn.getAttribute("data-course-id"));
    });
  });
}

export function renderCoursesView({
  countries,
  country,
  state,
  usStates,
  query,
  results,
  loading,
  error,
  recentCourses = [],
}) {
  return `
    <div class="fw-view fw-view-courses">
      <h1 class="fw-page-title">Courses</h1>
      ${
        recentCourses.length
          ? `
        <section class="fw-courses-recent" aria-label="Recent courses">
          <h2 class="fw-section-title">Recent</h2>
          <ul class="fw-course-results">
            ${recentCourses
              .slice(0, 3)
              .map(
                (c) => `
              <li>
                <button type="button" class="fw-course-result" data-course-id="${esc(c.id)}">
                  <span class="fw-course-result-name">${esc(c.name)}</span>
                  <span class="fw-course-result-meta">${esc([c.city, c.state].filter(Boolean).join(", "))}</span>
                </button>
              </li>`
              )
              .join("")}
          </ul>
        </section>`
          : ""
      }
      <div class="fw-search-panel">
        <div class="fw-search-row">
          <select id="fwCountrySelect" class="fw-select" aria-label="Country">
            ${countries
              .map(
                (c) =>
                  `<option value="${esc(c.code)}" ${c.code === country ? "selected" : ""}>${esc(c.flag)} ${esc(c.name)}</option>`
              )
              .join("")}
          </select>
          ${
            country === "us"
              ? `<select id="fwStateSelect" class="fw-select" aria-label="State">
              <option value="">All states</option>
              ${usStates
                .map(
                  (s) =>
                    `<option value="${esc(s.code)}" ${s.code === state ? "selected" : ""}>${esc(s.name || s.code)}</option>`
                )
                .join("")}
            </select>`
              : ""
          }
        </div>
        <div class="fw-search-input-wrap">
          <i data-lucide="search" class="fw-search-icon" aria-hidden="true"></i>
          <input id="fwCourseSearch" class="fw-search-input" type="search"
            placeholder="Search golf courses..." value="${esc(query || "")}" autocomplete="off"
            aria-label="Search golf courses" />
        </div>
      </div>
      ${error ? `<div class="fw-error" role="alert">${esc(error)}</div>` : ""}
      ${loading ? `<div class="fw-loading"><span class="fw-spinner" aria-hidden="true"></span> Searching…</div>` : ""}
      <ul class="fw-course-results" aria-live="polite">
        ${
          results?.length
            ? results
                .map(
                  (c) => `
            <li>
              <button type="button" class="fw-course-result" data-course-id="${esc(c.id)}">
                <span class="fw-course-result-name">${esc(c.name)}</span>
                <span class="fw-course-result-meta">${esc([c.city, c.state].filter(Boolean).join(", "))}</span>
              </button>
            </li>`
                )
                .join("")
            : !loading && query
              ? `<li class="fw-empty">No courses found</li>`
              : !loading
                ? `<li class="fw-empty">Start typing to search courses</li>`
                : ""
        }
      </ul>
      <p class="fw-osm-credit">Course data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a></p>
    </div>`;
}

export function wireCoursesView(container, handlers) {
  const searchInput = container?.querySelector("#fwCourseSearch");
  const debouncedSearch = debounce((q) => handlers.onSearch?.(q), 200);

  searchInput?.addEventListener("input", (e) => debouncedSearch(e.target.value));

  container?.querySelector("#fwCountrySelect")?.addEventListener("change", (e) => {
    handlers.onCountryChange?.(e.target.value);
  });

  container?.querySelector("#fwStateSelect")?.addEventListener("change", (e) => {
    handlers.onStateChange?.(e.target.value);
  });

  container?.querySelectorAll(".fw-course-result").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-course-id");
      handlers.onSelect?.(id);
    });
  });
}

function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function renderRoundsView() {
  return `
    <div class="fw-view fw-view-rounds">
      <h1 class="fw-page-title">Rounds</h1>
      <div class="fw-stub-card">
        <i data-lucide="flag"></i>
        <h2>Saved rounds coming soon</h2>
        <p>Track your rounds, scores, and conditions history. Available in a future milestone.</p>
      </div>
    </div>`;
}
