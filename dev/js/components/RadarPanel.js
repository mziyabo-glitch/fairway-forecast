import { esc } from "../../../shared/utils.js";
import { createMockRadarProvider, createRadarAdapter } from "../radar/radarAdapter.js";

export function loadRadarFoundation() {
  const adapter = createRadarAdapter(createMockRadarProvider(), { allowLiveFetch: false });
  return adapter.load();
}

export function renderRadarPanel(model) {
  if (!model) return "";
  const layers = Array.isArray(model.layers) ? model.layers : [];
  return `
    <section class="fw-radar-panel" aria-label="Radar foundation">
      <h2 class="fw-section-title">Rain radar</h2>
      <p class="fw-radar-status">Radar is not live. These are mock layers only.</p>
      <ul class="fw-radar-layers">
        ${layers
          .map(
            (layer) => `
          <li class="fw-radar-layer">
            <span>${esc(layer.name)}</span>
            <span class="fw-muted">${esc(layer.status || "placeholder")}</span>
          </li>`
          )
          .join("")}
      </ul>
      <p class="fw-radar-attribution">${esc(model.attribution || "")}</p>
    </section>`;
}
