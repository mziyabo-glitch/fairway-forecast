import { loadWindEstimate } from "../../shared/wind-source.js?v=20261003-shot";
import { windRelativeToShot, cardinal, wrapBearing, signedAngle } from "../../shared/wind-caddie.js";
import { PersistenceService } from "../../shared/persistence.js";
import { initClubBag, syncClubBag } from "./components/ClubBag.js?v=20261003-fast";
import { canAccess } from "./entitlements/entitlements.js?v=20261005-owner-google";
import { renderCaddiesGate } from "./components/PremiumLock.js?v=20261005-owner-google";
import { restoreOwnerSession, onOwnerSessionChange, wireOwnerLogin, renderOwnerControls, wireOwnerControls } from "./auth/owner-session.js?v=20261005-owner-google";

const main = document.querySelector(".fw-fast-app");
const toolMarkup = main.innerHTML;
let stopTools;
let showingTools = false;
function renderOwnerView() {
  const allowed = canAccess("caddies");
  if (allowed && showingTools) return;
  stopTools?.();
  stopTools = null;
  showingTools = allowed;
  main.innerHTML = allowed ? toolMarkup : renderCaddiesGate({ forecastPath: location.pathname.startsWith("/dev/") ? "/dev/forecast" : "/forecast" });
  main.hidden = false;
  if (allowed) {
    main.insertAdjacentHTML("afterbegin", renderOwnerControls());
    wireOwnerControls(main);
    stopTools = startWindCaddie();
  } else wireOwnerLogin(main);
}
onOwnerSessionChange(renderOwnerView);
renderOwnerView();
void restoreOwnerSession();
window.addEventListener("focus", () => { void restoreOwnerSession(); });

