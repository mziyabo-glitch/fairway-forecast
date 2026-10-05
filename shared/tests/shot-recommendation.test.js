import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { recommendShot, shotConditionsFromForecast } from "../shot-recommendation.js";
import { DEFAULT_SHOT_CLUBS } from "../shot-clubs.js";
import { noteShotCaddieOpened, trackShotCaddieEvent, ShotCaddieEvents, SHOT_COUNT_KEY } from "../shot-caddie-analytics.js";

const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const mockStore = () => {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, value) };
};

describe("Shot Caddie recommendation", () => {
  it("165 yards, 12 mph headwind, and soft ground plays longer and clubs up", () => {
    const calm = recommendShot({
      target: 165,
      units: "yd",
      windOnShot: "cross",
      windMph: 12,
      ground: "normal",
      rain: "dry",
      clubs: DEFAULT_SHOT_CLUBS,
    });
    const shot = recommendShot({
      target: 165,
      units: "yd",
      windOnShot: "head",
      windMph: 12,
      ground: "soft",
      rain: "dry",
      clubs: DEFAULT_SHOT_CLUBS,
    });
    assert.equal(calm.club.name, "6 Iron");
    assert.ok(shot.playsLikeYards > 165);
    assert.ok(shot.club.carryYards > calm.club.carryYards);
    assert.equal(shot.club.name, "5 Iron");
    assert.equal(shot.clubSteps, 1);
    assert.equal(shot.clubLabel, "Club up 1");
  });

  it("tailwind shortens the playing distance", () => {
    const shot = recommendShot({
      target: 165,
      units: "yd",
      windOnShot: "tail",
      windMph: 12,
      ground: "normal",
      rain: "dry",
      clubs: DEFAULT_SHOT_CLUBS,
    });
    assert.ok(shot.playsLikeYards < 165);
    const stronger = recommendShot({
      target: 165,
      units: "yd",
      windOnShot: "tail",
      windMph: 30,
      ground: "normal",
      rain: "dry",
      clubs: DEFAULT_SHOT_CLUBS,
    });
    assert.ok(stronger.club.carryYards < shot.calmClub.carryYards);
    assert.match(stronger.clubLabel, /^Club down /);
  });

  it("treats crosswind as no distance change and light rain as a small add", () => {
    const cross = recommendShot({ target: 165, windOnShot: "cross", windMph: 12, ground: "normal", rain: "dry" });
    const light = recommendShot({ target: 165, windOnShot: "cross", windMph: 12, ground: "normal", rain: "light" });
    const firm = recommendShot({ target: 165, windOnShot: "cross", windMph: 0, ground: "firm", rain: "dry" });
    const verySoft = recommendShot({ target: 165, windOnShot: "cross", windMph: 0, ground: "very_soft", rain: "dry" });
    assert.equal(cross.playsLikeYards, 165);
    assert.equal(cross.clubLabel, "Normal club");
    assert.ok(light.playsLikeYards > cross.playsLikeYards);
    assert.ok(firm.playsLikeYards < 165);
    assert.ok(verySoft.playsLikeYards > 165);
  });

  it("does not throw when weather is missing", () => {
    assert.doesNotThrow(() => recommendShot());
    assert.doesNotThrow(() => recommendShot(null));
    assert.doesNotThrow(() => shotConditionsFromForecast());
    assert.doesNotThrow(() => shotConditionsFromForecast(null));
    const shot = recommendShot({ target: 165, windOnShot: "head", windMph: null, rain: null, ground: null });
    assert.equal(shot.ok, true);
    assert.equal(shot.usedWind, false);
    assert.equal(shot.playsLikeYards, 165);
    assert.equal(shotConditionsFromForecast(null).hasWeather, false);
    assert.equal(shotConditionsFromForecast({}).windMph, null);
  });

  it("reads real forecast wind and an already computed rain label", () => {
    const conditions = shotConditionsFromForecast({
      loaded: true,
      units: "metric",
      teeTimeUnix: 1_700_000_000,
      hourly: [{ dt: 1_700_000_000, wind_speed: 5.36, wind_deg: 225, rain_mm: 1 }],
      rainAnalysis: {
        hours: [{ dt: 1_700_000_000, intensity: { key: "light", label: "Light rain" } }],
      },
    });
    assert.equal(conditions.hasWeather, true);
    assert.equal(conditions.windKnown, true);
    assert.equal(conditions.windMph, 12);
    assert.equal(conditions.windCardinal, "SW");
    assert.equal(conditions.rainLabel, "Light");
    assert.equal(conditions.windMph === 0, false);
  });
});

describe("Shot Caddie analytics", () => {
  it("counts opens locally and marks a later open as repeat use", () => {
    const store = mockStore();
    const events = [];
    const track = (event) => events.push(event);
    noteShotCaddieOpened({ track, store });
    assert.deepEqual(events, [ShotCaddieEvents.OPENED]);
    noteShotCaddieOpened({ track, store });
    assert.deepEqual(events, [ShotCaddieEvents.OPENED, ShotCaddieEvents.OPENED, ShotCaddieEvents.REPEAT_USE]);
    const counts = JSON.parse(store.getItem(SHOT_COUNT_KEY));
    assert.equal(counts.shot_caddie_opened, 2);
    assert.equal(counts.shot_caddie_repeat_use, 1);
    assert.doesNotThrow(() => trackShotCaddieEvent(ShotCaddieEvents.DISTANCE_ENTERED, {}, { track, store }));
    assert.doesNotThrow(() => trackShotCaddieEvent(ShotCaddieEvents.RECOMMENDATION_GENERATED, {}, { track, store, also() { throw new Error("dev wrapper down"); } }));
  });
});

describe("Shot Caddie aim UI", () => {
  it("renders point-at-target, wind dial, and rangefinder hint when weather is loaded", () => {
    const view = read("dev/js/views/ShotCaddieView.js");
    const dial = read("dev/js/shot-wind-dial.js");
    assert.doesNotMatch(view, /What are you hitting/);
    assert.match(view, /fwShotPointAtTarget/);
    assert.match(view, /Point at target/);
    assert.match(view, /fw-shot-yardage-hint/);
    assert.match(view, /renderShotWindDialMarkup/);
    assert.match(dial, /fw-shot-wind-dial-tag--aim/);
    assert.match(dial, />You</);
    assert.match(dial, />Wind</);
  });
});

describe("Shot Caddie is in the primary shell", () => {
  it("marks Caddies as premium in navigation and below the verdict", () => {
    const shell = read("dev/js/components/AppShell.js");
    const forecast = read("dev/js/views/ForecastView.js");
    const router = read("dev/js/router.js");
    assert.match(shell, /label: "Caddies"/);
    assert.match(shell, /icon: "lock-keyhole"/);
    assert.match(forecast, /Explore Caddies · Premium/);
    assert.match(forecast, /id="fwPlanShot"/);
    assert.match(router, /"caddie"/);
    assert.doesNotMatch(forecast, /Wind Caddie/);
  });
});

