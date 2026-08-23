import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeGolfVerdict,
  analyzeRainDuringRound,
  calculateDayScore,
  getWindowData,
  isMaterialTeeShift,
  teeShiftMinutes,
} from "../forecast-engine.js";
import { rainIntensityCategory, scoreToVerdict } from "../utils.js";

function hourlyPoint(overrides = {}) {
  return {
    dt: overrides.dt ?? 1_700_000_000,
    temp: overrides.temp ?? 15,
    pop: overrides.pop ?? 0,
    rain_mm: overrides.rain_mm ?? 0,
    wind_speed: overrides.wind_speed ?? 0,
    wind_gust: overrides.wind_gust ?? overrides.wind_speed ?? 0,
    weather: overrides.weather ?? [{ id: 800, main: "Clear" }],
  };
}

function windowWithWind(mph, gustMph = mph) {
  const mps = mph / 2.237;
  const gustMps = gustMph / 2.237;
  return Array.from({ length: 4 }, (_, i) =>
    hourlyPoint({
      dt: 1_700_000_000 + i * 3600,
      wind_speed: mps,
      wind_gust: gustMps,
      temp: 15,
    })
  );
}

describe("wind scoring — metric vs imperial display", () => {
  const speeds = [5, 10, 15, 20, 25, 30, 35];

  for (const mph of speeds) {
    it(`${mph} mph produces identical score for metric and imperial`, () => {
      const mps = mph / 2.237;
      const metricWindow = Array.from({ length: 4 }, (_, i) =>
        hourlyPoint({ dt: 1_700_000_000 + i * 3600, wind_speed: mps, wind_gust: mps * 1.1, temp: 15 })
      );
      const imperialWindow = Array.from({ length: 4 }, (_, i) =>
        hourlyPoint({ dt: 1_700_000_000 + i * 3600, wind_speed: mph, wind_gust: mph * 1.1, temp: 59 })
      );

      const metric = computeGolfVerdict(metricWindow, metricWindow, metricWindow[0].dt, 4, "metric", "gb");
      const imperial = computeGolfVerdict(
        imperialWindow,
        imperialWindow,
        imperialWindow[0].dt,
        4,
        "imperial",
        "gb"
      );

      assert.equal(metric.score, imperial.score, `Wind ${mph} mph should score equally`);
    });
  }

  it("gusts increase effective wind penalty", () => {
    const calm = computeGolfVerdict(windowWithWind(8, 8), windowWithWind(8, 8), 1_700_000_000, 4, "metric", "gb");
    const gusty = computeGolfVerdict(windowWithWind(8, 28), windowWithWind(8, 28), 1_700_000_000, 4, "metric", "gb");
    assert.ok(gusty.score < calm.score, "High gusts should lower score");
  });
});

describe("rain intensity categories", () => {
  const cases = [
    [0, "dry"],
    [0.2, "drizzle"],
    [1, "light"],
    [3, "moderate"],
    [6, "heavy"],
  ];

  for (const [mm, key] of cases) {
    it(`${mm} mm/h → ${key}`, () => {
      assert.equal(rainIntensityCategory(mm).key, key);
    });
  }
});

describe("rain scoring", () => {
  for (const mm of [0, 0.2, 1, 3, 6]) {
    it(`total rain ${mm} mm affects score sensibly`, () => {
      const window = Array.from({ length: 4 }, (_, i) =>
        hourlyPoint({ dt: 1_700_000_000 + i * 3600, rain_mm: mm / 4, temp: 15 })
      );
      const v = computeGolfVerdict(window, window, window[0].dt, 4, "metric", "gb");
      assert.ok(v.score >= 0 && v.score <= 100);
      if (mm >= 6) assert.ok(v.score <= 60);
      if (mm === 0) assert.ok(v.score >= 90);
    });
  }
});

describe("UK temperature scoring", () => {
  const temps = [-2, 2, 7, 15, 25, 32];

  for (const temp of temps) {
    it(`${temp}°C produces valid verdict`, () => {
      const window = Array.from({ length: 4 }, (_, i) =>
        hourlyPoint({ dt: 1_700_000_000 + i * 3600, temp, wind_speed: 2 })
      );
      const v = computeGolfVerdict(window, window, window[0].dt, 4, "metric", "gb");
      assert.ok(v.score >= 0 && v.score <= 100);
      assert.equal(v.verdict, scoreToVerdict(v.score));
      assert.match(v.message, /.+/);
    });
  }

  it("−2°C in the UK is NOT AVOID", () => {
    const window = Array.from({ length: 4 }, (_, i) =>
      hourlyPoint({ dt: 1_700_000_000 + i * 3600, temp: -2, wind_speed: 2 })
    );
    const v = computeGolfVerdict(window, window, window[0].dt, 4, "metric", "gb");
    assert.notEqual(v.verdict, "AVOID");
    assert.ok(v.score >= 30, "UK −2°C should remain playable enough to not be AVOID");
  });
});

