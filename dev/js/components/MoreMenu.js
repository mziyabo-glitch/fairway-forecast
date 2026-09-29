import { esc } from "../../../shared/utils.js";

export function renderMoreMenu(items = []) {
  if (!items.length) {
    return `<p class="fw-muted">Nothing else is switched on in this preview.</p>`;
  }
  return `
    <nav class="fw-more-menu" aria-label="More">
      ${items
        .map(
          (item) => `
        <button type="button" class="fw-more-item" data-more-tab="${esc(item.id)}">
          <span class="fw-more-item-label">${esc(item.label)}</span>
          <span class="fw-more-item-hint">${esc(item.hint || "")}</span>
        </button>`
        )
        .join("")}
    </nav>`;
}
