import { renderDayForecastStrip, wireDayForecastStrip } from "../components/DayForecastStrip.js";
import {
  renderGolfVerdictHero,
  renderVerdictHeroSkeleton,
  wireGolfVerdictHero,
} from "../components/GolfVerdictHero.js?v=20261005-round-flow";
import { renderRoundSelector, wireRoundSelector } from "../components/RoundSelector.js?v=20261005-round-flow";
import { renderRainTimeline, renderRainTimelineSkeleton } from "../components/RainTimeline.js";
import { renderWeatherImpactCards } from "../components/WeatherImpactCard.js";
import {
  renderBestTeeTimeCard,
  renderScoreExplanationBody,
  wireBestTeeTimeCard,
} from "../components/ScoreExplanation.js";
import { renderHourlyForecast, wireHourlyForecast } from "../components/HourlyForecast.js";
import { renderPremiumLocks, wirePremiumLocks } from "../components/PremiumLock.js?v=20261005-owner-google";
import { openSheet } from "../components/AppShell.js?v=20261005-round-flow";
import { esc, fmtTimeCourse } from "../../../shared/utils.js";
import { wireEveningPractice } from "../components/EveningPractice.js";

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
    weatherIcon = "🌤️",
    showSaveRound = true,
    roundLimitNote = "",
    extendedOutlookHtml = "",
    radarHtml = "",
    sponsoredHtml = "",
    eveningHtml = "",
    dimensionsHtml = "",
    scoreCaption = "",
    safetyActive = false,
    premiumHtml = renderPremiumLocks(),
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

  if (!weatherLoading && (error || !days?.length) && !verdict) {
    return `
      <div class="fw-view fw-view-forecast">
        <div class="fw-error-state" role="alert">
          <i data-lucide="cloud-off"></i>
          <h2>Forecast unavailable</h2>
          <p>${esc(error || "No forecast data is available for this course right now.")}</p>
          <button type="button" class="fw-btn fw-btn-primary" id="fwRetryForecast">Try again</button>
        </div>
      </div>`;
  }

  const showSkeleton = Boolean(weatherLoading);
  const dayStripHtml = showSkeleton
    ? renderDayForecastStrip([], selectedDateKey, dayScores)
    : renderDayForecastStrip(days, selectedDateKey, dayScores);

  const selectedDay = days?.find(day => day.dateKey === selectedDateKey);
  const roundSummary = selectedTeeTime
    ? `${selectedDay?.dateLabel || selectedDateKey} · ${fmtTimeCourse(selectedTeeTime, tzOffset)}–${fmtTimeCourse(selectedTeeTime + windowHours * 3600, tzOffset)} · ${holes} holes · Course local time`
    : "";
  const heroHtml = showSkeleton
    ? renderVerdictHeroSkeleton()
    : !verdict
    ? `<section class="fw-round-unavailable" role="status">
        <h2 class="fw-section-title">No round verdict available</h2>
        <p>There is not enough forecast data for this round. Try another day, tee time or round length.</p>
        <button type="button" class="fw-btn fw-btn-secondary" id="fwRetryForecast">Refresh forecast</button>
      </section>`
    : renderGolfVerdictHero({
        score: verdict?.score ?? scoreResult?.score,
        status: verdict?.status ?? scoreResult?.status,
        label: verdict?.label ?? decision?.label,
        message: verdict?.message ?? decision?.message,
        verdict,
        decision,
        weatherIcon,
        scoreCaption,
        safetyActive,
        roundSummary,
      });

  const roundHtml = renderRoundSelector({
    teeTimes,
    selectedTeeTime,
    holes,
    windowHours,
    tzOffset,
    teeTimeUnix: selectedTeeTime,
    loading: showSkeleton,
  });

  const rainHtml = showSkeleton ? renderRainTimelineSkeleton() : verdict ? renderRainTimeline(rainAnalysis) : "";
  const impactHtml = showSkeleton
    ? renderWeatherImpactCards(null)
    : verdict ? renderWeatherImpactCards(impactCards, verdict?.metrics) : "";
  const betterHtml = !showSkeleton && verdict && betterTee ? renderBestTeeTimeCard(betterTee) : "";
  const hourlyHtml = showSkeleton
    ? ""
    : renderHourlyForecast({ hourly, tzOffset, units, expanded: hourlyExpanded });

  return `
    <div class="fw-view fw-view-forecast fw-forecast-column" ${weatherLoading ? 'aria-busy="true"' : ""}>
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
      <section class="fw-round-setup" aria-label="Plan your round">
        <h2 class="fw-section-title">Plan your round</h2>
        <p class="fw-planning-intro">Set your date, tee time and round length.</p>
        <h3 class="fw-round-date-label">Date</h3>
        <div id="fwDayStripMount">${dayStripHtml}</div>
        <div id="fwRoundMount">${roundHtml}</div>
      </section>
      <div class="fw-verdict-stack">
        <div id="fwHeroMount">${heroHtml}</div>
        ${
          showSkeleton || !verdict
            ? ""
            : `<button type="button" class="fw-btn fw-btn-secondary fw-shot-plan" id="fwPlanShot">Explore Caddies · Premium</button>`
        }
      </div>
      ${dimensionsHtml ? `<div id="fwDimensionsMount">${dimensionsHtml}</div>` : ""}
      <div id="fwBetterMount">${betterHtml}</div>
      ${
        showSaveRound
          ? `<div class="fw-forecast-save-row">
        <button type="button" class="fw-btn fw-btn-ghost" id="fwSaveRound" aria-live="polite" ${showSkeleton || !verdict ? "disabled" : ""}>
          ${roundSaved ? "✓ Round saved" : "Save this round"}
        </button>
        ${roundLimitNote ? `<p class="fw-muted">${esc(roundLimitNote)}</p>` : ""}
      </div>`
          : ""
      }
      <div id="fwRainMount">${rainHtml}</div>
      <div id="fwImpactMount">${impactHtml}</div>
      ${eveningHtml ? `<div id="fwEveningMount">${eveningHtml}</div>` : ""}
      <div id="fwHourlyMount">${hourlyHtml}</div>
      ${premiumHtml ? `<div id="fwPremiumMount">${premiumHtml}</div>` : ""}
      ${extendedOutlookHtml ? `<div id="fwExtendedOutlookMount">${extendedOutlookHtml}</div>` : ""}
      ${radarHtml ? `<div id="fwRadarMount">${radarHtml}</div>` : ""}
      ${sponsoredHtml ? `<div id="fwSponsoredMount">${sponsoredHtml}</div>` : ""}
    </div>`;
}

