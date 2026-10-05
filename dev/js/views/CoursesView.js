import { esc } from "../../../shared/utils.js";
import { formatDistance } from "../../../shared/geo.js";
import { renderFavouriteStar, wireFavouriteStars } from "../components/FavouriteStar.js";
import { renderLoadingMark } from "../components/BrandMark.js";

function courseRow(
  c,
  { favouriteIds = new Set(), showDistance = false, distanceUnits = "metric", showStars = true } = {}
) {
  const loc =
    [...new Set([c.city, c.state, c.country].filter(Boolean))].join(", ") || c.location || "";
  const dist =
    showDistance && Number.isFinite(c.distance) ? formatDistance(c.distance, distanceUnits) : "";
  return `
    <li class="fw-course-row">
      <button type="button" class="fw-course-result" data-course-id="${esc(c.id)}">
        <span class="fw-course-result-name">${esc(c.name)}</span>
        <span class="fw-course-result-meta">${esc(loc)}${dist ? ` · ${esc(dist)}` : ""}</span>
      </button>
      ${showStars ? renderFavouriteStar(favouriteIds.has(c.id), { courseId: c.id, compact: true }) : ""}
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
  favouriteCourses = [],
  favouriteIds = new Set(),
  nearby = [],
  nearbyLoading = false,
  nearbyError = null,
  distanceUnits = "metric",
  showFavourites = true,
  showRecents = true,
  showNearby = true,
  unresolvedShare = false,
} = {}) {
  return `
    <div class="fw-view fw-view-courses">
      <h1 class="fw-page-title fw-page-title--prompt">Find your golf course</h1>
      <p class="fw-planning-intro">Choose a course, then set your date and tee time to check weather throughout your round.</p>

      <div class="fw-search-input-wrap fw-search-input-wrap--hero">
        <i data-lucide="search" class="fw-search-icon" aria-hidden="true"></i>
        <input id="fwCourseSearch" class="fw-search-input" type="search"
          placeholder="Search golf courses…" value="${esc(query || "")}" autocomplete="off"
          aria-label="Search golf courses" />
      </div>

      ${
        showNearby
          ? `<button type="button" class="fw-btn fw-btn-secondary fw-nearby-btn" id="fwNearbyBtn">
        <span aria-hidden="true">📍</span> Courses near me
      </button>
      ${nearbyLoading ? `<div class="fw-loading">${renderLoadingMark(18)} Finding courses near you…</div>` : ""}
      ${nearbyError ? `<div class="fw-error" role="alert">${esc(nearbyError)}</div>` : ""}`
          : ""
      }

      ${
        showNearby && nearby.length
          ? `
        <section class="fw-nearby-results" aria-label="Courses near you">
          <h2 class="fw-section-title fw-section-title--subtle">Near you</h2>
          <ul class="fw-course-results">
            ${nearby.map((c) => courseRow(c, { favouriteIds, showDistance: true, distanceUnits, showStars: showFavourites })).join("")}
          </ul>
        </section>`
          : ""
      }

      ${
        showRecents && recentCourses.length
          ? `
        <section class="fw-courses-recent" aria-label="Recent courses">
          <h2 class="fw-section-title fw-section-title--subtle">Recent</h2>
          <ul class="fw-course-results">
            ${recentCourses.slice(0, 5).map((c) => courseRow(c, { favouriteIds, showStars: showFavourites })).join("")}
          </ul>
        </section>`
          : ""
      }

      ${
        showFavourites && favouriteCourses.length
          ? `
        <section class="fw-courses-favourites" aria-label="Favourite courses">
          <h2 class="fw-section-title fw-section-title--subtle">Favourites</h2>
          <ul class="fw-course-results">
            ${favouriteCourses.slice(0, 8).map((c) => courseRow(c, { favouriteIds, showStars: showFavourites })).join("")}
          </ul>
        </section>`
          : ""
      }

      <details class="fw-region-filters">
        <summary>Search region: ${esc(countries?.find(c => c.code === country)?.name || country || "Choose a country")}</summary>
        <div class="fw-search-row">
          <div class="fw-region-field"><label for="fwCountrySelect">Country</label>
          <select id="fwCountrySelect" class="fw-select" aria-label="Country">
            ${countries
              .map(
                (c) =>
                  `<option value="${esc(c.code)}" ${c.code === country ? "selected" : ""}>${esc(c.flag)} ${esc(c.name)}</option>`
              )
              .join("")}
          </select>
          </div>
          ${
            country === "us"
              ? `<div class="fw-region-field"><label for="fwStateSelect">State</label><select id="fwStateSelect" class="fw-select" aria-label="State">
              <option value="">All states</option>
              ${usStates
                .map(
                  (s) =>
                    `<option value="${esc(s.code)}" ${s.code === state ? "selected" : ""}>${esc(s.name || s.code)}</option>`
                )
                .join("")}
            </select></div>`
              : ""
          }
        </div>
      </details>

      ${error ? `<div class="fw-error" role="alert">${esc(error)}</div>` : ""}
      ${loading ? `<div class="fw-loading">${renderLoadingMark(18)} Searching…</div>` : ""}
      <ul class="fw-course-results" aria-live="polite">
        ${
          results?.length
            ? results.map((c) => courseRow(c, { favouriteIds, showStars: showFavourites })).join("")
            : !loading && (query || unresolvedShare)
              ? `<li class="fw-empty">No courses found</li>`
              : !loading && query === ""
                ? ""
                : !loading
                  ? ""
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
