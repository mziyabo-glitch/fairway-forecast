import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
 BAG_KEY,CLUB_CATALOG,MAX_CLUBS,defaultBag,loadBag,saveBag,normalizeBag,
 toDisplay,toYards,updateCarry,addClub,removeClub,reorderClub,closestCarry
} from "../club-bag.js";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
const mockStore=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};};
describe("My Golf Bag",()=>{
 it("starts with unfilled Driver through 60-degree wedge and putter; never invents carries",()=>{
  const bag=defaultBag();
  assert.ok(bag.clubs.length<=14);
  for(const id of ["driver","3wood","5wood","4hy","5i","6i","7i","8i","9i","pw","50w","54w","60w","putter"]){
   assert.ok(bag.clubs.some(c=>c.id===id),id);
  }
  assert.ok(bag.clubs.every(c=>c.carryYards===null));
  assert.equal(closestCarry(bag,160),null);
 });
 it("updates and persists a personal carry without touching other clubs",()=>{
  let bag=defaultBag();bag=updateCarry(bag,"7i","158");
  assert.equal(bag.clubs.find(c=>c.id==="7i").carryYards,158);
  assert.equal(bag.clubs.find(c=>c.id==="6i").carryYards,null);
  const store=mockStore();assert.equal(saveBag(bag,store),true);
  assert.equal(JSON.parse(store.getItem(BAG_KEY)).clubs.find(c=>c.id==="7i").carryYards,158);
  assert.equal(loadBag(store).clubs.find(c=>c.id==="7i").carryYards,158);
 });
 it("converts yards and metres without changing stored yards on display",()=>{
  let bag=defaultBag();bag={...bag,units:"m"};
  bag=updateCarry(bag,"7i","140");
  assert.ok(Math.abs(bag.clubs.find(c=>c.id==="7i").carryYards-153.1)<.12);
  assert.equal(toDisplay(bag.clubs.find(c=>c.id==="7i").carryYards,"m"),140);
  assert.ok(toYards("100","m")>109 && toYards("100","m")<110);
 });
 it("supports adding and removing alternate clubs and reordering",()=>{
  let bag=defaultBag();bag=addClub(bag,"3i");
  assert.equal(bag.clubs.at(-1).name,"3 Iron");
  assert.equal(addClub(bag,"3i"),null);
  bag=reorderClub(bag,"3i",-1);
  assert.equal(bag.clubs.at(-2).id,"3i");
  bag=removeClub(bag,"3i");
  assert.equal(bag.clubs.some(c=>c.id==="3i"),false);
  assert.ok(CLUB_CATALOG.some(([id])=>id==="60w"));
 });
 it("rejects invalid carry and does not overwrite previously entered values",()=>{
  let bag=updateCarry(defaultBag(),"driver","245");
  assert.equal(updateCarry(bag,"driver","999"),null);
  assert.equal(updateCarry(bag,"driver","-5"),null);
  assert.equal(updateCarry(bag,"driver","invalid"),null);
  bag=updateCarry(bag,"driver","");
  assert.equal(bag.clubs.find(c=>c.id==="driver").carryYards,null);
 });
 it("sanitizes stored data and refuses duplicate or unknown club identifiers",()=>{
  const bag=normalizeBag({units:"m",clubs:[
   {id:"driver",name:"Fake Driver",carryYards:270},
   {id:"driver",name:"Duplicated",carryYards:300},
   {id:"unknown",name:"Bad",carryYards:280},
   {id:"custom_abcd",name:"<script>Test</script>",carryYards:200},
   {id:"60w",carryYards:999},
  ]});
  assert.equal(bag.clubs.length,3);
  assert.equal(bag.clubs[0].name,"Driver");
  assert.equal(bag.clubs[1].name.includes("<"),false);
  assert.equal(bag.clubs[2].carryYards,null);
  assert.equal(normalizeBag({clubs: Array.from({length:MAX_CLUBS+3},(_,i)=>({id:"custom_abcd"+i,name:"Name"}))}).clubs.length,MAX_CLUBS);
 });
 it("finds nearest entered normal carry only, excluding putter",()=>{
  let bag=defaultBag();
  bag=updateCarry(bag,"6i",170);bag=updateCarry(bag,"7i",155);
  assert.equal(closestCarry(bag,159).name,"7 Iron");
  assert.equal(closestCarry(bag,169).name,"6 Iron");
  assert.equal(closestCarry(bag,0),null);
 });
 it("handles corrupt storage and failed saves safely",()=>{
  assert.equal(loadBag({getItem:()=>"{not json"}).clubs.length,defaultBag().clubs.length);
  assert.equal(saveBag(defaultBag(),{setItem:()=>{throw Error("no storage")}}),false);
 });
 it("exposes the club editor only as a submenu and removes mode switch",()=>{
  for(const path of ["wind/index.html","dev/wind/index.html"]){
   const html=read(path);
   assert.match(html,/<dialog id="clubBag"/);
   assert.match(html,/id="bagOpen"/);
   assert.match(html,/id="bagQuickOpen"/);
   assert.match(html,/20261003-fast/);
   assert.doesNotMatch(html,/id="competition"/);
   assert.ok(html.indexOf('id="shotPlanner"') < html.indexOf('id="windHeading"'));
  }
  const code=read("dev/js/wind-caddie-app.js");
  assert.match(code,/initClubBag\(\)/);
  assert.match(code,/syncClubBag/);
  assert.doesNotMatch(code,/competition/);
  const editor=read("dev/js/components/ClubBag.js");
  assert.match(editor,/openClubBag/);
  assert.match(editor,/showModal/);
  assert.match(editor,/closeClubBag/);
 });
});
