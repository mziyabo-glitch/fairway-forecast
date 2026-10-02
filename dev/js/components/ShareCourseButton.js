import { esc } from "../../../shared/utils.js";

export function renderShareButton(course) {
  if (!course?.id) return "";
  const name = course.name || "this course";
  return `<button type="button" class="fw-share-btn" data-action="share-course" aria-label="Share ${esc(name)}">
    <i data-lucide="share" aria-hidden="true"></i>
    <span class="fw-share-label">Share</span>
  </button>`;
}

export function wireShareButtons(container, onShare) {
  container?.querySelectorAll("[data-action='share-course']").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onShare?.();
    });
  });
}

export function showShareCopied(root = document) {
  root.querySelectorAll?.(".fw-share-btn").forEach((btn) => {
    const label = btn.querySelector(".fw-share-label");
    if (!label) return;
    if (btn.dataset.shareTimer) window.clearTimeout(Number(btn.dataset.shareTimer));
    if (!btn.dataset.shareLabel) btn.dataset.shareLabel = label.textContent || "Share";
    label.textContent = "Link copied";
    btn.classList.add("is-copied");
    btn.setAttribute("aria-live", "polite");
    const timer = window.setTimeout(() => {
      label.textContent = btn.dataset.shareLabel || "Share";
      btn.classList.remove("is-copied");
      btn.removeAttribute("aria-live");
    }, 2200);
    btn.dataset.shareTimer = String(timer);
  });
}
