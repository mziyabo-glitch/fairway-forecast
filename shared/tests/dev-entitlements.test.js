import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canAccess, defaultEntitlementTier, getEntitlementTier,
  resetEntitlementTier, setEntitlementTier,
} from "../../dev/js/entitlements/entitlements.js";

const tools = [
  "unlimitedSavedRounds", "weatherAlerts", "radar", "extendedOutlook",
  "eveningPractice", "society", "advancedNotifications",
];

describe("all golf-planning tools are free", () => {
  beforeEach(() => resetEntitlementTier());

  it("grants every implemented tool to anonymous, free and old tiers", () => {
    for (const tier of ["anonymous", "free", "premium_preview", "premium"]) {
      for (const tool of tools) assert.equal(canAccess(tool, tier), true, `${tier}: ${tool}`);
    }
  });

  it("does not allow unknown feature keys", () => {
    assert.equal(canAccess("checkout"), false);
    assert.equal(canAccess(""), false);
  });

  it("ignores old local subscription tiers and stays free", () => {
    assert.equal(defaultEntitlementTier(), "free");
    assert.equal(getEntitlementTier(), "free");
    assert.equal(setEntitlementTier("anonymous"), "free");
    assert.equal(setEntitlementTier("premium"), "free");
    assert.equal(getEntitlementTier(), "free");
  });
});
