import { esc } from "../../../shared/utils.js";
import { devFeatures } from "../config/devFeatures.js";
import { GOLFER_PREFERENCE_DEFAULTS } from "../preferences/golferPreferences.js";

function option(value, label, selected) {
  return `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
}

function preferencesSection(preferences) {
  const prefs = preferences || GOLFER_PREFERENCE_DEFAULTS;
  const pace = prefs.paceMins || GOLFER_PREFERENCE_DEFAULTS.paceMins;
  return `
    <section class="fw-settings-block" aria-label="Golfer preferences">
      <h2 class="fw-section-title">Your preferences</h2>
      <p>These stay on this device and shape Personal fit only. The weather score is unchanged.</p>
      <form id="fwGolferPrefs" class="fw-form">
        <label class="fw-field">Rain
          <select class="fw-select" name="rainTolerance">
            ${option("avoid", "Avoid rain", prefs.rainTolerance)}
            ${option("light", "Light rain is fine", prefs.rainTolerance)}
            ${option("any", "Any rain", prefs.rainTolerance)}
          </select>
        </label>
        <label class="fw-field">Wind
          <select class="fw-select" name="windTolerance">
            ${option("low", "Low", prefs.windTolerance)}
            ${option("medium", "Medium", prefs.windTolerance)}
            ${option("high", "High", prefs.windTolerance)}
          </select>
        </label>
        <div class="fw-pref-grid">
          <label class="fw-field">Min comfort °C
            <input class="fw-search-input" name="minComfortC" type="number" inputmode="numeric" min="-20" max="45" value="${esc(prefs.minComfortC)}" />
          </label>
          <label class="fw-field">Max comfort °C
            <input class="fw-search-input" name="maxComfortC" type="number" inputmode="numeric" min="-20" max="45" value="${esc(prefs.maxComfortC)}" />
          </label>
        </div>
        <label class="fw-field">Getting around
          <select class="fw-select" name="transport">
            ${option("walking", "Walking", prefs.transport)}
            ${option("buggy", "Buggy", prefs.transport)}
          </select>
        </label>
        <label class="fw-field">Play style
          <select class="fw-select" name="playStyle">
            ${option("practice", "Practice", prefs.playStyle)}
            ${option("casual", "Casual", prefs.playStyle)}
            ${option("competition", "Competition", prefs.playStyle)}
            ${option("society", "Society", prefs.playStyle)}
          </select>
        </label>
        <label class="fw-field">Daylight safety margin (minutes)
          <input class="fw-search-input" name="daylightSafetyMarginMins" type="number" inputmode="numeric" min="0" max="90" value="${esc(prefs.daylightSafetyMarginMins)}" />
        </label>
        <fieldset class="fw-pref-pace">
          <legend>Pace (minutes)</legend>
          <div class="fw-pref-grid">
            <label class="fw-field">3 holes
              <input class="fw-search-input" name="pace3" type="number" inputmode="numeric" min="20" max="360" value="${esc(pace[3])}" />
            </label>
            <label class="fw-field">6 holes
              <input class="fw-search-input" name="pace6" type="number" inputmode="numeric" min="20" max="360" value="${esc(pace[6])}" />
            </label>
            <label class="fw-field">9 holes
              <input class="fw-search-input" name="pace9" type="number" inputmode="numeric" min="20" max="360" value="${esc(pace[9])}" />
            </label>
            <label class="fw-field">18 holes
              <input class="fw-search-input" name="pace18" type="number" inputmode="numeric" min="20" max="360" value="${esc(pace[18])}" />
            </label>
          </div>
        </fieldset>
        <p class="fw-muted" id="fwPrefsStatus" role="status">Saved on this device.</p>
      </form>
    </section>`;
}

export function renderSettingsView({ notificationMode = "in_app_only", showPreferences = false, preferences = null } = {}) {
  const flags = Object.entries(devFeatures)
    .map(([key, value]) => `<li><span>${esc(key)}</span><span>${value ? "On" : "Off"}</span></li>`)
    .join("");
  return `
    <div class="fw-view fw-view-settings">
      <h1 class="fw-page-title">Settings</h1>
      ${showPreferences ? preferencesSection(preferences) : ""}
      <section class="fw-settings-block" aria-label="Affiliate disclosure">
        <h2 class="fw-section-title">Affiliate disclosure</h2>
        <p>FairwayWeather may later show one sponsored golf card below the forecast verdict, rain timeline, and tee selector. Sponsored cards are off in this preview, so nothing is rendered. If a partner link is enabled later, it will use <span class="fw-code">rel="sponsored noopener"</span>.</p>
        <p class="fw-muted">Advertising slots are off. This preview does not load an ad script or iframe.</p>
      </section>
      <section class="fw-settings-block" aria-label="Notifications">
        <h2 class="fw-section-title">Notifications</h2>
        <p>Delivery mode: ${esc(notificationMode)}. Push and email are not sent.</p>
      </section>
      <section class="fw-settings-block" aria-label="Offline">
        <h2 class="fw-section-title">On this device</h2>
        <p>Saved courses and rounds stay in local storage. Live weather is not cached. If you are offline, open a saved course or round after the app shell has loaded.</p>
      </section>
      <section class="fw-settings-block" aria-label="Feature flags">
        <h2 class="fw-section-title">Preview flags</h2>
        <ul class="fw-flag-list">${flags}</ul>
      </section>
    </div>`;
}

export function readPreferencesForm(form) {
  const data = new FormData(form);
  const value = (name) => String(data.get(name) ?? "");
  return {
    rainTolerance: value("rainTolerance"),
    windTolerance: value("windTolerance"),
    minComfortC: value("minComfortC"),
    maxComfortC: value("maxComfortC"),
    transport: value("transport"),
    playStyle: value("playStyle"),
    daylightSafetyMarginMins: value("daylightSafetyMarginMins"),
    paceMins: {
      3: value("pace3"),
      6: value("pace6"),
      9: value("pace9"),
      18: value("pace18"),
    },
  };
}

export function wireSettingsView(container, { onPreferencesChange } = {}) {
  const form = container?.querySelector("#fwGolferPrefs");
  if (!form) return;
  const status = form.querySelector("#fwPrefsStatus");
  const save = () => {
    try {
      const saved = onPreferencesChange?.(readPreferencesForm(form));
      if (status) status.textContent = saved === false ? "Could not save on this device. The forecast still works." : "Saved on this device.";
    } catch {
      if (status) status.textContent = "Could not save on this device. The forecast still works.";
    }
  };
  form.addEventListener("change", save);
  form.addEventListener("input", (event) => {
    if (event.target instanceof HTMLInputElement) save();
  });
}
