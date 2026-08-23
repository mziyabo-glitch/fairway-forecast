import { esc, fmtTimeCourse, weatherIdToIcon, windDegToCardinal, roundNum, tempUnit } from "../../../shared/utils.js";

export function renderHourlyForecast({ hourly = [], tzOffset = 0, units = "metric", expanded = false } = {}) {
  const tu = tempUnit(units);
  const rows = (hourly || []).slice(0, 16).map((h) => {
    const icon = weatherIdToIcon(h?.weather?.[0]?.id);
    const pop = Math.round((h.pop || 0) * 100);
    const rain = Number.isFinite(h.rain_mm) ? `${roundNum(h.rain_mm, 1)}` : "0";
    const wind = Number.isFinite(h.wind_speed) ? roundNum(h.wind_speed, 0) : "—";
    const gust = Number.isFinite(h.wind_gust) ? roundNum(h.wind_gust, 0) : "—";
    const dir = windDegToCardinal(h.wind_deg);
    const temp = Number.isFinite(h.temp) ? Math.round(h.temp) : "—";
    const feels = Number.isFinite(h.feels_like) ? Math.round(h.feels_like) : "—";
    return `
      <tr>
        <td>${esc(fmtTimeCourse(h.dt, tzOffset))}</td>
        <td class="fw-hourly-icon" aria-hidden="true">${icon}</td>
        <td>${esc(String(temp))}${esc(tu)}</td>
        <td>${esc(String(feels))}${esc(tu)}</td>
        <td>${esc(String(pop))}%</td>
        <td>${esc(rain)}</td>
        <td>${esc(String(wind))}</td>
        <td>${esc(String(gust))}</td>
        <td>${esc(dir)}</td>
      </tr>`;
  });

  if (!rows.length) return "";

  return `
    <details class="fw-hourly" id="fwHourlyWeather" ${expanded ? "open" : ""}>
      <summary class="fw-hourly-summary">Hourly weather</summary>
      <div class="fw-hourly-table-wrap">
        <table class="fw-hourly-table">
          <thead>
            <tr>
              <th>Time</th>
              <th></th>
              <th>Temp</th>
              <th>Feels</th>
              <th>Rain %</th>
              <th>mm</th>
              <th>Wind</th>
              <th>Gusts</th>
              <th>Dir</th>
            </tr>
          </thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
    </details>`;
}

export function wireHourlyForecast(container, onExpand) {
  const details = container?.querySelector("#fwHourlyWeather");
  if (!details) return;
  details.addEventListener("toggle", () => {
    if (details.open) onExpand?.();
  });
}
