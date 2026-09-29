import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { devFeatures } from "../../dev/js/config/devFeatures.js";
import {
  buildDaylightWindow,
  buildPracticePlan,
  estimatedDurationMins,
} from "../../dev/js/daylight/eveningPractice.js";
import { assessForecastConfidence } from "../../dev/js/confidence/forecastConfidence.js";
import {
  COURSE_STATUS_STALE_MS,
  buildGolferReport,
  buildOfficialStatus,
  isStaleTimestamp,
  presentCourseStatus,
} from "../../dev/js/course-status/courseStatus.js";
import { buildForecastDimensions } from "../../dev/js/dimensions/forecastDimensions.js";
import { assessGroundConditionRisk } from "../../dev/js/ground/groundCondition.js";
import { loadDevGroundSignals } from "../../dev/js/ground/groundRequest.js";
import {
  computePersonalFit,
  loadGolferPreferences,
  normalizeGolferPreferences,
  saveGolferPreferences,
} from "../../dev/js/preferences/golferPreferences.js";
import {
  SAFETY_LABEL,
  SAFETY_THRESHOLDS,
  evaluateSafetyOverrides,
  safetyVerdictDisplay,
} from "../../dev/js/safety/safetyOverrides.js";

const comfortable = {
  maxPrecipProb: 10,
  totalPrecipMm: 0,
  avgWind: 8,
  maxGust: 12,
  avgTemp: 16,
};

function hour(dt, overrides = {}) {
  return {
    dt,
    temp: 16,
    pop: 0.1,
    rain_mm: 0,
    wind_speed: 3,
    wind_gust: 4,
    weather: [{ id: 800, main: "Clear" }],
    ...overrides,
  };
}

