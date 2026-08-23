import { esc } from "../../../shared/utils.js";

export function renderScoreExplanationBody({ score, factors, decision }) {
  const items = [];

  if (factors?.length) {
    for (const f of factors) {
      items.push(`<li><strong>${esc(f.text)}</strong>${f.impact ? ` <span class="fw-impact-delta">${f.impact}</span>` : ""}</li>`);
    }
  }

  if (decision?.reasons?.length) {
    for (const r of decision.reasons) {
      if (!items.some((i) => i.includes(esc(r)))) {
        items.push(`<li>${esc(r)}</li>`);
      }
    }
  }

  if (!items.length) {
    items.push("<li>Great conditions across the board — enjoy your round!</li>");
  }

  return `
    <p class="fw-sheet-intro">Your score of <strong>${esc(String(score))}</strong> reflects how rain, wind, and temperature will feel during your round — not just right now.</p>
    <ul class="fw-score-factors">${items.join("")}</ul>
    <p class="fw-sheet-footnote">Scores above 72 are generally good for golf. Below 48, most golfers will find it tough.</p>`;
}

export function renderBestTeeTimeCard(better) {
  if (!better) return "";

  return `
    <section class="fw-better-tee" aria-label="Better tee time suggestion">
      <div class="fw-better-tee-inner">
        <div>
          <span class="fw-better-label">Better tee time</span>
          <strong class="fw-better-time">${esc(better.label)}</strong>
          <p class="fw-better-copy">+${better.improvement} points vs your current slot — ${esc(better.decision?.label || "better conditions")}</p>
        </div>
        <button type="button" class="fw-btn fw-btn-primary" id="fwUseBetterTee">Use ${esc(better.label)}</button>
      </div>
    </section>`;
}

export function wireBestTeeTimeCard(container, onUse) {
  container?.querySelector("#fwUseBetterTee")?.addEventListener("click", onUse);
}
