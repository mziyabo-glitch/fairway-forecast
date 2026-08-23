/** Local persistence — structured so localStorage can later sync to cloud. No auth yet. */

const STORAGE_KEY = "fw_rebuild_prefs";
const LEGACY_FAVS_KEY = "ff_favourites_v1";
const STORAGE_VERSION = 2;
const MAX_RECENT = 5;
const MAX_FAVOURITES = 24;

const DEFAULT_PREFS = {
  version: STORAGE_VERSION,
  lastCourse: null,
  recentCourses: [],
  lastHolesPreference: 18,
  lastTeeTimePreference: null,
  lastDateKey: null,
  favourites: [],
  savedRounds: [],
};

function memoryStore() {
  if (!globalThis.__fwPersistMem) globalThis.__fwPersistMem = new Map();
  return {
    getItem: (k) => (globalThis.__fwPersistMem.has(k) ? globalThis.__fwPersistMem.get(k) : null),
    setItem: (k, v) => {
      globalThis.__fwPersistMem.set(k, String(v));
    },
    removeItem: (k) => {
      globalThis.__fwPersistMem.delete(k);
    },
  };
}

function getStore() {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* private mode */
  }
  return memoryStore();
}

export function normalizeCourse(course) {
  if (!course) return null;
  const city = course.city ?? "";
  const state = course.state ?? "";
  const location =
    course.location ||
    [city, state, course.country].filter(Boolean).join(", ") ||
    "";
  return {
    id: course.id ?? null,
    name: course.name ?? "",
    location,
    lat: Number.isFinite(Number(course.lat)) ? Number(course.lat) : null,
    lon: Number.isFinite(Number(course.lon)) ? Number(course.lon) : null,
    country: course.country ?? "",
    city,
    state,
  };
}

export function favKey(course) {
  const id = course?.id ? String(course.id) : "";
  const lat = Number(course?.lat);
  const lon = Number(course?.lon);
  if (id) return `id:${id}`;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `ll:${lat.toFixed(5)},${lon.toFixed(5)}`;
  }
  return `name:${(course?.name || "").toLowerCase()}`;
}

export function createLastKnownForecast(verdict, fetchedAt = Date.now()) {
  const rainRisk =
    typeof verdict?.metrics?.maxPrecipProb === "number"
      ? verdict.metrics.maxPrecipProb
      : typeof verdict?.maxPop === "number"
        ? Math.round(verdict.maxPop <= 1 ? verdict.maxPop * 100 : verdict.maxPop)
        : null;

  return {
    score: Number.isFinite(verdict?.score) ? verdict.score : null,
    verdict: verdict?.verdict ?? verdict?.status?.label ?? null,
    rainRisk,
    message: verdict?.message ?? "",
    fetchedAt,
  };
}

export function isRoundPast(round, nowMs = Date.now()) {
  if (!round) return false;
  const start = Number(round.teeTime);
  if (!Number.isFinite(start) || start <= 0) return false;
  const hours = round.holes === 9 ? 2 : 4;
  return (start + hours * 3600) * 1000 < nowMs;
}

