import { esc } from "../../../shared/utils.js";

export function renderScoreExplanationBody({ score, factors, decision, verdict }) {
  const items = [];
  const factorList = factors || verdict?.factors;

  if (factorList?.length) {
    for (const f of factorList) {
      items.push(
        `<li><strong>${esc(f.text)}</strong>${f.impact ? ` <span class="fw-impact-delta">${f.impact}</span>` : ""}</li>`
      );
    }
  }

  const reasons = decision?.reasons || verdict?.reasons;
  if (reasons?.length) {
    for (const r of reasons) {
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
    <p class="fw-sheet-footnote">90+ Excellent · 80–89 Good · 65–79 Playable · 50–64 Risky · 30–49 Poor · below 30 Avoid.</p>`;
}

export function renderBestTeeTimeCard(better) {
  if (!better) return "";

  const bullets = (better.reasons || [])
    .map((r) => `<li>${esc(r)}</li>`)
    .join("");

  return `
    <section class="fw-better-tee fw-fade-in" aria-label="Better tee time suggestion">
      <div class="fw-better-tee-inner">
        <div>
          <span class="fw-better-label">Better tee time</span>
          <strong class="fw-better-time">${esc(better.label)}</strong>
          <p class="fw-better-copy">+${better.improvement} points vs your current slot</p>
          ${bullets ? `<ul class="fw-better-reasons">${bullets}</ul>` : ""}
        </div>
        <button type="button" class="fw-btn fw-btn-primary" id="fwUseBetterTee">Use ${esc(better.label)}</button>
      </div>
    </section>`;
}

export function wireBestTeeTimeCard(container, onUse) {
  container?.querySelector("#fwUseBetterTee")?.addEventListener("click", onUse);
}
