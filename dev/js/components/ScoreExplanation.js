import { esc } from "../../../shared/utils.js";

export function renderScoreExplanationBody({ score, factors, decision, verdict }) {
  const factorList = factors || verdict?.factors || [];
  const positives = [];
  const cautions = [];

  for (const f of factorList) {
    const impact = f.impact ?? 0;
    const item = `<li><span class="fw-factor-text">${esc(f.text)}</span></li>`;
    if (impact >= -8) positives.push(item);
    else cautions.push(item);
  }

  const reasons = decision?.reasons || verdict?.reasons;
  if (reasons?.length) {
    for (const r of reasons) {
      const item = `<li><span class="fw-factor-text">${esc(r)}</span></li>`;
      if (!cautions.some((i) => i.includes(esc(r)))) cautions.push(item);
    }
  }

  if (!positives.length && !cautions.length) {
    positives.push("<li><span class=\"fw-factor-text\">Great conditions across the board — enjoy your round!</span></li>");
  }

  return `
    <p class="fw-sheet-intro">Your <strong>${esc(String(score))}</strong> score reflects rain, wind, and temperature during your round — not just right now.</p>
    ${
      positives.length
        ? `<div class="fw-score-group fw-score-group--positive">
            <h3 class="fw-score-group-title"><span aria-hidden="true">✓</span> Working in your favour</h3>
            <ul class="fw-score-factors">${positives.join("")}</ul>
          </div>`
        : ""
    }
    ${
      cautions.length
        ? `<div class="fw-score-group fw-score-group--caution">
            <h3 class="fw-score-group-title"><span aria-hidden="true">⚠</span> Watch out for</h3>
            <ul class="fw-score-factors">${cautions.join("")}</ul>
          </div>`
        : ""
    }
    <details class="fw-score-scale">
      <summary>Score guide</summary>
      <p class="fw-sheet-footnote">90+ Excellent · 80–89 Good · 65–79 Playable · 50–64 Risky · 30–49 Poor · below 30 Avoid.</p>
    </details>`;
}

export function renderBestTeeTimeCard(better) {
  if (!better) return "";

  const bullets = (better.reasons || [])
    .map((r) => `<li>${esc(r)}</li>`)
    .join("");

  return `
    <section class="fw-better-tee fw-fade-in" aria-label="Better tee time suggestion">
      <div class="fw-better-tee-inner">
        <div class="fw-better-tee-copy">
          <span class="fw-better-label"><span aria-hidden="true">⭐</span> Better tee time</span>
          <strong class="fw-better-time">${esc(better.label)}</strong>
          <p class="fw-better-score">${esc(String(better.score ?? ""))}${better.score != null ? " / 100" : ""}</p>
          <p class="fw-better-copy">+${better.improvement} points</p>
          ${bullets ? `<ul class="fw-better-reasons">${bullets}</ul>` : ""}
        </div>
        <button type="button" class="fw-btn fw-btn-primary fw-btn-compact" id="fwUseBetterTee">Use ${esc(better.label)}</button>
      </div>
    </section>`;
}

export function wireBestTeeTimeCard(container, onUse) {
  container?.querySelector("#fwUseBetterTee")?.addEventListener("click", onUse);
}
