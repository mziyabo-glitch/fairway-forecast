import { wrapBearing } from "../../shared/wind-caddie.js";

/** North-up dial rotations (deg, clockwise). Wind line matches wind-caddie-app: from wind origin toward center. */
export function shotWindDialViewState({ windKnown, windDeg, shotBearing, available }) {
  if (!windKnown || !Number.isFinite(windDeg)) return { hidden: true };
  const state = {
    hidden: false,
    windRotate: wrapBearing(windDeg),
    aimRotate: null,
    showAim: false,
    note: null,
  };
  if (available === false) {
    state.note = "Compass unavailable — wind from forecast";
    return state;
  }
  if (shotBearing == null) {
    state.note = "Point at target to show your aim";
    return state;
  }
  state.showAim = true;
  state.aimRotate = wrapBearing(shotBearing);
  return state;
}

export function renderShotWindDialMarkup() {
  return `
    <div class="fw-shot-wind-dial-wrap" id="fwShotWindDialWrap" hidden>
      <div class="fw-shot-wind-dial" id="fwShotWindDial" role="img" aria-labelledby="fwShotWindDialAria">
        <svg class="fw-shot-wind-dial-svg" viewBox="0 0 72 72" aria-hidden="true">
          <circle class="fw-shot-wind-dial-ring" cx="36" cy="36" r="31" />
          <text class="fw-shot-wind-dial-n" x="36" y="10" text-anchor="middle">N</text>
          <g class="fw-shot-wind-dial-wind" data-layer="wind">
            <line class="fw-shot-wind-dial-wind-line" x1="36" y1="8" x2="36" y2="28" />
            <polygon class="fw-shot-wind-dial-wind-head" points="36,8 32,16 40,16" />
          </g>
          <g class="fw-shot-wind-dial-aim" data-layer="aim" hidden>
            <line class="fw-shot-wind-dial-aim-line" x1="36" y1="36" x2="36" y2="10" />
            <circle class="fw-shot-wind-dial-aim-dot" cx="36" cy="10" r="3.5" />
          </g>
          <circle class="fw-shot-wind-dial-hub" cx="36" cy="36" r="3" />
        </svg>
        <p class="fw-shot-wind-dial-legend" aria-hidden="true">
          <span class="fw-shot-wind-dial-tag fw-shot-wind-dial-tag--aim">You</span>
          <span class="fw-shot-wind-dial-tag fw-shot-wind-dial-tag--wind">Wind</span>
        </p>
        <p class="fw-sr-only" id="fwShotWindDialAria">Phone aim and forecast wind on a north-up compass</p>
      </div>
      <p class="fw-shot-wind-dial-note" id="fwShotWindDialNote" hidden></p>
    </div>`;
}

export function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function updateShotWindDial(root, params) {
  if (!root) return;
  const wrap = root.closest(".fw-shot-wind-dial-wrap") || root;
  const dial = wrap.querySelector(".fw-shot-wind-dial") || root;
  const note = wrap.querySelector("#fwShotWindDialNote") || wrap.querySelector(".fw-shot-wind-dial-note");
  const windLayer = dial.querySelector('[data-layer="wind"]');
  const aimLayer = dial.querySelector('[data-layer="aim"]');
  const state = shotWindDialViewState(params);

  if (state.hidden) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  dial.classList.toggle("is-smooth", !prefersReducedMotion());

  if (windLayer) windLayer.style.transform = `rotate(${state.windRotate}deg)`;
  if (aimLayer) {
    aimLayer.hidden = !state.showAim;
    if (state.showAim && state.aimRotate != null) {
      aimLayer.style.transform = `rotate(${state.aimRotate}deg)`;
    }
  }

  if (note) {
    if (state.note) {
      note.textContent = state.note;
      note.hidden = false;
    } else {
      note.textContent = "";
      note.hidden = true;
    }
  }

  const aria = wrap.querySelector("#fwShotWindDialAria");
  if (aria) {
    const parts = [`Wind from ${Math.round(state.windRotate)}°`];
    if (state.showAim && state.aimRotate != null) parts.push(`you aiming ${Math.round(state.aimRotate)}°`);
    aria.textContent = parts.join(", ");
  }
}
