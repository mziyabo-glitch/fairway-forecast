/** Pure playing-distance adjustment for Shot Caddie. Does not touch forecast scoring. */
import { toYards } from "./club-bag.js";
import { DEFAULT_SHOT_CLUBS } from "./shot-clubs.js";
import { windSpeedMph } from "./utils.js";
import { cardinal } from "./wind-caddie.js";

const HEAD_YARDS_PER_MPH = 1;
const TAIL_YARDS_PER_MPH = 0.5;
const CROSS_YARDS_PER_MPH = 0;
const MAX_WIND_YARDS = 40;

const GROUND_YARDS = {
  firm: -4,
  normal: 0,
  soft: 4,
  very_soft: 8,
};

const RAIN_YARDS = {
  dry: 0,
  drizzle: 1,
  light: 3,
  moderate: 5,
  heavy: 8,
};

const RAIN_LABELS = {
  dry: "Dry",
  drizzle: "Drizzle",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
};

const DOWNWIND_ARROW = {
  N: "↓",
  NE: "↙",
  E: "←",
  SE: "↖",
  S: "↑",
  SW: "↗",
  W: "→",
  NW: "↘",
};

function emptyConditions() {
  return {
    hasWeather: false,
    windKnown: false,
    windMph: null,
    windDeg: null,
    windCardinal: null,
    windArrow: null,
    rainKey: null,
    rainLabel: null,
  };
}

function pickWindRow(hourly, current, teeTimeUnix) {
  const rows = (hourly || []).filter((row) => row && Number.isFinite(row.dt));
  if (Number.isFinite(teeTimeUnix) && rows.length) {
    const upcoming = rows.filter((row) => row.dt >= teeTimeUnix).sort((a, b) => a.dt - b.dt)[0];
    if (upcoming) return upcoming;
    return rows.slice().sort((a, b) => Math.abs(a.dt - teeTimeUnix) - Math.abs(b.dt - teeTimeUnix))[0];
  }
  if (current && Number.isFinite(current.wind_speed)) return current;
  return rows[0] || (current && typeof current === "object" ? current : null);
}

function rainFromAnalysis(rainAnalysis, teeTimeUnix) {
  const hours = Array.isArray(rainAnalysis?.hours) ? rainAnalysis.hours : [];
  let intensity = null;
  if (hours.length) {
    let hour = hours[0];
    if (Number.isFinite(teeTimeUnix)) {
      hour = hours.find((item) => item.dt === teeTimeUnix) || hours.find((item) => item.dt >= teeTimeUnix) || hours[0];
    }
    intensity = hour?.intensity || null;
  } else if (rainAnalysis?.peakIntensity) {
    intensity = rainAnalysis.peakIntensity;
  }
  const key = intensity?.key;
  if (!RAIN_LABELS[key]) return { rainKey: null, rainLabel: null };
  return { rainKey: key, rainLabel: RAIN_LABELS[key] };
}

/** Read wind and rain already on the loaded forecast. Never invents a wind number. */
export function shotConditionsFromForecast(source) {
  try {
    if (!source || typeof source !== "object" || source.loaded === false) return emptyConditions();
    const hourly = Array.isArray(source.hourly) ? source.hourly : [];
    const current = source.current && typeof source.current === "object" ? source.current : null;
    const rainAnalysis = source.rainAnalysis && typeof source.rainAnalysis === "object" ? source.rainAnalysis : null;
    if (!hourly.length && !current && !rainAnalysis) return emptyConditions();

    const units = source.units === "imperial" ? "imperial" : "metric";
    const row = pickWindRow(hourly, current, source.teeTimeUnix);
    let windMph = null;
    let windDeg = null;
    if (row && Number.isFinite(Number(row.wind_speed))) {
      const mph = windSpeedMph(Number(row.wind_speed), units);
      if (Number.isFinite(mph) && mph >= 0) windMph = Math.round(mph);
      if (Number.isFinite(Number(row.wind_deg))) windDeg = ((Number(row.wind_deg) % 360) + 360) % 360;
    }
    const windCardinal = Number.isFinite(windDeg) ? cardinal(windDeg) : null;
    const rain = rainFromAnalysis(rainAnalysis, source.teeTimeUnix);
    return {
      hasWeather: true,
      windKnown: windMph != null,
      windMph,
      windDeg,
      windCardinal,
      windArrow: windCardinal ? DOWNWIND_ARROW[windCardinal] || null : null,
      rainKey: rain.rainKey,
      rainLabel: rain.rainLabel,
    };
  } catch {
    return emptyConditions();
  }
}

