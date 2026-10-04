import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createShotCompass } from "../../dev/js/shot-compass.js";
import { formatAimLine } from "../../dev/js/views/ShotCaddieView.js";

describe("shot compass aim lock", () => {
  it("keeps locked bearing when phone heading drifts", () => {
    const compass = createShotCompass();
    compass.setHeadingForTest(45);
    assert.equal(compass.shotBearing(), 45);
    assert.ok(compass.lock());
    compass.setHeadingForTest(120);
    assert.equal(compass.getState().heading, 120);
    assert.equal(compass.shotBearing(), 45);
    assert.equal(compass.getState().lockedBearing, 45);
  });

  it("pointAtTarget unlocks when already locked", async () => {
    const compass = createShotCompass();
    compass.setHeadingForTest(90);
    compass.lock();
    const result = await compass.pointAtTarget();
    assert.equal(result, "unlocked");
    assert.equal(compass.getState().locked, false);
    assert.equal(compass.shotBearing(), 90);
  });

  it("pointAtTarget locks after start when heading is known", async () => {
    const prevWindow = globalThis.window;
    const prevOrientation = globalThis.DeviceOrientationEvent;
    globalThis.window = {
      addEventListener() {},
      removeEventListener() {},
    };
    globalThis.DeviceOrientationEvent = {};
    try {
      const compass = createShotCompass();
      compass.setHeadingForTest(200);
      const result = await compass.pointAtTarget();
      assert.equal(result, "locked");
      assert.equal(compass.shotBearing(), 200);
      compass.setHeadingForTest(10);
      assert.equal(compass.shotBearing(), 200);
    } finally {
      globalThis.window = prevWindow;
      globalThis.DeviceOrientationEvent = prevOrientation;
    }
  });

  it("formatAimLine shows locked bearing line", () => {
    const line = formatAimLine({ locked: true, shotBearing: 45 });
    assert.match(line, /Aiming 45°/);
    assert.match(line, /NE/);
  });
});
