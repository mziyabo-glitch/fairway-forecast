/**
 * Assembles /dev-only forecast context. Each section is omitted when its flag is off.
 */

import { assessForecastConfidence } from "../confidence/forecastConfidence.js";
import { presentCourseStatus } from "../course-status/courseStatus.js";
import { assessGroundConditionRisk } from "../ground/groundCondition.js";
import { computePersonalFit } from "../preferences/golferPreferences.js";
import { evaluateSafetyOverrides } from "../safety/safetyOverrides.js";

function on(flags, key) {
  return flags?.[key] === true;
}

export function buildForecastDimensions({
  flags = {},
  verdict = null,
  preferences = null,
  nowUnix,
  teeTimeUnix,
  windowHours = 4,
  hourly = [],
  units = "metric",
  originalSnapshot = null,
  latestSnapshot = null,
  groundSignals = null,
  course = null,
  officialStatus = null,
  golferReport = null,
  nowMs = Date.now(),
} = {}) {
  const weatherScore = Number.isFinite(verdict?.score) ? verdict.score : null;
  const personalFit =
    on(flags, "golferPreferences") && verdict
      ? computePersonalFit({ metrics: verdict.metrics, preferences })
      : null;
  const confidence = on(flags, "forecastConfidence") && verdict
    ? assessForecastConfidence({
        nowUnix,
        teeTimeUnix,
        windowHours,
        hourly,
        originalSnapshot,
        latestSnapshot,
      })
    : null;
  const ground = on(flags, "groundConditionRisk")
    ? assessGroundConditionRisk({
        pastRain: groundSignals?.pastRain ?? null,
        freezing: groundSignals?.freezing ?? null,
        drying: groundSignals?.drying ?? null,
        course,
      })
    : null;
  const safety = on(flags, "safetyOverrides") && verdict
    ? evaluateSafetyOverrides({
        hourly,
        teeTimeUnix,
        windowHours,
        metrics: verdict.metrics,
        units,
      })
    : null;
  const courseStatus = on(flags, "courseStatus")
    ? presentCourseStatus({ course, official: officialStatus, report: golferReport, now: nowMs })
    : null;

  const safetyActive = Boolean(safety?.active);
  const hasPanel = Boolean(personalFit || confidence || ground || safetyActive || courseStatus);
  return {
    weatherScore,
    personalFit,
    confidence,
    ground,
    safety,
    courseStatus,
    scoreCaption: personalFit || safetyActive ? "Weather" : "",
    safetyActive,
    hasPanel,
  };
}
