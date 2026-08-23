import { esc, fmtTimeCourse, weatherIdToIcon, windDegToCardinal, roundNum, tempUnit } from "../../../shared/utils.js";

export function renderHourlyForecast({ hourly = [], tzOffset = 0, units = "metric", expanded = false } = {}) {
  const tu = tempUnit(units);
  const rows = (hourly || []).slice(0, 16).map((h) => {
    const icon = weatherIdToIcon(h?.weather?.[0]?.id);
    const pop = Math.round((h.pop || 0) * 100);
    const rain = Number.isFinite(h.rain_mm) ? `${roundNum(h.rain_mm, 1)} mm` : "0 mm";
    const wind = Number.isFinite(h.wind_speed) ? roundNum(h.wind_speed, 0) : "—";
    const gust = Number.isFinite(h.wind_gust) ? roundNum(h.wind_gust, 0) : "—";
    const dir = windDegToCardinal(h.wind_deg);
    const temp = Number.isFinite(h.temp) ? Math.round(h.temp) : "—";
    const feels = Number.isFinite(h.feels_like) ? Math.round(h.feels_like) : "—";
    const time = fmtTimeCourse(h.dt, tzOffset);
    return `
      <li class="fw-hourly-row">
        <div class="fw-hourly-primary">
          <time class="fw-hourly-time">${esc(time)}</time>
          <span class="fw-hourly-icon" aria-hidden="true">${icon}</span>
          <span class="fw-hourly-temp">${esc(String(temp))}${esc(tu)}</span>
          <span class="fw-hourly-feels">feels ${esc(String(feels))}${esc(tu)}</span>
        </div>
        <div class="fw-hourly-secondary">
          <span>Rain ${esc(String(pop))}%</span>
          <span>${esc(rain)}</span>
          <span>Wind ${esc(String(wind))}</span>
          <span>Gusts ${esc(String(gust))}</span>
          <span>${esc(dir)}</span>
        </div>
      </li>`;
  });

  if (!rows.length) return "";

  return `
    <details class="fw-hourly" id="fwHourlyWeather" ${expanded ? "open" : ""}>
      <summary class="fw-hourly-summary" aria-expanded="${expanded ? "true" : "false"}">Hourly weather</summary>
      <ol class="fw-hourly-list">${rows.join("")}</ol>
    </details>`;
}

export function wireHourlyForecast(container, onExpand) {
  const details = container?.querySelector("#fwHourlyWeather");
  if (!details) return;
  const summary = details.querySelector("summary");
  const sync = () => summary?.setAttribute("aria-expanded", details.open ? "true" : "false");
  sync();
  details.addEventListener("toggle", () => {
    sync();
    if (details.open) onExpand?.();
  });
}
