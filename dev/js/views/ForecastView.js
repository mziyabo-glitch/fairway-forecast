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
import { openSheet } from "../components/AppShell.js";
import { esc } from "../../../shared/utils.js";

export function renderForecastView(state) {
  const {
    loading,
    error,
    noCourse,
    days,
    selectedDateKey,
    dayScores,
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

  if (error) {
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

  const dayStripHtml = renderDayForecastStrip(days, selectedDateKey, dayScores);
  const heroHtml = loading
    ? renderVerdictHeroSkeleton()
    : renderGolfVerdictHero({
        score: scoreResult?.score,
        status: scoreResult?.status,
        label: decision?.label,
        message: decision?.message,
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

  const rainHtml = loading ? renderRainTimelineSkeleton() : renderRainTimeline(rainAnalysis);
  const impactHtml = loading ? renderWeatherImpactCards(null) : renderWeatherImpactCards(impactCards);
  const betterHtml = !loading && betterTee ? renderBestTeeTimeCard(betterTee) : "";

  return `
    <div class="fw-view fw-view-forecast" ${loading ? 'aria-busy="true"' : ""}>
      <div id="fwDayStripMount">${dayStripHtml}</div>
      <div id="fwHeroMount">${heroHtml}</div>
      <div id="fwRoundMount">${roundHtml}</div>
      <div id="fwRainMount">${rainHtml}</div>
      <div id="fwImpactMount">${impactHtml}</div>
      <div id="fwBetterMount">${betterHtml}</div>
    </div>`;
}

export function wireForecastView(container, handlers) {
  container?.querySelector("#fwGoCourses")?.addEventListener("click", () => handlers.onNavigate?.("courses"));
  container?.querySelector("#fwRetryForecast")?.addEventListener("click", () => handlers.onRetry?.());

  wireDayForecastStrip(container.querySelector("#fwDayStripMount"), handlers.onDaySelect);
  wireGolfVerdictHero(container.querySelector("#fwHeroMount"), () => {
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
    if (bt?.teeTime) handlers.onTeeTimeChange?.(bt.teeTime);
  });
}
