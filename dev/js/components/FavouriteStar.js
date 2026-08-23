import { esc } from "../../../shared/utils.js";

export function renderFavouriteStar(isFav, { courseId = "", compact = false } = {}) {
  const label = isFav ? "Remove from favourites" : "Add to favourites";
  return `
    <button type="button"
      class="fw-star ${isFav ? "is-on" : ""} ${compact ? "fw-star--compact" : ""}"
      data-fav-toggle="${esc(courseId)}"
      aria-pressed="${isFav ? "true" : "false"}"
      aria-label="${esc(label)}"
      title="${esc(label)}">
      <span aria-hidden="true">${isFav ? "★" : "☆"}</span>
    </button>`;
}

export function wireFavouriteStars(container, onToggle) {
  container?.querySelectorAll("[data-fav-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onToggle?.(btn.getAttribute("data-fav-toggle"));
    });
  });
}
