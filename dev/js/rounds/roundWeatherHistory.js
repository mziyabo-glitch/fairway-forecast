import { createJsonStore } from "../storage/jsonStore.js";

const store = createJsonStore("fw_dev_round_weather_v1");

function readAll() {
  const raw = store.read();
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

export function snapshotFromKnown(known) {
  if (!known || typeof known !== "object") return null;
  return {
    score: Number.isFinite(Number(known.score)) ? Number(known.score) : null,
    rainProbability: Number.isFinite(Number(known.rainProbability)) ? Number(known.rainProbability) : null,
    rainMm: Number.isFinite(Number(known.rainMm)) ? Number(known.rainMm) : null,
    wind: Number.isFinite(Number(known.wind)) ? Number(known.wind) : null,
    gust: Number.isFinite(Number(known.gust)) ? Number(known.gust) : null,
    tempC: Number.isFinite(Number(known.tempC)) ? Number(known.tempC) : null,
    rainStartUnix: Number.isFinite(Number(known.rainStartUnix)) ? Number(known.rainStartUnix) : null,
    checkedAt: Number.isFinite(Number(known.checkedAt)) ? Number(known.checkedAt) : null,
  };
}

export function getRoundWeatherPair(roundId) {
  if (!roundId) return null;
  const row = readAll()[roundId];
  if (!row || typeof row !== "object") return null;
  return {
    original: snapshotFromKnown(row.original),
    latest: snapshotFromKnown(row.latest),
  };
}

/** Keeps the first original snapshot and replaces latest. Storage errors are ignored. */
export function recordRoundWeather(roundId, latest, { seedOriginal = null } = {}) {
  if (!roundId || !latest) return null;
  const all = readAll();
  const prev = all[roundId] || {};
  const original = snapshotFromKnown(prev.original) || snapshotFromKnown(seedOriginal) || snapshotFromKnown(latest);
  const nextLatest = snapshotFromKnown(latest);
  all[roundId] = { original, latest: nextLatest };
  store.write(all);
  return { original, latest: nextLatest };
}

export function forgetRoundWeather(roundId) {
  if (!roundId) return;
  const all = readAll();
  delete all[roundId];
  store.write(all);
}

export function resetRoundWeatherHistory() {
  store.clear();
}
