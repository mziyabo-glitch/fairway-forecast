import { esc } from "../../../shared/utils.js";

export function renderCourseHeader(course, { onChange } = {}) {
  if (!course) {
    return `
      <div class="fw-course-header fw-course-header--empty">
        <div class="fw-course-header-text">
          <span class="fw-course-name">Select a course</span>
          <span class="fw-course-location">Search in Courses to get started</span>
        </div>
      </div>`;
  }

  const parts = [course.city, course.state, course.country].filter(Boolean);
  const location = parts.join(", ") || "Location unavailable";

  return `
    <div class="fw-course-header">
      <div class="fw-course-header-text">
        <h1 class="fw-course-name">${esc(course.name)}</h1>
        <p class="fw-course-location">${esc(location)}</p>
      </div>
      ${
        onChange
          ? `<button type="button" class="fw-btn-text" id="fwChangeCourse">Change</button>`
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
}
