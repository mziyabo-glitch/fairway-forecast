import { renderDayForecastStrip, wireDayForecastStrip } from "../components/DayForecastStrip.js";
import {
  renderGolfVerdictHero,
  renderVerdictHeroSkeleton,
  wireGolfVerdictHero,
} from "../components/GolfVerdictHero.js";
import { renderRoundSelector, wireRoundSelector } from "../components/RoundSelector.js";
import { renderRainTimeline, renderRainTimelineSkeleton } from "../components/RainTimeline.js";
import { renderWeatherImpactCards } from "../components/WeatherImpactCard.js";
import {
  renderBestTeeTimeCard,
  renderScoreExplanationBody,
  wireBestTeeTimeCard,
} from "../components/ScoreExplanation.js";
import { renderHourlyForecast, wireHourlyForecast } from "../components/HourlyForecast.js";
import { renderPremiumLocks, wirePremiumLocks } from "../components/PremiumLock.js";
import { openSheet } from "../components/AppShell.js";
import { esc } from "../../../shared/utils.js";

export function renderForecastView(state) {
  const {
    weatherLoading,
    error,
    noCourse,
    days,
    selectedDateKey,
    dayScores,
    verdict,
    scoreResult,
    decision,
    teeTimes,
    selectedTeeTime,
    holes,
    windowHours,
    tzOffset,
    rainAnalysis,
    impactCards,
    betterTee,
    hourly = [],
    units = "metric",
    freshness = null,
    hourlyExpanded = false,
    roundSaved = false,
    teeAdjusted = null,
    isFavourite = false,
  } = state;

  if (noCourse) {
    return `
      <div class="fw-view fw-view-forecast">
        <div class="fw-empty-state">
          <i data-lucide="map-pin"></i>
          <h2>Select a course</h2>
          <p>Search for a golf course to see your personalised forecast and play verdict.</p>
          <button type="button" class="fw-btn fw-btn-primary" id="fwGoCourses">Find a course</button>
        </div>
      </div>`;
  }

  if (error && !verdict) {
    return `
      <div class="fw-view fw-view-forecast">
        <div class="fw-error-state" role="alert">
          <i data-lucide="cloud-off"></i>
          <h2>Forecast unavailable</h2>
          <p>${esc(error)}</p>
          <button type="button" class="fw-btn fw-btn-primary" id="fwRetryForecast">Try again</button>
        </div>
      </div>`;
  }

  const showSkeleton = weatherLoading && !verdict;
  const dayStripHtml = showSkeleton
    ? renderDayForecastStrip([], selectedDateKey, dayScores)
    : renderDayForecastStrip(days, selectedDateKey, dayScores);

  const heroHtml = showSkeleton
    ? renderVerdictHeroSkeleton()
    : renderGolfVerdictHero({
        score: verdict?.score ?? scoreResult?.score,
        status: verdict?.status ?? scoreResult?.status,
        label: verdict?.label ?? decision?.label,
        message: verdict?.message ?? decision?.message,
        verdict,
        decision,
      });

  const roundHtml = renderRoundSelector({
    teeTimes,
    selectedTeeTime,
    holes,
    windowHours,
    tzOffset,
    teeTimeUnix: selectedTeeTime,
  });

  const rainHtml = showSkeleton ? renderRainTimelineSkeleton() : renderRainTimeline(rainAnalysis);
  const impactHtml = showSkeleton ? renderWeatherImpactCards(null) : renderWeatherImpactCards(impactCards);
  const betterHtml = !showSkeleton && betterTee ? renderBestTeeTimeCard(betterTee) : "";
  const hourlyHtml = showSkeleton
    ? ""
    : renderHourlyForecast({ hourly, tzOffset, units, expanded: hourlyExpanded });

  return `
    <div class="fw-view fw-view-forecast" ${weatherLoading ? 'aria-busy="true"' : ""}>
      ${freshness ? `<p class="fw-freshness" role="status">${esc(freshness)}</p>` : ""}
      ${
        teeAdjusted
          ? `<p class="fw-tee-adjust ${teeAdjusted.material ? "is-material" : ""}" role="status">
              ${
                teeAdjusted.material
                  ? "Saved tee isn’t available that day — showing the nearest valid time."
                  : "Tee snapped to the nearest valid time on the same day."
              }
            </p>`
          : ""
      }
      <div id="fwDayStripMount">${dayStripHtml}</div>
      <div id="fwHeroMount">${heroHtml}</div>
      <div id="fwRoundMount">${roundHtml}</div>
      <div class="fw-forecast-actions">
        <button type="button" class="fw-btn fw-btn-primary" id="fwSaveRound" aria-live="polite">
          ${roundSaved ? "✓ Round saved" : "Save this round"}
        </button>
        <button type="button" class="fw-btn fw-btn-secondary" id="fwForecastFav" aria-pressed="${isFavourite ? "true" : "false"}">
          ${isFavourite ? "★ Favourited" : "☆ Favourite"}
        </button>
      </div>
      <div id="fwRainMount">${rainHtml}</div>
      <div id="fwImpactMount">${impactHtml}</div>
      <div id="fwBetterMount">${betterHtml}</div>
      <div id="fwHourlyMount">${hourlyHtml}</div>
      <div id="fwPremiumMount">${renderPremiumLocks()}</div>
    </div>`;
}

export function wireForecastView(container, handlers) {
  container?.querySelector("#fwGoCourses")?.addEventListener("click", () => handlers.onNavigate?.("courses"));
  container?.querySelector("#fwRetryForecast")?.addEventListener("click", () => handlers.onRetry?.());
  container?.querySelector("#fwSaveRound")?.addEventListener("click", () => handlers.onSaveRound?.());
  container?.querySelector("#fwForecastFav")?.addEventListener("click", () => handlers.onToggleFavourite?.());

  wireDayForecastStrip(container.querySelector("#fwDayStripMount"), handlers.onDaySelect);
  wireGolfVerdictHero(container.querySelector("#fwHeroMount"), () => {
    handlers.onWhyScore?.();
    openSheet(
      `Why ${handlers.getScore?.() ?? ""}?`,
      renderScoreExplanationBody({
        score: handlers.getScore?.(),
        factors: handlers.getFactors?.(),
        decision: handlers.getDecision?.(),
      })
    );
  });

  wireRoundSelector(container.querySelector("#fwRoundMount"), {
    onTeeTimeChange: handlers.onTeeTimeChange,
    onHolesChange: handlers.onHolesChange,
  });

  wireBestTeeTimeCard(container.querySelector("#fwBetterMount"), () => {
    const bt = handlers.getBetterTee?.();
    if (bt?.teeTime) handlers.onUseBetterTee?.(bt.teeTime) ?? handlers.onTeeTimeChange?.(bt.teeTime);
  });

  wireHourlyForecast(container.querySelector("#fwHourlyMount"), handlers.onHourlyExpand);
  wirePremiumLocks(container.querySelector("#fwPremiumMount"), (id) => handlers.onPremium?.(id));
}
