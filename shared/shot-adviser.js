/** Practice-only heuristic. NOT a measured ball-flight model or competition advice.
 * Target is assumed to mean desired CARRY to the landing area, not total distance.
 */
import { toYards } from "./club-bag.js";
const limit=(value,min,max)=>Math.min(max,Math.max(min,value));
export function buildShotAdvice({bag,target,wind=null,rain=null,ground="unspecified",bearingConfirmed=false}={}){
 const units=bag?.units==="m"?"m":"yd";
 const yards=toYards(target,units);
 if(yards==null) return {state:"need_target",units};
 const entries=(bag?.clubs||[]).filter(c=>c.id!=="putter"&&Number.isFinite(c.carryYards)&&c.carryYards>0)
   .sort((a,b)=>a.carryYards-b.carryYards);
 if(!entries.length) return {state:"need_bag",units,targetYards:yards};
 // When wind is missing or the phone is not pointed, show a safe calm-air reference
 // rather than fabricating an on-course wind adjustment.
 const reliable=wind&&Number.isFinite(wind.headMph)&&bearingConfirmed&&!wind.stale;
 const head=reliable?wind.headMph:0;
 const windPct=head>0?limit(head*.006,0,.14):limit(head*.003,-.07,0);
 // Rain may reduce carry and wet ball/lie introduces uncertainty. The small 1–2%
 // margin below is an explicit starting heuristic, never presented as exact physics.
 const observed=rain&&rain.known===true;
 const rainMm=observed&&Number.isFinite(rain.mmPerHour)?rain.mmPerHour:null;
 const chance=observed&&Number.isFinite(rain.probability)?rain.probability:null;
 const rainPct=rainMm!=null?(rainMm>=2?.02:rainMm>=.2?.01:0):(chance!=null&&chance>=.7?.01:0);
 const groundPct=ground==="wet_lie"?.02:0;
 // Do not invent a direction-dependent club recommendation when wind is untrusted;
 // rain adjustment is allowed if actually sourced and explicitly labelled.
 const totalPct=windPct+rainPct+groundPct;
 const effectiveYards=limit(yards*(1+totalPct),1,450);
 const ranked=entries.map(c=>({...c,gap:Math.abs(c.carryYards-effectiveYards)})).sort((a,b)=>a.gap-b.gap);
 const selected=ranked[0];
 const calm=entries.map(c=>({...c,gap:Math.abs(c.carryYards-yards)})).sort((a,b)=>a.gap-b.gap)[0];
 const notes=[];
 if(!wind) notes.push("No local wind loaded. Club uses your normal carries plus any supported rain or ground assumption.");
 else if(wind.stale) notes.push("Wind estimate is stale; no wind adjustment applied.");
 else if(!bearingConfirmed) notes.push("Point at the target and lock the bearing to include wind.");
 else if(head>1) notes.push("Headwind: provisional extra carry allowance.");
 else if(head< -1) notes.push("Tailwind: provisional helping-wind allowance.");
 else notes.push("Minimal head/tail wind component.");
 if(!observed) notes.push("Rain data unavailable; no rain penalty assumed.");
 else if(rainPct>0) notes.push("Rain: provisional small carry allowance (not a measured effect).");
 else notes.push("No rain adjustment indicated by available forecast.");
 if(ground==="wet_lie") notes.push("Wet lie: optional provisional 2% buffer; expect unpredictable contact and reduced rollout.");
 if(ground==="soft") notes.push("Soft ground reduces rollout; this tool targets carry, not total distance.");
 if(ground==="firm") notes.push("Firm ground may increase rollout; avoid assuming this tool predicts total distance.");
 return {
  state:"ready",units,targetYards:yards,effectiveYards:Math.round(effectiveYards),
  selected,calm,alternate:ranked[1]||null,usedWind:Boolean(reliable),
  windPct,rainPct,groundPct,totalPct,notes,
  label:"Estimated starting point — not a precise carry prediction",
 };
}
