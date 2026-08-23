import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatForecastFreshness,
  weatherCacheKey,
  getWeatherMeta,
} from "../weather-service.js";

describe("weather-service cache helpers", () => {
  it("keys weather by units and rounded coords", () => {
    assert.equal(weatherCacheKey(51.617449, -1.706551, "metric"), weatherCacheKey(51.61745, -1.70655, "metric"));
    assert.notEqual(weatherCacheKey(51.61, -1.7, "metric"), weatherCacheKey(51.61, -1.7, "imperial"));
  });

  it("labels stale snapshots as offline, never as current", () => {
    assert.equal(formatForecastFreshness(null), null);
    assert.equal(formatForecastFreshness({ stale: false, offline: false, fetchedAt: Date.now() }), null);
    assert.equal(formatForecastFreshness({ stale: true, offline: true }), "Offline forecast");
    const labeled = formatForecastFreshness({
      stale: true,
      offline: true,
      fetchedAt: Date.parse("2026-08-23T14:05:00Z"),
    });
    assert.match(labeled, /Offline forecast/);
    assert.match(labeled, /Last updated \d{2}:\d{2}/);
  });

  it("reads attached meta without inventing a live fetch", () => {
    const raw = { _fwMeta: { fromCache: true, stale: true, offline: true, fetchedAt: 1 } };
    assert.deepEqual(getWeatherMeta(raw), raw._fwMeta);
  });
});
