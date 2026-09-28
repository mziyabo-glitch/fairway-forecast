const MARK_SRC = "/dev/assets/brand/fairwayweather-mark.svg";

export function renderWordmark() {
  return `<span class="fw-shell-wordmark-fairway">Fairway</span><span class="fw-shell-wordmark-weather">Weather</span>`;
}

export function renderShellMark(size = 30) {
  return `<img class="fw-shell-mark" src="${MARK_SRC}" width="${size}" height="${size}" alt="" />`;
}

/** Compact mark for loading. Opacity pulse only — the symbol does not spin. */
export function renderLoadingMark(size = 18) {
  return `<span class="fw-mark-pulse" style="width:${size}px;height:${size}px" aria-hidden="true">
    <svg viewBox="0 0 32 32" width="${size}" height="${size}" focusable="false">
      <path d="M6.4 3.2V28.8" fill="none" stroke="currentColor" stroke-width="3.25" stroke-linecap="round"/>
      <path d="M8 6L16.8 8.9L8 11.9Z" fill="currentColor" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="M6.4 16.7C12.2 16.1 18.6 17.5 27 13" fill="none" stroke="currentColor" stroke-width="3.25" stroke-linecap="round"/>
    </svg>
  </span>`;
}

export function renderFirstRunIntro() {
  return `
    <div class="fw-brand-intro">
      <img class="fw-brand-intro-mark" src="${MARK_SRC}" width="44" height="44" alt="" />
      <p class="fw-brand-intro-wordmark">${renderWordmark()}</p>
      <p class="fw-brand-intro-tagline">Know before you tee.</p>
    </div>`;
}
