import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeGolfVerdict, getWindowData } from "../forecast-engine.js";
import { devFeatures } from "../../dev/js/config/devFeatures.js";
import {
  LAST_PLAYABLE_LEAD_MIN,
  PRACTICE_DURATION_RANGES,
  buildDaylightWindow,
  buildPracticePlan,
  estimatedDurationMins,
  formatCourseTime,
  needsDevDaylightFetch,
  parseOpenMeteoDaylight,
  providerDaylightSeries,
  zonedLocalToUnix,
} from "../../dev/js/daylight/eveningPractice.js";

function point(dt, overrides = {}) {
  return {
    dt,
    temp: 16,
    pop: 0,
    rain_mm: 0,
    wind_speed: 1,
    wind_gust: 1,
    weather: [{ id: 800, main: "Clear" }],
    ...overrides,
  };
}

function londonDay() {
  const sunrise = Math.floor(Date.UTC(2026, 8, 29, 6, 0) / 1000);
  const sunset = Math.floor(Date.UTC(2026, 8, 29, 18, 0) / 1000);
  const daylight = buildDaylightWindow({
    date: "2026-09-29",
    timezone: "UTC",
    sunrise,
    sunset,
    source: "provider",
  });
  return { sunrise, sunset, daylight };
}

describe("evening practice window", () => {
  it("keeps the evening practice flag on and sponsored flags off", () => {
    assert.equal(devFeatures.eveningPractice, true);
    assert.equal(devFeatures.affiliateCards, false);
    assert.equal(devFeatures.adsenseSlot, false);
    assert.deepEqual(PRACTICE_DURATION_RANGES[3], { min: 45, max: 60 });
    assert.deepEqual(PRACTICE_DURATION_RANGES[6], { min: 90, max: 105 });
    assert.deepEqual(PRACTICE_DURATION_RANGES[9], { min: 120, max: 140 });
    assert.equal(estimatedDurationMins(9), 140);
  });

  it("recommends a start that finishes by last playable light", () => {
    const { daylight } = londonDay();
    const last = daylight.lastPlayableLight;
    assert.equal(last, daylight.sunset - LAST_PLAYABLE_LEAD_MIN * 60);

    const hourly = [];
    for (let dt = daylight.sunrise; dt <= daylight.sunset + 2 * 3600; dt += 15 * 60) {
      const after = dt >= last;
      hourly.push(
        point(dt, after
          ? { pop: 0, rain_mm: 0, wind_speed: 1, wind_gust: 1, weather: [{ id: 800 }] }
          : { pop: 0.8, rain_mm: 2, wind_speed: 12, wind_gust: 16, weather: [{ id: 500 }] })
      );
    }

    const now = Math.floor(Date.UTC(2026, 8, 29, 14, 0) / 1000);
    const plan = buildPracticePlan({
      holes: 9,
      daylight,
      hourly,
      now,
      units: "metric",
      countryCode: "gb",
      tzOffset: 0,
    });

    assert.notEqual(plan.daylightStatus, "insufficient");
    assert.equal(plan.estimatedDurationMins, 140);
    assert.ok(plan.recommendedStart != null);
    assert.equal(plan.recommendedEnd, plan.recommendedStart + 140 * 60);
    assert.ok(plan.recommendedEnd <= daylight.lastPlayableLight);
    assert.ok(plan.recommendedStart <= plan.latestSafeStart);

    const windowHours = plan.estimatedDurationMins / 60;
    const windowData = getWindowData(hourly, plan.recommendedStart, windowHours);
    const verdict = computeGolfVerdict(
      windowData,
      hourly,
      plan.recommendedStart,
      windowHours,
      "metric",
      "gb",
      0
    );
    assert.equal(plan.golfScore, verdict.score);
    assert.ok(plan.summary.includes(verdict.message));
    assert.match(plan.summary, /rain|wind/i);

    const dryHourly = hourly.map((hour) =>
      point(hour.dt, { pop: 0, rain_mm: 0, wind_speed: 1, wind_gust: 1 })
    );
    const dry = buildPracticePlan({
      holes: 9,
      daylight,
      hourly: dryHourly,
      now,
      units: "metric",
      countryCode: "gb",
      tzOffset: 0,
    });
    assert.ok(dry.recommendedEnd <= daylight.lastPlayableLight);
    assert.ok(dry.golfScore > plan.golfScore);
  });

  it("says it is too late and points at the next evening", () => {
    const { daylight } = londonDay();
    const nextSunrise = Math.floor(Date.UTC(2026, 8, 30, 6, 0) / 1000);
    const next = buildDaylightWindow({
      date: "2026-09-30",
      timezone: "UTC",
      sunrise: nextSunrise,
      sunset: nextSunrise + 12 * 3600,
      source: "open-meteo",
    });
    const now = daylight.lastPlayableLight - 10 * 60;
    const plan = buildPracticePlan({
      holes: 3,
      daylight,
      upcoming: [daylight, next],
      hourly: [],
      now,
      tzOffset: 0,
    });

    assert.equal(plan.holes, 3);
    assert.equal(plan.estimatedDurationMins, 60);
    assert.equal(plan.daylightStatus, "insufficient");
    assert.equal(plan.recommendedStart, null);
    assert.equal(plan.recommendedEnd, null);
    assert.equal(plan.golfScore, null);
    assert.match(plan.summary, /too late/i);
    assert.match(plan.summary, /30/);
    assert.match(plan.summary, /sep/i);
  });

  it("marks a short remaining gap as tight and still finishes in time", () => {
    const { daylight } = londonDay();
    const now = daylight.lastPlayableLight - 70 * 60;
    const plan = buildPracticePlan({
      holes: 3,
      daylight,
      hourly: [point(now, { temp: 15 })],
      now,
      tzOffset: 0,
    });
    assert.equal(plan.daylightStatus, "tight");
    assert.ok(plan.recommendedEnd <= daylight.lastPlayableLight);
    assert.match(plan.summary, /tight/i);
  });

  it("formats course time across daylight saving", () => {
    const winterNoon = zonedLocalToUnix(2026, 1, 15, 12, 0, "Europe/London");
    const summerNoon = zonedLocalToUnix(2026, 6, 21, 12, 0, "Europe/London");
    assert.equal(formatCourseTime(winterNoon, { timeZone: "Europe/London" }), "12:00");
    assert.equal(formatCourseTime(summerNoon, { timeZone: "Europe/London" }), "12:00");
    assert.equal(winterNoon, Math.floor(Date.UTC(2026, 0, 15, 12, 0) / 1000));
    assert.equal(summerNoon, Math.floor(Date.UTC(2026, 5, 21, 11, 0) / 1000));

    const parsed = parseOpenMeteoDaylight({
      timezone: "Europe/London",
      daily: {
        time: ["2026-06-21", "2026-01-15"],
        sunrise: ["2026-06-21T04:43", "2026-01-15T08:05"],
        sunset: ["2026-06-21T21:21", "2026-01-15T16:15"],
      },
    });
    assert.equal(formatCourseTime(parsed[0].sunset, { timeZone: "Europe/London" }), "21:21");
    assert.equal(formatCourseTime(parsed[1].sunset, { timeZone: "Europe/London" }), "16:15");
    assert.equal(parsed[0].lastPlayableLight, parsed[0].sunset - LAST_PLAYABLE_LEAD_MIN * 60);
    assert.equal(parsed[0].source, "open-meteo");
    assert.equal("civilTwilightEnd" in parsed[0], false);

    const withTwilight = buildDaylightWindow({
      date: "2026-06-21",
      timezone: "Europe/London",
      sunrise: 1_000,
      sunset: 10_000,
      civilTwilightEnd: 12_000,
      source: "open-meteo",
    });
    assert.equal(withTwilight.civilTwilightEnd, 12_000);
    assert.equal(withTwilight.lastPlayableLight, 10_000 - LAST_PLAYABLE_LEAD_MIN * 60);
  });

  it("does not treat shifted copies of today's sunset as a daily series", () => {
    const sunrise = 1_790_661_446;
    const sunset = 1_790_703_851;
    const norm = {
      sunrise,
      sunset,
      timezoneOffset: 3600,
      timezone: 3600,
      hourly: [{ dt: sunrise + 86400 }],
      daily: [
        { dt: sunrise, sunrise, sunset },
        { dt: sunrise + 86400, sunrise: sunrise + 86400, sunset: sunset + 86400 },
      ],
    };
    const series = providerDaylightSeries(norm);
    const today = series.find((day) => day.source === "provider");
    const later = series.find((day) => day.source === "estimate");
    assert.ok(today);
    assert.equal(today.sunrise, sunrise);
    assert.equal(today.sunset, sunset);
    assert.ok(later);
    assert.equal(needsDevDaylightFetch(norm), true);
  });
});
