import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { featureOn, isAdvancedDev } from "../../dev/js/features/gates.js";
import { canAccess } from "../../dev/js/entitlements/entitlements.js";
import { tabFromPath, pathForTab } from "../../dev/js/router.js";

const root = new URL("../../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

describe("free advanced features on production", () => {
  it("exposes all implemented advanced functions without a paid tier", () => {
    for (const key of ["savedRounds", "weatherAlerts", "favouriteCourses", "nearbyCourses", "radarFoundation", "extendedOutlook", "societyWeather", "eveningPractice", "golferPreferences", "forecastConfidence", "groundConditionRisk", "safetyOverrides", "courseStatus", "pwaReadiness"]) {
      assert.equal(featureOn(key), true, key);
    }
    for (const key of ["unlimitedSavedRounds", "weatherAlerts", "radar", "extendedOutlook", "eveningPractice", "society"]) assert.equal(canAccess(key, "anonymous"), true);
    assert.equal(featureOn("adsenseSlot"), false);
    assert.equal(featureOn("affiliateCards"), false);
    assert.equal(isAdvancedDev(), true);
  });

  it("routes advanced tools on production and preserves working direct URLs", () => {
    for (const route of ["alerts", "society", "settings", "account"]) {
      assert.equal(tabFromPath("/" + route), route);
      assert.equal(pathForTab(route, "/"), "/" + route);
      assert.match(read(route + "/index.html"), /app\.js\?v=20261004-aim-dial-2/);
    }
    assert.match(read("_redirects"), /\/alerts \/index\.html 200/);
    assert.match(read("_redirects"), /\/society \/index\.html 200/);
  });

  it("does not render a legacy premium lock or a production preview banner", () => {
    const locks = read("dev/js/components/PremiumLock.js");
    const html = read("index.html");
    const app = read("dev/js/app.js");
    assert.match(locks, /return ""/);
    assert.doesNotMatch(html, /DEV — Premium UI preview/);
    assert.match(app, /showMore: true/);
  });

  it("does not imply the radar is live or promise push notification delivery", () => {
    assert.match(read("dev/js/components/RadarPanel.js"), /not live/);
    assert.match(read("dev/js/app.js"), /in_app_only/);
  });
});
