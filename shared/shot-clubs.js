/** Shot Caddie club yardages. Stored on this device, in yards. */
import { toDisplay, toYards } from "./club-bag.js";

export const SHOT_CLUBS_KEY = "fw_shot_clubs_v1";
export const SHOT_SETUP_KEY = "fw_shot_setup_v1";

/** Typical amateur carry distances. One number per club, driver through wedges. */
export const DEFAULT_SHOT_CLUBS = Object.freeze([
  { id: "driver", name: "Driver", carryYards: 230 },
  { id: "3wood", name: "3 Wood", carryYards: 215 },
  { id: "5wood", name: "5 Wood", carryYards: 200 },
  { id: "4hy", name: "4 Hybrid", carryYards: 190 },
  { id: "5i", name: "5 Iron", carryYards: 175 },
  { id: "6i", name: "6 Iron", carryYards: 160 },
  { id: "7i", name: "7 Iron", carryYards: 148 },
  { id: "8i", name: "8 Iron", carryYards: 138 },
  { id: "9i", name: "9 Iron", carryYards: 128 },
  { id: "pw", name: "Pitching Wedge", carryYards: 115 },
  { id: "gw", name: "Gap Wedge", carryYards: 100 },
  { id: "sw", name: "Sand Wedge", carryYards: 85 },
  { id: "lw", name: "Lob Wedge", carryYards: 70 },
]);

const GROUNDS = new Set(["firm", "normal", "soft", "very_soft"]);
const WINDS = new Set(["head", "cross", "tail"]);

export function defaultShotClubs() {
  return {
    version: 1,
    units: "yd",
    clubs: DEFAULT_SHOT_CLUBS.map((club) => ({ ...club })),
  };
}

export function normalizeShotClubs(raw) {
  const fallback = defaultShotClubs();
  const units = raw?.units === "m" ? "m" : "yd";
  const incoming = Array.isArray(raw?.clubs) ? raw.clubs : [];
  const byId = new Map();
  for (const item of incoming) {
    if (!item || typeof item.id !== "string") continue;
    const known = fallback.clubs.find((club) => club.id === item.id);
    if (!known || byId.has(item.id)) continue;
    const yards = Number(item.carryYards);
    const carryYards = Number.isFinite(yards) && yards >= 1 && yards <= 450 ? Math.round(yards) : known.carryYards;
    byId.set(item.id, { id: known.id, name: known.name, carryYards });
  }
  return {
    version: 1,
    units,
    clubs: fallback.clubs.map((club) => byId.get(club.id) || { ...club }),
  };
}

export function loadShotClubs(store = globalThis.localStorage) {
  try {
    const raw = store?.getItem?.(SHOT_CLUBS_KEY);
    if (!raw) return defaultShotClubs();
    return normalizeShotClubs(JSON.parse(raw));
  } catch {
    return defaultShotClubs();
  }
}

export function saveShotClubs(bag, store = globalThis.localStorage) {
  try {
    if (!store?.setItem) return false;
    store.setItem(SHOT_CLUBS_KEY, JSON.stringify(normalizeShotClubs(bag)));
    return true;
  } catch {
    return false;
  }
}

export function setShotClubCarry(bag, id, input) {
  const yards = input === "" || input == null ? null : toYards(input, bag?.units === "m" ? "m" : "yd");
  if (input !== "" && input != null && yards == null) return null;
  const next = normalizeShotClubs(bag);
  const club = next.clubs.find((item) => item.id === id);
  if (!club) return null;
  if (yards != null) club.carryYards = Math.round(yards);
  return next;
}

export function setShotClubUnits(bag, units) {
  const next = normalizeShotClubs(bag);
  next.units = units === "m" ? "m" : "yd";
  return next;
}

export function displayCarry(yards, units) {
  return toDisplay(yards, units === "m" ? "m" : "yd");
}

export function loadShotSetup(store = globalThis.localStorage) {
  const fallback = { windOnShot: "cross", ground: "normal" };
  try {
    const raw = store?.getItem?.(SHOT_SETUP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      windOnShot: WINDS.has(parsed.windOnShot) ? parsed.windOnShot : fallback.windOnShot,
      ground: GROUNDS.has(parsed.ground) ? parsed.ground : fallback.ground,
    };
  } catch {
    return fallback;
  }
}

export function saveShotSetup(setup, store = globalThis.localStorage) {
  try {
    if (!store?.setItem) return false;
    const current = loadShotSetup(store);
    const next = {
      windOnShot: WINDS.has(setup?.windOnShot) ? setup.windOnShot : current.windOnShot,
      ground: GROUNDS.has(setup?.ground) ? setup.ground : current.ground,
    };
    store.setItem(SHOT_SETUP_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