function migrateLegacyFavourites(store) {
  try {
    const raw = store.getItem(LEGACY_FAVS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((f) => {
        const course = normalizeCourse(f);
        if (!course) return null;
        return {
          ...course,
          addedAt: f.addedAt || Date.now(),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readRaw() {
  const store = getStore();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = migrateLegacyFavourites(store);
      const prefs = { ...DEFAULT_PREFS, favourites: legacy };
      if (legacy.length) writeRaw(prefs);
      return prefs;
    }
    const parsed = JSON.parse(raw);
    const prefs = {
      ...DEFAULT_PREFS,
      ...parsed,
      version: STORAGE_VERSION,
      favourites: Array.isArray(parsed.favourites) ? parsed.favourites : [],
      savedRounds: Array.isArray(parsed.savedRounds) ? parsed.savedRounds : [],
    };
    if (!prefs.favourites.length) {
      const legacy = migrateLegacyFavourites(store);
      if (legacy.length) {
        prefs.favourites = legacy;
        writeRaw(prefs);
      }
    }
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writeRaw(prefs) {
  try {
    getStore().setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class PersistenceService {
  load() {
    return readRaw();
  }

  saveLastCourse(course) {
    const entry = normalizeCourse(course);
    if (!entry?.id && !entry?.name) return;
    const prefs = readRaw();
    prefs.lastCourse = entry;
    prefs.recentCourses = [
      entry,
      ...(prefs.recentCourses || []).filter((c) => favKey(c) !== favKey(entry)),
    ].slice(0, MAX_RECENT);
    writeRaw(prefs);
  }

  getLastCourse() {
    return readRaw().lastCourse;
  }

  getRecentCourses() {
    return readRaw().recentCourses || [];
  }

  saveHolesPreference(holes) {
    const prefs = readRaw();
    prefs.lastHolesPreference = holes === 9 ? 9 : 18;
    writeRaw(prefs);
  }

  getHolesPreference() {
    const h = readRaw().lastHolesPreference;
    return h === 9 ? 9 : 18;
  }

  saveTeeTimePreference(teeTimeUnix, dateKey) {
    const prefs = readRaw();
    prefs.lastTeeTimePreference = teeTimeUnix;
    if (dateKey) prefs.lastDateKey = dateKey;
    writeRaw(prefs);
  }

  getTeeTimePreference() {
    const prefs = readRaw();
    return {
      teeTime: prefs.lastTeeTimePreference,
      dateKey: prefs.lastDateKey,
    };
  }

  getFavourites() {
    return (readRaw().favourites || []).map((f) => normalizeCourse(f)).filter(Boolean);
  }

  isFavourite(course) {
    if (!course) return false;
    const key = favKey(course);
    return (readRaw().favourites || []).some((f) => favKey(f) === key);
  }

  addFavourite(course) {
    const entry = normalizeCourse(course);
    if (!entry) return this.getFavourites();
    const prefs = readRaw();
    const key = favKey(entry);
    const next = (prefs.favourites || []).filter((f) => favKey(f) !== key);
    next.unshift({ ...entry, addedAt: Date.now() });
    if (next.length > MAX_FAVOURITES) next.length = MAX_FAVOURITES;
    prefs.favourites = next;
    writeRaw(prefs);
    return prefs.favourites;
  }

  removeFavourite(course) {
    if (!course) return this.getFavourites();
    const prefs = readRaw();
    const key = favKey(course);
    prefs.favourites = (prefs.favourites || []).filter((f) => favKey(f) !== key);
    writeRaw(prefs);
    return prefs.favourites;
  }

  /** @returns {boolean} true if the course is now a favourite */
  toggleFavourite(course) {
    if (this.isFavourite(course)) {
      this.removeFavourite(course);
      return false;
    }
    this.addFavourite(course);
    return true;
  }

  getRounds() {
    return [...(readRaw().savedRounds || [])];
  }

  getRound(id) {
    return this.getRounds().find((r) => r.id === id) || null;
  }

  getUpcomingRounds(nowMs = Date.now()) {
    return this.getRounds()
      .filter((r) => !isRoundPast(r, nowMs))
      .sort((a, b) => (a.teeTime || 0) - (b.teeTime || 0));
  }

  getPastRounds(nowMs = Date.now()) {
    return this.getRounds()
      .filter((r) => isRoundPast(r, nowMs))
      .sort((a, b) => (b.teeTime || 0) - (a.teeTime || 0));
  }

  saveRound(input) {
    const prefs = readRaw();
    const course = normalizeCourse(input.course);
    const lastKnownForecast = input.lastKnownForecast
      ? {
          score: input.lastKnownForecast.score ?? null,
          verdict: input.lastKnownForecast.verdict ?? null,
          rainRisk: input.lastKnownForecast.rainRisk ?? null,
          message: input.lastKnownForecast.message ?? "",
          fetchedAt: input.lastKnownForecast.fetchedAt ?? Date.now(),
        }
      : createLastKnownForecast(null);

    const record = {
      id: input.id || uid("rnd"),
      course,
      date: input.date || null,
      teeTime: Number.isFinite(Number(input.teeTime)) ? Number(input.teeTime) : null,
      holes: input.holes === 9 ? 9 : 18,
      createdAt: input.createdAt || Date.now(),
      lastKnownForecast,
    };

    const existing = (prefs.savedRounds || []).findIndex((r) => r.id === record.id);
    if (existing >= 0) prefs.savedRounds[existing] = record;
    else prefs.savedRounds = [record, ...(prefs.savedRounds || [])];
    writeRaw(prefs);
    return record;
  }

  updateRoundForecast(id, lastKnownForecast) {
    const prefs = readRaw();
    const idx = (prefs.savedRounds || []).findIndex((r) => r.id === id);
    if (idx < 0) return null;
    prefs.savedRounds[idx] = {
      ...prefs.savedRounds[idx],
      lastKnownForecast: {
        score: lastKnownForecast?.score ?? null,
        verdict: lastKnownForecast?.verdict ?? null,
        rainRisk: lastKnownForecast?.rainRisk ?? null,
        message: lastKnownForecast?.message ?? "",
        fetchedAt: lastKnownForecast?.fetchedAt ?? Date.now(),
      },
    };
    writeRaw(prefs);
    return prefs.savedRounds[idx];
  }

  deleteRound(id) {
    const prefs = readRaw();
    prefs.savedRounds = (prefs.savedRounds || []).filter((r) => r.id !== id);
    writeRaw(prefs);
    return prefs.savedRounds;
  }
}
