import { esc } from "../../../shared/utils.js";

/** Renders nothing unless placement selection returned a card. */
export function renderSponsoredGolfCard(selection) {
  if (!selection?.placement || !selection.card) return "";
  const card = selection.card;
  return `
    <aside class="fw-sponsored" aria-label="Sponsored">
      <p class="fw-sponsored-kicker">Sponsored</p>
      <a class="fw-sponsored-link" href="${esc(card.href)}" rel="sponsored noopener" target="_blank">${esc(card.title)}</a>
      <p class="fw-sponsored-body">${esc(card.body)}</p>
    </aside>`;
}

/** No iframe and no ad script unless a slot is explicitly enabled. */
export function renderAdsenseSlot({ enabled = false, slotId = "" } = {}) {
  if (enabled !== true || !slotId) return "";
  return `<div class="fw-adsense" data-ad-slot="${esc(slotId)}" role="complementary" aria-label="Advertisement"></div>`;
}
