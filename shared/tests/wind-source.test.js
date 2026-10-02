import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectWindReading, loadWindEstimate } from "../../shared/wind-source.js";

const now = 1760000000;
function raw({ current, list, stale = false } = {}) {
 return {current,list,_fwMeta:{fetchedAt:now*1000,stale,offline:false}};
}
describe("Wind Caddie source resilience",()=>{
 it("prefers valid current Worker flat wind and converts m/s to mph",()=>{
  const w=selectWindReading(raw({current:{wind_speed:6,wind_gust:10,wind_deg:225}}),{nowSec:now});
  assert.equal(w.kind,"current");
  assert.equal(w.deg,225);
  assert.ok(w.speed>13 && w.speed<14);
 });
 it("uses nearby forecast if current has no direction",()=>{
  const w=selectWindReading(raw({
   current:{wind_speed:6,wind_deg:null},
   list:[{dt:now+3600,main:{temp:12},wind:{speed:4,deg:280}}]
  }),{nowSec:now});
  assert.equal(w.kind,"near-term forecast");
  assert.equal(w.deg,280);
 });
 it("rejects distant future forecast rather than calling it live",()=>{
  const w=selectWindReading(raw({current:{wind_speed:null},list:[{dt:now+10*3600,main:{temp:12},wind:{speed:4,deg:250}}]}),{nowSec:now});
  assert.equal(w,null);
 });
 it("attempts the primary same-origin service then falls back to Worker after an error",async()=>{
  const calls=[];
  const fetcher=async(base)=>{ calls.push(base); if(!base)throw Error("No same origin function");
   return raw({current:{wind_speed:3,wind_deg:90}}); };
  const w=await loadWindEstimate(51,-1,{workerUrl:"https://example.workers.dev",fetcher,clock:()=>now*1000});
  assert.deepEqual(calls,["","https://example.workers.dev"]);
  assert.equal(w.source,"FairwayWeather Worker");assert.equal(w.deg,90);
 });
 it("never silently reports stale data as live",async()=>{
  const w=await loadWindEstimate(51,-1,{fetcher:async()=>raw({current:{wind_speed:3,wind_deg:90},stale:true}),clock:()=>now*1000});
  assert.equal(w.stale,true);
 });
 it("does not invent missing wind",async()=>{
  await assert.rejects(loadWindEstimate(51,-1,{fetcher:async()=>raw({current:{temp:15}}),clock:()=>now*1000}),/wind/i);
 });
});