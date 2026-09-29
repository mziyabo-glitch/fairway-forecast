import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canAccess,
  defaultEntitlementTier,
  getEntitlementTier,
  resetEntitlementTier,
  setEntitlementTier,
} from "../../dev/js/entitlements/entitlements.js";

describe("entitlements", () => {
  beforeEach(() => {
    resetEntitlementTier();
  });

  it("allows premium preview and premium through the soft gates", () => {
    for (const feature of ["unlimitedSavedRounds", "weatherAlerts", "radar", "extendedOutlook", "society", "advancedNotifications"]) {
      assert.equal(canAccess(feature, "premium_preview"), true, feature);
      assert.equal(canAccess(feature, "premium"), true, feature);
    }
  });

  it("keeps anonymous and free outside the soft gates", () => {
    for (const tier of ["anonymous", "free"]) {
      assert.equal(canAccess("society", tier), false);
      assert.equal(canAccess("weatherAlerts", tier), false);
      assert.equal(canAccess("radar", tier), false);
      assert.equal(canAccess("extendedOutlook", tier), false);
      assert.equal(canAccess("unlimitedSavedRounds", tier), false);
      assert.equal(canAccess("advancedNotifications", tier), false);
    }
  });

  it("rejects unknown features", () => {
    assert.equal(canAccess("checkout", "premium"), false);
    assert.equal(canAccess("", "premium_preview"), false);
  });

  it("defaults the dev shell to premium preview and stores a chosen tier", () => {
    assert.equal(defaultEntitlementTier(), "premium_preview");
    assert.equal(getEntitlementTier(), "premium_preview");
    assert.equal(setEntitlementTier("free"), "free");
    assert.equal(getEntitlementTier(), "free");
    assert.equal(setEntitlementTier("nope"), "free");
  });
});
