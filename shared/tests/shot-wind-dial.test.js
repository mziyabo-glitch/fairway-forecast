import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shotWindDialViewState } from "../../dev/js/shot-wind-dial.js";

describe("shot wind dial", () => {
  it("hides when wind is unknown", () => {
    assert.deepEqual(shotWindDialViewState({ windKnown: false, windDeg: 90 }), { hidden: true });
  });

  it("shows wind-only with note when compass unavailable", () => {
    const state = shotWindDialViewState({
      windKnown: true,
      windDeg: 270,
      shotBearing: 45,
      available: false,
    });
    assert.equal(state.hidden, false);
    assert.equal(state.windRotate, 270);
    assert.equal(state.showAim, false);
    assert.match(state.note, /Wind-only mode/);
  });

  it("shows both aim and wind when bearing is known", () => {
    const state = shotWindDialViewState({
      windKnown: true,
      windDeg: 90,
      shotBearing: 45,
      available: true,
    });
    assert.equal(state.showAim, true);
    assert.equal(state.aimRotate, 45);
    assert.equal(state.windRotate, 90);
    assert.equal(state.note, null);
  });

  it("wind-only until shot bearing is set", () => {
    const state = shotWindDialViewState({
      windKnown: true,
      windDeg: 180,
      shotBearing: null,
      available: true,
    });
    assert.equal(state.showAim, false);
    assert.match(state.note, /Point at target/);
  });
});
