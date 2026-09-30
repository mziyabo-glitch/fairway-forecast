import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getVerdictCue, renderGolfVerdictHero } from "../../dev/js/components/GolfVerdictHero.js";

describe("golf verdict cue", () => {
  it("shows the factor that actually reduced the score", () => {
    const verdict = {
      score: 80,
      factors: [
        { key: "wind", impact: -20 },
        { key: "rain", impact: -5 },
      ],
      metrics: { avgTemp: 14 },
    };

    assert.deepEqual(getVerdictCue({ verdict, weatherIcon: "🌧️" }), {
      icon: "wind",
      text: "Main consideration: wind",
    });

    const html = renderGolfVerdictHero({ verdict, weatherIcon: "🌧️" });
    assert.match(html, /data-lucide="wind"/);
    assert.match(html, /Main consideration: wind/);
    assert.doesNotMatch(html, /fw-verdict-icon|🌧️/);
  });

  it("uses selected-window weather when no factor reduced the score", () => {
    assert.deepEqual(getVerdictCue({ verdict: { factors: [] }, weatherIcon: "☀️" }), {
      icon: "sun",
      text: "Selected window: clear",
    });
  });
});
