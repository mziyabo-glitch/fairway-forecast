import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  windRelativeToShot,
  cardinal,
  mpsToMph,
  windArrowRelativeToShot,
  classifyWindOnShot,
  headingFromOrientationEvent,
} from "../../shared/wind-caddie.js";
const wind=(from,to,speed=16)=>windRelativeToShot({windFrom:from,shotBearing:to,speedMph:speed});
describe("shot wind components",()=>{
 it("wind from target is all headwind",()=>{const r=wind(0,0);assert.equal(r.headMagnitudeMph,16);assert.equal(r.crossMagnitudeMph,0);assert.equal(r.headType,"Headwind");});
 it("wind from behind is tailwind",()=>{const r=wind(180,0);assert.equal(r.headType,"Tailwind");assert.equal(r.headMagnitudeMph,16);});
 it("east wind for north-bound shot crosses from right",()=>{const r=wind(90,0);assert.equal(r.crossType,"From right");assert.equal(r.crossMagnitudeMph,16);assert.equal(r.headMagnitudeMph,0);});
 it("west wind for north-bound shot crosses from left",()=>{const r=wind(270,0);assert.equal(r.crossType,"From left");assert.equal(r.crossMagnitudeMph,16);});
 it("45-degree quartering gives 11 mph each for 16 mph",()=>{const r=wind(45,0);assert.equal(r.headMagnitudeMph,11);assert.equal(r.crossMagnitudeMph,11);});
 it("handles wrap and zero wind",()=>{assert.equal(wind(360,0).headMagnitudeMph,16);assert.equal(wind(90,0,0).headMagnitudeMph,0);assert.equal(cardinal(360),"N");assert.ok(mpsToMph(5)>11);});
 it("rejects missing model inputs",()=>assert.equal(windRelativeToShot({windFrom:null,shotBearing:0,speedMph:10}),null));
});

describe("compass-relative wind for Shot Caddie", () => {
  it("maps user heading and wind vector to relative arrow and segment", () => {
    const shot = 0;
    const from = 0;
    const relative = windRelativeToShot({ windFrom: from, shotBearing: shot, speedMph: 12 });
    assert.equal(windArrowRelativeToShot(from, shot), "↑");
    assert.equal(classifyWindOnShot(relative), "head");
    const tail = windRelativeToShot({ windFrom: 180, shotBearing: shot, speedMph: 12 });
    assert.equal(windArrowRelativeToShot(180, shot), "↓");
    assert.equal(classifyWindOnShot(tail), "tail");
    const cross = windRelativeToShot({ windFrom: 90, shotBearing: shot, speedMph: 12 });
    assert.equal(windArrowRelativeToShot(90, shot), "→");
    assert.equal(classifyWindOnShot(cross), "cross");
  });

  it("updates relative arrow when phone heading rotates", () => {
    const windFrom = 270;
    assert.equal(windArrowRelativeToShot(windFrom, 0), "←");
    assert.equal(windArrowRelativeToShot(windFrom, 90), "↓");
    assert.equal(windArrowRelativeToShot(windFrom, 180), "→");
  });

  it("reads compass heading from orientation events", () => {
    assert.equal(headingFromOrientationEvent({ webkitCompassHeading: 45 }), 45);
    assert.equal(headingFromOrientationEvent({ absolute: true, alpha: 300 }), 60);
    assert.equal(headingFromOrientationEvent({ alpha: 10 }), null);
  });
});
