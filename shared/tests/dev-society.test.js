import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeGolfVerdict, getWindowData } from "../forecast-engine.js";
import { courseDayStartSec } from "../timezone.js";
import { generateSocietySlots } from "../../dev/js/society/societySlots.js";

function hour(dt, overrides = {}) {
  return {
    dt,
    temp: overrides.temp ?? 16,
    pop: overrides.pop ?? 0,
    rain_mm: overrides.rain_mm ?? 0,
    wind_speed: overrides.wind_speed ?? 3,
    wind_gust: overrides.wind_gust ?? 4,
    weather: overrides.weather ?? [{ id: 800, main: "Clear" }],
  };
}

describe("society tee slots", () => {
  it("scores groups with the forecast engine and ranks best against riskiest", () => {
    const first = courseDayStartSec(2027, 0, 15, 0) + 8 * 3600;
    const hourly = [
      hour(first, { pop: 0.05, rain_mm: 0, wind_speed: 2 }),
      hour(first + 3600, { pop: 0.95, rain_mm: 6, wind_speed: 10, weather: [{ id: 502 }] }),
    ];

    const norm = { hourly, timezoneOffset: 0, daily: [] };
    const result = generateSocietySlots({
      norm,
      dateKey: "2027-01-15",
      firstTee: "08:00",
      intervalMinutes: 60,
      groups: 2,
      playersPerGroup: 4,
      windowHours: 1,
      units: "metric",
      countryCode: "gb",
    });

    assert.equal(result.error, null);
    assert.equal(result.slots.length, 2);
    assert.equal(result.slots.every((slot) => slot.scored), true);

    const firstWindow = getWindowData(hourly, result.slots[0].teeTime, 1);
    const direct = computeGolfVerdict(firstWindow, hourly, result.slots[0].teeTime, 1, "metric", "gb", 0);
    assert.equal(result.slots[0].score, direct.score);
    assert.equal(result.slots[0].verdict, direct.verdict);

    assert.ok(result.best.score > result.riskiest.score);
    assert.equal(result.best.group, 1);
    assert.equal(result.riskiest.group, 2);
    assert.equal(result.slots[0].players, 4);
  });

  it("does not invent a score when the hourly window is empty", () => {
    const result = generateSocietySlots({
      norm: { hourly: [], timezoneOffset: 0 },
      dateKey: "2027-01-15",
      firstTee: "09:30",
      intervalMinutes: 10,
      groups: 3,
      windowHours: 4,
    });
    assert.equal(result.slots.length, 3);
    assert.equal(result.slots.every((slot) => slot.score == null && slot.scored === false), true);
    assert.equal(result.best, null);
    assert.equal(result.riskiest, null);
  });
});
