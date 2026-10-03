import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildShotAdvice } from "../shot-adviser.js";
import { defaultBag, updateCarry } from "../club-bag.js";
import { readRainForWind } from "../wind-source.js";
const bag=()=>{
 let b=defaultBag();
 b=updateCarry(b,"7i",150);
 b=updateCarry(b,"6i",170);
 b=updateCarry(b,"8i",135);
 return b;
};
describe("practice-only, personalized shot advisor",()=>{
 it("requests target distance when missing rather than assuming any distance",()=>{
  assert.equal(buildShotAdvice({bag:bag(),wind:{headMph:12},bearingConfirmed:true}).state,"need_target");
 });
 it("requests real stored club carries without inventing stock yardages",()=>{
  assert.equal(buildShotAdvice({bag:defaultBag(),target:150}).state,"need_bag");
 });
 it("headwind can select a longer entered club",()=>{
  const result=buildShotAdvice({bag:bag(),target:153,wind:{headMph:20,stale:false},bearingConfirmed:true});
  assert.equal(result.state,"ready");
  assert.equal(result.calm.name,"7 Iron");
  assert.equal(result.selected.name,"6 Iron");
  assert.equal(result.usedWind,true);
  assert.ok(result.effectiveYards>result.targetYards);
 });
 it("tailwind can select a shorter club without treating crosswind as headwind",()=>{
  const result=buildShotAdvice({bag:bag(),target:150,wind:{headMph:-24,stale:false},bearingConfirmed:true});
  assert.equal(result.selected.name,"8 Iron");
  const cross=buildShotAdvice({bag:bag(),target:150,wind:{headMph:0,stale:false},bearingConfirmed:true});
  assert.equal(cross.effectiveYards,cross.targetYards);
 });
 it("does not invent wind if heading is not locked or forecast is stale",()=>{
  const unconfirmed=buildShotAdvice({bag:bag(),target:153,wind:{headMph:20},bearingConfirmed:false});
  const stale=buildShotAdvice({bag:bag(),target:153,wind:{headMph:20,stale:true},bearingConfirmed:true});
  assert.equal(unconfirmed.usedWind,false);
  assert.equal(stale.usedWind,false);
  assert.equal(unconfirmed.effectiveYards,153);
  assert.equal(stale.effectiveYards,153);
 });
 it("uses precipitation only when the source provides it and caps the allowance",()=>{
  const baseline=buildShotAdvice({bag:bag(),target:153,bearingConfirmed:false});
  const rainy=buildShotAdvice({bag:bag(),target:153,rain:{known:true,mmPerHour:2.1,probability:.9}});
  const unknown=buildShotAdvice({bag:bag(),target:153,rain:{known:false}});
  assert.equal(baseline.effectiveYards,unknown.effectiveYards);
  assert.equal(rainy.rainPct,.02);
  assert.ok(rainy.effectiveYards>baseline.effectiveYards);
  const extreme=buildShotAdvice({bag:bag(),target:153,wind:{headMph:110},bearingConfirmed:true});
  assert.equal(extreme.windPct,.14);
 });
 it("treats soft ground as a roll warning; optional wet lie has an explicit small buffer",()=>{
  const baseline=buildShotAdvice({bag:bag(),target:153});
  const soft=buildShotAdvice({bag:bag(),target:153,ground:"soft"});
  const wet=buildShotAdvice({bag:bag(),target:153,ground:"wet_lie"});
  assert.equal(soft.effectiveYards,baseline.effectiveYards);
  assert.equal(wet.groundPct,.02);
  assert.ok(wet.effectiveYards>baseline.effectiveYards);
 });
 it("supports entered metric club carries and target metres",()=>{
  let b={...bag(),units:"m"};
  const r=buildShotAdvice({bag:b,target:140});
  assert.ok(r.targetYards>153 && r.targetYards<154);
  assert.equal(r.units,"m");
 });
});
describe("real rain data extraction",()=>{
 it("reads current one-hour amount and zero without inferring dry from missing fields",()=>{
  assert.deepEqual(readRainForWind({current:{rain_1h:0,pop:0}},{kind:"current"}),{known:true,mmPerHour:0,probability:0});
  assert.deepEqual(readRainForWind({current:{temp:13}},{kind:"current"}),{known:false,mmPerHour:null,probability:null});
 });
 it("reads forecast 3-hour amount as a per-hour approximate intensity",()=>{
  const rain=readRainForWind({list:[{dt:1000,rain:{"3h":6},pop:.8}]},{kind:"near-term forecast",validFor:1000*1000});
  assert.equal(rain.mmPerHour,2);
  assert.equal(rain.probability,.8);
 });
 it("rejects rain data from unrelated forecast hours",()=>{
  const rain=readRainForWind({list:[{dt:1000,rain:{"3h":9},pop:.8}]},{kind:"near-term forecast",validFor:2000*1000});
  assert.equal(rain.known,false);
 });
});
describe("prominent shot planner",()=>{
 it("has one target and ground selector above the location and compass in both routes",()=>{
  for(const path of ["wind/index.html","dev/wind/index.html"]){
    const html=readFileSync(new URL("../../"+path,import.meta.url),"utf8");
    assert.equal((html.match(/id="shotTarget"/g)||[]).length,1);
    assert.equal((html.match(/id="shotGround"/g)||[]).length,1);
    assert.ok(html.indexOf('id="shotTarget"')<html.indexOf('id="gps"'));
    assert.ok(html.indexOf('id="shotTarget"')<html.indexOf('id="compass"'));
    assert.match(html,/id="competition" type="checkbox" checked/);
  }
 });
});