function startWindCaddie() {
let disposed = false;
const $ = id => document.getElementById(id);
const isDev = location.pathname.startsWith("/dev/");
$("back").href = isDev ? "/dev/forecast" : "/forecast";
const APP = window.APP_CONFIG || {};
const store = new PersistenceService();
const last = store.getLastCourse();
const savedCourse = Number.isFinite(last?.lat) && Number.isFinite(last?.lon) ? { lat: last.lat, lon: last.lon, name: last.name } : null;
let coords = Number.isFinite(last?.lat) && Number.isFinite(last?.lon) ? {lat:last.lat,lon:last.lon,name:last.name} : null;
let wind = null, heading = null, listening = false, locked = false;
let loading = false;
let latestRequest = 0;
let shot = 0;
let lastOrientationAt=0;
$("source").textContent = coords ? "Saved course: " + coords.name : "Tap Use my location or choose a saved course in Forecast.";
$("manual").value = "0";
$("bearing").value = "0";
const status = txt => { if (!disposed) $("status").textContent = txt; };
const initialPrompt = savedCourse ? "Loading wind for your saved course…" : "Tap Use my location to load a nearby wind estimate.";
status(initialPrompt);
$("compassInfo").textContent = initialPrompt;
function arrowPoint(bearing,radius,cx=160,cy=150) {
 const angle=bearing*Math.PI/180;
 return [cx+radius*Math.sin(angle),cy-radius*Math.cos(angle)];
}
function draw(result) {
 const svg=$("compass");if(!result){svg.innerHTML='<circle cx="160" cy="150" r="112" fill="#F2F7F3" stroke="#D9E7DC"/><text x="160" y="148" text-anchor="middle" fill="#61796D" font-size="15">'+(wind?"Point at flag":"Loading wind")+'</text>';return;}
 const [sx,sy]=arrowPoint(result.shotBearing,86);
 const [wx,wy]=arrowPoint(result.windFrom,100);
 const [tx,ty]=arrowPoint(result.windFrom+180,40);
 svg.innerHTML=`<defs><marker id="tip" markerWidth="7" markerHeight="7" refX="4" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#1c654e"/></marker><marker id="wtip" markerWidth="7" markerHeight="7" refX="4" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#2b8aaf"/></marker></defs>
 <circle cx="160" cy="150" r="112" fill="#f3f8f4" stroke="#d4e7db" stroke-width="1.5"/>
 <circle cx="160" cy="150" r="87" fill="none" stroke="#dae6dd" stroke-dasharray="3 6"/>
 <text x="160" y="23" text-anchor="middle" font-size="12" fill="#61796d">N</text><text x="160" y="288" text-anchor="middle" font-size="12" fill="#61796d">S</text><text x="28" y="153" text-anchor="middle" font-size="12" fill="#61796d">W</text><text x="293" y="153" text-anchor="middle" font-size="12" fill="#61796d">E</text>
 <path d="M160 150 L${sx} ${sy}" stroke="#1c654e" stroke-width="4" stroke-linecap="round" marker-end="url(#tip)"/>
 <path d="M${wx} ${wy} L${tx} ${ty}" stroke="#2b8aaf" stroke-width="4" stroke-linecap="round" marker-end="url(#wtip)"/>
 <circle cx="160" cy="150" r="7" fill="#1c654e" stroke="#fff" stroke-width="3"/>
 <text x="160" y="182" font-size="11" text-anchor="middle" fill="#61796d">YOU</text>`;
}
function render() {
 if (disposed) return;
 const result=locked?windRelativeToShot({windFrom:wind?.deg,shotBearing:shot,speedMph:wind?.speed,gustMph:wind?.gust}):null;
 draw(result);
 $("shotLabel").textContent=shot+"° "+cardinal(shot);
 $("directionStatus").textContent=locked?"Target "+shot+"° · locked":heading==null?"Direction not set":"Point at flag · "+Math.round(heading)+"°";
 $("heading").textContent=heading==null?"No compass reading":"Phone heading: "+Math.round(heading)+"° "+cardinal(heading)+(locked?" · locked":"");
 $("compassInfo").textContent=wind?"Wind from "+cardinal(wind.deg)+" ("+Math.round(wind.deg)+"°) · "+Math.round(wind.speed)+" mph"+(wind.gust!=null?" · gust "+Math.round(wind.gust)+" mph":""):(loading ? "Loading wind…" : savedCourse ? "Wind not loaded — use location or retry saved course" : "Tap Use my location to load wind");
 $("interpretation").textContent=result?.label||(wind?"Point at flag to check wind":"Loading wind…");
 $("head").textContent=result ? result.headMagnitudeMph+" mph" : "—";
 $("headType").textContent=result?.headType||"Head / tail";
 $("cross").textContent=result ? result.crossMagnitudeMph+" mph" : "—";
 $("crossType").textContent=result?.crossType||"Crosswind";
 syncClubBag({result,wind,bearingConfirmed:locked});
}
function orientation(event) {
 if (locked) return;
 let value=null;
 if(Number.isFinite(event.webkitCompassHeading)) value=event.webkitCompassHeading;
 else if(event.absolute===true && Number.isFinite(event.alpha)) value=360-event.alpha;
 if(!Number.isFinite(value))return;
 const time=Date.now();
 if(time-lastOrientationAt<125) return;
 const next=wrapBearing(value);
 if(heading!=null && Math.abs(signedAngle(next-heading))<3) return;
 lastOrientationAt=time;
 heading=next;
 shot=Math.round(heading);
 $("bearing").value=String(shot);$("manual").value=String(shot);
 render();
}
$("compassStart").addEventListener("click",async()=>{
 if(!("DeviceOrientationEvent" in window)){status("Compass unavailable on this browser. Set direction manually.");return;}
 try{
  if(typeof DeviceOrientationEvent.requestPermission==="function"){
   const permission=await DeviceOrientationEvent.requestPermission();
   if(permission!=="granted"){status("Compass permission denied. Use manual direction.");return;}
  }
  if(!listening){window.addEventListener("deviceorientationabsolute",orientation);window.addEventListener("deviceorientation",orientation);listening=true;}
  locked=false;status("Compass started. Point the top of your phone towards the target, away from magnetic objects. Tap Lock bearing when ready.");
 }catch{status("Compass unavailable. Use manual bearing.");}
});
$("lock").addEventListener("click",()=>{if(heading!=null){shot=Math.round(heading);locked=true;$("bearing").value=String(shot);$("manual").value=String(shot);status("Shot direction locked. Recheck before your next shot.");render();}else status("No reliable compass reading yet. Use manual direction.");});
$("bearing").addEventListener("input",e=>{locked=true;shot=Number(e.target.value);$("manual").value=String(shot);render();});
$("manual").addEventListener("change",e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||n<0||n>=360){status("Enter a bearing from 0 to 359 degrees.");return;}locked=true;shot=Math.round(n);$("bearing").value=String(shot);render();});
async function load(lat,lon,label) {
 if (disposed) return;
 const request = ++latestRequest;
 coords = {lat,lon,name:label};
 loading = true; wind = null;
 status("Loading local wind…"); $("source").textContent = label;
 $("compassInfo").textContent = "Fetching wind for " + label + "…";
 $("age").textContent = "";
 $("gps").disabled = true; $("course").disabled = true;
 try {
   const estimate = await loadWindEstimate(lat,lon,{workerUrl:APP.WORKER_BASE_URL});
   if(request !== latestRequest) return;
   wind = estimate;
   status(estimate.stale ? "Saved weather: conditions may have changed. Retry for an update." : "Wind loaded. Point at your target or adjust the bearing.");
   const validTime = estimate.validFor ? " · Wind valid for " + new Date(estimate.validFor).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) : "";
   $("age").textContent = estimate.source + " · " + estimate.kind + validTime + (estimate.stale ? " · STALE" : "");
 } catch(e) {
   if(request !== latestRequest) return;
   wind = null;
   status("Unable to load wind: " + (e?.message || "Unknown error") + " Try again or select your saved course.");
   $("compassInfo").textContent = "Wind not loaded — retry above.";
 } finally {
   if(request === latestRequest) {
     loading = false;
     $("gps").disabled = false;
     $("course").disabled = !savedCourse;
     render();
   }
 }
}
$("gps").addEventListener("click",()=>{
 if(!navigator.geolocation){status("Geolocation unsupported. Use a saved course.");return;}
 status("Waiting for location permission…");
 navigator.geolocation.getCurrentPosition(p=>load(p.coords.latitude,p.coords.longitude,"Near your current position"),
 e=>status("Could not access location ("+e.message+"). Use saved course instead."),
 {enableHighAccuracy:true,timeout:12000,maximumAge:30000});
});
$("course").addEventListener("click",()=>savedCourse?load(savedCourse.lat,savedCourse.lon,savedCourse.name):status("Choose a golf course in Forecast first."));
if(savedCourse){$("course").disabled=false;}else{$("course").disabled=true;}
render();
initClubBag();
if(savedCourse) load(savedCourse.lat,savedCourse.lon,savedCourse.name || "Saved course");
return () => {
  disposed = true;
  latestRequest++;
  window.removeEventListener("deviceorientationabsolute", orientation);
  window.removeEventListener("deviceorientation", orientation);
};
}