describe("golfer preferences and personal fit", () => {
  it("keeps the new flags on without touching the weather score", () => {
    assert.equal(devFeatures.golferPreferences, true);
    assert.equal(devFeatures.forecastConfidence, true);
    assert.equal(devFeatures.groundConditionRisk, true);
    assert.equal(devFeatures.safetyOverrides, true);
    assert.equal(devFeatures.courseStatus, true);

    const verdict = { score: 88, metrics: { ...comfortable, maxPrecipProb: 40, totalPrecipMm: 1 } };
    const fit = computePersonalFit({
      metrics: verdict.metrics,
      preferences: { rainTolerance: "avoid" },
    });
    assert.equal(verdict.score, 88);
    assert.equal(fit.score, 75);
    assert.notEqual(fit.score, verdict.score);
  });

  it("scores a comfortable window at 100 and penalises rain, cold, and stricter styles", () => {
    assert.equal(computePersonalFit({ metrics: comfortable }).score, 100);

    const rainy = { ...comfortable, maxPrecipProb: 40, totalPrecipMm: 1 };
    const avoid = computePersonalFit({ metrics: rainy, preferences: { rainTolerance: "avoid" } });
    const light = computePersonalFit({ metrics: rainy, preferences: { rainTolerance: "light" } });
    assert.equal(avoid.score, 75);
    assert.equal(light.score, 100);
    assert.ok(avoid.score < light.score);

    assert.equal(computePersonalFit({ metrics: { ...comfortable, avgTemp: 2 } }).score, 82);
    assert.equal(computePersonalFit({ metrics: { ...comfortable, avgTemp: 8 } }).score, 100);
    assert.equal(computePersonalFit({ metrics: { ...comfortable, avgTemp: 26 } }).score, 100);

    const breezy = { ...comfortable, avgWind: 20, maxGust: 20 };
    const casual = computePersonalFit({
      metrics: breezy,
      preferences: { playStyle: "casual", transport: "buggy" },
    });
    const competition = computePersonalFit({
      metrics: breezy,
      preferences: { playStyle: "competition", transport: "buggy" },
    });
    assert.equal(casual.score, 92);
    assert.equal(competition.score, 90);

    const harsh = computePersonalFit({
      metrics: { maxPrecipProb: 100, totalPrecipMm: 20, avgWind: 40, maxGust: 60, avgTemp: 40 },
      preferences: {
        rainTolerance: "avoid",
        windTolerance: "low",
        maxComfortC: 26,
        transport: "walking",
        playStyle: "competition",
      },
    });
    assert.equal(harsh.score, 0);
  });

  it("falls back when stored preferences are unusable", () => {
    const normalized = normalizeGolferPreferences({
      rainTolerance: "monsoon",
      minComfortC: 40,
      maxComfortC: 5,
      paceMins: { 9: "nope", 18: 10 },
    });
    assert.equal(normalized.rainTolerance, "light");
    assert.equal(normalized.minComfortC, 5);
    assert.equal(normalized.maxComfortC, 40);
    assert.equal(normalized.paceMins[9], 140);
    assert.equal(normalized.paceMins[18], 20);

    const memory = new Map();
    globalThis.localStorage = {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => {
        memory.set(key, String(value));
      },
      removeItem: (key) => {
        memory.delete(key);
      },
    };
    const saved = saveGolferPreferences({ rainTolerance: "avoid", paceMins: { 9: 150 } });
    assert.equal(saved.rainTolerance, "avoid");
    assert.equal(loadGolferPreferences().paceMins[9], 150);
    assert.equal(loadGolferPreferences().paceMins[3], 60);

    globalThis.localStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    assert.doesNotThrow(() => loadGolferPreferences());
    assert.equal(loadGolferPreferences().rainTolerance, "light");
    assert.doesNotThrow(() => saveGolferPreferences({ rainTolerance: "any" }));
    delete globalThis.localStorage;
  });

  it("uses a saved pace and daylight margin without changing absent defaults", () => {
    assert.equal(estimatedDurationMins(3), 60);
    assert.equal(estimatedDurationMins(6), 105);
    assert.equal(estimatedDurationMins(9), 140);
    assert.equal(estimatedDurationMins(9, undefined), 140);
    assert.equal(estimatedDurationMins(9, { 9: 160 }), 160);

    const sunrise = Math.floor(Date.UTC(2026, 8, 29, 6, 0) / 1000);
    const sunset = Math.floor(Date.UTC(2026, 8, 29, 18, 0) / 1000);
    const daylight = buildDaylightWindow({
      date: "2026-09-29",
      timezone: "UTC",
      sunrise,
      sunset,
      source: "provider",
    });
    const now = Math.floor(Date.UTC(2026, 8, 29, 10, 0) / 1000);
    const hourly = [];
    for (let dt = sunrise; dt <= sunset; dt += 3600) hourly.push(hour(dt));

    const base = buildPracticePlan({ holes: 9, daylight, hourly, now, tzOffset: 0 });
    const paced = buildPracticePlan({
      holes: 9,
      daylight,
      hourly,
      now,
      tzOffset: 0,
      paceMins: { 9: 90 },
    });
    const sameMargin = buildPracticePlan({
      holes: 9,
      daylight,
      hourly,
      now,
      tzOffset: 0,
      daylightSafetyMarginMins: 15,
    });
    const widerMargin = buildPracticePlan({
      holes: 9,
      daylight,
      hourly,
      now,
      tzOffset: 0,
      daylightSafetyMarginMins: 60,
    });

    assert.equal(base.estimatedDurationMins, 140);
    assert.equal(paced.estimatedDurationMins, 90);
    assert.equal(paced.recommendedEnd - paced.recommendedStart, 90 * 60);
    assert.equal(sameMargin.latestSafeStart, base.latestSafeStart);
    assert.ok(widerMargin.latestSafeStart < base.latestSafeStart);
  });
});

