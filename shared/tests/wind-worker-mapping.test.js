import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeWeather } from "../weather-service.js";
describe("Worker and OpenWeather wind mapping",()=>{
 it("reads Worker flat wind fields from current data",()=>{
  const normalized=normalizeWeather({current:{dt:1000,wind_speed:5,wind_gust:8,wind_deg:225}});
  assert.equal(normalized.current.wind_speed,5);
  assert.equal(normalized.current.wind_gust,8);
  assert.equal(normalized.current.wind_deg,225);
 });
 it("supports upstream nested wind fields",()=>{
  const normalized=normalizeWeather({current:{wind:{speed:4,gust:7,deg:0}}});
  assert.equal(normalized.current.wind_speed,4);
  assert.equal(normalized.current.wind_gust,7);
  assert.equal(normalized.current.wind_deg,0);
 });
 it("reads flat wind fields from forecast list when current is absent",()=>{
  const normalized=normalizeWeather({list:[{dt:1000,main:{temp:15},wind_speed:6,wind_gust:9,wind_deg:270}]});
  assert.equal(normalized.current.wind_speed,6);
  assert.equal(normalized.current.wind_gust,9);
  assert.equal(normalized.current.wind_deg,270);
 });
 it("prefers valid flat speed and zero-degree direction",()=>{
  const normalized=normalizeWeather({current:{wind_speed:0,wind_deg:0,wind:{speed:5,deg:120}}});
  assert.equal(normalized.current.wind_speed,0);
  assert.equal(normalized.current.wind_deg,0);
 });
});
