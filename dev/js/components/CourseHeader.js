import { esc } from "../../../shared/utils.js";
import { renderFavouriteStar, wireFavouriteStars } from "./FavouriteStar.js";

export function renderCourseHeader(course, { onChange, isFavourite = false } = {}) {
  if (!course) {
    return `
      <div class="fw-course-header fw-course-header--empty">
        <div class="fw-course-header-text">
          <span class="fw-course-name">Select a course</span>
          <span class="fw-course-location">Search in Courses to get started</span>
        </div>
      </div>`;
  }

  const location =
    course.location ||
    [course.city, course.state, course.country].filter(Boolean).join(", ") ||
    "Location unavailable";

  return `
    <div class="fw-course-header">
      <div class="fw-course-header-text">
        <h1 class="fw-course-name">${esc(course.name)}</h1>
        <p class="fw-course-location">${esc(location)}</p>
      </div>
      <div class="fw-course-header-actions">
        ${renderFavouriteStar(isFavourite, { courseId: course.id })}
        ${
          onChange
            ? `<button type="button" class="fw-btn-text" id="fwChangeCourse">Change</button>`
            : ""
        }
      </div>
    </div>`;
}

export function mountCourseHeader(container, course, handlers = {}) {
  if (!container) return;
  container.innerHTML = renderCourseHeader(course, handlers);
  document.getElementById("fwChangeCourse")?.addEventListener("click", () => {
    handlers.onChange?.();
  });
  wireFavouriteStars(container, () => handlers.onToggleFavourite?.(course));
}