describe("forecast confidence", () => {
  const tee = 1_800_000_000;
  const windowHours = 4;

  function covered(now) {
    return [0, 1, 2, 3].map((step) => hour(tee + step * 3600));
  }

  it("does not invent a second provider", () => {
    const result = assessForecastConfidence({
      nowUnix: tee - 2 * 3600,
      teeTimeUnix: tee,
      windowHours,
      hourly: covered(),
    });
    assert.equal(result.level, "high");
    assert.equal(result.providerAgreement, "not available");
    assert.equal(result.providers, undefined);
    assert.equal(result.rainTimingCompared, false);
    assert.doesNotMatch(result.summary, /provider|agree|move/i);
    assert.match(result.summary, /High confidence/);
  });

  it("lowers confidence for lead time, missing fields, and a one-hour rain shift", () => {
    const later = assessForecastConfidence({
      nowUnix: tee - 48 * 3600,
      teeTimeUnix: tee,
      windowHours,
      hourly: covered(),
    });
    assert.equal(later.level, "medium");
    assert.match(later.summary, /more than a day away/);

    const missing = assessForecastConfidence({
      nowUnix: tee - 2 * 3600,
      teeTimeUnix: tee,
      windowHours,
      hourly: [hour(tee, { temp: null }), hour(tee + 3600), hour(tee + 7200), hour(tee + 10800)],
    });
    assert.equal(missing.level, "medium");
    assert.match(missing.summary, /missing/);

    const empty = assessForecastConfidence({
      nowUnix: tee - 2 * 3600,
      teeTimeUnix: tee,
      windowHours,
      hourly: [],
    });
    assert.equal(empty.level, "low");

    const shifted = assessForecastConfidence({
      nowUnix: tee - 2 * 3600,
      teeTimeUnix: tee,
      windowHours,
      hourly: covered(),
      originalSnapshot: { rainStartUnix: tee, checkedAt: 1 },
      latestSnapshot: { rainStartUnix: tee + 3600, checkedAt: 2 },
    });
    assert.equal(shifted.level, "medium");
    assert.equal(shifted.rainTimingCompared, true);
    assert.equal(shifted.summary, "Medium confidence — rain timing may move by around one hour.");

    const single = assessForecastConfidence({
      nowUnix: tee - 2 * 3600,
      teeTimeUnix: tee,
      windowHours,
      hourly: covered(),
      originalSnapshot: { rainStartUnix: tee, checkedAt: 1 },
    });
    assert.equal(single.rainTimingCompared, false);
    assert.doesNotMatch(single.summary, /move|moved|differs/i);

    const unchanged = assessForecastConfidence({
      nowUnix: tee - 2 * 3600,
      teeTimeUnix: tee,
      windowHours,
      hourly: covered(),
      originalSnapshot: { rainStartUnix: tee, checkedAt: 1 },
      latestSnapshot: { rainStartUnix: tee, checkedAt: 2 },
    });
    assert.equal(unchanged.rainTimingCompared, true);
    assert.equal(unchanged.level, "high");
    assert.doesNotMatch(unchanged.summary, /move|moved/i);
  });
});

