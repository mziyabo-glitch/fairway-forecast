import { esc, debounce } from "../../../shared/utils.js";

export function renderHomeView() {
  return `
    <div class="fw-view fw-view-home">
      <div class="fw-home-hero">
        <img src="../icons/icon-192.png" alt="" class="fw-home-logo" width="56" height="56" />
        <h1 class="fw-home-title">Fairway Weather</h1>
        <p class="fw-home-tagline">Know before you tee.</p>
      </div>
      <div class="fw-home-cards">
        <button type="button" class="fw-home-card" data-goto="courses">
          <i data-lucide="search"></i>
          <span>Find a course</span>
        </button>
        <button type="button" class="fw-home-card" data-goto="forecast">
          <i data-lucide="cloud-sun"></i>
          <span>View forecast</span>
        </button>
      </div>
      <p class="fw-home-note">Rebuild preview — mobile-first forecast experience.</p>
    </div>`;
}

export function wireHomeView(container, onNavigate) {
  container?.querySelectorAll("[data-goto]").forEach((el) => {
    el.addEventListener("click", () => onNavigate(el.getAttribute("data-goto")));
  });
}

export function renderCoursesView({ countries, country, state, usStates, query, results, loading, error }) {
  return `
    <div class="fw-view fw-view-courses">
      <h1 class="fw-page-title">Courses</h1>
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
          <i data-lucide="search" class="fw-search-icon"></i>
          <input id="fwCourseSearch" class="fw-search-input" type="search"
            placeholder="Search golf courses..." value="${esc(query || "")}" autocomplete="off" />
        </div>
      </div>
      ${error ? `<div class="fw-error" role="alert">${esc(error)}</div>` : ""}
      ${loading ? `<div class="fw-loading"><span class="fw-spinner"></span> Searching…</div>` : ""}
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