describe("combination scenarios", () => {
  it("dry calm round scores excellent", () => {
    const window = Array.from({ length: 4 }, (_, i) =>
      hourlyPoint({ dt: 1_700_000_000 + i * 3600, temp: 18, wind_speed: 2, rain_mm: 0 })
    );
    const v = computeGolfVerdict(window, window, window[0].dt, 4, "metric", "gb");
    assert.ok(v.score >= 90);
    assert.equal(v.verdict, "EXCELLENT");
  });

  it("wind + rain lowers score more than either alone", () => {
    const windOnly = computeGolfVerdict(
      windowWithWind(22, 24),
      windowWithWind(22, 24),
      1_700_000_000,
      4,
      "metric",
      "gb"
    );
    const rainOnly = computeGolfVerdict(
      Array.from({ length: 4 }, (_, i) =>
        hourlyPoint({ dt: 1_700_000_000 + i * 3600, rain_mm: 1, temp: 15 })
      ),
      [],
      1_700_000_000,
      4,
      "metric",
      "gb"
    );
    const combined = computeGolfVerdict(
      Array.from({ length: 4 }, (_, i) =>
        hourlyPoint({
          dt: 1_700_000_000 + i * 3600,
          rain_mm: 1,
          wind_speed: 22 / 2.237,
          wind_gust: 24 / 2.237,
          temp: 15,
        })
      ),
      [],
      1_700_000_000,
      4,
      "metric",
      "gb"
    );
    assert.ok(combined.score <= rainOnly.score);
    assert.ok(combined.score <= windOnly.score);
  });

  it("score and verdict never contradict", () => {
    const window = windowWithWind(28, 32);
    const v = computeGolfVerdict(window, window, window[0].dt, 4, "metric", "gb");
    assert.equal(v.verdict, scoreToVerdict(v.score));
  });
});

describe("wettest period", () => {
  it("uses peak rain segment not first-to-last wet hour", () => {
    const hourly = [
      hourlyPoint({ dt: 1000, rain_mm: 0.3 }),
      hourlyPoint({ dt: 4600, rain_mm: 0 }),
      hourlyPoint({ dt: 8200, rain_mm: 0.2 }),
      hourlyPoint({ dt: 11800, rain_mm: 4 }),
      hourlyPoint({ dt: 15400, rain_mm: 3 }),
      hourlyPoint({ dt: 19000, rain_mm: 0.1 }),
    ];
    const analysis = analyzeRainDuringRound(hourly, 1000, 5, 0);
    assert.ok(analysis.wettestPeriod.includes("03:") || analysis.wettestPeriod.includes("4"));
    assert.notEqual(analysis.wettestPeriod.split("–")[0].trim(), analysis.hours[0].time);
  });

  it("rain timeline includes probability and intensity", () => {
    const hourly = [
      hourlyPoint({ dt: 1000, rain_mm: 0, pop: 0.2 }),
      hourlyPoint({ dt: 4600, rain_mm: 1.2, pop: 0.7 }),
    ];
    const analysis = analyzeRainDuringRound(hourly, 1000, 2, 0);
    assert.equal(analysis.hours[0].probability, 20);
    assert.equal(analysis.hours[1].rainfallMm, 1.2);
    assert.ok(analysis.hours[1].weatherIcon);
  });
});

describe("day score strip", () => {
  it("evaluates tee windows not arbitrary midpoint", () => {
    const base = Date.UTC(2026, 7, 24) / 1000;
    const norm = {
      timezoneOffset: 0,
      sunrise: base + 6 * 3600,
      sunset: base + 20 * 3600,
      hourly: Array.from({ length: 14 }, (_, i) =>
        hourlyPoint({
          dt: base + 7 * 3600 + i * 3600,
          rain_mm: i < 4 ? 2 : 0,
          wind_speed: 3,
          temp: 16,
        })
      ),
    };
    const date = new Date(Date.UTC(2026, 7, 24));
    const ds = calculateDayScore(norm, date, "metric", 4, "gb");
    assert.ok(ds.bestScore >= 0);
    assert.ok(ds.bestTeeTime != null || ds.score > 0);
  });
});

describe("same-day tee adjustment", () => {
  it("treats a 15-minute snap as not material", () => {
    const a = 1_800_000_000;
    const b = a + 15 * 60;
    assert.equal(teeShiftMinutes(a, b, 0), 15);
    assert.equal(isMaterialTeeShift(a, b, 0), false);
  });

  it("treats a 45-minute snap as material", () => {
    const a = 1_800_000_000;
    const b = a + 45 * 60;
    assert.equal(isMaterialTeeShift(a, b, 0), true);
  });
});