describe("ground-condition risk", () => {
  it("says we don't know when recent rain is missing", () => {
    const unknown = assessGroundConditionRisk({});
    assert.equal(unknown.level, "unknown");
    assert.match(unknown.summary, /we don't know/i);
    assert.doesNotMatch(unknown.summary, /soft ground or restrictions are possible/i);
    assert.doesNotMatch(unknown.summary, /the ground is/i);

    const namedOnly = assessGroundConditionRisk({ course: { name: "Wrag Barn", drainage: "poor" } });
    assert.equal(namedOnly.level, "unknown");
  });

  it("uses cautious wording for medium and high risk", () => {
    const wet = assessGroundConditionRisk({ pastRain: { h24: 20, h48: 30, h72: 40 } });
    assert.equal(wet.level, "high");
    assert.equal(wet.summary, "Soft ground or restrictions are possible.");
    assert.doesNotMatch(wet.summary, /the ground is soft|greens are closed|course is closed|waterlogged/i);

    const light = assessGroundConditionRisk({ pastRain: { h24: 0, h48: 0, h72: 0 } });
    assert.equal(light.level, "low");
    assert.match(light.summary, /does not confirm the ground is dry/i);

    const moderate = assessGroundConditionRisk({ pastRain: { h24: 5, h48: 5, h72: 5 } });
    const poor = assessGroundConditionRisk({
      pastRain: { h24: 5, h48: 5, h72: 5 },
      course: { drainage: "poor" },
    });
    const noTrait = assessGroundConditionRisk({
      pastRain: { h24: 5, h48: 5, h72: 5 },
      course: { name: "Club" },
    });
    assert.equal(moderate.level, "medium");
    assert.equal(poor.level, "high");
    assert.equal(noTrait.level, "medium");
    assert.equal(noTrait.factors.some((factor) => /drainage|elevation|exposure/.test(factor)), false);
  });

  it("does not fetch unless allowed, and a failed fetch stays unknown", async () => {
    let calls = 0;
    const skipped = await loadDevGroundSignals(
      { hourly: [{ dt: 2_000_000_000, temp: 12, rain_mm: null }] },
      {
        allowFetch: false,
        fetchImpl: async () => {
          calls += 1;
          return { ok: true, json: async () => ({}) };
        },
      }
    );
    assert.equal(calls, 0);
    assert.equal(skipped.pastRain, null);
    assert.equal(assessGroundConditionRisk(skipped).level, "unknown");

    const failed = await loadDevGroundSignals(
      { hourly: [] },
      {
        allowFetch: true,
        lat: 51.6,
        lon: -1.7,
        fetchImpl: async () => {
          throw new Error("offline");
        },
      }
    );
    assert.equal(failed.source, "unavailable");
    assert.equal(failed.pastRain, null);
    assert.equal(assessGroundConditionRisk(failed).level, "unknown");
    assert.match(assessGroundConditionRisk(failed).summary, /we don't know/i);
  });
});

describe("safety overrides", () => {
  const verdict = {
    score: 82,
    label: "Good — solid golf weather",
    metrics: { maxGust: 10, avgTemp: 18, minTemp: 16 },
  };

  it("keeps published thresholds and leaves the weather score unchanged", () => {
    assert.equal(SAFETY_THRESHOLDS.dangerousGustMph, 45);
    assert.equal(SAFETY_THRESHOLDS.extremeHeatC, 35);
    assert.equal(SAFETY_THRESHOLDS.extremeColdC, -5);
    assert.equal(SAFETY_THRESHOLDS.denseFogVisibilityM, 200);

    const calm = evaluateSafetyOverrides({
      metrics: verdict.metrics,
      windowData: [{ temp: 18, wind_gust: 4, weather: [{ id: 800 }] }],
    });
    assert.equal(calm.active, false);
    const calmDisplay = safetyVerdictDisplay(verdict, calm);
    assert.equal(calmDisplay.weatherScore, 82);
    assert.equal(calmDisplay.label, verdict.label);
    assert.equal(verdict.score, 82);

    const thunder = evaluateSafetyOverrides({
      windowData: [{ weather: [{ id: 211, main: "Thunderstorm" }] }],
      metrics: {},
    });
    assert.equal(thunder.active, true);
    assert.equal(thunder.label, SAFETY_LABEL);
    const shown = safetyVerdictDisplay(verdict, thunder);
    assert.equal(shown.label, "Safety risk");
    assert.equal(shown.weatherScore, 82);
    assert.equal(verdict.score, 82);

    assert.equal(evaluateSafetyOverrides({ metrics: { maxGust: 44 } }).active, false);
    assert.equal(evaluateSafetyOverrides({ metrics: { maxGust: 45 } }).active, true);
    assert.equal(evaluateSafetyOverrides({ metrics: { avgTemp: 34 } }).active, false);
    assert.equal(evaluateSafetyOverrides({ metrics: { avgTemp: 35 } }).active, true);
    assert.equal(evaluateSafetyOverrides({ metrics: { minTemp: -4 } }).active, false);
    assert.equal(evaluateSafetyOverrides({ metrics: { minTemp: -5 } }).active, true);
    assert.equal(evaluateSafetyOverrides({ windowData: [{ weather: [{ id: 511 }] }] }).active, true);
    assert.equal(evaluateSafetyOverrides({ windowData: [{ weather: [{ id: 800 }] }] }).active, false);
    assert.equal(evaluateSafetyOverrides({ windowData: [{ visibility: 100, weather: [{ id: 800 }] }] }).active, true);
    assert.equal(
      evaluateSafetyOverrides({ windowData: [{ visibility: 5000, weather: [{ id: 800 }] }] }).active,
      false
    );
    assert.equal(evaluateSafetyOverrides({ windowData: [{ weather: [{ id: 741 }] }] }).active, true);
    assert.equal(evaluateSafetyOverrides({ windowData: [{ weather: [{ id: 701 }] }] }).active, false);
  });
});

describe("course status", () => {
  const now = Date.UTC(2026, 8, 29, 12, 0, 0);

  it("labels stale reports and does not claim an unofficial status", () => {
    assert.equal(isStaleTimestamp(now - COURSE_STATUS_STALE_MS, now), false);
    assert.equal(isStaleTimestamp(now - COURSE_STATUS_STALE_MS - 1, now), true);

    const unknown = presentCourseStatus({ course: { name: "Wrag Barn" }, now });
    assert.equal(unknown.kind, "unknown");
    assert.equal(unknown.claimsOfficial, false);
    assert.match(unknown.officialSummary, /unknown/i);
    assert.doesNotMatch(unknown.officialSummary, /official status: (open|closed|restricted)/i);

    const linked = presentCourseStatus({
      course: { officialStatusUrl: "https://example.com/status" },
      now,
    });
    assert.equal(linked.url, "https://example.com/status");
    assert.equal(linked.claimsOfficial, false);
    assert.match(linked.officialSummary, /no verified status/i);

    const fresh = presentCourseStatus({
      official: buildOfficialStatus({
        status: "closed",
        timestamp: now - 60 * 1000,
        closure: "Closed for maintenance",
        buggyRestriction: "No buggies",
      }),
      now,
    });
    assert.equal(fresh.kind, "official");
    assert.equal(fresh.claimsOfficial, true);
    assert.match(fresh.officialSummary, /Official status: closed/);
    assert.match(fresh.officialSummary, /Closed for maintenance/);
    assert.match(fresh.officialSummary, /No buggies/);

    const staleOfficial = presentCourseStatus({
      official: buildOfficialStatus({
        status: "closed",
        timestamp: now - 13 * 60 * 60 * 1000,
        buggyRestriction: "No buggies",
      }),
      now,
    });
    assert.equal(staleOfficial.claimsOfficial, false);
    assert.equal(staleOfficial.stale, true);
    assert.match(staleOfficial.officialSummary, /stale/i);
    assert.doesNotMatch(staleOfficial.officialSummary, /closed|buggy|No buggies/i);

    const staleReport = presentCourseStatus({
      report: buildGolferReport({
        note: "Greens felt soft",
        timestamp: now - 13 * 60 * 60 * 1000,
      }),
      now,
    });
    assert.equal(staleReport.kind, "community");
    assert.equal(staleReport.communityState, "stale");
    assert.match(staleReport.communitySummary, /stale/i);
    assert.match(staleReport.communitySummary, /not current/i);
    assert.doesNotMatch(staleReport.communitySummary, /Greens felt soft/);
    assert.equal(staleReport.claimsOfficial, false);

    const freshReport = presentCourseStatus({
      report: buildGolferReport({ note: "Greens felt soft", timestamp: now - 60 * 60 * 1000 }),
      now,
    });
    assert.equal(freshReport.communityState, "unverified");
    assert.match(freshReport.communitySummary, /Unverified golfer report/);
    assert.doesNotMatch(freshReport.communitySummary, /stale/i);
    assert.equal(freshReport.claimsOfficial, false);
  });
});

describe("feature flags hide the new sections", () => {
  it("returns no panel and does not score when every flag is off", () => {
    const verdict = { score: 80, label: "Good", metrics: comfortable };
    const hidden = buildForecastDimensions({
      flags: {
        golferPreferences: false,
        forecastConfidence: false,
        groundConditionRisk: false,
        safetyOverrides: false,
        courseStatus: false,
      },
      verdict,
      hourly: [{ dt: 10, weather: [{ id: 211 }] }],
      teeTimeUnix: 10,
      windowHours: 1,
      groundSignals: { pastRain: { h24: 30, h48: 30, h72: 30 } },
      officialStatus: buildOfficialStatus({ status: "closed", timestamp: Date.now() }),
    });
    assert.equal(hidden.personalFit, null);
    assert.equal(hidden.confidence, null);
    assert.equal(hidden.ground, null);
    assert.equal(hidden.safety, null);
    assert.equal(hidden.courseStatus, null);
    assert.equal(hidden.hasPanel, false);
    assert.equal(hidden.safetyActive, false);
    assert.equal(hidden.weatherScore, 80);
    assert.equal(verdict.score, 80);
  });
});