function usableClubs(clubs) {
  const source = Array.isArray(clubs) && clubs.length ? clubs : DEFAULT_SHOT_CLUBS;
  return source
    .filter((club) => club && club.id !== "putter" && Number.isFinite(Number(club.carryYards)) && Number(club.carryYards) > 0)
    .map((club) => ({
      id: String(club.id),
      name: String(club.name || club.id),
      carryYards: Math.round(Number(club.carryYards)),
    }));
}

function nearestClub(clubs, yards) {
  return clubs.slice().sort((a, b) => {
    const gap = Math.abs(a.carryYards - yards) - Math.abs(b.carryYards - yards);
    if (gap !== 0) return gap;
    return b.carryYards - a.carryYards;
  })[0] || null;
}

function clubSteps(clubs, calm, selected) {
  if (!calm || !selected) return 0;
  const ordered = clubs.slice().sort((a, b) => a.carryYards - b.carryYards);
  const from = ordered.findIndex((club) => club.id === calm.id);
  const to = ordered.findIndex((club) => club.id === selected.id);
  if (from < 0 || to < 0) return 0;
  return to - from;
}

export function clubChangeLabel(steps) {
  const n = Number(steps) || 0;
  if (n > 0) return `Club up ${n}`;
  if (n < 0) return `Club down ${Math.abs(n)}`;
  return "Normal club";
}

/**
 * Map a target distance and simple on-shot conditions to a club.
 * Missing wind, rain, ground, or clubs never throws.
 */
export function recommendShot(input) {
  try {
    const source = input && typeof input === "object" ? input : {};
    const units = source.units === "m" ? "m" : "yd";
    const targetYards = toYards(source.target, units);
    const clubs = usableClubs(source.clubs);
    if (targetYards == null) {
      return {
        ok: false,
        state: "need_target",
        units,
        targetYards: null,
        playsLikeYards: null,
        club: null,
        calmClub: null,
        clubSteps: 0,
        clubLabel: "Normal club",
        usedWind: false,
        windYards: 0,
        groundYards: 0,
        rainYards: 0,
      };
    }

    const windOnShot = source.windOnShot === "head" || source.windOnShot === "tail" || source.windOnShot === "cross"
      ? source.windOnShot
      : "cross";
    const windMph = Number(source.windMph);
    const windKnown = Number.isFinite(windMph) && windMph >= 0;
    let windYards = 0;
    if (windKnown) {
      const perMph = windOnShot === "head" ? HEAD_YARDS_PER_MPH : windOnShot === "tail" ? -TAIL_YARDS_PER_MPH : CROSS_YARDS_PER_MPH;
      windYards = Math.max(-MAX_WIND_YARDS, Math.min(MAX_WIND_YARDS, perMph * windMph));
    }
    const groundYards = GROUND_YARDS[source.ground] ?? 0;
    const rainYards = RAIN_YARDS[source.rain] ?? 0;
    const playsLikeYards = Math.max(1, Math.round(targetYards + windYards + groundYards + rainYards));
    const club = nearestClub(clubs, playsLikeYards);
    const calmClub = nearestClub(clubs, targetYards);
    const steps = clubSteps(clubs, calmClub, club);

    return {
      ok: Boolean(club),
      state: club ? "ready" : "need_clubs",
      units,
      targetYards: Math.round(targetYards),
      playsLikeYards,
      club,
      calmClub,
      clubSteps: steps,
      clubLabel: clubChangeLabel(steps),
      usedWind: windKnown && windYards !== 0,
      windYards: Math.round(windYards),
      groundYards,
      rainYards,
    };
  } catch {
    return {
      ok: false,
      state: "need_target",
      units: "yd",
      targetYards: null,
      playsLikeYards: null,
      club: null,
      calmClub: null,
      clubSteps: 0,
      clubLabel: "Normal club",
      usedWind: false,
      windYards: 0,
      groundYards: 0,
      rainYards: 0,
    };
  }
}