export function wireForecastView(container, handlers) {
  container?.querySelector("#fwGoCourses")?.addEventListener("click", () => handlers.onNavigate?.("courses"));
  container?.querySelector("#fwRetryForecast")?.addEventListener("click", () => handlers.onRetry?.());
  container?.querySelector("#fwSaveRound")?.addEventListener("click", () => handlers.onSaveRound?.());
  container?.querySelector("#fwPlanShot")?.addEventListener("click", () => handlers.onPlanShot?.());

  wireDayForecastStrip(container.querySelector("#fwDayStripMount"), handlers.onDaySelect);
  wireGolfVerdictHero(container.querySelector("#fwHeroMount"), () => {
    handlers.onWhyScore?.();
    openSheet(
      `Why ${handlers.getScore?.() ?? ""}?`,
      renderScoreExplanationBody({
        score: handlers.getScore?.(),
        factors: handlers.getFactors?.(),
        decision: handlers.getDecision?.(),
        verdict: handlers.getVerdict?.(),
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

  wireEveningPractice(container.querySelector("#fwEveningMount"), handlers.onPracticeHoles);
  wireHourlyForecast(container.querySelector("#fwHourlyMount"), handlers.onHourlyExpand);
  wirePremiumLocks(container.querySelector("#fwPremiumMount"), (id) => handlers.onPremium?.(id));
}
