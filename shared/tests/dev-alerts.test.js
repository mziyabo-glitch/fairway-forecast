import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALERT_TYPES, compareRoundWeather, suppressDuplicateAlerts } from "../../dev/js/alerts/compareRoundWeather.js";
import { createNotificationAdapter } from "../../dev/js/alerts/notificationAdapter.js";

const base = {
  score: 82,
  rainProbability: 10,
  rainMm: 0,
  wind: 8,
  gust: 12,
  tempC: 16,
  rainStartUnix: 1_800_000_000,
};

describe("compareRoundWeather", () => {
  it("flags rain added to a dry round", () => {
    const alerts = compareRoundWeather(base, { ...base, rainProbability: 55, rainMm: 1.2 }, { roundId: "r1" });
    assert.equal(alerts.some((a) => a.type === ALERT_TYPES.RAIN_ADDED), true);
  });

  it("flags rain that starts earlier", () => {
    const alerts = compareRoundWeather(
      base,
      { ...base, rainStartUnix: base.rainStartUnix - 45 * 60, rainProbability: 40, rainMm: 0.4 },
      { roundId: "r1" }
    );
    assert.equal(alerts.some((a) => a.type === ALERT_TYPES.RAIN_EARLIER), true);
  });

  it("flags a score drop", () => {
    const alerts = compareRoundWeather(base, { ...base, score: 70 }, { roundId: "r1" });
    assert.equal(alerts.some((a) => a.type === ALERT_TYPES.SCORE_DROP), true);
    assert.match(alerts.find((a) => a.type === ALERT_TYPES.SCORE_DROP).detail, /82/);
  });

  it("flags a wind increase", () => {
    const alerts = compareRoundWeather(base, { ...base, wind: 18, gust: 24 }, { roundId: "r1" });
    assert.equal(alerts.some((a) => a.type === ALERT_TYPES.WIND_INCREASE), true);
  });

  it("flags temperature risk", () => {
    const alerts = compareRoundWeather(base, { ...base, tempC: 2 }, { roundId: "r1" });
    assert.equal(alerts.some((a) => a.type === ALERT_TYPES.TEMPERATURE_RISK), true);
  });

  it("flags a better tee time supplied by the forecast engine", () => {
    const alerts = compareRoundWeather(base, base, {
      roundId: "r1",
      betterTee: { label: "10:30", teeTime: 123, improvement: 14 },
    });
    assert.equal(alerts.some((a) => a.type === ALERT_TYPES.BETTER_TEE_TIME), true);
  });

  it("returns nothing when the forecast is unchanged", () => {
    assert.deepEqual(compareRoundWeather(base, { ...base }, { roundId: "r1" }), []);
  });

  it("suppresses duplicate fingerprints", () => {
    const alerts = compareRoundWeather(base, { ...base, score: 60 }, { roundId: "r1" });
    const doubled = [...alerts, ...alerts];
    const once = suppressDuplicateAlerts(doubled, []);
    assert.equal(once.length, alerts.length);
    const again = suppressDuplicateAlerts(alerts, once.map((a) => a.fingerprint));
    assert.equal(again.length, 0);
  });
});

describe("notification adapter", () => {
  it("keeps delivery disabled and in-app only", () => {
    const adapter = createNotificationAdapter({ mode: "push" });
    assert.equal(adapter.mode, "in_app_only");
    assert.equal(adapter.deliveryEnabled, false);
    assert.equal(adapter.deliver({ type: "score_drop" }).delivered, false);
  });
});
