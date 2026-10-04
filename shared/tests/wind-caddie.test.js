import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { windRelativeToShot, cardinal, mpsToMph } from "../../shared/wind-caddie.js";
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
