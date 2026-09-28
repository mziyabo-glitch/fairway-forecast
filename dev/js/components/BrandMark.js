/**
 * The mark is drawn inline. An <img src="/dev/assets/..."> disappears when that
 * request 404s (project-site base path, or a service worker still serving the
 * pre-brand shell). currentColor keeps the symbol on the brand green.
 */

const MICRO_PATHS = `
  <path d="M6.4 3.2V28.8" fill="none" stroke="currentColor" stroke-width="3.25" stroke-linecap="round"/>
  <path d="M8 6L16.8 8.9L8 11.9Z" fill="currentColor" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M6.4 16.7C12.2 16.1 18.6 17.5 27 13" fill="none" stroke="currentColor" stroke-width="3.25" stroke-linecap="round"/>`;

const FULL_PATHS = `
  <path d="M43.5 22.5C53.5 12 65.5 13 70.5 23" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M11.5 10V70" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/>
  <path d="M14.5 15.8L36.5 21.2L14.5 26.6Z" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M11.5 43C25.5 41.5 41.5 45 66.5 32.5" fill="none" stroke="currentColor" stroke-width="6.5" stroke-linecap="round"/>`;

function markSvg({ className, size, viewBox, paths }) {
  return `<svg class="${className}" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${paths}</svg>`;
}

export function renderWordmark() {
  return `<span class="fw-shell-wordmark-fairway">Fairway</span><span class="fw-shell-wordmark-weather">Weather</span>`;
}

/** Header lockup. At 32px and under, the micro mark drops the horizon arc. */
export function renderShellMark(size = 32) {
  const micro = size <= 32;
  return markSvg({
    className: "fw-shell-mark",
    size,
    viewBox: micro ? "0 0 32 32" : "4.7 4.7 70.6 70.6",
    paths: micro ? MICRO_PATHS : FULL_PATHS,
  });
}

/** Compact mark for loading. Opacity pulse only — the symbol does not spin. */
export function renderLoadingMark(size = 18) {
  return `<span class="fw-mark-pulse" style="width:${size}px;height:${size}px" aria-hidden="true">
    <svg viewBox="0 0 32 32" width="${size}" height="${size}" focusable="false">${MICRO_PATHS}
    </svg>
  </span>`;
}

export function renderFirstRunIntro() {
  return `
    <div class="fw-brand-intro">
      ${markSvg({
        className: "fw-brand-intro-mark",
        size: 56,
        viewBox: "4.7 4.7 70.6 70.6",
        paths: FULL_PATHS,
      })}
      <p class="fw-brand-intro-wordmark">${renderWordmark()}</p>
      <p class="fw-brand-intro-tagline">Know before you tee.</p>
    </div>`;
}
