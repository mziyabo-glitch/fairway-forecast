import { esc } from "../../../shared/utils.js";
import { displayCarry } from "../../../shared/shot-clubs.js";
import { recommendShot } from "../../../shared/shot-recommendation.js";
import { cardinal } from "../../../shared/wind-caddie.js";

const WIND_OPTIONS = [
  ["head", "Headwind"],
  ["cross", "Cross"],
  ["tail", "Tailwind"],
];

const GROUND_OPTIONS = [
  ["firm", "Firm"],
  ["normal", "Normal"],
  ["soft", "Soft"],
  ["very_soft", "Very Soft"],
];

function unitWord(units, { long = false } = {}) {
  if (units === "m") return long ? "m" : "m";
  return long ? "yds" : "yds";
}

function segments(name, groupLabel, options, selected) {
  return `
    <div class="fw-shot-seg" role="group" aria-label="${esc(groupLabel)}">
      ${options
        .map(
          ([value, label]) => `
        <button type="button" class="fw-shot-seg-btn ${value === selected ? "is-active" : ""}" data-shot-${name}="${esc(value)}" aria-pressed="${value === selected ? "true" : "false"}">
          ${esc(label)}
        </button>`
        )
        .join("")}
    </div>`;
}

export function renderShotResult(rec, units = "yd") {
  if (!rec || rec.state !== "ready" || !rec.club) {
    return `<p class="fw-shot-waiting">Enter a distance</p>`;
  }
  const unit = unitWord(units);
  const arrow = rec.clubSteps > 0 ? "↑ " : rec.clubSteps < 0 ? "↓ " : "";
  return `
    <p class="fw-shot-kicker">Recommended</p>
    <p class="fw-shot-club">${esc(rec.club.name)}</p>
    <p class="fw-shot-plays">Plays like ${esc(String(rec.playsLikeYards))} ${esc(unit)}</p>
    <p class="fw-shot-change">${esc(arrow + rec.clubLabel)}</p>`;
}

export function formatWindLine(conditions, compass = {}) {
  if (!conditions.windKnown) return "Unavailable";
  const {
    relativeArrow = null,
    relativeLabel = null,
    compassActive = false,
    shotBearing = null,
  } = compass;
  const base = `${conditions.windCardinal ? `${conditions.windCardinal} ` : ""}${conditions.windMph} mph forecast`;
  if (compassActive && relativeArrow) {
    const aim =
      shotBearing != null ? ` · ${relativeArrow} at ${shotBearing}° ${cardinal(shotBearing)}` : ` · ${relativeArrow} on your shot`;
    const detail = relativeLabel ? ` · ${relativeLabel}` : "";
    return `${base}${aim}${detail}`;
  }
  const abs = conditions.windArrow ? `${conditions.windArrow} ${base}` : base;
  return abs;
}

