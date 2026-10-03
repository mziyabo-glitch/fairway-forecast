import {
 CLUB_CATALOG,MAX_CLUBS,defaultBag,loadBag,saveBag,normalizeBag,
 toDisplay,updateCarry,addClub,removeClub,reorderClub,closestCarry
} from "../../../shared/club-bag.js?v=20261003-bag";
const esc = str => String(str ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
let bag=loadBag(), target="", competition=true, lastResult=null, saveMessage="";
const unit=()=>bag.units==="m"?"m":"yd";
function planner() {
 if(competition) return '<p class="small">Competition mode is on. Personalised club selection is hidden. You can set up your bag before a round.</p>';
 if (!lastResult) return '<p class="small">Load local wind to see the shot-relative wind alongside your own carry distances.</p>';
 if(!target) return '<p class="small">Enter target distance to see the nearest club by your normal carry. No automatic wind yardage adjustment is assumed.</p>';
 const club=closestCarry(bag,target);
 if(!club) return '<p class="small">Enter the carry distances for your clubs to compare your target with your usual carries.</p>';
 const gap=Math.abs(club.gapYards),units=bag.units;
 const difference=toDisplay(gap,units);
 const relation=club.gapYards > 0?"short of":club.gapYards<0?"beyond":"matching";
 const head=lastResult.headMph;
 const windNote=head>6 ? "Headwind detected. Compare the next longer entered clubs; exact adjustment depends on ball flight and actual wind at the ball." :
 head< -6 ? "Helping wind detected. Check whether the next shorter club is appropriate; the forecast cannot predict exact carry." :
 "No strong head/tail component in this forecast. Gusts and conditions at the ball can still differ.";
 return `<div class="fw-club-suggestion"><span class="small">Nearest normal carry · calm-air reference</span>
 <strong>${esc(club.name)} · ${esc(toDisplay(club.carryYards,units))} ${units}</strong>
 <span class="small">${difference<.2?"Matches target":`${esc(difference)} ${units} ${relation} target`}</span>
 <p class="small">${esc(windNote)}</p></div>`;
}
function rows(){
 return bag.clubs.map((club,index)=>{
 const putter=club.id==="putter";
 const v=toDisplay(club.carryYards,bag.units);
 return `<div class="fw-bag-row">
  <label for="club-${esc(club.id)}">${esc(club.name)}</label>
  <div class="fw-bag-field">
   ${putter?'<span class="small">No carry required</span>':`<input id="club-${esc(club.id)}" data-carry="${esc(club.id)}" type="number" inputmode="decimal" min="1" max="450" step="0.1" value="${v==null?"":v}" placeholder="—" aria-label="${esc(club.name)} normal carry in ${unit()==="yd"?"yards":"metres"}">`}
   <span class="fw-bag-units">${putter?"":unit()}</span>
   <button class="fw-bag-icon" type="button" data-up="${esc(club.id)}" aria-label="Move ${esc(club.name)} up" ${index===0?"disabled":""}>↑</button>
   <button class="fw-bag-icon" type="button" data-down="${esc(club.id)}" aria-label="Move ${esc(club.name)} down" ${index===bag.clubs.length-1?"disabled":""}>↓</button>
   <button class="fw-bag-icon fw-bag-remove" type="button" data-remove="${esc(club.id)}" aria-label="Remove ${esc(club.name)}">×</button>
  </div>
 </div>`;
 }).join("");
}
function options(){
 const present=new Set(bag.clubs.map(c=>c.id));
 return CLUB_CATALOG.filter(([id])=>!present.has(id)).map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join("");
}
function render(){
 const el=document.getElementById("clubBag"); if(!el)return;
 const complete=bag.clubs.filter(c=>c.id!=="putter"&&Number.isFinite(c.carryYards)).length;
 el.innerHTML=`
  <div class="fw-bag-head"><div><span class="pill">Your personalised distances</span><h2>My Golf Bag</h2></div>
  <label class="fw-bag-unit-label" for="bagUnits">Units <select id="bagUnits" aria-label="Club distance units"><option value="yd" ${bag.units==="yd"?"selected":""}>Yards</option><option value="m" ${bag.units==="m"?"selected":""}>Metres</option></select></label></div>
  <p class="small">Enter your <strong>normal carry</strong>, not your total distance including roll. Blank clubs are fine. These distances are saved on this device.</p>
  <div class="fw-bag-progress">${complete} club carries entered</div>
  <div class="fw-bag-rows">${rows()}</div>
  <div class="fw-bag-add">
   <label for="bagClubSelect">Add a different club</label>
   <div class="fw-bag-add-row"><select id="bagClubSelect"><option value="">Choose a club…</option>${options()}<option value="custom">Custom club…</option></select>
   <button id="bagAdd" type="button" class="btn ghost" ${bag.clubs.length>=MAX_CLUBS?"disabled":""}>Add</button></div>
   <label for="bagCustom" id="bagCustomLabel" hidden>Custom club name <input id="bagCustom" type="text" maxlength="32" placeholder="e.g. 62° wedge"></label>
  </div>
  <p id="bagSaveStatus" class="small" role="status">${esc(saveMessage)}</p>
  <div class="fw-bag-planner" aria-label="Pre-round shot planner">
    <h3>Compare your target</h3>
    <label for="bagTarget">Target distance (${unit()})</label>
    <input type="number" id="bagTarget" min="1" max="450" inputmode="decimal" step="1" placeholder="e.g. 160" value="${esc(target)}">
    <div id="bagPlannerResult" aria-live="polite">${planner()}</div>
  </div>`;
 wire(el);
}
function persist(){
 const ok=saveBag(bag);
 saveMessage=ok?"Saved on this device": "Could not save on this device. Allow browser storage, or keep this page open and copy your distances.";
 return ok;
}
function wire(root){
 root.querySelector("#bagUnits").addEventListener("change",event=>{
  const prev=bag.units, next=event.target.value;
  if(prev===next)return;
  // Target is expressed in display units; convert it along with the bag.
  if(target){const value=Number(target);target=String(Math.round((next==="m"?value/1.0936132983377078:value*1.0936132983377078)*10)/10);}
  bag={...bag,units:next};persist();render();
 });
 root.querySelectorAll("[data-carry]").forEach(input=>input.addEventListener("change",()=>{
   const newBag=updateCarry(bag,input.dataset.carry,input.value.trim());
   if(!newBag){root.querySelector("#bagSaveStatus").textContent="Enter a realistic normal carry between 1 and 450 "+unit()+", or leave it empty.";return;}
   bag=newBag;persist();render();
 }));
 root.querySelectorAll("[data-remove]").forEach(btn=>btn.addEventListener("click",()=>{
   bag=removeClub(bag,btn.dataset.remove);persist();render();
 }));
 for(const [attr,delta] of [["data-up",-1],["data-down",1]]){
  root.querySelectorAll("["+attr+"]").forEach(btn=>btn.addEventListener("click",()=>{
   bag=reorderClub(bag,btn.getAttribute(attr),delta);persist();render();
  }));
 }
 root.querySelector("#bagClubSelect").addEventListener("change",event=>{
   root.querySelector("#bagCustomLabel").hidden=event.target.value!=="custom";
 });
 root.querySelector("#bagAdd").addEventListener("click",()=>{
  const select=root.querySelector("#bagClubSelect"),custom=root.querySelector("#bagCustom");
  if(!select.value){root.querySelector("#bagSaveStatus").textContent="Choose a club first.";return;}
  const id=select.value==="custom"?"custom_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,6):select.value;
  const result=addClub(bag,id,custom.value);
  if(!result){root.querySelector("#bagSaveStatus").textContent="Enter a valid unique club name or remove another club first.";return;}
  bag=result;persist();render();
 });
 root.querySelector("#bagTarget").addEventListener("input",event=>{
  target=event.target.value;
  root.querySelector("#bagPlannerResult").innerHTML=planner();
 });
}
export function initClubBag(){
 bag=loadBag();render();
}
export function syncClubBag({isCompetition,result}={}){
 competition=Boolean(isCompetition);
 lastResult=result||null;
 const root=document.getElementById("clubBag");
 if(root?.querySelector("#bagPlannerResult"))root.querySelector("#bagPlannerResult").innerHTML=planner();
}
