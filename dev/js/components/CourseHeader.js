import { esc } from "../../../shared/utils.js";
import { renderFavouriteStar, wireFavouriteStars } from "./FavouriteStar.js";
import { renderShellMark, renderWordmark } from "./BrandMark.js";

export function renderCourseHeader(course, { onChange, isFavourite = false } = {}) {
  const location = course
    ? course.location ||
      [course.city, course.state, course.country].filter(Boolean).join(", ") ||
      "Location unavailable"
    : "";

  return `
    <div class="fw-course-header ${course ? "fw-course-header--has-course" : "fw-course-header--brand"}">
      <div class="fw-course-header-identity">
        ${renderShellMark(30)}
        <div class="fw-course-header-text">
          <p class="fw-shell-wordmark">${renderWordmark()}</p>
          ${
            course
              ? `<h1 class="fw-course-name">${esc(course.name)}</h1>
                 <p class="fw-course-location">${esc(location)}</p>`
              : ""
          }
        </div>
      </div>
      ${
        course
          ? `<div class="fw-course-header-actions">
        ${renderFavouriteStar(isFavourite, { courseId: course.id })}
        ${
          onChange
            ? `<button type="button" class="fw-btn-text" id="fwChangeCourse">Change</button>`
            : ""
        }
      </div>`
          : ""
      }
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
