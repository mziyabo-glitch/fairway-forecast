import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { devFeatures } from "../../dev/js/config/devFeatures.js";
import { ALLOWED_PLACEMENT, selectSponsoredPlacement } from "../../dev/js/monetisation/placement.js";
import { renderAdsenseSlot, renderSponsoredGolfCard } from "../../dev/js/monetisation/SponsoredGolfCard.js";

describe("sponsored placement", () => {
  it("returns no placement when affiliate cards are off", () => {
    const selection = selectSponsoredPlacement({
      monetisationHooks: devFeatures.monetisationHooks,
      affiliateCards: devFeatures.affiliateCards,
      adsenseSlot: devFeatures.adsenseSlot,
      surface: "forecast",
    });
    assert.equal(devFeatures.affiliateCards, false);
    assert.equal(devFeatures.adsenseSlot, false);
    assert.equal(devFeatures.monetisationHooks, true);
    assert.equal(selection.placement, null);
    assert.equal(selection.card, null);
    assert.equal(selection.reason, "affiliate_cards_disabled");
    assert.equal(renderSponsoredGolfCard(selection), "");
    assert.equal(renderAdsenseSlot({ enabled: devFeatures.adsenseSlot }), "");
  });

  it("refuses surfaces above the verdict, rain timeline, and tee selector", () => {
    for (const surface of ["above_verdict", "rain_timeline", "tee_selector"]) {
      const selection = selectSponsoredPlacement({
        monetisationHooks: true,
        affiliateCards: true,
        surface,
      });
      assert.equal(selection.placement, null, surface);
    }
  });

  it("selects a single below-core card only when affiliate cards are enabled", () => {
    const selection = selectSponsoredPlacement({
      monetisationHooks: true,
      affiliateCards: true,
      adsenseSlot: false,
      surface: "forecast",
    });
    assert.equal(selection.placement, ALLOWED_PLACEMENT);
    const html = renderSponsoredGolfCard(selection);
    assert.match(html, /rel="sponsored noopener"/);
    assert.doesNotMatch(html, /iframe|adsbygoogle/i);
    assert.equal(renderAdsenseSlot({ enabled: false, slotId: "123" }), "");
  });
});