export function renderShotCaddieView(state) {
  const {
    panel = "shot",
    hasWeather = false,
    loading = false,
    conditions = {},
    target = "",
    units = "yd",
    windOnShot = "cross",
    ground = "normal",
    clubs = [],
    compass = {},
  } = state || {};

  if (panel === "clubs") {
    return `
      <div class="fw-view fw-view-shot">
        <button type="button" class="fw-shot-back" id="fwShotBack">Shot Caddie</button>
        <h1 class="fw-shot-title">My Clubs</h1>
        <p class="fw-shot-note">One carry each. Saved on this device.</p>
        <div class="fw-shot-unit-toggle" role="group" aria-label="Distance units">
          <button type="button" class="fw-shot-unit-btn ${units !== "m" ? "is-active" : ""}" data-shot-units="yd">yds</button>
          <button type="button" class="fw-shot-unit-btn ${units === "m" ? "is-active" : ""}" data-shot-units="m">m</button>
        </div>
        <ul class="fw-shot-club-list">
          ${clubs
            .map((club) => {
              const shown = displayCarry(club.carryYards, units);
              return `
              <li class="fw-shot-club-row">
                <label for="fwClub-${esc(club.id)}">${esc(club.name)}</label>
                <input id="fwClub-${esc(club.id)}" data-club-id="${esc(club.id)}" type="number" inputmode="decimal" min="1" max="450" step="1" value="${shown == null ? "" : esc(String(shown))}" />
              </li>`;
            })
            .join("")}
        </ul>
      </div>`;
  }

  if (!hasWeather) {
    return `
      <div class="fw-view fw-view-shot">
        <h1 class="fw-shot-title">Shot Caddie</h1>
        <p class="fw-shot-empty">${loading ? "Loading the course forecast…" : "Open a course forecast first. Wind and rain come from that forecast."}</p>
        ${loading ? "" : `<button type="button" class="fw-btn fw-btn-primary fw-shot-plan" id="fwShotGoForecast">Forecast</button>`}
      </div>`;
  }

  const windText = formatWindLine(conditions, compass);
  const compassStatus = compass.status ? esc(compass.status) : "";
  const compassControls =
    conditions.windKnown && compass.available !== false
      ? `<div class="fw-shot-compass-row">
          <button type="button" class="fw-shot-compass-btn" id="fwShotCompassStart">${compass.listening ? "Compass on" : "Use compass"}</button>
          <button type="button" class="fw-shot-compass-btn" id="fwShotCompassLock" ${compass.heading == null ? "disabled" : ""}>${compass.locked ? "Unlock" : "Lock aim"}</button>
        </div>
        ${compassStatus ? `<p class="fw-shot-compass-status" id="fwShotCompassStatus">${compassStatus}</p>` : `<p class="fw-shot-compass-status" id="fwShotCompassStatus"></p>`}`
      : "";
  const rainText = conditions.rainLabel || "—";
  const rec = recommendShot({
    target,
    units,
    windOnShot,
    windMph: conditions.windKnown ? conditions.windMph : null,
    rain: conditions.rainKey,
    ground,
    clubs,
  });

  return `
    <div class="fw-view fw-view-shot">
      <h1 class="fw-shot-title">Shot Caddie</h1>
      <p class="fw-shot-prompt">What are you hitting?</p>
      <div class="fw-shot-distance">
        <label class="fw-sr-only" for="fwShotDistance">Target distance</label>
        <input id="fwShotDistance" type="number" inputmode="numeric" min="1" max="450" step="1" placeholder="165" value="${esc(target)}" autocomplete="off" />
        <span class="fw-shot-unit" id="fwShotUnitLabel">${esc(unitWord(units))}</span>
      </div>
      <div class="fw-shot-unit-toggle fw-shot-unit-toggle--tiny" role="group" aria-label="Distance units">
        <button type="button" class="fw-shot-unit-btn ${units !== "m" ? "is-active" : ""}" data-shot-units="yd">yds</button>
        <button type="button" class="fw-shot-unit-btn ${units === "m" ? "is-active" : ""}" data-shot-units="m">m</button>
      </div>
      <p class="fw-shot-cond"><span>Wind</span> <strong id="fwShotWindLine">${esc(windText)}</strong></p>
      ${compassControls}
      ${conditions.windKnown ? segments("wind", "Wind on the shot", WIND_OPTIONS, windOnShot) : `<p class="fw-shot-note">No wind speed in this forecast.</p>`}
      ${compass.manualWind && compass.compassActive ? `<p class="fw-shot-note">Wind segment set manually — lock aim or tap Use compass to follow the phone again.</p>` : ""}
      <p class="fw-shot-cond"><span>Rain</span> <strong>${esc(rainText)}</strong></p>
      ${conditions.rainLabel ? `<p class="fw-shot-note">Rain is for the whole course and tee time, not hole-by-hole.</p>` : ""}
      <p class="fw-shot-cond"><span>Ground</span></p>
      ${segments("ground", "Ground", GROUND_OPTIONS, ground)}
      <div id="fwShotResult" class="fw-shot-result">${renderShotResult(rec, units)}</div>
      <button type="button" class="fw-shot-clubs-link" id="fwMyClubs">My Clubs</button>
    </div>`;
}

export function wireShotCaddieView(container, handlers = {}) {
  container?.querySelector("#fwShotGoForecast")?.addEventListener("click", () => handlers.onForecast?.());
  container?.querySelector("#fwShotBack")?.addEventListener("click", () => handlers.onBack?.());
  container?.querySelector("#fwMyClubs")?.addEventListener("click", () => handlers.onClubs?.());

  const distance = container?.querySelector("#fwShotDistance");
  distance?.addEventListener("input", () => handlers.onDistance?.(distance.value));

  container?.querySelectorAll("[data-shot-units]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onUnits?.(btn.getAttribute("data-shot-units")));
  });
  container?.querySelectorAll("[data-shot-wind]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onWind?.(btn.getAttribute("data-shot-wind")));
  });
  container?.querySelectorAll("[data-shot-ground]").forEach((btn) => {
    btn.addEventListener("click", () => handlers.onGround?.(btn.getAttribute("data-shot-ground")));
  });
  container?.querySelector("#fwShotCompassStart")?.addEventListener("click", () => handlers.onCompassStart?.());
  container?.querySelector("#fwShotCompassLock")?.addEventListener("click", () => handlers.onCompassLock?.());
  container?.querySelectorAll("[data-club-id]").forEach((input) => {
    input.addEventListener("change", () => handlers.onClubCarry?.(input.getAttribute("data-club-id"), input.value));
  });
}
