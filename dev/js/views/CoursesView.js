import { esc } from "../../../shared/utils.js";
import { formatDistance } from "../../../shared/geo.js";
import { renderFavouriteStar, wireFavouriteStars } from "../components/FavouriteStar.js";

function courseRow(c, { favouriteIds = new Set(), showDistance = false } = {}) {
  const loc = [c.city, c.state, c.country].filter(Boolean).join(", ") || c.location || "";
  const dist = showDistance && Number.isFinite(c.distance) ? formatDistance(c.distance) : "";
  return `
    <li class="fw-course-row">
      <button type="button" class="fw-course-result" data-course-id="${esc(c.id)}">
        <span class="fw-course-result-name">${esc(c.name)}</span>
        <span class="fw-course-result-meta">${esc(loc)}${dist ? ` · ${esc(dist)}` : ""}</span>
      </button>
      ${renderFavouriteStar(favouriteIds.has(c.id), { courseId: c.id, compact: true })}
    </li>`;
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
  favouriteIds = new Set(),
  nearby = [],
  nearbyLoading = false,
  nearbyError = null,
} = {}) {
  return `
    <div class="fw-view fw-view-courses">
      <h1 class="fw-page-title">Courses</h1>

      <button type="button" class="fw-btn fw-btn-secondary fw-nearby-btn" id="fwNearbyBtn">
        📍 Courses near me
      </button>
      ${nearbyLoading ? `<div class="fw-loading"><span class="fw-spinner" aria-hidden="true"></span> Finding courses near you…</div>` : ""}
      ${nearbyError ? `<div class="fw-error" role="alert">${esc(nearbyError)}</div>` : ""}
      ${
        nearby.length
          ? `
        <section class="fw-nearby-results" aria-label="Courses near you">
          <h2 class="fw-section-title">Near you</h2>
          <ul class="fw-course-results">
            ${nearby.map((c) => courseRow(c, { favouriteIds, showDistance: true })).join("")}
          </ul>
        </section>`
          : ""
      }

      ${
        recentCourses.length
          ? `
        <section class="fw-courses-recent" aria-label="Recent courses">
          <h2 class="fw-section-title">Recent</h2>
          <ul class="fw-course-results">
            ${recentCourses.slice(0, 3).map((c) => courseRow(c, { favouriteIds })).join("")}
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
            ? results.map((c) => courseRow(c, { favouriteIds })).join("")
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

  container?.querySelector("#fwNearbyBtn")?.addEventListener("click", () => {
    handlers.onNearby?.();
  });

  container?.querySelectorAll(".fw-course-result").forEach((btn) => {
    btn.addEventListener("click", () => {
      handlers.onSelect?.(btn.getAttribute("data-course-id"));
    });
  });

  wireFavouriteStars(container, (id) => handlers.onToggleFavourite?.(id));
}

function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
