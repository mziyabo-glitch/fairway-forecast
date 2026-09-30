/** Sponsored placement selection. Affiliate cards stay off unless the flag is explicitly true. */

export const FORBIDDEN_SURFACES = ["above_verdict", "rain_timeline", "tee_selector", "above_core"];

export const ALLOWED_PLACEMENT = "below_core";

const SPONSORED_CARD = {
  id: "sponsored-golf-preview",
  title: "Course partner",
  body: "A single sponsored card can sit below the forecast. It is hidden while affiliate cards are off.",
  href: "https://fairwayweather.example/partners",
};

export function selectSponsoredPlacement({
  affiliateCards = false,
  adsenseSlot = false,
  monetisationHooks = false,
  surface = "forecast",
} = {}) {
  if (!monetisationHooks) {
    return { placement: null, card: null, adsense: false, reason: "hooks_disabled" };
  }
  if (FORBIDDEN_SURFACES.includes(surface)) {
    return { placement: null, card: null, adsense: false, reason: "forbidden_surface" };
  }
  if (affiliateCards !== true) {
    return { placement: null, card: null, adsense: false, reason: "affiliate_cards_disabled" };
  }
  if (surface !== "forecast") {
    return { placement: null, card: null, adsense: false, reason: "no_surface" };
  }
  return {
    placement: ALLOWED_PLACEMENT,
    card: SPONSORED_CARD,
    adsense: adsenseSlot === true,
    reason: "selected",
  };
}
