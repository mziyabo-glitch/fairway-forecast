import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeGolfVerdict, getBestDayThisWeek } from "../forecast-engine.js";
import { renderForecastView } from "../../dev/js/views/ForecastView.js";
import { canAccess, setEntitlementTier } from "../../dev/js/entitlements/entitlements.js";
import { renderCaddiesGate } from "../../dev/js/components/PremiumLock.js";

const tee = 1_800_000_000;
const state = {
  days: [{ dateKey: "2027-01-15", dateLabel: "Jan 15", dayLabel: "Friday", hasValidTimes: true }],
  selectedDateKey: "2027-01-15", selectedTeeTime: tee,
  teeTimes: [{ value: tee, label: "08:00" }], holes: 18, windowHours: 4, tzOffset: 0,
  verdict: { score: 90, label: "Excellent", message: "Light wind and little rain.", metrics: {} },
};

describe("round planning and honest forecast states", () => {
  it("puts the date and tee controls before the selected round verdict", () => {
    const html = renderForecastView(state);
    assert.ok(html.indexOf('id="fwDayStripMount"') < html.indexOf('id="fwRoundMount"'));
    assert.ok(html.indexOf('id="fwRoundMount"') < html.indexOf('id="fwHeroMount"'));
    assert.match(html, /Your round verdict/);
    assert.match(html, /18 holes · Course local time/);
    assert.match(html, /Higher is better/);
  });

  it("hides a previous verdict while the replacement weather loads", () => {
    const html = renderForecastView({ ...state, weatherLoading: true });
    assert.match(html, /Loading weather for your round/);
    assert.doesNotMatch(html, /data-score="90"|Excellent|Explore Caddies/);
    assert.match(html, /id="fwSaveRound"[^>]*disabled/);
  });

  it("shows unavailable and retry controls after a fetch failure", () => {
    const html = renderForecastView({ ...state, verdict: null, error: "Could not load weather." });
    assert.match(html, /Forecast unavailable/);
    assert.match(html, /id="fwRetryForecast"/);
    assert.doesNotMatch(html, /data-score=|Excellent/);
  });

  it("keeps date and tee controls usable when a round cannot be scored", () => {
    const html = renderForecastView({ ...state, verdict: null });
    assert.match(html, /No round verdict available/);
    assert.match(html, /id="fwTeeTimeSelect"/);
    assert.doesNotMatch(html, /data-score=|fw-status-text-excellent/);
  });

  it("does not turn missing wind or temperature into good conditions", () => {
    for (const window of [[], [{ dt: tee, temp: 15 }], [{ dt: tee, wind_speed: 0 }]]) {
      const verdict = computeGolfVerdict(window, window, tee, 4);
      assert.equal(verdict.score, null);
      assert.equal(verdict.verdict, null);
      assert.equal(verdict.label, "No Data");
    }
    assert.equal(getBestDayThisWeek({ "2027-01-15": { bestScore: null } }, state.days), null);
  });
});

describe("only Caddies is premium", () => {
  it("keeps planning free and ignores an unverified stored paid tier", () => {
    setEntitlementTier("premium");
    assert.equal(canAccess("caddies", "premium"), false);
    for (const feature of ["unlimitedSavedRounds", "weatherAlerts", "radar", "extendedOutlook", "eveningPractice", "society"]) {
      assert.equal(canAccess(feature), true, feature);
    }
    const html = renderCaddiesGate();
    assert.match(html, /Premium · Coming soon/);
    assert.match(html, /not available to purchase yet/);
    assert.doesNotMatch(html, /Get Premium|Buy now|data-shot-/);
  });
});
