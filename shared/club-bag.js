/** On-device club bag for carry distances only.
 * All distances are stored in yards, regardless of display units.
 */
export const BAG_KEY = "fw_wind_club_bag_v1";
export const YARDS_PER_METRE = 1.0936132983377078;
export const MAX_CLUBS = 20;

export const CLUB_CATALOG = Object.freeze([
  ["driver","Driver"],["2wood","2 Wood"],["3wood","3 Wood"],["4wood","4 Wood"],["5wood","5 Wood"],["7wood","7 Wood"],["9wood","9 Wood"],
  ["2hy","2 Hybrid"],["3hy","3 Hybrid"],["4hy","4 Hybrid"],["5hy","5 Hybrid"],["6hy","6 Hybrid"],
  ["2i","2 Iron"],["3i","3 Iron"],["4i","4 Iron"],["5i","5 Iron"],["6i","6 Iron"],["7i","7 Iron"],
  ["8i","8 Iron"],["9i","9 Iron"],["pw","Pitching Wedge"],["gw","Gap Wedge"],["aw","Approach Wedge"],
  ["46w","46° Wedge"],["48w","48° Wedge"],["50w","50° Wedge"],["52w","52° Wedge"],
  ["54w","54° Wedge"],["56w","56° Wedge"],["58w","58° Wedge"],["60w","60° Wedge"],["62w","62° Wedge"],
  ["putter","Putter"]
]);
const CATALOG = new Map(CLUB_CATALOG);
const STANDARD_IDS = ["driver","3wood","5wood","4hy","5i","6i","7i","8i","9i","pw","50w","54w","60w","putter"];
export const defaultBag = () => ({
  version: 1,
  units: "yd",
  clubs: STANDARD_IDS.map(id => ({id, name: CATALOG.get(id), carryYards: null})),
});

export function toDisplay(yards,units) {
  if (yards == null || !Number.isFinite(yards)) return null;
  return Math.round((units === "m" ? yards / YARDS_PER_METRE : yards) * 10) / 10;
}
export function toYards(distance,units) {
  const n = Number(distance);
  if (distance === "" || distance == null || !Number.isFinite(n) || n < 1 || n > 450) return null;
  const yards = units === "m" ? n * YARDS_PER_METRE : n;
  if (yards > 450) return null;
  return Math.round(yards * 100) / 100;
}
function cleanName(name) {
  return String(name || "").trim().replace(/[<>]/g,"").slice(0,32);
}
export function normalizeBag(raw) {
  const units = raw?.units === "m" ? "m" : "yd";
  const arr = Array.isArray(raw?.clubs) ? raw.clubs.slice(0,MAX_CLUBS) : [];
  const seen = new Set();
  const clubs = arr.reduce((out,item)=>{
    if (!item || typeof item.id !== "string") return out;
    const id = item.id;
    const validId = CATALOG.has(id) || /^custom_[a-z0-9_-]{4,30}$/.test(id);
    if (!validId || seen.has(id)) return out;
    const name = CATALOG.get(id) || cleanName(item.name);
    if (!name) return out;
    seen.add(id);
    const carry = item.carryYards;
    const carryYards = id === "putter" || carry == null || carry === "" || !Number.isFinite(Number(carry)) || Number(carry) < 1 || Number(carry) > 450
      ? null : Math.round(Number(carry)*100)/100;
    out.push({id,name,carryYards});
    return out;
  },[]);
  return {version:1,units,clubs};
}
export function loadBag(store = globalThis.localStorage) {
  try {
    const raw = store?.getItem(BAG_KEY);
    return raw ? normalizeBag(JSON.parse(raw)) : defaultBag();
  } catch {
    return defaultBag();
  }
}
export function saveBag(bag, store = globalThis.localStorage) {
  try {
    if (!store?.setItem) return false;
    store.setItem(BAG_KEY,JSON.stringify(normalizeBag(bag)));
    return true;
  } catch {
    return false;
  }
}
export function updateCarry(bag,id,input) {
  const yards = toYards(input,bag.units);
  if (input !== "" && yards == null) return null;
  return {...bag,clubs:bag.clubs.map(c=>c.id===id?{...c,carryYards:yards}:c)};
}
export function addClub(bag,id,name="") {
  if (bag.clubs.length >= MAX_CLUBS || bag.clubs.some(c=>c.id===id)) return null;
  const clubName = CATALOG.get(id) || (/^custom_[a-z0-9_-]{4,30}$/.test(id) ? cleanName(name) : "");
  if (!clubName) return null;
  return {...bag,clubs:[...bag.clubs,{id,name:clubName,carryYards:null}]};
}
export function removeClub(bag,id) {
  return {...bag,clubs:bag.clubs.filter(c=>c.id!==id)};
}
export function reorderClub(bag,id,direction) {
  const clubs=bag.clubs.slice(), i=clubs.findIndex(c=>c.id===id), j=i+direction;
  if(i<0||j<0||j>=clubs.length) return bag;
  [clubs[i],clubs[j]]=[clubs[j],clubs[i]];
  return {...bag,clubs};
}
/** Nearest entered carry to the target in calm conditions; NOT wind-adjusted. */
export function closestCarry(bag,target,units=bag.units) {
  const yards=toYards(target,units);
  if (yards==null) return null;
  const ranked=bag.clubs.filter(c=>c.id!=="putter" && Number.isFinite(c.carryYards))
    .map(c=>({...c,gapYards:Math.round((yards-c.carryYards)*10)/10}))
    .sort((a,b)=>Math.abs(a.gapYards)-Math.abs(b.gapYards));
  return ranked[0] || null;
}
