import {
  CLUB_CATALOG, MAX_CLUBS, loadBag, saveBag, toDisplay, updateCarry, addClub, removeClub, reorderClub,
} from "../../../shared/club-bag.js?v=20261003-shot";
import { buildShotAdvice } from "../../../shared/shot-adviser.js?v=20261003-shot";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let bag=loadBag(),target="",ground="",lastWind=null,lastResult=null,confirmed=false,saveMessage="";
const unit=()=>bag.units==="m"?"m":"yd";
const reading=()=>lastWind?.stale?"Saved forecast — no wind adjustment":lastWind?.rain?.known?"Rain data available":"Rain forecast detail unavailable";
function renderAdvice(){
  const panel=document.getElementById("shotPlannerResult");
  const indicator=document.getElementById("shotUnit");
  if(indicator) indicator.textContent=unit();
  const targetInput=document.getElementById("shotTarget");
  if(targetInput) targetInput.setAttribute("aria-label","Target carry distance in "+(unit()==="yd"?"yards":"metres"));
  if(!panel) return;
  const groundSelect=document.getElementById("shotGround");
  if(groundSelect && groundSelect.value!==ground) groundSelect.value=ground;
  const status=document.getElementById("shotWeatherStatus");
  if(status){
    if(!lastWind) status.textContent="Wind pending · enter your target";
    else if(lastWind.stale) status.textContent="Saved wind · using normal carries";
    else status.textContent=Math.round(lastWind.speed)+" mph · "+
      (lastWind.rain?.known && Number.isFinite(lastWind.rain.mmPerHour)
      ? lastWind.rain.mmPerHour.toFixed(1)+" mm/h rain" : lastWind.rain?.known?"rain outlook available":"rain unknown");
  }
  const result=buildShotAdvice({
    bag,target,wind:lastResult?{...lastResult,stale:!lastWind||lastWind.stale}:null,
    rain:!lastWind?.stale?lastWind?.rain:null,ground,bearingConfirmed:confirmed
  });
  if(result.state==="need_target") {
    panel.innerHTML='<p class="small">Enter the carry distance to your intended landing area to calculate a club.</p>';
    return;
  }
  if(result.state==="need_bag") {
    panel.innerHTML='<p class="small">Add your normal carry distances in My Bag to see your club suggestion.</p>';
    return;
  }
  const selected=result.selected;
  const change=result.calm.id===selected.id ? "Same club as calm conditions" :
    selected.carryYards>result.calm.carryYards ? "Longer club than calm conditions" : "Shorter club than calm conditions";
  const adjust=Math.round((result.effectiveYards-result.targetYards)*10)/10;
  const toDisp=y=>toDisplay(y,bag.units);
  const rain=lastWind?.rain;
  const rainLine=rain?.known && !lastWind?.stale
    ? (Number.isFinite(rain.mmPerHour) ? `Rain (${rain.period || "forecast"}): ${rain.mmPerHour.toFixed(1)} mm/h` :
       `Rain chance (${rain.period || "forecast"}): ${Math.round(rain.probability*100)}%`)
    : "Rain data unknown";
  const windLine=result.usedWind
    ? `${Math.abs(lastResult.headMph).toFixed(0)} mph ${lastResult.headMph>=0?"headwind":"tailwind"} component`
    : "Wind not used until target bearing is locked and weather is current";
  const optional=result.alternate
    ? `<span class="small">Alternative to assess: ${esc(result.alternate.name)} · ${toDisp(result.alternate.carryYards)} ${unit()}</span>`
    : "";
  panel.innerHTML=`
    <div class="fw-shot-choice">
      <span class="fw-shot-choice-kicker">${result.usedWind?"WIND-ADJUSTED PRACTICE ESTIMATE":"PERSONAL CARRY ESTIMATE"}</span>
      <div class="fw-shot-main"><strong class="fw-shot-club">${esc(selected.name)}</strong>
        <span class="fw-shot-change">${esc(change)}</span></div>
      <div class="fw-shot-meta">Plan for <b>${toDisp(result.effectiveYards)} ${unit()}</b> · Your carry <b>${toDisp(selected.carryYards)} ${unit()}</b></div>
      <div class="fw-shot-chips"><span>${esc(windLine)}</span><span>${esc(rainLine)}</span></div>
      <details class="fw-shot-more"><summary>Why this club</summary>
        <div class="fw-shot-breakdown">
          <div><span>Target carry</span><b>${toDisp(result.targetYards)} ${unit()}</b></div>
          <div><span>Illustrative allowance</span><b>${adjust>=0?"+":""}${toDisp(adjust)} ${unit()}</b></div>
          <div><span>Planning carry</span><b>${toDisp(result.effectiveYards)} ${unit()}</b></div>
        </div>
        ${optional}
        <p class="small">${esc(result.notes.join(" "))}</p>
        <p class="small">Heuristic only: ball flight, elevation and actual wind at the ball are not measured. This estimates carry, not rollout.</p>
      </details>
  </div>`;
}
function bagRows(){
 return bag.clubs.map((club,i)=>{
   const val=toDisplay(club.carryYards,bag.units);
   const putter=club.id==="putter";
   return `<div class="fw-bag-row"><label for="club-${esc(club.id)}">${esc(club.name)}</label>
     <div class="fw-bag-field">
       ${putter?'<span class="small">No carry needed</span>':`<input id="club-${esc(club.id)}" data-carry="${esc(club.id)}" type="number" inputmode="decimal" min="1" max="450" step="0.1" value="${val??""}" placeholder="—" aria-label="${esc(club.name)} carry in ${unit()}">`}
       <span class="fw-bag-units">${putter?"":unit()}</span>
       <button type="button" class="fw-bag-icon" data-up="${esc(club.id)}" aria-label="Move ${esc(club.name)} up" ${i===0?"disabled":""}>↑</button>
       <button type="button" class="fw-bag-icon" data-down="${esc(club.id)}" aria-label="Move ${esc(club.name)} down" ${i===bag.clubs.length-1?"disabled":""}>↓</button>
       <button type="button" class="fw-bag-icon fw-bag-remove" data-remove="${esc(club.id)}" aria-label="Remove ${esc(club.name)}">×</button>
     </div></div>`;
 }).join("");
}
function renderBag(){
 const el=document.getElementById("clubBag");if(!el)return;
 const completed=bag.clubs.filter(c=>c.id!=="putter"&&c.carryYards!=null).length;
 const ids=new Set(bag.clubs.map(c=>c.id));
 const options=CLUB_CATALOG.filter(([id])=>!ids.has(id)).map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join("");
 el.innerHTML=`
   <div class="fw-bag-head"><div><span class="pill">Your personal distances</span><h2>My Golf Bag</h2></div>
   <label class="fw-bag-unit-label" for="bagUnits">Units
     <select id="bagUnits"><option value="yd" ${bag.units==="yd"?"selected":""}>Yards</option><option value="m" ${bag.units==="m"?"selected":""}>Metres</option></select>
   </label><button id="bagClose" type="button" class="fw-bag-done" aria-label="Close My Golf Bag">Done</button></div>
   <p class="small">Enter your normal carry, without roll. Blank clubs are fine. Saved on this device.</p>
   <div class="fw-bag-progress">${completed} club carries entered</div>
   <div class="fw-bag-rows">${bagRows()}</div>
   <div class="fw-bag-add">
     <label for="bagClubSelect">Add a club</label>
     <div class="fw-bag-add-row"><select id="bagClubSelect"><option value="">Choose a club…</option>${options}<option value="custom">Custom club…</option></select>
     <button id="bagAdd" type="button" class="btn ghost" ${bag.clubs.length>=MAX_CLUBS?"disabled":""}>Add</button></div>
     <label for="bagCustom" id="bagCustomLabel" hidden>Custom club name<input id="bagCustom" type="text" maxlength="32" placeholder="e.g. 62° wedge"></label>
   </div>
   <p id="bagSaveStatus" class="small" role="status">${esc(saveMessage)}</p>`;
 el.querySelector("#bagClose")?.addEventListener("click", closeClubBag);
 function changed(){
   saveMessage=saveBag(bag)?"Saved on this device":"Could not save: check browser storage permissions";
   renderBag();renderAdvice();
 }
 el.querySelector("#bagUnits").addEventListener("change",e=>{
   const prev=bag.units,next=e.target.value;
   if(prev===next)return;
   if(target&&Number.isFinite(Number(target)))target=String(Math.round(
     Number(target)*(next==="m"?1/1.0936132983377078:1.0936132983377078)*10)/10);
   const hero=document.getElementById("shotTarget");
   if(hero)hero.value=target;
   bag={...bag,units:next};changed();
 });
 el.querySelectorAll("[data-carry]").forEach(input=>input.addEventListener("change",()=>{
   const updated=updateCarry(bag,input.dataset.carry,input.value.trim());
   if(!updated){el.querySelector("#bagSaveStatus").textContent="Enter a carry between 1 and 450 "+unit()+" or leave blank.";return;}
   bag=updated;changed();
 }));
 el.querySelectorAll("[data-remove]").forEach(btn=>btn.addEventListener("click",()=>{
   bag=removeClub(bag,btn.dataset.remove);changed();
 }));
 for(const [attr,delta] of [["data-up",-1],["data-down",1]])
   el.querySelectorAll("["+attr+"]").forEach(btn=>btn.addEventListener("click",()=>{
     bag=reorderClub(bag,btn.getAttribute(attr),delta);changed();
   }));
 el.querySelector("#bagClubSelect").addEventListener("change",e=>{
   el.querySelector("#bagCustomLabel").hidden=e.target.value!=="custom";
 });
 el.querySelector("#bagAdd").addEventListener("click",()=>{
   const select=el.querySelector("#bagClubSelect");
   if(!select.value){el.querySelector("#bagSaveStatus").textContent="Choose a club first.";return;}
   const id=select.value==="custom"?
     "custom_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6):select.value;
   const next=addClub(bag,id,el.querySelector("#bagCustom").value);
   if(!next){el.querySelector("#bagSaveStatus").textContent="Enter a valid club name or remove another club.";return;}
   bag=next;changed();
 });
}
export function closeClubBag(){
 const dialog=document.getElementById("clubBag");
 if(!dialog)return;
 if(typeof dialog.close==="function" && dialog.open)dialog.close();
 else dialog.removeAttribute("open");
}
export function openClubBag(){
 const dialog=document.getElementById("clubBag");
 if(!dialog)return;
 if(typeof dialog.showModal==="function"){if(!dialog.open)dialog.showModal();}
 else dialog.setAttribute("open","");
}
export function initClubBag(){
 bag=loadBag();renderBag();
 for(const id of ["bagOpen","bagQuickOpen"]){
   document.getElementById(id)?.addEventListener("click",openClubBag);
 }
 document.getElementById("clubBag")?.addEventListener("click",e=>{
   if(e.target===e.currentTarget)closeClubBag();
 });
 const hero=document.getElementById("shotPlanner");
 if(hero){
   hero.querySelector("#shotTarget").addEventListener("input",e=>{target=e.target.value;renderAdvice();});
   hero.querySelector("#shotGround").addEventListener("change",e=>{ground=e.target.value;renderAdvice();});
 }
 renderAdvice();
}
export function syncClubBag({result,wind,bearingConfirmed}={}){
 lastResult=result||null;
 lastWind=wind||null;
 confirmed=Boolean(bearingConfirmed);
 renderAdvice();
}
